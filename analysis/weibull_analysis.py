#!/usr/bin/env python3
"""
weibull_analysis.py -- Fit 2AFC Weibull psychometric functions to the online
RDK + attentional-load study, comparing the "easy" (low-load) and "hard"
(high-load) RSVP conditions.

Motion types.  The experiment runs three motion types as separate runs:
    translation  -> direction coded left / right
    rotation     -> direction coded cw / ccw   (rigid fronto-parallel rotation)
    spiral       -> direction coded cw / ccw   (balanced screw; radial sign is a
                                                balanced logged nuisance)
The psychometric machinery is direction-agnostic: it fits `motion_correct`, so
cw/ccw runs need no special-casing. This script detects the motion type(s)
present in the data (column `motion_type`; absent -> assumed "translation" for
back-compat with the earliest pilots) and runs the full pipeline PER TYPE,
tagging every output with the type. When several types share one CSV (e.g. a
participant's three within-subject runs concatenated), each is analysed
separately and a cross-type threshold comparison is written.

It also runs two manipulation checks that only matter once direction is coded
cw/ccw and the spiral carries a radial nuisance:
  * direction bias  -- accuracy split by the two response directions, to catch a
                       participant biased toward one sense (e.g. always "cw").
  * spiral radial   -- accuracy split by expand/contract, to confirm the
                       (unjudged) radial sign does not shift rotational-sense
                       discrimination.

Usage:
    python weibull_analysis.py path/to/data.csv [--out OUTDIR]
                               [--motion-type translation|rotation|spiral]

Model (per condition), fit by maximum likelihood (binomial):
    p(c) = gamma + (1 - gamma - lambda) * (1 - exp(-(c/alpha)^beta))
      gamma  = 0.5   guess rate (2-alternative forced choice), fixed
      alpha  > 0     scale (63%-of-range threshold)
      beta   > 0     slope
      lambda in[0,.06] lapse rate (bounded)

Outputs:
    weibull_fit.png     two-panel figure (curves + bootstrap thresholds)
    weibull_params.csv  fitted parameters and 75% thresholds with 95% CIs
"""
import argparse, os, json
import numpy as np
import pandas as pd
from scipy.optimize import minimize

GUESS = 0.5  # 2AFC guess rate

# Per-motion-type wording for the direction 2AFC (response axis + the two signs).
MOTION_TASK_LABEL = {
    "translation": "Left/right discrimination",
    "rotation":    "CW/CCW discrimination",
    "spiral":      "CW/CCW discrimination (spiral)",
}
# The two direction codes each type uses, in a fixed order for stable tables.
MOTION_DIR_CODES = {
    "translation": ["left", "right"],
    "rotation":    ["ccw", "cw"],
    "spiral":      ["ccw", "cw"],
}

def weibull(c, alpha, beta, lapse, guess=GUESS):
    return guess + (1 - guess - lapse) * (1 - np.exp(-(c / alpha) ** beta))

def neg_loglik(params, c, k, n):
    alpha, beta, lapse = params
    p = np.clip(weibull(c, alpha, beta, lapse), 1e-6, 1 - 1e-6)
    return -np.sum(k * np.log(p) + (n - k) * np.log(1 - p))

def _fit(c, k, n):
    best = None
    for a0 in (0.05, 0.1, 0.2, 0.3):
        for b0 in (1.0, 2.0, 3.0):
            r = minimize(neg_loglik, [a0, b0, 0.02], args=(c, k, n),
                         method="L-BFGS-B",
                         bounds=[(1e-3, 3.0), (0.3, 10.0), (0.0, 0.06)])
            if r.success and (best is None or r.fun < best.fun):
                best = r
    return best

def threshold_at(alpha, beta, lapse, target=0.75, guess=GUESS):
    ceil = 1 - lapse
    arg = 1 - (target - guess) / (ceil - guess)
    return alpha * (-np.log(arg)) ** (1 / beta) if 0 < arg < 1 else np.nan

def fit_condition(sub):
    g = (sub.groupby("coherence")
            .agg(n=("motion_correct", "size"), k=("motion_correct", "sum"))
            .reset_index())
    c, k, n = g.coherence.values, g.k.values.astype(float), g.n.values.astype(float)
    r = _fit(c, k, n)
    a, b, l = r.x
    return dict(alpha=a, beta=b, lapse=l, thr75=threshold_at(a, b, l),
                nll=r.fun, grouped=g)

def bootstrap_threshold(sub, nboot=2000, seed=0, target=0.75):
    g = (sub.groupby("coherence")
            .agg(n=("motion_correct", "size"), k=("motion_correct", "sum"))
            .reset_index())
    c, n = g.coherence.values, g.n.values.astype(int)
    p_hat = np.clip(g.k.values / g.n.values, 0, 1)
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(nboot):
        k_b = rng.binomial(n, p_hat).astype(float)
        try:
            r = _fit(c, k_b, n.astype(float))
            a, b, l = r.x
            t = threshold_at(a, b, l, target)
            if np.isfinite(t) and t < 3:
                out.append(t)
        except Exception:
            pass
    return np.asarray(out)

