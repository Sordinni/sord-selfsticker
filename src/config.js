import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 3002,
  host: process.env.HOST || "0.0.0.0",
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost:3000,https://sordbot.site,https://www.sordbot.site")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || path.join(__dirname, "../sessions")),
  tempDir: path.resolve(process.env.TEMP_DIR || path.join(os.tmpdir(), "sord-selfsticker")),
  stickerPackName: process.env.STICKER_PACK_NAME || "twitter - @sordbot",
  stickerPackAuthor: process.env.STICKER_PACK_AUTHOR ?? "",
  maxVideoDurationSeconds: Number(process.env.MAX_VIDEO_DURATION_SECONDS) || 10,
  maxMediaBytes: Number(process.env.MAX_MEDIA_BYTES) || 32 * 1024 * 1024,
  maxStickerSizeBytes: 1024 * 1024, // 1MB WhatsApp limit
  rateLimitPairingPerIp: Number(process.env.RATE_LIMIT_PAIRING_PER_IP) || 3,
  cooldownMinutesPerPhone: Number(process.env.COOLDOWN_MINUTES_PER_PHONE) || 15,
  broadcastToken: process.env.BROADCAST_TOKEN || "",
  owners: (process.env.OWNERS || "32472916180")
    .split(",")
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean),
};
