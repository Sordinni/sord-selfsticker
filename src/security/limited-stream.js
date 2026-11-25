export class MediaLimitError extends Error {}

/**
 * Reads an async iterable stream while enforcing strict byte and time limits.
 * @param {AsyncIterable<Buffer|Uint8Array> & { destroy: Function }} stream
 * @param {{ maxBytes: number, timeoutMs: number }} limits
 * @returns {Promise<Buffer>}
 */
export async function readLimitedStream(stream, { maxBytes, timeoutMs }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Invalid stream limits");
  }
  if (!stream || typeof stream.destroy !== "function" || !stream[Symbol.asyncIterator]) {
    throw new TypeError("Readable stream required");
  }

  const chunks = [];
  let length = 0;
  const timer = setTimeout(
    () => stream.destroy(new MediaLimitError("Tempo limite de mídia excedido")),
    timeoutMs
  );
  timer.unref?.();

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > maxBytes) {
        throw new MediaLimitError("Mídia excede o limite permitido");
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, length);
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
}
