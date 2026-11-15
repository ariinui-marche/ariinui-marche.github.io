// Web Worker : calcule les plans / zones / sweeps Arii CDX SW HORS du fil principal (l'affichage et les gestes ne sont jamais bloqués, même avec des centaines de milliers de barres).
// Reçoit les barres en Float64Array [t,o,h,l,c, t,o,h,l,c, ...] (transfert sans copie) et renvoie { plans, zones }.
self.window = self;
importScripts('./cdx-engine.js', './cdx-plans.js');
const unpack = (f) => { const n = f.length / 5, a = new Array(n); for (let i = 0, k = 0; i < n; i++, k += 5) a[i] = [f[k], f[k + 1], f[k + 2], f[k + 3], f[k + 4]]; return a; };
self.onmessage = (e) => {
  const m = e.data;
  let res;
  try { res = self.CDXP.compute(unpack(m.bs), m.m1 ? unpack(m.m1) : null, m.tf); } catch (err) { res = { plans: [], zones: null }; }
  self.postMessage({ ck: m.ck, key: m.key, seq: m.seq, res });
};
