const { bind, unbind, getPlayerId, getRoomId } = require('../utils/playerMap')
const { addEvent, processQueue } = require('../game/queue')
const { getGame } = require('../game/gameState')

// ⬇️ Phần này Back2 sẽ bổ sung sau
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

        // Client gửi playerId + roomId ngay sau khi connect
        socket.on('auth', ({ playerId, roomId }) => {
            // TODO: Back2 thêm validate getPlayer(playerId) ở đây
            console.log('AUTH received:', playerId, roomId)
            bind(socket.id, playerId, roomId)
            socket.join(roomId) // join socket room để broadcast
            console.log('Bind OK, rooms:', socket.rooms)

            // Hủy reconnect timer nếu đang chờ
            if (reconnectTimers[playerId]) {
                clearTimeout(reconnectTimers[playerId])
                delete reconnectTimers[playerId]
                console.log(playerId, 'reconnected')
            }
        })

        socket.on('play_card', ({ card, chosenColor }) => {
            const playerId = getPlayerId(socket.id)
            const roomId = getRoomId(socket.id)
            if (!playerId || !roomId) return

            addEvent({ type: 'play_card', data: { playerId, roomId, card, chosenColor } })
            const game = processQueue()

            if (game) {
                io.to(roomId).emit('game_update', { type: 'game_update', game: sanitize(game, playerId) })
            }
        })

        socket.on('draw_card', () => {
            const playerId = getPlayerId(socket.id)
            const roomId = getRoomId(socket.id)
            if (!playerId || !roomId) return

            addEvent({ type: 'draw_card', data: { playerId, roomId } })
            const game = processQueue()

            if (game) {
                io.to(roomId).emit('game_update', { type: 'game_update', game: sanitize(game, playerId) })
            }
        })

        socket.on('disconnect', () => {
            const playerId = getPlayerId(socket.id)
            const roomId = getRoomId(socket.id)
            if (!playerId) return

            unbind(socket.id)

            reconnectTimers[playerId] = setTimeout(() => {
                // TODO: Back2 bổ sung removePlayer(roomId, playerId)
                console.log(playerId, 'timed out, removing from room', roomId)
                delete reconnectTimers[playerId]
            }, RECONNECT_TIMEOUT)
        })
    })
}

// Ẩn bài của người khác trước khi gửi về client
function sanitize(game, currentPlayerId) {
    const sanitized = { ...game, hand: {} }
    for (const [pid, cards] of Object.entries(game.hand)) {
        sanitized.hand[pid] = pid === currentPlayerId
            ? cards                    // bài của mình → gửi đầy đủ
            : cards.map(() => ({}))    // bài người khác → chỉ gửi số lượng
    }
    return sanitized
}

module.exports = { setupSocket }