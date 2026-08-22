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
}

let currentEvents = [];
let currentFilter = 'all';

function renderEvents() {
  const list = document.getElementById('ecoList');
  const filtered = currentFilter === 'all'
    ? currentEvents
    : currentEvents.filter((e) => e.impact === currentFilter);

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Aucun événement</div>';
    return;
  }

  list.innerHTML = filtered.map((e) => {
    const d = new Date(e.date);
    const time = isNaN(d) ? '--:--' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateLabel = isNaN(d) ? '' : d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' });
    const flag = COUNTRY_FLAGS[e.country] || '🏳️';
    const hasValues = e.forecast || e.previous || e.actual;
    return `
      <div class="eco-event">
        <span class="eco-time" title="${dateLabel}">${time}</span>
        <span class="eco-flag">${flag}</span>
        <span class="eco-title" title="${e.title}">${e.title}</span>
        <span class="impact-badge impact-${e.impact}">${e.impact}</span>
      </div>
      ${hasValues ? `<div class="eco-values">
        ${e.actual ? `<span>Actual: <b>${e.actual}</b></span>` : ''}
        ${e.forecast ? `<span>Forecast: <b>${e.forecast}</b></span>` : ''}
        ${e.previous ? `<span>Previous: <b>${e.previous}</b></span>` : ''}
      </div>` : ''}`;
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
    const [currencyData, ecoData] = await Promise.all([
      loadJSON('./data/currency-strength.json').catch(() => null),
      loadJSON('./data/eco-calendar.json').catch(() => null),
    ]);

    renderCurrencies(currencyData);

    currentEvents = (ecoData?.events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    renderEvents();

    const latest = [currencyData?.timestamp, ecoData?.timestamp].filter(Boolean).sort().pop();
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
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.impact;
  renderEvents();
});

loadAll();
