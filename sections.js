/**
 * sections.js — front-matter and back-matter timeline nodes for the online RDK
 * study: preload, browser check, fullscreen, consent, virtual-chinrest
 * calibration, general instructions, comprehension checks, practice framing,
 * breaks, debrief, DataPipe save, and Prolific completion redirect.
 *
 * Provides a global `SECTIONS` object consumed by experiment.js. Loaded AFTER
 * config.js / helpers.js / experiment.js define jsPsych, CONFIG, RdkHelpers,
 * and ExpBuild (experiment.js pushes SECTIONS.* into the timeline, so this file
 * must be loaded before jsPsych.run — see index.html ordering).
 *
 * NOTE ON LOAD ORDER: experiment.js references SECTIONS at assembly time, so in
 * index.html sections.js is loaded BEFORE experiment.js. experiment.js reads
 * `jsPsych`, `CONFIG`, `RdkHelpers` (globals) and calls ExpBuild.setPxPerDegree;
 * those globals exist as long as config/helpers/plugins precede both files.
 */

window.SECTIONS = (function () {
  const jsPsych = window.__JSPSYCH__; // set by experiment.js init

  /* ---------------- motion-type vocabulary (per run) ----------------
   * The instruction / quiz / debrief wording must match the motion type of
   * this run (translation / rotation / spiral / radial), which is fixed at page
   * load in experiment.js. Everything task-facing pulls from this one object
   * so no screen can drift from the actual stimulus + response mapping.
   */
  const MT = (window.ExpBuild && window.ExpBuild.MOTION_TYPE) || "translation";
  const isRot = MT === "rotation" || MT === "spiral";
  const isRad = MT === "radial";
  const pick = (rad, rot, tra) => (isRad ? rad : isRot ? rot : tra);
  const V = {
    // short verb for the coherent motion
    verb: pick("move outward or inward together", "rotate together", "drift together"),
    // the two response alternatives, human-readable
    alts: pick(
      "<b>outward</b> (expanding) or <b>inward</b> (contracting)",
      "<b>counter-clockwise</b> or <b>clockwise</b>",
      "<b>left</b> or <b>right</b>"
    ),
    // arrow glyphs shown for the response keys (LEFT glyph then RIGHT glyph)
    glyphs: pick("\u2192\u2190 / \u2190\u2009\u2192", "\u21ba / \u21bb", "\u2190 / \u2192"),
    // key legend: LEFT arrow first, RIGHT arrow second
    keyLegend: pick(
      "press <b>\u2190</b> (contracting / inward) or <b>\u2192</b> (expanding / outward)",
      "press <b>\u2190</b> (counter-clockwise) or <b>\u2192</b> (clockwise)",
      "press <b>\u2190</b> or <b>\u2192</b>"
    ),
    // noun for what is judged
    judged: pick("expansion/contraction", "rotation direction", "left/right direction"),
    // past-tense phrase for debrief/load-intro ("which way the dots ...")
    moved: pick(
      "whether the pattern expanded or contracted",
      "which way the dots were rotating",
      "which way the dots moved"
    ),
    // quiz correct-answer label
    quizJudged: pick(
      "Whether the pattern was expanding or contracting overall",
      "Their overall clockwise/counter-clockwise rotation",
      "Their overall left/right direction"
    ),
  };
  // The letter-task sentence depends on whether this run manipulates load.
  // A single-load run must not promise that the question "changes between
  // blocks" -- it does not.
  const _singleLoad =
    (window.ExpBuild && window.ExpBuild.SINGLE_LOAD) !== false;
  const _loadCond =
    (window.ExpBuild && window.ExpBuild.LOAD_CONDITIONS &&
      window.ExpBuild.LOAD_CONDITIONS[0]) || "low";
  const LOAD_Q = !_singleLoad
    ? "a question about the letters that flashed on the cross " +
      "(this changes between blocks \u2014 we'll tell you which version each time)"
    : _loadCond === "low"
    ? "whether the letter <b>X</b> appeared in the stream at all (<b>Y</b> / <b>N</b>)"
    : "<b>how many</b> <b>X</b>s appeared in the stream";

  // spiral gets an extra note that the pattern also expands/contracts but only
  // the rotational sense is judged.
  const spiralNote =
    MT === "spiral"
      ? "<p style='opacity:0.85;'>The pattern also gently expands or contracts, " +
        "but you only need to judge whether it is turning <b>counter-clockwise</b> " +
        "or <b>clockwise</b>.</p>"
      : "";

  /* --------------------------- preload --------------------------- */
  const preload = {
    type: jsPsychPreload,
    auto_preload: true,
  };

  /* ------------------------ browser check ------------------------ */
  // Require a desktop browser + a minimum window size; reject phones/tablets.
  const browserCheck = {
    type: jsPsychBrowserCheck,
    inclusion_function: (data) => {
      return !data.mobile && data.width >= 900 && data.height >= 600;
    },
    exclusion_message: (data) => {
      if (data.mobile) {
        return "<p>This study must be done on a <b>desktop or laptop</b> computer, " +
          "not a phone or tablet. Please return the study on Prolific.</p>";
      }
      return "<p>Your browser window is too small. Please maximise the window " +
        "(minimum 900\u00d7600) and reload, or return the study on Prolific.</p>";
    },
  };

  /* ---------------------- welcome + fullscreen ------------------- */
  const welcomeFullscreen = {
    type: jsPsychFullscreen,
    fullscreen_mode: true,
    message:
      "<div style='max-width:640px;margin:auto;'>" +
      "<h2>Welcome</h2>" +
      "<p>This study takes about <b>20 minutes</b>. It works best in a quiet room " +
      "with steady lighting. Please stay in fullscreen for the whole study.</p>" +
      "<p>Click below to enter fullscreen and begin.</p></div>",
    button_label: "Enter fullscreen & begin",
  };

  /* ---------------------------- consent -------------------------- */
  const consentText =
    "<div style='max-width:680px;margin:auto;text-align:left;line-height:1.5;'>" +
    "<h2>Information & consent</h2>" +
    "<p><b>What is this?</b> A study of how paying attention to a letter task affects " +
    "your ability to see the " + V.judged + " of moving dots. You will watch patches of " +
    "moving dots and, on each trial, judge their overall " + V.judged + " and answer a " +
    "question about a stream of letters.</p>" +
    "<p><b>Duration & pay.</b> About 20 minutes. You will be paid the fixed amount stated " +
    "on Prolific, provided you complete the study.</p>" +
    "<p><b>Risks.</b> There are no known risks beyond mild eye tiredness or boredom. The " +
    "display flickers rapidly; if you are photosensitive or prone to migraines you may " +
    "prefer not to take part.</p>" +
    "<p><b>Data.</b> We record only your task responses and reaction times, your Prolific " +
    "ID (to arrange payment), and basic display information. Data are stored anonymously " +
    "on the Open Science Framework and may be shared openly for research. You can withdraw " +
    "at any time by closing the window; incomplete data will not be analysed.</p>" +
    "<p><b>Contact.</b> Questions: contact the researcher via Prolific.</p>" +
    "<p>By ticking the box and continuing you confirm that you are 18+, have read the " +
    "above, and consent to take part.</p></div>";

  const consent = {
    type: jsPsychSurveyHtmlForm,
    preamble: consentText,
    html:
      "<p><label><input type='checkbox' name='agree' required> " +
      "I am 18 or older and I consent to take part.</label></p>",
    button_label: "Continue",
    data: { trial_kind: "consent" },
  };

  /* =====================================================================
   * INTAKE: participant ID (standalone), eligibility (DOB), demographics
   * =====================================================================
   * Shown after consent, before calibration/practice, so an ineligible or
   * photosensitive participant is screened out before any flickering stimulus.
   */

  // ---- (standalone only) optional researcher-supplied participant code ----
  // In Prolific mode the subject_id IS the Prolific PID and this node is skipped
  // by run.js. In standalone mode an anonymous ID is auto-assigned; this lets an
  // in-lab researcher optionally record their own code/label. It NEVER changes
  // the RNG seed (that is fixed at page load from the auto ID).
  const participantIdEntry = {
    type: jsPsychSurveyHtmlForm,
    preamble:
      "<div style='max-width:600px;margin:auto;text-align:left;'>" +
      "<h3>Participant ID</h3>" +
      "<p>An anonymous ID has been assigned automatically. If a researcher gave " +
      "you a participant code, enter it below (optional). Otherwise just continue.</p></div>",
    html:
      "<p><label>Participant code (optional): " +
      "<input type='text' name='code' maxlength='40' " +
      "style='width:220px;' autocomplete='off'></label></p>",
    button_label: "Continue",
    data: { trial_kind: "id_entry" },
    on_finish: function (data) {
      const code = (data.response && data.response.code || "").trim();
      if (code.length > 0) {
        jsPsych.data.addProperties({ participant_code: code });
      }
    },
  };

  // ---- eligibility: date of birth -> age; must be >= MIN_AGE_YEARS ----
  function computeAgeYears(dobStr) {
    // dobStr is "YYYY-MM-DD" from <input type="date">
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobStr || "");
    if (!parts) return null;
    const y = +parts[1], m = +parts[2], d = +parts[3];
    const today = new Date();
    let age = today.getFullYear() - y;
    // subtract a year if this year's birthday hasn't happened yet
    const hadBirthday =
      today.getMonth() + 1 > m ||
      (today.getMonth() + 1 === m && today.getDate() >= d);
    if (!hadBirthday) age -= 1;
    return age;
  }

  const eligibility = {
    type: jsPsychSurveyHtmlForm,
    preamble:
      "<div style='max-width:600px;margin:auto;text-align:left;'>" +
      "<h3>Before we begin</h3>" +
      "<p>You must be <b>" + CONFIG.MIN_AGE_YEARS + " years or older</b> to take part. " +
      "Please enter your date of birth to confirm your eligibility.</p></div>",
    html:
      "<p><label>Date of birth: " +
      "<input type='date' name='dob' required min='1900-01-01'></label></p>",
    button_label: "Continue",
    data: { trial_kind: "eligibility" },
    on_finish: function (data) {
      const dob = data.response && data.response.dob;
      const age = computeAgeYears(dob);
      const eligible = age !== null && age >= CONFIG.MIN_AGE_YEARS;
      window.__ELIGIBLE__ = eligible;
      const props = { age_years: age, eligible: eligible };
      if (CONFIG.STORE_DOB) props.dob = dob; // identifiable — off by default
      jsPsych.data.addProperties(props);
    },
  };

  // Ends the study politely if under age. run.js places this right after
  // `eligibility`; the conditional only fires for ineligible participants.
  const eligibilityGate = {
    timeline: [
      {
        type: jsPsychHtmlKeyboardResponse,
        stimulus:
          "<div style='max-width:600px;margin:auto;'>" +
          "<h2>Thank you for your interest</h2>" +
          "<p>Unfortunately you do not meet the eligibility requirement " +
          "(" + CONFIG.MIN_AGE_YEARS + "+ years) for this study. You may now close " +
          "this window.</p>" +
          "<p>If you were recruited via Prolific, please <b>return</b> the study.</p></div>",
        choices: "NO_KEYS",
        trial_duration: 100,
        on_start: function () {
          jsPsych.endExperiment(
            "<div style='max-width:600px;margin:auto;'><h2>Thank you</h2>" +
            "<p>You are not eligible for this study. You may close the window" +
            (ExpBuild.isProlific ? " and return the study on Prolific." : ".") +
            "</p></div>"
          );
        },
        data: { trial_kind: "ineligible" },
      },
    ],
    conditional_function: function () {
      return window.__ELIGIBLE__ === false;
    },
  };

  // ---- short demographics / health / vision questionnaire ----
  const demographics = {
    type: jsPsychSurveyHtmlForm,
    preamble:
      "<div style='max-width:640px;margin:auto;text-align:left;'>" +
      "<h3>A few quick questions</h3>" +
      "<p>These help us describe who took part and check that the display suits " +
      "you. Answer honestly; you can decline any item marked optional. Your " +
      "answers are stored anonymously.</p></div>",
    html:
      "<div style='max-width:640px;margin:auto;text-align:left;line-height:1.7;'>" +

      // sex assigned at birth (required)
      "<p><b>1. Sex assigned at birth</b><br>" +
      "<label><input type='radio' name='sex' value='female' required> Female</label> &nbsp; " +
      "<label><input type='radio' name='sex' value='male'> Male</label> &nbsp; " +
      "<label><input type='radio' name='sex' value='intersex'> Intersex</label> &nbsp; " +
      "<label><input type='radio' name='sex' value='no_say'> Prefer not to say</label></p>" +

      // gender identity (optional)
      "<p><b>2. Gender identity</b> (optional)<br>" +
      "<input type='text' name='gender' maxlength='40' style='width:240px;' autocomplete='off'></p>" +

      // handedness (required)
      "<p><b>3. Which hand do you write with?</b><br>" +
      "<label><input type='radio' name='handedness' value='right' required> Right</label> &nbsp; " +
      "<label><input type='radio' name='handedness' value='left'> Left</label> &nbsp; " +
      "<label><input type='radio' name='handedness' value='both'> Both</label></p>" +

      // vision correction (required)
      "<p><b>4. Do you normally wear glasses or contact lenses?</b><br>" +
      "<label><input type='radio' name='vision_correction' value='none' required> No, my vision is uncorrected</label><br>" +
      "<label><input type='radio' name='vision_correction' value='glasses'> Yes, glasses</label><br>" +
      "<label><input type='radio' name='vision_correction' value='contacts'> Yes, contact lenses</label></p>" +

      // wearing correction now (required)
      "<p><b>5. Are you wearing your usual correction right now?</b><br>" +
      "<label><input type='radio' name='wearing_correction_now' value='yes' required> Yes</label> &nbsp; " +
      "<label><input type='radio' name='wearing_correction_now' value='no'> No</label> &nbsp; " +
      "<label><input type='radio' name='wearing_correction_now' value='na'> Not applicable</label></p>" +

      // self-reported vision quality (required)
      "<p><b>6. With correction (if any), how would you rate your eyesight?</b><br>" +
      "<label><input type='radio' name='vision_quality' value='normal' required> Normal / clear</label> &nbsp; " +
      "<label><input type='radio' name='vision_quality' value='mild'> Mildly impaired</label> &nbsp; " +
      "<label><input type='radio' name='vision_quality' value='impaired'> Noticeably impaired</label></p>" +

      // colour vision (required, quick)
      "<p><b>7. Do you have any known colour-vision deficiency (colour blindness)?</b><br>" +
      "<label><input type='radio' name='color_vision' value='no' required> No</label> &nbsp; " +
      "<label><input type='radio' name='color_vision' value='yes'> Yes</label> &nbsp; " +
      "<label><input type='radio' name='color_vision' value='unsure'> Unsure</label></p>" +

      // general health today (required)
      "<p><b>8. How is your general health today?</b><br>" +
      "<label><input type='radio' name='health' value='excellent' required> Excellent</label> &nbsp; " +
      "<label><input type='radio' name='health' value='good'> Good</label> &nbsp; " +
      "<label><input type='radio' name='health' value='fair'> Fair</label> &nbsp; " +
      "<label><input type='radio' name='health' value='poor'> Poor</label></p>" +

      // alertness (required, quick)
      "<p><b>9. How alert do you feel right now?</b><br>" +
      "<label><input type='radio' name='alertness' value='alert' required> Wide awake</label> &nbsp; " +
      "<label><input type='radio' name='alertness' value='ok'> Fairly alert</label> &nbsp; " +
      "<label><input type='radio' name='alertness' value='tired'> Tired / sluggish</label></p>" +

      // neurological / attention conditions (optional)
      "<p><b>10. Do you have any condition affecting vision or attention?</b> (optional, e.g. ADHD, " +
      "amblyopia, strabismus) <br>" +
      "<input type='text' name='conditions' maxlength='120' style='width:100%;' autocomplete='off'></p>" +

      // SAFETY: photosensitivity (required)
      "<p style='background:#fff6f6;border:1px solid #f0c0c0;padding:8px;border-radius:6px;'>" +
      "<b>11. Safety check.</b> This study shows <b>rapidly flickering</b> dots and letters. " +
      "Do you have photosensitive epilepsy, or a history of seizures triggered by flashing visuals?<br>" +
      "<label><input type='radio' name='photosensitive' value='no' required> No</label> &nbsp; " +
      "<label><input type='radio' name='photosensitive' value='yes'> Yes</label> &nbsp; " +
      "<label><input type='radio' name='photosensitive' value='unsure'> Unsure</label></p>" +
      "</div>",
    button_label: "Continue",
    data: { trial_kind: "demographics" },
    on_finish: function (data) {
      const r = data.response || {};
      // store each field at the dataset level so every row carries it
      jsPsych.data.addProperties({
        demo_sex: r.sex || null,
        demo_gender: (r.gender || "").trim() || null,
        demo_handedness: r.handedness || null,
        demo_vision_correction: r.vision_correction || null,
        demo_wearing_correction_now: r.wearing_correction_now || null,
        demo_vision_quality: r.vision_quality || null,
        demo_color_vision: r.color_vision || null,
        demo_health: r.health || null,
        demo_alertness: r.alertness || null,
        demo_conditions: (r.conditions || "").trim() || null,
        demo_photosensitive: r.photosensitive || null,
      });
      // flag for the safety gate
      window.__PHOTOSENSITIVE_EXCLUDE__ =
        CONFIG.EXCLUDE_PHOTOSENSITIVE && r.photosensitive === "yes";
    },
  };

  // Ends the study before any flicker if the participant reports photosensitive
  // epilepsy (and EXCLUDE_PHOTOSENSITIVE is on).
  const safetyGate = {
    timeline: [
      {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: "",
        choices: "NO_KEYS",
        trial_duration: 100,
        on_start: function () {
          jsPsych.endExperiment(
            "<div style='max-width:600px;margin:auto;'><h2>Thank you</h2>" +
            "<p>For your safety we will not continue, because this study contains " +
            "rapidly flickering visuals. You may close the window" +
            (ExpBuild.isProlific ? " and return the study on Prolific." : ".") +
            "</p></div>"
          );
        },
        data: { trial_kind: "photosensitive_excluded" },
      },
    ],
    conditional_function: function () {
      return window.__PHOTOSENSITIVE_EXCLUDE__ === true;
    },
  };

  /* ------------------ virtual-chinrest calibration --------------- */
  // Standardizes stimulus size across monitors: the participant matches an
  // on-screen card to a real credit card (px/cm), then a blind-spot task fixes
  // viewing distance, giving px-per-degree. We convert and store it.
  const calibration = {
    type: jsPsychVirtualChinrest,
    blindspot_reps: 3,
    resize_units: "deg",
    pixels_per_unit: 40, // placeholder; plugin computes the true value
    // The plugin's default prompt says "black square", but this study runs on a
    // black page, so the fixation target is recoloured to WHITE (see the
    // #virtual-chinrest-square rule in index.html). Keep the wording consistent.
    blindspot_prompt:
      "<p>Now we will quickly measure how far away you are sitting.</p>" +
      "<div style='text-align:left;'><ol>" +
      "<li>Put your left hand on the <b>space bar</b>.</li>" +
      "<li>Cover your right eye with your right hand.</li>" +
      "<li>Using your left eye, focus on the <b>white square</b>. Keep your focus on the white square.</li>" +
      "<li>The <span style='color:red;font-weight:bold;'>red ball</span> will disappear as it moves " +
      "from right to left. Press the space bar as soon as the ball disappears.</li>" +
      "</ol></div>" +
      "<p>Press the space bar when you are ready to begin.</p>",
    on_finish: function (data) {
      // The plugin stores px2deg (pixels per degree) in data.
      const ppd =
        data.px2deg && isFinite(data.px2deg)
          ? data.px2deg
          : CONFIG.FALLBACK_PX_PER_DEGREE;
      ExpBuild.setPxPerDegree(ppd);
      jsPsych.data.addProperties({
        px_per_degree: ppd,
        view_dist_mm: data.view_dist_mm || null,   // blindspot viewing distance
        win_width_deg: data.win_width_deg || null, // window width in degrees
        item_width_mm: data.item_width_mm || null, // card resize result
      });
    },
    data: { trial_kind: "calibration" },
  };

  /* ---------------------- general instructions ------------------- */
  const generalInstructions = {
    type: jsPsychInstructions,
    show_clickable_nav: true,
    pages: [
      "<div style='max-width:640px;margin:auto;text-align:left;'>" +
        "<h2>What you'll do</h2>" +
        "<p>On each trial you'll see a ring of flickering white dots around a central " +
        "red cross. Most dots move randomly, but a fraction " + V.verb + " either " +
        V.alts + ". Your job is to judge that overall " + V.judged + ".</p>" +
        spiralNote +
        "<p><b>Always keep your eyes on the central cross</b> \u2014 don't chase the dots.</p></div>",
      "<div style='max-width:640px;margin:auto;text-align:left;'>" +
        "<h2>The two questions</h2>" +
        "<p>After the dots stop, you'll answer:</p>" +
        "<ol><li><b>Direction:</b> " + V.keyLegend + " for the overall " + V.judged + ".</li>" +
        "<li><b>Letters:</b> " + LOAD_Q + "</li></ol>" +
        "<p>Answer as accurately as you can. Speed matters less than accuracy.</p></div>",
      "<div style='max-width:640px;margin:auto;text-align:left;'>" +
        "<h2>Sometimes it's hard</h2>" +
        "<p>On many trials the common motion is <b>very weak</b> and you'll have to guess " +
        "\u2014 that's expected and fine. Just give your best judgement every time.</p>" +
        "<p>Next: a couple of quick checks, then practice.</p></div>",
    ],
    data: { trial_kind: "instructions" },
  };

  /* --------------------- comprehension checks -------------------- */
  // A short quiz; if wrong, re-show instructions and re-test (loop).
  const quiz = {
    type: jsPsychSurveyHtmlForm,
    preamble:
      "<div style='max-width:600px;margin:auto;text-align:left;'><h3>Quick check</h3></div>",
    html:
      "<div style='max-width:600px;margin:auto;text-align:left;'>" +
      "<p>1. Where should your eyes stay?<br>" +
      "<label><input type='radio' name='q1' value='cross' required> On the central cross</label><br>" +
      "<label><input type='radio' name='q1' value='dots'> Following the dots</label></p>" +
      "<p>2. What are you judging about the dots?<br>" +
      "<label><input type='radio' name='q2' value='dir' required> " + V.quizJudged + "</label><br>" +
      "<label><input type='radio' name='q2' value='color'> Their colour</label></p>" +
      "<p>3. If the common motion looks very weak, you should\u2026<br>" +
      "<label><input type='radio' name='q3' value='guess' required> Give your best guess anyway</label><br>" +
      "<label><input type='radio' name='q3' value='skip'> Skip the trial</label></p></div>",
    button_label: "Submit",
    data: { trial_kind: "comprehension" },
  };

  const quizFeedback = {
    type: jsPsychHtmlButtonResponse,
    stimulus: function () {
      const r = jsPsych.data.get().filter({ trial_kind: "comprehension" }).last(1).values()[0].response;
      const ok = r.q1 === "cross" && r.q2 === "dir" && r.q3 === "guess";
      return ok
        ? "<p>Great \u2014 you've got it. On to practice.</p>"
        : "<p>Not quite. Let's review the instructions once more.</p>";
    },
    choices: ["Continue"],
    data: { trial_kind: "comprehension_feedback" },
  };

  // loop: instructions -> quiz -> feedback, repeat until all correct
  const comprehensionLoop = {
    timeline: [generalInstructions, quiz, quizFeedback],
    loop_function: function (data) {
      const r = jsPsych.data.get().filter({ trial_kind: "comprehension" }).last(1).values()[0].response;
      const ok = r.q1 === "cross" && r.q2 === "dir" && r.q3 === "guess";
      return !ok; // loop again if not all correct
    },
  };

  /* --------------------------- practice -------------------------- */
  const practiceIntro = {
    type: jsPsychHtmlButtonResponse,
    stimulus:
      "<div style='max-width:600px;margin:auto;'><h2>Practice</h2>" +
      "<p>A few practice trials now, <b>with feedback</b> after each. The real study " +
      "gives no feedback.</p></div>",
    choices: ["Start practice"],
    data: { trial_kind: "practice_intro" },
  };
  const practiceEnd = {
    type: jsPsychHtmlButtonResponse,
    stimulus:
      "<div style='max-width:600px;margin:auto;'><h2>End of practice</h2>" +
      "<p>The main study begins now. There are two blocks with a short break in each. " +
      "No more feedback from here on \u2014 just do your best.</p></div>",
    choices: ["Begin the study"],
    data: { trial_kind: "practice_end" },
  };

  /* ---------------------------- break ---------------------------- */
  function breakScreen(done, total) {
    return {
      type: jsPsychHtmlKeyboardResponse,
      stimulus:
        "<div style='max-width:600px;margin:auto;'><h2>Short break</h2>" +
        "<p>You've done " + done + " of " + total + " trials in this block. " +
        "Rest your eyes for a moment.</p>" +
        "<p>Press <b>space</b> when you're ready to continue.</p></div>",
      choices: [" "],
      data: { trial_kind: "break" },
    };
  }

  /* --------------------------- debrief --------------------------- */
  const debrief = {
    type: jsPsychHtmlButtonResponse,
    stimulus: function () {
      const tests = jsPsych.data.get().filter({ task: "test", trial_kind: "rdk" });
      const n = tests.count();
      const motionAcc = n ? Math.round(100 * tests.select("motion_correct").mean()) : 0;
      return (
        "<div style='max-width:600px;margin:auto;'><h2>All done \u2014 thank you!</h2>" +
        "<p>You completed " + n + " trials and got the dot direction right on about <b>" +
        motionAcc + "%</b> of them.</p>" +
        "<p><b>What we're studying:</b> whether doing a demanding letter-counting task at " +
        "the same time reduces how well you can see weak coherent motion. Comparing your " +
        "accuracy in the easy vs. hard letter blocks lets us measure that.</p>" +
        "<p>Click below to save your data. <b>Please don't close the window</b> until you " +
        "see the final confirmation.</p></div>"
      );
    },
    choices: ["Save my data & finish"],
    data: { trial_kind: "debrief" },
  };

  /* ------------------------ save (DataPipe) ---------------------- */
  const saveData = {
    type: jsPsychPipe,
    action: "save",
    experiment_id: CONFIG.DATAPIPE_EXPERIMENT_ID,
    filename: function () {
      return ExpBuild.ids.subject_id + "_" + Date.now() + ".csv";
    },
    data_string: function () {
      return jsPsych.data.get().csv();
    },
    // Only actually contact DataPipe if configured & enabled.
    on_start: function () {
      if (!CONFIG.SAVE_TO_DATAPIPE ||
          CONFIG.DATAPIPE_EXPERIMENT_ID === "REPLACE_WITH_DATAPIPE_ID") {
        // skip network call by short-circuiting: handled in index via conditional
      }
    },
    data: { trial_kind: "save" },
  };

  // Conditional wrapper: only run the DataPipe node when configured; otherwise
  // (local testing) trigger a CSV download so no data is lost.
  const saveDataConditional = {
    timeline: [saveData],
    conditional_function: function () {
      return CONFIG.SAVE_TO_DATAPIPE &&
        CONFIG.DATAPIPE_EXPERIMENT_ID !== "REPLACE_WITH_DATAPIPE_ID";
    },
  };
  const localDownload = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: "<p>Saving your data\u2026</p>",
    choices: "NO_KEYS",
    trial_duration: 50,
    on_start: function () {
      if (CONFIG.LOCAL_DOWNLOAD_FALLBACK &&
          (!CONFIG.SAVE_TO_DATAPIPE ||
           CONFIG.DATAPIPE_EXPERIMENT_ID === "REPLACE_WITH_DATAPIPE_ID")) {
        jsPsych.data.get().localSave("csv",
          ExpBuild.ids.subject_id + "_" + Date.now() + ".csv");
      }
    },
    data: { trial_kind: "local_save" },
  };
  const saveBundle = { timeline: [saveDataConditional, localDownload] };

  /* --------------------- completion --------------------- */
  // On Prolific: offer a button that redirects to the completion URL to register
  // payment. In standalone mode: just confirm the data is saved (no redirect).
  const completion = {
    type: jsPsychHtmlButtonResponse,
    stimulus: function () {
      return ExpBuild.isProlific
        ? "<div style='max-width:600px;margin:auto;'><h2>Data saved \u2014 thank you!</h2>" +
          "<p>Click below to return to Prolific and register your completion.</p></div>"
        : "<div style='max-width:600px;margin:auto;'><h2>Data saved \u2014 thank you!</h2>" +
          "<p>Your responses have been recorded. You may now close this window.</p></div>";
    },
    choices: function () {
      return ExpBuild.isProlific ? ["Return to Prolific"] : ["Finish"];
    },
    on_finish: function () {
      if (ExpBuild.isProlific &&
          CONFIG.PROLIFIC_COMPLETION_URL &&
          CONFIG.PROLIFIC_COMPLETION_URL.indexOf("REPLACE_WITH_CODE") === -1) {
        window.location = CONFIG.PROLIFIC_COMPLETION_URL;
      }
    },
    data: { trial_kind: "completion" },
  };

  return {
    preload,
    browserCheck,
    welcomeFullscreen,
    consent,
    participantIdEntry,
    eligibility,
    eligibilityGate,
    demographics,
    safetyGate,
    calibration,
    generalInstructions,
    comprehension: [comprehensionLoop],
    practiceIntro,
    practiceEnd,
    breakScreen,
    debrief,
    saveData: saveBundle,
    completion,
  };
})();
