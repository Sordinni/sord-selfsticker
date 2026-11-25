import { test, expect, mock } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import os from "node:os";

test("pareamentos simultâneos não duplicam socket e valida mismatch de identidade", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "selfsticker-manager-"));
  const { config } = await import("../src/config.js");
  const originalDir = config.sessionsDir;
  config.sessionsDir = root;

  let release;
  let count = 0;
  let lastSocket;
  const version = new Promise((resolve) => {
    release = resolve;
  });

  mock.module("@whiskeysockets/baileys", () => ({
    useMultiFileAuthState: async () => ({
      state: { creds: { registered: false } },
      saveCreds() {},
    }),
    DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    jidNormalizedUser: (jid) => jid?.replace(/:\d+@/, "@"),
  }));
  mock.module("pino", () => ({
    default: () => ({ info() {}, warn() {}, error() {} }),
  }));
  mock.module("../src/baileys/connection.js", () => ({
    BaileysVersion: class {
      fetchVersion() {
        return version;
      }
    },
    createConnection() {
      return {};
    },
  }));
  mock.module("../src/baileys/zero-sight.js", () => ({
    attachZeroSightHandler() {},
    trackBotMessage() {},
    mediaQueue: { async stopKey() {}, releaseKey() {}, async close() {} },
  }));
  mock.module("../src/sticker/user-prefs.js", () => ({
    forgetUserPrefs() {},
    async flushUserPrefs() {},
  }));
  mock.module("../src/baileys/socket.js", () => ({
    naruyaizumi() {
      count++;
      lastSocket = {
        ev: new EventEmitter(),
        ws: { isOpen: true, close() {} },
        requestPairingCode: async () => "ABCDEFGH",
        end() {},
      };
      return lastSocket;
    },
  }));

  try {
    const { SessionManager } = await import("../src/baileys/session-manager.js");
    const manager = new SessionManager();

    const first = manager.startPairing("5511999999999");
    for (let i = 0; i < 100 && (await readdir(root)).length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await expect(manager.startPairing("5511999999999")).rejects.toMatchObject({ code: "EEXIST" });

    release([2, 3000, 1]);
    expect((await first).code).toBe("ABCD-EFGH");
    expect(count).toBe(1);

    lastSocket.user = { id: "5511999999999:1@s.whatsapp.net" };
    lastSocket.ev.emit("connection.update", { connection: "open" });
    expect(manager.getStatus("5511999999999").status).toBe("connected");

    lastSocket.ev.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 515 } } },
    });
    expect(manager.sessions.get("5511999999999").reconnectTimer).toBeTruthy();

    await manager.shutdown();
    expect(count).toBe(1);

    const mismatch = new SessionManager();
    await mismatch.startPairing("5511888888888");
    lastSocket.user = { id: "5511777777777:1@s.whatsapp.net" };
    lastSocket.ev.emit("connection.update", { connection: "open" });
    expect(mismatch.getStatus("5511888888888").status).toBe("identity_mismatch");
    await mismatch.shutdown();
  } finally {
    release?.([2, 3000, 1]);
    config.sessionsDir = originalDir;
    await rm(root, { recursive: true, force: true });
    mock.restore();
  }
});