def to_bool(s):
    return s.astype(str).str.lower().isin(["true", "1", "1.0"])

def display_fingerprint(csv_path):
    """Per motion_type: the physical display signature (px2mm from the card
    resize, view distance from blindspot, refresh/OS/browser). Read from the RAW
    file because these live on the calibration / browser-check rows, not the rdk
    trials. Used to tag cross-type thresholds when the runs were not all on the
    same display — spatial scaling is equated by the chinrest, but luminance /
    contrast / gamma / panel persistence are not."""
    df = pd.read_csv(csv_path)
    if "motion_type" not in df.columns:
        df["motion_type"] = "translation"
    df["motion_type"] = df["motion_type"].fillna("translation").astype(str).str.lower()
    rows = []
    for mt, g in df.groupby("motion_type"):
        def first(col):
            if col not in g:
                return np.nan
            s = pd.to_numeric(g[col], errors="coerce").dropna()
            return float(s.iloc[0]) if len(s) else np.nan
        def firsts(col):
            if col not in g:
                return None
            s = g[col].dropna()
            return s.iloc[0] if len(s) else None
        rows.append(dict(motion_type=mt, px2mm=first("px2mm"),
                         view_dist_mm=first("view_dist_mm"),
                         refresh=first("vsync_rate"),
                         os=firsts("os"), browser=firsts("browser")))
    fp = pd.DataFrame(rows)
    # Flag: same physical display across runs? px2mm within 5%.
    pm = fp["px2mm"].dropna()
    fp.attrs["same_display"] = not (len(pm) >= 2 and pm.mean() > 0
                                    and (pm.max() - pm.min()) / pm.mean() > 0.05)
    fp.attrs["px2mm_spread"] = (float((pm.max() - pm.min()) / pm.mean())
                                if len(pm) >= 2 and pm.mean() > 0 else 0.0)
    return fp


def load_photometry(path):
    """Load lab endpoint photometry (cd/m^2) and derive per-display contrast.

    Endpoint-only: L_black is the background (#000000) luminance, L_white is the
    dot (#ffffff) luminance. For the 255-on-0 stimulus these two fully determine
    dot-vs-background contrast. Returns a dict keyed by display label with the
    raw luminances plus Michelson and Weber contrast, or None if the file is
    absent or the endpoints have not been filled in yet."""
    if not path or not os.path.exists(path):
        return None
    with open(path) as fh:
        spec = json.load(fh)
    out = {}
    for label, d in spec.get("displays", {}).items():
        lb, lw = d.get("L_black_cd_m2"), d.get("L_white_cd_m2")
        if lb is None or lw is None:
            continue  # not measured yet
        lb, lw = float(lb), float(lw)
        michelson = (lw - lb) / (lw + lb) if (lw + lb) > 0 else np.nan
        weber = (lw - lb) / lb if lb > 0 else np.inf  # dot on near-black
        out[label] = dict(L_black=lb, L_white=lw,
                          michelson=michelson, weber=weber,
                          lum_ratio=(lw / lb if lb > 0 else np.inf),
                          px2mm_nominal=d.get("px2mm_nominal"))
    return out or None


def match_display(px2mm, photometry, tol=0.10):
    """Nearest-display match for a run's measured px2mm (px per mm is a physical
    property of the panel, roughly constant across sessions). Returns the display
    label if within `tol` fractional distance, else None."""
    if photometry is None or px2mm != px2mm:
        return None
    best, bestd = None, tol
    for label, d in photometry.items():
        nom = d.get("px2mm_nominal")
        if nom:
            frac = abs(px2mm - nom) / nom
            if frac < bestd:
                best, bestd = label, frac
    return best


def load_rdk(csv_path):
    df = pd.read_csv(csv_path)
    rdk = df[(df.get("trial_kind") == "rdk") & (df.get("task") == "test")].copy()
    rdk["coherence"] = pd.to_numeric(rdk["coherence"], errors="coerce")
    rdk["motion_correct"] = to_bool(rdk["motion_correct"]).astype(int)
    rdk["load_correct"] = to_bool(rdk["load_correct"]).astype(int)   # secondary task
    if "rsvp_n_targets" in rdk.columns:
        rdk["rsvp_n_targets"] = pd.to_numeric(rdk["rsvp_n_targets"], errors="coerce")
    # motion_type: absent in the earliest translation-only pilots -> assume it.
    if "motion_type" not in rdk.columns:
        rdk["motion_type"] = "translation"
    rdk["motion_type"] = rdk["motion_type"].fillna("translation").astype(str).str.lower()
    # direction / radial_direction are string codes; keep them as-is but normalise.
    if "direction" in rdk.columns:
        rdk["direction"] = rdk["direction"].astype(str).str.lower()
    if "radial_direction" not in rdk.columns:
        rdk["radial_direction"] = np.nan
    rdk = rdk.dropna(subset=["coherence", "load_condition"])
    return rdk

