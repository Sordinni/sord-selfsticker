import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { MediaLimitError, readLimitedStream } from "../src/security/limited-stream.js";

test("limita o tamanho recebido no fluxo", async () => {
  async function* chunks() {
    yield Buffer.alloc(600);
    yield Buffer.alloc(600);
  }
  await assert.rejects(
    readLimitedStream(Readable.from(chunks()), { maxBytes: 1000, timeoutMs: 2000 }),
    MediaLimitError
  );
});

test("interrompe um fluxo que fica parado", async () => {
  const stalled = new Readable({ read() {} });
  await assert.rejects(
    readLimitedStream(stalled, { maxBytes: 1024, timeoutMs: 50 }),
    MediaLimitError
  );
});
