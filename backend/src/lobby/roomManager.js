const { v4 : uuidv4 } = require('uuid');

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
        players: room.players.map(toPublicPlayer),
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers,
        status: room.status,
        createdAt: room.createdAt
    };
}

function createRoom(player) {
    const id =  'R_' + uuidv4().slice(0, 8).toUpperCase(); // Generate a unique room ID
    const room = {
        id,
        players: [player],
        maxPlayers: MAX_PLAYERS, 
        status: 'waiting',
        createdAt: Date.now()
    };
    rooms[id] = room;
    return room ;
}

function joinRoom(roomID, player) { 
    const room = rooms[roomID];
    if (!room) 
        return { ok: false, error: 'Room not found' };
    if (room.status === 'playing')
        return { ok: false, error: 'Room is already in progress' };
    if (room.players.length >= room.maxPlayers)
        return { ok: false, error: 'Room is full' };
    if (room.players.some(p => p.id === player.id))
        return { ok: false, error: 'Player already in room' };

    room.players.push(player);
    
    // If room is full after adding the player, change status to 'playing'
    if (room.players.length === room.maxPlayers) {
        room.status = 'playing';
    }
    return { ok: true, room };
}

function quickJoin(player) {
    // Try to find a room that is waiting and has space
    const waitingRoom = Object.values(rooms).find(room => 
        room.status === 'waiting' &&
        room.players.length < room.maxPlayers && 
        !room.players.some(p => p.id === player.id)
    );

    if(waitingRoom) {
        return joinRoom(waitingRoom.id, player);
    }

    const room = createRoom(player);
    return { ok: true, room };
}

function getRoom(id) {
    return rooms[id] || null;
}

function setStatus(roomID, status) {
    if(rooms[roomID]) {
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

    return room;
}

function allRooms() {
    return Object.values(rooms);
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
    toPublicPlayer
};