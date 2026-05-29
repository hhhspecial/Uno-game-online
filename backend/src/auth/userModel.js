const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        index: true
    },
    password: {
        type: String,
        default: null
    },
    isGuest: {
        type: Boolean,
        required: true,
        default: false
    },
    lastLoginAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

userSchema.index(
    { name: 1, isGuest: 1 },
    {
        unique: true,
        partialFilterExpression: { isGuest: false }
    }
);

module.exports = mongoose.model('User', userSchema);