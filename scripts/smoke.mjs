/**
 * Kiem tra tong the he thong dang chay: web, API, phan quyen admin, va mot van that voi bot.
 * Chay: node smoke.mjs   (server phai dang listen o :4000)
 */
import { io } from 'socket.io-client';

const BASE = 'http://127.0.0.1:4000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const token = /tt_session=([^;]+)/.exec(setCookie)?.[1];
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* khong phai JSON */ }
  return { status: res.status, json, token, setCookie, text };
}

// ---------- 1. Web ----------
const home = await http('/');
check('GET / tra HTML', home.status === 200);
const jsPath = /src="(\/assets\/[^"]+\.js)"/.exec(home.text)?.[1] ?? '';
const cssPath = /href="(\/assets\/[^"]+\.css)"/.exec(home.text)?.[1] ?? '';
const js = await http(jsPath);
const css = await http(cssPath);
check('bundle JS/CSS tai duoc', js.status === 200 && css.status === 200, `${jsPath} (${js.text.length} B), ${cssPath} (${css.text.length} B)`);
check('bundle co trang QUAN TRI', js.text.includes('QUAN TRI'));
check('bundle co form DOI MAT KHAU', js.text.includes('DOI MAT KHAU'));
check('bundle co NHAT KY HE THONG', js.text.includes('NHAT KY HE THONG'));
check('route la tra ve app (SPA)', (await http('/lobby/ABC234')).status === 200);

// ---------- 2. Tai khoan admin ----------
const adminPass = process.env.ADMIN_PASSWORD ?? '123';
const adminLogin = await http('/api/auth/login', { method: 'POST', body: { username: 'admin', password: adminPass } });
check('dang nhap admin', adminLogin.status === 200 && adminLogin.json.user?.role === 'admin', `role=${adminLogin.json.user?.role}`);
const admin = `tt_session=${adminLogin.token}`;

const overview = await http('/api/admin/overview', { cookie: admin });
check('admin xem duoc overview', overview.status === 200, `cap=${overview.json.bot?.level} bai=${overview.json.bot?.lessons} van=${overview.json.bot?.games}`);
check('overview co nhat ky', Array.isArray(overview.json.logs) && overview.json.logs.length > 0, `${overview.json.logs?.length} dong`);
check('overview co thong ke he thong', typeof overview.json.system?.users === 'number', `users=${overview.json.system?.users}`);
const users = await http('/api/admin/users', { cookie: admin });
check('admin xem duoc danh sach tai khoan', users.status === 200 && Array.isArray(users.json.users), `${users.json.users?.length} tai khoan`);
const botApi = await http('/api/bot', { cookie: admin });
check('admin xem duoc /api/bot', botApi.status === 200 && typeof botApi.json.stats?.level === 'number', `cap=${botApi.json.stats?.level}`);

// ---------- 3. Tai khoan thuong bi chan ----------
const stamp = Date.now().toString(36).slice(-6);
const reg = await http('/api/auth/register', { method: 'POST', body: { username: `smoke${stamp}`, password: 'matkhau123' } });
check('dang ky tai khoan thuong', reg.status === 200 && reg.json.user?.role === 'user', `role=${reg.json.user?.role}`);
const user = `tt_session=${reg.token}`;

for (const path of ['/api/admin/overview', '/api/admin/users', '/api/bot']) {
  const res = await http(path, { cookie: user });
  check(`tai khoan thuong bi chan ${path}`, res.status === 403, `HTTP ${res.status}`);
}
const trainForbidden = await http('/api/admin/train', { method: 'POST', body: { games: 1 }, cookie: user });
check('tai khoan thuong khong train duoc bot', trainForbidden.status === 403);
check('sai mat khau bi tu choi', (await http('/api/auth/login', { method: 'POST', body: { username: `smoke${stamp}`, password: 'saisai' } })).status === 401);
const adminName = await http('/api/auth/register', { method: 'POST', body: { username: 'admin', password: 'matkhau123' } });
check('khong dang ky duoc ten admin', adminName.status === 409, adminName.json.code);

// ---------- 4. Doi mat khau ----------
check('doi mat khau sai mat cu bi chan',
  (await http('/api/auth/password', { method: 'POST', body: { currentPassword: 'sai', newPassword: 'matkhaumoi1' }, cookie: user })).status === 400);
check('doi mat khau thanh cong',
  (await http('/api/auth/password', { method: 'POST', body: { currentPassword: 'matkhau123', newPassword: 'matkhaumoi1' }, cookie: user })).status === 200);
