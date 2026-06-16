const { v4: uuidv4 } = require('uuid');
const User = require("../auth/userModel")
const GameHistory = require("../game/gameHistoryModel")

const MAX_PLAYERS = 4;
const rooms = {};
// Room structure: { id: string, players: array of player objects, gameState: object }

// Convert a player object to a public representation
function toPublicPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        isGuest: !!player.isGuest
    };
}

// Convert a Room object to a public representation
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

// Find the room that a player is currently in, or return null if not in any room
function findRoomByPlayer(playerID) {
    return Object.values(rooms).find(room =>
        room.players.some(p => p.id === playerID)
    ) || null;
}

// Create a new room with the given player as the host
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

// Add a player to a room if possible, and return the updated room or an error message
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

// Try to find a waiting room with space and join it, or create a new room if none found
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

// Get a room by its ID, or return null if not found
function getRoom(id) {
    return rooms[id] || null;
}

// Update the status of a room (e.g. 'waiting', 'playing', 'finished')
function setStatus(roomID, status) {
    if (rooms[roomID]) {
        rooms[roomID].status = status;
    }
}

// Remove a player from a room, and delete the room if it becomes empty. If the host leaves, assign a new host.
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

// Start the game in a room if the host initiates it and there are enough players
function startGame(roomID, hostID) {
    const room = rooms[roomID];
    if (!room) {
        return { ok: false, error: 'Room not found' };
    }

    if (room.status !== 'waiting') {
        return { ok: false, error: 'Game already started' };
    }

    if (room.hostId !== hostID) {
        return { ok: false, error: 'Only the host can start the game' };
    }
    if (room.players.length < 2) {
        return { ok: false, error: 'At least 2 players are required to start the game' };
    }

    room.status = 'playing';
    return {
        ok: true,
        room
    };
}

// Get a list of all rooms in the system
function allRooms() {
    return Object.values(rooms);
}

// Get a list of all rooms that are currently waiting for players, in a public representation
function getPublicWaitingRooms() {
    return allRooms()
        .filter(room => room.status === 'waiting')
        .map(toPublicRoom);
}

// Save the result of a finished match to the database, and update players' stats and rewards
async function saveMatchResultAndRewards(roomId, players, winnerId) {
    try {
        const winnerInfo = players.find(p => p.id === winnerId);
        const winnerName = winnerInfo ? winnerInfo.name : "Người thắng";

        await GameHistory.create({
            roomId,
            players: players.map(p => ({ id: p.id, name: p.name })),
            winnerId,
            winnerName
        });

        for (const player of players) {
            const isWinner = player.id === winnerId;

            const xpGained = isWinner ? 50 : 25; 

            const dbUser = await User.findOne({ id: player.id });
            if (dbUser) {
                let newXp = (dbUser.xp || 0) + xpGained;
                let currentLevel = dbUser.level || 1;

                while (newXp >= 100) {
                    currentLevel += 1;
                    newXp -= 100;
                }

                await User.updateOne(
                    { id: player.id },
                    {
                        $inc: {
                            gamesPlayed: 1,
                            gamesWon: isWinner ? 1 : 0
                        },
                        $set: {
                            xp: newXp,
                            level: currentLevel
                        }
                    }
                );
            }
        }
    } catch (error) {
        console.error("Helper saveMatchResultAndRewards failed:", error);
    }
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
    findRoomByPlayer,
    startGame,
    saveMatchResultAndRewards
};