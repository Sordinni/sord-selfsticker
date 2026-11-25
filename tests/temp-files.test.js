import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { cleanupStaleTempDirectories, makeTempDirectory } from "../src/security/temp-files.js";

test("cria diretório temporário isolado e limpa apenas diretórios antigos", async () => {
  const fresh = await makeTempDirectory("sticker");
  const stale = path.join(config.tempDir, "ssom-stale1");
  const unrelated = path.join(config.tempDir, "keep-me");
  try {
    await mkdir(stale, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(stale, oldDate, oldDate);
    await utimes(unrelated, oldDate, oldDate);

    await cleanupStaleTempDirectories();

    assert.ok((await stat(fresh)).isDirectory());
    assert.ok((await stat(unrelated)).isDirectory());
    await assert.rejects(stat(stale));
  } finally {
    await rm(fresh, { recursive: true, force: true }).catch(() => {});
    await rm(stale, { recursive: true, force: true }).catch(() => {});
    await rm(unrelated, { recursive: true, force: true }).catch(() => {});
  }
});