check('phien cu bi huy sau khi doi mat khau', (await http('/api/auth/me', { cookie: user })).status === 401);
const relogin = await http('/api/auth/login', { method: 'POST', body: { username: `smoke${stamp}`, password: 'matkhaumoi1' } });
check('dang nhap duoc bang mat khau moi', relogin.status === 200);

// ---------- 5. Choi that voi bot ----------
const cookie = `tt_session=${relogin.token}`;
const created = await http('/api/lobbies', { method: 'POST', body: { tier: 'classic', vsBot: true, botDifficulty: 'normal' }, cookie });
const code = created.json.lobby?.code;
check('tao phong co bot', created.status === 200 && typeof code === 'string', `code=${code}`);

const socket = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] });
const states = [];
socket.on('match:state', (m) => states.push(m));
await new Promise((res, rej) => { socket.once('connect', res); socket.once('connect_error', rej); });
check('socket ket noi duoc', socket.connected);

socket.emit('lobby:join', { code });
await wait(400);
socket.emit('lobby:start');

const until = async (pred, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (let i = states.length - 1; i >= 0; i -= 1) if (pred(states[i])) return states[i];
    await wait(40);
  }
  throw new Error('timeout cho trang thai van');
};

const started = await until((m) => m.status === 'playing');
check('van bat dau', !!started, `quan: ${started.players.map((p) => `${p.username}:${p.symbol}`).join(' / ')}`);

const taken = new Set();
const cells = [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]];
const end = Date.now() + 25000;
while (Date.now() < end) {
  const snap = states[states.length - 1];
  if (!snap || snap.status === 'finished') break;
  const me = snap.players.find((p) => !p.userId.startsWith('bot:'));
  if (snap.turn === me?.userId) {
    const move = cells
      .map(([x, y]) => ({ x, y, k: `${x},${y}` }))
      .find((m) => !taken.has(m.k) && !snap.board.some((c) => c.x === m.x && c.y === m.y));
    if (move) { taken.add(move.k); socket.emit('game:place', { x: move.x, y: move.y }); }
  }
  await wait(80);
}
const finished = await until((m) => m.status === 'finished', 15000);
check('van ket thuc co ket qua', ['win', 'draw'].includes(finished.reason), `reason=${finished.reason}, nguoi thang=${finished.winnerId ? 'co' : 'hoa'}`);
check('khong co o trung nhau', new Set(finished.board.map((c) => `${c.x},${c.y}`)).size === finished.board.length, `${finished.board.length} quan`);

const after = await http('/api/admin/overview', { cookie: admin });
check('nao bot tang sau van', after.json.bot.games > overview.json.bot.games, `${overview.json.bot.games} -> ${after.json.bot.games} van`);
const botLog = after.json.logs.find((l) => l.scope === 'match' && l.message.includes('Bot rut kinh nghiem'));
check('co log hoc bai cua bot', !!botLog, botLog?.message?.slice(0, 80));

const loser = finished.winnerId ? finished.players.find((p) => p.userId !== finished.winnerId) : finished.players[0];
states.length = 0;
socket.emit('lobby:rematch:request', { tier: 'classic' });
const next = await until((m) => m.status === 'playing' && m.board.length === 0, 15000);
const nextLoser = next.players.find((p) => p.userId === loser?.userId);
check('nguoi thua van truoc duoc di truoc van sau', nextLoser?.symbol === 'X', `${loser?.username} di voi ${nextLoser?.symbol}`);

socket.close();

// ---------- 6. Admin dat lai mat khau cho nguoi khac ----------
const freshUsers = await http('/api/admin/users', { cookie: admin });
const target = freshUsers.json.users.find((u) => u.username === `smoke${stamp}`);
if (target) {
  check('admin dat lai mat khau cho nguoi khac',
    (await http(`/api/admin/users/${target.id}/password`, { method: 'POST', body: { password: 'matkhaucuatoi' }, cookie: admin })).status === 200);
  check('dang nhap duoc bang mat khau admin dat',
    (await http('/api/auth/login', { method: 'POST', body: { username: `smoke${stamp}`, password: 'matkhaucuatoi' } })).status === 200);
} else {
  check('tim thay tai khoan de test', false, `khong thay smoke${stamp}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} kiem tra dat ===`);
if (failed.length) {
  console.log('THAT BAI:');
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
  process.exit(1);
}