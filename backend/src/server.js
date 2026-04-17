const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
    }
});

app.use(express.json());

const authRouter = require('./auth'); 
app.use('/', authRouter);

app.get('/ping', (req, res) => {
    res.json({status: 'UNO Server is running'});
});

io.on('connection', (socket) => {
    console.log('Client connected: ' + socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected: ' + socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

