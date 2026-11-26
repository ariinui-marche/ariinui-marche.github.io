// Bougies jaunes (sweeps de DTFX) : node scripts/build-sweeps.mjs  ->  <OUT>/sweeps.json
// Pour les 31 paires et les unités 1h, 4h, daily : la dernière bougie CLÔTURÉE du flux IC est comparée à celle juste avant.
// Même règle que candleYellowLevel (script.js) et que f_checkSweep (DTFX.txt).
import { writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';

const PAIRS = 'EURUSD GBPUSD USDJPY AUDUSD USDCAD USDCHF NZDUSD XAUUSD BTCUSD ETHUSD EURJPY GBPJPY EURGBP EURAUD EURCAD EURCHF EURNZD GBPAUD GBPCAD GBPCHF GBPNZD AUDJPY CADJPY CHFJPY NZDJPY AUDCAD AUDCHF AUDNZD CADCHF NZDCAD NZDCHF'.split(' ');
const TFS = { 60: 3600, 240: 14400, '1D': 86400 };

function fetchAll(tf) { // une seule connexion pour les 31 paires
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', { headers: { Origin: 'https://www.tradingview.com' } });
    const send = (m, p) => { const j = JSON.stringify({ m, p }); ws.send(`~m~${j.length}~m~${j}`); };
    const out = {};
    const done = () => { clearTimeout(timer); ws.close(); resolve(out); };
    const timer = setTimeout(done, 25000);
    ws.on('error', done);
    ws.on('open', () => {
      send('set_auth_token', ['unauthorized_user_token']);
      PAIRS.forEach((p, i) => {
        send('chart_create_session', [`cs_${i}`, '']);
        send('resolve_symbol', [`cs_${i}`, `sym_${i}`, `={"symbol":"IC:${p}","adjustment":"splits"}`]);
        send('create_series', [`cs_${i}`, `sds_${i}`, `s${i}`, `sym_${i}`, tf, 6, '']);
      });
    });
    ws.on('message', (d) => {
      const raw = d.toString();
      if (/^~m~\d+~m~~h~\d+$/.test(raw)) { ws.send(raw); return; }
      for (const part of raw.split(/~m~\d+~m~/)) {
        if (!part.startsWith('{')) continue;
        let msg;
        try { msg = JSON.parse(part); } catch { continue; }
        if (msg.m !== 'timescale_update') continue;
        for (const [k, v] of Object.entries(msg.p?.[1] || {})) {
          const i = Number(k.replace('sds_', ''));
          if (PAIRS[i] && v?.s?.length) out[PAIRS[i]] = v.s.map((b) => b.v.slice(0, 5));
        }
        if (Object.keys(out).length === PAIRS.length) done();
      }
    });
  });
}

function sweepLevel(prev, b) {
  if (prev[4] > prev[1] && b[4] > b[1] && b[3] < prev[3] && b[4] > prev[1]) return prev[3];
  if (prev[4] < prev[1] && b[4] < b[1] && b[2] > prev[2] && b[4] < prev[1]) return prev[2];
  return null;
}

const now = Math.floor(Date.now() / 1000), signals = [], read = {};
for (const [tf, sec] of Object.entries(TFS)) {
  let all = await fetchAll(tf);
  if (Object.keys(all).length < PAIRS.length) all = { ...(await fetchAll(tf)), ...all }; // 1 nouvel essai
  read[tf] = Object.keys(all).length;
  for (const pair of PAIRS) {
    const closed = (all[pair] || []).filter((b) => b.every((v) => v != null) && b[0] + sec <= now);
    if (closed.length < 2) continue;
    const prev = closed[closed.length - 2], b = closed[closed.length - 1], level = sweepLevel(prev, b);
    if (level !== null) signals.push({ pair, tf, t: b[0], close: b[0] + sec, bull: b[4] > b[1], level });
  }
}
console.log('paires lues :', JSON.stringify(read), '| signaux :', signals.map((s) => `${s.pair} ${s.tf} ${s.bull ? 'haussier' : 'baissier'}`).join(', ') || 'aucun');
if (!Object.values(read).some((n) => n)) { process.exitCode = 1; } else {
  const OUT = process.env.OUT || 'data';
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/sweeps.json`, JSON.stringify({ updated: new Date().toISOString(), read, signals }));
}
