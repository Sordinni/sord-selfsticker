# Sord Self-Sticker Engine 🚀

> **Bot pessoal de figurinhas para WhatsApp com arquitetura Zero-Sight (Privacidade Absoluta).**  
> *Personal WhatsApp self-chat sticker companion with Zero-Sight privacy architecture.*

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![Baileys](https://img.shields.io/badge/baileys-whiskeysockets-purple.svg)](https://github.com/WhiskeySockets/Baileys)

---

## 🇧🇷 Português

### Visão Geral
O **Sord Self-Sticker** permite conectar o seu próprio WhatsApp através de um **Código de Emparelhamento (Pairing Code)** de 8 dígitos gerado na web. Uma vez conectado, ele opera **exclusivamente no seu chat privado com você mesmo ("Mensagens Salvas")**:
- Envie uma foto: receba uma figurinha estática otimizada com Sharp.
- Envie um GIF ou vídeo curto (até 10 segundos): receba uma figurinha animada otimizada com FFmpeg multi-passes (< 1MB).
- Inclui metadados EXIF personalizados (*pack* e *autor*).

### Garantia de Privacidade Zero-Sight
1. **Sem leitura de terceiros:** Qualquer mensagem recebida ou enviada que **não** seja o seu próprio chat com você mesmo (`remoteJid !== myJid`) é imediatamente descartada na memória RAM, sem logs nem persistência.
2. **Sem mensagens para fora:** O robô nunca responde nem envia mensagens para grupos ou outros contatos.
3. **Controle Total:** Você pode desconectar o robô a qualquer instante tanto pelo WhatsApp ("Aparelhos Conectados") quanto pela API/site.

---

## 🇺🇸 English

### Overview
**Sord Self-Sticker** allows users to link their WhatsApp account via an 8-digit **Pairing Code** without scanning QR codes. Once paired, it works **strictly in your private "Message Yourself" chat**:
- Send an image: instantly get a crisp, optimized WebP sticker.
- Send a GIF or video (< 10s): get a fluid animated WebP sticker converted with multi-pass FFmpeg (< 1MB).
- Custom EXIF pack metadata included.

### Zero-Sight Security Policy
- **No Third-Party Access:** Messages outside of `remoteJid === myJid` are dropped at socket-level in memory.
- **No External Sending:** The engine cannot dispatch messages to groups or other contacts.
- **Instant Revocation:** Unlink with one click from WhatsApp Linked Devices or the REST API.

---

## 🛠️ Instalação e Execução / Setup & Run

### Requisitos / Prerequisites
- **Node.js** >= 20.0.0 (ou Bun)
- **FFmpeg** instalado no sistema e acessível no `PATH`

### 1. Clonar e Instalar / Clone & Install
```bash
git clone https://github.com/sordinni/sord-selfsticker.git
cd sord-selfsticker
npm install
```

### 2. Configuração / Configuration
Copie o arquivo de exemplo:
```bash
cp .env.example .env
```

### 3. Iniciar o Servidor / Start the Server
```bash
npm start
```
O servidor iniciará em `http://localhost:3002`.

---

## 📡 API Endpoints

### `POST /api/sejabot/pair`
Gera o código de emparelhamento para o número fornecido.
- **Corpo (JSON):**
  ```json
  { "phone": "+5511999998888" }
  ```
- **Resposta (JSON):**
  ```json
  {
    "success": true,
    "code": "ABCD-1234",
    "sessionId": "5511999998888",
    "expiresIn": 120
  }
  ```

### `GET /api/sejabot/status?sessionId=5511999998888`
Retorna o estado da conexão.
- **Resposta (JSON):**
  ```json
  {
    "success": true,
    "status": "connected",
    "phone": "5511999998888"
  }
  ```

### `POST /api/sejabot/disconnect`
Encerra a sessão e apaga todas as chaves de autenticação do disco.
- **Corpo (JSON):**
  ```json
  { "sessionId": "5511999998888" }
  ```

---

## 🐳 Docker Deployment

```bash
docker-compose up -d --build
```

---

## 📄 Licença / License
Este projeto é distribuído sob os termos da licença **GNU Affero General Public License v3 (AGPL-3.0)**. Consulte o arquivo [LICENSE](LICENSE) para mais informações.
