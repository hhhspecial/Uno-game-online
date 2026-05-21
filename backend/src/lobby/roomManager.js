const { v4: uuidv4 } = require('uuid');

const MAX_PLAYERS = 4;
const rooms = {};
// Room structure: { id: string, players: array of player objects, gameState: object }

function toPublicPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        isGuest: !!player.isGuest
    };
}

function toPublicRoom(room) {
    return {
        id: room.id,
        name: room.name,
        hostId: room.hostId,
        players: room.players.map(toPublicPlayer),
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers,
        status: room.status,
        createdAt: room.createdAt
    };
}

function findRoomByPlayer(playerID) {
    return Object.values(rooms).find(room =>
        room.players.some(p => p.id === playerID)
    ) || null;
}

function createRoom(player, option = {}) {
    const id = 'R_' + uuidv4().slice(0, 8).toUpperCase(); // Generate a unique room ID

    const existingRoom = findRoomByPlayer(player.id);
    if (existingRoom) {
        return {
            ok: false,
            error: 'Player is already in a room',
            room: existingRoom
        }
    }

    const maxPlayers = Number(option.maxPlayers) || MAX_PLAYERS;
    if (maxPlayers < 2 || maxPlayers > 4) {
        return {
            ok: false,
            error: 'Max players must be between 2 and 4'
        };
    }

    const room = {
        id,
        name: option.name || `${player.name}'s room`,
        hostId: player.id,
        players: [player],
        maxPlayers: maxPlayers,
        status: 'waiting',
        createdAt: Date.now()
    };
    rooms[id] = room;
    return {
        ok: true,
        room
    };
}

function joinRoom(roomID, player) {
    const room = rooms[roomID];
    if (!room)
        return { ok: false, error: 'Room not found' };

    const existingRoom = findRoomByPlayer(player.id);
    if (existingRoom && existingRoom.id !== roomID) {
        return {
            ok: false,
            error: 'Player is already in another room',
            room: existingRoom
        };
    }

    if (room.players.some(p => p.id === player.id))
        return { ok: false, error: 'Player already in room' };

    if (room.status === 'playing')
        return { ok: false, error: 'Room is already in progress' };

    if (room.players.length >= room.maxPlayers)
        return { ok: false, error: 'Room is full' };

    room.players.push(player);

    // If room is full after adding the player, change status to 'playing'
    if (room.players.length === room.maxPlayers) {
        room.status = 'playing';
    }
    return {
        ok: true,
        room
    };
}

function quickJoin(player) {
    // Try to find a room that is waiting and has space
    const waitingRoom = Object.values(rooms).find(room =>
        room.status === 'waiting' &&
        room.players.length < room.maxPlayers &&
        !room.players.some(p => p.id === player.id)
    );

    if (waitingRoom) {
        return joinRoom(waitingRoom.id, player);
    }

    const result = createRoom(player, {});
    return result;
}

function getRoom(id) {
    return rooms[id] || null;
}

function setStatus(roomID, status) {
    if (rooms[roomID]) {
        rooms[roomID].status = status;
    }
}

function removePlayer(roomID, playerID) {
    const room = rooms[roomID];

    if (!room) return null;

    room.players = room.players.filter(p => p.id !== playerID);
    if (room.players.length === 0) {
        delete rooms[roomID];
        return null;
    }

    if (room.hostId === playerID) {
        room.hostId = room.players[0].id;
    }

    return room;
}

function allRooms() {
    return Object.values(rooms);
}

function getPublicWaitingRooms() {
    return allRooms()
        .filter(room => room.status === 'waiting')
        .map(toPublicRoom);
}

module.exports = {
    rooms,
    MAX_PLAYERS,
    createRoom,
    joinRoom,
    quickJoin,
    getRoom,
    setStatus,
    removePlayer,
    allRooms,
    toPublicRoom,
    toPublicPlayer,
    getPublicWaitingRooms,
    findRoomByPlayer
};