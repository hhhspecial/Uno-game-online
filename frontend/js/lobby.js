let socket = null;
let currentRoomId = null;
let isHost = false;

document.addEventListener("DOMContentLoaded", () => {
    const playerId = sessionStorage.getItem("playerId");

    if (!playerId) {
        window.location.href = "login.html";
        return;
    }

    showLobbyView();
    initializeLobby(playerId);
});

function showLobbyView() {
    document.getElementById("lobby-container").style.display = "block";
    document.getElementById("waiting-room-container").style.display = "none";
}

function showWaitingRoomView(roomId, maxPlayers, isHostUser, players = []) {
    currentRoomId = roomId;
    isHost = isHostUser;

    document.getElementById("lobby-container").style.display = "none";
    document.getElementById("waiting-room-container").style.display = "block";
    document.getElementById("room-title").textContent = "Phòng ID: " + roomId;
    document.getElementById("room-id-display").textContent = roomId;
    document.getElementById("room-max-players").textContent = maxPlayers;
    
    // Phân quyền hiển thị nút Start Game cho chủ phòng
    document.getElementById("host-actions").style.display = isHost ? "block" : "none";

    updatePlayersGrid(players);
}

function initializeLobby(playerId) {
    const playerName = sessionStorage.getItem("playerName") || "Người chơi";
    const isGuest = sessionStorage.getItem("isGuest") === "true";

    document.getElementById("current-player").textContent = playerName;
    document.getElementById("login-type").textContent = isGuest ? "Chế độ khách" : "Thành viên";

    // Đăng xuất
    document.getElementById("btn-logout").addEventListener("click", () => {
        sessionStorage.clear();
        if (socket) socket.disconnect();
        window.location.href = "login.html";
    });

    // Kết nối Socket
    connectSocket(playerId);

    //Tạo phòng thông qua Socket thay vì Fetch để tự động bind SocketID
    document.getElementById("create-room-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const btn = document.getElementById("btn-create-room");
        const maxPlayers = parseInt(document.getElementById("max-players").value);
        const name = document.getElementById("room-name").value.trim();

        btn.disabled = true;
        btn.textContent = "Đang tạo...";

        socket.emit("lobby:create", { playerId, name, maxPlayers }, (response) => {
            btn.disabled = false;
            btn.textContent = "Tạo phòng & Vào bàn chơi";
            
            if (response.ok) {
                const room = response.room;
                sessionStorage.setItem("roomId", room.id);
                showWaitingRoomView(room.id, room.maxPlayers, true, room.players);
            } else {
                alert("Lỗi tạo phòng: " + response.error);
            }
        });
    });

    // Vào phòng nhanh thông qua Event "lobby:quick"
    document.getElementById("btn-quick-join").addEventListener("click", function() {
        this.disabled = true;
        this.querySelector(".btn-text").style.display = "none";
        this.querySelector(".btn-loading").style.display = "inline-flex";

        socket.emit("lobby:quick", { playerId }, (response) => {
            if (response.ok) {
                const room = response.room;
                sessionStorage.setItem("roomId", room.id);
                // Người tạo phòng mới sẽ là Host, nếu chui vào phòng có sẵn thì ko phải Host
                const isHostUser = room.players.length > 0 && room.players[0].id === playerId;
                showWaitingRoomView(room.id, room.maxPlayers, isHostUser, room.players);
            } else {
                alert("Lỗi vào phòng nhanh: " + response.error);
                resetQuickJoinButton();
            }
        });
    });

    // Nút rời phòng
    document.getElementById("btn-leave-room").onclick = () => {
        socket.emit("lobby:leave", {}, (response) => {
            if (response.ok) {
                currentRoomId = null;
                isHost = false;
                sessionStorage.removeItem("roomId");
                showLobbyView();
            } else {
                alert("Lỗi rời phòng: " + response.error);
            }
        });
    };
    document.getElementById("btn-back-lobby").onclick = document.getElementById("btn-leave-room").onclick;

    // Lấy danh sách phòng lần đầu bằng API
    loadRoomsList();
}

// API Get list rooms
function loadRoomsList() {
    fetch("/lobby/rooms")
        .then((res) => res.json())
        .then((data) => {
            if (data.ok) renderRooms(data.rooms);
        })
        .catch(console.error);
}

