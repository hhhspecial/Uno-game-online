(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var SOCKET_URL = params.get("server") || "http://localhost:3000";
  var USE_MOCK = params.get("mock") !== "0";

  var socket = null;
  var lastServerState = null;

  function el(id) {
    return document.getElementById(id);
  }

  function cardClass(color) {
    if (color === "wild" || color === "wild_draw_four") return "wild";
    return color;
  }

  function cardFace(card) {
    if (!card) return "?";
    if (card.type === "wild") return "Wild";
    if (card.type === "wild_draw_four") return "+4";
    if (card.value === "skip") return "⊘";
    if (card.value === "reverse") return "⇄";
    if (card.value === "draw_two") return "+2";
    return String(card.value).toUpperCase();
  }

  function mockState() {
    return {
      direction: "clockwise",
      currentColor: "red",
      topCard: { color: "red", value: "7" },
      myHand: [
        { color: "red", value: "3" },
        { color: "blue", value: "skip" },
        { color: "green", value: "9" },
        { color: "yellow", value: "draw_two" },
        { type: "wild" },
        { color: "red", value: "0" },
      ],
      opponents: [
        { seat: 1, label: "P2", count: 5 },
        { seat: 2, label: "P3", count: 4 },
        { seat: 3, label: "P4", count: 7 },
      ],
      currentSeat: 0,
      mySeat: 0,
      mustChooseColor: false,
      unoButtonVisible: false,
    };
  }

  var state = mockState();

  function setSocketStatus(text) {
    var node = el("socket-status");
    if (node) node.textContent = text;
  }

  function setModeBadge() {
    var badge = el("mode-badge");
    if (!badge) return;
    badge.textContent = USE_MOCK ? "UI mẫu (mock)" : "Socket.IO";
    badge.classList.toggle("live", !USE_MOCK);
  }

  function applyServerPayload(payload) {
    lastServerState = payload;
    if (!payload || typeof payload !== "object") return;
    if (payload.game) state = mergeView(state, payload.game);
    else state = mergeView(state, payload);
    render();
  }

  function mergeView(base, incoming) {
    var out = Object.assign({}, base);
    for (var k in incoming) {
      if (Object.prototype.hasOwnProperty.call(incoming, k)) {
        out[k] = incoming[k];
      }
    }
    return out;
  }

  function renderDirection() {
    var node = document.querySelector("#center-table .direction-arrows");
    if (!node) return;
    node.classList.toggle("counterclockwise", state.direction === "counterclockwise");
    node.textContent =
      state.direction === "counterclockwise" ? "Ngược chiều" : "Theo chiều kim đồng hồ";
  }

  function renderGlow() {
    var glow = el("current-color-glow");
    if (!glow) return;
    glow.className = "";
    var c = state.currentColor || "red";
    glow.classList.add("glow-" + c);
  }

  function renderDiscard() {
    var pile = el("discard-pile");
    if (!pile) return;
    pile.innerHTML = "";
    if (!state.topCard) return;
    var underCount = 2;
    for (var i = 0; i < underCount; i++) {
      var under = document.createElement("div");
      under.className = "discard-under";
      under.setAttribute("aria-hidden", "true");
      under.style.setProperty("--u", String(i + 1));
      pile.appendChild(under);
    }
    var div = document.createElement("div");
    div.className =
      "card small on-discard " + cardClass(state.topCard.color || state.topCard.type);
    div.textContent = cardFace(state.topCard);
    pile.appendChild(div);
  }

  function renderOpponents() {
    var zones = document.querySelectorAll("#uno-battlefield .player-zone.opponent");
    zones.forEach(function (zone) {
      var seat = parseInt(zone.getAttribute("data-seat"), 10);
      if (Number.isNaN(seat)) return;
      var opp = null;
      (state.opponents || []).forEach(function (o) {
        if (o.seat === seat) opp = o;
      });
      var countEl = zone.querySelector(".card-count");
      if (countEl && opp) {
        countEl.textContent = "🂠 " + opp.count;
      }
      var label = zone.querySelector(".avatar-fallback");
      if (label && opp && opp.label) {
        label.textContent = opp.label;
      }
      var av = zone.querySelector(".avatar-container");
      if (av) {
        av.classList.toggle("active-turn", state.currentSeat === seat);
      }
    });
  }

  function renderMyZone() {
    var myZone = el("my-zone");
    var hand = el("my-hand");
    var myAv = myZone && myZone.querySelector(".my-footer .avatar-container");
    if (myAv) {
      myAv.classList.toggle("active-turn", state.currentSeat === state.mySeat);
    }
    if (!hand) return;
    hand.innerHTML = "";
    var isMyTurn = state.currentSeat === state.mySeat;
    (state.myHand || []).forEach(function (card, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card " + cardClass(card.color || card.type);
      btn.textContent = cardFace(card);
      btn.style.setProperty("--z", String(10 + index));
      btn.disabled = !isMyTurn;
      btn.addEventListener("click", function () {
        onPlayCard(index, card);
      });
      hand.appendChild(btn);
    });

    var uno = el("btn-call-uno");
    if (uno) {
      uno.classList.toggle("hidden", !state.unoButtonVisible);
    }
  }

  function renderColorModal() {
    var modal = el("color-picker-modal");
    if (!modal) return;
    modal.classList.toggle("hidden", !state.mustChooseColor);
  }

  function render() {
    renderDirection();
    renderGlow();
    renderDiscard();
    renderOpponents();
    renderMyZone();
    renderColorModal();
  }

  function emitOrLog(event, payload) {
    if (socket && socket.connected) {
      socket.emit(event, payload);
    } else {
      console.info("[mock]", event, payload);
    }
  }

  function onPlayCard(index, card) {
    emitOrLog("play_card", { index: index, card: card });
    if (!USE_MOCK) return;
    state.topCard = Object.assign({}, card.color ? { color: card.color, value: card.value } : { type: card.type });
    if (card.type === "wild" || card.type === "wild_draw_four") {
      state.mustChooseColor = true;
    } else {
      state.currentColor = card.color || state.currentColor;
    }
    state.myHand.splice(index, 1);
    state.currentSeat = (state.mySeat + 1) % 4;
    state.unoButtonVisible = state.myHand.length === 1;
    render();
  }

  function onChooseColor(color) {
    emitOrLog("choose_color", { color: color });
    if (!USE_MOCK) return;
    state.currentColor = color;
    state.mustChooseColor = false;
    render();
  }

  function onCallUno() {
    emitOrLog("call_uno", {});
    if (!USE_MOCK) return;
    state.unoButtonVisible = false;
    render();
  }

  function mockNextTurn() {
    state.currentSeat = (state.currentSeat + 1) % 4;
    render();
  }

  function mockDraw() {
    state.myHand.push({ color: "blue", value: String(Math.floor(Math.random() * 10)) });
    render();
  }

  function mockOpenWild() {
    state.mustChooseColor = true;
    render();
  }

  function wireUi() {
    document.querySelectorAll("#color-picker-modal .color-slice").forEach(function (slice) {
      slice.addEventListener("click", function () {
        var color = slice.getAttribute("data-color");
        if (color) onChooseColor(color);
      });
    });
    var unoBtn = el("btn-call-uno");
    if (unoBtn) {
      unoBtn.addEventListener("click", onCallUno);
    }
    el("demo-next-turn") && el("demo-next-turn").addEventListener("click", mockNextTurn);
    el("demo-draw") && el("demo-draw").addEventListener("click", mockDraw);
    el("demo-wild") && el("demo-wild").addEventListener("click", mockOpenWild);
  }

  function initSocket() {
    if (USE_MOCK || typeof io !== "function") {
      if (!USE_MOCK && typeof io !== "function") {
        setSocketStatus("Thiếu thư viện Socket.IO client");
      } else {
        setSocketStatus("Mock — thêm ?mock=0 để kết nối");
      }
      return;
    }
    setSocketStatus("Đang kết nối… " + SOCKET_URL);
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });
    socket.on("connect", function () {
      setSocketStatus("Đã kết nối: " + socket.id);
    });
    socket.on("disconnect", function (reason) {
      setSocketStatus("Ngắt: " + reason);
    });
    socket.on("connect_error", function (err) {
      setSocketStatus("Lỗi: " + (err && err.message ? err.message : "connect_error"));
    });

    var stateEvents = ["game_state", "state", "room:state"];
    stateEvents.forEach(function (ev) {
      socket.on(ev, applyServerPayload);
    });
  }

  function init() {
    setModeBadge();
    wireUi();
    render();
    initSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
