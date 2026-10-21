import {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { createConnection, BaileysVersion } from "./connection.js";
import { naruyaizumi } from "./socket.js";
import { attachZeroSightHandler } from "./zero-sight.js";

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

const versionFetcher = new BaileysVersion();

class SessionManager {
  constructor() {
    /** @type {Map<string, { sock: any, status: 'pairing' | 'connected' | 'disconnected', code?: string, createdAt: number }>} */
    this.sessions = new Map();
  }

  async init() {
    await fs.mkdir(config.sessionsDir, { recursive: true, mode: 0o700 });

    // Restaura sessões ativas existentes na inicialização
    try {
      const entries = await fs.readdir(config.sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const phone = entry.name;
          const credsPath = path.join(config.sessionsDir, phone, "creds.json");
          try {
            await fs.access(credsPath);
            logger.info(`[Session] Restoring saved companion session for: ${phone}`);
            this.connectSocket(phone, false).catch((err) => {
              logger.error({ err }, `[Session] Could not restore session for: ${phone}`);
            });
          } catch (_) {}
        }
      }
    } catch (err) {
      logger.error({ err }, "[Session] Error scanning existing sessions");
    }
  }

  getSessionPath(cleanPhone) {
    return path.join(config.sessionsDir, cleanPhone);
  }

  /**
   * Conecta ou reconecta o socket do companion usando a engine do Sordinho
   * @param {string} cleanPhone
   * @param {boolean} isInitialPairing
   */
  async connectSocket(cleanPhone, isInitialPairing = false) {
    const sessionDir = this.getSessionPath(cleanPhone);

    if (isInitialPairing) {
      await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    }

    const waVersion = await versionFetcher.fetchVersion();

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const auth = { state, saveCreds };

    const silentLogger = pino({
      level: "silent",
      base: { module: "SORD-SELFSTICKER" },
    });

    // Se for reconexão, não passamos cleanPhone como pairingNumber para não forçar usePairingCode
    const connectionConfig = createConnection(
      waVersion,
      auth,
      silentLogger,
      isInitialPairing ? cleanPhone : ""
    );

    const sock = naruyaizumi(connectionConfig);

    sock.ev.on("creds.update", saveCreds);

    let sessionData = this.sessions.get(cleanPhone);
    if (!sessionData) {
      sessionData = {
        sock,
        status: isInitialPairing ? "pairing" : "connecting",
        code: null,
        createdAt: Date.now(),
        reconnectAttempts: 0,
        reconnectTimer: null,
      };
      this.sessions.set(cleanPhone, sessionData);
    } else {
      if (sessionData.reconnectTimer) {
        clearTimeout(sessionData.reconnectTimer);
        sessionData.reconnectTimer = null;
      }
      sessionData.sock = sock;
      if (isInitialPairing) {
        sessionData.status = "pairing";
        sessionData.reconnectAttempts = 0;
      }
    }

    // Handle connection state changes
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        logger.info(`[Session] WhatsApp companion connected successfully for: ${cleanPhone}`);
        sessionData.status = "connected";
        sessionData.reconnectAttempts = 0;
        if (sessionData.reconnectTimer) {
          clearTimeout(sessionData.reconnectTimer);
          sessionData.reconnectTimer = null;
        }
        attachZeroSightHandler(sock, cleanPhone, logger);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(`[Session] Connection closed for ${cleanPhone}. Reason: ${statusCode}, Reconnect: ${shouldReconnect}`);

        try {
          sock.ev.removeAllListeners();
          sock.ws?.close?.();
        } catch (_) {}

        if (sessionData.reconnectTimer) {
          clearTimeout(sessionData.reconnectTimer);
          sessionData.reconnectTimer = null;
        }

        if (!shouldReconnect) {
          await this.disconnect(cleanPhone);
        } else {
          sessionData.status = "reconnecting";
          sessionData.reconnectAttempts = (sessionData.reconnectAttempts || 0) + 1;

          // Status 515 (restartRequired) é disparado imediatamente após o usuário digitar o código no celular!
          // O WhatsApp exige reiniciar a conexão para carregar as credenciais validadas.
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
          const delayMs = isRestartRequired ? 500 : Math.min(2500 * sessionData.reconnectAttempts, 15000);

          if (sessionData.reconnectAttempts > 8 && !isRestartRequired) {
            logger.warn(`[Session] Reconnection attempt limit reached for ${cleanPhone}`);
            sessionData.status = "disconnected";
            this.sessions.delete(cleanPhone);
            return;
          }

          logger.info(`[Session] Scheduling auto-reconnect for ${cleanPhone} in ${delayMs}ms (attempt ${sessionData.reconnectAttempts}, status: ${statusCode})...`);
          sessionData.reconnectTimer = setTimeout(() => {
            sessionData.reconnectTimer = null;
            this.connectSocket(cleanPhone, false).catch((err) => {
              logger.error({ err }, `[Session] Failed to auto-reconnect ${cleanPhone}`);
            });
          }, delayMs);
        }
      }
    });

    return { sock, sessionData };
  }

  /**
   * Starts a pairing session for the given phone number using Sordinho's exact initialization instance.
   * @param {string} cleanPhone
   * @returns {Promise<{ code: string, sessionId: string, alreadyConnected?: boolean }>}
   */
  async startPairing(cleanPhone) {
    // If there is already an active connected session, return status
    const existing = this.sessions.get(cleanPhone);
    if (existing && existing.status === "connected") {
      return { code: "CONNECTED", sessionId: cleanPhone, alreadyConnected: true };
    }

    // Clean any prior pending socket
    if (existing?.sock) {
      try { existing.sock.end(); } catch (_) {}
      this.sessions.delete(cleanPhone);
    }

    const { sock, sessionData } = await this.connectSocket(cleanPhone, true);

    // Wait actively until WebSocket is open (readyState === 1) exactly as in Sordinho
    await new Promise((resolve) => {
      let ticks = 0;
      const maxTicks = 40;
      const interval = setInterval(() => {
        ticks++;
        const isReady = sock.user || sock.ws?.readyState === 1;
        if (isReady || ticks >= maxTicks) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    try {
      let rawCode = await sock.requestPairingCode(cleanPhone);
      const formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;

      sessionData.code = formattedCode;
      sessionData.status = "pairing";
      return { code: formattedCode, sessionId: cleanPhone };
    } catch (err) {
      this.sessions.delete(cleanPhone);
      throw new Error(`Falha ao solicitar código de emparelhamento: ${err.message}`);
    }
  }

  /**
   * Retrieves status for a session.
   * @param {string} cleanPhone
   */
  getStatus(cleanPhone) {
    const session = this.sessions.get(cleanPhone);
    if (!session) {
      return { status: "not_found" };
    }
    return {
      status: session.status,
      phone: cleanPhone,
      connectedAt: session.status === "connected" ? session.createdAt : null,
    };
  }

  /**
   * Closes socket and wipes all session files securely from disk.
   * @param {string} cleanPhone
   */
  async disconnect(cleanPhone) {
    const session = this.sessions.get(cleanPhone);
    if (session?.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
    if (session?.sock) {
      try {
        await session.sock.logout();
      } catch (_) {}
      try {
        session.sock.end();
      } catch (_) {}
    }

    this.sessions.delete(cleanPhone);

    const sessionDir = this.getSessionPath(cleanPhone);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
      logger.info(`[Session] Purged credentials directory for: ${cleanPhone}`);
    } catch (err) {
      logger.error({ err }, `[Session] Failed removing session directory for: ${cleanPhone}`);
    }
  }

  /**
   * Closes all active sessions, cancels all reconnection timers, and wipes storage directory.
   */
  async disconnectAll() {
    const disconnected = [];
    for (const [phone, session] of this.sessions.entries()) {
      try {
        if (session.reconnectTimer) {
          clearTimeout(session.reconnectTimer);
          session.reconnectTimer = null;
        }
        if (session.sock) {
          try { session.sock.ev?.removeAllListeners(); } catch (_) {}
          try { await session.sock.logout?.(); } catch (_) {}
          try { session.sock.end?.(); } catch (_) {}
          try { session.sock.ws?.close?.(); } catch (_) {}
        }
        disconnected.push(phone);
      } catch (_) {}
    }
    this.sessions.clear();

    try {
      await fs.rm(config.sessionsDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(config.sessionsDir, { recursive: true, mode: 0o700 });
      logger.info(`[Session] Disconnected all sessions (${disconnected.length}) and wiped storage.`);
    } catch (err) {
      logger.error({ err }, "[Session] Failed to wipe sessions directory");
    }

    return { count: disconnected.length, phones: disconnected };
  }
}

export const sessionManager = new SessionManager();
