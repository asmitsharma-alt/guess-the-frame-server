require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const socketHandler = require('./services/socketHandler');
const keepAliveService = require('./services/keepAlive');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(s => s.trim()),
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/', healthRoutes);

app.get('/', (req, res) => {
  res.json({
    name: 'Guess The Frame — Realtime Backend Server',
    status: 'online',
    version: '1.0.0',
    documentation: 'https://github.com/asmitsharma-alt/guess-the-frame-server',
    endpoints: {
      health: '/health',
      ping: '/ping',
      stats: '/api/stats',
      websocket: '/ws'
    }
  });
});

// Create HTTP Server & Bind WebSockets
const server = http.createServer(app);
socketHandler.init(server);

// Start listening
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎬 Guess The Frame Server running on port ${PORT}`);
  console.log(`🌐 HTTP Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket Server:  ws://localhost:${PORT}/ws`);
  console.log(`⚙️  Environment:       ${process.env.NODE_ENV || 'production'}`);
  console.log(`=======================================================`);

  // Start internal self-ping keep-alive if configured
  keepAliveService.start();
});

// Graceful Shutdown
const shutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Shutting down server gracefully...`);
  keepAliveService.stop();

  server.close(() => {
    console.log('✅ HTTP & WebSocket servers closed.');
    process.exit(0);
  });

  // Force exit after 5 seconds if connections linger
  setTimeout(() => {
    console.error('⚠️ Forcefully terminating server.');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
