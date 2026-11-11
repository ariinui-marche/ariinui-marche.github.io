// Sources officielles dédiées à une seule devise par nature
const SOURCE_CURRENCY = {
  'Bank of England': 'GBP',
  'Federal Reserve': 'USD',
  'European Central Bank': 'EUR',
  'Bank of Japan': 'JPY',
  'Reserve Bank of Australia': 'AUD',
  'Bank of Canada': 'CAD',
  'Swiss National Bank': 'CHF',
};

// ── Focus devise : la devise du prochain event High pilote la page ──
let focusMode = true; // toujours activé à l'ouverture ; l'interrupteur ne vaut que pour la session en cours
let focusCcys = [];
let lastCurrencyData;
let lastTrendData;
const focusActive = () => focusMode && focusCcys.length > 0;
const inFocus = (ccy) => !focusActive() || focusCcys.includes(ccy);

const CURRENCY_FLAGS = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  CHF: '🇨🇭', AUD: '🇦🇺', CAD: '🇨🇦', NZD: '🇳🇿',
};

const COUNTRY_FLAGS = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  AUD: '🇦🇺', NZD: '🇳🇿', CAD: '🇨🇦', CHF: '🇨🇭', CNY: '🇨🇳',
};

function scoreColor(score) {
  if (score >= 70) return 'var(--green)';
  if (score >= 45) return '#a3e635';
  if (score >= 30) return 'var(--orange)';
  return 'var(--red)';
}

async function loadJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const CURRENCY_NAMES = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', JPY: 'Japanese Yen',
  CHF: 'Swiss Franc', AUD: 'Australian Dollar', CAD: 'Canadian Dollar', NZD: 'New Zealand Dollar',
};

// Force Devise: live proxy déjà utilisé par TradeJournal Pro (BabyPips bloque les IPs
// cloud génériques type GitHub Actions, ce proxy Vercel est whitelisté — voir décision session)
const MARKET_DATA_URL = 'https://ariinuiirgina.vercel.app/api/market-data';

async function fetchMarketRaw() {
  const res = await fetch(MARKET_DATA_URL);
  if (!res.ok) throw new Error(`market-data: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json?.data || {};
}

function computeCurrencyStrength(raw) {
  const rawCurrencies = raw?.currencies || [];

  const changes = rawCurrencies.map((c) => {
    const id = (c.id?.includes(':') ? c.id.split(':').pop() : c.id || '').toUpperCase();
    return { id, name: CURRENCY_NAMES[id] || c.name, changePct: (c.change?.indicator?.pct || 0) * 100 };
  }).filter((c) => CURRENCY_NAMES[c.id]); // garde les 8 devises forex, écarte XAU/BTC de cette section

  const pctValues = changes.map((c) => c.changePct);
  const min = Math.min(...pctValues);
  const max = Math.max(...pctValues);
  const range = max - min || 1;

  const currencies = changes
    .map((c) => ({
      id: c.id,
      name: c.name,
      score: Math.round(((c.changePct - min) / range) * 100),
      changePct: c.changePct,
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  return { timestamp: new Date().toISOString(), currencies };
}

// ── Trend Momentum — per-currency score (0-100) + 4-tier label (Very
// Bearish/Bearish/Bullish/Very Bullish), same live/dynamic min-max scoring
// pattern as Currency Strength, but driven by price distance vs a fast SMA
// (50) and a slow SMA (200) instead of the 1D %change — using sma50/sma200
// pct already present in the same /api/market-data payload (same pairs
// array already fetched for Currency Strength — no extra proxy call).
function momentumLabel(score) {
  if (score >= 70) return 'Very Bullish';
  if (score >= 45) return 'Bullish';
  if (score >= 30) return 'Bearish';
  return 'Very Bearish';
}

function computeTrendMomentum(raw) {
  const pairs = raw?.pairs || [];
  const acc = {};
  Object.keys(CURRENCY_NAMES).forEach((code) => { acc[code] = { fast: [], slow: [] }; });

  pairs.forEach((p) => {
    const rawId = p.id || '';
    const id = (rawId.includes(':') ? rawId.split(':').pop() : rawId).toUpperCase();
    if (id.length !== 6) return; // écarte tout id qui n'est pas une paire base/quote à 3+3
    const base = id.slice(0, 3);
    const quote = id.slice(3, 6);
    const fast = p.sma50?.indicator?.pct;  // écart prix vs SMA rapide
    const slow = p.sma200?.indicator?.pct; // écart prix vs SMA lente
    // Base et quote héritent du même écart, mais en signe opposé pour la quote
    // (une paire haussière = base fort / quote faible).
    if (acc[base]) {
      if (typeof fast === 'number') acc[base].fast.push(fast);
      if (typeof slow === 'number') acc[base].slow.push(slow);
    }
    if (acc[quote]) {
      if (typeof fast === 'number') acc[quote].fast.push(-fast);
      if (typeof slow === 'number') acc[quote].slow.push(-slow);
    }
  });

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const combined = Object.entries(acc)
    .map(([id, v]) => ({ id, name: CURRENCY_NAMES[id], fast: avg(v.fast), slow: avg(v.slow) }))
    // Fast (SMA50) pondéré plus fort que Slow (SMA200) — sinon le score bouge à peine
    // d'un rechargement à l'autre sur plusieurs jours (SMA200 quasi figée par nature).
    .map((c) => ({ ...c, raw: c.fast * 0.7 + c.slow * 0.3 }));

  const rawValues = combined.map((c) => c.raw);
  const min = Math.min(...rawValues);
  const max = Math.max(...rawValues);
  const range = max - min || 1;

  const currencies = combined
    .map((c) => ({ ...c, score: Math.round(((c.raw - min) / range) * 100), rank: 0 }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  return { timestamp: new Date().toISOString(), currencies };
}

function renderTrendMomentum(data) {
  lastTrendData = data;
  const grid = document.getElementById('trendGrid');
  if (!grid) return;
  if (!data?.currencies?.length) {
    grid.innerHTML = '<div class="empty-state">Data unavailable</div>';
    return;
  }
  grid.innerHTML = data.currencies.map((c) => {
    const label = momentumLabel(c.score);
    return `
      <div class="trend-card">
        <div class="row1">
          <span><span class="flag">${CURRENCY_FLAGS[c.id] || ''}</span> <span class="id">${c.id}</span></span>
          <span class="rank">#${c.rank}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${c.score}%; background:${scoreColor(c.score)}"></div>
        </div>
        <div class="stats">
          <span>${c.score}/100</span>
          <span class="trend-badge" style="color:${scoreColor(c.score)}">${label}</span>
        </div>
      </div>`;
  }).join('');
  parseEmoji(grid);
}

function renderCurrencies(data) {
  lastCurrencyData = data;
  const grid = document.getElementById('currencyGrid');
  if (!data?.currencies?.length) {
    grid.innerHTML = '<div class="empty-state">Data unavailable</div>';
    return;
  }
  grid.innerHTML = data.currencies.map((c) => {
    const pctClass = c.changePct >= 0 ? 'pct-pos' : 'pct-neg';
    const pctSign = c.changePct >= 0 ? '+' : '';
    return `
      <div class="currency-card">
        <div class="row1">
          <span><span class="flag">${CURRENCY_FLAGS[c.id] || ''}</span> <span class="id">${c.id}</span></span>
          <span class="rank">#${c.rank}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${c.score}%; background:${scoreColor(c.score)}"></div>
        </div>
        <div class="stats">
          <span>${c.score}/100</span>
          <span class="${pctClass}">${pctSign}${c.changePct.toFixed(2)}%</span>
        </div>
      </div>`;
  }).join('');
  parseEmoji(grid);
}

function parseEmoji(el) {
  if (window.twemoji) twemoji.parse(el, { folder: 'svg', ext: '.svg' });
}

// ── Live Correlation — pick 2-3 pairs, see if they move together ────────
// Direct correlation checker: pick exactly the pairs you're considering
// trading (2 or 3) and a timeframe, see the correlation strength between
// them — avoids accidentally trading pairs that move in the same direction
// (double exposure) or missing an easy hedge.
// Data: Yahoo Finance (Pearson), fetched on demand — only when a pair or
// timeframe button is pressed, never polled — via TradeJournal Pro's
// api/live-correlation.ts (same Vercel proxy already used for Currency
// Strength above; Yahoo Finance blocks direct browser calls via CORS,
// confirmed by testing — a server proxy is required). Timeframe options
// mirror myfxbook's correlation tool (5min…1 month) — same method (Pearson
// on Yahoo Finance price data) but a different underlying feed than
// myfxbook's own broker ticks, so expect similar but not identical numbers.

const LIVE_CORR_URL = 'https://ariinuiirgina.vercel.app/api/live-correlation';

const CORR_TIMEFRAMES = [
  { id: '5m', label: '5 min' },
  { id: '15m', label: '15 min' },
  { id: '30m', label: '30 min' },
  { id: '1h', label: '1 hour' },
  { id: '4h', label: '4 hours' },
  { id: '1d', label: '1 day' },
  { id: '1w', label: '1 week' },
  { id: '1mo', label: '1 month' },
];

const CORR_ALL_PAIRS = [
  { id: 'EURUSD', label: 'EUR/USD', category: 'Major' },
  { id: 'GBPUSD', label: 'GBP/USD', category: 'Major' },
  { id: 'USDJPY', label: 'USD/JPY', category: 'Major' },
  { id: 'AUDUSD', label: 'AUD/USD', category: 'Major' },
  { id: 'USDCAD', label: 'USD/CAD', category: 'Major' },
  { id: 'USDCHF', label: 'USD/CHF', category: 'Major' },
  { id: 'NZDUSD', label: 'NZD/USD', category: 'Major' },
  { id: 'XAUUSD', label: 'XAU/USD', category: 'Metal' },
  { id: 'BTCUSD', label: 'BTC/USD', category: 'Crypto' },
  { id: 'ETHUSD', label: 'ETH/USD', category: 'Crypto' },
  { id: 'EURJPY', label: 'EUR/JPY', category: 'Cross' },
  { id: 'GBPJPY', label: 'GBP/JPY', category: 'Cross' },
  { id: 'EURGBP', label: 'EUR/GBP', category: 'Cross' },
  { id: 'EURAUD', label: 'EUR/AUD', category: 'Cross' },
  { id: 'EURCAD', label: 'EUR/CAD', category: 'Cross' },
  { id: 'EURCHF', label: 'EUR/CHF', category: 'Cross' },
  { id: 'EURNZD', label: 'EUR/NZD', category: 'Cross' },
  { id: 'GBPAUD', label: 'GBP/AUD', category: 'Cross' },
  { id: 'GBPCAD', label: 'GBP/CAD', category: 'Cross' },
  { id: 'GBPCHF', label: 'GBP/CHF', category: 'Cross' },
  { id: 'GBPNZD', label: 'GBP/NZD', category: 'Cross' },
  { id: 'AUDJPY', label: 'AUD/JPY', category: 'Cross' },
  { id: 'CADJPY', label: 'CAD/JPY', category: 'Cross' },
  { id: 'CHFJPY', label: 'CHF/JPY', category: 'Cross' },
  { id: 'NZDJPY', label: 'NZD/JPY', category: 'Cross' },
  { id: 'AUDCAD', label: 'AUD/CAD', category: 'Minor' },
  { id: 'AUDCHF', label: 'AUD/CHF', category: 'Minor' },
  { id: 'AUDNZD', label: 'AUD/NZD', category: 'Minor' },
  { id: 'CADCHF', label: 'CAD/CHF', category: 'Minor' },
  { id: 'NZDCAD', label: 'NZD/CAD', category: 'Minor' },
  { id: 'NZDCHF', label: 'NZD/CHF', category: 'Minor' },
];
const CORR_DEFAULT_COUNT = 10;
const CORR_MIN_SELECT = 2;
const CORR_MAX_SELECT = 3;

let corrSelected = new Set(); // empty by default — pick the exact pairs you're weighing
let corrShowAllPairs = false;
let corrTimeframe = '1d';
let corrLoading = false;
let corrError = null;
let corrCombos = null; // [{pairA,pairB,r}] from the last successful live fetch
let corrFetchSeq = 0; // guards against a stale response overwriting a newer one

function corrLevel(r) {
  if (r >= 0.7) return 'DANGER';
  if (r >= 0.4) return 'ATTENTION';
  if (r >= -0.4) return 'OK';
  if (r >= -0.7) return 'DIVERSIFIED';
  return 'HEDGE';
}

const CORR_LEVEL_COLOR = {
  DANGER: 'var(--red)', ATTENTION: 'var(--orange)', OK: '#a3e635',
  DIVERSIFIED: 'var(--green)', HEDGE: 'var(--green)',
};

// Plain-language reading of what the correlation means for trading both pairs
// at once — same phrasing logic as TradeJournal Pro's api/live-correlation.ts.
function corrAdvice(pairA, pairB, r, level) {
  const pct = Math.round(Math.abs(r) * 100);
  switch (level) {
    case 'DANGER':
      return `${pairA} and ${pairB} move in the same direction ${pct}% of the time. Opening both in the same direction doubles your real risk. Reduce size on one, or avoid holding both at once.`;
    case 'ATTENTION':
      return `Moderate correlation (${pct}%). ${pairA} and ${pairB} tend to follow each other partially. If you trade both, reduce your total exposure on the shared currency.`;
    case 'OK':
      return `${pairA} and ${pairB} move independently. You can trade both at the same time without significant double-exposure risk.`;
    case 'DIVERSIFIED':
      return `Good diversification. ${pairA} and ${pairB} tend to move in opposite directions (${pct}% opposition), which naturally reduces your overall risk.`;
    case 'HEDGE':
      return `${pairA} and ${pairB} move in opposite directions ${pct}% of the time — an excellent natural hedge. A position on each protects the other in a market shock.`;
  }
}

function corrGlobalVerdict(combos) {
  const dangers = combos.filter((c) => c.level === 'DANGER');
  const attentions = combos.filter((c) => c.level === 'ATTENTION');
  const hedges = combos.filter((c) => c.level === 'HEDGE' || c.level === 'DIVERSIFIED');
  if (dangers.length > 0) {
    const names = [...new Set(dangers.flatMap((c) => [c.a, c.b]))];
    return { text: `⚠️ Double-exposure risk on: ${names.join(', ')}. Check they don't share the same pivot currency before trading — reduce size or pick only one.`, color: 'var(--red)' };
  }
  if (attentions.length > 0) {
    return { text: 'Generally acceptable, but watch the combination(s) marked ATTENTION — adjust position size to avoid concentration.', color: 'var(--orange)' };
  }
  if (hedges.length >= Math.ceil(combos.length / 2)) {
    return { text: 'Strong natural diversification — these pairs offset each other, reducing overall drawdown in an adverse move.', color: 'var(--green)' };
  }
  return { text: 'Safe basket — all combinations are independent, you can trade them simultaneously without significant correlation risk.', color: 'var(--green)' };
}

// ── Rendering ─────────────────────────────────────────────────────────

function corrPickerHtml() {
  const visible = corrShowAllPairs ? CORR_ALL_PAIRS : CORR_ALL_PAIRS.slice(0, CORR_DEFAULT_COUNT);
  const chips = visible.map((p) => {
    const isSel = corrSelected.has(p.id);
    const isDisabled = !isSel && corrSelected.size >= CORR_MAX_SELECT;
    const cls = ['corr-chip', isSel ? 'corr-chip-selected' : '', isDisabled ? 'corr-chip-disabled' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-pair="${p.id}" ${isDisabled ? 'disabled' : ''}>
      <span class="corr-chip-label">${p.label}</span>
      <span class="corr-chip-cat">${p.category}</span>
    </button>`;
  }).join('');

  const selectedChips = [...corrSelected].map((id) => `<button type="button" class="corr-selected-chip" data-remove="${id}">${id} ×</button>`).join('');

  const timeframeChips = CORR_TIMEFRAMES.map((t) => `
    <button type="button" class="corr-tf-chip ${t.id === corrTimeframe ? 'corr-tf-selected' : ''}" data-tf="${t.id}">${t.label}</button>`).join('');

  return `
    <div class="corr-picker-grid">${chips}</div>
    <button type="button" id="corrShowMoreBtn" class="corr-showmore">
      ${corrShowAllPairs ? '▲ Hide extra pairs' : `▼ Show ${CORR_ALL_PAIRS.length - CORR_DEFAULT_COUNT} more pairs (crosses & minors)`}
    </button>
    <div class="corr-section-label">Timeframe</div>
    <div class="corr-tf-grid">${timeframeChips}</div>
    <div class="corr-selbar">
      <div class="corr-selbar-left">
        ${corrSelected.size === 0
          ? `<span class="corr-selbar-empty">Select ${CORR_MIN_SELECT}-${CORR_MAX_SELECT} pairs to check</span>`
          : `<span class="corr-selbar-count"><b>${corrSelected.size}</b> pair${corrSelected.size > 1 ? 's' : ''}</span><div class="corr-selected-chips">${selectedChips}</div><button type="button" id="corrClearBtn" class="corr-clear">Clear</button>`}
      </div>
    </div>`;
}

function corrResultHtml() {
  if (corrSelected.size < CORR_MIN_SELECT) return '';
  if (corrLoading) return '<div class="corr-loading">Checking correlation…</div>';
  if (corrError) return `<div class="empty-state">${corrError}</div>`;
  if (!corrCombos?.length) return '';

  const combos = corrCombos.map((c) => ({ a: c.pairA, b: c.pairB, r: c.r, rTrend: c.rTrend, level: corrLevel(c.r) }));

  const rows = combos.map((c) => `
    <div class="corr-combo-card">
      <div class="corr-r-row">
        <span class="corr-r-pairs">${c.a} × ${c.b}</span>
        <span class="corr-r-value" style="color:${CORR_LEVEL_COLOR[c.level]}">${c.r >= 0 ? '+' : ''}${c.r.toFixed(2)}</span>
        <span class="corr-r-badge" style="color:${CORR_LEVEL_COLOR[c.level]}">${c.level}</span>
      </div>
      <div class="corr-advice">${corrAdvice(c.a, c.b, c.r, c.level)}</div>
      ${typeof c.rTrend === 'number' ? `<div class="corr-trend">Trend correlation (price levels, myfxbook-style): <b>${c.rTrend >= 0 ? '+' : ''}${c.rTrend.toFixed(2)}</b> — often higher, inflated by a shared macro trend rather than real day-to-day co-movement.</div>` : ''}
    </div>`).join('');

  const verdict = combos.length > 1 ? corrGlobalVerdict(combos) : null;

  return `
    ${verdict ? `<div class="corr-verdict" style="border-color:${verdict.color};color:${verdict.color}">${verdict.text}</div>` : ''}
    ${rows}`;
}

function renderCorrelation() {
  try {
    corrRenderBody();
  } catch (err) {
    console.error('renderCorrelation failed, hiding panel', err);
    document.getElementById('corrBody').innerHTML = '<div class="empty-state">Data unavailable</div>';
  }
}

function corrRenderBody() {
  const body = document.getElementById('corrBody');
  body.innerHTML = `
    <div class="corr-intro">Pick 2 or 3 pairs and a timeframe to see how correlated they are, so you don't accidentally trade two or three pairs moving in the same direction at once. Two numbers are shown: the main one (returns-based, same method as TradingView/OANDA) is what matters for double-exposure risk; the trend one (price-level based, myfxbook-style) is shown alongside for reference — it reads higher during trending months, even between pairs that don't really move together day to day.</div>
    ${corrPickerHtml()}
    ${corrResultHtml()}
    <div class="corr-footer">Pearson correlation, Yahoo Finance, fetched live on selection · 31-pair catalog</div>`;

  corrBindPickerEvents();
}

async function corrFetchIfReady() {
  if (corrSelected.size < CORR_MIN_SELECT) {
    corrCombos = null;
    corrError = null;
    corrLoading = false;
    corrRenderBody();
    return;
  }
  const seq = ++corrFetchSeq;
  corrLoading = true;
  corrError = null;
  corrRenderBody();
  try {
    const url = `${LIVE_CORR_URL}?pairs=${[...corrSelected].join(',')}&timeframe=${corrTimeframe}`;
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (seq !== corrFetchSeq) return; // a newer selection/timeframe change superseded this request
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    corrCombos = (body.combos || []).filter((c) => typeof c.r === 'number');
  } catch (err) {
    if (seq !== corrFetchSeq) return;
    console.error('Live correlation fetch failed', err);
    corrError = 'Live correlation unavailable right now — try again in a moment.';
    corrCombos = null;
  } finally {
    if (seq === corrFetchSeq) corrLoading = false;
    corrRenderBody();
  }
}

function corrBindPickerEvents() {
  const body = document.getElementById('corrBody');
  body.querySelectorAll('.corr-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pair;
      if (corrSelected.has(id)) corrSelected.delete(id);
      else if (corrSelected.size < CORR_MAX_SELECT) corrSelected.add(id);
      corrFetchIfReady();
    });
  });
  body.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      corrSelected.delete(btn.dataset.remove);
      corrFetchIfReady();
    });
  });
  body.querySelectorAll('.corr-tf-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      corrTimeframe = btn.dataset.tf;
      corrFetchIfReady();
    });
  });
  document.getElementById('corrShowMoreBtn')?.addEventListener('click', () => {
    corrShowAllPairs = !corrShowAllPairs;
    corrRenderBody();
  });
  document.getElementById('corrClearBtn')?.addEventListener('click', () => {
    corrSelected.clear();
    corrFetchIfReady();
  });
}

document.getElementById('corrToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('corrBody').classList.toggle('collapsed', expanded);
});

// ── Charts — pick one pair, get its Daily/4H/1H TradingView charts stacked ──
// Same pair catalog as Live Correlation (CORR_ALL_PAIRS/CORR_DEFAULT_COUNT
// above). Each chart is TradingView's script-embed "Advanced Chart" widget
// (an iframe under the hood, not the TV.js container_id API that never
// worked in this project — see feedback_tradingview_charts). Charts are
// only ever created in response to a pair click, which can only happen
// once this panel is already open and visible, so there's no risk of the
// 0×0-on-hidden-container issue the lazy-loaded TradingView News widget has.

function tvSymbolFor(id) {
  if (id === 'XAUUSD') return 'OANDA:XAUUSD';
  if (id === 'BTCUSD') return 'COINBASE:BTCUSD';
  if (id === 'ETHUSD') return 'COINBASE:ETHUSD';
  return `FX:${id}`;
}

const CHART_TIMEFRAMES = [
  { interval: 'D', label: 'Daily' },
];

function chartBlockHtml(symbol, label) {
  const symbolPath = symbol.replace(':', '-');
  return `
    <div class="chart-block">
      <div class="chart-block-label">${label}</div>
      <div class="tv-chart-widget">
        <div class="tradingview-widget-container" style="height:100%;width:100%">
          <div class="tradingview-widget-container__widget" style="height:calc(100% - 32px);width:100%"></div>
          <div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/symbols/${symbolPath}/" rel="noopener nofollow" target="_blank"><span class="blue-text">${symbol} chart</span></a><span class="trademark"> by TradingView</span></div>
        </div>
      </div>
    </div>`;
}

// Liste unique, une colonne : nom du symbole + bougies Daily dessinées en SVG
// (données data/daily-candles.json, mises à jour par GitHub Actions). Triées à
// l'ouverture du panneau : 2 dernières bougies clôturées (hier + avant-hier)
// haussières → baissières → autres. Un clic ouvre les graphiques TradingView.

let chartsSelectedPair = null;
let chartsCandles = null;
let chartsEco = []; // événements High + Medium du calendrier éco (lignes verticales + bulles)

// Clé de jour FX (identique à scripts/fetch-candles.mjs) : la journée bascule à 17h New York,
// la bougie est étiquetée par minuit UTC de sa date.
const CHARTS_NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
function chartsDayKey(tsSec) {
  const p = Object.fromEntries(CHARTS_NY.formatToParts(new Date(tsSec * 1000)).map((x) => [x.type, x.value]));
  return Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour + 7) / 86400000) * 86400;
}

// Index des annonces High + Medium par « devise|jour FX » (lignes verticales + bulles drapeau).
const CHARTS_MAJORS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];
let chartsEcoIndex = new Map();
function chartsBuildEcoIndex() {
  chartsEcoIndex = new Map();
  for (const e of chartsEco) {
    const k = `${e.country}|${chartsDayKey(new Date(e.date).getTime() / 1000)}`;
    if (!chartsEcoIndex.has(k)) chartsEcoIndex.set(k, []);
    chartsEcoIndex.get(k).push(e);
  }
}
// Devises d'une paire qui comptent (XAU / BTC / ETH : seulement USD)
function chartsPairCcys(pairId) {
  return [pairId.slice(0, 3), pairId.slice(3, 6)].filter((c) => CHARTS_MAJORS.includes(c));
}
// Jours (clés de bougie) où une annonce High/Medium d'une des devises de la paire a eu lieu
function chartsEcoDays(pairId) {
  const days = new Set();
  for (const c of chartsPairCcys(pairId)) {
    for (const k of chartsEcoIndex.keys()) if (k.startsWith(c + '|')) days.add(+k.slice(4));
  }
  return days;
}

// Lignes verticales pointillées des jours d'annonces (derrière les bougies, jusqu'aux bulles).
// Un seul élément par jour ; sa position est calée sur un pixel entier (chartsSnapLines) pour un trait net.
function chartsLinesHtml(series, pairId) {
  const closed = chartsClosed(series).slice(-30);
  const days = chartsEcoDays(pairId);
  const W = 600, PAD = 8, step = (W - 2 * PAD) / closed.length;
  const spans = closed.map((c, i) => days.has(c[0])
    ? `<span class="cd-evline" data-pct="${((PAD + step * (i + 0.5)) / W * 100).toFixed(3)}"></span>` : '').join('');
  return `<div class="cd-lines">${spans}</div>`;
}
function chartsSnapLines() {
  document.querySelectorAll('.cd-lines').forEach((box) => {
    const w = box.clientWidth;
    box.querySelectorAll('.cd-evline').forEach((l) => { l.style.left = Math.round(+l.dataset.pct / 100 * w) + 'px'; });
  });
}
let chartsSnapTimer = null;
window.addEventListener('resize', () => { clearTimeout(chartsSnapTimer); chartsSnapTimer = setTimeout(chartsSnapLines, 120); });

// Bandeau de bulles drapeau sous le graphique (style TradingView) : une rangée par devise,
// bulle rouge = High, orange = Medium. Clic / toucher = infobulle avec les annonces du jour.
function chartsEvStrip(series, pairId) {
  const closed = chartsClosed(series).slice(-30);
  const ccys = chartsPairCcys(pairId);
  if (!closed.length || !ccys.length) return '';
  const W = 600, PAD = 8, step = (W - 2 * PAD) / closed.length;
  let bubbles = '';
  ccys.forEach((ccy, row) => {
    closed.forEach((c, i) => {
      const evs = chartsEcoIndex.get(`${ccy}|${c[0]}`);
      if (!evs) return;
      const high = evs.some((e) => e.impact === 'High');
      const left = ((PAD + step * (i + 0.5)) / W * 100).toFixed(2);
      bubbles += `<button type="button" class="cd-bub ${high ? 'cd-bub-high' : 'cd-bub-med'}" style="left:${left}%;--row:${row}" data-ccy="${ccy}" data-key="${c[0]}" aria-label="${ccy} announcements">${COUNTRY_FLAGS[ccy] || ''}</button>`;
    });
  });
  return `<div class="cd-evstrip" style="--rows:${ccys.length}">${bubbles}</div>`;
}

const chartsEsc = (t) => String(t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function chartsShowEvCard(bub) {
  const strip = bub.closest('.cd-evstrip');
  const had = strip.querySelector('.cd-evcard');
  strip.parentElement.parentElement.querySelectorAll('.cd-evcard').forEach((c) => c.remove());
  document.querySelectorAll('.cd-bub-on').forEach((b) => b.classList.remove('cd-bub-on'));
  if (had && had.dataset.for === bub.dataset.ccy + bub.dataset.key) return; // 2e clic = fermer
  const evs = (chartsEcoIndex.get(`${bub.dataset.ccy}|${bub.dataset.key}`) || []).slice()
    .sort((a, b) => (b.impact === 'High') - (a.impact === 'High') || new Date(a.date) - new Date(b.date));
  const day = new Date(+bub.dataset.key * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  const val = (l, v) => (v ? `<span>${l} <b>${chartsEsc(v)}</b></span>` : '');
  const rows = evs.slice(0, 8).map((e) => {
    const t = new Date(e.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const nums = val('A', e.actual) + val('F', e.forecast) + val('P', e.previous);
    return `<div class="cd-evrow"><span class="cd-evdot ${e.impact === 'High' ? 'cd-bub-high' : 'cd-bub-med'}"></span><span class="cd-evtime">${t}</span><span class="cd-evtitle">${chartsEsc(e.title)}</span>${nums ? `<div class="cd-evnums">${nums}</div>` : ''}</div>`;
  }).join('');
  const more = evs.length > 8 ? `<div class="cd-evmore">+${evs.length - 8} more</div>` : '';
  const card = document.createElement('div');
  card.className = 'cd-evcard';
  card.dataset.for = bub.dataset.ccy + bub.dataset.key;
  card.innerHTML = `<div class="cd-evhead">${COUNTRY_FLAGS[bub.dataset.ccy] || ''} ${bub.dataset.ccy} · ${day}</div>${rows}${more}`;
  strip.appendChild(card);
  if (window.twemoji) twemoji.parse(card, { folder: 'svg', ext: '.svg' });
  const w = strip.clientWidth, cw = Math.min(260, w - 16);
  card.style.width = cw + 'px';
  const center = bub.offsetLeft;
  card.style.left = Math.max(8, Math.min(center - cw / 2, w - cw - 8)) + 'px';
  bub.classList.add('cd-bub-on');
}

function chartsClosed(series) {
  // Bougie clôturée = son heure de fin réelle (c[5], 17h New York) est passée.
  // Anciennes données sans c[5] : repli sur « date UTC avant aujourd'hui ».
  const now = Date.now() / 1000;
  const todayStart = Math.floor(now / 86400) * 86400;
  return series.filter((c) => (c[5] ? c[5] <= now : c[0] < todayStart));
}

function chartsScore(id) {
  const closed = chartsClosed(chartsCandles[id] || []);
  if (closed.length < 2) return { group: 2, move: 0 };
  const a = closed[closed.length - 2];
  const b = closed[closed.length - 1];
  const bull = (c) => c[4] > c[1];
  const bear = (c) => c[4] < c[1];
  const group = bull(a) && bull(b) ? 0 : bear(a) && bear(b) ? 1 : 2;
  return { group, move: Math.abs((b[4] - a[1]) / a[1]) };
}

function chartsSvg(series, pairId) {
  const closed = chartsClosed(series).slice(-30);
  if (!closed.length) return '';
  const W = 600, H = 240, PAD = 8;
  const hi = Math.max(...closed.map((c) => c[2]));
  const lo = Math.min(...closed.map((c) => c[3]));
  const rng = hi - lo || 1;
  const y = (v) => (PAD + (1 - (v - lo) / rng) * (H - 2 * PAD)).toFixed(1);
  const step = (W - 2 * PAD) / closed.length;
  const bw = Math.max(2, step * 0.72);
  return `<svg class="cd-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
    closed.map((c, i) => {
      const x = PAD + step * (i + 0.5);
      const up = c[4] >= c[1];
      const col = up ? '#26a69a' : '#ef5350';
      const top = y(Math.max(c[1], c[4]));
      const h = Math.max(1, Math.abs(y(c[1]) - y(c[4])));
      return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(c[2])}" y2="${y(c[3])}" stroke="${col}" stroke-width="1.6"/>` +
        `<rect x="${(x - bw / 2).toFixed(1)}" y="${top}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}"/>`;
    }).join('') + '</svg>';
}

function chartsRenderList() {
  const list = document.getElementById('chartsList');
  if (!chartsCandles) {
    list.innerHTML = '<div class="charts-intro">Daily candles unavailable right now.</div>';
    return;
  }
  const rows = CORR_ALL_PAIRS
    .filter((p) => chartsCandles[p.id])
    .map((p) => ({ p, s: chartsScore(p.id) }))
    .sort((x, y) => x.s.group - y.s.group || y.s.move - x.s.move);
  const keep = candleIndex();
  list.innerHTML = rows.map(({ p, s }) => {
    const open = chartsSelectedPair === p.id;
    const cls = s.group === 0 ? 'cd-bull' : s.group === 1 ? 'cd-bear' : '';
    return `<div class="cd-row ${cls}">
      <button type="button" class="cd-head" data-pair="${p.id}" aria-expanded="${open}">
        <span class="cd-name">${p.label}</span>
      </button>
      <div class="cd-plot">
        ${chartsLinesHtml(chartsCandles[p.id], p.id)}
        <button type="button" class="cd-chart" data-pair="${p.id}" aria-label="${p.label} detail">${chartsSvg(chartsCandles[p.id], p.id)}</button>
        ${chartsEvStrip(chartsCandles[p.id], p.id)}
      </div>
      <div class="cd-detail" id="cd-detail-${p.id}"></div>
    </div>`;
  }).join('');
  if (window.twemoji) twemoji.parse(list, { folder: 'svg', ext: '.svg' });
  chartsSnapLines();
  if (chartsSelectedPair) chartsOpenDetail(chartsSelectedPair);
}

function chartsOpenDetail(id, interval = 'D', boxPrefix = 'cd-detail-') {
  const box = document.getElementById(`${boxPrefix}${id}`);
  if (!box) return;
  const symbol = tvSymbolFor(id);
  box.innerHTML = CHART_TIMEFRAMES.map((tf) => chartBlockHtml(symbol, tf.label)).join('');
  // <script> inséré via innerHTML ne s'exécute jamais : créer chaque script à la main.
  box.querySelectorAll('.tradingview-widget-container').forEach((container, i) => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.text = JSON.stringify({
      allow_symbol_change: false, calendar: false, details: false, hide_side_toolbar: true,
      hide_top_toolbar: i === 0, hide_legend: i === 0, hide_volume: true, hotlist: false,
      // Daily : graphique nu (ni barre du haut, ni légende, ni volume), comme la miniature SVG
      disabled_features: ['volume_force_overlay', 'create_volume_indicator_by_default'],
      interval, locale: 'en', save_image: false, style: '1',
      symbol, theme: 'dark', timezone: 'Etc/UTC', backgroundColor: '#0F0F0F',
      gridColor: 'rgba(242, 242, 242, 0.2)', watchlist: [], withdateranges: false,
      compareSymbols: [], support_host: 'https://www.tradingview.com', studies: [], autosize: true,
    });
    container.appendChild(script);
  });
}

async function chartsLoad() {
  try {
    const res = await fetch('./data/daily-candles.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    chartsCandles = (await res.json()).pairs;
  } catch (e) {
    if (!chartsCandles) chartsCandles = null;
  }
  try {
    const r = await fetch('./data/eco-calendar.json', { cache: 'no-store' });
    const d = r.ok ? await r.json() : null;
    chartsEco = ((d && d.events) || []).filter((e) => (e.impact === 'High' || e.impact === 'Medium') && e.date);
    chartsBuildEcoIndex();
  } catch (e) { /* lignes éco facultatives */ }
  chartsRenderList();
}

document.getElementById('chartsList').addEventListener('click', (e) => {
  const bub = e.target.closest('.cd-bub');
  if (bub) { e.stopPropagation(); chartsShowEvCard(bub); return; }
  if (!e.target.closest('.cd-evcard')) {
    document.querySelectorAll('.cd-evcard').forEach((c) => c.remove());
    document.querySelectorAll('.cd-bub-on').forEach((b) => b.classList.remove('cd-bub-on'));
  }
  const btn = e.target.closest('[data-pair]');
  if (!btn) return;
  const id = btn.dataset.pair;
  const wasOpen = chartsSelectedPair === id;
  if (chartsSelectedPair) {
    const prev = document.getElementById(`cd-detail-${chartsSelectedPair}`);
    if (prev) prev.innerHTML = '';
  }
  chartsSelectedPair = wasOpen ? null : id;
  if (!wasOpen) chartsOpenDetail(id);
});

document.getElementById('chartsToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('chartsBody').classList.toggle('collapsed', expanded);
  if (!expanded) chartsLoad(); // à chaque ouverture : tri recalculé
});


let currentEvents = [];
const currentImpactFilters = new Set(); // vide = All

// ── Mini calendrier mensuel (Calendrier Économique) ─────────────────────────

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const IMPACT_RANK = { High: 3, Medium: 2, Low: 1 };

const today = new Date();
let calViewYear = today.getFullYear();
let calViewMonth = today.getMonth();
let calSelectedDate = null;
let calShowAll = false;

function isThisWeek(date) {
  const day = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  return date >= monday && date <= sunday;
}

// Couleur d'une case selon sa position dans le temps (semaines lundi→dimanche) :
// passé = gris clair, aujourd'hui = rouge, reste de la semaine = orange, semaine suivante = vert.
function calDayStatus(y, m, d, hasEvent) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((new Date(y, m, d) - t0) / 86400000);
  if (diff < 0) return hasEvent ? 'cal-past' : 'cal-empty-past';
  if (diff === 0) return 'cal-today';
  if (!hasEvent) return 'cal-empty-future';
  const daysToSunday = (7 - today.getDay()) % 7; // dimanche = fin de semaine
  if (diff <= daysToSunday) return 'cal-week';
  if (diff <= daysToSunday + 7) return 'cal-nextweek';
  return '';
}

