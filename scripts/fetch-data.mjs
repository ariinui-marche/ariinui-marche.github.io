// Fetches the economic calendar (ForexFactory) server-side via GitHub Actions,
// writes static JSON consumed by the static page.
// Force Devise is NOT fetched here: BabyPips blocks GitHub Actions IPs (Cloudflare 403,
// tested 2026-08-22) — that section is fetched live client-side via the whitelisted
// TradeJournal Pro Vercel proxy instead (see script.js).

import { writeFile, mkdir } from 'node:fs/promises';

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
  const events = await fetchEcoCalendar();
  await writeFile('data/eco-calendar.json', JSON.stringify({ timestamp, events }, null, 2));
  console.log(`eco-calendar.json written (${events.length} events)`);
}

main().catch((err) => {
  console.error('Eco calendar fetch failed:', err);
  process.exit(1);
});
