// Regenerate docs/screenshots/*.png from the running application.
//
//   npm run seed        # once, so the shots show the demo data
//   node docs/screenshots-source/capture.js
//
// Starts the app on its own port against the normal database, drives headless
// Chrome over CDP (same approach as the SADD/report renderers — no Puppeteer,
// no extra dependencies), and captures each page at the size the existing
// screenshots use. Nothing is written to the database; every shot is a read.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');

const APP_PORT = 4020;
const ORIGIN = `http://localhost:${APP_PORT}`;
const CDP_PORT = 9335;

// Match the dimensions of the screenshots already in the repo.
const WIDTH = 1300;
const HEIGHT = 880;

const ADMIN = { email: 'admin@hostel.test', password: 'admin123' };
const STUDENT = { email: 'rahul@hostel.test', password: 'student123' };

// Each shot names the page, who is looking at it, and how to tell it has
// finished rendering — polling a real selector beats guessing at a delay.
const SHOTS = [
  { file: '01-landing.png',        path: '/index.html',            as: null,      ready: "!!document.querySelector('.auth-card, .landing, main, body > div')" },
  { file: '02-login.png',          path: '/login.html',            as: null,      ready: "!!document.getElementById('loginForm')" },
  { file: '03-admin-dashboard.png', path: '/admin.html',           as: 'admin',   ready: "document.querySelectorAll('#stats .stat').length >= 6 && document.querySelectorAll('canvas').length >= 2 && !!document.querySelector('#recentArea table')", settle: 1200 },
  { file: '04-admin-complaints.png', path: '/admin-complaints.html', as: 'admin', ready: "!!document.querySelector('#resultArea table tbody tr')" },
  { file: '05-student-dashboard.png', path: '/dashboard.html',     as: 'student', ready: "document.querySelectorAll('#stats .stat').length >= 5" },
  { file: '06-my-complaints.png',  path: '/my-complaints.html',    as: 'student', ready: "!!document.querySelector('#listArea table tbody tr')" },
  { file: '07-raise-complaint.png', path: '/raise.html',           as: 'student', ready: "document.getElementById('category').options.length > 1" },
  { file: '08-admin-students.png', path: '/admin-students.html',   as: 'admin',   ready: "!!document.querySelector('#resultArea table tbody tr')" },
  { file: '09-not-found.png',      path: '/no-such-page',          as: null,      ready: "!!document.querySelector('.auth-card')" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- app server ---------------------------------------------------------

function startApp() {
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src', 'server.js')],
    { cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.getOutput = () => output;
  return child;
}

async function waitForApp(server) {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) {
      throw new Error(`app exited early (code ${server.exitCode}):\n${server.getOutput()}`);
    }
    try {
      const res = await fetch(`${ORIGIN}/api/health`);
      if (res.ok) return;
    } catch { /* not listening yet */ }
    await sleep(200);
  }
  throw new Error(`app did not start:\n${server.getOutput()}`);
}

async function login({ email, password }) {
  const res = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`could not log in as ${email} — run "npm run seed" first (got ${res.status})`);
  }
  return res.json();
}

// --- chrome / CDP (same helper shape as the SADD renderer) --------------

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const page = (await res.json()).find((t) => t.type === 'page');
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
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

// The page guards read localStorage as soon as their script runs, so the
// session has to be in place *before* the document executes anything.
function sessionScript(session) {
  if (!session) {
    return "localStorage.removeItem('hb_token'); localStorage.removeItem('hb_user');";
  }
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
  if (!fs.existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH to override.`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = startApp();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-shot-'));
  let chrome;

  try {
    await waitForApp(server);
    console.log(`[shots] app running on ${ORIGIN}`);

    const sessions = { admin: await login(ADMIN), student: await login(STUDENT) };
    console.log('[shots] signed in as admin and student');

    chrome = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`,
      `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], { stdio: 'ignore' });

    const ws = new WebSocket(await getWsUrl());
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
    const send = cdp(ws);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });

    for (const shot of SHOTS) {
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
        source: sessionScript(sessions[shot.as] || null),
      });

      const loaded = new Promise((res) => {
        const onMessage = (ev) => {
          if (JSON.parse(ev.data).method === 'Page.loadEventFired') {
            ws.removeEventListener('message', onMessage);
            res();
          }
        };
        ws.addEventListener('message', onMessage);
      });
      await send('Page.navigate', { url: ORIGIN + shot.path });
      await loaded;

      await waitFor(send, shot.ready, shot.file);
      await sleep(shot.settle || 400); // let fonts and any chart animation settle

      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(OUT_DIR, shot.file);
      fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
      console.log(`  ✓ ${shot.file}  (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);

      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }

    ws.close();
    console.log(`\n[shots] wrote ${SHOTS.length} screenshots to docs/screenshots/`);
  } finally {
    if (chrome) chrome.kill();
    server.kill();
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
