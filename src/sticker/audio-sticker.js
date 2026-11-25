import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  prepareWAMessageMedia,
  proto,
  normalizeMessageContent,
  getContentType,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { addExifToWebp, createExifBuffer } from "./converter.js";
import { makeTempDirectory } from "../security/temp-files.js";

const execFileAsync = promisify(execFile);
const AUDIO_MIME = "audio/ogg; codecs=opus";

/**
 * Ensures Baileys protobuf encoder supports StickerMessage.audioMessage and Message.audioStickerMessage
 * without duplicating fields when natively supported.
 */
export function installAudioStickerEncoding() {
  const sticker = proto.Message.StickerMessage;
  if (!Object.hasOwn(sticker.prototype, "audioMessage") && !sticker.encode.servicebotAudio) {
    const encode = sticker.encode;
    const patched = function (message, writer) {
      writer = encode(message, writer);
      if (message.audioMessage != null) {
        proto.Message.AudioMessage.encode(
          message.audioMessage,
          writer.uint32(210).fork()
        ).ldelim();
      }
      return writer;
    };
    patched.servicebotAudio = true;
    sticker.encode = patched;
  }

  if (!Object.hasOwn(proto.Message.prototype, "audioStickerMessage") && !proto.Message.encode.servicebotAudio) {
    const encode = proto.Message.encode;
    const patched = function (message, writer) {
      writer = encode(message, writer);
      if (message.audioStickerMessage != null) {
        proto.Message.FutureProofMessage.encode(
          message.audioStickerMessage,
          writer.uint32(1074).fork()
        ).ldelim();
      }
      return writer;
    };
    patched.servicebotAudio = true;
    proto.Message.encode = patched;
  }
}

export function audioStickerPayload(sticker, audio, seconds, waveform, contextInfo) {
  const required = ["url", "directPath", "mediaKey", "fileSha256", "fileEncSha256", "fileLength"];
  if (required.some((key) => sticker?.[key] == null || audio?.[key] == null)) {
    throw new Error("Upload de mídia incompleto.");
  }

  const embeddedAudio = {
    ...audio,
    mimetype: AUDIO_MIME,
    seconds: Math.max(1, Math.min(10, Math.ceil(Number(seconds) || 10))),
    waveform,
  };
  delete embeddedAudio.ptt;

  return {
    audioStickerMessage: {
      message: {
        stickerMessage: {
          ...sticker,
          mimetype: "image/webp",
          width: 64,
          height: 64,
          isAnimated: true,
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
          premium: 0,
          contextInfo: {
            ...contextInfo,
            forwardingScore: 1,
            isForwarded: true,
            forwardOrigin: 0,
          },
          audioMessage: embeddedAudio,
        },
      },
    },
    messageContextInfo: { messageSecret: randomBytes(32) },
  };
}

function quoteContext(quoted, chat, userJid) {
  if (!quoted?.key?.id || !quoted.message) return undefined;
  const content = normalizeMessageContent(quoted.message);
  const type = getContentType(content);
  if (!type) return undefined;

  const clean = { ...content[type] };
  delete clean.contextInfo;

  const participant = quoted.key.fromMe
    ? userJid
    : quoted.participant || quoted.key.participant || quoted.key.remoteJid;

  return {
    stanzaId: quoted.key.id,
    ...(participant ? { participant: jidNormalizedUser(participant) } : {}),
    quotedMessage: { [type]: clean },
    ...(chat !== quoted.key.remoteJid && quoted.key.remoteJid
      ? { remoteJid: quoted.key.remoteJid }
      : {}),
  };
}

function fallbackWaveform() {
  return Buffer.from(
    Array.from({ length: 64 }, (_, i) => Math.floor(20 + 15 * Math.sin((i / 64) * Math.PI)))
  );
}

async function computeWaveform(file, remaining, signal) {
  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-loglevel", "error",
        "-protocol_whitelist", "file,pipe",
        "-i", file,
        "-ac", "1",
        "-ar", "8000",
        "-f", "s16le",
        "-",
      ],
      { encoding: "buffer", timeout: remaining(), maxBuffer: 512000, signal }
    );

    const samples = Math.floor(stdout.length / 2);
    if (samples < 64) return fallbackWaveform();

    const block = Math.floor(samples / 64);
    const values = Array.from({ length: 64 }, (_, i) => {
      let sum = 0;
      for (let n = 0; n < block; n++) {
        sum += Math.abs(stdout.readInt16LE((i * block + n) * 2));
      }
      return sum / block;
    });
    const max = Math.max(...values);
    return Buffer.from(
      values.map((value) => (max ? Math.max(2, Math.min(100, Math.floor((value * 100) / max))) : 0))
    );
  } catch {
    return fallbackWaveform();
  }
}

