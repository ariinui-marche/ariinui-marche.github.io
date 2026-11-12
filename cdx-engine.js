// Moteur Arii CDX SW en JavaScript — port ligne a ligne de tools/cdx_engine.py (specification executable).
// Entree : barres [[t_utc, o, h, l, c], ...] d'un meme timeframe (1 ou 5 min). Sortie : liste de plans.
// Utilisable sous Node (module.exports) et dans le navigateur (window.CDX).
(function () {
'use strict';

const LOC = -10 * 3600;                                   // UTC-10 (fuseau des Killzones)
const SESS = { 1: [14, 17], 2: [22, 2], 3: [2, 3], 4: [3, 7] };   // Asia, London, NY AM, NY Lunch (heures locales UTC-10)

const fdiv = (a, b) => Math.floor(a / b);                 // division entiere a la Python (//)
const pmod = (a, b) => ((a % b) + b) % b;                 // modulo a la Python (%)
const nn = (x) => x !== null && x !== undefined;

function hourLoc(t) { return pmod(fdiv(t + LOC, 3600), 24); }
function inSess(h, k) { const [a, b] = SESS[k]; return a < b ? (a <= h && h < b) : (h >= a || h < b); }
function sidOf(h) { for (const k of [1, 2, 3, 4]) if (inSess(h, k)) return k; return 0; }
function tdkey(t) { return fdiv(t + LOC - 43200, 86400); }
function domUtc2(t) { return fdiv(t + 2 * 3600, 86400); }
function pohIx(t) {
  const hh = pmod(hourLoc(t) + 12, 24);
  return hh < 2 ? 0 : hh < 3 ? 1 : hh < 5 ? 2 : hh < 10 ? 3 : hh < 11 ? 4 : hh < 14 ? 5 : hh < 15 ? 6 : hh < 19 ? 7 : 8;
}

class Swp {   // f_swp
  constructor() { this.ch = this.cl = this.ph = this.pl = null; }
  step(np, rs, h, l, c) {
    if (np || this.ch === null) {
      if (this.ch !== null) { this.ph = rs ? null : this.ch; this.pl = rs ? null : this.cl; }
      this.ch = h; this.cl = l;
    } else { this.ch = Math.max(this.ch, h); this.cl = Math.min(this.cl, l); }
    return [nn(this.ph) && this.ch > this.ph && c < this.ph, nn(this.pl) && this.cl < this.pl && c > this.pl];
  }
}

class Dx {    // f_dx2
  constructor() { this.ch = this.cl = this.chb = this.clb = this.ph = this.pl = null; this.chOk = this.clOk = false; }
  step(np, i, h, l, c) {
    if (np || this.ch === null) {
      if (this.ch !== null) { this.ph = this.ch; this.pl = this.cl; }
      this.ch = h; this.cl = l; this.chb = i; this.clb = i;
      this.chOk = this.clOk = false;
    } else {
      if (h > this.ch) { this.ch = h; this.chb = i; }
      if (l < this.cl) { this.cl = l; this.clb = i; }
    }
    if (nn(this.ph) && this.ch > this.ph && c < this.ph) this.chOk = true;
    if (nn(this.pl) && this.cl < this.pl && c > this.pl) this.clOk = true;
    return [this.chOk, i - this.chb, this.clOk, i - this.clb];
  }
}

class Once {
  constructor() { this.dn = false; }
  step(ev, np) {
    if (np) this.dn = false;
    const r = ev && !this.dn;
    if (r) this.dn = true;
    return r;
  }
}

class KZ {
  constructor(k) { this.k = k; this.lines = []; this.prevT = false; }
  step(h, hi, lo) {
    const t = inSess(h, this.k);
    if (t && !this.prevT) {
      this.lines.unshift([hi, lo]);
      if (this.lines.length > 20) this.lines.pop();
    } else if (t && this.lines.length) {
      if (hi > this.lines[0][0]) this.lines[0][0] = hi;
      if (lo < this.lines[0][1]) this.lines[0][1] = lo;
    }
    this.prevT = t;
  }
}

function popAll(arrs, i) { for (const a of arrs) a.splice(i, 1); }

class PzEng {   // f_pz_eng
  constructor() {
    this.rt = []; this.rb = []; this.rbl = []; this.rn = [];
    this.h1 = this.h2 = this.l1 = this.l2 = null; this.n = 0;
    this.qt = []; this.qb = []; this.qbl = []; this.qn = [];
  }
  step(o, h, l, c, lim, atr, bprDist = 10) {
    let dr = 0, tp = null, bt = null, pr = 0, pt = null, pb = null;
    this.n++;
    for (let i = this.rt.length - 1; i >= 0; i--) {
      const bl = this.rbl[i]; const old = this.n - this.rn[i] > lim;
      const inv = bl ? (c < this.rb[i]) : (c > this.rt[i]);
      if (!old && inv && Math.abs(c - o) >= atr * 0.3) { dr = bl ? -1 : 1; tp = this.rt[i]; bt = this.rb[i]; }
      if (old || inv) popAll([this.rt, this.rb, this.rbl, this.rn], i);
    }
    const bu = nn(this.h2) && l > this.h2;
    const be = nn(this.l2) && h < this.l2;
    if ((bu || be) && (bu ? (l - this.h2) : (this.l2 - h)) >= atr * 0.2) {
      const ft = bu ? l : this.l2; const fb = bu ? this.h2 : h;
      for (let j = this.qt.length - 1; j >= 0; j--) {
        if (this.n - this.qn[j] > bprDist * 5) popAll([this.qt, this.qb, this.qbl, this.qn], j);
        else if (this.qbl[j] !== bu && Math.min(ft, this.qt[j]) - Math.max(fb, this.qb[j]) > atr * 0.1) {
          pr = bu ? 1 : -1; pt = Math.min(ft, this.qt[j]); pb = Math.max(fb, this.qb[j]);
          popAll([this.qt, this.qb, this.qbl, this.qn], j);
        }
      }
      this.qt.push(ft); this.qb.push(fb); this.qbl.push(bu); this.qn.push(this.n);
      this.rt.push(bu ? l : this.l2); this.rb.push(bu ? this.h2 : h); this.rbl.push(bu); this.rn.push(this.n);
    }
    this.h2 = this.h1; this.h1 = h; this.l2 = this.l1; this.l1 = l;
    return [dr, tp, bt, pr, pt, pb];
  }
}

class M1Zones {   // f_m1_run / f_m1_red
  constructor() { this.p = [null, null, null, null]; this.k = 0; this.r = []; this.pend = []; }
  run(bars1, atr1, rd, z, i, rdSu, rdSd) {
    for (let q = 0; q < bars1.length; q++) {
      const [, o, h, l, c] = bars1[q]; const a = atr1[q];
      this.k++;
      const hp2 = this.p[1], lp2 = this.p[3];
      if (nn(hp2)) {
        const bull = l > hp2, bear = h < lp2;
        const kk = bull ? 1 : bear ? -1 : 0;
        const nt = bull ? l : lp2, nb = bull ? hp2 : h;
        if (kk !== 0 && nt - nb >= a * 0.2) {
          for (let ii = this.r.length - 1; ii >= 0; ii--) {
            const rr = this.r[ii];
            if (rr.k === -kk && !rr.u && this.k - rr.n <= 10) {
              const ot = Math.min(nt, rr.t), ob = Math.max(nb, rr.b);
              if (ot - ob > a * 0.1) { rr.u = true; z.push([ot, ob, 0, i]); break; }
            }
          }
          this.r.push({ t: nt, b: nb, k: kk, n: this.k, u: false });
        }
      }
      for (let ii = this.r.length - 1; ii >= 0; ii--) {
        const rr = this.r[ii];
        const inv = rr.k > 0 ? (c < rr.b) : (c > rr.t);
        const age = this.k - rr.n;
        if (inv && age <= 30 && Math.abs(c - o) >= a * 0.3) this._red(rr.t, rr.b, rr.k < 0, rd, z, i, rdSu, rdSd);
        if ((inv && age <= 30) || age > 35) this.r.splice(ii, 1);
      }
      for (let ii = this.pend.length - 1; ii >= 0; ii--) {
        if (rd === null) break;
        const qq = this.pend[ii]; const ib = qq[2];
        const hit = (ib ? (h - rd[1]) : (rd[0] - l)) + (rd[0] - rd[1]) / 2 > 0;
        if (hit || (ib ? rdSd : rdSu) === 2) {
          if (hit) z.push([qq[0], qq[1], ib ? 1 : -1, i]);
          this.pend.splice(ii, 1);
        }
      }
      this.p[1] = this.p[0]; this.p[3] = this.p[2]; this.p[0] = h; this.p[2] = l;
    }
    if (this.r.length > 50) this.r.shift();
  }
  _red(t, b, ib, rd, z, i, rdSu, rdSd) {
    if (rd === null) return;
    const r = rd[0] - rd[1]; const e = ib ? rd[1] : rd[0];
    const f = ib ? (e - b) : (t - e);
    if ((ib ? (e - t) : (b - e)) >= 0 && f <= r && (ib ? rdSd : rdSu) === 1) {
      if (f <= r / 2) z.push([t, b, ib ? 1 : -1, i]);
      else this.pend.push([t, b, ib]);
    }
  }
}

function pipOf(digits) { return Math.pow(10, -digits) * ((digits === 3 || digits === 5) ? 10 : 1); }

function keepLast(a, n) { if (a.length > n) a.splice(0, a.length - n); }

// Champ ajoute par rapport au Python (affichage seulement) : plan.ie = index de la barre de fin (absent tant que le plan est actif).
// opts : { tfMin, slPips, fvgMinPips, minRiskPips, swWinBase, d1, h4, w1, mn1, trace, m1, atr1, swInval, ifvgLog }
function run(bars, digits, opts) {
  const o_ = Object.assign({ tfMin: 1, slPips: 1.0, fvgMinPips: 2.0, minRiskPips: 3.0, swWinBase: 20, trace: null, m1: null, atr1: null, swInval: 0, ifvgLog: null }, opts || {});
  const { tfMin, slPips, fvgMinPips, minRiskPips, d1, h4, w1, mn1, trace, m1, atr1, swInval, ifvgLog } = o_;
  const pip = pipOf(digits);
  const swWin = o_.swWinBase * (tfMin === 1 ? 5 : 1);
  const KZNAME = { 1: 'Asia', 2: 'London', 3: 'NY AM', 4: 'NY Lunch' };
  const kzs = { 1: new KZ(1), 2: new KZ(2), 3: new KZ(3), 4: new KZ(4) };
  const kzList = [kzs[1], kzs[2], kzs[3], kzs[4]];
  let ddKey = null, ddH = null, ddL = null, pdh = null, pdl = null;
  let bPrevDom = null, cH = null, cL = null, cDone = false, bHi = null, bLo = null;
  const sPoh = new Swp(), sD = new Swp(), s4 = new Swp(), sW = new Swp(), sM = new Swp();
  const oUq = new Once(), oLp = new Once(), oUd = new Once(), oLd = new Once(), oUh = new Once(), oLh = new Once(), oUw = new Once(), oLw = new Once(), oUm = new Once(), oLm = new Once();
  const dxd = new Dx(), dxw = new Dx();
  const prev = {};
  let swDir = 0, swBar = null, swNm = '', swoUp = null, swoDn = null;
  let act = null; const fl = []; const plans = [];
  let atr = null; let rawBull = [], rawBear = []; let sxBar = null, sxDir = 0, sxUsed = -1;
  let rdSu = 0, rdSd = 0; const rdPend = []; let rdLast = null, plSeen = null; const plUsed = [];
  const mode5 = (tfMin === 5 && m1 !== null && m1 !== undefined);
  const y1 = []; const zz = []; const m1z = new M1Zones(); const pz1 = new PzEng(), pz3 = new PzEng();
  let k3 = null, o3 = null, h3 = null, l3 = null, c3 = null;
  const ifv = []; const bprs = []; const cfDays = []; let jm = 0;
  let created = false;
  const n = bars.length;

  for (let i = 0; i < n; i++) {
    const [t, o, h, l, c] = bars[i];
    const hl = hourLoc(t);
    // ---------- jour de trading : PDH/PDL
    const kd0 = tdkey(t);
    if (ddKey !== kd0) { pdh = ddH; pdl = ddL; ddKey = kd0; ddH = h; ddL = l; }
    else { ddH = Math.max(ddH, h); ddL = Math.min(ddL, l); }
    // ---------- boite 14H
    const domv = domUtc2(t);
    const isNew = bPrevDom !== null && domv !== bPrevDom;
    bPrevDom = domv;
    const inPer = hl === 14;
    if (!inPer && !cDone && cH !== null) cDone = true;
    if (isNew) { cDone = false; cH = cL = bHi = bLo = null; }
    if (inPer && !cDone) { cH = cH === null ? h : Math.max(cH, h); cL = cL === null ? l : Math.min(cL, l); }
    if (cDone && bHi === null) { bHi = cH; bLo = cL; }
    // ---------- pivots Killzone
    for (const kz of kzList) kz.step(hl, h, l);
    // ---------- sweeps
    const pix = pohIx(t);
    const pt = prev.t;
    const pPix = prev.pix !== undefined ? prev.pix : pix;
    const npP = pix !== pPix;
    const rsP = pix < pPix || (nn(pt) && t - pt > 43200);
    const kd = d1(t), k4 = h4(t), kw = w1(t), km = mn1(t);
    const npD = (prev.kd !== undefined ? prev.kd : kd) !== kd;
    const np4 = (prev.k4 !== undefined ? prev.k4 : k4) !== k4;
    const npW = (prev.kw !== undefined ? prev.kw : kw) !== kw;
    const npM = (prev.km !== undefined ? prev.km : km) !== km;
    const [psh, psl] = sPoh.step(npP, rsP, h, l, c);
    const [dsh, dsl] = sD.step(npD, false, h, l, c);
    const [hsh, hsl] = s4.step(np4, false, h, l, c);
    const [wsh, wsl] = sW.step(npW, false, h, l, c);
    const [msh, msl] = sM.step(npM, false, h, l, c);
    const [dh, dhA, dl, dlA] = dxd.step(npD, i, h, l, c);
    const [wh, whA, wl, wlA] = dxw.step(npW, i, h, l, c);
    const uq = oUq.step(psh, npP), lp = oLp.step(psl, npP);
    const ud = oUd.step(dsh, npD), ld = oLd.step(dsl, npD);
    const uh = oUh.step(hsh, np4), lh = oLh.step(hsl, np4);
    const uw = oUw.step(wsh, npW), lw = oLw.step(wsl, npW);
    const um = oUm.step(msh, npM), lm = oLm.step(msl, npM);
    const up = uq || ud || uh || uw || um;
    const dn = lp || ld || lh || lw || lm;
    if (up && !dn) swDir = -1;
    else if (dn && !up) swDir = 1;
    if (up && !dn) { swNm = uq ? 'POH' : ud ? 'daily' : uh ? '4H' : uw ? 'weekly' : 'monthly'; swBar = i; }
    if (dn && !up) { swNm = lp ? 'POH' : ld ? 'daily' : lh ? '4H' : lw ? 'weekly' : 'monthly'; swBar = i; }
    if (uq || ud || uw || um) swoUp = i;
    if (lp || ld || lw || lm) swoDn = i;
    const sdb = swDir === 1 ? swoDn : swoUp;
    const sw4Blk = swNm === '4H' && swBar !== null && i - swBar <= swWin && !(nn(sdb) && i - sdb <= swWin);
    prev.t = t; prev.pix = pix; prev.kd = kd; prev.k4 = k4; prev.kw = kw; prev.km = km;
    // ---------- ATR 14 (RMA) et moteur IFVG / BPR du graphique
    const tr = i === 0 ? (h - l) : Math.max(h - l, Math.abs(h - bars[i - 1][4]), Math.abs(l - bars[i - 1][4]));
    atr = atr === null ? tr : (atr * 13 + tr) / 14;
    const events = [];
    const detBull = i >= 2 && l > bars[i - 2][2];
    const detBear = i >= 2 && h < bars[i - 2][3];
    const minSz = atr * 0.2;
    if (detBull && l - bars[i - 2][2] >= minSz) { rawBull.push({ top: l, bot: bars[i - 2][2], cb: i, inv: false, used: false }); keepLast(rawBull, 50); }
    if (detBear && bars[i - 2][3] - h >= minSz) { rawBear.push({ top: bars[i - 2][3], bot: h, cb: i, inv: false, used: false }); keepLast(rawBear, 50); }
    rawBull = rawBull.filter((r) => i - r.cb <= 35);
    rawBear = rawBear.filter((r) => i - r.cb <= 35);
    const disp = Math.abs(c - o) >= atr * 0.3;
    for (const [srcBull, arr] of [[true, rawBull], [false, rawBear]]) {
      for (let q = arr.length - 1; q >= 0; q--) {
        const r = arr[q];
        const inv = srcBull ? (c < r.bot) : (c > r.top);
        if (!r.inv && i - r.cb <= 30 && inv && disp) {
          r.inv = true;
          const ob = { ib: !srcBull, top: r.top, bot: r.bot, ct: r.top, cb: r.bot, ot: r.top, obt: r.bot, left: r.cb - 2, mit: false, hot: false };
          ifv.push(ob); keepLast(ifv, 5);
          events.push([1, srcBull ? -1 : 1, r.top, r.bot, r.cb, ob]);
        }
      }
    }
    for (const [newBull, det, arr, tt, bb] of [
      [true, detBull, rawBear, l, i >= 2 ? bars[i - 2][2] : 0],
      [false, detBear, rawBull, i >= 2 ? bars[i - 2][3] : 0, h]]) {
      if (det && tt - bb >= minSz) {
        for (let q = arr.length - 1; q >= 0; q--) {
          const r = arr[q];
          const ot = Math.min(tt, r.top), ob = Math.max(bb, r.bot);
          if (!r.used && i - r.cb <= 10 && ot - ob > atr * 0.1) {
            r.used = true;
            const bo = { bull: newBull, ct: ot, cb: ob, ot: ot, obt: ob, left: Math.min(i - 2, r.cb - 2), mit: false };
            bprs.push(bo); keepLast(bprs, 5);
            events.push([2, newBull ? 1 : -1, ot, ob, i, bo]);
            break;
          }
        }
      }
    }
    if (ifvgLog) for (const ev of events) if (ev[0] === 1) ifvgLog.push([t, ev[1], ev[2], ev[3]]);
    // ---------- IFVG rouge (f_rd_apply / f_rd_pend)
    const rdOk = bHi !== null && bLo !== null;
    if (!rdOk) { rdSu = rdSd = 0; rdPend.length = 0; }
    else {
      const rdR = bHi - bLo;
      rdSu = Math.max(rdSu, h >= bHi + rdR ? 2 : h >= bHi + rdR / 2 ? 1 : 0);
      rdSd = Math.max(rdSd, l <= bLo - rdR ? 2 : l <= bLo - rdR / 2 ? 1 : 0);
      for (const ev of events) {
        if (ev[0] !== 1) continue;
        const ib = ev[1] === 1; const top_ = ev[2], bot_ = ev[3];
        const e_ = ib ? bLo : bHi;
        const n_ = ib ? e_ - top_ : bot_ - e_;
        const f_ = ib ? e_ - bot_ : top_ - e_;
        if (n_ >= 0 && f_ <= rdR && (ib ? rdSd : rdSu) === 1) {
          if (f_ <= rdR / 2) { rdLast = { left: ev[4] - 2, ib, bn: i }; ev[5].hot = true; }
          else rdPend.push({ ib, left: ev[4] - 2, ob: ev[5] });
        }
      }
      for (const q of rdPend.slice().reverse()) {
        const ib = q.ib;
        const hit = (ib ? (h - bLo) : (bHi - l)) + rdR / 2 > 0;
        if (hit || (ib ? rdSd : rdSu) === 2) {
          if (hit) { rdLast = { left: q.left, ib, bn: i }; q.ob.hot = true; }
          rdPend.splice(rdPend.indexOf(q), 1);
        }
      }
    }
    // ---------- mise a jour des IFVG / BPR du graphique (gf_update_fvg)
    for (const [lst, isb] of [[ifv, 'ib'], [bprs, 'bull']]) {
      for (const ob of lst.slice()) {
        const bb = ob[isb];
        if (bb ? (c <= ob.cb) : (c >= ob.ct)) { lst.splice(lst.indexOf(ob), 1); continue; }
        if (ob.cb <= c && c <= ob.ct) {
          ob.mit = true;
          const nt_ = Math.min(c, ob.ct), nb_ = Math.max(c, ob.cb);
          if (bb && nt_ > ob.cb && nt_ < ob.ot) ob.ct = nt_;
          if (!bb && nb_ < ob.ct && nb_ > ob.obt) ob.cb = nb_;
        }
      }
    }
    if (isNew) { cfDays.push(i); keepLast(cfDays, 40); }
    // ---------- sweeps de depart du plan sweep + IFVG/BPR
    const eHi = (psh && !prev.psh) || (dsh && !prev.dsh) || (hsh && !prev.hsh);
    const eLo = (psl && !prev.psl) || (dsl && !prev.dsl) || (hsl && !prev.hsl);
    if (eHi) { sxBar = i; sxDir = -1; }
    if (eLo) { sxBar = i; sxDir = 1; }
    prev.psh = psh; prev.dsh = dsh; prev.hsh = hsh; prev.psl = psl; prev.dsl = dsl; prev.hsl = hsl;
    // ---------- mode 5 min
    let pzHit5 = null, pzSrc = '';
    const lvs = [];
    if (bHi !== null && bLo !== null) {
      const rg_ = bHi - bLo;
      lvs.push(bHi, bLo, (bHi + bLo) / 2);
      for (let kk = 1; kk <= 10; kk++) lvs.push(bHi + kk * 0.5 * rg_, bLo - kk * 0.5 * rg_);
    }
    for (const kz of kzList) for (const [a_, b_] of kz.lines) lvs.push(a_, b_);
    if (pdh !== null && pdl !== null) lvs.push(pdh, pdl);
    if (mode5) {
      const g1 = [];
      while (jm < m1.length && m1[jm][0] < t) jm++;
      let jj = jm;
      while (jj < m1.length && m1[jj][0] < t + 300) { g1.push(jj); jj++; }
      const rdb = (bHi !== null && bLo !== null) ? [bHi, bLo] : null;
      for (const gx of g1) {
        if (gx < 2) continue;
        const x0 = m1[gx], x1 = m1[gx - 1], x2 = m1[gx - 2];
        const bu1 = x0[3] > x2[2], be1 = x0[2] < x2[3];
        if ((bu1 || be1) && (x1[2] - x1[3]) >= fvgMinPips * pip) {
          const tt_ = bu1 ? x0[3] : x2[3]; const bb_ = bu1 ? x2[2] : x0[2];
          if (lvs.some((v) => bb_ <= v && v <= tt_)) { y1.push([tt_, bb_, bu1 ? 1 : -1, i]); keepLast(y1, 60); }
        }
      }
      if (g1.length) {
        m1z.run(g1.map((x) => m1[x]), g1.map((x) => atr1[x]), rdb, zz, i, rdSu, rdSd); keepLast(zz, 60);
        for (const gx of g1) {
          const [qT, qO, qH, qL, qC] = m1[gx];
          const [d1_, t1_, b1_, p1_, u1_, v1_] = pz1.step(qO, qH, qL, qC, 150, atr);
          if (p1_ !== 0) zz.push([u1_, v1_, 5 * p1_, i]);
          if (d1_ !== 0 && d1_ === sxDir && pzHit5 === null) { pzHit5 = [t1_, b1_]; pzSrc = '1m IFVG'; }
          if (p1_ !== 0 && p1_ === sxDir && pzHit5 === null) { pzHit5 = [u1_, v1_]; pzSrc = '1m BPR'; }
          const qK = fdiv(qT, 180);
          if (k3 !== null && qK !== k3) {
            const [d3_, t3_, b3_, p3_, u3_, v3_] = pz3.step(o3, h3, l3, c3, 50, atr);
            if (p3_ !== 0) zz.push([u3_, v3_, 6 * p3_, i]);
            if (d3_ !== 0 && d3_ === sxDir && pzHit5 === null) { pzHit5 = [t3_, b3_]; pzSrc = '3m IFVG'; }
            if (p3_ !== 0 && p3_ === sxDir && pzHit5 === null) { pzHit5 = [u3_, v3_]; pzSrc = '3m BPR'; }
          }
          if (k3 === null || qK !== k3) { k3 = qK; o3 = qO; h3 = qH; l3 = qL; c3 = qC; }
          else { h3 = Math.max(h3, qH); l3 = Math.min(l3, qL); c3 = qC; }
        }
      }
    }

    const attempt = (isl, midx, entry, midH, midT, kind, left, info) => {
      plUsed.push(left);
      if (plUsed.length > 60) plUsed.shift();
      const stop = isl ? midx - slPips * pip : midx + slPips * pip;
      const dx = isl ? ((dl && dlA <= swWin) || (wl && wlA <= swWin)) : ((dh && dhA <= swWin) || (wh && whA <= swWin));
      const ntm = 7 <= hl && hl < 14;
      let ok = (isl && stop < entry) || (!isl && stop > entry);
      ok = ok && !(ntm && !dx);
      ok = ok && !((midH === 22 || midH === 14 || midH === 2) && !dx);
      ok = ok && (dx || (swDir === (isl ? 1 : -1) && swBar !== null && i - swBar <= swWin));
      if (swInval > 0 && ok && !dx && swBar !== null) {
        const lo0 = Math.max(0, swBar - swInval);
        if (isl) {
          let mxa = -1e18; for (let q = swBar + 1; q <= i; q++) mxa = Math.max(mxa, bars[q][2]);
          let mxb = -Infinity; for (let q = lo0; q <= swBar; q++) mxb = Math.max(mxb, bars[q][2]);
          if (mxa > mxb) ok = false;
        } else {
          let mna = 1e18; for (let q = swBar + 1; q <= i; q++) mna = Math.min(mna, bars[q][3]);
          let mnb = Infinity; for (let q = lo0; q <= swBar; q++) mnb = Math.min(mnb, bars[q][3]);
          if (mna < mnb) ok = false;
        }
      }
      ok = ok && !(sw4Blk && !dx);
      ok = ok && Math.abs(entry - stop) >= minRiskPips * pip;
      const sid = sidOf(midH);
      const busy = (act !== null && act.lg === isl && act.sid === sid) || fl.some((f) => f.lg === isl && f.sid === sid);
      if (trace) trace.push({ t: midT, lg: isl, kind, ok0: ok, busy, swdir: swDir, swage: swBar !== null ? i - swBar : null, swnm: swNm, dx });
      if (ok && !busy) {
        if (act !== null) {
          act.mfav = act.lg ? Math.max(act.mfav, h) : Math.min(act.mfav, l);
          fl.push(act);
        }
        act = { lg: isl, e: entry, s: stop, mfav: entry, t: midT, i, sid, vis: false, end: null, dx, kind, info: Object.assign({ sw: swNm, swAge: swBar !== null ? i - swBar : null }, info || {}) };   // info : confluences (affichage seulement)
        plans.push(act);
        created = true;
        return true;
      }
      return false;
    };

    // ---------- nouveau FVG forme par les 3 bougies [i-2, i-1, i]
    created = false;
    let cand = false;
    if (i >= 2) {
      const b2 = bars[i - 2], b1 = bars[i - 1];
      const bull = l > b2[2], bear = h < b2[3];
      if (bull || bear) {
        const top = bull ? l : b2[3]; const bot = bull ? b2[2] : h;
        const lv = [], lvn = [];
        if (bHi !== null && bLo !== null) {
          const rg = bHi - bLo;
          lv.push(bHi, bLo, (bHi + bLo) / 2); lvn.push('14H box high', '14H box low', '14H box 50%');
          for (let kk = 1; kk <= 10; kk++) { lv.push(bHi + kk * 0.5 * rg, bLo - kk * 0.5 * rg); lvn.push('14H high +' + (kk * 0.5) + 'R', '14H low -' + (kk * 0.5) + 'R'); }
        }
        for (const kz of kzList) kz.lines.forEach(([a_, b_], q) => { lv.push(a_, b_); const nm = KZNAME[kz.k] + (q === 0 ? '' : ' (-' + q + ')'); lvn.push(nm + ' high', nm + ' low'); });
        if (pdh !== null && pdl !== null) { lv.push(pdh, pdl); lvn.push('PDH', 'PDL'); }
        let hit = lv.some((v) => bot <= v && v <= top);
        const lvHit = []; lv.forEach((v, q) => { if (bot <= v && v <= top && lvHit.length < 3) lvHit.push(lvn[q]); });
        if (hit && (b1[2] - b1[3]) < fvgMinPips * pip) hit = false;
        if (hit) {
          let dom = true; const conf = [];
          if (mode5) {
            const fl_ = i - 2;
            const ov = (a_, b_) => a_ <= top && b_ >= bot;
            const d1c = y1.some((y) => y[3] >= fl_ && y[3] <= fl_ + 2 && (y[2] > 0) === bull && ov(y[1], y[0]));
            const zhas = (kd_) => zz.some((z_) => z_[2] === kd_ && z_[3] >= fl_ && z_[3] <= fl_ + 2 && ov(z_[1], z_[0]));
            let cfd = 0; { const xs = cfDays.filter((x) => x <= fl_); if (xs.length) cfd = Math.max(...xs); }
            const cfLim = (bHi !== null && bLo !== null) ? 2.0 * (bHi - bLo) : 0.0;
            const cfOk = (zt, zb, zl) => {
              if (zt >= bot && zb <= top) return true;
              return zl < fl_ && zl >= cfd && (bull ? (zb <= bot && bot - zt <= cfLim) : (zt >= top && zb - top <= cfLim));
            };
            const d4c = ifv.some((g) => !g.mit && g.hot && g.ib === bull && cfOk(g.ct, g.cb, g.left));
            const ex_ = bull ? Math.min(l, bars[i - 1][3], b2[3]) : Math.max(h, bars[i - 1][2], b2[2]);
            const d5c = bprs.some((g) => (g.ot >= bot && g.obt <= top) || (ex_ <= g.ot && ex_ >= g.obt));
            dom = d1c || zhas(0) || zhas(bull ? 1 : -1) || d4c || d5c || zhas(bull ? 5 : -5) || zhas(bull ? 6 : -6);
            if (d1c) conf.push('1m FVG on a level'); if (zhas(0)) conf.push('1m BPR'); if (zhas(bull ? 1 : -1)) conf.push('1m red IFVG');
            if (d4c) conf.push('Red IFVG (14H box)'); if (d5c) conf.push('5m BPR'); if (zhas(bull ? 5 : -5)) conf.push('1m BPR (sweep)'); if (zhas(bull ? 6 : -6)) conf.push('3m BPR');
          }
          if (dom) {
            cand = true;
            attempt(bull, bull ? b1[3] : b1[2], b1[4], hourLoc(b1[0]), b1[0], 'fvg', i - 2, { levels: lvHit, conf, gap: [bot, top] });
          } else {
            plUsed.push(i - 2);
            if (plUsed.length > 60) plUsed.shift();
          }
        }
      }
    }
    // ---------- plan par IFVG rouge (pl_via)
    let via = false;
    if (!cand && rdLast !== null && i - rdLast.bn <= 2 && (plSeen === null || rdLast.bn !== plSeen)) {
      plSeen = rdLast.bn;
      const lf = rdLast.left;
      if (!plUsed.includes(lf) && 0 <= i - lf - 1 && i - lf - 1 <= 1400) {
        via = true;
        const mb = bars[lf + 1];
        attempt(rdLast.ib, rdLast.ib ? mb[3] : mb[2], mb[4], hourLoc(mb[0]), mb[0], 'rouge', lf, { conf: ['Red IFVG (14H box)'] });
      }
    }
    // ---------- plan sweep + IFVG / BPR (pz_via)
    if (!cand && !via && sxDir !== 0 && sxBar !== null && sxUsed !== sxBar && i - sxBar <= 4) {
      const findEv = () => { for (const e of events) if (e[1] === sxDir) return e; return null; };
      const pz = mode5 ? (pzHit5 !== null ? [0, sxDir, pzHit5[0], pzHit5[1]] : findEv()) : findEv();
      if (pz !== null) {
        const rg = (bHi !== null && bLo !== null) ? (bHi - bLo) : null;
        if (rg === null || (rg > 0 && pz[2] >= bLo - 5 * rg && pz[3] <= bHi + 5 * rg)) {
          if (attempt(sxDir === 1, sxDir === 1 ? l : h, c, hl, t, 'pz', i - 1, { conf: [mode5 && pzHit5 !== null ? pzSrc : (pz[0] === 1 ? 'IFVG' : 'BPR')], zone: [pz[3], pz[2]] })) sxUsed = sxBar;
        }
      }
    }
    // ---------- vie du plan actif
    const h7 = hl === 7 && (i === 0 || hourLoc(bars[i - 1][0]) !== 7);
    if (act !== null && !created) {
      const lg = act.lg;
      act.mfav = lg ? Math.max(act.mfav, h) : Math.min(act.mfav, l);
      const stp = lg ? (l <= act.s) : (h >= act.s);
      if (!act.vis && (lg ? (act.mfav - act.e) : (act.e - act.mfav)) >= 0.5 * Math.abs(act.e - act.s)) {
        act.vis = true;
        for (const f of fl.slice()) {
          f.mfav = f.lg ? Math.max(f.mfav, h) : Math.min(f.mfav, l);
          if ((lg && !f.lg) || (!lg && f.lg)) { f.end = 'contraire'; f.ie = i; fl.splice(fl.indexOf(f), 1); }
        }
      }
      if (stp || h7) { act.end = stp ? 'stop' : '07h'; act.ie = i; act = null; }
    }
    // ---------- plans suivis
    for (const f of fl.slice()) {
      const lg = f.lg;
      f.mfav = lg ? Math.max(f.mfav, h) : Math.min(f.mfav, l);
      const stp = lg ? (l <= f.s) : (h >= f.s);
      if (!f.vis && (lg ? (f.mfav - f.e) : (f.e - f.mfav)) >= 0.5 * Math.abs(f.e - f.s)) f.vis = true;
      if (stp || h7) { f.end = stp ? 'stop' : '07h'; f.ie = i; fl.splice(fl.indexOf(f), 1); }
    }
  }
  for (const p of plans) {
    const r = Math.abs(p.e - p.s);
    p.pic = r ? Math.abs(p.mfav - p.e) / r : 0.0;
  }
  return plans;
}

// ---------- utilitaires : bords de periodes du courtier (UTC+2 / UTC+3 en heure d'ete US) et ATR 1 min
function usDst(utc) {
  const d = new Date(utc * 1000); const y = d.getUTCFullYear();
  const nthSun = (m, nth, hour) => {
    const x = new Date(Date.UTC(y, m - 1, 1));
    const wd = (x.getUTCDay() + 6) % 7;                  // lundi = 0 (comme Python)
    return Date.UTC(y, m - 1, 1 + pmod(6 - wd, 7) + 7 * (nth - 1), hour) / 1000;
  };
  return nthSun(3, 2, 7) <= utc && utc < nthSun(11, 1, 6);
}
function brokerOff(utc) { return usDst(utc) ? 3 * 3600 : 2 * 3600; }
function srv(t) { return t + brokerOff(t); }
const brokerKeys = {
  d1: (t) => fdiv(srv(t), 86400),
  h4: (t) => fdiv(srv(t), 14400),
  w1: (t) => fdiv(fdiv(srv(t), 86400) + 3, 7),
  mn1: (t) => { const d = new Date(srv(t) * 1000); return d.getUTCFullYear() * 12 + (d.getUTCMonth() + 1); },
};
function atrSeries(bars) {
  const out = []; let a = null; let pc = null;
  for (const [, , h, l, c] of bars) {
    const tr = pc === null ? (h - l) : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    a = a === null ? tr : (a * 13 + tr) / 14;
    out.push(a); pc = c;
  }
  return out;
}

const API = { run, usDst, brokerKeys, atrSeries, pipOf, hourLoc };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.CDX = API;
})();
