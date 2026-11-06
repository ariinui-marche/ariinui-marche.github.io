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
  grid.innerHTML = data.currencies.filter((c) => inFocus(c.id)).map((c) => {
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
  grid.innerHTML = data.currencies.filter((c) => inFocus(c.id)).map((c) => {
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

// Dimensions réelles de la zone graphique (plein écran) : le SVG est dessiné à l'échelle 1:1, sans déformation
function candleDims() {
  return { W: Math.max(300, Math.round(window.innerWidth)), H: Math.max(300, Math.round(window.innerHeight) - 90) };
}
function candleNiceStep(rng, n) {
  const raw = rng / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
// Échelle de prix : calée sur les 9 POH (priorité d'affichage), journalières coupées sur les bords
function candleScale(dly, day) {
  const dd = (dly || []).slice(-4), poh = Object.values((day && day.c) || {}); // POH : [o, h, l, c] ; daily : [t, o, h, l, c]
  const base = poh.length ? poh : dd.map((b) => b.slice(1, 5));
  if (!base.length) return null;
  let hi = Math.max(...base.map((c) => c[1])), lo = Math.min(...base.map((c) => c[2]));
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
const CANDLE_G = { AX: 60, TOP: 44, BOT: 14, LEFT: 4 }; // géométrie du graphique (aussi utilisée par les gestes)
function candleSvg(day, dly, view) {
  const dd = (dly || []).slice(-4).map((b, i, a) => ({ lbl: 'D' + (a.length - 1 - i), c: b.slice(1, 5) }));
  const cs = dd.concat([{ lbl: '', c: null }], CANDLE_SLOTS.map(([k, lbl]) => ({ lbl, c: day.c[k] })));
  const vals = cs.filter((x) => x.c);
  if (!vals.length) return '';
  const { W, H } = candleDims();
  const { AX, TOP, BOT, LEFT } = CANDLE_G;
  const sc = candleScale(dly, day), vw = view || CANDLE_DEF;
  const baseRng = sc.hi - sc.lo, cenV = (sc.hi + sc.lo) / 2 + vw.yp * baseRng, rng = baseRng / vw.yz;
  const lo = cenV - rng / 2, hi = cenV + rng / 2; // fenêtre de prix affichée (zoom vertical + décalage)
  const y = (v) => TOP + (1 - (v - lo) / rng) * (H - TOP - BOT);
  const dec = hi >= 1000 ? 2 : hi >= 100 ? 3 : 5;
  const fmt = (v) => v.toFixed(dec);
  const stepP = candleNiceStep(rng, 8);
  let grid = '';
  for (let v = Math.ceil(lo / stepP) * stepP; v <= hi; v += stepP) {
    grid += `<line x1="0" x2="${W - AX}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#1d1f24" stroke-width="1"/>` +
      `<text x="${W - AX + 6}" y="${(y(v) + 4).toFixed(1)}" class="pc-ax">${fmt(v)}</text>`;
  }
  const step = (W - AX - LEFT) / cs.length * vw.xz, xOff = vw.xp * (W - AX), bw = Math.min(step * 0.74, 120); // zoom horizontal + décalage
  const last = [...cs].reverse().find((x) => x.c);
  const lastC = last.c[3], lastCol = last.c[3] >= last.c[0] ? '#26a69a' : '#ef5350';
  const body = cs.map((x, i) => {
    const cx = LEFT + xOff + step * (i + 0.5);
    if (!x.c) return '';
    const [o, h, l, c] = x.c;
    const col = c >= o ? '#26a69a' : '#ef5350';
    const top = y(Math.max(o, c)), ht = Math.max(1, Math.abs(y(o) - y(c)));
    const vis = h >= lo && l <= hi; // la bougie touche la zone affichée
    return (vis ? `<text x="${cx.toFixed(1)}" y="${Math.min(H - 6, Math.max(14, y(h) - 6)).toFixed(1)}" text-anchor="middle" class="pc-lbl" style="fill:${col}">${x.lbl}</text>` : '') +
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(h).toFixed(1)}" y2="${y(l).toFixed(1)}" stroke="${col}" stroke-width="1.3"/>` +
      `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${ht.toFixed(1)}" fill="${c >= o ? '#0b0b0b' : col}" stroke="${col}" stroke-width="1.3"/>`;
  }).join('');
  let fib = '';
  const fl = candleFibLevels(dly), d1i = cs.findIndex((x) => x.lbl === 'D1');
  if (fl && d1i >= 0) {
    const x0 = LEFT + xOff + step * (d1i + 0.5);
    fib = fl.filter((f) => f.v >= lo && f.v <= hi).map((f) => `<line x1="${x0.toFixed(1)}" x2="${W - AX}" y1="${y(f.v).toFixed(1)}" y2="${y(f.v).toFixed(1)}" stroke="#f5b642" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="1 4" stroke-linecap="round"/>` +
      `<text x="${W - AX - 4}" y="${(y(f.v) - 4).toFixed(1)}" text-anchor="end" style="fill:#f5b642;fill-opacity:.6;font-size:10px">${f.t}% · ${fmt(f.v)}</text>`).join('');
  }
  const yl = Math.min(H - BOT, Math.max(TOP - 20, y(lastC))); // l'étiquette du dernier prix reste visible sur le bord
  // PDH / PDL : plus haut / plus bas de D1, comme Arii SNIPER (jaune #F5B700 opacité 0,85, pointillé 1 px, étiquette à droite), depuis le début de D0
  let pd = '';
  const pdD1 = cs.find((x) => x.lbl === 'D1' && x.c), pdD0i = cs.findIndex((x) => x.lbl === 'D0' && x.c);
  if (pdD1) {
    const xs = LEFT + xOff + step * (pdD0i >= 0 ? pdD0i : cs.findIndex((x) => x.lbl === 'D1') + 1);
    for (const [v, t] of [[pdD1.c[1], 'PDH'], [pdD1.c[2], 'PDL']]) {
      if (v < lo || v > hi) continue;
      pd += `<line x1="${xs.toFixed(1)}" x2="${W - AX}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#F5B700" stroke-opacity="0.85" stroke-width="1" stroke-dasharray="1 3"/>` +
        `<text x="${W - AX - 4}" y="${(y(v) - 4).toFixed(1)}" text-anchor="end" style="fill:#F5B700;font-size:10px">${t}</text>`;
    }
  }
  const tag = `<line x1="0" x2="${W - AX}" y1="${yl.toFixed(1)}" y2="${yl.toFixed(1)}" stroke="${lastCol}" stroke-width="1" stroke-dasharray="2 3"/>` +
    `<rect x="${W - AX + 1}" y="${(yl - 10).toFixed(1)}" width="${AX - 2}" height="20" fill="${lastCol}"/>` +
    `<text x="${W - AX + 6}" y="${(yl + 4).toFixed(1)}" class="pc-ax" style="fill:#fff">${fmt(lastC)}</text>`;
  return `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><defs><clipPath id="pcClip"><rect x="0" y="0" width="${W - AX}" height="${H}"/></clipPath></defs>${grid}<g clip-path="url(#pcClip)">${fib}${pd}${body}</g>${tag}</svg>`;
}

// Sweep de la bougie daily précédente (même règle qu'Arii SNIPER) : D0 dépasse le haut de D1 et clôture dessous, ou casse son bas et clôture dessus
function candleSweep(dly, day) {
  const a = (dly || []).slice(-4);
  if (a.length < 2) return '';
  const d1 = a[a.length - 2]; // [t, o, h, l, c]
  // Sur la journée entière : chacune des 9 bougies POH est testée contre D1 (le sweep reste affiché même si le prix repart ensuite de l'autre côté)
  const poh = Object.values((day && day.c) || {}); // [o, h, l, c]
  const hi = poh.some((c) => c[1] > d1[2] && c[3] < d1[2]), lo = poh.some((c) => c[2] < d1[3] && c[3] > d1[3]);
  // bas = bleu, haut = rouge (les deux si D0 a pris les deux côtés)
  return (lo ? '<span class="cd-sweep cd-sweep-lo">Sweep</span>' : '') + (hi ? '<span class="cd-sweep cd-sweep-hi">Sweep</span>' : '');
}
// Boutons Fibo / Sweep : affichent immédiatement les paires concernées (les deux actifs = les deux conditions)
const candleF = { fibo: false, sweep: false, both: false }; // both = Fibo ET Sweep (3e bouton « F+S »)
function candleInfo(id) {
  const dly = (candleDaily || {})[id], a = (dly || []).slice(-4);
  const days = ((candlePoh || {})[id] || []).filter((d) => Object.keys(d.c).length), day = days[days.length - 1];
  // Fibo = les lignes sont réellement affichées à l'écran (D2 et D1 même sens ET au moins un niveau dans la zone des POH)
  const fl = candleFibLevels(dly), sc = day ? candleScale(dly, day) : null;
  const fibo = !!(fl && sc && fl.some((f) => f.v >= sc.lo && f.v <= sc.hi));
  const sweep = !!(day && candleSweep(dly, day));
  return { fibo, sweep, both: fibo && sweep };
}
function candleFilterUpdate() {
  const ids = CORR_ALL_PAIRS.filter((p) => candlePoh && candlePoh[p.id]).map((p) => p.id);
  const n = { fibo: 0, sweep: 0, both: 0 };
  for (const id of ids) { const i = candleInfo(id); if (i.fibo) n.fibo++; if (i.sweep) n.sweep++; if (i.both) n.both++; }
  document.querySelectorAll('#candleStrip [data-f]').forEach((b) => {
    b.classList.toggle('on', candleF[b.dataset.f]);
    b.textContent = `${{ fibo: 'Fibo', sweep: 'Sweep', both: 'F+S' }[b.dataset.f]} (${n[b.dataset.f]})`;
  });
}
// ===== Zoom / déplacement façon TradingView (pincer à deux doigts, glisser), enregistré par paire =====
const CANDLE_DEF = { yz: 1, yp: 0, xz: 1, xp: 0 }; // zoom prix, décalage prix (fraction de l'échelle de base), zoom bougies, décalage horizontal (fraction de la largeur)
try { localStorage.removeItem('candleAlertsV1'); } catch (e) { /* nettoyage des anciennes alertes (fonction retirée) */ }
const CANDLE_VIEW_LS = 'candleViewV1';
let candleViews = {};
try { candleViews = JSON.parse(localStorage.getItem(CANDLE_VIEW_LS) || '{}') || {}; } catch (e) { candleViews = {}; }
const candleDays = {};
function candleViewOf(id) { return Object.assign({}, CANDLE_DEF, candleViews[id] || {}); }
function candleViewIsDef(v) { return Math.abs(v.yz - 1) < 1e-3 && Math.abs(v.yp) < 1e-3 && Math.abs(v.xz - 1) < 1e-3 && Math.abs(v.xp) < 1e-3; }
function candleViewSave(id, v) {
  if (candleViewIsDef(v)) delete candleViews[id]; else candleViews[id] = v;
  try { localStorage.setItem(CANDLE_VIEW_LS, JSON.stringify(candleViews)); } catch (e) { /* quota */ }
  const rb = document.querySelector(`.cd-reset[data-reset="${id}"]`);
  if (rb) rb.hidden = candleViewIsDef(v);
}
function candleRedraw(id, v) {
  const ch = document.querySelector(`.cd-chart[data-pair="${id}"]`);
  if (ch && candleDays[id]) ch.innerHTML = candleSvg(candleDays[id], (candleDaily || {})[id], v);
}
const cg = { pts: new Map(), id: null, mode: null, v0: null, start: null, cur: null, dx: 0, swallow: 0, moved: false, rect: null };
function candleGeo(id) {
  const { W, H } = candleDims(), { AX, TOP, BOT } = CANDLE_G;
  const sc = candleScale((candleDaily || {})[id], candleDays[id]);
  return { plotW: W - AX, plotH: H - TOP - BOT, baseRng: sc.hi - sc.lo, cenB: (sc.hi + sc.lo) / 2 };
}
function candleBeginGesture(rect) {
  cg.v0 = candleViewOf(cg.id);
  cg.cur = Object.assign({}, cg.v0);
  cg.start = [...cg.pts.values()].map((p) => ({ x: p.x, y: p.y }));
  cg.rect = rect;
}
const candleClamp = (v, a, b) => Math.min(b, Math.max(a, v));
function candleOnMove() {
  const g = candleGeo(cg.id), r = cg.rect, T = CANDLE_G.TOP, pts = [...cg.pts.values()];
  const priceAt = (v, yPx) => {
    const rngV = g.baseRng / v.yz, lo = g.cenB + v.yp * g.baseRng - rngV / 2;
    return lo + (1 - (yPx - T) / g.plotH) * rngV;
  };
  if (pts.length >= 2 && cg.start.length >= 2) { // pincement : horizontal = bougies, vertical = prix, le centre suit les doigts
    cg.mode = 'pinch';
    const [a, b] = pts, [a0, b0] = cg.start;
    const cx0 = (a0.x + b0.x) / 2 - r.left, cy0 = (a0.y + b0.y) / 2 - r.top, cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    const sx = Math.max(Math.abs(a.x - b.x), 40) / Math.max(Math.abs(a0.x - b0.x), 40);
    const sy = Math.max(Math.abs(a.y - b.y), 40) / Math.max(Math.abs(a0.y - b0.y), 40);
    const v = cg.cur, v0 = cg.v0;
    v.xz = candleClamp(v0.xz * sx, 0.3, 10);
    v.xp = (cx - (cx0 - v0.xp * g.plotW) * (v.xz / v0.xz)) / g.plotW;
    v.yz = candleClamp(v0.yz * sy, 0.15, 12);
    const rng2 = g.baseRng / v.yz, lo2 = priceAt(v0, cy0) - (1 - (cy - T) / g.plotH) * rng2;
    v.yp = (lo2 + rng2 / 2 - g.cenB) / g.baseRng;
    cg.moved = true;
  } else if (pts.length === 1 && cg.start.length === 1 && cg.mode !== 'done') {
    const dx = pts[0].x - cg.start[0].x, dy = pts[0].y - cg.start[0].y;
    if (!cg.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      cg.mode = candleViewIsDef(cg.v0) && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'swipe' : 'pan'; // vue standard : glisser à l'horizontale = changer de paire
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
    if (cg.id !== ch.dataset.pair) { cg.pts.clear(); cg.mode = null; }
    cg.id = ch.dataset.pair;
    cg.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { ch.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    if (cg.pts.size === 1) { cg.mode = null; cg.moved = false; cg.dx = 0; }
    candleBeginGesture(ch.getBoundingClientRect()); // repart de la vue actuelle à chaque doigt ajouté
  });
  list.addEventListener('pointermove', (e) => {
    if (!cg.pts.has(e.pointerId) || !cg.id) return;
    cg.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
  list.addEventListener('wheel', (e) => { // souris : molette = zoom prix autour du curseur
    const ch = e.target.closest('.cd-chart');
    if (!ch) return;
    e.preventDefault();
    const id = ch.dataset.pair, g = candleGeo(id), v = candleViewOf(id), T = CANDLE_G.TOP, yPx = e.clientY - ch.getBoundingClientRect().top;
    const rngV = g.baseRng / v.yz, lo = g.cenB + v.yp * g.baseRng - rngV / 2, p0 = lo + (1 - (yPx - T) / g.plotH) * rngV;
    v.yz = candleClamp(v.yz * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.15, 12);
    const rng2 = g.baseRng / v.yz, lo2 = p0 - (1 - (yPx - T) / g.plotH) * rng2;
    v.yp = (lo2 + rng2 / 2 - g.cenB) / g.baseRng;
    candleRedraw(id, v); candleViewSave(id, v);
  }, { passive: false });
})();

function candleRender() {
  const list = document.getElementById('candleList');
  if (!candlePoh) { list.innerHTML = '<div class="charts-intro">POH candles unavailable right now.</div>'; return; }
  const rows = CORR_ALL_PAIRS.filter((p) => candlePoh[p.id] && (!candleF.fibo || candleInfo(p.id).fibo) && (!candleF.sweep || candleInfo(p.id).sweep) && (!candleF.both || candleInfo(p.id).both))
    .map((p) => ({ p, s: chartsCandles ? chartsScore(p.id) : { group: 2, move: 0 } }))
    .sort((x, y) => x.s.group - y.s.group || y.s.move - x.s.move);
  let date = '';
  const keep = candleIndex(), keepId = candleCurId();
  list.innerHTML = rows.map(({ p, s }) => {
    const days = candlePoh[p.id].filter((d) => Object.keys(d.c).length);
    const day = days[days.length - 1];
    if (!day) return '';
    date = day.d;
    candleDays[p.id] = day;
    const cls = s.group === 0 ? 'cd-bull' : s.group === 1 ? 'cd-bear' : '';
    return `<div class="cd-row ${cls}" data-id="${p.id}"><button type="button" class="cd-head"><span class="cd-name">${p.label}</span> <span class="pc-date">${day.d}</span>${candleSweep((candleDaily || {})[p.id], day)}</button><button type="button" class="cd-chart" data-pair="${p.id}" aria-label="${p.label} 1h chart">${candleSvg(day, (candleDaily || {})[p.id], candleViewOf(p.id))}</button><button type="button" class="cd-reset" data-reset="${p.id}" aria-label="Reset zoom"${candleViewIsDef(candleViewOf(p.id)) ? ' hidden' : ''}>\u27f2</button><div class="cd-detail" id="pc-detail-${p.id}"></div></div>`;
  }).join('');
  const ki = keepId ? [...candleSlides()].findIndex((r) => r.dataset.id === keepId) : -1;
  list.scrollLeft = (ki >= 0 ? ki : keep) * list.clientWidth;
  if (!rows.length) list.innerHTML = '<div class="charts-intro">No pair matches.</div>';
  candleFilterUpdate();
  candleNavUpdate();
  if (candleSelected) chartsOpenDetail(candleSelected, '60', 'pc-detail-');
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
function candleNavUpdate() {
  const n = candleSlides().length, i = Math.min(candleIndex(), Math.max(0, n - 1));
  const c = document.getElementById('candleCount');
  if (c) c.textContent = n ? `${i + 1} / ${n}` : '';
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
  let i = [...candleSlides()].findIndex((r) => r.dataset.id === id);
  if (i < 0) { candleF.fibo = false; candleF.sweep = false; candleF.both = false; candleSelected = null; candleRender(); i = [...candleSlides()].findIndex((r) => r.dataset.id === id); } // la paire est masquée par un filtre : on l'enlève
  const l = document.getElementById('candleList');
  if (i >= 0) l.scrollTo({ left: i * l.clientWidth, behavior: 'smooth' });
}
document.getElementById('candleStrip')?.addEventListener('click', (e) => {
  const d = e.target.closest('[data-d]');
  if (!d) return;
  e.stopPropagation();
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
  candleF[b.dataset.f] = !candleF[b.dataset.f];
  if (b.dataset.f === 'both') { candleF.fibo = false; candleF.sweep = false; } else candleF.both = false; // « F+S » remplace Fibo+Sweep ; Fibo ou Sweep seul annule « F+S »
  candleSelected = null;
  if (candlePoh) candleRender();
  document.getElementById('candleList').scrollLeft = 0;
  candleNavUpdate();
});
document.getElementById('candleClose')?.addEventListener('click', () => document.getElementById('candleToggle').click());
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
    const ch = r.querySelector('.cd-chart');
    if (ch) ch.innerHTML = candleSvg(day, (candleDaily || {})[id], candleViewOf(id));
    const hd = r.querySelector('.cd-head');
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
  if (!expanded) candleLoad();
});

document.getElementById('candleList').addEventListener('click', (e) => {
  const rs = e.target.closest('[data-reset]');
  if (rs) { const id = rs.dataset.reset; candleRedraw(id, CANDLE_DEF); candleViewSave(id, Object.assign({}, CANDLE_DEF)); return; }
  if (Date.now() < cg.swallow) return; // clic issu d'un geste de zoom / déplacement
  const btn = e.target.closest('[data-pair]');
  if (!btn) return;
  const id = btn.dataset.pair;
  const wasOpen = candleSelected === id;
  if (candleSelected) {
    const prev = document.getElementById(`pc-detail-${candleSelected}`);
    if (prev) prev.innerHTML = '';
  }
  candleSelected = wasOpen ? null : id;
  if (!wasOpen) {
    chartsOpenDetail(id, '60', 'pc-detail-');
    setTimeout(() => document.getElementById(`pc-detail-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
});

// ===== ALERTE : tableau Symbol | 50 % façon PAPER TRADING =====
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
function alerteRender() {
  const box = document.getElementById('alerteTable');
  if (!box) return;
  if (!alerteData) { box.innerHTML = '<div class="charts-intro">Alert data unavailable right now.</div>'; return; }
  // Une ligne par niveau touché : le 1er touché = PTP, le côté opposé touché ensuite = OCO. Type : BUY côté haut, SELL côté bas.
  const rows = [];
  for (const p of CORR_ALL_PAIRS) {
    const f = alerteData[p.id];
    if (!f) continue;
    const ev = [];
    if (f.up) ev.push({ t: f.up, side: 'up' });
    if (f.dn) ev.push({ t: f.dn, side: 'dn' });
    ev.sort((x, y) => x.t - y.t);
    ev.forEach((e, k) => rows.push({ id: p.id, f, t: e.t, side: e.side, sens: k === 0 ? 'PTP' : 'OCO' }));
  }
  rows.sort((a, b) => a.t - b.t);
  const dec = (v) => v.toFixed(v >= 1000 ? 2 : v >= 100 ? 3 : 5);
  box.innerHTML = `<div class="al-grid"><div class="al-h">Symbol</div><div class="al-h">50%</div><div class="al-h">Sens</div><div class="al-h">Type</div>` +
    (rows.length ? rows.map((r, i) => {
      const b = r.id.slice(0, 3), q = r.id.slice(3), col = alerteZone(r.t), alt = i % 2 === 0 ? 'a' : 'b';
      const R = r.f.hi - r.f.lo, da = `data-id="${r.id}" data-t="${r.t}"`;
      const tip = `Box 14H: ${dec(r.f.hi)} / ${dec(r.f.lo)} · 50% up ${dec(r.f.hi + R / 2)} · 50% down ${dec(r.f.lo - R / 2)}`;
      return `<div class="al-c ${alt}" ${da} title="${tip}"><span style="color:${ALERTE_CCY[b] || '#e5e5e5'}">${b}</span> <span style="color:${ALERTE_CCY[q] || '#e5e5e5'}">${q}</span></div>` +
        `<div class="al-c al-t" ${da} style="color:${col};background:${col}1f" title="${tip}">${alerteTime(r.t)}</div>` +
        `<div ${da} class="al-c ${alt} al-sens ${r.sens === 'OCO' ? 'oco' : 'ptp'}">${r.sens}</div>` +
        `<div ${da} class="al-c ${alt} al-type ${r.side === 'up' ? 'buy' : 'sell'}">${r.side === 'up' ? 'BUY' : 'SELL'}</div>`;
    }).join('') : '<div class="al-empty">—</div>') +
    `</div>`;
}
async function alerteLoad() {
  if (!alerteData) {
    try { const c = JSON.parse(localStorage.getItem(ALERTE_LS) || 'null'); if (c && c.f50) { alerteData = c.f50; alerteRender(); } } catch (e) { /* pas de cache */ }
  }
  try {
    const j = await candleFetchProxy();
    alerteData = j.f50 || {};
    try { localStorage.setItem(ALERTE_LS, JSON.stringify({ f50: alerteData })); } catch (e) { /* quota */ }
  } catch (e) { /* on garde la dernière version */ }
  alerteRender();
}
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


// ===== Graphique de l'alerte : bougies 1 min / 5 min (flèches ‹ ›) + niveaux 14H à gauche, POH à droite — dessin pur, sans stockage =====
const ALG = { AX: 60, TOP: 44, BOT: 22 };
const alg = { id: null, t: null, tf: '1', bars: [], off: 0, n: 110, cache: {} };
function algDec(v) { return v.toFixed(v >= 1000 ? 2 : v >= 100 ? 3 : 5); }
function algDraw() {
  const box = document.getElementById('algPlot');
  if (!box) return;
  const W = Math.max(300, Math.round(window.innerWidth)), H = Math.max(300, Math.round(window.innerHeight) - ALG.TOP);
  const { AX, BOT } = ALG, top = 8;
  const bars = alg.bars, f = (alerteData || {})[alg.id];
  if (!bars.length) { box.innerHTML = '<div class="charts-intro" style="padding:20px">Loading…</div>'; return; }
  const n = Math.min(alg.n, bars.length);
  alg.off = Math.max(0, Math.min(bars.length - n, alg.off));
  const vis = bars.slice(bars.length - n - alg.off, bars.length - alg.off);
  // bougies de droite : D3..D0 puis les 9 POH du jour (comme CANDLE)
  const dly = ((candleDaily || {})[alg.id] || []).slice(-4);
  const days = ((candlePoh || {})[alg.id] || []).filter((d) => Object.keys(d.c).length), day = days[days.length - 1];
  const right = dly.map((b, i, a) => ({ lbl: 'D' + (a.length - 1 - i), c: b.slice(1, 5) }))
    .concat(day ? CANDLE_SLOTS.filter(([k]) => day.c[k]).map(([k, lbl]) => ({ lbl, c: day.c[k] })) : []);
  const rw = right.length ? Math.min(Math.round(W * 0.42), right.length * 26) : 0, lw = W - AX - rw;
  // niveaux de la boîte 14H : Entry = bords, 50 % = bord ± R/2, TP = bord ± R
  const lv = [];
  if (f) {
    const R = f.hi - f.lo;
    lv.push([f.hi + R, 'TP 14H', '#5cc8ff'], [f.hi + R / 2, 'H50% 14H', '#ff9f43'], [f.hi, 'Entry 14H', '#5cc8ff'],
      [f.lo, 'Entry 14H', '#5cc8ff'], [f.lo - R / 2, 'L50% 14H', '#ff9f43'], [f.lo - R, 'TP 14H', '#5cc8ff']);
  }
  let hi = Math.max(...vis.map((b) => b[2])), lo = Math.min(...vis.map((b) => b[3]));
  right.forEach((x) => { hi = Math.max(hi, x.c[1]); lo = Math.min(lo, x.c[2]); });
  const lvIn = lv.filter(([v]) => v <= hi + (hi - lo) * 0.25 && v >= lo - (hi - lo) * 0.25); // un niveau trop lointain n'écrase pas l'échelle
  lvIn.forEach(([v]) => { hi = Math.max(hi, v); lo = Math.min(lo, v); });
  const m = (hi - lo || hi * 0.001) * 0.06; hi += m; lo -= m;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - BOT);
  const stp = candleNiceStep(hi - lo, 8);
  let grid = '';
  for (let v = Math.ceil(lo / stp) * stp; v <= hi; v += stp) grid += `<line x1="0" x2="${W - AX}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#1d1f24"/><text x="${W - AX + 6}" y="${(y(v) + 4).toFixed(1)}" class="pc-ax">${algDec(v)}</text>`;
  const st = lw / n, bw = Math.max(1, st * 0.7);
  alg.step = st;
  let body = '', tx = '';
  vis.forEach((b, i) => {
    const [t, o, h, l, c] = b, cx = st * (i + 0.5), col = c >= o ? '#26a69a' : '#ef5350';
    body += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(h).toFixed(1)}" y2="${y(l).toFixed(1)}" stroke="${col}"/>` +
      `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(Math.max(o, c)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y(o) - y(c))).toFixed(1)}" fill="${col}"/>`;
    if (i % Math.max(1, Math.round(n / 5)) === 0) tx += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="pc-ax">${alerteTime(t)}</text>`;
  });
  // repère de l'heure de l'alerte (barre qui la contient)
  let mark = '';
  if (alg.t) {
    const k = vis.findIndex((b, i) => alg.t >= b[0] && (i + 1 >= vis.length || alg.t < vis[i + 1][0]));
    if (k >= 0 && alg.t < vis[vis.length - 1][0] + 60 * Number(alg.tf)) {
      const cx = st * (k + 0.5), col = alerteZone(alg.t);
      mark = `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${top}" y2="${H - BOT}" stroke="${col}" stroke-dasharray="3 3"/><text x="${cx.toFixed(1)}" y="${top + 11}" text-anchor="middle" style="fill:${col};font-size:11px">${alerteTime(alg.t)}</text>`;
    }
  }
  const lines = lvIn.map(([v, t, c]) => `<line x1="0" x2="${W - AX}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${c}" stroke-opacity=".75" stroke-dasharray="1 4" stroke-linecap="round"/>` +
    `<text x="${lw - 4}" y="${(y(v) - 3).toFixed(1)}" text-anchor="end" style="fill:${c};font-size:10px">${t}</text>`).join('');
  const rs = right.length ? rw / right.length : 0, rbw = Math.min(rs * 0.7, 22);
  const rbody = right.map((x, i) => {
    const [o, h, l, c] = x.c, cx = lw + rs * (i + 0.5), col = c >= o ? '#26a69a' : '#ef5350';
    return `<text x="${cx.toFixed(1)}" y="${Math.min(H - BOT - 2, Math.max(12, y(h) - 5)).toFixed(1)}" text-anchor="middle" style="fill:${col};font-size:9px">${x.lbl}</text>` +
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(h).toFixed(1)}" y2="${y(l).toFixed(1)}" stroke="${col}"/>` +
      `<rect x="${(cx - rbw / 2).toFixed(1)}" y="${y(Math.max(o, c)).toFixed(1)}" width="${rbw.toFixed(1)}" height="${Math.max(1, Math.abs(y(o) - y(c))).toFixed(1)}" fill="${c >= o ? '#0b0b0b' : col}" stroke="${col}"/>`;
  }).join('');
  const lb = bars[bars.length - 1], lastC = lb[4], lc = lastC >= lb[1] ? '#26a69a' : '#ef5350', yl = Math.min(H - BOT, Math.max(top, y(lastC)));
  const tag = `<line x1="0" x2="${W - AX}" y1="${yl.toFixed(1)}" y2="${yl.toFixed(1)}" stroke="${lc}" stroke-dasharray="2 3"/><rect x="${W - AX + 1}" y="${(yl - 10).toFixed(1)}" width="${AX - 2}" height="20" fill="${lc}"/><text x="${W - AX + 6}" y="${(yl + 4).toFixed(1)}" class="pc-ax" style="fill:#fff">${algDec(lastC)}</text>`;
  box.innerHTML = `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><clipPath id="algClip"><rect x="0" y="0" width="${W - AX}" height="${H}"/></clipPath></defs>${grid}<g clip-path="url(#algClip)">${lines}${body}${mark}${rbody}</g>${tx}${tag}</svg>`;
}
async function algLoad() {
  const key = alg.id + '|' + alg.tf;
  document.getElementById('algTf').textContent = alg.tf + 'm';
  document.getElementById('algPrev').disabled = alg.tf === '1';
  document.getElementById('algNext').disabled = alg.tf === '5';
  alg.n = alg.tf === '5' ? 90 : 110; alg.off = 0;
  alg.bars = alg.cache[key] || [];
  algDraw();
  try {
    const r = await fetch(`https://ariinuiirgina.vercel.app/api/poh-candles?pair=${alg.id}&tf=${alg.tf}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const j = r.ok ? await r.json() : null;
    if (j && j.bars && j.bars.length) { alg.cache[key] = j.bars; if (key === alg.id + '|' + alg.tf) { alg.bars = j.bars; algDraw(); } }
  } catch (e) { /* on garde ce qui est affiché */ }
}
function algOpen(id, t) {
  alg.id = id; alg.t = t; alg.tf = '1'; alg.cache = {};
  let ov = document.getElementById('algOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'algOverlay';
    ov.innerHTML = '<div class="alg-top"><button type="button" id="algClose" aria-label="Close">✕</button><span id="algName"></span><span class="alg-nav"><button type="button" id="algPrev" aria-label="1 minute">&#8249;</button><b id="algTf">1m</b><button type="button" id="algNext" aria-label="5 minutes">&#8250;</button></span></div><div id="algPlot"></div>';
    document.body.appendChild(ov);
    document.getElementById('algClose').addEventListener('click', () => { ov.hidden = true; document.body.classList.remove('alg-open'); });
    document.getElementById('algPrev').addEventListener('click', () => { alg.tf = '1'; algLoad(); });
    document.getElementById('algNext').addEventListener('click', () => { alg.tf = '5'; algLoad(); });
    const plot = document.getElementById('algPlot');
    let px = null;
    plot.addEventListener('pointerdown', (e) => { px = e.clientX; plot.setPointerCapture(e.pointerId); });
    plot.addEventListener('pointermove', (e) => {
      if (px === null) return;
      const d = Math.round((e.clientX - px) / Math.max(1.5, alg.step || 4)); // glisser = remonter dans l'historique
      if (d) { px = e.clientX; alg.off += d; algDraw(); }
    });
    ['pointerup', 'pointercancel'].forEach((ev) => plot.addEventListener(ev, () => { px = null; }));
    window.addEventListener('resize', () => { if (!ov.hidden) algDraw(); });
  }
  ov.hidden = false;
  document.body.classList.add('alg-open');
  document.getElementById('algName').textContent = id.slice(0, 3) + '/' + id.slice(3);
  algLoad();
}
document.getElementById('alerteTable')?.addEventListener('click', (e) => {
  const c = e.target.closest('[data-id]');
  if (c) algOpen(c.dataset.id, Number(c.dataset.t) || null);
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

// ntfy : alertes sonores (son, vibration, pop-up). Le serveur crée un canal au nom aléatoire ; le lien l'ouvre directement dans l'application ntfy.
async function alerteNtfyInit() {
  const box = document.getElementById('alerteNtfy');
  if (!box || box.dataset.ready) return;
  try {
    const r = await fetch(`${ALERTE_API}/alerte?ntfy=1`);
    const j = r.ok ? await r.json() : null;
    if (!j || !j.topic) return;
    document.getElementById('alerteNtfySub').href = `ntfy://ntfy.sh/${j.topic}?display=Alerte`;
    document.getElementById('alerteNtfyTopic').textContent = `Channel: ${j.topic}`;
    box.hidden = false;
    box.dataset.ready = '1';
  } catch (e) { /* le panneau reste sans ntfy tant que le serveur ne répond pas */ }
}
document.getElementById('alerteToggle')?.addEventListener('click', () => { alerteNtfyInit(); });
