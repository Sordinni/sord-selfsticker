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
- **Figurinhas Estáticas:** Envie qualquer foto ou imagem para receber a figurinha WebP instantânea.
- **Figurinhas Animadas:** Envie um vídeo curto ou GIF (até 10 segundos) para receber uma figurinha animada otimizada (< 1MB) com FFmpeg.
- **Modo Esticado (`.alternar`):** Alterne entre figurinhas esticadas (ocupando todo o quadrado 512x512) ou com proporção original preservada.
- **Controle de Autosticker (`.autosticker on/off`):** Ative ou desative a conversão automática de mídias enviadas sem legenda.
- **Créditos Personalizados (`.renomear Pack | Autor`):** Defina o nome do pacote e autor gravados no EXIF de suas figurinhas.
- **Comando Manual (`.s` / `.fig`):** Crie figurinhas respondendo a qualquer mídia ou com tamanhos personalizados (ex: `.s 26`, `.s 256`).

### Comandos Disponíveis no Chat Próprio
- `.alternar` — Alterna o modo esticado (Ativado/Desativado).
- `.autosticker on` — Ativa a conversão automática ao enviar fotos/vídeos sem legenda.
- `.autosticker off` — Desativa a conversão automática (converte apenas com `.s` ou `.fig`).
- `.renomear Pack | Autor` — Personaliza o nome do pacote e o autor da figurinha.
- `.s` ou `.fig` — Converte a mídia enviada ou citada (suporta tamanho, ex: `.s 26`).
- `.enviar (anuncio)` — Envia comunicado em massa para todos os usuários cadastrados (apenas owner).
- `.status` — Mostra o status das suas preferências atuais.
- `.ajuda` — Exibe o menu com todos os comandos e exemplos.

### Garantia de Privacidade Zero-Sight
1. **Sem leitura de terceiros:** Qualquer mensagem recebida ou enviada que **não** seja o seu próprio chat com você mesmo (`remoteJid !== myJid`) é imediatamente descartada na memória RAM, sem logs nem persistência.
2. **Sem mensagens para fora:** O robô nunca responde nem envia mensagens para grupos ou outros contatos.
3. **Controle Total:** Você pode desconectar o robô a qualquer instante tanto pelo WhatsApp ("Aparelhos Conectados") quanto pela API/site.

---

## 🇺🇸 English

### Overview
**Sord Self-Sticker** allows users to link their WhatsApp account via an 8-digit **Pairing Code** without scanning QR codes. Once paired, it works **strictly in your private "Message Yourself" chat**:
- **Static Stickers:** Send any photo to receive an instant WebP sticker.
- **Animated Stickers:** Send a short video or GIF (< 10s) to receive an optimized animated sticker (< 1MB).
- **Stretched Mode (`.alternar`):** Toggle between stretched stickers (filling the entire 512x512 canvas) and aspect-ratio preserved stickers.
- **Autosticker Control (`.autosticker on/off`):** Enable or disable automatic conversion of media sent without captions.
- **Custom Credits (`.renomear Pack | Author`):** Set custom pack name and publisher author recorded into sticker EXIF.
- **Manual Commands (`.s` / `.fig`):** Convert media by replying or specifying custom dimensions (e.g., `.s 26`, `.s 256`).

### Self-Chat Commands
- `.alternar` — Toggle stretched mode (Active/Disabled).
- `.autosticker on` — Enable automatic conversion for media sent without caption.
- `.autosticker off` — Disable automatic conversion (convert only via `.s` or `.fig`).
- `.renomear Pack | Author` — Customize sticker pack name and author.
- `.s` or `.fig` — Convert attached or quoted media (supports sizes, e.g. `.s 26`).
- `.enviar (announcement)` — Broadcast announcement to all registered users (owner only).
- `.status` — Display current user preferences.
- `.ajuda` / `.help` — Display help menu with all commands.

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

### `POST /api/sejabot/enviar`
Transmite uma mensagem de anúncio oficial para todos os usuários cadastrados.
- **Corpo (JSON):**
  ```json
  { "message": "O bot foi atualizado com novas funções!" }
  ```
- **Resposta (JSON):**
  ```json
  {
    "success": true,
    "total": 5,
    "successCount": 5,
    "failedCount": 0,
    "failures": []
  }
  ```

---

## 🐳 Docker Deployment

```bash
docker-compose up -d --build
```

---

## 📄 Licença / License
Este projeto é distribuído sob os termos da licença **GNU Affero General Public License v3 (AGPL-3.0)**. Consulte o arquivo [LICENSE](LICENSE) para mais informações.
