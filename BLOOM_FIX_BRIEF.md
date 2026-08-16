# Task brief: fix the Phosphor "glow" (bloom) effect

This is a self-contained handoff. You do not need any prior chat context. Everything is in `src/App.jsx` (single-file React app; Vite; deploys to Vercel from `main`).

## What the effect is
"Phosphor glow" is a **bloom**: isolate the bright highlights of the rendered (dithered) image, blur them, and add them back on top so bright areas softly bleed light. It's one slider (`phosphorGlow`, 0–100) in the **Effects** panel. It is a separate effect from **Luminance lift** (a flat additive white overexposure) — keep them separate; do not merge.

## Symptoms to fix (reported by the product owner)
1. **The slider is quantized.** Moving glow does nothing across most of the range; it only visibly changes at a few values. e.g. 87, 88, 89 look identical, then it jumps. Bloom must increase **smoothly and continuously** at every step from 0→100.
2. **Grain "swims."** On an image with visible dither grain / noise, sliding the glow makes the grain move/shift around the image instead of the haze just growing smoothly. The blur must be **stable/deterministic** so the pattern doesn't jump as the slider moves.
3. **(History) it didn't render on mobile at all.** The original bloom used `ctx.filter = 'blur(Npx)'`. **WebKit/Safari — i.e. every iOS browser — does not implement `CanvasRenderingContext2D.filter`.** It's a silent no-op there, so on iPhone the highlights got composited **unblurred**, which just looked like brightened highlights, not bloom. **Do not use `ctx.filter`.**

## Where the code is
- File: `src/App.jsx`
- Function: `applyAtmosphere(canvas, { phosphorGlow, luminanceLift, scanlines, noise, chromaShift, phosphorGrid, darkColor })`
- The bloom is the `if (phosphorGlow > 0) { ... }` block (search for `phosphorGlow>0`), currently ~line 621.
- `applyAtmosphere` is called from two places (both must keep working): `renderSettingsToCanvas` (preset thumbnails) and `composeOutput` (live preview at ~900px **and** export at native res up to 4096px).
- Order note: glow runs **before** the `noise` effect in `applyAtmosphere`, so glow never blurs the Noise-effect grain — the swimming grain is the **dither grain** already baked into the highlights.

## Root cause of the current bad behavior
Current implementation (the block to replace):
```js
// isolate highlights (keep this idea)
const knee=0.5;
for each pixel: v=max(r,g,b)/255; wt = v>knee ? (v-knee)/(1-knee) : 0; brightLayer = pixel*wt;

// BAD blur: a down→up mipmap pyramid
const levels = Math.round(3 + g*4);            // <-- INTEGER: only 3..7, ~4 discrete steps → quantized slider
// halve `levels` times, then double back up
// screen-composite:
ctx.globalAlpha = Math.min(1, g*1.5);          // <-- pins at 1 for g>=0.667, so above 67% nothing changes either
ctx.globalCompositeOperation='screen'; ctx.drawImage(bloom,0,0);
```
- `levels` is integer → blur **radius** is quantized to ~4 values → the "only changes at specific numbers" bug.
- `alpha` saturates at 1 for g ≥ ~0.67 → above 67% neither radius nor intensity changes.
- Integer halving (`width>>1`) + a changing number of levels shifts the resample grid frame-to-frame → the blurred grain lands in different places → "swimming."

## The original (v1) bloom, for reference (the look to reproduce)
```js
const blurPx = g * Math.min(w,h) * 0.06;       // CONTINUOUS radius
blctx.filter = `blur(${blurPx}px)`;            // Gaussian — smooth, continuous... but ctx.filter is unsupported on iOS
blctx.drawImage(bright, 0, 0);
ctx.globalCompositeOperation = 'screen';
ctx.globalAlpha = Math.min(1, g*1.5);
ctx.drawImage(blur, 0, 0);
```
It was smooth and continuous **because the Gaussian radius `blurPx` was a continuous function of `g`**. The only problem was `ctx.filter` not existing on iOS. **The correct fix is to reproduce that continuous-radius Gaussian with a JS blur that works everywhere — not to use a discrete pyramid.**

## The plan
Replace the pyramid blur with a **continuous-radius separable blur implemented in JS** (no `ctx.filter`):

1. Keep the highlight isolation (the `knee` / `wt` loop) that builds the bright layer.
2. Blur the bright layer with a **separable box blur using running sums, 3 passes ≈ Gaussian**. Box blur via running sums is **O(w·h) per pass regardless of radius**, so it's fast even at 4096px.
   - Radius must be **continuous**: `radius = g * Math.min(w,h) * 0.06` (match the old feel; tune the constant). No rounding to discrete buckets — a fractional radius is fine (either lerp between two integer box widths, or just `Math.round` the radius but keep it a *large, continuous-ish* value so ±1px steps are invisible; the key is it changes on every slider step, unlike the current 4-bucket `levels`).
   - 3 box passes approximate a Gaussian and remove box-blur artifacts.
