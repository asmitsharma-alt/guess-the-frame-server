// Self-ping Keep-Alive Service to keep Render free tier awake 24/7
const https = require('https');
const http = require('http');

class KeepAliveService {
  constructor() {
    this.timer = null;
    this.intervalMs = 10 * 60 * 1000; // 10 minutes
  }

  start(externalUrl) {
    const url = externalUrl || process.env.RENDER_EXTERNAL_URL;
    if (!url) {
      console.log('ℹ️  [KeepAlive] RENDER_EXTERNAL_URL not set. Relying on UptimeRobot external health checks.');
      return;
    }

    const target = url.endsWith('/') ? `${url}health` : `${url}/health`;
    console.log(`⏱️  [KeepAlive] Self-ping scheduled for ${target} every 10 minutes.`);

    this.timer = setInterval(() => {
      this.ping(target);
    }, this.intervalMs);

    // Initial warm-up ping after 30 seconds
    setTimeout(() => this.ping(target), 30000);
  }

  ping(targetUrl) {
    try {
      const client = targetUrl.startsWith('https') ? https : http;
      client.get(targetUrl, (res) => {
        res.resume(); // consume response data to free up memory
        console.log(`[KeepAlive] Self-ping response: ${res.statusCode} at ${new Date().toISOString()}`);
      }).on('error', (err) => {
        console.warn(`[KeepAlive] Self-ping warning: ${err.message}`);
      });
    } catch (e) {
      console.warn(`[KeepAlive] Execution notice: ${e.message}`);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = new KeepAliveService();
