import { parsePhoneNumberFromString } from "libphonenumber-js";
import { config } from "../config.js";

const ipRequestMap = new Map();
const phoneCooldownMap = new Map();

/**
 * Validates and normalizes phone number to clean E.164 without '+'
 * @param {string} rawPhone
 * @returns {{ valid: boolean, cleanPhone?: string, error?: string }}
 */
export function validateAndCleanPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== "string") {
    return { valid: false, error: "Número de telefone obrigatório." };
  }

  // Ensure raw starts with + for parser if not present
  const withPlus = rawPhone.trim().startsWith("+") ? rawPhone.trim() : `+${rawPhone.trim()}`;
  const parsed = parsePhoneNumberFromString(withPlus);

  if (!parsed || !parsed.isValid()) {
    return { valid: false, error: "Número de telefone inválido. Verifique o código do país e DDD." };
  }

  // Baileys needs phone numbers without '+'
  const cleanPhone = parsed.number.replace("+", "");
  return { valid: true, cleanPhone };
}

/**
 * Rate limiter for pairing requests (anti-DoS & pairing spam protection)
 * @param {string} ip
 * @param {string} phone
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkPairingLimits(ip, phone) {
  const now = Date.now();

  // 1. Check IP rate limit (Window: 15 minutes)
  const windowMs = 15 * 60 * 1000;
  const ipRecord = ipRequestMap.get(ip) || { count: 0, resetAt: now + windowMs };

  if (now > ipRecord.resetAt) {
    ipRecord.count = 1;
    ipRecord.resetAt = now + windowMs;
  } else {
    ipRecord.count++;
  }
  ipRequestMap.set(ip, ipRecord);

  if (ipRecord.count > config.rateLimitPairingPerIp) {
    return {
      allowed: false,
      reason: `Muitas tentativas a partir deste IP. Aguarde alguns minutos antes de tentar novamente.`
    };
  }

  // 2. Check Phone number cooldown (15 minutes)
  const phoneCooldownMs = config.cooldownMinutesPerPhone * 60 * 1000;
  const lastPhoneAttempt = phoneCooldownMap.get(phone) || 0;

  if (now - lastPhoneAttempt < phoneCooldownMs) {
    const remainingMin = Math.ceil((phoneCooldownMs - (now - lastPhoneAttempt)) / 60000);
    return {
      allowed: false,
      reason: `Este número já solicitou um código recentemente. Aguarde ${remainingMin} minuto(s) para solicitar outro.`
    };
  }

  phoneCooldownMap.set(phone, now);
  return { allowed: true };
}
