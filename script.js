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
  USD: 'Dollar US', EUR: 'Euro', GBP: 'Livre Sterling', JPY: 'Yen Japonais',
  CHF: 'Franc Suisse', AUD: 'Dollar Australien', CAD: 'Dollar Canadien', NZD: 'Dollar Néo-Zélandais',
};

// Force Devise: live proxy déjà utilisé par TradeJournal Pro (BabyPips bloque les IPs
// cloud génériques type GitHub Actions, ce proxy Vercel est whitelisté — voir décision session)
const MARKET_DATA_URL = 'https://ariinuiirgina.vercel.app/api/market-data';

async function fetchCurrencyStrength() {
  const res = await fetch(MARKET_DATA_URL);
  if (!res.ok) throw new Error(`market-data: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  const raw = json?.data?.currencies || [];

  const changes = raw.map((c) => {
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

function renderCurrencies(data) {
  const grid = document.getElementById('currencyGrid');
  if (!data?.currencies?.length) {
    grid.innerHTML = '<div class="empty-state">Données indisponibles</div>';
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

let currentEvents = [];
let currentFilter = 'High';

function renderEvents() {
  const list = document.getElementById('ecoList');
  const filtered = currentFilter === 'all'
    ? currentEvents
    : currentEvents.filter((e) => e.impact === currentFilter);

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Aucun événement</div>';
    return;
  }

  let lastDateKey = null;

  list.innerHTML = filtered.map((e) => {
    const d = new Date(e.date);
    const time = isNaN(d) ? '--:--' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const dateKey = isNaN(d) ? '' : d.toDateString();
    const dateLabel = isNaN(d)
      ? ''
      : d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const showDateHeader = dateKey && dateKey !== lastDateKey;
    lastDateKey = dateKey || lastDateKey;

    const flag = COUNTRY_FLAGS[e.country] || '🏳️';
    const hasValues = e.forecast || e.previous || e.actual;

    return `
      ${showDateHeader ? `<div class="eco-date-header">${dateLabel}</div>` : ''}
      <div class="eco-event">
        <span class="eco-time">${time}</span>
        <span class="eco-flag">${flag}</span>
        <span class="eco-title" title="${e.title}">${e.title}</span>
        <span class="impact-badge impact-${e.impact}">${e.impact}</span>
      </div>
      ${hasValues ? `<div class="eco-values">
        ${e.actual ? `<span>Actual: <b class="${valueColorClass(e.actual)}">${e.actual}</b></span>` : ''}
        ${e.forecast ? `<span>Forecast: <b class="${valueColorClass(e.forecast)}">${e.forecast}</b></span>` : ''}
        ${e.previous ? `<span>Previous: <b class="${valueColorClass(e.previous)}">${e.previous}</b></span>` : ''}
      </div>` : ''}`;
  }).join('');
  parseEmoji(list);
}

function valueColorClass(val) {
  if (!val) return '';
  const num = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return '';
  if (num > 0) return 'val-pos';
  if (num < 0) return 'val-neg';
  return 'val-zero';
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
  BTC: ['BTC', 'Bitcoin'],
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

let currentNews = [];
let currentNewsFilter = 'all';

function renderNews() {
  const list = document.getElementById('newsList');
  const filtered = currentNewsFilter === 'all'
    ? currentNews
    : currentNews.filter((n) => n.currencies.includes(currentNewsFilter));

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Aucune news</div>';
    return;
  }

  list.innerHTML = filtered.map((n) => {
    const d = new Date(n.pubDate);
    const time = isNaN(d) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const dateLabel = isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    return `
      <a class="news-item" href="${n.link}" target="_blank" rel="noopener noreferrer">
        <div class="news-meta">
          <span class="news-source">${n.source}</span>
          <span class="news-time">${dateLabel} ${time}</span>
        </div>
        <div class="news-title">${n.title}</div>
      </a>`;
  }).join('');
}

function formatTimestamp(iso) {
  if (!iso) return 'Jamais';
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'À l\'instant';
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  return d.toLocaleString();
}

async function loadAll() {
  document.getElementById('updateStatus').textContent = 'Chargement…';
  try {
    const [currencyData, ecoData, newsData] = await Promise.all([
      fetchCurrencyStrength().catch((err) => { console.error(err); return null; }),
      loadJSON('./data/eco-calendar.json').catch(() => null),
      loadJSON('./data/market-news.json').catch(() => null),
    ]);

    renderCurrencies(currencyData);

    currentEvents = (ecoData?.events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    renderEvents();

    currentNews = (newsData?.items || [])
      .map((n) => ({ ...n, currencies: detectCurrencies(n.title + ' ' + n.description) }))
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    renderNews();

    const latest = [currencyData?.timestamp, ecoData?.timestamp, newsData?.timestamp].filter(Boolean).sort().pop();
    document.getElementById('updateStatus').textContent = `Mis à jour : ${formatTimestamp(latest)}`;
  } catch (err) {
    document.getElementById('updateStatus').textContent = 'Erreur de chargement';
    console.error(err);
  }
}

document.getElementById('refreshBtn').addEventListener('click', loadAll);
document.getElementById('impactFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  e.currentTarget.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.impact;
  renderEvents();
});
document.getElementById('newsFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  e.currentTarget.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentNewsFilter = btn.dataset.ccy;
  renderNews();
});

loadAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW registration failed', err));
  });
}
