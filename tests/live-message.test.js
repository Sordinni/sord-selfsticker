import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveMessage } from "../src/security/live-message.js";

test("descarta mensagens antigas e mensagens sem data ao restaurar sessões", () => {
  const start = 1700000000;
  assert.equal(isLiveMessage({}, start), false);
  assert.equal(isLiveMessage({ messageTimestamp: null }, start), false);
  assert.equal(isLiveMessage({ messageTimestamp: start - 1 }, start), false);
  assert.equal(isLiveMessage({ messageTimestamp: start }, start), true);
  assert.equal(isLiveMessage({ messageTimestamp: { toNumber: () => start + 5 } }, start), true);
});
