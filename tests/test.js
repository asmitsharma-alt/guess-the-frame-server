const assert = require('assert');
const FuzzyMatcher = require('../src/utils/fuzzyMatcher');
const roomManager = require('../src/services/roomManager');

console.log('🧪 Starting Guess The Frame Server Test Suite...\n');

// 1. FuzzyMatcher Tests
console.log('--- 1. Testing FuzzyMatcher & Spoiler Shield ---');
assert.strictEqual(FuzzyMatcher.isMatch('12th fail', '12th Fail (2023)'), true, 'Should match ignoring year');
assert.strictEqual(FuzzyMatcher.isMatch('The Godfather', 'Godfather'), true, 'Should match ignoring article');
assert.strictEqual(FuzzyMatcher.isMatch('Detective Byomkesh Bakshy', 'Detective Byomkesh Bakshy (2015)'), true, 'Should match exact title');
assert.strictEqual(FuzzyMatcher.isMatch('Random Movie', 'After Hours'), false, 'Should reject completely different movie');

const spoilerCheck = FuzzyMatcher.isSpoiler('I think it is Bramayugam movie', 'Bramayugam (2024)');
assert.strictEqual(spoilerCheck, true, 'Should catch spoiler in chat');
console.log('✅ FuzzyMatcher tests passed.');

// 2. RoomManager Tests
console.log('\n--- 2. Testing RoomManager Authoritative Lifecycle ---');
const hostData = { id: 'host_test_1', name: 'Asmit', avatar: 'aman' };
const { room, hostPlayer } = roomManager.createRoom(hostData, { timer: 30 });

assert.ok(room.code, 'Room should have a 4-letter code');
assert.strictEqual(room.hostId, hostPlayer.id, 'Host ID should match');
assert.strictEqual(room.players.size, 1, 'Room should have 1 player (host)');

// Join Player
const joinResult = roomManager.joinRoom(room.code, { id: 'player_test_2', name: 'Guest', avatar: 'aziz' });
assert.strictEqual(joinResult.success, true, 'Join should succeed');
assert.strictEqual(room.players.size, 2, 'Room should now have 2 players');

// Reconnection Test
const reconResult = roomManager.reconnectPlayer(room.code, 'player_test_2', { lastKnownScore: 10 });
assert.ok(reconResult, 'Reconnect should return player');
assert.strictEqual(reconResult.player.connected, true, 'Player should be marked connected');

// Match Start & Guessing
roomManager.startMatch(room.code, [
  { id: 1, answer: 'After Hours', year: '1985' },
  { id: 2, answer: 'Piku', year: '2015' }
]);

assert.strictEqual(room.status, 'PLAYING', 'Room status should be PLAYING');
assert.strictEqual(room.currentPlayIndex, 0, 'Current play index should be 0');

const guessResult = roomManager.processGuess(room.code, 'player_test_2', 'after hours');
assert.strictEqual(guessResult.valid, true, 'Guess should be valid');
assert.strictEqual(guessResult.isCorrect, true, 'Guess should be correct');
assert.ok(guessResult.player.score > 0, 'Player should have scored points');

// Duplicate guess prevention
const dupGuess = roomManager.processGuess(room.code, 'player_test_2', 'after hours');
assert.strictEqual(dupGuess.alreadyWon, true, 'Should block duplicate guess in same round');

// Snapshot test
const snapshot = roomManager.getRoomSnapshot(room.code);
assert.ok(snapshot.remainingSeconds <= 30, 'Snapshot should calculate remaining seconds');
assert.strictEqual(snapshot.roundWinners.length, 1, 'Snapshot should list round winners');

console.log('✅ RoomManager tests passed.');

// 3. Stats Check
console.log('\n--- 3. Testing Stats & Diagnostics ---');
const stats = roomManager.getStats();
assert.ok(stats.activeRooms >= 1, 'Stats should report active rooms');
console.log('Stats:', stats);
console.log('✅ Diagnostics tests passed.');

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
process.exit(0);
