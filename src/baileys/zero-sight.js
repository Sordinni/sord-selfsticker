import {
  jidNormalizedUser,
  areJidsSameUser,
  extractMessageContent,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import {
  createStickerImage,
  createStickerVideo,
  setStickerMetadata,
} from "../sticker/converter.js";
import {
  getUserPrefs,
  setUserPrefs,
  toggleUserPref,
  resetUserPrefs,
} from "../sticker/user-prefs.js";
import { config } from "../config.js";
import { sessionManager } from "./session-manager.js";

const silentLogger = pino({ level: "silent" });
const botSentMsgIds = new Set();

/**
 * Registra o ID de mensagens enviadas pelo bot para evitar loops de eco no self-chat.
 * @param {any} sentMsg
 */
function trackBotMessage(sentMsg) {
  if (sentMsg?.key?.id) {
    botSentMsgIds.add(sentMsg.key.id);
    setTimeout(() => botSentMsgIds.delete(sentMsg.key.id), 60000);
  }
}

/**
 * Envia mensagem de texto com rastreamento anti-eco.
 * @param {any} sock
 * @param {string} jid
 * @param {string} text
 * @param {any} quoted
 */
async function sendReply(sock, jid, text, quoted) {
  try {
    const sent = await sock.sendMessage(jid, { text }, { quoted });
    trackBotMessage(sent);
    return sent;
  } catch (err) {
    console.error("[ZeroSight] Falha ao enviar resposta de texto:", err.message);
  }
}

/**
 * Envia figurinha com rastreamento anti-eco.
 * @param {any} sock
 * @param {string} jid
 * @param {Buffer} sticker
 * @param {any} quoted
 */
async function sendSticker(sock, jid, sticker, quoted) {
  try {
    const sent = await sock.sendMessage(jid, { sticker }, { quoted });
    trackBotMessage(sent);
    return sent;
  } catch (err) {
    console.error("[ZeroSight] Falha ao enviar figurinha:", err.message);
  }
}

/**
 * Extrai texto limpo de uma mensagem.
 * @param {any} content
 * @returns {string}
 */
function extractText(content) {
  if (!content) return "";
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ""
  ).trim();
}

/**
 * Baixa buffer de midia atraves do helper nativo ou fallback oficial do Baileys.
 * @param {any} sock
 * @param {any} m
 * @param {any} mediaNode
 * @param {'image' | 'video' | 'sticker'} mediaType
 * @returns {Promise<Buffer|null>}
 */
async function downloadMedia(sock, m, mediaNode, mediaType) {
  if (sock.downloadM) {
    try {
      const buffer = await sock.downloadM(mediaNode, mediaType);
      if (buffer && buffer.length > 0) return buffer;
    } catch (_) {}
  }

  try {
    const buffer = await downloadMediaMessage(
      m,
      "buffer",
      {},
      {
        logger: silentLogger,
        reuploadRequest: sock.updateMediaMessage,
      }
    );
    if (buffer && buffer.length > 0) return buffer;
  } catch (_) {}

  return null;
}

/**
 * Conecta o ouvinte de eventos Zero-Sight ao socket Baileys.
 * INVARIANTES DE PRIVACIDADE E SEGURANCA:
 * - 100% das mensagens fora do self-chat do usuario sao descartadas na RAM.
 * - Suporta comandos do Sordinho (.alternar, .autosticker, .renomear, .s, .fig).
 * - Suporta criacao de figurinhas estaticas, esticadas e animadas (< 1MB).
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} cleanPhone
 * @param {object} logger
 */
