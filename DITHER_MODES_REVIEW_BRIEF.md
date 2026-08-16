# Task brief: fix the dither "broken grid" artifacts (non-integer pixel upscale)

Self-contained handoff. No prior chat context needed. Everything is in `src/App.jsx` (single-file React app; Vite; deploys to Vercel from `main`).

## THE REAL BUG (confirmed by the product owner + verified in code/math)
On dither presets (seen clearly on **Grid / ordered patterns with custom palettes**), a mid-to-high range of the **Detail** slider renders a **broken, non-uniform pixel grid** — cells merge into uneven squares and the clean pixelated look falls apart. Owner's repro on the **Grid** pattern:
- **Detail 77** → good-ish
- **Detail 82–98** → awful: pixels merge, uneven squares, grid breaks, loses the pixelated effect
- **Detail 100** → perfect again

### Root cause
`renderDither` (in `src/App.jsx`) pixelates by:
1. downscaling the image to a small buffer `sw × sh` where `sw = Math.max(1, Math.round(w/px))` (line ~456),
2. dithering at that small size,
3. **nearest-neighbor upscaling** back to full size: `ctx.imageSmoothingEnabled=false; ctx.drawImage(small, 0,0, sw,sh, 0,0, w,h)` (lines ~471 and ~541 — one for the adaptive branch, one for the palette branch).

`px` comes from `detailToSize('dither', detail)` = `max * (min/max)^(detail/100)` with `DETAIL_RANGE.dither = [1, 26]` (line ~149). This returns a **fractional** `px`, so **`w/sw` is a non-integer** for almost the whole top half of the slider. Nearest-neighbor upscaling by a non-integer ratio produces **unevenly sized cells** (some 1px, some 2px, …) → the "broken grid."

Verified numbers (preview width ≈ 900):

| detail | px | sw=round(900/px) | upscale 900/sw | |
|---|---|---|---|---|
| 77 | 2.116 | 425 | 2.118 | fractional (big cells, unevenness hidden) |
| 82 | 1.798 | 501 | 1.796 | fractional → broken |
| 90 | 1.385 | 650 | 1.385 | fractional → broken |
| 98 | 1.067 | 843 | 1.068 | fractional → broken |
| 100 | 1.000 | 900 | **1.000 integer** | clean |

So: the recalibrated geometric Detail curve put most of the slider in a **fractional-`px` (fractional-upscale) zone**, and nearest-neighbor upscaling can't render a uniform grid there.

### NOT the cause (ruled out by the owner — do not chase these)
- **Not** the adaptive color path (`ditherAdaptive`). The bug shows on **custom-palette** presets.
- **Not** the diffusion/"grain" algorithm — its kernel is unchanged (see naming note below).
- **Not** serpentine, not a preset `algo` change.

## The fix: integer pixelation (uniform cells at every Detail)
Make the pixel cell size an **integer** and upscale by that **exact integer**, so every cell is uniform:

```js
// in renderDither, replace the fractional sw/sh + full-size upscale:
const c  = Math.max(1, Math.round(px));            // integer cell size in output px
const sw = Math.max(1, Math.ceil(w / c));          // ceil so sw*c >= w (fully covers, edge cropped)
const sh = Math.max(1, Math.ceil(h / c));
// ... dither into out[sw*sh*4] exactly as today ...
sctx.putImageData(new ImageData(out, sw, sh), 0, 0);
const canvas = /* w × h */;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.drawImage(small, 0, 0, sw, sh, 0, 0, sw*c, sh*c);   // <-- integer upscale: every cell exactly c×c; overhang cropped at w×h
```
Key points:
- Apply to **both** upscale sites in `renderDither` (adaptive-branch output and palette-branch output) — the `sw/sh` computation and the final `drawImage` are shared, so fixing `sw = ceil(w/c)` and drawing to `sw*c × sh*c` fixes both color modes.
- Because `ditherAdaptive` just fills the `sw × sh` buffer that `renderDither` upscales, fixing `renderDither` fixes the adaptive path too — but the owner says palette is where it's visible; verify both look clean.
- This makes **Detail quantized to integer cell sizes** (px = 1,2,3,…). Consequence: several adjacent slider values (e.g. 82–98, which map to px≈1.07–1.8 → round to 1 or 2) will collapse to the same clean look. That's expected and acceptable — a clean grid beats fractional steps. If the owner wants more *distinct* high-detail steps, retune `DETAIL_RANGE.dither` / the curve so the integer buckets spread more evenly across the slider (secondary, get sign-off).

