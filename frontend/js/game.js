(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var SOCKET_URL = params.get("server") || "http://localhost:3000";
  var USE_MOCK = params.get("mock") !== "0";

  var socket = null;
  var lastServerState = null;

  /** Block double actions while card flight runs (mock UX). */
  var motionLock = false;
  /** Wild: defer removing from hand until color chosen + flight completes. */
  var pendingWild = null;

  var DRAW_PREVIEW_SEQUENCE = [];
  var drawPreviewOffset = 0;
  var DRAW_LAYERS = 7;

  function el(id) {
    return document.getElementById(id);
  }

  function shuffleInPlace(arr) {
    var i = arr.length;
    while (i > 1) {
      var j = Math.floor(Math.random() * i);
      i--;
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function buildDrawPreviewPool() {
    var colors = ["red", "blue", "green", "yellow"];
    var nums = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    var specials = ["skip", "reverse", "draw2", "draw_two"];
    var pool = [];
    colors.forEach(function (color) {
      nums.forEach(function (n) {
        pool.push({ kind: "face", color: color, value: n });
      });
      specials.forEach(function (v) {
        pool.push({ kind: "face", color: color, value: v });
      });
    });
    for (var w = 0; w < 5; w++) pool.push({ kind: "wildBack" });
    for (var k = 0; k < 5; k++) pool.push({ kind: "wild4Back" });
    return pool;
  }

  function initDrawPreviewSequence() {
    DRAW_PREVIEW_SEQUENCE = shuffleInPlace(buildDrawPreviewPool());
    drawPreviewOffset = 0;
  }

  function cardClassFromCard(card) {
    if (!card) return "";
    if (card.type === "wild" || card.type === "wild_draw_four") return "wild";
    if (card.color === "wild") return "wild";
    return card.color || "";
  }

  function cardFace(card) {
    if (!card) return "?";
    if (card.type === "wild") return "Wild";
    if (card.type === "wild_draw_four") return "+4";
    if (card.color === "wild") {
      if (card.value === "draw4") return "+4";
      return "Wild";
    }
    if (card.value === "skip") return "⊘";
    if (card.value === "reverse") return "⇄";
    if (card.value === "draw_two" || card.value === "draw2") return "+2";
    return String(card.value).toUpperCase();
  }

  function cardVisual(card) {
    return {
      className: "card card-floating " + cardClassFromCard(card),
      face: cardFace(card),
    };
  }

  function peekStackEntries() {
    var n = Math.min(DRAW_LAYERS, DRAW_PREVIEW_SEQUENCE.length || 7);
    var out = [];
    var seqLen = DRAW_PREVIEW_SEQUENCE.length || 1;
    for (var i = 0; i < n; i++) {
      out.push(
        DRAW_PREVIEW_SEQUENCE[(drawPreviewOffset + i) % seqLen]
      );
    }
    return out;
  }

  function previewEntryToDrawnCard(peekTop) {
    if (!peekTop) {
      var colors = ["red", "blue", "green", "yellow"];
      return {
        color: colors[Math.floor(Math.random() * 4)],
        value: String(Math.floor(Math.random() * 10)),
      };
    }
    if (peekTop.kind === "wildBack") return { type: "wild" };
    if (peekTop.kind === "wild4Back") return { type: "wild_draw_four" };
    var v = peekTop.value;
    if (v === "draw2") v = "draw_two";
    return { color: peekTop.color, value: v };
  }

  function faceFromPreviewEntry(entry) {
    if (!entry || entry.kind === "wildBack") return "";
    if (entry.kind === "wild4Back") return "";
    if (entry.value === "skip") return "⊘";
    if (entry.value === "reverse") return "⇄";
    if (entry.value === "draw2" || entry.value === "draw_two") return "+2";
    return String(entry.value).toUpperCase();
  }

  function renderDrawPile() {
    var stack = el("draw-pile-stack");
    if (!stack || !DRAW_PREVIEW_SEQUENCE.length) return;
    stack.innerHTML = "";

    var entries = peekStackEntries();

    entries.forEach(function (entry, idx) {
      var layer = document.createElement("div");
      layer.className = "draw-pile-layer";
      var depth = entries.length - 1 - idx;
      var rot = -11 + idx * (22 / Math.max(entries.length - 1, 1));
      var tx = ((idx - (entries.length - 1) / 2) * 2.2).toFixed(1) + "px";
      var ty = -(idx * 2.8).toFixed(1) + "px";
      layer.style.setProperty("--rot", rot + "deg");
      layer.style.setProperty("--tx", tx);
      layer.style.setProperty("--ty", ty);
      layer.style.transform =
        "translate(" + tx + ", " + ty + ") rotate(" + rot + "deg)";
      layer.style.zIndex = String(10 + idx);

      if (idx === entries.length - 1) layer.classList.add("draw-layer-top");

      var mini = document.createElement("div");
      mini.className = "mini-card";

      if (entry.kind === "wildBack") {
        mini.classList.add("back-wild");
        var w = document.createElement("span");
        w.className = "wild-mark";
        w.textContent = "Wild";
        mini.appendChild(w);
      } else if (entry.kind === "wild4Back") {
        mini.classList.add("back-wild");
        var p4 = document.createElement("span");
        p4.className = "plus4-mark";
        p4.textContent = "+4";
        mini.appendChild(p4);
      } else {
        mini.classList.add(entry.color);
        mini.textContent = faceFromPreviewEntry(entry);
      }

      layer.appendChild(mini);
      stack.appendChild(layer);
    });
  }

  function getHandCardButton(index) {
    var hand = el("my-hand");
    if (!hand) return null;
    var buttons = hand.querySelectorAll("button.card");
    return buttons[index] || null;
  }

  /**
   * @param {DOMRectReadOnly | DOMRect} fromRect
   * @param {DOMRectReadOnly | DOMRect} toRect
   * @param {{ className: string, face: string }} appearance
   * @param {{ onDone?: function }} opts
   */
  function animateCardFlight(fromRect, toRect, appearance, opts) {
    var duration = opts && opts.duration != null ? opts.duration : 420;
    var onDone = opts && opts.onDone;

    var layer = el("card-motion-layer");
    if (!layer || !fromRect || !toRect) {
      if (onDone) onDone();
      return;
    }

    var node = document.createElement("div");
    node.className = appearance.className + " is-flying";
    node.textContent = appearance.face || "";
    node.style.left = fromRect.left + "px";
    node.style.top = fromRect.top + "px";
    node.style.width = fromRect.width + "px";
    node.style.height = fromRect.height + "px";
    layer.appendChild(node);

    var dx =
      toRect.left -
      fromRect.left +
      (toRect.width - fromRect.width) / 2;
    var dy =
      toRect.top -
      fromRect.top +
      (toRect.height - fromRect.height) / 2;

    node.getBoundingClientRect();

    var ended = false;
    function cleanup() {
      if (ended) return;
      ended = true;
      node.removeEventListener("transitionend", done);
      if (node.parentNode) node.parentNode.removeChild(node);
      if (onDone) onDone();
    }

    function done(ev) {
      if (ev && ev.propertyName && ev.propertyName !== "transform") return;
      cleanup();
    }

    requestAnimationFrame(function () {
      node.style.transform =
        "translate(" + dx + "px," + dy + "px) scale(1)";
      node.style.boxShadow = "0 14px 32px rgba(0,0,0,0.4)";
    });

    node.addEventListener("transitionend", done);
    window.setTimeout(cleanup, duration + 120);
  }

  function fallbackCardSize() {
    var root = document.documentElement;
    var cs = getComputedStyle(root);
    var w =
      parseFloat(cs.getPropertyValue("--card-w").trim()) || 72;
    var h =
      parseFloat(cs.getPropertyValue("--card-h").trim()) || 108;
    return { w: w, h: h };
  }

  function triggerCenterTableNudge() {
    var row = document.querySelector("#center-table .piles-row");
    var disc = el("discard-pile");
    if (row) {
      row.classList.remove("cards-center-nudge");
      void row.offsetWidth;
      row.classList.add("cards-center-nudge");
      window.setTimeout(function () {
        row.classList.remove("cards-center-nudge");
      }, 460);
    }
    if (disc) {
      disc.classList.remove("pulse-drop");
      void disc.offsetWidth;
      disc.classList.add("pulse-drop");
      window.setTimeout(function () {
        disc.classList.remove("pulse-drop");
      }, 460);
    }
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
      "card small on-discard " + cardClassFromCard(state.topCard);
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
      btn.className = "card " + cardClassFromCard(card);
      btn.textContent = cardFace(card);
      btn.style.setProperty("--z", String(10 + index));
      btn.disabled =
        !isMyTurn || motionLock || state.mustChooseColor;
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
    renderDrawPile();
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

  function isWildCard(card) {
    return (
      !!(card &&
        (card.type === "wild" ||
          card.type === "wild_draw_four" ||
          card.color === "wild"))
    );
  }

  function finalizePlayState(index, card) {
    state.topCard = card.color
      ? Object.assign({}, { color: card.color, value: card.value })
      : Object.assign({}, { type: card.type });

    state.mustChooseColor = false;
    state.currentColor = card.color
      ? card.color
      : state.currentColor;

    state.myHand.splice(index, 1);
    state.currentSeat = (state.mySeat + 1) % 4;
    state.unoButtonVisible = state.myHand.length === 1;
  }

  function onPlayCard(index, card) {
    emitOrLog("play_card", { index: index, card: card });
    if (!USE_MOCK) return;

    if (motionLock) return;

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
    var appearance = cardVisual(card);
    animateCardFlight(
      btn.getBoundingClientRect(),
      discard.getBoundingClientRect(),
      appearance,
      {
        duration: 420,
        onDone: function () {
          btn.classList.remove("is-leaving");
          finalizePlayState(index, card);
          motionLock = false;
          render();
          triggerCenterTableNudge();
        },
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

      if (!btn || !discard || motionLock) {
        state.topCard =
          pw.card.type === "wild_draw_four"
            ? { color: color, type: "wild_draw_four", value: "draw4" }
            : { color: color, type: "wild", value: "wild" };
        state.mustChooseColor = false;
        state.currentColor = color;
        state.myHand.splice(pw.index, 1);
        state.currentSeat = (state.mySeat + 1) % 4;
        render();
        return;
      }

      motionLock = true;
      btn.classList.add("is-leaving");
      animateCardFlight(
        btn.getBoundingClientRect(),
        discard.getBoundingClientRect(),
        cardVisual(pw.card),
        {
          duration: 420,
          onDone: function () {
            btn.classList.remove("is-leaving");
            state.topCard =
              pw.card.type === "wild_draw_four"
                ? { color: color, type: "wild_draw_four", value: "draw4" }
                : { color: color, type: "wild", value: "wild" };
            state.mustChooseColor = false;
            state.currentColor = color;
            state.myHand.splice(pw.index, 1);
            state.currentSeat = (state.mySeat + 1) % 4;
            state.unoButtonVisible = state.myHand.length === 1;
            motionLock = false;
            render();
            triggerCenterTableNudge();
          },
        }
      );
      return;
    }

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
    if (motionLock) return;
    state.currentSeat = (state.currentSeat + 1) % 4;
    render();
  }

  function performMockDraw() {
    if (!USE_MOCK) return;

    if (motionLock || state.mustChooseColor) return;

    if (!DRAW_PREVIEW_SEQUENCE.length) {
      initDrawPreviewSequence();
      renderDrawPile();
    }

    var seqLen = DRAW_PREVIEW_SEQUENCE.length;
    var peekTop = DRAW_PREVIEW_SEQUENCE[drawPreviewOffset % seqLen];
    var drawn = previewEntryToDrawnCard(peekTop);

    renderDrawPile();

    var topLayer = document.querySelector(".draw-layer-top .mini-card");
    var drawPileRoot = el("draw-pile");
    var hand = el("my-hand");

    var fromEl = topLayer || drawPileRoot;
    if (!fromEl || !hand) {
      drawPreviewOffset = (drawPreviewOffset + 1) % seqLen;
      state.myHand.push(drawn);
      render();
      return;
    }

    var fromRect = fromEl.getBoundingClientRect();

    motionLock = true;

    var vis = cardVisual(drawn);

    var refBtn = hand.querySelector("button.card");
    var fz = fallbackCardSize();
    var estW =
      refBtn &&
      refBtn.getBoundingClientRect().width &&
      refBtn.getBoundingClientRect().width > 0
        ? refBtn.getBoundingClientRect().width
        : fromRect.width || fz.w;
    var estH =
      refBtn &&
      refBtn.getBoundingClientRect().height &&
      refBtn.getBoundingClientRect().height > 0
        ? refBtn.getBoundingClientRect().height
        : fromRect.height || fz.h;

    var hb = hand.getBoundingClientRect();

    function targetLandingRect(w, h) {
      var ref = hand.querySelector("button.card:last-of-type") || refBtn;
      if (ref) {
        var rRef = ref.getBoundingClientRect();
        var inset = Math.min(w * 0.38, 28);
        return {
          left: Math.min(
            Math.max(hb.left + 4, rRef.right - inset),
            hb.right - w - 6
          ),
          top: Math.min(
            Math.max(hb.top + 6, rRef.top + (rRef.height - h) / 2),
            hb.bottom - h - 10
          ),
          width: w,
          height: h,
        };
      }
      return {
        left: Math.max(hb.left + 4, hb.right - w - Math.max(hb.width * 0.1, 14)),
        top: Math.min(Math.max(hb.top + hb.height * 0.08, hb.top + 8), hb.bottom - h - 8),
        width: w,
        height: h,
      };
    }

    var targetRect = targetLandingRect(estW, estH);

    animateCardFlight(fromRect, targetRect, vis, {
      duration: 480,
      onDone: function () {
        drawPreviewOffset = (drawPreviewOffset + 1) % seqLen;
        state.myHand.push(drawn);
        motionLock = false;
        render();
        var sc = el("my-hand");
        if (sc) sc.scrollLeft = sc.scrollWidth;
        triggerCenterTableNudge();
      },
    });
  }

  function mockDraw() {
    performMockDraw();
  }

  function mockOpenWild() {
    state.mustChooseColor = true;
    pendingWild = null;
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
    var drawRoot = el("draw-pile");
    if (drawRoot) {
      drawRoot.addEventListener("click", function () {
        mockDraw();
      });
      drawRoot.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          mockDraw();
        }
      });
    }

    var demoNt = el("demo-next-turn");
    if (demoNt) demoNt.addEventListener("click", mockNextTurn);
    var demoDr = el("demo-draw");
    if (demoDr) demoDr.addEventListener("click", mockDraw);
    var demoW = el("demo-wild");
    if (demoW) demoW.addEventListener("click", mockOpenWild);
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
      setSocketStatus(
        "Lỗi: " + (err && err.message ? err.message : "connect_error")
      );
    });

    var stateEvents = ["game_state", "state", "room:state"];
    stateEvents.forEach(function (ev) {
      socket.on(ev, applyServerPayload);
    });
  }

  function init() {
    initDrawPreviewSequence();
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
