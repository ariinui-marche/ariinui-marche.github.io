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
    .map((c) => ({ ...c, raw: c.fast + c.slow }));

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

// ── AUD Desk — manual institutional-style confluence briefing ──────────────
// Hand-maintained (via a Claude Code session) ahead of major AUD events, not
// auto-fetched — see data/aud-desk.json. No live narrative generation (would
// require a paid LLM call per update, against this project's zero-server-cost
// rule) — this only renders whatever a human has last written to the JSON.

const AUDD_DIR_ARROW = { bullish: '▲', bearish: '▼', neutral: '–' };
const AUDD_WEIGHT_TO_IMPACT = { high: 'High', medium: 'Medium', low: 'Low' };

function auddWeightBadge(weight) {
  const impact = AUDD_WEIGHT_TO_IMPACT[weight] || 'Low';
  return `<span class="impact-badge impact-${impact}">${weight}</span>`;
}

function auddDirClass(direction) {
  return `audd-dir-${direction || 'neutral'}`;
}

// Wrapped defensively: a malformed/unexpected aud-desk.json (or a stale SW
// cache mismatch across shell files) must never throw out of here — it would
// otherwise abort loadAll()'s shared try/catch and blank out every other
// panel (currency/calendar/news) along with it. Degrade to hiding just this
// panel instead.
function renderAudDesk(data) {
  try {
    renderAudDeskUnsafe(data);
  } catch (err) {
    console.error('renderAudDesk failed, hiding panel', err);
    document.getElementById('audDeskPanel')?.classList.add('audd-hidden');
  }
}