3. **Optional performance step (keep it STABLE):** downscale the bright layer to a **fixed** working resolution (e.g. long side capped at 512px) *independent of the slider*, blur there with a proportionally-scaled radius, then upscale once. Fixed resolution = the resample grid never shifts with the slider = **no swimming**. Do NOT make the working resolution depend on `g`.
4. Composite additively (`globalCompositeOperation='screen'`, or `'lighter'` for a punchier glow) with a **continuous** intensity. Don't hard-saturate alpha early; if you want a strong max, scale so it still visibly grows near 100 (e.g. drive both radius and a soft intensity from `g`).
5. Restore `ctx.imageSmoothingEnabled=false` afterward (the pipeline elsewhere relies on pixelated draws).

### Reference: separable box blur with running sums (sketch — implement/verify properly)
```js
// Blur an ImageData's RGB in place. r = integer radius. Call 3x for Gaussian-ish.
function boxBlurPass(data, w, h, r){
  const tmp = new Uint8ClampedArray(data.length);
  const win = r*2+1;
  // horizontal
  for(let y=0;y<h;y++){
    let ri=0,gi=0,bi=0;
    const row=y*w*4;
    for(let x=-r;x<=r;x++){ const xx=Math.min(w-1,Math.max(0,x))*4+row; ri+=data[xx]; gi+=data[xx+1]; bi+=data[xx+2]; }
    for(let x=0;x<w;x++){
      const o=row+x*4; tmp[o]=ri/win; tmp[o+1]=gi/win; tmp[o+2]=bi/win; tmp[o+3]=255;
      const add=Math.min(w-1,x+r+1)*4+row, sub=Math.max(0,x-r)*4+row;
      ri+=data[add]-data[sub]; gi+=data[add+1]-data[sub+1]; bi+=data[add+2]-data[sub+2];
    }
  }
  // vertical (read tmp -> write data)
  for(let x=0;x<w;x++){
    let ri=0,gi=0,bi=0; const col=x*4;
    for(let y=-r;y<=r;y++){ const yy=Math.min(h-1,Math.max(0,y))*w*4+col; ri+=tmp[yy]; gi+=tmp[yy+1]; bi+=tmp[yy+2]; }
    for(let y=0;y<h;y++){
      const o=y*w*4+col; data[o]=ri/win; data[o+1]=gi/win; data[o+2]=bi/win; data[o+3]=255;
      const add=Math.min(h-1,y+r+1)*w*4+col, sub=Math.max(0,y-r)*w*4+col;
      ri+=tmp[add]-tmp[sub]; gi+=tmp[add+1]-tmp[sub+1]; bi+=tmp[add+2]-tmp[sub+2];
    }
  }
}
```
(StackBlur.js is a fine alternative if you'd rather use a vetted implementation — but keep the app self-contained; a small inline box blur is preferred over adding a dependency. Verify the running-sum indexing carefully.)

## Constraints / gotchas (important)
- **No `ctx.filter` anywhere.** It's the reason it broke on iOS.
- **`vite build` does NOT catch undeclared-variable / runtime errors** — a bare undefined var compiles to a global lookup and only throws at runtime. A "clean" build once shipped a blank-screen crash. **Always load the app in a browser and check the console**, don't trust the build alone.
- Bloom must be **continuous** over the full 0–100 (verify 87/88/89/90 all differ).
- Bloom must be **stable** (no grain swimming as the slider moves) — fixed working resolution, deterministic blur.
- Bloom must be **additive** (base preserved). Verify: pick a pure-white highlight pixel; it should be **byte-identical at glow 0 and glow 100** (only a soft halo appears around it), not muted.
- Keep **performant** at export (up to 4096px). Running-sum box blur is O(w·h)/pass; the fixed-downscale approach keeps it cheap.
- Two callers of `applyAtmosphere` must both keep working (thumbnails + preview/export).

## Acceptance criteria (how to verify before shipping)
1. Load the app; **no console errors**.
2. Slide `phosphor glow` slowly 0→100 on a bright image: the bloom grows **smoothly at every step** (spot-check 87→88→89→90 each look different).
3. On a grainy/noisy image, sliding glow does **not** make the grain swim; the haze just spreads/intensifies smoothly.
4. On a white highlight, the pixel value is identical at glow 0 vs glow 100 (additive; whites not muted).
5. Looks like a **soft, uniform Gaussian bloom** (no blocks, no hard edges).
6. Confirm on a real iOS Safari device (or note that it's untestable in the harness — but the no-`ctx.filter` requirement guarantees iOS parity).

## Commit/deploy
- Single file: `src/App.jsx`. Commit to `main`; Vercel auto-deploys.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
