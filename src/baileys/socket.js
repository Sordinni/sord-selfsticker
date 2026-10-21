import makeWASocket, { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { Buffer } from "node:buffer";

/**
 * Socket wrapper idêntico ao naruyaizumi do Sordinho
 */
export function naruyaizumi(connectionOptions) {
  const conn = makeWASocket(connectionOptions);

  // Helper downloadM exatamente igual ao do Sordinho
  conn.downloadM = async (m, type) => {
    if (!m || !(m.url || m.directPath)) return Buffer.alloc(0);
    try {
      const stream = await downloadContentFromMessage(m, type);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return Buffer.alloc(0);
    }
  };

  return conn;
}
