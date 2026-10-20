"""
design_figures.py — regenerate design_velocity_fields.png.

The velocity fields are reproduced from the SAME formulas the plugin uses
(plugins/plugin-rdk-load.js), so the figure cannot drift from the stimulus:

    <r^2> = (rOuter^2 + rInner^2) / 2            (uniform-density annulus)
    translation : uniform v in +x                -> |v| = v           (constant)
    rotation    : tangential, omega = v/sqrt(<r^2>)  -> |v| = omega*r (grows with r)
    spiral      : 45 deg screw, k = v/sqrt(2<r^2>)   -> |v| = sqrt(2)*k*r = omega*r
    radial      : uniform radial speed v          -> |v| = v           (constant)

Note rotation and spiral share an identical speed MAGNITUDE field and differ
only in direction; translation and radial are both flat at v. All four have
area-weighted RMS speed = v, which is the equating the design relies on.

Arrow lengths are proportional to local speed with ONE scale factor shared
across panels, so the panels are directly comparable by eye.

Usage:  python design_figures.py          (writes design_velocity_fields.png)
Dependencies: numpy, matplotlib.
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---- geometry (must match config.js) ----
R_IN, R_OUT = 2.0, 7.0      # aperture inner/outer radius, deg
V = 6.0                     # signal dot speed, deg/s
N_ARROWS = 150
SEED = 3

meanR2 = (R_OUT**2 + R_IN**2) / 2.0
OMEGA = V / np.sqrt(meanR2)          # rad/s   (rotation)
K = V / np.sqrt(2 * meanR2)          # 1/s     (spiral)

# Keep the three original panel hues; radial gets a distinct fourth.
PANELS = [
    ("Translation", "#2b6cb0", ("left", "right"), ("\u2190", "\u2192")),
    ("Rotation",    "#c45508", ("CCW", "CW"),     ("\u2190", "\u2192")),
    ("Spiral",      "#238b45", ("CCW", "CW"),     ("\u2190", "\u2192")),
    ("Radial",      "#7b3f99", ("contracting", "expanding"), ("\u2190", "\u2192")),
]


def sample_annulus(n, rng):
    """Area-weighted uniform sample of the annulus."""
    r = np.sqrt(rng.uniform(size=n) * (R_OUT**2 - R_IN**2) + R_IN**2)
    th = rng.uniform(0, 2 * np.pi, size=n)
    return r * np.cos(th), r * np.sin(th)


def velocity(kind, x, y):
    """Signal-dot velocity (deg/s) at (x, y), per the plugin's formulas."""
    r = np.hypot(x, y)
    if kind == "Translation":
        return np.full_like(x, V), np.zeros_like(y)        # rightward
    if kind == "Rotation":                                  # CW on screen
        return -OMEGA * y, OMEGA * x
    if kind == "Spiral":                                    # CW + expanding
        return K * (x - y), K * (y + x)
    if kind == "Radial":                                    # expanding, |v| = V
        return V * x / r, V * y / r
    raise ValueError(kind)


def make_velocity_field_figure(out_png="design_velocity_fields.png"):
    rng = np.random.default_rng(SEED)
    x, y = sample_annulus(N_ARROWS, rng)

    fig = plt.figure(figsize=(16.5, 8.0))
    gs = fig.add_gridspec(1, 4, left=0.02, right=0.98, top=0.95, bottom=0.34,
                          wspace=0.06)
    # One shared arrow scale so panels are comparable by eye. With
    # angles/scale_units='xy' the drawn length in DATA units is magnitude/scale,
    # so fixing the longest arrow at ARROW_MAX_DEG sets the scale.
    speeds = [np.hypot(*velocity(p[0], x, y)) for p in PANELS]
    ARROW_MAX_DEG = 1.25                       # longest arrow, in degrees
    scale = max(s.max() for s in speeds) / ARROW_MAX_DEG

    for i, (name, colour, alts, keys) in enumerate(PANELS):
        ax = fig.add_subplot(gs[0, i])
        u, v = velocity(name, x, y)
        ax.quiver(x, y, u, v, color=colour, angles="xy", scale_units="xy",
                  scale=scale, width=0.0065, headwidth=3.6,
                  headlength=4.2, headaxislength=3.6, zorder=3)
        for rad in (R_IN, R_OUT):
            ax.add_patch(plt.Circle((0, 0), rad, fill=False, color="#8a8a8a",
                                    lw=1.1, zorder=5))
        ax.plot(0, 0, "o", ms=5, color="#e8000b", zorder=4)
        ax.set_title(name, color=colour, fontsize=17, pad=12)
        ax.set_xlim(-R_OUT * 1.12, R_OUT * 1.12)
        ax.set_ylim(-R_OUT * 1.12, R_OUT * 1.12)
        ax.set_aspect("equal")
        ax.axis("off")

        # response-mapping strip under each panel
        xc = (gs[0, i].get_position(fig).x0 + gs[0, i].get_position(fig).x1) / 2
        half = (gs[0, i].get_position(fig).x1 - gs[0, i].get_position(fig).x0) / 2
        fig.text(xc - half * 0.52, 0.22, f"{keys[0]}  {alts[0]}", color=colour,
                 fontsize=13.5, fontweight="bold", ha="center", va="center")
        fig.text(xc + half * 0.52, 0.22, f"{alts[1]}  {keys[1]}", color=colour,
                 fontsize=13.5, fontweight="bold", ha="center", va="center")
        fig.lines.append(plt.Line2D([xc, xc], [0.185, 0.255], color="#b0b0b0",
                                    lw=1.0, transform=fig.transFigure))
        fig.text(xc, 0.155, "arrow key \u2192 judged direction", color="#6e6e6e",
                 fontsize=11, ha="center", va="center")

    fig.text(0.5, 0.055,
             "Annulus 2\u20137\u00b0 \u00b7 all four matched on area-weighted RMS retinal "
             "speed (6\u00b0/s). Arrow length \u221d local speed, one scale for all panels.",
             fontsize=12.5, color="#2a2a2a", ha="center", va="center")
    fig.text(0.5, 0.018,
             "Radial is judged by its expansion/contraction sign; the spiral's radial "
             "sign is a balanced logged nuisance and only its rotational sense is judged.",
             fontsize=12.5, color="#2a2a2a", ha="center", va="center")
    fig.savefig(out_png, dpi=150, facecolor="white")
    return fig


if __name__ == "__main__":
    f = make_velocity_field_figure()
    print("wrote design_velocity_fields.png")
    # report the speed statistics the figure is asserting
    rng = np.random.default_rng(SEED)
    xx, yy = sample_annulus(200000, rng)
    for name, *_ in PANELS:
        sp = np.hypot(*velocity(name, xx, yy))
        print(f"  {name:12s} RMS={np.sqrt(np.mean(sp**2)):6.3f} deg/s  "
              f"mean={sp.mean():6.3f}  min={sp.min():6.3f}  max={sp.max():6.3f}")
