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
  }

  getSessionPath(cleanPhone) {
    return path.join(config.sessionsDir, cleanPhone);
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

    // Clean any prior pending socket and stale creds to ensure fresh key negotiation
    if (existing?.sock) {
      try { existing.sock.end(); } catch (_) {}
      this.sessions.delete(cleanPhone);
    }

    const sessionDir = this.getSessionPath(cleanPhone);
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });

    // Fetch latest WhatsApp Web version to prevent handshake rejection
    const waVersion = await versionFetcher.fetchVersion();

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const auth = { state, saveCreds };

    const silentLogger = pino({
      level: "silent",
      base: { module: "SORD-SELFSTICKER" },
    });

    // Usa createConnection idêntico ao Sordinho
    const connectionConfig = createConnection(
      waVersion,
      auth,
      silentLogger,
      cleanPhone
    );

    // Usa naruyaizumi idêntico ao Sordinho
    const sock = naruyaizumi(connectionConfig);

    sock.ev.on("creds.update", saveCreds);

    const sessionData = {
      sock,
      status: "pairing",
      code: null,
      createdAt: Date.now(),
    };
    this.sessions.set(cleanPhone, sessionData);

    // Handle connection state changes
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        logger.info(`[Session] WhatsApp companion connected successfully for: ${cleanPhone}`);
        sessionData.status = "connected";
        attachZeroSightHandler(sock, cleanPhone, logger);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(`[Session] Connection closed for ${cleanPhone}. Reason: ${statusCode}, Reconnect: ${shouldReconnect}`);

        if (!shouldReconnect) {
          await this.disconnect(cleanPhone);
        } else {
          sessionData.status = "disconnected";
        }
      }
    });

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
}

export const sessionManager = new SessionManager();
