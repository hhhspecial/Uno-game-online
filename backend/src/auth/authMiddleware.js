const { getPlayer } = require('./guestHandle');

async function authRequired(req, res, next) {
    // Lấy ID từ header hoặc query param
    const playerId = req.headers['x-player-id'] || req.query.playerId;
    
    if (!playerId) {
        return res.status(401).json({ 
            ok: false, 
            error: 'You need to login first.' 
        });
    }

    try {
        const player = await getPlayer(playerId);
        if (!player) {
            return res.status(401).json({ 
                ok: false, 
                error: 'Invalid player ID.' 
            });
        }
        
        req.playerObj = player; 
        next();
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

module.exports = { authRequired };