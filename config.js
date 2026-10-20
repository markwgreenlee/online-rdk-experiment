/**
 * config.js — single source of truth for the online RDK + attentional-load study.
 *
 * Mirrors the philosophy of the desktop experiment's config.py: every tunable
 * lives here and is snapshotted into each participant's data. Visual parameters
 * (dot size, density, speed, colours) are adapted from config.py but expressed
 * for a FLAT coherence RDK viewed on an uncalibrated monitor (sizes in degrees,
 * converted to pixels at runtime via the virtual-chinrest px-per-degree).
 */

const CONFIG = {
  /* ---------------- data / deployment ---------------- */
  // OSF DataPipe experiment ID — CREATE A PIPE at https://pipe.jspsych.org and
  // paste its ID here. Until then data still downloads locally as a fallback.
  DATAPIPE_EXPERIMENT_ID: "REPLACE_WITH_DATAPIPE_ID",
  // Prolific completion URL — paste YOUR study's completion code URL.
  PROLIFIC_COMPLETION_URL:
    "https://app.prolific.com/submissions/complete?cc=REPLACE_WITH_CODE",
  SAVE_TO_DATAPIPE: false, // false during local testing
  LOCAL_DOWNLOAD_FALLBACK: true,

  /* ---------------- recruitment / participant identity ---------------- */
  // How participants are recruited. This is an EXPERIMENTER setting (set once
  // when you deploy) — not a question shown to participants.
  //   "auto"        -> Prolific if a PROLIFIC_PID URL parameter is present,
  //                    otherwise standalone (recommended default).
  //   "prolific"    -> always treat as a Prolific run (expects URL params,
  //                    redirects to PROLIFIC_COMPLETION_URL at the end).
  //   "standalone"  -> never use Prolific; assign an anonymous participant ID
  //                    and let the participant enter an optional researcher code.
  RECRUITMENT: "auto",

  /* ---------------- eligibility / intake ---------------- */
  MIN_AGE_YEARS: 18, // hard eligibility floor; DOB is checked against this
  // Store the computed AGE IN YEARS only (recommended). Set true to also store
  // the raw date of birth — note DOB is identifiable personal data, so keep
  // this false unless your ethics protocol specifically requires it.
  STORE_DOB: false,
  COLLECT_DEMOGRAPHICS: true, // present the short intake questionnaire
  // Safety: the stimulus flickers rapidly. If a participant reports
  // photosensitive epilepsy, end the study before any flicker is shown.
  EXCLUDE_PHOTOSENSITIVE: true,

  /* ---------------- stimulus geometry (degrees) ---------------- */
  APERTURE_INNER_DEG: 2.0,
  APERTURE_OUTER_DEG: 7.0,
  DOT_RADIUS_DEG: 0.1, // ~6 arcmin
  DOT_DENSITY: 2.0, // dots / deg^2
  DOT_SPEED_DPS: 6.0, // signal dot speed, deg/s
  DOT_COLOR: "#ffffff",
  BACKGROUND_COLOR: "#000000",
  FIXATION_COLOR: "#ff3b30",

  /* ---------------- RSVP central stream ---------------- */
  RSVP_TARGET: "X",
  RSVP_LENGTH: 6, // items per stream (6 x 150 ms = 900 ms, fits MOTION_DURATION_MS)
  RSVP_MAX_TARGETS: 2, // count range is 0..2 (shared by both load conditions)
  RSVP_ITEM_MS: 150, // 6.7 items/s
  // Probability that a stream contains AT LEAST ONE target. The count is then
  // uniform over 1..RSVP_MAX_TARGETS, so this fully specifies the distribution:
  // at 0.5 -> P(0,1,2) = (0.50, 0.25, 0.25).
  //
  // Why 0.5: the low-load question is "did an X appear?", so the best a
  // participant can do WITHOUT attending to the stream is to answer the more
  // frequent alternative every trial -- max(P(present), P(absent)). That is
  // minimised at exactly 0.5, where both constant strategies score 0.50 and the
  // task is un-gameable. The previous uniform-over-0..2 default put a target in
  // 2/3 of streams, so "always yes" scored 0.67 for free.
  //
  // The cost, and it is a real one: prevalence and the counting task pull in
  // opposite directions. The best constant answer on the HIGH-load question
  // ("how many Xs?") is the modal count, so dropping prevalence to 0.5 raises
  // that baseline from 1/3 to 0.5. Both conditions therefore now sit at a 0.5
  // chance level -- which the analysis derives empirically rather than assuming
  // (see analysis/analyze.py `_load_chance`), and which has the side benefit of
  // putting a* = (acc - chance)/(1 - chance) on the same scale in both.
  // Set to null to restore the legacy uniform-over-0..maxTargets behaviour.
  RSVP_TARGET_PRESENT_P: 0.5,
  RSVP_LETTER_DEG: 0.8,
  RSVP_COLOR: "#7fd4ff",

  /* ---------------- motion / design ---------------- */
  // Coherence levels sampled to span floor-to-ceiling accuracy for the
  // psychometric fit. Logarithmically spaced.
  COHERENCE_LEVELS: [0.04, 0.08, 0.16, 0.32, 0.64],
  MOTION_DURATION_MS: 1000, // stimulus is fixed at 1 s (>= stream 6x150ms)

  // Motion type for THIS run. One type per run (separate deployments / runs
  // avoid within-session confusion). Overridable at deploy time with the
  // `?motion=` URL parameter (translation | rotation | spiral | radial), so a
  // single GitHub Pages deployment serves all four as separate runs.
  //   "translation" -> horizontal drift; response LEFT/RIGHT
  //   "rotation"    -> rigid fronto-parallel spin; response CW(left)/CCW(right)
  //   "spiral"      -> balanced 45-deg screw (rotation + expand/contract);
  //                    response CW(left)/CCW(right); the radial sign is a
  //                    balanced NUISANCE factor (not judged).
  //   "radial"      -> pure expansion/contraction at uniform radial speed;
  //                    response CONTRACT(left)/EXPAND(right). The radial sign
  //                    IS the judged axis here (cf. spiral, where it is a
  //                    nuisance). Matches Luo et al. (2026) Exp 1 geometry.
  MOTION_TYPE: "translation",

  // The signal-motion directions per motion type (the discriminated axis).
  // For spiral, the radial sign is crossed separately (see SPIRAL_RADIAL) and
  // balanced within each coherence cell; it is NOT part of the judged response.
  MOTION_DIRECTIONS: {
    translation: ["left", "right"],
    rotation: ["cw", "ccw"],
    spiral: ["cw", "ccw"],
    radial: ["expand", "contract"],
  },
  // Spiral radial (expansion/contraction) nuisance levels, balanced 50/50
  // within each coherence x rotational-sense cell and logged but not judged.
  SPIRAL_RADIAL: ["expand", "contract"],

  // All four motion types are matched on MOTION ENERGY (area-weighted RMS
  // retinal speed) at this common reference speed, so DOT_SPEED_DPS above is
  // the translation speed; the rotation/spiral rates and the radial speed are
  // derived from it in
  // the plugin. Nothing else to set here.

  DIRECTIONS: ["left", "right"], // legacy (translation); kept for back-compat

  // Which attentional-load blocks this run presents. DEFAULT IS LOW-LOAD ONLY:
  // the RSVP stream is still shown and still questioned ("did an X appear?"),
  // so fixation and the secondary-task demand are held constant -- what is
  // dropped is the load MANIPULATION, not the secondary task. Overridable at
  // deploy time with the `?load=` URL parameter:
  //   ?load=low   -> one low-load block  (default; the motion-type baseline)
  //   ?load=high  -> one high-load block (rarely wanted on its own; see README)
  //   ?load=both  -> two counterbalanced blocks (the original load design)
  // NOTE: a low-only run and a later high-only run do NOT make a valid load
  // contrast -- that comparison would be between sessions and between displays.
  // Use ?load=both when you want the load effect. See README section 8b.
  LOAD_CONDITIONS: ["low"],

  // Design: per load block, each (coherence x direction) cell repeated REPS
  // times. 5 coherence x 2 direction x 8 reps = 80 trials/block.
  //   two-block  (?load=both): 80 x 2 = 160 test trials, 16 per coherence x load
  //   single-block (default):  REPS_PER_CELL_SINGLE_LOAD is used instead, so the
  //                            freed half of the session goes back into reps
  //                            rather than shortening the run.
  // Directions balanced within each coherence cell.
  REPS_PER_CELL: 8,
  // Reps per (coherence x direction) cell when only ONE load block is run.
  // 16 keeps the session at 160 test trials (same duration as the two-block
  // design) and doubles the data per coherence level: 32 trials per coherence
  // instead of 16, which cuts the binomial SE at the steep point from ~0.12 to
  // ~0.085. Set to 8 instead if you want a half-length ~12 min session.
  REPS_PER_CELL_SINGLE_LOAD: 16,
  N_PRACTICE: 10, // practice trials (mixed, with feedback)
  BREAK_EVERY_N_TRIALS: 40, // within-block rest break

  /* ---------------- timing (ms) ---------------- */
  FIXATION_MS: 800,
  ITI_MS: 500,

  /* ---------------- calibration ---------------- */
  // For real online participants the true px/deg comes from the virtual
  // chinrest. FALLBACK_PX_PER_DEGREE is used only if a participant skips or
  // fails calibration. If you know the physical monitor (e.g. a lab display),
  // set DISPLAY_PIXEL_PITCH_MM and ASSUMED_VIEW_DIST_MM below and the fallback
  // is computed from them (overriding this literal) so the stimulus is scaled
  // correctly without calibration.
  FALLBACK_PX_PER_DEGREE: 40.0, // generic default (~15" laptop at 50 cm)
  KNOWN_CARD_WIDTH_MM: 85.6, // ISO/IEC 7810 ID-1 (credit card) long edge

  // Physical-display fallback (optional). Leave both null for the generic
  // fallback above. Set for a known lab/local monitor.
  //   Dell 2209WA secondary display: 22" 16:10, 1680x1050, 0.282 mm pixel
  //   pitch (active area 473.8 x 296.1 mm). Assuming a 60 cm viewing distance
  //   gives ~37 px/deg. Adjust ASSUMED_VIEW_DIST_MM to your real distance.
  DISPLAY_PIXEL_PITCH_MM: 0.282,
  ASSUMED_VIEW_DIST_MM: 574, // = TARGET_VIEW_DIST_MM; keep the two in step

  // ---- standard viewing distance ----
  // 57.4 cm is the distance at which one degree of visual angle subtends almost
  // exactly one centimetre on screen: 2 * 574 * tan(0.5 deg) = 10.018 mm, i.e.
  // 1 deg = 1 cm to within 0.18%. Working at this distance makes degrees and
  // centimetres interchangeable, which is why it is the lab standard here.
  TARGET_VIEW_DIST_MM: 574,
  // Accepted window around the target. The blindspot estimate is a perceptual
  // judgement and is not precise to the millimetre, so demanding better than
  // this would just produce dropout. +/-50 mm is +/-8.7% of the distance, hence
  // +/-8.7% in degrees -- small next to the 23% uncorrected spread it replaces.
  // Checked against the 12 pilot runs: this window flags exactly the four
  // sessions whose card-resize step was demonstrably mis-set (see README 9b).
  VIEW_DIST_TOLERANCE_MM: 50,
  // Extra calibration attempts allowed before the run proceeds anyway (the
  // result is still logged and flagged, never silently accepted as on-target).
  VIEW_DIST_MAX_RETRIES: 2,

  /* ---------------- misc ---------------- */
  VERSION: "1.1.0", // 1.1.0: optional load design, radial motion type, 50% RSVP target prevalence
};

// Derive the calibration fallback from the physical display when its pixel
// pitch and an assumed viewing distance are known. mm-per-degree uses the exact
// visual-angle formula (2 * D * tan(0.5 deg)); px-per-degree = px/mm * mm/deg.
if (CONFIG.DISPLAY_PIXEL_PITCH_MM && CONFIG.ASSUMED_VIEW_DIST_MM) {
  const pxPerMm = 1 / CONFIG.DISPLAY_PIXEL_PITCH_MM;
  const mmPerDeg =
    2 * CONFIG.ASSUMED_VIEW_DIST_MM * Math.tan((0.5 * Math.PI) / 180);
  CONFIG.FALLBACK_PX_PER_DEGREE = pxPerMm * mmPerDeg;
}
