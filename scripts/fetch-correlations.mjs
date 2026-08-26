// Live correlation checker — same method and pair catalog as TradeJournal Pro's
// Analytics "Corrélation" tab (LiveCorrelationChecker.tsx / api/live-correlation.ts):
// Yahoo Finance daily closes, Pearson correlation on daily returns. Run once/day
// via GitHub Actions (correlations move slowly) — writes data/correlations.json,
// consumed client-side alongside Currency Strength + COT + Economic Calendar to
// recommend a best trio, instantly and entirely client-side (no live API round-trip
// needed since the full 31-pair matrix is precomputed daily).

import { writeFile, mkdir } from 'node:fs/promises';

const YF_SYMBOL = {
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X',
  AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X',
  NZDUSD: 'NZDUSD=X',
  XAUUSD: 'GC=F', BTCUSD: 'BTC-USD', ETHUSD: 'ETH-USD',
  EURJPY: 'EURJPY=X', GBPJPY: 'GBPJPY=X', EURGBP: 'EURGBP=X',
  EURAUD: 'EURAUD=X', EURCAD: 'EURCAD=X', EURCHF: 'EURCHF=X', EURNZD: 'EURNZD=X',
  GBPAUD: 'GBPAUD=X', GBPCAD: 'GBPCAD=X', GBPCHF: 'GBPCHF=X', GBPNZD: 'GBPNZD=X',
  AUDJPY: 'AUDJPY=X', CADJPY: 'CADJPY=X', CHFJPY: 'CHFJPY=X', NZDJPY: 'NZDJPY=X',
  AUDCAD: 'AUDCAD=X', AUDCHF: 'AUDCHF=X', AUDNZD: 'AUDNZD=X',
  CADCHF: 'CADCHF=X', NZDCAD: 'NZDCAD=X', NZDCHF: 'NZDCHF=X',
};

const PAIRS = Object.keys(YF_SYMBOL);

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

async function fetchDailyCloses(pair) {
  const sym = YF_SYMBOL[pair];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=3mo`;
  const res = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) throw new Error(`${pair} (${sym}) Yahoo HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`${pair} (${sym}): empty chart result`);
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const out = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    out.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: closes[i] });
  }
  return out;
}

function dailyReturns(bars) {
  const map = new Map();
  for (let i = 1; i < bars.length; i++) {
    if (bars[i - 1].close === 0) continue;
    map.set(bars[i].date, (bars[i].close - bars[i - 1].close) / bars[i - 1].close);
  }
  return map;
}

function pearson(x, y) {
  const n = x.length;
  if (n < 10) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const ex = x[i] - mx, ey = y[i] - my;
    num += ex * ey; dx2 += ex * ex; dy2 += ey * ey;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? null : parseFloat((num / den).toFixed(2));
}

// Batches Yahoo requests (some hosts throttle bursts of 30+ concurrent requests)
async function fetchAllInBatches(pairs, batchSize = 8) {
  const results = new Array(pairs.length);
  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(fetchDailyCloses));
    settled.forEach((r, j) => { results[i + j] = r; });
  }
  return results;
}

async function main() {
  await mkdir('data', { recursive: true });

  const results = await fetchAllInBatches(PAIRS);
  const returnsByPair = {};
  for (let i = 0; i < PAIRS.length; i++) {
    if (results[i].status === 'fulfilled') {
      returnsByPair[PAIRS[i]] = dailyReturns(results[i].value);
    } else {
      console.error(`${PAIRS[i]} fetch failed:`, results[i].reason.message);
    }
  }

  const available = PAIRS.filter((p) => returnsByPair[p]);
  const combos = [];
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const pairA = available[i], pairB = available[j];
      const retA = returnsByPair[pairA], retB = returnsByPair[pairB];
      const common = [...retA.keys()].filter((d) => retB.has(d));
      const r = pearson(common.map((d) => retA.get(d)), common.map((d) => retB.get(d)));
      if (r !== null) combos.push({ pairA, pairB, r, commonDays: common.length });
    }
  }

  const timestamp = new Date().toISOString();
  await writeFile('data/correlations.json', JSON.stringify({ timestamp, pairs: available, combos }, null, 2));
  console.log(`correlations.json written (${available.length}/${PAIRS.length} pairs, ${combos.length} combos)`);
}

main().catch((err) => {
  console.error('Fetch failed:', err);
  process.exit(1);
});