export function attachZeroSightHandler(sock, cleanPhone, logger = console) {
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const m of messages) {
      try {
        if (!m?.message) continue;

        // 1. Evita loops de eco causados por mensagens do proprio bot
        if (m.key?.id && botSentMsgIds.has(m.key.id)) {
          continue;
        }

        // 2. Identifica os JIDs do usuario logado
        const myPhoneJid = `${cleanPhone}@s.whatsapp.net`;
        const myUserJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
        const myLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null;

        const remoteJid = m.key?.remoteJid || "";
        const normalizedRemote = jidNormalizedUser(remoteJid);

        // ZERO-SIGHT: descarta grupos e listas de transmissao imediatamente
        if (remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast")) {
          continue;
        }

        // Valida que a mensagem esta estritamente no chat consigo mesmo (self-chat)
        const isSelfChat =
          normalizedRemote === myPhoneJid ||
          (myUserJid && (normalizedRemote === myUserJid || areJidsSameUser(remoteJid, myUserJid))) ||
          (myLid && (normalizedRemote === myLid || areJidsSameUser(remoteJid, myLid))) ||
          remoteJid.replace(/[^0-9]/g, "") === cleanPhone;

        if (!isSelfChat) {
          continue;
        }

        // Desempacota mensagem efemera ou visualizacao unica
        const rawMsg = m.message;
        const content = extractMessageContent(rawMsg) || rawMsg;
        if (!content) continue;

        // Ignora figurinhas puras sem comando para evitar loops
        if (content.stickerMessage && !content.extendedTextMessage) {
          continue;
        }

        const text = extractText(content);
        const lowerText = text.toLowerCase();
        const userPrefs = await getUserPrefs(cleanPhone);

        // Contexto de mensagem citada (quoted) disponivel para todos os comandos
        const contextInfo =
          content.extendedTextMessage?.contextInfo ||
          content.imageMessage?.contextInfo ||
          content.videoMessage?.contextInfo ||
          content.documentMessage?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage;
        const quotedContent = quotedMsg ? (extractMessageContent(quotedMsg) || quotedMsg) : null;

        // =========================================================================
        // COMANDO 1: .alternar (Alterna entre modo esticado e original)
        // =========================================================================
        if (/^[./!]?alternar$/i.test(text)) {
          const newValue = await toggleUserPref(cleanPhone, "esticada");
          await sendReply(
            sock,
            remoteJid,
            `Modo esticado: ${newValue ? "Ativado" : "Desativado"}`,
            m
          );
          continue;
        }

        // =========================================================================
        // COMANDO 2: .autosticker [on|off]
        // =========================================================================
        const autoMatch = text.match(/^[./!]?autosticker(?:\s+(on|1|off|0))?$/i);
        if (autoMatch) {
          const opt = autoMatch[1]?.toLowerCase();
          if (opt === "on" || opt === "1") {
            await setUserPrefs(cleanPhone, { autosticker: true });
            await sendReply(
              sock,
              remoteJid,
              "Seu autosticker pessoal foi *ativado*.",
              m
            );
            continue;
          }
          if (opt === "off" || opt === "0") {
            await setUserPrefs(cleanPhone, { autosticker: false });
            await sendReply(
              sock,
              remoteJid,
              "Seu autosticker pessoal foi *desativado*.",
              m
            );
            continue;
          }

          // Sem argumento: exibe status e instrucoes identicas ao Sordinho
          const statusText = userPrefs.autosticker ? "*Ativado*" : "*Desativado*";
          const helpMsg =
            `*Configuracao de Autosticker*\n\n` +
            `Status atual: ${statusText}\n\n` +
            `Quando ativado, qualquer imagem ou video curto sem legenda que voce enviar sera convertido em figurinha automaticamente.\n\n` +
            `Para alterar o status, digite:\n` +
            `*.autosticker on* (para ativar)\n` +
            `*.autosticker off* (para desativar)`;
          await sendReply(sock, remoteJid, helpMsg, m);
          continue;
        }

        // =========================================================================
        // COMANDO 3: .renomear [Pack | Autor]
        // =========================================================================
        const renameMatch = text.match(/^[./!]?(?:renomear|rename|pack)(?:\s+(.+))?$/i);
        if (renameMatch) {
          const argsText = renameMatch[1]?.trim() || "";

          if (/^(reset|padrao|default)$/i.test(argsText)) {
            await resetUserPrefs(cleanPhone);
            await sendReply(
              sock,
              remoteJid,
              "Configuracoes de figurinha redefinidas para os valores padrao.",
              m
            );
            continue;
          }

          let newPack, newAuthor;
          const quotesMatch = argsText.match(/"([^"]+)"\s+"([^"]+)"/);
          if (quotesMatch) {
            newPack = quotesMatch[1].trim();
            newAuthor = quotesMatch[2].trim();
          } else if (argsText.includes("|")) {
            const parts = argsText.split("|");
            newPack = parts[0].trim();
            newAuthor = parts.slice(1).join("|").trim();
          }

          if (newPack && newAuthor) {
            newPack = newPack.substring(0, 30);
            newAuthor = newAuthor.substring(0, 30);
            await setUserPrefs(cleanPhone, { pack: newPack, author: newAuthor });
            await sendReply(
              sock,
              remoteJid,
              `Configuracoes atualizadas com sucesso!\n\n*Pack:* ${newPack}\n*Autor:* ${newAuthor}`,
              m
            );
            continue;
          }

          // Sem argumentos validos: exibe guia de uso
          const helpRename =
            `*Como configurar suas figurinhas*\n\n` +
            `Use o separador |:\n` +
            `*.renomear Nome do Pack | Nome do Autor*\n\n` +
            `*Exemplo:*\n` +
            `*.renomear Meus Stickers | Juan*\n\n` +
            `*Configuracao atual:*\n` +
            `Pack: *${userPrefs.pack}*\n` +
            `Autor: *${userPrefs.author}*`;
          await sendReply(sock, remoteJid, helpRename, m);
          continue;
        }

        // =========================================================================
        // COMANDO 4: .status / .ajuda / .menu
        // =========================================================================
        if (/^[./!]?(status)$/i.test(text)) {
          const statusInfo =
            `*Suas Preferencias no Sord Self-Sticker:*\n\n` +
            `- Autosticker: ${userPrefs.autosticker ? "*Ativado*" : "*Desativado*"}\n` +
            `- Modo Esticado: ${userPrefs.esticada ? "*Ativado*" : "*Desativado*"}\n` +
            `- Pacote (Pack): *${userPrefs.pack}*\n` +
            `- Autor: *${userPrefs.author}*`;
          await sendReply(sock, remoteJid, statusInfo, m);
          continue;
        }

        if (/^[./!]?(ajuda|menu|help)$/i.test(text)) {
          const menuInfo =
            `*Sord Self-Sticker - Guia de Comandos*\n\n` +
            `*Criacao de Figurinhas:*\n` +
            `- Envie qualquer imagem ou video (ate 10s)\n` +
            `- Ou responda a uma midia com *.s* ou *.fig*\n` +
            `- Tamanho personalizado: *.s 26*, *.s 256*, etc.\n\n` +
            `*Configuracoes:*\n` +
            `- *.alternar* - Alterna modo esticado (Ativado/Desativado)\n` +
            `- *.autosticker on/off* - Liga/desliga conversao automatica\n` +
            `- *.renomear Pack | Autor* - Personaliza creditos do pacote\n` +
            `- *.status* - Mostra as preferencias atuais`;
          await sendReply(sock, remoteJid, menuInfo, m);
          continue;
        }

        // =========================================================================
        // COMANDO 5: .enviar (anuncio) [Owner apenas]
        // =========================================================================
        const enviarMatch = text.match(/^[./!]?(?:enviar|sejabot-enviar|broadcastself)(?:[\s\r\n]+([\s\S]+)|(\([\s\S]*\)))?$/is);
        if (enviarMatch) {
          const isOwner =
            cleanPhone === "32472916180" ||
            remoteJid.includes("32472916180") ||
            remoteJid.includes("14418691801217") ||
            config.owners.includes(cleanPhone);

          if (!isOwner) {
            await sendReply(
              sock,
              remoteJid,
              "Apenas o dono do bot pode usar este comando.",
              m
            );
            continue;
          }

          let announcement = (enviarMatch[1] || enviarMatch[2] || "").trim();
          if (announcement.startsWith("(") && announcement.endsWith(")")) {
            announcement = announcement.slice(1, -1).trim();
          }

          if (!announcement && quotedContent) {
            announcement = extractText(quotedContent);
          }

          if (!announcement) {
            await sendReply(
              sock,
              remoteJid,
              "Uso incorreto.\n\nComo usar:\n.enviar (sua mensagem de anuncio aqui)\n\nExemplo:\n.enviar O selfbot foi atualizado!\n\nDica: Voce tambem pode responder a uma mensagem de texto com .enviar",
              m
            );
            continue;
          }

          await sendReply(
            sock,
            remoteJid,
            "Iniciando transmissao do comunicado para todos os usuarios cadastrados no Selfbot...",
            m
          );

          const result = await sessionManager.broadcast(announcement);

          let report = `*RELATORIO DE ENVIO - SELFBOT*\n\n` +
            `- Total de cadastrados: ${result.total}\n` +
            `- Enviados com sucesso: ${result.successCount}\n` +
            `- Falhas: ${result.failedCount}`;

          if (result.failures.length > 0) {
            report += `\n\n*Detalhes das falhas:*\n` +
              result.failures
                .slice(0, 15)
                .map((f, i) => `${i + 1}. +${f.phone}: ${f.error}`)
                .join("\n");
          }

          await sendReply(sock, remoteJid, report, m);
          continue;
        }

        // =========================================================================
        // 5. DETECCAO DE MIDIA E COMANDO DE FIGURINHA (.s / .fig / autosticker)
        // =========================================================================
        const isStickerCommand = /^[./!]?(s|fig|sticker|f|figurinha)(?:\s+|$)/i.test(text);

        // Identifica tamanho personalizado (.s 26, .s 256, .s 128x128)
        let customSizeImage = 512;
        let customSizeVideo = 210;
        const sizeMatch = text.match(/(?:[./!]?(?:s|sticker|fig|figurinha))\s+(?:(\d+)[xX]\d+|(\d+))/i);
        if (sizeMatch) {
          const parsedSize = parseInt(sizeMatch[1] || sizeMatch[2], 10);
          if (parsedSize > 0) {
            customSizeImage = Math.min(1024, Math.max(16, parsedSize));
            customSizeVideo = Math.min(512, Math.max(16, parsedSize));
          }
        }

        // Midia direta na mensagem
        const directImage = content.imageMessage;
        const directVideo = content.videoMessage;
        const directDoc = content.documentMessage;
        const isDirectImage = Boolean(directImage) || (directDoc && directDoc.mimetype?.startsWith("image/"));
        const isDirectVideo = Boolean(directVideo) || (directDoc && directDoc.mimetype?.startsWith("video/"));

        // Midia citada (quoted)
        const quotedImage = quotedContent?.imageMessage;
        const quotedVideo = quotedContent?.videoMessage;
        const quotedDoc = quotedContent?.documentMessage;
        const quotedSticker = quotedContent?.stickerMessage;
        const isQuotedImage = Boolean(quotedImage) || (quotedDoc && quotedDoc.mimetype?.startsWith("image/"));
        const isQuotedVideo = Boolean(quotedVideo) || (quotedDoc && quotedDoc.mimetype?.startsWith("video/"));
        const isQuotedSticker = Boolean(quotedSticker);

        let targetNode = null;
        let isImage = false;
        let isVideo = false;
        let isSticker = false;
        let sourceMsgForDownload = m;

        if (isDirectImage || isDirectVideo) {
          targetNode = directImage || directVideo || directDoc;
          isImage = isDirectImage;
          isVideo = isDirectVideo;
        } else if (isStickerCommand && (isQuotedImage || isQuotedVideo || isQuotedSticker)) {
          targetNode = quotedImage || quotedVideo || quotedDoc || quotedSticker;
          isImage = isQuotedImage;
          isVideo = isQuotedVideo;
          isSticker = isQuotedSticker;
          sourceMsgForDownload = { message: quotedMsg };
        }

        // Se nao ha midia elegivel, encerra processamento
        if (!targetNode) {
          if (isStickerCommand) {
            await sendReply(
              sock,
              remoteJid,
              "⚠️ Responda a uma imagem, vídeo curto ou figurinha com *.s* para converter.",
              m
            );
          }
          continue;
        }

        // Se for midia direta sem legenda, so converte se o autosticker estiver ativo
        const hasCaption = Boolean(text);
        if (!isStickerCommand && !hasCaption && !userPrefs.autosticker) {
          continue;
        }

        // Validacao de duracao para videos (anti-DoS e limite do WhatsApp)
        if (isVideo && (targetNode.seconds > 15 || directVideo?.seconds > 15)) {
          await sendReply(
            sock,
            remoteJid,
            "⚠️ O vídeo é muito longo. Envie um vídeo ou GIF com até 10 segundos para figurinha animada.",
            m
          );
          continue;
        }

        // Reage com ampulheta para indicar processamento
        try {
          await sock.sendMessage(remoteJid, {
            react: { text: "⏳", key: m.key },
          });
        } catch (_) {}

        // Baixa o buffer da midia
        const mediaBuffer = await downloadMedia(
          sock,
          sourceMsgForDownload,
          targetNode,
          isImage ? "image" : isVideo ? "video" : "sticker"
        );

        if (!mediaBuffer || mediaBuffer.length === 0) {
          logger.warn(`[ZeroSight] Nao foi possivel baixar midia em ${cleanPhone}`);
          continue;
        }

        let stickerResult;
        if (isSticker) {
          // Reaplica os metadados do usuario sobre a figurinha citada
          stickerResult = await setStickerMetadata(
            mediaBuffer,
            userPrefs.pack,
            userPrefs.author
          );
        } else if (isImage) {
          stickerResult = await createStickerImage(
            mediaBuffer,
            userPrefs.pack,
            userPrefs.author,
            userPrefs.esticada,
            customSizeImage
          );
        } else if (isVideo) {
          stickerResult = await createStickerVideo(
            mediaBuffer,
            userPrefs.pack,
            userPrefs.author,
            userPrefs.esticada,
            customSizeVideo
          );
        }

        if (!stickerResult) {
          logger.warn(`[ZeroSight] Falha ao converter figurinha para ${cleanPhone}`);
          continue;
        }

        // Envia figurinha de volta no self-chat
        await sendSticker(sock, remoteJid, stickerResult, m);

        // Reage com confirmacao
        try {
          await sock.sendMessage(remoteJid, {
            react: { text: "OK", key: m.key },
          });
        } catch (_) {}
      } catch (err) {
        logger.error({ err }, `[ZeroSight Debug] Erro ao processar mensagem no self-chat de ${cleanPhone}`);
      }
    }
  });
}
