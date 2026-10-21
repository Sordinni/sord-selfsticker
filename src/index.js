import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { sessionManager } from "./baileys/session-manager.js";
import { validateAndCleanPhone, checkPairingLimits } from "./security/sanitizer.js";

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      if (
        config.corsOrigins.includes("*") ||
        config.corsOrigins.some((allowed) => origin.startsWith(allowed)) ||
        origin.includes("localhost")
      ) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in dev/self-hosted mode
    },
    credentials: true,
  })
);

// Healthcheck endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "sord-selfsticker",
    version: "1.0.0",
    time: new Date().toISOString(),
  });
});

/**
 * POST /api/sejabot/pair
 * Initiates pairing and returns the 8-character code.
 */
app.post("/api/sejabot/pair", async (req, res) => {
  try {
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "127.0.0.1";
    const { phone } = req.body;

    const validation = validateAndCleanPhone(phone);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const cleanPhone = validation.cleanPhone;

    // Rate limit check
    const rateCheck = checkPairingLimits(clientIp, cleanPhone);
    if (!rateCheck.allowed) {
      return res.status(429).json({ success: false, message: rateCheck.reason });
    }

    // Start pairing
    const result = await sessionManager.startPairing(cleanPhone);

    return res.json({
      success: true,
      code: result.code,
      sessionId: result.sessionId,
      alreadyConnected: result.alreadyConnected || false,
      expiresIn: 120, // Pairing codes typically expire in 2 minutes
    });
  } catch (err) {
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
    const status = sessionManager.getStatus(cleanPhone);

    return res.json({
      success: true,
      ...status,
    });
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
    const { sessionId } = req.body;
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ success: false, message: "Parâmetro sessionId é obrigatório." });
    }

    const cleanPhone = sessionId.replace(/\D/g, "");
    await sessionManager.disconnect(cleanPhone);

    return res.json({
      success: true,
      message: "Sessão encerrada e chaves excluídas com sucesso.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Boot server
async function main() {
  await sessionManager.init();
  app.listen(config.port, config.host, () => {
    console.log(`🚀 Sord Self-Sticker running on http://${config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal initialization error:", err);
  process.exit(1);
});
