// Fichier texte compact des news à fort impact pour l'EA MT5 Arii CDX SW (mêmes données et même fusion que les pastilles de CANDLE) :
// data/candle-news.txt = une ligne par news : t_utc \t DEVISE \t titre \t actual \t forecast \t previous (45 derniers jours + futur)
import fs from 'node:fs';
const MAJ = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];
const tvRaw = JSON.parse(fs.readFileSync('data/tv-events.json', 'utf8')).events || [];
const tv = tvRaw.map((a) => ({ country: a[1], title: a[2], _t: a[0], actual: a[3], forecast: a[4], previous: a[5] }));
let ff = [];
try { ff = (JSON.parse(fs.readFileSync('data/eco-calendar.json', 'utf8')).events || []).filter((e) => (e.impact === 'High' || /\b(speaks|testifies|speech)\b/i.test(e.title)) && e.date).map((e) => Object.assign({}, e, { _t: Math.floor(Date.parse(e.date) / 1000) })).filter((e) => e._t > 0); } catch { /* facultatif */ }
const isSpeech = (t) => /speak|speech|press conf|testif|hearing|minutes/i.test(t || '');
const byCcy = {};
for (const e of tv) (byCcy[e.country] = byCcy[e.country] || []).push(e._t);
const extra = ff.filter((e) => isSpeech(e.title) || !(byCcy[e.country] || []).some((t) => Math.abs(t - e._t) <= 600));
const from = Math.floor(Date.now() / 1000) - 45 * 86400;
const clean = (s) => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
const out = tv.concat(extra).filter((e) => MAJ.includes(e.country) && e._t >= from).sort((a, b) => a._t - b._t)
  .map((e) => [e._t, e.country, clean(e.title), clean(e.actual), clean(e.forecast), clean(e.previous)].join('\t'));
fs.writeFileSync('data/candle-news.txt', out.join('\n') + '\n');
console.log('candle-news.txt :', out.length, 'news');