function renderEcoCalendar() {
  const el = document.getElementById('ecoCalendar');

  const visibleEvents = currentImpactFilters.size === 0
    ? currentEvents
    : currentEvents.filter((e) => e.impact === 'Holiday' || currentImpactFilters.has(e.impact));

  const dateMap = new Map();
  for (const e of visibleEvents.filter((ev) => inFocus(ev.country))) {
    const d = new Date(e.date);
    if (isNaN(d)) continue;
    const key = localDateStr(d);
    const info = dateMap.get(key) || { count: 0, impact: null };
    info.count++;
    if ((IMPACT_RANK[e.impact] || 0) > (IMPACT_RANK[info.impact] || 0)) info.impact = e.impact;
    dateMap.set(key, info);
  }

  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const firstDow = new Date(calViewYear, calViewMonth, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const monthLabelRaw = new Date(calViewYear, calViewMonth).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const monthLabel = monthLabelRaw.charAt(0).toUpperCase() + monthLabelRaw.slice(1);
  const todayStr = localDateStr(today);

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += '<div></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const info = dateMap.get(dateStr);
    const cls = ['cal-day'];
    cls.push(calDayStatus(calViewYear, calViewMonth, day, !!info));
    if (dateStr === todayStr) cls.push('today');
    if (dateStr === calSelectedDate) cls.push('selected');
    cells += `
      <button class="${cls.join(' ')}" data-date="${dateStr}" ${info ? `title="${info.count} event${info.count > 1 ? 's' : ''}"` : ''}>
        ${day}
      </button>`;
  }

  el.innerHTML = `
    <div class="cal-header">
      <button class="cal-nav" id="calPrev">‹</button>
      <span class="cal-month-label">${monthLabel}</span>
      <button class="cal-nav" id="calNext">›</button>
    </div>
    <div class="cal-weekdays">${['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'].map((d) => `<div>${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-footer">
      ${calShowAll ? '<button class="cal-link" id="calThisWeek">8 jours</button>' : ''}
      ${(calSelectedDate || !calShowAll) ? '<button class="cal-link" id="calShowAll">Tout afficher</button>' : ''}
      ${calSelectedDate !== todayStr ? '<button class="cal-link" id="calToday">Aujourd&rsquo;hui</button>' : ''}
    </div>`;
}

document.getElementById('ecoCalendar').addEventListener('click', (e) => {
  if (e.target.closest('#calPrev')) {
    if (calViewMonth === 0) { calViewMonth = 11; calViewYear--; } else { calViewMonth--; }
  } else if (e.target.closest('#calNext')) {
    if (calViewMonth === 11) { calViewMonth = 0; calViewYear++; } else { calViewMonth++; }
  } else if (e.target.closest('#calShowAll')) {
    calSelectedDate = null;
    calShowAll = true;
  } else if (e.target.closest('#calThisWeek')) {
    calSelectedDate = null;
    calShowAll = false;
  } else if (e.target.closest('#calToday')) {
    calViewYear = today.getFullYear();
    calViewMonth = today.getMonth();
    calSelectedDate = localDateStr(today);
    calShowAll = false;
  } else {
    const dayBtn = e.target.closest('.cal-day');
    if (!dayBtn) return;
    const date = dayBtn.dataset.date;
    calSelectedDate = calSelectedDate === date ? null : date;
    calShowAll = false;
  }
  renderEcoCalendar();
  renderEvents();
});

// ── Compte à rebours vers le prochain event High (indépendant des filtres) ──

let nextHighEvent = null;

// Groupe "simultané" : le prochain High + tous les High qui sortent dans les 5 minutes qui suivent (toutes devises).
const GROUP_WINDOW_MS = 5 * 60 * 1000;
function inNextGroup(e) {
  if (!nextHighEvent || e.impact !== 'High') return false;
  const t = new Date(e.date).getTime();
  const t0 = new Date(nextHighEvent.date).getTime();
  return t >= t0 && t <= t0 + GROUP_WINDOW_MS;
}

// Après sa sortie, le groupe reste affiché (et le Focus dessus) HOLD_MS pour voir l'actual avant la bascule.
const HOLD_MS = 10 * 60 * 1000;
function findNextHighEvent() {
  const now = Date.now();
  nextHighEvent = currentEvents.find((e) => e.impact === 'High' && new Date(e.date).getTime() > now - HOLD_MS) || null;
  // Devises en focus = toutes celles qui ont un High exactement à cette heure-là
  focusCcys = nextHighEvent
    ? [...new Set(currentEvents.filter(inNextGroup).map((e) => e.country))]
    : [];
}

const FOCUS_BODIES = [['currencyToggle', 'currencyGrid'], ['trendToggle', 'trendGrid'], ['marketNewsToggle', 'marketNewsBody']];

function setFocusPanelsOpen(open) {
  for (const [toggleId, bodyId] of FOCUS_BODIES) {
    document.getElementById(toggleId)?.setAttribute('aria-expanded', String(open));
    document.getElementById(bodyId)?.classList.toggle('collapsed', !open);
  }
}

// Ré-applique le focus partout (changement de devise, interrupteur, chargement).
function renderFocusViews() {
  document.body.classList.toggle('focus-on', focusActive());
  renderCountdownStatic();
  const btn = document.getElementById('focusBtn');
  if (btn) {
    btn.classList.toggle('active', focusActive());
    btn.textContent = focusActive() ? `Focus · ${focusCcys.join('/')}` : (focusMode ? 'Focus' : 'Focus off');
    btn.setAttribute('aria-pressed', String(focusMode));
  }
  if (focusActive()) setFocusPanelsOpen(true);
  if (lastCurrencyData !== undefined) renderCurrencies(lastCurrencyData);
  if (lastTrendData !== undefined) renderTrendMomentum(lastTrendData);
  renderEcoCalendar();
  renderEvents();
  renderNews();
  renderFocusBar();
}

// Résumé d'une ligne sous le décompte : ce qui est filtré par le Focus.
function renderFocusBar() {
  const el = document.getElementById('focusBar');
  if (!el) return;
  if (!focusActive()) { el.innerHTML = ''; return; }
  const inWeek = (e) => { const d = new Date(e.date); return !isNaN(d) && isThisWeek(d); };
  const evCount = currentEvents.filter((e) => e.impact === 'High' && focusCcys.includes(e.country) && inWeek(e)).length;
  const newsCount = currentNews.filter((n) => n.currencies.some((c) => focusCcys.includes(c))).length;
  el.innerHTML = `<span class="fb-tag">Focus</span><span class="fb-ccy">${focusCcys.join(' / ')}</span>` +
    `<span class="fb-stat"><b>${evCount}</b> High cette semaine</span><span class="fb-stat"><b>${newsCount}</b> news</span>`;
}

// ── Tableau ECO (type terminal) : tous les événements des devises en Focus ──
function ecoTableHtml(rows) {
  const now = Date.now();
  const multi = !focusActive() || focusCcys.length > 1; // plusieurs devises affichées → étiquette devant le titre
  const cell = (v, cls = '') => `<span class="ct-v ${cls}">${v ? v : '–'}</span>`;
  let lastDay = null;
  const body = rows.map((e) => {
    const d = new Date(e.date);
    const dayKey = d.toDateString();
    let head = '';
    if (dayKey !== lastDay) {
      lastDay = dayKey;
      const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      head = `<div class="ct-day ${calDayStatus(d.getFullYear(), d.getMonth(), d.getDate(), true)}">${label}</div>`;
    }
    const isNext = inNextGroup(e);
    const past = d.getTime() < now;
    const bm = actualVsForecast(e.actual, e.forecast);
    const impCls = ['High', 'Medium', 'Low'].includes(e.impact) ? e.impact : 'Other';
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${head}
      <div class="ct-row${isNext ? ' ct-next' : ''}${past ? ' ct-past' : ''}${e.impact === 'Holiday' ? ' ct-holiday' : ''}">
        <span class="ct-time ${ecoTimeColorClass(d.getHours())}">${time}</span>
        <span class="ct-imp ct-imp-${impCls}" title="${e.impact}"></span>
        <span class="ct-title" title="${e.title}">${multi ? `<span class="ct-ccy">${e.country}</span>` : ''}${e.title}${isLiveWindow(e) ? `<button class="live-btn" data-date="${e.date}" data-title="${e.title.replace(/"/g, '&quot;')}">▶ Live</button>` : ''}</span>
        ${cell(e.actual, 'ct-act' + (bm !== 'neutral' ? ' ct-' + bm : ''))}
        ${cell(e.forecast)}
        ${cell(e.previous, 'ct-prev')}
      </div>`;
  }).join('');
  return `
    <div class="ct-wrap">
      <div class="ct-header"><span>Heure</span><span></span><span>Événement</span><span class="ct-r">Actual</span><span class="ct-r">Fcst</span><span class="ct-r">Prev</span></div>
      <div class="ct-body" id="ctBody">${body || '<div class="ct-empty">Aucun événement</div>'}</div>
    </div>`;
}

function renderCountdownStatic() {
  const el = document.getElementById('ecoCountdown');
  if (!nextHighEvent) {
    el.innerHTML = '';
    return;
  }
  // Tous les High qui sortent exactement à la même heure (toutes devises), pas seulement le premier
  const sims = currentEvents.filter(inNextGroup);
  const val = (label, v, cls = '') => `<span class="cd-v ${cls}"><em>${label}</em>${v ? v : '–'}</span>`;
  const fmtT = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const evLines = sims.map((e) => {
    const bm = actualVsForecast(e.actual, e.forecast);
    const offset = e.date !== nextHighEvent.date ? `<span class="cd-t">${fmtT(e.date)}</span>` : '';
    return `
      <div class="cd-ev">
        <div class="cd-ev-line">
          ${offset}
          <span class="countdown-flag">${COUNTRY_FLAGS[e.country] || '🏳️'}</span>
          <span class="countdown-ccy">${e.country}</span>
          <span class="countdown-title" title="${e.title}">${e.title}</span>
        </div>
        <div class="cd-ev-vals">
          ${val('Actual', e.actual, 'cd-act' + (bm !== 'neutral' ? ' ct-' + bm : ''))}
          ${val('Fcst', e.forecast)}
          ${val('Prev', e.previous, 'cd-prev')}
        </div>
      </div>`;
  }).join('');
  const d = new Date(nextHighEvent.date);
  const evTime = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const evDate = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  el.innerHTML = `
    <div class="cd-head">
      <span class="cd-date">${evDate}</span>
      <span class="cd-tag">Next High</span>
    </div>
    <div class="cd-body">
      <span class="countdown-at ${ecoTimeColorClass(d.getHours())}">${evTime}</span>
      <span class="cd-count">${sims.length > 1 ? sims.length + ' événements' : ''}</span>
      <span class="countdown-time" id="countdownTime">--:--:--</span>
    </div>
    <div class="cd-evlist">${evLines}</div>`;
  parseEmoji(el);
  tickCountdown();
}

let releaseHandledFor = null;
function tickCountdown() {
  if (!nextHighEvent) return;
  const diff = new Date(nextHighEvent.date).getTime() - Date.now();
  if (diff <= -HOLD_MS) {
    // Fin du maintien : bascule sur le High suivant
    findNextHighEvent();
    renderCountdownStatic();
    renderFocusViews();
    return;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const timeEl = document.getElementById('countdownTime');
  if (diff <= 0) {
    // Sorti : on garde le groupe, chrono "sorti il y a" + actual en direct
    if (releaseHandledFor !== nextHighEvent.date) {
      releaseHandledFor = nextHighEvent.date;
      scheduleReleaseRefresh();
      pollLiveActuals();
      renderCountdownStatic();
      return;
    }
    const sec = Math.floor(-diff / 1000);
    if (timeEl) {
      timeEl.textContent = `SORTI +${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
      timeEl.className = 'countdown-time cd-released';
    }
    return;
  }
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (timeEl) timeEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  if (timeEl) timeEl.className = 'countdown-time ' + (totalSec > 6 * 3600 ? 'cd-green' : totalSec > 3600 ? 'cd-orange' : 'cd-red');
}

setInterval(tickCountdown, 1000);

// ── Speaks en direct (YouTube) : lecteur sous le panneau Next High, seulement pendant la fenêtre du speak ──
const LIVE_BEFORE_MS = 10 * 60000, LIVE_AFTER_MS = 60 * 60000;
const SPEAK_RE = /\b(speaks|testifies|speech|press conference)\b/i;
// La chaîne financière est toujours en direct ; la banque centrale l'est seulement pendant ses conférences.
const LIVE_SOURCES = {
  yahoo: { label: 'Yahoo Finance', channel: 'UCEAZeUIeJs0IjQiqTCdVSIg' },
  reuters: { label: 'Reuters', channel: 'UChqUTb7kYRX8-EiaN3XFrSQ' },
  fed: { label: 'Fed', channel: 'UCAzhpt9DmG6PnHXjmJTvRGQ', ccy: 'USD' },
  boe: { label: 'BoE', channel: 'UCZ25rmSDSnjIWZxjd2-04Rg', ccy: 'GBP' },
  snb: { label: 'SNB', channel: 'UC4vQTVEqtj2orppzBkdGmyg', ccy: 'CHF' },
  ecb: { label: 'ECB', channel: 'UCXB8fM4VyQubRu3UVGhd3wA', ccy: 'EUR' },
  boj: { label: 'BoJ', channel: 'UC32Yu7NyStgmKYsXvYofPvQ', ccy: 'JPY' },
  rba: { label: 'RBA', channel: 'UCaLmgAMEglL-yGvuGzTx6ig', ccy: 'AUD' },
  boc: { label: 'BoC', channel: 'UCY4EvEbIox0M4JuEsu5OKnQ', ccy: 'CAD' },
  rbnz: { label: 'RBNZ', channel: 'UC1v0CeB83SX6Px9r5KT0NuQ', ccy: 'NZD' },
};
function isLiveWindow(e) {
  if (e.impact !== 'High' || !SPEAK_RE.test(e.title)) return false;
  const d = new Date(e.date).getTime() - Date.now();
  return d <= LIVE_BEFORE_MS && d >= -LIVE_AFTER_MS;
}
let liveKey = null, liveSrc = 'yahoo', liveDismissed = new Set(), liveRenderedKey = 'null|';
function updateLivePlayer() {
  const el = document.getElementById('livePlayer');
  if (!el) return;
  const ev = currentEvents.filter(isLiveWindow).find((e) => !liveDismissed.has(e.date + e.title)) || null;
  const key = ev ? ev.date + ev.title : null;
  const state = key + '|' + liveSrc;
  if (state === liveRenderedKey) return;
  const hadPlayer = liveRenderedKey.split('|')[0] !== 'null';
  const sameEvent = liveRenderedKey.split('|')[0] === String(key);
  liveRenderedKey = state;
  if (!ev) { liveKey = null; el.innerHTML = ''; el.classList.remove('open'); if (hadPlayer) renderEvents(); return; }
  liveKey = key;
  const srcs = Object.entries(LIVE_SOURCES).filter(([, v]) => !v.ccy || v.ccy === ev.country);
  if (!srcs.some(([id]) => id === liveSrc)) liveSrc = 'yahoo';
  const tabs = srcs.map(([id, v]) => `<button class="live-tab${id === liveSrc ? ' active' : ''}" data-src="${id}">${v.label}</button>`).join('');
  const t = new Date(ev.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  el.classList.add('open');
  el.innerHTML = `
    <div class="live-head"><span class="live-dot"></span><span class="live-title">LIVE · ${ev.country} ${ev.title} · ${t}</span><button class="live-close" aria-label="Fermer">✕</button></div>
    <div class="live-tabs">${tabs}</div>
    <div class="live-frame"><iframe src="https://www.youtube.com/embed/live_stream?channel=${LIVE_SOURCES[liveSrc].channel}&rel=0" title="Live" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>
    <div class="live-note">Si l'écran est noir, la chaîne n'est pas en direct : essaie un autre flux.</div>`;
  if (!sameEvent) renderEvents();
}
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.live-tab');
  if (tab) { liveSrc = tab.dataset.src; updateLivePlayer(); return; }
  if (e.target.closest('.live-close')) { if (liveKey) liveDismissed.add(liveKey); updateLivePlayer(); return; }
  const btn = e.target.closest('.live-btn');
  if (btn) {
    liveDismissed.delete(btn.dataset.date + btn.dataset.title.replace(/&quot;/g, '"'));
    updateLivePlayer();
    document.getElementById('livePlayer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
setInterval(updateLivePlayer, 5000);

function renderEvents() {
  const list = document.getElementById('ecoList');
  let filtered = currentImpactFilters.size === 0
    ? currentEvents
    : currentEvents.filter((e) => e.impact === 'Holiday' || currentImpactFilters.has(e.impact));
  if (focusActive()) filtered = filtered.filter((e) => focusCcys.includes(e.country));
  // Événements déjà passés : seuls les High restent affichés
  { const nowMs = Date.now(); const todayMs = new Date().setHours(0, 0, 0, 0); filtered = filtered.filter((e) => e.impact === 'High' || new Date(e.date).getTime() >= nowMs || (e.impact === 'Holiday' && new Date(e.date).getTime() >= todayMs)); }
  if (calSelectedDate) {
    filtered = filtered.filter((e) => {
      const d = new Date(e.date);
      return !isNaN(d) && localDateStr(d) === calSelectedDate;
    });
  } else if (!calShowAll) {
    // Par défaut : d'aujourd'hui (minuit) jusqu'à J+8
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const endMs = start.getTime() + 8 * 86400000;
    filtered = filtered.filter((e) => {
      const t = new Date(e.date).getTime();
      return !isNaN(t) && t >= start.getTime() && t < endMs;
    });
  }
  list.innerHTML = ecoTableHtml(filtered);
  parseEmoji(list);
  // Fait apparaître la ligne du prochain événement High dans la zone défilante
  const ctBody = document.getElementById('ctBody');
  const nextRow = ctBody && ctBody.querySelector('.ct-next');
  if (nextRow && !calSelectedDate) ctBody.scrollTop = Math.max(0, nextRow.offsetTop - 34); // ct-body est position:relative
}

function ecoTimeColorClass(hour) {
  if (hour >= 14 && hour < 17) return 'eco-time-blue';
  if (hour >= 22 || hour < 2) return 'eco-time-red';
  if (hour >= 2 && hour < 3) return 'eco-time-green';
  if (hour >= 3 && hour < 7) return 'eco-time-yellow';
  return 'eco-time-gray'; // 7-12, 12-14, 17-22
}

function valueColorClass(val) {
  if (!val) return '';
  const num = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return '';
  if (num > 0) return 'val-pos';
  if (num < 0) return 'val-neg';
  return 'val-zero';
}

// Triangle vert/rouge affiché à gauche d'Actual : actual bat le forecast (vert)
// ou le manque (rouge), comparaison numérique brute (pas d'interprétation par
// indicateur — même convention volontairement simpliste que valueColorClass).
function actualVsForecast(actual, forecast) {
  if (!actual || !forecast) return 'neutral';
  const a = parseFloat(String(actual).replace(/,/g, ''));
  const f = parseFloat(String(forecast).replace(/,/g, ''));
  if (isNaN(a) || isNaN(f)) return 'neutral';
  if (a > f) return 'pos';
  if (a < f) return 'neg';
  return 'neutral';
}

// ── News Marché (FXStreet + Investing.com) ──────────────────────────────────

const CCY_ALIASES = {
  EUR: ['EUR', 'Euro'],
  USD: ['USD', 'US Dollar', 'Greenback'],
  GBP: ['GBP', 'Pound', 'Sterling', 'Cable'],
  JPY: ['JPY', 'Yen'],
  CHF: ['CHF', 'Franc'],
  AUD: ['AUD', 'Aussie'],
  CAD: ['CAD', 'Loonie'],
  NZD: ['NZD', 'Kiwi'],
  XAU: ['XAU', 'Gold'],
  BTC: ['BTC', 'Bitcoin', 'Crypto', 'Cryptocurrency'],
  ETH: ['ETH', 'Ethereum'],
  OIL: ['Oil', 'Crude', 'WTI', 'Brent'],
};

function detectCurrencies(text) {
  const found = new Set();
  // Paires collées ou avec slash (AUDUSD / AUD/USD) — priorité, très fiable dans les titres forex
  for (const m of text.matchAll(/\b([A-Z]{3})\/?([A-Z]{3})\b/g)) {
    if (CCY_ALIASES[m[1]]) found.add(m[1]);
    if (CCY_ALIASES[m[2]]) found.add(m[2]);
  }
  // Alias mots (Gold, Bitcoin, Aussie, etc.) + codes isolés
  for (const [ccy, aliases] of Object.entries(CCY_ALIASES)) {
    for (const alias of aliases) {
      const re = new RegExp(`\\b${alias}\\b`, alias === alias.toUpperCase() ? '' : 'i');
      if (re.test(text)) { found.add(ccy); break; }
    }
  }
  return [...found];
}

// Heuristique par mots-clés — pas une vraie analyse sémantique. Compte les mots
// haussiers/baissiers dans le titre, prend le camp dominant. Ne distingue pas
// quel actif précis bénéficie/pâtit dans un titre mentionnant plusieurs actifs
// en sens opposés (ex. "Gold rallies on weaker dollar") — limite assumée.
const BULLISH_RE = /\b(rise|rises|rising|rose|rall(?:y|ies|ied|ying)|gain(?:s|ed|ing)?|strengthen(?:s|ed|ing)?|surge(?:s|d)?|climb(?:s|ed|ing)?|advance(?:s|d)?|jump(?:s|ed)?|rebound(?:s|ed)?|soar(?:s|ed|ing)?|higher|bulls?|bullish|outperform(?:s)?|boost(?:s|ed)?|extends? gains|hits? (?:a )?(?:new )?high|record high|strong|firmer)\b/i;
const BEARISH_RE = /\b(fall(?:s|ing)?|fell|drop(?:s|ped|ping)?|declin(?:es|ed|ing)?|weaken(?:s|ed|ing)?|slide(?:s|d)?|sliding|tumbl(?:es|ed|ing)|sink(?:s|ing)?|sank|retreat(?:s|ed|ing)?|soft(?:er)?|lower|bears?|bearish|underperform(?:s)?|slump(?:s|ed)?|plung(?:es|ed|ing)|extends? losses|hits? (?:a )?(?:new )?low|record low|weak)\b/i;

function detectSentiment(text) {
  const pos = (text.match(new RegExp(BULLISH_RE, 'gi')) || []).length;
  const neg = (text.match(new RegExp(BEARISH_RE, 'gi')) || []).length;
  if (pos > neg) return 'pos';
  if (neg > pos) return 'neg';
  return 'neutral';
}

// Tags des news — regex reprises telles quelles de KEYWORDS (trader-news/news.py) du repo MIT
// https://github.com/Jakeschincariol/day-trader-skill (commit 3d0f4ef, © Jake Schincariol).
// Seules les catégories utiles au forex / XAU / BTC sont gardées (earnings, analyst, deal,
// capital, halt = actions, écartées). Appliquées en insensible à la casse, comme dans le repo.
const NEWS_TAGS = [
  ['legal', /\blawsuit\b|\bsued\b|\bprobe\b|\binvestigation\b|\bSEC charges\b|\bantitrust\b|\bjudge\b|\bcourt\b/i],
  ['people', /\bCEO\b|\bCFO\b|\bresign|\bsteps down\b|\bappoint/i],
  ['risk', /\brecall\b|\bbankrupt|\bdefault\b|\bdelist|\bhack|\bbreach\b|\boutage\b/i],
  ['regulatory', /\bFDA\b|\bapproval\b|\bapproves\b|\bclinical\b|\bFTC\b|\bDOJ\b/i],
  ['macro', /\bFed\b|\bFOMC\b|\bCPI\b|\binflation\b|\bjobs report\b|\bpayrolls\b|\btariffs?\b|\bfutures\b/i],
];

// AJOUTS ARII (pas dans le repo) : vocabulaire forex / XAU / BTC, car les regex du repo
// ci-dessus sont écrites pour les actions et ne matchent presque aucune news forex.
// Fusionnés avec la regex du repo de la même catégorie (OU logique).
const NEWS_TAGS_FOREX = {
  macro: /\brates?\b|\brate (?:decision|hike|cut)s?\b|\bhike[sd]?\b|\bhawkish\b|\bdovish\b|\bcentral bank\b|\bBoE\b|\bBank of England\b|\bECB\b|\bBoJ\b|\bBank of Japan\b|\bRBA\b|\bRBNZ\b|\bBoC\b|\bBank of Canada\b|\bSNB\b|\bFederal Reserve\b|\bPowell\b|\bLagarde\b|\bBailey\b|\bUeda\b|\bGDP\b|\bPCE\b|\bPPI\b|\bNFP\b|\bunemployment\b|\bemployment\b|\bjobless\b|\bretail sales\b|\bPMI\b|\bmonetary policy\b|\bgilts?\b|\bTreasur(?:y|ies)\b|\bintervention\b/i,
  regulatory: /\bSEC\b|\bCFTC\b|\bETF\b|\bspot ETF\b|\bregulat(?:ion|ors?|ory)\b|\bMiCA\b|\bstablecoin\b|\bFCA\b|\bsanctions?\b|\bbill\b|\blegislation\b/i,
  risk: /\bwar\b|\bconflict\b|\bcrash\b|\bsell-?off\b|\bturmoil\b|\bcrisis\b|\bexploit\b|\bliquidation[s]?\b|\bshutdown\b|\bgeopolitical\b|\bsafe[- ]haven\b|\bvolatil(?:e|ity)\b/i,
  legal: /\bruling\b|\bsentenc(?:e|ed|ing)\b|\btrial\b|\bcharged\b|\bsettlement\b|\blegal\b|\bappeal\b/i,
  people: /\bgovernor\b|\bchair(?:man|woman)?\b|\bpresident\b|\bnominat(?:e|es|ed|ion)\b|\bsuccessor\b|\bdeputy\b|\bTrump\b|\bspeaks?\b|\bspeech\b/i,
};

function detectNewsTags(text) {
  return NEWS_TAGS.filter(([tag, re]) => re.test(text) || NEWS_TAGS_FOREX[tag].test(text)).map(([tag]) => tag);
}

let currentNews = [];
let currentNewsTag = 'all';

function loadStoredNewsFilter() {
  try {
    return localStorage.getItem('newsFilterCcy') || 'all';
  } catch {
    return 'all';
  }
}

function saveNewsFilter(ccy) {
  try {
    localStorage.setItem('newsFilterCcy', ccy);
  } catch {
    // localStorage unavailable (private browsing, storage blocked...) — not blocking
  }
}

let currentNewsFilter = loadStoredNewsFilter();

function renderNews() {
  const list = document.getElementById('newsList');
  const byCcy = focusActive()
    ? currentNews.filter((n) => n.currencies.some((c) => focusCcys.includes(c)))
    : currentNewsFilter === 'all'
      ? currentNews
      : currentNews.filter((n) => n.currencies.includes(currentNewsFilter));
  const filtered = currentNewsTag === 'all' ? byCcy : byCcy.filter((n) => n.tags.includes(currentNewsTag));

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Aucune news</div>';
    return;
  }

  list.innerHTML = filtered.map((n) => {
    const d = new Date(n.pubDate);
    const time = isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const dateLabel = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
    const sentiment = detectSentiment(n.title);
    return `
      <a class="news-item" href="${n.link}" target="_blank" rel="noopener noreferrer">
        <div class="news-meta">
          <span class="news-source">${n.source}</span>
          <span class="news-time">${dateLabel} ${time}</span>
        </div>
        <div class="news-title news-title-${sentiment}">${n.title}</div>
        ${n.tags.length ? `<div class="news-tags">${n.tags.map((t) => `<span class="ntag-badge">${t}</span>`).join('')}</div>` : ''}
      </a>`;
  }).join('');
}

// Tous les discours (Speaks / Testifies / Speech) visant une devise précise passent en High,
// quel que soit le classement ForexFactory. Affichage seulement : les données brutes ne changent pas.
const SPEECH_RE = /\b(speaks|testifies|speech)\b/i;
function prepareEvents(events) {
  return (events || [])
    .map((e) => (SPEECH_RE.test(e.title) && COUNTRY_FLAGS[e.country] && e.impact !== 'High'
      ? { ...e, impact: 'High', impactOrig: e.impact }
      : e))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Recharge seulement le calendrier (JSON statique, pas l'API BabyPips) puis ré-applique le Focus.
async function refreshEco() {
  const ecoData = await loadJSON('./data/eco-calendar.json').catch(() => null);
  if (!ecoData) return;
  currentEvents = prepareEvents(ecoData.events);
  await applyLiveActuals();
  findNextHighEvent();
  renderCountdownStatic();
  renderFocusViews();
}

// ── Actual quasi instantané : calendrier public TradingView via le proxy Vercel ──
// (le cron GitHub Actions est trop lent). Rapprochement par devise + heure ±10 min
// + forecast/previous numériquement égaux — les titres FF/TV diffèrent.
const TV_ACTUALS_URL = 'https://ariinuiirgina.vercel.app/api/tv-actuals';
function tvNum(s) {
  if (s == null || s === '') return null;
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function tvSame(ffText, tvVal) {
  const a = tvNum(ffText);
  if (a == null || tvVal == null) return null;
  return Math.abs(a - tvVal) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(tvVal));
}
function tvTokens(title) {
  const t = String(title).toLowerCase().replace(/m\/m/g, 'mom').replace(/y\/y/g, 'yoy').replace(/q\/q/g, 'qoq')
    .replace(/prices/g, 'price').split(/[^a-z0-9]+/).filter((w) => w && !['final', 'prelim', 'adv', 'flash', 'the', 'of', 'non', 'farm'].includes(w));
  return new Set(t);
}
function tvFormatLike(ev, v) {
  const ref = [ev.forecast, ev.previous].find((x) => x && tvNum(x) != null) || '';
  const m = String(ref).match(/-?\d+(?:\.(\d+))?\s*([A-Za-z%]*)/);
  return m ? `${v.toFixed(m[1] ? m[1].length : 0)}${m[2]}` : String(v);
}
// ── Actual Forex Smart Alert en direct : proxy Vercel (api/fsa-calendar), fonctionne sur mobile ──
// En cas d'échec (fetch silencieux) : TradingView prend le relais.
const FSA_RELAY_URL = 'https://ariinuiirgina.vercel.app/api/fsa-calendar';
async function applyRelayActuals() {
  try {
    // Timeout court : sans relais (ou si Chrome attend l'autorisation réseau local), ne jamais bloquer l'affichage.
    const res = await fetch(FSA_RELAY_URL, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const src = ((await res.json()).result || []).filter((t) => t.actual);
    let changed = false;
    for (const ev of currentEvents) {
      if (ev.actual) continue;
      const evT = new Date(ev.date).getTime();
      const evTok = tvTokens(ev.title);
      let best = null;
      for (const t of src) {
        if (t.currency !== ev.country || Math.abs(new Date(t.date).getTime() - evT) > 10 * 60000) continue;
        const f = tvSame(ev.forecast, tvNum(t.forecast)), p = tvSame(ev.previous, tvNum(t.previous));
        const tt = tvTokens(t.title);
        const score = (f ? 2 : 0) + (p ? 2 : 0) + [...evTok].filter((w) => tt.has(w)).length;
        if (score < 3) continue;
        if (!best || score > best.score) best = { t, score };
      }
      if (best) { ev.actual = best.t.actual; changed = true; }
    }
    return changed;
  } catch (e) { return false; }
}

// Renvoie true si au moins un actual a été ajouté.
async function applyLiveActuals() {
  const relayChanged = await applyRelayActuals();
  try {
    const res = await fetch(`${TV_ACTUALS_URL}?hours=12`, { cache: 'no-store' });
    if (!res.ok) return relayChanged;
    const tv = ((await res.json()).result || []).filter((t) => t.actual != null);
    let changed = false;
    for (const ev of currentEvents) {
      if (ev.actual) continue;
      const evT = new Date(ev.date).getTime();
      let best = null;
      const evTok = tvTokens(ev.title);
      for (const t of tv) {
        if (t.currency !== ev.country || Math.abs(new Date(t.date).getTime() - evT) > 10 * 60000) continue;
        const f = tvSame(ev.forecast, t.forecast), p = tvSame(ev.previous, t.previous);
        const tt = tvTokens(t.title);
        const overlap = [...evTok].filter((w) => tt.has(w)).length;
        // Le précédent est souvent révisé, le titre diffère : on cumule valeurs égales + mots communs.
        const score = (f ? 2 : 0) + (p ? 2 : 0) + overlap;
        if (score < 3) continue;
        if (!best || score > best.score) best = { t, score };
      }
      if (best) { ev.actual = tvFormatLike(ev, best.t.actual); changed = true; }
    }
    return changed || relayChanged;
  } catch (e) { return relayChanged; }
}

// Pendant le maintien post-sortie : interroge le proxy toutes les 15 s tant qu'il manque un actual
// (fenêtre bornée à l'événement précis, pas un polling permanent).
let livePollTimer = null;
async function pollLiveActuals() {
  clearTimeout(livePollTimer);
  if (!nextHighEvent) return;
  const t0 = new Date(nextHighEvent.date).getTime();
  if (Date.now() > t0 + HOLD_MS) return;
  if (await applyLiveActuals()) { renderCountdownStatic(); renderEcoCalendar(); renderEvents(); }
  const missing = currentEvents.filter(inNextGroup).some((e) => !e.actual);
  if (missing) livePollTimer = setTimeout(pollLiveActuals, 15000);
}

// Pas de polling : rafraîchissements ponctuels déclenchés par un événement précis
// (sortie du High, retour sur l'app) pour voir l'actual dès qu'il est publié.
let lastEcoRefresh = Date.now();
function refreshEcoTracked() { lastEcoRefresh = Date.now(); return refreshEco(); }
function scheduleReleaseRefresh() { [60000, 300000, 600000].forEach((ms) => setTimeout(refreshEcoTracked, ms)); }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastEcoRefresh > 120000) refreshEcoTracked();
});

async function loadAll() {
  try {
    const [marketRaw, ecoData, newsData] = await Promise.all([
      fetchMarketRaw().catch((err) => { console.error(err); return null; }),
      loadJSON('./data/eco-calendar.json').catch(() => null),
      loadJSON('./data/market-news.json').catch(() => null),
    ]);

    renderCurrencies(marketRaw ? computeCurrencyStrength(marketRaw) : null);
    renderTrendMomentum(marketRaw ? computeTrendMomentum(marketRaw) : null);
    renderCorrelation();

    currentEvents = prepareEvents(ecoData?.events);
    await applyLiveActuals();
    findNextHighEvent();
    renderCountdownStatic();
    renderEcoCalendar();
    renderEvents();
    updateLivePlayer();

    currentNews = (newsData?.items || [])
      .map((n) => {
        const currencies = detectCurrencies(n.title + ' ' + n.description);
        // Sources 100% dédiées à une devise par nature — tag forcé même sans
        // mot-clé explicite dans le titre (ex. un communiqué Fed technique
        // qui ne mentionne jamais littéralement "USD"/"dollar")
        const forcedCcy = SOURCE_CURRENCY[n.source];
        if (forcedCcy && !currencies.includes(forcedCcy)) currencies.push(forcedCcy);
        return { ...n, currencies, tags: detectNewsTags(n.title) };
      })
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    renderNews();
    renderFocusViews();
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('focusBtn')?.addEventListener('click', () => {
  focusMode = !focusMode;
  if (!focusMode) setFocusPanelsOpen(false);
  renderFocusViews();
});
document.getElementById('currencyToggle').addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('currencyGrid').classList.toggle('collapsed', expanded);
});
document.getElementById('trendToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('trendGrid').classList.toggle('collapsed', expanded);
});
document.getElementById('marketNewsToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('marketNewsBody').classList.toggle('collapsed', expanded);
});

