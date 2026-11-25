import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const prefsCache = new Map();
const writeLocks = new Map();

function cleanPhoneNumber(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getDefaultPrefs() {
  return {
    autosticker: true,
    esticada: true,
    pack: config.stickerPackName || "twitter - @sordbot",
    author: config.stickerPackAuthor ?? "",
  };
}

function normalizePrefs(data) {
  const defaults = getDefaultPrefs();
  return {
    autosticker: typeof data?.autosticker === "boolean" ? data.autosticker : defaults.autosticker,
    esticada: typeof data?.esticada === "boolean" ? data.esticada : defaults.esticada,
    pack: typeof data?.pack === "string" && data.pack.trim() ? data.pack.trim().slice(0, 30) : defaults.pack,
    author: typeof data?.author === "string" ? data.author.trim().slice(0, 30) : defaults.author,
  };
}

function remember(cleanPhone, value) {
  prefsCache.delete(cleanPhone);
  prefsCache.set(cleanPhone, value);
  if (prefsCache.size > 10000) {
    prefsCache.delete(prefsCache.keys().next().value);
  }
}

function getPrefsFilePath(cleanPhone) {
  return path.join(config.sessionsDir, cleanPhone, "prefs.json");
}

async function loadRaw(cleanPhone) {
  const prefsPath = getPrefsFilePath(cleanPhone);
  try {
    const info = await stat(prefsPath);
    if (info.size > 1024 * 1024) throw new Error("Preferências excedem o limite.");
    const parsed = JSON.parse(await readFile(prefsPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Preferências inválidas.");
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

/**
 * Recupera as preferencias do usuario do cache ou do disco.
 * @param {string} phone
 * @returns {Promise<{ autosticker: boolean, esticada: boolean, pack: string, author: string }>}
 */
export async function getUserPrefs(phone) {
  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone) {
    return getDefaultPrefs();
  }

  if (prefsCache.has(cleanPhone)) {
    const cached = prefsCache.get(cleanPhone);
    remember(cleanPhone, cached);
    return { ...cached };
  }

  let prefs;
  try {
    prefs = normalizePrefs(await loadRaw(cleanPhone));
  } catch (_) {
    prefs = getDefaultPrefs();
  }

  remember(cleanPhone, prefs);
  return { ...prefs };
}

async function update(phone, updater) {
  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone) {
    return getDefaultPrefs();
  }

  const previous = writeLocks.get(cleanPhone) || Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const sessionDir = path.join(config.sessionsDir, cleanPhone);
      await mkdir(sessionDir, { recursive: true, mode: 0o700 });

      let raw = {};
      try {
        raw = await loadRaw(cleanPhone);
      } catch (_) {}

      const updated = normalizePrefs(updater(normalizePrefs(raw)));
      const tempPath = path.join(sessionDir, `.${randomBytes(16).toString("hex")}.tmp`);
      let handle;

      try {
        handle = await open(tempPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify(updated, null, 2), "utf-8");
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(tempPath, getPrefsFilePath(cleanPhone));
      } finally {
        if (handle) await handle.close().catch(() => {});
        await rm(tempPath, { force: true }).catch(() => {});
      }

      remember(cleanPhone, updated);
      return { ...updated };
    });

  writeLocks.set(cleanPhone, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(cleanPhone) === task) {
      writeLocks.delete(cleanPhone);
    }
  }
}

/**
 * Atualiza e persiste as preferencias do usuario.
 * @param {string} phone
 * @param {Partial<{ autosticker: boolean, esticada: boolean, pack: string, author: string }>} updates
 * @returns {Promise<{ autosticker: boolean, esticada: boolean, pack: string, author: string }>}
 */
export async function setUserPrefs(phone, updates) {
  return update(phone, (current) => ({
    ...current,
    ...(typeof updates?.autosticker === "boolean" ? { autosticker: updates.autosticker } : {}),
    ...(typeof updates?.esticada === "boolean" ? { esticada: updates.esticada } : {}),
    ...(typeof updates?.pack === "string" && updates.pack.trim() ? { pack: updates.pack.trim() } : {}),
    ...(typeof updates?.author === "string" ? { author: updates.author.trim() } : {}),
  }));
}

/**
 * Alterna um valor booleano nas preferencias do usuario.
 * @param {string} phone
 * @param {'esticada' | 'autosticker'} key
 * @returns {Promise<boolean>}
 */
export async function toggleUserPref(phone, key) {
  if (key !== "esticada" && key !== "autosticker") {
    throw new Error("Preferência inválida.");
  }
  const updated = await update(phone, (current) => ({
    ...current,
    [key]: !current[key],
  }));
  return updated[key];
}

/**
 * Restaura as preferencias do usuario para os padroes originais.
 * @param {string} phone
 * @returns {Promise<{ autosticker: boolean, esticada: boolean, pack: string, author: string }>}
 */
export async function resetUserPrefs(phone) {
  return update(phone, () => getDefaultPrefs());
}

export function forgetUserPrefs(phone) {
  prefsCache.delete(cleanPhoneNumber(phone));
}

export async function flushUserPrefs(phone) {
  const cleanPhone = cleanPhoneNumber(phone);
  while (writeLocks.has(cleanPhone)) {
    await writeLocks.get(cleanPhone).catch(() => {});
  }
}
