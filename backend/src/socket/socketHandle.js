const {
    bind,
    unbind,
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
    getPublicWaitingRooms
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

function authenticateSocket(socket, playerId, roomId) {
    const player = getPlayer(playerId);
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

    bind(socket.id, playerId, roomId)
    socket.join(roomId) // join socket room for broadcast

    if (reconnectTimers[playerId]) {
        clearTimeout(reconnectTimers[playerId]);
        delete reconnectTimers[playerId];
    }

    return { ok: true, player, room };

}

function setupSocket(io) {
    io.on('connection', socket => {
        console.log(`Socket connected: ${socket.id}`)

        socket.on('auth', ({ playerId, roomId }, callback) => {
            const result = authenticateSocket(socket, playerId, roomId)

            if (!result.ok) {
                return callback?.(result);
            }

            const game = getGame(roomId);
            if (game) {
                socket.emit('game_update', {
                    type: 'game_update',
                    game: sanitize(game, playerId)
                });
            }

            callback?.({
                ok: true,
                room: toPublicRoom(result.room),
            });
        });

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

        socket.on('lobby:create', ({ playerId }, callback) => {
            const player = getPlayer(playerId);
            if (!player) {
                return callback?.({ ok: false, error: 'Player not found' });
            }

            const room = createRoom(player);

            bind(socket.id, playerId, room.id);
            socket.join(room.id);

            callback?.({
                ok: true,
                room: toPublicRoom(room)
            });

            emitRoomUpdate(io, room);
            emitLobbyRooms(io);
        });

        socket.on('lobby:quick', ({ playerId }, callback) => {
            const player = getPlayer(playerId);
            if (!player) {
                return callback?.({ ok: false, error: 'Player not found' });
            }

            const result = quickJoin(player);
            if (!result.ok) {
                return callback?.({ ok: false, error: result.error });
            }

            const room = result.room;
            bind(socket.id, playerId, room.id);
            socket.join(room.id);

            callback?.({
                ok: true,
                room: toPublicRoom(room)
            });

            emitRoomUpdate(io, room);
            emitLobbyRooms(io);
            startGameIfReady(io, room);
        });

        socket.on('lobby:join', ({ playerId, roomId }, callback) => {
            const player = getPlayer(playerId);
            if (!player) {
                return callback?.({ ok: false, error: 'Player not found' });
            }

            const result = joinRoom(roomId, player);
            if (!result.ok) {
                return callback?.({ ok: false, error: result.error });
            }

            const room = result.room;
            bind(socket.id, playerId, room.id);
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
                return callback?.({ ok: false, error: 'Not in a room' });
            }

            const updatedRoom = removePlayer(roomId, playerId);
            socket.leave(roomId);
            unbind(socket.id)

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

        socket.on('play_card', ({ card, chosenColor }, callback) => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);

            if (!playerId || !roomId) {
                return callback?.({ ok: false, error: 'Not in a game' });
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
                return callback?.({ ok: false, error: 'Game not found' });
            }

            emitGameToPlayers(io, game);
            callback?.({ ok: true });
        });

        socket.on('draw_card', (payload, callback) => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);

            if (!playerId || !roomId) {
                return callback?.({ ok: false, error: 'Not in a game' });
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
                return callback?.({ ok: false, error: 'Game not found' });
            }
            emitGameToPlayers(io, game);
            callback?.({ ok: true });
        });

        socket.on('disconnect', () => {
            const playerId = getPlayerId(socket.id);
            const roomId = getRoomId(socket.id);

            if (!playerId || !roomId) return;

            unbind(socket.id)

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
        status: game.status
    }

    for (const [pid, cards] of Object.entries(game.hand)) {
        sanitized.hand[pid] = pid === currentPlayerId
            ? cards                    // my cards → send full
            : cards.map(() => ({}));   // others' cards → send count only
    }
    return sanitized;
}

module.exports = { setupSocket }
