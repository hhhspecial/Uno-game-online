const express = require('express');
const router = express.Router();
const {createGuestUser, register, login} = require('./guestHandle');

//POST /auth/guest
router.post('/guest', async (req, res) => {
    const guestUser = await createGuestUser();
    res.status(201).json(guestUser);
});

//POST /auth/register
router.post('/register', async (req, res) => {
    const {username, password} = req.body;
    if(!username || !password) {
        return res.status(400).json({error: 'Username and password are required'});
    }
    try {
        const player = await register(username, password);
        res.status(201).json(player);
    } catch (error) {
        res.status(400).json({error: error.message});
    }
});

//POST /auth/login
router.post('/login', async (req, res) => {
    const {username, password} = req.body;
    if(!username || !password) {
        return res.status(400).json({error: 'Username and password are required'});
    }
    try {
        const player = await login(username, password);
        res.status(200).json(player);
    } catch (error) {
        res.status(401).json({error: error.message});
    }
});

module.exports = router;