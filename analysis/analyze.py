#!/usr/bin/env python3
"""
analyze.py — analysis scaffold for the online RDK + attentional-load study.

Pipeline:
  1. Load per-participant CSVs (as exported by jsPsych/DataPipe) from a folder.
  2. Apply preregistered quality-control exclusions.
  3. Fit a Weibull psychometric function (P correct vs. coherence) per
     participant × load condition; extract the 75%-correct coherence threshold.
  4. Group-level test of the load effect on threshold (paired) and on the
     secondary letter-task performance (manipulation check).
  5. Write a tidy trial table, a per-subject threshold table, and two figures.

Usage:
    python analyze.py --data_dir ../data --out_dir ./out

The script is deliberately defensive about column names: jsPsych's CSV columns
depend on the plugin `data` fields. It expects (from plugin-rdk-load.js /
experiment.js) at least:
    subject_id, task, trial_kind, load_condition, coherence, direction,
    motion_response, motion_correct, rt_motion,
    load_response, load_correct, rsvp_n_targets
Adjust COLS below if you rename fields.

Dependencies: numpy, pandas, scipy, matplotlib.
"""
from __future__ import annotations
import argparse
import glob
import os
import sys
import warnings

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ----------------------------------------------------------------------------
# configuration: column names + QC thresholds (edit to match your data schema)
# ----------------------------------------------------------------------------
COLS = dict(
    subject="subject_id",
    task="task",                 # "practice" | "test"
    kind="trial_kind",           # we keep trial_kind == "rdk"
    load="load_condition",       # "low" | "high"
    coherence="coherence",       # 0..1
    direction="direction",       # "left" | "right"
    motion_resp="motion_response",
    motion_correct="motion_correct",
    rt_motion="motion_rt",       # plugin field name
    load_correct="load_correct",
    load_rt="load_rt",
    n_targets="rsvp_n_targets",
    motion_type="motion_type",   # "translation" | "rotation" | "spiral" | "radial"
    # display-provenance fields (logged by the virtual-chinrest calibration)
    px2mm="px2mm",               # physical pixel size (px per mm) — display-specific
    view_dist_mm="view_dist_mm", # blindspot viewing distance
    screen_w="width",            # window width (px)
    screen_h="height",           # window height (px)
    refresh="vsync_rate",        # measured refresh (Hz)
    osname="os",
    browser="browser",
)

COHERENCE_LEVELS = np.array([0.04, 0.08, 0.16, 0.32, 0.64])
GUESS = 0.5          # 2-AFC lower asymptote
LAPSE = 0.02         # fixed upper-asymptote lapse
THRESHOLD_P = 0.75   # target performance level for the threshold

# Motion types, in canonical order. Runs are collected separately (one URL
# parameter per run) but may arrive as several CSVs per participant.
MOTION_TYPES = ["translation", "rotation", "spiral", "radial"]

# Standing load-engagement gate (mirrors weibull_analysis.py). A run whose
# secondary-task performance ABOVE ITS OWN CHANCE does not drop by at least this
# much from low to high load did not create a differential attentional demand;
# its high-vs-low threshold contrast is therefore NOT a valid load effect and is
# dropped from the paired load test (the run's overall threshold still counts
# toward the motion-type main effect).
ENGAGE_MIN_DROP = 0.10

# preregistered QC (tune to your study)
QC = dict(
    min_test_trials=140,          # of 160
    max_fast_rt_frac=0.10,        # frac of motion RTs < 200 ms
    min_highcoh_acc=0.65,         # accuracy at the two highest coherences
    min_load_acc=0.55,            # secondary-task RAW accuracy floor (crude backstop)
    # Secondary-task floor expressed ABOVE CHANCE. The raw 0.55 floor is not a
    # usable criterion for the low-load task: with RSVP_MAX_TARGETS=2 and
    # uniform 0..2 targets, P(at least one X) = 2/3, so an participant who
    # simply answers "yes" every trial scores ~0.67 and sails past a 0.55 floor
    # while providing no evidence of having attended the stream at all. That
    # hole is harmless when low load is one half of a contrast (the engagement
    # gate catches it) but NOT when a run is low-load-only and the RSVP accuracy
    # is the only secondary-task evidence there is. This criterion uses the same
    # normalized above-chance score as the engagement gate,
    # a* = (acc - chance) / (1 - chance), with each condition's own chance.
    min_load_above_chance=0.10,
    # Low-load sensitivity floor, d' (log-linear corrected). The above-chance
    # criterion is bias-SENSITIVE: a participant who answers "yes" on every
    # trial scores a* = 0 only in expectation, and sampling noise in the stream
    # lets them clear a 0.10 floor ~12% of the time in a 160-trial run (~16% at
    # the legacy 2/3 prevalence). d' is immune to response bias by construction
    # -- hit = false-alarm implies d' = 0 exactly, whatever the prevalence --
    # so it catches the all-yes voter deterministically. Only defined for the
    # low-load yes/no detection task; the high-load counting task keeps a*.
    # Calibration: the first pilot run scores d' = 1.11 (hit 0.74, FA 0.32).
    min_load_dprime=0.50,
)


