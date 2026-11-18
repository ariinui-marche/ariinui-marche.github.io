// Bougies statiques (test) : node scripts/fetch-static-candles.mjs XAUUSD 1D
// Lit data/candles/<tf>/<PAIRE>.json (historique), le complète avec les dernières barres de TradingView (flux IC, WebSocket public),
// fusionne par horodatage (la barre en cours est remplacée) et réécrit le fichier. Remplace l'appel à l'API Vercel pour ce couple paire/timeframe.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';

const ALL = 'EURUSD GBPUSD USDJPY AUDUSD USDCAD USDCHF NZDUSD XAUUSD BTCUSD ETHUSD EURJPY GBPJPY EURGBP EURAUD EURCAD EURCHF EURNZD GBPAUD GBPCAD GBPCHF GBPNZD AUDJPY CADJPY CHFJPY NZDJPY AUDCAD AUDCHF AUDNZD CADCHF NZDCAD NZDCHF'.split(' ');
const [ARG = 'ALL', TF = '1D'] = process.argv.slice(2); // PAIRE, 'EURUSD,GBPUSD' ou ALL
const PAIRS = ARG === 'ALL' ? ALL : ARG.split(',');
const OUT = process.env.OUT || 'data/candles', N_UPDATE = 400, N_FIRST = +(process.env.N_FIRST || 5000); // barres demandées : mise à jour / 1er passage (historique complet)

function fetchBars(sym, tf, n) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', { headers: { Origin: 'https://www.tradingview.com' } });
    const enc = (o) => { const j = JSON.stringify(o); return `~m~${j.length}~m~${j}`; };
    const send = (m, p) => ws.send(enc({ m, p }));
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 25000);
    let buf = '';
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('open', () => {
      send('set_auth_token', ['unauthorized_user_token']);
      send('chart_create_session', ['cs_x', '']);
      send('resolve_symbol', ['cs_x', 'sds_sym_1', `={"symbol":"${sym}","adjustment":"splits"}`]);
      send('create_series', ['cs_x', 'sds_1', 's1', 'sds_sym_1', tf, n, '']);
    });
    ws.on('message', (d) => {
      const m = d.toString();
      if (/^~m~\d+~m~~h~\d+$/.test(m)) { ws.send(m); return; }
      if (m.includes('symbol_error') || m.includes('critical_error')) { clearTimeout(timer); ws.close(); reject(new Error('symbol_error')); return; }
      buf += m;
      const x = buf.match(/"s":\[(.*?)\],"ns"/s);
      if (x) { clearTimeout(timer); ws.close(); resolve(JSON.parse('[' + x[1] + ']').map((b) => b.v)); }
    });
  });
}

async function run(PAIR) {
  const FILE = `${OUT}/${TF}/${PAIR}.json`;
  let old = { pair: PAIR, tf: TF, bars: [] };
  try { old = JSON.parse(readFileSync(FILE, 'utf8')); } catch { /* 1er passage */ }
  const fresh = (await fetchBars(`IC:${PAIR}`, TF, old.bars.length ? N_UPDATE : N_FIRST)).filter((b) => b.slice(0, 5).every((v) => v != null)).map((b) => b.slice(0, 5));
  if (fresh.length < 10) throw new Error('trop peu de barres reçues : ' + fresh.length);
  const map = new Map(old.bars.map((b) => [b[0], b]));
  for (const b of fresh) map.set(b[0], b); // même horodatage = barre remplacée par la plus récente
  const bars = [...map.values()].sort((a, b) => a[0] - b[0]);
  if (bars.length < old.bars.length) throw new Error('fusion incohérente');
  mkdirSync(`${OUT}/${TF}`, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ pair: PAIR, tf: TF, updated: new Date().toISOString(), bars }));
  const RECENT = +(process.env.RECENT || 0); // petit fichier « récent » (dernières barres) : c'est lui que le site relit souvent, le fichier complet n'est lu qu'au 1er chargement
  if (RECENT) writeFileSync(`${OUT}/${TF}/${PAIR}.recent.json`, JSON.stringify({ pair: PAIR, tf: TF, updated: new Date().toISOString(), bars: bars.slice(-RECENT) }));
  console.log(`${PAIR} ${TF} : ${old.bars.length} -> ${bars.length} barres (dernière ${new Date(bars[bars.length - 1][0] * 1000).toISOString()})`);
}
let fails = 0;
for (const p of PAIRS) {
  try { await run(p); } catch (e) {
    try { await run(p); } catch (e2) { fails++; console.error(`ECHEC ${p} : ${e2.message}`); } // 1 nouvel essai
  }
}
if (fails) process.exitCode = fails === PAIRS.length ? 1 : 0; // échec total seulement = workflow rouge
