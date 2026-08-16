# Task brief: review the dither modes (a beloved "GRAIN" look changed)

Self-contained handoff. No prior chat context needed. Everything is in `src/App.jsx` (single-file React app; Vite; deploys to Vercel from `main`).

## What the product owner reported
- There used to be a dither mode called **"GRAIN"** that they loved. It's gone from the UI, and they suspect it was renamed to **"Floyd–Steinberg"** — but they're worried the **output also changed**, not just the label.
- Other modes ("Atkinson", etc.) had different names before and were renamed.
- They asked (in past sessions) for **more** dither modes; instead existing ones appear to have been **changed/renamed without explicit sign-off**.
- The visible symptom: the output **used to feel like dispersed grain**, and now shows **vertical, squiggly lines that are not dispersed**.

Goal of this task: **review what actually changed, restore the "grain" feel/name the owner wants, and do it without silently altering other modes.** Confirm each finding against git before changing anything.

## Confirmed history (verified via git — treat as ground truth)
Original modes in the core commit `4c84179` (dropdown was `{[['bayer','GRID'],['cross','CROSS'],['diffusion','GRAIN'],['atkinson','ATKINSON']]}`):

| internal `algo` key | original label | what it is |
|---|---|---|
| `bayer` | **GRID** | ordered Bayer 4×4 |
| `cross` | **CROSS** | ordered `CROSS_8X8` matrix (size 8, max 8) |
| `diffusion` | **GRAIN** | **Floyd–Steinberg** error diffusion (7/16, 3/16, 5/16, 1/16), on luminance |
| `atkinson` | **ATKINSON** | Atkinson error diffusion |

Current modes (dropdown, `renderingPanel` in `src/App.jsx`):
`Grid 2×2` (`bayer2`), `Grid 4×4` (`bayer`), `Grid 8×8` (`bayer8`), `Diamond` (`diamond`), `Blue noise` (`bluenoise`), `Floyd–Steinberg` (`diffusion`), `Jarvis` (`jjn`), `Stucki` (`stucki`), `Sierra` (`sierra`), `Atkinson` (`atkinson`), `Riemersma` (`riemersma`).

### What changed, precisely
1. **`diffusion` was relabeled GRAIN → "Floyd–Steinberg."** The **kernel is byte-identical** to v1: current `DIFFUSION_KERNELS.diffusion = { div:16, taps:[[1,0,7],[-1,1,3],[0,1,5],[1,1,1]] }` == the original inline `7/16, 3/16, 5/16, 1/16`. **So on the palette path the GRAIN algorithm was NOT changed — only the name.**
2. **`cross` key was renamed to `diamond`** ("CROSS" → "Diamond"; `CROSS_8X8` → `DIAMOND_8X8`, still size 8 / max 8). A short-lived real cross-hatch "Cross" was added then removed. **No preset references `algo:'cross'` anymore (0)** — so any old preset that used `cross` would now fall back to the default. Verify none silently changed look.
3. **Added modes:** Grid 2×2, Grid 8×8, Diamond, Blue noise, Jarvis, Stucki, Sierra, Riemersma (commits `c6a4873` Stucki/Sierra/blue-noise, `58b8180` Jarvis).
4. **NEW "adaptive" color path** (did not exist in v1). `dcolor:'adaptive'` runs `ditherAdaptive(...)` — a **per-channel RGB** error diffusion / ordered dither (hue-preserving), which is a **different pattern** from the v1 luminance-based palette diffusion. **10 presets now use `dcolor:'adaptive'`; 18 still use `algo:'diffusion'`.**
5. **Detail control was unified** (commit `1f85c13` "Unify dot/cell size into one intuitive Detail control") and later recalibrated. This changes the **cell/pixel size** (grain scale), which changes how the same algorithm *reads* even if the math is unchanged.

## Most likely cause of "vertical squiggly lines, not dispersed" (hypotheses to confirm)
Investigate in this order:
1. **Adaptive path.** The strongest suspect. A "grain" preset the owner loved may have been switched from `dcolor:'palette'` + `algo:'diffusion'` (clean luminance Floyd–Steinberg = dispersed grain) to `dcolor:'adaptive'`. `ditherAdaptive` diffuses **each RGB channel independently**, which produces structured, directional, "squiggly" artifacts rather than dispersed monochrome-tone grain. **Reproduce:** apply a palette `diffusion` preset vs an adaptive preset at the same Detail and compare.
2. **Non-serpentine Floyd–Steinberg worms.** FS here scans strictly left→right, top→bottom (no serpentine/boustrophedon) in **both** v1 and current — so in smooth gradients it produces directional "worm" artifacts. If the **Detail recalibration** made cells larger, or tone curves smoother, those worms become far more visible and can read as squiggly lines. Compare v1 vs current cell size for the same Detail.
3. **A preset's `algo` was changed** to something path-following (e.g. `riemersma`, which literally follows a Hilbert curve and looks like squiggles) or a different diffusion. Audit preset diffs (below).
4. **Phosphor grid confusion (rule out):** a recently added `phosphorGrid` effect draws vertical RGB stripes. It defaults to 0, but confirm the owner isn't seeing that effect rather than the dither.

