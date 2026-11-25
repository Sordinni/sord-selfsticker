import sharp from "sharp";
import webp from "node-webpmux";
import crypto from "crypto";
import { Buffer } from "node:buffer";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { makeTempDirectory } from "../security/temp-files.js";

const execFilePromise = promisify(execFile);

/**
 * Cria o buffer EXIF do WhatsApp contendo informacoes de pack e autor.
 * @param {string} [pack]
 * @param {string} [author]
 * @returns {Promise<Buffer>}
 */
export async function createExifBuffer(pack, author) {
  const json = {
    "sticker-pack-id": crypto.randomBytes(32).toString("hex"),
    "sticker-pack-name": pack ?? config.stickerPackName,
    "sticker-pack-publisher": author ?? config.stickerPackAuthor,
  };
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuffer = Buffer.from(JSON.stringify(json), "utf8");
  const exif = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);
  return exif;
}

/**
 * Anexa metadados EXIF a um buffer WebP existente.
 * @param {Buffer} webpBuffer
 * @param {Buffer} exifBuffer
 * @returns {Promise<Buffer>}
 */
export async function addExifToWebp(webpBuffer, exifBuffer) {
  const img = new webp.Image();
  await img.load(webpBuffer);
  img.exif = exifBuffer;
  return await img.save(null);
}

/**
 * Reaplica metadados EXIF em uma figurinha existente.
 * @param {Buffer} stickerBuffer
 * @param {string} [pack]
 * @param {string} [author]
 * @returns {Promise<Buffer>}
 */
export async function setStickerMetadata(stickerBuffer, pack, author) {
  const exifBuffer = await createExifBuffer(pack, author);
  return await addExifToWebp(stickerBuffer, exifBuffer);
}

/**
 * Converte um buffer de imagem em figurinha estatica WebP.
 * Suporta modo esticado (esticada = true) e preservacao de proporcao.
 * @param {Buffer} buffer
 * @param {string} [pack]
 * @param {string} [author]
 * @param {boolean} [isStretched]
 * @param {number} [targetSize]
 * @returns {Promise<Buffer>}
 */
export async function createStickerImage(
  buffer,
  pack = config.stickerPackName,
  author = config.stickerPackAuthor,
  isStretched = true,
  targetSize = 512
) {
  const resizeOptions = isStretched
    ? {
        width: targetSize,
        height: targetSize,
        fit: "fill",
      }
    : {
        width: targetSize,
        height: targetSize,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      };

  const exifBuffer = await createExifBuffer(pack, author);

  for (const quality of [90, 75, 55]) {
    const webpBuffer = await sharp(buffer)
      .resize(resizeOptions)
      .webp({ quality })
      .toBuffer();

    const result = await addExifToWebp(webpBuffer, exifBuffer);
    if (result.length <= config.maxStickerSizeBytes) {
      return result;
    }
  }

  throw new Error("Figurinha excede o limite permitido.");
}

/**
 * Converte video ou GIF em figurinha animada WebP via cascata multi-pass do FFmpeg.
 * Garante compatibilidade estrita com o limite de 1MB do WhatsApp.
 * @param {Buffer} mediaBuffer
 * @param {string} [pack]
 * @param {string} [author]
 * @param {boolean} [isStretched]
 * @param {number} [targetSize]
 * @param {AbortSignal} [signal]
 * @returns {Promise<Buffer>}
 */
export async function createStickerVideo(
  mediaBuffer,
  pack = config.stickerPackName,
  author = config.stickerPackAuthor,
  isStretched = true,
  targetSize = 210,
  signal
) {
  const tmpDir = await makeTempDirectory("sticker");
  const inputPath = path.join(tmpDir, "input");
  const outputPath = path.join(tmpDir, "output.webp");

  const durationSec = Math.max(1, config.maxVideoDurationSeconds) + 1;
  const deadline = Date.now() + 30000;

  const configs = [
    { fps: 30, size: targetSize, duration: durationSec, q: 40 },
    { fps: 28, size: targetSize, duration: durationSec, q: 40 },
    { fps: 20, size: targetSize, duration: durationSec, q: 35 },
    { fps: 15, size: targetSize, duration: durationSec, q: 30 },
    { fps: 15, size: Math.min(targetSize, 256), duration: durationSec, q: 25 },
    { fps: 10, size: Math.min(targetSize, 256), duration: durationSec, q: 20 },
    { fps: 10, size: Math.min(targetSize, 192), duration: Math.min(8, durationSec), q: 15 },
  ];

  try {
    await fs.writeFile(inputPath, mediaBuffer);

    const exifBuffer = await createExifBuffer(pack, author);
    let finalSticker = null;

    for (const conf of configs) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      const vfFilter = isStretched
        ? `fps=${conf.fps},scale=${conf.size}:${conf.size}`
        : `fps=${conf.fps},scale=${conf.size}:${conf.size}:force_original_aspect_ratio=increase,crop=${conf.size}:${conf.size}`;

      const ffmpegArgs = [
        "-y",
        "-protocol_whitelist", "file",
        "-loglevel", "error",
        "-threads", "1",
        "-t", String(conf.duration),
        "-i", inputPath,
        "-vcodec", "libwebp",
        "-vf", vfFilter,
        "-lossless", "0",
        "-q:v", String(conf.q),
        "-preset", "default",
        "-loop", "0",
        "-an",
        "-vsync", "0",
        outputPath,
      ];

      try {
        await execFilePromise("ffmpeg", ffmpegArgs, { timeout: remainingMs, signal });
        const currentBuffer = await fs.readFile(outputPath);

        if (currentBuffer.length <= config.maxStickerSizeBytes) {
          const withExif = await addExifToWebp(currentBuffer, exifBuffer);
          if (withExif.length <= config.maxStickerSizeBytes) {
            finalSticker = withExif;
            break;
          }
        }
      } catch (_) {
        // Falha nesta configuracao, tenta o proximo passo da cascata
      }
    }

    if (!finalSticker) {
      throw new Error("Nao foi possivel gerar a figurinha animada com o tamanho adequado.");
    }

    return finalSticker;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
