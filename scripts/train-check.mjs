/** Kiem tra luong train nen: server co phan hoi ngay + tien do + log. */
const BASE = 'http://127.0.0.1:4000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

async function http(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const token = /tt_session=([^;]+)/.exec(setCookie)?.[1];
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* html */ }
  return { status: res.status, json, token };
}

const login = await http('/api/auth/login', { method: 'POST', body: { username: 'admin', password: process.env.ADMIN_PASSWORD ?? '123' } });
if (login.status !== 200) { console.log('FAIL  khong dang nhap duoc admin'); process.exit(1); }
const admin = `tt_session=${login.token}`;

const before = (await http('/api/admin/overview', { cookie: admin })).json;

const t0 = Date.now();
const started = await http('/api/admin/train', { method: 'POST', body: { games: 400, tier: 'classic', level: 'hard', opponent: 'easy' }, cookie: admin });
const startMs = Date.now() - t0;
check('POST /train tra ve ngay (khong treo)', started.status === 200 && started.json.job?.running === true, `${startMs}ms, job=${started.json.job?.id}`);
check('duoi muc trong toi da', startMs < 3000, `${startMs}ms`);

// Server phai phan hoi ngay tren khi dang train
const t1 = Date.now();
const ping = await http('/api/health');
const pingMs = Date.now() - t1;
check('server van phan hoi khi dang train', ping.status === 200 && pingMs < 1500, `/api/health ${pingMs}ms`);

const t2 = Date.now();
const logsDuring = await http('/api/admin/overview', { cookie: admin });
const logsMs = Date.now() - t2;
check('doc duoc nhat ky khi dang train', logsDuring.status === 200 && Array.isArray(logsDuring.json.logs), `${logsMs}ms, ${logsDuring.json.logs?.length} dong`);
check('co dong log "bat dau train"', logsDuring.json.logs?.some((l) => l.message.includes('bat dau train')));

// Theo doi tien do
let sawProgress = false;
let lastSeen = 0;
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  const ov = (await http('/api/admin/overview', { cookie: admin })).json;
  const job = ov.training;
  if (job?.running) {
    lastSeen = Math.max(lastSeen, job.done);
    if (job.done > 0) sawProgress = true;
    process.stdout.write(`\r  tien do: ${job.done}/${job.total} van ...        `);
  } else if (job) {
    process.stdout.write('\n');
    check('job chay toi khi het', job.running === false && job.done === job.total, `${job.done}/${job.total}`);
    check('job co ket qua', !!job.result, job.result ? `cap=${job.result.stats.level} bai=${job.result.stats.lessons}` : '');
    check('nao bot da duoc luu', ov.bot.games > before.bot.games, `${before.bot.games} -> ${ov.bot.games} van`);
    const logDone = ov.logs.find((l) => l.message.includes('Train xong'));
    check('co dong log "Train xong"', !!logDone, logDone?.message?.slice(0, 90));
    break;
  }
  await wait(600);
}
check('thay tien do chay trong luc train', sawProgress, `da thay toi da ${lastSeen} van`);

// Khong chay trung nhieu job
const again = await http('/api/admin/train', { method: 'POST', body: { games: 5 }, cookie: admin });
check('tra ve job dang chay neu goi lai', typeof again.json.job?.id === 'string');

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} kiem tra dat ===`);
process.exit(failed.length ? 1 : 0);