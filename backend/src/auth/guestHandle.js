const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const User = require('./userModel');

const users = {};

// Convert a User document to a public player object
function toPublicAuthPlayer(user) {
    return {
        id: user.id,
        name: user.name,
        isGuest: !!user.isGuest
    };
}

// Create a new guest user with a unique ID and random username
const createGuestUser = async () => {
    const id = 'guest_' + uuidv4().slice(0, 8);
    const guestUsername = `guest_` + Math.floor(Math.random() * 10000 + 100);
    const guest = await User.create({
        id,
        name: guestUsername,
        password: null,
        isGuest: true,
        lastLoginAt: new Date()
    })
    const player = toPublicAuthPlayer(guest);
    users[id] = player;
    return player;
};

// Register a new user with username and password
async function register(username, password) {

    username = username.trim();
    if(username.length < 3) {
        throw new Error('Username must be at least 3 characters long');
    }

    if(password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
    }

    const existingUser = await User.findOne({
        name: username,
        isGuest: false
    }).lean();

    if (existingUser) throw new Error('Username already exists');

    const id = 'user_' + uuidv4().slice(0, 8);
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
        id,
        name: username,
        password: hashedPassword,
        isGuest: false,
        lastLoginAt: new Date()
    });

    const player = toPublicAuthPlayer(newUser);
    users[id] = player;

    return player;
}

// Login with username and password
async function login(username, password) {
    username = username.trim();

    const existingUser = await User.findOne({
        name: username,
        isGuest: false
    }).lean();
    if (!existingUser) throw new Error('User not found');

    const passwordMatch = await bcrypt.compare(password, existingUser.password);
    if (!passwordMatch) throw new Error('Invalid password');
    await User.updateOne(
        { id: existingUser.id },
        { $set: { lastLoginAt: new Date() } }
    );
    const player = toPublicAuthPlayer(existingUser);
    users[existingUser.id] = player;
    return player;

}

// Get player info by ID, using cache for performance
async function getPlayer(id) {
    const cachedPlayer = users[id];
    if (cachedPlayer) return cachedPlayer;

    const user = await User.findOne({ id }).lean();
    if (!user) return null;

    const publicPlayer = toPublicAuthPlayer(user);
    users[id] = publicPlayer;
    
    return publicPlayer;
}

module.exports = {
    users,
    createGuestUser,
    register,
    login,
    getPlayer
};