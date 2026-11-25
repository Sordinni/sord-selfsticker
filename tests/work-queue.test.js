import { test } from "node:test";
import assert from "node:assert/strict";
import { QueueFullError, WorkQueue } from "../src/security/work-queue.js";

test("limita concorrência e fila por usuário", async () => {
  const queue = new WorkQueue({ concurrency: 1, maxPending: 2, maxPerKey: 2 });
  let releaseFirst;
  const first = queue.run("user1", () => new Promise((r) => (releaseFirst = r)));
  const second = queue.run("user1", async () => "second");

  await assert.rejects(
    queue.run("user1", async () => "third"),
    QueueFullError
  );

  releaseFirst("first");
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  await queue.close();
});
