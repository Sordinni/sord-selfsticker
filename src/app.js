import express from "express";
import cors from "cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { validateAndCleanPhone, checkPairingLimits } from "./security/sanitizer.js";
import { FixedWindowLimiter } from "./security/rate-limit.js";

function isAllowedOrigin(origin, corsOrigins) {
  if (!origin) return true;
  if (corsOrigins.includes("*")) return true;
  if (corsOrigins.some((allowed) => origin === allowed || origin.startsWith(allowed))) {
    return true;
  }
  return origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
}

function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Builds the Express HTTP application for WhatsApp pairing, status, and disconnect.
 * @param {{ manager: any, config: any }} deps
 */
export function createApp({ manager, config }) {
  const app = express();
  const byIp = new FixedWindowLimiter({ windowMs: 60000 });
  const bySession = new FixedWindowLimiter({ windowMs: 60000 });

  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  app.use(
    cors({
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin, config.corsOrigins)),
      credentials: true,
    })
  );

  app.use(express.json({ limit: "16kb", strict: true }));

  app.use("/api/sejabot", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!byIp.allow(req.ip || "127.0.0.1", 600)) {
      return res.status(429).json({ success: false, message: "Muitas requisições." });
    }
    if (req.path === "/status" && typeof req.query.sessionId === "string") {
      const id = createHash("sha256").update(req.query.sessionId.slice(0, 64)).digest("hex");
      if (!bySession.allow(id, 120)) {
        return res.status(429).json({ success: false, message: "Muitas consultas." });
      }
    }
    next();
  });

  app.get(["/health", "/health/live"], (_req, res) => {
    res.json({
      status: "ok",
      service: "sord-selfsticker",
      version: "1.1.0",
      time: new Date().toISOString(),
    });
  });

  /**
   * POST /api/sejabot/pair
   * Initiates pairing and returns the 8-character code.
   */
  app.post("/api/sejabot/pair", async (req, res) => {
    try {
      const clientIp =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.ip ||
        req.socket?.remoteAddress ||
        "127.0.0.1";
      const { phone } = req.body || {};

      const validation = validateAndCleanPhone(phone);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }

      const cleanPhone = validation.cleanPhone;
      const rateCheck = checkPairingLimits(clientIp, cleanPhone);
      if (!rateCheck.allowed) {
        return res.status(429).json({ success: false, message: rateCheck.reason });
      }

      const result = await manager.startPairing(cleanPhone);

      return res.json({
        success: true,
        code: result.code,
        sessionId: result.sessionId,
        alreadyConnected: result.alreadyConnected || false,
        expiresIn: 120,
      });
    } catch (err) {
      if (err?.code === "EEXIST") {
        return res.status(409).json({ success: false, message: err.message });
      }
      console.error("[API] Error in /pair:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Erro interno ao iniciar emparelhamento.",
      });
    }
  });

  /**
   * GET /api/sejabot/status
   * Queries current connection status for a session.
   */
  app.get("/api/sejabot/status", (req, res) => {
    try {
      const { sessionId } = req.query;
      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ success: false, message: "Parâmetro sessionId é obrigatório." });
      }

      const cleanPhone = sessionId.replace(/\D/g, "");
      if (!/^\d{7,16}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, message: "Parâmetro sessionId inválido." });
      }

      const status = manager.getStatus(cleanPhone);
      return res.json({ success: true, ...status });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  /**
   * POST /api/sejabot/disconnect
   * Terminates session and permanently deletes authentication credentials.
   */
  app.post("/api/sejabot/disconnect", async (req, res) => {
    try {
      const { sessionId } = req.body || {};
      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ success: false, message: "Parâmetro sessionId é obrigatório." });
      }

      const cleanPhone = sessionId.replace(/\D/g, "");
      if (!/^\d{7,16}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, message: "Parâmetro sessionId inválido." });
      }

      await manager.disconnect(cleanPhone);

      return res.json({
        success: true,
        message: "Sessão encerrada e chaves excluídas com sucesso.",
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  /**
   * POST /api/sejabot/enviar
   * POST /api/sejabot/broadcast
   * Protected by BROADCAST_TOKEN when configured; disabled otherwise.
   */
  app.post(["/api/sejabot/enviar", "/api/sejabot/broadcast"], async (req, res) => {
    try {
      if (!config.broadcastToken) {
        return res.status(403).json({
          success: false,
          message: "Broadcast HTTP desabilitado. Configure BROADCAST_TOKEN ou use .enviar no chat do dono.",
        });
      }

      const authHeader = req.get("authorization") || "";
      const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (!tokensMatch(provided, config.broadcastToken)) {
        return res.status(401).json({ success: false, message: "Não autorizado." });
      }

      const { message, announcement } = req.body || {};
      const text = (announcement || message || "").trim();
      if (!text) {
        return res.status(400).json({ success: false, message: "Campo message ou announcement obrigatório." });
      }

      const result = await manager.broadcast(text);
      return res.json({ success: true, ...result });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  app.use((err, _req, res, _next) => {
    res
      .status(err?.status === 413 ? 413 : 400)
      .json({ success: false, message: "Requisição inválida." });
  });

  return app;
}
