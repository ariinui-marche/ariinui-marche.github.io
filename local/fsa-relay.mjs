// Relais PRIVÉ (localhost uniquement) : calendrier Forex Smart Alert -> Ariinui Marché.
// Usage personnel sur ce PC. Dossier `local/` ignoré par git : ne jamais le publier.
// Lancer : node local/fsa-relay.mjs   (ou local/start-relay.bat)
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const PORT = 8787;
const UPSTREAM = 'https://api.forexsmartalert.com/user/calendar.php';
const CACHE_MS = 8000;
const ORIGINS = new Set(['https://ariinui-marche.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765']);

let cache = { t: 0, body: null };

function fetchUpstream() {
  return new Promise((resolve, reject) => {
    const req = https.get(UPSTREAM, {
      headers: { language: 'EN', platform: 'ANDROID', 'user-agent': 'Dart/3.7 (dart:io)', 'accept-encoding': 'gzip' },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      const stream = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`HTTP ${res.statusCode}`))));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Normalise vers { title, currency, date (ISO), actual, forecast, previous, impact }
function normalize(raw) {
  const j = JSON.parse(raw);
  return (j.data || []).map((e) => ({
    id: e.Index,
    title: e.Name,
    currency: e.Currency,
    date: new Date(Number(e.Release) * 1000).toISOString(),
    actual: e.Actual || null,
    forecast: e.Forecast || null,
    previous: e.Previous || null,
    impact: e.Impact,
  }));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url.split('?')[0] !== '/calendar') { res.writeHead(404); return res.end(); }
  try {
    if (!cache.body || Date.now() - cache.t > CACHE_MS) {
      cache = { t: Date.now(), body: JSON.stringify({ result: normalize(await fetchUpstream()) }) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(cache.body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`FSA relay -> http://127.0.0.1:${PORT}/calendar`));
