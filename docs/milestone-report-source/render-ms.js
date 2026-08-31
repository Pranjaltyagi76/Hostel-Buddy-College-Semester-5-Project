const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = path.resolve(__dirname, 'milestones.html');
const outPath = path.resolve(__dirname, 'Group19_HostelBuddy_Implementation_Milestone_Report.pdf');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-rep-'));
const PORT = 9388; const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wsUrl(){ for(let i=0;i<80;i++){ try{ const t=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p=t.find(x=>x.type==='page'); if(p&&p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; }catch(e){} await sleep(300);} throw new Error('no devtools'); }
function cdp(ws){ let id=0; const pend=new Map(); ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}}); return (method,params={})=>new Promise((res,rej)=>{const mid=++id;pend.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method,params}));}); }
(async()=>{
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars',`--remote-debugging-port=${PORT}`,`--user-data-dir=${userDataDir}`,'about:blank'],{stdio:'ignore'});
  try{
    const ws=new WebSocket(await wsUrl());
    await new Promise((res,rej)=>{ws.addEventListener('open',res);ws.addEventListener('error',rej);});
    const send=cdp(ws); await send('Page.enable'); await send('Runtime.enable');
    const loaded=new Promise(res=>{const h=ev=>{const m=JSON.parse(ev.data); if(m.method==='Page.loadEventFired'){ws.removeEventListener('message',h);res();}};ws.addEventListener('message',h);});
    await send('Page.navigate',{url:fileUrl}); await loaded;
    let done=false; for(let i=0;i<120;i++){ const r=await send('Runtime.evaluate',{expression:'window.__PAGED_DONE===true',returnByValue:true}); if(r.result&&r.result.value===true){done=true;break;} await sleep(400); }
    const pc=await send('Runtime.evaluate',{expression:'document.querySelectorAll(".pagedjs_page").length',returnByValue:true});
    console.log('paged done:',done,'pages:',pc.result&&pc.result.value); await sleep(500);
    const {data}=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0,paperWidth:8.27,paperHeight:11.69});
    fs.writeFileSync(outPath,Buffer.from(data,'base64')); console.log('PDF:',outPath,fs.statSync(outPath).size,'bytes'); ws.close();
  } finally { chrome.kill(); try{fs.rmSync(userDataDir,{recursive:true,force:true});}catch(e){} }
})().catch(e=>{console.error('ERR',e);process.exit(1);});
