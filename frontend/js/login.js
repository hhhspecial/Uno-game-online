document.addEventListener("DOMContentLoaded", () => {
    // If session exists, go directly to lobby
    if (sessionStorage.getItem("playerId")) {
        window.location.href = "lobby.html";
    }

    // Handle tab switching for Login / Register
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.target}-form`).classList.add('active');
        });
    });

    // Function to show message
    function showMessage(elementId, message) {
        const el = document.getElementById(elementId);
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => el.style.display = 'none', 3000);
    }

    // Handle Login & Register Forms (Mock - waiting for Backend)
    const forms = ["login-form", "register-form"];
    forms.forEach(formId => {
        document.getElementById(formId).addEventListener("submit", (e) => {
            e.preventDefault();
            const errorId = formId === "login-form" ? "login-error" : "register-error";
            showMessage(errorId, "Chức năng này cần ghép Backend. Hãy dùng 'Chơi tạm thời'.");
        });
    });

    // HANDLE GUEST MODE
    const btnGuest = document.getElementById("btn-guest");
    btnGuest.addEventListener("click", () => {
        btnGuest.disabled = true;
        btnGuest.querySelector(".btn-text").style.display = "none";
        btnGuest.querySelector(".btn-loading").style.display = "inline-flex";

        setTimeout(() => {
            // Per spec: player id [cite: 1, 7, 113]
            const guestId = "p" + Math.floor(Math.random() * 1000); 
            sessionStorage.setItem("playerId", guestId);
            sessionStorage.setItem("playerName", "Khách " + guestId);
            sessionStorage.setItem("isGuest", "true");

            window.location.href = "lobby.html";
        }, 600);
    });
});