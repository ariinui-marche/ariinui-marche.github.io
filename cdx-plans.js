// Calcul des plans / zones / sweeps Arii CDX SW sur les barres récentes — fonctions pures (sans DOM) : exécutées dans un Web Worker (cdx-worker.js) pour ne jamais bloquer
// l'affichage ; repli sur le fil principal si les Workers ne sont pas disponibles. Code déplacé tel quel depuis script.js (candlePlansGet / candleSweepMarks).
(function () {
'use strict';
const root = typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis;
function sweepMarks(bars, i0, prevU, keyOf, isPoh) { // règle de l'EA MT5 / Pine : le plus haut (bas) d'une période dépasse celui de la période précédente et la clôture de la période revient dessous (dessus) -> marque sur la barre de l'extrême
  const out = []; let ci = null, ch = 0, cl = 0, cc = 0, hb = 0, lb = 0, ph = 0, pl = 0, hP = false;
  const flush = () => {
    if (ci === null || !hP) return;
    if (ch > ph && cc < ph && bars[hb][0] >= prevU) out.push({ t: bars[hb][0], p: ch, hi: true });
    if (cl < pl && cc > pl && bars[lb][0] >= prevU) out.push({ t: bars[lb][0], p: cl, hi: false });
  };
  for (let i = i0; i < bars.length; i++) {
    const b = bars[i], k = keyOf(b[0]);
    if (k !== ci) {
      if (ci !== null) { flush(); if (isPoh && (k < ci || (i > i0 && b[0] - bars[i - 1][0] > 43200))) hP = false; else { ph = ch; pl = cl; hP = true; } }
      ci = k; ch = b[2]; cl = b[3]; hb = lb = i;
    } else { if (b[2] > ch) { ch = b[2]; hb = i; } if (b[3] < cl) { cl = b[3]; lb = i; } }
    cc = b[4];
  }
  flush();
  return out;
}
// bs : fenêtre des dernières barres du timeframe (30 000 en 1 min, 15 000 en 5 min) ; m1 : barres 1 min couvrant cette fenêtre (mode 5 min) sinon null
function compute(bs, m1, tf) {
  const CDX = root.CDX, lb = bs[bs.length - 1], t0 = bs[0][0];
  let plans = [], zones = null;
  try {
    const bars = bs, px = lb[4], digits = px >= 1000 ? 2 : px >= 20 ? 3 : 5;
    const out = CDX.run(bs, digits, Object.assign({ tfMin: +tf, m1, atr1: m1 ? CDX.atrSeries(m1) : null }, CDX.brokerKeys));
    const tMin = t0 + 7 * 86400; // les 7 premiers jours de la fenêtre servent à chauffer le moteur (niveaux de session, sweeps)
    const tm = (k) => bs[Math.max(0, Math.min(bs.length - 1, k))][0], zi = out.zones;
    zones = { ifv: zi.ifv.map((g) => ({ ib: g.ib, hot: g.hot, ts: tm(g.left), ot: g.ot, obt: g.obt })), bprs: zi.bprs.map((g) => ({ bull: g.bull, ts: tm(g.left), te: tm(g.cr + 2), ot: g.ot, obt: g.obt })), fvg: [] };
    { // FVG de session (règle de l'EA MT5) : non comblés, jour de trading précédent + en cours, couleur de la session de la bougie du milieu, 300 derniers
      const n = bars.length - 1, startU = Math.floor((lb[0] - 36000 - 43200) / 86400) * 86400 + 36000 + 43200, prevU = startU - 86400;
      let i0 = n; while (i0 > 2 && bars[i0 - 2][0] >= prevU - 3 * 86400) i0--;
      for (let i = Math.max(2, i0); i < n; i++) {
        const b2 = bars[i - 2], bi = bars[i], bu = bi[3] > b2[2], be = bi[2] < b2[3];
        if ((!bu && !be) || bars[i - 1][0] < prevU) continue;
        let mit = false;
        for (let k = i + 1; k < n && !mit; k++) mit = bu ? bars[k][3] <= b2[2] : bars[k][2] >= b2[3];
        if (mit) continue;
        zones.fvg.push({ ts: b2[0], top: bu ? bi[3] : b2[3], bot: bu ? b2[2] : bi[2], sid: CDX.sidOf(CDX.hourLoc(bars[i - 1][0])) });
      }
      if (zones.fvg.length > 300) zones.fvg.splice(0, zones.fvg.length - 300);
      let j0 = n; while (j0 > 0 && bars[j0][0] >= prevU - 2 * 86400) j0--; // marqueurs de sweep : POH (●), daily (●), 4H (★)
      zones.sw = { poh: sweepMarks(bars, j0, prevU, CDX.pohIx, true), d: sweepMarks(bars, j0, prevU, CDX.brokerKeys.d1, false), h4: sweepMarks(bars, j0, prevU, CDX.brokerKeys.h4, false) };
    }
    plans = out.filter((p) => (p.vis || p.end === null) && p.t >= tMin).map((p) => ({ ts: bs[p.i][0], te: p.ie !== undefined ? bs[p.ie][0] : null, lg: p.lg, e: p.e, s: p.s, pic: p.pic, vis: p.vis, sid: p.sid, kind: p.kind, end: p.end, info: p.info || {}, pips: Math.abs(p.e - p.s) / CDX.pipOf(digits), dec: digits === 2 ? 2 : digits === 3 ? 3 : 5, tf }));
  } catch (err) { plans = []; }
  return { plans, zones };
}
const API = { compute, sweepMarks };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.CDXP = API;
})();