// TradingView's embed script measures the container's rendered size once on
// load — injecting it while the panel sits under display:none (collapsed by
// default) would freeze the widget at 0×0 forever. Load it lazily, the first
// time the panel is actually opened.
let tvNewsLoaded = false;
function loadTvNewsWidget() {
  if (tvNewsLoaded) return;
  tvNewsLoaded = true;
  const container = document.getElementById('tvNewsWidget');
  container.innerHTML = `
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/news/top-providers/tradingview/" rel="noopener nofollow" target="_blank"><span class="blue-text">Top stories</span></a><span class="trademark"> by TradingView</span></div>
    </div>`;
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js';
  script.text = JSON.stringify({
    displayMode: 'regular',
    feedMode: 'all_symbols',
    colorTheme: 'dark',
    isTransparent: false,
    locale: 'en',
    width: '100%',
    height: '100%',
  });
  container.querySelector('.tradingview-widget-container').appendChild(script);
}
document.getElementById('tvNewsToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('tvNewsBody').classList.toggle('collapsed', expanded);
  if (expanded === false) loadTvNewsWidget();
});
document.getElementById('impactFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  const impact = btn.dataset.impact;
  if (impact === 'all') {
    currentImpactFilters.clear();
  } else if (currentImpactFilters.has(impact)) {
    currentImpactFilters.delete(impact);
  } else {
    currentImpactFilters.add(impact);
  }
  e.currentTarget.querySelectorAll('.filter-btn').forEach((b) => {
    const active = b.dataset.impact === 'all' ? currentImpactFilters.size === 0 : currentImpactFilters.has(b.dataset.impact);
    b.classList.toggle('active', active);
  });
  renderEcoCalendar();
  renderEvents();
});
document.getElementById('newsFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  e.currentTarget.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentNewsFilter = btn.dataset.ccy;
  saveNewsFilter(currentNewsFilter);
  renderNews();
});

document.getElementById('newsTagFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  e.currentTarget.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentNewsTag = btn.dataset.tag;
  renderNews();
});

// Restaure le filtre devise persisté (localStorage) sur l'état visuel des boutons
{
  const newsFiltersEl = document.getElementById('newsFilters');
  newsFiltersEl.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.ccy === currentNewsFilter);
  });
}

loadAll();

// Ebook Library — books are pre-split into per-chapter HTML fragments
// (ebooks/<id>/chapters/*.html + a chapters.json manifest) and injected
// straight into this page's own DOM (not an iframe), so reading flows
// vertically like a normal page — and so the browser's native page
// translate can actually reach the text, the way it does on ariinui.github.io.
let ebooksCache = [];
let currentBook = null;
let currentChapters = [];
let currentChapterIndex = null;
let ebookScrollSaveTimer = null;
let ebookLastScrollTop = 0;
const EBOOK_COVER_COLORS = ['#f5b642', '#22c55e', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

function ebookCoverColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return EBOOK_COVER_COLORS[hash % EBOOK_COVER_COLORS.length];
}

function renderEbookShelf() {
  const container = document.getElementById('ebooksShelf');
  if (!ebooksCache.length) {
    container.innerHTML = '<div class="empty-state">No ebooks yet.</div>';
    return;
  }
  container.innerHTML = ebooksCache.map((b) => `
    <button class="ebook-card" data-id="${b.id}">
      ${b.cover
        ? `<img class="ebook-cover" src="${b.cover}" alt="">`
        : `<span class="ebook-cover" style="background:${ebookCoverColor(b.title)}">${b.title}</span>`}
      <span class="ebook-title">${b.title}</span>
      <span class="ebook-author">${b.author || ''}</span>
    </button>`).join('');
}

async function loadEbooks() {
  try {
    const data = await loadJSON('./data/ebooks.json');
    ebooksCache = data?.books || [];
  } catch (err) {
    console.error(err);
    ebooksCache = [];
  }
  renderEbookShelf();
}

function loadEbookProgress(bookId) {
  try {
    const all = JSON.parse(localStorage.getItem('ebookProgress') || '{}');
    return all[bookId] || null;
  } catch (err) {
    return null;
  }
}

function saveEbookProgress(bookId, chapterIdx, paragraphIndex) {
  try {
    const all = JSON.parse(localStorage.getItem('ebookProgress') || '{}');
    all[bookId] = { chapterIdx, paragraphIndex };
    localStorage.setItem('ebookProgress', JSON.stringify(all));
  } catch (err) {
    // localStorage unavailable (private browsing, storage blocked...) — not blocking
  }
}

function ebookBaseDir(book) {
  return book.chapters.replace(/\/chapters\.json$/, '');
}

function waitForEbookImages(container) {
  const imgs = [...container.querySelectorAll('img')];
  return Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }))));
}

// Resuming by raw scroll fraction drifts (image loading order/layout shifts
// change scrollHeight between save and restore) — anchor to the actual
// paragraph/image element at the top of the viewport instead, so "come back
// exactly where I stopped" means the same content, not just a similar %.
function ebookTopVisibleIndex(container) {
  const wrapper = container.firstElementChild;
  if (!wrapper) return 0;
  const children = wrapper.children;
  const containerTop = container.getBoundingClientRect().top;
  for (let i = 0; i < children.length; i++) {
    if (children[i].getBoundingClientRect().bottom > containerTop + 1) return i;
  }
  return Math.max(0, children.length - 1);
}

function ebookScrollToIndex(container, index) {
  const wrapper = container.firstElementChild;
  if (!wrapper || !wrapper.children.length) return;
  const target = wrapper.children[Math.min(Math.max(index, 0), wrapper.children.length - 1)];
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  container.scrollTop += targetRect.top - containerRect.top;
}

function showChapterList() {
  currentChapterIndex = null;
  document.getElementById('ebookReaderToc').hidden = true;
  document.getElementById('ebookReaderTitle').textContent = currentBook.title;
  const body = document.getElementById('ebookReaderBody');
  body.innerHTML = `<ol class="ebook-chapter-list">${currentChapters.map((c, i) => `
    <li><button class="ebook-chapter-item" data-idx="${i}">${c.title}</button></li>`).join('')}</ol>`;
  body.scrollTop = 0;
}

async function openChapter(idx, paragraphIndex) {
  if (!currentBook || idx < 0 || idx >= currentChapters.length) return;
  currentChapterIndex = idx;
  const chapter = currentChapters[idx];
  const book = currentBook;
  const body = document.getElementById('ebookReaderBody');
  document.getElementById('ebookReaderToc').hidden = false;
  document.getElementById('ebookReaderTitle').textContent = `${book.title} — ${chapter.title}`;
  body.innerHTML = '<div class="ebook-reader-loading">Loading…</div>';
  document.querySelector('.ebook-reader-bar').classList.remove('ebook-reader-bar-hidden');
  ebookLastScrollTop = 0;

  const chapterUrl = new URL(`${ebookBaseDir(book)}/chapters/${chapter.id}.html`, location.href);

  try {
    const html = await fetch(chapterUrl).then((r) => r.text());
    // Chapter fragments use paths relative to their own chapters/ folder
    // (e.g. "../images/x.webp") — resolve them against the chapter's own
    // URL before injecting into this page.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('img[src]').forEach((img) => {
      img.src = new URL(img.getAttribute('src'), chapterUrl).href;
    });
    // Source books (Calibre exports) mark their chapter title inconsistently
    // — sometimes a plain bold <p>, sometimes an <h2> — but it's always the
    // very first element inside the chapter's wrapping <div> (the exact split
    // point). Check that element directly instead of assuming a specific tag,
    // so every chapter's title gets centered/styled the same way instead of
    // only some of them.
    const firstEl = doc.body.firstElementChild?.firstElementChild;
    if (firstEl && /^chapter\s+\d+:/i.test(firstEl.textContent.trim())) {
      firstEl.classList.add('ebook-chapter-heading');
    }
    const nav = `
      <div class="ebook-chapter-nav">
        <button class="ebook-nav-prev"${idx === 0 ? ' disabled' : ''}>‹ Previous</button>
        <button class="ebook-nav-next"${idx === currentChapters.length - 1 ? ' disabled' : ''}>Next ›</button>
      </div>`;
    body.innerHTML = doc.body.innerHTML + nav;
  } catch (err) {
    console.error(err);
    body.innerHTML = '<div class="empty-state">Could not load this chapter.</div>';
    return;
  }

  body.scrollTop = 0;
  await waitForEbookImages(body);
  if (paragraphIndex) ebookScrollToIndex(body, paragraphIndex);
}

async function openEbookReader(book) {
  currentBook = book;
  currentChapters = [];
  currentChapterIndex = null;
  const reader = document.getElementById('ebookReader');
  const body = document.getElementById('ebookReaderBody');
  document.getElementById('ebookReaderTitle').textContent = book.title;
  document.getElementById('ebookReaderToc').hidden = true;
  body.innerHTML = '<div class="ebook-reader-loading">Loading…</div>';
  reader.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (!book.chapters) {
    body.innerHTML = '<div class="empty-state">This ebook has no readable content yet.</div>';
    return;
  }

  try {
    const manifest = await loadJSON(book.chapters);
    currentChapters = manifest?.chapters || [];
  } catch (err) {
    console.error(err);
    body.innerHTML = '<div class="empty-state">Could not load this ebook.</div>';
    return;
  }

  const progress = loadEbookProgress(book.id);
  if (progress && currentChapters[progress.chapterIdx]) {
    openChapter(progress.chapterIdx, progress.paragraphIndex);
  } else if (currentChapters.length === 1) {
    // A single-chapter book has no real table of contents to show — open
    // straight into it instead of a list with one button.
    openChapter(0);
  } else {
    showChapterList();
  }
}

// A "gallery" book has no chapters/prose — just categorized screenshots.
// Reuses the same fullscreen reader shell (bar + close + image viewer) since
// the body's <img> click delegation already opens any tapped image, no new
// wiring needed beyond rendering the category sections themselves.
async function openGallery(book) {
  currentBook = book;
  currentChapters = [];
  currentChapterIndex = null;
  const reader = document.getElementById('ebookReader');
  const body = document.getElementById('ebookReaderBody');
  document.getElementById('ebookReaderTitle').textContent = book.title;
  document.getElementById('ebookReaderToc').hidden = true;
  body.innerHTML = '<div class="ebook-reader-loading">Loading…</div>';
  reader.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.querySelector('.ebook-reader-bar').classList.remove('ebook-reader-bar-hidden');

  try {
    const galleryUrl = new URL(book.gallery, location.href);
    const data = await loadJSON(book.gallery);
    const categories = data?.categories || [];
    body.innerHTML = categories.map((cat) => `
      <section class="ebook-gallery-section">
        <h3 class="ebook-gallery-title">${cat.title}</h3>
        <div class="ebook-gallery-grid">
          ${cat.images.map((src) => `<img loading="lazy" src="${new URL(src, galleryUrl).href}" alt="">`).join('')}
        </div>
      </section>`).join('') || '<div class="empty-state">No photos yet.</div>';
  } catch (err) {
    console.error(err);
    body.innerHTML = '<div class="empty-state">Could not load this gallery.</div>';
    return;
  }
  body.scrollTop = 0;
}

function closeEbookReader() {
  saveEbookProgressNow();
  const reader = document.getElementById('ebookReader');
  reader.classList.remove('open');
  document.getElementById('ebookReaderBody').innerHTML = '';
  document.getElementById('ebookReaderToc').hidden = true;
  document.body.style.overflow = '';
  currentBook = null;
  currentChapters = [];
  currentChapterIndex = null;
}

// Individual chart screenshots are landscape-formatted — tapping one opens
// it in its own fullscreen viewer (separate from the reading view, which
// stays mounted underneath at its scroll position). Fullscreen + Screen
// Orientation Lock actually rotate the device on Android Chrome; browsers
// that refuse them (notably iOS Safari) silently fail here and fall back to
// the CSS `.force-landscape` rotate-the-box trick defined in styles.css.
function openEbookImage(src) {
  const viewer = document.getElementById('ebookImageViewer');
  document.getElementById('ebookImageViewerImg').src = src;
  viewer.classList.add('open');
  if (currentBook?.landscape && window.matchMedia('(max-width: 900px)').matches) {
    viewer.classList.add('force-landscape');
    viewer.requestFullscreen().then(() => screen.orientation.lock('landscape')).catch(() => {});
  }
}

function closeEbookImage() {
  const viewer = document.getElementById('ebookImageViewer');
  viewer.classList.remove('open', 'force-landscape');
  document.getElementById('ebookImageViewerImg').src = '';
  if (screen.orientation?.unlock) screen.orientation.unlock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

document.getElementById('ebooksShelf').addEventListener('click', (e) => {
  const card = e.target.closest('.ebook-card');
  if (!card) return;
  const book = ebooksCache.find((b) => b.id === card.dataset.id);
  if (!book) return;
  if (book.type === 'gallery') openGallery(book); else openEbookReader(book);
});
document.getElementById('ebookReaderClose').addEventListener('click', closeEbookReader);
document.getElementById('ebookReaderToc').addEventListener('click', showChapterList);
document.getElementById('ebookReaderBody').addEventListener('click', (e) => {
  const chapterBtn = e.target.closest('.ebook-chapter-item');
  if (chapterBtn) {
    openChapter(Number(chapterBtn.dataset.idx));
    return;
  }
  const prevBtn = e.target.closest('.ebook-nav-prev');
  if (prevBtn && !prevBtn.disabled) {
    openChapter(currentChapterIndex - 1);
    return;
  }
  const nextBtn = e.target.closest('.ebook-nav-next');
  if (nextBtn && !nextBtn.disabled) {
    openChapter(currentChapterIndex + 1);
    return;
  }
  const img = e.target.closest('img');
  if (img) openEbookImage(img.currentSrc || img.src);
});
document.getElementById('ebookReaderBody').addEventListener('scroll', (e) => {
  const body = e.currentTarget;

  // Hide the title bar while advancing through the text (content scrolling
  // up), bring it back when scrolling back up toward earlier content —
  // standard reader behavior (Kindle/Medium-style), frees screen space
  // while reading. Always shown near the very top so it's never hidden
  // right when a chapter opens.
  const bar = document.querySelector('.ebook-reader-bar');
  const delta = body.scrollTop - ebookLastScrollTop;
  if (body.scrollTop < 40) {
    bar.classList.remove('ebook-reader-bar-hidden');
  } else if (delta > 5) {
    bar.classList.add('ebook-reader-bar-hidden');
  } else if (delta < -5) {
    bar.classList.remove('ebook-reader-bar-hidden');
  }
  ebookLastScrollTop = body.scrollTop;

  if (!currentBook || currentChapterIndex == null) return;
  const bookId = currentBook.id;
  const idx = currentChapterIndex;
  clearTimeout(ebookScrollSaveTimer);
  ebookScrollSaveTimer = setTimeout(() => {
    saveEbookProgress(bookId, idx, ebookTopVisibleIndex(body));
  }, 300);
});

// Leaving the page/app (switching apps, closing the tab) can happen before
// the debounced scroll save above fires — save immediately in that case so
// resuming later always lands on the exact paragraph, not a slightly stale one.
function saveEbookProgressNow() {
  if (!currentBook || currentChapterIndex == null) return;
  clearTimeout(ebookScrollSaveTimer);
  saveEbookProgress(currentBook.id, currentChapterIndex, ebookTopVisibleIndex(document.getElementById('ebookReaderBody')));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveEbookProgressNow();
});
window.addEventListener('pagehide', saveEbookProgressNow);

document.getElementById('ebookImageViewerClose').addEventListener('click', closeEbookImage);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('ebookImageViewer').classList.contains('open')) {
    closeEbookImage();
  } else {
    closeEbookReader();
  }
});
document.getElementById('ebooksToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('ebooksBody').classList.toggle('collapsed', expanded);
});

loadEbooks();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW registration failed', err));
  });
  // Nouvelle version déployée : le SW (skipWaiting + clients.claim) prend la main → proposer de recharger.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (document.getElementById('updateToast')) return;
      const t = document.createElement('div');
      t.id = 'updateToast';
      t.className = 'update-toast';
      t.innerHTML = '<span>Nouvelle version disponible</span><button type="button">Recharger</button>';
      t.querySelector('button').addEventListener('click', () => location.reload());
      document.body.appendChild(t);
    });
  }
}

// ===== CANDLE : bougies POH (14h / 15h-17h / 22h / 02h, heure UTC-10) des symboles de Charts =====
let candlePoh = null;
let candleSelected = null;
const CANDLE_SLOTS = [['12', '12h'], ['14', '14h'], ['15', '15h'], ['17', '17h'], ['22', '22h'], ['23', '23h'], ['02', '02h'], ['03', '03h'], ['07', '07h']];
let candleDaily = null; // { PAIR: [[t,o,h,l,c], ...4 derniers jours D3..D0] }
// Historique 1 min / 5 min à gauche des POH (flèches ‹ › dans l'en-tête) : '0' = POH seuls (vue habituelle), '1' / '5' = bougies 1 min / 5 min
let candleHistTf = '0';
let candleMini = false; // roue > « 4 candles » : liste défilante de tous les symboles avec leurs 4 bougies (14h, 15-17h, 22h, 02h), comme à l'origine (enregistré)
try { candleMini = localStorage.getItem('candleMini') === '1'; } catch (e) { /* pas de stockage */ }
let candleClean = false; // clic sur le nom du symbole : échelle de prix + rangée Fibo / Sweep / F+S masquées, jusqu'au prochain clic (enregistré)
try { candleClean = localStorage.getItem('candleClean') === '1'; } catch (e) { /* pas de stockage */ }
try { candleHistTf = localStorage.getItem('candleHistTf') || '0'; } catch (e) { /* pas de stockage */ }
const CANDLE_HIST_MODES = ['0', '1', '5', '60', '240', '1D'], CANDLE_HIST_LBL = { 0: '\u2014', 1: '1m', 5: '5m', 60: '1h', 240: '4h', '1D': '1D' };
const CANDLE_HIST_N = { 1: 50, 5: 50, 60: 24, 240: 12, '1D': 8 }; // bougies récentes prises pour caler l'échelle de prix (1 jour environ)
if (!CANDLE_HIST_MODES.includes(candleHistTf)) candleHistTf = '0';
const candleHistData = {}; // 'PAIR|tf' -> { bars: [[t,o,h,l,c]...], at, busy }
const CANDLE_FLAG = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', AUD: 'au', NZD: 'nz', CAD: 'ca', CHF: 'ch' }; // drapeaux ronds des pastilles de news (comme TradingView)
const CANDLE_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'], CANDLE_DAYS_S = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const CANDLE_DAYFR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const CANDLE_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let candleEcoEv = []; // news à fort impact (calendrier éco) : { country, title, _t, actual, forecast, previous }
const candleEvHits = {}; // paire -> [{ x, y, r, list }] zones cliquables des pastilles (repère du graphique)
let candleFocusMark = null; // repère de l'événement ALERTE ouvert dans CANDLE : { id, t } (trait bleu vertical + flèche)
let candleF50 = {}; // { PAIR: { hi, lo, ... } } boîte 14H (niveaux Entry / 50 % / TP)
// REPLAY (façon TradingView) : on rejoue les bougies du graphique affiché. rp.t = heure d'ouverture de la dernière barre visible ; tout ce qui est après est masqué
const rp = { on: false, id: null, t: 0, pick: false, playing: false, timer: 0, spd: 0, qty: 1, slp: 0, tpp: 0, tw: true, wm: true, view: null, vkey: '', pos: null, done: [], msg: '' };
const RP_SPEEDS = [[100, '10x', '10 màj par sec'], [143, '7x', '7 MàJ par seconde'], [200, '5x', '5 MàJ par seconde'], [333, '3x', '3 màj par sec'], [1000, '1x', '1 màj par sec'], [2000, '0.5x', '1 màj par 2 sec'], [3333, '0.3x', '1 màj par 3 sec'], [5000, '0.2x', '1 MàJ par 5 secondes'], [10000, '0.1x', '1 màj par 10 sec']]; // délai entre 2 bougies (mêmes vitesses que TradingView)
try { const s = parseInt(localStorage.getItem('candleRpSpd3'), 10); if (s >= 0 && s < RP_SPEEDS.length) rp.spd = s; } catch (e) { /* pas de stockage */ }
let candleXh = null; // réticule (croix pointillée) façon TradingView : { id, x, y } en pixels du graphique ; le ⊕ de l'étiquette de prix crée une alerte
const XH_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], XH_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function candleXhTime(t) { // secondes UTC -> « Sat 07 Nov '26  16:39 » en UTC-10 (fuseau de l'utilisateur)
  const d = new Date((t - 36000) * 1000), p = (n) => String(n).padStart(2, '0');
  return `${XH_DAYS[d.getUTCDay()]} ${p(d.getUTCDate())} ${XH_MON[d.getUTCMonth()]} '${p(d.getUTCFullYear() % 100)}  ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
let candleAl = [], candleAlAt = 0; // alertes de prix en attente (serveur) : { id, pair, price, dir, created }
const candleAlHits = {};
let candleAlDrag = null; // alerte en cours de déplacement : { aid, price, moved }
let candlePrev = null; // niveau en cours de création (fiche « Price alert » ouverte) : { id, price } — ligne bleue d'aperçu qui reste visible tant que la fiche est ouverte
function candleRpCount(full) { // nombre de barres dont l'ouverture <= rp.t (borne haute par dichotomie)
  let a = 0, b = full.length;
  while (a < b) { const m = (a + b) >> 1; if (full[m][0] <= rp.t) a = m + 1; else b = m; }
  return Math.max(1, a);
}
function candleRpBars(full, id) { // barres visibles pendant le replay (copie mise en cache : recalculée seulement si la position ou les données changent)
  if (rp.pick) return full;
  const n = candleRpCount(full), key = id + '|' + candleHistTf + '|' + full.length + '|' + full[full.length - 1][0] + '|' + n;
  if (rp.vkey !== key) { rp.view = full.slice(0, n); rp.vkey = key; }
  return rp.view;
}
const RP_SLOTS = { '12': [0, 2], '14': [2, 3], '15': [3, 5], '17': [5, 10], '22': [10, 11], '23': [11, 14], '02': [14, 15], '03': [15, 19], '07': [19, 24] }; // mêmes périodes POH que le proxy (heures UTC+2)
function candleRpPoh(id) { // replay : POH et bougies D3..D0 recalculés à partir des barres fines JUSQU'À la position du replay ; la journée POH commence toujours par la bougie 12h, le POH en cours se forme avec le prix (comme D0)
  if (!rp.on || rp.id !== id || rp.pick) return null;
  const tfSec = (candleHistTf === '1D' ? 1440 : +candleHistTf || 1) * 60, cut = rp.t + tfSec;
  let bars = null, used = '';
  for (const tf of ['1', '5', '60']) { // barres les plus fines qui couvrent la position du replay (4 jours d'avance pour D3), sinon les plus anciennes disponibles
    const h = candleHistData[id + '|' + tf];
    if (!h || !h.bars.length) continue;
    if (!bars || h.bars[0][0] < bars[0][0]) { bars = h.bars; used = tf; }
    if (h.bars[0][0] <= cut - 5 * 86400) { bars = h.bars; used = tf; break; }
  }
  if (!bars) return { day: { d: '', c: {} }, dly: [] };
  const key = id + '|' + used + '|' + cut + '|' + bars.length;
  if (rp.poh && rp.poh.key === key) return rp.poh;
  const bsec = +used * 60;
  let a = 0, b = bars.length; const from = cut - 6 * 86400;
  while (a < b) { const m = (a + b) >> 1; if (bars[m][0] < from) a = m + 1; else b = m; }
  const days = new Map(); let lastK = null;
  for (let i = a; i < bars.length && bars[i][0] + bsec <= cut; i++) { // seules les barres entièrement jouées (pas de futur)
    const [t, o, h, l, c] = bars[i], k = Math.floor((t + 7200) / 86400);
    const d = days.get(k);
    if (!d) days.set(k, { o, h, l, c }); else { if (h > d.h) d.h = h; if (l < d.l) d.l = l; d.c = c; }
    lastK = k;
  }
  const out = { key, day: { d: '', c: {} }, dly: [] };
  if (lastK === null) { rp.poh = out; return out; }
  const ks = [...days.keys()].sort((x, y) => x - y).slice(-4);
  out.dly = ks.map((k) => { const d = days.get(k); return [k * 86400 - 7200, d.o, d.h, d.l, d.c]; });
  out.day.d = new Date(lastK * 86400 * 1000).toISOString().slice(0, 10);
  for (let i = a; i < bars.length && bars[i][0] + bsec <= cut; i++) { // POH du jour de trading en cours (UTC+2) : de 12h jusqu'à la période en cours
    const [t, o, h, l, c] = bars[i];
    if (Math.floor((t + 7200) / 86400) !== lastK) continue;
    const hr = Math.floor(((t + 7200) % 86400) / 3600);
    for (const k of Object.keys(RP_SLOTS)) {
      if (hr < RP_SLOTS[k][0] || hr >= RP_SLOTS[k][1]) continue;
      const s0 = out.day.c[k];
      if (!s0) out.day.c[k] = [o, h, l, c]; else { if (h > s0[1]) s0[1] = h; if (l < s0[2]) s0[2] = l; s0[3] = c; }
    }
  }
  rp.poh = out;
  return out;
}
function candleHistBars(id) {
  if (candleHistTf === '0') return null;
  const h = candleHistData[id + '|' + candleHistTf];
  if (!h || !h.bars.length) return null;
  return rp.on && rp.id === id ? candleRpBars(h.bars, id) : h.bars;
}
function candleHistEnsure(id, tfx) { // charge (au plus toutes les 25 s) les bougies de la paire affichée, puis redessine EN PLACE
  if (!id || (candleHistTf === '0' && !tfx)) return;
  const tf = tfx || candleHistTf, key = id + '|' + tf, h = candleHistData[key] || (candleHistData[key] = { bars: [], at: 0, busy: false });
  if (h.busy || Date.now() - h.at < (tf === '1' || tf === '5' ? 25000 : 300000)) return; // 1h / 4h / 1D : fichiers plus lourds, rechargés au plus toutes les 5 min
  h.busy = true;
  // 1 min / 5 min : après le 1er chargement complet (historique), on ne redemande que les bougies récentes (dernière = en formation)
  const since = (tf === '1' || tf === '5') && h.bars.length ? h.bars[h.bars.length - 1][0] : 0;
  fetch(`https://ariinuiirgina.vercel.app/api/poh-candles?pair=${id}&tf=${tf}${since ? '&since=' + since : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && j.bars && j.bars.length) h.bars = since ? h.bars.filter((b) => b[0] < since).concat(j.bars) : j.bars;
      if ((tf === candleHistTf || rp.on) && !(cg.mode)) candleRedraw(id, candleViewOf(id));
      if (!since && tf === '1' && id === 'EURUSD' && h.bars.length && !h.deep) candleDeepLoad(id, h); // TEST : jusqu'à 250 000 barres 1 min MT5
    })
    .catch(() => { /* on garde ce qui est affiché */ })
    .finally(() => { h.busy = false; h.at = Date.now(); });
}
// Historique profond (fichiers MT5 privés) : pages de 50 000 barres plus anciennes, ajoutées à GAUCHE des barres déjà chargées
async function candleDeepLoad(id, h) {
  h.deep = true;
  try {
    for (let k = 0; k < 8 && h.bars.length; k++) {
      const r = await fetch(`https://ariinuiirgina.vercel.app/api/poh-candles?pair=${id}&tf=1&older=${h.bars[0][0]}&n=50000`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) break;
      const j = await r.json();
      if (!j.bars || !j.bars.length) break;
      h.bars = j.bars.concat(h.bars);
      if (candleHistTf === '1' && !(cg.mode)) candleRedraw(id, candleViewOf(id));
      if (!j.more) break;
    }
  } catch (e) { h.deep = false; /* nouvel essai au prochain chargement */ }
}

