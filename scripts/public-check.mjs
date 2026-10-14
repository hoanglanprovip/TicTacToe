/** Kiem tra chơi realtime qua link public cua Cloudflare Tunnel (khong can Tailscale). */
import { io } from 'socket.io-client';

const BASE = process.argv[2];
const ok = (n, c, d = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' -- ' + d : ''}`);

const guest = async (name) => {
  const res = await fetch(`${BASE}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'loi');
  const cookie = (res.headers.get('set-cookie') ?? '').match(/tt_session=([^;]+)/)[1];
  return { user: body.user, cookie: `tt_session=${cookie}` };
};

const connect = (cookie) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'], timeout: 20000 });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

const until = (states, pred, ms = 25000) =>
  new Promise((resolve, reject) => {
    const end = Date.now() + ms;
    const t = setInterval(() => {
      for (let i = states.length - 1; i >= 0; i -= 1) if (pred(states[i])) { clearInterval(t); resolve(states[i]); return; }
      if (Date.now() > end) { clearInterval(t); reject(new Error('timeout')); }
    }, 60);
  });

// 1) WebSocket bắt tay qua tunnel
const alice = await guest('Alice');
const bob = await guest('Bob');
ok('tao duoc 2 phien khach qua HTTPS public', !!alice.cookie && !!bob.cookie, `${alice.user.username} + ${bob.user.username}`);

const sa = await connect(alice.cookie);
ok('WebSocket (socket.io) ket noi qua tunnel', sa.connected);
const statesA = [];
sa.on('match:state', (m) => statesA.push(m));
const sb = await connect(bob.cookie);
const statesB = [];
sb.on('match:state', (m) => statesB.push(m));
ok('ca hai ket noi', sa.connected && sb.connected);

// 2) Alice tao phong, Bob vao phong
const created = await fetch(`${BASE}/api/lobbies`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: alice.cookie },
  body: JSON.stringify({ tier: 'classic' }),
}).then((r) => r.json());
const code = created.lobby.code;
ok('khach tao phong qua public', !!code, `ma=${code}`);

sa.emit('lobby:join', { code });
await new Promise((r) => setTimeout(r, 400));
sb.emit('lobby:join', { code });
const lobby = await until(statesA, () => false, 3000).catch(() => null);
await new Promise((r) => setTimeout(r, 800));
const lobbyView = await fetch(`${BASE}/api/lobbies/${code}`, { headers: { cookie: bob.cookie } }).then((r) => r.json());
ok('khach thu hai vao duoc phong', lobbyView.lobby?.members?.length === 2,
  'thanh vien: ' + (lobbyView.lobby?.members ?? []).map((m) => m.username).join(' vs '));

// 3) Choi het van
sa.emit('lobby:start');
const started = await until(statesA, (m) => m.status === 'playing' && m.board.length === 0, 30000);
ok('van bat dau qua public', started.status === 'playing');

const meId = alice.user.id;
const cells = [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]];
const used = new Set();
const deadline = Date.now() + 60000;
let finished = null;
while (Date.now() < deadline && !finished) {
  const snap = statesA[statesA.length - 1];
  if (!snap) { await new Promise((r) => setTimeout(r, 100)); continue; }
  if (snap.status === 'finished') { finished = snap; break; }
  const turnPlayer = snap.players.find((p) => p.userId === snap.turn);
  if (!turnPlayer) { await new Promise((r) => setTimeout(r, 100)); continue; }
  const socket = turnPlayer.userId === meId ? sa : sb;
  const move = cells.map(([x, y]) => ({ x, y, k: `${x},${y}` }))
    .find((m) => !used.has(m.k) && !snap.board.some((c) => c.x === m.x && c.y === m.y));
  if (move) { used.add(move.k); socket.emit('game:place', { x: move.x, y: move.y }); }
  await new Promise((r) => setTimeout(r, 150));
}
finished = finished ?? await until(statesA, (m) => m.status === 'finished', 20000);
ok('choi het van qua public', finished.status === 'finished', `ket qua=${finished.reason}, ${finished.board.length} quan`);

// 4) Hai ben cung thay trang thái van (realtime 2 chieu)
const seenByBob = statesB.some((m) => m.board.length >= finished.board.length);
ok('doi phu thay doi chieu (bot nhin thay nuoc cua Alice)', seenByBob);

// 5) Chat realtime
sa.emit('chat:send', { text: 'chao ban, choi nhe' });
const chatOk = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 8000);
  sb.on('chat:message', (m) => { if (m.text.includes('chao ban')) { clearTimeout(t); resolve(true); } });
});
ok('chat realtime qua public', chatOk);

sa.close(); sb.close();
console.log(`\nHOAN TAT kiem tra link public: ${BASE}`);