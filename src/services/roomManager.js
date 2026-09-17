const FuzzyMatcher = require('../utils/fuzzyMatcher');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    // Prune stale rooms every 5 minutes
    setInterval(() => this.pruneInactiveRooms(), 5 * 60 * 1000);
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Ensure uniqueness
    if (this.rooms.has(code)) return this.generateRoomCode();
    return code;
  }

  createRoom(hostData, initialSettings = {}) {
    const code = this.generateRoomCode();
    const settings = {
      category: 'all',
      categories: ['frames', 'eyes', 'dialogue'],
      roundsByMode: { frames: 3, eyes: 3, dialogue: 4 },
      rounds: 10,
      timer: 30,
      maxPlayers: 12,
      ...initialSettings
    };

    const hostPlayer = {
      id: hostData.id || `p_${Math.random().toString(36).substr(2, 9)}`,
      name: (hostData.name || 'Host').trim().slice(0, 16),
      avatar: (hostData.avatar || 'aman').toLowerCase(),
      score: 0,
      isHost: true,
      connected: true,
      pingMs: 0,
      lastSeen: Date.now(),
      joinTime: Date.now()
    };

    const room = {
      code,
      id: `room_${code}`,
      hostId: hostPlayer.id,
      players: new Map([[hostPlayer.id, hostPlayer]]),
      status: 'LOBBY', // LOBBY, HOW_TO_ANSWER, PLAYING, ROUND_END, GAME_OVER
      settings,
      playlist: [],
      currentPlayIndex: 0,
      roundStartedAt: 0,
      roundDurationSec: settings.timer || 30,
      roundWinners: [],
      maskedHint: null,
      chatHistory: [],
      pendingDisconnects: new Map(),
      isPaused: false,
      lastActivity: Date.now()
    };

    this.rooms.set(code, room);
    return { room, hostPlayer };
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase().trim()) || null;
  }

  joinRoom(code, playerData) {
    const room = this.getRoom(code);
    if (!room) {
      return { success: false, error: 'ROOM_NOT_FOUND', message: 'Room not found. Please verify the code.' };
    }

    const maxPlayers = room.settings.maxPlayers || 12;
    if (room.players.size >= maxPlayers) {
      return { success: false, error: 'ROOM_FULL', message: `This room is full (${maxPlayers}/${maxPlayers} players).` };
    }

    const playerId = playerData.id || `p_${Math.random().toString(36).substr(2, 9)}`;
    const existing = room.players.get(playerId);

    if (existing) {
      // Re-joining player
      existing.name = (playerData.name || existing.name).trim().slice(0, 16);
      existing.avatar = (playerData.avatar || existing.avatar).toLowerCase();
      existing.connected = true;
      existing.lastSeen = Date.now();
      room.lastActivity = Date.now();
      return { success: true, room, player: existing, isRejoin: true };
    }

    const newPlayer = {
      id: playerId,
      name: (playerData.name || 'Player').trim().slice(0, 16),
      avatar: (playerData.avatar || 'aman').toLowerCase(),
      score: 0,
      isHost: false,
      connected: true,
      pingMs: 0,
      lastSeen: Date.now(),
      joinTime: Date.now()
    };

    room.players.set(newPlayer.id, newPlayer);
    room.lastActivity = Date.now();

    return { success: true, room, player: newPlayer, isRejoin: false };
  }

  reconnectPlayer(code, playerId, playerData = {}) {
    const room = this.getRoom(code);
    if (!room) return null;

    // Clear pending disconnect grace timer if active
    if (room.pendingDisconnects.has(playerId)) {
      clearTimeout(room.pendingDisconnects.get(playerId));
      room.pendingDisconnects.delete(playerId);
    }

    let player = room.players.get(playerId);
    if (!player) {
      // Player score recovery from client payload if room was refreshed
      player = {
        id: playerId,
        name: (playerData.name || 'Player').trim().slice(0, 16),
        avatar: (playerData.avatar || 'aman').toLowerCase(),
        score: typeof playerData.lastKnownScore === 'number' ? playerData.lastKnownScore : 0,
        isHost: room.hostId === playerId,
        connected: true,
        pingMs: 0,
        lastSeen: Date.now(),
        joinTime: Date.now()
      };
      room.players.set(playerId, player);
    } else {
      player.connected = true;
      player.lastSeen = Date.now();
      if (playerData.name) player.name = playerData.name.trim().slice(0, 16);
      if (playerData.avatar) player.avatar = playerData.avatar.toLowerCase();
    }

    room.lastActivity = Date.now();
    return { room, player };
  }

  handlePlayerDisconnect(code, playerId, onRemovedCallback) {
    const room = this.getRoom(code);
    if (!room || !room.players.has(playerId)) return;

    const player = room.players.get(playerId);
    player.connected = false;

    // 45-second grace period for reconnecting
    if (room.pendingDisconnects.has(playerId)) {
      clearTimeout(room.pendingDisconnects.get(playerId));
    }

    const timer = setTimeout(() => {
      room.pendingDisconnects.delete(playerId);
      const target = room.players.get(playerId);
      if (target && !target.connected) {
        room.players.delete(playerId);

        // Host migration if host left
        if (target.isHost && room.players.size > 0) {
          const nextHost = Array.from(room.players.values()).find(p => p.connected) || Array.from(room.players.values())[0];
          if (nextHost) {
            nextHost.isHost = true;
            room.hostId = nextHost.id;
          }
        }

        if (typeof onRemovedCallback === 'function') {
          onRemovedCallback(room, target);
        }

        if (room.players.size === 0) {
          this.rooms.delete(code);
        }
      }
    }, 45000);

    room.pendingDisconnects.set(playerId, timer);
  }

  startMatch(code, playlist, settings = null) {
    const room = this.getRoom(code);
    if (!room) return null;

    if (playlist && Array.isArray(playlist) && playlist.length > 0) {
      room.playlist = playlist;
    }
    if (settings) {
      room.settings = { ...room.settings, ...settings };
    }

    room.currentPlayIndex = 0;
    room.status = 'PLAYING';
    room.roundStartedAt = Date.now();
    room.roundDurationSec = room.settings.timer || 30;
    room.roundWinners = [];
    room.maskedHint = null;
    room.isPaused = false;
    room.lastActivity = Date.now();

    // Reset scores for new match
    room.players.forEach(p => p.score = 0);

    return room;
  }

  startRound(code, roundIndex) {
    const room = this.getRoom(code);
    if (!room) return null;

    room.currentPlayIndex = roundIndex !== undefined ? roundIndex : room.currentPlayIndex + 1;
    room.status = 'PLAYING';
    room.roundStartedAt = Date.now();
    room.roundDurationSec = room.settings.timer || 30;
    room.roundWinners = [];
    room.maskedHint = null;
    room.isPaused = false;
    room.lastActivity = Date.now();

    return room;
  }

  processGuess(code, playerId, guessText) {
    const room = this.getRoom(code);
    if (!room || room.status !== 'PLAYING') return { valid: false, error: 'ROUND_NOT_ACTIVE' };

    const player = room.players.get(playerId);
    if (!player) return { valid: false, error: 'PLAYER_NOT_FOUND' };

    // Check if player already guessed correctly in this round
    if (room.roundWinners.some(w => w.playerId === playerId)) {
      return { valid: false, alreadyWon: true };
    }

    const currentFrame = room.playlist[room.currentPlayIndex];
    if (!currentFrame || !currentFrame.answer) return { valid: false, error: 'NO_FRAME_ACTIVE' };

    const isMatch = FuzzyMatcher.isMatch(guessText, currentFrame.answer);
    if (!isMatch) {
      return { valid: true, isCorrect: false };
    }

    // Correct answer!
    const elapsedSec = Math.max(0, (Date.now() - room.roundStartedAt) / 1000);
    const position = room.roundWinners.length + 1;

    // Speed-based point scoring: 1st = 10pts, 2nd = 8pts, 3rd = 6pts, etc. (min 3pts)
    const basePoints = Math.max(3, 12 - (position * 2));
    player.score += basePoints;

    const winnerEntry = {
      playerId: player.id,
      playerName: player.name,
      playerAvatar: player.avatar,
      points: basePoints,
      newScore: player.score,
      position,
      timeTakenSec: Number(elapsedSec.toFixed(2))
    };

    room.roundWinners.push(winnerEntry);
    room.lastActivity = Date.now();

    // Check if all connected players have guessed correctly
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
    const allGuessed = connectedPlayers.length > 0 && room.roundWinners.length >= connectedPlayers.length;

    return {
      valid: true,
      isCorrect: true,
      winnerEntry,
      player,
      allGuessed,
      room
    };
  }

  requestHint(code, playerId) {
    const room = this.getRoom(code);
    if (!room || room.status !== 'PLAYING') return null;

    const currentFrame = room.playlist[room.currentPlayIndex];
    if (!currentFrame || !currentFrame.answer) return null;

    if (!room.maskedHint) {
      room.maskedHint = FuzzyMatcher.generateMaskedHint(currentFrame.answer);
    }

    // Deduct 2 points from player requesting hint
    const player = room.players.get(playerId);
    if (player) {
      player.score = Math.max(0, player.score - 2);
    }

    room.lastActivity = Date.now();
    return { maskedHint: room.maskedHint, player };
  }

  getRoomSnapshot(code) {
    const room = this.getRoom(code);
    if (!room) return null;

    const elapsed = room.roundStartedAt ? (Date.now() - room.roundStartedAt) / 1000 : 0;
    const remainingSeconds = Math.max(0, Math.round(room.roundDurationSec - elapsed));

    return {
      roomCode: room.code,
      roomId: room.id,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      players: Array.from(room.players.values()),
      currentPlaylist: room.playlist,
      currentPlayIndex: room.currentPlayIndex,
      currentFrame: room.playlist[room.currentPlayIndex] || null,
      roundStartedAt: room.roundStartedAt,
      roundDurationSec: room.roundDurationSec,
      remainingSeconds: remainingSeconds,
      roundWinners: room.roundWinners,
      maskedHint: room.maskedHint,
      isPaused: room.isPaused
    };
  }

  pruneInactiveRooms() {
    const now = Date.now();
    const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours of complete inactivity
    for (const [code, room] of this.rooms.entries()) {
      if (now - (room.lastActivity || 0) > staleThreshold || room.players.size === 0) {
        console.log(`🧹 [RoomManager] Pruned inactive room: ${code}`);
        this.rooms.delete(code);
      }
    }
  }

  getStats() {
    let totalPlayers = 0;
    let connectedPlayers = 0;
    for (const room of this.rooms.values()) {
      totalPlayers += room.players.size;
      for (const p of room.players.values()) {
        if (p.connected) connectedPlayers++;
      }
    }
    return {
      activeRooms: this.rooms.size,
      totalPlayers,
      connectedPlayers
    };
  }
}

module.exports = new RoomManager();
