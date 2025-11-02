const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ARENA = { width: 800, height: 600 };
const PLAYER_RADIUS = 12;
const TOKEN_RADIUS = 6;
const TICK_RATE = 60; // physics updates per second
const SNAPSHOT_RATE = 20; // state broadcasts per second
const PUNCH_RANGE = 40; // distance within which a punch hits
const KNOCKBACK = 80; // pixels pushed on hit
const PUNCH_COOLDOWN_MS = 450; // minimum time between punches per player
const EFFECT_LIFETIME_MS = 250; // punch visual lifetime

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true }));

const players = new Map(); // socketId -> player
let tokens = [];
let effects = []; // transient visual effects like punches

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randColor() {
  const h = randInt(0, 360);
  return `hsl(${h} 70% 50%)`;
}

function spawnTokens(count = 20) {
  tokens = Array.from({ length: count }, () => ({
    x: randInt(TOKEN_RADIUS, ARENA.width - TOKEN_RADIUS),
    y: randInt(TOKEN_RADIUS, ARENA.height - TOKEN_RADIUS),
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }));
}

spawnTokens(24);

io.on('connection', (socket) => {
  const startX = randInt(PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS);
  const startY = randInt(PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS);

  players.set(socket.id, {
    id: socket.id,
    x: startX,
    y: startY,
    color: randColor(),
    score: 0,
    input: { up: false, down: false, left: false, right: false },
    lastPunchAt: 0
  });

  socket.on('input', (incoming) => {
    const p = players.get(socket.id);
    if (!p || typeof incoming !== 'object') return;
    p.input = {
      up: !!incoming.up,
      down: !!incoming.down,
      left: !!incoming.left,
      right: !!incoming.right
    };
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
  });

  socket.on('punch', () => {
    const attacker = players.get(socket.id);
    if (!attacker) return;
    const now = Date.now();
    if (now - (attacker.lastPunchAt || 0) < PUNCH_COOLDOWN_MS) return;
    attacker.lastPunchAt = now;

    // record a transient punch effect
    effects.push({ type: 'punch', x: attacker.x, y: attacker.y, t: now, id: attacker.id });

    // apply knockback to nearby players (excluding attacker)
    for (const victim of players.values()) {
      if (victim.id === attacker.id) continue;
      const dx = victim.x - attacker.x;
      const dy = victim.y - attacker.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= PUNCH_RANGE) {
        const len = dist || 1;
        const ux = dx / len; // unit vector away from attacker
        const uy = dy / len;
        victim.x = clamp(victim.x + ux * KNOCKBACK, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS);
        victim.y = clamp(victim.y + uy * KNOCKBACK, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS);
      }
    }

    // Acknowledge to the attacker for diagnostics
    socket.emit('punch_ack', { ok: true, t: now });
  });
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function updatePhysics(dt) {
  const speed = 180; // pixels per second
  for (const p of players.values()) {
    let vx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    let vy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    // normalize
    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx /= len; vy /= len;
    }
    p.x = clamp(p.x + vx * speed * dt, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS);
    p.y = clamp(p.y + vy * speed * dt, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS);

    // token collection
    tokens = tokens.filter((t) => {
      const dist = Math.hypot(p.x - t.x, p.y - t.y);
      const hit = dist < (PLAYER_RADIUS + TOKEN_RADIUS);
      if (hit) {
        p.score += 1;
      }
      return !hit;
    });

    // keep token count
    if (tokens.length < 24) {
      const addCount = 24 - tokens.length;
      for (let i = 0; i < addCount; i++) {
        tokens.push({
          x: randInt(TOKEN_RADIUS, ARENA.width - TOKEN_RADIUS),
          y: randInt(TOKEN_RADIUS, ARENA.height - TOKEN_RADIUS),
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`
        });
      }
    }
  }

  // expire effects
  const now = Date.now();
  effects = effects.filter((e) => (now - e.t) < EFFECT_LIFETIME_MS);
}

// physics loop
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - last) / 1000); // cap dt to avoid jumps
  last = now;
  updatePhysics(dt);
}, 1000 / TICK_RATE);

// snapshot loop
setInterval(() => {
  const payload = {
    arena: ARENA,
    tokens,
    effects,
    players: Array.from(players.values()).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      color: p.color,
      score: p.score
    }))
  };
  io.emit('state', payload);
}, 1000 / SNAPSHOT_RATE);

server.listen(PORT, () => {
  console.log(`Multiplayer server running at http://localhost:${PORT}/`);
});