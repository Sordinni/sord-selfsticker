import { Browsers, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

export class BaileysVersion {
  constructor() {
    this.version = null;
    this.lastFetch = 0;
    this.cacheTTL = 3600000;
    this.versionUrl =
      "https://raw.githubusercontent.com/WhiskeySockets/Baileys/refs/heads/master/src/Defaults/baileys-version.json";
  }

  async fetchVersion() {
    const now = Date.now();
    if (this.version && now - this.lastFetch < this.cacheTTL) {
      return this.version;
    }

    try {
      const response = await fetch(this.versionUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.version) || data.version.length !== 3) {
        throw new Error("Invalid version format");
      }
      this.version = data.version;
      this.lastFetch = now;
      return this.version;
    } catch {
      try {
        const v = await fetchLatestBaileysVersion();
        this.version = v.version;
        return this.version;
      } catch {
        this.version = [2, 3000, 1043857760];
        return this.version;
      }
    }
  }
}

/**
 * Cria a mesma configuração de conexão usada no motor do Sordinho
 */
export function createConnection(baileysVersion, auth, baileyLogger, pairingNumber) {
  const shouldUsePairingCode = String(pairingNumber || "").trim() !== "";

  return {
    version: baileysVersion,
    logger: baileyLogger,
    browser: Browsers.macOS("Safari"),
    auth: auth.state,
    ...(shouldUsePairingCode ? { usePairingCode: true } : {}),
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    emitOwnEvents: true,
    fireInitQueries: true,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false, // Não baixa histórico antigo por privacidade
    markOnlineOnConnect: false,
    retryRequestDelayMs: 250,
    maxMsgRetryCount: 5,
    appStateMacVerification: {
      patch: true,
      snapshot: true,
    },
    linkPreviewImageThumbnailWidth: 192,
    transactionOpts: {
      maxCommitRetries: 10,
      delayBetweenTriesMs: 3000,
    },
    enableAutoSessionRecreation: true,
    enableRecentMessageCache: true,
    shouldSyncHistoryMessage: () => false,
    shouldIgnoreJid: (jid) => {
      if (!jid) return true;
      return jid.endsWith("@broadcast") || jid.startsWith("status@broadcast");
    },
  };
}
