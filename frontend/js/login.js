document.addEventListener("DOMContentLoaded", () => {
    // Chuyển thẳng vào sảnh nếu đã đăng nhập
    if (sessionStorage.getItem("playerId") || localStorage.getItem("playerId")) {
        window.location.href = "lobby.html";
        return;
    }

    // Xử lý chuyển tab Đăng nhập / Đăng ký
    const tabButtons = document.querySelectorAll(".tab-nav .tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            tabButtons.forEach((b) => b.classList.remove("active"));
            tabContents.forEach((c) => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`${btn.dataset.target}-form`).classList.add("active");
        });
    });

    function showMessage(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.style.display = "block";
            setTimeout(() => (el.style.display = "none"), 4000);
        }
    }

    // Gọi POST /auth/login
    document.getElementById("login-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const username = document.getElementById("login-username").value.trim();
        const password = document.getElementById("login-password").value;

        fetch("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.ok && data.player) {
                    saveSessionAndEnterLobby(data.player.id, data.player.name, data.player.isGuest);
                } else {
                    showMessage("login-error", data.error || "Đăng nhập thất bại.");
                }
            })
            .catch(() => showMessage("login-error", "Lỗi kết nối server."));
    });

    // Gọi POST /auth/register
    document.getElementById("register-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const username = document.getElementById("reg-username").value.trim();
        const password = document.getElementById("reg-password").value;

        fetch("/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.ok && data.player) {
                    saveSessionAndEnterLobby(data.player.id, data.player.name, data.player.isGuest);
                } else {
                    showMessage("register-error", data.error || "Đăng ký thất bại.");
                }
            })
            .catch(() => showMessage("register-error", "Lỗi kết nối server."));
    });

    // Gọi POST /auth/guest
    const btnGuest = document.getElementById("btn-guest");
    btnGuest.addEventListener("click", () => {
        btnGuest.disabled = true;
        btnGuest.querySelector(".btn-text").style.display = "none";
        btnGuest.querySelector(".btn-loading").style.display = "inline-flex";

        fetch("/auth/guest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.ok && data.player) {
                    saveSessionAndEnterLobby(data.player.id, data.player.name, data.player.isGuest);
                } else {
                    throw new Error(data.error || "Lỗi máy chủ");
                }
            })
            .catch((err) => {
                alert("Không thể tạo tài khoản khách: " + err.message);
                btnGuest.disabled = false;
                btnGuest.querySelector(".btn-text").style.display = "inline";
                btnGuest.querySelector(".btn-loading").style.display = "none";
            });
    });
});

function saveSessionAndEnterLobby(id, name, isGuest) {
    clearStoredSession();

    const storage = isGuest ? sessionStorage : localStorage;
    storage.setItem("playerId", id);
    storage.setItem("playerName", name);
    storage.setItem("isGuest", isGuest ? "true" : "false");
    window.location.href = "/pages/lobby.html";
}

function clearStoredSession() {
    ["playerId", "playerName", "isGuest", "roomId"].forEach((key) => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
    });
}
