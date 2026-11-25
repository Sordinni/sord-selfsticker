import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config.js";
import {
  getUserPrefs,
  resetUserPrefs,
  setUserPrefs,
  toggleUserPref,
} from "../src/sticker/user-prefs.js";

test("persiste, alterna e redefine preferências do usuário", async () => {
  const originalDir = config.sessionsDir;
  const root = await mkdtemp(path.join(os.tmpdir(), "selfsticker-prefs-"));
  config.sessionsDir = root;
  const phone = "5511999999999";

  try {
    const initial = await getUserPrefs(phone);
    assert.equal(initial.autosticker, true);
    assert.equal(initial.esticada, true);
    assert.equal(initial.pack, "twitter - @sordbot");
    assert.equal(initial.author, "");

    assert.equal(await toggleUserPref(phone, "esticada"), false);
    await setUserPrefs(phone, { autosticker: false, pack: "Meu Pack", author: "Eu" });

    const saved = await getUserPrefs(phone);
    assert.deepEqual(saved, {
      autosticker: false,
      esticada: false,
      pack: "Meu Pack",
      author: "Eu",
    });

    const reset = await resetUserPrefs(phone);
    assert.equal(reset.autosticker, true);
    assert.equal(reset.esticada, true);
  } finally {
    config.sessionsDir = originalDir;
    await rm(root, { recursive: true, force: true });
  }
});
