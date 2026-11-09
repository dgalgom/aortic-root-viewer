  // Aortic root viewer v2.0. Copyright 2026 Daniel Gallardo Gómez.
  // Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
  /* ===================== Follow-up analysis ===================== */
  const growthCtx = () => (state.dec.cause === 'tav' ? 'sporadic' : 'htad');
  function growthFor(key) {
    const cur = state.measured[key], curT = parseDate(state.studyDate), method = currentMethod();
    const all = validPriors().filter(p => Number.isFinite(p[key])).map(p => ({ tm: parseDate(p.date), v: p[key], date: p.date, method: p.method }));
    if (!all.length || !Number.isFinite(curT)) return null;
    const same = all.filter(p => p.method === method), sameMethod = same.length > 0;
    const series = [...(sameMethod ? same : all), { tm: curT, v: cur, date: state.studyDate, method }];
    const n = series.length, last = series[n - 2], dt = yearsBetween(last.tm, curT), d = cur - last.v, rate = d / dt;
    const crit = EVIDENCE.growth[growthCtx()];
    const meetsOne = (dt <= 1.0001 && d >= crit.oneYear) || (dt > 1 && rate >= crit.oneYear);
    let meetsTwo = false;
    if (growthCtx() === 'sporadic' && n >= 3) {
      const prev = series[n - 3], dt1 = yearsBetween(prev.tm, last.tm), r1 = (last.v - prev.v) / dt1;
      meetsTwo = r1 >= crit.perYear && rate >= crit.perYear && dt1 + dt >= 1.75;
    }
    const notes = [];
    let cls = 'st-ok';
    const withinVar = Math.abs(d) <= state.variability;
    if (!sameMethod) { notes.push(['g.diffMethod']); cls = 'st-dil'; }
    else if (meetsOne || meetsTwo) {
      notes.push(meetsTwo && !meetsOne ? ['g.rapid2'] : ['g.rapid1', { n: crit.oneYear }]);
      cls = withinVar ? 'st-dil' : 'st-hot';
    }
    if (d === 0) notes.push(['g.noChange']);
    else if (withinVar) notes.push(['g.withinVar']);
    if (dt < 0.5) notes.push(['g.short']);
    if (sameMethod && !(meetsOne || meetsTwo) && d !== 0 && !withinVar) notes.push([d > 0 ? 'g.below' : 'g.smaller']);
    if (cls !== 'st-ok' && sameMethod) notes.push(['g.confirm']);
    return { since: last.date, sinceMethod: last.method, d, rate, dt, notes, cls, meets: sameMethod && (meetsOne || meetsTwo) && !withinVar };
  }
  const notesText = (notes) => notes.map(([k, v]) => t(k, v)).join('. ') + '.';
  function rapidGrowthLevel() { for (const lv of LEVELS) { const g = growthFor(lv.key); if (g && g.meets) return lv; } return null; }

  /* ===================== Decision support ===================== */
  function maxDiameter() {
    let best = { key: 'sov', v: -Infinity };
    for (const k of ['sov', 'stj', 'aa']) if (state.measured[k] > best.v) best = { key: k, v: state.measured[k] };
    return best;
  }
  function indexedMeasures() {
    const D = maxDiameter().v / 10, h = state.patient.height / 100, bsa = state.reference.bsa;
    return { asi: D / bsa, ahi: D / h, csa: (Math.PI * Math.pow(D / 2, 2)) / h };
  }
  const phenotype = () => (state.dec.pheno !== 'auto' ? state.dec.pheno : (state.measured.sov >= state.measured.aa ? 'root' : 'asc'));
  // Each rule: label key, strength (3 recommended, 2 reasonable/should be considered, 1 may be), verdict key,
  // diameter threshold (null for non-diameter tests), strict (> instead of ≥), cond (non-diameter conditions), test (for non-diameter rules)
  function guidelineRules(g) {
    const d = state.dec, D = maxDiameter().v, idx = indexedMeasures(), rapid = !!rapidGrowthLevel();
    const preg = d.preg && state.patient.sex === 'F', hr = d.hr || rapid, pheno = phenotype();
    const R = (k, v, verdict, thr, cond = true, extra = {}) => ({ k, v, verdict, thr, cond, ...extra });
    if (g === 'acc') {
      switch (d.cause) {
        case 'tav': return [
          R('c.d55', 3, 'v.rec', 55), R('c.growth', 3, 'v.rec', null, true, { test: rapid }),
          R('c.d50team', 2, 'v.reason', 50, d.low), R('c.csaTall', 2, 'v.reason', null, d.height, { test: idx.csa >= EVIDENCE.indexed.csa }),
          R('c.avs45', 2, 'v.reason', 45, d.avs)];
        case 'bav': {
          const rf = d.hr || rapid || pheno === 'root';
          return [
            R('c.d55', 3, 'v.rec', 55), R('c.csa', 2, 'v.reason', null, true, { test: idx.csa >= EVIDENCE.indexed.csa }),
            R('c.bavRf', 2, 'v.reason', 50, rf), R('c.bavLow', 1, 'v.may', 50, d.low && !rf),
            R('c.avs45', 2, 'v.reason', 45, d.avs), R('c.preg50', 2, 'v.preg', 50, preg)];
        }
        case 'marfan': return [
          R('c.d50', 3, 'v.rec', 50), R('c.d45hr', 2, 'v.reason', 45, hr),
          R('c.csa', 2, 'v.reason', null, true, { test: idx.csa >= EVIDENCE.indexed.csa }), R('c.preg45', 2, 'v.preg', 45, preg, { strict: true })];
        case 'htad': return [R('c.d50', 3, 'v.rec', 50), R('c.d45hr', 3, 'v.rec', 45, hr)];
        default: return null;   // Loeys–Dietz: gene-specific in ACC/AHA 2022, not encoded
      }
    }
    switch (d.cause) {
      case 'tav': return [
        R('c.d55', 3, 'v.rec', 55), R('c.d52low', 2, 'v.consider', 52, d.low, { strict: true }),
        R('c.avsEsc', 2, 'v.consider', d.low ? 45 : 50, d.avs), R('c.ocs50', 2, 'v.consider', 50, d.ocs)];
      case 'bav': return [
        R('c.d55', 3, 'v.rec', 55), R('c.root50', 3, 'v.rec', 50, pheno === 'root'),
        R('c.asc50rf', 2, 'v.consider', 50, pheno === 'asc' && hr), R('c.avs45', 2, 'v.consider', 45, d.avs)];
      case 'marfan': return [R('c.d50', 3, 'v.rec', 50), R('c.d45hr', 2, 'v.consider', 45, hr), R('c.preg45', 3, 'v.preg', 45, preg, { strict: true })];
      case 'lds': return [R('c.lds45', 2, 'v.consider', 45), R('c.lds40', 2, 'v.consider', 40, d.hr)];
      default: return null;   // heritable disease without an identified gene: not encoded for ESC 2024
    }
  }
  function evaluateGuideline(g) {
    const all = guidelineRules(g), D = maxDiameter().v;
    const rules = all && all.filter(r => !r.k.startsWith('c.preg') || state.patient.sex === 'F');   // pregnancy rules only for women
    if (!rules) return { encoded: false, rows: [], verdict: 'v.notEncoded', strength: -1 };
    let best = null, gap = null;
    const rows = rules.map(rule => {
      let met = false;
      if (rule.cond) met = rule.thr === null ? !!rule.test : (rule.strict ? D > rule.thr : D >= rule.thr);
      const st = !rule.cond ? 'na' : met ? 'met' : 'not';
      if (met && (!best || rule.v > best.v)) best = rule;
      if (!met && rule.cond && rule.thr !== null) { const g2 = rule.thr - D + (rule.strict ? 0.1 : 0); if (gap === null || g2 < gap.d) gap = { d: g2, t: rule.thr }; }
      return { ...rule, st };
    });
    return { encoded: true, rows, verdict: best ? best.verdict : 'v.none', strength: best ? best.v : 0, gap: best ? null : gap };
  }
  function renderDecision() {
    const d = state.dec, sel = $('cause');
    sel.value = d.cause;
    $('pheno-wrap').hidden = d.cause !== 'bav';
    $('hr-wrap').hidden = d.cause === 'tav';
    $('height-wrap').hidden = d.cause !== 'tav';
    $('dec-hr-help').textContent = d.cause === 'tav' ? '' : t('hr.' + d.cause);
    $('preg-wrap').hidden = state.patient.sex !== 'F' || !['bav', 'marfan'].includes(d.cause);
    const phSel = $('pheno');
    phSel.options[0].textContent = t('pheno.auto', { p: t(state.measured.sov >= state.measured.aa ? 'pheno.root' : 'pheno.asc') });
    phSel.value = d.pheno;
    for (const k of ['hr', 'low', 'avs', 'ocs', 'preg', 'height']) $('dec-' + k).checked = d[k];
    const rapid = rapidGrowthLevel();
    $('dec-rapid').textContent = rapid ? t('dec.rapid', { level: lcFirst(lvName(rapid.key)) }) : '';
    const mx = maxDiameter(), idx = indexedMeasures(), I = EVIDENCE.indexed;
    const fact = (label, value, thr, over) => `<div><span>${label}</span><strong class="${over ? 'v2' : ''}">${value}</strong>${thr ? ` <em class="vx">${thr}</em>` : ''}</div>`;
    $('keyfacts').innerHTML =
      fact(t('dec.max'), `${fmt(mx.v)} mm`, t('dec.at', { level: lcFirst(lvName(mx.key)) }), false) +
      fact(t('idx.asi'), `${fmt(idx.asi, 2)} cm/m²`, t('idx.thr', { t: fmt(I.asi, 2) }), idx.asi >= I.asi) +
      fact(t('idx.ahi'), `${fmt(idx.ahi, 2)} cm/m`, t('idx.thr', { t: fmt(I.ahi, 2) }), idx.ahi >= I.ahi) +
      fact(t('idx.csa'), `${fmt(idx.csa, 1)} cm²/m`, t('idx.thr', { t: fmt(I.csa, 0) }), idx.csa >= I.csa) +
      `<p class="help" style="grid-column:1/-1;margin:0">${t('idx.note')}</p>`;
    $('gcards').innerHTML = ['acc', 'esc'].map(g => {
      const ev = evaluateGuideline(g), name = g === 'acc' ? 'ACC/AHA 2022' : 'ESC 2024';
      const vcls = ev.strength < 0 ? 'vx' : 'v' + ev.strength;
      const sub = !ev.encoded ? t('dec.notEncodedHelp') : ev.gap ? t('dec.gap', { d: fmt(Math.max(0, ev.gap.d)), t: fmt(ev.gap.t, 0) }) : '';
      const items = ev.rows.map(row => {
        const icon = row.st === 'met' ? '●' : row.st === 'not' ? '○' : '–';
        return `<li class="${row.st}"><i class="${row.st === 'met' ? 'v' + row.v : ''}">${icon}</i><span>${t(row.k)} <span class="vx">(${t('s.' + row.st)})</span></span></li>`;
      }).join('');
      return `<div class="gcard"><h3>${name}</h3><p class="verdict ${vcls}">${t(ev.verdict)}</p>${sub ? `<p class="gap">${sub}</p>` : ''}<ul>${items}</ul></div>`;
    }).join('');
    $('fu-ctx').textContent = t('fu.ctx', { c: t(growthCtx() === 'sporadic' ? 'ctx.sporadic' : 'ctx.htad') });
  }

  /* ===================== Report import (pasted text) ===================== */
  const NUM_RE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(mm|cm)?/i;
  const LEVEL_PATTERNS = [   // order matters: junction before sinus
    { key: 'stj', re: /(sino-?\s?tubular|uni[oó]n\s+sino-?tubular|\bSTJ\b|\bUST\b)/ig },
    { key: 'annulus', re: /(annulus|anillo(?:\s+(?:a[oó]rtico|valvular))?)/ig },
    { key: 'aa', re: /(ascending\s+aorta|aorta\s+ascendente|tubular\s+(?:ascending\s+)?aorta|aorta\s+tubular|\basc(?:ending)?\.?\s*ao\b)/ig },
    { key: 'sov', re: /(sinus(?:es)?\s+(?:of\s+)?valsalva|senos?\s+de\s+valsalva|\bsinuses\b|\bsenos\b|aortic\s+root|ra[ií]z\s+a[oó]rtica|\bSoV\b)/ig }
  ];
  function parseReport(text) {
    const found = [], src = String(text || '');
    const hits = [];
    for (const pat of LEVEL_PATTERNS) { pat.re.lastIndex = 0; let m; while ((m = pat.re.exec(src))) hits.push({ key: pat.key, start: m.index, end: m.index + m[0].length, label: m[0] }); }
    hits.sort((a, b) => a.start - b.start);
    const taken = new Set();
    hits.forEach((h, i) => {
      if (taken.has(h.key)) return;
      const next = hits.slice(i + 1).find(x => x.start >= h.end);
      const windowText = src.slice(h.end, Math.min(next ? next.start : src.length, h.end + 60));
      const m = NUM_RE.exec(windowText);
      if (!m) return;
      let v = parseFloat(m[1].replace(',', '.')); const notes = [];
      if (m[2] && m[2].toLowerCase() === 'cm') { v *= 10; notes.push('imp.note.cm'); }
      else if (!m[2] && v < 10) { v *= 10; notes.push('imp.note.assumedCm'); }
      if (h.key === 'sov' && /(aortic\s+root|ra[ií]z\s+a[oó]rtica)/i.test(h.label) && !/(valsalva|sinus|seno)/i.test(src)) notes.push('imp.note.root');
      v = Math.round(v * 10) / 10;
      const ok = v >= 10 && v <= 90;
      if (!ok) notes.push('imp.note.range');
      taken.add(h.key);
      found.push({ field: h.key, label: lvName(h.key), snippet: (h.label + windowText.slice(0, m.index + m[0].length)).trim(), value: v, display: fmt(v) + ' mm', notes, ok });
    });
    const sov = found.find(f => f.field === 'sov'), ann = found.find(f => f.field === 'annulus');
    if (sov && ann && ann.value > sov.value) ann.notes.push('imp.note.order');
    let m;
    if ((m = /(?:\bage\b|\bedad\b)\s*[:=]?\s*(\d{1,3})/i.exec(src)) || (m = /(\d{1,3})\s*(?:years?(?:\s*old)?|yrs?|y\/o|a[ñn]os)/i.exec(src))) {
      const v = +m[1]; found.push({ field: 'age', label: t('f.age'), snippet: m[0], value: v, display: v + ' ' + t('unit.yr'), notes: v >= 15 && v <= 100 ? [] : ['imp.note.range'], ok: v >= 15 && v <= 100 });
    }
    if ((m = /\b(female|woman|mujer|femenino)\b/i.exec(src))) found.push({ field: 'sex', label: t('f.sex'), snippet: m[0], value: 'F', display: t('sex.F'), notes: [], ok: true });
    else if ((m = /\b(male|man|var[oó]n|hombre|masculino)\b/i.exec(src))) found.push({ field: 'sex', label: t('f.sex'), snippet: m[0], value: 'M', display: t('sex.M'), notes: [], ok: true });
    if ((m = /(?:height|talla|altura|estatura)\s*[:=]?\s*(\d(?:[.,]\d{1,2})|\d{2,3}(?:[.,]\d)?)\s*(cm|m)?\b/i.exec(src))) {
      let v = parseFloat(m[1].replace(',', '.')); const notes = [];
      if (v < 3) { v = Math.round(v * 100); notes.push('imp.note.m'); }
      const ok = v >= 120 && v <= 220; if (!ok) notes.push('imp.note.range');
      found.push({ field: 'height', label: t('f.height'), snippet: m[0], value: v, display: v + ' cm', notes, ok });
    }
    if ((m = /(?:weight|peso)\s*[:=]?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:kg)?/i.exec(src))) {
      const v = parseFloat(m[1].replace(',', '.')), ok = v >= 30 && v <= 200;
      found.push({ field: 'weight', label: t('f.weight'), snippet: m[0], value: v, display: fmt(v) + ' kg', notes: ok ? [] : ['imp.note.range'], ok });
    }
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(src)) && Number.isFinite(parseDate(m[0]))) {
      found.push({ field: 'date', label: t('fld.date'), snippet: m[0], value: m[0], display: shortDate(m[0]), notes: [], ok: true });
    } else if ((m = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/.exec(src))) {
      const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (Number.isFinite(parseDate(iso)) && +m[2] <= 12) found.push({ field: 'date', label: t('fld.date'), snippet: m[0], value: iso, display: shortDate(iso), notes: ['imp.note.dmy'], ok: true });
    }
    if ((m = /\b(CT|TC|TAC|angio-?TC|tomograf\w*|computed\s+tomography|MRI|RMN?|CMR|resonancia\s+magn[eé]tica|magnetic\s+resonance)\b/i.exec(src))) {
      found.push({ field: 'method', label: t('fld.method'), snippet: m[0], value: 'ct-mri', display: t('conv.ct-mri'), notes: [], ok: true });
    } else if ((m = /\b(echo\w*|eco\w*|TTE|ETT|transthoracic|transtor[aá]cic\w*)\b/i.exec(src))) {
      found.push({ field: 'method', label: t('fld.method'), snippet: m[0], value: 'le-ed', display: t('conv.le-ed'), notes: [], ok: true });
    }
    return found;
  }
  let importRows = [];
  function renderImportPreview() {
    const body = $('imp-preview').querySelector('tbody');
    body.textContent = '';
    importRows.forEach((row, i) => {
      const tr = document.createElement('tr');
      const c0 = document.createElement('td'), cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = row.ok; cb.disabled = !row.ok && row.notes.includes('imp.note.range');
      cb.setAttribute('aria-label', row.label);
      cb.addEventListener('change', () => { importRows[i].use = cb.checked; });
      row.use = cb.checked;
      c0.appendChild(cb); tr.appendChild(c0);
      for (const [txt, cls] of [[row.label, ''], [row.snippet, 'wrap'], [row.display, ''], [row.notes.map(n => t(n)).join('; '), 'wrap']]) {
        const td = document.createElement('td'); td.textContent = txt; if (cls) td.className = cls; tr.appendChild(td);
      }
      body.appendChild(tr);
    });
    $('imp-preview').hidden = importRows.length === 0;
  }
  function applyImport() {
    let n = 0;
    for (const row of importRows) {
      if (!row.use) continue;
      n++;
      if (LEVELS.some(l => l.key === row.field)) state.measured[row.field] = row.value;
      else if (row.field === 'age' || row.field === 'height' || row.field === 'weight') state.patient[row.field] = row.value;
      else if (row.field === 'sex') state.patient.sex = row.value;
      else if (row.field === 'date') state.studyDate = row.value;
      else if (row.field === 'method') state.convention = row.value;
    }
    syncInputs(); save(); refresh();
    $('imp-msg').textContent = t('imp.applied', { n });
    toast(t('imp.applied', { n }));
  }

  /* ===================== PDF report ===================== */
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  function loadScript(src) {
    if (window.jspdf) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('load'));
      document.head.appendChild(s);
    });
  }
  // The PDF's built-in fonts cover Latin-1 only, so replace symbols outside it
  const pdfSafe = (s) => String(s).replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[−–—]/g, '-').replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"')
    .replace(/⊥/g, 'perpendicular to').replace(/→/g, '->').replace(/←/g, '<-').replace(/β/g, 'beta').replace(/⁻³/g, '^-3').replace(/⁻⁶/g, '^-6')
    .replace(/⁻¹/g, '^-1').replace(/²/g, '2').replace(/●/g, '*').replace(/○/g, 'o').replace(/•/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '?');
  async function saveFile(filename, blob) {
    let dl = null;
    try { if (window.claude && typeof window.claude.use === 'function') dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename, data: blob }); toast(t('report.saved')); }
      catch (err) { toast(err && err.code === 'declined' ? t('report.declined') : t('report.unavailable')); }
      return;
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');   // outside the Claude viewer: a normal download
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t('report.saved'));
  }
  function snapshotImages() {
    const out = {}, v = viewers.find(x => x.key === 'pt');
    try {
      if (v && v.renderer && v.canvas3d.width > 0) {   // square centre crop, so it sits level with the scan image
        v.renderer.render(v.scene, v.camera);
        const src = v.canvas3d, side = Math.min(src.width, src.height), sq = document.createElement('canvas');
        sq.width = sq.height = side;
        sq.getContext('2d').drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, side, side);
        out.three = { url: sq.toDataURL('image/jpeg', 0.9), ratio: 1 };
      }
    } catch (e) { /* skip */ }
    try {
      const prevMode = state.mode; state.mode = 'clinician';
      renderRaster(v);
      const c = document.createElement('canvas'); c.width = c.height = 700;
      drawScanOverlay(v, { cv: c, ctx: c.getContext('2d'), r: 1.6 });
      state.mode = prevMode;
      out.scan = { url: c.toDataURL('image/jpeg', 0.9), ratio: 1 };
    } catch (e) { /* skip */ }
    try {
      const c = document.createElement('canvas'); c.width = 1400; c.height = 520;
      drawProfile({ cv: c, ctx: c.getContext('2d'), r: 2 });
      out.profile = { url: c.toDataURL('image/jpeg', 0.9), ratio: c.height / c.width };
    } catch (e) { /* skip */ }
    return out;
  }
  async function makeReport() {
    const btn = $('report-btn');
    btn.disabled = true; toast(t('report.making'));
    try {
      await loadScript(JSPDF_URL);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const PW = 210, PH = 297, ML = 14, MR = 14, CW = PW - ML - MR;
      let y = 16;
      const ensure = (h) => { if (y + h > PH - 16) { doc.addPage(); y = 16; } };
      const text = (s, size = 9.5, style = 'normal', colour = [30, 30, 30]) => {
        doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...colour);
        const lines = doc.splitTextToSize(pdfSafe(s), CW), lh = size * 0.42;
        ensure(lines.length * lh + 1);
        doc.text(lines, ML, y + lh * 0.8); y += lines.length * lh + 1.2;
      };
      const heading = (s) => { y += 3; ensure(10); doc.setDrawColor(200); doc.line(ML, y, PW - MR, y); y += 2; text(s, 11.5, 'bold', [20, 60, 70]); y += 0.5; };
      const table = (cols, rows) => {   // cols: [{h, w, align}]
        const size = 8.6, lh = size * 0.42, pad = 1.2;
        const drawRow = (cells, bold) => {
          doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(bold ? 90 : 30);
          const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfSafe(c), cols[i].w - 2 * pad));
          const h = Math.max(...wrapped.map(w => w.length)) * lh + 2 * pad;
          ensure(h);
          let x = ML;
          wrapped.forEach((w, i) => {
            const al = cols[i].align === 'right' ? 'right' : 'left', tx = al === 'right' ? x + cols[i].w - pad : x + pad;
            doc.text(w, tx, y + pad + lh * 0.8, { align: al }); x += cols[i].w;
          });
          y += h; doc.setDrawColor(225); doc.line(ML, y, ML + cols.reduce((a, c) => a + c.w, 0), y);
        };
        drawRow(cols.map(c => c.h), true);
        rows.forEach(r => drawRow(r, false));
        y += 2;
      };
      const L = state.reference.levels;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 20, 20);
      doc.text(pdfSafe(t('rep.title')), ML, y + 4); y += 9;
      text(t('rep.generated', { d: new Date().toLocaleString(LANG === 'es' ? 'es-ES' : 'en-GB') }), 8.5, 'normal', [100, 100, 100]);

      heading(t('rep.patient'));
      const p = state.patient;
      table([{ h: '', w: 48 }, { h: '', w: 44 }, { h: '', w: 48 }, { h: '', w: CW - 140 }], [
        [t('f.age'), `${p.age} ${t('unit.yr')}`, t('fu.date'), shortDate(state.studyDate)],
        [t('f.sex'), t('sex.' + p.sex), t('rep.conv'), t('conv.' + state.convention)],
        [t('f.height') + ' / ' + t('f.weight'), `${p.height} cm / ${fmt(p.weight)} kg`, t('rep.ref'), t('rs.' + state.refSet)],
        [t('bsa.label'), `${fmt(state.reference.bsa, 2)} m²`, t('rep.var'), `±${fmt(state.variability)} mm`]
      ]);

      heading(t('rep.measure'));
      table([{ h: t('th.level'), w: 40 }, { h: t('th.measured'), w: 24, align: 'right' }, { h: t('th.expected'), w: 22, align: 'right' },
        { h: t('th.range'), w: 30, align: 'right' }, { h: t('th.z'), w: 34, align: 'right' }, { h: t('th.assess'), w: CW - 150 }],
        LEVELS.map(lv => {
          const r = L[lv.key], z = models.pt.z[lv.key], [lo, hi] = zRange(lv.key);
          return [lvName(lv.key), fmt(state.measured[lv.key]), fmt(r.mean), `${fmt(r.mean - 2 * r.sd)}-${fmt(r.mean + 2 * r.sd)}`, `${signed(z)} (${signed(lo)} / ${signed(hi)})`, assessText(lv.key)];
        }));
      const conv = state.convention !== 'le-ed' ? t('convn.' + state.convention) : '';
      if (conv) text(conv, 8.3, 'italic', [120, 80, 20]);

      heading(t('rep.indexed'));
      const mx = maxDiameter(), idx = indexedMeasures(), I = EVIDENCE.indexed;
      table([{ h: '', w: 60 }, { h: '', w: 40, align: 'right' }, { h: '', w: CW - 100 }], [
        [t('dec.max'), `${fmt(mx.v)} mm`, t('dec.at', { level: lcFirst(lvName(mx.key)) })],
        [t('idx.asi'), `${fmt(idx.asi, 2)} cm/m²`, t('idx.thr', { t: fmt(I.asi, 2) })],
        [t('idx.ahi'), `${fmt(idx.ahi, 2)} cm/m`, t('idx.thr', { t: fmt(I.ahi, 2) })],
        [t('idx.csa'), `${fmt(idx.csa, 1)} cm²/m`, t('idx.thr', { t: fmt(I.csa, 0) })]
      ]);

      heading(t('rep.decision'));
      const factors = ['hr', 'low', 'avs', 'ocs', 'preg', 'height'].filter(k => state.dec[k] && (k !== 'preg' || p.sex === 'F')).map(k => t(k === 'hr' ? 'dec.hr' : k === 'low' ? 'dec.lowrisk' : 'dec.' + k));
      if (rapidGrowthLevel()) factors.push(t('c.growth'));
      text(`${t('rep.cause')}: ${t('cause.' + state.dec.cause)}${state.dec.cause === 'bav' ? ' (' + t('dec.pheno') + ': ' + t(phenotype() === 'root' ? 'pheno.root' : 'pheno.asc') + ')' : ''}`, 9.2);
      text(`${t('rep.factors')}: ${factors.length ? factors.join('; ') : t('rep.none')}`, 9.2);
      for (const g of ['acc', 'esc']) {
        const ev = evaluateGuideline(g);
        const met = ev.rows.filter(r => r.st === 'met').map(r => t(r.k));
        y += 1;
        text(`${g === 'acc' ? 'ACC/AHA 2022' : 'ESC 2024'}: ${t(ev.verdict)}`, 10, 'bold');
        if (ev.gap) text(t('dec.gap', { d: fmt(Math.max(0, ev.gap.d)), t: fmt(ev.gap.t, 0) }), 8.8);
        if (met.length) text('• ' + met.join('\n• '), 8.8);
        if (!ev.encoded) text(t('dec.notEncodedHelp'), 8.8);
      }

      if (validPriors().length) {
        heading(t('rep.growth'));
        table([{ h: t('th.level'), w: 40 }, { h: t('th.since'), w: 38 }, { h: t('th.change'), w: 22, align: 'right' }, { h: t('th.rate'), w: 26, align: 'right' }, { h: t('th.interp'), w: CW - 126 }],
          LEVELS.map(lv => {
            const g = growthFor(lv.key);
            return g ? [lvName(lv.key), `${shortDate(g.since)} (${t('method.' + g.sinceMethod)})`, `${signed(g.d)} mm`, `${signed(g.rate)} ${t('unit.mmyr')}`, notesText(g.notes)]
              : [lvName(lv.key), '-', '-', '-', t('g.noPrev')];
          }));
      }
      const st = stiffnessResult();
      if (st) {
        heading(t('rep.stiff'));
        text(`${t('st.strain')}: ${fmt(st.strain * 100)}%   ${t('st.dist')}: ${fmt(st.dist3, 2)} x10^-3 mmHg^-1 (${fmt(st.distCgs, 2)} x10^-6 cm2/dyn)   ${t('st.beta')}: ${fmt(st.beta, 2)}`, 9.2);
      }

      const imgs = snapshotImages();
      if (imgs.three || imgs.scan || imgs.profile) {
        heading(t('rep.images'));
        const half = (CW - 6) / 2;
        const hTop = Math.max(imgs.three ? half * imgs.three.ratio : 0, imgs.scan ? half : 0);
        if (hTop) {
          ensure(hTop + 8);
          if (imgs.three) { doc.addImage(imgs.three.url, 'JPEG', ML, y, half, half * imgs.three.ratio); }
          if (imgs.scan) { doc.addImage(imgs.scan.url, 'JPEG', ML + half + 6, y, half, half); }
          y += hTop + 1;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
          if (imgs.three) doc.text(pdfSafe(t('rep.img3d')), ML, y + 3);
          if (imgs.scan) doc.text(pdfSafe(t('rep.imgScan')), ML + half + 6, y + 3);
          y += 7;
        }
        if (imgs.profile) {
          const h = CW * imgs.profile.ratio;
          ensure(h + 8);
          doc.addImage(imgs.profile.url, 'JPEG', ML, y, CW, h); y += h + 1;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
          doc.text(pdfSafe(t('rep.imgProfile')), ML, y + 3); y += 7;
        }
      }
      heading(t('rep.notes'));
      text(t('rep.n1', { ref: t('rs.' + state.refSet), v: fmt(state.variability) }), 8.6);
      text(t('rep.n2'), 8.6); text(t('rep.n3'), 8.6); text(t('rep.n4'), 8.6);
      y += 1; text(t('rep.disclaimer'), 8.6, 'bold', [140, 40, 30]);
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(130);
        doc.text(pdfSafe(t('rep.page', { n: i, m: pages }) + '  ·  Aortic root viewer v.2.0'), PW - MR, PH - 8, { align: 'right' });
      }
      await saveFile(`${t('rep.fname')}-${state.studyDate}.pdf`, doc.output('blob'));
    } catch (err) {
      toast(t('report.failed'));
    } finally {
      btn.disabled = false;
      requestRender(true, true);
    }
  }

  /* ===================== Patient view ===================== */
  function renderPatientSummary() {
    const L = state.reference.levels, z = models.pt.z;
    const dil = LEVELS.filter(l => z[l.key] >= 2).sort((a, b) => z[b.key] - z[a.key])[0];
    $('pm-summary').textContent = dil
      ? t('pm.sumDil', { d: fmt(state.measured[dil.key]), level: t('lvp.' + dil.key), e: fmt(L[dil.key].mean, 0), hi: fmt(L[dil.key].mean + 2 * L[dil.key].sd, 0) })
      : t('pm.sumOk');
    $('pm-gauges').innerHTML = LEVELS.map(lv => {
      const r = L[lv.key], lo = r.mean - 2 * r.sd, hi = r.mean + 2 * r.sd, v = state.measured[lv.key];
      const min = Math.min(lo, v) - 4, max = Math.max(hi, v) + 4, pct = (x) => ((x - min) / (max - min)) * 100;
      const colour = z[lv.key] >= 2 ? 'var(--pt)' : 'var(--text)';
      return `<div><div class="gauge-head"><span>${lvName(lv.key)}</span><span>${t('pm.gauge', { lo: fmt(lo, 0), hi: fmt(hi, 0), v: fmt(v) })}</span></div>` +
        `<div class="track" aria-hidden="true"><div class="band" style="left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%"></div><div class="mark" style="left:${pct(v)}%;background:${colour}"></div></div></div>`;
    }).join('');
  }
  function setMode(mode) {
    state.mode = mode;
    document.body.classList.toggle('patient', mode === 'patient');
    for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    applyPanelTitles();
    if (mode === 'patient') renderPatientSummary();
    viewers.forEach(v => { v.tip.hidden = true; resize(v); updateDynamic(v); });
    save(); requestRender(true, true);
    if (mode === 'clinician') { drawProfile(); drawGrowth(); }
  }
  function applyPanelTitles() {
    const pt = state.mode === 'patient';
    $('ref-title').textContent = t(pt ? 'pm.left' : 'p.ref.title');
    $('pt-title').textContent = t(pt ? 'pm.right' : 'p.pt.title');
  }

  /* ===================== Tables and panels ===================== */
  function zRange(key) {
    const L = state.reference.levels[key], m = state.measured[key], e = state.variability;
    return [(m - e - L.mean) / L.sd, (m + e - L.mean) / L.sd];
  }
  function assessText(key) {
    const z = models.pt.z[key], [lo, hi] = zRange(key);
    let text = z >= 2 ? t('st.dil') : z <= -2 ? t('st.low') : t('st.ok');
    if ((lo < 2 && hi >= 2) || (lo <= -2 && hi > -2)) text += t('st.border');
    return text;
  }
  function updateTables() {
    const L = state.reference.levels;
    $('bsa').textContent = fmt(state.reference.bsa, 2);
    const refRows = $('table-ref').tBodies[0].rows, ptRows = $('table-pt').tBodies[0].rows;
    LEVELS.forEach((lv, i) => {
      const r = L[lv.key], c1 = refRows[i];
      c1.querySelector('.lvl').textContent = lvName(lv.key);
      c1.querySelector('[data-f="exp"]').textContent = fmt(r.mean) + ' mm';
      c1.querySelector('[data-f="rng"]').textContent = fmt(r.mean - 2 * r.sd) + '–' + fmt(r.mean + 2 * r.sd) + ' mm';
      c1.querySelector('[data-f="basis"]').textContent = basisText(r.basis);
      const c2 = ptRows[i], z = models.pt.z[lv.key];
      c2.querySelector('.lvl').textContent = lvName(lv.key);
      c2.querySelector('input').setAttribute('aria-label', t('aria.measured', { name: lvName(lv.key) }));
      c2.querySelector('[data-f="exp"]').innerHTML = `${fmt(r.mean)} <span class="sub">(${fmt(r.mean - 2 * r.sd)}–${fmt(r.mean + 2 * r.sd)})</span>`;
      c2.querySelector('[data-f="z"]').innerHTML = `${signed(z)} <span class="sub">(${signed(zRange(lv.key)[0])} / ${signed(zRange(lv.key)[1])})</span>`;
      const st = c2.querySelector('[data-f="st"]');
      st.textContent = assessText(lv.key);
      st.className = z >= 3.5 ? 'st-hot' : z >= 2 ? 'st-dil' : z <= -2 ? 'st-low' : 'st-ok';
    });
    $('pt-caption').textContent = t('cap.pt', { v: fmt(state.variability), conv: lcFirst(t('conv.' + state.convention)) });
    $('conv-note').textContent = state.convention === 'le-ed' ? '' : t('convn.' + state.convention);
    $('ref-sub').textContent = `${t('rs.' + state.refSet)}: ${lcFirst(t('rsn.' + state.refSet))}`;
    $('fu-method').textContent = t('method.' + currentMethod());
  }
  function updateGrowthTable() {
    const body = $('growth').tBodies[0];
    body.textContent = '';
    for (const lv of LEVELS) {
      const g = growthFor(lv.key), tr = document.createElement('tr');
      const td = (txt, cls) => { const c = document.createElement('td'); c.textContent = txt; if (cls) c.className = cls; tr.appendChild(c); };
      td(lvName(lv.key));
      if (!g) { td('–'); td('–'); td('–'); td(t('g.noPrev'), 'wrap'); }
      else { td(`${shortDate(g.since)} · ${t('method.' + g.sinceMethod)}`); td(signed(g.d) + ' mm'); td(signed(g.rate) + ' ' + t('unit.mmyr')); td(notesText(g.notes), 'wrap ' + g.cls); }
      body.appendChild(tr);
    }
  }
  function renderStudies() {
    const body = $('studies').tBodies[0];
    body.textContent = '';
    const cur = parseDate(state.studyDate);
    const sorted = [...state.priors].sort((a, b) => (parseDate(a.date) || 0) - (parseDate(b.date) || 0));
    for (const p of sorted) {
      const tr = document.createElement('tr');
      const tdD = document.createElement('td'), di = document.createElement('input');
      di.type = 'date'; di.value = p.date; di.setAttribute('aria-label', t('aria.priorDate'));
      const dateOk = () => { const v = parseDate(di.value); return Number.isFinite(v) && v < cur; };
      const markDate = () => { di.setAttribute('aria-invalid', String(!dateOk())); di.title = dateOk() ? '' : t('fu.dateErr'); };
      markDate();
      di.addEventListener('change', () => { markDate(); p.date = di.value; onStudiesChanged(); });
      tdD.appendChild(di); tr.appendChild(tdD);
      const tdM = document.createElement('td'), ms = document.createElement('select');
      for (const mth of ['echo', 'ctmr']) { const o = document.createElement('option'); o.value = mth; o.textContent = t('method.' + mth); ms.appendChild(o); }
      ms.value = p.method; ms.setAttribute('aria-label', t('th.method'));
      ms.addEventListener('change', () => { p.method = ms.value; onStudiesChanged(); });
      tdM.appendChild(ms); tr.appendChild(tdM);
      for (const lv of LEVELS) {
        const td = document.createElement('td'), inp = document.createElement('input');
        inp.type = 'number'; inp.min = 10; inp.max = 90; inp.step = 0.5; inp.inputMode = 'decimal';
        inp.value = Number.isFinite(p[lv.key]) ? p[lv.key] : '';
        inp.setAttribute('aria-label', t('aria.priorVal', { name: lvName(lv.key), d: shortDate(p.date) }));
        inp.addEventListener('input', () => {
          if (inp.value === '') { p[lv.key] = null; inp.setAttribute('aria-invalid', 'false'); onStudiesChanged(); return; }
          const x = Number(inp.value), ok = Number.isFinite(x) && x >= 10 && x <= 90;
          inp.setAttribute('aria-invalid', String(!ok));
          if (ok) { p[lv.key] = x; onStudiesChanged(); }
        });
        td.appendChild(inp); tr.appendChild(td);
      }
      const tdX = document.createElement('td'), rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'remove'; rm.textContent = '×'; rm.setAttribute('aria-label', t('aria.remove', { d: shortDate(p.date) }));
      rm.addEventListener('click', () => { state.priors = state.priors.filter(q => q !== p); renderStudies(); onStudiesChanged(); });
      tdX.appendChild(rm); tr.appendChild(tdX);
      body.appendChild(tr);
    }
    const tr = document.createElement('tr');
    tr.className = 'current';
    const cells = [t('fu.current'), t('method.' + currentMethod()), ...LEVELS.map(lv => fmt(state.measured[lv.key])), ''];
    cells.forEach((c, i) => { const td = document.createElement('td'); if (i === 0) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = c; td.appendChild(s); } else td.textContent = c; tr.appendChild(td); });
    body.appendChild(tr);
  }
  function onStudiesChanged() { save(); refresh({ studies: false }); }
  function updateStiffness() {
    const res = stiffnessResult(), box = $('st-results'), m = EVIDENCE.aorticStrain;
    const filled = ['sys', 'dia', 'sbp', 'dbp'].every(k => Number.isFinite(state.stiff[k]));
    if (res) {
      box.innerHTML = `<div><span>${t('st.strain')}</span><strong>${fmt(res.strain * 100)}%</strong></div>` +
        `<div><span>${t('st.dist')}</span><strong>${fmt(res.dist3, 2)}</strong> <span>10⁻³ mmHg⁻¹ (${fmt(res.distCgs, 2)} 10⁻⁶ cm²·dyn⁻¹)</span></div>` +
        `<div><span>${t('st.beta')}</span><strong>${fmt(res.beta, 2)}</strong></div>`;
      $('st-help').textContent = t('st.helpOk', { m: fmt(m.mean * 100), sd: fmt(m.sd * 100) });
    } else {
      box.innerHTML = '';
      $('st-help').textContent = filled ? t('st.helpBad') : t('st.helpEmpty', { m: fmt(m.mean * 100) });
    }
  }

  /* ===================== ECG ===================== */
  const ecg = { canvas: null, ctx: null, lastX: null, lastY: null, window: 3 };
  const ecgY = (val, H) => H * 0.62 - val * H * 0.48;
  function drawEcgStatic() {
    const c = ecg.canvas;
    if (!c || !fitCanvas(c)) return;
    const ctx = ecg.ctx, W = c.width, H = c.height, tm = cycleTiming(state.hr, state.patient.sex);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,92,77,0.45)'; ctx.lineWidth = 1.2 * dpr();
    ctx.beginPath();
    for (let x = 0; x <= W; x++) { const y = ecgY(ecgValue((x / W) * ecg.window + tm.pr, tm), H); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ecg.lastX = null;
  }
  function drawEcgSweep(tAbs, tm) {
    const c = ecg.canvas, ctx = ecg.ctx, W = c.width, H = c.height;
    if (!W) return;
    const x = ((tAbs % ecg.window) / ecg.window) * W, y = ecgY(ecgValue(tAbs, tm), H), gap = 14 * dpr();
    if (ecg.lastX === null || x < ecg.lastX) {
      if (ecg.lastX === null) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
      ecg.lastX = 0; ecg.lastY = y;
    }
    ctx.fillStyle = '#000'; ctx.fillRect(x, 0, Math.min(gap, W - x), H);
    ctx.strokeStyle = 'rgba(255,92,77,0.95)'; ctx.lineWidth = 1.4 * dpr();
    ctx.beginPath(); ctx.moveTo(ecg.lastX, ecg.lastY);
    const steps = Math.max(1, Math.ceil(x - ecg.lastX));
    for (let i = 1; i <= steps; i++) {
      const xi = ecg.lastX + ((x - ecg.lastX) * i) / steps;
      ctx.lineTo(xi, ecgY(ecgValue(tAbs - ((x - xi) / W) * ecg.window, tm), H));
    }
    ctx.stroke();
    ecg.lastX = x; ecg.lastY = y;
  }

  /* ===================== Render loop ===================== */
  // 3D views render every frame while something moves. Scan rasters are the expensive part, so during
  // the heartbeat they alternate between the two panels, one per frame.
  let pending = false, want3d = false, nextScan = 0;
  const wantScan = new Set();
  function requestRender(r3d, r2d) {
    want3d = want3d || r3d;
    if (r2d) viewers.forEach(v => wantScan.add(v));
    if (!pending) { pending = true; requestAnimationFrame(frame); }
  }
  function frame(now) {
    pending = false;
    now = now || performance.now();
    let keepGoing = false;
    if (state.tween) {
      const tw = state.tween, x = clamp((now - tw.t0) / tw.dur, 0, 1), e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      for (const k of ['theta', 'phi', 'radius']) state.orbit[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      applyOrbit();
      if (x >= 1) state.tween = null; else keepGoing = true;
    }
    if (state.playing) {
      const tm = cycleTiming(state.hr, state.patient.sex), sec = (now - state.t0) / 1000;
      state.cyc = cardiacState(sec, tm);
      viewers.forEach(updateDynamic);
      want3d = true;
      wantScan.clear();
      wantScan.add(viewers[nextScan % viewers.length]); nextScan++;
      if (fitCanvas(ecg.canvas)) drawEcgSweep(sec, tm);
      $('beat-dot').classList.toggle('on', state.cyc.t < 0.12);
      $('phase').textContent = t(state.cyc.phase);
      keepGoing = true;
    }
    if (want3d) for (const v of viewers) if (v.renderer) v.renderer.render(v.scene, v.camera);
    want3d = false;
    for (const v of wantScan) renderScan(v);
    wantScan.clear();
    if (keepGoing) { pending = true; requestAnimationFrame(frame); }
  }

  /* ===================== UI ===================== */
  const slider = $('slice'), sliceOut = $('slice-out');
  function setS(s) {
    state.s = clamp(s, 0, LEN);
    slider.value = state.s.toFixed(1);
    sliceOut.textContent = t('slice.out', { mm: fmt(state.s), name: t(levelKeyAt(state.s)).replace(/ \(.*\)$/, '') });
    for (const b of $('jumps').children) b.setAttribute('aria-current', String(Math.abs(Number(b.dataset.s) - state.s) < 0.6));
    for (const tr of document.querySelectorAll('#table-ref tbody tr, #table-pt tbody tr')) tr.classList.toggle('active', Math.abs(Number(tr.dataset.s) - state.s) <= 2.5);
    viewers.forEach(updateDynamic);
    drawProfile();
    requestRender(true, true);
  }
  function setPlaying(on) {
    state.playing = on;
    $('play').setAttribute('aria-pressed', String(on));
    $('play-label').textContent = t(on ? 'hb.stop' : 'hb.start');
    $('play-icon').setAttribute('d', on ? 'M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z' : 'M4 2.5v11l9-5.5z');
    if (on) { state.t0 = performance.now(); ecg.lastX = null; }
    else {
      state.cyc = REST;
      $('phase').textContent = t(REST.phase);
      $('beat-dot').classList.remove('on');
      viewers.forEach(updateDynamic);
      drawEcgStatic();
    }
    requestRender(true, true);
  }
  function setHeartRate(hr) {
    if (state.playing) {
      const now = performance.now(), oldT = 60 / state.hr, newT = 60 / hr;
      const frac = (((now - state.t0) / 1000) % oldT) / oldT;
      state.t0 = now - frac * newT * 1000;
      ecg.lastX = null;
    }
    state.hr = hr;
    $('hr-range').value = hr; $('hr-num').value = hr; $('bpm-val').textContent = hr;
    if (!state.playing) drawEcgStatic();
    save();
  }
  const pressGroup = (sel, attr, value) => { for (const b of document.querySelectorAll(sel)) b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))); };
  function syncInputs() {
    for (const k of ['age', 'height', 'weight']) { $(k).value = state.patient[k]; $(k).setAttribute('aria-invalid', 'false'); }
    $('demo-msg').textContent = '';
    pressGroup('[data-sex]', 'sex', state.patient.sex);
    LEVELS.forEach((lv, i) => { const inp = $('table-pt').tBodies[0].rows[i].querySelector('input'); inp.value = state.measured[lv.key]; inp.setAttribute('aria-invalid', 'false'); });
    $('study-date').value = state.studyDate;
    $('convention').value = state.convention;
    $('variability').value = state.variability;
    for (const k of ['sys', 'dia', 'sbp', 'dbp']) $('st-' + k).value = Number.isFinite(state.stiff[k]) ? state.stiff[k] : '';
    for (const r of document.querySelectorAll('input[name="refset"]')) r.checked = r.value === state.refSet;
  }
  function selectTab(name, focus) {
    state.tab = name;
    for (const b of document.querySelectorAll('.tab')) {
      const on = b.id === 'tab-' + name;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
      $(b.getAttribute('aria-controls')).hidden = !on;
    }
    if (name === 'profile') drawProfile();
    if (name === 'followup') drawGrowth();
  }
  function fillSelect(sel, items) {
    const keep = sel.value;
    sel.textContent = '';
    for (const [value, label] of items) { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); }
    if (keep) sel.value = keep;
  }
  // Re-labels everything that depends on the language
  function applyLanguage() {
    LANG = state.lang;
    document.documentElement.lang = LANG;
    document.title = t('app.title') + ' v.2.0';
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of document.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', t(el.dataset.i18nPh));
    for (const el of document.querySelectorAll('.no-gl')) el.setAttribute('data-nogl', t('nogl'));
    for (const el of document.querySelectorAll('[data-lang]')) el.hidden = el.dataset.lang !== LANG;
    pressGroup('[data-lang-btn]', 'langBtn', LANG);
    for (const b of $('jumps').children) b.textContent = lvName(b.dataset.key);
    fillSelect($('cause'), ['tav', 'bav', 'marfan', 'lds', 'htad'].map(c => [c, t('cause.' + c)]));
    $('cause').value = state.dec.cause;
    fillSelect($('pheno'), [['auto', ''], ['root', t('pheno.rootF')], ['asc', t('pheno.ascF')]]);
    $('pheno').value = state.dec.pheno;
    fillSelect($('convention'), CONVENTIONS.map(c => [c, t('conv.' + c)]));
    $('convention').value = state.convention;
    const rs = $('refsets'); rs.textContent = '';
    for (const key of REF_SETS) {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span'), small = document.createElement('small');
      input.type = 'radio'; input.name = 'refset'; input.value = key; input.checked = state.refSet === key;
      input.addEventListener('change', () => { if (input.checked) { state.refSet = key; save(); refresh(); } });
      text.textContent = t('rs.' + key); small.textContent = t('rsn.' + key);
      text.appendChild(document.createElement('br')); text.appendChild(small);
      label.append(input, text); rs.appendChild(label);
    }
    for (const el of document.querySelectorAll('.meas .lvl')) el.title = t('aria.showLevel');
    $('play-label').textContent = t(state.playing ? 'hb.stop' : 'hb.start');
    $('phase').textContent = t(state.cyc.phase);
    applyPanelTitles();
  }

  function buildControls() {
    slider.max = Math.floor(LEN);
    for (const lv of LEVELS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.dataset.s = lv.s; b.dataset.key = lv.key;
      b.addEventListener('click', () => setS(lv.s));
      $('jumps').appendChild(b);
    }
    slider.addEventListener('input', () => setS(Number(slider.value)));
    const refBody = $('table-ref').tBodies[0], ptBody = $('table-pt').tBodies[0];
    for (const lv of LEVELS) {
      const mkLevelCell = () => {
        const td = document.createElement('td'), b = document.createElement('button');
        b.type = 'button'; b.className = 'lvl';
        b.addEventListener('click', () => setS(lv.s));
        td.appendChild(b); return td;
      };
      const r1 = document.createElement('tr'); r1.dataset.s = lv.s;
      r1.appendChild(mkLevelCell());
      for (const [f, cls] of [['exp', ''], ['rng', ''], ['basis', 'wrap']]) { const td = document.createElement('td'); td.dataset.f = f; if (cls) td.className = cls; r1.appendChild(td); }
      refBody.appendChild(r1);
      const r2 = document.createElement('tr'); r2.dataset.s = lv.s;
      r2.appendChild(mkLevelCell());
      const td = document.createElement('td'), inp = document.createElement('input');
      inp.type = 'number'; inp.min = 10; inp.max = 90; inp.step = 0.5; inp.inputMode = 'decimal';
      inp.addEventListener('input', () => {
        const x = Number(inp.value), ok = inp.value !== '' && Number.isFinite(x) && x >= 10 && x <= 90;
        inp.setAttribute('aria-invalid', String(!ok));
        if (ok) { state.measured[lv.key] = x; save(); refresh(); }
      });
      td.appendChild(inp); r2.appendChild(td);
      for (const f of ['exp', 'z', 'st']) { const c = document.createElement('td'); c.dataset.f = f; r2.appendChild(c); }
      ptBody.appendChild(r2);
    }
    const demoInputs = [
      { id: 'age', min: 15, max: 100, msg: 'msg.age' }, { id: 'height', min: 120, max: 220, msg: 'msg.height' }, { id: 'weight', min: 30, max: 200, msg: 'msg.weight' }
    ];
    for (const d of demoInputs) {
      const el = $(d.id);
      el.addEventListener('input', () => {
        const x = Number(el.value), ok = el.value !== '' && Number.isFinite(x) && x >= d.min && x <= d.max;
        el.setAttribute('aria-invalid', String(!ok));
        $('demo-msg').textContent = demoInputs.filter(o => $(o.id).getAttribute('aria-invalid') === 'true').map(o => t(o.msg)).join(' ');
        if (ok) { state.patient[d.id] = x; save(); refresh(); }
      });
    }
    for (const b of document.querySelectorAll('[data-sex]')) {
      b.addEventListener('click', () => { state.patient.sex = b.dataset.sex; pressGroup('[data-sex]', 'sex', b.dataset.sex); save(); refresh(); if (!state.playing) drawEcgStatic(); });
    }
    for (const b of document.querySelectorAll('[data-fov]')) b.addEventListener('click', () => { state.fov = Number(b.dataset.fov); pressGroup('[data-fov]', 'fov', state.fov); viewers.forEach(updateDynamic); requestRender(true, true); });
    for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => { state.view = b.dataset.view; pressGroup('[data-view]', 'view', state.view); viewers.forEach(updateDynamic); requestRender(true, true); });
    for (const b of document.querySelectorAll('[data-cam]')) b.addEventListener('click', () => goToCamera(b.dataset.cam));
    for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
    for (const b of document.querySelectorAll('[data-lang-btn]')) b.addEventListener('click', () => { state.lang = b.dataset.langBtn; save(); applyLanguage(); refresh({ studies: true }); updateStiffness(); setS(state.s); if (!state.playing) drawEcgStatic(); });
    $('ghost').addEventListener('change', (e) => { state.showGhost = e.target.checked; viewers.forEach(updateDynamic); requestRender(true, true); });
    $('prior-outline').addEventListener('change', (e) => { state.showPrior = e.target.checked; refresh({ studies: false }); });
    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('hr-range').addEventListener('input', (e) => setHeartRate(Number(e.target.value)));
    $('hr-num').addEventListener('input', (e) => {
      const x = Number(e.target.value), ok = e.target.value !== '' && Number.isInteger(x) && x >= 30 && x <= 200;
      e.target.setAttribute('aria-invalid', String(!ok));
      if (ok) setHeartRate(x);
    });
    // Tabs (arrow keys move between them)
    const tabs = [...document.querySelectorAll('.tab')];
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => selectTab(b.id.slice(4)));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(n.id.slice(4), true);
      });
    });
    // Decision inputs
    $('cause').addEventListener('change', (e) => { state.dec.cause = e.target.value; save(); refresh({ studies: false }); });
    $('pheno').addEventListener('change', (e) => { state.dec.pheno = e.target.value; save(); renderDecision(); });
    for (const k of ['hr', 'low', 'avs', 'ocs', 'preg', 'height']) $('dec-' + k).addEventListener('change', (e) => { state.dec[k] = e.target.checked; save(); renderDecision(); });
    // Follow-up
    const sd = $('study-date');
    sd.addEventListener('change', () => {
      const ok = Number.isFinite(parseDate(sd.value));
      sd.setAttribute('aria-invalid', String(!ok));
      if (ok) { state.studyDate = sd.value; save(); refresh(); }
    });
    $('add-study').addEventListener('click', () => {
      state.priors.push({ id: Math.random().toString(36).slice(2), date: isoShift(state.studyDate, -1), method: currentMethod(), annulus: null, sov: null, stj: null, aa: null });
      renderStudies(); onStudiesChanged();
      const inputs = $('studies').querySelectorAll('input[type="date"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $('example-studies').addEventListener('click', () => {
      state.priors.push(
        { id: 'ex1', date: isoShift(state.studyDate, -2), method: 'echo', annulus: 26, sov: 36.5, stj: 30, aa: 35 },
        { id: 'ex2', date: isoShift(state.studyDate, -1.5), method: 'ctmr', annulus: 25, sov: 37, stj: 29, aa: 37 },
        { id: 'ex3', date: isoShift(state.studyDate, -1), method: 'echo', annulus: 26, sov: 38, stj: 30, aa: 38.5 }
      );
      renderStudies(); onStudiesChanged();
    });
    $('clear-saved').addEventListener('click', () => {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      state.priors = []; state.stiff = { sys: null, dia: null, sbp: null, dbp: null };
      for (const k of ['sys', 'dia', 'sbp', 'dbp']) $('st-' + k).value = '';
      renderStudies(); refresh({ studies: false }); updateStiffness();
    });
    for (const b of document.querySelectorAll('[data-gm]')) b.addEventListener('click', () => { state.growthMetric = b.dataset.gm; pressGroup('[data-gm]', 'gm', state.growthMetric); drawGrowth(); });
    // Method
    $('convention').addEventListener('change', (e) => { state.convention = e.target.value; save(); refresh(); });
    const vb = $('variability');
    vb.addEventListener('input', () => {
      const x = Number(vb.value), ok = vb.value !== '' && x >= 1 && x <= 5;
      vb.setAttribute('aria-invalid', String(!ok));
      if (ok) { state.variability = x; save(); refresh({ studies: false }); }
    });
    // Stiffness
    for (const k of ['sys', 'dia', 'sbp', 'dbp']) {
      const el = $('st-' + k);
      el.addEventListener('input', () => {
        state.stiff[k] = el.value === '' ? null : Number(el.value);
        const x = state.stiff[k], ok = x === null || (Number.isFinite(x) && x >= Number(el.min) && x <= Number(el.max));
        el.setAttribute('aria-invalid', String(!ok));
        updateModels(); updateStiffness(); save();
        viewers.forEach(updateDynamic); requestRender(true, true);
      });
    }
    // Import
    $('import-btn').addEventListener('click', () => {
      const panel = $('import'), open = panel.hidden;
      panel.hidden = !open; $('import-btn').setAttribute('aria-expanded', String(open));
      if (open) $('imp-text').focus();
    });
    $('imp-close').addEventListener('click', () => { $('import').hidden = true; $('import-btn').setAttribute('aria-expanded', 'false'); $('import-btn').focus(); });
    $('imp-read').addEventListener('click', () => {
      importRows = parseReport($('imp-text').value);
      renderImportPreview();
      $('imp-msg').textContent = importRows.length ? t('imp.found', { n: importRows.length }) : t('imp.none');
    });
    $('imp-apply').addEventListener('click', applyImport);
    $('report-btn').addEventListener('click', makeReport);
    // Canvases
    ecg.canvas = $('ecg'); ecg.ctx = ecg.canvas.getContext('2d');
    new ResizeObserver(() => { if (!state.playing) drawEcgStatic(); }).observe(ecg.canvas);
    profile.canvas = $('profile'); profile.ctx = profile.canvas.getContext('2d');
    new ResizeObserver(() => drawProfile()).observe(profile.canvas);
    attachProfilePointer();
    growthChart.canvas = $('growth-chart'); growthChart.ctx = growthChart.canvas.getContext('2d');
    new ResizeObserver(() => drawGrowth()).observe(growthChart.canvas);
  }
  function refresh(opts = {}) {
    updateModels();
    updateTables();
    if (opts.studies !== false) renderStudies();
    else { const cur = $('studies').querySelector('tr.current'); if (cur) { const cells = cur.children; cells[1].textContent = t('method.' + currentMethod()); LEVELS.forEach((lv, i) => { cells[i + 2].textContent = fmt(state.measured[lv.key]); }); } }
    updateGrowthTable();
    renderDecision();
    if (state.mode === 'patient') renderPatientSummary();
    viewers.forEach(rebuildViewer);
    viewers.forEach(updateDynamic);
    drawProfile(); drawGrowth();
    requestRender(true, true);
  }

  /* ===================== Boot ===================== */
  load();
  LANG = state.lang;
  updateModels();
  buildControls();
  applyLanguage();
  syncInputs();
  createViewer('ref');
  createViewer('pt');
  for (const el of document.querySelectorAll('.no-gl')) el.setAttribute('data-nogl', t('nogl'));
  document.body.classList.toggle('patient', state.mode === 'patient');
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  viewers.forEach(resize);
  refresh();
  updateStiffness();
  applyPanelTitles();
  applyOrbit();
  setS(state.s);
  setHeartRate(state.hr);
  drawEcgStatic();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawProfile(); drawGrowth(); requestRender(false, true); });

  // Test hook, present only when a test harness sets the flag before this script runs
  if (window.__AORTIC_DEBUG__) {
    window.__aortic = {
      state, models, setS, viewers, LEN, growthFor, referenceFor, evaluateGuideline, parseReport, makeReport, setMode, applyLanguage,
      maxDiameter, indexedMeasures, renderRaster, renderScan, refresh, I18N,
      census(v) { renderRaster(v); const counts = {}; for (const l of v.labels) counts[v.names[l]] = (counts[v.names[l]] || 0) + 1; return counts; }
    };
  }
