// Bougies POH (heure UTC-10, comme Arii SNIPER) des 31 symboles de Charts -> data/poh-candles.json
// 14h = 00:00-01:00 UTC, 15h-17h = 01:00-03:00 UTC, 22h = 08:00-09:00 UTC, 02h = 12:00-13:00 UTC.
// Source : TradingView (WebSocket public, mêmes symboles que le widget du site), barres 1h ; la bougie 15h-17h agrège 2 barres 1h.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';

const PAIRS = ('EURUSD GBPUSD USDJPY AUDUSD USDCAD USDCHF NZDUSD XAUUSD BTCUSD ETHUSD ' +
  'EURJPY GBPJPY EURGBP EURAUD EURCAD EURCHF EURNZD GBPAUD GBPCAD GBPCHF GBPNZD ' +
  'AUDJPY CADJPY CHFJPY NZDJPY AUDCAD AUDCHF AUDNZD CADCHF NZDCAD NZDCHF').split(' ');
const SLOTS = { '12': [22, 23], '14': [0, 1], '15': [1, 2], '17': [3, 4], '22': [8, 9], '23': [9, 10], '02': [12, 13], '03': [13, 14], '07': [17, 18] }; // heures UTC [début, fin[
const KEEP_DAYS = 5;

function tvSymbol(id) { // mêmes symboles que les graphiques TradingView du site (script.js tvSymbolFor)
  if (id === 'XAUUSD') return 'OANDA:XAUUSD';
  if (id === 'BTCUSD') return 'COINBASE:BTCUSD';
  if (id === 'ETHUSD') return 'COINBASE:ETHUSD';
  return `FX:${id}`;
}

// Barres 1h via le WebSocket public de TradingView (même flux que le widget affiché dans le site).
function fetchBars(sym) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', { headers: { Origin: 'https://www.tradingview.com' } });
    const enc = (o) => { const j = JSON.stringify(o); return `~m~${j.length}~m~${j}`; };
    const send = (m, p) => ws.send(enc({ m, p }));
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 20000);
    let buf = '';
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('open', () => {
      send('set_auth_token', ['unauthorized_user_token']);
      send('chart_create_session', ['cs_x', '']);
      send('resolve_symbol', ['cs_x', 'sds_sym_1', `={"symbol":"${sym}","adjustment":"splits"}`]);
      send('create_series', ['cs_x', 'sds_1', 's1', 'sds_sym_1', '60', 300, '']);
    });
    ws.on('message', (d) => {
      const m = d.toString();
      if (/^~m~\d+~m~~h~\d+$/.test(m)) { ws.send(m); return; }
      if (m.includes('symbol_error') || m.includes('critical_error')) { clearTimeout(timer); ws.close(); reject(new Error('symbol_error')); return; }
      buf += m;
      const x = buf.match(/"s":\[(.*?)\],"ns"/s);
      if (x) { clearTimeout(timer); ws.close(); resolve(JSON.parse('[' + x[1] + ']').map((b) => b.v)); }
    });
  });
}

async function fetchOne(id) {
  const bars = await fetchBars(tvSymbol(id)); // [t, o, h, l, c, vol]
  const days = new Map(); // 'YYYY-MM-DD' -> { slot -> [o,h,l,c,nbBarres] }
  for (const [t, o, h, l, c] of bars) {
    if ([o, h, l, c].some((v) => v == null)) continue;
    const dt = new Date(t * 1000);
    const hr = dt.getUTCHours();
    for (const [slot, [a, b]] of Object.entries(SLOTS)) {
      if (hr < a || hr >= b) continue;
      const d = new Date((t + (slot === '12' ? 7200 : 0)) * 1000).toISOString().slice(0, 10);
      if (!days.has(d)) days.set(d, {});
      const s = days.get(d);
      if (!s[slot]) s[slot] = [o, h, l, c, 1];
      else { s[slot][1] = Math.max(s[slot][1], h); s[slot][2] = Math.min(s[slot][2], l); s[slot][3] = c; s[slot][4]++; }
    }
  }
  return [...days.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).slice(-KEEP_DAYS).map(([d, s]) => {
    const c = {};
    for (const [slot, [a, b]] of Object.entries(SLOTS)) {
      const v = s[slot];
      if (v && v[4] === b - a) c[slot] = v.slice(0, 4).map((x) => +x.toPrecision(7));
    }
    return { d, c };
  });
}

let old = {};
try { old = JSON.parse(readFileSync('data/poh-candles.json', 'utf8')).pairs || {}; } catch {}
const pairs = {};
let ok = 0;
for (const id of PAIRS) {
  try { pairs[id] = await fetchOne(id); ok++; } catch (e) {
    console.error(`${id}: ${e.message}`);
    if (old[id]) pairs[id] = old[id];
  }
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`${ok}/${PAIRS.length} paires mises à jour`);
if (ok === 0) process.exit(1);
mkdirSync('data', { recursive: true });
writeFileSync('data/poh-candles.json', JSON.stringify({ updated: new Date().toISOString(), pairs }));
