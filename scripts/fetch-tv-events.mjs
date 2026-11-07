// Calendrier éco « fort impact » façon TradingView pour le module CANDLE (pastilles de news sur le graphique) :
// même source que le calendrier de TradingView (economic-calendar.tradingview.com, gratuit, en-tête Origin requis),
// historique depuis TV_FROM (défaut 2023-01-01) jusqu'à +TV_DAYS_AHEAD jours (défaut 120), importance 1 = High
// (annonces, discours, conférences de presse). Écrit data/tv-events.json (format compact).
// Si TradingView bloque, le script échoue sans toucher au fichier existant (le workflow l'appelle avec `|| true`).
//
// Format : { updated, events: [[t (s UTC), devise, titre, actual, forecast, previous], ...] } — valeurs déjà formatées
// comme à l'écran de TradingView (« 3.6% », « A$3.047B », « 58.3 », « » si vide).

import { readFile, writeFile } from 'node:fs/promises';

// 1er passage (ou TV_FULL=1) : tout l'historique ; ensuite on ne rafraîchit que les 10 derniers jours + le futur et on garde le reste
let previous = [];
try { previous = JSON.parse(await readFile('data/tv-events.json', 'utf-8')).events || []; } catch (e) { /* 1er passage */ }
const FULL = process.env.TV_FULL === '1' || previous.length < 50;
const FROM = FULL ? new Date(process.env.TV_FROM || '2023-01-01T00:00:00Z') : new Date(Date.now() - 10 * 86400000);
const AHEAD = Number(process.env.TV_DAYS_AHEAD || 120);
const END = new Date(Date.now() + AHEAD * 86400000);
const COUNTRIES = 'US,EU,GB,JP,AU,NZ,CA,CH';
const CHUNK_DAYS = 14;

function fmtVal(v, e) {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? String(v) : String(v);
  const unit = e.unit || '', scale = e.scale || '';
  if (unit === '%') return `${n}%`;
  if (unit && unit.length > 1 && /[A-Za-z$€£¥]/.test(unit) && !/^[A-Za-z]{3,}$/.test(unit)) return `${unit}${n}${scale}`;
  return `${n}${scale}${unit && unit !== '%' ? ' ' + unit : ''}`.trim();
}

const events = new Map();
const keyOf = (a) => `${a[0]}|${a[1]}|${a[2]}`;
if (!FULL) for (const a of previous) if (a[0] * 1000 < FROM.getTime()) events.set(keyOf(a), a); // anciens événements conservés tels quels
for (let t = FROM.getTime(); t < END.getTime(); t += CHUNK_DAYS * 86400000) {
  const from = new Date(t).toISOString(), to = new Date(Math.min(END.getTime(), t + CHUNK_DAYS * 86400000)).toISOString();
  const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${COUNTRIES}&minImportance=1`;
  let res;
  for (let k = 0; k < 3; k++) {
    res = await fetch(url, { headers: { Origin: 'https://www.tradingview.com', 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) break;
    await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
  }
  if (!res.ok) throw new Error(`TradingView HTTP ${res.status} (${from})`);
  for (const e of (await res.json()).result || []) {
    if (e.importance !== 1 || !e.date || !e.currency) continue;
    const ts = Math.floor(Date.parse(e.date) / 1000);
    events.set(`${ts}|${e.currency}|${e.title}`, [ts, e.currency, e.title, fmtVal(e.actual, e), fmtVal(e.forecast, e), fmtVal(e.previous, e)]);
  }
}
const list = [...events.values()].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
if (list.length < 50) throw new Error(`Trop peu d'événements (${list.length}) : fichier existant conservé`);
await writeFile('data/tv-events.json', JSON.stringify({ updated: new Date().toISOString(), events: list }));
console.log(`tv-events.json : ${list.length} événements High (${new Date(list[0][0] * 1000).toISOString().slice(0, 10)} → ${new Date(list[list.length - 1][0] * 1000).toISOString().slice(0, 10)})`);
