const express = require('express');
const router = express.Router();
const { getPlayer } = require('../auth/guestHandle');
const { createRoom, joinRoom, allRooms } = require('./roomManager');

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

    const roomId = createRoom(player);
    res.status(201).json(roomId);
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
    res.status(200).json({ 
        roomId: roomId,
        players: result.room.players.map(p => ({ id: p.id, username: p.username }))
    });
});

// GET /lobby/rooms
// Returns a list of all rooms are waiting

router.get('/rooms', (req, res) => { 
    const rooms = allRooms()
    .filter(room => room.status === 'waiting')
    .map(room => ({
        id: room.id,
        playerCount: room.players.length
    }));
    res.status(200).json(rooms);
});

module.exports = router;