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

    // Wait until WebSocket is actually open (ws.isOpen or waitForSocketOpen)
    let isOpened = Boolean(sock.ws?.isOpen || sock.user);
    if (!isOpened) {
      for (let i = 0; i < 50; i++) {
        if (sock.ws?.isOpen || sock.user) {
          isOpened = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!isOpened && typeof sock.waitForSocketOpen === "function") {
      try {
        await Promise.race([
          sock.waitForSocketOpen(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout conectando ao WhatsApp")), 10000)),
        ]);
      } catch (_) {}
    }

    try {
      let rawCode;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          rawCode = await sock.requestPairingCode(cleanPhone);
          if (rawCode) break;
        } catch (err) {
          lastErr = err;
          const isConnClosed = err?.output?.statusCode === 428 || err?.message?.includes("Connection Closed");
          if (isConnClosed && attempt < 3) {
            logger.warn(`[Session] Socket closed during pairing code request (attempt ${attempt}/3). Retrying...`);
            await new Promise((r) => setTimeout(r, 1500));
          } else {
            throw err;
          }
        }
      }

      if (!rawCode && lastErr) {
        throw lastErr;
      }

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

  /**
   * Retorna lista de todos os usuarios cadastrados no Sord Self-Sticker
   * @returns {Promise<Array<{ phone: string, jid: string, isConnected: boolean }>>}
   */
  async getRegisteredUsers() {
    const usersMap = new Map();

    for (const [phone, session] of this.sessions.entries()) {
      const cleanPhone = phone.replace(/\D/g, "");
      if (cleanPhone) {
        usersMap.set(cleanPhone, {
          phone: cleanPhone,
          jid: `${cleanPhone}@s.whatsapp.net`,
          isConnected: session.status === "connected" && Boolean(session.sock),
        });
      }
    }

    try {
      await fs.mkdir(config.sessionsDir, { recursive: true, mode: 0o700 });
      const entries = await fs.readdir(config.sessionsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const cleanPhone = entry.name.replace(/\D/g, "");
        if (!cleanPhone || cleanPhone.length < 8) continue;

        const credsPath = path.join(config.sessionsDir, entry.name, "creds.json");
        try {
          const rawCreds = await fs.readFile(credsPath, "utf-8");
          const parsedCreds = JSON.parse(rawCreds);
          if (parsedCreds?.registered && !usersMap.has(cleanPhone)) {
            usersMap.set(cleanPhone, {
              phone: cleanPhone,
              jid: `${cleanPhone}@s.whatsapp.net`,
              isConnected: false,
            });
          }
        } catch (_) {}
      }
    } catch (err) {
      logger.error({ err }, "[Session] Erro ao listar usuarios cadastrados");
    }

    return Array.from(usersMap.values());
  }

  /**
   * Transmite comunicado oficial para todos os usuarios cadastrados
   * @param {string} announcement
   * @returns {Promise<{ total: number, successCount: number, failedCount: number, failures: Array<{ phone: string, error: string }> }>}
   */
  async broadcast(announcement) {
    const users = await this.getRegisteredUsers();
    const formatted = `[COMUNICADO OFICIAL - SELFBOT]\n\n${announcement}\n\n---\nMensagem enviada para todos os usuarios cadastrados no Selfbot.`;

    let successCount = 0;
    let failedCount = 0;
    const failures = [];

    for (const user of users) {
      try {
        const session = this.sessions.get(user.phone);
        if (session?.sock && session.status === "connected") {
          const selfJid = session.sock.user?.id ? session.sock.user.id.split(":")[0] + "@s.whatsapp.net" : user.jid;
          await session.sock.sendMessage(selfJid, { text: formatted });
          successCount++;
        } else {
          failedCount++;
          failures.push({
            phone: user.phone,
            error: "Sessao companion nao conectada no momento",
          });
        }
      } catch (err) {
        failedCount++;
        failures.push({
          phone: user.phone,
          error: err.message || "Falha no envio",
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    return {
      total: users.length,
      successCount,
      failedCount,
      failures,
    };
  }
}

export const sessionManager = new SessionManager();