# ----------------------------------------------------------------------------
# psychometric model
# ----------------------------------------------------------------------------
def weibull(c, thresh, slope):
    """P(correct) as a function of coherence c. 2-AFC Weibull with fixed
    guess rate and lapse; `thresh` is the coherence at THRESHOLD_P by
    construction of the scaling constant k."""
    c = np.asarray(c, dtype=float)
    # scale so that P(thresh) == THRESHOLD_P exactly
    k = (-np.log((1 - THRESHOLD_P) / (1 - GUESS - LAPSE))) ** (1.0 / slope)
    return GUESS + (1 - GUESS - LAPSE) * (1 - np.exp(-((c * k / thresh) ** slope)))


def fit_threshold(coh, correct):
    """Fit the Weibull to binary trial outcomes aggregated by coherence.
    Returns (threshold, slope, n_trials). NaN threshold if the fit fails."""
    df = pd.DataFrame({"coh": coh, "correct": correct})
    grp = df.groupby("coh")["correct"].agg(["mean", "count"]).reset_index()
    x = grp["coh"].values
    y = grp["mean"].values
    w = grp["count"].values
    if len(x) < 3 or np.all(y <= GUESS + 0.02):
        return np.nan, np.nan, int(w.sum())
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            popt, _ = curve_fit(
                weibull, x, y,
                p0=[0.15, 1.5],
                bounds=([0.01, 0.3], [1.5, 6.0]),
                sigma=1.0 / np.sqrt(w),
                maxfev=10000,
            )
        return float(popt[0]), float(popt[1]), int(w.sum())
    except Exception:
        return np.nan, np.nan, int(w.sum())


# ----------------------------------------------------------------------------
# data loading + QC
# ----------------------------------------------------------------------------
def load_data(data_dir):
    files = sorted(glob.glob(os.path.join(data_dir, "*.csv")))
    if not files:
        raise SystemExit(f"No CSV files found in {data_dir}")
    frames = []
    for f in files:
        try:
            d = pd.read_csv(f)
        except Exception as e:
            print(f"  ! skipping unreadable {os.path.basename(f)}: {e}")
            continue
        d["_source_file"] = os.path.basename(f)
        frames.append(d)
    raw = pd.concat(frames, ignore_index=True)
    print(f"Loaded {len(files)} files, {len(raw)} rows total.")
    return raw


def to_trials(raw):
    """Filter to RDK test trials and coerce dtypes."""
    c = COLS
    need = [c["kind"], c["task"], c["load"], c["coherence"], c["motion_correct"]]
    missing = [col for col in need if col not in raw.columns]
    if missing:
        raise SystemExit(f"Missing expected columns: {missing}\n"
                         f"Available: {list(raw.columns)}")
    df = raw[raw[c["kind"]] == "rdk"].copy()
    df = df[df[c["task"]] == "test"].copy()
    # coerce numerics
    for col in [c["coherence"], c["motion_correct"], c["load_correct"],
                c["rt_motion"], c["n_targets"]]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    # motion type: default to translation for legacy translation-only pilots
    # that predate the motion_type column.
    if c["motion_type"] not in df.columns:
        df[c["motion_type"]] = "translation"
    df[c["motion_type"]] = (df[c["motion_type"]].fillna("translation")
                            .astype(str).str.lower())
    return df


def _low_load_dprime(g):
    """Log-linear corrected d' on the LOW-load yes/no detection task.

    hit = P(said "yes" | >=1 target), fa = P(said "yes" | no target), with
    Hautus (1995) +0.5/+1 correction so perfect or empty cells stay finite.
    Returns nan when the run has no low-load trials or no response column.
    An always-"yes" (or always-"no") responder gives exactly 0.
    """
    c = COLS
    if c["load"] not in g or "load_response" not in g:
        return np.nan
    low = g[g[c["load"]].astype(str).str.lower() == "low"]
    if len(low) == 0:
        return np.nan
    nt = pd.to_numeric(low[c["n_targets"]], errors="coerce")
    resp = pd.to_numeric(low["load_response"], errors="coerce")
    ok = nt.notna() & resp.notna()
    if not ok.any():
        return np.nan
    nt, resp = nt[ok], resp[ok]
    present, said_yes = nt >= 1, resp == 1
    n_sig, n_noise = int(present.sum()), int((~present).sum())
    if n_sig == 0 or n_noise == 0:
        return np.nan
    h = (int((said_yes & present).sum()) + 0.5) / (n_sig + 1.0)
    f = (int((said_yes & ~present).sum()) + 0.5) / (n_noise + 1.0)
    return float(stats.norm.ppf(h) - stats.norm.ppf(f))