def make_figure(fits, boots, labels, colors, out_png, suptitle=None):
    import matplotlib as mpl
    import matplotlib.pyplot as plt
    from matplotlib.ticker import NullLocator, NullFormatter
    try:
        apply_figure_style(sizes=(8, 7, 6))  # noqa: F821  (present when run in-kernel)
    except NameError:
        mpl.rcParams.update({"font.size": 8, "axes.spines.top": False,
                             "axes.spines.right": False})
    fig, (axA, axB) = plt.subplots(1, 2, figsize=(7.2, 3.2))
    cc = np.logspace(np.log10(0.03), np.log10(0.75), 200)
    for lc in fits:
        f, g = fits[lc], fits[lc]["grouped"]
        axA.plot(g.coherence, g.k / g.n, "o", color=colors[lc], ms=6,
                 mec="white", mew=0.6, zorder=3)
        axA.plot(cc, weibull(cc, f["alpha"], f["beta"], f["lapse"]),
                 "-", color=colors[lc], lw=2, zorder=2)
        t = f["thr75"]
        axA.plot([t, t], [0.5, 0.75], ":", color=colors[lc], lw=1.2, zorder=1)
        axA.plot(t, 0.75, "v", color=colors[lc], ms=6, mec="white", mew=0.5, zorder=4)
    axA.axhline(0.5, color="0.6", lw=0.8, ls="--")
    axA.axhline(0.75, color="0.8", lw=0.8)
    axA.set_xscale("log")
    axA.set_xticks([0.04, 0.08, 0.16, 0.32, 0.64])
    axA.set_xticklabels(["4", "8", "16", "32", "64"])
    axA.xaxis.set_minor_locator(NullLocator())
    axA.xaxis.set_minor_formatter(NullFormatter())
    axA.set_xlabel("Motion coherence (%)")
    axA.set_ylabel("P(correct direction)")
    axA.set_ylim(0.4, 1.02)
    axA.set_title("Direction discrimination vs. coherence", loc="left")
    ypos = {"low": 0.93, "high": 0.86}
    for lc in fits:
        axA.text(0.045, ypos.get(lc, 0.80), labels[lc], color=colors[lc], fontsize=6, va="center")
    for lc in boots:
        axB.hist(boots[lc], bins=40, range=(0, 0.8), color=colors[lc], alpha=0.55,
                 density=True, label=labels[lc])
        axB.axvline(np.median(boots[lc]), color=colors[lc], lw=1.6)
    axB.set_xlabel("75%-correct threshold (coherence)")
    axB.set_ylabel("Bootstrap density")
    axB.set_xlim(0, 0.75)
    axB.set_title("Bootstrap threshold distributions", loc="left")
    try:
        panel_letter(axA, "a"); panel_letter(axB, "b")  # noqa: F821
    except NameError:
        axA.text(-0.12, 1.05, "a", transform=axA.transAxes, fontweight="bold")
        axB.text(-0.12, 1.05, "b", transform=axB.transAxes, fontweight="bold")
    if suptitle:
        fig.suptitle(suptitle, x=0.01, ha="left", fontsize=9, fontweight="bold")
        fig.tight_layout(rect=(0, 0, 1, 0.95))
    else:
        fig.tight_layout()
    fig.savefig(out_png, dpi=300, bbox_inches="tight")
    return fig

# ---------------------------------------------------------------------------
# Secondary (RSVP letter/counting) task: does the dual-task cost trade off with
# motion difficulty?  We model letter-task accuracy as a logistic function of
# log2(coherence), per load condition.  The SLOPE is the trade-off test:
#   slope > 0  -> easier motion frees capacity, letter accuracy rises (trade-off)
#   slope ~ 0  -> tasks independent (or secondary task floored/saturated)
# Chance differs by condition (low = yes/no with a high 'yes' base rate;
# high = count 0-3, guess = 0.25), so compare each condition to its own baseline
# and read the slope, which the base rate does not confound.
# ---------------------------------------------------------------------------

def _logistic(x, a, b):
    return 1.0 / (1.0 + np.exp(-(a + b * x)))

def _nll_logit(params, x, y):
    a, b = params
    p = np.clip(_logistic(x, a, b), 1e-9, 1 - 1e-9)
    return -np.sum(y * np.log(p) + (1 - y) * np.log(1 - p))

