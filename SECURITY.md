# Security Policy & Architecture Model

## 1. Zero-Sight Guarantee (Privacidade Cega)

`sord-selfsticker` is engineered under the **Zero-Sight Principle**. Because a connected companion device technically receives raw socket events across the user's account, our architecture implements an uncompromising memory filter:

```
[ WhatsApp WebSocket Event: messages.upsert ]
                   │
                   ▼
       Is `remoteJid === myJid`?
             ├─── NO  ───► [ DROP IMMEDIATELY ] (Zero logging, zero processing, GC collected)
             └─── YES ───► Proceed to Self-Chat Sticker Pipeline
```

### Invariants:
1. **No Group Reading:** Every event where `isJidGroup(jid)` or `isJidStatusBroadcast(jid)` is true is dropped before reaching any handler.
2. **No Third-Party DM Reading:** Any message whose `remoteJid !== conn.user.id` is terminated at the top of the event loop.
3. **No External Outbound Transmission:** The socket cannot send messages to any destination other than `conn.user.id`.

---

## 2. Trust Boundaries & Threat Model

| Boundary | Threat | Defense Mechanism |
| :--- | :--- | :--- |
| **HTTP API (`/pair`)** | Pairing spam, DoS, telephone verification flooding | • IP rate limiting (3 requests / 15 min)<br>• Phone number cooldown (15 min per number)<br>• E.164 normalization with `libphonenumber-js` |
| **Storage (`/sessions`)** | Session credential theft via server breach | • Session directories set with `0700` POSIX permissions<br>• Ephemeral session auto-expiry on disconnect or inactivity<br>• Explicit `POST /disconnect` endpoint securely unlinks and purges auth files |
| **Media Engine (FFmpeg & Sharp)** | Malicious video/image exploits (RCE, SSRF, DoS bombs) | • Safe argument array invocation via `execFile` (no shell interpolation)<br>• `-protocol_whitelist "file"` blocks external network SSRF in FFmpeg<br>• Hard wall-clock timeout (20s) and file size cap (10MB)<br>• Temporary input/output files strictly isolated in OS tempdir with random hex tokens and removed in `finally` blocks |

---

## 3. Sandboxing & Operational Hardening

When running in production or Docker:
- Run under a non-root user (`node`).
- Restrict container memory: `--memory="512m"` `--cpus="1.0"`.
- Read-only root filesystem with writable `/tmp` and `/sessions`.
- Isolate network namespaces; do not expose internal management ports.

---

## 4. Reporting Security Vulnerabilities

If you discover a potential security vulnerability within this project, please report it privately:
- Do not create public GitHub issues for security vulnerabilities.
- Send details, reproduction steps, and impact assessment to: `security@sordbot.site`.
