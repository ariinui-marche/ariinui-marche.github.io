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
  // Source officielle GBP — communication gouvernementale, librement republiable
  { url: 'https://www.bankofengland.co.uk/rss/news', source: 'Bank of England' },
  { url: 'https://www.bankofengland.co.uk/rss/speeches', source: 'Bank of England' },
];

const REUTERS_QUERY =
  'site:reuters.com (intitle:forex OR intitle:currency OR intitle:currencies OR intitle:dollar OR intitle:yen OR intitle:euro OR intitle:sterling OR intitle:gold OR intitle:bitcoin) when:2d';

// Grands médias financiers (hors Reuters, déjà couvert séparément) — évite le
// bruit d'un Google News sans restriction de source (sport, actu générale...)
const GOOGLE_NEWS_QUERY =
  '(site:cnbc.com OR site:bloomberg.com OR site:wsj.com OR site:marketwatch.com OR site:forbes.com) ' +
  '(intitle:forex OR intitle:currency OR intitle:currencies OR intitle:dollar OR intitle:yen OR intitle:euro OR intitle:sterling OR intitle:gold OR intitle:bitcoin) when:1d';

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

async function fetchGoogleNewsFeed() {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(GOOGLE_NEWS_QUERY)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Google News RSS HTTP ${res.status}`);
  const xml = await res.text();
  return parseRSS(xml, 'Google News')
    .map((it) => ({ ...it, title: it.title.replace(/\s*-\s*(CNBC|Bloomberg\.com|WSJ|MarketWatch|Forbes)\s*$/i, '') }))
    .filter((it) => !/\|\s*Stock Price/i.test(it.title));
}

async function fetchMarketNews() {
  const feedFetches = [...NEWS_FEEDS.map(fetchOneFeed), fetchReutersFeed(), fetchGoogleNewsFeed()];
  const feedNames = [...NEWS_FEEDS.map((f) => f.source), 'Reuters', 'Google News'];
  const results = await Promise.allSettled(feedFetches);

  const items = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      items.push(...results[i].value);
    } else {
      console.error(`${feedNames[i]} fetch failed:`, results[i].reason.message);
    }
  }

  const valid = items
    .filter((it) => !isNaN(new Date(it.pubDate)))
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Répartition garantie par source : un flux peu fréquent (ex. Bank of England,
  // quelques posts/mois) se ferait sinon totalement éjecter par le tri global
  // face à des sources très actives (FXStreet, plusieurs/heure).
  const MIN_PER_SOURCE = 5;
  const TOTAL_CAP = 100;
  const guaranteed = [];
  const bySource = new Map();
  for (const it of valid) {
    const count = bySource.get(it.source) || 0;
    if (count < MIN_PER_SOURCE) {
      guaranteed.push(it);
      bySource.set(it.source, count + 1);
    }
  }
  const guaranteedLinks = new Set(guaranteed.map((it) => it.link));
  const remainingSlots = Math.max(0, TOTAL_CAP - guaranteed.length);
  const rest = valid.filter((it) => !guaranteedLinks.has(it.link)).slice(0, remainingSlots);

  return [...guaranteed, ...rest].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
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
