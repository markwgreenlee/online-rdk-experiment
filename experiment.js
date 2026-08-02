/**
 * experiment.js — trial timeline, randomization, and flow for the online
 * RDK + attentional-load study.
 *
 * Flow: consent -> device check -> virtual-chinrest calibration -> instructions
 * (+ comprehension checks) -> practice (feedback) -> 2 load blocks (order
 * counterbalanced) with a mid-block break -> debrief -> save (DataPipe) ->
 * Prolific completion redirect.
 *
 * Depends (loaded as globals by index.html):
 *   jsPsych (7.x), plugin-html-keyboard-response, plugin-html-button-response,
 *   plugin-instructions, plugin-survey-html-form, plugin-preload,
 *   plugin-fullscreen, plugin-virtual-chinrest, plugin-browser-check,
 *   @jspsych-contrib/plugin-pipe, jsPsychRdkLoad (custom), CONFIG, RdkHelpers.
 */

/* =========================================================================
 * 0. jsPsych init + participant / session identifiers
 * ========================================================================= */
const jsPsych = initJsPsych({
  on_finish: function () {
    // handled explicitly by the save + redirect nodes; nothing here.
  },
});
// expose immediately so sections.js (loaded next) can reference it
window.__JSPSYCH__ = jsPsych;

// ---- recruitment mode + participant identity --------------------------------
// Prolific passes PROLIFIC_PID / STUDY_ID / SESSION_ID as URL query params.
const prolificPid = jsPsych.data.getURLVariable("PROLIFIC_PID");
const recruitCfg = (CONFIG.RECRUITMENT || "auto").toLowerCase();
const isProlific =
  recruitCfg === "prolific" ||
  (recruitCfg === "auto" && !!prolificPid);

// A short, URL-safe random token for anonymous (non-Prolific) participants.
function randomId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return prefix + rand + stamp;
}

// The canonical subject_id must be fixed at page load because it seeds the RNG
// that generates the trial list and RSVP streams. On Prolific it is the PID;
// in standalone mode it is an auto-assigned anonymous token. Any researcher-
// supplied code entered at intake is stored separately as `participant_code`
// (see sections.js) and does not change the seed.
const subject_id = isProlific ? (prolificPid || "PROLIFIC_NA") : randomId("ANON-");
const study_id = jsPsych.data.getURLVariable("STUDY_ID") || "NA";
const session_id = jsPsych.data.getURLVariable("SESSION_ID") || "NA";

// Motion type for this run. A `?motion=` URL parameter overrides the config
// default so one deployment serves translation / rotation / spiral as separate
// runs. Unknown values fall back to the config default.
const MOTION_TYPES_VALID = ["translation", "rotation", "spiral"];
const motionUrl = (jsPsych.data.getURLVariable("motion") || "").toLowerCase();
const MOTION_TYPE = MOTION_TYPES_VALID.includes(motionUrl)
  ? motionUrl
  : (CONFIG.MOTION_TYPE || "translation");
const MOTION_DIRECTIONS = (CONFIG.MOTION_DIRECTIONS || {})[MOTION_TYPE] ||
  CONFIG.DIRECTIONS;

// Reproducible per-participant seed. Motion type is folded in so the three
// runs get independent (but individually reproducible) randomizations.
const seedStr = subject_id + "::" + MOTION_TYPE + "::" + CONFIG.VERSION;
const rng = RdkHelpers.makeRng(seedStr);

// px-per-degree is filled in by the virtual chinrest; default until then.
let PX_PER_DEGREE = CONFIG.FALLBACK_PX_PER_DEGREE;

jsPsych.data.addProperties({
  subject_id: subject_id,
  participant_code: subject_id, // may be overwritten at intake in standalone mode
  recruitment_mode: isProlific ? "prolific" : "standalone",
  study_id: study_id,
  session_id: session_id,
  seed: seedStr,
  config_version: CONFIG.VERSION,
  motion_type: MOTION_TYPE,
  coherence_levels: CONFIG.COHERENCE_LEVELS.join(","),
  reps_per_cell: CONFIG.REPS_PER_CELL,
});

