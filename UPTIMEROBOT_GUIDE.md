# 🤖 UptimeRobot Setup Guide: 24/7 Zero Cold Starts on Render

Render's free tier web services spin down (sleep) after 15 minutes of inactivity. When a player connects to a sleeping server, Render takes **50–70 seconds** to perform a cold boot, resulting in connection timeouts or long waiting spinners.

By setting up a free monitor on **[UptimeRobot](https://uptimerobot.com)**, UptimeRobot will ping the server's lightweight `/health` endpoint **every 5 minutes**, keeping the service warm and responsive **24 hours a day, 7 days a week, 100% free**.

---

## 🛠️ Step-by-Step Setup Instructions

### 1. Deploy Your Server to Render
1. Push this repository to GitHub (`asmitsharma-alt/guess-the-frame-server`).
2. Go to your [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** ➔ **Web Service**.
4. Select your repository: `guess-the-frame-server`.
5. Configure the service:
   - **Name**: `guess-the-frame-server` (or any unique name)
   - **Region**: Singapore / Frankfurt / Oregon (choose closest to your players)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
6. Click **Create Web Service**.
7. Wait ~1 minute for deployment to finish. Once live, Render will give you a public URL like:
   ```
   https://guess-the-frame-server.onrender.com
   ```

---

### 2. Create the UptimeRobot Monitor
1. Head over to **[UptimeRobot](https://uptimerobot.com/)** and log in (or create a free account).
2. On the main dashboard, click the **+ Add New Monitor** button.
3. Configure the monitor fields as follows:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Guess The Frame - Render Server`
   - **URL (or IP)**: `https://<YOUR-RENDER-SERVICE-NAME>.onrender.com/health`  
     *(e.g., `https://guess-the-frame-server.onrender.com/health`)*
   - **Monitoring Interval**: `5 minutes` (the fastest interval on the free plan)
   - **Monitor Timeout**: `30 seconds`
   - **Select "Alert Contacts to Notify"**: Check your email box.
4. Click **Create Monitor**.

---

### 3. Verification
- Within 1–2 minutes, UptimeRobot will perform its first check.
- You should see the monitor turn **Green (Up 100%)**.
- If you open `https://<your-service>.onrender.com/health` in your browser, you will see the JSON output:
  ```json
  {
    "status": "ok",
    "service": "guess-the-frame-server",
    "uptime": 1240,
    "uptimeHuman": "0h 20m 40s",
    "timestamp": 1726569100000,
    "rooms": 1,
    "players": 3,
    "connectedPlayers": 3
  }
  ```
- Because UptimeRobot sends a request every 5 minutes, **Render will never sleep**, guaranteeing instant sub-second joins for any player at any time!