def fit_rsvp_logit(sub):
    x = np.log2(sub.coherence.values)
    y = sub.load_correct.values.astype(float)
    r = minimize(_nll_logit, [0.0, 0.0], args=(x, y), method="Nelder-Mead")
    return r.x  # intercept a, slope b

def bootstrap_rsvp_slope(sub, nboot=3000, seed=7):
    rng = np.random.default_rng(seed)
    x = np.log2(sub.coherence.values)
    y = sub.load_correct.values.astype(float)
    n = len(y); out = []
    for _ in range(nboot):
        idx = rng.integers(0, n, n)
        try:
            r = minimize(_nll_logit, [0, 0], args=(x[idx], y[idx]), method="Nelder-Mead")
            out.append(r.x[1])
        except Exception:
            pass
    return np.asarray(out)

def make_rsvp_figure(rdk, logit, boots, labels, colors, chance, out_png):
    import matplotlib as mpl
    import matplotlib.pyplot as plt
    from matplotlib.ticker import NullLocator, NullFormatter
    try:
        apply_figure_style(sizes=(8, 7, 6))  # noqa: F821
    except NameError:
        mpl.rcParams.update({"font.size": 8, "axes.spines.top": False,
                             "axes.spines.right": False})
    tab = (rdk.groupby(["load_condition", "coherence"])
              .agg(n=("load_correct", "size"), k=("load_correct", "sum")).reset_index())
    tab["p"] = tab.k / tab.n
    fig, (axA, axB) = plt.subplots(1, 2, figsize=(7.2, 3.2))
    cc = np.logspace(np.log10(0.03), np.log10(0.75), 200)
    for lc in logit:
        g = tab[tab.load_condition == lc]
        axA.plot(g.coherence, g.p, "o", color=colors[lc], ms=6, mec="white", mew=0.6, zorder=3)
        a, b = logit[lc]
        axA.plot(cc, _logistic(np.log2(cc), a, b), "-", color=colors[lc], lw=2, zorder=2)
        axA.axhline(chance[lc], color=colors[lc], lw=0.8, ls=":", alpha=0.7, zorder=0)
    axA.set_xscale("log")
    axA.set_xticks([0.04, 0.08, 0.16, 0.32, 0.64]); axA.set_xticklabels(["4", "8", "16", "32", "64"])
    axA.xaxis.set_minor_locator(NullLocator()); axA.xaxis.set_minor_formatter(NullFormatter())
    axA.set_xlabel("Motion coherence (%)"); axA.set_ylabel("P(correct on letter task)")
    axA.set_ylim(0.0, 1.0)
    axA.set_title("Letter-task accuracy vs. coherence", loc="left")
    ypos = {"low": 0.94, "high": 0.16}
    for lc in logit:
        axA.text(0.045, ypos.get(lc, 0.5), labels[lc], color=colors[lc], fontsize=6, va="center")
    for lc in boots:
        axB.hist(boots[lc], bins=45, range=(-1.2, 1.6), color=colors[lc], alpha=0.55, density=True)
        axB.axvline(logit[lc][1], color=colors[lc], lw=1.6)
    axB.axvline(0, color="0.4", lw=1.0, ls="--", zorder=0)
    axB.set_xlabel("Trade-off slope ($\\Delta$ logit / log$_2$ coherence)")
    axB.set_ylabel("Bootstrap density"); axB.set_xlim(-1.2, 1.6)
    axB.set_title("Trade-off slope by load", loc="left")
    try:
        panel_letter(axA, "a"); panel_letter(axB, "b")  # noqa: F821
    except NameError:
        axA.text(-0.12, 1.05, "a", transform=axA.transAxes, fontweight="bold")
        axB.text(-0.12, 1.05, "b", transform=axB.transAxes, fontweight="bold")
    fig.tight_layout(); fig.savefig(out_png, dpi=300, bbox_inches="tight")
    return fig

