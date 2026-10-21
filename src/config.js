import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 3002,
  host: process.env.HOST || "0.0.0.0",
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost:3000,https://sordbot.site")
    .split(",")
    .map((s) => s.trim()),
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || path.join(__dirname, "../sessions")),
  stickerPackName: process.env.STICKER_PACK_NAME || "Feito por Mim",
  stickerPackAuthor: process.env.STICKER_PACK_AUTHOR || "SejaBot",
  maxVideoDurationSeconds: Number(process.env.MAX_VIDEO_DURATION_SECONDS) || 10,
  maxStickerSizeBytes: 1024 * 1024, // 1MB WhatsApp limit
  rateLimitPairingPerIp: Number(process.env.RATE_LIMIT_PAIRING_PER_IP) || 3,
  cooldownMinutesPerPhone: Number(process.env.COOLDOWN_MINUTES_PER_PHONE) || 15,
};