function renderAudDeskUnsafe(data) {
  const panel = document.getElementById('audDeskPanel');
  const labelEl = document.getElementById('audDeskToggleLabel');
  const bodyEl = document.getElementById('audDeskBody');
  if (!panel || !labelEl || !bodyEl) return; // stale cached HTML without the AUD Desk markup
  if (!data) { panel.classList.add('audd-hidden'); return; }
  panel.classList.remove('audd-hidden');

  const ev = data.event || {};
  const evDate = ev.date ? new Date(ev.date) : null;
  const evDateLabel = evDate && !isNaN(evDate)
    ? evDate.toLocaleString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const bias = data.bias || {};
  const c = ev.consensus || {};

  const confPct = Number.isFinite(bias.confidencePct) ? `${bias.confidencePct}%` : '';

  labelEl.innerHTML = `
    <span class="audd-ticker">${ev.ccy || ''}</span>
    <span class="audd-bias-pill audd-bias-${bias.direction || 'neutral'}">${(bias.direction || 'neutral').toUpperCase()}${confPct ? ` · ${confPct}` : ''}</span>`;

  bodyEl.innerHTML = `
    ${ev.title ? `<div class="audd-toggle-title">${ev.title}</div>` : ''}
    ${evDateLabel ? `<div class="audd-event-time">${evDateLabel} (your local time)</div>` : ''}

    <div class="audd-bias audd-bias-${bias.direction || 'neutral'}">
      <span class="audd-bias-label">${(bias.direction || 'neutral').toUpperCase()}${confPct ? ` <span class="audd-bias-pct">${confPct}</span>` : ''}</span>
      <span class="audd-bias-meta">${bias.horizon || ''}${bias.confidenceSample ? ` · ${bias.confidenceSample}` : ''}</span>
      ${bias.summary ? `<span class="audd-bias-summary">${bias.summary}</span>` : ''}
      ${bias.confidenceCaveat ? `<span class="audd-bias-caveat">${bias.confidenceCaveat}</span>` : ''}
    </div>

    ${data.shortTermRead ? `
    <div class="audd-section-label">Short-term read</div>
    <div class="audd-shortread">
      <div class="audd-shortread-headline">${data.shortTermRead.headline}</div>
      ${Number.isFinite(data.shortTermRead.hitRatePct) ? `<div class="audd-shortread-stat"><span class="audd-shortread-pct ${auddDirClass(bias.direction)}">${data.shortTermRead.hitRatePct}%</span><span class="audd-shortread-sample">${data.shortTermRead.hitRateSample || ''}</span></div>` : ''}
      ${(data.shortTermRead.scenarios || []).map((s) => `
        <div class="audd-play-row">
          <div class="audd-play-scenario">${s.case} <span class="audd-play-confidence">(${s.historicalRate})</span></div>
          <div class="audd-play-expected">${s.expectedMove}</div>
        </div>`).join('')}
      ${(data.shortTermRead.riskFlags || []).length ? `
      <ul class="audd-shortread-risks">
        ${data.shortTermRead.riskFlags.map((f) => `<li>${f}</li>`).join('')}
      </ul>` : ''}
    </div>` : ''}

    ${(c.headlineYoY || c.trimmedMeanYoY) ? `
    <div class="audd-consensus">
      ${c.headlineYoY ? `<div class="audd-stat"><span class="audd-stat-label">Headline YoY (cons.)</span><span class="audd-stat-value">${c.headlineYoY}</span><span class="audd-stat-prior">prior ${c.priorHeadlineYoY || '—'}</span></div>` : ''}
      ${c.trimmedMeanYoY ? `<div class="audd-stat"><span class="audd-stat-label">Trimmed mean YoY (cons.)</span><span class="audd-stat-value">${c.trimmedMeanYoY}</span><span class="audd-stat-prior">prior ${c.priorTrimmedMeanYoY || '—'}</span></div>` : ''}
    </div>
    ${c.sources ? `<div class="audd-note">${c.sources}</div>` : ''}
    ${ev.note ? `<div class="audd-note">${ev.note}</div>` : ''}` : ''}

    ${(data.catalysts || []).length ? `
    <div class="audd-section-label">Catalyst scorecard</div>
    <div class="audd-scorecard">
      ${data.catalysts.map((k) => `
        <div class="audd-score-row">
          <span class="audd-score-dir ${auddDirClass(k.direction)}">${AUDD_DIR_ARROW[k.direction] || '–'}</span>
          <span class="audd-score-factor">${k.factor}</span>
          ${auddWeightBadge(k.weight)}
          <span class="audd-score-note">${k.note}</span>
        </div>`).join('')}
    </div>` : ''}

    ${data.positioning ? `
    <div class="audd-section-label">Positioning — ${data.positioning.source}</div>
    <div class="audd-positioning">
      <span class="audd-pos-value ${data.positioning.netContracts < 0 ? 'audd-dir-bearish' : 'audd-dir-bullish'}">${data.positioning.netContracts > 0 ? '+' : ''}${data.positioning.netContracts.toLocaleString('en-GB')}</span>
      <span class="audd-pos-meta">net contracts (prior ${data.positioning.priorNetContracts > 0 ? '+' : ''}${data.positioning.priorNetContracts.toLocaleString('en-GB')}) · as of ${data.positioning.asOf}</span>
      <span class="audd-pos-note">${data.positioning.note}</span>
    </div>` : ''}

    ${(data.marketIndicators || []).length ? `
    <div class="audd-section-label">Institutional tools</div>
    <div class="audd-indicators">
      ${data.marketIndicators.map((m) => `
        <div class="audd-indicator">
          <div class="audd-indicator-name">${m.name}</div>
          <div class="audd-indicator-what">${m.what}</div>
          <div class="audd-indicator-reading"><b>Reading:</b> ${m.reading}</div>
          <div class="audd-indicator-apply"><b>How to apply:</b> ${m.howToApply}</div>
        </div>`).join('')}
    </div>` : ''}

    ${(data.correlations || []).length ? `
    <div class="audd-section-label">Correlations (computed, not textbook)</div>
    <div class="audd-indicators">
      ${data.correlations.map((c2) => `
        <div class="audd-indicator">
          <div class="audd-indicator-name">${c2.pair}</div>
          <div class="audd-indicator-what">${c2.method}</div>
          <div class="audd-indicator-reading"><b>Result:</b> ${c2.value}</div>
          <div class="audd-indicator-apply"><b>Read:</b> ${c2.read}</div>
        </div>`).join('')}
    </div>` : ''}

    ${(data.reactionHistory || []).length ? `
    <div class="audd-section-label">Reaction history</div>
    <div class="audd-history">
      <div class="audd-history-row audd-history-head">
        <span>Print</span><span>Headline</span><span>Trimmed mean</span><span>Alignment</span><span>Move</span>
      </div>
      ${data.reactionHistory.map((h) => `
        <div class="audd-history-row">
          <span>${h.label}</span><span>${h.headline}</span><span>${h.trimmedMean}</span><span>${h.alignment}</span><span>${h.move}</span>
        </div>
        <div class="audd-history-read">${h.read}</div>`).join('')}
    </div>` : ''}

    ${(data.playbook || []).length ? `
    <div class="audd-section-label">Playbook</div>
    <div class="audd-playbook">
      ${data.playbook.map((p) => `
        <div class="audd-play-row">
          <div class="audd-play-scenario">${p.scenario} <span class="audd-play-confidence">(${p.confidence} confidence)</span></div>
          <div class="audd-play-expected">${p.expected}</div>
        </div>`).join('')}
    </div>` : ''}

    ${(data.usCalendarSameDay || []).length ? `
    <div class="audd-section-label">Same-day US calendar</div>
    <div class="audd-uscal">
      ${data.usCalendarSameDay.map((u) => `<span class="audd-uscal-item">${u.localTime} — ${u.event} ${auddWeightBadge(u.weight)}</span>`).join('')}
    </div>` : ''}

    <div class="audd-footer">
      ${data.asOf ? `<span>Briefing as of ${new Date(data.asOf).toLocaleString('en-GB')}</span>` : ''}
      ${data.disclaimer ? `<span class="audd-disclaimer">${data.disclaimer}</span>` : ''}
    </div>`;
}

