// Récupère UNIQUEMENT la valeur 'actual' des événements High Impact du jour,
// via l'Actor Apify scrapemint/forexfactory-economic-calendar.
//
// Pourquoi Apify et pas un fetch direct : forexfactory.com/calendar est protégé
// par un challenge Cloudflare JS (testé : curl direct ET Playwright headless
// avec patches anti-détection échouent tous les deux, bloqués sur "Just a
// moment..."). L'Actor gère ce contournement pour nous.
//
// Pourquoi range:'custom' et pas 'today' : les ranges jour/semaine de l'Actor
// utilisent le même flux JSON gratuit que fetch-data.mjs (jamais d'actual) —
// seul le mode custom/mois parse la page HTML et retourne l'actual réel.
//
// Coût : impactLevels limité à High + 1 run/jour (cron dédié) pour rester très
// en dessous du crédit gratuit Apify de $5/mois (~$1,50/mois estimé, $15/1000
// lignes, quelques événements High/jour).

import { readFile, writeFile } from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN manquant (secret GitHub Actions)');

const today = new Date().toISOString().slice(0, 10);
const startDate = process.env.ACTUALS_START_DATE || today;
const endDate = process.env.ACTUALS_END_DATE || today;

const res = await fetch(
  `https://api.apify.com/v2/acts/scrapemint~forexfactory-economic-calendar/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      range: 'custom',
      startDate,
      endDate,
      impactLevels: ['high'],
      currencies: [],
    }),
  }
);
if (!res.ok) throw new Error(`Apify HTTP ${res.status}: ${await res.text()}`);
const items = await res.json();

const norm = (s) => (s || '').trim().toLowerCase();

// Groupé par titre+devise seulement : le jour calendaire d'un même événement peut
// différer d'1 jour entre le site (ex. release GBP à 02:00 EDT) et l'Actor
// (constaté : GBP Claimant Count Change daté 17/08 côté Actor vs 18/08 côté flux
// JSON qu'on utilise déjà). On tolère donc ±1 jour au moment du merge plutôt que
// d'exiger une date strictement identique.
const actualsByTitleCcy = new Map();
for (const it of items) {
  if (!it.actual) continue;
  const key = `${norm(it.title)}|${norm(it.currency)}`;
  const list = actualsByTitleCcy.get(key) || [];
  list.push({ date: new Date(`${it.date}T00:00:00Z`), actual: it.actual });
  actualsByTitleCcy.set(key, list);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const file = JSON.parse(await readFile('data/eco-calendar.json', 'utf-8'));
let updated = 0;
for (const ev of file.events) {
  const key = `${norm(ev.title)}|${norm(ev.country)}`;
  const candidates = actualsByTitleCcy.get(key);
  if (!candidates) continue;
  const evDate = new Date(`${ev.date.slice(0, 10)}T00:00:00Z`);
  const match = candidates.find((c) => Math.abs(c.date - evDate) <= ONE_DAY_MS);
  if (match && ev.actual !== match.actual) {
    ev.actual = match.actual;
    updated++;
  }
}

await writeFile('data/eco-calendar.json', JSON.stringify(file, null, 2));
console.log(`Apify: ${items.length} événement(s) High reçus, ${updated} 'actual' mis à jour dans eco-calendar.json`);
