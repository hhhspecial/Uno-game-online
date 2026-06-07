const {
    bindPlayerSocket,
    unbindSocket,
    getPlayerId,
    getRoomId,
    getSocketId
} = require('../utils/playerMap')

const {
    createRoom,
    quickJoin,
    joinRoom,
    getRoom,
    removePlayer,
    toPublicRoom,
    getPublicWaitingRooms,
    findRoomByPlayer,
    startGame
} = require('../lobby/roomManager')

const {
    addEvent,
    processQueue
} = require('../game/queue')

const {
    createGame,
    getGame
} = require('../game/gameState')

const { getPlayer } = require('../auth/guestHandle');

const RECONNECT_TIMEOUT = 30_000
const reconnectTimers = {}

// Socket event list:
// 'auth' - Authenticate and bind socket to player and room
// 'auth:restore' - Restore session if reconnecting within timeout
// 'lobby:get_rooms' - Get list of waiting rooms
// 'lobby:create' - Create a new room
// 'lobby:quick' - Quick join a waiting room or create if none available
// 'lobby:join' - Join a specific room
// 'lobby:leave' - Leave current room
// 'lobby:start' - Start current room game by host
// 'play_card' - Play a card in the game
// 'draw_card' - Draw a card in the game

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function requirePlayerId(playerId) {
    if (!isNonEmptyString(playerId)) {
        return {
            ok: false,
            error: 'Player ID is required'
        };
    }

    return { ok: true };
}

function requireRoomId(roomId) {
    if (!isNonEmptyString(roomId)) {
        return {
            ok: false,
            error: 'Room ID is required'
        };
    }

    return { ok: true };
}

function isValidCardPayload(card) {
    return card &&
        isNonEmptyString(card.color) &&
        isNonEmptyString(card.value);
}

function emitLobbyRooms(io) {
    io.emit('lobby_rooms', {
        type: 'lobby_rooms',
        rooms: getPublicWaitingRooms()
    });
}

function emitRoomUpdate(io, room) {
    io.to(room.id).emit('room_update', {
        type: 'room_update',
        room: toPublicRoom(room)
    });
}

function replaceOldSocket(io, oldSocketId, newSocketId) {
    if (!oldSocketId || oldSocketId === newSocketId) {
        return;
    }

    const oldSocket = io.sockets.sockets.get(oldSocketId);
    if (!oldSocket) {
        return;
    }

    oldSocket.emit('session:replaced', {
        type: 'session:replaced',
        reason: 'same_player_connected_elsewhere'
    });

    oldSocket.disconnect(true);
}

function emitGameToPlayers(io, game) {
    game.players.forEach(player => {
        const socketId = getSocketId(player.id)
        if (!socketId) return;

        io.to(socketId).emit('game_update', {
            type: 'game_update',
            game: sanitize(game, player.id)
        });
    });
}

function startGameIfReady(io, room) {
    if (!room || room.status !== 'playing') {
        return null;
    }

    let game = getGame(room.id)
    if (!game) {
        game = createGame(room.id, room.players)
    }

    io.to(room.id).emit('game_start', {
        type: 'game_start',
        room: toPublicRoom(room)
    });

    emitGameToPlayers(io, game);
    return game;
}

async function authenticateSocket(socket, playerId, roomId) { // validate player and room existence and bind socket to player
    const player = await getPlayer(playerId);
    if (!player) {
        return { ok: false, error: 'Player not found' };
    }

    const room = getRoom(roomId);
    if (!room) {
        return { ok: false, error: 'Room not found' };
    }

    const isInRoom = room.players.some(p => p.id === playerId);
    if (!isInRoom) {
        return { ok: false, error: 'Player not in room' };
    }

    const oldSocketId = bindPlayerSocket(socket.id, playerId, roomId);
    socket.join(roomId) // join socket room for broadcast

    if (reconnectTimers[playerId]) {
        clearTimeout(reconnectTimers[playerId]);
        delete reconnectTimers[playerId];
    }

    return {
        ok: true,
        player,
        room,
        oldSocketId
    };

}


