// Regenerate docs/migration/er-schema-v2.png from er-schema-v2.svg.html.
//
//   node docs/migration/render-er.js
//
// Drives headless Chrome over CDP — the same approach as the screenshot and
// SADD renderers, so the repo needs no extra dependencies. The diagram is a
// local file, so nothing is served and no database is touched.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HERE = __dirname;
const SOURCE = path.join(HERE, 'er-schema-v2.svg.html');
const OUT = path.join(HERE, 'er-schema-v2.png');
const CDP_PORT = 9337;

// The SVG's own viewBox. Captured at 2x so the diagram stays readable when
// GitHub scales it down inside the README.
const WIDTH = 860;
const HEIGHT = 1210;
const SCALE = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('Chrome did not expose a CDP endpoint');
}

function cdp(ws) {
  let id = 0;
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      const onMessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id !== messageId) return;
        ws.removeEventListener('message', onMessage);
        if (msg.error) return reject(new Error(`${method}: ${msg.error.message}`));
        resolve(msg.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
}

(async () => {
  if (!fs.existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH to override.`);
  }
  if (!fs.existsSync(SOURCE)) throw new Error(`missing ${SOURCE}`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-er-'));
  let chrome;

  try {
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
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false,
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
    await send('Page.navigate', { url: `file:///${SOURCE.replace(/\\/g, '/')}` });
    await loaded;
    await sleep(600); // let the web fonts settle before capturing

    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
    ws.close();

    console.log(`[er] wrote ${path.relative(path.resolve(HERE, '..', '..'), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  } finally {
    if (chrome) chrome.kill();
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})();
