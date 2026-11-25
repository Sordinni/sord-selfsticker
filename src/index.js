import { config } from "./config.js";
import { createApp } from "./app.js";
import { sessionManager } from "./baileys/session-manager.js";
import { cleanupStaleTempDirectories } from "./security/temp-files.js";

async function main() {
  await cleanupStaleTempDirectories().catch(() => {});
  await sessionManager.init();

  const app = createApp({ manager: sessionManager, config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[Sord Self-Sticker] Servidor rodando em http://${config.host}:${config.port}`);
  });

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;

    const force = setTimeout(() => process.exit(1), 30000);
    force.unref();

    const httpClosed = new Promise((resolve) => server.close(resolve));
    server.closeIdleConnections?.();

    try {
      await Promise.all([httpClosed, sessionManager.shutdown()]);
      clearTimeout(force);
    } catch (err) {
      console.error("[Shutdown] Error during shutdown:", err);
      process.exitCode = 1;
      server.closeAllConnections?.();
    }
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal initialization error:", err);
  process.exit(1);
});