def _rsvp_design(g):
    """(P(stream contains >=1 target), max targets) for a run, taken from the
    LOGGED DESIGN rather than estimated from the realised streams.

    This matters: max_k P_hat(k) is upward-biased as an estimator of max_k P(k)
    -- in an 80-trial block the observed modal count exceeds its expectation by
    sampling noise alone -- so estimating chance from the sample would inflate
    chance, deflate a*, and make the engagement/QC floors drift with block size.
    The design is known exactly, so use it.

    `rsvp_target_present_p` is logged from config.js v1.1.0 onward. Older runs
    (uniform over 0..max_targets) have no such column; for those the implied
    prevalence is max_targets / (max_targets + 1), which reproduces the original
    2/3 and 1/3 chance levels exactly.
    """
    max_t = np.nan
    if "rsvp_max_targets" in g:
        v = pd.to_numeric(g["rsvp_max_targets"], errors="coerce").dropna()
        if len(v):
            max_t = int(v.iloc[0])
    if not np.isfinite(max_t) or max_t < 1:
        nt = pd.to_numeric(g.get(COLS["n_targets"]), errors="coerce")
        max_t = int(np.nanmax(nt)) if nt is not None and nt.notna().any() else 2
        max_t = max(max_t, 1)
    p_pres = np.nan
    if "rsvp_target_present_p" in g:
        v = pd.to_numeric(g["rsvp_target_present_p"], errors="coerce").dropna()
        if len(v):
            p_pres = float(v.iloc[0])
    if not np.isfinite(p_pres):
        p_pres = max_t / (max_t + 1.0)   # legacy: uniform over 0..max_t
    return float(np.clip(p_pres, 0.0, 1.0)), int(max_t)


def _load_chance(g):
    """Each load condition's own chance level on the secondary task, pooled over
    the rows of one run.

    Chance is defined as the BEST ACCURACY ACHIEVABLE BY A CONSTANT RESPONSE --
    i.e. what a participant scores by answering the same thing every trial
    without attending to the stream at all:
      low  ("did an X appear?") -> max(P(present), P(absent))
      high ("how many Xs?")     -> max_k P(n_targets = k), the modal count
    Both are read from the run's OWN empirical target distribution rather than
    assumed, because the two depend on target prevalence in opposite directions
    (see config.js RSVP_TARGET_PRESENT_P). Under the legacy uniform-over-0..2
    streams this reduces to the previously hardcoded 2/3 and 1/3; under 50%
    prevalence both become 0.5. Hardcoding 1/(max+1) for the high condition
    would let an 'always answer 0' responder score a* = +0.25 on 50%-prevalence
    data and pass the engagement floor while doing nothing.
    """
    c = COLS
    lc = g[c["load"]].astype(str).str.lower() if c["load"] in g else None
    out = {}
    for cond in ("low", "high"):
        sub = g if lc is None else g[lc == cond]
        if len(sub) == 0:
            continue
        p_pres, max_t = _rsvp_design(sub)
        if cond == "low":
            out[cond] = max(p_pres, 1.0 - p_pres)
        else:
            # count distribution is P(0) = 1 - p_pres and p_pres/max_t on each
            # of 1..max_t, so the best constant answer is the larger of those
            out[cond] = max(1.0 - p_pres, p_pres / max_t if max_t else 1.0)
    return out


