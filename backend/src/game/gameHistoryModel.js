const mongoose = require('mongoose');

const gameHistorySchema = new mongoose.Schema({
    roomId: { 
        type: String, 
        required: true 
    },
    players: [{
        id: { type: String, required: true },
        name: { type: String, required: true }
    }],
    winnerId: { 
        type: String, 
        required: true 
    },
    winnerName: { 
        type: String, 
        required: true 
    },
    endedAt: { 
        type: Date, 
        default: Date.now 
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('GameHistory', gameHistorySchema);