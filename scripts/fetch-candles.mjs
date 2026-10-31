// Bougies Daily (30 dernières) des 31 symboles du module Charts -> data/daily-candles.json
// Source : Yahoo Finance chart API (gratuite, sans clé). Une exécution par jour suffit.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PAIRS = ('EURUSD GBPUSD USDJPY AUDUSD USDCAD USDCHF NZDUSD XAUUSD BTCUSD ETHUSD ' +
  'EURJPY GBPJPY EURGBP EURAUD EURCAD EURCHF EURNZD GBPAUD GBPCAD GBPCHF GBPNZD ' +
  'AUDJPY CADJPY CHFJPY NZDJPY AUDCAD AUDCHF AUDNZD CADCHF NZDCAD NZDCHF').split(' ');

function yahooSymbol(id) {
  if (id === 'XAUUSD') return 'GC=F';
  if (id === 'BTCUSD') return 'BTC-USD';
  if (id === 'ETHUSD') return 'ETH-USD';
  return `${id}=X`;
}

async function fetchOne(id) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(id))}?range=3mo&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const q = r.indicators.quote[0];
  const out = [];
  r.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some((v) => v == null)) return;
    out.push([t, +o.toPrecision(7), +h.toPrecision(7), +l.toPrecision(7), +c.toPrecision(7)]);
  });
  return out.slice(-40);
}

let old = {};
try { old = JSON.parse(readFileSync('data/daily-candles.json', 'utf8')).pairs || {}; } catch {}

const pairs = {};
let ok = 0;
for (const id of PAIRS) {
  try {
    pairs[id] = await fetchOne(id);
    ok++;
  } catch (e) {
    console.error(`${id}: ${e.message}`);
    if (old[id]) pairs[id] = old[id]; // garde l'ancienne série plutôt que de la perdre
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`${ok}/${PAIRS.length} paires mises à jour`);
if (ok === 0) process.exit(1);

mkdirSync('data', { recursive: true });
writeFileSync('data/daily-candles.json', JSON.stringify({ updated: new Date().toISOString(), pairs }));
