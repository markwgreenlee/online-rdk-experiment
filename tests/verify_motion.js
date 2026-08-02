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
  console.log("  RMS speed px/ms  translation=" + tr.toFixed(4) + " rotation=" + ro.toFixed(4) + " spiral=" + sp.toFixed(4));
  const target = SPEED_DPS * PPD / 1000;
  check("translation RMS == reference speed", Math.abs(tr - target) / target < 0.02);
  check("rotation RMS matches translation", Math.abs(ro - tr) / tr < 0.05, "ratio=" + (ro / tr).toFixed(4));
  check("spiral RMS matches translation", Math.abs(sp - tr) / tr < 0.05, "ratio=" + (sp / tr).toFixed(4));
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
  // translation keeps LEFT=left, RIGHT=right
  const tL = runResponse({ ...baseTrial, motion_type: "translation", direction: "left" }, "ArrowLeft");
  check("translation LEFT -> left", tL.ok && tL.resp === "left", "resp=" + (tL.resp));
  check("translation LEFT correct when signal=left", tL.correct === true);
  const tR = runResponse({ ...baseTrial, motion_type: "translation", direction: "right" }, "ArrowRight");
  check("translation RIGHT -> right", tR.ok && tR.resp === "right", "resp=" + (tR.resp));
}

console.log("\n=========================================");
console.log("  " + PASS + " passed, " + FAIL + " failed");
console.log("=========================================");
process.exit(FAIL ? 1 : 0);
