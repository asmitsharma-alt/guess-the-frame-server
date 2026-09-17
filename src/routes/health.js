const express = require('express');
const router = express.Router();
const roomManager = require('../services/roomManager');

// 1. Full health check for Render & UptimeRobot HTTP monitors
router.get('/health', (req, res) => {
  const stats = roomManager.getStats();
  const uptimeSeconds = Math.floor(process.uptime());
  const mem = process.memoryUsage();

  res.status(200).json({
    status: 'ok',
    service: 'guess-the-frame-server',
    uptime: uptimeSeconds,
    uptimeHuman: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
    timestamp: Date.now(),
    serverTime: new Date().toISOString(),
    rooms: stats.activeRooms,
    players: stats.totalPlayers,
    connectedPlayers: stats.connectedPlayers,
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024)
    }
  });
});

// 2. Ultra-lightweight endpoint for fast 200 OK checks
router.get('/ping', (req, res) => {
  res.status(200).send('PONG');
});

// 3. Stats endpoint
router.get('/api/stats', (req, res) => {
  res.json({
    server: 'Guess The Frame Production Realtime Engine',
    version: '1.0.0',
    ...roomManager.getStats()
  });
});

module.exports = router;