/* =========================================================================
 * 1. trial-list construction
 * ========================================================================= */
// One test block for a given load condition: fully crossed coherence x
// direction x reps, balanced and shuffled with the seeded RNG.
function buildBlockTrials(loadCondition) {
  const trials = [];
  const isSpiral = MOTION_TYPE === "spiral";
  const radialLevels = CONFIG.SPIRAL_RADIAL || ["expand", "contract"];
  for (const coh of CONFIG.COHERENCE_LEVELS) {
    for (const dir of MOTION_DIRECTIONS) {
      for (let r = 0; r < CONFIG.REPS_PER_CELL; r++) {
        if (isSpiral) {
          // Balance the radial nuisance 50/50 within each coherence x sense
          // cell: half the reps expand, half contract (alternate, then the
          // whole block is shuffled). REPS_PER_CELL should be even for exact
          // balance; if odd, the split differs by one rep.
          const radial = radialLevels[r % radialLevels.length];
          trials.push({
            coherence: coh,
            direction: dir,
            radial_direction: radial,
            load_condition: loadCondition,
          });
        } else {
          trials.push({
            coherence: coh,
            direction: dir,
            radial_direction: null,
            load_condition: loadCondition,
          });
        }
      }
    }
  }
  RdkHelpers.shuffleInPlace(trials, rng);
  return trials;
}

// Counterbalance which load block comes first, deterministically from the RNG.
const lowFirst = rng() < 0.5;
const blockOrder = lowFirst ? ["low", "high"] : ["high", "low"];
jsPsych.data.addProperties({ block_order: blockOrder.join(",") });

// Turn a spec object into a full rdk-load trial (attaching a fresh RSVP stream).
function makeRdkTrial(spec, isPractice) {
  const s = RdkHelpers.makeRsvpStream(rng, {
    length: CONFIG.RSVP_LENGTH,
    target: CONFIG.RSVP_TARGET,
    maxTargets: CONFIG.RSVP_MAX_TARGETS,
  });
  return {
    type: jsPsychRdkLoad,
    px_per_degree: function () { return PX_PER_DEGREE; }, // resolved at run time
    aperture_inner_deg: CONFIG.APERTURE_INNER_DEG,
    aperture_outer_deg: CONFIG.APERTURE_OUTER_DEG,
    dot_radius_deg: CONFIG.DOT_RADIUS_DEG,
    dot_density: CONFIG.DOT_DENSITY,
    dot_speed_dps: CONFIG.DOT_SPEED_DPS,
    dot_color: CONFIG.DOT_COLOR,
    background_color: CONFIG.BACKGROUND_COLOR,
    fixation_color: CONFIG.FIXATION_COLOR,
    motion_type: MOTION_TYPE,
    coherence: spec.coherence,
    direction: spec.direction,
    radial_direction: spec.radial_direction,
    motion_duration_ms: CONFIG.MOTION_DURATION_MS,
    rsvp_stream: s.stream,
    rsvp_target: CONFIG.RSVP_TARGET,
    rsvp_item_ms: CONFIG.RSVP_ITEM_MS,
    rsvp_letter_deg: CONFIG.RSVP_LETTER_DEG,
    rsvp_color: CONFIG.RSVP_COLOR,
    load_condition: spec.load_condition,
    rsvp_max_targets: CONFIG.RSVP_MAX_TARGETS,
    feedback: !!isPractice,
    // NOTE: jsPsych only writes the `data` object (plus fields the plugin adds
    // in finishTrial) to the saved CSV — trial *parameters* like coherence are
    // NOT auto-saved. So the independent variables are duplicated here.
    data: {
      task: isPractice ? "practice" : "test",
      trial_kind: "rdk",
      motion_type: MOTION_TYPE,
      coherence: spec.coherence,
      direction: spec.direction,
      radial_direction: spec.radial_direction,
      load_condition: spec.load_condition,
      rsvp_n_targets: s.nTargets,
    },
  };
}

