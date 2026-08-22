// Fetches currency strength (BabyPips MarketMilk) + economic calendar (ForexFactory)
// Runs server-side via GitHub Actions, writes static JSON consumed by the static page.

import { writeFile, mkdir } from 'node:fs/promises';

const BABYPIPS_API = 'https://marketmilk.babypips.com/api';
const BP_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json',
  'Origin': 'https://marketmilk.babypips.com',
  'Referer': 'https://marketmilk.babypips.com/',
};

const CURRENCIES_QUERY = `{
  currencies: symbols(listId: "fxcm:forex") {
    id
    name
    price
    change: indicator(streamId: REAL_TIME, indicator: {name: "change", period: ONE_DAY, clientId: "cchg"}) {
      indicator {
        ... on ChangeIndicator { raw pct pips }
      }
    }
  }
}`;

const CURRENCY_NAMES = {
  USD: 'Dollar US',
  EUR: 'Euro',
  GBP: 'Livre Sterling',
  JPY: 'Yen Japonais',
  CHF: 'Franc Suisse',
  AUD: 'Dollar Australien',
  CAD: 'Dollar Canadien',
  NZD: 'Dollar Néo-Zélandais',
};

async function fetchCurrencyStrength() {
  const res = await fetch(BABYPIPS_API, {
    method: 'POST',
    headers: BP_HEADERS,
    body: JSON.stringify({ query: CURRENCIES_QUERY }),
  });
  if (!res.ok) throw new Error(`BabyPips HTTP ${res.status}`);
  const json = await res.json();
  const raw = json?.data?.currencies || [];

  const changes = raw.map((c) => ({
    id: (c.id?.includes(':') ? c.id.split(':').pop() : c.id || '').toUpperCase(),
    name: CURRENCY_NAMES[(c.id?.includes(':') ? c.id.split(':').pop() : c.id || '').toUpperCase()] || c.name,
    changePct: (c.change?.indicator?.pct || 0) * 100,
  }));

  const pctValues = changes.map((c) => c.changePct);
  const min = Math.min(...pctValues);
  const max = Math.max(...pctValues);
  const range = max - min || 1;

  return changes
    .map((c) => ({
      id: c.id,
      name: c.name,
      score: Math.round(((c.changePct - min) / range) * 100),
      changePct: Number(c.changePct.toFixed(3)),
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

async function fetchEcoCalendar() {
  const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`ForexFactory HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error('eco-cal: invalid response (not array)');
  return raw
    .filter((e) => e.impact !== 'Non-Economic')
    .map((e) => ({
      title: e.title,
      country: e.country,
      date: e.date,
      impact: e.impact,
      forecast: e.forecast || '',
      previous: e.previous || '',
      actual: e.actual || '',
    }));
}

async function main() {
  await mkdir('data', { recursive: true });
  const timestamp = new Date().toISOString();

  const results = await Promise.allSettled([fetchCurrencyStrength(), fetchEcoCalendar()]);

  if (results[0].status === 'fulfilled') {
    await writeFile(
      'data/currency-strength.json',
      JSON.stringify({ timestamp, currencies: results[0].value }, null, 2),
    );
    console.log(`currency-strength.json written (${results[0].value.length} currencies)`);
  } else {
    console.error('Currency strength fetch failed:', results[0].reason);
  }

  if (results[1].status === 'fulfilled') {
    await writeFile(
      'data/eco-calendar.json',
      JSON.stringify({ timestamp, events: results[1].value }, null, 2),
    );
    console.log(`eco-calendar.json written (${results[1].value.length} events)`);
  } else {
    console.error('Eco calendar fetch failed:', results[1].reason);
  }

  if (results.every((r) => r.status === 'rejected')) {
    process.exit(1);
  }
}

main();
