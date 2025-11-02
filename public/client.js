(() => {
  const socket = io();
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const playersEl = document.getElementById('players');
  const scoreEl = document.getElementById('score');
  const mobileToggle = document.getElementById('mobileToggle');
  const mobileControls = document.getElementById('mobileControls');

  let state = { arena: { width: canvas.width, height: canvas.height }, tokens: [], players: [] };

  // resize canvas to server arena if provided
  function syncCanvasSize() {
    if (!state.arena) return;
    if (canvas.width !== state.arena.width || canvas.height !== state.arena.height) {
      canvas.width = state.arena.width;
      canvas.height = state.arena.height;
    }
  }

  const keys = { up: false, down: false, left: false, right: false };
  function handleKey(e, pressed) {
    const k = e.key.toLowerCase();
    if (["w", "arrowup"].includes(k)) keys.up = pressed;
    if (["s", "arrowdown"].includes(k)) keys.down = pressed;
    if (["a", "arrowleft"].includes(k)) keys.left = pressed;
    if (["d", "arrowright"].includes(k)) keys.right = pressed;
    if (k === 'f' && pressed) {
      // punch on key down
      socket.emit('punch');
    }
  }
  window.addEventListener('keydown', (e) => handleKey(e, true));
  window.addEventListener('keyup', (e) => handleKey(e, false));
  // Fallback: some environments prefer keypress for character keys
  window.addEventListener('keypress', (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'f') { e.preventDefault(); socket.emit('punch'); }
  });

  // Ensure canvas can receive focus and capture keys after first click
  try {
    // Focus on first user click/tap to guarantee key events
    const focusOnce = () => { try { canvas && canvas.focus && canvas.focus(); } catch (_) {} };
    window.addEventListener('click', focusOnce, { once: true });
    window.addEventListener('touchstart', focusOnce, { once: true, passive: true });
  } catch (_) {}

  // Mobile controls: show/hide and map D-pad to inputs
  function setMobileVisible(visible) {
    if (!mobileControls) return;
    mobileControls.hidden = !visible;
    mobileControls.setAttribute('aria-hidden', String(!visible));
    if (mobileToggle) mobileToggle.setAttribute('aria-expanded', String(visible));
  }
  // Auto-show controls on touch/coarse-pointer devices
  try {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    if (coarse || hasTouch) setMobileVisible(true);
  } catch (_) {
    // ignore detection errors
  }
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      const nowVisible = mobileControls.hidden;
      setMobileVisible(nowVisible);
    });
  }
  // If touch device, auto-suggest controls by making the toggle visible
  // and opening once on first touch.
  let autoOpened = false;
  window.addEventListener('touchstart', () => {
    if (!autoOpened) { setMobileVisible(true); autoOpened = true; }
  }, { once: true });

  if (mobileControls) {
    mobileControls.addEventListener('contextmenu', (e) => e.preventDefault());
    const buttons = mobileControls.querySelectorAll('.dir');
    buttons.forEach((btn) => {
      const dir = btn.getAttribute('data-dir');
      const setDir = (pressed) => {
        if (!dir) return;
        if (dir === 'up') keys.up = pressed;
        if (dir === 'down') keys.down = pressed;
        if (dir === 'left') keys.left = pressed;
        if (dir === 'right') keys.right = pressed;
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture && btn.setPointerCapture(e.pointerId);
        setDir(true);
      });
      const release = (e) => { e && e.preventDefault(); setDir(false); };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
      // Fallbacks for browsers without pointer events
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); setDir(true); });
      btn.addEventListener('mouseup', release);
      btn.addEventListener('mouseleave', release);
      // Touch fallbacks for older mobile browsers
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); setDir(true); }, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
    });

    const punchBtn = mobileControls.querySelector('.action[data-action="punch"]');
    if (punchBtn) {
      const emitPunch = (e) => { e && e.preventDefault(); socket.emit('punch'); };
      punchBtn.addEventListener('pointerdown', emitPunch);
      // Fallbacks for cross-browser compatibility
      punchBtn.addEventListener('click', emitPunch);
      punchBtn.addEventListener('touchstart', emitPunch, { passive: false });
    }
  }

  // send inputs at 20Hz to reduce chatter
  setInterval(() => {
    socket.emit('input', keys);
  }, 50);

  socket.on('state', (incoming) => {
    state = incoming;
    syncCanvasSize();
    playersEl.textContent = `Players: ${state.players.length}`;
    const me = state.players.find((p) => p.id === socket.id);
    scoreEl.textContent = `Your score: ${me ? me.score : 0}`;
    draw();
  });

  // Optional: log server punch acknowledgment for diagnostics
  socket.on('punch_ack', (info) => {
    try { console.debug('Punch acknowledged', info); } catch (_) {}
  });

  function draw() {
    const { arena, tokens, players } = state;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // grid background
    ctx.save();
    ctx.strokeStyle = '#1c2142';
    ctx.lineWidth = 1;
    for (let x = 0; x <= arena.width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, arena.height); ctx.stroke();
    }
    for (let y = 0; y <= arena.height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(arena.width, y); ctx.stroke();
    }
    ctx.restore();

    // tokens
    for (const t of tokens) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
    }

    // transient effects (punch ring)
    if (state.effects && Array.isArray(state.effects)) {
      const now = Date.now();
      for (const e of state.effects) {
        const age = now - e.t;
        const life = Math.max(0, 1 - age / 250);
        const radius = 40 + (1 - life) * 10; // slight growth
        ctx.beginPath();
        ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 200, 120, ${life})`;
        ctx.lineWidth = 4 * life;
        ctx.stroke();
      }
    }

    // players
    for (const p of players) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      // name/score label
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e6e9ff';
      const you = p.id === socket.id ? ' (you)' : '';
      ctx.fillText(`${p.score}${you}`, p.x, p.y - 16);
    }
  }
})();