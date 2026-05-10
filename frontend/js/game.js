(function () {
  "use strict";

  /* ========== CONFIG ========== */
  var params = new URLSearchParams(window.location.search);
  var SOCKET_URL = params.get("server") || "http://localhost:3000";
  var USE_MOCK = params.get("mock") !== "0";

  var socket = null;
  var lastServerState = null;
  var motionLock = false;
  var pendingWild = null;

  var DRAW_LAYERS = 5;

  /* Clockwise seat order around the table: bottom(0) → left(3) → top(1) → right(2) */
  var SEAT_ORDER_CW = [0, 3, 1, 2];

  function nextSeat(current, direction) {
    var dir = (direction === -1 || direction === "counterclockwise") ? -1 : 1;
    var idx = SEAT_ORDER_CW.indexOf(current);
    if (idx === -1) idx = 0;
    var next = (idx + dir + SEAT_ORDER_CW.length) % SEAT_ORDER_CW.length;
    return SEAT_ORDER_CW[next];
  }

  function el(id) { return document.getElementById(id); }

  /* ========== SOUND EFFECTS ========== */
  var SFX = {
    play: null, draw: null, uno: null, turn: null,
    _ctx: null,
    init: function () {
      try { this._ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
    },
    _beep: function (freq, dur, vol) {
      if (!this._ctx) return;
      try {
        var o = this._ctx.createOscillator();
        var g = this._ctx.createGain();
        o.connect(g); g.connect(this._ctx.destination);
        o.frequency.value = freq;
        g.gain.value = vol || 0.08;
        o.start(); o.stop(this._ctx.currentTime + (dur || 0.1));
      } catch (e) { }
    },
    playCard: function () { this._beep(660, 0.08, 0.06); },
    drawCard: function () { this._beep(440, 0.06, 0.05); },
    callUno: function () { this._beep(880, 0.15, 0.1); setTimeout(function () { SFX._beep(1100, 0.12, 0.08); }, 160); },
    turnChange: function () { this._beep(520, 0.05, 0.04); }
  };

  /* ========== CARD DATA HELPERS ========== */
  function cardColor(card) {
    if (!card) return "";
    // Wild card already played with chosen color: show that color
    if (card._wildChosen) return card.color || "wild";
    if (card.type === "wild" || card.type === "wild_draw_four") return "wild";
    if (card.color === "wild") return "wild";
    if (card.value === "wild" || card.value === "draw4") return "wild";
    return card.color || "";
  }

  function isWildType(card) {
    if (!card) return false;
    return card.value === "wild" || card.value === "draw4" ||
           card.type === "wild" || card.type === "wild_draw_four" ||
           card.color === "wild";
  }

  function cardFaceText(card) {
    if (!card) return "?";
    if (card.value === "draw4" || card.type === "wild_draw_four") return "+4";
    if (card.value === "wild" || card.type === "wild") return "WILD";
    if (card.value === "skip") return "⊘";
    if (card.value === "reverse") return "⇄";
    if (card.value === "draw_two" || card.value === "draw2") return "+2";
    return String(card.value).toUpperCase();
  }

  function isWildCard(card) {
    return !!(card && (card.type === "wild" || card.type === "wild_draw_four" ||
           card.color === "wild" || card.value === "wild" || card.value === "draw4"));
  }

  /* Match backend isValidMove logic */
  function isValidMove(card, topCard, currentColor) {
    if (!card || !topCard) return false;
    if (isWildCard(card)) return true;
    var cc = currentColor || topCard.color;
    if (card.color === cc) return true;
    var tv = topCard.value || topCard.type;
    if (card.value === tv) return true;
    return false;
  }

  function getPlayableIndices(hand, topCard, currentColor) {
    var indices = [];
    if (!hand || !topCard) return indices;
    for (var i = 0; i < hand.length; i++) {
      if (isValidMove(hand[i], topCard, currentColor)) indices.push(i);
    }
    return indices;
  }

  /* ========== DOM: CREATE CARD ELEMENTS ========== */
  function createCardBack(small) {
    var card = document.createElement("div");
    card.className = "card-back" + (small ? " small" : "");
    var inner = document.createElement("div");
    inner.className = "card-back-inner";
    var oval = document.createElement("div");
    oval.className = "card-back-oval";
    var txt = document.createElement("span");
    txt.className = "card-back-text";
    txt.textContent = "UNO";
    oval.appendChild(txt);
    inner.appendChild(oval);
    card.appendChild(inner);
    return card;
  }

  function createCardFront(card, opts) {
    var color = cardColor(card);
    var face = cardFaceText(card);
    var wild = isWildType(card);
    var div = document.createElement(opts && opts.tag === "button" ? "button" : "div");
    if (opts && opts.tag === "button") div.type = "button";
    div.className = "card-front " + color;
    // If it's a wild card played with chosen color, add wild-colored class
    if (card && card._wildChosen) div.classList.add("wild-colored");

    // Oval
    var oval = document.createElement("div");
    oval.className = "card-oval";
    div.appendChild(oval);

    // Corner top-left
    var ctl = document.createElement("span");
    ctl.className = "card-corner top-left";
    ctl.textContent = face;
    div.appendChild(ctl);

    // Center value
    var val = document.createElement("span");
    val.className = "card-value";
    if (card && card.value === "reverse") val.classList.add("card-value-reverse");
    val.textContent = face;
    div.appendChild(val);

    // Corner bottom-right
    var cbr = document.createElement("span");
    cbr.className = "card-corner bottom-right";
    cbr.textContent = face;
    div.appendChild(cbr);

    return div;
  }

  /* ========== MOCK STATE ========== */
  function mockState() {
    return {
      direction: 1,
      currentColor: "red",
      topCard: { color: "red", value: "7" },
      myHand: [
        { color: "red", value: "3" },
        { color: "blue", value: "skip" },
        { color: "green", value: "reverse" },
        { color: "yellow", value: "draw2" },
        { color: "wild", value: "wild" },
        { color: "wild", value: "draw4" },
        { color: "blue", value: "7" },
      ],
      opponents: [
        { seat: 1, name: "Minh Anh", count: 7 },
        { seat: 2, name: "Hoàng Long", count: 7 },
        { seat: 3, name: "Thu Hà", count: 7 },
      ],
      currentSeat: 0,
      mySeat: 0,
      mustChooseColor: false,
      unoButtonVisible: false,
    };
  }

  var state = mockState();

  /* ========== RENDER: DIRECTION ========== */
  function renderDirection() {
    var icon = document.querySelector(".direction-indicator .dir-icon");
    var text = document.querySelector(".direction-indicator .dir-text");
    if (!icon || !text) return;
    var ccw = state.direction === -1 || state.direction === "counterclockwise";
    icon.textContent = ccw ? "↺" : "↻";
    text.textContent = ccw ? "Ngược chiều" : "Thuận chiều";
  }

  /* ========== RENDER: COLOR GLOW ========== */
  function renderGlow() {
    var glow = el("current-color-glow");
    if (!glow) return;
    glow.className = "";
    var c = state.currentColor || "red";
    glow.classList.add("glow-" + c);
  }

  /* ========== RENDER: DISCARD PILE ========== */
  function renderDiscard() {
    var pile = el("discard-pile");
    if (!pile) return;
    pile.innerHTML = "";
    if (!state.topCard) return;

    for (var i = 0; i < 2; i++) {
      var under = document.createElement("div");
      under.className = "discard-under";
      under.style.setProperty("--u", String(i + 1));
      pile.appendChild(under);
    }

    var top = createCardFront(state.topCard);
    top.classList.add("on-discard");
    pile.appendChild(top);
  }

  /* ========== RENDER: DRAW PILE (ALL FACE-DOWN) ========== */
  function renderDrawPile() {
    var stack = el("draw-pile-stack");
    if (!stack) return;
    stack.innerHTML = "";

    for (var i = 0; i < DRAW_LAYERS; i++) {
      var layer = document.createElement("div");
      layer.className = "draw-pile-layer";

      var rot = -8 + i * (16 / Math.max(DRAW_LAYERS - 1, 1));
      var tx = ((i - (DRAW_LAYERS - 1) / 2) * 1.8).toFixed(1) + "px";
      var ty = -(i * 2.2).toFixed(1) + "px";
      layer.style.transform = "translate(" + tx + ", " + ty + ") rotate(" + rot + "deg)";
      layer.style.zIndex = String(10 + i);

      if (i === DRAW_LAYERS - 1) layer.classList.add("draw-layer-top");

      var back = createCardBack(false);
      layer.appendChild(back);
      stack.appendChild(layer);
    }
  }

  /* ========== RENDER: OPPONENT CARD FAN ========== */
  function renderOpponentFan(zone, count) {
    var container = zone.querySelector(".opponent-cards");
    if (!container) return;
    container.innerHTML = "";

    var seat = zone.getAttribute("data-seat");
    var isLeftRight = seat === "2" || seat === "3";
    var maxSpread = isLeftRight ? 80 : 140;
    var n = Math.max(count, 1);

    for (var i = 0; i < count; i++) {
      var back = createCardBack(true);
      back.style.position = "absolute";

      if (isLeftRight) {
        // Vertical fan
        var totalH = Math.min(n * 12, maxSpread);
        var offsetY = -totalH / 2 + (i / Math.max(n - 1, 1)) * totalH;
        var rotV = -10 + (i / Math.max(n - 1, 1)) * 20;
        back.style.transform = "translateY(" + offsetY + "px) rotate(" + rotV + "deg)";
      } else {
        // Horizontal fan
        var totalW = Math.min(n * 14, maxSpread);
        var offsetX = -totalW / 2 + (i / Math.max(n - 1, 1)) * totalW;
        var rotH = -15 + (i / Math.max(n - 1, 1)) * 30;
        back.style.transform = "translateX(" + offsetX + "px) rotate(" + rotH + "deg)";
      }
      back.style.zIndex = String(i);
      container.appendChild(back);
    }

    // Update container sizing
    if (isLeftRight) {
      container.style.height = Math.min(n * 12, maxSpread) + 60 + "px";
    } else {
      container.style.width = Math.min(n * 14, maxSpread) + 50 + "px";
    }
  }

  /* ========== RENDER: OPPONENTS ========== */
  function renderOpponents() {
    var zones = document.querySelectorAll("#uno-battlefield .player-zone.opponent");
    zones.forEach(function (zone) {
      var seat = parseInt(zone.getAttribute("data-seat"), 10);
      if (isNaN(seat)) return;

      var opp = null;
      (state.opponents || []).forEach(function (o) {
        if (o.seat === seat) opp = o;
      });

      // Avatar + name
      var info = zone.querySelector(".player-info");
      if (info) {
        info.classList.toggle("active-turn", state.currentSeat === seat);
      }

      var nameEl = zone.querySelector(".player-name");
      if (nameEl && opp && opp.name) nameEl.textContent = opp.name;

      var avatarCircle = zone.querySelector(".avatar-circle");
      if (avatarCircle && opp) {
        avatarCircle.textContent = (opp.name || "P").charAt(0).toUpperCase();
      }

      // Card count badge
      var badge = zone.querySelector(".card-count-badge");
      if (badge && opp) badge.textContent = opp.count + " lá";

      // Render fan
      if (opp) renderOpponentFan(zone, opp.count);
    });
  }

  /* ========== RENDER: MY HAND ========== */
  function renderMyZone() {
    var myZone = el("my-zone");
    var hand = el("my-hand");

    // My avatar active state
    var myInfo = myZone && myZone.querySelector(".my-footer .player-info");
    if (myInfo) {
      myInfo.classList.toggle("active-turn", state.currentSeat === state.mySeat);
    }

    if (!hand) return;
    hand.innerHTML = "";

    var isMyTurn = state.currentSeat === state.mySeat;
    var playableIndices = isMyTurn && !state.mustChooseColor
      ? getPlayableIndices(state.myHand, state.topCard, state.currentColor)
      : [];
    var hasPlayable = playableIndices.length > 0;

    // Dynamic overlap: more cards = more overlap
    var cardCount = (state.myHand || []).length;
    var cardW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 70;
    var containerW = hand.parentElement ? hand.parentElement.offsetWidth : window.innerWidth;
    var maxVisibleW = containerW - 20; // padding
    var neededW = cardW * cardCount;
    var overlap = 22; // default overlap px
    if (cardCount > 1 && neededW - (overlap * (cardCount - 1)) > maxVisibleW) {
      overlap = Math.min(cardW - 12, (neededW - maxVisibleW) / (cardCount - 1));
    }

    (state.myHand || []).forEach(function (card, index) {
      var btn = createCardFront(card, { tag: "button" });
      btn.style.setProperty("--z", String(10 + index));
      btn.style.marginLeft = index === 0 ? "0" : (-overlap) + "px";
      btn.setAttribute("tabindex", "0");
      btn.setAttribute("aria-label", cardFaceText(card) + " " + cardColor(card));

      if (isMyTurn && !motionLock && !state.mustChooseColor) {
        var isPlayable = playableIndices.indexOf(index) !== -1;
        if (isPlayable) {
          btn.classList.add("playable");
        } else {
          btn.classList.add("dimmed");
        }
        btn.disabled = !isPlayable;
      } else {
        btn.disabled = true;
        if (!isMyTurn) btn.classList.add("dimmed");
      }

      btn.addEventListener("click", function () {
        onPlayCard(index, card);
      });
      hand.appendChild(btn);
    });

    // UNO button — always visible, lights up when activatable
    var uno = el("btn-call-uno");
    if (uno) {
      uno.classList.remove("hidden");
      uno.classList.toggle("uno-active", !!state.unoButtonVisible);
    }

    // Draw guidance
    renderDrawGuide(isMyTurn, hasPlayable);
  }

  /* ========== RENDER: DRAW GUIDANCE ========== */
  function renderDrawGuide(isMyTurn, hasPlayable) {
    var drawPile = el("draw-pile");
    var guide = el("action-guide");

    if (drawPile) {
      drawPile.classList.toggle("draw-guide", isMyTurn && !hasPlayable && !state.mustChooseColor && !motionLock);
    }

    if (guide) {
      if (isMyTurn && !hasPlayable && !state.mustChooseColor && !motionLock) {
        guide.textContent = "🃏 Không có lá hợp lệ — Nhấn vào chồng bài để bốc!";
        guide.classList.remove("hidden");
      } else if (isMyTurn && hasPlayable && !state.mustChooseColor) {
        guide.textContent = "✨ Chọn lá sáng để đánh!";
        guide.classList.remove("hidden");
      } else if (state.mustChooseColor) {
        guide.textContent = "🎨 Chọn màu cho lá Wild!";
        guide.classList.remove("hidden");
      } else {
        guide.classList.add("hidden");
      }
    }
  }

  /* ========== RENDER: COLOR MODAL ========== */
  function renderColorModal() {
    var modal = el("color-picker-modal");
    if (modal) modal.classList.toggle("hidden", !state.mustChooseColor);
  }

  /* ========== RENDER: ALL ========== */
  function render() {
    renderDirection();
    renderGlow();
    renderDiscard();
    renderDrawPile();
    renderOpponents();
    renderMyZone();
    renderColorModal();
  }

  /* ========== CARD FLIGHT ANIMATION ========== */
  function animateCardFlight(fromRect, toRect, cardEl, opts) {
    var duration = (opts && opts.duration) || 420;
    var onDone = opts && opts.onDone;
    var layer = el("card-motion-layer");

    if (!layer || !fromRect || !toRect) {
      if (onDone) onDone();
      return;
    }

    var clone = cardEl.cloneNode(true);
    clone.classList.add("card-floating");
    clone.style.left = fromRect.left + "px";
    clone.style.top = fromRect.top + "px";
    clone.style.width = fromRect.width + "px";
    clone.style.height = fromRect.height + "px";
    clone.style.position = "fixed";
    clone.style.zIndex = "201";
    clone.style.transition = "transform " + duration + "ms cubic-bezier(0.22,1,0.36,1), box-shadow " + duration + "ms ease";
    layer.appendChild(clone);

    var dx = toRect.left - fromRect.left + (toRect.width - fromRect.width) / 2;
    var dy = toRect.top - fromRect.top + (toRect.height - fromRect.height) / 2;

    clone.getBoundingClientRect();

    var ended = false;
    function cleanup() {
      if (ended) return; ended = true;
      if (clone.parentNode) clone.parentNode.removeChild(clone);
      if (onDone) onDone();
    }

    requestAnimationFrame(function () {
      clone.style.transform = "translate(" + dx + "px," + dy + "px)";
      clone.style.boxShadow = "0 14px 32px rgba(0,0,0,0.5)";
    });

    setTimeout(cleanup, duration + 100);
  }

  function triggerCenterTableNudge() {
    var row = document.querySelector("#center-table .piles-row");
    var disc = el("discard-pile");
    if (row) {
      row.classList.remove("cards-center-nudge");
      void row.offsetWidth;
      row.classList.add("cards-center-nudge");
      setTimeout(function () { row.classList.remove("cards-center-nudge"); }, 450);
    }
    if (disc) {
      disc.classList.remove("pulse-drop");
      void disc.offsetWidth;
      disc.classList.add("pulse-drop");
      setTimeout(function () { disc.classList.remove("pulse-drop"); }, 450);
    }
  }

  /* ========== GAME ACTIONS ========== */
  function emitOrLog(event, payload) {
    if (socket && socket.connected) {
      socket.emit(event, payload);
    } else {
      console.info("[mock]", event, payload);
    }
  }

  function finalizePlayState(index, card) {
    state.topCard = card.color && card.color !== "wild"
      ? { color: card.color, value: card.value }
      : { color: "wild", value: card.value || card.type };
    state.mustChooseColor = false;
    state.currentColor = card.color && card.color !== "wild" ? card.color : state.currentColor;

    // Handle reverse card: toggle direction
    if (card.value === "reverse") {
      state.direction = state.direction === 1 ? -1 : 1;
    }

    state.myHand.splice(index, 1);

    // Skip card: skip next player
    if (card.value === "skip") {
      state.currentSeat = nextSeat(nextSeat(state.mySeat, state.direction), state.direction);
    } else {
      state.currentSeat = nextSeat(state.mySeat, state.direction);
    }

    state.unoButtonVisible = state.myHand.length === 1;
  }

  function getHandCardButton(index) {
    var hand = el("my-hand");
    if (!hand) return null;
    return hand.querySelectorAll(".card-front")[index] || null;
  }

  function onPlayCard(index, card) {
    emitOrLog("play_card", { index: index, card: card });
    if (!USE_MOCK) return;
    if (motionLock) return;

    SFX.playCard();

    if (isWildCard(card)) {
      pendingWild = { index: index, card: card };
      state.mustChooseColor = true;
      render();
      return;
    }

    var btn = getHandCardButton(index);
    var discard = el("discard-pile");
    if (!btn || !discard) {
      finalizePlayState(index, card);
      render();
      return;
    }

    motionLock = true;
    btn.classList.add("is-leaving");

    animateCardFlight(
      btn.getBoundingClientRect(),
      discard.getBoundingClientRect(),
      btn,
      {
        duration: 400,
        onDone: function () {
          finalizePlayState(index, card);
          motionLock = false;
          render();
          triggerCenterTableNudge();
        }
      }
    );
  }

  function onChooseColor(color) {
    emitOrLog("choose_color", { color: color });
    if (!USE_MOCK) return;

    if (pendingWild) {
      var pw = pendingWild;
      pendingWild = null;
      var btn = getHandCardButton(pw.index);
      var discard = el("discard-pile");

      state.mustChooseColor = false;

      var isD4 = pw.card.value === "draw4" || pw.card.type === "wild_draw_four";
      var newTop = isD4
        ? { color: color, value: "draw4", _wildChosen: true }
        : { color: color, value: "wild", _wildChosen: true };

      if (!btn || !discard || motionLock) {
        state.topCard = newTop;
        state.currentColor = color;
        state.myHand.splice(pw.index, 1);
        state.currentSeat = nextSeat(state.mySeat, state.direction);
        state.unoButtonVisible = state.myHand.length === 1;
        render();
        return;
      }

      motionLock = true;
      btn.classList.add("is-leaving");
      SFX.playCard();

      animateCardFlight(
        btn.getBoundingClientRect(),
        discard.getBoundingClientRect(),
        btn,
        {
          duration: 400,
          onDone: function () {
            state.topCard = newTop;
            state.currentColor = color;
            state.myHand.splice(pw.index, 1);
            state.currentSeat = nextSeat(state.mySeat, state.direction);
            state.unoButtonVisible = state.myHand.length === 1;
            motionLock = false;
            render();
            triggerCenterTableNudge();
          }
        }
      );
      return;
    }

    state.currentColor = color;
    state.mustChooseColor = false;
    render();
  }

  function onCallUno() {
    if (!state.unoButtonVisible) return;
    emitOrLog("call_uno", {});
    SFX.callUno();
    if (!USE_MOCK) return;
    state.unoButtonVisible = false;
    render();
  }

  /* ========== DRAW CARD ========== */
  function performDraw() {
    emitOrLog("draw_card", {});
    if (!USE_MOCK) return;
    if (motionLock || state.mustChooseColor) return;

    SFX.drawCard();

    // Random draw for mock
    var colors = ["red", "blue", "green", "yellow"];
    var values = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"];
    var r = Math.random();
    var drawn;
    if (r < 0.08) drawn = { color: "wild", value: "wild" };
    else if (r < 0.14) drawn = { color: "wild", value: "draw4" };
    else drawn = { color: colors[Math.floor(Math.random() * 4)], value: values[Math.floor(Math.random() * values.length)] };

    var topLayer = document.querySelector(".draw-layer-top .card-back");
    var hand = el("my-hand");
    var fromEl = topLayer || el("draw-pile");

    if (!fromEl || !hand) {
      state.myHand.push(drawn);
      render();
      return;
    }

    var fromRect = fromEl.getBoundingClientRect();
    var hb = hand.getBoundingClientRect();
    var targetRect = {
      left: hb.right - 80,
      top: hb.top + 10,
      width: 70,
      height: 105
    };

    motionLock = true;
    var cardEl = createCardBack(false);

    animateCardFlight(fromRect, targetRect, cardEl, {
      duration: 450,
      onDone: function () {
        state.myHand.push(drawn);
        state.currentSeat = nextSeat(state.mySeat, state.direction);
        motionLock = false;
        render();
        var sc = el("my-hand");
        if (sc) sc.scrollLeft = sc.scrollWidth;
      }
    });
  }

  /* ========== MOCK CONTROLS ========== */
  function mockNextTurn() {
    if (motionLock) return;
    SFX.turnChange();
    state.currentSeat = nextSeat(state.currentSeat, state.direction);
    render();
  }

  function mockOpenWild() {
    state.mustChooseColor = true;
    pendingWild = null;
    render();
  }

  /* ========== SOCKET / SERVER ========== */
  function setSocketStatus(text) {
    var node = el("socket-status");
    if (node) node.textContent = text;
  }

  function setModeBadge() {
    var badge = el("mode-badge");
    if (!badge) return;
    badge.textContent = USE_MOCK ? "UI mẫu (mock)" : "Socket.IO";
  }

  function applyServerPayload(payload) {
    lastServerState = payload;
    if (!payload || typeof payload !== "object") return;
    var incoming = payload.game || payload;

    // Map server state to our state format
    if (incoming.currentCard) state.topCard = incoming.currentCard;
    if (incoming.currentTurn !== undefined) {
      // Server uses player IDs, we use seat indices - adapter needed
      state.currentSeat = incoming.currentSeat || 0;
    }
    if (incoming.direction !== undefined) state.direction = incoming.direction;
    if (incoming.hand) {
      // Server sends hand as { playerId: cards[] }
      // Frontend adapter will need to map this
      state.myHand = incoming.myHand || state.myHand;
    }
    if (incoming.currentColor) state.currentColor = incoming.currentColor;
    if (incoming.opponents) state.opponents = incoming.opponents;

    render();
  }

  /* ========== WIRE UI ========== */
  function wireUi() {
    // Color picker
    document.querySelectorAll("#color-picker-modal .color-slice").forEach(function (slice) {
      slice.addEventListener("click", function () {
        var color = slice.getAttribute("data-color");
        if (color) onChooseColor(color);
      });
    });

    // UNO button
    var unoBtn = el("btn-call-uno");
    if (unoBtn) unoBtn.addEventListener("click", onCallUno);

    // Draw pile
    var drawRoot = el("draw-pile");
    if (drawRoot) {
      drawRoot.addEventListener("click", performDraw);
      drawRoot.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); performDraw(); }
      });
    }

    // Demo controls
    var demoNt = el("demo-next-turn");
    if (demoNt) demoNt.addEventListener("click", mockNextTurn);
    var demoDr = el("demo-draw");
    if (demoDr) demoDr.addEventListener("click", performDraw);
    var demoW = el("demo-wild");
    if (demoW) demoW.addEventListener("click", mockOpenWild);
  }

  function initSocket() {
    if (USE_MOCK || typeof io !== "function") {
      setSocketStatus(USE_MOCK ? "Mock — thêm ?mock=0 để kết nối" : "Thiếu Socket.IO");
      return;
    }
    setSocketStatus("Đang kết nối… " + SOCKET_URL);
    socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", function () { setSocketStatus("Đã kết nối: " + socket.id); });
    socket.on("disconnect", function (r) { setSocketStatus("Ngắt: " + r); });
    socket.on("connect_error", function (e) { setSocketStatus("Lỗi: " + (e && e.message || "?")); });

    ["game_state", "state", "room:state", "game_update"].forEach(function (ev) {
      socket.on(ev, applyServerPayload);
    });
  }

  /* ========== DEAL ANIMATION ========== */
  function dealCards(onDone) {
    if (!USE_MOCK) { if (onDone) onDone(); return; }

    // Save real hand and opponent counts
    var realHand = state.myHand.slice();
    var realCounts = state.opponents.map(function (o) { return o.count; });
    var cardsPerPlayer = 7;

    // Start with empty
    state.myHand = [];
    state.opponents.forEach(function (o) { o.count = 0; });
    render();

    var drawPile = el("draw-pile");
    var fromRect = drawPile ? drawPile.getBoundingClientRect() : null;

    var totalPlayers = 1 + state.opponents.length;
    var dealOrder = []; // array of {type, index}
    for (var round = 0; round < cardsPerPlayer; round++) {
      dealOrder.push({ type: "me", round: round });
      for (var oi = 0; oi < state.opponents.length; oi++) {
        dealOrder.push({ type: "opp", oppIdx: oi });
      }
    }

    var dealIdx = 0;
    var dealInterval = 80; // ms between cards

    function dealNext() {
      if (dealIdx >= dealOrder.length) {
        // Dealing done — flip discard from deck
        setTimeout(function () {
          SFX.playCard();
          triggerCenterTableNudge();
          render();
          if (onDone) onDone();
        }, 300);
        return;
      }

      var item = dealOrder[dealIdx];
      dealIdx++;

      SFX.drawCard();

      if (item.type === "me") {
        // Add card to my hand
        var card = realHand[item.round] || realHand[0];
        state.myHand.push(card);

        // Animate card flying to hand
        if (fromRect) {
          var handEl = el("my-hand");
          var hb = handEl ? handEl.getBoundingClientRect() : null;
          if (hb) {
            var targetRect = {
              left: hb.left + hb.width / 2 - 40,
              top: hb.top + 10,
              width: 80, height: 120
            };
            var cardEl = createCardBack(false);
            animateCardFlight(fromRect, targetRect, cardEl, { duration: 250 });
          }
        }
      } else {
        // Increment opponent card count
        var opp = state.opponents[item.oppIdx];
        if (opp && opp.count < realCounts[item.oppIdx]) {
          opp.count++;
        }

        // Animate card flying to opponent zone
        if (fromRect) {
          var seatMap = [null, "opponent-top", "opponent-right", "opponent-left"];
          var seat = opp ? opp.seat : 1;
          var zoneId = seatMap[seat] || "opponent-top";
          var zone = el(zoneId);
          if (zone) {
            var zr = zone.getBoundingClientRect();
            var targetRect = {
              left: zr.left + zr.width / 2 - 20,
              top: zr.top + zr.height / 2 - 30,
              width: 40, height: 60
            };
            var cardEl = createCardBack(true);
            animateCardFlight(fromRect, targetRect, cardEl, { duration: 250 });
          }
        }
      }

      render();
      setTimeout(dealNext, dealInterval);
    }

    // Start dealing after a brief pause
    setTimeout(dealNext, 500);
  }

  /* ========== INIT ========== */
  function init() {
    setModeBadge();
    wireUi();
    // Start with deal animation in mock mode
    dealCards(function () {
      // Deal done — game starts
    });
    initSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