def qc_exclusions(df):
    """Return (kept_df, report_df). Excludes whole participants failing QC."""
    c = COLS
    rows = []
    keep_ids = []
    for sid, g in df.groupby(c["subject"]):
        n = len(g)
        rt = g[c["rt_motion"]].dropna()
        fast_frac = float((rt < 200).mean()) if len(rt) else np.nan
        hi = g[g[c["coherence"]] >= 0.32]
        hi_acc = float(hi[c["motion_correct"]].mean()) if len(hi) else np.nan
        load_acc = float(g[c["load_correct"]].mean()) if c["load_correct"] in g else np.nan
        reasons = []
        if n < QC["min_test_trials"]:
            reasons.append(f"n_trials={n}")
        if not np.isnan(fast_frac) and fast_frac > QC["max_fast_rt_frac"]:
            reasons.append(f"fast_rt_frac={fast_frac:.2f}")
        if not np.isnan(hi_acc) and hi_acc < QC["min_highcoh_acc"]:
            reasons.append(f"highcoh_acc={hi_acc:.2f}")
        if not np.isnan(load_acc) and load_acc < QC["min_load_acc"]:
            reasons.append(f"load_acc={load_acc:.2f}")
        # Chance-relative secondary-task floor, evaluated per load condition
        # present in the run. This is the criterion that actually has teeth on a
        # low-load-only run (see the QC note above).
        load_astar = np.nan
        try:
            lc_col = g[c["load"]].astype(str).str.lower() if c["load"] in g else None
            chances = _load_chance(g)
            astars = []
            for cond, ch in chances.items():
                sub = g if lc_col is None else g[lc_col == cond]
                if len(sub) == 0 or not (ch < 1.0):
                    continue
                acc_c = float(sub[c["load_correct"]].mean())
                astars.append((acc_c - ch) / (1.0 - ch))
            if astars:
                load_astar = float(np.min(astars))
                if load_astar < QC["min_load_above_chance"]:
                    reasons.append(f"load_above_chance={load_astar:.2f}")
        except Exception as e:   # never silently skip a QC criterion
            raise RuntimeError(
                f"secondary-task above-chance QC failed for {sid}: {e}") from e
        # Bias-immune low-load sensitivity floor (see QC note).
        load_dp = _low_load_dprime(g)
        if not np.isnan(load_dp) and load_dp < QC["min_load_dprime"]:
            reasons.append(f"load_dprime={load_dp:.2f}")
        passed = len(reasons) == 0
        if passed:
            keep_ids.append(sid)
        rows.append(dict(subject=sid, n_trials=n, fast_rt_frac=fast_frac,
                         highcoh_acc=hi_acc, load_acc=load_acc,
                         load_above_chance=load_astar, load_dprime=load_dp,
                         excluded=(not passed), reasons=";".join(reasons)))
    report = pd.DataFrame(rows)
    kept = df[df[c["subject"]].isin(keep_ids)].copy()
    print(f"QC: {len(keep_ids)}/{report.shape[0]} participants passed.")
    return kept, report


# ----------------------------------------------------------------------------
# load-engagement gate (per subject x motion type)
# ----------------------------------------------------------------------------
def _rsvp_chance(gl, load):
    """Empirical secondary-task chance for one load cell (mirrors the
    single-file pipeline): low = 'always-yes' base rate; high = 1/(n_options)."""
    c = COLS
    if c["n_targets"] in gl.columns and gl[c["n_targets"]].notna().any():
        if load == "low":
            return float((gl[c["n_targets"]] >= 1).mean())
        return 1.0 / (int(np.nanmax(gl[c["n_targets"]])) + 1)
    return 0.5 if load == "low" else 0.25


def load_engagement(df):
    """Per (subject, motion_type): did the load manipulation engage?

    Returns a report DataFrame with normalized above-chance accuracy per load
    and an `engaged` flag (True/False/NaN). A False means the high-vs-low
    threshold contrast for that run should not be read as a load effect.
    """
    c = COLS
    rows = []
    for (sid, mt), g in df.groupby([c["subject"], c["motion_type"]]):
        above = {}
        acc = {}
        for load in ["low", "high"]:
            gl = g[g[c["load"]] == load]
            if len(gl) == 0 or c["load_correct"] not in gl.columns:
                above[load] = np.nan
                acc[load] = np.nan
                continue
            a = float(gl[c["load_correct"]].mean())
            ch = _rsvp_chance(gl, load)
            acc[load] = a
            above[load] = (a - ch) / (1.0 - ch) if ch < 1.0 else np.nan
        drop = above["low"] - above["high"]
        engaged = (bool(drop >= ENGAGE_MIN_DROP)
                   if drop == drop else None)  # NaN -> None (one load missing)
        rows.append(dict(subject=sid, motion_type=mt,
                         rsvp_acc_low=acc["low"], rsvp_acc_high=acc["high"],
                         above_chance_low=above["low"], above_chance_high=above["high"],
                         drop_above_chance=drop, engaged=engaged))
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------
# display-provenance check (per subject, across their motion-type runs)
# ----------------------------------------------------------------------------
# Online, each participant self-calibrates and their three runs may fall on
# different days or devices. Spatial scaling is equated by the virtual chinrest,
# but a change of physical display still changes luminance/contrast/gamma/panel
# persistence, which the calibration cannot control. This flags participants
# whose runs were NOT collected under a consistent display profile, so a
# motion-type contrast built on mismatched hardware is caught before it is read.
PROVENANCE_TOL = dict(
    px2mm_frac=0.05,   # physical pixel size may drift <=5% (same display, re-resize)
    refresh_hz=8.0,    # measured refresh within 8 Hz counts as the same panel
)


