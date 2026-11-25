import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const prefixes = new Set(["ssom", "sticker"]);

/**
 * Creates an isolated temporary directory for sticker conversion.
 * @param {'sticker' | 'ssom'} prefix
 * @returns {Promise<string>}
 */
export async function makeTempDirectory(prefix) {
  if (!prefixes.has(prefix)) {
    throw new Error("Tipo temporário inválido.");
  }
  await mkdir(config.tempDir, { recursive: true, mode: 0o700 });
  return mkdtemp(path.join(config.tempDir, `${prefix}-`));
}

/**
 * Removes orphaned sticker temp directories older than 24 hours.
 * @param {number} now
 */
export async function cleanupStaleTempDirectories(now = Date.now()) {
  await mkdir(config.tempDir, { recursive: true, mode: 0o700 });
  const entries = await readdir(config.tempDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^(ssom|sticker)-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const directory = path.join(config.tempDir, entry.name);
    const stat = await lstat(directory);
    if (stat.isDirectory() && now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