def analyze_secondary_task(rdk, conds, labels, colors, outdir, nboot=3000, prefix=""):
    """Fit + plot the RSVP trade-off; returns a params DataFrame."""
    # empirical chance per condition: low = 'always-yes' base rate; high = 0.25 guess
    chance = {}
    if "low" in conds:
        chance["low"] = float((rdk[rdk.load_condition == "low"].rsvp_n_targets >= 1).mean())
    if "high" in conds:
        # counting task guess rate = 1 / (number of response options).
        # Options are 0..max_targets, derived from the data so it tracks the
        # RSVP_MAX_TARGETS setting used to collect this run (0-3 -> 0.25; 0-2 -> 0.333).
        max_t = int(np.nanmax(rdk[rdk.load_condition == "high"].rsvp_n_targets))
        chance["high"] = 1.0 / (max_t + 1)
    logit = {lc: fit_rsvp_logit(rdk[rdk.load_condition == lc]) for lc in conds}
    boots = {lc: bootstrap_rsvp_slope(rdk[rdk.load_condition == lc], nboot=nboot) for lc in conds}
    rows = []
    for lc in conds:
        a, b = logit[lc]; bs = boots[lc]
        lo, hi = np.percentile(bs, [2.5, 97.5])
        rows.append(dict(condition=lc, intercept_a=a, slope_b=b,
                         slope_ci_lo=lo, slope_ci_hi=hi,
                         frac_boot_positive=float((bs > 0).mean()),
                         chance=chance.get(lc, np.nan),
                         marginal_acc=float(rdk[rdk.load_condition == lc].load_correct.mean())))
    params = pd.DataFrame(rows)
    params.to_csv(os.path.join(outdir, prefix + "rsvp_tradeoff_params.csv"), index=False)
    make_rsvp_figure(rdk, logit, boots, labels, colors, chance,
                     os.path.join(outdir, prefix + "rsvp_tradeoff.png"))
    return params


# ---------------------------------------------------------------------------
# Manipulation checks that become relevant once direction is coded cw/ccw and
# the spiral carries a balanced radial nuisance.
# ---------------------------------------------------------------------------

def direction_bias_table(sub, motion_type):
    """Accuracy and trial count split by the two response directions.

    A large accuracy gap between the two signs (or a lopsided response rate)
    flags a participant biased toward one rotational/translational sense.
    """
    codes = MOTION_DIR_CODES.get(motion_type, sorted(sub["direction"].dropna().unique()))
    rows = []
    for d in codes:
        g = sub[sub["direction"] == d]
        if len(g) == 0:
            continue
        # response-choice rate toward this sign (how often the participant PICKED d)
        picked = float((sub.get("motion_response").astype(str).str.lower() == d).mean()) \
            if "motion_response" in sub.columns else np.nan
        rows.append(dict(motion_type=motion_type, direction=d, n_trials=int(len(g)),
                         accuracy=float(g["motion_correct"].mean()),
                         chose_this_dir_rate=picked))
    return pd.DataFrame(rows)


def spiral_radial_table(sub):
    """Accuracy split by the (unjudged) spiral radial sign expand/contract.

    The radial sign is a balanced nuisance; rotational-sense accuracy should not
    differ between expand and contract. A gap would mean the radial component
    leaks into the rotational judgement.
    """
    if "radial_direction" not in sub.columns:
        return pd.DataFrame()
    g = sub[sub["radial_direction"].astype(str).str.lower().isin(["expand", "contract"])]
    if len(g) == 0:
        return pd.DataFrame()
    rows = []
    for rd in ["expand", "contract"]:
        h = g[g["radial_direction"].astype(str).str.lower() == rd]
        if len(h) == 0:
            continue
        rows.append(dict(radial_direction=rd, n_trials=int(len(h)),
                         accuracy=float(h["motion_correct"].mean())))
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Standing pre-check: did the attentional-load manipulation actually engage?
#
# The load is manipulated at fixation via RSVP difficulty (easy detection vs.
# hard counting). If it engaged, secondary-task performance ABOVE ITS OWN CHANCE
# should be lower under high load than under low load (the participant pays a
# cost for the harder fixation task). If high ~= low, the "high load" run did not
# create a differential demand, and any motion-threshold contrast between the two
# load halves of THAT run is uninterpretable as a load effect. This is exactly
# what separated the flat spiral run from the steep translation/rotation runs in
# the single-participant pilot.
#
# Metric: normalized above-chance performance a* = (acc - chance)/(1 - chance),
# per load, using each condition's empirical chance (low = 'always-yes' base
# rate; high = 1/(n_options) counting guess). Verdict engaged if
#   a*_low - a*_high >= ENGAGE_MIN_DROP  (default 0.10).
# ---------------------------------------------------------------------------

ENGAGE_MIN_DROP = 0.10  # normalized above-chance drop (low - high) to call it engaged