def _first(series):
    s = pd.to_numeric(series, errors="coerce").dropna() if series is not None else pd.Series([], dtype=float)
    return float(s.iloc[0]) if len(s) else np.nan


def _any(series):
    """First non-null string/categorical value, or None."""
    if series is None:
        return None
    s = series.dropna()
    return s.iloc[0] if len(s) else None


def display_provenance(raw):
    """Per subject: are all motion-type runs on a consistent display profile?

    Reads the RAW frame (before the rdk filter) because the display fingerprint
    is logged on the calibration row (`px2mm`) and the browser-check row
    (`width`/`height`/`vsync_rate`/`os`/`browser`), not on the rdk trials. Each
    source file is one (subject, run); the fingerprint is the non-null value of
    each field anywhere in that file. Returns one row per (subject, motion_type)
    with the display fingerprint plus a per-subject `consistent` flag.
    """
    c = COLS
    key = "_source_file" if "_source_file" in raw.columns else None
    groups = (raw.groupby(key) if key
              else raw.groupby([c["subject"], c["motion_type"]]))
    prof = []
    for gk, g in groups:
        mt_vals = g[c["motion_type"]].dropna().unique() if c["motion_type"] in g else []
        mt = mt_vals[0] if len(mt_vals) else "translation"
        sid = _any(g.get(c["subject"]))
        prof.append(dict(
            subject=sid, motion_type=mt,
            px2mm=_first(g.get(c["px2mm"])),
            view_dist_mm=_first(g.get(c["view_dist_mm"])),
            screen_w=_first(g.get(c["screen_w"])),
            screen_h=_first(g.get(c["screen_h"])),
            refresh=_first(g.get(c["refresh"])),
            os=_any(g.get(c["osname"])),
            browser=_any(g.get(c["browser"])),
        ))
    prof = pd.DataFrame(prof)
    if prof.empty:
        return prof

    verdict = {}
    for sid, g in prof.groupby("subject"):
        if len(g) < 2:
            verdict[sid] = (True, "single run")
            continue
        reasons = []
        # physical pixel size (px2mm): fractional spread across runs
        pm = g["px2mm"].dropna()
        if len(pm) >= 2 and pm.mean() > 0:
            frac = (pm.max() - pm.min()) / pm.mean()
            if frac > PROVENANCE_TOL["px2mm_frac"]:
                reasons.append(f"px2mm spread={frac:.0%}")
        # screen resolution must match exactly
        for f in ["screen_w", "screen_h"]:
            v = g[f].dropna()
            if len(v) >= 2 and v.nunique() > 1:
                reasons.append(f"{f}={sorted(set(v.astype(int)))}")
        # refresh within tolerance
        rf = g["refresh"].dropna()
        if len(rf) >= 2 and (rf.max() - rf.min()) > PROVENANCE_TOL["refresh_hz"]:
            reasons.append(f"refresh={rf.min():.0f}-{rf.max():.0f}Hz")
        # OS / browser identity
        for f in ["os", "browser"]:
            v = g[f].dropna()
            if len(v) >= 2 and v.nunique() > 1:
                reasons.append(f"{f}={sorted(set(v))}")
        verdict[sid] = (len(reasons) == 0, "; ".join(reasons) or "consistent")

    prof["consistent"] = prof["subject"].map(lambda s: verdict[s][0])
    prof["provenance_note"] = prof["subject"].map(lambda s: verdict[s][1])
    return prof


# ----------------------------------------------------------------------------
# per-subject fits + group stats
# ----------------------------------------------------------------------------
def fit_all(df):
    """Per (subject, motion_type, load) threshold fit."""
    c = COLS
    out = []
    for (sid, mt), g in df.groupby([c["subject"], c["motion_type"]]):
        # collapsed-across-load threshold for this run (motion-type main effect)
        thr_all, slope_all, ntr_all = fit_threshold(
            g[c["coherence"]].values, g[c["motion_correct"]].values)
        for load in ["low", "high"]:
            gl = g[g[c["load"]] == load]
            if len(gl) < 20:
                continue
            thr, slope, ntr = fit_threshold(
                gl[c["coherence"]].values, gl[c["motion_correct"]].values)
            out.append(dict(subject=sid, motion_type=mt, load=load,
                            threshold=thr, slope=slope, n=ntr,
                            mean_acc=float(gl[c["motion_correct"]].mean()),
                            threshold_run=thr_all))
    return pd.DataFrame(out)


