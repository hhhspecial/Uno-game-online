const express = require('express');
const router = express.Router();
const { createGuestUser, register, login } = require('./guestHandle');

// Auth REST API:
// POST /auth/guest - Create a new guest user and return their info
// POST /auth/register - Register a new user with username and password
// POST /auth/login - Login with username and password

//POST /auth/guest
router.post('/guest', async (req, res) => {
    const guestUser = await createGuestUser();
    res.status(201).json({
        ok: true,
        player: guestUser
    });
});

//POST /auth/register
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({
            ok: false,
            error: 'Username and password are required'
        });
    }
    try {
        const player = await register(username, password);
        res.status(201).json({
            ok: true,
            player
        });
    } catch (error) {
        res.status(400).json({
            ok: false,
            error: error.message
        });
    }
});

//POST /auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({
            ok: false,
            error: 'Username and password are required'
        });
    }
    try {
        const player = await login(username, password);
        res.status(200).json({
            ok: true,
            player
        });
    } catch (error) {
        res.status(401).json({
            ok: false,
            error: error.message
        });
    }
});

module.exports = router;