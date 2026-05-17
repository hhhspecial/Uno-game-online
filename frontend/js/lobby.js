document.addEventListener("DOMContentLoaded", () => {
    const playerId = sessionStorage.getItem('playerId');
    const playerName = sessionStorage.getItem('playerName') || 'Người chơi';
    const isGuest = sessionStorage.getItem('isGuest') === 'true';

    // Protect page: if no playerId, redirect to login
    if (!playerId) {
        window.location.href = 'login.html';
        return;
    }

    // Display player information
    document.getElementById('current-player').textContent = playerName;
    document.getElementById('login-type').textContent = isGuest ? 'Chế độ khách' : 'Thành viên';

    // Handle Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        sessionStorage.clear();
        window.location.href = 'login.html';
    });

    // Handle Create Room (Correct spec /create-room) [cite: 1, 27]
    const createForm = document.getElementById('create-room-form');
    createForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-create-room');
        const roomName = document.getElementById('room-name').value;

        btn.disabled = true;
        btn.textContent = 'Đang khởi tạo...';

        // Save room info to session for game.html to use
        sessionStorage.setItem('currentRoomName', roomName);

        setTimeout(() => {
            // Mock receiving roomId from server [cite: 1, 33]
            const mockRoomId = 'r' + Math.floor(Math.random() * 10000);
            sessionStorage.setItem('roomId', mockRoomId);
            window.location.href = 'game.html';
        }, 800);
    });

    // Mock list of rooms for UI testing
    const container = document.getElementById('rooms-container');
    const mockRooms = [
        { id: 'r1', name: 'Phòng cộng đồng', players: 2 },
        { id: 'r2', name: 'Uno Chiến Thần', players: 1 }
    ];

    container.innerHTML = mockRooms.map(room => `
        <div class="room-card">
            <div class="room-info">
                <div class="room-name">${room.name}</div>
                <div class="room-details"><span>👤 ${room.players}/4</span></div>
            </div>
            <button class="btn-join" onclick="handleJoin('${room.id}', '${room.name}')">Tham gia</button>
        </div>
    `).join('');
});

// Function to join room
function handleJoin(roomId, roomName) {
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('currentRoomName', roomName);
    window.location.href = 'game.html';
}