def rsvp_load_sanity(rdk_t, motion_type, conds):
    """Per-load RSVP accuracy vs chance + an 'engaged' verdict. Returns (df, verdict)."""
    rows = []
    for lc in conds:
        sub = rdk_t[rdk_t.load_condition == lc]
        acc = float(sub.load_correct.mean())
        n = int(len(sub))
        # empirical chance for this load condition (mirrors analyze_secondary_task)
        if lc == "low":
            ch = float((sub.rsvp_n_targets >= 1).mean()) if "rsvp_n_targets" in sub.columns else 0.5
        else:
            if "rsvp_n_targets" in sub.columns and sub.rsvp_n_targets.notna().any():
                ch = 1.0 / (int(np.nanmax(sub.rsvp_n_targets)) + 1)
            else:
                ch = 0.25
        above = (acc - ch) / (1.0 - ch) if ch < 1.0 else np.nan
        # binomial 95% CI on raw accuracy (normal approx, floored at n>0)
        se = np.sqrt(acc * (1 - acc) / n) if n > 0 else np.nan
        rows.append(dict(motion_type=motion_type, load=lc, n_trials=n,
                         rsvp_acc=acc, acc_ci_lo=max(0.0, acc - 1.96 * se),
                         acc_ci_hi=min(1.0, acc + 1.96 * se),
                         chance=ch, acc_above_chance=above))
    df = pd.DataFrame(rows)

    verdict = dict(motion_type=motion_type, engaged=None, drop_above_chance=np.nan,
                   reason="only one load condition present")
    if set(conds) >= {"low", "high"}:
        aL = df.loc[df.load == "low", "acc_above_chance"].iloc[0]
        aH = df.loc[df.load == "high", "acc_above_chance"].iloc[0]
        drop = aL - aH
        engaged = bool(drop >= ENGAGE_MIN_DROP)
        verdict.update(engaged=engaged, drop_above_chance=float(drop),
                       reason=("high-load RSVP cost present (a*_low - a*_high = %.2f >= %.2f)"
                               % (drop, ENGAGE_MIN_DROP)) if engaged else
                              ("NO differential load cost (a*_low - a*_high = %.2f < %.2f): "
                               "load halves of this run are not interpretable as a load effect"
                               % (drop, ENGAGE_MIN_DROP)))
    return df, verdict


