// LOCAL-ONLY script — never runs in GitHub Actions, never committed/pushed.
// Fetches Reuters headlines via Google News RSS search (site:reuters.com).
//
// Google's feed terms restrict this to "rendering... within a personal feed
// reader for personal, non-commercial use" — running this yourself, on your
// own machine, for your own private viewing keeps it inside that scope.
// Writes to data/market-news-local.json, gitignored, read by script.js only
// if present (silently absent on the public ariinui-marche.github.io site).
//
// Run manually: node scripts/fetch-local-news.mjs
// Or schedule via Windows Task Scheduler if you want it to auto-refresh.

import { writeFile, mkdir } from 'node:fs/promises';

const QUERIES = [
  'site:reuters.com (intitle:forex OR intitle:currency OR intitle:currencies OR intitle:dollar OR intitle:yen OR intitle:euro OR intitle:sterling OR intitle:gold OR intitle:bitcoin) when:2d',
];

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseGoogleNewsRSS(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
      return m ? decodeEntities(m[1].trim()) : '';
    };
    let title = get('title');
    const link = get('link');
    const pubDate = get('pubDate');
    if (!title || !link) continue;
    // Google News appends " - Reuters" (or the source name) to every title
    title = title.replace(/\s*-\s*Reuters\s*$/i, '');
    // Ticker-quote landing pages, not real articles (e.g. "(GOLD.P) | Stock Price & Latest News")
    if (/\|\s*Stock Price/i.test(title)) continue;
    items.push({ title, link, pubDate: new Date(pubDate).toISOString(), description: '', source: 'Reuters' });
  }
  return items;
}

async function main() {
  await mkdir('data', { recursive: true });

  const results = await Promise.allSettled(
    QUERIES.map((q) =>
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then(parseGoogleNewsRSS),
    ),
  );

  const seen = new Set();
  const items = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') { console.error('Query failed:', r.reason.message); continue; }
    for (const it of r.value) {
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      items.push(it);
    }
  }
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const timestamp = new Date().toISOString();
  await writeFile('data/market-news-local.json', JSON.stringify({ timestamp, items }, null, 2));
  console.log(`market-news-local.json written (${items.length} Reuters items) — local only, never pushed`);
}

main().catch((err) => {
  console.error('Local Reuters fetch failed:', err);
  process.exit(1);
});