def _paired_load_test(sub_fits, label):
    """Paired high-vs-low threshold test on one motion type. Returns (wide, res)."""
    wide = sub_fits.pivot_table(index="subject", columns="load", values="threshold")
    wide = wide.dropna(subset=[c for c in ["low", "high"] if c in wide.columns])
    if not {"low", "high"} <= set(wide.columns) or len(wide) < 2:
        print(f"  [{label}] not enough paired data for a load test "
              f"(n={0 if wide.empty else len(wide)}).")
        return wide, None
    diff = wide["high"] - wide["low"]
    t, p = stats.ttest_rel(wide["high"], wide["low"])
    d = diff.mean() / diff.std(ddof=1) if diff.std(ddof=1) > 0 else np.nan
    w_stat, w_p = stats.wilcoxon(wide["high"], wide["low"])
    print(f"  [{label}] n={len(wide)}  low={wide['low'].mean():.3f} "
          f"high={wide['high'].mean():.3f}  "
          f"paired t={t:.3f} p={p:.4f} dz={d:.3f}  "
          f"Wilcoxon W={w_stat:.1f} p={w_p:.4f}")
    return wide, dict(motion_type=label, n=len(wide), low=wide["low"].mean(),
                      high=wide["high"].mean(), t=t, p=p, dz=d, w=w_stat, wp=w_p)


def group_stats(fits, engagement=None):
    """Group tests: (1) motion-type main effect on the run threshold, and
    (2) per-motion-type paired load effect, EXCLUDING runs whose load
    manipulation did not engage. Returns (wide_by_type, results_dict)."""
    c = COLS
    results = {"load_by_type": [], "motion_main": None, "excluded_runs": []}

    # --- (1) motion-type main effect: one threshold per (subject, run) --------
    run_thr = (fits.drop_duplicates(subset=["subject", "motion_type"])
                    [["subject", "motion_type", "threshold_run"]])
    piv = run_thr.pivot_table(index="subject", columns="motion_type",
                              values="threshold_run")
    present = [m for m in MOTION_TYPES if m in piv.columns]
    print("\n=== Motion-type main effect on threshold (collapsed across load) ===")
    print(f"  mean threshold: "
          + "  ".join(f"{m}={piv[m].mean():.3f}" for m in present))
    complete = piv.dropna(subset=present)
    if len(present) >= 2 and len(complete) >= 2:
        if len(present) >= 3:
            fr = stats.friedmanchisquare(*[complete[m] for m in present])
            print(f"  Friedman chi2 = {fr.statistic:.3f}, p = {fr.pvalue:.4f} "
                  f"(n={len(complete)} with all {len(present)} runs)")
            results["motion_main"] = dict(test="friedman", stat=float(fr.statistic),
                                          p=float(fr.pvalue), n=len(complete),
                                          types=present)
        # pairwise Wilcoxon across types
        pw = []
        for i in range(len(present)):
            for j in range(i + 1, len(present)):
                a, b = present[i], present[j]
                cc = piv.dropna(subset=[a, b])
                if len(cc) >= 2:
                    ws, wp = stats.wilcoxon(cc[a], cc[b])
                    print(f"    {a} vs {b}: n={len(cc)} "
                          f"mean diff={cc[a].mean()-cc[b].mean():+.3f} "
                          f"Wilcoxon W={ws:.1f} p={wp:.4f}")
                    pw.append(dict(type_a=a, type_b=b, n=len(cc),
                                   mean_diff=float(cc[a].mean()-cc[b].mean()),
                                   w=float(ws), p=float(wp)))
        results["pairwise_motion"] = pw
    else:
        print("  Not enough complete cross-type data for a motion-type test.")

    # --- (2) per-type paired load effect, with engagement exclusion ----------
    print("\n=== Load effect on threshold, per motion type (engaged runs only) ===")
    eng_lookup = {}
    if engagement is not None:
        for _, r in engagement.iterrows():
            eng_lookup[(r["subject"], r["motion_type"])] = r["engaged"]

    for mt in present:
        sub = fits[fits.motion_type == mt].copy()
        # drop runs whose load manipulation did not engage
        if eng_lookup:
            def _keep(sid):
                v = eng_lookup.get((sid, mt), None)
                return v is not False  # keep True and None(unknown); drop False
            dropped = sorted({s for s in sub.subject.unique() if not _keep(s)})
            for s in dropped:
                results["excluded_runs"].append(dict(subject=s, motion_type=mt,
                                                     reason="load did not engage"))
            if dropped:
                print(f"  [{mt}] excluded {len(dropped)} run(s) for non-engagement: "
                      + ", ".join(map(str, dropped)))
            sub = sub[sub.subject.apply(_keep)]
        _, res = _paired_load_test(sub, mt)
        if res is not None:
            results["load_by_type"].append(res)

    return piv, results


