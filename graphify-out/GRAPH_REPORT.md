# Graph Report - sord-selfsticker  (2026-11-02)

## Corpus Check
- 13 files · ~7,255 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 129 nodes · 180 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2a6ba51d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]

## God Nodes (most connected - your core abstractions)
1. `SessionManager` - 13 edges
2. `setUserPrefs()` - 8 edges
3. `config` - 7 edges
4. `getUserPrefs()` - 7 edges
5. `Sord Self-Sticker Engine 🚀` - 7 edges
6. `createStickerVideo()` - 5 edges
7. `resetUserPrefs()` - 5 edges
8. `Legal Disclaimer & Terms of Use` - 5 edges
9. `🛠️ Instalação e Execução / Setup & Run` - 5 edges
10. `📡 API Endpoints` - 5 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (11 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.17
Nodes (12): checkPairingLimits(), ipRequestMap, phoneCooldownMap, validateAndCleanPhone(), config, __dirname, app, cleanPhone (+4 more)

### Community 1 - "Community 1"
Cohesion: 0.17
Nodes (11): author, description, keywords, license, main, name, scripts, dev (+3 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (23): 📡 API Endpoints, code:bash (docker-compose up -d --build), code:json ({ "phone": "+5511999998888" }), code:json ({), code:json ({), code:json ({ "sessionId": "5511999998888" }), code:json ({ "message": "O bot foi atualizado com novas funções!" }), code:json ({) (+15 more)

### Community 3 - "Community 3"
Cohesion: 0.22
Nodes (9): dependencies, cors, express, libphonenumber-js, node-webpmux, pino, pino-pretty, sharp (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.25
Nodes (8): 1. Clonar e Instalar / Clone & Install, 2. Configuração / Configuration, 3. Iniciar o Servidor / Start the Server, code:bash (git clone https://github.com/sordinni/sord-selfsticker.git), code:bash (cp .env.example .env), code:bash (npm start), 🛠️ Instalação e Execução / Setup & Run, Requisitos / Prerequisites

### Community 6 - "Community 6"
Cohesion: 0.25
Nodes (7): 1. Zero-Sight Guarantee (Privacidade Cega), 2. Trust Boundaries & Threat Model, 3. Sandboxing & Operational Hardening, 4. Reporting Security Vulnerabilities, code:block1 ([ WhatsApp WebSocket Event: messages.upsert ]), Invariants:, Security Policy & Architecture Model

### Community 8 - "Community 8"
Cohesion: 0.62
Nodes (6): addExifToWebp(), createExifBuffer(), createStickerImage(), createStickerVideo(), execFilePromise, setStickerMetadata()

### Community 9 - "Community 9"
Cohesion: 0.33
Nodes (5): 1. Non-Affiliation with WhatsApp / Meta, 2. Terms of Service & Account Safety, 3. Privacy & Zero-Sight Architecture, 4. "AS IS" Warranty, Legal Disclaimer & Terms of Use

### Community 10 - "Community 10"
Cohesion: 0.24
Nodes (6): BaileysVersion, createConnection(), logger, versionFetcher, naruyaizumi(), attachZeroSightHandler()

### Community 11 - "Community 11"
Cohesion: 0.25
Nodes (13): botSentMsgIds, sendReply(), sendSticker(), silentLogger, trackBotMessage(), cleanPhoneNumber(), getDefaultPrefs(), getPrefsFilePath() (+5 more)

## Knowledge Gaps
- **58 isolated node(s):** `name`, `version`, `description`, `main`, `type` (+53 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SessionManager` connect `Community 7` to `Community 0`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `Sord Self-Sticker Engine 🚀` connect `Community 2` to `Community 4`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _58 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._