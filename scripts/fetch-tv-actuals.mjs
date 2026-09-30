// Complète le champ 'actual' de data/eco-calendar.json depuis le calendrier public
// de TradingView (economic-calendar.tradingview.com/events) : gratuit, sans clé,
// l'actual y apparaît quelques minutes après la sortie — contrairement au flux
// ForexFactory gratuit (jamais d'actual) et à Apify (1 passage/jour).
//
// Endpoint non officiel : il exige l'en-tête Origin de tradingview.com. Testé
// depuis GitHub Actions (HTTP 200). Si TradingView le bloque un jour, ce script
// échoue sans conséquence (le workflow l'appelle avec `|| true`) et Apify reste
// le filet de sécurité.
//
// Rapprochement : les titres diffèrent entre FF et TV ("CPI m/m" vs "Inflation
// Rate MoM"), donc on apparie par devise + heure (±10 min) + valeurs forecast /
// previous numériquement identiques — jamais par le titre seul.
//
// Env : TV_DAYS_BACK (défaut 3), TV_DRY=1 (n'écrit rien), TV_COMPARE=1 (mode
// validation : rejoue aussi les événements qui ont déjà un actual et compare).

import { readFile, writeFile } from 'node:fs/promises';

const DAYS_BACK = Number(process.env.TV_DAYS_BACK || 3);
const DRY = process.env.TV_DRY === '1';
const COMPARE = process.env.TV_COMPARE === '1';
const TIME_TOL_MS = 10 * 60 * 1000;
const CURRENCY_TO_COUNTRY = { USD: 'US', EUR: 'EU', GBP: 'GB', JPY: 'JP', AUD: 'AU', NZD: 'NZ', CAD: 'CA', CHF: 'CH', CNY: 'CN' };

const now = Date.now();
const from = new Date(now - DAYS_BACK * 86400000).toISOString();
const to = new Date(now + 3600000).toISOString();
const url =
  `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}` +
  `&countries=${Object.values(CURRENCY_TO_COUNTRY).join(',')}`;

const res = await fetch(url, {
  headers: { Origin: 'https://www.tradingview.com', 'User-Agent': 'Mozilla/5.0' },
});
if (!res.ok) throw new Error(`TradingView HTTP ${res.status}`);
const tv = (await res.json()).result || [];

// "21.5K" → 21.5 ; "4.60%" → 4.6 ; "<1.25%" → 1.25 ; "" → null
function num(s) {
  if (s == null || s === '') return null;
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

// Compare une valeur FF (texte) à une valeur TV (nombre) ; null = non comparable.
function sameValue(ffText, tvVal) {
  const a = num(ffText);
  if (a == null || tvVal == null) return null;
  return close(a, tvVal);
}

// Met l'actual TV au même format que le forecast/previous FF (unité, décimales).
function formatLike(ev, tvActual) {
  const ref = [ev.forecast, ev.previous].find((v) => v && num(v) != null) || '';
  const m = String(ref).match(/-?\d+(?:\.(\d+))?\s*([A-Za-z%]*)/);
  const decimals = m && m[1] ? m[1].length : 0;
  const suffix = m ? m[2] : '';
  const body = m ? tvActual.toFixed(decimals) : String(tvActual);
  return `${body}${suffix}`;
}

function findMatch(ev) {
  const evTime = new Date(ev.date).getTime();
  let best = null;
  for (const t of tv) {
    if (t.currency !== ev.country || t.actual == null) continue;
    if (Math.abs(new Date(t.date).getTime() - evTime) > TIME_TOL_MS) continue;
    const f = sameValue(ev.forecast, t.forecast);
    const p = sameValue(ev.previous, t.previous);
    // Au moins une valeur comparable, aucune contradiction.
    if (f === false || p === false) continue;
    if (f == null && p == null) continue;
    const score = (f ? 1 : 0) + (p ? 1 : 0);
    if (!best || score > best.score) best = { t, score };
  }
  return best && best.t;
}

const file = JSON.parse(await readFile('data/eco-calendar.json', 'utf-8'));
let filled = 0, checked = 0, agree = 0;
const disagreements = [];
for (const ev of file.events) {
  const evTime = new Date(ev.date).getTime();
  if (isNaN(evTime) || evTime > now || evTime < now - DAYS_BACK * 86400000) continue;
  if (ev.impact !== 'High') continue;
  const hasActual = ev.actual && String(ev.actual).trim() !== '';
  if (hasActual && !COMPARE) continue;
  const m = findMatch(ev);
  if (!m) continue;
  const formatted = formatLike(ev, m.actual);
  if (hasActual) {
    checked++;
    if (num(ev.actual) === num(formatted) || close(num(ev.actual), num(formatted))) agree++;
    else disagreements.push(`${ev.date.slice(0, 16)} ${ev.country} ${ev.title}: FF/Apify=${ev.actual} TV=${formatted}`);
    continue;
  }
  console.log(`+ ${ev.date.slice(0, 16)} ${ev.country} ${ev.title} → ${formatted}  (TV: "${m.title}")`);
  ev.actual = formatted;
  filled++;
}

if (COMPARE) {
  console.log(`Validation : ${checked} événement(s) déjà connus retrouvés côté TV, ${agree} identiques.`);
  disagreements.forEach((d) => console.log('  ≠', d));
}
if (filled && !DRY) await writeFile('data/eco-calendar.json', JSON.stringify(file, null, 2));
console.log(`TradingView: ${tv.length} événements reçus, ${filled} 'actual' ajouté(s)${DRY ? ' (dry-run)' : ''}`);