// Dimensions réelles de la zone graphique (plein écran) : le SVG est dessiné à l'échelle 1:1, sans déformation
function candleDims() {
  const rpp = rp.on ? document.getElementById('rpBar') : null; // replay : barres du haut et du bas masquées, seule la barre d'icônes du replay occupe le bas
  return { W: Math.max(300, Math.round(window.innerWidth)), H: Math.max(300, Math.round(window.innerHeight) - (rpp && rpp.offsetHeight ? rpp.offsetHeight : rp.on ? 58 : candleClean ? 46 : 90)) };
}
function candleNiceStep(rng, n) {
  const raw = rng / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
// Échelle de prix : calée sur les 9 POH (priorité d'affichage), journalières coupées sur les bords
function candleScale(dly, day, hist) {
  const dd = (dly || []).slice(-4), poh = Object.values((day && day.c) || {}); // POH : [o, h, l, c] ; daily : [t, o, h, l, c]
  const base = poh.length ? poh : dd.map((b) => b.slice(1, 5));
  if (!base.length && !(hist && hist.length)) return null; // replay : ni POH ni daily, seulement les barres visibles
  let hi = base.length ? Math.max(...base.map((c) => c[1])) : -Infinity, lo = base.length ? Math.min(...base.map((c) => c[2])) : Infinity;
  if (hist && hist.length) for (const b of hist.slice(-(CANDLE_HIST_N[candleHistTf] || 50))) { hi = Math.max(hi, b[2]); lo = Math.min(lo, b[3]); }
  const d0 = dd.length ? dd[dd.length - 1] : null;
  const minSpan = d0 ? (d0[2] - d0[3]) * 0.35 : 0; // évite un zoom extrême quand il n'y a encore qu'une ou deux bougies POH
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; hi = mid + minSpan / 2; lo = mid - minSpan / 2; }
  const m = (hi - lo || hi * 0.001) * 0.08;
  return { hi: hi + m, lo: lo - m };
}
// Fibonacci 38/50/61 sur D1 si D2 et D1 vont dans le même sens (mesuré depuis le plus bas si haussières, depuis le plus haut si baissières)
function candleFibLevels(dly) {
  const a = (dly || []).slice(-4);
  if (a.length < 3) return null;
  const d1 = a[a.length - 2], d2 = a[a.length - 3]; // [t, o, h, l, c]
  const bu1 = d1[4] > d1[1], be1 = d1[4] < d1[1], bu2 = d2[4] > d2[1], be2 = d2[4] < d2[1];
  if (!((bu1 && bu2) || (be1 && be2))) return null;
  const r = d1[2] - d1[3];
  return [[0.382, '38'], [0.5, '50'], [0.618, '61']].map(([p, t]) => ({ t, v: bu1 ? d1[3] + p * r : d1[2] - p * r }));
}
const CANDLE_UP = '#00a3e0', CANDLE_DN = '#ffffff'; // couleurs des bougies comme TradingView (haussière bleue, baissière blanche)
const CANDLE_G = { AX: 60, TOP: 44, BOT: 14, LEFT: 4 }; // géométrie du graphique (aussi utilisée par les gestes)
if (candleClean) CANDLE_G.AX = 0;
function candleSvg(day, dly, view, id) {
  const rpx = candleRpPoh(id); // replay : POH / daily calculés à la position du replay
  if (rpx) { day = rpx.day; dly = rpx.dly; }
  const dd = (dly || []).slice(-4).map((b, i, a) => ({ lbl: 'D' + (a.length - 1 - i), dn: CANDLE_DAYFR[new Date((b[0] + 7200) * 1000).getUTCDay()], c: b.slice(1, 5) })); // dn : jour de la semaine en français (jour de trading UTC+2) affiché à la place de D3..D0
  const cs = dd.concat([{ lbl: '', c: null }], CANDLE_SLOTS.map(([k, lbl]) => ({ lbl, c: day.c[k] })));
  const vals = cs.filter((x) => x.c);
  if (!vals.length && !(id && rp.on && rp.id === id)) return '';
  const { W, H } = candleDims();
  const { AX, TOP, BOT, LEFT } = CANDLE_G;
  const hist = id ? candleHistBars(id) : null;
  const RP = !!(id && rp.on && rp.id === id); // replay : POH, Fibo, PDH/PDL et boîte 14H masqués (ils montreraient le futur)
  if (RP && !hist) return '';
  const sc = candleScale(dly, day, hist), vw = view || CANDLE_DEF;
  const baseRng = sc.hi - sc.lo, cenV = (sc.hi + sc.lo) / 2 + vw.yp * baseRng, rng = baseRng / vw.yz;
  const lo = cenV - rng / 2, hi = cenV + rng / 2; // fenêtre de prix affichée (zoom vertical + décalage)
  const y = (v) => TOP + (1 - (v - lo) / rng) * (H - TOP - BOT);
  const dec = hi >= 1000 ? 2 : hi >= 100 ? 3 : 5;
  const fmt = (v) => v.toFixed(dec);
  const stepP = candleNiceStep(rng, 8);
  let grid = '';
  for (let v = Math.ceil(lo / stepP) * stepP; v <= hi; v += stepP) {
    grid += `<text x="${W - AX + 6}" y="${(y(v) + 4).toFixed(1)}" class="pc-ax">${fmt(v)}</text>`; // seuls les chiffres de l'échelle : plus de lignes grises horizontales
  }
  // avec l'historique : les POH occupent la moitié droite, l'historique la moitié gauche ; zoom/déplacement s'appliquent à l'ensemble
  const split = hist ? 0.5 : 0, plotW0 = W - AX - LEFT, stepB = plotW0 * (1 - split) / cs.length;
  const step = stepB * vw.xz, xOff = vw.xp * (W - AX) + split * plotW0 * vw.xz, bw = Math.min(step * 0.74, 120); // zoom horizontal + décalage
  const hl = RP ? hist[hist.length - 1] : null;
  const last = RP ? { c: [hl[1], hl[2], hl[3], hl[4]] } : [...cs].reverse().find((x) => x.c);
  const lastC = last.c[3], lastCol = last.c[3] >= last.c[0] ? '#089981' : '#f23645'; // ligne du dernier prix : verte si haussière, rouge si baissière
  const lfCap = 0.9 * step / (0.62 * Math.max(2, ...cs.map((x) => String(x.dn || x.lbl || '').length))); // taille max commune : le plus long label tient dans l'écart entre 2 bougies (pas de chevauchement)
  const body = cs.map((x, i) => {
    const cx = LEFT + xOff + step * (i + 0.5);
    if (!x.c) return '';
    const [o, h, l, c] = x.c;
    let col = c >= o ? CANDLE_UP : CANDLE_DN;
    // POH 14h / 22h / 02h : la bougie POH suivante sweepe son haut (rouge) ou son bas (vert) = dépasse l'extrême puis clôture de retour dedans ; si les deux, la clôture de la suivante tranche (baissière = haut en dernier)
    if (x.lbl === '14h' || x.lbl === '22h' || x.lbl === '02h') {
      const nx = cs[i + 1] && cs[i + 1].c;
      if (nx) {
        const sh = nx[1] > h && nx[3] < h, sl = nx[2] < l && nx[3] > l;
        if (sh && sl) col = nx[3] < nx[0] ? '#f23645' : '#089981'; else if (sh) col = '#f23645'; else if (sl) col = '#089981';
      }
    }
    const top = y(Math.max(o, c)), ht = Math.max(1, Math.abs(y(o) - y(c)));
    const vis = h >= lo && l <= hi; // la bougie touche la zone affichée
    const lf = Math.min(44, 11 * bw / Math.max(1, Math.min(stepB * 0.74, 120)), lfCap); // label POH : suit la largeur de la bougie (11 px au zoom d'origine)
    return (vis && lf >= 3.5 ? `<text x="${cx.toFixed(1)}" y="${Math.min(H - 6 * lf / 11, Math.max(1.3 * lf, y(h) - 0.55 * lf)).toFixed(1)}" text-anchor="middle" class="pc-lbl" style="fill:${col};font-size:${lf.toFixed(1)}px">${x.dn || x.lbl}</text>` : '') +
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(h).toFixed(1)}" y2="${y(l).toFixed(1)}" stroke="${col}" stroke-width="0.9"/>` +
      `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${ht.toFixed(1)}" fill="${c >= o ? '#0b0b0b' : col}" stroke="${col}" stroke-width="0.9"/>`;
  }).join('');
  const axT = []; // étiquettes des lignes : affichées DANS l'échelle de prix à droite (nom de la ligne à la place du prix), centrées sur la ligne
  let fib = '';
  const fl = RP ? null : candleFibLevels(dly), d1i = cs.findIndex((x) => x.lbl === 'D1');
  if (fl && d1i >= 0) {
    const x0 = LEFT + xOff + step * (d1i + 0.5);
    fib = fl.filter((f) => f.v >= lo && f.v <= hi).map((f) => { axT.push({ y: y(f.v), t: f.t + '%', c: '#f5b642' }); return `<line x1="${x0.toFixed(1)}" x2="${W - AX}" y1="${y(f.v).toFixed(1)}" y2="${y(f.v).toFixed(1)}" stroke="#f5b642" stroke-opacity="0.5" stroke-width="0.7" stroke-dasharray="1 4" stroke-linecap="round"/>`; }).join('');
  }
  let hb = '', evb = '', sepSvg = '', xhT = '';
  if (hist) {
    const hs0 = stepB / 3 * vw.xz, edge = LEFT + xOff - stepB * 0.5 * vw.xz; // hs0 = largeur d'une barre
    const sg = Math.max(1, Math.floor(1.2 / hs0)); // très dézoomé : bougies regroupées (comme TradingView), le graphique reste fluide quel que soit le zoom
    const hs = hs0 * sg, hw = Math.max(1, hs * 0.7);
    if (candleXh && candleXh.id === id) { const j = Math.floor((edge - candleXh.x) / hs), i = hist.length - 1 - j * sg; if (candleXh.x <= edge && j >= 0 && i >= 0) xhT = candleXhTime(hist[i][0]); } // les barres vont vers la gauche depuis `edge` (dernière barre) ; pas d'heure au-dessus des POH ni du futur
    const jMin = Math.max(0, Math.floor((edge - (W - AX)) / hs) - 1), jMax = Math.min(Math.ceil(hist.length / sg) - 1, Math.ceil((edge + hs) / hs));
    const is1D = candleHistTf === '1D', tfMin = is1D ? 1440 : +candleHistTf, tfSec = tfMin * 60, kLbl = Math.max(1, Math.round(80 / hs));
    if (candleFocusMark && candleFocusMark.id === id && !is1D) { // repère de l'événement ALERTE : dernière barre dont l'heure d'ouverture <= heure de l'événement
      let a = 0, b = hist.length - 1;
      while (a < b) { const m = (a + b + 1) >> 1; if (hist[m][0] <= candleFocusMark.t) a = m; else b = m - 1; }
      const fx = edge - (Math.floor((hist.length - 1 - a) / sg) + 0.5) * hs;
      if (fx >= 0 && fx <= W - AX) evb += `<line x1="${fx.toFixed(1)}" x2="${fx.toFixed(1)}" y1="0" y2="${H - BOT - 30}" stroke="#5cc8ff" stroke-width="1" stroke-dasharray="4 4" stroke-opacity=".8"/>` +
        `<path d="M${(fx - 7).toFixed(1)} ${H - BOT - 2} L${(fx + 7).toFixed(1)} ${H - BOT - 2} L${fx.toFixed(1)} ${H - BOT - 14} Z" fill="#5cc8ff"/>`;
    }
    const tLast = hist[hist.length - 1][0], noClose = /^(BTC|ETH)/.test(id), xMax = W - AX, R = 12;
    const futStart = LEFT + xOff + step * cs.length; // le futur commence à droite du bloc des POH et se prolonge à l'infini
    const phase = (t) => ((t % 604800) + 604800) % 604800;
    const closedAt = (t) => !noClose && phase(t) >= 165600 && phase(t) < 338400; // marché fermé du vendredi 22:00 UTC au dimanche 22:00 UTC (pas de barres le week-end ; crypto : jamais)
    const openSecs = (a, b) => { // secondes de marché ouvert entre a et b
      let tot = b - a;
      if (!noClose) for (let w = Math.floor((a - 338400) / 604800); w * 604800 + 165600 < b; w++) tot -= Math.max(0, Math.min(b, w * 604800 + 338400) - Math.max(a, w * 604800 + 165600));
      return tot;
    };
    const fxBar = (k) => futStart + (k - 0.5) * hs0; // centre de la k-ième barre future (k >= 1)
    const barShift = tfMin >= 60 ? 60 : 0; // les barres 1h / 4h sont datées hh:01 (comme TradingView), les barres 1 et 5 min hh:mm
    const hourStep = is1D ? 0 : ([60, 300, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200].find((s) => s >= tfSec && s / tfSec * hs0 >= 80) || 0); // pas des étiquettes d'heure ; 0 = jours seulement
    const ticks = [], wdays = [];
    candleEvHits[id] = [];
    if (!is1D && candleEcoEv.length && id) { // news à fort impact (passé ET futur) : pastille drapeau rond à anneau rouge sur l'axe du temps, sur UNE seule rangée comme TradingView, + trait vertical gris très discret
      const ccys = chartsPairCcys(id), groups = new Map(), cy = H - BOT - R - 4;
      for (const e of candleEcoEv) {
        if (ccys.indexOf(e.country) < 0 || e._t < hist[0][0] || (RP && e._t >= tLast + tfSec)) continue; // replay : pas de news futures (leur résultat serait connu)
        let key, x;
        if (e._t < tLast + tfSec) { // la pastille est posée sur la barre qui contient l'heure de la news (dernière barre dont l'heure d'ouverture <= heure de la news)
          let lo2 = 0, hi2 = hist.length - 1;
          while (lo2 < hi2) { const m = (lo2 + hi2 + 1) >> 1; if (hist[m][0] <= e._t) lo2 = m; else hi2 = m - 1; }
          const jg = Math.floor((hist.length - 1 - lo2) / sg);
          x = edge - (jg + 0.5) * hs; key = e.country + '|p|' + jg;
        } else {
          const k = Math.floor(openSecs(tLast, e._t) / tfSec);
          x = fxBar(k); key = e.country + '|f|' + k;
        }
        if (!groups.has(key)) groups.set(key, { x, ccy: e.country, list: [] });
        groups.get(key).list.push(e);
      }
      const seen = {};
      [...groups.values()].sort((a, b) => a.x - b.x).forEach((g) => {
        const kx = Math.round(g.x), n = seen[kx] || 0; seen[kx] = n + 1;
        const x = g.x + n * R * 1.1; // deux devises sur la même barre : pastilles côte à côte
        if (x < -R || x > xMax + R) return;
        g.list.sort((a, b) => a._t - b._t);
        sepSvg += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${(cy - R).toFixed(1)}" stroke="#232323" stroke-width="1" stroke-dasharray="5 6"/>`;
        evb += `<circle cx="${x.toFixed(1)}" cy="${cy}" r="${R - 1}" fill="#000" stroke="#ef5350" stroke-width="2"/>` +
          `<image href="https://hatscripts.github.io/circle-flags/flags/${CANDLE_FLAG[g.ccy] || 'un'}.svg" x="${(x - R + 4).toFixed(1)}" y="${cy - R + 4}" width="${2 * R - 8}" height="${2 * R - 8}"/>`;
        candleEvHits[id].push({ x, y: cy, r: R, list: g.list });
      });
    }
    let sepX = -1e9;
    for (let j = jMin; j <= jMax; j++) { // j = rang du groupe (1 bougie par groupe quand le zoom est normal)
      const i0 = hist.length - 1 - j * sg, iLo = Math.max(0, i0 - sg + 1);
      let b = hist[i0];
      if (sg > 1) { let gh = -Infinity, gl = Infinity; for (let q = iLo; q <= i0; q++) { if (hist[q][2] > gh) gh = hist[q][2]; if (hist[q][3] < gl) gl = hist[q][3]; } b = [hist[i0][0], hist[iLo][1], gh, gl, hist[i0][4]]; }
      const x = edge - (j + 0.5) * hs, col = b[4] >= b[1] ? CANDLE_UP : CANDLE_DN;
      hb += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(b[2]).toFixed(1)}" y2="${y(b[3]).toFixed(1)}" stroke="${col}" stroke-width="0.7"/>` +
        `<rect x="${(x - hw / 2).toFixed(1)}" y="${y(Math.max(b[1], b[4])).toFixed(1)}" width="${hw.toFixed(1)}" height="${Math.max(1, Math.abs(y(b[1]) - y(b[4]))).toFixed(1)}" fill="${col}"/>`;
      const older = hist[iLo - 1]; // barre précédente
      if (is1D) {
        if (j % kLbl === 0) hb += `<text x="${x.toFixed(1)}" y="${H - 3}" text-anchor="middle" class="pc-ax" style="font-size:9px">${new Date((b[0] - 36000) * 1000).toISOString().slice(2, 10)}</text>`;
        continue;
      }
      if (!older) continue;
      const dB = Math.floor((b[0] - 36000) / 86400), dO = Math.floor((older[0] - 36000) / 86400);
      const sess = Math.floor((b[0] - 79200) / 86400) !== Math.floor((older[0] - 79200) / 86400); // 1re barre de la séance (12:01 UTC-10) : trait pointillé pile sur cette barre
      if (sess && Math.abs(x - sepX) >= 20) { sepSvg += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${H}" stroke="#4a4a4a" stroke-width="1" stroke-dasharray="1 2.75"/>`; sepX = x; }
      if (dB !== dO) { // minuit UTC-10 : numéro du jour (gras), ou nom du mois au changement de mois ; le nom du jour est posé au même endroit
        const dt = new Date((b[0] - 36000) * 1000), mo = new Date((older[0] - 36000) * 1000).getUTCMonth() !== dt.getUTCMonth();
        ticks.push({ x, w: mo ? 4 : 3, t: mo ? CANDLE_MON[dt.getUTCMonth()] : dt.getUTCDate() });
        if ((b[0] - 36000) % 86400 <= 60) wdays.push({ x, d: dt.getUTCDay() });
      } else if (hourStep) {
        if (sess) ticks.push({ x, w: 2, t: alerteTime(b[0]) }); // « 12:01 » : début de séance
        else { const r = (b[0] - 36000) % hourStep; if (r === 0 || (r === 60 && !((older[0] - 36000) % hourStep === 0))) ticks.push({ x, w: 1, t: alerteTime(b[0]) }); }
      }
    }
    if (!is1D && futStart < xMax + 60) { // axe du temps du FUTUR (à droite des POH) : mêmes règles que l'historique, jours ouvrés seulement
      const nBar = (t) => Math.round(openSecs(tLast, t + barShift) / tfSec);
      for (let d = 0, tt = (Math.floor((tLast - 36000) / 86400) + 1) * 86400 + 36000; d < 400; d++, tt += 86400) { // minuits UTC-10 suivants
        const ts = tt + 43200; // début de séance (12:00 UTC-10 = 22:00 UTC)
        if (!closedAt(ts)) {
          const ks = nBar(ts), xs = fxBar(ks);
          if (xs <= xMax && xs >= 0 && ks >= 1) { sepSvg += `<line x1="${xs.toFixed(1)}" x2="${xs.toFixed(1)}" y1="0" y2="${H}" stroke="#4a4a4a" stroke-width="1" stroke-dasharray="1 2.75"/>`; if (hourStep) ticks.push({ x: xs, w: 2, t: alerteTime(ts + barShift) }); }
        }
        let to = tt;
        if (closedAt(to)) to += 338400 - phase(to); // week-end : le numéro du jour va sur la réouverture du dimanche
        if (to >= tt + 86400) continue;
        const k = nBar(to), x = fxBar(k);
        if (k < 1) continue;
        if (x > xMax) break;
        if (x < 0) continue;
        const dt = new Date((tt - 36000) * 1000);
        ticks.push({ x, w: dt.getUTCDate() === 1 ? 4 : 3, t: dt.getUTCDate() === 1 ? CANDLE_MON[dt.getUTCMonth()] : dt.getUTCDate() });
        if (to === tt) wdays.push({ x, d: dt.getUTCDay() });
      }
      if (hourStep) {
        for (let k = 0, t = (Math.floor((tLast - 36000) / hourStep) + 1) * hourStep + 36000; k < 4000; k++, t += hourStep) {
          const r = (t - 36000) % 86400;
          if (closedAt(t) || r === 0 || r === 43200) continue; // minuit et début de séance : déjà posés ci-dessus
          const n = nBar(t), x = fxBar(n);
          if (n < 1) continue;
          if (x > xMax) break;
          if (x >= 0) ticks.push({ x, w: 1, t: alerteTime(t + barShift) });
        }
      }
    }
    if (ticks.length) { // étiquettes de l'axe : par priorité (mois > jour > début de séance > heure), sans jamais se chevaucher
      const placed = [];
      for (const tk of ticks.sort((a, b) => b.w - a.w || b.x - a.x)) {
        if (placed.some((p) => Math.abs(p.x - tk.x) < (p.w >= 3 && tk.w >= 3 ? 24 : 40))) continue;
        placed.push(tk);
        hb += tk.w >= 3 ? `<text x="${tk.x.toFixed(1)}" y="${H - 3}" text-anchor="middle" class="pc-ax" style="font-size:10px;font-weight:700;fill:#d1d4dc">${tk.t}</text>`
          : `<text x="${tk.x.toFixed(1)}" y="${H - 3}" text-anchor="middle" class="pc-ax" style="font-size:9px">${tk.t}</text>`;
      }
    }
    const dayPx = hs0 * 1440 / (tfMin || 1440), names = dayPx >= 70 ? CANDLE_DAYS : dayPx >= 34 ? CANDLE_DAYS_S : null; // noms des jours : discrets, au-dessus des pastilles, abrégés puis masqués quand on dézoome
    if (names && !is1D) for (const w of wdays) hb += `<text x="${w.x.toFixed(1)}" y="${H - BOT - 2 * R - 26}" text-anchor="middle" style="fill:#4a4a4a;font-size:11px;letter-spacing:1px;pointer-events:none">${names[w.d]}</text>`;
    const f50 = RP ? null : (candleF50 || {})[id], f = f50 && f50.d === new Date(Date.now() + 7200 * 1000).toISOString().slice(0, 10) ? f50 : null; // lignes 14H : seulement la journée de trading en cours (UTC+2) ; elles disparaissent à minuit UTC+2 (12:00 UTC-10) et reviennent quand la bougie 14H de la nouvelle journée est terminée, comme Arii SNIPER
    if (f) { // niveaux de la boîte 14H : Entry = bords, 50 % = bord ± R/2, TP = bord ± R (seulement s'ils sont dans l'échelle)
      const R = f.hi - f.lo;
      hb += [[f.hi + R, 'TP 14H', '#5cc8ff'], [f.hi + R / 2, 'H50% 14H', '#ff9f43', !!f.up], [f.hi, 'Entry 14H', '#5cc8ff'], [f.lo, 'Entry 14H', '#5cc8ff'], [f.lo - R / 2, 'L50% 14H', '#ff9f43', !!f.dn], [f.lo - R, 'TP 14H', '#5cc8ff']]
        .filter(([v, , , touched]) => v >= lo && v <= hi && touched !== false)
        .map(([v, t, c]) => { axT.push({ y: y(v), t, c }); return `<line x1="0" x2="${W - AX}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${c}" stroke-opacity=".7" stroke-width="0.7" stroke-dasharray="1 4" stroke-linecap="round"/>`; }).join('');
    }
  }
  const yl = Math.min(H - BOT, Math.max(TOP - 20, y(lastC))); // l'étiquette du dernier prix reste visible sur le bord
  // PDH / PDL : plus haut / plus bas de D1, comme Arii SNIPER (jaune #F5B700 opacité 0,85, pointillé 1 px, étiquette à droite), depuis le début de D0
  let pd = '';
  const pdD1 = cs.find((x) => x.lbl === 'D1' && x.c), pdD0i = cs.findIndex((x) => x.lbl === 'D0' && x.c);
  if (pdD1 && !RP) {
    const xs = LEFT + xOff + step * (pdD0i >= 0 ? pdD0i : cs.findIndex((x) => x.lbl === 'D1') + 1);
    for (const [v, t] of [[pdD1.c[1], 'PDH'], [pdD1.c[2], 'PDL']]) {
      if (v < lo || v > hi) continue;
      axT.push({ y: y(v), t, c: '#F5B700' });
      pd += `<line x1="${xs.toFixed(1)}" x2="${W - AX}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#F5B700" stroke-opacity="0.85" stroke-width="0.7" stroke-dasharray="1 3"/>`;
    }
  }
  { // étiquettes de lignes : jamais l'une sur l'autre ni sur l'étiquette du dernier prix (obstacle fixe), restent dans la zone du graphique
    const it = axT.concat([{ y: yl, p: true }]).sort((a, b) => a.y - b.y), gap = (a, b) => (a.p || b.p ? 19 : 17), top = TOP + 8, bot = H - BOT - 8;
    for (let k = 0; k < 6; k++) {
      for (let n = 1; n < it.length; n++) if (!it[n].p && it[n].y < it[n - 1].y + gap(it[n - 1], it[n])) it[n].y = it[n - 1].y + gap(it[n - 1], it[n]);
      for (let n = it.length - 2; n >= 0; n--) if (!it[n].p && it[n].y > it[n + 1].y - gap(it[n], it[n + 1])) it[n].y = it[n + 1].y - gap(it[n], it[n + 1]);
      for (const a of it) if (!a.p) a.y = Math.max(top, Math.min(bot, a.y));
    }
  }
  const axl = axT.map((a) => `<rect x="${W - AX + 1}" y="${(a.y - 8).toFixed(1)}" width="${AX - 2}" height="16" rx="3" fill="${a.c}" fill-opacity=".92"/><text x="${(W - AX / 2).toFixed(1)}" y="${(a.y + 3.5).toFixed(1)}" text-anchor="middle" style="fill:#0b0b0b;font-size:10px;font-weight:700;pointer-events:none">${a.t}</text>`).join('');
  const tag = `<line x1="0" x2="${W - AX}" y1="${yl.toFixed(1)}" y2="${yl.toFixed(1)}" stroke="${lastCol}" stroke-width="0.7" stroke-dasharray="2 3"/>` +
    `<rect x="${W - AX + 1}" y="${(yl - 10).toFixed(1)}" width="${AX - 2}" height="20" fill="${lastCol}"/>` +
    `<text x="${W - AX + 6}" y="${(yl + 4).toFixed(1)}" class="pc-ax" style="fill:#fff">${fmt(lastC)}</text>`;
  return `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><defs><clipPath id="pcClip"><rect x="0" y="0" width="${W - AX}" height="${H}"/></clipPath></defs>${RP ? '' : grid}<g clip-path="url(#pcClip)">${sepSvg}${hb}${fib}${pd}${body}${evb}${RP ? candleRpOverlay(y, W - AX, fmt, lo, hi, lastC) : candleAlSvg(id, y, W - AX, lo, hi, fmt)}</g>${RP ? '' : axl}${RP ? '' : tag}${!RP && candleXh && candleXh.id === id ? candleXhSvg(candleXh, W, H, AX, TOP, BOT, lo, rng, fmt, xhT) : ''}</svg>`;
}

