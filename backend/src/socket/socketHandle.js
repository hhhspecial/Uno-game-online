const { bind, unbind, getPlayerId, getRoomId, getSocketId } = require('../utils/playerMap')
const { addEvent, processQueue } = require('../game/queue')
const { getGame } = require('../game/gameState')

// ⬇️ Back2 will add this part later
// const { getPlayer } = require('../auth/guestHandle')
// const { removePlayer } = require('../lobby/roomManager')

const RECONNECT_TIMEOUT = 30_000
const reconnectTimers = {}

function setupSocket(io) {
    io.on('connection', (socket) => {
        socket.onAny((event, data) => {
            console.log('EVENT:', event)
            console.log(data)
        })
        console.log('Socket connected:', socket.id)
        socket.on('ping_room', () => {

            const playerId = getPlayerId(socket.id)
            const roomId = getRoomId(socket.id)

            console.log('PING ROOM')
            console.log('PLAYER:', playerId)
            console.log('ROOM:', roomId)

            io.to(roomId).emit('pong_room', {
                message: 'hello room'
            })

            console.log('EMITTED')

        })

        // Client sends playerId + roomId right after connecting
        socket.on('auth', ({ playerId, roomId }) => {
            // TODO: Back2 add validate getPlayer(playerId) here
            console.log('AUTH received:', playerId, roomId)
            bind(socket.id, playerId, roomId)
            socket.join(roomId) // join socket room for broadcast
            console.log('Bind OK, rooms:', socket.rooms)

            // Cancel reconnect timer if waiting
            if (reconnectTimers[playerId]) {
                clearTimeout(reconnectTimers[playerId])
                delete reconnectTimers[playerId]
                console.log(playerId, 'reconnected')
            }

            // Send current game state to player on connect/reconnect
            const game = getGame(roomId)
            if (game) {
                socket.emit('game_update', {
                    type: 'game_update',
                    game: sanitize(game, playerId)
                })
            }
        })

        socket.on('play_card', ({ card, chosenColor }) => {
            const playerId = getPlayerId(socket.id)
            const roomId = getRoomId(socket.id)
            if (!playerId || !roomId) return

            addEvent({ type: 'play_card', data: { playerId, roomId, card, chosenColor } })
            const game = processQueue()

            if (game) {
                broadcastGame(io, game)
            }
        })

        socket.on('draw_card', () => {
            const playerId = getPlayerId(socket.id)
            const roomId = getRoomId(socket.id)
            if (!playerId || !roomId) return

            addEvent({ type: 'draw_card', data: { playerId, roomId } })
            const game = processQueue()

            if (game) {
                broadcastGame(io, game)
            }
        })

        socket.on('disconnect', () => {
            const playerId = getPlayerId(socket.id)
            const roomId = getRoomId(socket.id)
            if (!playerId) return

            unbind(socket.id)

            reconnectTimers[playerId] = setTimeout(() => {
                // TODO: Back2 add removePlayer(roomId, playerId)
                console.log(playerId, 'timed out, removing from room', roomId)
                delete reconnectTimers[playerId]
            }, RECONNECT_TIMEOUT)
        })
    })
}

// Send game state individually to each player (each sees their own hand)
function broadcastGame(io, game) {
    game.players.forEach(player => {
        const sid = getSocketId(player.id)
        if (!sid) return
        const s = io.sockets.sockets.get(sid)
        if (!s) return
        s.emit('game_update', {
            type: 'game_update',
            game: sanitize(game, player.id)
        })
    })
}

// Hide other players' cards before sending to client
function sanitize(game, currentPlayerId) {
    const sanitized = { ...game, hand: {} }
    for (const [pid, cards] of Object.entries(game.hand)) {
        sanitized.hand[pid] = pid === currentPlayerId
            ? cards                    // my cards → send full
            : cards.map(() => ({}))    // others' cards → send count only
    }
    return sanitized
}

module.exports = { setupSocket }