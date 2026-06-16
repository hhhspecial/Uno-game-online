const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('./userModel');
const GameHistory = require('../game/gameHistoryModel');
const { authRequired } = require('./authMiddleware');

//USER REST API:   
// 1. GET /users/me - Get current user's account info (including exp, level...)
// 2. PATCH /users/me - Update user info (e.g. change display name)
// 3. PATCH /users/password - Change password (Only for registered accounts)
// 4. GET /users/me/stats - Personal stats + Recent 10 games history
// 5. GET /users/leaderboard - Leaderboard (Exclude guest accounts)


// 1. GET /users/me - Lấy thông tin tài khoản hiện tại (gồm cả exp, level...)
router.get('/me', authRequired, async (req, res) => {
    try {
        const user = await User.findOne({ id: req.playerObj.id }).lean();
        if (!user) {
            return res.status(404).json({ ok: false, error: 'User not found' });
        }
        
        // Loại bỏ trường password trước khi gửi về client bảo mật
        const { password, ...safeUser } = user;
        res.status(200).json({ ok: true, user: safeUser });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 2. PATCH /users/me - Cập nhật thông tin (ví dụ: đổi tên hiển thị)
router.patch('/me', authRequired, async (req, res) => {
    // Nhận thêm trường avatar từ body gửi lên
    const { name, avatar } = req.body; 
    
    const updateData = {};
    if (name) {
        if (name.trim().length < 3) {
            return res.status(400).json({ ok: false, error: 'Tên phải dài tối thiểu 3 ký tự.' });
        }
        updateData.name = name.trim();
    }
    
    if (avatar) {
        // Kiểm tra xem ID avatar gửi lên có nằm trong danh sách định nghĩa sẵn không
        const isValid = VALID_AVATARS.some(av => av.id === avatar);
        if (!isValid) {
            return res.status(400).json({ ok: false, error: 'Mẫu avatar không hợp lệ.' });
        }
        updateData.avatar = avatar;
    }

    try {
        const updatedUser = await User.findOneAndUpdate(
            { id: req.playerObj.id },
            { $set: updateData },
            { new: true }
        ).select('-password').lean();

        res.status(200).json({ ok: true, user: updatedUser });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 3. PATCH /users/password - Thay đổi mật khẩu (Chỉ dành cho TV đã đăng ký)
router.patch('/password', authRequired, async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (req.playerObj.isGuest) {
        return res.status(403).json({ ok: false, error: 'Tài khoản khách không thể đổi mật khẩu.' });
    }

    if (!oldPassword || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu mới phải từ 6 ký tự.' });
    }

    try {
        const user = await User.findOne({ id: req.playerObj.id });
        if (!user) {
            return res.status(404).json({ ok: false, error: 'User không tồn tại.' });
        }

        // Kiểm tra mật khẩu cũ
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ ok: false, error: 'Mật khẩu cũ không đúng!' });
        }

        // Hash mật khẩu mới và lưu
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.status(200).json({ ok: true, message: 'Đổi mật khẩu thành công!' });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 4. GET /users/me/stats - Thống kê cá nhân + Biểu đồ & Lịch sử 10 trận gần nhất
router.get('/me/stats', authRequired, async (req, res) => {
    try {
        const user = await User.findOne({ id: req.playerObj.id }).lean();
        
        // Truy vấn 10 trận đấu gần nhất người này tham gia
        const historyList = await GameHistory.find({
            'players.id': req.playerObj.id
        })
        .sort({ endedAt: -1 })
        .limit(10)
        .lean();

        const gamesPlayed = user.gamesPlayed || 0;
        const gamesWon = user.gamesWon || 0;
        const winRate = gamesPlayed > 0 ? parseFloat(((gamesWon / gamesPlayed) * 100).toFixed(1)) : 0;

        res.status(200).json({
            ok: true,
            stats: {
                level: user.level || 1,
                xp: user.xp || 0,
                gamesPlayed,
                gamesWon,
                gamesLost: gamesPlayed - gamesWon,
                winRate: winRate + '%'
            },
            history: historyList
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 5. GET /users/leaderboard - Bảng xếp hạng (Bỏ qua tài khoản khách)
router.get('/leaderboard', async (req, res) => {
    try {
        // Sắp xếp theo số trận thắng giảm dần, nếu bằng thì tính theo level
        const topPlayers = await User.find({ isGuest: false })
            .sort({ gamesWon: -1, level: -1 })
            .limit(10) // Lấy top 10
            .select('name level gamesPlayed gamesWon')
            .lean();

        res.status(200).json({
            ok: true,
            leaderboard: topPlayers
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;