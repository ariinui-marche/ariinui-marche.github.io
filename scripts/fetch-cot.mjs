// CFTC Commitment of Traders — same source as TradeJournal Pro's api/cot-data.ts:
// CFTC Socrata Open Data (Legacy Futures Report), free, no API key, US government
// public data. COT reports publish weekly (Fridays) — this runs on a weekly cron,
// not the daily correlations cadence.

import { writeFile, mkdir } from 'node:fs/promises';

const SOCRATA_URL = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json';

const CONTRACTS = [
  'EURO FX', 'JAPANESE YEN', 'BRITISH POUND', 'SWISS FRANC',
  'CANADIAN DOLLAR', 'AUSTRALIAN DOLLAR', 'NEW ZEALAND DOLLAR',
  'GOLD', 'BITCOIN',
];

async function main() {
  await mkdir('data', { recursive: true });

  const whereClause = CONTRACTS.map((c) => `market_and_exchange_names like '%${c}%'`).join(' OR ');
  const params = new URLSearchParams({
    '$where': whereClause,
    '$order': 'report_date_as_yyyy_mm_dd DESC',
    '$limit': '500',
    '$select': [
      'market_and_exchange_names',
      'report_date_as_yyyy_mm_dd',
      'noncomm_positions_long_all',
      'noncomm_positions_short_all',
      'change_in_noncomm_long_all',
      'change_in_noncomm_short_all',
    ].join(','),
  });

  const res = await fetch(`${SOCRATA_URL}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CFTC Socrata HTTP ${res.status}`);
  const raw = await res.json();

  const timestamp = new Date().toISOString();
  await writeFile('data/cot-data.json', JSON.stringify({ timestamp, entries: raw }, null, 2));
  console.log(`cot-data.json written (${raw.length} entries)`);
}

main().catch((err) => {
  console.error('Fetch failed:', err);
  process.exit(1);
});
