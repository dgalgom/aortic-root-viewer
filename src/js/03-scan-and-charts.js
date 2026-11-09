  /* ===================== Scan view ===================== */
  function labelText(key) {
    if (key.startsWith('cav:')) return t('an.cavity', { n: t(key.slice(4)) });
    if (key.startsWith('wall:')) return t('an.wall', { n: t(key.slice(5)) });
    return t(key);
  }
  function attachScanPointer(v) {
    let pressed = false;
    const local = (e) => {
      const rect = v.canvas2d.getBoundingClientRect();
      const W = rect.width, H = rect.height, side = Math.min(W, H);
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      return { x, y, W, H, px: Math.floor(((x - (W - side) / 2) / side) * RAW), py: Math.floor(((y - (H - side) / 2) / side) * RAW),
        u: ((x - W / 2) / side) * state.fov, w: ((H / 2 - y) / side) * state.fov };
    };
    const tip = (p) => {
      if (p.px < 0 || p.py < 0 || p.px >= RAW || p.py >= RAW || !v.names.length) { v.tip.hidden = true; return; }
      const key = v.names[v.labels[p.py * RAW + p.px]];
      v.tip.textContent = key ? labelText(key) : '';
      v.tip.style.left = p.x + 'px'; v.tip.style.top = p.y + 'px';
      v.tip.style.transform = p.x > p.W - 180 ? 'translate(calc(-100% - 12px), -50%)' : '';
      v.tip.hidden = !v.tip.textContent;
    };
    const scrub = (p) => {
      if (state.view !== 'plax') return;
      let best = -1, bd = Infinity;
      for (let i = 0; i < NS && cl.s[i] <= S_ARCH; i++) {
        const d = cl.P[i].clone().sub(PLAX.P), du = d.dot(PLAX.R) - p.u, dw = d.dot(PLAX.U) - p.w, dd = du * du + dw * dw;
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0 && Math.sqrt(bd) < models.pt.prof(cl.s[best]) / 2 + 12) setS(cl.s[best]);
    };
    v.canvas2d.addEventListener('pointermove', (e) => { const p = local(e); tip(p); if (pressed) scrub(p); });
    v.canvas2d.addEventListener('pointerdown', (e) => { pressed = true; const p = local(e); tip(p); scrub(p); });
    const up = () => { pressed = false; };
    v.canvas2d.addEventListener('pointerup', up);
    v.canvas2d.addEventListener('pointercancel', up);
    v.canvas2d.addEventListener('pointerleave', () => { pressed = false; v.tip.hidden = true; });
  }

  const NOISE = new Float32Array(RAW * RAW);
  (function seedNoise() {   // static speckle so the image looks like a scan without flicker
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < NOISE.length; i++) NOISE[i] = (rnd() + rnd() + rnd() - 1.5) * 0.05;
  })();
  const TONE = { lung: 0.03, soft: 0.17, myo: 0.40, blood: 0.72, vwall: 0.42, vlum: 0.70, cwall: 0.5, clum: 0.82, awall: 0.47, alum: 0.88 };
  function ellipsoidCoefs(e, P, R, U) {
    const d = P.clone().sub(e.C), out = [];
    for (let k = 0; k < 3; k++) out.push(d.dot(e.e[k]) / e.r[k], R.dot(e.e[k]) / e.r[k], U.dot(e.e[k]) / e.r[k]);
    return out;
  }
  // Union of sphere–plane circles approximates any tube's cut; short runs with their own bounding boxes keep it fast.
  function circleGroup(runs, P, Nn, R, U, wall, lum, wallTone, nameId, half) {
    const chunks = [], lim = half + 30;
    for (const run of runs) {
      const c = [];
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const smp of run) {
        const dx = smp.p.x - P.x, dy = smp.p.y - P.y, dz = smp.p.z - P.z;
        const d = dx * Nn.x + dy * Nn.y + dz * Nn.z, ro = smp.r + wall;
        if (Math.abs(d) >= ro) continue;
        const cu = dx * R.x + dy * R.y + dz * R.z, cvv = dx * U.x + dy * U.y + dz * U.z;
        if (Math.abs(cu) > lim || Math.abs(cvv) > lim) continue;
        const ro2 = ro * ro - d * d, rr = Math.sqrt(ro2);
        c.push(cu, cvv, ro2, smp.r * smp.r - d * d, nameId(smp.label));
        minU = Math.min(minU, cu - rr); maxU = Math.max(maxU, cu + rr); minV = Math.min(minV, cvv - rr); maxV = Math.max(maxV, cvv + rr);
      }
      if (c.length) chunks.push({ c, minU, maxU, minV, maxV });
    }
    return { chunks, lum, wall: wallTone };
  }
  // One raster for either view. In short axis the aorta at the level is drawn exactly (three-lobed); elsewhere tubes are sphere unions.
  function renderRaster(v) {
    const m = v.model, s = state.s, cyc = state.cyc, k = aorticScale(m), fov = state.fov, sax = state.view === 'sax';
    let P, Nn, R, U, f = null;
    if (sax) { f = frameAt(s); const ax = screenAxes(f.T); P = f.P; Nn = f.T; R = ax.R; U = ax.U; }
    else { P = PLAX.P; Nn = PLAX.N; R = PLAX.R; U = PLAX.U; }
    const mmpp = fov / RAW, half = RAW / 2;
    const names = [], ids = new Map();
    const nameId = (n) => { if (!ids.has(n)) { ids.set(n, names.length); names.push(n); } return ids.get(n); };
    const ID_LUNG = nameId('an.lung'), ID_SOFT = nameId('an.soft');
    const ells = [];
    for (const c of CHAMBERS) {
      const d = chamberAt(c, cyc), rmax = Math.max(d.r[0], d.r[1], d.r[2]);
      const off = d.C.clone().sub(P), dist = off.dot(Nn);
      if (Math.abs(dist) >= rmax) continue;
      const cu = off.dot(R), cvv = off.dot(U), rr = Math.sqrt(rmax * rmax - dist * dist);
      ells.push({ k: ellipsoidCoefs(d, P, R, U), inner: d.inner, idBlood: nameId('cav:' + c.name), idWall: nameId('wall:' + c.name),
        minU: cu - rr, maxU: cu + rr, minV: cvv - rr, maxV: cvv + rr });
    }
    const med = ellipsoidCoefs(MEDIASTINUM, P, R, U);
    const aortaSamples = [];
    const stepI = sax ? 1 : 2;   // the long-axis cut runs along the aorta, so half the samples (1.7 mm apart) suffice
    for (let i = 0; i < NS; i += stepI) if (!sax || Math.abs(cl.s[i] - s) > 30) aortaSamples.push({ p: cl.P[i], r: (m.prof(cl.s[i]) / 2) * k, label: aortaPartKey(cl.s[i]) });
    coronaries(m);
    const groups = [
      circleGroup(VESSEL_RUNS, P, Nn, R, U, 1.5, TONE.vlum, TONE.vwall, nameId, fov / 2),
      circleGroup(m._corRuns, P, Nn, R, U, 0.6, TONE.clum, TONE.cwall, nameId, fov / 2),
      circleGroup(chunk(aortaSamples, sax ? 12 : 6), P, Nn, R, U, WALL, TONE.alum, TONE.awall, nameId, fov / 2)
    ].filter(g => g.chunks.length);
    let nU = 0, nV = 0, bU = 0, bV = 0, Rb = 0, la = 0, rmax2 = -1;
    if (sax) {
      Rb = (m.prof(s) / 2) * k; la = lobe(s);
      nU = f.N.dot(R); nV = f.N.dot(U); bU = f.B.dot(R); bV = f.B.dot(U);
      rmax2 = Math.pow(Rb * (1 + la) + WALL, 2);
    }
    const ID_AL = nameId('an.lumen'), ID_AW = nameId('an.awall');
    const data = v.img.data, labels = v.labels;
    for (let py = 0; py < RAW; py++) {
      const vv = (half - py - 0.5) * mmpp;
      for (let px = 0; px < RAW; px++) {
        const uu = (px + 0.5 - half) * mmpp;
        let val = TONE.lung, lab = ID_LUNG, q = 0;
        for (let j = 0; j < 9; j += 3) { const z = med[j] + uu * med[j + 1] + vv * med[j + 2]; q += z * z; }
        if (q < 1) { val = TONE.soft; lab = ID_SOFT; }
        for (const e of ells) {
          if (uu < e.minU || uu > e.maxU || vv < e.minV || vv > e.maxV) continue;
          const c = e.k;
          const a = c[0] + uu * c[1] + vv * c[2], b = c[3] + uu * c[4] + vv * c[5], cc = c[6] + uu * c[7] + vv * c[8];
          const qq = a * a + b * b + cc * cc;
          if (qq < 1) { if (qq < e.inner) { val = TONE.blood; lab = e.idBlood; } else { val = TONE.myo; lab = e.idWall; } }
        }
        for (const g of groups) {
          let hitW = -1, hitL = -1;
          for (const ch of g.chunks) {
            if (uu < ch.minU || uu > ch.maxU || vv < ch.minV || vv > ch.maxV) continue;
            const c = ch.c;
            for (let j = 0; j < c.length; j += 5) {
              const du = uu - c[j], dv = vv - c[j + 1], d2 = du * du + dv * dv;
              if (d2 < c[j + 2]) { if (hitW < 0) hitW = c[j + 4]; if (d2 < c[j + 3]) { hitL = c[j + 4]; break; } }
            }
            if (hitL >= 0) break;
          }
          if (hitL >= 0) { val = g.lum; lab = hitL; } else if (hitW >= 0) { val = g.wall; lab = hitW; }
        }
        if (rmax2 > 0) {
          const xn = uu * nU + vv * nV, xb = uu * bU + vv * bV, rr = xn * xn + xb * xb;
          if (rr < rmax2) {
            const r = Math.sqrt(rr), th = Math.atan2(xb, xn), Rt = Rb * (1 + la * Math.cos(3 * th));
            if (r < Rt) { val = TONE.alum; lab = ID_AL; } else if (r < Rt + WALL) { val = TONE.awall; lab = ID_AW; }
          }
        }
        const idx = py * RAW + px;
        labels[idx] = lab;
        let out = val + NOISE[idx] * (0.4 + val);   // clamp inlined: this runs ~48k times per frame
        out = (out < 0 ? 0 : out > 1 ? 1 : out) * 255;
        const o = idx * 4;
        data[o] = out * 0.93; data[o + 1] = out * 0.98; data[o + 2] = out; data[o + 3] = 255;
      }
    }
    v.names = names;
    v.rctx.putImageData(v.img, 0, 0);
    v.scan = { sax, P, R, U, Nn, f, k, geo: { nU, nV, bU, bV, Rb, la } };
    if (sax && s < VALVE_TOP) {   // closed "Mercedes" sign in diastole, cusps pressed toward the wall when open
      const rc = v.rctx, o = cyc.open, comms = [Math.PI / 3, Math.PI, (5 * Math.PI) / 3];
      const toRaw = (r, th) => [half + (r * (Math.cos(th) * nU + Math.sin(th) * bU)) / mmpp, half - (r * (Math.cos(th) * nV + Math.sin(th) * bV)) / mmpp];
      rc.strokeStyle = 'rgba(150,160,166,0.95)'; rc.lineWidth = 1.3; rc.lineCap = 'round';
      for (let c = 0; c < 3; c++) {
        const a1 = comms[c], a2 = comms[c] + (2 * Math.PI) / 3;
        rc.beginPath();
        for (let i = 0; i <= 24; i++) {
          const u = i / 24, th = a1 + u * (a2 - a1);
          const closedTh = u < 0.5 ? a1 : a2, closedR = u < 0.5 ? 1 - 2 * u : 2 * u - 1;
          const pC = toRaw(radiusAt(m, s, closedTh, k) * 0.98 * closedR, closedTh);
          const pO = toRaw(radiusAt(m, s, th, k) * 0.98 * (0.97 - 0.12 * Math.sin(Math.PI * u)), th);
          const x = pC[0] * (1 - o) + pO[0] * o, y = pC[1] * (1 - o) + pO[1] * o;
          i ? rc.lineTo(x, y) : rc.moveTo(x, y);
        }
        rc.stroke();
      }
    }
  }
  function renderScan(v) {
    if (state.mode !== 'clinician' || !fitCanvas(v.canvas2d)) return;
    renderRaster(v);
    drawScanOverlay(v, { cv: v.canvas2d, ctx: v.ctx, r: dpr() });
  }

  /* ----- Overlay text that never overlaps ----- */
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  // Draws lines of text on a translucent plate and returns its box. anchor: 'tl' | 'tr' | 'bl'
  function plateSize(ctx, lines, r) {
    const pad = 4 * r, widths = [], heights = [];
    for (const l of lines) { ctx.font = l.font; widths.push(ctx.measureText(l.t).width); heights.push(l.size * 1.35); }
    return { w: Math.max(...widths) + pad * 2, h: heights.reduce((a, c) => a + c, 0) + pad * 2, heights, pad };
  }
  function plate(ctx, lines, x, y, anchor, r) {
    if (!lines.length) return null;
    const { w, h, heights, pad } = plateSize(ctx, lines, r);
    const x0 = anchor === 'tr' ? x - w : x, y0 = anchor === 'bl' ? y - h : y;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x0, y0, w, h);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    let yy = y0 + pad;
    lines.forEach((l, i) => {
      ctx.font = l.font;
      if (l.parts) {
        let xx = x0 + pad;
        l.parts.forEach((p, j) => { ctx.fillStyle = p.c; ctx.fillText(p.t, xx, yy); xx += ctx.measureText(p.t + (j < l.parts.length - 1 ? '   ' : '')).width; });
      } else { ctx.fillStyle = l.c; ctx.fillText(l.t, x0 + pad, yy); }
      yy += heights[i];
    });
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  }
  // Places a short marker at (x, y); if it would sit on a text plate, slides it toward (cx, cy).
  function marker(ctx, text, x, y, cx, cy, boxes, r, colour) {
    ctx.font = `500 ${11 * r}px ${MONO}`;
    const w = ctx.measureText(text).width + 4 * r, h = 14 * r;
    for (let i = 0; i < 12; i++) {
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
      if (!boxes.some(b => b && overlaps(box, b))) break;
      x += (cx - x) * 0.12; y += (cy - y) * 0.12;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);   // readable on bright lumen too
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colour || 'rgba(214,223,225,0.85)';
    ctx.fillText(text, x, y);
  }
  function caliper(ctx, x1, y1, x2, y2, colour, r) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, px = -(y2 - y1) / len, py = (x2 - x1) / len, tk = 5 * r;
    ctx.strokeStyle = colour; ctx.lineWidth = 1.3 * r; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.moveTo(x1 - px * tk, y1 - py * tk); ctx.lineTo(x1 + px * tk, y1 + py * tk);
    ctx.moveTo(x2 - px * tk, y2 - py * tk); ctx.lineTo(x2 + px * tk, y2 + py * tk);
    ctx.stroke();
  }
  function drawScanOverlay(v, target) {
    const { cv, ctx, r } = target, W = cv.width, H = cv.height, fov = state.fov;
    const side = Math.min(W, H), sc = side / fov, cx = W / 2, cy = H / 2, sx0 = (W - side) / 2, sy0 = (H - side) / 2;
    const scan = v.scan, accent = v.key === 'ref' ? '#78c9d8' : '#f2aa3f';
    const toX = (u) => cx + u * sc, toY = (w) => cy - w * sc;
    const proj = (X) => { const d = X.clone().sub(scan.P); return [toX(d.dot(scan.R)), toY(d.dot(scan.U))]; };
    const compact = side < 320 * r;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    if ('filter' in ctx) ctx.filter = 'blur(' + (0.35 * r) + 'px)';
    ctx.drawImage(v.raw, sx0, sy0, side, side);
    if ('filter' in ctx) ctx.filter = 'none';

    const kRef = aorticScale(models.ref), kPrior = models.prior ? aorticScale(models.prior) : 1;
    const plaxWall = (m, s, k, sign) => {
      const f = frameAt(s), c = proj(f.P);
      let tu = f.T.dot(scan.R), tw = f.T.dot(scan.U); const l = Math.hypot(tu, tw) || 1; tu /= l; tw /= l;
      const hw = (m.prof(s) / 2) * k * sc;
      return [c[0] - tw * hw * sign, c[1] - tu * hw * sign];
    };
    const outline = (m, k, colour, dash, sMin = -Infinity, sMax = Infinity) => {
      ctx.save(); ctx.setLineDash(dash.map(x => x * r)); ctx.strokeStyle = colour; ctx.lineWidth = 1.2 * r;
      ctx.beginPath();
      if (scan.sax) {
        if (state.s < sMin || state.s > sMax) { ctx.restore(); return; }
        const g = scan.geo;
        for (let j = 0; j <= M; j++) {
          const th = (j / M) * Math.PI * 2, rr = radiusAt(m, state.s, th, k);
          const u = rr * (Math.cos(th) * g.nU + Math.sin(th) * g.bU), w = rr * (Math.cos(th) * g.nV + Math.sin(th) * g.bV);
          j ? ctx.lineTo(toX(u), toY(w)) : ctx.moveTo(toX(u), toY(w));
        }
      } else {
        for (const sign of [1, -1]) {
          let started = false;
          for (let s = Math.max(0, sMin); s <= Math.min(PROFILE_MAX + 20, sMax); s += 1) {
            const p = plaxWall(m, s, k, sign);
            started ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
            started = true;
          }
        }
      }
      ctx.stroke(); ctx.restore();
    };
    if (v.key === 'pt' && state.showGhost) outline(models.ref, kRef, 'rgba(120,201,216,0.9)', [5, 4]);
    if (v.key === 'pt' && state.showPrior && models.prior) outline(models.prior, kPrior, 'rgba(169,180,184,0.95)', [2, 3], models.prior.sMin, models.prior.sMax);

    if (scan.sax) {
      const g = scan.geo, r0 = g.Rb * (1 + g.la), rp = g.Rb * (1 - g.la);
      caliper(ctx, toX(r0 * g.nU), toY(r0 * g.nV), toX(-rp * g.nU), toY(-rp * g.nV), accent, r);
    } else {
      drawPlaxAnnotations(v, ctx, proj, plaxWall, accent, r);
    }

    // Text plates
    const k = scan.k, D = v.model.prof(state.s) * k, pad = 8 * r;
    const small = `400 ${11 * r}px ${MONO}`, strong = `500 ${11 * r}px ${MONO}`, big = `500 ${14 * r}px ${MONO}`;
    const muted = 'rgba(150,164,170,1)', white = 'rgba(214,223,225,0.95)';
    const boxes = [];
    boxes.push(plate(ctx, [
      { t: scan.sax ? t('sc.sax') : t('sc.plax'), c: muted, font: small, size: 11 * r },
      { t: t(levelKeyAt(state.s)) + (compact ? '' : ' · ' + t('sc.fromAnn', { mm: fmt(state.s) })), c: white, font: strong, size: 11 * r }
    ], pad, pad, 'tl', r));
    // Phase and scale bar, top right
    const phaseLines = [{ t: t(state.cyc.phase), c: state.playing ? 'rgba(255,92,77,0.95)' : muted, font: small, size: 11 * r }];
    const phaseW = plateSize(ctx, phaseLines, r).w, tl = boxes[0];
    const phaseY = tl && tl.x1 + 6 * r > W - pad - phaseW ? tl.y1 + 4 * r : pad;
    const phaseBox = plate(ctx, phaseLines, W - pad, phaseY, 'tr', r);
    boxes.push(phaseBox);
    const bar = 10 * sc, bx1 = W - pad - 4 * r, bx0 = bx1 - bar, by = phaseBox.y1 + 14 * r;
    ctx.strokeStyle = 'rgba(214,223,225,0.8)'; ctx.lineWidth = 1.2 * r; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(bx0, by - 4 * r); ctx.lineTo(bx0, by); ctx.lineTo(bx1, by); ctx.lineTo(bx1, by - 4 * r); ctx.stroke();
    ctx.font = small; ctx.fillStyle = 'rgba(214,223,225,0.8)'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('10 mm', bx1, by + 3 * r);
    boxes.push({ x0: bx0 - 4 * r, x1: bx1 + 4 * r, y0: by - 8 * r, y1: by + 16 * r });
    // Measurements, bottom left
    const lines = [{ t: state.playing ? t('sc.D', { d: fmt(D) }) : t('sc.dia', { d: fmt(D) }), c: accent, font: big, size: 14 * r }];
    if (!state.playing && !compact) lines.push({ t: t('sc.sys', { d: fmt(D * (1 + v.model.strain)), src: v.key === 'pt' && stiffnessResult() ? t('sc.measured') : t('sc.mean') }), c: 'rgba(214,223,225,0.8)', font: small, size: 11 * r });
    if (!scan.sax) {   // long-axis caliper values, colour-matched to the calipers, two per line
      const parts = LEVELS.map(lv => ({ t: t('lvs.' + lv.key) + ' ' + fmt(v.model.d[lv.key]), c: LEVEL_COLOURS[lv.key] }));
      lines.push({ t: parts[0].t + '   ' + parts[1].t, c: parts[1].c, font: small, size: 11 * r, parts: parts.slice(0, 2) });
      lines.push({ t: parts[2].t + '   ' + parts[3].t, c: parts[3].c, font: small, size: 11 * r, parts: parts.slice(2) });
    }
    if (v.key === 'pt') {
      const refD = models.ref.prof(state.s) * kRef;
      lines.push({ t: t('sc.exp', { d: fmt(refD), diff: signed(D - refD) }), c: 'rgba(120,201,216,0.95)', font: small, size: 11 * r });
      if (state.showPrior && priorCovers(state.s) && !compact) lines.push({ t: t('sc.prev', { d: fmt(models.prior.prof(state.s) * kPrior), date: shortDate(models.prior.date) }), c: 'rgba(169,180,184,0.95)', font: small, size: 11 * r });
      const lv = LEVELS.find(l => Math.abs(l.s - state.s) <= 2.5);
      if (lv) {
        const z = v.model.z[lv.key], [lo, hi] = zRange(lv.key);
        lines.push({ t: t('sc.z', { z: signed(z), lo: signed(lo), hi: signed(hi) }), c: z >= 2 ? '#f2aa3f' : muted, font: small, size: 11 * r });
      }
    }
    boxes.push(plate(ctx, lines, pad, H - pad, 'bl', r));
    // Orientation markers, kept clear of the plates
    if (scan.sax) {
      const mark = (dir, key) => {
        const du = dir.dot(scan.R), dv = dir.dot(scan.U), l = Math.hypot(du, dv);
        if (l < 0.3) return;
        const rad = side / 2 - 14 * r;
        marker(ctx, t(key), cx + (du / l) * rad, cy - (dv / l) * rad, cx, cy, boxes, r);
      };
      mark(V(0, 0, 1), 'or.A'); mark(V(0, 0, -1), 'or.P'); mark(V(1, 0, 0), 'or.L'); mark(V(-1, 0, 0), 'or.R');
    } else {
      marker(ctx, t('or.A'), cx, sy0 + 14 * r, cx, cy, boxes, r);
      marker(ctx, t('or.P'), cx, sy0 + side - 14 * r, cx, cy, boxes, r);
      marker(ctx, t('sc.apex'), sx0 + 34 * r, cy, cx, cy, boxes, r);
      marker(ctx, t('sc.aorta'), sx0 + side - 34 * r, cy, cx, cy, boxes, r);
    }
  }
  function drawPlaxAnnotations(v, ctx, proj, plaxWall, accent, r) {
    const m = v.model, k = v.scan.k, o = state.cyc.open;
    const ant = plaxWall(m, 1.5, k, 1), post = plaxWall(m, 1.5, k, -1), mid = proj(frameAt(6).P);
    ctx.strokeStyle = 'rgba(190,198,202,0.95)'; ctx.lineWidth = 1.6 * r; ctx.setLineDash([]); ctx.lineCap = 'round';
    for (const [hinge, sign] of [[ant, 1], [post, -1]]) {   // right coronary cusp anteriorly, non-coronary posteriorly
      const tp = plaxWall(m, 13, k * 0.9, sign);
      ctx.beginPath(); ctx.moveTo(hinge[0], hinge[1]); ctx.lineTo(mid[0] * (1 - o) + tp[0] * o, mid[1] * (1 - o) + tp[1] * o); ctx.stroke();
    }
    // Calipers in level colours; their values are listed in the text plate, which never collides with them
    LEVELS.forEach(lv => {
      const a = plaxWall(m, lv.s, k, 1), b = plaxWall(m, lv.s, k, -1);
      caliper(ctx, a[0], a[1], b[0], b[1], LEVEL_COLOURS[lv.key], r);
    });
    const a = plaxWall(m, state.s, k * 1.15, 1), b = plaxWall(m, state.s, k * 1.15, -1);
    ctx.setLineDash([4 * r, 3 * r]); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.1 * r;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
  }

  /* ===================== Charts ===================== */
  const CHART_FONT = (px, r) => `400 ${px * r}px "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif`;
  // Lays out legend items in rows that fit the width; returns rows of {label, colour, kind, x}
  function legendRows(ctx, items, x0, x1, r) {
    ctx.font = CHART_FONT(11, r);
    const rows = [[]]; let x = x0;
    for (const it of items) {
      const w = (19 + 14) * r + ctx.measureText(it.label).width;
      if (x + w > x1 && rows[rows.length - 1].length) { rows.push([]); x = x0; }
      rows[rows.length - 1].push({ ...it, x }); x += w;
    }
    return rows;
  }
  function drawLegend(ctx, rows, y0, r) {
    ctx.font = CHART_FONT(11, r); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    rows.forEach((row, ri) => {
      const y = y0 + ri * 16 * r;
      for (const it of row) {
        ctx.strokeStyle = it.colour; ctx.fillStyle = it.colour; ctx.lineWidth = 2 * r;
        if (it.kind === 'box') ctx.fillRect(it.x, y - 4 * r, 14 * r, 9 * r);
        else { ctx.setLineDash(it.kind === 'dash' ? [3 * r, 3 * r] : []); ctx.beginPath(); ctx.moveTo(it.x, y); ctx.lineTo(it.x + 14 * r, y); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle = '#b5c1c5'; ctx.fillText(it.label, it.x + 19 * r, y);
      }
    });
  }
  const profile = { canvas: null, ctx: null, map: null };
  function drawProfile(target) {
    const onScreen = !target;
    if (onScreen) { if (!profile.canvas || !fitCanvas(profile.canvas)) return; target = { cv: profile.canvas, ctx: profile.ctx, r: dpr() }; }
    const { cv, ctx, r } = target, W = cv.width, H = cv.height;
    const items = [
      { label: t('leg.normal'), colour: 'rgba(120,201,216,0.35)', kind: 'box' },
      { label: t('leg.expected'), colour: '#78c9d8', kind: 'line' },
      { label: t('leg.entered'), colour: '#f2aa3f', kind: 'line' }
    ];
    if (state.showPrior && models.prior) items.push({ label: t('leg.previous', { d: shortDate(models.prior.date) }), colour: '#a9b4b8', kind: 'dash' });
    const x0 = 46 * r, x1 = W - 12 * r;
    const rows = legendRows(ctx, items, x0, x1, r);
    const y0 = (14 + rows.length * 16) * r, y1 = H - 30 * r;
    const xs = [], pts = { lo: [], hi: [], ref: [], pt: [], prior: [] };
    for (let s = 0; s <= PROFILE_MAX + 1e-6; s += 0.5) {
      xs.push(s);
      pts.lo.push(state.band.lo(s)); pts.hi.push(state.band.hi(s));
      pts.ref.push(models.ref.prof(s)); pts.pt.push(models.pt.prof(s));
      pts.prior.push(state.showPrior && priorCovers(s) ? models.prior.prof(s) : NaN);
    }
    const all = [...pts.lo, ...pts.hi, ...pts.pt, ...pts.prior.filter(Number.isFinite)];
    const yMin = Math.floor(Math.min(...all) / 5) * 5 - 2, yMax = Math.ceil(Math.max(...all) / 5) * 5 + 2;
    const X = (s) => x0 + (s / PROFILE_MAX) * (x1 - x0), Y = (d) => y1 - ((d - yMin) / (yMax - yMin)) * (y1 - y0);
    if (onScreen) profile.map = { x0, x1 };
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.font = CHART_FONT(11, r); ctx.strokeStyle = '#141d20'; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let d = Math.ceil(yMin / 5) * 5; d <= yMax; d += 5) {
      ctx.beginPath(); ctx.moveTo(x0, Y(d)); ctx.lineTo(x1, Y(d)); ctx.stroke();
      ctx.fillStyle = '#82929a'; ctx.fillText(String(d), x0 - 6 * r, Y(d));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const lv of LEVELS) {
      ctx.strokeStyle = '#1b2529'; ctx.beginPath(); ctx.moveTo(X(lv.s), y0); ctx.lineTo(X(lv.s), y1); ctx.stroke();
      ctx.fillStyle = '#82929a'; ctx.fillText(t('lvs.' + lv.key), X(lv.s) + (lv.s === 0 ? 10 * r : 0), y1 + 6 * r);
    }
    ctx.save(); ctx.translate(12 * r, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t('ch.diam'), 0, 0); ctx.restore();
    ctx.textAlign = 'right'; ctx.fillText(t('ch.dist'), x1, y1 + 18 * r);
    ctx.beginPath();
    xs.forEach((s, i) => (i ? ctx.lineTo(X(s), Y(pts.hi[i])) : ctx.moveTo(X(s), Y(pts.hi[i]))));
    for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(X(xs[i]), Y(pts.lo[i]));
    ctx.closePath(); ctx.fillStyle = 'rgba(120,201,216,0.13)'; ctx.fill();
    const line = (arr, colour, width, dash) => {
      ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = width * r; ctx.setLineDash(dash.map(x => x * r));
      ctx.beginPath(); let on = false;
      xs.forEach((s, i) => { const y = arr[i]; if (!Number.isFinite(y)) { on = false; return; } on ? ctx.lineTo(X(s), Y(y)) : ctx.moveTo(X(s), Y(y)); on = true; });
      ctx.stroke(); ctx.restore();
    };
    line(pts.ref, '#78c9d8', 1.5, []);
    line(pts.prior, '#a9b4b8', 1.4, [3, 3]);
    line(pts.pt, '#f2aa3f', 2.2, []);
    for (const lv of LEVELS) {
      const z = models.pt.z[lv.key];
      ctx.fillStyle = z >= 3.5 ? '#ff5c4d' : z >= 2 ? '#f2aa3f' : '#d6dfe1';
      ctx.beginPath(); ctx.arc(X(lv.s), Y(models.pt.d[lv.key]), 3.2 * r, 0, Math.PI * 2); ctx.fill();
    }
    if (onScreen && state.s <= PROFILE_MAX) {
      ctx.save(); ctx.setLineDash([3 * r, 3 * r]); ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.moveTo(X(state.s), y0); ctx.lineTo(X(state.s), y1); ctx.stroke(); ctx.restore();
    }
    drawLegend(ctx, rows, 10 * r, r);
  }
  function attachProfilePointer() {
    const c = profile.canvas, tip = $('profile-tip');
    const sAt = (e) => {
      const rect = c.getBoundingClientRect(), m = profile.map;
      if (!m) return null;
      const x = (e.clientX - rect.left) * dpr();
      return { s: clamp(((x - m.x0) / (m.x1 - m.x0)) * PROFILE_MAX, 0, PROFILE_MAX), x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width };
    };
    c.addEventListener('pointermove', (e) => {
      const p = sAt(e); if (!p) return;
      const s = p.s;
      let txt = t('prof.tip', { s: fmt(s), e: fmt(models.ref.prof(s)), lo: fmt(state.band.lo(s)), hi: fmt(state.band.hi(s)), m: fmt(models.pt.prof(s)) });
      if (state.showPrior && priorCovers(s)) txt += t('prof.tipPrev', { p: fmt(models.prior.prof(s)) });
      tip.textContent = txt; tip.hidden = false;
      tip.style.left = p.x + 'px'; tip.style.top = Math.max(14, p.y) + 'px';
      tip.style.transform = p.x > p.w / 2 ? 'translate(calc(-100% - 12px), -50%)' : '';
    });
    c.addEventListener('pointerleave', () => { tip.hidden = true; });
    c.addEventListener('click', (e) => { const p = sAt(e); if (p) setS(p.s); });
  }

  const growthChart = { canvas: null, ctx: null };
  function drawGrowth() {
    const c = growthChart.canvas;
    if (!c || !fitCanvas(c)) return;
    const ctx = growthChart.ctx, r = dpr(), W = c.width, H = c.height;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const priors = validPriors();
    ctx.font = CHART_FONT(12, r); ctx.fillStyle = '#82929a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (!priors.length) { ctx.fillText(t('fu.empty'), W / 2, H / 2); return; }
    const metric = state.growthMetric;
    const studies = [...priors.map(p => ({ date: p.date, vals: p, method: p.method })), { date: state.studyDate, vals: state.measured, method: currentMethod() }];
    const series = LEVELS.map(lv => ({
      lv, pts: studies.filter(st => Number.isFinite(st.vals[lv.key])).map(st => ({
        tm: parseDate(st.date), method: st.method, y: metric === 'z' ? zOf(lv.key, st.vals[lv.key], ageAt(st.date)) : st.vals[lv.key]
      }))
    })).filter(s => s.pts.length);
    const x0 = 46 * r, x1 = W - 16 * r;
    const rows = legendRows(ctx, series.map(s => ({ label: lvName(s.lv.key), colour: LEVEL_COLOURS[s.lv.key], kind: 'box' })), x0, x1, r);
    const y0 = (16 + rows.length * 16) * r, y1 = H - 30 * r;
    const ts = studies.map(s => parseDate(s.date)), tMin = Math.min(...ts), tMax = Math.max(...ts);
    const ys = series.flatMap(s => s.pts.map(p => p.y));
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (metric === 'z') { yMin = Math.min(yMin, -2.5); yMax = Math.max(yMax, 2.5); }
    const padY = Math.max(1, (yMax - yMin) * 0.12); yMin -= padY; yMax += padY;
    const X = (tm) => x0 + (tMax === tMin ? 0.5 : (tm - tMin) / (tMax - tMin)) * (x1 - x0);
    const Y = (y) => y1 - ((y - yMin) / (yMax - yMin)) * (y1 - y0);
    ctx.font = CHART_FONT(11, r); ctx.strokeStyle = '#141d20'; ctx.lineWidth = 1; ctx.textAlign = 'right';
    const step = metric === 'z' ? 1 : (yMax - yMin > 25 ? 5 : 2);
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      ctx.beginPath(); ctx.moveTo(x0, Y(y)); ctx.lineTo(x1, Y(y)); ctx.stroke();
      ctx.fillStyle = '#82929a'; ctx.fillText(metric === 'z' ? signed(y, 0) : String(y), x0 - 6 * r, Y(y));
    }
    if (metric === 'z') {
      ctx.fillStyle = 'rgba(120,201,216,0.10)'; ctx.fillRect(x0, Y(2), x1 - x0, Y(-2) - Y(2));
      ctx.save(); ctx.setLineDash([4 * r, 3 * r]); ctx.strokeStyle = 'rgba(242,170,63,0.6)';
      ctx.beginPath(); ctx.moveTo(x0, Y(2)); ctx.lineTo(x1, Y(2)); ctx.stroke(); ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#82929a';
    let lastX = -Infinity;   // skip date labels that would collide
    [...new Set(ts)].sort((a, b) => a - b).forEach(tm => {
      const x = X(tm), label = shortDate(new Date(tm).toISOString().slice(0, 10)), w = ctx.measureText(label).width;
      if (x - w / 2 > lastX + 6 * r) { ctx.fillText(label, clamp(x, x0 + w / 2, x1 - w / 2), y1 + 6 * r); lastX = x + w / 2; }
    });
    for (const s of series) {   // lines join studies done with the same method only
      const col = LEVEL_COLOURS[s.lv.key];
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.8 * r;
      for (const method of ['echo', 'ctmr']) {
        const p = s.pts.filter(q => q.method === method);
        if (p.length < 2) continue;
        ctx.setLineDash(method === 'ctmr' ? [4 * r, 3 * r] : []);
        ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(X(q.tm), Y(q.y)) : ctx.moveTo(X(q.tm), Y(q.y)))); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const q of s.pts) {
        ctx.beginPath();
        if (q.method === 'ctmr') ctx.rect(X(q.tm) - 3.2 * r, Y(q.y) - 3.2 * r, 6.4 * r, 6.4 * r);
        else ctx.arc(X(q.tm), Y(q.y), 3.3 * r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawLegend(ctx, rows, 10 * r, r);
  }