document.getElementById('audDeskToggle')?.addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('audDeskBody').classList.toggle('collapsed', expanded);
});

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

let currentEvents = [];
const currentImpactFilters = new Set(['High']);

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

function renderEcoCalendar() {
  const el = document.getElementById('ecoCalendar');

  const visibleEvents = currentImpactFilters.size === 0
    ? currentEvents
    : currentEvents.filter((e) => currentImpactFilters.has(e.impact));

  const dateMap = new Map();
  for (const e of visibleEvents) {
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
  const monthLabel = new Date(calViewYear, calViewMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const todayStr = localDateStr(today);

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += '<div></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const info = dateMap.get(dateStr);
    const cls = ['cal-day'];
    if (info) cls.push(`cal-impact-${info.impact}`);
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
    <div class="cal-weekdays">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<div>${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-footer">
      ${calShowAll ? '<button class="cal-link" id="calThisWeek">This week</button>' : ''}
      ${(calSelectedDate || !calShowAll) ? '<button class="cal-link" id="calShowAll">Show all</button>' : ''}
      ${calSelectedDate !== todayStr ? '<button class="cal-link" id="calToday">Today</button>' : ''}
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

function findNextHighEvent() {
  const now = Date.now();
  nextHighEvent = currentEvents.find((e) => e.impact === 'High' && new Date(e.date).getTime() > now) || null;
}

function renderCountdownStatic() {
  const el = document.getElementById('ecoCountdown');
  if (!nextHighEvent) {
    el.innerHTML = '';
    return;
  }
  const flag = COUNTRY_FLAGS[nextHighEvent.country] || '🏳️';
  el.innerHTML = `
    <span class="countdown-ccy">${nextHighEvent.country}</span>
    <span class="countdown-flag">${flag}</span>
    <span class="countdown-info">
      <span class="countdown-label">Next High</span>
      <span class="countdown-title" title="${nextHighEvent.title}">${nextHighEvent.title}</span>
    </span>
    <span class="countdown-time" id="countdownTime">--:--:--</span>`;
  parseEmoji(el);
  tickCountdown();
}

function tickCountdown() {
  if (!nextHighEvent) return;
  const diff = new Date(nextHighEvent.date).getTime() - Date.now();
  if (diff <= 0) {
    findNextHighEvent();
    renderCountdownStatic();
    return;
  }
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const timeEl = document.getElementById('countdownTime');
  if (timeEl) timeEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
}

setInterval(tickCountdown, 1000);

function renderEvents() {
  const list = document.getElementById('ecoList');
  let filtered = currentImpactFilters.size === 0
    ? currentEvents
    : currentEvents.filter((e) => currentImpactFilters.has(e.impact));
  if (calSelectedDate) {
    filtered = filtered.filter((e) => {
      const d = new Date(e.date);
      return !isNaN(d) && localDateStr(d) === calSelectedDate;
    });
  } else if (!calShowAll) {
    filtered = filtered.filter((e) => {
      const d = new Date(e.date);
      return !isNaN(d) && isThisWeek(d);
    });
  }

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No events</div>';
    return;
  }

  let lastDateKey = null;

  list.innerHTML = filtered.map((e) => {
    const d = new Date(e.date);
    const time = isNaN(d) ? '--:--' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const timeClass = isNaN(d) ? '' : ecoTimeColorClass(d.getHours());
    const dateKey = isNaN(d) ? '' : d.toDateString();
    const dateLabel = isNaN(d)
      ? ''
      : d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    const showDateHeader = dateKey && dateKey !== lastDateKey;
    lastDateKey = dateKey || lastDateKey;

    const flag = COUNTRY_FLAGS[e.country] || '🏳️';
    const hasValues = e.forecast || e.previous || e.actual;
    const beatMiss = actualVsForecast(e.actual, e.forecast);

    return `
      ${showDateHeader ? `<div class="eco-date-header">${dateLabel}</div>` : ''}
      <div class="eco-event">
        <span class="eco-time ${timeClass}">${time}</span>
        <span class="eco-ccy">${e.country}</span>
        <span class="eco-flag">${flag}</span>
        <span class="eco-title" title="${e.title}">${e.title}</span>
        <span class="eco-impact-wrap">
          <span class="impact-badge impact-${e.impact}">${e.impact}</span>
        </span>
      </div>
      ${hasValues ? `<div class="eco-values">
        ${e.actual ? `<span>${beatMiss !== 'neutral' ? `<span class="sentiment-tri tri-${beatMiss}"></span>` : ''}Actual: <b class="${valueColorClass(e.actual)}">${e.actual}</b></span>` : ''}
        ${e.forecast ? `<span>Forecast: <b class="${valueColorClass(e.forecast)}">${e.forecast}</b></span>` : ''}
        ${e.previous ? `<span>Previous: <b class="${valueColorClass(e.previous)}">${e.previous}</b></span>` : ''}
      </div>` : ''}`;
  }).join('');
  parseEmoji(list);
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

let currentNews = [];

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
  const filtered = currentNewsFilter === 'all'
    ? currentNews
    : currentNews.filter((n) => n.currencies.includes(currentNewsFilter));

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No news</div>';
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
      </a>`;
  }).join('');
}

async function loadAll() {
  try {
    const [marketRaw, ecoData, newsData, audDeskData] = await Promise.all([
      fetchMarketRaw().catch((err) => { console.error(err); return null; }),
      loadJSON('./data/eco-calendar.json').catch(() => null),
      loadJSON('./data/market-news.json').catch(() => null),
      loadJSON('./data/aud-desk.json').catch(() => null),
    ]);

    renderAudDesk(audDeskData);
    renderCurrencies(marketRaw ? computeCurrencyStrength(marketRaw) : null);
    renderTrendMomentum(marketRaw ? computeTrendMomentum(marketRaw) : null);
    renderCorrelation();

    currentEvents = (ecoData?.events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    findNextHighEvent();
    renderCountdownStatic();
    renderEcoCalendar();
    renderEvents();

    currentNews = (newsData?.items || [])
      .map((n) => {
        const currencies = detectCurrencies(n.title + ' ' + n.description);
        // Sources 100% dédiées à une devise par nature — tag forcé même sans
        // mot-clé explicite dans le titre (ex. un communiqué Fed technique
        // qui ne mentionne jamais littéralement "USD"/"dollar")
        const forcedCcy = SOURCE_CURRENCY[n.source];
        if (forcedCcy && !currencies.includes(forcedCcy)) currencies.push(forcedCcy);
        return { ...n, currencies };
      })
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    renderNews();
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('refreshBtn').addEventListener('click', loadAll);
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

// Restaure le filtre devise persisté (localStorage) sur l'état visuel des boutons
{
  const newsFiltersEl = document.getElementById('newsFilters');
  newsFiltersEl.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.ccy === currentNewsFilter);
  });
}

loadAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW registration failed', err));
  });
}
