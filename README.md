# 🎬 Guess The Frame — Realtime Backend Server (Render + UptimeRobot)

Production real-time WebSocket backend engine for **[Guess The Frame](https://github.com/asmitsharma-alt/guess-the-frame)**, providing authoritative room state, sub-millisecond timer synchronization, unbreakable auto-reconnection, latency telemetry, and anti-spoiler chat protection.

---

## ⚡ Features

- **Authoritative Server Engine**: Rooms, active frames, scores, and round winners are verified and stored authoritatively on the server to prevent desyncs and tampering.
- **Unbreakable Reconnection**: Players who lock their phone, switch between Wi-Fi and 5G, or accidentally refresh reconnect seamlessly with their score, current frame, and timer restored instantly.
- **Microsecond Clock Synchronization**: Replaces client-local drift with server timestamps so movie unblur canvas animations remain lock-stepped across all screens.
- **Connection Strength & Health Telemetry**: Live ping/pong RTT calculation, powering real-time connection strength badges (🟢 Strong / 🟡 Moderate / 🔴 Weak).
- **Zero Cold Starts (UptimeRobot Ready)**: Dedicated `/health` and `/ping` endpoints paired with an internal keepalive daemon to ensure Render free tier remains awake 24/7.
- **Anti-Spoiler Shield**: Prevents players from leaking answers in the live chat during active rounds.

---

## 📦 Project Structure

```
guess-the-frame-server/
├── src/
│   ├── server.js              # Express + WebSocket HTTP server entrypoint
│   ├── routes/
│   │   └── health.js          # /health & /ping endpoints for UptimeRobot
│   ├── services/
│   │   ├── roomManager.js     # Authoritative room state, timer, and player scores
│   │   ├── socketHandler.js   # WebSocket event router, reconnect, and ping/pong
│   │   └── keepAlive.js       # Background keepalive self-ping worker
│   └── utils/
│       └── fuzzyMatcher.js    # Levenshtein distance & anti-spoiler filter
├── render.yaml                # Render Blueprint specification
├── UPTIMEROBOT_GUIDE.md       # Step-by-step UptimeRobot keepalive tutorial
├── package.json
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Test Suite
```bash
npm test
```

### 3. Start Local Server
```bash
npm run dev
```
The server will run on `http://localhost:10000` with WebSockets available at `ws://localhost:10000/ws`.

---

## ☁️ Deploying to Render

### Method A: One-Click Blueprint (`render.yaml`)
1. In your [Render Dashboard](https://dashboard.render.com/), click **New +** ➔ **Blueprint**.
2. Connect this repository (`asmitsharma-alt/guess-the-frame-server`).
3. Click **Apply**. Render will automatically detect `render.yaml` and configure the Web Service!

### Method B: Manual Web Service
1. In Render Dashboard, click **New +** ➔ **Web Service**.
2. Connect this repository.
3. Configure settings:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Set Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `CORS_ORIGIN`: `*`
5. Click **Deploy Web Service**.

---

## 🤖 24/7 Keep-Alive via UptimeRobot

To prevent Render free tier from sleeping after 15 minutes of inactivity:
1. Create a free HTTP monitor on [UptimeRobot](https://uptimerobot.com).
2. Set URL to `https://<YOUR-RENDER-URL>.onrender.com/health`.
3. Set interval to **5 minutes**.
4. Read the detailed guide in [UPTIMEROBOT_GUIDE.md](./UPTIMEROBOT_GUIDE.md).
