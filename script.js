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

// ── Mini calendrier mensuel (Calendrier Économique) ─────────────────────────

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const IMPACT_RANK = { High: 3, Medium: 2, Low: 1 };
function impactColor(impact) {
  if (impact === 'High') return 'var(--red)';
  if (impact === 'Medium') return 'var(--orange)';
  return 'var(--gray)';
}

const today = new Date();
let calViewYear = today.getFullYear();
let calViewMonth = today.getMonth();
let calSelectedDate = null;

function renderEcoCalendar() {
  const el = document.getElementById('ecoCalendar');

  const dateMap = new Map();
  for (const e of currentEvents) {
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
  const monthLabel = new Date(calViewYear, calViewMonth).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const todayStr = localDateStr(today);

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += '<div></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const info = dateMap.get(dateStr);
    const cls = ['cal-day'];
    if (dateStr === todayStr) cls.push('today');
    if (dateStr === calSelectedDate) cls.push('selected');
    cells += `
      <button class="${cls.join(' ')}" data-date="${dateStr}" ${info ? `title="${info.count} événement${info.count > 1 ? 's' : ''}"` : ''}>
        ${day}
        ${info ? `<span class="cal-dot" style="background:${impactColor(info.impact)}"></span>` : ''}
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
      ${calSelectedDate ? '<button class="cal-link" id="calShowAll">Tout afficher</button>' : ''}
      ${calSelectedDate !== todayStr ? '<button class="cal-link" id="calToday">Aujourd\'hui</button>' : ''}
    </div>`;
}

document.getElementById('ecoCalendar').addEventListener('click', (e) => {
  if (e.target.closest('#calPrev')) {
    if (calViewMonth === 0) { calViewMonth = 11; calViewYear--; } else { calViewMonth--; }
  } else if (e.target.closest('#calNext')) {
    if (calViewMonth === 11) { calViewMonth = 0; calViewYear++; } else { calViewMonth++; }
  } else if (e.target.closest('#calShowAll')) {
    calSelectedDate = null;
  } else if (e.target.closest('#calToday')) {
    calViewYear = today.getFullYear();
    calViewMonth = today.getMonth();
    calSelectedDate = localDateStr(today);
  } else {
    const dayBtn = e.target.closest('.cal-day');
    if (!dayBtn) return;
    const date = dayBtn.dataset.date;
    calSelectedDate = calSelectedDate === date ? null : date;
  }
  renderEcoCalendar();
  renderEvents();
});

function renderEvents() {
  const list = document.getElementById('ecoList');
  let filtered = currentFilter === 'all'
    ? currentEvents
    : currentEvents.filter((e) => e.impact === currentFilter);
  if (calSelectedDate) {
    filtered = filtered.filter((e) => {
      const d = new Date(e.date);
      return !isNaN(d) && localDateStr(d) === calSelectedDate;
    });
  }

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
  BTC: ['BTC', 'Bitcoin', 'Crypto', 'Cryptocurrency'],
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

    const latest = [currencyData?.timestamp, ecoData?.timestamp, newsData?.timestamp].filter(Boolean).sort().pop();
    document.getElementById('updateStatus').textContent = `Mis à jour : ${formatTimestamp(latest)}`;
  } catch (err) {
    document.getElementById('updateStatus').textContent = 'Erreur de chargement';
    console.error(err);
  }
}

document.getElementById('refreshBtn').addEventListener('click', loadAll);
document.getElementById('currencyToggle').addEventListener('click', (e) => {
  const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('currencyGrid').classList.toggle('collapsed', expanded);
});
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
