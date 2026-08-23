// Étend automatiquement l'horizon futur du calendrier éco d'une semaine à chaque
// exécution (cron hebdomadaire), via l'Actor Apify scrapemint/forexfactory-economic-calendar
// — le même utilisé par fetch-actuals.mjs. Remplace le besoin de rattrapage manuel
// via navigateur connecté (fait une fois le 2026-08-22) : dorénavant la fenêtre
// future (~2 mois d'avance) se maintient toute seule, High impact uniquement.
//
// Format date/heure : vérifié que le 'date'+'time' de l'Actor correspond exactement
// à notre convention de stockage EDT (-04:00), aucune conversion nécessaire.
//
// Coût : ~5-10 événements High/semaine, largement sous le crédit gratuit Apify.

import { readFile, writeFile } from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN manquant (secret GitHub Actions)');

const file = JSON.parse(await readFile('data/eco-calendar.json', 'utf-8'));

const fmt = (d) => d.toISOString().slice(0, 10);
let startStr = process.env.RANGE_START_DATE;
let endStr = process.env.RANGE_END_DATE;

if (!startStr || !endStr) {
  const maxDate = file.events.reduce((max, e) => (e.date.slice(0, 10) > max ? e.date.slice(0, 10) : max), '0000-00-00');
  const startDate = new Date(`${maxDate}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  startStr = fmt(startDate);
  endStr = fmt(endDate);
}

console.log(`Récupération : ${startStr} → ${endStr}`);

const res = await fetch(
  `https://api.apify.com/v2/acts/scrapemint~forexfactory-economic-calendar/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      range: 'custom',
      startDate: startStr,
      endDate: endStr,
      impactLevels: ['high'],
      currencies: [],
    }),
  }
);
if (!res.ok) throw new Error(`Apify HTTP ${res.status}: ${await res.text()}`);
const items = await res.json();

function toIso(date, time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time || '').trim());
  if (!m) return `${date}T00:00:00-04:00`;
  return `${date}T${m[1].padStart(2, '0')}:${m[2]}:00-04:00`;
}

const eventKey = (e) => `${e.title}|${e.country}|${e.date.slice(0, 10)}`;

const existing = new Map(file.events.map((e) => [eventKey(e), e]));
let added = 0;
for (const it of items) {
  if (!it.title || !it.date) continue;
  const e = {
    title: it.title,
    country: it.currency,
    date: toIso(it.date, it.time),
    impact: it.impact === 'high' ? 'High' : it.impact === 'medium' ? 'Medium' : it.impact === 'low' ? 'Low' : it.impact,
    forecast: it.forecast || '',
    previous: it.previous || '',
    actual: it.actual || '',
  };
  const key = eventKey(e);
  if (!existing.has(key)) added++;
  existing.set(key, e);
}

file.events = [...existing.values()].sort((a, b) => new Date(a.date) - new Date(b.date));

await writeFile('data/eco-calendar.json', JSON.stringify(file, null, 2));
console.log(`Apify: ${items.length} événement(s) High reçus pour ${startStr}→${endStr}, ${added} nouveau(x) ajouté(s)`);
