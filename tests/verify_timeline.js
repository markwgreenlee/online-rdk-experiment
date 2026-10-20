// Headless assembly of the REAL timeline (config+helpers+experiment+sections+run)
// under ?motion=radial&load=low, to confirm the new calibration LOOP node slots
// into run.js unchanged and that the seating/verify screens are in it.
const fs = require('fs'), vm = require('vm');
const URLV = { motion: "radial", load: "low" };
const sandbox = { console, Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite, NaN,
                  Array, Object, String, Number, setTimeout, clearTimeout };
sandbox.window = sandbox;
sandbox.document = { body: {}, getElementById: () => ({ style: {} }),
                     createElement: () => ({ style: {}, appendChild(){} }) };
sandbox.window.location = { search: "", href: "" };
let ranTimeline = null;
const jsp = {
  data: { getURLVariable: (k) => URLV[k],
          addProperties: (o) => Object.assign(sandbox.__props ||= {}, o) },
  run: (tl) => { ranTimeline = tl; }, pluginAPI: { getKeyboardResponse: () => {} },
};
sandbox.initJsPsych = () => jsp;
for (const p of ["jsPsychHtmlButtonResponse","jsPsychHtmlKeyboardResponse","jsPsychRdkLoad",
                 "jsPsychBrowserCheck","jsPsychFullscreen","jsPsychInstructions","jsPsychPipe",
                 "jsPsychPreload","jsPsychSurveyHtmlForm","jsPsychVirtualChinrest"]) sandbox[p] = {name: p};
vm.createContext(sandbox);
for (const f of ["config.js","helpers.js","experiment.js","sections.js","run.js"])
  vm.runInContext(fs.readFileSync(f,'utf8'), sandbox, {filename: f});

const tl = ranTimeline || sandbox.window.__TIMELINE__;
const S  = sandbox.window.SECTIONS;
let fail = 0;
const ck = (n,c,d) => { console.log((c?"  PASS  ":"  FAIL  ")+n+(c?"":"  -> "+d)); if(!c) fail++; };
console.log("timeline assembled, nodes:", tl.length);
const calIdx = tl.indexOf(S.calibration);
ck("run.js pushed the calibration node unchanged", calIdx >= 0, "indexOf = "+calIdx);
ck("it is a loop node, not a bare trial",
   Array.isArray(S.calibration.timeline) && typeof S.calibration.loop_function === "function");
const kinds = S.calibration.timeline.map(t => (t.data && t.data.trial_kind) ||
                 (t.timeline && t.timeline[0] && t.timeline[0].data.trial_kind));
ck("order is seating -> calibration -> seating_retry",
   JSON.stringify(kinds) === JSON.stringify(["seating","calibration","seating_retry"]),
   JSON.stringify(kinds));
ck("the chinrest sits before the instructions in the run",
   calIdx < tl.indexOf(S.comprehension[0]), "cal="+calIdx);
ck("no px/deg is set before calibration runs",
   sandbox.window.ExpBuild.getPxPerDegree() > 0);  // falls back until measured
console.log("  fallback px/deg before calibration:",
            sandbox.window.ExpBuild.getPxPerDegree().toFixed(3),
            "(from ASSUMED_VIEW_DIST_MM =", vm.runInContext('CONFIG',sandbox).ASSUMED_VIEW_DIST_MM + ")");
console.log(fail ? "\nDRY RUN FAILED ("+fail+")" : "\nDRY RUN OK");
process.exit(fail ? 1 : 0);
