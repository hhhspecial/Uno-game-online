const map = {}     // socketId → { playerId, roomId }
const reverse = {} // playerId → socketId

function bind(socketId, playerId, roomId) {
    map[socketId] = { playerId, roomId }
    reverse[playerId] = socketId
}

function getPlayerId(socketId) {
    return map[socketId]?.playerId
}

function getRoomId(socketId) {
    return map[socketId]?.roomId
}

function getSocketId(playerId) {
    return reverse[playerId]
}

function unbind(socketId) {
    const entry = map[socketId]
    if (entry) delete reverse[entry.playerId]
    delete map[socketId]
}

module.exports = {
    bind,
    unbind,
    getPlayerId,
    getRoomId,
    getSocketId
}