// Sweep de la bougie daily précédente (même règle qu'Arii SNIPER) : D0 dépasse le haut de D1 et clôture dessous, ou casse son bas et clôture dessus
function candleSweep(dly, day) {
  const a = (dly || []).slice(-4);
  if (a.length < 2) return '';
  const d1 = a[a.length - 2]; // [t, o, h, l, c]
  // Sur la journée entière, bougies POH dans l'ordre (plusieurs sweeps possibles dans la journée) : un Sweep High naît quand une bougie dépasse le haut de D1 et clôture dessous ;
  // il reste valide tant que le prix reste revenu sous ce haut — une clôture au-dessus du haut l'annule (le prix a accepté la cassure), un nouveau sweep peut ensuite le recréer. Sweep Low : inverse avec le bas de D1.
  let hi = false, lo = false;
  for (const [k] of CANDLE_SLOTS) {
    const c = day && day.c && day.c[k]; if (!c) continue; // [o, h, l, c]
    if (c[1] > d1[2] && c[3] < d1[2]) hi = true; else if (c[3] > d1[2]) hi = false;
    if (c[2] < d1[3] && c[3] > d1[3]) lo = true; else if (c[3] < d1[3]) lo = false;
  }
  // bas = bleu, haut = rouge (les deux si D0 a pris les deux côtés)
  return (lo ? '<span class="cd-sweep cd-sweep-lo">Sweep</span>' : '') + (hi ? '<span class="cd-sweep cd-sweep-hi">Sweep</span>' : '');
}
// Boutons Fibo / Sweep : affichent immédiatement les paires concernées (les deux actifs = les deux conditions)
const candleF = { fibo: false, sweep: false, both: false, alert: false }; // both = Fibo ET Sweep (3e bouton « F+S ») ; alert = paires avec ligne bleue ou plan du tableau ALERTE (4e bouton)
function candleHasAlert(id) { // ligne d'alerte de prix (bleue) OU plan (PTP/OCO) dans le tableau ALERTE
  if (candleAl.some((a) => a.pair === id)) return true;
  const f = alerteData && alerteData[id], q = f && f.pt;
  return !!(q && (q.up || q.dn));
}
function candleInfo(id) {
  const dly = (candleDaily || {})[id], a = (dly || []).slice(-4);
  const days = ((candlePoh || {})[id] || []).filter((d) => Object.keys(d.c).length), day = days[days.length - 1];
  // Fibo = les lignes sont réellement affichées à l'écran (D2 et D1 même sens ET au moins un niveau dans la zone des POH)
  const fl = candleFibLevels(dly), sc = day ? candleScale(dly, day) : null;
  const fibo = !!(fl && sc && fl.some((f) => f.v >= sc.lo && f.v <= sc.hi));
  const sweep = !!(day && candleSweep(dly, day));
  return { fibo, sweep, both: fibo && sweep, alert: candleHasAlert(id) };
}
function candleFilterUpdate() {
  const ids = CORR_ALL_PAIRS.filter((p) => candlePoh && candlePoh[p.id]).map((p) => p.id);
  const n = { fibo: 0, sweep: 0, both: 0, alert: 0 };
  for (const id of ids) { const i = candleInfo(id); if (i.fibo) n.fibo++; if (i.sweep) n.sweep++; if (i.both) n.both++; if (i.alert) n.alert++; }
  document.querySelectorAll('#candleStrip [data-f]').forEach((b) => {
    b.classList.toggle('on', candleF[b.dataset.f]);
    b.textContent = `${{ fibo: 'Fibo', sweep: 'Sweep', both: 'F+S', alert: 'Alerts' }[b.dataset.f]} (${n[b.dataset.f]})`;
  });
}
// ===== Zoom / déplacement façon TradingView (pincer à deux doigts, glisser), enregistré par paire =====
const CANDLE_DEF = { yz: 1, yp: 0, xz: 1, xp: 0 }; // zoom prix, décalage prix (fraction de l'échelle de base), zoom bougies, décalage horizontal (fraction de la largeur)
try { localStorage.removeItem('candleAlertsV1'); } catch (e) { /* nettoyage des anciennes alertes (fonction retirée) */ }
const CANDLE_VIEW_LS = 'candleViewV2'; // UNE seule vue (zoom / centrage) partagée par tous les symboles, enregistrée dans le téléphone
let candleViews = {};
try { candleViews = JSON.parse(localStorage.getItem(CANDLE_VIEW_LS) || '{}') || {}; } catch (e) { candleViews = {}; }
const candleDays = {};
function candleViewOf() { return Object.assign({}, CANDLE_DEF, candleViews.all || {}); } // même vue pour toutes les paires
function candleViewIsDef(v) { return Math.abs(v.yz - 1) < 1e-3 && Math.abs(v.yp) < 1e-3 && Math.abs(v.xz - 1) < 1e-3 && Math.abs(v.xp) < 1e-3; }
function candleViewSave(id, v) {
  if (candleViewIsDef(v)) delete candleViews.all; else candleViews.all = v;
  try { localStorage.setItem(CANDLE_VIEW_LS, JSON.stringify(candleViews)); } catch (e) { /* quota */ }
  const cur = typeof candleCurId === 'function' ? candleCurId() : null;
  for (const k of Object.keys(candleDays)) if (k !== cur && !(typeof rp !== 'undefined' && rp.on && rp.id === k)) { try { candleRedraw(k, candleViewOf()); } catch (e) { /* paire pas encore dessinée */ } } // les autres symboles prennent aussitôt la même vue
  candleResetUpdate();
}
// Bouton « recentrer » (barre du bas, à droite) : visible seulement quand la vue de la paire affichée n'est plus la vue d'origine
function candleResetUpdate() {
  const b = document.getElementById('candleViewReset'), id = typeof candleCurId === 'function' ? candleCurId() : null;
  if (b) b.hidden = !id || candleViewIsDef(candleViewOf(id));
}
function candleRedraw(id, v) {
  const ch = document.querySelector(`.cd-chart[data-pair="${id}"]`);
  if (ch && candleDays[id]) ch.innerHTML = candleSvg(candleDays[id], (candleDaily || {})[id], v, id);
}
const cg = { pts: new Map(), id: null, mode: null, v0: null, start: null, cur: null, dx: 0, swallow: 0, moved: false, rect: null };
function candleGeo(id) {
  const { W, H } = candleDims(), { AX, TOP, BOT } = CANDLE_G;
  const rpx = candleRpPoh(id), sc = candleScale(rpx ? rpx.dly : (candleDaily || {})[id], rpx ? rpx.day : candleDays[id], candleHistBars(id)) || { hi: 1, lo: 0 };
  return { plotW: W - AX, plotH: H - TOP - BOT, baseRng: sc.hi - sc.lo, cenB: (sc.hi + sc.lo) / 2 };
}
function candleBeginGesture(rect) {
  cg.v0 = candleViewOf(cg.id);
  cg.cur = Object.assign({}, cg.v0);
  cg.start = [...cg.pts.values()].map((p) => ({ x: p.x, y: p.y }));
  cg.rect = rect;
}
const candleClamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CANDLE_XZ = [0.002, 400], CANDLE_YZ = [0.02, 500]; // bornes de zoom (bougies / prix) : pratiquement illimité, de tout l'historique à une seule bougie
function candleOnMove() {
  const g = candleGeo(cg.id), r = cg.rect, T = CANDLE_G.TOP, pts = [...cg.pts.values()];
  const priceAt = (v, yPx) => {
    const rngV = g.baseRng / v.yz, lo = g.cenB + v.yp * g.baseRng - rngV / 2;
    return lo + (1 - (yPx - T) / g.plotH) * rngV;
  };
  const pinching = pts.length >= 2 && cg.start.length >= 2 && Math.hypot(cg.start[0].x - cg.start[1].x, cg.start[0].y - cg.start[1].y) >= 60; // 2 doigts réellement écartés (un contact parasite tout près du doigt n'est pas un pincement)
  if (pinching) { // pincement : horizontal = bougies, vertical = prix, le centre suit les doigts
    cg.mode = 'pinch';
    const [a, b] = pts, [a0, b0] = cg.start;
    const cx0 = (a0.x + b0.x) / 2 - r.left, cy0 = (a0.y + b0.y) / 2 - r.top, cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    const sx = Math.max(Math.abs(a.x - b.x), 40) / Math.max(Math.abs(a0.x - b0.x), 40);
    const sy = Math.max(Math.abs(a.y - b.y), 40) / Math.max(Math.abs(a0.y - b0.y), 40);
    const v = cg.cur, v0 = cg.v0;
    v.xz = candleClamp(v0.xz * sx, CANDLE_XZ[0], CANDLE_XZ[1]);
    v.xp = (cx - (cx0 - v0.xp * g.plotW) * (v.xz / v0.xz)) / g.plotW;
    v.yz = candleClamp(v0.yz * sy, CANDLE_YZ[0], CANDLE_YZ[1]);
    const rng2 = g.baseRng / v.yz, lo2 = priceAt(v0, cy0) - (1 - (cy - T) / g.plotH) * rng2;
    v.yp = (lo2 + rng2 / 2 - g.cenB) / g.baseRng;
    cg.moved = true;
  } else if (pts.length >= 1 && cg.start.length >= 1 && !(pts.length >= 2 && pinching) && cg.mode !== 'done') {
    const dx = pts[0].x - cg.start[0].x, dy = pts[0].y - cg.start[0].y;
    if (!cg.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      cg.mode = !(rp.on && rp.id === cg.id) && candleViewIsDef(cg.v0) && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'swipe' : 'pan'; // vue standard : glisser à l'horizontale = changer de paire
      cg.moved = true;
    }
    cg.dx = dx;
    if (cg.mode === 'pan') {
      const v = cg.cur, v0 = cg.v0, rngV = g.baseRng / v0.yz;
      v.xp = v0.xp + dx / g.plotW;
      v.yp = v0.yp + dy * (rngV / g.plotH) / g.baseRng;
    }
  }
  if (cg.mode === 'pan' || cg.mode === 'pinch') candleRedraw(cg.id, cg.cur);
}
(function candleGestures() {
  const list = document.getElementById('candleList');
  list.addEventListener('pointerdown', (e) => {
    const ch = e.target.closest('.cd-chart');
    if (!ch || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (cg.id !== ch.dataset.pair || (e.pointerType !== 'mouse' && cg.pts.size && Date.now() - (cg.lastEv || 0) > 1500)) { cg.pts.clear(); cg.mode = null; } // changement de paire ou doigt fantôme : on repart propre
    cg.id = ch.dataset.pair; cg.lastEv = Date.now();
    cg.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { ch.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    if (cg.pts.size === 1) { cg.mode = null; cg.moved = false; cg.dx = 0; }
    candleBeginGesture(ch.getBoundingClientRect()); // repart de la vue actuelle à chaque doigt ajouté
  });
  list.addEventListener('pointermove', (e) => {
    if (!cg.pts.has(e.pointerId) || !cg.id) return;
    cg.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); cg.lastEv = Date.now();
    candleOnMove();
  });
  const end = (e) => {
    if (!cg.pts.has(e.pointerId)) return;
    const wasMode = cg.mode, wasSingle = cg.pts.size === 1;
    cg.pts.delete(e.pointerId);
    if (cg.pts.size > 0) { cg.mode = 'done'; return; } // un doigt levé pendant un pincement : on attend la fin du geste
    if ((wasMode === 'pan' || wasMode === 'pinch' || wasMode === 'done') && cg.cur) candleViewSave(cg.id, cg.cur);
    if (wasMode === 'swipe' && wasSingle && e.type === 'pointerup' && Math.abs(cg.dx) > 50) candleGo(candleIndex() + (cg.dx < 0 ? 1 : -1));
    if (cg.moved) cg.swallow = Date.now() + 350; // un geste n'ouvre pas le graphique TradingView
    cg.mode = null;
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  // Filets anti-blocage : si le relâchement n'arrive pas sur la liste (doigt levé hors graphique, graphique redessiné, appel entrant, geste système…),
  // le doigt « fantôme » restait en mémoire et bloquait ensuite tout déplacement / zoom / changement de paire.
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  window.addEventListener('lostpointercapture', (e) => { if (e.pointerType !== 'mouse') setTimeout(() => { if (cg.pts.has(e.pointerId)) end(e); }, 80); }, true);
  const unstick = () => { // plus aucun doigt à l'écran : on remet le geste à zéro
    if (!cg.pts.size && !cg.mode) return;
    if ((cg.mode === 'pan' || cg.mode === 'pinch' || cg.mode === 'done') && cg.cur && cg.id) candleViewSave(cg.id, cg.cur);
    cg.pts.clear(); cg.mode = null;
  };
  const noTouch = (e) => { if (!e.touches || e.touches.length === 0) setTimeout(unstick, 120); };
  window.addEventListener('touchend', noTouch, true);
  window.addEventListener('touchcancel', noTouch, true);
  window.addEventListener('blur', unstick);
  document.addEventListener('visibilitychange', () => { if (document.hidden) unstick(); });
  list.addEventListener('wheel', (e) => { // souris : molette = zoom des bougies autour du curseur (comme TradingView) ; Maj + molette = zoom du prix
    const ch = e.target.closest('.cd-chart');
    if (!ch) return;
    e.preventDefault();
    const id = ch.dataset.pair, g = candleGeo(id), v = candleViewOf(id), T = CANDLE_G.TOP, rc = ch.getBoundingClientRect(), yPx = e.clientY - rc.top, xPx = e.clientX - rc.left;
    const dl = e.deltaY || e.deltaX, f = dl < 0 ? 1.15 : 1 / 1.15; // (Maj + molette : certains navigateurs renvoient deltaX)
    if (e.shiftKey) {
      const rngV = g.baseRng / v.yz, lo = g.cenB + v.yp * g.baseRng - rngV / 2, p0 = lo + (1 - (yPx - T) / g.plotH) * rngV;
      v.yz = candleClamp(v.yz * f, CANDLE_YZ[0], CANDLE_YZ[1]);
      const rng2 = g.baseRng / v.yz, lo2 = p0 - (1 - (yPx - T) / g.plotH) * rng2;
      v.yp = (lo2 + rng2 / 2 - g.cenB) / g.baseRng;
    } else {
      const z0 = v.xz;
      v.xz = candleClamp(z0 * f, CANDLE_XZ[0], CANDLE_XZ[1]);
      v.xp = (xPx - (xPx - v.xp * g.plotW) * (v.xz / z0)) / g.plotW;
    }
    candleRedraw(id, v); candleViewSave(id, v);
  }, { passive: false });
})();

const CANDLE_LAST_LS = 'candleLastPair'; // dernier symbole affiché : retrouvé à la réouverture (même après fermeture de l'appli)
function candleLastId() { try { return localStorage.getItem(CANDLE_LAST_LS) || null; } catch (e) { return null; } }
function candleMiniSvg(day, W) { // 4 bougies d'origine : 14h, 15-17h, 22h, 02h (UTC-10), même couleurs et même style que les POH
  const H = 150, TOP = 22, BOT = 8, cs = [['14', '14h'], ['15', '15-17h'], ['22', '22h'], ['02', '02h']].map(([k, l]) => ({ l, c: day.c[k] }));
  const vals = cs.filter((x) => x.c);
  if (!vals.length) return '';
  let hi = Math.max(...vals.map((x) => x.c[1])), lo = Math.min(...vals.map((x) => x.c[2]));
  const m = (hi - lo || hi * 0.001) * 0.08;
  hi += m; lo -= m;
  const y = (v) => TOP + (1 - (v - lo) / (hi - lo)) * (H - TOP - BOT), step = (W - 8) / 4, bw = Math.min(step * 0.5, 46);
  return `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">` + cs.map((x, i) => {
    if (!x.c) return '';
    const [o, h, l, c] = x.c, col = c >= o ? CANDLE_UP : CANDLE_DN, cx = 4 + step * (i + 0.5), top = y(Math.max(o, c)), ht = Math.max(1, Math.abs(y(o) - y(c)));
    return `<text x="${cx.toFixed(1)}" y="${Math.max(14, y(h) - 6).toFixed(1)}" text-anchor="middle" class="pc-lbl" style="fill:${col}">${x.l}</text>` +
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(h).toFixed(1)}" y2="${y(l).toFixed(1)}" stroke="${col}" stroke-width="0.9"/>` +
      `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${ht.toFixed(1)}" fill="${c >= o ? '#0b0b0b' : col}" stroke="${col}" stroke-width="0.9"/>`;
  }).join('') + '</svg>';
}
function candleRender() {
  const list = document.getElementById('candleList');
  if (!candlePoh) { list.innerHTML = '<div class="charts-intro">POH candles unavailable right now.</div>'; return; }
  const rows = CORR_ALL_PAIRS.filter((p) => candlePoh[p.id] && (!candleF.fibo || candleInfo(p.id).fibo) && (!candleF.sweep || candleInfo(p.id).sweep) && (!candleF.both || candleInfo(p.id).both) && (!candleF.alert || candleInfo(p.id).alert))
    .map((p) => ({ p, s: chartsCandles ? chartsScore(p.id) : { group: 2, move: 0 } }))
    .sort((x, y) => x.s.group - y.s.group || y.s.move - x.s.move);
  let date = '';
  const wasMini = !!list.querySelector(':scope > .cd-mini'); // la liste affichée est encore celle des 4 bougies : sa position ne dit rien sur la paire
  const keep = candleMini || wasMini ? 0 : candleIndex(), keepId = candleMini ? null : (!wasMini && list.clientWidth ? candleCurId() : null) || candleLastId(), keepTop = candleMini ? list.scrollTop : 0, Wm = Math.max(300, Math.round(window.innerWidth));
  list.innerHTML = rows.map(({ p, s }) => {
    const days = candlePoh[p.id].filter((d) => Object.keys(d.c).length);
    const day = days[days.length - 1];
    if (!day) return '';
    date = day.d;
    candleDays[p.id] = day;
    const cls = s.group === 0 ? 'cd-bull' : s.group === 1 ? 'cd-bear' : '';
    if (candleMini) return `<div class="cd-row cd-mini ${cls}" data-id="${p.id}"><div class="cd-mhead"><span class="cd-name">${p.label}</span> <span class="pc-date">${day.d}</span>${candleSweep((candleDaily || {})[p.id], day)}</div><div class="cd-mchart">${candleMiniSvg(day, Wm)}</div></div>`;
    return `<div class="cd-row ${cls}" data-id="${p.id}"><button type="button" class="cd-head"><span class="cd-name">${p.label}</span> <span class="pc-date">${day.d}</span>${candleSweep((candleDaily || {})[p.id], day)}</button><button type="button" class="cd-chart" data-pair="${p.id}" aria-label="${p.label} 1h chart">${candleSvg(day, (candleDaily || {})[p.id], candleViewOf(p.id), p.id)}</button></div>`;
  }).join('');
  const ki = keepId ? [...candleSlides()].findIndex((r) => r.dataset.id === keepId) : -1;
  list.scrollLeft = (ki >= 0 ? ki : keep) * list.clientWidth;
  if (candleMini) list.scrollTop = keepTop;
  if (!rows.length) list.innerHTML = '<div class="charts-intro">No pair matches.</div>';
  candleFilterUpdate();
  candleNavUpdate();
}

// Carrousel : une paire par diapo (défilement par glissement), flèches + compteur
function candleSlides() { return document.querySelectorAll('#candleList > .cd-row'); }
function candleIndex() {
  const l = document.getElementById('candleList');
  return l.clientWidth ? Math.round(l.scrollLeft / l.clientWidth) : 0;
}
function candleGo(i) {
  const l = document.getElementById('candleList');
  const n = candleSlides().length;
  if (!n) return;
  l.scrollTo({ left: Math.max(0, Math.min(n - 1, i)) * l.clientWidth, behavior: 'smooth' });
}
function candleCurId() { return candleSlides()[candleIndex()]?.dataset.id || null; }
// Filtre « Alerts » actif : la paire affichée s'ouvre sur le 1 min, centrée sur le repère bleu vertical de son plan (dernier 50 % du tableau ALERTE) ; sans plan, sur le prix de sa ligne bleue
let candleAlFocusKey = '', candleAlFocusTimer = 0;
function candleAlertFocusSoon() {
  clearTimeout(candleAlFocusTimer);
  candleAlFocusTimer = setTimeout(() => {
    if (!candleF.alert || candleMini || rp.on) return;
    if (alerteFocusBusy) { candleAlertFocusSoon(); return; }
    const id = candleCurId(); if (!id) return;
    const q = alerteData && alerteData[id] && alerteData[id].pt, t = q ? Math.max(q.up || 0, q.dn || 0) : 0, ln = candleAl.find((a) => a.pair === id), px = ln ? +ln.price : 0, key = id + '|' + t + '|' + px;
    if (key === candleAlFocusKey || (!t && !(px > 0))) return;
    candleAlFocusKey = key;
    alerteFocus(id, t || 0, true, px);
  }, 350);
}
function candleNavUpdate() {
  if (candleMini) { const c0 = document.getElementById('candleCount'); if (c0) c0.textContent = ''; return; } // liste défilante : ni compteur ni historique
  const lid = candleCurId();
  if (lid && document.getElementById('candleList').clientWidth) { try { localStorage.setItem(CANDLE_LAST_LS, lid); } catch (e) { /* pas de stockage */ } } // mémorise le symbole à l'écran
  candleHistEnsure(candleCurId());
  candleResetUpdate();
  const n = candleSlides().length, i = Math.min(candleIndex(), Math.max(0, n - 1));
  const c = document.getElementById('candleCount');
  if (c) c.textContent = n ? `${i + 1} / ${n}` : '';
  candleRpSync();
  if (candleF.alert) candleAlertFocusSoon();
}
// Petit bouton ▾ de Fibo / Sweep : liste des noms des paires concernées ; un clic sur un nom la ferme et amène le carrousel à cette paire
let candleNamesOpen = null; // 'fibo' | 'sweep' | 'both' | null
function candleNamesRender() {
  const box = document.getElementById('candleNames');
  if (!box) return;
  document.querySelectorAll('#candleStrip [data-d]').forEach((b) => b.setAttribute('aria-expanded', String(candleNamesOpen === b.dataset.d)));
  if (!candleNamesOpen) { box.hidden = true; return; }
  const ids = CORR_ALL_PAIRS.filter((p) => candlePoh && candlePoh[p.id])
    .map((p) => ({ p, s: chartsCandles ? chartsScore(p.id) : { group: 2, move: 0 } }))
    .sort((x, y) => x.s.group - y.s.group || y.s.move - x.s.move)
    .map((x) => x.p).filter((p) => candleInfo(p.id)[candleNamesOpen]);
  box.innerHTML = ids.length ? ids.map((p) => {
    let cls = '';
    if (candleNamesOpen === 'sweep' || candleNamesOpen === 'both') { const h = candleSweep((candleDaily || {})[p.id], ((candlePoh[p.id] || []).filter((d) => Object.keys(d.c).length).slice(-1)[0])); cls = (h.includes('cd-sweep-lo') ? ' lo' : '') + (h.includes('cd-sweep-hi') ? ' hi' : ''); }
    return `<button type="button" class="cc-name${cls}" data-go="${p.id}">${p.label}</button>`;
  }).join('') : '<span class="cc-none">No pair</span>';
  box.hidden = false;
}
function candleGoTo(id) {
  if (candleMini) { const r = [...candleSlides()].find((x) => x.dataset.id === id); if (r) r.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  let i = [...candleSlides()].findIndex((r) => r.dataset.id === id);
  if (i < 0) { candleF.fibo = false; candleF.sweep = false; candleF.both = false; candleF.alert = false; candleSelected = null; candleRender(); i = [...candleSlides()].findIndex((r) => r.dataset.id === id); } // la paire est masquée par un filtre : on l'enlève
  const l = document.getElementById('candleList');
  if (i >= 0) l.scrollTo({ left: i * l.clientWidth, behavior: 'smooth' });
}
document.getElementById('candleStrip')?.addEventListener('click', (e) => {
  const d = e.target.closest('[data-d]');
  if (!d) return;
  e.stopPropagation();
  document.getElementById('candleSetMenu').hidden = true; document.getElementById('candleSet')?.setAttribute('aria-expanded', 'false');
  candleNamesOpen = candleNamesOpen === d.dataset.d ? null : d.dataset.d;
  candleNamesRender();
});
document.getElementById('candleNames')?.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (!g) return;
  candleNamesOpen = null;
  candleNamesRender();
  candleGoTo(g.dataset.go);
});
document.addEventListener('click', (e) => { // un clic ailleurs referme la liste
  if (candleNamesOpen && !e.target.closest('#candleNames') && !e.target.closest('#candleStrip [data-d]')) { candleNamesOpen = null; candleNamesRender(); }
});
document.getElementById('candleStrip')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  document.getElementById('candleSetMenu').hidden = true; document.getElementById('candleSet')?.setAttribute('aria-expanded', 'false'); // le menu se referme après le choix
  candleAlFocusKey = '';
  const was = candleF[b.dataset.f];
  candleF[b.dataset.f] = !was;
  if (b.dataset.f === 'alert') { candleF.fibo = candleF.sweep = candleF.both = false; } else { candleF.alert = false; if (b.dataset.f === 'both') { candleF.fibo = false; candleF.sweep = false; } else candleF.both = false; } // « Alerts » est seul ; Fibo / Sweep / F+S l'annulent (et inversement) // « F+S » remplace Fibo+Sweep ; Fibo ou Sweep seul annule « F+S »
  candleSelected = null;
  if (candlePoh) candleRender();
  document.getElementById('candleList').scrollLeft = 0;
  candleNavUpdate();
  if (b.dataset.f === 'alert' && candleF.alert && !alerteData) { // plans du tableau ALERTE pas encore chargés : on les charge puis on réaffiche
    Promise.all([alerteLoad(), candleAlFetch()]).then(() => { if (candleF.alert && candlePoh) { candleRender(); document.getElementById('candleList').scrollLeft = 0; candleNavUpdate(); } });
  }
});
document.getElementById('candleClose')?.addEventListener('click', () => document.getElementById('candleToggle').click());
function candleCleanApply() { // mode épuré : échelle de prix + rangée Fibo / Sweep / F+S masquées
  const b = document.getElementById('candleBody');
  if (b) b.classList.toggle('cc-clean', candleClean);
  CANDLE_G.AX = rp.on || candleClean ? 0 : 60;
}
candleCleanApply();
document.getElementById('candleList').addEventListener('click', (e) => { // clic sur le nom du symbole : bascule le mode épuré (enregistré)
  const n = e.target.closest('.cd-name');
  if (!n || candleMini || document.getElementById('candleBody').classList.contains('collapsed')) return;
  e.stopPropagation(); e.preventDefault();
  candleClean = !candleClean;
  try { localStorage.setItem('candleClean', candleClean ? '1' : '0'); } catch (err) { /* pas de stockage */ }
  candleCleanApply();
  if (candlePoh) candleRender();
}, true);
// Roue (remplace le bouton viseur) : menu déroulant « Aim » (recentrer) + « 4 candles » (liste défilante des 4 bougies de tous les symboles)
// Aim : recentre EXCLUSIVEMENT sur les bougies POH (12h … 07h) : D3-D0 et l'historique sortent à gauche, prix cadré sur les POH seuls
function candleAim(id) {
  const day = candleDays[id], dly = (candleDaily || {})[id];
  const vals = day ? CANDLE_SLOTS.map(([k]) => day.c[k]).filter(Boolean) : [];
  if (!vals.length || (rp.on && rp.id === id)) { candleRedraw(id, CANDLE_DEF); candleViewSave(id, Object.assign({}, CANDLE_DEF)); return; }
  const { W } = candleDims(), { AX, LEFT } = CANDLE_G, plotW0 = W - AX - LEFT, split = candleHistBars(id) ? 0.5 : 0;
  const nd = (dly || []).slice(-4).length, n = nd + 1 + CANDLE_SLOTS.length, f = nd + 1, m = CANDLE_SLOTS.length; // f = indice de la 1re bougie POH
  const stepB = plotW0 * (1 - split) / n, xz = candleClamp(0.94 * plotW0 / (m * stepB), CANDLE_XZ[0], CANDLE_XZ[1]), step = stepB * xz;
  const xOff = plotW0 * 0.03 - step * f, xp = (xOff - split * plotW0 * xz) / (W - AX);
  let hi = -Infinity, lo = Infinity;
  for (const c of vals) { hi = Math.max(hi, c[1]); lo = Math.min(lo, c[2]); }
  const g = candleGeo(id), span = Math.max(hi - lo, g.baseRng * 0.01) * 1.15;
  const v = { xz, xp, yz: candleClamp(g.baseRng / span, CANDLE_YZ[0], CANDLE_YZ[1]), yp: ((hi + lo) / 2 - g.cenB) / g.baseRng };
  candleViewSave(id, v);
  candleRedraw(id, v);
}
// ===== PANNEAU « ALERTS » (dans la roue ⚙) : comme TradingView — onglets Alerts / Log, « + », recherche, tri, modifier / supprimer, non-lus en surbrillance =====
// Alerts = alertes de prix en attente (serveur) ; Log = alertes de prix déclenchées (serveur, 200 dernières) + signaux ALERTE (journal). Toucher une ligne ouvre le graphique de la paire au niveau de l'alerte.
const AL_SEEN_LS = 'alertLogSeenV1', AL_CLR_LS = 'alertLogClearedV1', AL_SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['pair', 'Symbol A–Z']];
const alP = { tab: 'alerts', sort: 'new', q: '', log: [], loaded: false };
const alLsGet = (k) => { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } };
const alLsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* pas de stockage */ } };
const alPairLbl = (id) => `${id.slice(0, 3)}/${id.slice(3)}`;
const alDec = (v) => (v >= 1000 ? 2 : v >= 100 ? 3 : 5);
async function alLogFetch() {
  try { const r = await fetch(`${ALERTE_API}/alerte?alog=1`, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); if (r.ok) alP.log = (await r.json()).log || []; } catch (e) { /* on garde le dernier journal */ }
  if (!alerteJournal) { try { const r = await fetch(`${ALERTE_API}/alerte?journal=1`, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); if (r.ok) alerteJournal = (await r.json()).journal || {}; } catch (e) { /* signaux indisponibles */ } }
  alP.loaded = true;
  alBadgeUpdate();
}
function alLogItems() {
  const cleared = alLsGet(AL_CLR_LS), items = [];
  for (const x of alP.log) items.push({ t: x.t, pair: x.pair, price: x.price, title: `${alPairLbl(x.pair)} ${x.dir === 'above' ? 'Crossing up' : 'Crossing down'} ${(+x.price).toFixed(alDec(x.price))}`, sub: 'Price alert' });
  for (const x of Object.values(alerteJournal || {})) if (x.t) items.push({ t: x.t, pair: x.pair, title: `${alPairLbl(x.pair)} · 50% ${x.sens} · ${x.side}`, sub: x.res === 1 ? 'TP reached' : x.res === 2 ? 'Stop hit' : 'Open' });
  return items.filter((i) => i.t > cleared).sort((a, b) => b.t - a.t).slice(0, 150);
}
const alUnread = () => { const seen = alLsGet(AL_SEEN_LS); return alLogItems().filter((i) => i.t > seen).length; };
function alBadgeUpdate() {
  const el = document.getElementById('candleAlertsSub');
  if (el) { const u = alUnread(), n = candleAl.length; el.textContent = `${n} active${u ? ` · ${u} new in log` : ''}`; }
}
function alExpiryTxt(a) {
  if (!a.expires) return 'No expiry';
  const d = a.expires - Math.floor(Date.now() / 1000);
  return d <= 0 ? 'Expiring' : d < 3600 ? `Expires in ${Math.ceil(d / 60)} min` : d < 172800 ? `Expires in ${Math.round(d / 3600)} h` : `Expires in ${Math.round(d / 86400)} d`;
}
function alPanelRender() {
  const box = document.getElementById('alPanel');
  if (!box) return;
  const q = alP.q.trim().toLowerCase();
  const unread = alUnread(), act = alP.tab === 'alerts';
  let list = '';
  if (act) {
    let rows = candleAl.filter((a) => !q || (alPairLbl(a.pair) + ' ' + a.pair + ' ' + a.price).toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => alP.sort === 'old' ? a.created - b.created : alP.sort === 'pair' ? a.pair.localeCompare(b.pair) : b.created - a.created);
    list = rows.length ? rows.map((a) => `<div class="alp-it" data-go="${a.pair}" data-px="${a.price}"><div class="alp-m"><div class="alp-t">${alPairLbl(a.pair)} ${a.dir === 'above' ? 'Crossing up' : 'Crossing down'} ${(+a.price).toFixed(alDec(a.price))}</div><div class="alp-s"><b>${a.pair}</b> · <span class="alp-on">Active</span> · ${alExpiryTxt(a)}</div></div><button type="button" class="alp-b" data-ed="${a.id}" aria-label="Edit">✎</button><button type="button" class="alp-b" data-del="${a.id}" aria-label="Delete">🗑</button></div>`).join('')
      : `<div class="alp-empty">${candleAl.length ? 'No alert matches your search.' : 'No active alerts.<br>Long-press a chart, then tap ⊕ on the price axis, or use + above.'}</div>`;
  } else {
    const seen = alLsGet(AL_SEEN_LS), items = alLogItems().filter((i) => !q || i.title.toLowerCase().includes(q));
    let day = '';
    list = items.length ? items.map((i) => {
      const d = new Date((i.t - 36000) * 1000), ds = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).toUpperCase();
      const head = ds !== day ? `<div class="alp-day">${ds}</div>` : ''; day = ds;
      return head + `<div class="alp-it ${i.t > seen ? 'new' : ''}" data-go="${i.pair}" data-px="${i.price || ''}"><div class="alp-m"><div class="alp-t">${alEsc(i.title)}</div><div class="alp-s"><b>${i.pair}</b> · ${alEsc(i.sub)} · ${alerteTime(i.t)}:${String(d.getUTCSeconds()).padStart(2, '0')}</div></div></div>`;
    }).join('') : '<div class="alp-empty">The log is empty.</div>';
  }
  box.innerHTML = `<div class="alp-top"><div class="alp-tabs"><button type="button" data-tab="alerts" class="${act ? 'on' : ''}">Alerts ${candleAl.length ? `<i>${candleAl.length}</i>` : ''}</button><button type="button" data-tab="log" class="${act ? '' : 'on'}">Log ${unread ? `<i class="hot">${unread > 99 ? '99+' : unread}</i>` : ''}</button></div><button type="button" class="alp-x" data-close aria-label="Close">✕</button></div>` +
    `<div class="alp-bar">${act ? `<button type="button" class="alp-b" data-add aria-label="New alert">＋</button>` : `<button type="button" class="alp-b" data-clear aria-label="Clear log" title="Clear log">🧹</button><button type="button" class="alp-b" data-read aria-label="Mark all as read" title="Mark all as read">✓✓</button>`}<input class="alp-q" type="search" placeholder="Search" value="${alEsc(alP.q)}" aria-label="Search">${act ? `<button type="button" class="alp-b alp-sort" data-sort title="Sort">⇅ <small>${AL_SORTS.find((s) => s[0] === alP.sort)[1]}</small></button>` : ''}</div>` +
    `<div class="alp-list">${list}</div>`;
  const qi = box.querySelector('.alp-q');
  qi.addEventListener('input', () => { alP.q = qi.value; const pos = qi.selectionStart; alPanelRender(); const n = document.querySelector('#alPanel .alp-q'); n.focus(); n.setSelectionRange(pos, pos); });
}
async function alPanelOpen() {
  const body = document.getElementById('candleBody');
  if (!body || document.getElementById('alPanel')) return;
  const box = document.createElement('div');
  box.id = 'alPanel';
  body.appendChild(box);
  alP.tab = 'alerts'; alP.q = '';
  alPanelRender();
  box.addEventListener('click', (e) => {
    const t = e.target;
    const tab = t.closest('[data-tab]'), ed = t.closest('[data-ed]'), del = t.closest('[data-del]');
    if (t.closest('[data-close]')) { box.remove(); alBadgeUpdate(); return; }
    if (tab) { alP.tab = tab.dataset.tab; alP.q = ''; alPanelRender(); return; }
    if (t.closest('[data-add]')) {
      const id = candleCurId(); if (!id) return;
      candleLiveLast(id).then((last) => { box.remove(); candleAlCreate(id, last == null ? candleLastPx(id) : last); });
      return;
    }
    if (t.closest('[data-sort]')) { const i = AL_SORTS.findIndex((s) => s[0] === alP.sort); alP.sort = AL_SORTS[(i + 1) % AL_SORTS.length][0]; alPanelRender(); return; }
    if (t.closest('[data-clear]')) { alLsSet(AL_CLR_LS, Math.floor(Date.now() / 1000)); alPanelRender(); return; }
    if (t.closest('[data-read]')) { alLsSet(AL_SEEN_LS, Math.floor(Date.now() / 1000)); alPanelRender(); return; }
    if (ed) {
      const a = candleAl.find((x) => x.id === ed.dataset.ed); if (!a) return;
      candleAlSheet(`Edit alert · ${alPairLbl(a.pair)}`, 'Change the price level.', a.price, 'Save', async (px) => {
        if (!(px > 0)) throw new Error('Enter a valid price');
        const last = await candleLiveLast(a.pair);
        await candleAlPost({ lineMove: { id: a.id, price: px, dir: last === null || px >= last ? 'above' : 'below' } });
        alPanelRender();
      });
      return;
    }
    if (del) {
      const a = candleAl.find((x) => x.id === del.dataset.del); if (!a) return;
      candleAlSheet(`Delete alert · ${alPairLbl(a.pair)}`, `${a.dir === 'above' ? 'Rises to' : 'Falls to'} ${(+a.price).toFixed(alDec(a.price))}`, null, 'Delete alert', async () => { await candleAlPost({ lineDelete: a.id }); alPanelRender(); });
      return;
    }
    const it = t.closest('[data-go]');
    if (it) { // ouvre le graphique de la paire, prix de l'alerte visible
      const id = it.dataset.go, px = parseFloat(it.dataset.px);
      box.remove(); alBadgeUpdate();
      if (candleMini) { candleMini = false; try { localStorage.setItem('candleMini', '0'); } catch (err) { /* pas de stockage */ } candleMiniApply(); }
      candleGoTo(id);
      if (px > 0) setTimeout(() => candleShowPrice(id, px), 450);
    }
  });
  await Promise.all([candleAlFetch(), alLogFetch()]);
  if (document.getElementById('alPanel')) alPanelRender();
}
function candleShowPrice(id, price) { // rend visibles le dernier prix ET le niveau d'une alerte (zoom vertical seulement)
  if (!candleDays[id]) return;
  const g = candleGeo(id), v = candleViewOf(id), last = candleLastPx(id), hi = Math.max(price, last == null ? price : last), lo = Math.min(price, last == null ? price : last);
  const span = Math.max(hi - lo, g.baseRng * 0.02) * 1.4, nv = Object.assign({}, v, { yz: candleClamp(g.baseRng / span, CANDLE_YZ[0], CANDLE_YZ[1]), yp: ((hi + lo) / 2 - g.cenB) / g.baseRng });
  candleViewSave(id, nv);
  candleRedraw(id, nv);
}
function candleSetMenuUpdate() {
  const m = document.getElementById('candleSetMenu');
  if (!m) return;
  const mi = m.querySelector('[data-a="mini"]'), ai = m.querySelector('[data-a="aim"]');
  if (mi) mi.setAttribute('aria-checked', String(candleMini));
  if (ai) ai.disabled = candleMini;
}
let candleMiniBack = null; // { id, top } : paire ouverte depuis la liste « 4 candles » et position de défilement, pour y revenir exactement
function candleMiniApply() {
  const b = document.getElementById('candleBody');
  if (b) b.classList.toggle('cc-mini', candleMini);
  if (candleMini && rp.on) candleRpExit();
  candleSetMenuUpdate();
  if (candlePoh) candleRender();
  if (candleMini && candleMiniBack) { // retour dans « 4 candles » : même position, même paire
    const l = document.getElementById('candleList'), mb = candleMiniBack; candleMiniBack = null;
    l.scrollTop = mb.top;
    const r = [...l.querySelectorAll('.cd-mini')].find((x) => x.dataset.id === mb.id);
    if (r) { const lr = l.getBoundingClientRect(), rr = r.getBoundingClientRect(); if (rr.top < lr.top || rr.bottom > lr.bottom) r.scrollIntoView({ block: 'start' }); }
  }
}
if (candleMini) document.getElementById('candleBody')?.classList.add('cc-mini');
candleSetMenuUpdate();
document.getElementById('candleSet')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const m = document.getElementById('candleSetMenu'), open = m.hidden;
  if (open) { alBadgeUpdate(); if (!alP.loaded) alLogFetch(); }
  m.hidden = !open;
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
document.getElementById('candleSetMenu')?.addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]');
  if (!a || a.disabled) return;
  e.stopPropagation();
  if (a.dataset.a === 'aim') {
    const id = candleCurId();
    if (id) candleAim(id);
  } else if (a.dataset.a === 'alerts') {
    alPanelOpen();
  } else if (a.dataset.a === 'mini') {
    candleMini = !candleMini;
    try { localStorage.setItem('candleMini', candleMini ? '1' : '0'); } catch (err) { /* pas de stockage */ }
    candleMiniApply();
  }
  document.getElementById('candleSetMenu').hidden = true;
  document.getElementById('candleSet')?.setAttribute('aria-expanded', 'false');
});
document.getElementById('candleList').addEventListener('click', (e) => { // liste « 4 candles » : un clic sur un symbole ouvre aussitôt son graphique sur les POH
  if (!candleMini) return;
  const r = e.target.closest('.cd-mini');
  if (!r || !r.dataset.id) return;
  e.stopPropagation(); e.preventDefault();
  candleMiniBack = { id: r.dataset.id, top: document.getElementById('candleList').scrollTop }; // mémorisé pour le retour
  try { localStorage.setItem(CANDLE_LAST_LS, r.dataset.id); localStorage.setItem('candleMini', '0'); } catch (err) { /* pas de stockage */ }
  candleMini = false;
  candleMiniApply(); // carrousel sur cette paire (position instantanée)
  for (let k = 0; k < 8 && candleHistTf !== '0'; k++) document.getElementById('candleHistPrev').click(); // vue POH seuls
}, true);
document.addEventListener('click', (e) => { // un clic ailleurs referme le menu
  const m = document.getElementById('candleSetMenu');
  if (m && !m.hidden && !e.target.closest('#candleSetMenu')) { m.hidden = true; document.getElementById('candleSet')?.setAttribute('aria-expanded', 'false'); }
});
let candleRz = 0;
window.addEventListener('resize', () => { clearTimeout(candleRz); candleRz = setTimeout(() => { if (candlePoh && !document.getElementById('candleBody').classList.contains('collapsed')) candleRender(); }, 200); });
document.getElementById('candlePrev')?.addEventListener('click', () => candleGo(candleIndex() - 1));
document.getElementById('candleNext')?.addEventListener('click', () => candleGo(candleIndex() + 1));
document.getElementById('candleList')?.addEventListener('scroll', () => candleNavUpdate(), { passive: true });

