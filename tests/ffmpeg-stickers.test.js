import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import webp from "node-webpmux";
import { createStickerVideo } from "../src/sticker/converter.js";
import { sendAudioSticker } from "../src/sticker/audio-sticker.js";

const execFileAsync = promisify(execFile);

test("converte vídeo sintético em figurinha animada e figurinha com áudio (.ssom) via FFmpeg", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfsticker-ffmpeg-"));
  const mp4Path = path.join(dir, "sample.mp4");

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=blue:s=128x128:d=2:r=15",
      "-f", "lavfi",
      "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-shortest",
      mp4Path,
    ]);

    const videoBuffer = await readFile(mp4Path);

    const animatedSticker = await createStickerVideo(videoBuffer, "Pack Video", "Autor Video", true, 210);
    assert.ok(animatedSticker.length > 0 && animatedSticker.length <= 1024 * 1024);
    const img = new webp.Image();
    await img.load(animatedSticker);
    assert.ok(img.exif.includes(Buffer.from("Pack Video")));

    let uploads = 0;
    let relayedPayload = null;
    const sock = {
      user: { id: "5511999999999@s.whatsapp.net" },
      waUploadToServer: async () => ({
        mediaUrl: `https://example.invalid/${++uploads}`,
        directPath: `/test/${uploads}`,
      }),
      relayMessage: async (_jid, payload) => {
        relayedPayload = payload;
        return { key: { id: "relayed-1" } };
      },
    };

    await sendAudioSticker(sock, "5511999999999@s.whatsapp.net", videoBuffer, {
      seconds: 2,
      stretched: true,
      pack: "Pack Som",
      author: "Autor Som",
    });

    assert.equal(uploads, 2);
    assert.ok(relayedPayload?.audioStickerMessage?.message?.stickerMessage?.audioMessage);
    assert.equal(
      relayedPayload.audioStickerMessage.message.stickerMessage.audioMessage.mimetype,
      "audio/ogg; codecs=opus"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
