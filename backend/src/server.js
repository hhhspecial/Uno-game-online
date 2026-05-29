const express = require('express');
const http = require('http');
const path = require('path');
require('dotenv').config();
const { Server } = require('socket.io');
const { connectDB } = require('./configs/db');
const { setupSocket } = require('./socket/socketHandle')
const { createGame } = require('./game/gameState')

const { users } = require('./auth/guestHandle');
const { rooms } = require('./lobby/roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
    }
});


app.use(express.json());

// Serve frontend files
app.use('/frontend', express.static(path.join(__dirname, '../../frontend')));
app.use(express.static(path.join(__dirname, '../../frontend')));

// Mặc định trả về login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/pages/login.html'));
});

const authRouter = require('./auth');
app.use('/auth', authRouter);

const lobbyRouter = require('./lobby');
app.use('/lobby', lobbyRouter);

app.get('/ping', (req, res) => {
    res.json({ status: 'UNO Server is running' });
});

// ===== TEST ENDPOINT: tạo game 4 người để test =====
app.get('/test-game', (req, res) => {
    const roomId = 'test-room-' + Date.now();
    const players = [
        { id: 'player1', name: 'Minh Anh' },
        { id: 'player2', name: 'Hoàng Long' },
        { id: 'player3', name: 'Thu Hà' },
        { id: 'player4', name: 'Đức Huy' },
    ];

    const game = createGame(roomId, players);

    // Lưu players vào users store để auth không bị null
    players.forEach(p => {
        users[p.id] = { ...p, isGuest: true };
    });

    // Lưu room vào rooms store để authenticateSocket tìm được
    rooms[roomId] = {
        id: roomId,
        players,
        maxPlayers: 4,
        status: 'playing',
        createdAt: Date.now()
    };

    console.log('Test game created:', roomId, 'Players:', players.map(p => p.id));

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const links = players.map(p => ({
        name: p.name,
        id: p.id,
        url: `${baseUrl}/frontend/pages/game.html?mock=0&playerId=${p.id}&roomId=${roomId}`
    }));

    // Return HTML page with clickable links
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>UNO Test Game</title>
    <style>
      body { font-family: system-ui; background: #1a1035; color: #f0e6ff; padding: 2rem; }
      h1 { color: #fbbf24; }
      .player { margin: 1rem 0; padding: 1rem; background: rgba(255,255,255,0.08); border-radius: 8px; }
      a { color: #60a5fa; font-size: 1.1rem; }
      code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 0.9rem; }
      .tip { margin-top: 2rem; padding: 1rem; background: rgba(251,191,36,0.1); border-left: 3px solid #fbbf24; border-radius: 4px; }
    </style></head><body>
    <h1>🎮 UNO Test Game</h1>
    <p>Room: <code>${roomId}</code></p>
    <p>Mở mỗi link trong một tab/cửa sổ khác nhau:</p>`;

    links.forEach((l, i) => {
        html += `<div class="player">
            <strong>Player ${i + 1}: ${l.name}</strong> (${l.id})<br>
            <a href="${l.url}" target="_blank">▶ Mở game tab</a>
        </div>`;
    });

    html += `<div class="tip">
        <strong>💡 Cách test:</strong><br>
        1. Mở 4 tab bằng cách click vào các link phía trên<br>
        2. Player 1 (Minh Anh) đánh trước<br>
        3. Đánh bài / bốc bài ở mỗi tab theo lượt<br>
        4. Kiểm tra xem state có sync giữa các tab không
    </div>`;
    html += '</body></html>';

    res.send(html);
});

async function startServer() {
    await connectDB();

    setupSocket(io);

    const PORT = process.env.PORT || 3000;

    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

startServer();
