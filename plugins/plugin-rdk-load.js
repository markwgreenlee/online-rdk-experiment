/**
 * plugin-rdk-load.js
 * -------------------------------------------------------------------------
 * Custom jsPsych 7.x plugin: a flat random-dot kinematogram (RDK) shown in an
 * annular aperture with a simultaneous central RSVP letter stream, followed by
 * a 2AFC global-motion-direction response and a secondary "attentional-load"
 * response.
 *
 * Scientific lineage: the visual parameters (white dots on black, dot size and
 * density, speed) are adapted from the desktop PsychoPy vection experiment in
 * this repository (config.py / optic_flow.py). The engine here is a standard
 * FLAT coherence-based RDK (not the funnel/looming optic-flow model), because
 * the online study measures objective direction discrimination rather than
 * subjective vection.
 *
 * Coherence algorithm: "white noise" (a.k.a. Rajananda et al. 2018 rule 1 /
 * Scase et al. 1996). On every animation frame each dot is INDEPENDENTLY
 * designated signal (probability = coherence) or noise (probability =
 * 1 - coherence). Signal dots step by (speed * dt) in the coherent direction;
 * noise dots are repositioned to a random location in the aperture. Because the
 * signal/noise assignment is redrawn each frame, no individual dot is trackable,
 * so the only reliable cue is GLOBAL motion. Timing is wall-clock based
 * (elapsed ms via requestAnimationFrame timestamps), so the physical dot speed
 * and stimulus duration are independent of the participant's refresh rate.
 *
 * Data recorded per trial (see `info.data` below): coherence, signal direction,
 * motion response + correctness + RT, the exact RSVP stream and its target
 * count, the load condition, the load response + correctness + RT, plus the
 * measured mean frame interval for QC.
 *
 * Author: generated for the Online_RDK_Experiment build. MIT-style, open source.
 */

