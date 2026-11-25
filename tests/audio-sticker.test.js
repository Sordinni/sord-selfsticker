import { test } from "node:test";
import assert from "node:assert/strict";
import { proto } from "@whiskeysockets/baileys";
import {
  audioStickerPayload,
  installAudioStickerEncoding,
  sendAudioSticker,
} from "../src/sticker/audio-sticker.js";

function fields(bytes) {
  let pos = 0;
  function varint() {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[pos++];
      result += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return result;
  }

  const result = [];
  while (pos < bytes.length) {
    const tag = varint();
    const wire = tag & 7;
    const number = tag >>> 3;
    if (wire === 2) {
      const length = varint();
      result.push({ number, bytes: bytes.subarray(pos, pos + length) });
      pos += length;
    } else if (wire === 0) {
      varint();
      result.push({ number });
    } else {
      throw new Error(`wire type ${wire} inesperado`);
    }
  }
  return result;
}

test("serializa figurinha com áudio nos campos esperados sem duplicar patches", () => {
  const upload = {
    url: "https://example.invalid/a",
    directPath: "/a",
    mediaKey: Buffer.alloc(32),
    fileSha256: Buffer.alloc(32),
    fileEncSha256: Buffer.alloc(32),
    fileLength: 42,
  };
  const payload = audioStickerPayload(upload, upload, 4, Buffer.alloc(64));
  installAudioStickerEncoding();
  installAudioStickerEncoding();

  const root = fields(proto.Message.encode(payload).finish());
  const wrappers = root.filter((item) => item.number === 134);
  assert.equal(wrappers.length, 1);

  const innerMessage = fields(wrappers[0].bytes).find((item) => item.number === 1).bytes;
  const sticker = fields(innerMessage).find((item) => item.number === 26).bytes;
  const audioFields = fields(sticker).filter((item) => item.number === 26);
  assert.equal(audioFields.length, 1);
  assert.ok(audioFields[0].bytes.length > 0);
});

test("rejeita vídeo vazio ou excessivo antes de criar arquivos", async () => {
  await assert.rejects(sendAudioSticker({}, "x", Buffer.alloc(0)), /inválido/);
  await assert.rejects(
    sendAudioSticker({}, "x", Buffer.alloc(32 * 1024 * 1024 + 1)),
    /32 MB/
  );
});
