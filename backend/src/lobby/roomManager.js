const { v4 : uuidv4 } = require('uuid');
const rooms = {};
// Room structure: { id: string, players: array of player objects, gameState: object }

function createRoom(player) {
    const id =  'R_' + uuidv4().slice(0, 8).toUpperCase(); // Generate a unique room ID
    rooms[id] = {
        id,
        players: [player], 
        status: 'waiting'
    };
    return { roomId: id };
}

function joinRoom(roomID, player) { 
    const room = rooms[roomID];
    if (!room) 
        return { ok: false, error: 'Room not found' };
    if (room.status === 'playing')
        return { ok: false, error: 'Room is already in progress' };
    if (room.players.length >= 4)
        return { ok: false, error: 'Room is full (4/4)' };
    if (room.players.find(p => p.id === player.id))
        return { ok: false, error: 'Player already in room' };

    room.players.push(player);
    
    // If room is full after adding the player, change status to 'playing'
    if (room.players.length === 4) {
        room.status = 'playing';
    }
    return { ok: true, room };
}

function getRoom(id) {
    return rooms[id] || null;
}

function setStatus(roomID, status) {
    if(room[id]) {
        room[id].status = status;
    }
}

function removePlayer(roomID, playerID) {
    const room = rooms[roomID];
    if (!room) return;

    room.players = room.players.filter(p => p.id !== playerID);
    if (room.players.length === 0) {
        delete rooms[roomID];
    }
}

function allRooms() {
    return Object.values(rooms);
}

module.exports = {
    rooms,
    createRoom,
    joinRoom,
    getRoom,
    setStatus,
    removePlayer,
    allRooms
};