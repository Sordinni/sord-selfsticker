import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import webp from "node-webpmux";
import { createStickerImage, setStickerMetadata } from "../src/sticker/converter.js";

test("cria figurinha estática WebP com EXIF e reaplica metadados", async () => {
  const png = await sharp({
    create: { width: 120, height: 60, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const sticker = await createStickerImage(png, "Pack Teste", "Autor Teste", true, 512);
  const meta = await sharp(sticker).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);

  const img = new webp.Image();
  await img.load(sticker);
  assert.ok(img.exif.includes(Buffer.from("Pack Teste")));
  assert.ok(img.exif.includes(Buffer.from("Autor Teste")));

  const renamed = await setStickerMetadata(sticker, "Novo Pack", "Novo Autor");
  const img2 = new webp.Image();
  await img2.load(renamed);
  assert.ok(img2.exif.includes(Buffer.from("Novo Pack")));
  assert.ok(img2.exif.includes(Buffer.from("Novo Autor")));
});
