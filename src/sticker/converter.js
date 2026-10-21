import sharp from "sharp";
import webp from "node-webpmux";
import crypto from "crypto";
import { Buffer } from "node:buffer";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { config } from "../config.js";

const execFilePromise = promisify(execFile);

/**
 * Creates WhatsApp EXIF buffer with pack and author information.
 * @param {string} pack
 * @param {string} author
 * @returns {Promise<Buffer>}
 */
export async function createExifBuffer(pack, author) {
  const json = {
    "sticker-pack-id": crypto.randomBytes(32).toString("hex"),
    "sticker-pack-name": pack || config.stickerPackName,
    "sticker-pack-publisher": author || config.stickerPackAuthor,
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
 * Attaches EXIF metadata to an existing WebP buffer.
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
 * Converts image buffer into static WebP sticker.
 * @param {Buffer} buffer
 * @param {string} pack
 * @param {string} author
 * @param {number} targetSize
 * @returns {Promise<Buffer>}
 */
export async function createStickerImage(
  buffer,
  pack = config.stickerPackName,
  author = config.stickerPackAuthor,
  targetSize = 512
) {
  const webpBuffer = await sharp(buffer)
    .resize({
      width: targetSize,
      height: targetSize,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 90 })
    .toBuffer();

  const exifBuffer = await createExifBuffer(pack, author);
  return await addExifToWebp(webpBuffer, exifBuffer);
}

/**
 * Converts video/GIF buffer into animated WebP sticker using multi-pass FFmpeg.
 * Hardened per security-audit: uses execFile with explicit array args and protocol whitelist.
 * @param {Buffer} mediaBuffer
 * @param {string} pack
 * @param {string} author
 * @param {number} targetSize
 * @returns {Promise<Buffer>}
 */
export async function createStickerVideo(
  mediaBuffer,
  pack = config.stickerPackName,
  author = config.stickerPackAuthor,
  targetSize = 512
) {
  const tempId = crypto.randomBytes(8).toString("hex");
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `sord_${tempId}_in.mp4`);
  const outputPath = path.join(tmpDir, `sord_${tempId}_out.webp`);

  const configs = [
    { fps: 30, size: targetSize, duration: config.maxVideoDurationSeconds, q: 40 },
    { fps: 24, size: targetSize, duration: config.maxVideoDurationSeconds, q: 35 },
    { fps: 18, size: Math.min(targetSize, 384), duration: config.maxVideoDurationSeconds, q: 30 },
    { fps: 15, size: Math.min(targetSize, 256), duration: config.maxVideoDurationSeconds, q: 25 },
    { fps: 10, size: Math.min(targetSize, 256), duration: config.maxVideoDurationSeconds, q: 20 },
    { fps: 10, size: Math.min(targetSize, 192), duration: 8, q: 15 },
  ];

  try {
    await fs.writeFile(inputPath, mediaBuffer);

    let webpBuffer = null;
    let lastTriedBuffer = null;

    for (const conf of configs) {
      const ffmpegArgs = [
        "-y",
        "-protocol_whitelist", "file",
        "-loglevel", "error",
        "-t", String(conf.duration),
        "-i", inputPath,
        "-vcodec", "libwebp",
        "-vf", `fps=${conf.fps},scale=${conf.size}:${conf.size}:force_original_aspect_ratio=increase,crop=${conf.size}:${conf.size}`,
        "-lossless", "0",
        "-q:v", String(conf.q),
        "-preset", "default",
        "-loop", "0",
        "-an",
        "-vsync", "0",
        outputPath,
      ];

      try {
        await execFilePromise("ffmpeg", ffmpegArgs, { timeout: 25000 });
        const currentBuffer = await fs.readFile(outputPath);
        lastTriedBuffer = currentBuffer;

        if (currentBuffer.length <= config.maxStickerSizeBytes) {
          webpBuffer = currentBuffer;
          break;
        }
      } catch (err) {
        // Continue fallback passes
      }
    }

    if (!webpBuffer) {
      webpBuffer = lastTriedBuffer;
    }

    if (!webpBuffer) {
      throw new Error("Não foi possível gerar a figurinha animada com o tamanho adequado.");
    }

    const exifBuffer = await createExifBuffer(pack, author);
    return await addExifToWebp(webpBuffer, exifBuffer);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
