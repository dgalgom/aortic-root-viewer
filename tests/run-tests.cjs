// Aortic root viewer v2.0. Copyright 2026 Daniel Gallardo Gómez.
// Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Headless test suite (jsdom). Runs the built page without WebGL and checks evidence values,
// decision logic, report import, translations, patient view, scan contents, heartbeat timing and the PDF report.
// Usage: npm install && npm test
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
const app = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const page = html.replace(/<script src=[^>]+><\/script>/, '').replace(/<script>\n[\s\S]*?\n<\/script>/, '').replace(/<link[^>]+>/g, '');
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyeiiigD//2Q==';

function boot() {
  const dom = new JSDOM(page, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
  const w = dom.window;
  w.THREE = require('three');
  w.THREE.WebGLRenderer = function () { throw new Error('no WebGL in tests'); };
  const ctxStub = () => {
    const o = {}; const fn = () => {};
    ['fillRect','drawImage','beginPath','moveTo','lineTo','stroke','fillText','setLineDash','save','restore','putImageData','arc','fill','closePath','translate','rotate','strokeRect','clearRect','rect'].forEach(k => (o[k] = fn));
    o.measureText = (t) => ({ width: String(t).length * 6 });
    o.createImageData = (a, b) => ({ data: new Uint8ClampedArray(a * b * 4) });
    return o;
  };
  w.HTMLCanvasElement.prototype.getContext = function () { return this._c || (this._c = ctxStub()); };
  w.HTMLCanvasElement.prototype.toDataURL = () => TINY_JPEG;
  w.HTMLAnchorElement.prototype.click = function () {};
  w.ResizeObserver = class { observe() {} };
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 400; } });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get() { return 400; } });
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  let raf = []; w.requestAnimationFrame = (f) => raf.push(f);
  w.__AORTIC_DEBUG__ = true;
  w.jspdf = require('jspdf');
  w.URL.createObjectURL = (blob) => { w.__lastBlob = blob; return 'blob:test'; };
  w.URL.revokeObjectURL = () => {};
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.eval(app);
  const flush = (now) => { const q = raf; raf = []; const t0 = Date.now(); q.forEach((f) => f(now)); return Date.now() - t0; };
  return { w, d: w.document, A: w.__aortic, flush, errors };
}

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } };

