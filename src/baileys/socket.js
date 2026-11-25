import makeWASocket, { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { Buffer } from "node:buffer";
import { config } from "../config.js";
import { MediaLimitError, readLimitedStream } from "../security/limited-stream.js";

/**
 * Socket wrapper com download limitado por tamanho e tempo.
 */
export function naruyaizumi(connectionOptions) {
  const conn = makeWASocket(connectionOptions);

  conn.downloadM = async (m, type) => {
    if (!m || !(m.url || m.directPath)) return Buffer.alloc(0);
    try {
      const stream = await downloadContentFromMessage(m, type);
      return await readLimitedStream(stream, {
        maxBytes: config.maxMediaBytes,
        timeoutMs: 45000,
      });
    } catch (error) {
      if (error instanceof MediaLimitError) throw error;
      return Buffer.alloc(0);
    }
  };

  return conn;
}
