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
  RSVP_LENGTH: 10, // items per stream
  RSVP_MAX_TARGETS: 2, // 0..2 targets, uniform (shared by both load conditions)
  RSVP_ITEM_MS: 100, // 10 items/s
  RSVP_LETTER_DEG: 0.8,
  RSVP_COLOR: "#7fd4ff",

  /* ---------------- motion / design ---------------- */
  // Coherence levels sampled to span floor-to-ceiling accuracy for the
  // psychometric fit. Logarithmically spaced.
  COHERENCE_LEVELS: [0.04, 0.08, 0.16, 0.32, 0.64],
  MOTION_DURATION_MS: 1000, // stimulus is fixed at 1 s (>= stream 10x100ms)

  // Motion type for THIS run. One type per run (separate deployments / runs
  // avoid within-session confusion). Overridable at deploy time with the
  // `?motion=` URL parameter (translation | rotation | spiral), so a single
  // GitHub Pages deployment serves all three as separate runs.
  //   "translation" -> horizontal drift; response LEFT/RIGHT
  //   "rotation"    -> rigid fronto-parallel spin; response CW(left)/CCW(right)
  //   "spiral"      -> balanced 45-deg screw (rotation + expand/contract);
  //                    response CW(left)/CCW(right); the radial sign is a
  //                    balanced NUISANCE factor (not judged).
  MOTION_TYPE: "translation",

  // The signal-motion directions per motion type (the discriminated axis).
  // For spiral, the radial sign is crossed separately (see SPIRAL_RADIAL) and
  // balanced within each coherence cell; it is NOT part of the judged response.
  MOTION_DIRECTIONS: {
    translation: ["left", "right"],
    rotation: ["cw", "ccw"],
    spiral: ["cw", "ccw"],
  },
  // Spiral radial (expansion/contraction) nuisance levels, balanced 50/50
  // within each coherence x rotational-sense cell and logged but not judged.
  SPIRAL_RADIAL: ["expand", "contract"],

  // All three motion types are matched on MOTION ENERGY (area-weighted RMS
  // retinal speed) at this common reference speed, so DOT_SPEED_DPS above is
  // the translation speed and the rotation/spiral rates are derived from it in
  // the plugin. Nothing else to set here.

  DIRECTIONS: ["left", "right"], // legacy (translation); kept for back-compat
  LOAD_CONDITIONS: ["low", "high"],

  // Design: per load block, each (coherence x direction) cell repeated REPS
  // times. 5 coherence x 2 direction x 8 reps = 80 trials/block x 2 blocks
  // = 160 test trials. Directions balanced within each coherence cell.
  REPS_PER_CELL: 8,
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
  ASSUMED_VIEW_DIST_MM: 600,

  /* ---------------- misc ---------------- */
  VERSION: "1.0.0",
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
