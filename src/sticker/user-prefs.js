import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

const prefsCache = new Map();

/**
 * Normaliza o identificador do numero de telefone.
 * @param {string} phone
 * @returns {string}
 */
function cleanPhoneNumber(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Retorna as configuracoes padrao de um usuario.
 * @returns {{ autosticker: boolean, esticada: boolean, pack: string, author: string }}
 */
function getDefaultPrefs() {
  return {
    autosticker: true,
    esticada: true,
    pack: config.stickerPackName || "Feito por Mim",
    author: config.stickerPackAuthor || "SejaBot",
  };
}

/**
 * Obtem o caminho do arquivo de preferencias de uma sessao.
 * @param {string} cleanPhone
 * @returns {string}
 */
function getPrefsFilePath(cleanPhone) {
  return path.join(config.sessionsDir, cleanPhone, "prefs.json");
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
    return { ...prefsCache.get(cleanPhone) };
  }

  const prefsPath = getPrefsFilePath(cleanPhone);
  let prefs = getDefaultPrefs();

  try {
    const raw = await fs.readFile(prefsPath, "utf-8");
    const parsed = JSON.parse(raw);
    prefs = { ...prefs, ...parsed };
  } catch (_) {
    // Arquivo ainda nao existe, utiliza o padrao inicial
  }

  prefsCache.set(cleanPhone, prefs);
  return { ...prefs };
}

/**
 * Atualiza e persiste as preferencias do usuario.
 * @param {string} phone
 * @param {Partial<{ autosticker: boolean, esticada: boolean, pack: string, author: string }>} updates
 * @returns {Promise<{ autosticker: boolean, esticada: boolean, pack: string, author: string }>}
 */
export async function setUserPrefs(phone, updates) {
  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone) {
    return getDefaultPrefs();
  }

  const current = await getUserPrefs(cleanPhone);
  const updated = { ...current, ...updates };

  prefsCache.set(cleanPhone, updated);

  try {
    const sessionDir = path.join(config.sessionsDir, cleanPhone);
    await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      getPrefsFilePath(cleanPhone),
      JSON.stringify(updated, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error(`[UserPrefs] Falha ao persistir preferencias para ${cleanPhone}:`, err.message);
  }

  return { ...updated };
}

/**
 * Alterna um valor booleano nas preferencias do usuario.
 * @param {string} phone
 * @param {'esticada' | 'autosticker'} key
 * @returns {Promise<boolean>} Novo valor apos alternancia
 */
export async function toggleUserPref(phone, key) {
  const current = await getUserPrefs(phone);
  const newValue = !current[key];
  await setUserPrefs(phone, { [key]: newValue });
  return newValue;
}

/**
 * Restaura as preferencias do usuario para os padroes originais.
 * @param {string} phone
 * @returns {Promise<{ autosticker: boolean, esticada: boolean, pack: string, author: string }>}
 */
export async function resetUserPrefs(phone) {
  const cleanPhone = cleanPhoneNumber(phone);
  const defaults = getDefaultPrefs();
  return await setUserPrefs(cleanPhone, defaults);
}
