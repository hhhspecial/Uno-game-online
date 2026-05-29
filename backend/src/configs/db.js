const mongoose = require('mongoose');

async function connectDB() {
    const uri =  process.env.MONGODB_URI;
    if(!uri) {
        console.warn("MONGODB_URI is not set. Skipping database connection.");
        return false;
    }
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB");
        return true;
    } catch (error) {
        console.log("Failed to connect to MongoDB:", error);
        return false;
    }
}

module.exports = { connectDB };