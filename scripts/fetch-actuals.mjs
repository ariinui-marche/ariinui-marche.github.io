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

const res = await fetch(
  `https://api.apify.com/v2/acts/scrapemint~forexfactory-economic-calendar/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      range: 'custom',
      startDate: today,
      endDate: today,
      impactLevels: ['high'],
      currencies: [],
    }),
  }
);
if (!res.ok) throw new Error(`Apify HTTP ${res.status}: ${await res.text()}`);
const items = await res.json();

const norm = (s) => (s || '').trim().toLowerCase();

const actualsByKey = new Map();
for (const it of items) {
  if (!it.actual) continue;
  actualsByKey.set(`${norm(it.title)}|${norm(it.currency)}|${it.date}`, it.actual);
}

const file = JSON.parse(await readFile('data/eco-calendar.json', 'utf-8'));
let updated = 0;
for (const ev of file.events) {
  const key = `${norm(ev.title)}|${norm(ev.country)}|${ev.date.slice(0, 10)}`;
  const actual = actualsByKey.get(key);
  if (actual && ev.actual !== actual) {
    ev.actual = actual;
    updated++;
  }
}

await writeFile('data/eco-calendar.json', JSON.stringify(file, null, 2));
console.log(`Apify: ${items.length} événement(s) High reçus, ${updated} 'actual' mis à jour dans eco-calendar.json`);