# ----------------------------------------------------------------------------
# figures
# ----------------------------------------------------------------------------
def fig_group_psychometric(df, out_path, title="Group psychometric functions by load"):
    """Group-averaged accuracy vs coherence, one curve per load."""
    c = COLS
    fig, ax = plt.subplots(figsize=(4.2, 3.4))
    colors = {"low": "#1f6feb", "high": "#e8710a"}
    xs = np.logspace(np.log10(0.03), np.log10(0.8), 100)
    for load in ["low", "high"]:
        gl = df[df[c["load"]] == load]
        # per-subject accuracy at each coherence, then average across subjects
        per = (gl.groupby([c["subject"], c["coherence"]])[c["motion_correct"]]
                 .mean().reset_index())
        agg = per.groupby(c["coherence"])[c["motion_correct"]].agg(["mean", "sem"])
        ax.errorbar(agg.index, agg["mean"], yerr=agg["sem"], fmt="o",
                    color=colors[load], capsize=2, label=None, zorder=3)
        # group fit overlay
        thr, slope, _ = fit_threshold(gl[c["coherence"]].values,
                                      gl[c["motion_correct"]].values)
        if not np.isnan(thr):
            ax.plot(xs, weibull(xs, thr, slope), color=colors[load], lw=2,
                    label=f"{'Low' if load=='low' else 'High'} load")
    ax.axhline(0.75, color="#999", lw=0.7, ls=":")
    ax.set_xscale("log")
    ax.set_xticks(COHERENCE_LEVELS)
    ax.set_xticklabels([f"{int(x*100)}%" for x in COHERENCE_LEVELS])
    ax.set_xlabel("Motion coherence")
    ax.set_ylabel("P(correct direction)")
    ax.set_ylim(0.45, 1.0)
    ax.set_title(title)
    ax.legend(frameon=False, loc="lower right")
    fig.tight_layout()
    fig.savefig(out_path, dpi=200)
    plt.close(fig)
    print(f"  wrote {out_path}")


def fig_threshold_paired(wide, out_path):
    """Paired dot plot of low vs high thresholds per subject."""
    fig, ax = plt.subplots(figsize=(3.2, 3.6))
    for _, row in wide.iterrows():
        ax.plot([0, 1], [row["low"], row["high"]], "-", color="#bbb",
                lw=0.8, zorder=1)
    ax.plot(np.zeros(len(wide)), wide["low"], "o", color="#1f6feb", zorder=2)
    ax.plot(np.ones(len(wide)), wide["high"], "o", color="#e8710a", zorder=2)
    ax.plot([0, 1], [wide["low"].mean(), wide["high"].mean()], "k-", lw=2.5,
            zorder=3)
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["Low\nload", "High\nload"])
    ax.set_ylabel("Coherence threshold (75%)")
    ax.set_xlim(-0.3, 1.3)
    ax.set_title("Per-participant threshold shift")
    fig.tight_layout()
    fig.savefig(out_path, dpi=200)
    plt.close(fig)
    print(f"  wrote {out_path}")


