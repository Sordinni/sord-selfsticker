import {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { createConnection, BaileysVersion } from "./connection.js";
import { naruyaizumi } from "./socket.js";
import { attachZeroSightHandler, mediaQueue, trackBotMessage } from "./zero-sight.js";
import { forgetUserPrefs, flushUserPrefs } from "../sticker/user-prefs.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

const versionFetcher = new BaileysVersion();

export class SessionManager {
  constructor() {
    /** @type {Map<string, { sock: any, status: string, code?: string|null, createdAt: number, reconnectAttempts: number, reconnectTimer: any, disconnecting?: boolean }>} */
    this.sessions = new Map();
    this.shuttingDown = false;
    this.restorePromise = Promise.resolve();
  }

  async init() {
    await fs.mkdir(config.sessionsDir, { recursive: true, mode: 0o700 });

    const phones = [];
    try {
      const entries = await fs.readdir(config.sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d{7,16}$/.test(entry.name)) continue;
        const phone = entry.name;
        const credsPath = path.join(config.sessionsDir, phone, "creds.json");
        try {
          const raw = await fs.readFile(credsPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed?.registered) {
            phones.push(phone);
          }
        } catch (_) {}
      }
    } catch (err) {
      logger.error({ err }, "[Session] Error scanning existing sessions");
    }

    this.restorePromise = this.restoreSessions(phones);
    return this.restorePromise;
  }

  async restoreSessions(phones) {
    for (const phone of phones) {
      if (this.shuttingDown) break;
      logger.info(`[Session] Restoring saved companion session for: ${phone}`);
      try {
        await this.connectSocket(phone, false);
      } catch (err) {
        if (this.shuttingDown) break;
        logger.error({ err }, `[Session] Could not restore session for: ${phone}`);
        const session = this.sessions.get(phone) || {
          sock: null,
          status: "disconnected",
          code: null,
          createdAt: Date.now(),
          reconnectAttempts: 0,
          reconnectTimer: null,
        };
        this.sessions.set(phone, session);
        this.scheduleReconnect(phone, session);
      }
      // Stagger restored connections to avoid simultaneous bursts
      await new Promise((resolve) => setTimeout(resolve, 200 + Math.floor(Math.random() * 200)));
    }
  }

  getSessionPath(cleanPhone) {
    return path.join(config.sessionsDir, cleanPhone);
  }

  scheduleReconnect(phone, session, isRestartRequired = false) {
    if (
      this.shuttingDown ||
      session.disconnecting ||
      this.sessions.get(phone) !== session ||
      session.reconnectTimer
    ) {
      return;
    }

    session.status = "reconnecting";
    session.reconnectAttempts = (session.reconnectAttempts || 0) + 1;

    const cap = Math.min(60000, 1000 * 2 ** Math.min(session.reconnectAttempts, 6));
    const delay = isRestartRequired
      ? 500
      : Math.floor(cap / 2 + (Math.random() * cap) / 2);

    logger.info(
      `[Session] Scheduling auto-reconnect for ${phone} in ${delay}ms (attempt ${session.reconnectAttempts})...`
    );

    session.reconnectTimer = setTimeout(async () => {
      session.reconnectTimer = null;
      if (this.shuttingDown || session.disconnecting || this.sessions.get(phone) !== session) {
        return;
      }
      try {
        await this.connectSocket(phone, false);
      } catch (err) {
        logger.error({ err }, `[Session] Failed to auto-reconnect ${phone}`);
        this.scheduleReconnect(phone, session, false);
      }
    }, delay);
  }

  /**
   * Conecta ou reconecta o socket do companion.
   * @param {string} cleanPhone
   * @param {boolean} isInitialPairing
   */
  async connectSocket(cleanPhone, isInitialPairing = false) {
    if (this.shuttingDown) throw new Error("Serviço encerrando");
    const sessionDir = this.getSessionPath(cleanPhone);

    let sessionData = this.sessions.get(cleanPhone);
    if (!sessionData) {
      sessionData = {
        sock: null,
        status: isInitialPairing ? "pairing" : "connecting",
        code: null,
        createdAt: Date.now(),
        reconnectAttempts: 0,
        reconnectTimer: null,
        disconnecting: false,
      };
      this.sessions.set(cleanPhone, sessionData);
    } else {
      if (sessionData.reconnectTimer) {
        clearTimeout(sessionData.reconnectTimer);
        sessionData.reconnectTimer = null;
      }
      sessionData.disconnecting = false;
      if (isInitialPairing) {
        sessionData.status = "pairing";
        sessionData.createdAt = Date.now();
        sessionData.reconnectAttempts = 0;
      }
    }

    if (isInitialPairing) {
      await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    }

    const waVersion = await versionFetcher.fetchVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    if (this.shuttingDown || sessionData.disconnecting || this.sessions.get(cleanPhone) !== sessionData) {
      throw new Error("Serviço ou sessão encerrando");
    }

    const auth = { state, saveCreds };
    const silentLogger = pino({
      level: "silent",
      base: { module: "SORD-SELFSTICKER" },
    });

    const connectionConfig = createConnection(
      waVersion,
      auth,
      silentLogger,
      isInitialPairing ? cleanPhone : ""
    );

    const sock = naruyaizumi(connectionConfig);
    sessionData.sock = sock;

    sock.ev.on("creds.update", () =>
      Promise.resolve(saveCreds()).catch((err) => {
        logger.error({ err }, `[Session] Failed persisting credentials for ${cleanPhone}`);
      })
    );

    sock.ev.on("connection.update", async (update) => {
      if (sessionData.sock !== sock || sessionData.disconnecting) return;
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        if (!sock.user?.id || jidNormalizedUser(sock.user.id) !== `${cleanPhone}@s.whatsapp.net`) {
          sessionData.status = "identity_mismatch";
          sessionData.disconnecting = true;
          try {
            sock.ev.removeAllListeners();
            sock.end?.();
            sock.ws?.close?.();
          } catch (_) {}
          sessionData.sock = null;
          logger.error(`[Session] Identity mismatch for ${cleanPhone}`);
          return;
        }

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

        logger.warn(
          `[Session] Connection closed for ${cleanPhone}. Reason: ${statusCode}, Reconnect: ${shouldReconnect}`
        );

        try {
          sock.ev.removeAllListeners();
          sock.ws?.close?.();
        } catch (_) {}

        if (sessionData.reconnectTimer) {
          clearTimeout(sessionData.reconnectTimer);
          sessionData.reconnectTimer = null;
        }

        if (!shouldReconnect) {
          sessionData.sock = null;
          sessionData.status = "logged_out";
          await this.disconnect(cleanPhone).catch(() => {});
        } else if (
          state.creds.registered ||
          statusCode === DisconnectReason.restartRequired ||
          statusCode === 515
        ) {
          const isRestartRequired =
            statusCode === DisconnectReason.restartRequired || statusCode === 515;
          this.scheduleReconnect(cleanPhone, sessionData, isRestartRequired);
        } else {
          sessionData.status = "disconnected";
        }
      }
    });

    return { sock, sessionData };
  }

  /**
   * Starts a pairing session for the given phone number.
   * @param {string} cleanPhone
   * @returns {Promise<{ code: string, sessionId: string, alreadyConnected?: boolean }>}
   */
  async startPairing(cleanPhone) {
    const existing = this.sessions.get(cleanPhone);
    if (existing && existing.status === "connected") {
      return { code: "CONNECTED", sessionId: cleanPhone, alreadyConnected: true };
    }

    if (
      existing &&
      (existing.status === "pairing" || existing.status === "connecting" || existing.status === "reconnecting") &&
      Date.now() - existing.createdAt < 120000
    ) {
      throw Object.assign(new Error("Sessão já existente ou pareamento em andamento."), {
        code: "EEXIST",
      });
    }

    if (existing?.reconnectTimer) {
      clearTimeout(existing.reconnectTimer);
      existing.reconnectTimer = null;
    }
    if (existing?.sock) {
      try {
        existing.sock.ev?.removeAllListeners();
        existing.sock.end?.();
        existing.sock.ws?.close?.();
      } catch (_) {}
      this.sessions.delete(cleanPhone);
    }

    const { sock, sessionData } = await this.connectSocket(cleanPhone, true);

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
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout conectando ao WhatsApp")), 10000)
          ),
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
          const isConnClosed =
            err?.output?.statusCode === 428 || err?.message?.includes("Connection Closed");
          if (isConnClosed && attempt < 3) {
            logger.warn(
              `[Session] Socket closed during pairing code request (attempt ${attempt}/3). Retrying...`
            );
            await new Promise((r) => setTimeout(r, 1500));
          } else {
            throw err;
          }
        }
      }

      if (!rawCode) {
        throw lastErr || new Error("Código de pareamento indisponível");
      }

      const formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;

      sessionData.code = formattedCode;
      sessionData.status = "pairing";
      return { code: formattedCode, sessionId: cleanPhone };
    } catch (err) {
      sessionData.disconnecting = true;
      if (sessionData.reconnectTimer) {
        clearTimeout(sessionData.reconnectTimer);
        sessionData.reconnectTimer = null;
      }
      try { sock.ev?.removeAllListeners(); } catch (_) {}
      try { sock.end?.(); } catch (_) {}
      try { sock.ws?.close?.(); } catch (_) {}
      if (this.sessions.get(cleanPhone) === sessionData) {
        this.sessions.delete(cleanPhone);
      }
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
   * Gracefully shuts down active sockets without deleting saved session files.
   */
  async shutdown() {
    this.shuttingDown = true;
    for (const session of this.sessions.values()) {
      session.disconnecting = true;
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      session.sock?.ev?.removeAllListeners("messages.upsert");
    }

    await Promise.all([mediaQueue.close(), this.restorePromise]);

    for (const [phone, session] of this.sessions.entries()) {
      await flushUserPrefs(phone).catch(() => {});
      try { session.sock?.ev?.removeAllListeners(); } catch (_) {}
      try { session.sock?.end?.(); } catch (_) {}
      try { session.sock?.ws?.close?.(); } catch (_) {}
    }
    this.sessions.clear();
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
    if (session) session.disconnecting = true;
    if (session?.sock) session.sock._selfstickerStopping = true;

    await mediaQueue.stopKey(cleanPhone);
    await flushUserPrefs(cleanPhone);

    if (session?.sock) {
      try {
        if (session.status === "connected") {
          await session.sock.logout();
        }
      } catch (_) {}
      try { session.sock.ev?.removeAllListeners(); } catch (_) {}
      try { session.sock.end?.(); } catch (_) {}
      try { session.sock.ws?.close?.(); } catch (_) {}
    }

    this.sessions.delete(cleanPhone);
    forgetUserPrefs(cleanPhone);
    mediaQueue.releaseKey(cleanPhone);

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
        session.disconnecting = true;
        if (session.reconnectTimer) {
          clearTimeout(session.reconnectTimer);
          session.reconnectTimer = null;
        }
        await mediaQueue.stopKey(phone);
        await flushUserPrefs(phone);
        if (session.sock) {
          try { session.sock.ev?.removeAllListeners(); } catch (_) {}
          try { await session.sock.logout?.(); } catch (_) {}
          try { session.sock.end?.(); } catch (_) {}
          try { session.sock.ws?.close?.(); } catch (_) {}
        }
        forgetUserPrefs(phone);
        mediaQueue.releaseKey(phone);
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
          const selfJid = session.sock.user?.id
            ? session.sock.user.id.split(":")[0] + "@s.whatsapp.net"
            : user.jid;
          const messageId = randomBytes(16).toString("hex").toUpperCase();
          trackBotMessage({ key: { id: messageId } });
          await session.sock.sendMessage(selfJid, { text: formatted }, { messageId });
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
