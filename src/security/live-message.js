const startedAt = Math.ceil((Date.now() - process.uptime() * 1000) / 1000);

/**
 * Checks whether an incoming Baileys message is live (created at or after process boot).
 * Prevents replaying historical self-chat messages upon reconnect/sync.
 * @param {any} message
 * @param {number} startSeconds
 * @returns {boolean}
 */
export function isLiveMessage(message, startSeconds = startedAt) {
  try {
    const timestamp = message?.messageTimestamp;
    if (timestamp == null || timestamp === "") return false;
    const seconds = typeof timestamp?.toNumber === "function" ? timestamp.toNumber() : Number(timestamp);
    return Number.isSafeInteger(seconds) && seconds >= startSeconds;
  } catch {
    return false;
  }
}