def fig_motion_type_thresholds(fits, out_path):
    """Group run-threshold by motion type: per-subject points + mean/SEM,
    with subjects connected across types (within-subject design)."""
    run_thr = (fits.drop_duplicates(subset=["subject", "motion_type"])
                    [["subject", "motion_type", "threshold_run"]])
    present = [m for m in MOTION_TYPES if m in run_thr.motion_type.unique()]
    if len(present) < 1:
        return
    colors = {"translation": "#1b9e77", "rotation": "#7570b3", "spiral": "#d95f02",
              "radial": "#1f5fa9"}
    xpos = {m: i for i, m in enumerate(present)}
    piv = run_thr.pivot_table(index="subject", columns="motion_type",
                              values="threshold_run")

    fig, ax = plt.subplots(figsize=(4.8, 3.6))
    # connectors across types (within-subject)
    for _, row in piv.iterrows():
        xs = [xpos[m] for m in present if m in piv.columns and row.get(m) == row.get(m)]
        ys = [row[m] for m in present if m in piv.columns and row.get(m) == row.get(m)]
        if len(xs) >= 2:
            ax.plot(xs, ys, "-", color="#ccc", lw=0.7, zorder=1)
    # per-subject points + mean/SEM per type
    for m in present:
        vals = run_thr[run_thr.motion_type == m]["threshold_run"].dropna().values
        jitter = (np.random.RandomState(0).rand(len(vals)) - 0.5) * 0.12
        ax.plot(xpos[m] + jitter, vals, "o", color=colors.get(m, "#555"),
                ms=5, mec="white", mew=0.5, alpha=0.85, zorder=2)
        if len(vals):
            mean = vals.mean()
            sem = vals.std(ddof=1) / np.sqrt(len(vals)) if len(vals) > 1 else 0.0
            ax.plot([xpos[m] - 0.22, xpos[m] + 0.22], [mean, mean], "-",
                    color=colors.get(m, "#555"), lw=2.5, zorder=3)
            if sem > 0:
                ax.plot([xpos[m], xpos[m]], [mean - sem, mean + sem], "-",
                        color=colors.get(m, "#555"), lw=1.5, zorder=3)
    ax.set_xticks(list(xpos.values()))
    ax.set_xticklabels(present)
    ax.set_ylabel("Coherence threshold (75%)")
    ax.set_xlim(-0.5, len(present) - 0.5)
    ax.set_title("Direction-discrimination threshold by motion type")
    fig.tight_layout()
    fig.savefig(out_path, dpi=200, bbox_inches="tight")
    plt.close(fig)
    print(f"  wrote {out_path}")


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data_dir", default="../data",
                    help="folder of participant CSVs")
    ap.add_argument("--out_dir", default="./out")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    raw = load_data(args.data_dir)
    trials = to_trials(raw)
    kept, qc_report = qc_exclusions(trials)
    qc_report.to_csv(os.path.join(args.out_dir, "qc_report.csv"), index=False)

    # tidy trial table
    kept.to_csv(os.path.join(args.out_dir, "trials_clean.csv"), index=False)

    # standing display-provenance check (per subject, across motion-type runs).
    # Reads the raw frame — the display fingerprint lives on the calibration and
    # browser-check rows, which the rdk-only trials frame drops. Limited to
    # subjects that survived QC so we only warn about runs actually analysed.
    prov = display_provenance(raw[raw[COLS["subject"]].isin(kept[COLS["subject"]].unique())])
    if not prov.empty:
        prov.to_csv(os.path.join(args.out_dir, "display_provenance.csv"),
                    index=False)
        bad = prov[~prov["consistent"]]["subject"].unique()
        print(f"Display provenance: {len(bad)}/{prov['subject'].nunique()} "
              f"participant(s) have runs on INCONSISTENT displays.")
        for sid in bad:
            note = prov[prov.subject == sid]["provenance_note"].iloc[0]
            print(f"  [WARN] {sid}: {note} — motion-type contrast confounded "
                  f"with display; interpret with caution.")

    # standing load-engagement pre-check (per subject x motion type)
    engagement = load_engagement(kept)
    engagement.to_csv(os.path.join(args.out_dir, "load_engagement.csv"),
                      index=False)
    # `engagement` is an EMPTY frame (no columns) when no participant survived
    # QC, so guard the column access -- a run that is correctly excluded should
    # produce a clean report, not a traceback.
    n_flag = (int((engagement["engaged"] == False).sum())  # noqa: E712
              if "engaged" in engagement.columns else 0)
    print(f"Load-engagement: {n_flag}/{len(engagement)} run(s) did NOT engage "
          f"(dropped from the paired load test).")
    if kept.empty:
        print("No participant passed QC — see qc_report.csv for the reasons. "
              "Nothing further to analyse.")
        return

    fits = fit_all(kept)
    fits.to_csv(os.path.join(args.out_dir, "thresholds_by_subject.csv"),
                index=False)

    wide, res = group_stats(fits, engagement=engagement)
    if res["load_by_type"]:
        pd.DataFrame(res["load_by_type"]).to_csv(
            os.path.join(args.out_dir, "group_load_by_type.csv"), index=False)
    if res.get("pairwise_motion"):
        pd.DataFrame(res["pairwise_motion"]).to_csv(
            os.path.join(args.out_dir, "group_motion_pairwise.csv"), index=False)
    if res["excluded_runs"]:
        pd.DataFrame(res["excluded_runs"]).to_csv(
            os.path.join(args.out_dir, "load_test_exclusions.csv"), index=False)

    # figures: per-type group psychometric, and the motion-type threshold summary
    for mt in [m for m in MOTION_TYPES if m in kept[COLS["motion_type"]].unique()]:
        sub = kept[kept[COLS["motion_type"]] == mt]
        fig_group_psychometric(
            sub, os.path.join(args.out_dir, f"group_psychometric_{mt}.png"),
            title=f"Group psychometric by load — {mt}")
    fig_motion_type_thresholds(
        fits, os.path.join(args.out_dir, "group_motion_type_thresholds.png"))
    print("\nDone. Outputs in", args.out_dir)


if __name__ == "__main__":
    main()
