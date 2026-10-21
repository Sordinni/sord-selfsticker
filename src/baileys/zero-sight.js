import { downloadMediaMessage, jidNormalizedUser } from "@whiskeysockets/baileys";
import { createStickerImage, createStickerVideo } from "../sticker/converter.js";

/**
 * Attaches the Zero-Sight event listener to a Baileys socket.
 * STRICT SECURITY INVARIANT:
 * - Drops 100% of messages not belonging to the user's self-chat (`remoteJid === myJid`).
 * - Never logs or inspects third-party conversations.
 * - Outbound replies are strictly sent back to `myJid`.
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} cleanPhone
 * @param {object} logger
 */
export function attachZeroSightHandler(sock, cleanPhone, logger = console) {
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const m of messages) {
      try {
        const myJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
        if (!myJid) continue;

        // 🛡️ ZERO-SIGHT GUARD:
        // Ignore any message that is NOT strictly inside the user's chat with themselves!
        if (m.key.remoteJid !== myJid) {
          // Immediately drop. Never log message contents, never parse, let GC free memory.
          continue;
        }

        // Ignore view-once messages for security and privacy
        if (
          m.mtype === "viewOnceMessage" ||
          m.mtype === "viewOnceMessageV2" ||
          m.message?.viewOnceMessage ||
          m.message?.viewOnceMessageV2
        ) {
          continue;
        }

        // Determine message type and mime
        const msgContent = m.message;
        if (!msgContent) continue;

        const imageMessage = msgContent.imageMessage;
        const videoMessage = msgContent.videoMessage;
        const isGif = videoMessage?.gifPlayback;

        const isImage = Boolean(imageMessage);
        const isVideo = Boolean(videoMessage);

        if (!isImage && !isVideo) {
          // Not media, ignore
          continue;
        }

        // Check video duration limit (anti-DoS)
        if (isVideo && videoMessage.seconds > 15) {
          await sock.sendMessage(myJid, {
            text: "⚠️ O vídeo é muito longo para figurinha animada. Por favor, envie um vídeo ou GIF com até 10 segundos.",
          });
          continue;
        }

        // React with hourglass to signal processing
        try {
          await sock.sendMessage(myJid, {
            react: { text: "⏳", key: m.key },
          });
        } catch (_) {}

        // Download media buffer securely
        const mediaBuffer = await downloadMediaMessage(
          m,
          "buffer",
          {},
          {
            logger: {
              info: () => {},
              warn: () => {},
              error: () => {},
              debug: () => {},
              trace: () => {},
            },
          }
        );

        if (!mediaBuffer || mediaBuffer.length === 0) {
          continue;
        }

        let stickerBuffer;
        if (isImage) {
          stickerBuffer = await createStickerImage(mediaBuffer);
        } else {
          stickerBuffer = await createStickerVideo(mediaBuffer);
        }

        // Send sticker back to user's self-chat
        await sock.sendMessage(myJid, { sticker: stickerBuffer });

        // React with checkmark
        try {
          await sock.sendMessage(myJid, {
            react: { text: "✅", key: m.key },
          });
        } catch (_) {}
      } catch (err) {
        logger.error({ err: err.message }, "[ZeroSight] Error converting sticker in self-chat");
      }
    }
  });
}
