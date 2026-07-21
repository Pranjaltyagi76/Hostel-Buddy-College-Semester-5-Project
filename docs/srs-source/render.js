// Render srs.html -> PDF using headless Chrome + CDP (Node 24 built-in WebSocket).
// Waits for paged.js pagination to finish before printing.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = path.resolve(__dirname, 'srs.html');
const outPath = path.resolve(__dirname, 'Group19_HostelBuddy_SRS.pdf');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-'));
const PORT = 9333;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('Chrome DevTools endpoint not reachable');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
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

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await getWsUrl();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = cdp(ws);

    await send('Page.enable');
    await send('Runtime.enable');

    // Navigate and wait for load.
    const loaded = new Promise(res => {
      ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Page.loadEventFired') res();
      });
    });
    await send('Page.navigate', { url: fileUrl });
    await loaded;

    // Wait for paged.js to finish pagination.
    let done = false;
    for (let i = 0; i < 100; i++) {
      const r = await send('Runtime.evaluate', { expression: 'window.__PAGED_DONE === true', returnByValue: true });
      if (r.result && r.result.value === true) { done = true; break; }
      await sleep(250);
    }
    // Report page count for a sanity check.
    const pc = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".pagedjs_page").length', returnByValue: true });
    console.log('paged.js done:', done, '| pages:', pc.result && pc.result.value);
    await sleep(400);

    const { data } = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      paperWidth: 8.27, paperHeight: 11.69
    });
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log('PDF written:', outPath, fs.statSync(outPath).size, 'bytes');
    ws.close();
  } finally {
    chrome.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
