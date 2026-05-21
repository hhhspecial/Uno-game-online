const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

const users = {};

const createGuestUser = async () => {
    const id = 'guest_' + uuidv4().slice(0, 8); // Generate a unique guest ID
    const guestUsername = `guest_` + Math.floor(Math.random() * 10000 + 100); // Generate a random guest username
    const player = { id: id, name: guestUsername, isGuest: true };
    users[id] = player;
    return player;
};

async function register(username, password) {

    username = username.trim();
    if(username.length < 3) {
        throw new Error('Username must be at least 3 characters long');
    }

    if(password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
    }

    const existingUser = Object.values(users).find(
        u => !u.isGuest && u.name === username
    );
    if (existingUser) throw new Error('Username already exists');

    const id = 'user_' + uuidv4().slice(0, 8);
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id,
        name: username,
        password: hashedPassword,
        isGuest: false
    };

    users[id] = newUser;

    return {
        id: newUser.id,
        name: newUser.name,
        isGuest: false
    };
}


async function login(username, password) {
    const existingUser = Object.values(users).find(u => !u.isGuest && u.name === username);
    if (!existingUser) throw new Error('User not found');

    const passwordMatch = await bcrypt.compare(password, existingUser.password);
    if (!passwordMatch) throw new Error('Invalid password');
    return {
        id: existingUser.id,
        name: existingUser.name,
        isGuest: false
    };

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