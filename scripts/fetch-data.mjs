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

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRSS(xml, source) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
      return m ? decodeEntities(m[1].trim()) : '';
    };
    const title = get('title');
    const link = get('link');
    const pubDate = get('pubDate');
    const description = get('description').replace(/<[^>]+>/g, '').slice(0, 240);
    if (!title || !link) continue;
    items.push({ title, link, pubDate: new Date(pubDate).toISOString(), description, source });
  }
  return items;
}

const NEWS_FEEDS = [
  { url: 'https://www.fxstreet.com/rss/news', source: 'FXStreet' },
  { url: 'https://www.investing.com/rss/news.rss', source: 'Investing.com' },
  { url: 'https://beincrypto.com/feed/', source: 'BeInCrypto' },
];

const REUTERS_QUERY =
  'site:reuters.com (intitle:forex OR intitle:currency OR intitle:currencies OR intitle:dollar OR intitle:yen OR intitle:euro OR intitle:sterling OR intitle:gold OR intitle:bitcoin) when:2d';

async function fetchOneFeed({ url, source }) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${source} RSS HTTP ${res.status}`);
  const xml = await res.text();
  return parseRSS(xml, source);
}

async function fetchReutersFeed() {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(REUTERS_QUERY)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Reuters (Google News) RSS HTTP ${res.status}`);
  const xml = await res.text();
  return parseRSS(xml, 'Reuters')
    .map((it) => ({ ...it, title: it.title.replace(/\s*-\s*Reuters\s*$/i, '') }))
    .filter((it) => !/\|\s*Stock Price/i.test(it.title));
}

async function fetchMarketNews() {
  const feedFetches = [...NEWS_FEEDS.map(fetchOneFeed), fetchReutersFeed()];
  const feedNames = [...NEWS_FEEDS.map((f) => f.source), 'Reuters'];
  const results = await Promise.allSettled(feedFetches);

  const items = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      items.push(...results[i].value);
    } else {
      console.error(`${feedNames[i]} fetch failed:`, results[i].reason.message);
    }
  }

  return items
    .filter((it) => !isNaN(new Date(it.pubDate)))
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, 100);
}

async function main() {
  await mkdir('data', { recursive: true });
  const timestamp = new Date().toISOString();

  const [events, news] = await Promise.all([fetchEcoCalendar(), fetchMarketNews()]);

  await writeFile('data/eco-calendar.json', JSON.stringify({ timestamp, events }, null, 2));
  console.log(`eco-calendar.json written (${events.length} events)`);

  await writeFile('data/market-news.json', JSON.stringify({ timestamp, items: news }, null, 2));
  console.log(`market-news.json written (${news.length} items)`);
}

main().catch((err) => {
  console.error('Fetch failed:', err);
  process.exit(1);
});
