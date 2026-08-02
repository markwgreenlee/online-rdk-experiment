"""
verify_motion_energy_online.py — Independent check that translation / rotation /
spiral are equated for MOTION ENERGY in the flat online RDK, the online analog of
the desktop pipeline's verify_motion_energy.py.

The desktop experiment equates a kinematic ME proxy <area * speed^2> over visible
dots on a funnel/cone. Online the dots are CONSTANT size, so area factors out and
the proxy reduces to the area-weighted <speed^2> across the annulus. The plugin
(plugins/plugin-rdk-load.js) builds the three velocity fields to hold that equal:

    <r^2> = (rOuter^2 + rInner^2)/2                (uniform-density annulus)
    translation: every signal dot moves at v      -> <speed^2> = v^2
    rotation:    omega = v / sqrt(<r^2>)           -> <speed^2> = omega^2<r^2> = v^2
    spiral:      k = v / sqrt(2<r^2>) (45deg screw) -> <speed^2> = 2k^2<r^2>   = v^2

This script re-measures <speed^2> per type by Monte-Carlo, reproducing the
plugin's DISCRETE per-frame update (finite step + annulus respawn), so it catches
implementation drift, not just the intended analytic field. Respawn frames are
excluded (a teleport is not coherent motion).

Two honest caveats, both logged (not hidden), matching the desktop pipeline:
  - Only <speed^2> (RMS speed) is matched. The mean speed and the speed
    DISTRIBUTION differ: translation is a delta at v; rotation and spiral spread
    local speed over omega*r (same RMS, lower mean). You cannot match both the
    second moment and the mean of a spatially-extended rotational field.
  - A rendered Adelson-Bergen filterbank is NOT used: online every noise dot
    teleports each frame (broadband flicker, identical across types), so an AB /
    full-field measure is dominated by the noise pedestal and cannot discriminate
    the types. The coherent (signal) kinematic energy is the operative quantity.

Headless. Run once per aperture geometry:  python verify_motion_energy_online.py
"""
import numpy as np

# ---- geometry (config.js defaults) ----
R_IN, R_OUT = 2.0, 7.0     # aperture inner/outer radius, deg
V = 6.0                    # signal dot speed, deg/s (translation reference)
REFRESH = 60.0             # Hz
COH = [0.04, 0.08, 0.16, 0.32, 0.64]
ME_TOL = 0.08              # OK if |dev from v^2| under this (desktop tolerance)
N = 400_000                # Monte-Carlo dots

dt = 1.0 / REFRESH
meanR2 = (R_OUT**2 + R_IN**2) / 2.0
OMEGA = V / np.sqrt(meanR2)         # rad/s
K = V / np.sqrt(2 * meanR2)         # 1/s


def _sample_annulus(n, rng):
    r = np.sqrt(rng.uniform(size=n) * (R_OUT**2 - R_IN**2) + R_IN**2)  # area-weighted
    th = rng.uniform(0, 2 * np.pi, size=n)
    return r * np.cos(th), r * np.sin(th)


def _in_annulus(x, y):
    rr = np.hypot(x, y)
    return (rr >= R_IN) & (rr <= R_OUT)


def signal_speed2(mtype, n=N, seed=0):
    """<speed^2> and mean speed (deg/s) for a signal dot under the plugin's exact
    discrete update; respawn frames excluded."""
    rng = np.random.default_rng(seed)
    x, y = _sample_annulus(n, rng)
    if mtype == "translation":
        x2, y2 = x + V * dt, y.copy()
    elif mtype == "rotation":
        a = OMEGA * dt; c, s = np.cos(a), np.sin(a)
        x2, y2 = x * c - y * s, x * s + y * c            # radius preserved
    elif mtype == "spiral":
        a = K * dt; c, s = np.cos(a), np.sin(a); rf = 1 + K * dt
        x2, y2 = (x * c - y * s) * rf, (x * s + y * c) * rf
    else:
        raise ValueError(mtype)
    keep = _in_annulus(x2, y2)
    sp = np.hypot((x2 - x)[keep], (y2 - y)[keep]) / dt
    return float(np.mean(sp**2)), float(np.mean(sp)), float(np.mean(keep))


def verify(tol=ME_TOL):
    print("Online RDK motion-energy equating check")
    print("  <speed^2> = area-weighted mean over the annulus (the EQUATED quantity);")
    print("  mean speed is NOT equated (logged for transparency).\n")
    print(f"  aperture {R_IN}-{R_OUT} deg | v={V} deg/s | target <speed^2>=v^2={V**2:.1f}")
    print(f"  omega={OMEGA:.4f} rad/s | k={K:.4f} /s | tol={tol*100:.0f}%\n")
    ref = None
    rows = {}
    for mt in ["translation", "rotation", "spiral"]:
        s2, msp, kept = signal_speed2(mt)
        if ref is None:
            ref = s2
        rows[mt] = (s2, msp, kept, (s2 - ref) / ref)
    print(f"  {'type':11s} {'<speed^2>':>10s} {'RMS':>7s} {'mean':>7s} {'dev':>8s}  kept")
    all_ok = True
    for mt, (s2, msp, kept, dev) in rows.items():
        ok = abs(dev) <= tol
        all_ok &= ok
        print(f"  {mt:11s} {s2:10.3f} {np.sqrt(s2):7.3f} {msp:7.3f} "
              f"{dev*100:+7.2f}% {'OK' if ok else 'CHECK':>5s}  {kept*100:4.1f}%")
    print(f"\n  Signal ME {'matched across all types' if all_ok else 'EXCEEDS tolerance'} "
          f"(max |dev| = {max(abs(r[3]) for r in rows.values())*100:.2f}%).")
    print("  Because noise dots teleport identically for all types, the full-field")
    print("  proxy ME(c)=c*signal+(1-c)*noise is matched across types at every")
    print("  coherence by construction.")
    return all_ok


if __name__ == "__main__":
    verify()
