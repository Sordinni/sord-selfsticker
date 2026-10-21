# Graph Report - sord-selfsticker  (2026-10-21)

## Corpus Check
- 10 files · ~3,500 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 94 nodes · 109 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `91551d2d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]

## God Nodes (most connected - your core abstractions)
1. `SessionManager` - 8 edges
2. `Sord Self-Sticker Engine 🚀` - 7 edges
3. `config` - 5 edges
4. `createStickerVideo()` - 5 edges
5. `Legal Disclaimer & Terms of Use` - 5 edges
6. `🛠️ Instalação e Execução / Setup & Run` - 5 edges
7. `Security Policy & Architecture Model` - 5 edges
8. `createStickerImage()` - 4 edges
9. `📡 API Endpoints` - 4 edges
10. `scripts` - 3 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (10 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.16
Nodes (13): logger, attachZeroSightHandler(), checkPairingLimits(), ipRequestMap, phoneCooldownMap, validateAndCleanPhone(), config, __dirname (+5 more)

### Community 1 - "Community 1"
Cohesion: 0.17
Nodes (11): author, description, keywords, license, main, name, scripts, dev (+3 more)

### Community 2 - "Community 2"
Cohesion: 0.18
Nodes (10): code:bash (docker-compose up -d --build), 🐳 Docker Deployment, 🇺🇸 English, Garantia de Privacidade Zero-Sight, 📄 Licença / License, Overview, 🇧🇷 Português, Sord Self-Sticker Engine 🚀 (+2 more)

### Community 3 - "Community 3"
Cohesion: 0.22
Nodes (9): dependencies, cors, express, libphonenumber-js, node-webpmux, pino, pino-pretty, sharp (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.25
Nodes (8): 1. Clonar e Instalar / Clone & Install, 2. Configuração / Configuration, 3. Iniciar o Servidor / Start the Server, code:bash (git clone https://github.com/sordinni/sord-selfsticker.git), code:bash (cp .env.example .env), code:bash (npm start), 🛠️ Instalação e Execução / Setup & Run, Requisitos / Prerequisites

### Community 5 - "Community 5"
Cohesion: 0.25
Nodes (8): 📡 API Endpoints, code:json ({ "phone": "+5511999998888" }), code:json ({), code:json ({), code:json ({ "sessionId": "5511999998888" }), `GET /api/sejabot/status?sessionId=5511999998888`, `POST /api/sejabot/disconnect`, `POST /api/sejabot/pair`

### Community 6 - "Community 6"
Cohesion: 0.25
Nodes (7): 1. Zero-Sight Guarantee (Privacidade Cega), 2. Trust Boundaries & Threat Model, 3. Sandboxing & Operational Hardening, 4. Reporting Security Vulnerabilities, code:block1 ([ WhatsApp WebSocket Event: messages.upsert ]), Invariants:, Security Policy & Architecture Model

### Community 8 - "Community 8"
Cohesion: 0.62
Nodes (5): addExifToWebp(), createExifBuffer(), createStickerImage(), createStickerVideo(), execFilePromise

### Community 9 - "Community 9"
Cohesion: 0.33
Nodes (5): 1. Non-Affiliation with WhatsApp / Meta, 2. Terms of Service & Account Safety, 3. Privacy & Zero-Sight Architecture, 4. "AS IS" Warranty, Legal Disclaimer & Terms of Use

## Knowledge Gaps
- **50 isolated node(s):** `name`, `version`, `description`, `main`, `type` (+45 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Sord Self-Sticker Engine 🚀` connect `Community 2` to `Community 4`, `Community 5`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `SessionManager` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `🛠️ Instalação e Execução / Setup & Run` connect `Community 4` to `Community 2`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _50 weakly-connected nodes found - possible documentation gaps or missing edges._