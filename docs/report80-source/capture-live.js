// Capture the figures used by the 80% implementation report from the running
// application.
//
//   npm run seed                              # once, so the shots show demo data
//   node docs/report80-source/capture-live.js
//
// Starts the app on its own port against the normal database, drives headless
// Chrome over CDP, and writes into docs/report80-source/figures/. Every shot is
// a read; nothing is written to the database.
//
// This is separate from docs/screenshots-source/capture.js because the report
// needs pairs the README does not: the same page seen by a hostel manager and
// by the super admin, which is how hostel scoping is demonstrated on paper.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'figures');

const APP_PORT = 4030;
const ORIGIN = `http://localhost:${APP_PORT}`;
const CDP_PORT = 9345;
const WIDTH = 1300;
const HEIGHT = 880;

const ACCOUNTS = {
  admin:   { email: 'admin@hostel.test', password: 'admin123' },
  manager: { email: 'manager.aryabhatta@hostel.test', password: 'manager123' },
  student: { email: 'rahul@hostel.test', password: 'student123' },
};

const SHOTS = [
  { file: 'f02-register.png',     path: '/register.html',   as: null,      ready: "document.querySelectorAll('#hostel option').length > 1" },
  { file: 'f03-login.png',        path: '/login.html',      as: null,      ready: "!!document.getElementById('loginForm')" },
  { file: 'f04-student-dash.png', path: '/dashboard.html',  as: 'student', ready: "document.querySelectorAll('#stats .stat').length >= 5" },
  { file: 'f05-raise.png',        path: '/raise.html',      as: 'student', ready: "document.getElementById('category').options.length > 1 && !!document.getElementById('video')" },
  { file: 'f06-my-complaints.png', path: '/my-complaints.html', as: 'student', ready: "!!document.querySelector('#listArea table tbody tr')" },
  // The scoping pair — the whole point of the three-role model, shown twice.
  { file: 'f08-super-dash.png',   path: '/admin.html',      as: 'admin',   ready: "document.querySelectorAll('#stats .stat').length >= 6 && document.querySelectorAll('canvas').length >= 2", settle: 1300 },
  { file: 'f09-manager-dash.png', path: '/admin.html',      as: 'manager', ready: "document.querySelectorAll('#stats .stat').length >= 6 && document.querySelectorAll('canvas').length >= 2", settle: 1300 },
  { file: 'f10-super-queue.png',  path: '/admin-complaints.html', as: 'admin',   ready: "!!document.querySelector('#resultArea table tbody tr')" },
  { file: 'f11-manager-queue.png', path: '/admin-complaints.html', as: 'manager', ready: "!!document.querySelector('#resultArea table tbody tr')" },
  { file: 'f12-students.png',     path: '/admin-students.html', as: 'admin', ready: "!!document.querySelector('#resultArea table tbody tr')" },
  { file: 'f13-hostels.png',      path: '/hostels.html',    as: 'admin',   ready: "!!document.querySelector('#hostelArea table tbody tr') && !!document.querySelector('#managerArea table tbody tr')", settle: 800 },
  { file: 'f14-not-found.png',    path: '/no-such-page',    as: null,      ready: "!!document.querySelector('.auth-card')" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startApp() {
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src', 'server.js')],
    { cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT), LOG_LEVEL: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.getOutput = () => output;
  return child;
}

async function waitForApp(server) {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`app exited early:\n${server.getOutput()}`);
    try { if ((await fetch(`${ORIGIN}/api/health`)).ok) return; } catch { /* not listening yet */ }
    await sleep(200);
  }
  throw new Error(`app did not start:\n${server.getOutput()}`);
}

async function login({ email, password }) {
  const res = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`could not log in as ${email} — run "npm run seed" first (${res.status})`);
  return res.json();
}

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('Chrome DevTools endpoint not reachable');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

// js/guard.js reads the session from <head>, before the body is parsed, so the
// session has to be in place before the document runs anything at all.
function sessionScript(session) {
  if (!session) return "localStorage.removeItem('hb_token'); localStorage.removeItem('hb_user');";
  return `localStorage.setItem('hb_token', ${JSON.stringify(session.token)});` +
         `localStorage.setItem('hb_user', ${JSON.stringify(JSON.stringify(session.user))});`;
}

async function waitFor(send, expression, label) {
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.result && r.result.value === true) return true;
    await sleep(150);
  }
  console.warn(`  ! ${label}: readiness check never passed — capturing anyway`);
  return false;
}

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH to override.`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = startApp();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-fig-'));
  let chrome;

  try {
    await waitForApp(server);
    console.log(`[figures] app running on ${ORIGIN}`);

    const sessions = {};
    for (const [role, creds] of Object.entries(ACCOUNTS)) sessions[role] = await login(creds);
    console.log('[figures] signed in as super admin, manager and student');

    chrome = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`,
      `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`, 'about:blank',
    ], { stdio: 'ignore' });

    const ws = new WebSocket(await getWsUrl());
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = cdp(ws);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

    for (const shot of SHOTS) {
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
        source: sessionScript(sessions[shot.as] || null),
      });

      const loaded = new Promise((res) => {
        const h = (ev) => {
          if (JSON.parse(ev.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', h); res(); }
        };
        ws.addEventListener('message', h);
      });
      await send('Page.navigate', { url: ORIGIN + shot.path });
      await loaded;

      await waitFor(send, shot.ready, shot.file);
      await sleep(shot.settle || 400); // let fonts and chart animation settle

      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(OUT_DIR, shot.file);
      fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
      console.log(`  ok ${shot.file}  (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);

      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }

    ws.close();
    console.log(`\n[figures] wrote ${SHOTS.length} figures to docs/report80-source/figures/`);
  } finally {
    if (chrome) chrome.kill();
    server.kill();
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