def make_rsvp_sanity_figure(df, verdict, motion_type, out_png):
    """One-panel bar chart: RSVP accuracy by load with each condition's chance line."""
    import matplotlib as _mpl
    _mpl.use("Agg")
    import matplotlib.pyplot as _plt
    with _plt.rc_context({"font.size": 9, "axes.spines.top": False,
                          "axes.spines.right": False}):
        fig, ax = _plt.subplots(figsize=(3.6, 3.2))
        order = [lc for lc in ["low", "high"] if lc in list(df.load)]
        x = np.arange(len(order))
        bar_c = {"low": "#2166ac", "high": "#d6604d"}
        for i, lc in enumerate(order):
            r = df[df.load == lc].iloc[0]
            ax.bar(i, r.rsvp_acc, width=0.6, color=bar_c[lc], zorder=2,
                   yerr=[[r.rsvp_acc - r.acc_ci_lo], [r.acc_ci_hi - r.rsvp_acc]],
                   capsize=4, ecolor="0.3")
            # chance reference for this condition
            ax.plot([i - 0.35, i + 0.35], [r.chance, r.chance], "--", color="0.35",
                    lw=1.3, zorder=3)
            ax.annotate("chance", xy=(i + 0.36, r.chance), fontsize=6.5,
                        va="center", ha="left", color="0.35")
            ax.annotate("%.2f" % r.rsvp_acc, xy=(i, r.rsvp_acc), xytext=(0, 3),
                        textcoords="offset points", ha="center", fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(["Easy\n(low load)", "Hard\n(high load)"][:len(order)])
        ax.set_ylabel("Secondary-task (RSVP) accuracy")
        ax.set_ylim(0, 1.05)
        eng = verdict.get("engaged")
        tag = ("LOAD ENGAGED" if eng else "LOAD DID NOT ENGAGE") if eng is not None else "SINGLE LOAD"
        tcol = "#1a7a3a" if eng else ("#b22222" if eng is not None else "0.4")
        ax.set_title("%s — %s" % (MOTION_TASK_LABEL.get(motion_type, motion_type), tag),
                     loc="left", fontsize=9, color=tcol)
        if verdict.get("drop_above_chance") == verdict.get("drop_above_chance"):  # not NaN
            ax.annotate("above-chance drop\n(low - high) = %.2f" % verdict["drop_above_chance"],
                        xy=(0.5, 0.02), xycoords="axes fraction", ha="center",
                        va="bottom", fontsize=6.5, color=tcol)
        fig.tight_layout()
        fig.savefig(out_png, dpi=200, bbox_inches="tight")
        _plt.close(fig)


def analyze_one_type(rdk_t, motion_type, args, prefix):
    """Full pipeline (psychometric + secondary + checks) for one motion type."""
    conds = [c for c in ["low", "high"] if c in rdk_t.load_condition.unique()]
    labels = {"low": "Easy RSVP (low load)", "high": "Hard RSVP (high load)"}
    colors = {"low": "#2166ac", "high": "#d6604d"}

    # -- STANDING PRE-CHECK: did the load manipulation engage? ----------------
    sanity, verdict = rsvp_load_sanity(rdk_t, motion_type, conds)
    sanity.to_csv(os.path.join(args.out, prefix + "rsvp_load_sanity.csv"), index=False)
    make_rsvp_sanity_figure(sanity, verdict, motion_type,
                            os.path.join(args.out, prefix + "rsvp_load_sanity.png"))
    print("\n=== motion_type = %s : RSVP load pre-check ===" % motion_type)
    print(sanity.to_string(index=False))
    if verdict["engaged"] is False:
        print("  [WARN] " + verdict["reason"])
        print("  [WARN] Interpret this run's high-vs-low threshold contrast with caution.")
    elif verdict["engaged"] is True:
        print("  [OK]   " + verdict["reason"])
    else:
        print("  [--]   " + verdict["reason"])

    fits = {lc: fit_condition(rdk_t[rdk_t.load_condition == lc]) for lc in conds}
    boots = {lc: bootstrap_threshold(rdk_t[rdk_t.load_condition == lc],
                                     nboot=args.nboot, seed=42) for lc in conds}

    rows = []
    for lc in conds:
        f, b = fits[lc], boots[lc]
        lo, md, hi = np.percentile(b, [2.5, 50, 97.5])
        rows.append(dict(motion_type=motion_type, condition=lc,
                         n_trials=int(f["grouped"].n.sum()),
                         alpha=f["alpha"], beta=f["beta"], lapse=f["lapse"],
                         thr75=f["thr75"], thr75_boot_median=md,
                         thr75_ci_lo=lo, thr75_ci_hi=hi, nll=f["nll"]))
    params = pd.DataFrame(rows)
    params.to_csv(os.path.join(args.out, prefix + "weibull_params.csv"), index=False)
    print("\n=== motion_type = %s ===" % motion_type)
    print("Task: %s" % MOTION_TASK_LABEL.get(motion_type, motion_type))
    print(params.to_string(index=False))

    if set(conds) >= {"low", "high"}:
        m = min(len(boots["low"]), len(boots["high"]))
        d = boots["high"][:m] - boots["low"][:m]
        qd = np.percentile(d, [2.5, 50, 97.5])
        print(f"high - low 75%-threshold: median={qd[1]:.3f} "
              f"95% CI [{qd[0]:.3f}, {qd[2]:.3f}]  "
              f"(positive = predicted load cost; frac>0 = {(d>0).mean():.2f})")

    ttl = MOTION_TASK_LABEL.get(motion_type, motion_type)
    make_figure(fits, boots, labels, colors,
                os.path.join(args.out, prefix + "weibull_fit.png"), suptitle=ttl)

    # secondary (RSVP) task
    rsvp = analyze_secondary_task(rdk_t, conds, labels, colors, args.out,
                                  nboot=max(args.nboot, 2000), prefix=prefix)
    rsvp.insert(0, "motion_type", motion_type)
    print("Secondary-task (RSVP) trade-off slope by load:")
    print(rsvp.to_string(index=False))

    # manipulation checks
    dbias = direction_bias_table(rdk_t, motion_type)
    dbias.to_csv(os.path.join(args.out, prefix + "direction_bias.csv"), index=False)
    print("Direction bias (accuracy + choice rate by sign):")
    print(dbias.to_string(index=False))
    if motion_type == "spiral":
        srad = spiral_radial_table(rdk_t)
        if not srad.empty:
            srad.insert(0, "motion_type", motion_type)
            srad.to_csv(os.path.join(args.out, prefix + "spiral_radial_check.csv"), index=False)
            print("Spiral radial nuisance (accuracy by unjudged expand/contract):")
            print(srad.to_string(index=False))
    return params, verdict


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--out", default=".")
    ap.add_argument("--nboot", type=int, default=2000)
    ap.add_argument("--motion-type", dest="motion_type", default=None,
                    choices=["translation", "rotation", "spiral"],
                    help="analyse only this motion type (default: every type in the data)")
    ap.add_argument("--photometry", default="display_photometry.json",
                    help="lab endpoint-luminance file (cd/m^2); used to annotate "
                         "cross-type thresholds with per-display contrast when the "
                         "runs span >1 display. Ignored if missing/unfilled.")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    rdk = load_rdk(args.csv)

    # Which motion types are present? Analyse each separately.
    types_present = list(pd.unique(rdk["motion_type"]))
    if args.motion_type:
        types_present = [t for t in types_present if t == args.motion_type]
        if not types_present:
            raise SystemExit("No rows with motion_type == %r in this file." % args.motion_type)
    # stable order translation, rotation, spiral, then anything else
    order = {"translation": 0, "rotation": 1, "spiral": 2}
    types_present.sort(key=lambda t: order.get(t, 99))

    single = len(types_present) == 1
    all_params = []
    verdicts = []
    for mt in types_present:
        rdk_t = rdk[rdk["motion_type"] == mt].copy()
        # Prefix outputs with the type unless the file holds exactly one type
        # (keeps legacy single-run filenames: weibull_fit.png, etc.).
        prefix = "" if single else (mt + "_")
        p, verdict = analyze_one_type(rdk_t, mt, args, prefix)
        all_params.append(p)
        verdicts.append(verdict)

    # Consolidated load-engagement summary (standing pre-check across all runs).
    vdf = pd.DataFrame(verdicts)
    vdf.to_csv(os.path.join(args.out, "rsvp_load_sanity_summary.csv"), index=False)
    print("\n=== RSVP load-engagement pre-check (all runs) ===")
    for v in verdicts:
        tag = ("OK  " if v["engaged"] else "WARN") if v["engaged"] is not None else "--  "
        drop = v["drop_above_chance"]
        drop_s = ("%.2f" % drop) if drop == drop else " n/a"
        print("  [%s] %-11s above-chance drop=%s  %s"
              % (tag, v["motion_type"], drop_s, v["reason"]))
    if any(v["engaged"] is False for v in verdicts):
        print("  Runs flagged WARN: their high-vs-low threshold contrast is NOT a "
              "valid load effect (the load manipulation did not differentiate).")

    # Cross-type threshold comparison when >1 type is present in one file.
    if len(all_params) > 1:
        combined = pd.concat(all_params, ignore_index=True)
        # Tag each run with the display it was collected on, so a cross-type
        # threshold difference that coincides with a display change is visible.
        fp = display_fingerprint(args.csv)
        # If lab endpoint photometry is available, match each run to its display
        # and attach measured black/white luminance + Michelson contrast.
        photometry = load_photometry(args.photometry)
        fp["display"] = fp["px2mm"].map(lambda x: match_display(x, photometry))
        for col in ["L_black_cd_m2", "L_white_cd_m2", "michelson_contrast"]:
            fp[col] = np.nan
        if photometry is not None:
            for i, row in fp.iterrows():
                d = photometry.get(row["display"]) if row["display"] else None
                if d:
                    fp.at[i, "L_black_cd_m2"] = d["L_black"]
                    fp.at[i, "L_white_cd_m2"] = d["L_white"]
                    fp.at[i, "michelson_contrast"] = d["michelson"]
        merge_cols = ["motion_type", "px2mm", "view_dist_mm", "refresh", "os",
                      "browser", "display", "L_black_cd_m2", "L_white_cd_m2",
                      "michelson_contrast"]
        combined = combined.merge(fp[merge_cols], on="motion_type", how="left")
        combined.to_csv(os.path.join(args.out, "weibull_params_all_types.csv"), index=False)
        print("\n=== cross-type 75%% thresholds (low load) ===")
        show = ["motion_type", "thr75", "thr75_ci_lo", "thr75_ci_hi", "px2mm"]
        if photometry is not None and fp["michelson_contrast"].notna().any():
            show += ["display", "michelson_contrast"]
        else:
            show += ["os"]
        piv = combined[combined.condition == "low"][show]
        print(piv.to_string(index=False))
        if not fp.attrs["same_display"]:
            print("\n  [DISPLAY CONFOUND] Runs were NOT all on the same display "
                  "(px2mm spread=%.0f%%)." % (100 * fp.attrs["px2mm_spread"]))
            print("  Spatial scaling is equated by the chinrest, but luminance/"
                  "contrast/gamma/persistence are not. Any cross-type threshold")
            print("  difference is confounded with display type — treat as "
                  "provisional until a same-display replicate is collected.")
            mc = fp["michelson_contrast"].dropna()
            if len(mc) >= 2:
                spread = mc.max() - mc.min()
                print("  Measured dot/background Michelson contrast: "
                      "%.4f–%.4f (Δ=%.4f) — %s." % (
                          mc.min(), mc.max(), spread,
                          "contrast is closely matched, so it is unlikely to "
                          "explain the threshold difference" if spread < 0.02
                          else "contrast differs materially and could contribute "
                               "to the threshold difference"))
            elif photometry is None:
                print("  (Fill analysis/display_photometry.json with measured "
                      "cd/m^2 endpoints to quantify the contrast difference.)")
            fp.to_csv(os.path.join(args.out, "display_fingerprint.csv"), index=False)
        print("Wrote weibull_params_all_types.csv")

    if single:
        print("\nWrote rsvp_load_sanity.png/.csv, weibull_fit.png, weibull_params.csv, "
              "rsvp_tradeoff.png, rsvp_tradeoff_params.csv, direction_bias.csv, "
              "rsvp_load_sanity_summary.csv to", args.out)
    else:
        print("\nWrote per-type {type}_rsvp_load_sanity.png/.csv / _weibull_fit.png / "
              "_params.csv / _rsvp_tradeoff.png / _direction_bias.csv "
              "(+ spiral_radial_check.csv), plus rsvp_load_sanity_summary.csv to", args.out)

if __name__ == "__main__":
    main()
