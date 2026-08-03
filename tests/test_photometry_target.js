const fs = require('fs');
const vm = require('vm');

// --- extract the <script> body from the HTML ---
const path = require('path');
const HTML = path.resolve(__dirname, '..', 'analysis', 'photometry_target.html');
const html = fs.readFileSync(HTML, 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];

// --- minimal DOM stub (mirrors tests/verify_motion.js style) ---
function makeClassList() {
  const s = new Set();
  return {
    _s: s,
    add: c => s.add(c),
    remove: c => s.delete(c),
    contains: c => s.has(c),
    toggle: (c, force) => { const on = force === undefined ? !s.has(c) : force;
                            on ? s.add(c) : s.delete(c); return on; },
  };
}
function makeEl() {
  return { style: {}, classList: makeClassList(), innerHTML: '' };
}
const els = { patch: makeEl(), hud: makeEl() };
let keyHandler = null;
const body = makeEl();
const doc = {
  getElementById: id => els[id],
  addEventListener: (t, fn) => { if (t === 'keydown') keyHandler = fn; },
  body,
  documentElement: { requestFullscreen() {} },
  fullscreenElement: null,
  exitFullscreen() {},
};
const win = {
  devicePixelRatio: 1,
  addEventListener() {},
};
const ctx = { document: doc, window: win, Math, console };
vm.createContext(ctx);
vm.runInContext(js, ctx);

function press(key, shift=false) {
  keyHandler({ key, shiftKey: shift, preventDefault() {} });
}
function pxWidth() { return parseFloat(els.patch.style.width); }

let fails = 0;
function check(name, cond, got) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got=' + got));
  if (!cond) fails++;
}

// --- geometry: 20 mm * 3.95 px/mm / dpr(1) = 79 px ---
check('default square = 79.0 device-px (20mm @ 3.95)', Math.abs(pxWidth() - 79.0) < 1e-6, pxWidth());

// --- default mode: white patch on black ---
check('default: body NOT inverted', !body.classList.contains('invert'), body.classList._s);
check('default: patch visible', !els.patch.classList.contains('hidden'), els.patch.classList._s);

// --- mode 2: full black field (patch hidden, not inverted) ---
press('2');
check('mode2: patch hidden', els.patch.classList.contains('hidden'), els.patch.classList._s);
check('mode2: body NOT inverted', !body.classList.contains('invert'), body.classList._s);

// --- mode 3: black patch on white (inverted, patch visible) ---
press('3');
check('mode3: body inverted', body.classList.contains('invert'), body.classList._s);
check('mode3: patch visible', !els.patch.classList.contains('hidden'), els.patch.classList._s);

// --- mode 4: full white field (inverted, patch hidden) ---
press('4');
check('mode4: body inverted', body.classList.contains('invert'), body.classList._s);
check('mode4: patch hidden', els.patch.classList.contains('hidden'), els.patch.classList._s);

// --- mode 1: back to white patch on black ---
press('1');
check('mode1: body NOT inverted', !body.classList.contains('invert'), body.classList._s);
check('mode1: patch visible', !els.patch.classList.contains('hidden'), els.patch.classList._s);

// --- calibration nudges ---
const w0 = pxWidth();
press('ArrowUp');                          // +0.05 px/mm -> larger
check('ArrowUp enlarges square', pxWidth() > w0, pxWidth()+' vs '+w0);
press('ArrowUp', true);                    // fine +0.01
press('r'.toUpperCase() === 'R' ? 'R' : 'r'); // reset
check('R resets to 79.0 px', Math.abs(pxWidth() - 79.0) < 1e-6, pxWidth());

// --- target size arrows: 20 -> 21 mm = 82.95 px ---
press('ArrowRight');
check('ArrowRight -> 21mm = 82.95px', Math.abs(pxWidth() - 82.95) < 1e-6, pxWidth());

console.log('\n' + (fails ? fails + ' FAILED' : 'ALL PASS'));
process.exit(fails ? 1 : 0);