function setupSocket(io) {
    io.on('connection', socket => {
        console.log(`Socket connected: ${socket.id}`)


        // Client can emit 'auth' to validate their playerId and roomId and bind their socket to their player
        socket.on('auth', async ({ playerId, roomId } = {}, callback) => {
            const playerCheck = requirePlayerId(playerId);
            if (!playerCheck.ok) {
                return callback?.(playerCheck);
            }

            const roomCheck = requireRoomId(roomId);
            if (!roomCheck.ok) {
                return callback?.(roomCheck);
            }

            const result = await authenticateSocket(socket, playerId, roomId)

            if (!result.ok) {
                return callback?.(result);
            }

            replaceOldSocket(io, result.oldSocketId, socket.id);

            const game = getGame(roomId);
            if (game) {
                socket.emit('game_update', {
                    type: 'game_update',
                    game: sanitize(game, playerId)
                });
            }

            callback?.({
                ok: true,
                player: result.player,
                room: toPublicRoom(result.room),
                game: game ? sanitize(game, playerId) : null
            });
        });

        // If client gets disconnected, they can emit 'auth:restore' with the same playerId to restore their session if they reconnect within RECONNECT_TIMEOUT
        socket.on('auth:restore', async ({ playerId } = {}, callback) => {
            const playerCheck = requirePlayerId(playerId);
            if (!playerCheck.ok) {
                return callback?.(playerCheck);
            }

            const player = await getPlayer(playerId);

            if (!player) {
                return callback?.({
                    ok: false,
                    error: 'Player not found'
                });
            }

            const room = findRoomByPlayer(playerId);
            const roomId = room ? room.id : null;

            const oldSocketId = bindPlayerSocket(socket.id, playerId, roomId);
            replaceOldSocket(io, oldSocketId, socket.id);

            if (room) {
                socket.join(room.id);

                if (reconnectTimers[playerId]) {
                    clearTimeout(reconnectTimers[playerId]);
                    delete reconnectTimers[playerId];
                }

                emitRoomUpdate(io, room);
                emitLobbyRooms(io);
            }

            const game = room ? getGame(room.id) : null;
            callback?.({
                ok: true,
                player,
                room: room ? toPublicRoom(room) : null,
                game: game ? sanitize(game, playerId) : null
            });

            if (game) {
                socket.emit('game_update', {
                    type: 'game_update',
                    game: sanitize(game, playerId)
                });
            }
        });

        // Lobby events
        socket.on('lobby:get_rooms', (payload, callback) => {
            const rooms = getPublicWaitingRooms();

            callback?.({
                ok: true,
                rooms
            });

            socket.emit('lobby_rooms', {
                type: 'lobby_rooms',
                rooms
            });
        });

        // Create, join, quick join, leave lobby events. On success, bind socket to player and room, and emit room update and lobby rooms update to all clients
        socket.on('lobby:create', async ({ playerId, name, maxPlayers } = {}, callback) => {
            const playerCheck = requirePlayerId(playerId);
            if (!playerCheck.ok) {
                return callback?.(playerCheck);
            }

            const player = await getPlayer(playerId);
            if (!player) {
                return callback?.({
                    ok: false,
                    error: 'Player not found'
                });
            }

            const result = createRoom(player, { name, maxPlayers });
            if (!result.ok) {
                return callback?.({
                    ok: false,
                    error: result.error,
                    room: result.room ? toPublicRoom(result.room) : null
                });
            }

            const room = result.room;
            const oldSocketId = bindPlayerSocket(socket.id, playerId, room.id);
            replaceOldSocket(io, oldSocketId, socket.id);
            socket.join(room.id);

            callback?.({
                ok: true,
                room: toPublicRoom(room)
            });

            emitRoomUpdate(io, room);
            emitLobbyRooms(io);
        });

        socket.on('lobby:quick', async ({ playerId } = {}, callback) => {
            const playerCheck = requirePlayerId(playerId);
            if (!playerCheck.ok) {
                return callback?.(playerCheck);
            }

            const player = await getPlayer(playerId);
            if (!player) {
                return callback?.({
                    ok: false,
                    error: 'Player not found'
                });
            }

            const result = quickJoin(player);
            if (!result.ok) {
                return callback?.({
                    ok: false,
                    error: result.error,
                    room: result.room ? toPublicRoom(result.room) : null
                });
            }

            const room = result.room;
            const oldSocketId = bindPlayerSocket(socket.id, playerId, room.id);
            replaceOldSocket(io, oldSocketId, socket.id);
            socket.join(room.id);

            callback?.({
                ok: true,
                room: toPublicRoom(room)
            });

            emitRoomUpdate(io, room);
            emitLobbyRooms(io);
            startGameIfReady(io, room);
        });

        socket.on('lobby:join', async ({ playerId, roomId } = {}, callback) => {
            const playerCheck = requirePlayerId(playerId);
            if (!playerCheck.ok) {
                return callback?.(playerCheck);
            }

            const roomCheck = requireRoomId(roomId);
            if (!roomCheck.ok) {
                return callback?.(roomCheck);
            }

            const player = await getPlayer(playerId);
            if (!player) {
                return callback?.({
                    ok: false,
                    error: 'Player not found'
                });
            }

            const result = joinRoom(roomId, player);
            if (!result.ok) {
                return callback?.({
                    ok: false,
                    error: result.error,
                    room: result.room ? toPublicRoom(result.room) : null
                });
            }

            const room = result.room;
            const oldSocketId = bindPlayerSocket(socket.id, playerId, room.id);
            replaceOldSocket(io, oldSocketId, socket.id);
            socket.join(room.id);

            callback?.({
                ok: true,
                room: toPublicRoom(room)
            });

            emitRoomUpdate(io, room);
            emitLobbyRooms(io);
            startGameIfReady(io, room);
        });

        socket.on('lobby:leave', (payload, callback) => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);
            if (!playerId || !roomId) {
                return callback?.({
                    ok: false,
                    error: 'Not in a room'
                });
            }

            const updatedRoom = removePlayer(roomId, playerId);
            socket.leave(roomId);
            unbindSocket(socket.id)

            if (!updatedRoom) {
                callback?.({
                    ok: true,
                    room: null
                });
                emitLobbyRooms(io);
                return;
            }

            callback?.({
                ok: true,
                room: toPublicRoom(updatedRoom)
            });

            emitRoomUpdate(io, updatedRoom);
            emitLobbyRooms(io);
        });

        socket.on('lobby:start', ({ roomId } = {}, callback) => {
            const playerId = getPlayerId(socket.id);
            const currentRoomId = getRoomId(socket.id);

            if (!playerId) {
                return callback?.({
                    ok: false,
                    error: 'Not authenticated'
                });
            }

            if (!roomId) {
                return callback?.({
                    ok: false,
                    error: 'Room ID is required'
                });
            }

            if (currentRoomId !== roomId) {
                return callback?.({
                    ok: false,
                    error: 'You are not in this room'
                });
            }

            const result = startGame(roomId, playerId);

            if (!result.ok) {
                return callback?.({
                    ok: false,
                    error: result.error
                });
            }

            const room = result.room;

            callback?.({
                ok: true,
                room: toPublicRoom(room)
            });

            emitRoomUpdate(io, room);
            emitLobbyRooms(io);
            startGameIfReady(io, room);
        });

        // Game events. On success, add event to game queue and process. Then emit game update to all players in the room
        socket.on('play_card', ({ card, chosenColor } = {}, callback) => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);

            if (!playerId || !roomId) {
                return callback?.({
                    ok: false,
                    error: 'Not in a game'
                });
            }

            if (!isValidCardPayload(card)) {
                return callback?.({
                    ok: false,
                    error: 'Valid card is required'
                });
            }

            addEvent({
                type: 'play_card',
                data: {
                    playerId,
                    roomId,
                    card,
                    chosenColor
                }
            });

            const game = processQueue();
            if (!game) {
                return callback?.({
                    ok: false,
                    error: 'Game not found'
                });
            }

            emitGameToPlayers(io, game);
            callback?.({ ok: true });
        });

        socket.on('draw_card', (payload = {}, callback) => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);

            if (!playerId || !roomId) {
                return callback?.({
                    ok: false,
                    error: 'Not in a game'
                });
            }
            addEvent({
                type: 'draw_card',
                data: {
                    playerId,
                    roomId
                }
            });

            const game = processQueue();
            if (!game) {
                return callback?.({
                    ok: false,
                    error: 'Game not found'
                });
            }
            emitGameToPlayers(io, game);
            callback?.({ ok: true });
        });

        // player drew a playable card and chose to keep it (not play it)
        socket.on('keep_card', (payload = {}, callback) => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);

            if (!playerId || !roomId) {
                return callback?.({
                    ok: false,
                    error: 'Not in a game'
                });
            }
            addEvent({
                type: 'keep_card',
                data: {
                    playerId,
                    roomId
                }
            });

            const game = processQueue();
            if (!game) {
                return callback?.({
                    ok: false,
                    error: 'Game not found'
                });
            }
            emitGameToPlayers(io, game);
            callback?.({ ok: true });
        });

        // Handle client disconnect. Start a timer to wait for possible reconnection within RECONNECT_TIMEOUT. If timer expires, remove player from room and emit updates. If player reconnects with 'auth:restore' before timer expires, clear the timer and restore their session
        socket.on('disconnect', () => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);

            if (!playerId || !roomId) return;

            unbindSocket(socket.id);

            reconnectTimers[playerId] = setTimeout(() => {
                const updatedRoom = removePlayer(roomId, playerId);

                delete reconnectTimers[playerId];

                if (!updatedRoom) {
                    io.to(roomId).emit('room_closed', {
                        type: 'room_closed',
                        reason: 'room_empty'
                    });

                    emitLobbyRooms(io);
                    return;
                }

                io.to(roomId).emit('player_disconnected', {
                    type: 'player_disconnected',
                    playerId,
                    room: toPublicRoom(updatedRoom)
                });

                emitRoomUpdate(io, updatedRoom);
                emitLobbyRooms(io);

                if (updatedRoom.status === 'playing') {
                    io.to(roomId).emit('game_aborted', {
                        type: 'game_aborted',
                        reason: 'player_disconnected',
                        playerId
                    });
                }
            }, RECONNECT_TIMEOUT);
        });
    });
}

// Sanitize game state before sending to clients. Players can only see the count of other players' cards, but can see their own cards
function sanitize(game, currentPlayerId) {
    const sanitized = {
        roomId: game.roomId,
        players: game.players.map(p => ({
            id: p.id,
            name: p.name,
            isGuest: !!p.isGuest
        })),
        hand: {},
        currentTurn: game.currentTurn,
        direction: game.direction,
        currentCard: game.currentCard,
        drawStack: game.drawStack,
        drawnThisTurn: game.currentTurn === currentPlayerId && game.drawnThisTurn ? true : false,
        status: game.status,
        winnerId: game.winnerId || null
    }

    for (const [pid, cards] of Object.entries(game.hand)) {
        sanitized.hand[pid] = pid === currentPlayerId
            ? cards                    // my cards → send full
            : cards.map(() => ({}));   // others' cards → send count only
    }
    return sanitized;
}

module.exports = { setupSocket }