const CANDLE_LS = 'candlePohCache2';
async function candleFetchProxy() {
  const res = await fetch('https://ariinuiirgina.vercel.app/api/poh-candles', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const j = res.ok ? await res.json() : null;
  if (!j || !j.pairs || !Object.keys(j.pairs).length) throw new Error('proxy');
  return j;
}
function candleMerge(j) { // par paire : on garde l'ancienne série si la nouvelle manque (jamais de bougie qui disparaît)
  candlePoh = Object.assign({}, candlePoh || {}, j.pairs);
  candleDaily = Object.assign({}, candleDaily || {}, j.daily || {});
  candleF50 = Object.assign({}, candleF50 || {}, j.f50 || {});
}
async function candleLoad() {
  if (!candlePoh) { // affichage instantané : dernière série connue (localStorage), puis rafraîchie en direct
    try {
      const c = JSON.parse(localStorage.getItem(CANDLE_LS) || 'null');
      if (c && c.pairs) { candleMerge(c); candleRender(); }
    } catch (e) { /* pas de cache */ }
  }
  let j = null;
  for (let t = 0; t < 2 && !j; t++) { try { j = await candleFetchProxy(); } catch (e) { /* 2e essai */ } }
  if (j) {
    candleMerge(j);
    try { localStorage.setItem(CANDLE_LS, JSON.stringify({ pairs: candlePoh, daily: candleDaily })); } catch (e) { /* quota */ }
  } else if (!candlePoh) {
    try {
      const res = await fetch('./data/poh-candles.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      candlePoh = (await res.json()).pairs;
    } catch (e2) { candlePoh = null; }
  }
  if (!candleEcoEv.length) { // news à fort impact : calendrier TradingView (historique depuis 2023 + futur) complété par celui du site (NZD, CHF, discours)
    let tv = [], ff = [];
    try { const r = await fetch('./data/tv-events.json', { cache: 'no-store' }); if (r.ok) tv = ((await r.json()).events || []).map((a) => ({ country: a[1], title: a[2], _t: a[0], actual: a[3], forecast: a[4], previous: a[5] })); } catch (e) { /* facultatif */ }
    try { const r = await fetch('./data/eco-calendar.json', { cache: 'no-store' }); if (r.ok) ff = ((await r.json()).events || []).filter((e) => (e.impact === 'High' || SPEECH_RE.test(e.title)) && e.date).map((e) => Object.assign({}, e, { _t: Date.parse(e.date) / 1000 })).filter((e) => e._t > 0); } catch (e) { /* facultatif */ }
    const isSpeech = (t) => /speak|speech|press conf|testif|hearing|minutes/i.test(t || '');
    const byCcy = {};
    for (const e of tv) (byCcy[e.country] = byCcy[e.country] || []).push(e._t);
    const extra = ff.filter((e) => isSpeech(e.title) || !(byCcy[e.country] || []).some((t) => Math.abs(t - e._t) <= 600)); // une news déjà dans TradingView (même devise, ±10 min) n'est pas doublée
    candleEcoEv = tv.concat(extra);
  }
  if (!chartsCandles) {
    try {
      const r = await fetch('./data/daily-candles.json', { cache: 'no-store' });
      if (r.ok) chartsCandles = (await r.json()).pairs;
    } catch (e) { /* tri facultatif */ }
  }
  if ((!candleDaily || !Object.keys(candleDaily).length) && chartsCandles) { // repli : Daily du cron (D0 peut être en retard)
    candleDaily = {};
    for (const id of Object.keys(chartsCandles)) candleDaily[id] = chartsCandles[id].slice(-4);
  }
  candleRender();
}

// Actualisation automatique (toutes les 20 s tant que CANDLE est ouvert) : met à jour bougies, sweep et compteurs EN PLACE,
// sans toucher au carrousel, au zoom, au graphique TradingView ouvert ni à un geste en cours
let candleAutoBusy = false;
function candleRefreshInPlace() {
  document.querySelectorAll('#candleList > .cd-row').forEach((r) => {
    const id = r.dataset.id;
    if (cg.pts.size && cg.id === id) return; // geste en cours sur ce graphique
    const days = ((candlePoh || {})[id] || []).filter((d) => Object.keys(d.c).length), day = days[days.length - 1];
    if (!day) return;
    candleDays[id] = day;
    const ch = r.querySelector('.cd-chart'), mc = r.querySelector('.cd-mchart');
    if (ch) ch.innerHTML = candleSvg(day, (candleDaily || {})[id], candleViewOf(id), id);
    if (mc) mc.innerHTML = candleMiniSvg(day, Math.max(300, Math.round(window.innerWidth)));
    const hd = r.querySelector('.cd-head, .cd-mhead');
    if (hd) { hd.querySelectorAll('.cd-sweep').forEach((x) => x.remove()); hd.insertAdjacentHTML('beforeend', candleSweep((candleDaily || {})[id], day)); }
  });
  candleFilterUpdate();
  if (candleNamesOpen) candleNamesRender();
}
async function candleAutoRefresh() {
  const body = document.getElementById('candleBody');
  if (candleAutoBusy || !candlePoh || document.hidden || !body || body.classList.contains('collapsed')) return;
  candleAutoBusy = true;
  try {
    const j = await candleFetchProxy();
    candleMerge(j);
    try { localStorage.setItem(CANDLE_LS, JSON.stringify({ pairs: candlePoh, daily: candleDaily })); } catch (e) { /* quota */ }
    candleRefreshInPlace();
    if (Date.now() - candleAlAt > 120000) candleAlFetch(); // alertes de prix : relues toutes les 2 min (celles touchées disparaissent)
  } catch (e) { /* on réessaiera au prochain tour */ }
  candleAutoBusy = false;
}
setInterval(candleAutoRefresh, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) candleAutoRefresh(); });

document.getElementById('candleToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  document.body.classList.toggle('cc-lock', !expanded);
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('candleBody').classList.toggle('collapsed', expanded);
  if (!expanded) { candleLoad(); candleAlFetch(); if (!alerteData) alerteLoad().then(candleAlFilterSync); } // plans ALERTE chargés aussi : le compteur « Alerts » est juste dès l'ouverture
});

