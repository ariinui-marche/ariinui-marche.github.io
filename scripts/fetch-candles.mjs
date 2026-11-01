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

// Forex : les bougies Daily Yahoo ont un corps quasi nul. On reconstruit de vraies
// bougies Daily depuis les barres 1h, avec la coupure FX standard 17h New York.
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
function fxDayKey(tsSec) {
  const p = Object.fromEntries(NY.formatToParts(new Date(tsSec * 1000)).map((x) => [x.type, x.value]));
  // heure NY + 7h -> la journée FX bascule à 17h NY
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour + 7) / 1000;
}

// Fin réelle (secondes UTC) de la bougie étiquetée k (minuit UTC de sa date) : 17h New York ce jour-là,
// 21h ou 22h UTC selon l'heure d'été américaine.
function fxDayEnd(k) {
  const d = new Date(k * 1000);
  for (const h of [21, 22]) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h);
    const hourNY = +NY.formatToParts(new Date(t)).find((x) => x.type === 'hour').value;
    if (hourNY === 17) return t / 1000;
  }
  return k + 22 * 3600;
}

async function fetchForex(id) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(id))}?range=3mo&interval=1h`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const q = r.indicators.quote[0];
  const days = new Map();
  r.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some((v) => v == null)) return;
    const k = Math.floor(fxDayKey(t) / 86400) * 86400;
    const d = days.get(k);
    if (!d) days.set(k, [k, o, h, l, c]);
    else { d[2] = Math.max(d[2], h); d[3] = Math.min(d[3], l); d[4] = c; }
  });
  const all = [...days.values()].sort((a, b) => a[0] - b[0]);
  // Écarte les micro-bougies de week-end (quelques ticks, amplitude quasi nulle)
  const ranges = all.map((d) => d[2] - d[3]).sort((a, b) => a - b);
  const med = ranges[Math.floor(ranges.length / 2)] || 0;
  return all.filter((d) => d[2] - d[3] >= med * 0.1)
    .map((d) => [...d.map((v, i) => (i ? +v.toPrecision(7) : v)), fxDayEnd(d[0])]).slice(-40);
}

async function fetchOne(id) {
  try { return await fetchForex(id); } catch (e) { if (!['XAUUSD', 'BTCUSD', 'ETHUSD'].includes(id)) throw e; }
  // repli (or/crypto) : Daily Yahoo brutes si les barres 1h échouent
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
