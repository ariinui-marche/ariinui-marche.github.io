// Bougies POH (heure UTC-10, comme Arii SNIPER) des 31 symboles de Charts -> data/poh-candles.json
// 14h = 00:00-01:00 UTC, 15h-17h = 01:00-03:00 UTC, 22h = 08:00-09:00 UTC, 02h = 12:00-13:00 UTC.
// Source : Yahoo Finance, barres 1h (la bougie 15h-17h agrège 2 barres 1h).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PAIRS = ('EURUSD GBPUSD USDJPY AUDUSD USDCAD USDCHF NZDUSD XAUUSD BTCUSD ETHUSD ' +
  'EURJPY GBPJPY EURGBP EURAUD EURCAD EURCHF EURNZD GBPAUD GBPCAD GBPCHF GBPNZD ' +
  'AUDJPY CADJPY CHFJPY NZDJPY AUDCAD AUDCHF AUDNZD CADCHF NZDCAD NZDCHF').split(' ');
const SLOTS = { '14': [0, 1], '1517': [1, 3], '22': [8, 9], '02': [12, 13] }; // heures UTC [début, fin[
const KEEP_DAYS = 5;

function yahooSymbol(id) {
  if (id === 'XAUUSD') return 'GC=F';
  if (id === 'BTCUSD') return 'BTC-USD';
  if (id === 'ETHUSD') return 'ETH-USD';
  return `${id}=X`;
}

async function fetchOne(id) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(id))}?range=1mo&interval=1h`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const q = r.indicators.quote[0];
  const days = new Map(); // 'YYYY-MM-DD' -> { slot -> [o,h,l,c,nbBarres] }
  r.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some((v) => v == null)) return;
    const dt = new Date(t * 1000);
    const hr = dt.getUTCHours();
    for (const [slot, [a, b]] of Object.entries(SLOTS)) {
      if (hr < a || hr >= b) continue;
      const d = dt.toISOString().slice(0, 10);
      if (!days.has(d)) days.set(d, {});
      const s = days.get(d);
      if (!s[slot]) s[slot] = [o, h, l, c, 1];
      else { s[slot][1] = Math.max(s[slot][1], h); s[slot][2] = Math.min(s[slot][2], l); s[slot][3] = c; s[slot][4]++; }
    }
  });
  return [...days.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).slice(-KEEP_DAYS).map(([d, s]) => {
    const c = {};
    for (const [slot, [a, b]] of Object.entries(SLOTS)) {
      const v = s[slot];
      if (v && v[4] === b - a) c[slot] = v.slice(0, 4).map((x) => +x.toPrecision(7)); // barres toutes présentes
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
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`${ok}/${PAIRS.length} paires mises à jour`);
if (ok === 0) process.exit(1);
mkdirSync('data', { recursive: true });
writeFileSync('data/poh-candles.json', JSON.stringify({ updated: new Date().toISOString(), pairs }));
