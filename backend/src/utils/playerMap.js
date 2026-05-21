const socketToPlayer = {};
const playerToSocket = {};

function bindPlayerSocket(socketId, playerId, roomId = null) {
    const oldSocketId = playerToSocket[playerId];

    if (oldSocketId && oldSocketId !== socketId) {
        delete socketToPlayer[oldSocketId];
    }

    socketToPlayer[socketId] = {
        playerId,
        roomId
    };

    playerToSocket[playerId] = socketId;

    return oldSocketId || null;
}

function updatePlayerRoom(playerId, roomId) {
    const socketId = playerToSocket[playerId];

    if (!socketId || !socketToPlayer[socketId]) {
        return false;
    }

    socketToPlayer[socketId].roomId = roomId;
    return true;
}

function unbindSocket(socketId) {
    const entry = socketToPlayer[socketId];

    if (entry && playerToSocket[entry.playerId] === socketId) {
        delete playerToSocket[entry.playerId];
    }

    delete socketToPlayer[socketId];
}

function getPlayerBySocket(socketId) {
    return socketToPlayer[socketId] || null;
}

function getSocketByPlayer(playerId) {
    return playerToSocket[playerId] || null;
}

function getPlayerId(socketId) {
    return getPlayerBySocket(socketId)?.playerId || null;
}

function getRoomId(socketId) {
    return getPlayerBySocket(socketId)?.roomId || null;
}

function getSocketId(playerId) {
    return getSocketByPlayer(playerId);
}

// Giữ tên cũ để code hiện tại không vỡ
const bind = bindPlayerSocket;
const unbind = unbindSocket;

module.exports = {
    bind,
    unbind,
    getPlayerId,
    getRoomId,
    getSocketId,

    bindPlayerSocket,
    updatePlayerRoom,
    unbindSocket,
    getPlayerBySocket,
    getSocketByPlayer
};