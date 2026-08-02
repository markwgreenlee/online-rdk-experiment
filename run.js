/**
 * run.js — assembles the full jsPsych timeline from the builders in
 * experiment.js (window.ExpBuild) and the screens in sections.js
 * (window.SECTIONS), then runs it. Loaded LAST in index.html.
 */
(function () {
  const E = window.ExpBuild;
  const S = window.SECTIONS;
  const CONFIG = E.CONFIG;
  const rng = E.rng;
  const RH = window.RdkHelpers;

  const timeline = [];

  // ---- front matter ----
  timeline.push(S.preload);
  timeline.push(S.browserCheck);
  timeline.push(S.welcomeFullscreen);
  timeline.push(S.consent);

  // ---- intake: ID (standalone only), eligibility, demographics ----
  // Runs after consent and BEFORE calibration/practice, so ineligible or
  // photosensitive participants are screened out before any flickering stimulus.
  if (!E.isProlific) {
    timeline.push(S.participantIdEntry);   // optional researcher code
  }
  timeline.push(S.eligibility);            // date of birth -> age check
  timeline.push(S.eligibilityGate);        // ends study if under age
  if (CONFIG.COLLECT_DEMOGRAPHICS) {
    timeline.push(S.demographics);         // sex/vision/health/... + safety item
    timeline.push(S.safetyGate);           // ends study if photosensitive
  }

  timeline.push(S.calibration);           // sets px/deg via ExpBuild.setPxPerDegree
  timeline.push(...S.comprehension);       // instructions + check loop

  // ---- practice (mixed load, feedback) ----
  timeline.push(S.practiceIntro);
  {
    const cohsForPractice = [0.16, 0.32, 0.64];
    let taughtLow = false, taughtHigh = false;
    for (let i = 0; i < CONFIG.N_PRACTICE; i++) {
      const spec = {
        coherence: RH.randChoice(rng, cohsForPractice),
        direction: RH.randChoice(rng, E.MOTION_DIRECTIONS),
        radial_direction:
          E.MOTION_TYPE === "spiral"
            ? RH.randChoice(rng, CONFIG.SPIRAL_RADIAL)
            : null,
        load_condition: i % 2 === 0 ? "low" : "high",
      };
      if (spec.load_condition === "low" && !taughtLow) {
        timeline.push(E.loadIntro("low", "practice"));
        taughtLow = true;
      }
      if (spec.load_condition === "high" && !taughtHigh) {
        timeline.push(E.loadIntro("high", "practice"));
        taughtHigh = true;
      }
      timeline.push(...E.trialSequence(spec, true));
    }
    timeline.push(S.practiceEnd);
  }

  // ---- test blocks (counterbalanced) ----
  E.blockOrder.forEach((loadCondition, bi) => {
    timeline.push(E.loadIntro(loadCondition, bi + 1));
    const specs = E.buildBlockTrials(loadCondition);
    specs.forEach((spec, ti) => {
      if (ti > 0 && ti % CONFIG.BREAK_EVERY_N_TRIALS === 0) {
        timeline.push(S.breakScreen(ti, specs.length));
      }
      timeline.push(...E.trialSequence(spec, false));
    });
  });

  // ---- back matter ----
  timeline.push(S.debrief);
  timeline.push(S.saveData);   // DataPipe (+ local fallback bundle)
  timeline.push(S.completion); // Prolific redirect

  window.__TIMELINE__ = timeline; // for tests/debug
  E.jsPsych.run(timeline);
})();
