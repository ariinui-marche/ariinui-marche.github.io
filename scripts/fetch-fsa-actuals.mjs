// Complète 'actual' de data/eco-calendar.json depuis l'API Forex Smart Alert
// (même source que local/fsa-relay.mjs, mais côté GitHub Actions : le résultat
// est publié dans le JSON, donc visible sur mobile sans relais local).
// Non bloquant dans le workflow (`|| true`). FSA_DRY=1 : n'écrit rien.
import { readFile, writeFile } from 'node:fs/promises';

const DRY = process.env.FSA_DRY === '1';
const UPSTREAM = 'https://api.forexsmartalert.com/user/calendar.php';
const DAYS_BACK = 3;

const res = await fetch(UPSTREAM, {
  headers: { language: 'EN', platform: 'ANDROID', 'user-agent': 'Dart/3.7 (dart:io)', 'accept-encoding': 'gzip' },
  signal: AbortSignal.timeout(20000),
});
if (!res.ok) throw new Error(`FSA HTTP ${res.status}`);
const raw = await res.text();
const src = (JSON.parse(raw).data || []).map((e) => ({
  title: e.Name, currency: e.Currency, date: new Date(Number(e.Release) * 1000).toISOString(),
  actual: e.Actual || null, forecast: e.Forecast || null, previous: e.Previous || null,
}));

const num = (s) => {
  if (s == null || s === '') return null;
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};
const same = (a, b) => {
  const x = num(a), y = num(b);
  if (x == null || y == null) return null;
  return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
};
const tokens = (title) => new Set(String(title).toLowerCase().replace(/m\/m/g, 'mom').replace(/y\/y/g, 'yoy').replace(/q\/q/g, 'qoq')
  .replace(/prices/g, 'price').split(/[^a-z0-9]+/).filter((w) => w && !['final', 'prelim', 'adv', 'flash', 'the', 'of', 'non', 'farm'].includes(w)));

const file = JSON.parse(await readFile('data/eco-calendar.json', 'utf-8'));
const now = Date.now();
let filled = 0;
for (const ev of file.events) {
  const t0 = new Date(ev.date).getTime();
  if (isNaN(t0) || t0 > now || t0 < now - DAYS_BACK * 86400000) continue;
  if (ev.actual && String(ev.actual).trim() !== '') continue;
  const evTok = tokens(ev.title);
  let best = null;
  for (const t of src) {
    if (!t.actual || t.currency !== ev.country || Math.abs(new Date(t.date).getTime() - t0) > 10 * 60000) continue;
    const tt = tokens(t.title);
    const score = (same(ev.forecast, t.forecast) ? 2 : 0) + (same(ev.previous, t.previous) ? 2 : 0) + [...evTok].filter((w) => tt.has(w)).length;
    if (score >= 3 && (!best || score > best.score)) best = { t, score };
  }
  if (best) { console.log(`+ ${ev.date.slice(0, 16)} ${ev.country} ${ev.title} → ${best.t.actual}`); ev.actual = best.t.actual; filled++; }
}
if (filled && !DRY) await writeFile('data/eco-calendar.json', JSON.stringify(file, null, 2));
console.log(`FSA: ${src.length} événements reçus, ${filled} 'actual' ajouté(s)${DRY ? ' (dry-run)' : ''}`);