function renderRooms(rooms) {
    const container = document.getElementById("rooms-container");
    if (!rooms || rooms.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#8892a4;grid-column: 1/-1;">Không có phòng nào đang chờ. Hãy tạo phòng mới!</p>';
        return;
    }

    container.innerHTML = rooms.map((room) => {
        const isFull = room.playerCount >= room.maxPlayers;
        return `
        <div class="room-card">
            <div class="room-info">
                <div class="room-name">${room.name}</div>
                <div class="room-details">
                    <span>👤 ${room.playerCount}/${room.maxPlayers} Người</span>
                    <span class="room-status-badge" style="background-color: ${room.status === 'waiting' ? '#0066CC' : '#E8192C'}">
                        ${room.status === "waiting" ? "Đang chờ" : "Đang chơi"}
                    </span>
                </div>
            </div>
            <button class="btn-join" ${isFull ? "disabled" : ""} 
                onclick="handleJoinRoom('${room.id}')">
                ${isFull ? "Đầy Chỗ" : "Tham gia"}
            </button>
        </div>`;
    }).join("");
}

// Join phòng thủ công qua Socket Event
function handleJoinRoom(roomId) {
    const playerId = sessionStorage.getItem("playerId");
    socket.emit("lobby:join", { playerId, roomId }, (response) => {
        if (response.ok) {
            sessionStorage.setItem("roomId", roomId);
            showWaitingRoomView(roomId, response.room.maxPlayers, false, response.room.players);
        } else {
            alert("Không thể vào bàn: " + response.error);
        }
    });
}

function updatePlayersGrid(players) {
    const grid = document.getElementById("players-grid");
    const currentPlayerId = sessionStorage.getItem("playerId");

    document.getElementById("current-count").textContent = players.length;

    grid.innerHTML = players.map((player, index) => {
        const isPlayerHost = index === 0; 
        return `
        <div class="player-card">
            <div class="player-avatar" style="background-color: ${isPlayerHost ? 'var(--red)' : 'var(--blue)'}">
                ${player.name.charAt(0).toUpperCase()}
            </div>
            <div class="player-name">${player.name}</div>
            <div class="player-badge">
                ${player.id === currentPlayerId ? "<b>(Bạn)</b>" : player.isGuest ? "Khách" : "TV"}
                ${isPlayerHost ? " <span style='color:var(--yellow)'>👑 Host</span>" : ""}
            </div>
        </div>`;
    }).join("");
}

function resetQuickJoinButton() {
    const btn = document.getElementById("btn-quick-join");
    btn.disabled = false;
    btn.querySelector(".btn-text").style.display = "inline";
    btn.querySelector(".btn-loading").style.display = "none";
}

// ============================================================
// KẾT NỐI SOCKET VÀ XỬ LÝ LẮNG NGHE SỰ KIỆN TỪ BACKEND
// ============================================================
function connectSocket(playerId) {
    if (socket && socket.connected) return;

    socket = io(window.location.origin);

    socket.on("connect", () => {
        console.log("Socket connected:", socket.id);
        
        // Cố gắng khôi phục session nếu người dùng F5 hoặc mất mạng
        socket.emit("auth:restore", { playerId }, (response) => {
            if (response.ok && response.room) {
                // Đang ở trong phòng thì khôi phục lại view phòng chờ
                sessionStorage.setItem("roomId", response.room.id);
                const isHostUser = response.room.players.length > 0 && response.room.players[0].id === playerId;
                showWaitingRoomView(response.room.id, response.room.maxPlayers, isHostUser, response.room.players);
            }
        });
    });

    // Cập nhật danh sách tất cả các phòng sảnh ngoài realtime
    socket.on("lobby_rooms", (data) => {
        if (data.rooms) renderRooms(data.rooms);
    });

    // Cập nhật chi tiết phòng chờ mình đang đứng realtime (khi có người vào/ra)
    socket.on("room_update", (data) => {
        if (data.room && data.room.id === currentRoomId) {
            updatePlayersGrid(data.room.players);
            resetQuickJoinButton();
        }
    });

    // Host bấm bắt đầu -> server gửi event -> Chuyển sang game.html
    socket.on("game_start", (data) => {
        window.location.href = "game.html";
    });

    // Xử lý khi phòng bị hủy do Host/người cuối cùng rời đi
    socket.on("room_closed", (data) => {
        alert("Phòng đã bị đóng!");
        currentRoomId = null;
        isHost = false;
        sessionStorage.removeItem("roomId");
        showLobbyView();
    });
}