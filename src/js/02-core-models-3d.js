  /* ===================== Evidence ===================== */
  const EVIDENCE = {
    lang: {   // Lang RM et al. 2015: sex-specific mean, SD (mm)
      M: { annulus: [26, 3], sov: [34, 3], stj: [29, 3], aa: [30, 4] },
      F: { annulus: [23, 2], sov: [30, 3], stj: [26, 3], aa: [27, 4] }
    },
    devereux: { a: 2.423, age: 0.009, bsa: 0.461, sex: 0.267, see: 0.261 },   // cm
    wase: {   // WASE 2022: BSA-indexed mean, SD (mm/m²)
      M: { '18-40': { annulus: [11.3, 1.3], sov: [16.5, 2.2], stj: [14.1, 2.0] },
           '41-65': { annulus: [11.2, 1.4], sov: [17.4, 2.4], stj: [15.0, 2.2] },
           '>65':   { annulus: [11.3, 1.4], sov: [18.2, 2.7], stj: [15.7, 2.6] } },
      F: { '18-40': { annulus: [12.0, 1.4], sov: [17.3, 2.4], stj: [15.0, 2.2] },
           '41-65': { annulus: [11.7, 1.4], sov: [17.9, 2.4], stj: [15.6, 2.2] },
           '>65':   { annulus: [12.1, 1.6], sov: [19.3, 2.8], stj: [16.6, 2.6] } }
    },
    weissler: { M: { qs2: [546, 2.1], lvet: [413, 1.7] }, F: { qs2: [549, 2.0], lvet: [418, 1.6] } },   // ms
    aorticStrain: { mean: 0.151, sd: 0.036 },
    growth: { sporadic: { oneYear: 5, perYear: 3 }, htad: { oneYear: 3 } },   // mm, 2022 ACC/AHA
    indexed: { asi: 3.08, ahi: 3.21, csa: 10 }   // 2022 ACC/AHA: cm/m², cm/m, cm²/m
  };
  const LEVELS = [
    { key: 'annulus', s: 0 }, { key: 'sov', s: 10 }, { key: 'stj', s: 20 }, { key: 'aa', s: 35 }
  ];
  const LEVEL_COLOURS = { annulus: '#9fb3b8', sov: '#f2aa3f', stj: '#78c9d8', aa: '#c39bdc' };
  const lvName = (key) => t('lvl.' + key);
  const lcFirst = (x) => (/^[A-ZÁÉÍÓÚ]{2}/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));   // keeps acronyms like ESC intact
  const REF_SETS = ['devereux', 'lang', 'wase'];
  const CONVENTIONS = ['le-ed', 'ie-sys', 'le-sys', 'ct-mri'];
  const methodOfConvention = (c) => (c === 'ct-mri' ? 'ctmr' : 'echo');

  const bsaDuBois = (h, w) => 0.007184 * Math.pow(w, 0.425) * Math.pow(h, 0.725);
  const waseGroup = (age) => (age < 41 ? '18-40' : age < 66 ? '41-65' : '>65');
  function referenceFor(p, set) {
    const bsa = bsaDuBois(p.height, p.weight), L = EVIDENCE.lang[p.sex], levels = {};
    for (const lv of LEVELS) levels[lv.key] = { mean: L[lv.key][0], sd: L[lv.key][1], basis: ['basis.lang'] };
    if (set === 'devereux') {
      const d = EVIDENCE.devereux;
      const sovCm = d.a + d.age * p.age + d.bsa * bsa - d.sex * (p.sex === 'M' ? 1 : 2);
      levels.sov = { mean: sovCm * 10, sd: d.see * 10, basis: ['basis.dev'] };
    } else if (set === 'wase') {
      const g = waseGroup(p.age), W = EVIDENCE.wase[p.sex][g];
      for (const k of ['annulus', 'sov', 'stj']) levels[k] = { mean: W[k][0] * bsa, sd: W[k][1] * bsa, basis: ['basis.wase', { g, young: p.age < 18 }] };
      levels.aa.basis = ['basis.langAA'];
    }
    return { bsa, levels };
  }
  const basisText = (b) => (b[0] === 'basis.wase' ? t('basis.wase', { g: b[1].g, note: b[1].young ? t('basis.waseYoung') : '' }) : t(b[0]));

  /* ===================== Helpers ===================== */
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smoothstep = (a, b, x) => { const q = clamp((x - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const $ = (id) => document.getElementById(id);
  const DAY = 864e5;
  const parseDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const yearsBetween = (a, b) => (b - a) / (365.25 * DAY);
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const isoShift = (iso, years) => { const d = new Date(parseDate(iso)); d.setUTCMonth(d.getUTCMonth() + Math.round(years * 12)); return d.toISOString().slice(0, 10); };
  const shortDate = (iso) => { const v = parseDate(iso); return Number.isFinite(v) ? new Date(v).toLocaleDateString(LANG === 'es' ? 'es-ES' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : iso; };
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  function pchip(xs, ys) {   // monotone cubic, no overshoot between landmarks
    const n = xs.length, h = [], d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] > 0) !== (d[i] > 0)) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    }
    return (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
      const q = (x - xs[i]) / h[i], q2 = q * q, q3 = q2 * q;
      return (2 * q3 - 3 * q2 + 1) * ys[i] + (q3 - 2 * q2 + q) * h[i] * m[i] + (-2 * q3 + 3 * q2) * ys[i + 1] + (q3 - q2) * h[i] * m[i + 1];
    };
  }
  function fitCanvas(c) {   // match the canvas to its box at device resolution; false when hidden
    const w = Math.round(c.clientWidth * dpr()), h = Math.round(c.clientHeight * dpr());
    if (!w || !h) return false;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return true;
  }
  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  /* ===================== Cardiac cycle ===================== */
  const REST = { cv: 0, p: 0, open: 0, ka: 1, phase: 'ph.ed', t: 0 };
  function cycleTiming(hr, sex) {
    const w = EVIDENCE.weissler[sex], T = 60 / hr;
    const qs2 = (w.qs2[0] - w.qs2[1] * hr) / 1000, lvet = (w.lvet[0] - w.lvet[1] * hr) / 1000;
    return { T, qs2, lvet, pep: qs2 - lvet, pr: 0.16, qt: 0.41 * Math.sqrt(T), ivrt: 0.08 };
  }
  function cardiacState(tAbs, tm) {   // seconds since QRS onset
    const T = tm.T, x0 = ((tAbs % T) + T) % T;
    const avo = tm.pep, avc = tm.qs2, tF = Math.min(avc + tm.ivrt, T), tA = Math.max(tF, T - 0.12);
    const fillAt = (x) => 0.15 + 0.85 * Math.exp(-(x - tF) / 0.07);
    let cv;
    if (x0 < avo) cv = 0;
    else if (x0 < avc) { const x = (x0 - avo) / (avc - avo); cv = 1 - (1 - x) * (1 - x); }
    else if (x0 < tF) cv = 1;
    else if (x0 < tA) cv = fillAt(x0);
    else { const cA = tA > tF ? fillAt(tA) : 1; cv = cA * (1 - (x0 - tA) / Math.max(T - tA, 1e-3)); }
    let p;
    if (x0 >= avo && x0 < avc) { const x = (x0 - avo) / (avc - avo); p = x < 0.3 ? smoothstep(0, 0.3, x) : 1 - 0.15 * ((x - 0.3) / 0.7); }
    else {
      const since = x0 >= avc ? x0 - avc : x0 + T - avc, D = T - avc + avo, tau = 0.9;
      p = 0.85 * (Math.exp(-since / tau) - Math.exp(-D / tau)) / (1 - Math.exp(-D / tau));
      p -= 0.07 * Math.exp(-Math.pow((since - 0.02) / 0.012, 2));   // dicrotic notch
    }
    p = clamp(p, 0, 1);
    const open = x0 >= avo && x0 < avc ? clamp(Math.min((x0 - avo) / 0.03, (avc - x0) / 0.03), 0, 1) : 0;
    const aStart = T - tm.pr + 0.04, aDur = tm.pr - 0.04 + 0.03;
    const u = x0 >= aStart ? x0 - aStart : x0 + T - aStart;
    const ca = u >= 0 && u <= aDur ? Math.sin(Math.PI * u / aDur) : 0;
    const fa = x0 < tF ? x0 / tF : Math.exp(-(x0 - tF) / 0.08);
    let phase;
    if (x0 < avo) phase = ca > 0.05 ? 'ph.atr' : 'ph.ivc';
    else if (x0 < avc) phase = 'ph.ej';
    else if (x0 < tF) phase = 'ph.ivr';
    else phase = ca > 0.05 ? 'ph.atr' : 'ph.fill';
    return { cv, p, open, ka: 1 + 0.07 * fa - 0.10 * ca, phase, t: x0 };
  }
  function ecgValue(tAbs, tm) {
    const T = tm.T, x = ((tAbs % T) + T) % T;
    const g = (z, c, s, a) => a * Math.exp(-Math.pow((z - c) / s, 2));
    const beat = (z) => g(z, -tm.pr + 0.045, 0.022, 0.12) + g(z, 0.012, 0.008, -0.10) + g(z, 0.035, 0.009, 1.0) + g(z, 0.058, 0.009, -0.24) + g(z, tm.qt - 0.09, 0.045, 0.28);
    return beat(x) + beat(x - T);
  }

  /* ===================== Geometry ===================== */
  // World units are millimetres. x = patient left, y = superior, z = anterior.
  const RAW = 220, WALL = 2.0, NS = 340, M = 72, LOBE = 0.12, SINUS_TOP = 20, VALVE_TOP = 14, PROFILE_MAX = 45;
  const CL_POINTS = [
    V(0, 0, 0), V(-2, 10, 3), V(-5, 22, 6), V(-9, 40, 9), V(-12, 60, 9), V(-11, 78, 4),
    V(-5, 92, -6), V(6, 100, -20), V(18, 98, -36), V(25, 86, -50), V(27, 65, -58),
    V(27, 35, -62), V(26, 0, -64), V(25, -40, -64)
  ];
  const curve = new THREE.CatmullRomCurve3(CL_POINTS, false, 'centripetal');
  const LEN = curve.getLength();
  const cl = { s: new Float32Array(NS), P: [], T: [], N: [], B: [] };
  for (let i = 0; i < NS; i++) {   // parallel-transport frames avoid Frenet flips
    const u = i / (NS - 1);
    cl.s[i] = u * LEN;
    cl.P.push(curve.getPointAt(u));
    const T = curve.getTangentAt(u).normalize();
    let N;
    if (i === 0) N = V(0, 0, 1).sub(T.clone().multiplyScalar(T.z)).normalize();
    else { const prev = cl.N[i - 1]; N = prev.clone().sub(T.clone().multiplyScalar(prev.dot(T))).normalize(); }
    cl.T.push(T); cl.N.push(N); cl.B.push(V(0, 0, 0).crossVectors(T, N));
  }
  function nearestS(p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < NS; i++) { const d = cl.P[i].distanceToSquared(p); if (d < bd) { bd = d; best = i; } }
    return cl.s[best];
  }
  const S_ARCH = nearestS(CL_POINTS[5]), S_DESC = nearestS(CL_POINTS[9]);
  function frameAt(s) {
    const f = clamp(s / LEN, 0, 1) * (NS - 1);
    const i = Math.min(Math.floor(f), NS - 2), q = f - i;
    const P = cl.P[i].clone().lerp(cl.P[i + 1], q);
    const T = cl.T[i].clone().lerp(cl.T[i + 1], q).normalize();
    const N = cl.N[i].clone().lerp(cl.N[i + 1], q);
    N.sub(T.clone().multiplyScalar(N.dot(T))).normalize();
    return { P, T, N, B: V(0, 0, 0).crossVectors(T, N) };
  }
  function screenAxes(T) {
    let U = V(0, 0, 1).sub(T.clone().multiplyScalar(T.z));
    if (U.length() < 0.35) U = V(0, 1, 0).sub(T.clone().multiplyScalar(T.y));
    U.normalize();
    return { U, R: V(0, 0, 0).crossVectors(T, U).normalize() };
  }
  function levelKeyAt(s) {
    if (s < 2.5) return 'lvl.annulus';
    if (s < 17) return 'lvl.sov';
    if (s < 23) return 'lvl.stj';
    if (s < S_ARCH) return 'lvl.aa';
    if (s < S_DESC) return 'lvl.arch';
    return 'lvl.desc';
  }
  function aortaPartKey(s) {
    if (s < 23) return 'an.root';
    if (s < S_ARCH) return 'an.asc';
    if (s < S_DESC) return 'an.arch';
    return 'an.desc';
  }
  const lobe = (s) => (s > 0 && s < SINUS_TOP ? LOBE * Math.sin(Math.PI * s / SINUS_TOP) : 0);

  /* ===================== State ===================== */
  const ORBIT_DEFAULT = { theta: -0.55, phi: 1.42, radius: 430 };
  const DEG = Math.PI / 180;
  const CAMERAS = {
    default: ORBIT_DEFAULT,
    anterior: { theta: 0, phi: Math.PI / 2, radius: 430 },
    rao: { theta: -30 * DEG, phi: Math.PI / 2, radius: 430 },
    lao: { theta: 40 * DEG, phi: Math.PI / 2, radius: 430 },
    cranial: { theta: 0, phi: Math.PI / 2 - 25 * DEG, radius: 430 }
  };
  const state = {
    lang: 'en', mode: 'clinician',
    patient: { age: 30, sex: 'M', height: 185, weight: 80 },
    measured: { annulus: 26, sov: 40, stj: 30, aa: 42 },
    studyDate: todayISO(), priors: [],
    refSet: 'devereux', convention: 'le-ed', variability: 3,
    stiff: { sys: null, dia: null, sbp: null, dbp: null },
    dec: { cause: 'tav', pheno: 'auto', hr: false, low: false, avs: false, ocs: false, preg: false, height: false },
    s: 10, fov: 120, view: 'sax', showGhost: true, showPrior: true, growthMetric: 'mm', tab: 'decision',
    orbit: { ...ORBIT_DEFAULT, target: V(0, 20, -12) }, tween: null,
    hr: 70, playing: false, t0: 0, cyc: REST, reference: null, band: null
  };
  const models = { ref: { kind: 'ref' }, pt: { kind: 'pt' }, prior: null };

  /* ===================== Persistence ===================== */
  const STORE_KEY = 'aortic-root-viewer:v2.0';
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const { lang, mode, patient, measured, studyDate, priors, refSet, convention, variability, stiff, hr, dec } = state;
        localStorage.setItem(STORE_KEY, JSON.stringify({ lang, mode, patient, measured, studyDate, priors, refSet, convention, variability, stiff, hr, dec }));
      } catch (e) { /* storage unavailable: keep working in memory */ }
    }, 300);
  }
  function load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') return;
    const num = (x, a, b) => (typeof x === 'number' && x >= a && x <= b ? x : undefined);
    if (d.lang === 'en' || d.lang === 'es') state.lang = d.lang;
    if (d.mode === 'clinician' || d.mode === 'patient') state.mode = d.mode;
    if (d.patient) {
      const p = d.patient;
      if (num(p.age, 15, 100) !== undefined) state.patient.age = p.age;
      if (p.sex === 'M' || p.sex === 'F') state.patient.sex = p.sex;
      if (num(p.height, 120, 220) !== undefined) state.patient.height = p.height;
      if (num(p.weight, 30, 200) !== undefined) state.patient.weight = p.weight;
    }
    if (d.measured) for (const lv of LEVELS) if (num(d.measured[lv.key], 10, 90) !== undefined) state.measured[lv.key] = d.measured[lv.key];
    if (Number.isFinite(parseDate(d.studyDate))) state.studyDate = d.studyDate;
    if (Array.isArray(d.priors)) {
      state.priors = d.priors.filter(p => p && Number.isFinite(parseDate(p.date))).slice(0, 30).map(p => {
        const o = { id: String(p.id || Math.random().toString(36).slice(2)), date: p.date, method: p.method === 'ctmr' ? 'ctmr' : 'echo' };
        for (const lv of LEVELS) o[lv.key] = num(p[lv.key], 10, 90) ?? null;
        return o;
      });
    }
    if (REF_SETS.includes(d.refSet)) state.refSet = d.refSet;
    if (CONVENTIONS.includes(d.convention)) state.convention = d.convention;
    if (num(d.variability, 1, 5) !== undefined) state.variability = d.variability;
    if (d.stiff) for (const k of ['sys', 'dia', 'sbp', 'dbp']) if (typeof d.stiff[k] === 'number') state.stiff[k] = d.stiff[k];
    if (num(d.hr, 30, 200) !== undefined) state.hr = d.hr;
    if (d.dec && typeof d.dec === 'object') {
      if (['tav', 'bav', 'marfan', 'lds', 'htad'].includes(d.dec.cause)) state.dec.cause = d.dec.cause;
      if (['auto', 'root', 'asc'].includes(d.dec.pheno)) state.dec.pheno = d.dec.pheno;
      for (const k of ['hr', 'low', 'avs', 'ocs', 'preg', 'height']) state.dec[k] = d.dec[k] === true;
    }
  }

  /* ===================== Models ===================== */
  function buildProfile(d, archD, descD) {
    const xs = [0, 10, 20, 35, 52, S_ARCH, S_ARCH + (S_DESC - S_ARCH) * 0.6, LEN];
    const ys = [d.annulus, d.sov, d.stj, d.aa, 0.55 * d.aa + 0.45 * archD, archD, 0.5 * (archD + descD), descD];
    return pchip(xs, ys);
  }
  const ageAt = (iso) => state.patient.age - yearsBetween(parseDate(iso), parseDate(state.studyDate));
  function zOf(key, value, age) {
    const L = referenceFor({ ...state.patient, age: Math.max(15, age) }, state.refSet).levels[key];
    return (value - L.mean) / L.sd;
  }
  const currentMethod = () => methodOfConvention(state.convention);
  function validPriors() {
    const cur = parseDate(state.studyDate);
    return state.priors.filter(p => { const v = parseDate(p.date); return Number.isFinite(v) && v < cur; })
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));
  }
  function buildPriorModel() {   // latest earlier study with the current method (else any) and at least two levels
    const list = validPriors().reverse();
    const pick = list.find(p => p.method === currentMethod() && LEVELS.filter(l => Number.isFinite(p[l.key])).length >= 2) ||
      list.find(p => LEVELS.filter(l => Number.isFinite(p[l.key])).length >= 2);
    if (!pick) return null;
    const pts = LEVELS.filter(l => Number.isFinite(pick[l.key]));
    return { prof: pchip(pts.map(l => l.s), pts.map(l => pick[l.key])), sMin: pts[0].s, sMax: pts[pts.length - 1].s, date: pick.date, method: pick.method };
  }
  function stiffnessResult() {
    const { sys, dia, sbp, dbp } = state.stiff;
    const ok = [sys, dia].every(x => Number.isFinite(x) && x >= 10 && x <= 90) && Number.isFinite(sbp) && Number.isFinite(dbp) &&
      sbp >= 70 && sbp <= 250 && dbp >= 30 && dbp <= 150 && sys > dia && sbp > dbp;
    if (!ok) return null;
    const strain = (sys - dia) / dia, pp = sbp - dbp, dMmHg = (2 * strain) / pp;
    return { strain, dist3: dMmHg * 1e3, distCgs: (dMmHg / 1333.22) * 1e6, beta: Math.log(sbp / dbp) / strain };
  }
  function updateModels() {
    const ref = referenceFor(state.patient, state.refSet);
    state.reference = ref;
    const L = ref.levels;
    const archD = L.aa.mean * 0.87, descD = L.aa.mean * 0.78;   // illustrative only
    models.ref.d = { annulus: L.annulus.mean, sov: L.sov.mean, stj: L.stj.mean, aa: L.aa.mean };
    models.pt.d = { ...state.measured };
    for (const m of [models.ref, models.pt]) { m.prof = buildProfile(m.d, archD, descD); m._cor = null; }
    const z = {};
    for (const lv of LEVELS) z[lv.key] = (models.pt.d[lv.key] - L[lv.key].mean) / L[lv.key].sd;
    models.pt.z = z;
    models.pt.zAt = pchip([0, 10, 20, 35, 55, 75], [z.annulus, z.sov, z.stj, z.aa, z.aa * 0.4, 0]);
    models.ref.zAt = () => 0;
    const xs = LEVELS.map(l => l.s);
    state.band = { lo: pchip(xs, LEVELS.map(l => L[l.key].mean - 2 * L[l.key].sd)), hi: pchip(xs, LEVELS.map(l => L[l.key].mean + 2 * L[l.key].sd)) };
    const st = stiffnessResult();
    models.ref.strain = EVIDENCE.aorticStrain.mean;
    models.pt.strain = st ? st.strain : EVIDENCE.aorticStrain.mean;
    models.prior = buildPriorModel();
    if (models.prior) models.prior.strain = models.pt.strain;
  }
  const aorticScale = (m) => 1 + m.strain * state.cyc.p;
  const radiusAt = (m, s, th, k = 1) => (m.prof(s) / 2) * k * (1 + lobe(s) * Math.cos(3 * th));
  const priorCovers = (s) => models.prior && s >= models.prior.sMin - 1 && s <= models.prior.sMax + 1;
  const BASE = [0.835, 0.894, 0.902], AMBER = [1.0, 0.71, 0.28], RED = [1.0, 0.35, 0.30];
  function colourAt(m, s, out) {
    const z = Math.max(0, m.zAt(s)), a = smoothstep(1.0, 2.0, z), b = smoothstep(2.0, 3.5, z);
    for (let k = 0; k < 3; k++) out[k] = (BASE[k] * (1 - a) + AMBER[k] * a) * (1 - b) + RED[k] * b;
    return out;
  }

  /* ===================== Stylized anatomy ===================== */
  const LV_DIR = V(0.34, -0.817, 0.467).normalize();
  function chamber(name, C, axisLong, axisHint, r, inner, motion) {
    const e1 = axisLong.clone().normalize();
    const e2 = axisHint.clone().sub(e1.clone().multiplyScalar(axisHint.dot(e1))).normalize();
    return { name, C, e: [e1, e2, V(0, 0, 0).crossVectors(e1, e2)], r, inner, motion };
  }
  const CHAMBERS = [   // later chambers draw over earlier ones in scans
    chamber('an.ra', V(-36, -18, -8), V(0, 1, 0), V(1, 0, 0), [25, 20, 21], 0.80, 'atrium'),
    chamber('an.la', V(6, 8, -38), V(1, 0, 0), V(0, 1, 0), [22, 19, 16], 0.80, 'atrium'),
    chamber('an.laa', V(32, 8, -16), V(0.6, 0.2, 0.75), V(0, 1, 0), [14, 7, 8], 0.60, 'atrium'),
    chamber('an.rv', V(-8, -46, 36), LV_DIR, V(0.857, 0.057, -0.514), [40, 13, 30], 0.70, 'rv'),
    chamber('an.rvot', V(2, -14, 32), V(0.25, 1, -0.1), V(1, 0, 0), [22, 13, 13], 0.70, 'rvot'),
    chamber('an.lv', V(24, -46, 18), LV_DIR, V(1, 0, 0), [47, 27, 27], 0.58, 'lv')
  ];
  const MEDIASTINUM = chamber('an.soft', V(0, 0, -14), V(0, 1, 0), V(1, 0, 0), [160, 92, 82], 1, 'none');
  const MOTION = { lv: { long: 0.13, trans: 0.10, kin: [0.762, 0.629] }, rv: { long: 0.20, trans: 0.07, kin: [0.837, 0.725] } };
  function chamberAt(c, cyc) {
    const cv = cyc.cv;
    let kL = 1, kT = 1, inner = c.inner, C = c.C;
    if (c.motion === 'lv' || c.motion === 'rv') {
      const mo = MOTION[c.motion];
      kL = 1 - mo.long * cv; kT = 1 - mo.trans * cv;
      const kin = mo.kin[0] + (mo.kin[1] - mo.kin[0]) * cv;
      inner = kin * kin;
      C = c.C.clone().add(c.e[0].clone().multiplyScalar(c.r[0] * (1 - kL)));   // apex stays put
    } else if (c.motion === 'rvot') kL = kT = 1 - MOTION.rv.trans * cv;
    else if (c.motion === 'atrium') kL = kT = cyc.ka;
    return { name: c.name, C, e: c.e, r: [c.r[0] * kL, c.r[1] * kT, c.r[2] * kT], inner };
  }
  const BASE_DESCENT = { mitral: 2 * 47 * MOTION.lv.long, tricuspid: 2 * 40 * MOTION.rv.long };
  const VESSELS = [
    { name: 'an.pt', kind: 'pa', r: 12, pts: [V(10, 6, 30), V(13, 24, 25), V(15, 38, 10), V(14, 45, -6)] },
    { name: 'an.rpa', kind: 'pa', r: 8.5, pts: [V(14, 45, -6), V(2, 50, -22), V(-18, 50, -32), V(-40, 47, -32)] },
    { name: 'an.lpa', kind: 'pa', r: 8.5, pts: [V(14, 45, -6), V(26, 50, -18), V(38, 47, -28), V(48, 42, -32)] },
    { name: 'an.svc', kind: 'vein', r: 9, pts: [V(-34, 2, -10), V(-31, 40, -12), V(-29, 82, -10), V(-27, 110, -8)] },
    { name: 'an.ivc', kind: 'vein', r: 11, pts: [V(-35, -38, -12), V(-33, -70, -16), V(-32, -95, -18)] },
    { name: 'an.bct', kind: 'artery', r: 6.5, pts: [V(-6, 95, -4), V(-9, 112, -2), V(-14, 132, 0), V(-18, 150, 2)] },
    { name: 'an.lcca', kind: 'artery', r: 4, pts: [V(5, 100, -18), V(6, 118, -15), V(8, 138, -12), V(9, 155, -10)] },
    { name: 'an.lsa', kind: 'artery', r: 5, pts: [V(16, 99, -33), V(22, 116, -34), V(32, 130, -32), V(46, 138, -30)] },
    { name: 'an.rspv', kind: 'vein', r: 6, pts: [V(-32, 16, -48), V(-20, 14, -44), V(-10, 12, -40)] },
    { name: 'an.ripv', kind: 'vein', r: 6, pts: [V(-32, -4, -50), V(-20, -2, -44), V(-10, 0, -40)] },
    { name: 'an.lspv', kind: 'vein', r: 6, pts: [V(44, 16, -48), V(32, 14, -44), V(22, 12, -40)] },
    { name: 'an.lipv', kind: 'vein', r: 6, pts: [V(44, -4, -50), V(32, -2, -44), V(22, 0, -40)] }
  ].map(v => ({ ...v, curve: new THREE.CatmullRomCurve3(v.pts, false, 'centripetal') }));
  function tubeSamples(c, r, step, label) {
    const n = Math.max(2, Math.ceil(c.getLength() / step)), out = [];
    for (let i = 0; i <= n; i++) out.push({ p: c.getPointAt(i / n), r, label });
    return out;
  }
  const VESSEL_RUNS = VESSELS.flatMap(v => chunk(tubeSamples(v.curve, v.r, 1.2, v.name), 16));
  function coronaryCurves(m) {
    const ost = (th) => {
      const f = frameAt(12), r = radiusAt(m, 12, th);
      return f.P.clone().add(f.N.clone().multiplyScalar(Math.cos(th) * r)).add(f.B.clone().multiplyScalar(Math.sin(th) * r));
    };
    const rca = ost(0), lm = ost((2 * Math.PI) / 3), bif = V(22, -6, 2);
    return [
      { name: 'an.rca', r: 1.8, c: new THREE.CatmullRomCurve3([rca, rca.clone().add(V(-5, -1, 7)), V(-30, -14, 26), V(-44, -34, 18), V(-46, -58, 6), V(-40, -78, -6)]) },
      { name: 'an.lad', r: 2.0, c: new THREE.CatmullRomCurve3([lm, lm.clone().add(V(8, -1, -3)), bif, V(28, -18, 30), V(32, -48, 46), V(40, -80, 44)]) },
      { name: 'an.lcx', r: 1.5, c: new THREE.CatmullRomCurve3([bif, V(34, -12, -10), V(38, -26, -24), V(34, -44, -30)]) }
    ];
  }
  function coronaries(m) {
    if (!m._cor) { m._cor = coronaryCurves(m); m._corRuns = m._cor.flatMap(c => chunk(tubeSamples(c.c, c.r, 1.0, c.name), 16)); }
    return m._cor;
  }
  // Parasternal long-axis plane: contains the root axis, turned to pass near the LV, LA and RVOT centres
  const PLAX = (() => {
    const P0 = frameAt(0).P, Tax = frameAt(20).P.clone().sub(P0).normalize();
    const a = V(0, 0, 1).sub(Tax.clone().multiplyScalar(Tax.z)).normalize(), b = V(0, 0, 0).crossVectors(Tax, a);
    const targets = ['an.lv', 'an.la', 'an.rvot'].map(n => CHAMBERS.find(c => c.name === n));
    let best = a, bestCost = Infinity;
    for (let i = 0; i < 180; i++) {
      const phi = (i / 180) * Math.PI, n = a.clone().multiplyScalar(Math.cos(phi)).add(b.clone().multiplyScalar(Math.sin(phi)));
      let cost = 0;
      for (const c of targets) { const d = c.C.clone().sub(P0).dot(n) / Math.min(c.r[1], c.r[2]); cost += d * d; }
      if (cost < bestCost) { bestCost = cost; best = n; }
    }
    const N = best.normalize();
    const U = V(0, 0, 1).sub(N.clone().multiplyScalar(N.z)); U.sub(Tax.clone().multiplyScalar(U.dot(Tax))).normalize();
    const R = Tax.clone();
    const C = frameAt(16).P.clone().sub(R.clone().multiplyScalar(16));
    C.sub(N.clone().multiplyScalar(C.clone().sub(P0).dot(N)));
    return { P: C, N, R, U };
  })();

  /* ===================== 3D materials and geometry ===================== */
  const VERT = `
    attribute vec3 aCol; attribute vec3 aCenter;
    uniform float uScale;
    varying vec3 vN; varying vec3 vV; varying vec3 vC;
    void main() {
      vec3 p = aCenter + (position - aCenter) * uScale;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vC = aCol;
      gl_Position = projectionMatrix * mv;
    }`;
  const FRAG = `
    uniform vec3 uColor; uniform vec3 uRim; uniform float uAlpha; uniform float uRimAlpha;
    uniform float uPow; uniform float uUseVertex;
    varying vec3 vN; varying vec3 vV; varying vec3 vC;
    void main() {
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
      float rim = pow(1.0 - ndv, uPow);
      vec3 L1 = normalize(vec3(0.35, 0.55, 0.76));
      vec3 L2 = normalize(vec3(-0.6, -0.2, 0.4));
      float dif = max(dot(n, L1), 0.0) * 0.75 + max(dot(n, L2), 0.0) * 0.2;
      vec3 base = mix(uColor, vC, uUseVertex);
      gl_FragColor = vec4(base * (0.24 + dif) + uRim * rim, clamp(uAlpha + uRimAlpha * rim, 0.0, 1.0));
    }`;
  function fresnelMat({ color = [1, 1, 1], rim = [0.4, 0.5, 0.55], alpha = 1, rimAlpha = 0, pow = 2.2, vertex = false }) {
    const transparent = alpha < 1;
    return new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent, depthWrite: !transparent, side: THREE.FrontSide,
      uniforms: {
        uColor: { value: new THREE.Color(...color) }, uRim: { value: new THREE.Color(...rim) },
        uAlpha: { value: alpha }, uRimAlpha: { value: rimAlpha }, uPow: { value: pow },
        uUseVertex: { value: vertex ? 1 : 0 }, uScale: { value: 1 }
      }
    });
  }
  function prepGeom(geom) {   // the shader needs aCol and aCenter; aCenter = position means no scaling
    const n = geom.attributes.position.count;
    if (!geom.attributes.aCol) geom.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (!geom.attributes.aCenter) geom.setAttribute('aCenter', geom.attributes.position.clone());
    return geom;
  }
  const MAT = {
    chamber: fresnelMat({ color: [0.30, 0.45, 0.52], rim: [0.42, 0.62, 0.70], alpha: 0.07, rimAlpha: 0.5, pow: 2.4 }),
    vessel: fresnelMat({ color: [0.34, 0.40, 0.60], rim: [0.45, 0.52, 0.78], alpha: 0.10, rimAlpha: 0.55, pow: 2.2 }),
    branch: fresnelMat({ color: [0.62, 0.68, 0.70], rim: [0.55, 0.62, 0.66], alpha: 0.30, rimAlpha: 0.5, pow: 2.2 }),
    valve: fresnelMat({ color: [0.86, 0.83, 0.72], rim: [0.3, 0.3, 0.25], alpha: 0.92, rimAlpha: 0.08 }),
    coronary: fresnelMat({ color: [0.82, 0.42, 0.38], rim: [0.5, 0.25, 0.22], alpha: 0.9, rimAlpha: 0.1 })
  };
  const UNIT_SPHERE = prepGeom(new THREE.SphereGeometry(1, 56, 36));
  const STATIC_GEOMS = VESSELS.map(v => ({ g: prepGeom(new THREE.TubeGeometry(v.curve, 64, v.r, 24, false)), mat: v.kind === 'artery' ? MAT.branch : MAT.vessel }));
  const ringGeom = (radius) => prepGeom(new THREE.TorusGeometry(radius, 0.9, 10, 64));
  function orient(obj, center, normal) { obj.quaternion.setFromUnitVectors(V(0, 0, 1), normal.clone().normalize()); obj.position.copy(center); }
  const VALVES = [
    { r: 14, C: V(10, -12, -20), n: V(26, -60, 58), descent: BASE_DESCENT.mitral },
    { r: 15, C: V(-24, -34, 10), n: V(28, -28, 44), descent: BASE_DESCENT.tricuspid },
    { r: 12, C: V(10, 6, 30), n: VESSELS[0].curve.getTangentAt(0), descent: 0 }
  ];
  function ellipsoidMatrix(c, out) {
    return out.makeBasis(c.e[0].clone().multiplyScalar(c.r[0]), c.e[1].clone().multiplyScalar(c.r[1]), c.e[2].clone().multiplyScalar(c.r[2])).setPosition(c.C);
  }
  function createAortaGeometry() {
    const g = new THREE.BufferGeometry(), n = NS * (M + 1);
    for (const a of ['position', 'normal', 'aCol', 'aCenter']) g.setAttribute(a, new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const sAttr = new Float32Array(n), cen = g.attributes.aCenter.array;
    for (let i = 0; i < NS; i++) for (let j = 0; j <= M; j++) {
      const k = i * (M + 1) + j;
      sAttr[k] = cl.s[i];
      cen[k * 3] = cl.P[i].x; cen[k * 3 + 1] = cl.P[i].y; cen[k * 3 + 2] = cl.P[i].z;
    }
    g.userData.s = sAttr;
    const idx = [];
    for (let i = 0; i < NS - 1; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setIndex(idx);
    return g;
  }
  function fillAorta(g, m) {
    const pos = g.attributes.position.array, col = g.attributes.aCol.array, c = [0, 0, 0];
    for (let i = 0; i < NS; i++) {
      const s = cl.s[i], P = cl.P[i], N = cl.N[i], B = cl.B[i], R = m.prof(s) / 2, a = lobe(s);
      colourAt(m, s, c);
      for (let j = 0; j <= M; j++) {
        const th = (j / M) * Math.PI * 2, r = R * (1 + a * Math.cos(3 * th));
        const ct = Math.cos(th) * r, st = Math.sin(th) * r, k = (i * (M + 1) + j) * 3;
        pos[k] = P.x + ct * N.x + st * B.x; pos[k + 1] = P.y + ct * N.y + st * B.y; pos[k + 2] = P.z + ct * N.z + st * B.z;
        col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aCol.needsUpdate = true;
    g.computeVertexNormals();
    const nr = g.attributes.normal.array;   // close the seam
    for (let i = 0; i < NS; i++) {
      const a = i * (M + 1) * 3, b = (i * (M + 1) + M) * 3;
      for (let k = 0; k < 3; k++) { const v = (nr[a + k] + nr[b + k]) / 2; nr[a + k] = v; nr[b + k] = v; }
    }
    g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere();
  }
  function sectionPoints(m, s, out, grow, k) {
    const f = frameAt(s);
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2, r = radiusAt(m, s, th, k) + grow;
      const ct = Math.cos(th) * r, st = Math.sin(th) * r;
      out[j * 3] = f.P.x + ct * f.N.x + st * f.B.x;
      out[j * 3 + 1] = f.P.y + ct * f.N.y + st * f.B.y;
      out[j * 3 + 2] = f.P.z + ct * f.N.z + st * f.B.z;
    }
    return out;
  }

  /* ===================== Viewers ===================== */
  const viewers = [];
  const planeGeom = new THREE.PlaneGeometry(1, 1);
  const planeEdgeGeom = new THREE.BufferGeometry().setFromPoints([V(-0.5, -0.5, 0), V(0.5, -0.5, 0), V(0.5, 0.5, 0), V(-0.5, 0.5, 0)]);
  function lineLoop(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    const l = new THREE.LineLoop(g, material);
    l.frustumCulled = false;
    return l;
  }
  const dashed = (color, opacity = 1) => new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 1.6, depthTest: false, transparent: true, opacity });

  function createViewer(key) {
    const panel = $('panel-' + key);
    const v = { key, model: models[key], panel, host3d: panel.querySelector('.view3d'), host2d: panel.querySelector('.viewslice') };
    v.canvas3d = v.host3d.querySelector('canvas');
    v.canvas2d = v.host2d.querySelector('canvas');
    v.tip = v.host2d.querySelector('.tip');
    v.ctx = v.canvas2d.getContext('2d');
    v.raw = document.createElement('canvas'); v.raw.width = v.raw.height = RAW;
    v.rctx = v.raw.getContext('2d');
    v.img = v.rctx.createImageData(RAW, RAW);
    v.labels = new Uint8Array(RAW * RAW);
    v.names = [];
    v.scan = null;
    try { v.renderer = new THREE.WebGLRenderer({ canvas: v.canvas3d, antialias: true }); }
    catch (err) { v.renderer = null; v.host3d.classList.add('no-gl'); }
    if (v.renderer) {
      v.renderer.setClearColor(0x000000, 1);
      v.renderer.setPixelRatio(dpr());
      v.scene = new THREE.Scene();
      v.camera = new THREE.PerspectiveCamera(32, 1, 1, 4000);
      v.aortaGeom = createAortaGeometry();
      v.aortaMat = fresnelMat({ vertex: true, rim: [0.25, 0.32, 0.34], pow: 2.6 });
      v.aorta = new THREE.Mesh(v.aortaGeom, v.aortaMat);
      v.scene.add(v.aorta);
      v.chamberMeshes = CHAMBERS.map(() => { const m = new THREE.Mesh(UNIT_SPHERE, MAT.chamber); m.matrixAutoUpdate = false; v.scene.add(m); return m; });
      for (const s of STATIC_GEOMS) v.scene.add(new THREE.Mesh(s.g, s.mat));
      v.valveMeshes = VALVES.map(va => { const m = new THREE.Mesh(ringGeom(va.r), MAT.valve); orient(m, va.C, va.n); v.scene.add(m); return m; });
      v.dynamic = new THREE.Group();
      v.scene.add(v.dynamic);
      const accent = key === 'ref' ? 0x78c9d8 : 0xf2aa3f;
      v.plane = new THREE.Mesh(planeGeom, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      v.planeEdge = new THREE.LineLoop(planeEdgeGeom, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.55 }));
      for (const o of [v.plane, v.planeEdge]) { o.matrixAutoUpdate = false; o.renderOrder = 5; o.frustumCulled = false; v.scene.add(o); }
      v.ring = lineLoop(new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
      v.ring.renderOrder = 20;
      v.scene.add(v.ring);
      if (key === 'pt') {
        v.ghost = lineLoop(dashed(0x78c9d8)); v.ghost.renderOrder = 19; v.scene.add(v.ghost);
        v.priorRing = lineLoop(dashed(0xa9b4b8, 0.9)); v.priorRing.renderOrder = 18; v.scene.add(v.priorRing);
      }
      v.raycaster = new THREE.Raycaster();
      attachPointer(v);
    }
    attachScanPointer(v);
    new ResizeObserver(() => { resize(v); requestRender(true, true); }).observe(v.host3d);
    new ResizeObserver(() => { resize(v); requestRender(false, true); }).observe(v.host2d);
    viewers.push(v);
    return v;
  }
  function rebuildViewer(v) {
    if (!v.renderer) return;
    fillAorta(v.aortaGeom, v.model);
    for (const child of [...v.dynamic.children]) { child.geometry.dispose(); v.dynamic.remove(child); }
    for (const c of coronaries(v.model)) v.dynamic.add(new THREE.Mesh(prepGeom(new THREE.TubeGeometry(c.c, 60, c.r, 10, false)), MAT.coronary));
    const f0 = frameAt(0.01), av = new THREE.Mesh(ringGeom(v.model.d.annulus / 2), MAT.valve);
    orient(av, f0.P, f0.T);
    v.dynamic.add(av);
    const lmMat = new THREE.LineBasicMaterial({ color: 0x5f7980, transparent: true, opacity: 0.85 });
    for (const lv of LEVELS.slice(1)) {
      const l = lineLoop(lmMat);
      sectionPoints(v.model, lv.s, l.geometry.attributes.position.array, 0.25, 1);
      l.geometry.attributes.position.needsUpdate = true;
      v.dynamic.add(l);
    }
    if (v.key === 'pt' && models.prior && state.showPrior) {
      const pm = dashed(0xa9b4b8, 0.75);
      for (const lv of LEVELS) {
        if (lv.s < models.prior.sMin || lv.s > models.prior.sMax) continue;
        const l = lineLoop(pm);
        sectionPoints(models.prior, lv.s, l.geometry.attributes.position.array, 0.2, 1);
        l.geometry.attributes.position.needsUpdate = true;
        l.computeLineDistances();
        v.dynamic.add(l);
      }
    }
  }
  function updateDynamic(v) {   // everything that moves with the heartbeat, the level or the view
    if (!v.renderer) return;
    const cyc = state.cyc, k = aorticScale(v.model);
    v.aortaMat.uniforms.uScale.value = k;
    CHAMBERS.forEach((c, i) => { const m = v.chamberMeshes[i]; ellipsoidMatrix(chamberAt(c, cyc), m.matrix); m.matrixWorldNeedsUpdate = true; });
    VALVES.forEach((va, i) => v.valveMeshes[i].position.copy(va.C).add(LV_DIR.clone().multiplyScalar(va.descent * cyc.cv)));
    const scanVisible = state.mode === 'clinician';
    v.plane.visible = v.planeEdge.visible = v.ring.visible = scanVisible;
    let mtx;
    if (state.view === 'plax') {
      mtx = new THREE.Matrix4().makeBasis(PLAX.R.clone().multiplyScalar(state.fov), PLAX.U.clone().multiplyScalar(state.fov), PLAX.N).setPosition(PLAX.P);
    } else {
      const f = frameAt(state.s), ax = screenAxes(f.T);
      mtx = new THREE.Matrix4().makeBasis(ax.R.clone().multiplyScalar(state.fov), ax.U.clone().multiplyScalar(state.fov), f.T).setPosition(f.P);
    }
    v.plane.matrix.copy(mtx); v.planeEdge.matrix.copy(mtx);
    v.plane.matrixWorldNeedsUpdate = v.planeEdge.matrixWorldNeedsUpdate = true;
    sectionPoints(v.model, state.s, v.ring.geometry.attributes.position.array, 0.3, k);
    v.ring.geometry.attributes.position.needsUpdate = true;
    if (v.ghost) {
      v.ghost.visible = scanVisible && state.showGhost;
      sectionPoints(models.ref, state.s, v.ghost.geometry.attributes.position.array, 0.3, aorticScale(models.ref));
      v.ghost.geometry.attributes.position.needsUpdate = true;
      v.ghost.computeLineDistances();
      v.priorRing.visible = !!(scanVisible && state.showPrior && priorCovers(state.s));
      if (v.priorRing.visible) {
        sectionPoints(models.prior, state.s, v.priorRing.geometry.attributes.position.array, 0.3, aorticScale(models.prior));
        v.priorRing.geometry.attributes.position.needsUpdate = true;
        v.priorRing.computeLineDistances();
      }
    }
  }
  function applyOrbit() {
    const o = state.orbit, sp = Math.sin(o.phi);
    const pos = V(o.radius * sp * Math.sin(o.theta), o.radius * Math.cos(o.phi), o.radius * sp * Math.cos(o.theta)).add(o.target);
    for (const v of viewers) if (v.renderer) { v.camera.position.copy(pos); v.camera.lookAt(o.target); }
    requestRender(true, false);
  }
  function goToCamera(name) {
    const to = CAMERAS[name];
    if (!to) return;
    const from = { theta: state.orbit.theta, phi: state.orbit.phi, radius: state.orbit.radius };
    const dTheta = ((to.theta - from.theta) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;   // shortest way round
    const target = { theta: from.theta + dTheta, phi: to.phi, radius: to.radius };
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { Object.assign(state.orbit, target); applyOrbit(); return; }
    state.tween = { from, to: target, t0: performance.now(), dur: 450 };
    requestRender(true, false);
  }
  function resize(v) {
    if (v.renderer) {
      const w = v.host3d.clientWidth, h = v.host3d.clientHeight;
      if (w > 0 && h > 0) { v.renderer.setSize(w, h, false); v.camera.aspect = w / h; v.camera.updateProjectionMatrix(); }
    }
    fitCanvas(v.canvas2d);
  }
  function attachPointer(v) {
    const cv = v.canvas3d, pointers = new Map();
    let drag = null, pinch = null;
    function pick(e) {
      if (state.mode !== 'clinician') return;
      const rect = cv.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      v.raycaster.setFromCamera(ndc, v.camera);
      const hit = v.raycaster.intersectObject(v.aorta, false)[0];
      if (hit && hit.face) setS(v.aortaGeom.userData.s[hit.face.a]);
    }
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      state.tween = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: state.orbit.radius };
        drag = null;
      } else drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    cv.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        state.orbit.radius = clamp(pinch.r * (pinch.d / Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)), 150, 900);
        applyOrbit();
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; cv.classList.add('dragging'); }
        if (drag.moved) {
          state.orbit.theta -= dx * 0.008;
          state.orbit.phi = clamp(state.orbit.phi - dy * 0.008, 0.12, Math.PI - 0.12);
          drag.x = e.clientX; drag.y = e.clientY;
          applyOrbit();
        }
      } else if (e.pointerType === 'mouse') pick(e);
    });
    const end = (e) => {
      if (drag && !drag.moved && pointers.size === 1) pick(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) drag = null;
      cv.classList.remove('dragging');
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      state.tween = null;
      state.orbit.radius = clamp(state.orbit.radius * Math.exp(e.deltaY * 0.0012), 150, 900);
      applyOrbit();
    }, { passive: false });
  }