document.getElementById('candleViewReset')?.addEventListener('click', () => {
  const id = candleCurId();
  if (id) { candleRedraw(id, CANDLE_DEF); candleViewSave(id, Object.assign({}, CANDLE_DEF)); }
});
document.getElementById('candleList').addEventListener('click', (e) => {
  if (Date.now() < cg.swallow) return; // clic issu d'un geste de zoom / déplacement
  const ch = e.target.closest('.cd-chart');
  if (!ch || candleHistTf === '0' || candleHistTf === '1D') return;
  const rc = ch.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top;
  const hit = (candleEvHits[ch.dataset.pair] || []).slice().reverse().find((h) => Math.hypot(h.x - px, h.y - py) <= h.r + 6); // la pastille du dessus d'abord
  if (hit) candleEvOpen(hit.list);
});
// Panneau du bas façon TradingView : toutes les news de la pastille (nom, date/heure UTC-10, Actual / Forecast / Previous)
function candleEvOpen(list) {
  candleEvClose();
  const body = document.getElementById('candleBody');
  if (!body || !list || !list.length) return;
  const pad = (n) => String(n).padStart(2, '0'), esc = (t) => String(t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const live = (e) => { try { return (currentEvents || []).find((x) => x && x.title === e.title && x.country === e.country && x.date === e.date) || e; } catch (err) { return e; } };
  const rows = list.map((e0) => {
    const e = live(e0), d = new Date((e0._t - 36000) * 1000), v = (x) => (x === undefined || x === null || String(x).trim() === '' ? '—' : esc(x));
    return `<div class="ce-ev"><div class="ce-t">${esc(e0.title)}</div><div class="ce-d">${pad(d.getUTCDate())} ${CANDLE_MON[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}</div>` +
      `<div class="ce-r"><span>Actual</span><b class="${candleActCls(e.actual || e0.actual, e.forecast || e0.forecast)}">${v(e.actual || e0.actual)}</b></div><div class="ce-r"><span>Forecast</span><b>${v(e.forecast || e0.forecast)}</b></div><div class="ce-r"><span>Previous</span><b>${v(e.previous || e0.previous)}</b></div></div>`;
  }).join('');
  const wrap = document.createElement('div');
  wrap.id = 'candleEvSheet';
  wrap.innerHTML = `<div class="ce-scrim"></div><div class="ce-sheet" role="dialog">${rows}</div>`;
  body.appendChild(wrap);
  const sheet = wrap.querySelector('.ce-sheet');
  wrap.querySelector('.ce-scrim').addEventListener('click', candleEvClose);
  let y0 = null, dy = 0; // glisser vers le bas = fermer
  sheet.addEventListener('touchstart', (ev) => { y0 = sheet.scrollTop <= 0 ? ev.touches[0].clientY : null; dy = 0; }, { passive: true });
  sheet.addEventListener('touchmove', (ev) => { if (y0 === null) return; dy = ev.touches[0].clientY - y0; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sheet.addEventListener('touchend', () => { if (dy > 70) candleEvClose(); else sheet.style.transform = ''; y0 = null; });
}
// Couleur du résultat (Actual) : exactement la règle du calendrier éco du site (actualVsForecast) : plus haut que la prévision = vert, plus bas = rouge, égal ou sans prévision = blanc neutre.
function candleNum(v) { // « A$3.047B », « 10.632M », « 3.6% » -> nombre comparable
  const m = String(v == null ? '' : v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?\s*([KMBT])?/i);
  if (!m) return null;
  return parseFloat(m[0]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[1] || '').toUpperCase()] || 1);
}
function candleActCls(actual, forecast) {
  const a = candleNum(actual), f = candleNum(forecast);
  const r = a === null || f === null ? 'neutral' : actualVsForecast(String(a), String(f));
  return r === 'pos' ? 'ce-pos' : r === 'neg' ? 'ce-neg' : 'ce-neu';
}
function candleEvClose() { document.getElementById('candleEvSheet')?.remove(); }

// ===== ALERTE : tableau Symbol | 50 % | Sens | Type | Result | Rpot, règle PAPER TRADING (FVG 1 min sur le 50 %) =====
// 50 % = milieu entre l'entrée (bord de la boîte 14H) et le TP1 (bord ± R) : haut + R/2 ou bas - R/2. L'heure affichée (UTC-10) est celle de la 1re touche.
const ALERTE_LS = 'alerteCacheV1';
let alerteData = null; // { PAIR: { d, hi, lo, up, dn } }
const ALERTE_CCY = { EUR: '#4aa3ff', USD: '#ffd400', GBP: '#ff5ca8', JPY: '#ff4d4d', AUD: '#2ecc71', CAD: '#ff9f1c', CHF: '#b36bff', NZD: '#1de9d0', XAU: '#d4af37', BTC: '#f7931a' };
function alerteHour(t) { return new Date((t - 36000) * 1000).getUTCHours(); } // heure UTC-10
function alerteTime(t) { return new Date((t - 36000) * 1000).toISOString().slice(11, 16); }
function alerteZone(t) { // couleurs de session de PAPER TRADING : 14-17 bleu, 22-02 rouge, 02-03 vert, 03-07 jaune, sinon gris
  const h = alerteHour(t);
  return (h >= 14 && h < 17) ? '#2962ff' : (h >= 22 || h < 2) ? '#f23645' : (h >= 2 && h < 3) ? '#089981' : (h >= 3 && h < 7) ? '#fdd835' : '#787b86';
}
// Contexte d'un signal, connu AVANT la décision de 15 h (UTC-10) : volatilité de la veille, tendance 3 jours, cassure de PDH/PDL par le corps d'une POH, sweeps de D1 par les bougies 14h / 22h / 02h, Fibo de D1.
// ★ « profil vendredi » (hypothèse à valider avec le journal) : paire contenant le dollar + signal dans le sens de la tendance D3→D1 + veille > 1,3× sa moyenne des 20 jours.
let alerteCtxData = null; // { pairs, daily } du proxy
const ALERTE_SLOTS = ['12', '14', '15', '17', '22', '23', '02', '03', '07'];
function alerteCtx(id, side) {
  const dy = alerteCtxData && alerteCtxData.daily && alerteCtxData.daily[id], ds = alerteCtxData && alerteCtxData.pairs && alerteCtxData.pairs[id];
  if (!dy || dy.length < 3 || !ds || !ds.length) return null;
  const day = ds[ds.length - 1], d1 = dy[dy.length - 2], d2 = dy[dy.length - 3], d3 = dy.length >= 4 ? dy[dy.length - 4] : d2;
  if (!day || !day.c) return null;
  const H = d1[2], L = d1[3], cc = [];
  const hist = (chartsCandles && chartsCandles[id] || []).slice(0, -2).slice(-20); // 20 jours précédant la veille (flux quotidien du site)
  const base = hist.length >= 10 ? hist.reduce((a, b) => a + (b[2] - b[3]), 0) / hist.length : null;
  const vr = base ? (H - L) / base : null;
  const trend = d1[4] - d3[1], aligned = (trend > 0) === (side === 'up');
  let bh = null, bl = null;
  const sw = [];
  for (const sl of ALERTE_SLOTS) {
    const c = day.c[sl];
    if (!c) continue;
    if (bh === null && Math.max(c[0], c[3]) > H) bh = sl;
    if (bl === null && Math.min(c[0], c[3]) < L) bl = sl;
    if (sl === '14' || sl === '22' || sl === '02') {
      if (c[1] > H && c[3] < H) sw.push(sl + 'h H');
      if (c[2] < L && c[3] > L) sw.push(sl + 'h L');
    }
  }
  const bu1 = d1[4] > d1[1], be1 = d1[4] < d1[1], bu2 = d2[4] > d2[1], be2 = d2[4] < d2[1];
  const fibo = bu1 && bu2 ? 'haussier' : be1 && be2 ? 'baissier' : null;
  const star = /USD|XAU/.test(id) && aligned && vr !== null && vr >= 1.3;
  return { vr, aligned, trendUp: trend > 0, bh, bl, sw, fibo, star };
}
function alerteCtxHtml(c, side) {
  if (!c) return '';
  const chip = (t, cls, tip) => `<span class="al-chip ${cls || ''}" title="${tip || ''}">${t}</span>`;
  const out = [];
  if (c.vr !== null) out.push(chip(`Veille ${c.vr.toFixed(1)}×`, c.vr >= 1.3 ? 'hot' : c.vr < 0.8 ? 'cold' : '', 'Amplitude de la veille (D1) / sa moyenne des 20 jours'));
  out.push(chip(`Tendance 3j ${c.trendUp ? '▲' : '▼'} ${c.aligned ? 'alignée' : 'contre'}`, c.aligned ? 'ok' : 'bad', 'Sens de D3 → D1 comparé au sens du signal'));
  if (c.bh) out.push(chip(`PDH corps ${c.bh}h`, '', 'Une bougie POH a cassé le haut de la veille par son corps (heure UTC-10)'));
  if (c.bl) out.push(chip(`PDL corps ${c.bl}h`, '', 'Une bougie POH a cassé le bas de la veille par son corps (heure UTC-10)'));
  c.sw.forEach((x) => out.push(chip(`Sweep ${x}`, '', 'Mèche au-delà du haut / bas de D1 avec clôture de retour dans la plage')));
  if (c.fibo) out.push(chip(`Fibo ${c.fibo === 'haussier' ? '▲' : '▼'}`, '', 'D2 et D1 vont dans le même sens : Fibo 38/50/61 actif'));
  return out.join('');
}
// Jour de trading affiché (celui de la majorité des paires) et ses 2 meilleures paires : classées par R potentiel, parmi les paires dont un trade a atteint le TP1
function alerteDayStr() {
  const days = {};
  for (const k of Object.keys(alerteData || {})) if (alerteData[k] && alerteData[k].d) days[alerteData[k].d] = (days[alerteData[k].d] || 0) + 1;
  return Object.keys(days).sort((a, b) => days[b] - days[a] || (a < b ? 1 : -1))[0] || null;
}
function alerteTop2() {
  const dstr = alerteDayStr();
  if (!dstr) return [];
  return Object.keys(alerteData).filter((id) => { const f = alerteData[id]; return f && f.d === dstr && f.pt && f.pt.res === 1 && f.pt.rp != null; })
    .map((id) => ({ id, rp: alerteData[id].pt.rp })).sort((a, b) => b.rp - a.rp).slice(0, 2);
}
function alerteRender() {
  const box = document.getElementById('alerteTable');
  if (!box) return;
  if (!alerteData) { box.innerHTML = '<div class="charts-intro">Alert data unavailable right now.</div>'; return; }
  // Règle PAPER TRADING : un 50 % compte seulement si sa 1re touche est la barre du milieu d'un FVG 1 min qui le chevauche (heure = 3e barre, clôturée).
  // PTP = côté de la 1re sortie de la boîte 14H, OCO = côté opposé. Type : BUY côté haut, SELL côté bas. Résultat : TP / SL (un des deux trades) ; Rpot = R maximum atteint (vide si SL).
  const rows = [], topRank = {};
  alerteTop2().forEach((t, i) => { topRank[t.id] = i + 1; });
  for (const p of CORR_ALL_PAIRS) {
    const f = alerteData[p.id], q = f && f.pt;
    if (!q) continue;
    const ev = [];
    if (q.up) ev.push({ t: q.up, side: 'up' });
    if (q.dn) ev.push({ t: q.dn, side: 'dn' });
    ev.forEach((e) => rows.push({ id: p.id, f, q, t: e.t, side: e.side, sens: (e.side === 'up') === (q.dir === 1) ? 'PTP' : 'OCO' }));
  }
  rows.sort((a, b) => a.t - b.t);
  const dec = (v) => v.toFixed(v >= 1000 ? 2 : v >= 100 ? 3 : 5);
  box.innerHTML = `<div class="al-grid"><div class="al-h">Symbol</div><div class="al-h">50%</div><div class="al-h">Sens</div><div class="al-h">Type</div><div class="al-h">Result</div><div class="al-h">Rpot</div>` +
    (rows.length ? rows.map((r, i) => {
      const b = r.id.slice(0, 3), q = r.id.slice(3), col = alerteZone(r.t), alt = i % 2 === 0 ? 'a' : 'b';
      const R = r.f.hi - r.f.lo;
      const tip = `Box 14H: ${dec(r.f.hi)} / ${dec(r.f.lo)} · 50% up ${dec(r.f.hi + R / 2)} · 50% down ${dec(r.f.lo - R / 2)}`;
      const res = r.q.res === 1 ? '<span style="color:#089981">TP</span>' : r.q.res === 2 ? '<span style="color:#f23645">SL</span>' : '—';
      const rp = r.q.res !== 2 && r.q.rp != null ? '+' + r.q.rp.toFixed(2) + 'R' : '';
      const da = `data-fid="${r.id}" data-ft="${r.t}"`, cx = alerteCtx(r.id, r.side), star = cx && cx.star ? '<span class="al-star" title="Profil vendredi : paire dollar, tendance alignée, veille agitée (hypothèse en cours de test)">★</span> ' : '', top = topRank[r.id] ? `<span class="al-top" title="${topRank[r.id] === 1 ? '1re' : '2e'} meilleure paire du jour (R potentiel)">#${topRank[r.id]}</span> ` : '';
      return `<div class="al-c ${alt} al-go" ${da} title="${tip}">${top}${star}<span style="color:${ALERTE_CCY[b] || '#e5e5e5'}">${b}</span> <span style="color:${ALERTE_CCY[q] || '#e5e5e5'}">${q}</span></div>` +
        `<div class="al-c al-t al-go" ${da} style="color:${col};background:${col}1f" title="${tip}">${alerteTime(r.t)}</div>` +
        `<div class="al-c ${alt} al-go al-sens ${r.sens === 'OCO' ? 'oco' : 'ptp'}" ${da}>${r.sens}</div>` +
        `<div class="al-c ${alt} al-go al-type ${r.side === 'up' ? 'buy' : 'sell'}" ${da}>${r.side === 'up' ? 'BUY' : 'SELL'}</div>` +
        `<div class="al-c ${alt} al-go" ${da}>${res}</div><div class="al-c ${alt} al-go" ${da}>${rp}</div>` +
        (cx ? `<div class="al-ctx ${alt} al-go" ${da}>${alerteCtxHtml(cx, r.side)}</div>` : '');
    }).join('') : '<div class="al-empty">—</div>') +
    `</div>`;
}
// Clic sur un symbole du tableau : ouvre CANDLE sur cette paire, en 1 min, centré sur la barre de l'événement (3e barre du FVG) avec un repère bleu
let alerteFocusBusy = false;
async function alerteFocus(id, t, keep, px) { // keep = on garde le filtre « Alerts » ; px = prix de la ligne bleue quand la paire n'a pas de plan (pas de repère vertical)
  if (alerteFocusBusy || !id || (!t && !(px > 0))) return;
  alerteFocusBusy = true;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if (rp.on) candleRpExit();
    const tg = document.getElementById('candleToggle');
    if (tg && tg.getAttribute('aria-expanded') !== 'true') tg.click();
    if (candleMini) { candleMini = false; try { localStorage.setItem('candleMini', '0'); } catch (e) { /* pas de stockage */ } candleMiniApply(); }
    const was1 = candleHistTf === '1';
    candleHistTf = '1';
    try { localStorage.setItem('candleHistTf', '1'); } catch (e) { /* pas de stockage */ }
    if (window.candleHistSync) window.candleHistSync();
    for (let k = 0; k < 40 && !(candlePoh && candleDays[id]); k++) await wait(250); // attente du chargement des POH
    if (!keep) { candleF.fibo = candleF.sweep = candleF.both = candleF.alert = false; candleSelected = null; }
    candleFocusMark = t ? { id, t } : null;
    if (!keep || !was1) {
      candleRender();
      const l = document.getElementById('candleList'), i = [...candleSlides()].findIndex((r) => r.dataset.id === id);
      if (i >= 0) l.scrollLeft = i * l.clientWidth;
      candleNavUpdate();
    }
    const key = id + '|1';
    for (let k = 0; k < 80; k++) { // attente des barres 1 min (historique complet au 1er chargement)
      candleHistEnsure(id);
      const h = candleHistData[key];
      if (h && h.bars.length && (!t || h.bars[0][0] <= t)) break;
      await wait(250);
    }
    const h = candleHistData[key], bars = h && h.bars;
    if (!bars || !bars.length) return;
    if (!t) { candleShowPrice(id, px); return; } // ligne bleue horizontale seule : on cadre son prix sur le 1 min
    let a = 0, b = bars.length - 1; // dernière barre dont l'ouverture <= t
    while (a < b) { const m = (a + b + 1) >> 1; if (bars[m][0] <= t) a = m; else b = m - 1; }
    // vue : la barre de l'événement au centre de la zone des prix, ~8 px par barre ; prix centré sur les barres autour de l'événement
    const { W } = candleDims(), { AX, LEFT } = CANDLE_G, plotW0 = W - AX - LEFT, nCs = ((candleDaily || {})[id] || []).slice(-4).length + 1 + CANDLE_SLOTS.length;
    const stepB = plotW0 * 0.5 / nCs, xz = candleClamp(24 / stepB, CANDLE_XZ[0], CANDLE_XZ[1]), hs0 = stepB / 3 * xz, j = bars.length - 1 - a;
    const xp = ((W - AX) / 2 + (j + 0.5) * hs0 - LEFT - 0.5 * plotW0 * xz + 0.5 * stepB * xz) / (W - AX);
    const near = bars.slice(Math.max(0, a - 40), a + 40);
    let hi = -Infinity, lo = Infinity;
    for (const x of near) { hi = Math.max(hi, x[2]); lo = Math.min(lo, x[3]); }
    const g = candleGeo(id), span = Math.max(hi - lo, g.baseRng * 0.002) * 1.25;
    const v = { xz, xp, yz: candleClamp(g.baseRng / span, CANDLE_YZ[0], CANDLE_YZ[1]), yp: ((hi + lo) / 2 - g.cenB) / g.baseRng };
    candleViewSave(id, v);
    candleRedraw(id, v);
  } finally { alerteFocusBusy = false; }
}
document.getElementById('alerteTable')?.addEventListener('click', (e) => {
  const r = e.target.closest('[data-fid]');
  if (r) alerteFocus(r.dataset.fid, +r.dataset.ft);
});
// ===== RAPPORT DE FIN DE JOURNÉE (jour de trading 22:00 UTC → 22:00 UTC) : signaux, volatilité par paire et par devise, annonces majeures, cassures PDH/PDL, sweeps =====
// Généré à partir des données déjà chargées (bougies quotidiennes, POH, journal des signaux du serveur, calendrier du site) ; le serveur envoie en plus un résumé à 22:05 UTC (notification).
let alertePlans = null; // plans réels d'Arii CDX SW lus sur TradingView (outil plans_report.mjs) : confluences de l'infobulle de la partie rouge du stop
let alerteJournal = null, alerteJournalAt = 0, alerteEco = null, alerteHist = null; // alerteHist = signaux reconstitués à partir de l'historique 1 min (data/journal-history.json) ; le journal du serveur prime sur la même clé
const alEsc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function alerteReportLoad() {
  const box = document.getElementById('alerteReport');
  if (!box || !alerteData || !alerteCtxData) return;
  try {
    if (Date.now() - alerteJournalAt > 60000) {
      const r = await fetch(`${ALERTE_API}/alerte?journal=1`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (r.ok) { alerteJournal = (await r.json()).journal || {}; alerteJournalAt = Date.now(); }
    }
    if (!alerteHist) { const r = await fetch('./data/journal-history.json', { cache: 'no-store' }); if (r.ok) alerteHist = await r.json(); }
    if (!alertePlans) { const r = await fetch('./data/plans-log.json', { cache: 'no-store' }); if (r.ok) alertePlans = Object.values((await r.json()).plans || {}).filter((x) => (x.tf || '1') === '1' && x.c5); } // règle : seuls les plans 1 min en confluence avec un plan 5 min de même sens au même endroit (écart <= 45 min)
    if (!alerteEco) { const r = await fetch('./data/eco-calendar.json', { cache: 'no-store' }); if (r.ok) alerteEco = (await r.json()).events || []; }
  } catch (e) { /* le rapport s'affiche avec ce qui est disponible */ }
  alerteReportRender();
}
// ===== STATISTIQUES DU JOURNAL : win rate par profil (preuve avec tes propres signaux) =====
// Chaque signal enregistré par le serveur est classé avec les données connues AVANT sa journée (bougies quotidiennes du site) : volatilité de la veille, tendance D3→D1 alignée ou non, paire dollar, ★ (= dollar + tendance alignée + veille ≥ 1,3×).
function alerteSigCtx(x) {
  const arr = (chartsCandles || {})[x.pair];
  if (!arr) return null;
  const t0 = Date.parse(x.d + 'T00:00:00Z') / 1000, prev = arr.filter((b) => b[0] < t0), n = prev.length;
  if (n < 24) return null;
  const d1 = prev[n - 1], d3 = prev[n - 3], hist = prev.slice(n - 21, n - 1), base = hist.reduce((a, b) => a + (b[2] - b[3]), 0) / hist.length;
  if (!(base > 0)) return null;
  const vr = (d1[2] - d1[3]) / base, trend = d1[4] - d3[1], aligned = (trend > 0) === (x.side === 'BUY'), usd = /USD|XAU/.test(x.pair);
  return { vr, aligned, usd, star: usd && aligned && vr >= 1.3 };
}
function alerteStatsHtml() {
  const all = Object.values(Object.assign({}, alerteHist || {}, alerteJournal || {})).filter((x) => x.res === 1 || x.res === 2).map((x) => ({ x, c: alerteSigCtx(x) })).filter((r) => r.c);
  const days = new Set(all.map((r) => r.x.d)).size;
  // 2 meilleures paires de chaque jour (R potentiel le plus haut, paires gagnantes) : choisies APRÈS coup, donc leur win rate est gagnant par construction
  const perDay = {};
  for (const r of all) if (r.x.res === 1 && r.x.mf != null) { const m = perDay[r.x.d] || (perDay[r.x.d] = {}); m[r.x.pair] = Math.max(m[r.x.pair] || 0, r.x.mf); }
  const topSet = new Set(), topDays = Object.keys(perDay).sort().reverse().map((d) => {
    const t = Object.entries(perDay[d]).sort((a, b) => b[1] - a[1]).slice(0, 2);
    t.forEach(([pair]) => topSet.add(d + '|' + pair));
    return { d, t };
  });
  const groups = [
    ['Tous les signaux', () => true],
    ['★ profil vendredi', (r) => r.c.star],
    ['Sans ★', (r) => !r.c.star],
    ['Veille ≥ 1,3×', (r) => r.c.vr >= 1.3],
    ['Veille < 1,3×', (r) => r.c.vr < 1.3],
    ['Tendance alignée', (r) => r.c.aligned],
    ['Tendance contre', (r) => !r.c.aligned],
    ['Paires dollar / or', (r) => r.c.usd],
    ['Autres paires', (r) => !r.c.usd],
    ['PTP', (r) => r.x.sens === 'PTP'],
    ['OCO', (r) => r.x.sens === 'OCO'],
    ['2 meilleures du jour *', (r) => topSet.has(r.x.d + '|' + r.x.pair)],
  ];
  const rows = groups.map(([lbl, f]) => {
    const g = all.filter(f), tp = g.filter((r) => r.x.res === 1).length, n = g.length;
    return `<div class="als-c">${lbl}</div><div class="als-c als-n">${n}</div><div class="als-c als-n">${tp}</div><div class="als-c als-n">${n - tp}</div><div class="als-c als-n ${n >= 30 ? 'als-ok' : ''}">${n ? Math.round(100 * tp / n) + ' %' : '—'}</div>`;
  }).join('');
  return `<div class="alr-h">Statistiques du journal</div><div class="alr-r">${all.length} signaux terminés sur ${days} jour${days > 1 ? 's' : ''}${all.length < 30 ? ' · échantillon trop petit (moins de 30), à titre indicatif' : ''}</div>` +
    `<div class="als-grid"><div class="als-h">Profil</div><div class="als-h als-n">N</div><div class="als-h als-n">TP</div><div class="als-h als-n">SL</div><div class="als-h als-n">Win</div>${rows}</div>` +
    `<div class="alr-h">2 meilleures paires par jour (R potentiel)</div>` +
    topDays.slice(0, 8).map(({ d, t }) => `<div class="alr-ev"><b>${d.slice(5)}</b> ${t.map(([pair, mf]) => `${pair.slice(0, 3)}/${pair.slice(3)} <i>+${mf.toFixed(1)}R</i>`).join(' · ')}</div>`).join('') +
    `<div class="alr-r als-note">* Sélection faite après coup : ces paires sont choisies parce qu'elles ont gagné, leur win rate ne prouve rien. La liste ci-dessus sert à voir si les mêmes paires reviennent.</div>` +
    `<div class="alr-r als-note">Les groupes se recoupent. Les signaux encore en cours ne sont pas comptés. Un écart n'est significatif qu'avec plusieurs dizaines de signaux par groupe.</div>`;
}
let alerteDaySel = null; // jour du rapport choisi avec les flèches (null = jour en cours)
// ===== PLANS CDX SW : meilleurs plans du jour et win rate de la semaine, avec les confluences notées dans l'infobulle du plan =====
const PLAN_WIN_R = 1; // un plan est « gagnant » si son pic atteint au moins 1R
const PLAN_KZ = { A: 'Asia', L: 'London', NA: 'NY AM', NL: 'NY Lunch' };
const planTok = (t) => String(t).replace(/^[^\wÀ-ÿ]+/u, '').replace(/KZ(NA|NL|A|L)(H|L)/, (m, k, hl) => `KZ ${PLAN_KZ[k]} ${hl === 'H' ? 'haut' : 'bas'}`);
const planSweep = (x) => { const m = String(x.sweep || '').replace(/\s*\(il y a[^)]*\)/, '').trim(); return m ? 'Sweep ' + m : ''; }; // « dernier sweep » de l'infobulle (type seulement, sans l'ancienneté)
const planConf = (x) => [...new Set([...(x.source || []).map(planTok), ...(x.ligne || []).map(planTok), ...(x.ifvg ? ['IFVG rouge'] : []), planSweep(x), ...(x.c5 ? ['Plan 5 min confirmé', ...(x.c5.source || []).map(planTok)] : [])].filter(Boolean))];
const planExact = (x) => [...(x.source || []), ...(x.ligne || []).map(planTok), ...(x.ifvg ? ['IFVG rouge 1m/5m'] : []), x.sweep ? 'dernier sweep : ' + x.sweep : '', x.c5 ? 'plan 5 min ' + alerteTime(x.c5.t) + ' : ' + ((x.c5.source || []).join(' + ') || 'FVG jaune') : ''].filter(Boolean); // confluences telles qu'écrites dans l'infobulle du plan
function alertePlansHtml(dstr) {
  if (!alertePlans || !alertePlans.length) return '';
  const dayEnd = Date.parse(dstr + 'T22:00:00Z') / 1000, dayStart = dayEnd - 86400, wkStart = dayEnd - 5 * 86400;
  const inDay = alertePlans.filter((x) => x.t >= dayStart && x.t < dayEnd), inWk = alertePlans.filter((x) => x.t >= wkStart && x.t < dayEnd);
  const pn = (id) => id.slice(0, 3) + '/' + id.slice(3), win = (x) => x.pic >= PLAN_WIN_R;
  const tag = (x) => `${alEsc(pn(x.pair))} ${x.side === 'BUY' ? 'achat' : 'vente'}`;
  const planCard = (x) => `<div class="alr-card"><div class="alr-ct">${tag(x)} <b class="${win(x) ? 'up' : 'dn'}">+${x.pic.toFixed(2)}R</b> <span class="alr-r">${alerteTime(x.t)} · ${alEsc(x.state)}</span></div><div class="alr-ev">${planExact(x).map(alEsc).join(' · ') || 'sans confluence notée'}</div></div>`;
  const best = inDay.slice().sort((a, b) => b.pic - a.pic).slice(0, 3).map(planCard).join('');
  const worst = inDay.filter((x) => x.state !== 'en cours').sort((a, b) => a.pic - b.pic).slice(0, 3).map(planCard).join('');
  // tous les plans du jour par symbole, tels qu'affichés par l'indicateur (état de l'infobulle : stop touché / arrêté (plan contraire ou 07h) / en cours)
  const dayPair = {};
  for (const x of inDay) (dayPair[x.pair] || (dayPair[x.pair] = [])).push(x);
  const stLbl = (x) => (x.state === 'stop' ? 'SL (stop touché)' : x.state === 'contraire' ? 'arrêté (plan contraire)' : x.state === '07h' ? 'arrêté à 07h' : 'en cours');
  const perSym = Object.entries(dayPair).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([id, a]) => {
    a.sort((p, q) => p.t - q.t);
    const sl = a.filter((x) => x.state === 'stop').length, st = a.filter((x) => x.state === 'contraire' || x.state === '07h').length, run = a.filter((x) => x.state === 'en cours').length;
    return `<details class="alr-sym"><summary><b>${alEsc(pn(id))}</b> · ${a.length} plan${a.length > 1 ? 's' : ''} · ${sl} SL${st ? ` · ${st} arrêté${st > 1 ? 's' : ''}` : ''}${run ? ` · ${run} en cours` : ''}</summary>` +
      a.map((x) => `<div class="alr-ev"><b>${alerteTime(x.t)}</b> ${x.side === 'BUY' ? 'achat' : 'vente'} · ${stLbl(x)} · pic +${x.pic.toFixed(2)}R</div>`).join('') + `</details>`;
  }).join('');
  const byPair = {};
  for (const x of inWk) (byPair[x.pair] || (byPair[x.pair] = [])).push(x);
  const pairs = Object.entries(byPair).filter(([, a]) => a.length >= 2).map(([id, a]) => ({ id, n: a.length, w: a.filter(win).length, top: a.slice().sort((p, q) => q.pic - p.pic)[0] })).sort((a, b) => b.w / b.n - a.w / a.n || b.top.pic - a.top.pic).slice(0, 3)
    .map((r) => `<div class="alr-ev"><b>${alEsc(pn(r.id))}</b> ${Math.round(100 * r.w / r.n)} % (${r.w}/${r.n}) · meilleur plan +${r.top.pic.toFixed(2)}R : ${planConf(r.top).map(alEsc).join(' · ') || '—'}</div>`).join('');
  const byConf = {};
  for (const x of inWk) for (const c of planConf(x)) { const o = byConf[c] || (byConf[c] = { n: 0, w: 0 }); o.n++; if (win(x)) o.w++; }
  // meilleur combo de 2 confluences de la semaine (plans terminés, 1 min confirmés par le 5 min) : classé sur le taux de plans à 2R et plus, puis sur le nombre de plans
  const cb = {};
  for (const x of inWk) {
    if (x.state === 'en cours') continue;
    const cs = planConf(x).filter((c) => c !== 'Plan 5 min confirmé').sort();
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const o = cb[cs[i] + ' + ' + cs[j]] || (cb[cs[i] + ' + ' + cs[j]] = { n: 0, w1: 0, w2: 0, p: [] }); o.n++; if (x.pic >= 1) o.w1++; if (x.pic >= 2) o.w2++; o.p.push(x.pic); }
  }
  const cbMin = Object.values(cb).some((o) => o.n >= 8) ? 8 : 5;
  const cbBest = Object.entries(cb).filter(([, o]) => o.n >= cbMin).sort((a, b) => b[1].w2 / b[1].n - a[1].w2 / a[1].n || b[1].n - a[1].n)[0];
  const comboHtml = cbBest ? (() => { const [k, o] = cbBest, md = o.p.slice().sort((a, b) => a - b)[Math.floor(o.p.length / 2)]; return `<div class="alr-card"><div class="alr-ct"><b class="up">${alEsc(k)}</b></div><div class="alr-ev">${o.n} plans · ≥ 1R : <b>${Math.round(100 * o.w1 / o.n)} %</b> · ≥ 2R : <b>${Math.round(100 * o.w2 / o.n)} %</b> · pic médian +${md.toFixed(2)}R</div></div>`; })() : '<div class="alr-ev">Pas assez de plans pour classer un combo (5 minimum)</div>';
  // vue cumulée : tous les plans terminés depuis le début de l'historique jusqu'à la fin du jour affiché
  const allDone = alertePlans.filter((x) => x.t < dayEnd && x.state !== 'en cours');
  const cu1 = {}, cu2 = {};
  for (const x of allDone) {
    const cs = planConf(x).filter((c) => c !== 'Plan 5 min confirmé').sort();
    const add = (m, k) => { const o = m[k] || (m[k] = { n: 0, w1: 0, w2: 0, p: [] }); o.n++; if (x.pic >= 1) o.w1++; if (x.pic >= 2) o.w2++; o.p.push(x.pic); };
    for (let i = 0; i < cs.length; i++) { add(cu1, cs[i]); for (let j = i + 1; j < cs.length; j++) add(cu2, cs[i] + ' + ' + cs[j]); }
  }
  const cuRow = ([k, o]) => `<div class="alr-ev"><b>${alEsc(k)}</b><br>${o.n} plans · ≥ 1R <b>${Math.round(100 * o.w1 / o.n)} %</b> · ≥ 2R <b>${Math.round(100 * o.w2 / o.n)} %</b> · pic médian +${o.p.slice().sort((a, b) => a - b)[Math.floor(o.p.length / 2)].toFixed(2)}R</div>`;
  const cuTop = (m, min, k) => Object.entries(m).filter(([, o]) => o.n >= min).sort((a, b) => b[1].w2 / b[1].n - a[1].w2 / a[1].n || b[1].n - a[1].n).slice(0, k).map(cuRow).join('');
  const cuDays = new Set(allDone.map((x) => new Date((x.t + 7200) * 1000).toISOString().slice(0, 10)));
  const cumulHtml = allDone.length ? `<div class="alr-h">Cumul depuis le début (${cuDays.size} jour${cuDays.size > 1 ? 's' : ''}, ${allDone.length} plans)</div><div class="alr-r">Meilleurs combos (8 plans minimum)</div>${cuTop(cu2, 8, 3) || '<div class="alr-ev">Pas encore assez de plans</div>'}<div class="alr-r">Meilleures confluences seules (8 plans minimum)</div>${cuTop(cu1, 8, 5) || '<div class="alr-ev">Pas encore assez de plans</div>'}` : '';
  const confRow = ([c, o]) => `<div class="alr-ev"><b>${Math.round(100 * o.w / o.n)} %</b> (${o.w}/${o.n}) ${alEsc(c)}</div>`;
  const confAll = Object.entries(byConf).filter(([, o]) => o.n >= 3);
  const confs = confAll.slice().sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n || b[1].n - a[1].n).slice(0, 6).map(confRow).join('');
  const confBad = confAll.slice().sort((a, b) => a[1].w / a[1].n - b[1].w / b[1].n || b[1].n - a[1].n).slice(0, 6).map(confRow).join('');
  return `<div class="alr-h">Meilleurs plans du jour (confluences)</div>${best || '<div class="alr-ev">Aucun plan lu pour ce jour</div>'}` +
    `<div class="alr-h">Plans du jour par symbole (${inDay.length})</div>${perSym || '<div class="alr-ev">Aucun plan pour ce jour</div>'}` +
    `<div class="alr-h">Pires plans du jour (confluences)</div>${worst || '<div class="alr-ev">Aucun plan terminé pour ce jour</div>'}` +
    `<div class="alr-h">Win rate de la semaine par paire</div>${pairs || '<div class="alr-ev">Pas assez de plans (2 minimum par paire)</div>'}` +
    `<div class="alr-h">Meilleur combo de la semaine (1 min + 5 min)</div>${comboHtml}` +
    cumulHtml +
    `<div class="alr-h">Meilleures confluences de la semaine</div>${confs || '<div class="alr-ev">Pas assez de plans (3 minimum par confluence)</div>'}` +
    `<div class="alr-h">Pires confluences de la semaine</div>${confBad || '<div class="alr-ev">Pas assez de plans (3 minimum par confluence)</div>'}` +
    `<div class="alr-r als-note">Plan gagnant = pic d'au moins ${PLAN_WIN_R}R. Seuls les plans 1 min confirmés par un plan 5 min de même sens (écart 45 min max) sont comptés. Plans lus sur TradingView (Arii CDX SW), confluences de l'infobulle de la partie rouge du stop.</div>`;
}
function alerteReportRender() {
  const box = document.getElementById('alerteReport');
  if (!box || !alerteData || !alerteCtxData) return;
  const realCur = alerteDayStr(); // null entre 22:00 UTC et la formation du 50 % du nouveau jour : on affiche alors le dernier jour du journal
  const allSg = Object.assign({}, alerteHist || {}, alerteJournal || {});
  const dayList = [...new Set([realCur, ...Object.values(allSg).map((x) => x.d)].filter(Boolean))].sort().reverse();
  if (!dayList.length) { box.innerHTML = ''; return; }
  if (!dayList.includes(alerteDaySel)) alerteDaySel = null;
  const cur = realCur || dayList[0], dstr = alerteDaySel || cur, isCur = dstr === realCur, di = dayList.indexOf(dstr);
  const dayEnd = Date.parse(dstr + 'T22:00:00Z') / 1000, dayStart = dayEnd - 86400, over = Date.now() / 1000 >= dayEnd;
  const sgAll = Object.values(isCur ? (alerteJournal || {}) : allSg).filter((x) => x.d === dstr);
  const tp = sgAll.filter((x) => x.res === 1).length, sl = sgAll.filter((x) => x.res === 2).length, op = sgAll.length - tp - sl;
  let top = alerteTop2();
  if (!isCur) { const mp = {}; for (const x of sgAll) if (x.res === 1 && x.mf != null) mp[x.pair] = Math.max(mp[x.pair] || 0, x.mf); top = Object.entries(mp).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id, rp]) => ({ id, rp })); }
  // une fiche par paire : signaux, R potentiel, volatilité du jour, contexte connu avant la décision de 15 h
  const card = ({ id, rp }, i) => {
    const sg = sgAll.filter((x) => x.pair === id).sort((a, b) => a.t - b.t);
    const dy = isCur ? alerteCtxData.daily[id] : null, hist = ((chartsCandles || {})[id] || []).slice(0, -1).slice(-20);
    let vol = '';
    if (dy && dy.length && hist.length >= 10) {
      const d0 = dy[dy.length - 1], base = hist.reduce((a, b) => a + (b[2] - b[3]), 0) / hist.length, mv = (d0[4] - d0[1]) / d0[1] * 100;
      if (base > 0) vol = `<div class="alr-r">Volatilité du jour : <b>${((d0[2] - d0[3]) / base).toFixed(1)}×</b> sa moyenne · <b class="${mv >= 0 ? 'up' : 'dn'}">${mv >= 0 ? '+' : ''}${mv.toFixed(2)} %</b></div>`;
    }
    const main = sg.find((x) => x.res === 1) || sg[0], side = main ? (main.side === 'BUY' ? 'up' : 'dn') : ((alerteData[id].pt.dir === 1) ? 'up' : 'dn');
    const ctxIn = isCur ? `<div class="al-ctx-in">${alerteCtxHtml(alerteCtx(id, side), side)}</div>` : '';
    const rows = sg.length ? sg.map((x) => `<div class="alr-ev"><b>${alerteTime(x.t)}</b> ${x.side} ${x.sens} · ${x.res === 1 ? '<i>TP</i>' : x.res === 2 ? 'SL' : 'en cours'}${x.mf != null && x.res !== 2 ? ` · +${x.mf.toFixed(1)}R` : ''}</div>`).join('') : '';
    return `<div class="alr-card"><div class="alr-ct"><span class="al-top">#${i + 1}</span> ${id.slice(0, 3)}/${id.slice(3)} <b class="up">+${rp.toFixed(1)}R</b></div>${rows}${vol}${ctxIn}</div>`;
  };
  // annonces majeures du jour (heure UTC-10)
  const ev = (alerteEco || []).filter((e) => e.impact === 'High' && e.date).map((e) => ({ e, t: Date.parse(e.date) / 1000 })).filter((x) => x.t >= dayStart && x.t < dayEnd).sort((a, b) => a.t - b.t);
  const evHtml = ev.length ? ev.slice(0, 8).map(({ e, t }) => `<div class="alr-ev"><b>${alerteTime(t)}</b> ${alEsc(e.country)} · ${alEsc(e.title)}${e.actual ? ` <i>${alEsc(e.actual)}</i> <span>/ ${alEsc(e.forecast || '—')}</span>` : ''}</div>`).join('') + (ev.length > 8 ? `<div class="alr-ev">+${ev.length - 8}</div>` : '') : '<div class="alr-ev">Aucune annonce majeure</div>';
  box.innerHTML = `<div class="alr-t"><button type="button" class="alr-nav" data-dn="${di + 1}" ${di + 1 >= dayList.length ? 'disabled' : ''} aria-label="Jour précédent">◀</button> Jour de trading ${alEsc(dstr)} · ${over ? 'terminé' : 'en cours'} <button type="button" class="alr-nav" data-dn="${di - 1}" ${di <= 0 ? 'disabled' : ''} aria-label="Jour suivant">▶</button></div>` +
    `<div class="alr-r">${sgAll.length ? `${sgAll.length} signaux · <b class="up">${tp} TP</b> · <b class="dn">${sl} SL</b>${op ? ` · ${op} en cours` : ''}${tp + sl ? ` · win rate ${Math.round(100 * tp / (tp + sl))} %` : ''}` : 'Aucun signal enregistré'}</div>` +
    `<div class="alr-h">Les 2 meilleures paires du jour</div>` + (top.length ? top.map(card).join('') : '<div class="alr-ev">Aucune paire gagnante pour l\'instant</div>') +
    alertePlansHtml(dstr) + `<div class="alr-h">Annonces majeures (UTC-10)</div>${evHtml}` + alerteStatsHtml();
}
async function alerteLoad() {
  if (!alerteData) {
    try { const c = JSON.parse(localStorage.getItem(ALERTE_LS) || 'null'); if (c && c.f50) { alerteData = c.f50; alerteRender(); } } catch (e) { /* pas de cache */ }
  }
  try {
    const j = await candleFetchProxy();
    alerteData = j.f50 || {};
    alerteCtxData = { pairs: j.pairs || {}, daily: j.daily || {} };
    if (!chartsCandles) { try { const r = await fetch('./data/daily-candles.json', { cache: 'no-store' }); if (r.ok) chartsCandles = (await r.json()).pairs; } catch (e) { /* contexte sans moyenne 20 jours */ } }
    alerteReportLoad();
    try { localStorage.setItem(ALERTE_LS, JSON.stringify({ f50: alerteData })); } catch (e) { /* quota */ }
  } catch (e) { /* on garde la dernière version */ }
  alerteRender();
}
document.getElementById('alerteReport')?.addEventListener('click', (e) => {
  const b = e.target.closest('.alr-nav');
  if (!b || b.disabled) return;
  const all = Object.assign({}, alerteHist || {}, alerteJournal || {}), rc = alerteDayStr();
  const list = [...new Set([rc, ...Object.values(all).map((x) => x.d)].filter(Boolean))].sort().reverse(), t = list[+b.dataset.dn];
  alerteDaySel = t && t !== (rc || list[0]) ? t : null;
  alerteReportRender();
});
document.getElementById('alerteToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('alerteBody').classList.toggle('collapsed', expanded);
  if (!expanded) alerteLoad();
});
setInterval(() => { // actualisation tant que le panneau est ouvert et visible
  const b = document.getElementById('alerteBody');
  if (b && !b.classList.contains('collapsed') && !document.hidden) alerteLoad();
}, 20000);
document.addEventListener('visibilitychange', () => {
  const b = document.getElementById('alerteBody');
  if (!document.hidden && b && !b.classList.contains('collapsed')) alerteLoad();
});

// Notifications téléphone éteint : abonnement Web Push, envoyé au serveur qui surveille les niveaux 50 % chaque minute
const ALERTE_API = 'https://ariinuiirgina.vercel.app/api';
function alerteKey(b64) {
  const p = '='.repeat((4 - (b64.length % 4)) % 4), raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
// Abonnement automatique : dès que les notifications sont autorisées, le téléphone s'abonne (ou se réabonne) tout seul. Rien ne désabonne.
async function alerteSubscribe(reg) {
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const kr = await fetch(`${ALERTE_API}/alerte?vapid=1`); // la clé publique est créée et servie par le serveur
    const kj = kr.ok ? await kr.json() : null;
    if (!kj || !kj.publicKey) throw new Error('vapid');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: alerteKey(kj.publicKey) });
  }
  const res = await fetch(`${ALERTE_API}/alerte`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
  if (!res.ok) throw new Error('server');
}
async function alerteNotifState() {
  const btn = document.getElementById('alerteNotif');
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.classList.remove('on');
  try {
    if (Notification.permission === 'granted') {
      await alerteSubscribe(await navigator.serviceWorker.ready); // déjà autorisé : abonnement silencieux, sans clic
      btn.classList.add('on');
      btn.textContent = '\ud83d\udd14 Notifications on';
      btn.disabled = true;
      return;
    }
  } catch (e) { /* on retombe sur l'état affiché ci-dessous */ }
  btn.disabled = false;
  btn.textContent = Notification.permission === 'denied'
    ? '\ud83d\udd15 Notifications blocked \u2014 allow them in Chrome > Settings > Site settings > Notifications'
    : '\ud83d\udd14 Enable notifications';
}
document.getElementById('alerteNotif')?.addEventListener('click', async () => { // sert seulement à AUTORISER ; jamais à désabonner
  if (Notification.permission === 'denied') return;
  try { if (Notification.permission !== 'granted') await Notification.requestPermission(); } catch (e) { /* refus */ }
  alerteNotifState();
});
alerteNotifState();

// Flèches ‹ › : POH seuls (—) / historique 1 min (1m) / historique 5 min (5m), sans molette
(function candleHistCtl() {
  const modes = CANDLE_HIST_MODES, lbl = document.getElementById('candleHistLbl'), prev = document.getElementById('candleHistPrev'), next = document.getElementById('candleHistNext');
  if (!lbl || !prev || !next) return;
  const sync = () => {
    const i = modes.indexOf(candleHistTf);
    lbl.textContent = CANDLE_HIST_LBL[candleHistTf];
    prev.disabled = i <= 0; next.disabled = i >= modes.length - 1;
  };
  const go = (d) => {
    const i = Math.min(modes.length - 1, Math.max(0, modes.indexOf(candleHistTf) + d));
    candleHistTf = modes[i];
    if (candleHistTf === '0') candleRpExit();
    try { localStorage.setItem('candleHistTf', candleHistTf); } catch (e) { /* pas de stockage */ }
    sync();
    candleRender();
    candleHistEnsure(candleCurId());
  };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  sync();
  window.candleHistSync = sync;
})();

