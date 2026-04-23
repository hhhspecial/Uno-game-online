const {v4: uuidv4} = require('uuid');
const bcrypt = require('bcrypt');

const users = {};

const createGuestUser = async () => {
    const id = 'guest_' + uuidv4().slice(0, 8); // Generate a unique guest ID
    const guestUsername = `guest_` + Math.floor(Math.random() * 10000 +100); // Generate a random guest username
    const player = {id: id, name: guestUsername, isGuest: true};
    users[id] = player;
    return player;
};

async function register(username, password) {
    const existingUser = Object.values(users).find(u => !u.isGuest && u.username === username);
    if (existingUser) throw new Error('Username already exists');

    const id = 'user_' + uuidv4().slice(0, 8);
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {id: id, username: username, password: hashedPassword, isGuest: false};
    users[id] = newUser;
    return { success: true, userId: id };
}

async function login(username, password) {
    const existingUser = Object.values(users).find(u => !u.isGuest && u.username === username);
    if (!existingUser) throw new Error('User not found');

    const passwordMatch = await bcrypt.compare(password, existingUser.password);
    if (!passwordMatch) throw new Error('Invalid password');
    return { success: true, userId: existingUser.id, username: existingUser.username };
}

function getPlayer(id) {
    return users[id] || null;
}

module.exports = {
    users,
    createGuestUser,
    register,
    login,
    getPlayer
};