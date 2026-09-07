// Render report80.html to the 80% implementation report PDF.
//
//   node docs/report80-source/render.js
//
// Same approach as the SADD and milestone renderers: headless Chrome over CDP,
// Paged.js for the page boxes, no extra dependencies. Waits for Paged.js to
// finish laying out before printing, or the PDF comes out as one long page.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = path.resolve(__dirname, 'report80.html');
const outPath = path.resolve(__dirname, '..', '..', 'Group19_HostelBuddy_80_Percent_Implementation_Report.pdf');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
const PORT = 9390;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = tabs.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('Chrome did not expose a CDP endpoint');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  });
  return (method, params = {}) =>
    new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
}

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH to override.`);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-r80-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const ws = new WebSocket(await wsUrl());
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = cdp(ws);
    await send('Page.enable');
    await send('Runtime.enable');

    const loaded = new Promise((res) => {
      const h = (ev) => {
        if (JSON.parse(ev.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', h); res(); }
      };
      ws.addEventListener('message', h);
    });
    await send('Page.navigate', { url: fileUrl });
    await loaded;

    // Paged.js sets this flag from the `after` hook once pagination is done.
    let done = false;
    for (let i = 0; i < 150; i++) {
      const r = await send('Runtime.evaluate', { expression: 'window.__PAGED_DONE===true', returnByValue: true });
      if (r.result && r.result.value === true) { done = true; break; }
      await sleep(400);
    }
    const pages = await send('Runtime.evaluate', {
      expression: 'document.querySelectorAll(".pagedjs_page").length', returnByValue: true,
    });
    console.log('[report80] paged done:', done, '| pages:', pages.result && pages.result.value);
    if (!done) throw new Error('Paged.js did not finish laying the document out');
    await sleep(600); // let the images settle

    const { data } = await send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      paperWidth: 8.27, paperHeight: 11.69,
    });
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log('[report80] PDF:', outPath, '|', (fs.statSync(outPath).size / 1024).toFixed(0), 'KB');
    ws.close();
  } finally {
    chrome.kill();
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
