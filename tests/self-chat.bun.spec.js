import { test, expect, mock } from "bun:test";
import { EventEmitter } from "node:events";

test("comandos no próprio chat ignoram spoof/grupos/mensagens antigas e executam no self-chat", async () => {
  const phone = "5511999999999";
  const updates = [];
  const sends = [];
  const audioCalls = [];

  mock.module("@whiskeysockets/baileys", () => ({
    jidNormalizedUser: (jid) => jid?.replace(/:\d+@/, "@"),
    extractMessageContent: (message) => message,
    downloadMediaMessage() {},
  }));
  mock.module("pino", () => ({ default: () => ({}) }));
  mock.module("../src/baileys/session-manager.js", () => ({
    sessionManager: {
      async broadcast() {
        return { total: 0, successCount: 0, failedCount: 0, failures: [] };
      },
    },
  }));
  mock.module("../src/sticker/converter.js", () => ({
    createStickerImage() {},
    createStickerVideo() {},
    setStickerMetadata() {},
  }));
  mock.module("../src/sticker/audio-sticker.js", () => ({
    async sendAudioSticker(_sock, jid, buf, opts) {
      audioCalls.push({ jid, size: buf.length, opts });
    },
  }));
  mock.module("../src/sticker/user-prefs.js", () => ({
    async getUserPrefs() {
      return { autosticker: true, esticada: true, pack: "Feito por Mim", author: "SejaBot" };
    },
    async setUserPrefs(id, value) {
      updates.push({ id, value });
    },
    async toggleUserPref() {
      return false;
    },
    async resetUserPrefs() {},
  }));

  try {
    const { attachZeroSightHandler } = await import("../src/baileys/zero-sight.js");
    const sock = {
      ev: new EventEmitter(),
      user: { id: `${phone}:1@s.whatsapp.net` },
      async downloadM() {
        return Buffer.from("fake-video-bytes");
      },
      async sendMessage(jid, payload) {
        sends.push({ jid, payload });
        return { key: { id: `bot-echo-${sends.length}` } };
      },
    };

    attachZeroSightHandler(sock, phone);

    const current = Math.ceil(Date.now() / 1000);
    const makeMsg = (jid, timestamp, id, message) => ({
      key: { remoteJid: jid, id },
      messageTimestamp: timestamp,
      message,
    });

    sock.ev.emit("messages.upsert", {
      messages: [
        makeMsg(`${phone}@evil.invalid`, current, "spoof", { conversation: ".autosticker off" }),
        makeMsg(`${phone}@g.us`, current, "group", { conversation: ".autosticker off" }),
        makeMsg(`${phone}@s.whatsapp.net`, 1, "old", { conversation: ".autosticker off" }),
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(updates).toHaveLength(0);

    sock.ev.emit("messages.upsert", {
      messages: [
        makeMsg(`${phone}@s.whatsapp.net`, current, "self-auto", {
          conversation: ".autosticker off",
        }),
        makeMsg(`${phone}@s.whatsapp.net`, current, "self-ssom", {
          videoMessage: { caption: ".ssom", seconds: 4, fileLength: 16, url: "https://x" },
        }),
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(updates).toEqual([{ id: phone, value: { autosticker: false } }]);
    expect(audioCalls).toHaveLength(1);
    expect(audioCalls[0].jid).toBe(`${phone}@s.whatsapp.net`);
    expect(audioCalls[0].opts.pack).toBe("Feito por Mim");
  } finally {
    mock.restore();
  }
});