/**
 * Converts a video buffer into an animated WebP sticker with embedded Opus audio and relays it.
 * @param {any} sock
 * @param {string} jid
 * @param {Buffer} video
 * @param {{ seconds?: number, stretched?: boolean, pack?: string, author?: string, quoted?: any, track?: Function, signal?: AbortSignal }} [options]
 */
export async function sendAudioSticker(
  sock,
  jid,
  video,
  { seconds, stretched = true, pack, author, quoted, track, signal } = {}
) {
  if (!Buffer.isBuffer(video) || !video.length || video.length > config.maxMediaBytes) {
    throw new Error("Vídeo inválido ou acima de 32 MB.");
  }
  if (typeof sock.waUploadToServer !== "function" || typeof sock.relayMessage !== "function") {
    throw new Error("Envio de figurinha com áudio indisponível.");
  }

  const dir = await makeTempDirectory("ssom");
  const input = path.join(dir, "input");
  const audioPath = path.join(dir, "audio.ogg");
  const stickerPath = path.join(dir, "sticker.webp");
  const deadline = Date.now() + 60000;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0 || signal?.aborted) {
      throw new Error("Tempo limite de conversão excedido.");
    }
    return ms;
  };

  try {
    await writeFile(input, video, { mode: 0o600 });

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-loglevel", "error",
        "-protocol_whitelist", "file,pipe",
        "-threads", "1",
        "-i", input,
        "-t", "10",
        "-vn",
        "-af", "aresample=48000:async=1",
        "-c:a", "libopus",
        "-b:a", "64k",
        "-vbr", "on",
        "-compression_level", "10",
        "-frame_duration", "20",
        "-ar", "48000",
        "-ac", "1",
        "-avoid_negative_ts", "make_zero",
        "-f", "ogg",
        audioPath,
      ],
      { timeout: remaining(), maxBuffer: 1024 * 1024, signal }
    );

    const exifBuffer = await createExifBuffer(pack, author);
    let stickerBuffer;
    for (const [fps, quality] of [[15, 50], [12, 35], [8, 20], [6, 15]]) {
      const scale = stretched
        ? "scale=512:512:flags=lanczos"
        : "scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512";

      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-loglevel", "error",
          "-protocol_whitelist", "file,pipe",
          "-threads", "1",
          "-i", input,
          "-t", "10",
          "-vf", `fps=${fps},${scale},format=rgba`,
          "-c:v", "libwebp_anim",
          "-lossless", "0",
          "-q:v", String(quality),
          "-loop", "0",
          "-an",
          stickerPath,
        ],
        { timeout: remaining(), maxBuffer: 1024 * 1024, signal }
      );

      stickerBuffer = await addExifToWebp(await readFile(stickerPath), exifBuffer);
      if (stickerBuffer.length <= config.maxStickerSizeBytes) break;
    }

    const audioBuffer = await readFile(audioPath);
    if (
      !audioBuffer.length ||
      !stickerBuffer?.length ||
      stickerBuffer.length > config.maxStickerSizeBytes
    ) {
      throw new Error("Não foi possível gerar uma figurinha no limite permitido.");
    }

    let duration = Math.max(1, Math.min(10, Number(seconds) || 10));
    try {
      const { stdout } = await execFileAsync(
        "ffprobe",
        [
          "-v", "error",
          "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1",
          audioPath,
        ],
        { timeout: remaining(), signal }
      );
      if (Number(stdout) > 0) {
        duration = Math.max(1, Math.min(10, Number(stdout)));
      }
    } catch (_) {}

    const levels = await computeWaveform(audioPath, remaining, signal);
    remaining();

    const options = { upload: sock.waUploadToServer };
    const [{ audioMessage }, { stickerMessage }] = await Promise.all([
      prepareWAMessageMedia(
        {
          audio: audioBuffer,
          mimetype: AUDIO_MIME,
          seconds: Math.ceil(duration),
          waveform: levels,
        },
        options
      ),
      prepareWAMessageMedia(
        {
          sticker: stickerBuffer,
          mimetype: "image/webp",
          isAnimated: true,
        },
        options
      ),
    ]);

    const payload = audioStickerPayload(
      stickerMessage,
      audioMessage,
      duration,
      levels,
      quoteContext(quoted, jid, sock.user?.id)
    );

    installAudioStickerEncoding();
    const messageId = randomBytes(16).toString("hex").toUpperCase();
    track?.({ key: { id: messageId } });

    try {
      return await sock.relayMessage(jid, payload, { messageId });
    } catch (error) {
      error.audioStickerSendAttempted = true;
      throw error;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
