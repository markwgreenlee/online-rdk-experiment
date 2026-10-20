/**
 * verify_motion.js — headless verification of the RDK motion engine.
 *
 * Loads the REAL plugin source (plugin-rdk-load.js) into a stubbed DOM and
 * drives it frame-by-frame with controlled timestamps. Because the render loop
 * draws every signal dot as ctx.arc(ox+x, oy+y, ...) in stable index order, a
 * recording 2D-context stub captures the exact per-dot trajectories produced by
 * the engine — so this checks the shipping code, not a reimplementation.
 *
 * Run: node tests/verify_motion.js
 * Exit code 0 = all checks pass, 1 = any failure.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const pluginSrc = fs.readFileSync(
  path.join(ROOT, "plugins", "plugin-rdk-load.js"),
  "utf8"
);

// ---------------------------------------------------------------- test config
const CSS_W = 1000, CSS_H = 800;
const PPD = 40;
const R_IN = 2.0, R_OUT = 7.0; // deg
const SPEED_DPS = 6.0;
const DUR = 1000; // ms
const FRAME_MS = 16.6667; // ~60 Hz

// area-weighted <r^2> over the annulus, in px^2 (matches the engine formula)
const meanR2 = ((R_OUT * PPD) ** 2 + (R_IN * PPD) ** 2) / 2;

let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log("  PASS  " + name); }
  else { FAIL++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
}

// ------------------------------------------------- run one trial, record dots
// Returns { frames: [[{x,y}, ...], ...] } — dot positions (centred px) per frame.
function runTrial(trial) {
  const frames = [];
  let curFrame = null;

  // recording 2D context: capture arc() centres (dots) per frame; ignore the
  // fixation cross (drawn with moveTo/lineTo/stroke) and letters (fillText).
  const ctx = {
    setTransform() {}, fillRect() {}, beginPath() { }, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, fillText() {},
    arc(x, y, r) { if (curFrame) curFrame.push({ x: x - CSS_W / 2, y: y - CSS_H / 2 }); },
    set fillStyle(v) {}, get fillStyle() { return ""; },
    set strokeStyle(v) {}, get strokeStyle() { return ""; },
    set lineWidth(v) {}, get lineWidth() { return 0; },
    set font(v) {}, get font() { return ""; },
    set textAlign(v) {}, get textAlign() { return ""; },
    set textBaseline(v) {}, get textBaseline() { return ""; },
  };
  const canvas = {
    id: "", style: {}, width: 0, height: 0,
    getContext() { return ctx; },
    parentNode: null,
  };

  // controlled requestAnimationFrame pump
  let rafQueue = [];
  const raf = (cb) => { rafQueue.push(cb); return rafQueue.length; };

  const documentStub = {
    createElement() { return canvas; },
    body: { appendChild(el) { el.parentNode = documentStub.body; },
            removeChild() {} },
    addEventListener() {},
    fullscreenElement: null,
  };
  const windowStub = {
    innerWidth: CSS_W, innerHeight: CSS_H, devicePixelRatio: 1,
    addEventListener() {}, requestAnimationFrame: raf,
    cancelAnimationFrame() {},
  };

  // jsPsych stubs
  const ParameterType = new Proxy({}, { get: () => "stub" });
  const jsPsychModule = { ParameterType };
  const jsPsych = {
    pluginAPI: {
      getKeyboardResponse() {}, // never auto-responds; we stop at endMotion
    },
    finishTrial() {},
  };

  const sandbox = {
    window: windowStub, document: documentStub,
    requestAnimationFrame: raf, cancelAnimationFrame() {},
    jsPsychModule, console, Math, Date, performance: { now: () => 0 },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pluginSrc + "\nthis.__PLUGIN__ = jsPsychRdkLoad;", sandbox);

  const Plugin = sandbox.__PLUGIN__;
  const inst = new Plugin(jsPsych);
  const display = { innerHTML: "" };

  inst.trial(display, trial);

  // pump frames with controlled timestamps until the motion phase ends
  let ts = 0;
  for (let i = 0; i < 200 && rafQueue.length; i++) {
    const cb = rafQueue.shift();
    curFrame = [];
    cb(ts);
    if (curFrame.length) frames.push(curFrame);
    ts += FRAME_MS;
    if (ts > DUR + FRAME_MS * 3) break;
  }
  return { frames };
}

function toPolar(p) { return { r: Math.hypot(p.x, p.y), th: Math.atan2(p.y, p.x) }; }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

const baseTrial = {
  px_per_degree: PPD, aperture_inner_deg: R_IN, aperture_outer_deg: R_OUT,
  dot_radius_deg: 0.1, dot_density: 2.0, dot_speed_dps: SPEED_DPS,
  dot_color: "#fff", background_color: "#000", fixation_color: "#f00",
  coherence: 1.0, // ALL dots are signal -> deterministic per-dot motion
  motion_duration_ms: DUR,
  rsvp_stream: [], rsvp_target: "X", rsvp_item_ms: 100, rsvp_letter_deg: 0.8,
  rsvp_color: "#7fd4ff", load_condition: "low", rsvp_max_targets: 2,
  motion_choices: ["ArrowLeft", "ArrowRight"], feedback: false,
  debug: false,
};

// =============================================================== TRANSLATION
console.log("\n[translation]");
{
  const { frames } = runTrial({ ...baseTrial, motion_type: "translation", direction: "right" });
  check("produced frames", frames.length > 5, "n=" + frames.length);
  const f0 = frames[0], f1 = frames[1];
  const dxs = f0.map((p, i) => f1[i].x - p.x);
  const dys = f0.map((p, i) => f1[i].y - p.y);
  const stepPx = (SPEED_DPS * PPD / 1000) * FRAME_MS;
  const moved = dxs.filter((dx) => Math.abs(dx - stepPx) < 1e-6).length;
  check("rightward dx = +stepPx for signal dots",
    moved / dxs.length > 0.85, moved + "/" + dxs.length + " match " + stepPx.toFixed(3));
  // Non-respawned signal dots (dx == +stepPx) must have exactly zero dy.
  // Respawned dots (exited the aperture, jumped to a random point) are excluded
  // by the dx test — they are the only source of nonzero dy.
  const dyOfMovers = f0.map((p, i) => ({ dx: f1[i].x - p.x, dy: f1[i].y - p.y }))
    .filter((d) => Math.abs(d.dx - stepPx) < 1e-6)
    .map((d) => d.dy);
  check("no vertical motion for non-respawned dots",
    dyOfMovers.every((dy) => Math.abs(dy) < 1e-9), "n=" + dyOfMovers.length);

  const left = runTrial({ ...baseTrial, motion_type: "translation", direction: "left" });
  const lx = left.frames[0].map((p, i) => left.frames[1][i].x - p.x);
  check("leftward dx negative", mean(lx.filter((d) => Math.abs(d) < 2 * stepPx)) < 0);
}

// ================================================================= ROTATION
console.log("\n[rotation]");
function rotationRMS(dir) {
  const { frames } = runTrial({ ...baseTrial, motion_type: "rotation", direction: dir });
  const f0 = frames[0], f1 = frames[1];
  const speeds = [];
  let radiusPreserved = true, angAdvance = [];
  for (let i = 0; i < f0.length; i++) {
    const a = toPolar(f0[i]), b = toPolar(f1[i]);
    if (Math.abs(a.r - b.r) > 1e-6 * a.r + 1e-6) radiusPreserved = false;
    angAdvance.push(angDiff(b.th, a.th));
    speeds.push(Math.hypot(f1[i].x - f0[i].x, f1[i].y - f0[i].y) / FRAME_MS);
  }
  return { frames, radiusPreserved, dtheta: mean(angAdvance), rms: Math.sqrt(mean(speeds.map((s) => s * s))) };
}
{
  const cw = rotationRMS("cw");
  check("radius preserved (rigid rotation)", cw.radiusPreserved);
  check("cw advances angle positively (visually clockwise)", cw.dtheta > 0, "dtheta=" + cw.dtheta.toFixed(4));
  const ccw = rotationRMS("ccw");
  check("ccw advances angle negatively", ccw.dtheta < 0, "dtheta=" + ccw.dtheta.toFixed(4));
  check("cw and ccw are mirror images", Math.abs(cw.dtheta + ccw.dtheta) < 1e-6);
  const omega = (SPEED_DPS * PPD / 1000) / Math.sqrt(meanR2); // rad/ms
  check("angular rate matches RMS-derived omega",
    Math.abs(cw.dtheta - omega * FRAME_MS) < 1e-6, "got " + cw.dtheta.toFixed(5) + " exp " + (omega * FRAME_MS).toFixed(5));
}

// =================================================================== SPIRAL
console.log("\n[spiral]");
function spiralMeasure(dir, radial) {
  const { frames } = runTrial({ ...baseTrial, motion_type: "spiral", direction: dir, radial_direction: radial });
  const f0 = frames[0], f1 = frames[1];
  const growth = [], dtheta = [], radialComp = [], tangComp = [];
  for (let i = 0; i < f0.length; i++) {
    const a = toPolar(f0[i]), b = toPolar(f1[i]);
    const dth = angDiff(b.th, a.th);
    // A respawned dot lands at a RANDOM angle, so exclude any dot whose angular
    // step is far larger than the per-frame spiral rotation (a real signal step
    // is a small fraction of a radian). The radius filter alone is insufficient
    // because a respawn can land at a similar radius but arbitrary angle.
    if (Math.abs(b.r / a.r - 1) > 0.2 || Math.abs(dth) > 0.1) continue;
    growth.push(b.r / a.r);
    dtheta.push(dth);
    radialComp.push(Math.abs(b.r - a.r));
    tangComp.push(a.r * Math.abs(dth));
  }
  return { growth: mean(growth), dtheta: mean(dtheta), radial: mean(radialComp), tang: mean(tangComp) };
}
{
  const expCW = spiralMeasure("cw", "expand");
  check("expand grows radius (>1)", expCW.growth > 1, "growth=" + expCW.growth.toFixed(5));
  const conCW = spiralMeasure("cw", "contract");
  check("contract shrinks radius (<1)", conCW.growth < 1, "growth=" + conCW.growth.toFixed(5));
  check("cw spiral advances angle positively", expCW.dtheta > 0, "dtheta=" + expCW.dtheta.toFixed(5));
  const expCCW = spiralMeasure("ccw", "expand");
  check("ccw spiral advances angle negatively", expCCW.dtheta < 0);
  check("balanced screw: |dr| == r*|dtheta| (45 deg)",
    Math.abs(expCW.radial - expCW.tang) / expCW.tang < 0.02,
    "radial=" + expCW.radial.toFixed(4) + " tang=" + expCW.tang.toFixed(4));
}

// =================================================================== RADIAL
console.log("\n[radial]");
function radialMeasure(dir) {
  const { frames } = runTrial({ ...baseTrial, motion_type: "radial", direction: dir });
  const f0 = frames[0], f1 = frames[1];
  const dr = [], dth = [];
  for (let i = 0; i < f0.length; i++) {
    const a = toPolar(f0[i]), b = toPolar(f1[i]);
    const dthi = angDiff(b.th, a.th);
    // exclude respawned dots (random relocation -> large radius or angle jump)
    if (Math.abs(b.r - a.r) > 3 * (SPEED_DPS * PPD / 1000) * FRAME_MS) continue;
    if (Math.abs(dthi) > 1e-6) continue;
    dr.push(b.r - a.r);
    dth.push(dthi);
  }
  return { dr: mean(dr), dth: mean(dth), n: dr.length };
}
{
  const step = (SPEED_DPS * PPD / 1000) * FRAME_MS; // px per frame
  const ex = radialMeasure("expand");
  check("expand increases radius", ex.dr > 0, "dr=" + ex.dr.toFixed(5));
  const co = radialMeasure("contract");
  check("contract decreases radius", co.dr < 0, "dr=" + co.dr.toFixed(5));
  check("radial has NO angular component", Math.abs(ex.dth) < 1e-9 && Math.abs(co.dth) < 1e-9,
    "dth=" + ex.dth.toExponential(2));
  check("radial step == uniform reference speed (expand)",
    Math.abs(ex.dr - step) / step < 0.01, "dr=" + ex.dr.toFixed(5) + " exp " + step.toFixed(5));
  check("radial step == uniform reference speed (contract)",
    Math.abs(-co.dr - step) / step < 0.01, "dr=" + co.dr.toFixed(5) + " exp " + (-step).toFixed(5));
  check("expand and contract are mirror images", Math.abs(ex.dr + co.dr) < 1e-6);
}

// ==================================================== RMS SPEED MATCHING
console.log("\n[motion-energy matching]");
function rmsSpeed(trial) {
  const { frames } = runTrial(trial);
  const f0 = frames[0], f1 = frames[1];
  const sp = [];
  for (let i = 0; i < f0.length; i++) {
    const d = Math.hypot(f1[i].x - f0[i].x, f1[i].y - f0[i].y);
    if (d < 3 * (SPEED_DPS * PPD / 1000) * FRAME_MS) sp.push(d / FRAME_MS);
  }
  return Math.sqrt(mean(sp.map((s) => s * s))); // px/ms
}
{
  const tr = rmsSpeed({ ...baseTrial, motion_type: "translation", direction: "right" });
  const ro = rmsSpeed({ ...baseTrial, motion_type: "rotation", direction: "cw" });
  const sp = rmsSpeed({ ...baseTrial, motion_type: "spiral", direction: "cw", radial_direction: "expand" });
  const rdE = rmsSpeed({ ...baseTrial, motion_type: "radial", direction: "expand" });
  const rdC = rmsSpeed({ ...baseTrial, motion_type: "radial", direction: "contract" });
  console.log("  RMS speed px/ms  translation=" + tr.toFixed(4) + " rotation=" + ro.toFixed(4) +
    " spiral=" + sp.toFixed(4) + " radial(exp)=" + rdE.toFixed(4) + " radial(con)=" + rdC.toFixed(4));
  const target = SPEED_DPS * PPD / 1000;
  check("translation RMS == reference speed", Math.abs(tr - target) / target < 0.02);
  check("rotation RMS matches translation", Math.abs(ro - tr) / tr < 0.05, "ratio=" + (ro / tr).toFixed(4));
  check("spiral RMS matches translation", Math.abs(sp - tr) / tr < 0.05, "ratio=" + (sp / tr).toFixed(4));
  check("radial expand RMS matches translation", Math.abs(rdE - tr) / tr < 0.05, "ratio=" + (rdE / tr).toFixed(4));
  check("radial contract RMS matches translation", Math.abs(rdC - tr) / tr < 0.05, "ratio=" + (rdC / tr).toFixed(4));
  // The two radial signs must match EACH OTHER tightly: an energy difference
  // between them would masquerade as the expansion/contraction effect.
  check("radial expand == radial contract (both signs equated)",
    Math.abs(rdE - rdC) / rdC < 0.02, "ratio=" + (rdE / rdC).toFixed(4));
}

// ============================================== RESPONSE MAPPING + SCORING
// Drive the REAL 2AFC decode: capture the keyboard callback the plugin
// registers after the motion phase, inject a synthetic arrow key, and read the
// recorded motion_response / motion_correct from finishTrial's data.
console.log("\n[response mapping + scoring]");
function runResponse(trial, keyPressed) {
  let captured = null;      // the callback registered for the motion 2AFC
  let finished = null;      // data passed to finishTrial
  const ctx = new Proxy({}, { get: (t, k) => (k === "arc" ? () => {} : () => {}) });
  const canvas = { style: {}, getContext: () => ctx };
  let q = [];
  const raf = (cb) => { q.push(cb); return q.length; };
  const doc = { createElement: () => canvas, body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {}, fullscreenElement: null };
  const win = { innerWidth: CSS_W, innerHeight: CSS_H, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: raf, cancelAnimationFrame() {} };
  const jsPsychModule = { ParameterType: new Proxy({}, { get: () => "s" }) };
  let loadCb = null;
  const jsPsych = {
    pluginAPI: {
      getKeyboardResponse(opts) {
        // first registration = motion 2AFC, second = secondary load response
        if (!captured) captured = opts.callback_function;
        else if (!loadCb) loadCb = opts.callback_function;
      },
      cancelAllKeyboardResponses() {},
    },
    finishTrial(d) { finished = d; },
  };
  const sb = { window: win, document: doc, requestAnimationFrame: raf, cancelAnimationFrame() {}, jsPsychModule, console, Math, Date, performance: { now: () => 0 } };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(pluginSrc + "\nthis.__PLUGIN__ = jsPsychRdkLoad;", sb);
  const inst = new sb.__PLUGIN__(jsPsych);
  inst.trial({ innerHTML: "" }, trial);
  // pump the motion phase to completion so the 2AFC prompt + callback register
  let ts = 0;
  for (let i = 0; i < 200 && q.length; i++) { const cb = q.shift(); cb(ts); ts += FRAME_MS; if (captured) break; if (ts > DUR + FRAME_MS * 5) break; }
  if (!captured) return { ok: false };
  captured({ key: keyPressed, rt: 400 });
  // motion_response/correct are recorded synchronously in afterMotion, before
  // the load phase. Fire the load key too so finishTrial completes cleanly.
  if (loadCb) loadCb({ key: trial.load_condition === "low" ? "n" : "0", rt: 300 });
  return { ok: true, resp: finished && finished.motion_response, correct: finished && finished.motion_correct };
}
{
  // rotation: LEFT arrow = ccw, RIGHT arrow = cw
  const rL = runResponse({ ...baseTrial, motion_type: "rotation", direction: "ccw" }, "ArrowLeft");
  check("rotation LEFT -> ccw", rL.ok && rL.resp === "ccw", "resp=" + (rL.resp));
  check("rotation LEFT correct when signal=ccw", rL.correct === true);
  const rR = runResponse({ ...baseTrial, motion_type: "rotation", direction: "cw" }, "ArrowRight");
  check("rotation RIGHT -> cw", rR.ok && rR.resp === "cw", "resp=" + (rR.resp));
  check("rotation RIGHT correct when signal=cw", rR.correct === true);
  const rWrong = runResponse({ ...baseTrial, motion_type: "rotation", direction: "cw" }, "ArrowLeft");
  check("rotation LEFT incorrect when signal=cw", rWrong.correct === false);
  // spiral shares the rotational mapping
  const sL = runResponse({ ...baseTrial, motion_type: "spiral", direction: "ccw", radial_direction: "expand" }, "ArrowLeft");
  check("spiral LEFT -> ccw", sL.ok && sL.resp === "ccw", "resp=" + (sL.resp));
  // radial: LEFT arrow = contract, RIGHT arrow = expand
  const dL = runResponse({ ...baseTrial, motion_type: "radial", direction: "contract" }, "ArrowLeft");
  check("radial LEFT -> contract", dL.ok && dL.resp === "contract", "resp=" + (dL.resp));
  check("radial LEFT correct when signal=contract", dL.correct === true);
  const dR = runResponse({ ...baseTrial, motion_type: "radial", direction: "expand" }, "ArrowRight");
  check("radial RIGHT -> expand", dR.ok && dR.resp === "expand", "resp=" + (dR.resp));
  check("radial RIGHT correct when signal=expand", dR.correct === true);
  const dWrong = runResponse({ ...baseTrial, motion_type: "radial", direction: "expand" }, "ArrowLeft");
  check("radial LEFT incorrect when signal=expand", dWrong.correct === false);
  // translation keeps LEFT=left, RIGHT=right
  const tL = runResponse({ ...baseTrial, motion_type: "translation", direction: "left" }, "ArrowLeft");
  check("translation LEFT -> left", tL.ok && tL.resp === "left", "resp=" + (tL.resp));
  check("translation LEFT correct when signal=left", tL.correct === true);
  const tR = runResponse({ ...baseTrial, motion_type: "translation", direction: "right" }, "ArrowRight");
  check("translation RIGHT -> right", tR.ok && tR.resp === "right", "resp=" + (tR.resp));
}

// ======================================== INSTRUCTION / KEY-ORDER CONSISTENCY
// The plugin's own key decode is verified above, but nothing checked that the
// INSTRUCTIONS name the alternatives in the same order as the keys. They did
// not for radial -- the instructions read "outward or inward" while the keys
// read "left = contracting, right = expanding" -- which inverted the implied
// mapping for the participant and wasted a full session (ANON-ND2BQ7H8QQ:
// 0/32 correct at 64% coherence, a floor only reachable by answering backwards).
// This asserts, per motion type, that the FIRST-named alternative in the
// instruction text is the one bound to the LEFT arrow.
console.log("\n[instruction / key-order consistency]");
{
  const fs = require("fs");
  const sections = fs.readFileSync(__dirname + "/../sections.js", "utf8");
  const plugin = fs.readFileSync(__dirname + "/../plugins/plugin-rdk-load.js", "utf8");

  // Per motion type: the word the instructions use for the LEFT-arrow
  // alternative and for the RIGHT-arrow alternative. The left one must appear
  // FIRST in the instruction text. Note "clockwise" is a substring of
  // "counter-clockwise", so the right-word search excludes that prefix.
  const pair = {
    radial:      { left: /inward/,            right: /outward/ },
    rotation:    { left: /counter-clockwise/, right: /(?<!counter-)clockwise/ },
    translation: { left: /\bleft\b/,          right: /\bright\b/ },
  };

  const altsBlock = sections.match(/alts:\s*pick\(([\s\S]*?)\n\s*\),/);
  check("sections.js exposes V.alts via pick()", !!altsBlock);
  const strings = (altsBlock ? altsBlock[1] : "").match(/"([^"]*)"/g) || [];
  const order = ["radial", "rotation", "translation"];
  check("V.alts has one branch per motion family", strings.length === 3,
    "got " + strings.length);
  strings.forEach((raw, i) => {
    const mt = order[i];
    if (!mt || !pair[mt]) return;
    const plain = raw.replace(/<[^>]+>/g, "").replace(/"/g, "").toLowerCase();
    const mL = plain.match(pair[mt].left), mR = plain.match(pair[mt].right);
    const ok = mL && mR && mL.index < mR.index;
    check(`${mt}: instructions name the LEFT-arrow alternative first`, !!ok,
      `left@${mL ? mL.index : "none"} right@${mR ? mR.index : "none"} :: "${plain.trim()}"`);
  });

  // the radial glyph pair must not inherit the 0.5em letter-spacing that
  // pulled the arrows apart and made the two pairs indistinguishable
  check("radial response glyphs reset letter-spacing",
    /radialGlyph\s*=\s*\(arrows, word\)/.test(plugin) &&
    /letter-spacing:normal/.test(plugin));
  check("radial response glyphs are word-labelled (mapping not glyph-only)",
    /radialGlyph\("&rarr;&larr;", "inward"\)/.test(plugin) &&
    /radialGlyph\("&larr;&rarr;", "outward"\)/.test(plugin));
}

// ============================================= CALIBRATION -> RENDERED APERTURE
// The virtual chinrest with resize_units:"deg" scales #jspsych-content and then
// REPORTS the post-scale px2deg, which equals pixels_per_unit (40) in every run
// by construction. The RDK canvas lives outside that wrapper, so handing it the
// reported value drew the stimulus 1/scale_factor too large -- across the first
// 11 runs the nominal 7 deg aperture was really 7.2-8.8 deg. These checks pin
// (a) that sections.js recovers the TRUE px/deg, and (b) that the plugin then
// renders an aperture of exactly the calibrated angular size.
console.log("\n[calibration -> rendered aperture]");
{
  // ---- (a) run the REAL on_finish derivation in sections.js ----
  const sandbox = { console, Math, Date, JSON, parseInt, parseFloat, isFinite,
                    isNaN, Number, String, Array, Object, setTimeout };
  sandbox.window = sandbox;
  sandbox.document = { body: {}, getElementById: () => ({ style: {} }),
                       createElement: () => ({ style: {}, appendChild() {} }) };
  sandbox.window.location = { search: "", href: "" };
  sandbox.NaN = NaN;
  let captured = null;
  sandbox.window.ExpBuild = { setPxPerDegree: (v) => { captured = v; } };
  sandbox.window.__JSPSYCH__ = {
    data: { addProperties: (o) => { sandbox.__props = Object.assign(sandbox.__props || {}, o); },
            getURLVariable: () => undefined },
  };
  for (const g of ["jsPsychBrowserCheck","jsPsychFullscreen","jsPsychHtmlButtonResponse",
                   "jsPsychHtmlKeyboardResponse","jsPsychInstructions","jsPsychPipe",
                   "jsPsychPreload","jsPsychSurveyHtmlForm","jsPsychVirtualChinrest"])
    sandbox[g] = { name: g };
  vm.createContext(sandbox);
  for (const f of ["config.js", "helpers.js"])
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "sections.js"), "utf8"), sandbox,
                  { filename: "sections.js" });
  const S = sandbox.window.SECTIONS;
  const cal = S && S.chinrest;
  check("sections.js exposes the virtual-chinrest node", !!(cal && cal.on_finish));
  check("calibration is a seat -> measure -> verify loop around it",
    !!(S.calibration && Array.isArray(S.calibration.timeline) &&
       S.calibration.timeline.indexOf(cal) >= 0 &&
       typeof S.calibration.loop_function === "function"),
    "timeline len " + (S.calibration && S.calibration.timeline || []).length);

  // a real observed case: run ANON-3D22LCQJK5 reported px2deg 40, scale_factor
  // 0.8517, measured 563.4 mm -- on target (|563.4 - 574| = 10.6 <= 50)
  const SF = 0.8517, REPORTED = 40, TARGET = 574;
  cal.on_finish({ px2deg: REPORTED, scale_factor: SF, view_dist_mm: 563.4,
                  px2mm: 4.06, win_width_deg: 48, item_width_mm: 85.6 });
  const expected = REPORTED * SF;                     // 34.068 px/deg, the TRUE value
  check("on_finish recovers px2deg_true = reported x scale_factor",
    Math.abs(captured - expected) < 1e-9,
    "got " + captured + " expected " + expected);
  check("on_finish does NOT pass the reported (post-scale) value through",
    Math.abs(captured - REPORTED) > 1e-6, "got " + captured);
  check("both the true and reported px/deg are logged",
    sandbox.__props.px_per_degree === expected &&
    sandbox.__props.px_per_degree_reported === REPORTED &&
    sandbox.__props.chinrest_scale_factor === SF);

  // ---- the 57.4 cm distance gate ----
  const P = sandbox.__props;
  check("target distance is logged and 1 deg = 1 cm there",
    P.view_dist_target_mm === TARGET &&
    Math.abs(2 * TARGET * Math.tan(Math.PI / 360) - 10) / 10 < 0.002,
    "target=" + P.view_dist_target_mm);
  check("on-target measurement passes the gate and does not loop",
    P.view_dist_within_tolerance === true &&
    Math.abs(P.view_dist_error_mm - (563.4 - TARGET)) < 1e-9 &&
    S.calibration.loop_function() === false,
    "err=" + P.view_dist_error_mm + " within=" + P.view_dist_within_tolerance);
  // card-only cross-check: the two estimates must differ by exactly the
  // distance error, i.e. ratio == TARGET / view_dist_mm
  check("card-only px/deg cross-check scales as TARGET / measured distance",
    Math.abs(P.px_per_degree_at_target / P.px_per_degree - TARGET / 563.4) < 2e-3,
    "ratio " + (P.px_per_degree_at_target / P.px_per_degree).toFixed(4) +
    " vs " + (TARGET / 563.4).toFixed(4));

  // off-target: run ANON-Z1AQ28UQXR measured 429.67 mm, 144 mm too close
  cal.on_finish({ px2deg: REPORTED, scale_factor: 0.9141, view_dist_mm: 429.67,
                  px2mm: 5.32, item_width_mm: 85.6 });
  check("off-target measurement fails the gate and loops",
    sandbox.__props.view_dist_within_tolerance === false &&
    S.calibration.loop_function() === true,
    "within=" + sandbox.__props.view_dist_within_tolerance);
  check("retry screen tells the participant which way to move, by how much",
    (function () {
      const rt = S.calibration.timeline[S.calibration.timeline.length - 1];
      if (!rt || !rt.conditional_function || !rt.conditional_function()) return false;
      const html = rt.timeline[0].stimulus();
      return /back about 14 cm/.test(html) && /43 cm/.test(html);
    })(), "retry copy");

  // the retry budget is finite: the run proceeds (still flagged) once spent
  cal.on_finish({ px2deg: REPORTED, scale_factor: 0.9141, view_dist_mm: 429.67,
                  px2mm: 5.32, item_width_mm: 85.6 });
  check("retry budget is finite -- run proceeds after it is spent, still flagged",
    S.calibration.loop_function() === false &&
    sandbox.__props.view_dist_within_tolerance === false &&
    sandbox.__props.calibration_attempts === 3,
    "attempts=" + sandbox.__props.calibration_attempts +
    " loop=" + S.calibration.loop_function());

  // unscaled case (resize_units:"none"): px2deg is already true, leave it alone
  captured = null;
  cal.on_finish({ px2deg: 33.3, view_dist_mm: 600 });
  check("no scale_factor -> px2deg used unchanged", Math.abs(captured - 33.3) < 1e-9,
    "got " + captured);

  // ---- (b) the plugin then renders exactly that angular size ----
  const ppdTrue = expected;
  const { frames } = runTrial({ ...baseTrial, px_per_degree: ppdTrue,
                                motion_type: "radial", direction: "expand" });
  let rMax = 0, rMin = Infinity;
  for (const fr of frames) for (const d of fr) {
    const rr = Math.hypot(d.x, d.y);
    if (rr > rMax) rMax = rr;
    if (rr < rMin) rMin = rr;
  }
  const outerDeg = rMax / ppdTrue, innerDeg = rMin / ppdTrue;
  console.log("  rendered aperture: " + innerDeg.toFixed(3) + "-" + outerDeg.toFixed(3) +
              " deg at " + ppdTrue.toFixed(2) + " px/deg (nominal " + R_IN + "-" + R_OUT + ")");
  check("rendered OUTER edge matches the calibrated angular size",
    outerDeg <= R_OUT + 1e-6 && outerDeg > R_OUT * 0.98,
    "outer=" + outerDeg.toFixed(4) + " deg");
  check("rendered INNER edge matches the calibrated angular size",
    innerDeg >= R_IN - 1e-6 && innerDeg < R_IN * 1.02,
    "inner=" + innerDeg.toFixed(4) + " deg");
  // the regression itself: had we used the reported 40, the SAME pixel geometry
  // would subtend 7/scale_factor deg on this display
  const wouldHaveBeen = (R_OUT * REPORTED) / ppdTrue;
  check("using the reported px/deg would have over-sized the aperture",
    wouldHaveBeen > R_OUT * 1.1,
    "would have subtended " + wouldHaveBeen.toFixed(2) + " deg instead of " + R_OUT);
}

console.log("\n=========================================");
console.log("  " + PASS + " passed, " + FAIL + " failed");
console.log("=========================================");
process.exit(FAIL ? 1 : 0);