/* =========================================================================
 * 2. reusable simple screens
 * ========================================================================= */
const fixation = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus:
    '<div style="font-size:2.5em;color:#ff3b30;">+</div>',
  choices: "NO_KEYS",
  trial_duration: CONFIG.FIXATION_MS,
  data: { trial_kind: "fixation" },
};

const iti = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: "",
  choices: "NO_KEYS",
  trial_duration: CONFIG.ITI_MS,
  data: { trial_kind: "iti" },
};

// A test/practice trial = fixation -> rdk -> iti
function trialSequence(spec, isPractice) {
  return [fixation, makeRdkTrial(spec, isPractice), iti];
}

/* =========================================================================
 * 3. instructions text (per load condition)
 * ========================================================================= */
// Per-motion-type phrase for the "first say which way ..." line. Rotation and
// spiral judge rotational sense (LEFT=CCW, RIGHT=CW); translation judges L/R.
const _isRotMT = MOTION_TYPE === "rotation" || MOTION_TYPE === "spiral";
const MOTION_PHRASE = _isRotMT
  ? "<b>which way the dots were rotating</b> (\u21ba / \u21bb)"
  : "<b>which way the dots moved</b> (\u2190 / \u2192)";

const loadInstructionHtml = {
  low:
    "<h2>Letter task: EASY version</h2>" +
    "<p>While you watch the dots, a quick stream of letters flashes in the centre.</p>" +
    "<p>Afterwards you'll first say " + MOTION_PHRASE + ", " +
    "then simply say whether the letter <b>" + CONFIG.RSVP_TARGET +
    "</b> appeared at all (<b>Y</b> / <b>N</b>).</p>" +
    "<p>Keep your eyes on the central cross the whole time.</p>",
  high:
    "<h2>Letter task: HARD version</h2>" +
    "<p>While you watch the dots, a quick stream of letters flashes in the centre.</p>" +
    "<p>Afterwards you'll first say " + MOTION_PHRASE + ", " +
    "then report <b>exactly how many</b> <b>" + CONFIG.RSVP_TARGET +
    "</b>s appeared (press <b>0\u2013" + CONFIG.RSVP_MAX_TARGETS +
    "</b>). You must count them carefully.</p>" +
    "<p>Keep your eyes on the central cross the whole time.</p>",
};

function loadIntro(loadCondition, blockNum) {
  const header =
    blockNum === "practice"
      ? "<h3>Practice \u2014 " + (loadCondition === "low" ? "easy" : "hard") + " letter task</h3>"
      : "<h3>Block " + blockNum + " of 2</h3>";
  return {
    type: jsPsychHtmlButtonResponse,
    stimulus:
      "<div style='max-width:640px;margin:auto;text-align:left;'>" +
      header +
      loadInstructionHtml[loadCondition] +
      "<p style='opacity:0.8;'>Both tasks matter — try to do your best on both.</p></div>",
    choices: ["Start this block"],
    data: { trial_kind: "block_intro", load_condition: loadCondition },
  };
}

/* =========================================================================
 * 4. expose builders + state for run.js to assemble & run the timeline
 * ========================================================================= */
// The timeline is assembled in run.js (loaded last), which references SECTIONS
// (defined in sections.js, loaded between this file and run.js). This avoids a
// circular dependency: experiment.js -> jsPsych/builders; sections.js -> those;
// run.js -> SECTIONS + builders.
window.ExpBuild = {
  jsPsych,
  rng,
  CONFIG,
  MOTION_TYPE,
  MOTION_DIRECTIONS,
  buildBlockTrials,
  blockOrder,
  makeRdkTrial,
  trialSequence,
  loadIntro,
  fixation,
  iti,
  setPxPerDegree: function (v) { PX_PER_DEGREE = v; },
  getPxPerDegree: function () { return PX_PER_DEGREE; },
  isProlific: isProlific,
  ids: { subject_id, study_id, session_id, seedStr },
};
