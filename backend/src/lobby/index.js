const express = require('express');
const router = express.Router();
const { getPlayer } = require('../auth/guestHandle');
const {
    createRoom,
    joinRoom,
    quickJoin,
    getRoom,
    removePlayer,
    allRooms,
    toPublicRoom
} = require('./roomManager');


// POST /create-room
//Body: { playerId }

router.post('/create-room', (req, res) => {
    const { playerId } = req.body;

    if (!playerId) {
        return res.status(400).json({ error: 'Player ID is required' });
    }

    const player = getPlayer(playerId);
    if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }

    const room = createRoom(player);
    res.status(201).json(toPublicRoom(room));
});

// POST /join-room
// Body: { playerId, roomId }

router.post('/join-room', (req, res) => {
    const { roomId, playerId } = req.body;
    if (!playerId || !roomId) {
        return res.status(400).json({ error: 'Player ID and Room ID are required' });
    }
    const player = getPlayer(playerId);
    if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }
    const result = joinRoom(roomId, player);
    if (!result.ok) {
        return res.status(400).json({ error: result.error });
    }
    res.status(200).json(toPublicRoom(result.room));
});

// POST /quick-join
// Tries to join a waiting room, if none available, creates a new one
router.post('/quick', (req, res) => {
    const { playerId } = req.body;
    if (!playerId) {
        return res.status(400).json({ error: 'Player ID is required' });
    }

    const player = getPlayer(playerId);
    if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }

    const result = quickJoin(player);
    if (!result.ok) {
        return res.status(400).json({ error: result.error });
    }

    res.status(200).json(toPublicRoom(result.room));
});
// GET /lobby/rooms
// Returns a list of all rooms are waiting

router.get('/rooms', (req, res) => {
    const rooms = allRooms()
        .filter(room => room.status === 'waiting')
        .map(toPublicRoom);

    res.status(200).json(rooms);
});

// GET /lobby/rooms/:id
// Returns details of a specific room by ID
router.get('/rooms/:id', (req, res) => {
    const room = getRoom(req.params.id);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    res.status(200).json(toPublicRoom(room));
});

// POST /lobby/leave
// Allows a player to leave a room
router.delete('/rooms/:roomId/players/:playerId', (req, res) => {
    const { roomId, playerId } = req.params;

    const room = getRoom(roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    const hasPlayer = room.players.some(p => p.id === playerId);
    if (!hasPlayer) {
        return res.status(404).json({ error: 'Player not in room' });
    }

    const updatedRoom = removePlayer(roomId, playerId);
    if (!updatedRoom) {
        return res.status(200).json({ removed: true, room: null });
    }
    res.status(200).json(toPublicRoom(updatedRoom));
});

module.exports = router;