## Where to change it
- `src/App.jsx`:
  - `renderDither(...)` — `sw`/`sh` (~456) and the two `ctx.drawImage(small,0,0,sw,sh,0,0,w,h)` (~471, ~541).
  - `detailToSize` / `DETAIL_RANGE` (~149) — only if retuning steps.
- `renderDither` is also used by **preset thumbnails** (`renderSettingsToCanvas`) and **SVG export** (`buildDitherSVG`). After changing the upscale, confirm:
  - **Preview** (renders at ~900px via `composeOutput(900)`) and **export** (native res up to 4096, `px` scaled by `max(w,h)/900`) both produce a clean uniform grid and look consistent to each other.
  - Thumbnails still render.
  - SVG export (`buildDitherSVG`) still traces the pixels correctly (it reads the rendered canvas — check its dimension assumptions after switching to `sw*c × sh*c`).
- Halftone and ASCII modes have their own sizing; the owner's bug is **dither-specific** — scope to dither, but sanity-check the others didn't inherit a similar fractional-scale issue.

## Secondary (naming — lower priority, get sign-off)
Historical rename the owner flagged (for reference; the owner said **"Grid 4×4" is a fine name** now that multiple grid sizes exist):
- v1 dither labels were `GRID` (`bayer`), `CROSS` (`cross`), `GRAIN` (`diffusion`), `ATKINSON` (`atkinson`).
- `diffusion`'s label was changed **GRAIN → "Floyd–Steinberg"** (kernel byte-identical: `{div:16, taps:[[1,0,7],[-1,1,3],[0,1,5],[1,1,1]]}`). The owner liked "Grain." Consider renaming the label back to **"Grain"** (pure label change; do NOT touch the `diffusion` key or kernel). This is independent of the rendering bug above.
- `cross` key was renamed to `diamond` (`CROSS_8X8` → `DIAMOND_8X8`); no preset references `algo:'cross'` anymore. Just verify nothing regressed.

## Constraints / gotchas
- `vite build` does **not** catch undeclared-variable runtime errors (they become global lookups that throw at runtime). **Load the app and check the browser console**, not just the build.
- Dither changes must be verified **visually on a real image** — code review alone won't show the grid unevenness.
- Keep it **performant** at export (up to 4096px).
- Preview and export must match; thumbnails and SVG export must keep working.

## Acceptance criteria
1. Slide **Detail 0 → 100 slowly** on a **custom-palette Grid** preset: **every** value renders a **uniform pixel grid** — no merged/uneven cells, no "broken grid." Specifically verify the previously-broken **82–98** range is now clean.
2. The pixel cells are visibly **uniform in size** at any Detail (integer cells).
3. Preview and full-res export look consistent; thumbnails and SVG export still work.
4. No other mode regressed (spot-check Blue noise, Atkinson, Floyd–Steinberg/Grain, Diamond).
5. App loads with **no console errors**.

## Commit/deploy
- Single file: `src/App.jsx`. Commit to `main`; Vercel auto-deploys.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Appendix — reproduce the math
```
node -e "const [mn,mx]=[1,26], f=d=>mx*Math.pow(mn/mx,d/100), w=900;
[77,82,90,98,100].forEach(d=>{const px=f(d),sw=Math.round(w/px);
console.log(d, px.toFixed(3), sw, (w/sw).toFixed(3), Number.isInteger(w/sw)?'INT':'FRACTIONAL');});"
```
