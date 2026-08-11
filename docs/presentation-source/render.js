// Render deck.html -> 16:9 slide PDF via headless Chrome + CDP.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = path.resolve(__dirname, 'deck.html');
const outPath = path.resolve(__dirname, 'Group_19_Hostel_Buddy_Architecture_Review.pdf');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-deck-'));
const PORT = 9366;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const p = t.find((x) => x.type === 'page');
      if (p && p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('devtools not reachable');
}
function cdp(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await getWsUrl());
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = cdp(ws);
    await send('Page.enable'); await send('Runtime.enable');

    const loaded = new Promise((res) => {
      const h = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Page.loadEventFired') { ws.removeEventListener('message', h); res(); } };
      ws.addEventListener('message', h);
    });
    await send('Page.navigate', { url: fileUrl });
    await loaded;
    await sleep(1200);

    const n = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".slide").length', returnByValue: true });
    console.log('slides in HTML:', n.result.value);

    const { data } = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      paperWidth: 13.333, paperHeight: 7.5,
    });
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log('PDF written:', outPath, fs.statSync(outPath).size, 'bytes');
    ws.close();
  } finally {
    chrome.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
