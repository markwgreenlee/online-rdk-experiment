/**
 * helpers.js
 * -------------------------------------------------------------------------
 * Shared utilities for the Online RDK + attentional-load experiment:
 *   - a seeded PRNG (mulberry32 + a string hash) so each participant's
 *     randomization is reproducible from a logged seed;
 *   - RSVP stream generation that is IDENTICAL in distribution for the low- and
 *     high-load conditions (only the participant's TASK on the stream differs),
 *     so the visual input is matched across the attentional-load manipulation.
 */

/* ----------------------------- seeded PRNG ----------------------------- */
function hashStringToSeed(str) {
  // xmur3 string hash -> 32-bit integer seed
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed) {
  // returns a function producing floats in [0,1)
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seedStr) {
  return mulberry32(hashStringToSeed(String(seedStr)));
}

/* ------------------------- generic array helpers ----------------------- */
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randInt(rng, lo, hi) {
  // inclusive lo..hi
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function randChoice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/* --------------------------- RSVP stream gen --------------------------- */
// Distractor alphabet: consonants, excluding the target and easily-confused
// glyphs (I/O/Q). The stream contains 0..maxTargets copies of the target. The
// count distribution is set by `targetPresentP` (see below) and is IDENTICAL
// across load conditions -- this same generator feeds BOTH low- and high-load
// trials, so only the participant's TASK on the stream differs.
const RSVP_DISTRACTORS = "BCDFGHJKLMNPRSTUVWZ".split("");

function makeRsvpStream(rng, opts) {
  const {
    length = 10,
    target = "X",
    maxTargets = 3,
    targetPresentP = null,
  } = opts || {};
  // How many targets this stream contains.
  //   targetPresentP == null -> legacy: uniform over 0..maxTargets. With
  //     maxTargets=2 that puts a target in 2/3 of streams, so "always yes" on
  //     the low-load task scores 0.67 without attending to the stream at all.
  //   targetPresentP set     -> a target is PRESENT with that probability, and
  //     the count is then uniform over 1..maxTargets. At 0.5 the low-load task
  //     reaches its floor: always-yes and always-no both score exactly 0.5.
  // See README section 6d for the full gameability argument -- lowering
  // prevalence also RAISES the best constant answer on the high-load counting
  // task (to P(no target)), which the analysis chance rule accounts for.
  const nTargets =
    targetPresentP === null || targetPresentP === undefined
      ? randInt(rng, 0, maxTargets)
      : rng() < targetPresentP
      ? randInt(rng, 1, maxTargets)
      : 0;
  // pick distinct positions for targets (targets never adjacent-forced, just
  // distinct slots); avoid the first and last slot so onset/offset transients
  // don't hide a target.
  const interiorPositions = [];
  for (let i = 1; i < length - 1; i++) interiorPositions.push(i);
  shuffleInPlace(interiorPositions, rng);
  const targetPositions = new Set(interiorPositions.slice(0, nTargets));

  const distractors = RSVP_DISTRACTORS.filter((c) => c !== target);
  const stream = [];
  for (let i = 0; i < length; i++) {
    if (targetPositions.has(i)) {
      stream.push(target);
    } else {
      stream.push(randChoice(rng, distractors));
    }
  }
  return { stream: stream, nTargets: nTargets };
}

// expose to the global scope for the non-module <script> loading used here
window.RdkHelpers = {
  makeRng,
  shuffleInPlace,
  randInt,
  randChoice,
  makeRsvpStream,
  hashStringToSeed,
};