// ===== REPLAY (façon TradingView) : barre de départ, lecture / pause, pas à pas, vitesse, changement de période, trading papier =====
const rpPip = (id) => (/JPY$/.test(id) ? 0.01 : /^XAU/.test(id) ? 0.1 : /^(BTC|ETH)/.test(id) ? 1 : 0.0001);
const rpEl = (i) => document.getElementById(i);
function rpFull(id) { const h = candleHistData[(id || rp.id) + '|' + candleHistTf]; return h && h.bars.length ? h.bars : null; }
function rpDec() { const b = rpFull(); const v = b ? b[b.length - 1][4] : 1; return v >= 1000 ? 2 : v >= 100 ? 3 : 5; }
function candleRpOverlay(y, xr, fmt, lo, hi, px) { // position papier : entrée, SL, TP (lignes sur le graphique)
  const p = rp.pos;
  if (!p) return '';
  const pn = (px - p.px) * p.side / rpPip(rp.id), col = p.side > 0 ? '#2ebd85' : '#f6465d';
  const L = (v, c, t, dash) => (v >= lo && v <= hi ? `<line x1="0" x2="${xr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${c}" stroke-width="1"${dash ? ' stroke-dasharray="4 3"' : ''}/><text x="6" y="${(y(v) - 4).toFixed(1)}" style="fill:${c};font-size:11px;font-weight:700">${t}</text>` : '');
  return L(p.px, col, `${p.side > 0 ? 'BUY' : 'SELL'} ${fmt(p.px)}  ${pn >= 0 ? '+' : ''}${pn.toFixed(1)}p`, true) + (p.sl ? L(p.sl, '#f6465d', 'SL ' + fmt(p.sl)) : '') + (p.tp ? L(p.tp, '#2ebd85', 'TP ' + fmt(p.tp)) : '');
}
function candleRpRedraw() { if (rp.on) candleRedraw(rp.id, candleViewOf(rp.id)); }
function candleRpUi() { // texte d'état + boutons
  const p = rpEl('candleRp');
  if (!p) return;
  const full = rpFull(), n = full ? candleRpCount(full) : 0, last = full && n ? full[Math.min(n, full.length) - 1] : null;
  const w = rp.done.filter((t) => t.pips > 0).length, tot = rp.done.reduce((a, t) => a + t.pips, 0);
  let m = rp.msg;
  if (!m) {
    if (rp.pick) m = full ? `Tap a candle to start · data ${new Date((full[0][0] - 36000) * 1000).toISOString().slice(0, 10)} → ${new Date((full[full.length - 1][0] - 36000) * 1000).toISOString().slice(0, 10)}` : 'Loading history…';
    else if (last) {
      m = new Date((last[0] - 36000) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' · ' + last[4].toFixed(rpDec());
      if (rp.pos) { const pn = (last[4] - rp.pos.px) * rp.pos.side / rpPip(rp.id) * (rp.pos.qty || 1); m += ` · ${rp.pos.side > 0 ? 'BUY' : 'SELL'} ${pn >= 0 ? '+' : ''}${pn.toFixed(1)}p`; }
      if (rp.done.length) m += ` · ${rp.done.length} trades ${w}W ${tot >= 0 ? '+' : ''}${tot.toFixed(1)}p`;
    }
  }
  rpEl('rpMsg').textContent = m;
  rpEl('rpPlay').title = rp.playing ? 'Pause' : 'Play';
  rpEl('rpPlay').innerHTML = rp.playing ? '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14M16 5v14"/></svg>' : '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5v15l12-7.5z"/></svg>';
  rpEl('rpSpd').textContent = RP_SPEEDS[rp.spd][1];
  rpEl('rpTf').textContent = CANDLE_HIST_LBL[candleHistTf];
  rpEl('rpQty').textContent = rp.qty;
  rpEl('rpClose').disabled = !rp.pos;
  rpEl('rpTw').hidden = !rp.tw;
  rpEl('rpDice').classList.toggle('on', rp.pick);
}
function candleRpMode(on) { // replay plein écran façon TradingView : plus de barre du haut (Fibo/Sweep/F+S), ni de barre du bas (périodes), ni d'échelle de prix à droite
  const body = document.getElementById('candleBody');
  if (body) body.classList.toggle('rp-mode', !!on);
  CANDLE_G.AX = on || candleClean ? 0 : 60;
}
function candleRpSync() { // le panneau n'apparaît que sur la paire en replay ; en changeant de paire, la lecture se met en pause
  const p = rpEl('candleRp');
  if (!p) return;
  const here = rp.on && candleCurId() === rp.id;
  if (rp.on && !here) candleRpPlay(false);
  p.hidden = !here;
  candleRpMode(here);
  const b = rpEl('candleRpBtn');
  if (b) b.classList.toggle('on', rp.on);
  if (here) candleRpUi();
}
function candleRpExit() {
  const id = rp.id;
  candleRpPlay(false);
  rp.on = false; rp.pick = false; rp.pos = null; rp.done = []; rp.msg = ''; rp.view = null; rp.vkey = '';
  const p = rpEl('candleRp');
  if (p) p.hidden = true;
  candleRpMode(false);
  const b = rpEl('candleRpBtn');
  if (b) b.classList.remove('on');
  if (id) candleRedraw(id, candleViewOf(id));
}
function candleRpEnter() {
  const id = candleCurId();
  if (!id) return;
  if (rp.on) { candleRpExit(); return; } // 2e appui sur le bouton : on quitte
  if (candleHistTf === '0') rpEl('candleHistNext').click(); // le replay a besoin des bougies : 1m par défaut
  Object.assign(rp, { on: true, id, pick: true, playing: false, pos: null, done: [], msg: '', view: null, vkey: '' });
  candleHistEnsure(id);
  if (candleHistTf !== '60') candleHistEnsure(id, '60'); // barres 1h : historique long pour D3..D0 et POH quand le replay démarre loin dans le passé
  candleRpSync();
  const tw = rpEl('rpTw'); // widget Sell / Buy : recentré en bas à chaque nouveau replay
  if (tw) { tw.style.top = 'auto'; tw.style.bottom = ''; tw.style.left = Math.max(0, (innerWidth - tw.offsetWidth) / 2) + 'px'; }
  candleRpRedraw();
}
function candleRpSet(idx) { // place le curseur du replay sur la barre idx (les barres suivantes sont masquées)
  const full = rpFull();
  if (!full) return;
  rp.t = full[Math.max(0, Math.min(full.length - 1, idx))][0];
  rp.pick = false; rp.msg = ''; rp.pos = null;
  candleRpUi(); candleRpRedraw();
}
function candleRpIdxAt(id, px) { // abscisse -> index de barre (même géométrie que candleSvg)
  const full = rpFull(id);
  if (!full) return -1;
  const { W } = candleDims(), { AX, LEFT } = CANDLE_G, vw = candleViewOf(id);
  const nCs = ((candleDaily || {})[id] || []).slice(-4).length + 1 + CANDLE_SLOTS.length;
  const plotW0 = W - AX - LEFT, stepB = plotW0 * 0.5 / nCs, xOff = vw.xp * (W - AX) + 0.5 * plotW0 * vw.xz, edge = LEFT + xOff - stepB * 0.5 * vw.xz;
  const hs0 = stepB / 3 * vw.xz, sg = Math.max(1, Math.floor(1.2 / hs0)), hs = hs0 * sg, j = Math.round((edge - px) / hs - 0.5);
  return j < 0 ? -1 : Math.max(0, full.length - 1 - j * sg);
}
function candleRpCheck(b) { // SL / TP touchés par la nouvelle barre (si les deux : SL d'abord, prudent)
  const p = rp.pos;
  if (!p) return;
  let ex = null, why = '';
  if (p.side > 0) { if (p.sl && b[3] <= p.sl) { ex = p.sl; why = 'SL'; } else if (p.tp && b[2] >= p.tp) { ex = p.tp; why = 'TP'; } }
  else if (p.sl && b[2] >= p.sl) { ex = p.sl; why = 'SL'; } else if (p.tp && b[3] <= p.tp) { ex = p.tp; why = 'TP'; }
  if (ex !== null) candleRpClosePos(ex, why);
}
function candleRpClosePos(px, why) {
  const p = rp.pos;
  if (!p) return;
  const pips = (px - p.px) * p.side / rpPip(rp.id) * (p.qty || 1);
  rp.done.push({ side: p.side, px: p.px, exit: px, pips, why });
  rp.pos = null;
  rp.msg = `${why} · ${pips >= 0 ? '+' : ''}${pips.toFixed(1)}p`;
  setTimeout(() => { rp.msg = ''; candleRpUi(); }, 2500);
}
function candleRpStep(d) {
  const full = rpFull();
  if (!full || rp.pick) return false;
  const n = candleRpCount(full), nn = n + d;
  if (nn > full.length) { rp.msg = 'End of data'; candleRpUi(); setTimeout(() => { rp.msg = ''; candleRpUi(); }, 2000); return false; }
  if (nn < 1) return false;
  rp.t = full[nn - 1][0];
  if (d > 0) candleRpCheck(full[nn - 1]);
  candleRpUi(); candleRpRedraw();
  return true;
}
function candleRpPlay(on) {
  clearTimeout(rp.timer);
  rp.playing = !!on && rp.on && !rp.pick;
  if (rp.playing) {
    const loop = () => {
      if (!rp.playing) return;
      if (!candleRpStep(1)) { rp.playing = false; candleRpUi(); return; }
      rp.timer = setTimeout(loop, RP_SPEEDS[rp.spd][0]);
    };
    loop();
  }
  if (rpEl('rpPlay')) candleRpUi();
}
function candleRpOpen(side) { // achat / vente au prix de la dernière barre
  const full = rpFull();
  if (!full || rp.pick) return;
  const px = full[candleRpCount(full) - 1][4];
  if (rp.pos) { const same = rp.pos.side === side; candleRpClosePos(px, 'Closed'); if (same) { candleRpUi(); candleRpRedraw(); return; } } // sens opposé : ferme (comme TradingView, position nette)
  const pip = rpPip(rp.id), sl = rp.slp, tp = rp.tpp;
  rp.pos = { side, qty: rp.qty, px, sl: sl > 0 ? px - side * sl * pip : 0, tp: tp > 0 ? px + side * tp * pip : 0 };
  candleRpUi(); candleRpRedraw();
}
function rpMenuClose() { const m = rpEl('rpMenu'); if (m) { m.hidden = true; m.innerHTML = ''; } }
function rpMenu(title, rows) { // petit menu au-dessus de la barre : rows = [{ t, on, fn }]
  const m = rpEl('rpMenu');
  m.innerHTML = title ? `<div class="rp-mt">${title}</div>` : '';
  for (const r of rows) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rp-mi' + (r.on ? ' on' : ''); b.textContent = r.t;
    if (r.d) { const sp = document.createElement('span'); sp.className = 'rp-d'; sp.textContent = r.d; b.appendChild(sp); }
    b.addEventListener('click', () => { rpMenuClose(); r.fn(); });
    m.appendChild(b);
  }
  m.hidden = false;
  return m;
}
function rpMenuRow(m, label, input) { const d = document.createElement('div'); d.className = 'rp-mr'; const l = document.createElement('span'); l.textContent = label; d.append(l, input); m.appendChild(d); }
function rpSetTf(tf) { // période du replay : mêmes boutons cachés ‹ › que le graphique (la position du replay est conservée)
  const modes = CANDLE_HIST_MODES, i = modes.indexOf(candleHistTf), j = modes.indexOf(tf);
  if (j < 1 || j === i) return;
  for (let k = 0; k < Math.abs(j - i); k++) rpEl(j > i ? 'candleHistNext' : 'candleHistPrev').click();
  candleRpUi();
}
(function candleRpInit() {
  const panel = rpEl('candleRp'), list = rpEl('candleList');
  if (!panel || !list) return;
  const flash = (t) => { rp.msg = t; candleRpUi(); setTimeout(() => { rp.msg = ''; candleRpUi(); }, 2000); };
  rpEl('candleRpBtn').addEventListener('click', candleRpEnter);
  rpEl('rpExit').addEventListener('click', candleRpExit);
  rpEl('rpPlay').addEventListener('click', () => { rpMenuClose(); if (!rp.pick) candleRpPlay(!rp.playing); });
  rpEl('rpFwd').addEventListener('click', () => { rpMenuClose(); candleRpPlay(false); candleRpStep(1); });
  rpEl('rpEnd').addEventListener('click', () => { rpMenuClose(); const full = rpFull(); if (!full) return; candleRpPlay(false); candleRpSet(full.length - 1); });
  const dt = rpEl('rpDate');
  rpEl('rpDice').addEventListener('click', () => rpMenu('Sélectionnez le point de départ', [
    { t: 'Barre', fn: () => { candleRpPlay(false); rp.pick = true; rp.msg = ''; rp.pos = null; candleRpUi(); candleRpRedraw(); } },
    { t: 'Date…', fn: () => { try { dt.showPicker(); } catch (e) { dt.click(); } } },
    { t: 'Première date disponible', fn: () => { candleRpPlay(false); candleRpSet(0); } },
    { t: 'Barre aléatoire', fn: () => { const full = rpFull(); if (!full) return; candleRpPlay(false); candleRpSet(full.length > 400 ? 100 + Math.floor(Math.random() * (full.length - 300)) : Math.floor(full.length / 2)); } },
  ]));
  rpEl('rpSpd').addEventListener('click', () => rpMenu('Vitesse du replay', RP_SPEEDS.map(([, l, d], i) => ({ t: l, d, on: i === rp.spd, fn: () => { rp.spd = i; try { localStorage.setItem('candleRpSpd3', String(i)); } catch (e) { /* pas de stockage */ } candleRpUi(); } }))));
  rpEl('rpTf').addEventListener('click', () => rpMenu("Mettre à jour l'intervalle", CANDLE_HIST_MODES.filter((m) => m !== '0').map((m) => ({ t: ({ 1: '1 minute', 5: '5 minutes', 60: '1 heure', 240: '4 heures', '1D': '1 jour' })[m], on: m === candleHistTf, fn: () => rpSetTf(m) }))));
  rpEl('rpQty').addEventListener('click', () => rpMenu('Quantity (lots)', [0.1, 0.5, 1, 2, 5, 10].map((q) => ({ t: String(q), on: q === rp.qty, fn: () => { rp.qty = q; candleRpUi(); } }))));
  rpEl('rpSet').addEventListener('click', () => {
    const m = rpMenu('Replay settings', [
      { t: 'Trading widget', on: rp.tw, fn: () => { rp.tw = !rp.tw; candleRpUi(); } },
    ]);
    for (const [lbl, key] of [['Stop loss (pips)', 'slp'], ['Take profit (pips)', 'tpp']]) {
      const i = document.createElement('input'); i.type = 'number'; i.min = '0'; i.inputMode = 'decimal'; i.placeholder = 'none'; i.value = rp[key] || '';
      i.addEventListener('input', () => { rp[key] = Math.max(0, parseFloat(i.value) || 0); });
      rpMenuRow(m, lbl, i);
    }
  });
  document.addEventListener('pointerdown', (e) => { const m = rpEl('rpMenu'); if (m && !m.hidden && !m.contains(e.target) && !e.target.closest('.rp-bar, .rp-tw')) rpMenuClose(); }, true);
  dt.addEventListener('change', () => {
    const full = rpFull(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dt.value);
    if (!full || !m) return;
    const t0 = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 + 36000; // minuit UTC-10
    let a = 0, b = full.length;
    while (a < b) { const mid = (a + b) >> 1; if (full[mid][0] < t0) a = mid + 1; else b = mid; }
    candleRpPlay(false);
    if (a >= full.length) { flash('No data after that date'); return; }
    candleRpSet(a);
  });
  rpEl('rpBuy').addEventListener('click', () => candleRpOpen(1));
  rpEl('rpSell').addEventListener('click', () => candleRpOpen(-1));
  rpEl('rpClose').addEventListener('click', () => { const full = rpFull(); if (full && rp.pos) { candleRpClosePos(full[candleRpCount(full) - 1][4], 'Closed'); candleRpUi(); candleRpRedraw(); } });
  // widget Sell / quantité / Buy : déplaçable par la poignée
  const tw = rpEl('rpTw'), grip = rpEl('rpGrip');
  try { const q = JSON.parse(localStorage.getItem('candleRpTw') || 'null'); if (q) { tw.style.left = q.x + 'px'; tw.style.top = q.y + 'px'; tw.style.bottom = 'auto'; } } catch (e) { /* pas de stockage */ }
  let gd = null;
  grip.addEventListener('pointerdown', (e) => { const r = tw.getBoundingClientRect(); gd = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }; try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ } e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (!gd) return; const x = Math.min(innerWidth - gd.w, Math.max(0, e.clientX - gd.dx)), y = Math.min(innerHeight - gd.h - 60, Math.max(40, e.clientY - gd.dy)); tw.style.left = x + 'px'; tw.style.top = y + 'px'; tw.style.bottom = 'auto'; });
  const gEnd = () => { if (!gd) return; gd = null; try { localStorage.setItem('candleRpTw', JSON.stringify({ x: parseFloat(tw.style.left), y: parseFloat(tw.style.top) })); } catch (e) { /* pas de stockage */ } };
  grip.addEventListener('pointerup', gEnd); grip.addEventListener('pointercancel', gEnd);
  list.addEventListener('click', (e) => { // choix de la barre de départ (capture : avant le clic des pastilles de news)
    if (!rp.on || !rp.pick || Date.now() < cg.swallow) return;
    const ch = e.target.closest('.cd-chart');
    if (!ch || ch.dataset.pair !== rp.id) return;
    e.stopPropagation();
    const i = candleRpIdxAt(rp.id, e.clientX - ch.getBoundingClientRect().left);
    if (i >= 0) candleRpSet(i);
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) candleRpPlay(false); });
  ['candleClose', 'candleToggle'].forEach((i) => rpEl(i)?.addEventListener('click', () => { if (rp.on) candleRpExit(); }));
})();

// ===== LIGNES D'ALERTE DE PRIX sur CANDLE : appui long sur le graphique = créer, toucher l'étiquette bleue = supprimer ; surveillées par le serveur (api/alerte), notification téléphone =====
function candleXhSvg(c, W, H, AX, TOP, BOT, lo, rng, fmt, tm) { // croix en pointillé blanc + étiquette de prix avec ⊕ (axe de droite) + date/heure (axe du bas)
  const xr = W - AX, x = Math.min(xr, Math.max(0, c.x)), yy = Math.min(H - BOT, Math.max(TOP, c.y)), px = lo + (1 - (yy - TOP) / (H - TOP - BOT)) * rng, ln = 'stroke="#d1d4dc" stroke-opacity=".75" stroke-width="1" stroke-dasharray="4 4"';
  let o = `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${H - BOT}" ${ln}/><line x1="0" x2="${xr}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" ${ln}/>` +
    `<rect x="${xr - 28}" y="${(yy - 11).toFixed(1)}" width="${AX + 27}" height="22" rx="3" fill="#2a2e39"/>` +
    `<circle cx="${xr - 15}" cy="${yy.toFixed(1)}" r="9.5" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M${xr - 20} ${yy.toFixed(1)}h10M${xr - 15} ${(yy - 5).toFixed(1)}v10" stroke="#fff" stroke-width="1.4"/>` +
    `<text x="${xr + 6}" y="${(yy + 4).toFixed(1)}" class="pc-ax" style="fill:#fff;font-size:11px">${fmt(px)}</text>`;
  if (tm) { const w = tm.length * 6.4 + 14, tx = Math.min(xr - w, Math.max(0, x - w / 2)); o += `<rect x="${tx.toFixed(1)}" y="${H - 21}" width="${w.toFixed(1)}" height="19" rx="3" fill="#2a2e39"/><text x="${(tx + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" style="fill:#fff;font-size:11px;pointer-events:none">${tm}</text>`; }
  return o;
}
function candleAlSvg(id, y, xr, lo, hi, fmt) { // lignes bleues pointillées + étiquette (sens et prix) ; zones cliquables gardées pour la suppression
  candleAlHits[id] = [];
  if (!id) return '';
  let s = '';
  for (const a of candleAl) {
    const price = candleAlDrag && candleAlDrag.aid === a.id ? candleAlDrag.price : a.price;
    if (a.pair !== id || price < lo || price > hi) continue;
    const yy = y(price), w = 118, x0 = xr - w - 6;
    s += `<line x1="0" x2="${xr}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#2f7bff" stroke-width="1" stroke-dasharray="6 4"/>` +
      `<rect x="${x0}" y="${(yy - 10).toFixed(1)}" width="${w}" height="20" rx="4" fill="#2f7bff"/>` +
      `<rect x="${x0 + w - 26}" y="${(yy - 10).toFixed(1)}" width="26" height="20" rx="4" fill="#1b4cc4"/>` +
      `<text x="${x0 + 8}" y="${(yy + 4).toFixed(1)}" style="fill:#fff;font-size:11px;font-weight:700">${(candleAlDrag && candleAlDrag.aid === a.id ? candleAlDrag.price >= (candleLastPx(id) ?? 0) : a.dir === 'above') ? '▲' : '▼'} ${fmt(price)}</text>` +
      `<text x="${x0 + w - 13}" y="${(yy + 4).toFixed(1)}" text-anchor="middle" style="fill:#fff;font-size:12px;font-weight:700">✕</text>`;
    candleAlHits[id].push({ x: x0, y: yy - 10, w, h: 20, yc: yy, xr, aid: a.id });
  }
  if (candlePrev && candlePrev.id === id && candlePrev.price >= lo && candlePrev.price <= hi) { // aperçu du niveau en cours de création
    const yy = y(candlePrev.price), w = 96, x0 = xr - w - 6;
    s += `<line x1="0" x2="${xr}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#2f7bff" stroke-width="1" stroke-dasharray="3 4" stroke-opacity=".9"/>` +
      `<rect x="${x0}" y="${(yy - 10).toFixed(1)}" width="${w}" height="20" rx="4" fill="#2f7bff" fill-opacity=".85"/>` +
      `<text x="${x0 + 8}" y="${(yy + 4).toFixed(1)}" style="fill:#fff;font-size:11px;font-weight:700">+ ${fmt(candlePrev.price)}</text>`;
  }
  return s;
}
function candlePriceAt(id, yPx) { // ordonnée (pixels du graphique) -> prix
  const g = candleGeo(id), v = candleViewOf(id), rngV = g.baseRng / v.yz, lo = g.cenB + v.yp * g.baseRng - rngV / 2;
  return lo + (1 - (yPx - CANDLE_G.TOP) / g.plotH) * rngV;
}
function candleLastPx(id) { // dernier prix connu de la paire
  const h = candleHistData[id + '|' + candleHistTf];
  if (h && h.bars.length) return h.bars[h.bars.length - 1][4];
  const day = candleDays[id];
  if (!day) return null;
  for (let i = CANDLE_SLOTS.length - 1; i >= 0; i--) { const c = day.c[CANDLE_SLOTS[i][0]]; if (c) return c[3]; }
  return null;
}
async function candleAlFetch() {
  candleAlAt = Date.now();
  try {
    const r = await fetch(`${ALERTE_API}/alerte?lines=1`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const j = r.ok ? await r.json() : null;
    if (j && Array.isArray(j.lines)) { candleAl = j.lines; candleAlRedraw(); candleAlFilterSync(); }
  } catch (e) { /* on garde la liste actuelle */ }
}
function candleAlFilterSync() { // la liste des lignes a changé : compteur « Alerts » à jour, et si le filtre est actif, paires retirées/ajoutées
  if (!candlePoh) return;
  candleFilterUpdate();
  if (!candleF.alert || candleMini) return;
  const want = CORR_ALL_PAIRS.filter((p) => candlePoh[p.id] && candleHasAlert(p.id)).map((p) => p.id).sort().join(), have = [...candleSlides()].map((r) => r.dataset.id).sort().join();
  if (want !== have) candleRender();
}
function candleAlRedraw() { const id = candleCurId(); if (id && !(rp.on && rp.id === id)) candleRedraw(id, candleViewOf(id)); }
async function candleAlPost(body) {
  const r = await fetch(`${ALERTE_API}/alerte`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Server error');
  if (Array.isArray(j.lines)) candleAl = j.lines;
  candleAlAt = Date.now();
  candleAlRedraw();
  candleAlFilterSync();
}
function candleAlClose() { document.getElementById('candleAlSheet')?.remove(); if (candlePrev) { candlePrev = null; candleAlRedraw(); } }
function candleAlSheet(title, sub, price, okLabel, onOk, withExpiry) { // petite fiche en bas : prix modifiable + Annuler / OK
  candleAlClose();
  const body = document.getElementById('candleBody');
  if (!body) return;
  const wrap = document.createElement('div');
  wrap.id = 'candleAlSheet';
  wrap.innerHTML = `<div class="ce-scrim"></div><div class="ca-sheet" role="dialog"><div class="ca-t"></div><div class="ca-d"></div>${price === null ? '' : '<input class="ca-px" type="number" step="any" inputmode="decimal">'}${withExpiry ? '<select class="ca-exp" aria-label="Expiration"><option value="0">Never expires</option><option value="86400">Expires in 1 day</option><option value="604800">Expires in 1 week</option><option value="2592000">Expires in 1 month</option></select>' : ''}<div class="ca-err" hidden></div><div class="ca-b"><button type="button" class="no">Cancel</button><button type="button" class="ok"></button></div></div>`;
  wrap.querySelector('.ca-t').textContent = title;
  wrap.querySelector('.ca-d').textContent = sub;
  const inp = wrap.querySelector('.ca-px'), ok = wrap.querySelector('.ok'), err = wrap.querySelector('.ca-err');
  if (inp) inp.value = price;
  ok.textContent = okLabel;
  body.appendChild(wrap);
  const born = Date.now(); // au toucher, le « clic » qui suit le relâchement (⊕ ou ✕ sous le doigt) tombe sur la fiche toute neuve : on ignore les clics des 700 premières ms (sinon elle se refermait aussitôt)
  wrap.querySelector('.ce-scrim').addEventListener('click', () => { if (Date.now() - born > 700) candleAlClose(); });
  wrap.querySelector('.no').addEventListener('click', () => { if (Date.now() - born > 700) candleAlClose(); });
  ok.addEventListener('click', async () => {
    if (Date.now() - born < 700) return;
    ok.disabled = true;
    try { await onOk(inp ? parseFloat(inp.value) : null, wrap.querySelector('.ca-exp')?.value); candleAlClose(); } catch (e) { err.textContent = e.message || 'Error'; err.hidden = false; ok.disabled = false; }
  });
}
async function candleLiveLast(id) { // dernier prix 1 min en direct (le dernier prix « POH » peut dater de plusieurs heures) ; repli : dernier prix connu
  try {
    const r = await fetch(`https://ariinuiirgina.vercel.app/api/poh-candles?pair=${id}&tf=1&since=${Math.floor(Date.now() / 1000) - 900}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    const j = r.ok ? await r.json() : null;
    if (j && j.bars && j.bars.length) return j.bars[j.bars.length - 1][4];
  } catch (e) { /* repli */ }
  return candleLastPx(id);
}
function candleAlCreate(id, price) {
  const label = (CORR_ALL_PAIRS.find((p) => p.id === id) || { label: id }).label, dec = price >= 1000 ? 2 : price >= 100 ? 3 : 5;
  candleAlSheet(`Price alert · ${label}`, 'You will be notified (sound) when the price touches this level.', +price.toFixed(dec), 'Create alert', async (px, exp) => {
    if (!(px > 0)) throw new Error('Enter a valid price');
    const last = await candleLiveLast(id);
    await candleAlPost({ line: { pair: id, price: px, dir: last === null || px >= last ? 'above' : 'below', ttl: Number(exp) || 0 } });
  }, true);
  candlePrev = { id, price: +price }; // la ligne reste visible pendant que la fiche est ouverte, et suit le prix saisi
  candleAlRedraw();
  document.querySelector('#candleAlSheet input')?.addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v > 0 && candlePrev) { candlePrev.price = v; candleAlRedraw(); } });
}
(function candleAlInit() {
  const list = document.getElementById('candleList');
  if (!list) return;
  let lp = null, xhDown = null; // xhDown : doigt posé alors que le réticule est affiché
  const cancel = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
  list.addEventListener('pointerdown', (e) => {
    cancel();
    const ch = e.target.closest('.cd-chart');
    if (!ch || (rp.on && rp.id === ch.dataset.pair) || (e.pointerType === 'mouse' && e.button !== 0) || cg.pts.size > 1) return;
    const rc = ch.getBoundingClientRect(), id = ch.dataset.pair, x0 = e.clientX, y0 = e.clientY;
    lp = { x: x0, y: y0, timer: setTimeout(() => { // appui long immobile : création d'une alerte au prix touché
      lp = null;
      if (cg.pts.size !== 1 || Math.hypot(cg.pts.values().next().value.x - x0, cg.pts.values().next().value.y - y0) > 10) return;
      cg.swallow = Date.now() + 900;
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch (err) { /* ignoré */ } }
      candleXh = { id, x: x0 - rc.left, y: y0 - rc.top };
      xhDown = { pid: cg.pts.keys().next().value, moved: true, x: x0, y: y0, rc, id };
      cg.mode = 'cross';
      candleRedraw(id, candleViewOf(id));
    }, 520) };
  });
  const near = (id, px, py) => (candleAlHits[id] || []).find((h) => py >= h.yc - 14 && py <= h.yc + 14 && px >= 0 && px <= h.xr && !(px >= h.x + h.w - 26 - 6 && py >= h.y - 4 && py <= h.y + h.h + 4)); // ligne ou étiquette (hors bouton ✕)
  list.addEventListener('pointerdown', (e) => { // toucher une ligne d'alerte : on la déplace au doigt (le graphique ne bouge pas)
    const ch = e.target.closest('.cd-chart');
    if (!ch || (rp.on && rp.id === ch.dataset.pair) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (cg.pts.size > 1) { candleAlDrag = null; return; }
    const rc = ch.getBoundingClientRect(), hit = near(ch.dataset.pair, e.clientX - rc.left, e.clientY - rc.top), a = hit && candleAl.find((x) => x.id === hit.aid);
    if (!a) return;
    cancel();
    cg.mode = 'alert';
    candleAlDrag = { aid: a.id, price: a.price, moved: false, y0: e.clientY, id: ch.dataset.pair, rc };
  });
  list.addEventListener('pointerdown', (e) => { // réticule déjà affiché : toucher le ⊕ = créer l'alerte ; glisser = déplacer le réticule ; simple tap ailleurs = le masquer
    const ch = e.target.closest('.cd-chart');
    if (!candleXh || !ch || candleAlDrag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (cg.pts.size > 1 || candleXh.id !== ch.dataset.pair) { candleXh = null; xhDown = null; candleRedraw(ch.dataset.pair, candleViewOf(ch.dataset.pair)); return; } // 2 doigts (zoom) ou autre paire : réticule retiré
    cancel();
    const rc = ch.getBoundingClientRect();
    cg.mode = 'cross';
    cg.swallow = Date.now() + 700;
    xhDown = { pid: e.pointerId, moved: false, x: e.clientX, y: e.clientY, rc, id: ch.dataset.pair };
  });
  list.addEventListener('pointermove', (e) => {
    if (xhDown && candleXh && e.pointerId === xhDown.pid && !candleAlDrag) {
      if (!xhDown.moved && Math.hypot(e.clientX - xhDown.x, e.clientY - xhDown.y) < 8) return;
      xhDown.moved = true;
      candleXh.x = e.clientX - xhDown.rc.left; candleXh.y = e.clientY - xhDown.rc.top;
      candleRedraw(xhDown.id, candleViewOf(xhDown.id));
      return;
    }
    if (candleAlDrag) {
      const d = candleAlDrag;
      if (!d.moved && Math.abs(e.clientY - d.y0) < 4) return;
      d.moved = true;
      d.price = candlePriceAt(d.id, e.clientY - d.rc.top);
      candleRedraw(d.id, candleViewOf(d.id));
      return;
    }
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancel();
  });
  const dragEnd = async (e) => {
    cancel();
    const d = candleAlDrag;
    if (!d) return;
    candleAlDrag = null;
    if (e.type === 'pointercancel' || !d.moved) { candleRedraw(d.id, candleViewOf(d.id)); return; }
    cg.swallow = Date.now() + 600;
    const last = await candleLiveLast(d.id), dec = d.price >= 1000 ? 2 : d.price >= 100 ? 3 : 5, price = +d.price.toFixed(dec);
    try { await candleAlPost({ lineMove: { id: d.aid, price, dir: last === null || price >= last ? 'above' : 'below' } }); } catch (err) { candleRedraw(d.id, candleViewOf(d.id)); candleAlFetch(); }
  };
  const xhEnd = (e) => {
    const d = xhDown;
    if (!d || e.pointerId !== d.pid) return;
    xhDown = null;
    if (e.type === 'pointercancel' || !candleXh || d.moved) return; // glissé : le réticule reste où il est
    const xr = candleDims().W - CANDLE_G.AX, rx = d.x - d.rc.left, ry = d.y - d.rc.top;
    if (rx >= xr - 32 && Math.abs(ry - candleXh.y) <= 16) { // ⊕ : alerte au prix du réticule
      const id = d.id, price = candlePriceAt(id, candleXh.y);
      candleXh = null; candleRedraw(id, candleViewOf(id));
      candleAlCreate(id, price);
    } else { candleXh = null; candleRedraw(d.id, candleViewOf(d.id)); }
  };
  list.addEventListener('pointerup', xhEnd);
  list.addEventListener('pointercancel', xhEnd);
  list.addEventListener('pointerup', dragEnd);
  list.addEventListener('pointercancel', dragEnd);
  window.addEventListener('pointerup', dragEnd); // filet : si le graphique est redessiné pendant le geste, le relâchement est quand même pris en compte
  window.addEventListener('pointercancel', dragEnd);
  list.addEventListener('click', (e) => { // toucher l'étiquette bleue = supprimer l'alerte
    if (Date.now() < cg.swallow) return;
    const ch = e.target.closest('.cd-chart');
    if (!ch || (rp.on && rp.id === ch.dataset.pair)) return;
    const rc = ch.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top;
    const hit = (candleAlHits[ch.dataset.pair] || []).find((h) => px >= h.x + h.w - 26 - 6 && px <= h.x + h.w + 6 && py >= h.y - 6 && py <= h.y + h.h + 6); // seulement le bouton ✕
    const a = hit && candleAl.find((x) => x.id === hit.aid);
    if (a) candleAlSheet(`Alert · ${a.pair.slice(0, 3)}/${a.pair.slice(3)}`, `${a.dir === 'above' ? 'Rises to' : 'Falls to'} ${a.price}`, null, 'Delete alert', () => candleAlPost({ lineDelete: a.id }));
  });
})();
