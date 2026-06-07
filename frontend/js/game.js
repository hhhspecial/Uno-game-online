(function () {
  "use strict";

  /* ========== CONFIG ========== */
  var params = new URLSearchParams(window.location.search);
  var SOCKET_URL = params.get("server") || window.location.origin;
  var USE_MOCK = params.get("mock") !== "0";
  var MY_PLAYER_ID = params.get("playerId") || "";
  var MY_ROOM_ID = params.get("roomId") || "";

  var socket = null;
  var lastServerState = null;
  var motionLock = false;
  var pendingWild = null;

  var DRAW_LAYERS = 5;

  // Track which players are in UNO state (have exactly 1 card)
  var unoPlayers = {}; // { playerId: true }

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
    turnChange: function () { this._beep(520, 0.05, 0.04); },
    winSound: function () {
      // Victory fanfare
      var delays = [0, 150, 300, 450, 600];
      var freqs  = [523, 659, 784, 1047, 1319];
      for (var i = 0; i < delays.length; i++) {
        (function(f, d) {
          setTimeout(function() { SFX._beep(f, 0.2, 0.1); }, d);
        })(freqs[i], delays[i]);
      }
    }
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

  function getPlayableIndices(hand, topCard, currentColor, drawStack) {
    var indices = [];
    if (!hand || !topCard) return indices;
    for (var i = 0; i < hand.length; i++) {
      var card = hand[i];
      // When drawStack is active, only +2 or +4 can be played
      if (drawStack && drawStack > 0) {
        var topIsD4 = topCard.value === "draw4";
        if (card.value === "draw4") {
          indices.push(i); // +4 can always stack
        } else if (card.value === "draw2" && !topIsD4) {
          // +2 can stack on +2 but NOT on +4
          if (isValidMove(card, topCard, currentColor)) indices.push(i);
        }
      } else {
        if (isValidMove(card, topCard, currentColor)) indices.push(i);
      }
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
      drawStack: 0,
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
        { seat: 1, name: "Minh Anh", count: 7, playerId: "opp1" },
        { seat: 2, name: "Hoàng Long", count: 7, playerId: "opp2" },
        { seat: 3, name: "Thu Hà", count: 7, playerId: "opp3" },
      ],
      currentSeat: 0,
      mySeat: 0,
      mustChooseColor: false,
    };
  }

  var state = USE_MOCK ? mockState() : {
    direction: 1,
    currentColor: "red",
    topCard: null,
    drawStack: 0,
    myHand: [],
    opponents: [],
    currentSeat: -1,
    mySeat: 0,
    mustChooseColor: false,
    drawnThisTurn: false,
  };

  /* ========== UNO CALLOUT ANIMATION ========== */
  function showUnoCallout(playerName, targetSeat) {
    SFX.callUno();
    var overlay = el("uno-callout-overlay");
    if (!overlay) return;

    // Reset and show the UNO callout
    overlay.classList.remove("hidden");
    var textEl = overlay.querySelector(".uno-callout-text");
    if (textEl) {
      // Force re-trigger animation
      textEl.style.animation = "none";
      void textEl.offsetWidth;
      textEl.style.animation = "";
    }

    // Hide after animation completes
    setTimeout(function () {
      overlay.classList.add("hidden");
    }, 1700);
  }

  /* ========== UNO BADGE ON AVATAR ========== */
  function updateUnoBadges() {
    // Update my zone
    var myInfo = document.querySelector("#my-zone .my-footer .player-info");
    if (myInfo) {
      var myWrap = myInfo.querySelector(".avatar-wrap");
      var existingBadge = myWrap ? myWrap.querySelector(".uno-badge") : null;

      if (state.myHand && state.myHand.length === 1) {
        myInfo.classList.add("uno-state");
        if (myWrap && !existingBadge) {
          var badge = document.createElement("div");
          badge.className = "uno-badge";
          badge.textContent = "UNO";
          myWrap.appendChild(badge);
        }
      } else {
        myInfo.classList.remove("uno-state");
        if (existingBadge) existingBadge.remove();
      }
    }

    // Update opponent zones
    var zones = document.querySelectorAll("#uno-battlefield .player-zone.opponent");
    zones.forEach(function (zone) {
      var seat = parseInt(zone.getAttribute("data-seat"), 10);
      var info = zone.querySelector(".player-info");
      var wrap = zone.querySelector(".avatar-wrap");
      if (!info || !wrap) return;

      var opp = null;
      (state.opponents || []).forEach(function (o) {
        if (o.seat === seat) opp = o;
      });

      var existingBadge = wrap.querySelector(".uno-badge");

      if (opp && opp.count === 1) {
        info.classList.add("uno-state");
        if (!existingBadge) {
          var badge = document.createElement("div");
          badge.className = "uno-badge";
          badge.textContent = "UNO";
          wrap.appendChild(badge);
        }
      } else {
        info.classList.remove("uno-state");
        if (existingBadge) existingBadge.remove();
      }
    });
  }

  /* ========== WINNER CELEBRATION ========== */
  function showWinnerModal(winnerName) {
    SFX.winSound();

    var modal = el("winner-modal");
    var nameEl = el("winner-name");
    var countdownEl = el("winner-countdown-num");
    var particles = el("winner-particles");

    if (!modal) return;
    if (nameEl) nameEl.textContent = winnerName;

    // Spawn confetti particles
    if (particles) {
      particles.innerHTML = "";
      var colors = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ec4899", "#f97316", "#06b6d4"];
      for (var i = 0; i < 60; i++) {
        var piece = document.createElement("div");
        piece.className = "confetti-piece";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = (2 + Math.random() * 3) + "s";
        piece.style.animationDelay = (Math.random() * 2) + "s";
        piece.style.width = (6 + Math.random() * 8) + "px";
        piece.style.height = (6 + Math.random() * 8) + "px";
        piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
        particles.appendChild(piece);
      }
    }

    modal.classList.remove("hidden");

    // Countdown to redirect
    var secondsLeft = 8;
    if (countdownEl) countdownEl.textContent = String(secondsLeft);

    var countdownInterval = setInterval(function () {
      secondsLeft--;
      if (countdownEl) countdownEl.textContent = String(secondsLeft);
      if (secondsLeft <= 0) {
        clearInterval(countdownInterval);
        // Navigate all players back to lobby
        window.location.href = "/pages/lobby.html";
      }
    }, 1000);
  }

  // game aborted
  function showGameAbortedModal(data) {
    // Don't show if winner modal is already up
    var winnerModal = el("winner-modal");
    if (winnerModal && !winnerModal.classList.contains("hidden")) return;

    var modal = el("aborted-modal");
    if (!modal) {
      // Create the modal dynamically if not in HTML
      modal = document.createElement("div");
      modal.id = "aborted-modal";
      modal.setAttribute("aria-label", "Trận đấu bị hủy");
      modal.innerHTML =
        '<div class="aborted-backdrop"></div>' +
        '<div class="aborted-content">' +
          '<div class="aborted-icon">⚠️</div>' +
          '<h2 class="aborted-title">Trận đấu đã bị hủy</h2>' +
          '<p class="aborted-reason">Một người chơi đã mất kết nối quá lâu.</p>' +
          '<div class="aborted-countdown">Quay về sảnh trong <span id="aborted-countdown-num">5</span>s...</div>' +
        '</div>';
      document.body.appendChild(modal);
    }
    modal.classList.remove("hidden");

    var countdownEl = document.getElementById("aborted-countdown-num");
    var secondsLeft = 5;
    if (countdownEl) countdownEl.textContent = String(secondsLeft);

    var countdownInterval = setInterval(function () {
      secondsLeft--;
      if (countdownEl) countdownEl.textContent = String(secondsLeft);
      if (secondsLeft <= 0) {
        clearInterval(countdownInterval);
        window.location.href = "/pages/lobby.html";
      }
    }, 1000);
  }

  // render direction
  function renderDirection() {
    var icon = document.querySelector(".direction-indicator .dir-icon");
    var text = document.querySelector(".direction-indicator .dir-text");
    if (!icon || !text) return;
    var ccw = state.direction === -1 || state.direction === "counterclockwise";
    icon.textContent = ccw ? "↺" : "↻";
    text.textContent = ccw ? "Ngược chiều" : "Thuận chiều";
  }

  // render color glow
  function renderGlow() {
    var glow = el("current-color-glow");
    if (!glow) return;
    glow.className = "";
    var c = state.currentColor || "red";
    glow.classList.add("glow-" + c);
  }

  // render discard pile
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

    // Stack badge: show +N when drawStack is active
    if (state.drawStack > 0) {
      var badge = document.createElement("div");
      badge.className = "draw-stack-badge";
      badge.textContent = "+" + state.drawStack;
      pile.appendChild(badge);
    }
  }

  // render draw pile
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

  // render opponent card fan
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

  // render opponents
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

  // render my hand
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
    var inDrawChoice = isMyTurn && state.drawnThisTurn;
    var playableIndices = isMyTurn && !state.mustChooseColor && !inDrawChoice
      ? getPlayableIndices(state.myHand, state.topCard, state.currentColor, state.drawStack)
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

      if (inDrawChoice) {
        // During draw choice, all cards are dimmed and disabled
        // The drawn card (last one) gets a subtle highlight
        var isLast = index === cardCount - 1;
        btn.disabled = true;
        if (isLast) {
          btn.classList.add("drawn-highlight");
        } else {
          btn.classList.add("dimmed");
        }
      } else if (isMyTurn && !motionLock && !state.mustChooseColor) {
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

    // Draw guidance
    renderDrawGuide(isMyTurn && !inDrawChoice, hasPlayable);
  }

  // render draw guidance
  function renderDrawGuide(isMyTurn, hasPlayable) {
    var drawPile = el("draw-pile");
    var guide = el("action-guide");
    var mustDraw = isMyTurn && state.drawStack > 0 && !hasPlayable;
    var canStackOrDraw = isMyTurn && state.drawStack > 0 && hasPlayable;

    if (drawPile) {
      drawPile.classList.toggle("draw-guide", isMyTurn && (!hasPlayable || mustDraw) && !state.mustChooseColor && !motionLock);
    }

    if (guide) {
      if (mustDraw && !state.mustChooseColor && !motionLock) {
        guide.textContent = "⚠️ Phải bốc +" + state.drawStack + " lá! Nhấn chồng bài để bốc.";
        guide.classList.remove("hidden");
      } else if (canStackOrDraw && !state.mustChooseColor) {
        guide.textContent = "🔥 Có thể chồng +2/+4 hoặc bốc +" + state.drawStack + " lá!";
        guide.classList.remove("hidden");
      } else if (isMyTurn && !hasPlayable && !state.mustChooseColor && !motionLock) {
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

  // render color modal
  function renderColorModal() {
    var modal = el("color-picker-modal");
    if (modal) modal.classList.toggle("hidden", !state.mustChooseColor);
  }

  // render draw choice
  function renderDrawChoice() {
    var modal = el("draw-choice-modal");
    if (!modal) return;
    var isMyTurn = state.currentSeat === state.mySeat;
    var show = isMyTurn && state.drawnThisTurn && !state.mustChooseColor;
    modal.classList.toggle("hidden", !show);

    // Also disable draw pile during draw choice
    var drawPile = el("draw-pile");
    if (drawPile) {
      drawPile.classList.toggle("draw-disabled", show);
    }
  }

  // render all
  function render() {
    renderDirection();
    renderGlow();
    renderDiscard();
    renderDrawPile();
    renderOpponents();
    renderMyZone();
    renderColorModal();
    renderDrawChoice();
    updateUnoBadges();
  }

  // card flight animation
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

  // game actions
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

    // Auto-call UNO when I have 1 card left
    if (state.myHand.length === 1) {
      showUnoCallout("Bạn", 0);
    }
  }

  function getHandCardButton(index) {
    var hand = el("my-hand");
    if (!hand) return null;
    return hand.querySelectorAll(".card-front")[index] || null;
  }

  function onPlayCard(index, card) {
    if (!USE_MOCK) {
      // In live mode, for wild cards we wait for color choice first
      if (isWildCard(card)) {
        pendingWild = { index: index, card: card };
        state.mustChooseColor = true;
        render();
        return;
      }
      // Non-wild: emit immediately, let backend handle state
      emitOrLog("play_card", { card: { color: card.color, value: card.value } });
      // Animate locally while waiting for server
      SFX.playCard();
      var btn = getHandCardButton(index);
      var discard = el("discard-pile");
      if (btn && discard) {
        btn.classList.add("is-leaving");
        animateCardFlight(btn.getBoundingClientRect(), discard.getBoundingClientRect(), btn, { duration: 400 });
      }
      return;
    }
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
    if (!USE_MOCK && pendingWild) {
      // Live mode: emit play_card with chosenColor, let server handle
      var pw = pendingWild;
      pendingWild = null;
      state.mustChooseColor = false;
      emitOrLog("play_card", {
        card: { color: pw.card.color, value: pw.card.value },
        chosenColor: color
      });
      // Animate locally while waiting
      SFX.playCard();
      var btn = getHandCardButton(pw.index);
      var discard = el("discard-pile");
      if (btn && discard) {
        btn.classList.add("is-leaving");
        animateCardFlight(btn.getBoundingClientRect(), discard.getBoundingClientRect(), btn, { duration: 400 });
      }
      render();
      return;
    }

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
        // Auto-call UNO
        if (state.myHand.length === 1) {
          showUnoCallout("Bạn", 0);
        }
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
            // Auto-call UNO
            if (state.myHand.length === 1) {
              showUnoCallout("Bạn", 0);
            }
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

  function onCancelColorChoice() {
    if (!state.mustChooseColor || !pendingWild) return;
    // Cancel the pending play
    pendingWild = null;
    state.mustChooseColor = false;
    render();
  }

  // draw card
  function performDraw() {
    // Block drawing if in draw choice state
    if (state.drawnThisTurn) return;
    emitOrLog("draw_card", {});
    if (!USE_MOCK) {
      SFX.drawCard();
      return;
    }
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

  // socket / server
  function setSocketStatus(text) {
    console.log("[socket]", text);
  }

  function setModeBadge() {
    // No-op: debug HUD removed
  }

  // receive server state
  function applyServerPayload(payload) {
    lastServerState = payload;
    if (!payload || typeof payload !== "object") return;
    var incoming = payload.game || payload;
    if (!incoming) return;

    console.log("[server] game_update received:", incoming);

    // --- Check for winner FIRST ---
    if (incoming.status === "finished" && incoming.winnerId) {
      // Find the winner's name
      var winnerName = incoming.winnerId;
      if (incoming.players) {
        incoming.players.forEach(function (p) {
          if (p.id === incoming.winnerId) {
            winnerName = p.name || p.id;
          }
        });
      }

      // Still apply state so UI updates (hand empty, etc.)
      applyStateFields(incoming);
      render();

      // Show winner modal after a short delay for the final card animation
      setTimeout(function () {
        showWinnerModal(winnerName);
      }, 800);
      return;
    }

    // Track previous hand size for draw animation and UNO detection
    var prevHandSize = (state.myHand || []).length;
    var prevOpponentCounts = {};
    (state.opponents || []).forEach(function (o) {
      if (o.playerId) prevOpponentCounts[o.playerId] = o.count;
    });

    applyStateFields(incoming);
    render();

    // --- UNO auto-call detection ---
    // Check if my hand just became 1 card (I played a card and now have 1)
    var newHandSize = (state.myHand || []).length;
    if (newHandSize === 1 && prevHandSize > 1) {
      showUnoCallout("Bạn", 0);
    }

    // Check if any opponent just reached 1 card
    (state.opponents || []).forEach(function (opp) {
      var prevCount = opp.playerId ? (prevOpponentCounts[opp.playerId] || 0) : 0;
      if (opp.count === 1 && prevCount > 1) {
        showUnoCallout(opp.name, opp.seat);
      }
    });

    // --- Draw animation: if hand grew, animate cards from draw pile ---
    var cardsDrawn = newHandSize - prevHandSize;
    if (cardsDrawn > 0) {
      animateDrawFromPile(cardsDrawn);
    }

    SFX.turnChange();
  }

  /* Helper: apply server fields to local state */
  function applyStateFields(incoming) {
    // --- Top card & current color ---
    if (incoming.currentCard) {
      var cc = incoming.currentCard;
      var wasWild = cc.value === "wild" || cc.value === "draw4";
      if (wasWild) {
        state.topCard = { color: cc.color, value: cc.value, _wildChosen: true };
      } else {
        state.topCard = { color: cc.color, value: cc.value };
      }
      state.currentColor = cc.color;
    }

    // --- Direction ---
    if (incoming.direction !== undefined) {
      state.direction = incoming.direction;
    }

    // --- Draw stack ---
    state.drawStack = incoming.drawStack || 0;

    // --- My hand ---
    if (incoming.hand && incoming.hand[MY_PLAYER_ID]) {
      state.myHand = incoming.hand[MY_PLAYER_ID];
    }

    // --- Current turn → map to seat index ---
    if (incoming.currentTurn && incoming.players) {
      var players = incoming.players;
      var myIdx = players.findIndex(function (p) { return p.id === MY_PLAYER_ID; });
      var turnIdx = players.findIndex(function (p) { return p.id === incoming.currentTurn; });

      if (myIdx === -1) myIdx = 0;
      if (turnIdx === -1) turnIdx = 0;

      var relPos = (turnIdx - myIdx + players.length) % players.length;
      var relToSeat = [0, 3, 1, 2];
      state.currentSeat = relToSeat[relPos] !== undefined ? relToSeat[relPos] : 0;
      state.mySeat = 0;
    }

    // --- Opponents (clockwise from me: left → top → right) ---
    if (incoming.players && incoming.hand) {
      var oppSeatMap = [3, 1, 2]; // left, top, right
      var players = incoming.players;
      var myIdx = players.findIndex(function (p) { return p.id === MY_PLAYER_ID; });
      if (myIdx === -1) myIdx = 0;
      var seatI = 0;
      state.opponents = [];
      for (var i = 1; i < players.length; i++) {
        var pi = (myIdx + i) % players.length;
        var p = players[pi];
        var oppHand = incoming.hand[p.id] || [];
        state.opponents.push({
          seat: oppSeatMap[seatI] !== undefined ? oppSeatMap[seatI] : seatI + 1,
          name: p.name || p.id,
          count: oppHand.length,
          playerId: p.id
        });
        seatI++;
      }
    }

    state.mustChooseColor = false;
    state.drawnThisTurn = !!incoming.drawnThisTurn;
    pendingWild = null;
    motionLock = false;
  }

  // draw animation
  function animateDrawFromPile(count) {
    var drawPile = el("draw-pile");
    var hand = el("my-hand");
    if (!drawPile || !hand) return;

    var fromRect = drawPile.getBoundingClientRect();
    var hb = hand.getBoundingClientRect();
    var targetRect = {
      left: hb.left + hb.width / 2 - 40,
      top: hb.top + 10,
      width: 80, height: 120
    };

    for (var i = 0; i < Math.min(count, 10); i++) {
      (function (delay) {
        setTimeout(function () {
          SFX.drawCard();
          var cardEl = createCardBack(false);
          animateCardFlight(fromRect, targetRect, cardEl, { duration: 300 });
        }, delay * 100);
      })(i);
    }
  }

  // draw choice actions
  function onPlayDrawnCard() {
    if (!state.drawnThisTurn) return;
    // The drawn card is always the last card in hand
    var lastIndex = state.myHand.length - 1;
    var card = state.myHand[lastIndex];
    if (!card) return;
    onPlayCard(lastIndex, card);
  }

  function onKeepCard() {
    if (!state.drawnThisTurn) return;
    emitOrLog("keep_card", {});
    if (!USE_MOCK) {
      // Server will send game_update with nextTurn
      state.drawnThisTurn = false;
      render();
      return;
    }
    // Mock mode: just pass turn
    state.drawnThisTurn = false;
    state.currentSeat = nextSeat(state.mySeat, state.direction);
    render();
  }

  // wire UI
  function wireUi() {
    // Color picker
    document.querySelectorAll("#color-picker-modal .color-slice").forEach(function (slice) {
      slice.addEventListener("click", function () {
        var color = slice.getAttribute("data-color");
        if (color) onChooseColor(color);
      });
    });

    var btnCancelColor = el("cancel-color-btn");
    if (btnCancelColor) btnCancelColor.addEventListener("click", onCancelColorChoice);

    // Draw pile
    var drawRoot = el("draw-pile");
    if (drawRoot) {
      drawRoot.addEventListener("click", performDraw);
      drawRoot.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); performDraw(); }
      });
    }

    // Draw choice modal buttons
    var btnPlay = el("draw-choice-play");
    var btnKeep = el("draw-choice-keep");
    if (btnPlay) btnPlay.addEventListener("click", onPlayDrawnCard);
    if (btnKeep) btnKeep.addEventListener("click", onKeepCard);
  }

  function initSocket() {
    if (USE_MOCK || typeof io !== "function") {
      setSocketStatus(USE_MOCK ? "Mock mode" : "Missing Socket.IO");
      return;
    }
    if (!MY_PLAYER_ID || !MY_ROOM_ID) {
      setSocketStatus("Missing playerId or roomId");
      return;
    }
    setSocketStatus("Connecting to " + SOCKET_URL);
    socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", function () {
      setSocketStatus("Connected: " + socket.id);
      // Send auth to bind socket → player → room
      socket.emit("auth", { playerId: MY_PLAYER_ID, roomId: MY_ROOM_ID });
      console.log("[socket] auth sent:", MY_PLAYER_ID, MY_ROOM_ID);
    });
    socket.on("disconnect", function (r) { setSocketStatus("Disconnected: " + r); });
    socket.on("connect_error", function (e) { setSocketStatus("Error: " + (e && e.message || "?")); });

    // Listen for game state from backend
    ["game_state", "state", "room:state", "game_update"].forEach(function (ev) {
      socket.on(ev, applyServerPayload);
    });

    // A player disconnected after 30s timeout
    socket.on("player_disconnected", function (data) {
      console.log("[socket] Player disconnected from room:", data);
    });

    // Game was aborted because a player stayed disconnected too long
    socket.on("game_aborted", function (data) {
      console.log("[socket] Game aborted:", data);
      showGameAbortedModal(data);
    });
  }

  // deal animation
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

  // init
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
