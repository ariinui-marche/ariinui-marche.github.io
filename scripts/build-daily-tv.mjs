// data/daily-tv.json : les 10 dernières bougies 1D de chaque paire, extraites des MÊMES fichiers TradingView (IC) que le graphique
// -> les bougies D1 du côté POH (D3..D0) sont identiques à celles du graphique 1D (avant : Yahoo, prix légèrement différents).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'data/candles/1D', pairs = {};
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f.endsWith('.recent.json')) continue;
  try { const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); if (j.bars && j.bars.length) pairs[f.slice(0, -5)] = j.bars.slice(-10); } catch (e) { console.error(f, e.message); }
}
writeFileSync('data/daily-tv.json', JSON.stringify({ updated: new Date().toISOString(), pairs }));
console.log(Object.keys(pairs).length + ' paires');
