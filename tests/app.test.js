import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

test("endpoints HTTP de pareamento, status, desconexão e proteção de broadcast", async () => {
  const calls = [];
  const manager = {
    async startPairing(phone) {
      calls.push(["pair", phone]);
      return { code: "ABCD-EFGH", sessionId: phone };
    },
    getStatus(phone) {
      calls.push(["status", phone]);
      return { status: "pairing", phone };
    },
    async disconnect(phone) {
      calls.push(["disconnect", phone]);
    },
    async broadcast(msg) {
      return { total: 1, successCount: 1, failedCount: 0, failures: [], msg };
    },
  };

  const config = {
    corsOrigins: ["http://localhost:5173"],
    rateLimitPairingPerIp: 10,
    cooldownMinutesPerPhone: 0,
    broadcastToken: "segredo-teste",
  };

  const app = createApp({ manager, config });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);

    const pair = await fetch(`${origin}/api/sejabot/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+5511999998888" }),
    });
    assert.equal(pair.status, 200);
    assert.equal((await pair.json()).code, "ABCD-EFGH");

    const status = await fetch(`${origin}/api/sejabot/status?sessionId=5511999998888`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).status, "pairing");

    const unauthBroadcast = await fetch(`${origin}/api/sejabot/enviar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "oi" }),
    });
    assert.equal(unauthBroadcast.status, 401);

    const authBroadcast = await fetch(`${origin}/api/sejabot/enviar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer segredo-teste",
      },
      body: JSON.stringify({ message: "oi" }),
    });
    assert.equal(authBroadcast.status, 200);

    const disconnect = await fetch(`${origin}/api/sejabot/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "5511999998888" }),
    });
    assert.equal(disconnect.status, 200);
    assert.deepEqual(calls, [
      ["pair", "5511999998888"],
      ["status", "5511999998888"],
      ["disconnect", "5511999998888"],
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