(async () => {
  const { w, d, A, flush, errors } = boot();
  flush(0);
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a);
  const setCause = (c) => { const s = d.getElementById('cause'); s.value = c; s.dispatchEvent(new w.Event('change')); };
  const check = (id, on) => { const el = d.getElementById(id); el.checked = on; el.dispatchEvent(new w.Event('change')); };
  const setMeasured = (vals) => vals.forEach((v, i) => { const inp = d.querySelectorAll('#table-pt tbody tr')[i].querySelector('input'); inp.value = v; inp.dispatchEvent(new w.Event('input')); });
  const verdict = (g) => A.evaluateGuideline(g).verdict;

  console.log('Evidence');
  await test('Du Bois BSA, 185 cm / 80 kg = 2.04 m²', () => near(A.state.reference.bsa, 2.037, 0.005));
  await test('Devereux sinus expectation, man 30 y = 33.6 mm, SD 2.61', () => { const r = A.state.reference.levels.sov; near(r.mean, 33.65, 0.05); near(r.sd, 2.61, 0.001); });
  await test('z-score of 40 mm sinuses = +2.4', () => near(A.models.pt.z.sov, 2.43, 0.02));
  await test('Lang 2015 ascending aorta, men 30 ± 4 mm', () => { const r = A.state.reference.levels.aa; assert.equal(r.mean, 30); assert.equal(r.sd, 4); });
  await test('WASE sinuses use BSA-indexed 16.5 ± 2.2 mm/m² (18–40 y, men)', () => { const L = A.referenceFor(A.state.patient, 'wase').levels.sov; near(L.mean, 16.5 * 2.037, 0.05); });

  console.log('Decision support');
  await test('TAV 53 mm, average height: no threshold met', () => { setMeasured([26, 40, 30, 53]); assert.equal(verdict('acc'), 'v.none'); assert.equal(verdict('esc'), 'v.none'); });
  await test('TAV 53 mm + low risk: ACC reasonable, ESC should be considered', () => { check('dec-low', true); assert.equal(verdict('acc'), 'v.reason'); assert.equal(verdict('esc'), 'v.consider'); check('dec-low', false); });
  await test('BAV root phenotype 51 mm: ESC recommended', () => { setMeasured([26, 51, 30, 42]); setCause('bav'); assert.equal(verdict('esc'), 'v.rec'); });
  await test('Marfan 46 mm + high-risk: ACC reasonable, ESC should be considered', () => { setCause('marfan'); setMeasured([26, 46, 30, 35]); check('dec-hr', true); assert.equal(verdict('acc'), 'v.reason'); assert.equal(verdict('esc'), 'v.consider'); check('dec-hr', false); });
  await test('Loeys–Dietz: ACC not encoded, ESC 45 mm', () => { setCause('lds'); assert.equal(verdict('acc'), 'v.notEncoded'); assert.equal(verdict('esc'), 'v.consider'); });
  await test('pregnancy criteria hidden for men, shown for women', () => {
    setCause('marfan'); const has = () => A.evaluateGuideline('acc').rows.some((r) => r.k.startsWith('c.preg'));
    assert.equal(has(), false); d.querySelector('[data-sex="F"]').click(); assert.equal(has(), true); d.querySelector('[data-sex="M"]').click();
  });
  setCause('tav'); setMeasured([26, 40, 30, 42]);

  console.log('Follow-up');
  await test('growth compared within the same imaging method', () => {
    d.getElementById('tab-followup').click(); d.getElementById('example-studies').click(); flush(1);
    const g = A.growthFor('aa'); assert.equal(g.sinceMethod, 'echo'); near(g.d, 3.5, 0.01); assert.ok(g.meets);
  });

  console.log('Report import');
  await test('English report, cm converted', () => {
    const r = A.parseReport('TTE. Male, 52 years. Height 1.78 m, weight 84 kg. Sinuses of Valsalva 4.4 cm, sinotubular junction 36 mm, ascending aorta 4.7 cm.');
    const v = Object.fromEntries(r.map((x) => [x.field, x.value]));
    assert.equal(v.sov, 44); assert.equal(v.stj, 36); assert.equal(v.aa, 47); assert.equal(v.height, 178); assert.equal(v.sex, 'M');
  });
  await test('Spanish report, decimal comma, "raíz aórtica" flagged', () => {
    const r = A.parseReport('Varón de 61 años. Raíz aórtica 4,1 cm. Aorta ascendente 46 mm.');
    const sov = r.find((x) => x.field === 'sov'); assert.equal(sov.value, 41); assert.ok(sov.notes.includes('imp.note.root'));
  });

  console.log('Languages and patient view');
  await test('Spanish: every translatable element filled', () => {
    d.querySelector('[data-lang-btn="es"]').click(); flush(2);
    const empty = [...d.querySelectorAll('[data-i18n]')].filter((el) => !el.textContent.trim());
    assert.equal(empty.length, 0); assert.equal(d.querySelector('h1').textContent, 'Visor de raíz aórtica');
  });
  await test('English and Spanish dictionaries have the same keys', () => { const I = A.I18N; assert.deepEqual(Object.keys(I.en).sort(), Object.keys(I.es).sort()); });
  await test('patient view shows a plain-language summary', () => {
    d.querySelector('[data-mode="patient"]').click(); flush(3);
    assert.ok(d.body.classList.contains('patient')); assert.match(d.getElementById('pm-summary').textContent, /42,0 mm/);
    d.querySelector('[data-mode="clinician"]').click(); d.querySelector('[data-lang-btn="en"]').click(); flush(4);
  });

  console.log('Scans and heartbeat');
  await test('short axis at the sinuses shows the left atrium behind the root', () => { A.setS(10); const c = A.census(A.viewers[1]); assert.ok(c['cav:an.la'] > 0); assert.ok(c['an.lumen'] > 0); });
  await test('long axis shows LV, LA, RVOT and aortic root', () => {
    d.querySelector('[data-view="plax"]').click(); flush(5);
    const c = A.census(A.viewers[1]); for (const k of ['cav:an.lv', 'cav:an.la', 'cav:an.rvot', 'an.root']) assert.ok(c[k] > 0, k);
    d.querySelector('[data-view="sax"]').click(); flush(6);
  });
  await test('heartbeat runs and stops at end-diastole', () => {
    d.getElementById('play').click(); for (let i = 1; i <= 20; i++) flush(A.state.t0 + i * 16.7);
    d.getElementById('play').click(); flush(1e6); assert.equal(A.state.cyc.phase, 'ph.ed');
  });

  console.log('PDF report');
  for (const lang of ['en', 'es']) {
    await test('PDF report in ' + lang, async () => {
      d.querySelector('[data-lang-btn="' + lang + '"]').click(); flush(7);
      w.__lastBlob = null; await A.makeReport();
      assert.ok(w.__lastBlob, 'no PDF produced'); const n = (await w.__lastBlob.arrayBuffer()).byteLength; assert.ok(n > 10000, 'PDF too small: ' + n);
    });
  }
  await test('no runtime errors', () => assert.deepEqual(errors, []));
  console.log((process.exitCode ? 'FAILED' : 'All ' + passed + ' tests passed'));
})();
