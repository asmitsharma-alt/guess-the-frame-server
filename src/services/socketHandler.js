const { WebSocketServer } = require('ws');
const roomManager = require('./roomManager');
const FuzzyMatcher = require('../utils/fuzzyMatcher');

class SocketHandler {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { roomCode, playerId, isHost, ip, isAlive, lastPingTime }
  }

  init(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const clientState = {
        roomCode: null,
        playerId: null,
        isHost: false,
        ip,
        isAlive: true,
        lastPingTime: Date.now()
      };
      this.clients.set(ws, clientState);

      ws.on('pong', () => {
        clientState.isAlive = true;
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, clientState, msg);
        } catch (err) {
          console.error('[WS] Invalid JSON received:', err.message);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws, clientState);
      });

      ws.on('error', (err) => {
        console.warn('[WS] Socket error:', err.message);
      });

      // Send initial welcome
      this.send(ws, {
        type: 'SERVER_HELLO',
        message: 'Connected to Guess The Frame Realtime Server',
        serverTime: Date.now()
      });
    });

    // 25-second WebSocket ping interval to prevent carrier/proxy timeouts
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = this.clients.get(ws);
        if (!client) return;
        if (!client.isAlive) {
          console.log(`[WS] Terminating unresponsive socket for player ${client.playerId || 'anonymous'}`);
          ws.terminate();
          this.clients.delete(ws);
          return;
        }
        client.isAlive = false;
        ws.ping();
      });
    }, 25000);

    console.log('🔌 [WebSocket] Realtime Server listening on /ws');
  }

  send(ws, payload) {
    if (ws && ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify(payload));
    }
  }

  broadcastToRoom(roomCode, payload, excludeWs = null) {
    if (!roomCode) return;
    if (typeof payload === 'object' && payload !== null && !payload.roomCode) {
      payload.roomCode = roomCode;
    }
    const json = JSON.stringify(payload);
    for (const [ws, client] of this.clients.entries()) {
      if (client.roomCode === roomCode && ws !== excludeWs && ws.readyState === 1) {
        ws.send(json);
      }
    }
  }

  handleMessage(ws, client, msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      // 1. Telemetry / Connection Strength Ping
      case 'PING': {
        const clientTime = msg.clientTime || Date.now();
        const serverTime = Date.now();
        this.send(ws, {
          type: 'PONG',
          clientTime,
          serverTime
        });
        break;
      }

      // 2. Room Creation
      case 'CREATE_ROOM': {
        const { hostPlayer, settings, roomCode } = msg;
        const initialSettings = { ...(settings || {}), roomCode: roomCode || (settings && settings.roomCode) };
        const result = roomManager.createRoom(hostPlayer || {}, initialSettings);
        client.roomCode = result.room.code;
        client.playerId = result.hostPlayer.id;
        client.isHost = true;

        this.send(ws, {
          type: 'ROOM_CREATED',
          roomCode: result.room.code,
          roomId: result.room.id,
          hostPlayer: result.hostPlayer,
          players: Array.from(result.room.players.values()),
          settings: result.room.settings,
          serverTime: Date.now()
        });
        break;
      }

      // 3. Room Joining
      case 'JOIN_ROOM': {
        const { roomCode, player } = msg;
        const result = roomManager.joinRoom(roomCode, player || {});
        if (!result.success) {
          return this.send(ws, {
            type: 'JOIN_REJECTED',
            error: result.error,
            message: result.message
          });
        }

        client.roomCode = result.room.code;
        client.playerId = result.player.id;
        client.isHost = result.player.isHost;

        // Acknowledge the joining player with full room snapshot
        this.send(ws, {
          type: 'JOIN_ACCEPTED',
          roomCode: result.room.code,
          roomId: result.room.id,
          player: result.player,
          players: Array.from(result.room.players.values()),
          settings: result.room.settings,
          gameState: result.room.status.toLowerCase(),
          serverTime: Date.now()
        });

        // Broadcast player joined to room
        this.broadcastToRoom(result.room.code, {
          type: 'PLAYER_JOINED',
          player: result.player,
          players: Array.from(result.room.players.values())
        }, ws);
        break;
      }

      // 4. Resilient Reconnection & State Recovery
      case 'RECONNECT_SESSION': {
        const { roomCode, playerId, playerName, playerAvatar, lastKnownScore } = msg;
        const result = roomManager.reconnectPlayer(roomCode, playerId, {
          name: playerName,
          avatar: playerAvatar,
          lastKnownScore
        });

        if (!result) {
          return this.send(ws, {
            type: 'RECONNECT_FAILED',
            message: 'Room session expired or not found.'
          });
        }

        client.roomCode = result.room.code;
        client.playerId = result.player.id;
        client.isHost = result.player.isHost;

        // Provide complete authoritative state snapshot
        const snapshot = roomManager.getRoomSnapshot(result.room.code);
        this.send(ws, {
          type: 'RECONNECT_SUCCESS',
          player: result.player,
          snapshot,
          serverTime: Date.now()
        });

        // Notify other players
        this.broadcastToRoom(result.room.code, {
          type: 'PLAYER_RECONNECTED',
          playerId: result.player.id,
          playerName: result.player.name,
          players: Array.from(result.room.players.values())
        }, ws);
        break;
      }

      // 5. Game Start Flow
      case 'SHOW_HOW_TO_ANSWER': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room || !client.isHost) return;
        room.status = 'HOW_TO_ANSWER';
        this.broadcastToRoom(room.code, {
          type: 'SHOW_HOW_TO_ANSWER',
          totalRounds: msg.totalRounds || 10,
          settings: room.settings,
          players: Array.from(room.players.values()),
          playlist: msg.playlist || room.playlist
        });
        break;
      }

      case 'START_GAME': {
        const room = roomManager.startMatch(client.roomCode, msg.playlist, msg.settings);
        if (!room || !client.isHost) return;

        this.broadcastToRoom(room.code, {
          type: 'GAME_STARTED',
          playlist: room.playlist,
          totalRounds: room.playlist.length,
          settings: room.settings,
          players: Array.from(room.players.values()),
          serverTime: Date.now()
        });
        break;
      }

      case 'START_ROUND': {
        const room = roomManager.startRound(client.roomCode, msg.roundIndex);
        if (!room || !client.isHost) return;

        const currentFrame = room.playlist[room.currentPlayIndex];
        this.broadcastToRoom(room.code, {
          type: 'ROUND_START',
          roundIndex: room.currentPlayIndex,
          currentFrame,
          totalRounds: room.playlist.length,
          duration: room.roundDurationSec,
          roundStartedAt: room.roundStartedAt,
          players: Array.from(room.players.values()),
          serverTime: Date.now()
        });
        break;
      }

      // 6. Guess Submission & Anti-Cheat Validation
      case 'SUBMIT_GUESS': {
        const { guess, roundIndex } = msg;
        const result = roomManager.processGuess(client.roomCode, client.playerId, guess);

        if (!result.valid) {
          if (result.alreadyWon) {
            return this.send(ws, { type: 'GUESS_ALREADY_SUBMITTED' });
          }
          return;
        }

        if (result.isCorrect) {
          // Broadcast winner & points
          this.broadcastToRoom(client.roomCode, {
            type: 'GUESS_CORRECT',
            winner: result.winnerEntry,
            players: Array.from(result.room.players.values()),
            allGuessed: result.allGuessed,
            serverTime: Date.now()
          });

          // If all active players guessed, finish round early
          if (result.allGuessed) {
            result.room.status = 'ROUND_END';
            this.broadcastToRoom(client.roomCode, {
              type: 'ROUND_FINISHED',
              roundIndex: result.room.currentPlayIndex,
              currentFrame: result.room.playlist[result.room.currentPlayIndex],
              roundWinners: result.room.roundWinners,
              players: Array.from(result.room.players.values())
            });
          }
        } else {
          // Send wrong guess feedback only to sender
          this.send(ws, {
            type: 'GUESS_RESULT',
            isCorrect: false,
            message: '❌ Not quite, try again!'
          });
        }
        break;
      }

      // 7. Hints
      case 'REQUEST_HINT': {
        const hintResult = roomManager.requestHint(client.roomCode, client.playerId);
        if (hintResult) {
          this.broadcastToRoom(client.roomCode, {
            type: 'HINT_BROADCAST',
            maskedHint: hintResult.maskedHint,
            requestedBy: hintResult.player.name,
            players: Array.from(roomManager.getRoom(client.roomCode).players.values())
          });
        }
        break;
      }

      // 8. Round Controls
      case 'HOST_SKIP_ROUND': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room || !client.isHost) return;
        room.status = 'ROUND_END';
        this.broadcastToRoom(room.code, {
          type: 'HOST_SKIPPED_ROUND',
          roundIndex: room.currentPlayIndex,
          currentFrame: room.playlist[room.currentPlayIndex],
          roundWinners: room.roundWinners,
          players: Array.from(room.players.values())
        });
        break;
      }

      case 'HOST_NEXT_ROUND': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room || !client.isHost) return;

        const nextIndex = room.currentPlayIndex + 1;
        if (nextIndex >= room.playlist.length) {
          // Match Finished
          room.status = 'GAME_OVER';
          const podium = Array.from(room.players.values()).sort((a, b) => b.score - a.score);
          this.broadcastToRoom(room.code, {
            type: 'GAME_OVER',
            podium,
            winner: podium[0] || null
          });
        } else {
          roomManager.startRound(room.code, nextIndex);
          const currentFrame = room.playlist[nextIndex];
          this.broadcastToRoom(room.code, {
            type: 'ROUND_START',
            roundIndex: nextIndex,
            currentFrame,
            totalRounds: room.playlist.length,
            duration: room.roundDurationSec,
            roundStartedAt: room.roundStartedAt,
            players: Array.from(room.players.values()),
            serverTime: Date.now()
          });
        }
        break;
      }

      case 'HOST_TOGGLE_PAUSE': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room || !client.isHost) return;
        room.isPaused = !room.isPaused;
        this.broadcastToRoom(room.code, {
          type: 'MATCH_PAUSED',
          isPaused: room.isPaused
        });
        break;
      }

      case 'END_MATCH': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room || !client.isHost) return;
        room.status = 'GAME_OVER';
        const podium = Array.from(room.players.values()).sort((a, b) => b.score - a.score);
        this.broadcastToRoom(room.code, {
          type: 'GAME_OVER',
          podium,
          winner: podium[0] || null
        });
        break;
      }

      case 'REMATCH': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room) return;
        room.status = 'LOBBY';
        room.players.forEach(p => p.score = 0);
        room.roundWinners = [];
        room.currentPlayIndex = 0;
        this.broadcastToRoom(room.code, {
          type: 'RETURN_TO_LOBBY',
          players: Array.from(room.players.values()),
          settings: room.settings
        });
        break;
      }

      // 9. In-Game Chat & Spoiler Filtering
      case 'CHAT_MESSAGE': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room) return;

        const text = String(msg.text || (msg.msg && msg.msg.text) || '').trim();
        if (!text) return;

        // Check spoiler shield during active round
        if (room.status === 'PLAYING' && room.playlist[room.currentPlayIndex]) {
          const currentAns = room.playlist[room.currentPlayIndex].answer;
          if (FuzzyMatcher.isMatch(text, currentAns)) {
            // Evaluated as a guess submission rather than public leak
            return this.handleMessage(ws, client, {
              type: 'SUBMIT_GUESS',
              guess: text,
              roundIndex: room.currentPlayIndex
            });
          }
          if (FuzzyMatcher.isSpoiler(text, currentAns)) {
            return this.send(ws, {
              type: 'SYSTEM_MESSAGE',
              text: "⚠️ Shh! That message contains a spoiler for the active frame! 🤫"
            });
          }
        }

        const chatPayload = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          senderId: client.playerId,
          senderName: (room.players.get(client.playerId) || {}).name || 'Player',
          senderAvatar: (room.players.get(client.playerId) || {}).avatar || 'aman',
          text,
          timestamp: Date.now()
        };

        room.chatHistory.push(chatPayload);
        if (room.chatHistory.length > 50) room.chatHistory.shift();

        this.broadcastToRoom(room.code, {
          type: 'CHAT_MESSAGE',
          msg: chatPayload
        });
        break;
      }

      // 10. Player Kick (Host only)
      case 'KICK_PLAYER': {
        const room = roomManager.getRoom(client.roomCode);
        if (!room || !client.isHost) return;

        const targetId = msg.targetPlayerId;
        if (targetId && targetId !== client.playerId) {
          room.players.delete(targetId);

          // Notify kicked player socket
          for (const [otherWs, otherClient] of this.clients.entries()) {
            if (otherClient.playerId === targetId) {
              this.send(otherWs, { type: 'YOU_WERE_KICKED' });
              otherWs.close();
            }
          }

          this.broadcastToRoom(room.code, {
            type: 'PLAYER_KICKED',
            targetPlayerId: targetId,
            players: Array.from(room.players.values())
          });
        }
        break;
      }

      // 11. State Sync Request (Manual fallback sync)
      case 'REQUEST_ROOM_SYNC': {
        const snapshot = roomManager.getRoomSnapshot(client.roomCode);
        if (snapshot) {
          this.send(ws, {
            type: 'ROOM_SNAPSHOT',
            snapshot,
            serverTime: Date.now()
          });
        }
        break;
      }
    }
  }

  handleDisconnect(ws, client) {
    this.clients.delete(ws);
    if (!client.roomCode || !client.playerId) return;

    roomManager.handlePlayerDisconnect(client.roomCode, client.playerId, (room, removedPlayer) => {
      // Called if player does not reconnect within 45s grace period
      this.broadcastToRoom(room.code, {
        type: 'PLAYER_LEFT',
        playerId: removedPlayer.id,
        playerName: removedPlayer.name,
        players: Array.from(room.players.values())
      });

      if (removedPlayer.isHost) {
        const newHost = Array.from(room.players.values()).find(p => p.isHost);
        if (newHost) {
          this.broadcastToRoom(room.code, {
            type: 'HOST_MIGRATED',
            newHostId: newHost.id,
            newHostName: newHost.name
          });
        }
      }
    });

    // Notify other players of temporary disconnection
    this.broadcastToRoom(client.roomCode, {
      type: 'PLAYER_CONNECTION_STATUS',
      playerId: client.playerId,
      status: 'offline'
    });
  }
}

module.exports = new SocketHandler();
