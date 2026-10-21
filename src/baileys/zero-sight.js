import {
  jidNormalizedUser,
  areJidsSameUser,
  extractMessageContent,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { createStickerImage, createStickerVideo } from "../sticker/converter.js";

const silentLogger = pino({ level: "silent" });

/**
 * Attaches the Zero-Sight event listener to a Baileys socket.
 * STRICT SECURITY INVARIANT:
 * - Drops 100% of messages not belonging to the user's self-chat (`isSelfChat === true`).
 * - Listens to messages sent by the user (fromMe / isFromMe) in their own chat.
 * - Supports real-time incoming and synced "append" messages from phone.
 * - Outbound replies are strictly sent back to the self-chat (`remoteJid`).
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} cleanPhone
 * @param {object} logger
 */
export function attachZeroSightHandler(sock, cleanPhone, logger = console) {
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // Process all message events (mobile phone uploads often arrive as "append")
    for (const m of messages) {
      try {
        if (!m?.message) continue;

        // 1. Identify if sent by the user themselves
        const isFromMe = Boolean(m.key?.fromMe || m.fromMe || m.isFromMe);

        // 2. Identify user JIDs
        const myPhoneJid = `${cleanPhone}@s.whatsapp.net`;
        const myUserJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
        const myLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null;

        const remoteJid = m.key?.remoteJid || "";
        const normalizedRemote = jidNormalizedUser(remoteJid);

        // 🛡️ ZERO-SIGHT GUARD:
        // Immediately drop any group or broadcast message
        if (remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast")) {
          continue;
        }

        // Verify that this is strictly the user's chat with themselves (self-chat / same logged-in number)
        const isSelfChat =
          normalizedRemote === myPhoneJid ||
          (myUserJid && (normalizedRemote === myUserJid || areJidsSameUser(remoteJid, myUserJid))) ||
          (myLid && (normalizedRemote === myLid || areJidsSameUser(remoteJid, myLid))) ||
          remoteJid.replace(/[^0-9]/g, "") === cleanPhone;

        if (!isSelfChat) {
          continue;
        }

        // Unwrap ephemeral / view-once / wrapper messages
        const rawMsg = m.message;
        const content = extractMessageContent(rawMsg) || rawMsg;
        if (!content) continue;

        // Ignore stickers to prevent feedback loops
        if (content.stickerMessage || rawMsg.stickerMessage) {
          continue;
        }

        const imageMessage = content.imageMessage || rawMsg.imageMessage;
        const videoMessage = content.videoMessage || rawMsg.videoMessage;
        const documentMessage = content.documentMessage || rawMsg.documentMessage;

        const isImage = Boolean(imageMessage) || (documentMessage && documentMessage.mimetype?.startsWith("image/"));
        const isVideo = Boolean(videoMessage) || (documentMessage && documentMessage.mimetype?.startsWith("video/"));

        if (!isImage && !isVideo) {
          continue;
        }

        const targetMedia = imageMessage || videoMessage || documentMessage;

        // Check video duration limit (anti-DoS)
        if (isVideo && videoMessage?.seconds > 15) {
          await sock.sendMessage(remoteJid, {
            text: "⚠️ O vídeo é muito longo para figurinha animada. Por favor, envie um vídeo ou GIF com até 10 segundos.",
          }, { quoted: m });
          continue;
        }

        // React with hourglass to signal processing
        try {
          await sock.sendMessage(remoteJid, {
            react: { text: "⏳", key: m.key },
          });
        } catch (_) {}

        // Download media buffer using sock.downloadM with automatic fallback
        let mediaBuffer = null;
        if (sock.downloadM) {
          try {
            mediaBuffer = await sock.downloadM(targetMedia, isImage ? "image" : "video");
          } catch (_) {}
        }
        if (!mediaBuffer || mediaBuffer.length === 0) {
          try {
            mediaBuffer = await downloadMediaMessage(
              m,
              "buffer",
              {},
              {
                logger: silentLogger,
                reuploadRequest: sock.updateMediaMessage,
              }
            );
          } catch (_) {}
        }

        if (!mediaBuffer || mediaBuffer.length === 0) {
          continue;
        }

        let stickerBuffer;
        if (isImage) {
          stickerBuffer = await createStickerImage(mediaBuffer);
        } else {
          stickerBuffer = await createStickerVideo(mediaBuffer);
        }

        if (!stickerBuffer) continue;

        // Send sticker back to user's self-chat
        await sock.sendMessage(remoteJid, { sticker: stickerBuffer }, { quoted: m });

        // React with checkmark
        try {
          await sock.sendMessage(remoteJid, {
            react: { text: "✅", key: m.key },
          });
        } catch (_) {}
      } catch (err) {
        logger.error({ err: err.message }, "[ZeroSight] Error converting sticker in self-chat");
      }
    }
  });
}