var jsPsychRdkLoad = (function (jspsych) {
  "use strict";

  const info = {
    name: "rdk-load",
    version: "1.0.0",
    parameters: {
      /* ---- geometry (all angular sizes are in degrees of visual angle) ---- */
      px_per_degree: {
        type: jspsych.ParameterType.FLOAT,
        default: 40.0, // overwritten at runtime from the virtual-chinrest calibration
      },
      aperture_inner_deg: {
        type: jspsych.ParameterType.FLOAT,
        default: 2.0, // inner radius of the annulus (keeps dots off the RSVP letters)
      },
      aperture_outer_deg: {
        type: jspsych.ParameterType.FLOAT,
        default: 7.0, // outer radius of the annulus
      },
      dot_radius_deg: {
        type: jspsych.ParameterType.FLOAT,
        default: 0.1, // dot radius (~6 arcmin; comparable to config.py dot sizes)
      },
      dot_density: {
        type: jspsych.ParameterType.FLOAT,
        default: 2.0, // dots per degree^2 of aperture area
      },
      dot_speed_dps: {
        type: jspsych.ParameterType.FLOAT,
        default: 6.0, // signal dot speed in degrees/second
      },
      dot_color: {
        type: jspsych.ParameterType.STRING,
        default: "#ffffff",
      },
      background_color: {
        type: jspsych.ParameterType.STRING,
        default: "#000000",
      },
      fixation_color: {
        type: jspsych.ParameterType.STRING,
        default: "#ff3b30", // red, matching the desktop experiment's fixation
      },

      /* ---- motion stimulus ---- */
      coherence: {
        type: jspsych.ParameterType.FLOAT,
        default: 0.5, // proportion of coherently moving dots (0..1)
      },
      motion_type: {
        type: jspsych.ParameterType.STRING,
        default: "translation", // "translation" | "rotation" | "spiral" | "radial"
      },
      direction: {
        type: jspsych.ParameterType.STRING,
        // translation: "left"/"right"; rotation & spiral: "cw"/"ccw";
        // radial: "expand"/"contract"
        // (the signal motion sense the participant discriminates)
        default: "right",
      },
      radial_direction: {
        type: jspsych.ParameterType.STRING,
        // spiral only: "expand"/"contract". This is a balanced NUISANCE factor
        // (not judged) — the participant reports only cw/ccw. Ignored for the
        // other motion types.
        default: "expand",
      },
      motion_duration_ms: {
        type: jspsych.ParameterType.INT,
        default: 1000,
      },

      /* ---- RSVP central stream (the attentional-load secondary task) ---- */
      rsvp_stream: {
        type: jspsych.ParameterType.STRING,
        array: true,
        default: [], // sequence of single characters shown at fixation
      },
      rsvp_target: {
        type: jspsych.ParameterType.STRING,
        default: "X", // the target letter to detect / count
      },
      rsvp_item_ms: {
        type: jspsych.ParameterType.INT,
        default: 100, // duration of each letter (SOA; no blank between items)
      },
      rsvp_letter_deg: {
        type: jspsych.ParameterType.FLOAT,
        default: 0.8, // letter height in degrees
      },
      rsvp_color: {
        type: jspsych.ParameterType.STRING,
        default: "#7fd4ff", // pale blue — distinct from white dots & red fixation
      },
      load_condition: {
        type: jspsych.ParameterType.STRING,
        default: "low", // "low" (detect) or "high" (count)
      },
      rsvp_max_targets: {
        type: jspsych.ParameterType.INT,
        default: 2, // high-load count range is 0..rsvp_max_targets
      },

      /* ---- responses ---- */
      motion_choices: {
        type: jspsych.ParameterType.KEYS,
        default: ["ArrowLeft", "ArrowRight"],
      },
      feedback: {
        type: jspsych.ParameterType.BOOL,
        default: false, // practice trials set this true
      },
      feedback_ms: {
        type: jspsych.ParameterType.INT,
        default: 700,
      },
    },
    data: {
      motion_type: { type: jspsych.ParameterType.STRING },
      coherence: { type: jspsych.ParameterType.FLOAT },
      direction: { type: jspsych.ParameterType.STRING },
      radial_direction: { type: jspsych.ParameterType.STRING },
      load_condition: { type: jspsych.ParameterType.STRING },
      motion_response: { type: jspsych.ParameterType.STRING },
      motion_correct: { type: jspsych.ParameterType.BOOL },
      motion_rt: { type: jspsych.ParameterType.FLOAT },
      rsvp_stream: { type: jspsych.ParameterType.STRING, array: true },
      rsvp_target: { type: jspsych.ParameterType.STRING },
      rsvp_n_targets: { type: jspsych.ParameterType.INT },
      load_response: { type: jspsych.ParameterType.INT },
      load_correct: { type: jspsych.ParameterType.BOOL },
      load_rt: { type: jspsych.ParameterType.FLOAT },
      mean_frame_ms: { type: jspsych.ParameterType.FLOAT },
      n_frames: { type: jspsych.ParameterType.INT },
    },
  };

  class RdkLoadPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const jsPsych = this.jsPsych;

      // ---------------- derived geometry (pixels) ----------------
      // px_per_degree may be supplied as a live getter function (so it can be
      // filled in by the virtual-chinrest AFTER the timeline is built). jsPsych
      // does not reliably auto-evaluate function-valued parameters for custom
      // plugins, so resolve it here: call it if it's a function, and guard
      // against a non-finite / non-positive result (which would make every dot
      // and letter invisible). Falls back to a laptop-typical 40 px/deg.
      let ppd = trial.px_per_degree;
      if (typeof ppd === "function") ppd = ppd();
      if (typeof ppd !== "number" || !isFinite(ppd) || ppd <= 0) ppd = 40.0;
      const rInner = trial.aperture_inner_deg * ppd;
      const rOuter = trial.aperture_outer_deg * ppd;
      const dotR = Math.max(1, trial.dot_radius_deg * ppd);
      const speedPxPerMs = (trial.dot_speed_dps * ppd) / 1000.0;
      const apertureAreaDeg2 =
        Math.PI *
        (trial.aperture_outer_deg ** 2 - trial.aperture_inner_deg ** 2);
      const nDots = Math.max(1, Math.round(trial.dot_density * apertureAreaDeg2));

      // ---------------- motion-type kinematics ----------------
      // The three motion types are matched on MOTION ENERGY, i.e. the
      // area-weighted RMS retinal speed across the annulus (the flat-screen
      // reduction of the desktop vection experiment's <area * speed^2>
      // equating). For a uniform-density annulus the area-weighted mean of
      // r^2 is <r^2> = (rOuter^2 + rInner^2) / 2.
      //   translation: every signal dot moves at v = dot_speed_dps (constant)
      //                => <speed^2> = v^2
      //   rotation:    rigid spin at angular rate w; local speed = w*r
      //                => <speed^2> = w^2 <r^2>;  w = v / sqrt(<r^2>)
      //   spiral:      balanced 45 deg screw; equal radial & tangential
      //                components k*r each => local speed^2 = 2 k^2 r^2
      //                => <speed^2> = 2 k^2 <r^2>;  k = v / sqrt(2 <r^2>)
      //   radial:      pure expansion/contraction at UNIFORM radial speed v
      //                (every signal dot moves radially at v, as in Luo et al.
      //                2026 Experiment 1) => <speed^2> = v^2 exactly, and
      //                identically for both signs, so a measured
      //                expansion-vs-contraction difference cannot be a
      //                motion-energy artifact. Note this is NOT the spiral's
      //                radial component (which is scale-invariant k*r); the
      //                uniform field is chosen because it equates the two
      //                radial signs to each other, which the k*r field does not.
      const motionType = trial.motion_type || "translation";
      const meanR2 = (rOuter * rOuter + rInner * rInner) / 2; // px^2
      const vPxPerMs = speedPxPerMs; // translation reference speed
      const omegaRotPerMs = vPxPerMs / Math.sqrt(meanR2); // rad/ms (rotation)
      const kSpiralPerMs = vPxPerMs / Math.sqrt(2 * meanR2); // 1/ms (spiral)

      // Sign conventions. Canvas y points DOWN, so a positive rotation
      // (x' = x cos - y sin, y' = x sin + y cos) advances atan2(y,x) and is
      // therefore CLOCKWISE as seen by the participant. +x is rightward.
      const dirSign = trial.direction === "right" ? 1 : -1; // translation
      const signCW = trial.direction === "cw" ? 1 : -1; // +1 = clockwise
      const signExp = trial.radial_direction === "contract" ? -1 : 1; // +1 = expand
      // radial type: the JUDGED axis is the radial sign, carried in `direction`
      const signRad = trial.direction === "contract" ? -1 : 1; // +1 = expand

      // ---------------- canvas fills the viewport ----------------
      // The CSS box AND the drawing buffer must both cover the full viewport.
      // jsPsych renders trial content inside a centered `.jspsych-content`
      // wrapper; a canvas with only position:fixed/top:0/left:0 (but no CSS
      // width/height) inherits that wrapper's small, centered box, so the
      // full-buffer drawing appears offset toward the lower-right. Force the
      // CSS box to 100vw x 100vh and lift it above the wrapper with z-index so
      // element box and pixel buffer coincide and the centre is the true centre.
      // Attach the canvas DIRECTLY to document.body, NOT inside the jsPsych
      // content wrapper. jsPsych's `.jspsych-content-wrapper` (or an ancestor)
      // can carry a CSS `transform`, which makes THAT element — not the
      // viewport — the containing block for `position:fixed` children. A
      // fixed canvas placed inside it is then offset by the wrapper's position
      // (top-left of a centred wrapper => off-screen), which is exactly why the
      // stimulus was invisible while the body-attached debug overlay showed.
      // Appending to <body> guarantees `position:fixed` resolves against the
      // viewport. display_element stays empty during the motion phase.
      display_element.innerHTML = "";
      const canvas = document.createElement("canvas");
      canvas.id = "rdk-canvas";
      canvas.style.cssText =
        "display:block;position:fixed;top:0;left:0;margin:0;padding:0;" +
        "background:" + trial.background_color + ";z-index:2147483000;";
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      // CSS-pixel viewport dimensions; refreshed by resize(). ALL drawing is in
      // CSS pixels (see setTransform below), so the annulus radii, dot sizes and
      // centre derive from these — never from canvas.width/height, which is the
      // device-pixel backing buffer and can be a fractional multiple larger on a
      // macOS "scaled" display (devicePixelRatio ~1.59, not an integer).
      let cssW = 0;
      let cssH = 0;
      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        cssW = window.innerWidth;
        cssH = window.innerHeight;
        // Pin the CSS box explicitly to the visual viewport (px, not 100vw/vh):
        // vw/vh can resolve to the layout viewport and diverge from innerWidth
        // in fullscreen / scaled-display / page-zoom situations.
        canvas.style.width = cssW + "px";
        canvas.style.height = cssH + "px";
        // Backing buffer at device resolution for crisp dots...
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        // ...but draw in CSS pixels: 1 user unit -> dpr device px. This makes
        // the buffer/box 1:1 in CSS space, so (cssW/2, cssH/2) is the true
        // screen centre regardless of the (possibly fractional) dpr.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const cx = () => cssW / 2;
      const cy = () => cssH / 2;

      // ---------------- optional debug overlay (?debug=1) ----------------
      // Prints live geometry to the top-left corner so a participant/tester can
      // read back exact numbers if the stimulus still isn't visible. Off unless
      // the URL contains debug=1.
      let debugEl = null;
      const debugOn =
        typeof location !== "undefined" &&
        /[?&]debug=1\b/.test(location.search || "");
      const maybeDebugOverlay = debugOn
        ? function () {
            if (!debugEl) {
              debugEl = document.createElement("div");
              debugEl.style.cssText =
                "position:fixed;top:8px;left:8px;z-index:2147483001;" +
                "font:12px/1.4 monospace;color:#0f0;background:rgba(0,0,0,0.6);" +
                "padding:6px 8px;white-space:pre;pointer-events:none;";
              document.body.appendChild(debugEl);
            }
            debugEl.textContent =
              "css " + cssW + "x" + cssH +
              "  buffer " + canvas.width + "x" + canvas.height +
              "  dpr=" + (window.devicePixelRatio || 1).toFixed(3) +
              "\nppd=" + ppd.toFixed(1) +
              "  rInner=" + rInner.toFixed(0) + "px rOuter=" + rOuter.toFixed(0) +
              "px dotR=" + dotR.toFixed(1) +
              "\nnDots=" + nDots + " coh=" + trial.coherence +
              " type=" + motionType + " dir=" + trial.direction +
              "\nwindow " + window.innerWidth + "x" + window.innerHeight +
              " fs=" + (!!document.fullscreenElement);
          }
        : null;

      // ---------------- dot state ----------------
      // Each dot: position (x,y) relative to centre, in px. Signal/noise is
      // re-rolled per frame, so we only persist positions.
      const dots = new Array(nDots);
      const randPointInAnnulus = () => {
        // uniform over the annulus area
        const rr = Math.sqrt(
          rInner * rInner +
            Math.random() * (rOuter * rOuter - rInner * rInner)
        );
        const th = Math.random() * 2 * Math.PI;
        return { x: rr * Math.cos(th), y: rr * Math.sin(th) };
      };
      for (let i = 0; i < nDots; i++) dots[i] = randPointInAnnulus();

      const inAnnulus = (x, y) => {
        const r2 = x * x + y * y;
        return r2 >= rInner * rInner && r2 <= rOuter * rOuter;
      };

      // ---------------- RSVP stream bookkeeping ----------------
      const stream = trial.rsvp_stream || [];
      const nTargets = stream.filter((c) => c === trial.rsvp_target).length;
      const letterPx = trial.rsvp_letter_deg * ppd;

      // ---------------- animation loop ----------------
      let startTime = null;
      let lastTime = null;
      let frameIntervals = [];
      let rafId = null;

      const drawFixation = () => {
        const s = 0.4 * ppd; // 0.4 deg cross
        ctx.strokeStyle = trial.fixation_color;
        ctx.lineWidth = Math.max(1, 0.06 * ppd);
        ctx.beginPath();
        ctx.moveTo(cx() - s / 2, cy());
        ctx.lineTo(cx() + s / 2, cy());
        ctx.moveTo(cx(), cy() - s / 2);
        ctx.lineTo(cx(), cy() + s / 2);
        ctx.stroke();
      };

      const currentLetter = (elapsed) => {
        if (stream.length === 0) return null;
        const idx = Math.floor(elapsed / trial.rsvp_item_ms);
        if (idx < 0 || idx >= stream.length) return null;
        return stream[idx];
      };

      const step = (ts) => {
        if (startTime === null) {
          startTime = ts;
          lastTime = ts;
        }
        const elapsed = ts - startTime;
        const dt = ts - lastTime;
        lastTime = ts;
        if (dt > 0 && dt < 200) frameIntervals.push(dt);

        // advance dots
        const stepPx = vPxPerMs * dt; // translation step this frame
        // per-frame rotation angle (rad) and radial growth factor
        const dTheta = signCW * omegaRotPerMs * dt; // rotation type
        const dThetaSp = signCW * kSpiralPerMs * dt; // spiral tangential
        const radFac = 1 + signExp * kSpiralPerMs * dt; // spiral radial (log spiral)
        for (let i = 0; i < nDots; i++) {
          if (Math.random() < trial.coherence) {
            // signal dot: coherent motion per motion_type
            if (motionType === "rotation") {
              // rigid rotation about centre; radius preserved
              const x = dots[i].x, y = dots[i].y;
              const c = Math.cos(dTheta), s = Math.sin(dTheta);
              dots[i].x = x * c - y * s;
              dots[i].y = x * s + y * c;
              // radius is invariant, so it stays in the annulus; no respawn
            } else if (motionType === "radial") {
              // pure expansion/contraction: translate along the radius at the
              // uniform speed v (no angular component, no radial gradient)
              const x = dots[i].x, y = dots[i].y;
              const rr = Math.hypot(x, y);
              if (rr > 0) {
                const f = (rr + signRad * stepPx) / rr;
                dots[i].x = x * f;
                dots[i].y = y * f;
              }
              if (!inAnnulus(dots[i].x, dots[i].y)) {
                // crossed the inner or outer boundary -> respawn
                dots[i] = randPointInAnnulus();
              }
            } else if (motionType === "spiral") {
              // balanced screw: rotate AND scale radius exponentially
              const x = dots[i].x, y = dots[i].y;
              const c = Math.cos(dThetaSp), s = Math.sin(dThetaSp);
              dots[i].x = (x * c - y * s) * radFac;
              dots[i].y = (x * s + y * c) * radFac;
              if (!inAnnulus(dots[i].x, dots[i].y)) {
                // exited the annulus radially -> respawn
                dots[i] = randPointInAnnulus();
              }
            } else {
              // translation: coherent horizontal motion
              dots[i].x += dirSign * stepPx;
              if (!inAnnulus(dots[i].x, dots[i].y)) {
                // wrapped out of the aperture -> respawn at a random location
                dots[i] = randPointInAnnulus();
              }
            }
          } else {
            // noise dot: teleport to a fresh random location
            dots[i] = randPointInAnnulus();
          }
        }

        // render (coordinates are in CSS px because of the setTransform in resize)
        ctx.fillStyle = trial.background_color;
        ctx.fillRect(0, 0, cssW, cssH);

        ctx.fillStyle = trial.dot_color;
        const ox = cx();
        const oy = cy();
        for (let i = 0; i < nDots; i++) {
          ctx.beginPath();
          ctx.arc(ox + dots[i].x, oy + dots[i].y, dotR, 0, 2 * Math.PI);
          ctx.fill();
        }

        // central RSVP letter (drawn over the inner blank zone)
        const letter = currentLetter(elapsed);
        if (letter !== null) {
          ctx.fillStyle = trial.rsvp_color;
          ctx.font = `bold ${Math.round(letterPx)}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(letter, ox, oy);
        } else {
          drawFixation();
        }

        if (maybeDebugOverlay) maybeDebugOverlay();

        if (elapsed < trial.motion_duration_ms) {
          rafId = requestAnimationFrame(step);
        } else {
          endMotion();
        }
      };

      // ---------------- response phase ----------------
      const trialData = {
        motion_type: motionType,
        coherence: trial.coherence,
        direction: trial.direction,
        radial_direction: motionType === "spiral" ? trial.radial_direction : null,
        load_condition: trial.load_condition,
        rsvp_stream: stream,
        rsvp_target: trial.rsvp_target,
        rsvp_n_targets: nTargets,
      };

      // Remove the body-attached canvas (and debug overlay) so it doesn't sit
      // on top of the response prompts, which live in display_element.
      const removeCanvas = () => {
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (debugEl && debugEl.parentNode) debugEl.parentNode.removeChild(debugEl);
      };

      const endMotion = () => {
        if (rafId) cancelAnimationFrame(rafId);
        removeCanvas();
        const meanFrame =
          frameIntervals.length > 0
            ? frameIntervals.reduce((a, b) => a + b, 0) / frameIntervals.length
            : null;
        trialData.mean_frame_ms = meanFrame;
        trialData.n_frames = frameIntervals.length;
        askMotion();
      };

      // -- motion direction 2AFC --
      // Rotation & spiral share a rotational-sense response: LEFT arrow =
      // counter-clockwise, RIGHT arrow = clockwise. Translation keeps
      // LEFT = left, RIGHT = right.
      const isRot = motionType === "rotation" || motionType === "spiral";
      // Radial keeps the SAME two keys as every other motion type so that motor
      // demands are identical across runs and cannot confound the cross-type
      // threshold contrast. Neither arrow is spatially congruent with a radial
      // sign, so the glyphs carry the mapping: inward-pointing arrows for
      // contracting, outward-pointing for expanding.
      const isRadial = motionType === "radial";
      const askMotion = () => {
        const question = isRadial
          ? "Was the pattern expanding or contracting?"
          : isRot
          ? "Which way were the dots rotating overall?"
          : "Which way were the dots moving overall?";
        const glyphs = isRadial
          ? "&rarr;&larr; &nbsp; &larr;&nbsp;&rarr;"
          : isRot
          ? "&#x21ba; &nbsp; &#x21bb;"
          : "&larr; &nbsp; &rarr;";
        const legend = isRadial
          ? "Left arrow = contracting (inward) &nbsp;&nbsp; Right arrow = expanding (outward)"
          : isRot
          ? "Left arrow = counter-clockwise &nbsp;&nbsp; Right arrow = clockwise"
          : "Left arrow = left &nbsp;&nbsp; Right arrow = right";
        display_element.innerHTML =
          '<div style="color:#fff;font-family:sans-serif;text-align:center;' +
          'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);">' +
          '<p style="font-size:1.4em;">' + question + "</p>" +
          '<p style="font-size:2.2em;letter-spacing:0.5em;">' + glyphs + "</p>" +
          '<p style="opacity:0.7;">' + legend + "</p>" +
          "</div>";
        jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: afterMotion,
          valid_responses: trial.motion_choices,
          rt_method: "performance",
          persist: false,
          allow_held_key: false,
        });
      };

      const afterMotion = (info2) => {
        const resp = info2.key;
        const isLeft = resp.toLowerCase() === "arrowleft";
        // map the key to the judged axis for this motion type.
        // Rotational sense: LEFT arrow = counter-clockwise, RIGHT arrow =
        // clockwise (the arrow points the way the top of the pattern moves).
        const respDir = isRadial
          ? isLeft ? "contract" : "expand"
          : isRot
          ? isLeft ? "ccw" : "cw"
          : isLeft ? "left" : "right";
        trialData.motion_response = respDir;
        trialData.motion_correct = respDir === trial.direction;
        trialData.motion_rt = info2.rt;
        askLoad();
      };

      // -- secondary load response --
      const askLoad = () => {
        let prompt, valid;
        if (trial.load_condition === "low") {
          prompt =
            "Did the letter <b>" +
            trial.rsvp_target +
            "</b> appear in the stream?<br>" +
            '<span style="font-size:0.8em;opacity:0.8;">Y = yes &nbsp;&nbsp; N = no</span>';
          valid = ["y", "n"];
        } else {
          var maxT = trial.rsvp_max_targets;
          valid = [];
          for (var t = 0; t <= maxT; t++) valid.push(String(t));
          // "0, 1, or 2"  /  "0, 1, 2, or 3"  — grammatical for any max
          var keyList =
            maxT === 1
              ? "0 or 1"
              : valid.slice(0, -1).join(", ") + ", or " + valid[valid.length - 1];
          prompt =
            "How many <b>" +
            trial.rsvp_target +
            "</b>s appeared?<br>" +
            '<span style="font-size:0.8em;opacity:0.8;">Press ' + keyList + "</span>";
        }
        display_element.innerHTML =
          '<div style="color:#fff;font-family:sans-serif;text-align:center;' +
          'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:1.4em;">' +
          "<p>" +
          prompt +
          "</p></div>";
        jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: afterLoad,
          valid_responses: valid,
          rt_method: "performance",
          persist: false,
          allow_held_key: false,
        });
      };

      const afterLoad = (info2) => {
        let respVal, correct;
        if (trial.load_condition === "low") {
          const saidYes = info2.key.toLowerCase() === "y";
          respVal = saidYes ? 1 : 0;
          correct = saidYes === nTargets >= 1;
        } else {
          respVal = parseInt(info2.key, 10);
          correct = respVal === nTargets;
        }
        trialData.load_response = respVal;
        trialData.load_correct = correct;
        trialData.load_rt = info2.rt;

        if (trial.feedback) {
          showFeedback();
        } else {
          finish();
        }
      };

      const showFeedback = () => {
        const mc = trialData.motion_correct;
        const msg = mc
          ? '<span style="color:#4cd964;">Motion: correct</span>'
          : '<span style="color:#ff3b30;">Motion: incorrect</span>';
        const lc = trialData.load_correct
          ? '<span style="color:#4cd964;">Letter task: correct</span>'
          : '<span style="color:#ff3b30;">Letter task: incorrect</span>';
        display_element.innerHTML =
          '<div style="color:#fff;font-family:sans-serif;text-align:center;' +
          'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:1.4em;">' +
          "<p>" +
          msg +
          "</p><p>" +
          lc +
          "</p></div>";
        jsPsych.pluginAPI.setTimeout(finish, trial.feedback_ms);
      };

      const finish = () => {
        window.removeEventListener("resize", resize);
        document.removeEventListener("fullscreenchange", resize);
        document.removeEventListener("webkitfullscreenchange", resize);
        removeCanvas(); // defensive: normally already removed at endMotion
        display_element.innerHTML = "";
        jsPsych.finishTrial(trialData);
      };

      // kick off
      // Re-measure the canvas whenever the viewport changes size — which
      // happens on a plain window resize AND when the browser enters/exits
      // fullscreen or the window is dragged to a display with a different
      // resolution. Without this, a canvas sized before the fullscreen
      // transition (or before a move to the secondary display) keeps a stale
      // buffer and the stimulus can be off-screen or zero-sized (blank).
      window.addEventListener("resize", resize);
      document.addEventListener("fullscreenchange", resize);
      document.addEventListener("webkitfullscreenchange", resize);

      // Defer the first frame until the browser has laid out the (possibly
      // just-entered) fullscreen viewport. A double requestAnimationFrame
      // guarantees one full layout/paint cycle has completed, so `resize()`
      // reads the final viewport rather than racing the transition.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          resize();
          if (maybeDebugOverlay) maybeDebugOverlay();
          rafId = requestAnimationFrame(step);
        });
      });
    }
  }

  RdkLoadPlugin.info = info;
  return RdkLoadPlugin;
})(jsPsychModule);