## How to review what changed (concrete steps)
- Diff every preset's dither settings against v1:
  - `git show 4c84179:src/App.jsx` (original DEVICES/presets) vs current `LOOK_PRESETS`.
  - For each preset, compare `algo` and `dcolor`. Flag any that moved from palette→adaptive, or whose `algo` changed. Restore the owner's original intent unless the change was requested.
- Confirm the `diffusion` kernel and the `ditherAdaptive` diffusion are what you think, in `src/App.jsx`:
  - `renderDither(...)` — palette path (luminance `work` buffer, `DIFFUSION_KERNELS`, ordered `qOrd`, `riemersma`).
  - `ditherAdaptive(...)` — adaptive path (per-channel `R/G/B` buffers, ordered/riemersma/diffusion branches).
  - `DIFFUSION_KERNELS` (~line 284), `ORDERED_PATTERNS` (~line 41), default `const [algo] = useState('bayer')` (~line 915).
- Reproduce on a real image and capture before/after (v1 GRAIN vs current) so the owner can see the difference.

## Recommended fixes (get owner sign-off on scope first)
1. **Rename it back to "Grain"** (or "Grain (Floyd–Steinberg)") in the dropdown — pure label change, zero risk, directly addresses "grain is gone." Do NOT change the `diffusion` key or kernel.
2. **Add serpentine scanning to the Floyd–Steinberg / diffusion loops** (alternate row direction). This breaks up the directional worms and makes the grain read as **dispersed**, closer to the v1 feel — without changing which algorithm it is. Apply consistently to both `renderDither` and `ditherAdaptive` diffusion branches.
3. **Audit + restore presets** that were silently switched palette→adaptive or had `algo` changed, if that's what altered the beloved look. Only change presets the owner didn't ask to change.
4. **Do not alter the behavior of any existing mode** beyond (2); if you improve dispersion, keep it opt-in-feeling (same name, better quality) and confirm it still matches the v1 grain character.
5. Optionally re-expose friendly names for the others if the owner wants (GRID, etc.) — but that's cosmetic and secondary.

## Constraints / gotchas
- Two render paths must both be handled and must match visually where they share an algorithm: **`renderDither` (palette/device fixed palette)** and **`ditherAdaptive` (adaptive color)**. A change to one without the other will make the same "mode" look different depending on color mode.
- `renderDither`/`ditherAdaptive` are also used for **preset thumbnails** (`renderSettingsToCanvas`) and **SVG export** (`buildDitherSVG`) — keep those consistent.
- `vite build` does **not** catch undeclared-variable runtime errors (they become global lookups, throw at runtime). **Load the app and check the browser console**, not just the build.
- The output must be verified **visually** on a real image — dither changes are not obvious from code alone. Compare against v1 (`git show 4c84179:src/App.jsx`, or run the old commit) for the grain character.
- Keep it performant at export (up to 4096px). Error diffusion is O(w·h); serpentine adds no cost.

## Acceptance criteria
1. The mode the owner calls "grain" is present and clearly named (e.g. "Grain"), and its output **reads as dispersed grain**, not vertical squiggly lines, on a normal photo.
2. No other existing mode's output changed unintentionally (spot-check Grid, Atkinson, Diamond, Blue noise, Riemersma before/after).
3. Any preset whose look regressed is restored to the owner's intent.
4. Palette and adaptive color modes render the shared algorithm consistently.
5. App loads with no console errors; thumbnails and SVG export still work.

## Commit/deploy
- Single file for logic: `src/App.jsx`. Commit to `main`; Vercel auto-deploys.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Appendix — quick git references
- Original modes & GRAIN label: `git show 4c84179:src/App.jsx | grep -n "'diffusion','GRAIN'"`
- Original diffusion kernel: `git show 4c84179:src/App.jsx | sed -n '99,110p'`
- Detail unification: `git show 1f85c13 -- src/App.jsx`
- Added algos: `git show c6a4873`, `git show 58b8180`
- cross→diamond rename: search commits for "Diamond" / "Cross".
