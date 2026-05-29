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

// Lobby REST API:
// GET    /lobby/rooms - List all waiting rooms
// POST   /lobby/rooms - Create a new room
// POST   /lobby/rooms/quick-join - Quick join a waiting room or create if none available
// GET    /lobby/rooms/:roomId - Get details of a specific room
// POST   /lobby/rooms/:roomId/join - Join a specific room
// DELETE /lobby/rooms/:roomId/players/:playerId - Leave a room


// list rooms
router.get('/rooms', (req, res) => {
    const rooms = allRooms()
        .filter(room => room.status === 'waiting')
        .map(toPublicRoom);

    res.status(200).json({
        ok: true,
        rooms
    });
});

// create room
router.post('/rooms', async (req, res) => {
    const { playerId, name, maxPlayers } = req.body;

    if (!playerId) {
        return res.status(400).json({ 
            ok: false, 
            error: 'Player ID is required' 
        });
    }

    const player = await getPlayer(playerId);
    if (!player) {
        return res.status(404).json({ 
            ok: false, 
            error: 'Player not found' 
        });
    }

    const result = createRoom(player, { name, maxPlayers });
    if (!result.ok) {
        return res.status(400).json({ 
            ok: false, 
            error: result.error,
            room: result.room ? toPublicRoom(result.room) : null
        });
    }

    res.status(201).json({ 
        ok: true, 
        room: toPublicRoom(result.room) 
    });
});

// quick join
router.post('/rooms/quick-join', async (req, res) => {
    const { playerId } = req.body;
    if (!playerId) {
        return res.status(400).json({ 
            ok: false, 
            error: 'Player ID is required' 
        });
    }

    const player = await getPlayer(playerId);
    if (!player) {
        return res.status(404).json({ 
            ok: false, 
            error: 'Player not found' 
        });
    }

    const result = quickJoin(player);
    if (!result.ok) {
        return res.status(400).json({ 
            ok: false, 
            error: result.error 
        });
    }

    res.status(200).json({ 
        ok: true, 
        room: toPublicRoom(result.room) 
    });
});

// get room details
router.get('/rooms/:roomId', (req, res) => {
    const room = getRoom(req.params.roomId);
    if (!room) {
        return res.status(404).json({ 
            ok: false, 
            error: 'Room not found' 
        });
    }
    res.status(200).json({
        ok: true,
        room: toPublicRoom(room)
    });
});

// join room
router.post('/rooms/:roomId/join', async (req, res) => {
    const { roomId } = req.params;
    const { playerId } = req.body;
    if (!playerId || !roomId) {
        return res.status(400).json({ 
            ok: false, 
            error: 'Player ID and Room ID are required' 
        });
    }
    const player = await getPlayer(playerId);
    if (!player) {
        return res.status(404).json({ 
            ok: false, 
            error: 'Player not found' 
        });
    }
    const result = joinRoom(roomId, player);
    if (!result.ok) {
        return res.status(400).json({ 
            ok: false, 
            error: result.error 
        });
    }
    res.status(200).json({ 
        ok: true, 
        room: toPublicRoom(result.room) 
    });
});

// leave room
router.delete('/rooms/:roomId/players/:playerId', (req, res) => {
    const { roomId, playerId } = req.params;

    const room = getRoom(roomId);
    if (!room) {
        return res.status(404).json({ 
            ok: false, 
            error: 'Room not found' 
        });
    }
    const hasPlayer = room.players.some(p => p.id === playerId);
    if (!hasPlayer) {
        return res.status(404).json({ 
            ok: false, 
            error: 'Player not in room' 
        });
    }

    const updatedRoom = removePlayer(roomId, playerId);
    if (!updatedRoom) {
        return res.status(200).json({ 
            ok: true, 
            removed: true, 
            room: null 
        });
    }
    res.status(200).json({ 
        ok: true, 
        room: toPublicRoom(updatedRoom) 
    });
});

module.exports = router;