import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, Plus, X, ZoomIn, ZoomOut, Share2, ArrowLeftRight, ChevronDown, Circle, Square, Diamond, Minus, RotateCcw, Undo2, Redo2, Info, Eye, LayoutGrid, Grid3x3, Contrast, Palette, Radio, Save, Copy, Heart, Globe, Sparkles, SlidersHorizontal, Image as ImageIcon, ImagePlus, Sun } from 'lucide-react';

// Filter glyph (overlapping circles) for the Presets tab, à la Lightroom/Instagram.
const FilterIcon = ({size=17}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="10" r="5.5"/>
    <circle cx="15" cy="10" r="5.5"/>
    <circle cx="12" cy="15.5" r="5.5"/>
  </svg>
);
import LZString from 'lz-string';

const GITHUB_URL = 'https://github.com/dreegu';   // profile
const AUTHOR_URL = 'https://rodrigosilva.design';
const LINKEDIN_URL = '';   // set to enable the LinkedIn icon in the About modal
const DEFAULT_DETAIL = 88; // the global detail every non-device preset lands on (linear
// dither curve, snapped to a 4-unit stop: 88 = exactly 4px cells, ~the old geometric 55)





// ─── DITHER MATRICES ────────────────────────────────────────────────────────
// Recursive Bayer (ordered) matrix generator — order 2/4/8 give coarser→finer grids.
const B2 = [[0,2],[3,1]];
function genBayer(order){
  let m=[[0]], s=1;
  while(s<order){ const ns=s*2, nm=Array.from({length:ns},()=>Array(ns).fill(0));
    for(let y=0;y<ns;y++) for(let x=0;x<ns;x++) nm[y][x]=4*m[y%s][x%s]+B2[Math.floor(y/s)][Math.floor(x/s)];
    m=nm; s=ns; }
  return m;
}
// The old "cross" pattern — kept as Diamond, which is what it actually looks like.
const DIAMOND_8X8 = [
  [0,1,2,3,4,5,6,7],[1,0,1,2,3,4,5,0],[2,3,0,1,2,3,0,1],[3,4,5,0,1,0,1,2],
  [4,5,6,7,0,1,2,3],[3,4,5,0,1,0,1,2],[2,3,0,1,2,3,0,1],[1,0,1,2,3,4,5,0],
];
// Real cross-hatch: rank cells by proximity to EITHER diagonal, so as tone darkens the
// pixels fill in along both diagonals — forming X / stitch strokes in the shadows.
const ORDERED_PATTERNS = {
  bayer2:  { matrix: genBayer(2), size: 2, max: 4 },
  bayer:   { matrix: genBayer(4), size: 4, max: 16 },
  bayer8:  { matrix: genBayer(8), size: 8, max: 64 },
  diamond: { matrix: DIAMOND_8X8,    size: 8, max: 8 },
};

// Riemersma dithering diffuses error along a Hilbert space-filling curve, so error travels
// in a locally-continuous path instead of scanline order — no directional grain, a soft
// even texture. Cache the curve's pixel order per grid size (recomputing it every render
// would stutter on slider drags).
let _hilbert = { key: '', order: null };
function hilbertOrder(w, h) {
  const key = w + 'x' + h;
  if (_hilbert.key === key) return _hilbert.order;
  let n = 1; while (n < Math.max(w, h)) n *= 2;
  const order = new Int32Array(w * h); let idx = 0;
  for (let d = 0; d < n * n && idx < order.length; d++) {
    let t = d, x = 0, y = 0;
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const tmp = x; x = y; y = tmp; }
      x += s * rx; y += s * ry; t >>= 2;
    }
    if (x < w && y < h) order[idx++] = y * w + x;
  }
  _hilbert = { key, order };
  return order;
}
// Weighted error history: most-recent error weighted 1, decaying to 1/16 over 16 steps.
const RIEM_N = 16;
const RIEM_W = Array.from({ length: RIEM_N }, (_, k) => Math.pow(1 / 16, k / (RIEM_N - 1)));

const ASCII_RAMPS = {
  standard: { label:'STANDARD', chars:' .:-=+*#%@' },
  blocks:   { label:'BLOCKS',   chars:' \u2591\u2592\u2593\u2588' },
  numeric:  { label:'NUMERIC',  chars:' 1234567890' },
  symbols:  { label:'SYMBOLS',  chars:' \u00b7\u2219\u2022\u25e6\u25cb\u25cf' },
  code:     { label:'CODE',     chars:' .,;:!?/\\|()[]{}<>' },
  dense:    { label:'DENSE',    chars:" `^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
};


const PALETTE_PRESETS = {
  amber:    { name:'PHOSPHOR AMBER', colors:['#1a1410','#5c4a32','#a8865a','#f4e4c1'] },
  green:    { name:'MEMORY GREEN',   colors:['#0a1612','#1f3d33','#5a9b7f','#c8e8c8'] },
  red:      { name:'SIGNAL RED',     colors:['#1a1025','#5c2a3a','#a8455a','#e8c9a8'] },
  duo:      { name:'DUOTONE',        colors:['#7a3530','#e8c9a0'] },
  terminal: { name:'TERMINAL',       colors:['#000000','#00ff41'] },
  sepia:    { name:'SEPIA',          colors:['#1c0a00','#532b00','#c68642','#f5deb3'] },
  navy:     { name:'NAVY',           colors:['#0d1b2a','#1b4965','#5fa8d3','#cae9ff'] },

  // ── media-referenced palettes (from look presets) ──
  blame: { name:'BLAME!', colors:['#000000','#f0f0f0'], anchors:[0,1] },
  hollow_knight: { name:'HOLLOW KNIGHT', colors:['#000000','#d8e8f8'], anchors:[0,1] },
  gattaca: { name:'GATTACA', colors:['#141810','#c8b46c'], anchors:[0,1] },
  space_odyssey: { name:'2001', colors:['#000000','#ffffff'], anchors:[0,1] },
  stranger_things: { name:'STRANGER THINGS', colors:['#000000','#660000','#ffffff'], anchors:[0,0.35,1] },
  metal_gear_solid: { name:'METAL GEAR', colors:['#050a05','#304430','#c8e0b0'], anchors:[0,0.5,1] },
  stalker: { name:'STALKER', colors:['#0c0a08','#8a7e6c','#f0ece4'], anchors:[0,0.45,1] },
  ex_machina: { name:'EX MACHINA', colors:['#060808','#5a6a60','#f0f4f0'], anchors:[0,0.45,1] },
  doom: { name:'DOOM', colors:['#000000','#880000','#ff8844'], anchors:[0,0.4,1] },
  castlevania: { name:'CASTLEVANIA', colors:['#000010','#880000','#f0e8d0'], anchors:[0,0.5,1] },
  astral_chain: { name:'ASTRAL CHAIN', colors:['#000000','#110022','#0044ff','#ffffff'], anchors:[0,0.2,0.55,1] },
  shovel_knight: { name:'SHOVEL KNIGHT', colors:['#000000','#1a0044','#6600aa','#e8d888'], anchors:[0,0.33,0.66,1] },
  stardew_valley: { name:'STARDEW VALLEY', colors:['#1a3a10','#2a6a40','#88bb44','#ffe8a8'], anchors:[0,0.2,0.6,1] },
  outrun: { name:'OUTRUN', colors:['#0a0020','#660066','#cc0088','#ffee00'], anchors:[0,0.3,0.65,1] },
  hal9000: { name:'HAL 9000', colors:['#0a0000','#3d0000','#8b0000','#cc2200','#ff6644'], anchors:[0,0.4,0.65,0.85,1] },
  ghost_shell: { name:'GHOST IN THE SHELL', colors:['#000d0d','#003333','#006666','#00ccaa','#e0fffa'], anchors:[0,0.35,0.6,0.85,1] },
  tron: { name:'TRON', colors:['#000000','#001a33','#003366','#0099cc','#00eeff'], anchors:[0,0.3,0.55,0.8,1] },
  solaris: { name:'SOLARIS', colors:['#0d0800','#3d2b1f','#7a5c3f','#c8a882','#f5ead8'], anchors:[0,0.2,0.45,0.72,1] },
  her: { name:'HER', colors:['#2d0f0f','#7a3030','#c47850','#e8b090','#faeae0'], anchors:[0,0.2,0.5,0.78,1] },
  videodrome: { name:'VIDEODROME', colors:['#0a0008','#330022','#882244','#cc6688','#ffddee'], anchors:[0,0.2,0.5,0.78,1] },
  brazil: { name:'BRAZIL', colors:['#0f0a00','#4a3800','#8a6a20','#c8a850','#f5e8b0'], anchors:[0,0.25,0.5,0.75,1] },
  two046: { name:'2046', colors:['#0a0000','#3d0010','#880030','#cc4422','#f0c060'], anchors:[0,0.2,0.5,0.78,1] },
  strange_days: { name:'STRANGE DAYS', colors:['#050010','#1a0044','#5500aa','#cc44ff','#f0ccff'], anchors:[0,0.2,0.5,0.78,1] },
  wings_honneamise: { name:'WINGS OF HONNEAMISE', colors:['#0a1020','#1a3050','#4488aa','#88ccdd','#e8f4f8'], anchors:[0,0.2,0.5,0.78,1] },
  paranoia_agent: { name:'PARANOIA AGENT', colors:['#0a0010','#2a0044','#882288','#ffaacc','#fff0f8'], anchors:[0,0.2,0.5,0.78,1] },
  back_to_future: { name:'BACK TO THE FUTURE', colors:['#000511','#001a44','#0044cc','#ff6600','#ffffff'], anchors:[0,0.3,0.6,0.85,1] },
  interstellar: { name:'INTERSTELLAR', colors:['#050200','#1a0800','#4a2000','#c87020','#f8e090'], anchors:[0,0.4,0.65,0.85,1] },
  avatar: { name:'AVATAR', colors:['#000814','#001a33','#003366','#0099aa','#44ffcc'], anchors:[0,0.35,0.6,0.82,1] },
  westworld: { name:'WESTWORLD', colors:['#060608','#1a1c20','#4a4c54','#9aa0aa','#f0f4f8'], anchors:[0,0.25,0.5,0.75,1] },
  cyberpunk: { name:'CYBERPUNK', colors:['#0a0010','#330022','#880044','#ff0088','#ffee00'], anchors:[0,0.15,0.45,0.78,1] },
  cowboy_bebop: { name:'COWBOY BEBOP', colors:['#080810','#1a1830','#4a3848','#c89050','#f8e0a0'], anchors:[0,0.15,0.45,0.78,1] },
  serial_experiments_lain: { name:'SERIAL EXP. LAIN', colors:['#050508','#1a1a20','#444450','#aaaacc','#eeeeff'], anchors:[0,0.2,0.5,0.78,1] },
  perfect_blue: { name:'PERFECT BLUE', colors:['#000814','#001a44','#0044aa','#88aadd','#f0f4ff'], anchors:[0,0.2,0.5,0.78,1] },
  nausicaa: { name:'NAUSICAÄ', colors:['#100818','#3a2040','#7a5888','#88b8a0','#e8f0d0'], anchors:[0,0.2,0.5,0.78,1] },
  dorohedoro: { name:'DOROHEDORO', colors:['#080808','#1c1c10','#444430','#888860','#44ff44'], anchors:[0,0.25,0.55,0.78,1] },
  silent_hill: { name:'SILENT HILL', colors:['#0a0505','#2a1010','#6a3020','#aa7060','#e0c8b8'], anchors:[0,0.2,0.5,0.78,1] },
  streets_of_rage: { name:'STREETS OF RAGE', colors:['#000820','#001850','#0044aa','#ff8800','#ffeeaa'], anchors:[0,0.25,0.55,0.82,1] },
  ff7: { name:'FINAL FANTASY VII', colors:['#050010','#100030','#1a4a1a','#00cc44','#ccffaa'], anchors:[0,0.2,0.55,0.82,1] },
  another_world: { name:'ANOTHER WORLD', colors:['#000000','#000820','#001060','#0044aa','#88ccff'], anchors:[0,0.15,0.5,0.8,1] },
  celeste: { name:'CELESTE', colors:['#1a0a20','#3a2050','#c07090','#e8b8a0','#f8f0e0'], anchors:[0,0.2,0.55,0.82,1] },
  disco_elysium: { name:'DISCO ELYSIUM', colors:['#0c0c10','#2a2820','#4a4438','#6a6440','#8a8050','#b0a870','#e8e0b8'], anchors:[0,0.16,0.33,0.5,0.66,0.83,1] },
  akira: { name:'AKIRA', colors:['#000814','#03045e','#0077b6','#ff4d6d','#ffd6e0'], anchors:[0,0.2,0.5,0.8,1] },
  duotone_rust: { name:'RUST', colors:['#7a2a10','#f0dcc0'], anchors:[0,1] },
  duotone_navy: { name:'NAVY', colors:['#0a1428','#e8dfc8'], anchors:[0,1] },
  duotone_forest: { name:'FOREST', colors:['#0a2010','#eef4e0'], anchors:[0,1] },
  duotone_violet: { name:'VIOLET', colors:['#1a0838','#e8e0f4'], anchors:[0,1] },
};

// Baseline every look resets to, so a preset only declares what it changes.
const LOOK_BASE = { exposure:0, contrast:0, midtones:1, highlights:1, shadows:1, phosphorGlow:0, luminanceLift:0, scanlines:0, noise:0, chromaShift:0, phosphorGrid:0, saturation:100, asciiInvert:false, asciiCutout:0, asciiBold:false, dcolor:'palette', adaptiveCount:16, gamut:'full' };

// Unified "detail": 0-100 where higher = more detail. Maps to each mode's underlying
// cell/dot size (smaller size = finer = more detail), so the control reads intuitively.
// [finest, coarsest] cell size in px, calibrated to the 900px preview. Finest = 1px so the
// top of the slider is meaningful in the preview (below that is sub-pixel and invisible);
// coarsest raised for chunkier dots/cells at detail 0.
const DETAIL_RANGE = { dither:[1,26], ascii:[5,26], halftone:[1.5,26] };
// Dither cells are integer px, so only ~26 distinct outputs exist. Snap the Detail slider
// to one stop per integer cell (px 26→1) so EVERY notch changes the grid — no dead in-between
// values. 100 / (26-1 intervals) = 4 per step, and each 4-unit stop lands on an integer px.
const DITHER_DETAIL_STEP = 100 / (DETAIL_RANGE.dither[1] - DETAIL_RANGE.dither[0]);
// Geometric mapping (halftone/ascii): equal ratio per step, so dragging feels even.
// Dither is the exception — its cells are quantized to integer px (uniform-grid fix), so a
// geometric curve piles many slider values onto the same integer at the fine end (a dead
// zone at the top) and front-loads all the big visual jumps at the coarse end. Linear =
// equal px difference per step, so every notch changes the grid across the whole slider.
function detailToSize(mode, detail){
  const [min,max] = DETAIL_RANGE[mode] || DETAIL_RANGE.halftone;
  const d = Math.max(0, Math.min(100, detail))/100;
  if (mode==='dither') return max - (max-min)*d;
  return max * Math.pow(min/max, d);
}
function sizeToDetail(mode, size){
  const [min,max] = DETAIL_RANGE[mode] || DETAIL_RANGE.halftone;
  const s = Math.max(min, Math.min(max, size));
  if (mode==='dither') return Math.round(Math.max(0, Math.min(100, 100*(max-s)/(max-min))));
  return Math.round(Math.max(0, Math.min(100, 100*Math.log(s/max)/Math.log(min/max))));
}

// Each device's native horizontal resolution → a Detail level, so selecting a device
// pixelates the photo at that system's true pixel density (relative to the 900px preview
// reference the whole Detail scale is calibrated to). GB 160px works out to ~47, etc.
const DEVICE_NATIVE_W = {
  gameboy:160, gbcolor:160, gba:240, nes:256, playstation:320,
  c64:320, amiga:320, atarist:320, genesis:320, virtualboy:384, mac:512,
};
const deviceDetail = key => sizeToDetail('dither', 900 / DEVICE_NATIVE_W[key]);

// Look categories, in display order.
const CATEGORIES = [
  ['hardware','Devices'], ['soft','Soft'], ['cinematic','Cinematic'], ['poster','Poster'],
  ['vivid','Vivid'], ['duotone','Duotone'], ['mono','Monochrome'], ['riso','Riso'], ['type','Type'],
];

// Curated looks. A look sets colour + tone + mode, but NOT detail — that stays the
// user's, global. The exceptions carry `detail` and set carriesDetail:true (Hardware
// devices at native resolution, and STIPPLE); those stash and restore the user's detail.
const LOOK_PRESETS = [
  // ── Devices (adaptive + device gamut; Detail derived from each system's native resolution) ──
  { name:'GAME BOY', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'gameboy', detail:deviceDetail('gameboy') } },
  { name:'GAME BOY COLOR', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'gbcolor', detail:deviceDetail('gbcolor') } },
  { name:'GAME BOY ADVANCE', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'gba', detail:deviceDetail('gba') } },
  { name:'NES', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'nes', detail:deviceDetail('nes') } },
  { name:'PLAYSTATION', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'playstation', detail:deviceDetail('playstation') } },
  { name:'COMMODORE 64', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'c64', detail:deviceDetail('c64') } },
  { name:'AMIGA', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'amiga', detail:deviceDetail('amiga') } },
  { name:'ATARI ST', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'atarist', detail:deviceDetail('atarist') } },
  { name:'GENESIS', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'genesis', detail:deviceDetail('genesis') } },
  { name:'VIRTUAL BOY', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'virtualboy', detail:deviceDetail('virtualboy') } },
  { name:'MACINTOSH', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#000000',anchor:0},{color:'#ffffff',anchor:1}], detail:deviceDetail('mac') } },
  // ── Soft ──
  { name:'HER', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#2d0f0f',anchor:0},{color:'#7a3030',anchor:0.2},{color:'#c47850',anchor:0.5},{color:'#e8b090',anchor:0.78},{color:'#faeae0',anchor:1}], contrast:15, midtones:1.3, highlights:0.85, shadows:0.85, phosphorGlow:24 } },
  { name:'CELESTE', category:'soft', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#1a0a20',anchor:0},{color:'#3a2050',anchor:0.2},{color:'#c07090',anchor:0.55},{color:'#e8b8a0',anchor:0.82},{color:'#f8f0e0',anchor:1}], contrast:20, midtones:1.25, highlights:0.85, shadows:0.85, phosphorGlow:12 } },
  { name:'SILENT HILL', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#0c0c10',anchor:0},{color:'#2c2121',anchor:0.16},{color:'#5f534e',anchor:0.33},{color:'#7b7656',anchor:0.5},{color:'#a8a180',anchor:0.66},{color:'#cfcaab',anchor:0.83},{color:'#e9e5d3',anchor:1}], midtones:0.95, phosphorGlow:18, luminanceLift:10 } },
  { name:'PERFECT BLUE', category:'soft', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#030726',anchor:0},{color:'#172445',anchor:0.1},{color:'#082c76',anchor:0.18},{color:'#2477b7',anchor:0.31},{color:'#a6cbcd',anchor:0.69},{color:'#f3f4e6',anchor:1}], contrast:-11, midtones:1.1, highlights:1.5, shadows:1.2 } },
  { name:'METAL GEAR SOLID', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#041513',anchor:0.08},{color:'#1a5148',anchor:0.14},{color:'#117449',anchor:0.25},{color:'#3a9862',anchor:0.32},{color:'#83ce92',anchor:0.78},{color:'#a5dfc4',anchor:0.84},{color:'#d0e2da',anchor:0.95}], phosphorGlow:9, luminanceLift:30, scanlines:20 } },
  { name:'GHOST IN THE SHELL', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#1a1d1f',anchor:0.08},{color:'#21313f',anchor:0.13},{color:'#38658c',anchor:0.25},{color:'#7ac0e3',anchor:0.52},{color:'#7ac0e3',anchor:0.72},{color:'#ddc292',anchor:1}], contrast:-10, midtones:0.75, highlights:1.3, shadows:1.05, phosphorGlow:12, luminanceLift:20 } },
  { name:'TOEM', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#0c0c10',anchor:0.04},{color:'#333333',anchor:0.17},{color:'#616161',anchor:0.33},{color:'#808080',anchor:0.45},{color:'#a8a8a8',anchor:0.64},{color:'#cfcfcf',anchor:0.81},{color:'#e9e9e9',anchor:0.96}], contrast:10, midtones:0.95, highlights:0.95, shadows:0.95, phosphorGlow:9, luminanceLift:15 } },
  { name:'ANOTHER WORLD', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#302d1c',anchor:0.03},{color:'#584b38',anchor:0.13},{color:'#484967',anchor:0.21},{color:'#888888',anchor:0.33},{color:'#ada190',anchor:0.48},{color:'#c9a189',anchor:0.64},{color:'#e5c884',anchor:0.89}] } },
  // ── Cinematic ──
  { name:'DUNE', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#330d0a',anchor:0.07},{color:'#73230e',anchor:0.16},{color:'#b44b12',anchor:0.41},{color:'#df781d',anchor:0.53},{color:'#f39a2b',anchor:0.62},{color:'#fcc95d',anchor:0.73},{color:'#fcd788',anchor:0.82},{color:'#ecdec5',anchor:1}], contrast:-24, midtones:1.1, highlights:1.15, shadows:1.45 } },
  { name:'STRANGER THINGS', category:'cinematic', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#030726',anchor:0},{color:'#172445',anchor:0.1},{color:'#082c76',anchor:0.18},{color:'#b12323',anchor:0.33},{color:'#a6cbcd',anchor:0.69},{color:'#f3f4e6',anchor:1}], contrast:-11, midtones:1.1, highlights:1.5, shadows:1.2 } },
  { name:'VIDEODROME', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#0e132b',anchor:0.08},{color:'#035a8f',anchor:0.27},{color:'#9f3e8c',anchor:0.36},{color:'#c50012',anchor:0.46},{color:'#ea7d9c',anchor:0.52},{color:'#86b5c4',anchor:0.67},{color:'#3ac6bd',anchor:0.76},{color:'#e3ead9',anchor:0.92}], contrast:1 } },
  { name:'EDGERUNNERS', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#061012',anchor:0.04},{color:'#1f4240',anchor:0.19},{color:'#1f706b',anchor:0.37},{color:'#847ab7',anchor:0.46},{color:'#76c1a1',anchor:0.63},{color:'#e8f901',anchor:0.75},{color:'#c7dee5',anchor:0.83},{color:'#ece0f0',anchor:0.97}], phosphorGlow:11, luminanceLift:13 } },
  { name:'BACK TO THE FUTURE', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#16171d',anchor:0},{color:'#050f3e',anchor:0.08},{color:'#1a2a67',anchor:0.22},{color:'#b15527',anchor:0.39},{color:'#dd6227',anchor:0.52},{color:'#eab130',anchor:0.59},{color:'#d8c3ae',anchor:0.85}], noise:50 } },
  { name:'ANDOR', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#101826',anchor:0},{color:'#3a3d4a',anchor:0.14},{color:'#e8785a',anchor:0.41},{color:'#f0d8b0',anchor:0.91}], noise:45 } },
  { name:'FINAL FANTASY', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#021618',anchor:0},{color:'#1a4951',anchor:0.18},{color:'#2c8090',anchor:0.4},{color:'#6bbcae',anchor:0.5},{color:'#1ab788',anchor:0.61},{color:'#ebd0a7',anchor:0.76},{color:'#fce2e1',anchor:0.83},{color:'#fef3f1',anchor:0.96}], midtones:0.75, highlights:1.3, shadows:1.05, phosphorGlow:9, luminanceLift:20 } },
  { name:'DOOM', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#020202',anchor:0.05},{color:'#502f30',anchor:0.21},{color:'#cd3c32',anchor:0.49},{color:'#c87d50',anchor:0.59},{color:'#67975c',anchor:0.71},{color:'#97c47e',anchor:0.83},{color:'#f2d673',anchor:1}], contrast:-4, highlights:0.85, shadows:0.95 } },
  // ── Poster ──
  { name:'DISCO ELYSIUM', category:'poster', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#382015',anchor:0},{color:'#4e3f22',anchor:0.2},{color:'#545416',anchor:0.33},{color:'#7192a3',anchor:0.5},{color:'#b45629',anchor:0.63},{color:'#f5ac8a',anchor:0.73},{color:'#fcfcf0',anchor:0.91}], contrast:35, midtones:0.75, highlights:0.9, shadows:0.8, noise:20 } },
  { name:'BLADE RUNNER', category:'poster', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#251f30',anchor:0.11},{color:'#103a4a',anchor:0.36},{color:'#693238',anchor:0.55},{color:'#e93835',anchor:0.52},{color:'#237879',anchor:0.64},{color:'#f9f0da',anchor:0.84}], shadows:1.25 } },
  { name:'MAD MAX', category:'poster', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#010508',anchor:0.13},{color:'#0e3f3a',anchor:0.02},{color:'#347abc',anchor:0.27},{color:'#943b12',anchor:0.36},{color:'#c08316',anchor:0.61},{color:'#eeca03',anchor:0.77},{color:'#7bb7c1',anchor:0.87},{color:'#c6e5e6',anchor:0.94}], contrast:5, midtones:0.9, highlights:0.9, shadows:1.15, noise:40 } },
  { name:'CASTLEVANIA', category:'poster', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#000302',anchor:0.05},{color:'#18363f',anchor:0.34},{color:'#ca0507',anchor:0.76},{color:'#e2a99d',anchor:0.94}], phosphorGlow:9, luminanceLift:10 } },
  // ── Vivid ──
  { name:'CYBERPUNK', category:'vivid', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#0a0010',anchor:0.04},{color:'#330022',anchor:0.14},{color:'#880044',anchor:0.24},{color:'#ff0088',anchor:0.37},{color:'#50818b',anchor:0.42},{color:'#babc50',anchor:0.48},{color:'#ffee00',anchor:0.88}], phosphorGlow:15, luminanceLift:10, scanlines:10, chromaShift:3 } },
  { name:'AVATAR', category:'vivid', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#000814',anchor:0},{color:'#001a33',anchor:0.35},{color:'#003366',anchor:0.6},{color:'#0099aa',anchor:0.82},{color:'#44ffcc',anchor:1}], contrast:45, highlights:1.2, shadows:1.2, phosphorGlow:36 } },
  { name:'STREETS OF RAGE', category:'vivid', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#000820',anchor:0},{color:'#001850',anchor:0.25},{color:'#0044aa',anchor:0.55},{color:'#ff8800',anchor:0.82},{color:'#ffeeaa',anchor:1}], contrast:40, highlights:1.1, phosphorGlow:15 } },
  { name:'CHANTS OF SENNAAR', category:'vivid', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#8e2111',anchor:0.11},{color:'#c92c3d',anchor:0.36},{color:'#9f5417',anchor:0.52},{color:'#61bc81',anchor:0.55},{color:'#cc9e24',anchor:0.64},{color:'#ffea38',anchor:0.84}] } },
  { name:'ASTRAL CHAIN', category:'vivid', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#010103',anchor:0},{color:'#10146a',anchor:0.1},{color:'#2436d6',anchor:0.55},{color:'#973fac',anchor:0.63},{color:'#b3a3dc',anchor:0.83}], midtones:1.6, highlights:0.85, shadows:2.05, phosphorGlow:15, luminanceLift:25 } },
  // ── Duotone ──
  { name:'ROSE', category:'duotone', settings:{ mode:'halftone', htShape:'circle', htInk:'#4a1020', htPaper:'#f6d5c9', htAngle:45, contrast:20, midtones:1.1, highlights:0.9 } },
  { name:'NAVY', category:'duotone', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#0a1428',anchor:0},{color:'#e8dfc8',anchor:1}], contrast:35, midtones:1.1, highlights:0.9 } },
  { name:'FOREST', category:'duotone', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#0a2010',anchor:0},{color:'#eef4e0',anchor:1}], contrast:30, midtones:1.15, highlights:0.9 } },
  { name:'VIOLET', category:'duotone', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#1a0838',anchor:0},{color:'#e8e0f4',anchor:1}], contrast:40 } },
  // ── Monochrome ──
  { name:'2001', category:'mono', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#000000',anchor:0},{color:'#ffffff',anchor:1}], contrast:55, midtones:0.85, highlights:1.2, shadows:1.35 } },
  { name:'GATTACA', category:'mono', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#141810',anchor:0},{color:'#c8b46c',anchor:1}], contrast:40, highlights:0.95 } },
  { name:'HOLLOW KNIGHT', category:'mono', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#000000',anchor:0},{color:'#d8e8f8',anchor:1}], contrast:45, midtones:0.95, highlights:1.1 } },
  { name:'STIPPLE', category:'mono', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#050505',anchor:0},{color:'#f4f2ec',anchor:1}], contrast:40, midtones:0.9, highlights:1.15, shadows:1.3 } },
  // ── Riso ──
  { name:'AKIRA MANGA', category:'riso', settings:{ mode:'halftone', htShape:'square', htInk:'#0a0808', htPaper:'#f4f0e8', htAngle:45, contrast:30 } },
  { name:'PAPRIKA', category:'riso', settings:{ mode:'halftone', htShape:'diamond', htInk:'#6600aa', htPaper:'#ff6600', htAngle:30, phosphorGlow:18 } },
  { name:'ARRIVAL', category:'riso', settings:{ mode:'halftone', htShape:'circle', htInk:'#0a0f1a', htPaper:'#8899aa', htAngle:60, contrast:20, phosphorGlow:12 } },
  { name:'JOURNEY', category:'riso', settings:{ mode:'halftone', htShape:'line', htInk:'#3a1a00', htPaper:'#f0c860', htAngle:0, contrast:20, midtones:1.1, highlights:0.9, phosphorGlow:15 } },
  // ── Type ──
  { name:'THE MATRIX', category:'type', settings:{ mode:'ascii', asciiRamp:'standard', asciiFg:'#00ff41', asciiBg:'#000000', asciiCutout:22, phosphorGlow:18, scanlines:25 } },
  { name:'AMBER TERMINAL', category:'type', settings:{ mode:'ascii', asciiRamp:'standard', asciiFg:'#ffb000', asciiBg:'#140e06', asciiCutout:20, phosphorGlow:18 } },
  { name:'ASCII CLASSIC', category:'type', settings:{ mode:'ascii', asciiRamp:'dense', asciiFg:'#1c1814', asciiBg:'#f8f6f0', asciiInvert:true, asciiCutout:32, contrast:30 } },
];

// Pool of sample images shown on entry (cycled by nextSampleIndex). Add more here.
const DEFAULT_POOL = [
  { image:'/samples/landscape-1.jpg',  fileName:'landscape-1.jpg' },
  { image:'/samples/landscape-2.jpg',  fileName:'landscape-2.jpg' },
  { image:'/samples/landscape-3.jpg',  fileName:'landscape-3.jpg' },
  { image:'/samples/landscape-4.jpg',  fileName:'landscape-4.jpg' },
  { image:'/samples/landscape-5.jpg',  fileName:'landscape-5.jpg' },
  { image:'/samples/landscape-6.jpg',  fileName:'landscape-6.jpg' },
  { image:'/samples/landscape-7.jpg',  fileName:'landscape-7.jpg' },
  { image:'/samples/landscape-8.jpg',  fileName:'landscape-8.jpg' },
  { image:'/samples/landscape-9.jpg',  fileName:'landscape-9.jpg' },
  { image:'/samples/landscape-10.jpg', fileName:'landscape-10.jpg' },
];

// Shuffle-bag over the sample pool, persisted in localStorage (shared across tabs of the
// same origin), so every fresh visit — reload, duplicated tab, new tab — advances to a
// different photo and the whole pool is shown before any repeats.
function nextSampleIndex(n) {
  if (n <= 1) return 0;
  const KEY = 'ps_sample_bag';
  let bag = null;
  try { bag = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
  if (!bag || bag.n !== n || !Array.isArray(bag.order) || bag.pos >= bag.order.length) {
    const order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const last = bag ? bag.last : null;
    if (last != null && order[0] === last) [order[0], order[1]] = [order[1], order[0]]; // no back-to-back repeat
    bag = { n, order, pos: 0, last };
  }
  const idx = bag.order[bag.pos];
  bag.pos += 1; bag.last = idx;
  try { localStorage.setItem(KEY, JSON.stringify(bag)); } catch { /* ignore */ }
  return idx;
}

function hexToRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
function luminance([r,g,b]) { return (0.299*r + 0.587*g + 0.114*b) / 255; }
let _id = 0;
function mkEntry(color, anchor) { return { id: _id++, color, anchor }; }

// Error-diffusion kernels: taps are [dx,dy,weight], distributed over div.
const DIFFUSION_KERNELS = {
  diffusion: { div:16, taps:[[1,0,7],[-1,1,3],[0,1,5],[1,1,1]] },                                                        // Floyd–Steinberg
  jjn:       { div:48, taps:[[1,0,7],[2,0,5],[-2,1,3],[-1,1,5],[0,1,7],[1,1,5],[2,1,3],[-2,2,1],[-1,2,3],[0,2,5],[1,2,3],[2,2,1]] }, // Jarvis–Judice–Ninke
  stucki:    { div:42, taps:[[1,0,8],[2,0,4],[-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2],[-2,2,1],[-1,2,2],[0,2,4],[1,2,2],[2,2,1]] },
  sierra:    { div:32, taps:[[1,0,5],[2,0,3],[-2,1,2],[-1,1,4],[0,1,5],[1,1,4],[2,1,2],[-1,2,2],[0,2,3],[1,2,2]] },
};

// 64×64 blue-noise threshold matrix via void-and-cluster (Ulichney).
// Generated once and cached on first use — not per render, not per click.
let _blueNoise = null;
function getBlueNoise() {
  if (_blueNoise) return _blueNoise;
  const N=64, NP=N*N, SIGMA=1.9, sig2=2*SIGMA*SIGMA, R=Math.ceil(SIGMA*3);
  const kernel=[];
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++) kernel.push([dx,dy,Math.exp(-(dx*dx+dy*dy)/sig2)]);
  const energy=new Float32Array(NP), binary=new Uint8Array(NP);
  const addEnergy=(p,sign)=>{ const px=p%N, py=(p/N)|0;
    for(const[dx,dy,wt]of kernel){ const x=(px+dx+N)%N, y=(py+dy+N)%N; energy[y*N+x]+=sign*wt; } };
  const tightest=()=>{ let b=-1,bv=-Infinity; for(let p=0;p<NP;p++) if(binary[p]&&energy[p]>bv){bv=energy[p];b=p;} return b; };
  const largest =()=>{ let b=-1,bv=Infinity;  for(let p=0;p<NP;p++) if(!binary[p]&&energy[p]<bv){bv=energy[p];b=p;} return b; };
  // deterministic init: ~10% ones via a small LCG so the pattern is reproducible
  let seed=1234567; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const idxs=[...Array(NP).keys()]; const initOnes=Math.round(NP*0.1);
  for(let i=0;i<initOnes;i++){ const j=i+Math.floor(rnd()*(NP-i)); [idxs[i],idxs[j]]=[idxs[j],idxs[i]]; binary[idxs[i]]=1; addEnergy(idxs[i],1); }
  // phase 1: relax initial pattern until swapping the tightest cluster into the largest void is a no-op
  for(;;){ const c=tightest(); binary[c]=0; addEnergy(c,-1); const v=largest();
    if(v===c){ binary[c]=1; addEnergy(c,1); break; } binary[v]=1; addEnergy(v,1); }
  const rank=new Int32Array(NP).fill(-1);
  const count=initOnes;
  // phase 2: remove ones one by one, ranking downward from count-1
  const b2=binary.slice(), e2=energy.slice();
  const tightest2=()=>{ let b=-1,bv=-Infinity; for(let p=0;p<NP;p++) if(b2[p]&&e2[p]>bv){bv=e2[p];b=p;} return b; };
  const addE2=(p,sign)=>{ const px=p%N,py=(p/N)|0; for(const[dx,dy,wt]of kernel){ const x=(px+dx+N)%N,y=(py+dy+N)%N; e2[y*N+x]+=sign*wt; } };
  for(let i=count-1;i>=0;i--){ const c=tightest2(); b2[c]=0; addE2(c,-1); rank[c]=i; }
  // phase 3: add ones into the voids, ranking upward from count
  const b3=binary.slice(), e3=energy.slice();
  const largest3=()=>{ let b=-1,bv=Infinity; for(let p=0;p<NP;p++) if(!b3[p]&&e3[p]<bv){bv=e3[p];b=p;} return b; };
  const addE3=(p,sign)=>{ const px=p%N,py=(p/N)|0; for(const[dx,dy,wt]of kernel){ const x=(px+dx+N)%N,y=(py+dy+N)%N; e3[y*N+x]+=sign*wt; } };
  for(let i=count;i<NP;i++){ const v=largest3(); b3[v]=1; addE3(v,1); rank[v]=i; }
  const matrix=[];
  for(let y=0;y<N;y++){ const row=[]; for(let x=0;x<N;x++) row.push(rank[y*N+x]); matrix.push(row); }
  _blueNoise={ matrix, size:N, max:NP };
  return _blueNoise;
}

// ─── ADAPTIVE COLOR ──────────────────────────────────────────────────────────
// Nearest palette color index by squared RGB distance.
function nearestIdx(r,g,b,pal){
  let best=0,bd=Infinity;
  for(let k=0;k<pal.length;k++){const p=pal[k];const dr=r-p[0],dg=g-p[1],db=b-p[2];const d=dr*dr+dg*dg+db*db;if(d<bd){bd=d;best=k;}}
  return best;
}
// Median-cut: derive an n-color palette from an array of [r,g,b] samples.
function medianCutPalette(samples,n){
  if(!samples.length) return [[0,0,0],[255,255,255]];
  const rangeOf=(box)=>{
    let r0=255,r1=0,g0=255,g1=0,b0=255,b1=0;
    for(const p of box){ if(p[0]<r0)r0=p[0]; if(p[0]>r1)r1=p[0]; if(p[1]<g0)g0=p[1]; if(p[1]>g1)g1=p[1]; if(p[2]<b0)b0=p[2]; if(p[2]>b1)b1=p[2]; }
    const dr=r1-r0,dg=g1-g0,db=b1-b0,mx=Math.max(dr,dg,db);
    return {span:mx, axis: mx===dr?0:(mx===dg?1:2)};
  };
  let boxes=[samples];
  while(boxes.length<n){
    let bi=-1,bspan=-1;
    for(let i=0;i<boxes.length;i++){ if(boxes[i].length<2) continue; const {span}=rangeOf(boxes[i]); if(span>bspan){bspan=span;bi=i;} }
    if(bi<0) break;
    const box=boxes[bi]; const {axis}=rangeOf(box);
    box.sort((a,b)=>a[axis]-b[axis]);
    const mid=box.length>>1;
    boxes.splice(bi,1,box.slice(0,mid),box.slice(mid));
  }
  return boxes.map(box=>{let r=0,g=0,b=0;for(const p of box){r+=p[0];g+=p[1];b+=p[2];}const m=box.length;return [Math.round(r/m),Math.round(g/m),Math.round(b/m)];});
}
// RGB↔HSL so we can revive an adaptive palette. Median-cut returns the mean of each colour
// box, and averaging always drifts toward grey — the reason adaptive output looks washed out
// next to the source. We push saturation back up (and add a little tonal punch) so it reads
// like pixel art, not a foggy day, while keeping each colour's own hue.
function rgbToHsl(r,g,b){ r/=255;g/=255;b/=255; const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let h=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){ const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4; h/=6; } return [h,s,l]; }
function hslToRgb(h,s,l){ if(s===0){const v=Math.round(l*255);return [v,v,v];}
  const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
  const f=t=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
  return [Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)]; }
// Vibrance, not flat saturation: lift muted colours a lot, already-saturated ones barely —
// this is what pulls the median-cut means back out of the sepia/grey they average into.
function vividPalette(pal,satMul=1.75,contrast=1.14){
  return pal.map(([r,g,b])=>{ let [h,s,l]=rgbToHsl(r,g,b);
    s=Math.min(1, s*(satMul-(satMul-1)*s));
    l=Math.max(0,Math.min(1,0.5+(l-0.5)*contrast)); return hslToRgb(h,s,l); });
}

// Authentic hardware colour sets. Small fixed palettes map by nearest colour; bit-depth
// gamuts derive a palette from the photo then snap each colour to the console's channel grid.
const DEVICE_GAMUTS = {
  gameboy:     { label:'Game Boy',       palette:['#0f380f','#306230','#8bac0f','#9bbc0f'] },
  gbcolor:     { label:'Game Boy Color', bits:5, max:16 },
  gba:         { label:'Game Boy Advance', bits:5, max:32, desat:0.45 },   // washed-out AGB LCD
  nes:         { label:'NES',            palette:['#000000','#fcfcfc','#f8f8f8','#bcbcbc','#7c7c7c','#a4e4fc','#3cbcfc','#0078f8','#0000fc','#b8b8f8','#6888fc','#0058f8','#0000bc','#d8b8f8','#9878f8','#6844fc','#4428bc','#f8b8f8','#f878f8','#d800cc','#940084','#f8a4c0','#f85898','#e40058','#a80020','#f0d0b0','#f87858','#f83800','#a81000','#fce0a8','#fca044','#e45c10','#881400','#f8d878','#f8b800','#ac7c00','#503000','#d8f878','#b8f818','#00b800','#007800','#b8f8b8','#58d854','#00a800','#006800','#b8f8d8','#58f898','#00a844','#005800','#00fcfc','#00e8d8','#008888','#f8f8f8','#787878'] },
  playstation: { label:'PlayStation',    bits:5, max:48 },
  c64:         { label:'Commodore 64',   palette:['#000000','#ffffff','#880000','#aaffee','#cc44cc','#00cc55','#0000aa','#eeee77','#dd8855','#664400','#ff7777','#333333','#777777','#aaff66','#0088ff','#bbbbbb'] },
  amiga:       { label:'Amiga',          bits:4, max:32 },
  atarist:     { label:'Atari ST',       bits:3, max:16 },
  genesis:     { label:'Genesis',        bits:3, max:48 },   // 9-bit RGB (3 bits/channel)
  virtualboy:  { label:'Virtual Boy',    palette:['#000000','#550000','#aa0000','#ff0000'] },
};

// Dither the image toward a palette derived FROM the image (hue preserved), optionally
// constrained to a device gamut. Fills `out`; returns the palette.
function ditherAdaptive(data,sw,sh,out,algo,getY,n,gamut,satMul=1.75,dAmt=1){
  const total=sw*sh;
  const R=new Float32Array(total),G=new Float32Array(total),B=new Float32Array(total);
  for(let i=0;i<total;i++){
    const di=i*4, r=data[di],g=data[di+1],b=data[di+2];
    const lum=luminance([r,g,b]), nl=getY(r,g,b), sc= lum>0.004? nl/lum : nl;   // hue-preserving tone
    R[i]=Math.min(255,r*sc); G[i]=Math.min(255,g*sc); B[i]=Math.min(255,b*sc);
  }
  const stride=Math.max(1,Math.floor(total/4000)), samples=[];
  for(let i=0;i<total;i+=stride) samples.push([R[i],G[i],B[i]]);
  const gm = gamut && gamut!=='full' ? DEVICE_GAMUTS[gamut] : null;
  let pal;
  if(gm && gm.palette){
    pal = gm.palette.map(hexToRgb);                                   // exact hardware colours
  } else if(gm && gm.bits){
    const levels=(1<<gm.bits)-1, snap=v=>Math.round(Math.round(v/255*levels)/levels*255);
    let base = medianCutPalette(samples, gm.max);
    if(gm.desat){ const k=gm.desat; base = base.map(([r,g,b])=>{ const l=0.299*r+0.587*g+0.114*b; return [r+(l-r)*k, g+(l-g)*k, b+(l-b)*k]; }); }
    pal = base.map(([r,g,b])=>[snap(r),snap(g),snap(b)]);  // snap to console grid
  } else {
    pal = vividPalette(medianCutPalette(samples, Math.max(2,Math.min(16,n||16))), satMul);
  }
  const ordered = algo==='bluenoise'||!!ORDERED_PATTERNS[algo];
  if(ordered){
    const{matrix,size,max}=algo==='bluenoise'?getBlueNoise():ORDERED_PATTERNS[algo];
    const amp=48*dAmt;
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){
      const i=y*sw+x, thr=((matrix[y%size][x%size]+0.5)/max-0.5)*amp;
      const c=pal[nearestIdx(R[i]+thr,G[i]+thr,B[i]+thr,pal)], oi=i*4;
      out[oi]=c[0];out[oi+1]=c[1];out[oi+2]=c[2];out[oi+3]=255;
    }
  } else if(algo==='riemersma'){
    const order=hilbertOrder(sw,sh);
    const hr=new Float32Array(RIEM_N),hg=new Float32Array(RIEM_N),hb=new Float32Array(RIEM_N); let hp=0;
    for(let m=0;m<order.length;m++){
      const i=order[m];
      let ar=0,ag=0,ab=0; for(let k=0;k<RIEM_N;k++){const w=RIEM_W[k],idx=(hp-1-k+RIEM_N)%RIEM_N; ar+=hr[idx]*w; ag+=hg[idx]*w; ab+=hb[idx]*w;}
      const r=Math.max(0,Math.min(255,R[i]+ar*dAmt)),g=Math.max(0,Math.min(255,G[i]+ag*dAmt)),b=Math.max(0,Math.min(255,B[i]+ab*dAmt));
      const c=pal[nearestIdx(r,g,b,pal)], oi=i*4;
      out[oi]=c[0];out[oi+1]=c[1];out[oi+2]=c[2];out[oi+3]=255;
      hr[hp]=r-c[0]; hg[hp]=g-c[1]; hb[hp]=b-c[2]; hp=(hp+1)%RIEM_N;
    }
  } else {
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){
      const i=y*sw+x, r=Math.max(0,Math.min(255,R[i])),g=Math.max(0,Math.min(255,G[i])),b=Math.max(0,Math.min(255,B[i]));
      const c=pal[nearestIdx(r,g,b,pal)], oi=i*4;
      out[oi]=c[0];out[oi+1]=c[1];out[oi+2]=c[2];out[oi+3]=255;
      const er=r-c[0],eg=g-c[1],eb=b-c[2];
      if(algo==='atkinson'){
        const f=dAmt/8, push=(nx,ny)=>{ if(nx>=0&&nx<sw&&ny>=0&&ny<sh){const j=ny*sw+nx;R[j]+=er*f;G[j]+=eg*f;B[j]+=eb*f;} };
        push(x+1,y);push(x+2,y);push(x-1,y+1);push(x,y+1);push(x+1,y+1);push(x,y+2);
      } else {
        const{div,taps}=DIFFUSION_KERNELS[algo]||DIFFUSION_KERNELS.diffusion;
        for(const[dx,dy,wt]of taps){ const nx=x+dx,ny=y+dy; if(nx>=0&&nx<sw&&ny>=0&&ny<sh){const j=ny*sw+nx,f=wt/div*dAmt;R[j]+=er*f;G[j]+=eg*f;B[j]+=eb*f;} }
      }
    }
  }
  return pal;
}

// ─── RENDER: DITHER ──────────────────────────────────────────────────────────
function renderDither({img,w,h,px,palette,algo,getY,transparent,colorMode,adaptiveCount,gamut,saturation=100}) {
  const satMul = 1.75*(saturation/100), dAmt = 1;
  // Integer pixelation: cell size `c` is a whole number of output px, and we
  // upscale by exactly `c` so every cell is uniform (c×c). A fractional upscale
  // ratio (round(w/px) buffer drawn to w) makes nearest-neighbor produce uneven
  // 1px/2px cells — the "broken grid" artifact. ceil so sw*c>=w (overhang cropped).
  const c = Math.max(1,Math.round(px));
  const sw = Math.max(1,Math.ceil(w/c)), sh = Math.max(1,Math.ceil(h/c));
  const small = document.createElement('canvas');
  small.width=sw; small.height=sh;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(img, 0, 0, sw, sh);
  const data = sctx.getImageData(0,0,sw,sh).data;
  const out = new Uint8ClampedArray(sw*sh*4);
  if (colorMode==='adaptive') {
    ditherAdaptive(data,sw,sh,out,algo,getY,adaptiveCount,gamut,satMul,dAmt);
    sctx.putImageData(new ImageData(out,sw,sh),0,0);
    const canvas=document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(small,0,0,sw,sh,0,0,sw*c,sh*c);
    return canvas;
  }
  const sorted = [...palette].sort((a,b) => a.anchor-b.anchor);
  const cols = sorted.map(p => hexToRgb(p.color));
  const lums = sorted.map(p => p.anchor);
  const bgIdx = cols.length-1;   // highest anchor = lightest = background when exporting transparent
  const qOrd = (Y,x,y,matrix,size,maxVal) => {
    if (Y<=lums[0]) return 0;
    if (Y>=lums[lums.length-1]) return lums.length-1;
    for (let k=0;k<lums.length-1;k++) {
      if (Y>=lums[k]&&Y<=lums[k+1]) {
        const t=(lums[k+1]-lums[k])>0?(Y-lums[k])/(lums[k+1]-lums[k]):0;
        const thr=0.5+((matrix[y%size][x%size]+0.5)/maxVal-0.5)*dAmt;   // 0 amount → hard posterize
        return t>thr?k+1:k;
      }
    }
    return lums.length-1;
  };
  if (algo==='bluenoise'||!!ORDERED_PATTERNS[algo]) {
    const{matrix,size,max}=algo==='bluenoise'?getBlueNoise():ORDERED_PATTERNS[algo];
    for (let y=0;y<sh;y++) for (let x=0;x<sw;x++) {
      const i=(y*sw+x)*4;
      const Y=getY(data[i],data[i+1],data[i+2]);
      const idx=qOrd(Y,x,y,matrix,size,max);
      const c=cols[idx]; out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];out[i+3]=(transparent&&idx===bgIdx)?0:255;
    }
  } else if (algo==='riemersma') {
    const gL=lums.map(l=>l*255);
    const order=hilbertOrder(sw,sh);
    const hbuf=new Float32Array(RIEM_N); let hp=0;
    for (let n=0;n<order.length;n++) {
      const i=order[n], di=i*4;
      const base=getY(data[di],data[di+1],data[di+2])*255;
      let acc=0; for(let k=0;k<RIEM_N;k++) acc+=hbuf[(hp-1-k+RIEM_N)%RIEM_N]*RIEM_W[k];
      const v=Math.max(0,Math.min(255,base+acc*dAmt));
      let best=0,bd=Infinity; for(let k=0;k<gL.length;k++){const d=Math.abs(v-gL[k]);if(d<bd){bd=d;best=k;}}
      hbuf[hp]=v-gL[best]; hp=(hp+1)%RIEM_N;
      const c=cols[best]; out[di]=c[0];out[di+1]=c[1];out[di+2]=c[2];out[di+3]=(transparent&&best===bgIdx)?0:255;
    }
  } else {
    const work=new Float32Array(sw*sh);
    for (let i=0;i<sw*sh;i++) work[i]=getY(data[i*4],data[i*4+1],data[i*4+2])*255;
    const gL=lums.map(l=>l*255);
    for (let y=0;y<sh;y++) for (let x=0;x<sw;x++) {
      const i=y*sw+x;
      const v=Math.max(0,Math.min(255,work[i]));
      let best=0,bestD=Infinity;
      for (let k=0;k<gL.length;k++){const d=Math.abs(v-gL[k]);if(d<bestD){bestD=d;best=k;}}
      const err=v-gL[best]; const c=cols[best]; const oi=i*4;
      out[oi]=c[0];out[oi+1]=c[1];out[oi+2]=c[2];out[oi+3]=(transparent&&best===bgIdx)?0:255;
      if (algo==='atkinson') {
        const e=err/8*dAmt;
        if(x+1<sw)work[i+1]+=e; if(x+2<sw)work[i+2]+=e;
        if(x-1>=0&&y+1<sh)work[i+sw-1]+=e; if(y+1<sh)work[i+sw]+=e;
        if(x+1<sw&&y+1<sh)work[i+sw+1]+=e; if(y+2<sh)work[i+sw*2]+=e;
      } else {
        const {div,taps}=DIFFUSION_KERNELS[algo]||DIFFUSION_KERNELS.diffusion;
        for(const [dx,dy,wt] of taps){
          const nx=x+dx, ny=y+dy;
          if(nx>=0&&nx<sw&&ny<sh) work[ny*sw+nx]+=err*wt/div*dAmt;
        }
      }
    }
  }
  sctx.putImageData(new ImageData(out,sw,sh),0,0);
  const canvas=document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(small,0,0,sw,sh,0,0,sw*c,sh*c);
  return canvas;
}

// ─── RENDER: ASCII ───────────────────────────────────────────────────────────
function renderAscii({img,w,h,ramp,fgColor,bgColor,cellSize,getY,transparent,invert,cutout,bold}) {
  const chars=ASCII_RAMPS[ramp]?.chars||ASCII_RAMPS.standard.chars;
  // Monospace glyphs are ~0.6x as wide as tall — pack columns at that ratio so the
  // grid is dense and gap-free instead of speckled square cells.
  const cellH=Math.max(4,cellSize);
  const cellW=Math.max(2,cellH*0.6);
  const cols=Math.max(1,Math.round(w/cellW)), rows=Math.max(1,Math.round(h/cellH));
  const small=document.createElement('canvas');
  small.width=cols; small.height=rows;
  const sctx=small.getContext('2d');
  sctx.imageSmoothingEnabled=true;
  sctx.drawImage(img,0,0,cols,rows);
  const data=sctx.getImageData(0,0,cols,rows).data;
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(cols*cellW); canvas.height=rows*cellH;
  const ctx=canvas.getContext('2d');
  if(!transparent){ ctx.fillStyle=bgColor; ctx.fillRect(0,0,canvas.width,canvas.height); }
  ctx.fillStyle=fgColor; ctx.font=`${bold?'bold ':''}${cellH}px monospace`; ctx.textBaseline='top';
  const cut=Math.max(0,Math.min(0.95,(cutout||0)/100));
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    const i=(r*cols+c)*4;
    const Y=getY(data[i],data[i+1],data[i+2]);
    let t=invert?(1-Y):Y;             // t=1 → densest character (the "ink")
    t=(t-cut)/(1-cut);                // knock the background tone out to blank
    if(t<=0) continue;                // background: no character at all
    const ci=Math.round(Math.min(1,t)*(chars.length-1));
    const ch=chars[ci];
    if(ch&&ch!==' ') ctx.fillText(ch,c*cellW,r*cellH);
  }
  return canvas;
}

// ─── RENDER: HALFTONE ────────────────────────────────────────────────────────
function renderHalftone({img,w,h,shape,dotSize,angle,inkColor,paperColor,getY,transparent}) {
  const scale=0.5;
  const sw=Math.round(w*scale), sh=Math.round(h*scale);
  const small=document.createElement('canvas');
  small.width=sw; small.height=sh;
  const sctx=small.getContext('2d');
  sctx.imageSmoothingEnabled=true;
  sctx.drawImage(img,0,0,sw,sh);
  const data=sctx.getImageData(0,0,sw,sh).data;
  const canvas=document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext('2d');
  if(!transparent){ ctx.fillStyle=paperColor; ctx.fillRect(0,0,w,h); }
  ctx.fillStyle=inkColor;
  const rad=angle*Math.PI/180;
  const cosA=Math.cos(rad), sinA=Math.sin(rad);
  const step=dotSize*2;
  const diag=Math.ceil(Math.sqrt(w*w+h*h));
  for (let gy=-diag;gy<diag;gy+=step) {
    for (let gx=-diag;gx<diag;gx+=step) {
      const sx=gx*cosA-gy*sinA+w/2, sy=gx*sinA+gy*cosA+h/2;
      const ix=Math.round(sx*scale), iy=Math.round(sy*scale);
      if(ix<0||iy<0||ix>=sw||iy>=sh) continue;
      const idx=(iy*sw+ix)*4;
      const Y=getY(data[idx],data[idx+1],data[idx+2]);
      const r=dotSize*(1-Y);
      if(r<0.4) continue;
      ctx.beginPath();
      if(shape==='square'){ctx.rect(sx-r,sy-r,r*2,r*2);}
      else if(shape==='diamond'){ctx.moveTo(sx,sy-r);ctx.lineTo(sx+r,sy);ctx.lineTo(sx,sy+r);ctx.lineTo(sx-r,sy);ctx.closePath();}
      else if(shape==='line'){ctx.save();ctx.translate(sx,sy);ctx.rotate(rad);ctx.rect(-step/2,-r,step,r*2);ctx.restore();}
      else{ctx.arc(sx,sy,r,0,Math.PI*2);}
      ctx.fill();
    }
  }
  return canvas;
}

// ─── POST: ATMOSPHERE ────────────────────────────────────────────────────────
// Separable box blur (RGB) in place on an ImageData buffer, using running sums so cost is
// O(w·h) per pass regardless of radius. Call 3× to approximate a Gaussian. No ctx.filter —
// Safari/iOS doesn't implement CanvasRenderingContext2D.filter, so we blur in JS everywhere.
function boxBlurPass(data,w,h,r){
  if(r<1) return;
  const tmp=new Uint8ClampedArray(data.length);
  const win=r*2+1;
  // horizontal (read data → write tmp)
  for(let y=0;y<h;y++){
    const row=y*w*4; let ri=0,gi=0,bi=0;
    for(let x=-r;x<=r;x++){ const xx=row+Math.min(w-1,Math.max(0,x))*4; ri+=data[xx]; gi+=data[xx+1]; bi+=data[xx+2]; }
    for(let x=0;x<w;x++){
      const o=row+x*4; tmp[o]=ri/win; tmp[o+1]=gi/win; tmp[o+2]=bi/win; tmp[o+3]=255;
      const add=row+Math.min(w-1,x+r+1)*4, sub=row+Math.max(0,x-r)*4;
      ri+=data[add]-data[sub]; gi+=data[add+1]-data[sub+1]; bi+=data[add+2]-data[sub+2];
    }
  }
  // vertical (read tmp → write data)
  for(let x=0;x<w;x++){
    const col=x*4; let ri=0,gi=0,bi=0;
    for(let y=-r;y<=r;y++){ const yy=col+Math.min(h-1,Math.max(0,y))*w*4; ri+=tmp[yy]; gi+=tmp[yy+1]; bi+=tmp[yy+2]; }
    for(let y=0;y<h;y++){
      const o=col+y*w*4; data[o]=ri/win; data[o+1]=gi/win; data[o+2]=bi/win; data[o+3]=255;
      const add=col+Math.min(h-1,y+r+1)*w*4, sub=col+Math.max(0,y-r)*w*4;
      ri+=tmp[add]-tmp[sub]; gi+=tmp[add+1]-tmp[sub+1]; bi+=tmp[add+2]-tmp[sub+2];
    }
  }
}
function applyAtmosphere(canvas,{phosphorGlow,luminanceLift,scanlines,noise,chromaShift,phosphorGrid,darkColor}) {
  const ctx=canvas.getContext('2d');
  const{width:w,height:h}=canvas;
  if(phosphorGlow>0){
    const g=phosphorGlow/100;
    // Bloom the brightest tones by VALUE (max channel), not luminance, so vivid colours —
    // a saturated blue, a light lavender — glow too, not only near-white. A soft knee ramps
    // each pixel's contribution in instead of the old hard >0.8 luminance cutoff.
    const src=ctx.getImageData(0,0,w,h); const sd=src.data;
    const bright=document.createElement('canvas'); bright.width=w; bright.height=h;
    const brctx=bright.getContext('2d');
    const bimg=brctx.createImageData(w,h); const bd=bimg.data;
    // Lower knee → mid-brights (not just near-whites) feed the bloom, so the haze covers more
    // of the image. Amplify the captured highlights by a gain that grows with g so a strong
    // glow really blows the brights out, not just tints them.
    const knee=0.35;
    const gain=1+g*1.8;
    for(let i=0;i<sd.length;i+=4){
      const v=Math.max(sd[i],sd[i+1],sd[i+2])/255;
      const wt=v>knee?(v-knee)/(1-knee):0;
      if(wt>0){ const k=wt*gain; bd[i]=Math.min(255,sd[i]*k); bd[i+1]=Math.min(255,sd[i+1]*k); bd[i+2]=Math.min(255,sd[i+2]*k); bd[i+3]=255; }
    }
    brctx.putImageData(bimg,0,0);
    // Blur the bright layer at a FIXED working resolution (long side ≤512, independent of the
    // slider) with a separable 3-pass box blur ≈ Gaussian. Fixed grid = the resample never
    // shifts as glow moves, so grain doesn't swim. Radius is a CONTINUOUS function of g, and
    // intensity grows continuously too, so the slider changes smoothly at every step.
    const CAP=512;
    const scale=Math.min(1,CAP/Math.max(w,h));
    const ww=Math.max(1,Math.round(w*scale)), wh=Math.max(1,Math.round(h*scale));
    const work=document.createElement('canvas'); work.width=ww; work.height=wh;
    const wctx=work.getContext('2d');
    wctx.imageSmoothingEnabled=true; wctx.imageSmoothingQuality='high';
    wctx.drawImage(bright,0,0,ww,wh);
    // Radius on the full image is g·minDim·0.06 (matches the old Gaussian feel); scaled down
    // to the working resolution. Fractional radius rounded, but the value is large enough that
    // ±1px steps are invisible — and alpha below keeps every step distinct regardless.
    const radius=Math.max(1,Math.round(g*Math.min(w,h)*0.11*scale));
    const wd=wctx.getImageData(0,0,ww,wh);
    boxBlurPass(wd.data,ww,wh,radius);
    boxBlurPass(wd.data,ww,wh,radius);
    boxBlurPass(wd.data,ww,wh,radius);
    wctx.putImageData(wd,0,0);
    // Composite the halo in two additive passes, both continuous in g and both white-safe
    // (screen(255,x)=255, lighter only brightens): a wide 'screen' pass lays down a soft
    // coloured haze, then a 'lighter' pass punches the brights up so high glow reads strong.
    ctx.save();
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.globalCompositeOperation='screen';
    ctx.globalAlpha=Math.min(1,0.35+g*0.65);
    ctx.drawImage(work,0,0,w,h);
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=g*0.6;
    ctx.drawImage(work,0,0,w,h);
    ctx.restore();
    ctx.imageSmoothingEnabled=false;
  }
  if(luminanceLift>0){
    // gentle uniform overexposure via additive white at very low opacity
    ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.globalAlpha=(luminanceLift/100)*0.25;
    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,w,h); ctx.restore();
  }
  if(scanlines>0){
    // Multiply alternate rows toward dark so brightness is modulated proportionally, instead
    // of flat-filling dark over half the image. Period scales with the render height so a CRT
    // keeps a consistent line count at any resolution (fixed 2px lines vanish on big exports).
    const k=Math.round((1-(scanlines/100)*0.55)*255);
    const period=Math.max(2,Math.round(h/450)), thick=Math.max(1,Math.round(period*0.5));
    ctx.save(); ctx.globalCompositeOperation='multiply'; ctx.fillStyle=`rgb(${k},${k},${k})`;
    for(let y=0;y<h;y+=period) ctx.fillRect(0,y,w,thick);
    ctx.restore();
  }
  if(noise>0){
    ctx.save(); ctx.globalAlpha=0.5;
    const count=Math.round((noise/100)*w*h*0.04);
    for(let n=0;n<count;n++){
      ctx.fillStyle=Math.random()<0.5?darkColor||'#000':'#fff';
      ctx.fillRect(Math.random()*w,Math.random()*h,1,1);
    }
    ctx.restore();
  }
  if(chromaShift>0){
    const off=Math.round(chromaShift);
    const src=ctx.getImageData(0,0,w,h); const sd=src.data;
    const out=ctx.createImageData(w,h); const od=out.data;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      const rx=Math.min(w-1,Math.max(0,x+off));   // red channel shifted +off
      const bx=Math.min(w-1,Math.max(0,x-off));   // blue channel shifted -off
      od[i]  =sd[(y*w+rx)*4];       // R
      od[i+1]=sd[i+1];              // G unchanged
      od[i+2]=sd[(y*w+bx)*4+2];     // B
      od[i+3]=sd[i+3];              // A
    }
    ctx.putImageData(out,0,0);
  }
  if(phosphorGrid>0){
    // RGB aperture grille: soft vertical R/G/B stripes. Triads are a few px wide (coarser than
    // the dither, so the two don't interfere into colour grain) and the tint is gentle so it
    // reads as a screen, not noise. Width scales with the render for parity on export.
    const s=phosphorGrid/100, cell=Math.max(2,Math.round(Math.min(w,h)/200));
    const dim=1-s*0.38, boost=1+s*0.16;
    const img=ctx.getImageData(0,0,w,h); const d=img.data;
    for(let y=0;y<h;y++){ for(let x=0;x<w;x++){
      const phase=Math.floor(x/cell)%3, i=(y*w+x)*4;
      d[i]  *= phase===0?boost:dim;
      d[i+1]*= phase===1?boost:dim;
      d[i+2]*= phase===2?boost:dim;
    }}
    ctx.putImageData(img,0,0);
  }
}

// Build the tone-mapping function from a settings object (mirrors process()).
function makeGetY(s){
  const ex=1+(s.exposure||0)/100, cf=(100+(s.contrast||0))/100, mid=s.midtones||1, hi=s.highlights||1, sh=s.shadows||1;
  return (r,g,b)=>{
    let y=luminance([r,g,b])*ex;
    y=(y-0.5)*cf+0.5;
    y=Math.pow(Math.max(0,Math.min(1,y)),1/mid);
    if(y>0.5) y=0.5+(y-0.5)*hi; else y=0.5-(0.5-y)*sh;
    return Math.max(0,Math.min(1,y));
  };
}

// Render a settings object onto an image at (w,h). Used for preset preview thumbnails.
function renderSettingsToCanvas(img,s,w,h){
  const getY=makeGetY(s);
  const mode=s.mode||'halftone';
  // The live preview renders at ~900px on its long side. Scale the pattern size to THIS
  // canvas's size so a 160px thumbnail (or a 480px GIF frame) shows the same cell density
  // as the preview — otherwise the cells stay full-size while the image shrinks and the
  // thumbnail looks far chunkier than the real output.
  const scale=Math.max(0.05,Math.min(1,Math.max(w,h)/900));
  const sizeFor=(m,legacy)=> (s.detail!==undefined ? detailToSize(m,s.detail) : legacy) * scale;
  let canvas;
  if(mode==='dither') canvas=renderDither({img,w,h,px:Math.max(1,sizeFor('dither',s.pixelSize||5)),palette:(s.palette||[]).map(p=>({...p})),algo:s.algo||'bayer',getY,colorMode:s.dcolor,adaptiveCount:s.adaptiveCount,gamut:s.gamut,saturation:s.saturation});
  else if(mode==='ascii') canvas=renderAscii({img,w,h,ramp:s.asciiRamp||'standard',fgColor:s.asciiFg||'#00ff41',bgColor:s.asciiBg||'#000000',cellSize:Math.max(3,sizeFor('ascii',s.asciiSize||8)),getY,invert:s.asciiInvert,cutout:s.asciiCutout,bold:s.asciiBold!==false});
  else canvas=renderHalftone({img,w,h,shape:s.htShape||'circle',dotSize:Math.max(0.8,sizeFor('halftone',s.htSize||3.5)),angle:s.htAngle||45,inkColor:s.htInk||'#2a2420',paperColor:s.htPaper||'#f2ede4',getY});
  const darkColor=mode==='dither'?(([...(s.palette||[])].sort((a,b)=>a.anchor-b.anchor)[0]||{}).color||'#000'):mode==='ascii'?(s.asciiBg||'#000'):'#000';
  applyAtmosphere(canvas,{phosphorGlow:s.phosphorGlow||0,luminanceLift:s.luminanceLift||0,scanlines:s.scanlines||0,noise:s.noise||0,chromaShift:s.chromaShift||0,phosphorGrid:s.phosphorGrid||0,darkColor});
  return canvas;
}

// ─── SVG EXPORT ──────────────────────────────────────────────────────────────
// Vector reconstructions of each mode, so the output stays editable (move a glyph,
// tweak a dot) instead of baked pixels. Atmosphere is a raster post-pass and is
// intentionally omitted here — SVG carries the clean source art.
const svgEsc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const svgHex = (r,g,b) => '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');

// ASCII → real <text>: one line per row, per-glyph x positions matching the raster grid.
function buildAsciiSVG({img,w,h,ramp,fgColor,bgColor,cellSize,getY,transparent,invert,cutout,bold}){
  const chars=ASCII_RAMPS[ramp]?.chars||ASCII_RAMPS.standard.chars;
  const cellH=Math.max(4,cellSize);
  const cellW=Math.max(2,cellH*0.6);
  const cols=Math.max(1,Math.round(w/cellW)), rows=Math.max(1,Math.round(h/cellH));
  const small=document.createElement('canvas'); small.width=cols; small.height=rows;
  const sctx=small.getContext('2d'); sctx.imageSmoothingEnabled=true; sctx.drawImage(img,0,0,cols,rows);
  const data=sctx.getImageData(0,0,cols,rows).data;
  const W=Math.round(cols*cellW), H=rows*cellH;
  const cut=Math.max(0,Math.min(0.95,(cutout||0)/100));
  const xlist=Array.from({length:cols},(_,c)=>(+(c*cellW).toFixed(2))).join(' ');
  let lines='';
  for(let r=0;r<rows;r++){
    const row=new Array(cols).fill(' ');
    let any=false;
    for(let c=0;c<cols;c++){
      const i=(r*cols+c)*4;
      const Y=getY(data[i],data[i+1],data[i+2]);
      let t=invert?(1-Y):Y;
      t=(t-cut)/(1-cut);
      if(t<=0) continue;
      const ch=chars[Math.round(Math.min(1,t)*(chars.length-1))];
      if(ch&&ch!==' '){ row[c]=ch; any=true; }
    }
    if(any) lines+=`<text x="${xlist}" y="${(r*cellH).toFixed(2)}">${svgEsc(row.join(''))}</text>`;
  }
  const bg=transparent?'':`<rect width="${W}" height="${H}" fill="${bgColor}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}`
    +`<g font-family="monospace" font-size="${cellH}px" font-weight="${bold?'bold':'normal'}" fill="${fgColor}" `
    +`dominant-baseline="text-before-edge" xml:space="preserve">${lines}</g></svg>`;
}

// Halftone → one vector shape per dot.
function buildHalftoneSVG({img,w,h,shape,dotSize,angle,inkColor,paperColor,getY,transparent}){
  const scale=0.5;
  const sw=Math.round(w*scale), sh=Math.round(h*scale);
  const small=document.createElement('canvas'); small.width=sw; small.height=sh;
  const sctx=small.getContext('2d'); sctx.imageSmoothingEnabled=true; sctx.drawImage(img,0,0,sw,sh);
  const data=sctx.getImageData(0,0,sw,sh).data;
  const rad=angle*Math.PI/180, cosA=Math.cos(rad), sinA=Math.sin(rad);
  const step=dotSize*2;
  const diag=Math.ceil(Math.sqrt(w*w+h*h));
  let shapes='';
  for(let gy=-diag;gy<diag;gy+=step) for(let gx=-diag;gx<diag;gx+=step){
    const sx=gx*cosA-gy*sinA+w/2, sy=gx*sinA+gy*cosA+h/2;
    const ix=Math.round(sx*scale), iy=Math.round(sy*scale);
    if(ix<0||iy<0||ix>=sw||iy>=sh) continue;
    const idx=(iy*sw+ix)*4;
    const r=dotSize*(1-getY(data[idx],data[idx+1],data[idx+2]));
    if(r<0.4) continue;
    const X=sx.toFixed(2), Yc=sy.toFixed(2);
    if(shape==='square') shapes+=`<rect x="${(sx-r).toFixed(2)}" y="${(sy-r).toFixed(2)}" width="${(r*2).toFixed(2)}" height="${(r*2).toFixed(2)}"/>`;
    else if(shape==='diamond') shapes+=`<polygon points="${X},${(sy-r).toFixed(2)} ${(sx+r).toFixed(2)},${Yc} ${X},${(sy+r).toFixed(2)} ${(sx-r).toFixed(2)},${Yc}"/>`;
    else if(shape==='line') shapes+=`<rect x="${(-step/2).toFixed(2)}" y="${(-r).toFixed(2)}" width="${step.toFixed(2)}" height="${(r*2).toFixed(2)}" transform="translate(${X} ${Yc}) rotate(${angle})"/>`;
    else shapes+=`<circle cx="${X}" cy="${Yc}" r="${r.toFixed(2)}"/>`;
  }
  const bg=transparent?'':`<rect width="${w}" height="${h}" fill="${paperColor}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}<g fill="${inkColor}">${shapes}</g></svg>`;
}

// Dither → sample the rendered block grid and emit rects, merging horizontal runs of
// one colour so files stay lean. Reuses renderDither so the pattern matches exactly.
function buildDitherSVG({img,w,h,px,palette,algo,getY,transparent,colorMode,adaptiveCount,gamut,saturation}){
  const canvas=renderDither({img,w,h,px,palette,algo,getY,transparent,colorMode,adaptiveCount,gamut,saturation});
  const cw=canvas.width, ch=canvas.height;
  const data=canvas.getContext('2d').getImageData(0,0,cw,ch).data;
  const step=Math.max(1,Math.round(px));
  const cols=Math.ceil(cw/step), rows=Math.ceil(ch/step);
  let rects='';
  for(let ry=0;ry<rows;ry++){
    let run=null; // {color, x0}
    const y=ry*step;
    const flush=(xEnd)=>{ if(run){ rects+=`<rect x="${run.x0*step}" y="${y}" width="${(xEnd-run.x0)*step}" height="${step}" fill="${run.color}"/>`; run=null; } };
    for(let rx=0;rx<cols;rx++){
      const sx=Math.min(cw-1,rx*step), sy=Math.min(ch-1,y);
      const i=(sy*cw+sx)*4;
      const color=data[i+3]===0?null:svgHex(data[i],data[i+1],data[i+2]);
      if(color===null){ flush(rx); continue; }
      if(!run) run={color,x0:rx};
      else if(run.color!==color){ flush(rx); run={color,x0:rx}; }
    }
    flush(cols);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}" shape-rendering="crispEdges">${rects}</svg>`;
}

// Build an SVG document string from an image + live settings object (mirrors process()).
function renderSettingsToSVG(img,s,w,h){
  const getY=makeGetY(s);
  const mode=s.mode||'halftone';
  const tp=!!s.transparent;
  if(mode==='ascii') return buildAsciiSVG({img,w,h,ramp:s.asciiRamp||'standard',fgColor:s.asciiFg||'#00ff41',bgColor:s.asciiBg||'#000000',cellSize:detailToSize('ascii',s.detail??55),getY,transparent:tp,invert:!!s.asciiInvert,cutout:s.asciiCutout||0,bold:s.asciiBold!==false});
  if(mode==='halftone') return buildHalftoneSVG({img,w,h,shape:s.htShape||'circle',dotSize:detailToSize('halftone',s.detail??55),angle:s.htAngle||45,inkColor:s.htInk||'#2a2420',paperColor:s.htPaper||'#f2ede4',getY,transparent:tp});
  return buildDitherSVG({img,w,h,px:Math.max(1,detailToSize('dither',s.detail??55)),palette:(s.palette||[]).map(p=>({...p})),algo:s.algo||'bayer',getY,transparent:tp,colorMode:s.dcolor,adaptiveCount:s.adaptiveCount,gamut:s.gamut,saturation:s.saturation});
}

const EXPORT_MAX = 4096;    // raster export ceiling (long side) — safe across browsers

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function Phosphor() {
  const [imageSrc, setImageSrc] = useState('/samples/landscape-1.jpg');
  const [fileName, setFileName] = useState('creation-of-adam.jpg');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x:0,y:0});
  const [lightbox, setLightbox] = useState(false);   // mobile: tap the image for a full-screen view
  const [imgAspect, setImgAspect] = useState(1.5);   // natural w/h — drives the mobile preview height
  const viewRef = useRef({zoom:1, pan:{x:0,y:0}});

  const [mode, setMode] = useState('halftone');
  const [activeTab, setActiveTab] = useState('presets');
  const [activeLook, setActiveLook] = useState(null);
  const [lookThumbs, setLookThumbs] = useState({});

  const [palette, setPalette] = useState(() =>
    PALETTE_PRESETS.amber.colors.map((c,i,a) => mkEntry(c, a.length>1?i/(a.length-1):0.5))
  );
  const [paletteKey, setPaletteKey] = useState('amber');  // selected preset, or null when hand-edited
  const [algo, setAlgo] = useState('bayer');
  const [dcolor, setDcolor] = useState('palette');        // dither color mode: 'palette' | 'adaptive'
  const [adaptiveCount, setAdaptiveCount] = useState(16); // adaptive palette size (default to max)
  const [gamut, setGamut] = useState('full');             // adaptive colour constraint / device gamut
  const [showAllDevices, setShowAllDevices] = useState(false);   // Devices section: reveal beyond the first row set
  // Mobile presets: horizontal filmstrip with a sticky category rail (jump-to + scroll-spy).
  const [activeCat, setActiveCat] = useState(CATEGORIES[0][0]);
  const filmRef = useRef(null);          // horizontal scroll container
  const catRefs = useRef({});            // first card element of each category (for jump + spy)
  const tagRefs = useRef({});            // category tag buttons (to keep the active one in view)
  const spyRaf = useRef(0);
  const [detail, setDetail] = useState(DEFAULT_DETAIL);   // unified 0-100, higher = more detail
  // The load/upload pixelisation reveal animates THIS (render-only) — never the slider value or
  // history — so it reads as a transition, not a user edit. null = render at the real detail.
  const [revealDetail, setRevealDetail] = useState(null);
  const detailRef = useRef(DEFAULT_DETAIL); detailRef.current = detail;
  const sweepRef = useRef(0);
  const pendingSweepRef = useRef(false);   // holds the target detail to animate to after an upload decodes
  // Reveal the pixelisation by ramping the RENDER detail 0 → target. Drives revealDetail only,
  // so the slider stays put and nothing lands in history; clears to null (real detail) when done.
  const sweepDetail = useCallback((target) => {
    cancelAnimationFrame(sweepRef.current);
    if (target <= 0) { setRevealDetail(null); return; }
    const dur = 850, start = performance.now();
    setRevealDetail(0);
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);   // easeOutCubic
      setRevealDetail(t < 1 ? Math.round(e * target) : null);
      if (t < 1) sweepRef.current = requestAnimationFrame(step);
    };
    sweepRef.current = requestAnimationFrame(step);
  }, []);

  const [asciiRamp, setAsciiRamp] = useState('standard');
  const [asciiFg, setAsciiFg] = useState('#00ff41');
  const [asciiBg, setAsciiBg] = useState('#000000');
  const [asciiInvert, setAsciiInvert] = useState(false);
  const [asciiCutout, setAsciiCutout] = useState(0);
  const [asciiBold, setAsciiBold] = useState(false);

  const [htShape, setHtShape] = useState('circle');
  const [htAngle, setHtAngle] = useState(45);
  const [htInk, setHtInk] = useState('#2a2420');
  const [htPaper, setHtPaper] = useState('#f2ede4');

  const [exposure, setExposure] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [midtones, setMidtones] = useState(1);
  const [highlights, setHighlights] = useState(1);
  const [shadows, setShadows] = useState(1);

  const [phosphorGlow, setPhosphorGlow] = useState(0);
  const [luminanceLift, setLuminanceLift] = useState(0);
  const [scanlines, setScanlines] = useState(0);
  const [noise, setNoise] = useState(0);
  const [chromaShift, setChromaShift] = useState(0);
  const [phosphorGrid, setPhosphorGrid] = useState(0);   // RGB subpixel mask (Effects)
  const [saturation, setSaturation] = useState(100);      // adaptive palette vibrance (100 = default)

  const [transparentBg, setTransparentBg] = useState(false);
  const [format, setFormat] = useState('jpeg');
  const [outputUrl, setOutputUrl] = useState(null);
  const [shared, setShared] = useState(false);
  const [copied, setCopied] = useState(false);
  const imgRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const ctrlRef = useRef(null);
  // Each tab starts at the top — don't inherit the previous tab's scroll position.
  useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.scrollTop = 0;
    if (activeTab === 'presets' && filmRef.current) { filmRef.current.scrollLeft = 0; setActiveCat(CATEGORIES[0][0]); }
  }, [activeTab]);
  const zoomAreaRef = useRef(null);
  const previewImgRef = useRef(null);
  // Nearest-neighbour (pixelated) scaling only looks right when the render is shown at or
  // above its native size. Below that — zoomed out, or fit into a narrow pane — it aliases
  // the dither grid into moiré, so switch to smooth downscaling whenever it's shrunk.
  const [smoothScale, setSmoothScale] = useState(false);

  // ── Splash / boot ──
  const [booting, setBooting] = useState(true);
  const [bootHiding, setBootHiding] = useState(false);
  const bootStart = useRef(Date.now());
  const bootSweepRef = useRef(false);   // play the detail-reveal on the landing image once the splash lifts

  // ── Hold to compare ──
  const [comparing, setComparing] = useState(false);
  const canCompareRef = useRef(false);
  const lightboxRef = useRef(false);   // gestures are disabled while the lightbox is open

  // ── About ──
  const [aboutOpen, setAboutOpen] = useState(false);

  // ── Presets filter ──

  // ── Undo / redo (settings history) ──
  const historyRef = useRef({ stack: [], index: -1 });
  const [, setHistVer] = useState(0);
  const fnRef = useRef({});

  const loadFile = useCallback((file) => {
    if (!file) return;
    setZoom(1); setPan({x:0,y:0});   // fit the new image to the viewport
    setFileName(file.name);
    pendingSweepRef.current = detailRef.current;   // animate detail 0 → selected once it decodes
    const reader = new FileReader();
    reader.onload = ev => setImageSrc(ev.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleFile = (e) => { loadFile(e.target.files?.[0]); };

  const handleDrop = (e) => {
    e.preventDefault();
    loadFile(e.dataTransfer.files?.[0]);
  };

  const handleModeChange = (m) => {
    setMode(m);
    setActiveLook(null);
    if (ctrlRef.current) ctrlRef.current.scrollTop = 0;
  };

  // Detail is the user's, global. Most looks leave it alone. The few that carry detail
  // (Hardware, Stipple) stash the current value on entry and restore it when the user
  // moves to a look that doesn't carry detail — so stylised chunk never sticks.
  const detailStash = useRef(null);
  const setDetailOwned = (v) => { detailStash.current = null; setDetail(v); };

  const applyLookPreset = (p) => {
    setActiveLook(p.name);
    if (p.carriesDetail) {
      if (detailStash.current === null) detailStash.current = detail;
    } else if (detailStash.current !== null) {
      setDetail(detailStash.current);
      detailStash.current = null;
    }
    applyLoadedSettings({ ...LOOK_BASE, ...p.settings });
  };

  const applyPalettePreset = (key) => {
    const p = PALETTE_PRESETS[key];
    const anc = p.anchors;
    setPalette(p.colors.map((col,i,a) => mkEntry(col, anc?anc[i]:(a.length>1?i/(a.length-1):0.5))));
    setPaletteKey(key);
  };

  // Swap foreground/background on the two-color modes. Stateless — it just exchanges the colors.
  const invertAscii    = () => { setAsciiFg(asciiBg); setAsciiBg(asciiFg); };
  const invertHalftone = () => { setHtInk(htPaper);   setHtPaper(htInk);   };
  const invertPalette  = () => { setPaletteKey(null); setPalette(p => p.length===2
    ? [{...p[0],color:p[1].color},{...p[1],color:p[0].color}]
    : p); };

  // Apply a (possibly partial) settings object to state. Shared by shuffle and URL loading.
  const applyLoadedSettings = (s) => {
    if(s.mode!==undefined) setMode(s.mode);
    if(s.algo!==undefined) setAlgo(s.algo);
    if(s.dcolor!==undefined) setDcolor(s.dcolor);
    if(s.adaptiveCount!==undefined) setAdaptiveCount(s.adaptiveCount);
    if(s.gamut!==undefined) setGamut(s.gamut);
    // Unified detail, with backward-compat for older presets/links that stored raw sizes.
    if(s.detail!==undefined) setDetail(s.detail);
    else if(s.pixelSize!==undefined) setDetail(sizeToDetail('dither',s.pixelSize));
    else if(s.asciiSize!==undefined) setDetail(sizeToDetail('ascii',s.asciiSize));
    else if(s.htSize!==undefined) setDetail(sizeToDetail('halftone',s.htSize));
    if(s.palette!==undefined) { setPalette(s.palette.map(p=>mkEntry(p.color,p.anchor))); setPaletteKey(null); }
    if(s.asciiRamp!==undefined) setAsciiRamp(s.asciiRamp);
    if(s.asciiFg!==undefined) setAsciiFg(s.asciiFg);
    if(s.asciiBg!==undefined) setAsciiBg(s.asciiBg);
    if(s.asciiInvert!==undefined) setAsciiInvert(s.asciiInvert);
    if(s.asciiCutout!==undefined) setAsciiCutout(s.asciiCutout);
    if(s.asciiBold!==undefined) setAsciiBold(s.asciiBold);
    if(s.htShape!==undefined) setHtShape(s.htShape);
    if(s.htAngle!==undefined) setHtAngle(s.htAngle);
    if(s.htInk!==undefined) setHtInk(s.htInk);
    if(s.htPaper!==undefined) setHtPaper(s.htPaper);
    if(s.exposure!==undefined) setExposure(s.exposure);
    if(s.contrast!==undefined) setContrast(s.contrast);
    if(s.midtones!==undefined) setMidtones(s.midtones);
    if(s.highlights!==undefined) setHighlights(s.highlights);
    if(s.shadows!==undefined) setShadows(s.shadows);
    if(s.phosphorGlow!==undefined) setPhosphorGlow(s.phosphorGlow);
    if(s.luminanceLift!==undefined) setLuminanceLift(s.luminanceLift);
    if(s.scanlines!==undefined) setScanlines(s.scanlines);
    if(s.noise!==undefined) setNoise(s.noise);
    if(s.chromaShift!==undefined) setChromaShift(s.chromaShift);
    if(s.phosphorGrid!==undefined) setPhosphorGrid(s.phosphorGrid);
    if(s.saturation!==undefined) setSaturation(s.saturation);
  };

  // Fresh entry: a random sample image paired with a random look, so the landing frame
  // is different every visit. (Add more images to DEFAULT_POOL to vary the photo too.)
  const shuffleAll = () => {
    const img = DEFAULT_POOL[nextSampleIndex(DEFAULT_POOL.length)];
    // Landing look is a random photographic one — skip the stylised/text categories.
    const pickable = LOOK_PRESETS.filter(p => !['type','riso','duotone','mono'].includes(p.category));
    const look = pickable[Math.floor(Math.random()*pickable.length)];
    applyLookPreset(look);
    // Land chunky and remember where to ramp to; the splash-lift effect plays the reveal.
    // Non-device looks always reveal to the default detail — only devices carry their own.
    bootSweepRef.current = look.carriesDetail ? look.settings.detail : DEFAULT_DETAIL;
    setRevealDetail(0);   // render chunky behind the splash; the slider stays at the real value
    if(img.fileName) setFileName(img.fileName);
    setZoom(1); setPan({x:0,y:0});
    setImageSrc(img.image);
  };

  const getSettings = useCallback(() => ({
    mode, algo, dcolor, adaptiveCount, gamut, detail,
    palette: palette.map(({color,anchor})=>({color,anchor})),
    asciiRamp, asciiFg, asciiBg, asciiInvert, asciiCutout, asciiBold,
    htShape, htAngle, htInk, htPaper,
    exposure, contrast, midtones, highlights, shadows, phosphorGlow, luminanceLift, scanlines, noise, chromaShift, phosphorGrid, saturation,
  }), [mode,algo,dcolor,adaptiveCount,gamut,detail,palette,asciiRamp,asciiFg,asciiBg,asciiInvert,asciiCutout,asciiBold,htShape,htAngle,htInk,htPaper,exposure,contrast,midtones,highlights,shadows,phosphorGlow,luminanceLift,scanlines,noise,chromaShift,phosphorGrid,saturation]);

  // ── Undo / redo ───────────────────────────────────────────────────────────
  // History holds serialized settings only (never the image), so replacing the image
  // is not an undoable step. Snapshots are debounced off settings changes, which lands
  // them at interaction end (after a drag settles) instead of on every intermediate value.
  const pushSnapshot = useCallback((settingsObj) => {
    const h = historyRef.current;
    const s = JSON.stringify(settingsObj);
    if (h.index >= 0 && h.stack[h.index] === s) return; // unchanged — nothing to record
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(s);
    if (h.stack.length > 30) h.stack.shift();            // cap at 30 snapshots
    h.index = h.stack.length - 1;
    setHistVer(v => v + 1);
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    applyLoadedSettings(JSON.parse(h.stack[h.index]));
    setHistVer(v => v + 1);
  }, []);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    applyLoadedSettings(JSON.parse(h.stack[h.index]));
    setHistVer(v => v + 1);
  }, []);
  fnRef.current.undo = undo; fnRef.current.redo = redo;

  const canUndo = historyRef.current.index > 0;
  const canRedo = historyRef.current.index < historyRef.current.stack.length - 1;

  // Debounced snapshot: dragging a slider keeps resetting the timer, so only the settled
  // value is recorded. Re-applying an undo yields settings equal to the current stack top,
  // so pushSnapshot no-ops — no need for a separate "applying" guard.
  useEffect(() => {
    const id = setTimeout(() => pushSnapshot(getSettings()), 350);
    return () => clearTimeout(id);
  }, [getSettings, pushSnapshot]);

  // Keyboard: Cmd/Ctrl+Z undo, Cmd+Shift+Z / Ctrl+Y redo. Bound once; calls latest via ref.
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? fnRef.current.redo() : fnRef.current.undo(); }
      else if (k === 'y') { e.preventDefault(); fnRef.current.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shareSettings = () => {
    const packed = LZString.compressToEncodedURIComponent(JSON.stringify(getSettings()));
    window.location.hash = packed;
    navigator.clipboard.writeText(window.location.href);
    setShared(true);
    setTimeout(() => setShared(false), 1500);
  };

  // On first load: honour a shared settings link if present, otherwise land on a
  // random image + random look so every fresh visit looks different. Deferred a frame
  // (behind the splash) so we're not setting state synchronously during mount.
  useEffect(() => {
    const id = setTimeout(() => {
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash) { shuffleAll(); return; }
      try {
        const json = LZString.decompressFromEncodedURIComponent(hash);
        if (!json) { shuffleAll(); return; }
        applyLoadedSettings(JSON.parse(json));
      } catch { shuffleAll(); }
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render each look preset onto the CURRENT image for the preview cards, so the
  // thumbnails reflect whatever the user uploaded. Regenerated (in small batches so
  // 60+ renders don't block the main thread) whenever the source image changes.
  useEffect(() => {
    if (!imageSrc) return;
    let cancelled = false;
    const run = () => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        setLookThumbs({});   // drop stale thumbnails
        const W = 200, H = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
        let i = 0;
        const step = () => {
          if (cancelled) return;
          const batch = {};
          for (let n = 0; n < 6 && i < LOOK_PRESETS.length; n++, i++) {
            const p = LOOK_PRESETS[i];
            // Non-carrying looks render at the user's current detail, so the shelf shows
            // "your photo, this palette, your resolution". Carrying looks use their own.
            const s = { ...LOOK_BASE, ...p.settings, detail: p.carriesDetail ? p.settings.detail : detail };
            try { batch[p.name] = renderSettingsToCanvas(img, s, W, H).toDataURL('image/png'); }
            catch { /* skip a look that fails to render */ }
          }
          setLookThumbs(prev => ({ ...prev, ...batch }));
          if (i < LOOK_PRESETS.length) setTimeout(step, 0);
        };
        step();
      };
      img.src = imageSrc;
    };
    const t = setTimeout(run, 220); // debounce so dragging detail doesn't thrash re-renders
    return () => { cancelled = true; clearTimeout(t); };
  }, [imageSrc, detail]);

  useEffect(() => { viewRef.current = {zoom, pan}; }, [zoom, pan]);

  const clampZoom = z => Math.max(0.25, Math.min(8, z));
  const resetView = () => { setZoom(1); setPan({x:0,y:0}); };

  // Below md (768px) we swap the two-tab sidebar for a per-section tabbed layout.
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setIsNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // Added-to-home-screen (PWA standalone): no browser chrome, so the presets gallery gets the
  // full screen height for bigger thumbnails.
  const [isStandalone] = useState(() =>
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true));

  // Decide pixelated vs smooth from the actual on-screen size vs the render's native size.
  const checkSmooth = useCallback(() => {
    const im = previewImgRef.current;
    if (!im || !im.naturalWidth) return;
    // object-contain: the element box fills the pane; the image is fitted inside it.
    const fit = Math.min(im.clientWidth / im.naturalWidth, im.clientHeight / im.naturalHeight);
    setSmoothScale(fit * zoom < 0.98);   // displayed smaller than native → downscaling
  }, [zoom]);
  useEffect(() => {
    checkSmooth();
    const im = previewImgRef.current;
    if (!im || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(checkSmooth);
    ro.observe(im);
    return () => ro.disconnect();
  }, [checkSmooth, outputUrl, imageSrc]);
  // Zoom to a target level while keeping the point (px,py) — measured from the viewport centre — fixed.
  const zoomAt = (target, px, py) => {
    const {zoom:z, pan:p} = viewRef.current;
    const nz = clampZoom(target);
    const lx = (px - p.x)/z, ly = (py - p.y)/z;
    setZoom(nz);
    setPan({ x: px - nz*lx, y: py - nz*ly });
  };

  // Desktop keyboard shortcuts: +/= zoom in, - zoom out, 0 fit, Space (held) shows the original.
  useEffect(() => {
    if (isNarrow) return;
    const typing = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = e => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing()) return;
      if (e.code === 'Space') {
        e.preventDefault();               // stop the page from scrolling
        if (outputUrl && !e.repeat) setComparing(true);
        return;
      }
      switch (e.key) {
        case '+': case '=': e.preventDefault(); zoomAt(viewRef.current.zoom+0.25,0,0); break;
        case '-': case '_': e.preventDefault(); zoomAt(viewRef.current.zoom-0.25,0,0); break;
        case '0': e.preventDefault(); resetView(); break;
        default: break;
      }
    };
    const up = e => { if (e.code === 'Space') setComparing(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [isNarrow, outputUrl]);

  // Pan by dragging; zoom to the cursor via wheel/trackpad-pinch; zoom to the midpoint via touch pinch.
  useEffect(() => {
    const el = zoomAreaRef.current;
    if (!el) return;
    const rel = (cx, cy) => { const r = el.getBoundingClientRect(); return [cx - r.left - r.width/2, cy - r.top - r.height/2]; };

    const onWheel = (e) => {
      if(lightboxRef.current) return;
      e.preventDefault();
      const {zoom:z} = viewRef.current;
      const [px, py] = rel(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      zoomAt(z*factor, px, py);
    };

    // Drag to pan. Bind move/up dynamically on each pointerdown (on window, so the drag
    // tracks even when the cursor leaves the canvas). Keeping the drag state local to the
    // onDown call — instead of a shared flag on the effect — means an in-flight drag can't
    // be interrupted by a re-render, which was silently cancelling every pan.
    const onDown = (e) => {
      if(e.pointerType==='touch') return;
      if(e.button!==0 || lightboxRef.current) return;
      let prev=[e.clientX,e.clientY];
      el.style.cursor='grabbing';
      e.preventDefault();
      const move=(ev)=>{
        // Compute the delta now and update `prev` before scheduling state — the setPan
        // updater runs lazily at render time, so it must close over the numbers, not `prev`.
        const dx=ev.clientX-prev[0], dy=ev.clientY-prev[1];
        prev=[ev.clientX,ev.clientY];
        setPan(p=>({x:p.x+dx, y:p.y+dy}));
      };
      const up=()=>{ el.style.cursor='grab'; window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); };
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',up);
    };

    let last = null, pinch = null, tapInfo = null;
    // Touch "hold to compare": a still one-finger press reveals the original; any real
    // movement cancels it and becomes a pan, so the gesture never fights scrolling/panning.
    let pressTimer = null, pressStart = null, compareOn = false;
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    const endCompare = () => { if (compareOn) { compareOn = false; setComparing(false); } };

    const onTouchMove = (e) => {
      if(lightboxRef.current){   // lightbox: no pan/zoom, just keep a real drag from counting as a tap
        e.preventDefault();
        const t=e.touches[0];
        if(t && tapInfo && Math.hypot(t.clientX-tapInfo.x, t.clientY-tapInfo.y)>10) tapInfo=null;
        return;
      }
      if(e.touches.length===1 && !pinch){
        const t=e.touches[0];
        if (compareOn) { e.preventDefault(); return; }              // holding original: swallow movement
        if (pressStart && Math.hypot(t.clientX-pressStart[0], t.clientY-pressStart[1]) < 10) {
          if (pressTimer) { e.preventDefault(); return; }           // within threshold, still deciding
        } else { clearPress(); }                                    // moved → it's a pan
        e.preventDefault();
        if(last){ const dx=t.clientX-last[0], dy=t.clientY-last[1]; if(Math.abs(dx)+Math.abs(dy)>2) tapInfo=null; setPan(p=>({x:p.x+dx, y:p.y+dy})); }
        last=[t.clientX,t.clientY];
      } else if(e.touches.length===2){
        e.preventDefault();
        tapInfo=null; clearPress(); endCompare();
        const [a,b]=e.touches;
        const dist=Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
        const [mx,my]=rel((a.clientX+b.clientX)/2, (a.clientY+b.clientY)/2);
        if(pinch){ zoomAt(viewRef.current.zoom*(dist/pinch.dist), mx, my); }
        pinch={dist};
      }
    };
    const onTouchStart = (e) => {
      last = e.touches.length? [e.touches[0].clientX,e.touches[0].clientY] : null;
      // Only a tap on the bare photo toggles the lightbox — not on an overlay control (reset, %).
      tapInfo = (e.touches.length===1 && !(e.target.closest && e.target.closest('button'))) ? {t:Date.now(), x:e.touches[0].clientX, y:e.touches[0].clientY} : null;
      clearPress(); pressStart = null;
      if (e.touches.length === 1 && canCompareRef.current) {
        pressStart = [e.touches[0].clientX, e.touches[0].clientY];
        pressTimer = setTimeout(() => { pressTimer = null; compareOn = true; setComparing(true); }, 280);
      }
    };
    const onTouchEnd = (e) => {
      if(e.touches.length<2) pinch=null;
      if(e.touches.length===1){
        // A finger lifted mid-pinch: reseat the pan origin onto the finger that's still down,
        // otherwise the next move is measured from a stale point and the image snaps sideways.
        last=[e.touches[0].clientX, e.touches[0].clientY];
        tapInfo=null;
      }
      if(e.touches.length===0){
        // A quick, still, single-finger tap (not a hold, pan or pinch) toggles the mobile
        // full-screen lightbox and recentres the photo.
        if(tapInfo && !compareOn && Date.now()-tapInfo.t < 250 && window.innerWidth < 768){
          setZoom(1); setPan({x:0,y:0}); setLightbox(v=>!v);
        }
        last=null; clearPress(); endCompare(); pressStart=null; tapInfo=null;
      }
    };

    el.addEventListener('wheel', onWheel, { passive:false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('touchstart', onTouchStart, { passive:false });
    el.addEventListener('touchmove', onTouchMove, { passive:false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render the full pipeline at a given max dimension and return a fresh canvas (no state
  // side-effects). The preview calls this at 900px (fast, interactive); export calls it at
  // the upload's native resolution. Detail is calibrated at 900px, so the pattern size is
  // scaled by (renderLongSide / 900) to keep the same visual density at any resolution.
  const composeOutput = useCallback((maxDim) => {
    const img = imgRef.current;
    if (!img||!img.complete||!img.naturalWidth) return null;
    let w=img.naturalWidth, h=img.naturalHeight;
    const sc=Math.min(1,maxDim/Math.max(w,h));
    w=Math.max(1,Math.round(w*sc)); h=Math.max(1,Math.round(h*sc));
    const scale=Math.max(w,h)/900;

    const ex=1+exposure/100, cf=(100+contrast)/100;
    const getY=(r,g,b)=>{
      let y=luminance([r,g,b])*ex;
      y=(y-0.5)*cf+0.5;
      y=Math.pow(Math.max(0,Math.min(1,y)),1/midtones);
      if(y>0.5) y=0.5+(y-0.5)*highlights; else y=0.5-(0.5-y)*shadows;
      return Math.max(0,Math.min(1,y));
    };

    let canvas;
    const tp=transparentBg;
    const dv = revealDetail ?? detail;   // render-only reveal override; falls back to the slider value
    if(mode==='dither') canvas=renderDither({img,w,h,px:Math.max(1,detailToSize('dither',dv)*scale),palette,algo,getY,transparent:tp,colorMode:dcolor,adaptiveCount,gamut,saturation});
    else if(mode==='ascii') canvas=renderAscii({img,w,h,ramp:asciiRamp,fgColor:asciiFg,bgColor:asciiBg,cellSize:Math.max(3,detailToSize('ascii',dv)*scale),getY,transparent:tp,invert:asciiInvert,cutout:asciiCutout,bold:asciiBold});
    else canvas=renderHalftone({img,w,h,shape:htShape,dotSize:Math.max(0.8,detailToSize('halftone',dv)*scale),angle:htAngle,inkColor:htInk,paperColor:htPaper,getY,transparent:tp});
    if (!canvas) return null;

    const darkColor=mode==='dither'
      ?'#'+[...palette].sort((a,b)=>a.anchor-b.anchor)[0]?.color?.slice(1)
      :mode==='ascii'?asciiBg:'#000000';

    // Snapshot the rendered alpha so atmosphere passes can't paint over transparent areas.
    let alphaMask=null;
    if(tp){
      const ctx=canvas.getContext('2d');
      const id=ctx.getImageData(0,0,canvas.width,canvas.height);
      alphaMask=new Uint8ClampedArray(canvas.width*canvas.height);
      for(let i=0,p=0;i<id.data.length;i+=4,p++) alphaMask[p]=id.data[i+3];
    }

    applyAtmosphere(canvas,{phosphorGlow,luminanceLift,scanlines,noise,chromaShift,phosphorGrid,darkColor});

    if(tp&&alphaMask){
      const ctx=canvas.getContext('2d');
      const id=ctx.getImageData(0,0,canvas.width,canvas.height);
      const d=id.data;
      for(let i=0,p=0;i<d.length;i+=4,p++) d[i+3]=alphaMask[p];
      ctx.putImageData(id,0,0);
    }
    return canvas;
  }, [mode,palette,algo,dcolor,adaptiveCount,gamut,detail,revealDetail,asciiRamp,asciiFg,asciiBg,asciiInvert,asciiCutout,asciiBold,htShape,htAngle,htInk,htPaper,exposure,contrast,midtones,highlights,shadows,phosphorGlow,luminanceLift,scanlines,noise,chromaShift,phosphorGrid,saturation,transparentBg]);

  const process = useCallback(() => {
    const canvas = composeOutput(900);
    if (!canvas) return;
    outputCanvasRef.current = canvas;
    setOutputUrl(canvas.toDataURL('image/png'));
  }, [composeOutput]);

  // Bump a tick when the source image finishes loading. Don't call process() from onload —
  // that closure can be stale (settings applied after this effect last ran, e.g. a preset
  // picked on load with the same sample URL), which rendered the old look until the next
  // settings change. Instead let the render effect below (which always holds the current
  // process) fire off the tick.
  const [imgTick, setImgTick] = useState(0);
  useEffect(() => {
    if (!imageSrc) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) {
      imgRef.current = img; setImgTick(t => t + 1);
      if (img.naturalHeight) setImgAspect(img.naturalWidth / img.naturalHeight);
      if (pendingSweepRef.current !== false) { const tgt = pendingSweepRef.current; pendingSweepRef.current = false; sweepDetail(tgt); }
    } };
    img.src = imageSrc;
    return () => { cancelled = true; };
  }, [imageSrc]);

  // Coalesce rapid setting changes (e.g. dragging a slider) into one render per frame
  // so the heavy full-canvas render + toDataURL doesn't stutter, especially on mobile.
  useEffect(() => {
    if (!imgRef.current) return;
    const id = requestAnimationFrame(() => process());
    return () => cancelAnimationFrame(id);
  }, [process, imgTick]);

  // ── Splash: hide once the first render exists and a minimum on-screen time passed,
  // so it covers the initial processing flash without ever flickering. ──
  useEffect(() => {
    if (!booting || !outputUrl) return;
    const wait = Math.max(0, 700 - (Date.now() - bootStart.current));
    const t1 = setTimeout(() => setBootHiding(true), wait);
    const t2 = setTimeout(() => setBooting(false), wait + 550);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [booting, outputUrl]);
  // First visit lands chunky (detail 0, set in shuffleAll); the moment the splash STARTS
  // fading, ramp the pixelisation up to the landing look's real detail — so the reveal
  // plays as the logo leaves, with no dead gap, instead of waiting for it to fully unmount.
  useEffect(() => {
    if (!bootHiding || bootSweepRef.current === false) return;
    const target = bootSweepRef.current;
    bootSweepRef.current = false;
    sweepDetail(target);
  }, [bootHiding]);
  // Safety net: never trap the user behind the splash if a render never lands.
  useEffect(() => {
    const t = setTimeout(() => { setBootHiding(true); setTimeout(() => setBooting(false), 550); }, 5000);
    return () => clearTimeout(t);
  }, []);

  // Compare is only meaningful once processed output exists (read by the touch handlers).
  canCompareRef.current = !!outputUrl;
  lightboxRef.current = lightbox;
  const showingOriginal = comparing && !!outputUrl;

  const handleDownload = async () => {
    const now = new Date();
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join('');
    const base = fileName
      ? fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase()
      : 'phosphor';

    // Vector export: regenerate from the source image + live settings (no supersampling,
    // no atmosphere) and download the .svg directly.
    if (format==='svg') {
      const img = imgRef.current;
      if (!img || !img.naturalWidth) return;
      const maxDim=900;
      const sc=Math.min(1, maxDim/Math.max(img.naturalWidth, img.naturalHeight));
      const w=Math.max(1,Math.round(img.naturalWidth*sc)), h=Math.max(1,Math.round(img.naturalHeight*sc));
      let svg;
      try { svg = renderSettingsToSVG(img, { ...getSettings(), transparent: transparentBg }, w, h); }
      catch { return; }
      const blobUrl = URL.createObjectURL(new Blob([svg], { type:'image/svg+xml' }));
      const a = document.createElement('a');
      a.download = `${base}_${mode}_${time}.svg`;
      a.href = blobUrl; a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      return;
    }

    // Raster export re-renders at the upload's native resolution (capped), independent of
    // the 900px preview — so a big photo exports big without slowing down live editing.
    const canvas = composeOutput(EXPORT_MAX);
    if (!canvas) return;
    const ext = format==='jpeg' ? 'jpg' : 'png';
    const mime = format==='jpeg' ? 'image/jpeg' : 'image/png';
    const filename = `${base}_${mode}_${time}.${ext}`;

    let url;
    if (format==='jpeg') {
      // JPEG has no alpha — flatten onto white so transparency doesn't turn black
      const flat = document.createElement('canvas');
      flat.width = canvas.width; flat.height = canvas.height;
      const fx = flat.getContext('2d');
      fx.fillStyle = '#ffffff'; fx.fillRect(0,0,flat.width,flat.height);
      fx.drawImage(canvas,0,0);
      url = flat.toDataURL(mime, 0.92);
    } else {
      url = canvas.toDataURL(mime);
    }

    // Touch devices: offer the native share sheet (so users can Save to Photos).
    // Desktop: always download directly — the share sheet there just gets in the way.
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (isTouch && navigator.canShare) {
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    const a = document.createElement('a');
    a.download = filename;
    a.href = url; a.click();
  };

  // Copy the rendered image (PNG — the only format browsers accept for image clipboard)
  // at native resolution. ClipboardItem is created synchronously with a blob promise so
  // Safari accepts it inside the click gesture.
  const handleCopy = async () => {
    if (!navigator.clipboard || !window.ClipboardItem) return;
    const canvas = composeOutput(EXPORT_MAX);
    if (!canvas) return;
    try {
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; ignore */ }
  };

  const updateColor  = (id,hex) => { setPaletteKey(null); setPalette(p=>p.map(e=>e.id===id?{...e,color:hex}:e)); };
  const updateAnchor = (id,val) => { setPaletteKey(null); setPalette(p=>p.map(e=>e.id===id?{...e,anchor:val}:e)); };
  const addColor     = () => { if(palette.length<8){ setPaletteKey(null); setPalette(p=>[...p,mkEntry('#888888',0.5)]); } };
  const removeColor  = (id) => { if(palette.length>2){ setPaletteKey(null); setPalette(p=>p.filter(e=>e.id!==id)); } };
  const displayPalette = [...palette].sort((a,b)=>a.anchor-b.anchor);

  // Reset-to-default affordances: only surfaced once a value has moved off its baseline.
  const appearanceDirty = exposure!==0 || contrast!==0 || midtones!==1 || highlights!==1 || shadows!==1;
  const resetAppearance = () => { setExposure(0); setContrast(0); setMidtones(1); setHighlights(1); setShadows(1); };
  const atmosphereDirty = phosphorGlow!==0 || luminanceLift!==0 || scanlines!==0 || noise!==0 || chromaShift!==0 || phosphorGrid!==0;
  const resetAtmosphere = () => { setPhosphorGlow(0); setLuminanceLift(0); setScanlines(0); setNoise(0); setChromaShift(0); setPhosphorGrid(0); };

  // ── Control panels, factored so the desktop sidebar (long scroll) and the mobile
  //    per-section tabs can compose the same pieces without duplicating markup. ──
  const presetsBody = (<>
    <div className="sticky top-0 z-10 bg-zinc-950/70 backdrop-blur px-4 py-3">
      <NumSlider label="Detail" value={detail} min={0} max={100} step={mode==='dither'?DITHER_DETAIL_STEP:1} onChange={setDetailOwned}/>
    </div>
    <div className="anim-fadein flex flex-col">
      {CATEGORIES.map(([key,label])=>{
        const looks = LOOK_PRESETS.filter(p=>p.category===key);
        if(!looks.length) return null;
        const isDevices = key==='hardware';
        const shown = isDevices && !showAllDevices ? looks.slice(0,6) : looks;
        const hidden = isDevices ? looks.length-6 : 0;
        return (
        <Panel key={key} label={label} bare>
          {isDevices &&
            <p className="text-[11px] leading-relaxed text-zinc-500 -mt-1">
              Maps colors to device gamut and Detail to native pixel density.
            </p>}
          <div className="grid grid-cols-4 md:grid-cols-2 gap-1.5">
            {shown.map(p=>{
              const on=activeLook===p.name;
              return (
              <button key={p.name} onClick={()=>applyLookPreset(p)} title={p.name}
                className={`group flex flex-col overflow-hidden border transition-colors ${on?'border-amber-600':'border-zinc-800 hover:border-zinc-600'}`}>
                <div className="relative aspect-[16/10] w-full bg-zinc-900 overflow-hidden">
                  {lookThumbs[p.name]
                    ? <img src={lookThumbs[p.name]} alt="" className="w-full h-full object-cover" style={{imageRendering:p.settings.mode==='ascii'?'auto':'pixelated'}}/>
                    : <div className="w-full h-full animate-pulse bg-zinc-800"/>}
                </div>
                <div className={`text-[9px] md:text-[11px] leading-tight py-1.5 px-0.5 text-center ${on?'text-amber-100 bg-amber-950/40':'text-zinc-400 group-hover:text-zinc-200'}`}>{p.name}</div>
              </button>
            );})}
          </div>
          {isDevices && hidden>0 &&
            <button onClick={()=>setShowAllDevices(v=>!v)}
              className="tap-target w-full py-1 border border-zinc-800 hover:border-amber-700 text-zinc-600 hover:text-amber-400 flex items-center justify-center gap-1.5 text-xs transition-colors">
              {showAllDevices ? 'Show less' : `Show ${hidden} more`}
              <ChevronDown size={12} className={`transition-transform ${showAllDevices?'rotate-180':''}`}/>
            </button>}
        </Panel>
        );
      })}
    </div>
  </>);

  // ── Mobile presets: one horizontal filmstrip of all looks (category order, no section
  //    breaks) under a sticky category rail. Tapping a tag jumps the strip to that category;
  //    scrolling the strip highlights the tag you're currently in (scroll-spy). ──
  const scrollToCat = (key) => {
    const el = catRefs.current[key];
    if (el && filmRef.current) filmRef.current.scrollTo({ left: Math.max(0, el.offsetLeft - 12), behavior: 'smooth' });
    setActiveCat(key);
    tagRefs.current[key]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };
  const onFilmScroll = () => {
    if (spyRaf.current) return;
    spyRaf.current = requestAnimationFrame(() => {
      spyRaf.current = 0;
      const film = filmRef.current; if (!film) return;
      const sl = film.scrollLeft;
      const maxScroll = film.scrollWidth - film.clientWidth;
      let cur = CATEGORIES[0][0];
      for (const [key] of CATEGORIES) {
        const el = catRefs.current[key];
        if (!el) continue;
        if (el.offsetLeft - 28 <= sl) cur = key; else break;
      }
      // The last categories don't have enough cards after them to reach the left edge, so their
      // tag would never light on its own. Once scrolled to the very end, select the last
      // non-empty category — otherwise jumping to (or landing on) Type would immediately deselect.
      if (maxScroll > 0 && sl >= maxScroll - 2) {
        for (let i = CATEGORIES.length - 1; i >= 0; i--) {
          if (LOOK_PRESETS.some(p => p.category === CATEGORIES[i][0])) { cur = CATEGORIES[i][0]; break; }
        }
      }
      setActiveCat(prev => {
        if (prev !== cur) tagRefs.current[cur]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
        return cur;
      });
    });
  };
  const presetsBodyMobile = (
    <div className="anim-fadein flex flex-1 min-h-0 flex-col">
      <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3 pb-2.5">
        {CATEGORIES.map(([key,label])=>{
          if(!LOOK_PRESETS.some(p=>p.category===key)) return null;
          const on = activeCat===key;
          return (
            <button key={key} ref={el=>tagRefs.current[key]=el} onClick={()=>scrollToCat(key)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] tracking-wide transition-colors ${on?'border-amber-600 bg-amber-950/40 text-amber-100':'border-zinc-800 text-zinc-500 active:text-zinc-300'}`}>
              {label}
            </button>
          );
        })}
      </div>
      {/* Cards fill whatever editor height is left (so nothing is clipped by the browser chrome
          and the strip uses the real estate available), capped so they never get extreme. Fixed
          width → ~3.7 in view; width scales with the viewport so bigger phones get bigger cards. */}
      <div ref={filmRef} onScroll={onFilmScroll}
        className="no-scrollbar relative flex min-h-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden px-4 py-2">
        {(() => {
          const items = []; let shown = 0;
          for (const [key] of CATEGORIES) {
            const looks = LOOK_PRESETS.filter(p=>p.category===key);
            if (!looks.length) continue;
            if (shown>0) items.push(<div key={key+'__div'} className="h-2/3 w-px shrink-0 self-center bg-zinc-800"/>);
            looks.forEach((p,pi)=>{
              const on = activeLook===p.name;
              items.push(
                <button key={p.name} onClick={()=>applyLookPreset(p)}
                  ref={pi===0 ? (el=>{catRefs.current[key]=el;}) : undefined}
                  className={`group flex h-full shrink-0 flex-col overflow-hidden border transition-colors ${on?'border-amber-600':'border-zinc-800'}`}
                  style={{width:'clamp(104px, 26vw, 184px)', maxHeight: isStandalone ? '66dvh' : '300px'}}>
                  <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-zinc-900">
                    {lookThumbs[p.name]
                      ? <img src={lookThumbs[p.name]} alt="" className="h-full w-full object-cover" style={{imageRendering:p.settings.mode==='ascii'?'auto':'pixelated'}}/>
                      : <div className="h-full w-full animate-pulse bg-zinc-800"/>}
                  </div>
                  <div className={`shrink-0 px-0.5 py-1.5 text-center text-[10px] leading-tight ${on?'bg-amber-950/40 text-amber-100':'text-zinc-400'}`}>{p.name}</div>
                </button>
              );
            });
            shown++;
          }
          return items;
        })()}
      </div>
      <div className="px-4 pt-2 pb-3 shrink-0">
        <NumSlider label="Detail" value={detail} min={0} max={100} step={mode==='dither'?DITHER_DETAIL_STEP:1} onChange={setDetailOwned}/>
      </div>
    </div>
  );

  const renderingPanel = (
    <Panel label="Rendering">
      <Field label="Mode">
        <Segmented options={[['dither','Dither'],['ascii','ASCII'],['halftone','Halftone']]} value={mode} onChange={handleModeChange}/>
      </Field>
      {mode==='dither' && <>
        <Field label="Pattern">
          <Dropdown value={algo} onChange={setAlgo}
            options={[['bayer2','Grid 2×2'],['bayer','Grid 4×4'],['bayer8','Grid 8×8'],['diamond','Diamond'],['bluenoise','Blue noise'],['diffusion','Floyd–Steinberg'],['jjn','Jarvis'],['stucki','Stucki'],['sierra','Sierra'],['atkinson','Atkinson'],['riemersma','Riemersma']]}/>
        </Field>
      </>}
      {mode==='ascii' &&
        <Field label="Character set">
          <Dropdown value={asciiRamp} onChange={setAsciiRamp}
            options={Object.entries(ASCII_RAMPS).map(([k,v])=>[k, v.label[0]+v.label.slice(1).toLowerCase(), v.chars])}/>
        </Field>}
      {mode==='halftone' && <>
        <Field label="Dot shape">
          <Segmented value={htShape} onChange={setHtShape}
            options={[['circle',<Circle size={13}/>],['square',<Square size={13}/>],['diamond',<Diamond size={13}/>],['line',<Minus size={15}/>]]}/>
        </Field>
        <NumSlider label="Screen angle" value={htAngle} min={0} max={90} step={1} onChange={setHtAngle}/>
      </>}
      <NumSlider label="Detail" value={detail} min={0} max={100} step={mode==='dither'?DITHER_DETAIL_STEP:1} onChange={setDetailOwned}/>
    </Panel>
  );

  const appearancePanel = (
    <Panel label="Light" action={appearanceDirty && <ResetButton onClick={resetAppearance} title="Reset light"/>}>
      <NumSlider label="Exposure"   value={exposure}   min={-100} max={100} step={1}    onChange={setExposure}/>
      <NumSlider label="Contrast"   value={contrast}   min={-100} max={100} step={1}    onChange={setContrast}/>
      <NumSlider label="Highlights" value={highlights} min={0.3}  max={2.5} step={0.05} onChange={setHighlights}/>
      <NumSlider label="Midtones"   value={midtones}   min={0.3}  max={2.5} step={0.05} onChange={setMidtones}/>
      <NumSlider label="Shadows"    value={shadows}    min={0.3}  max={2.5} step={0.05} onChange={setShadows}/>
    </Panel>
  );

  const ditherColorPanel = (
    <Panel label="Color">
      <Field label="Mode">
        <Segmented options={[['palette','Palette'],['adaptive','Adaptive']]} value={dcolor} onChange={setDcolor}/>
      </Field>
      {dcolor==='adaptive' ? <>
        <Field label="Gamut">
          <Dropdown value={gamut} onChange={setGamut}
            options={[['full','Full color']].concat(Object.entries(DEVICE_GAMUTS).map(([k,g])=>[k,g.label]))}/>
        </Field>
        {gamut==='full' && <NumSlider label="Colors" value={adaptiveCount} min={2} max={16} step={1} onChange={setAdaptiveCount}/>}
        {gamut==='full' && <NumSlider label="Saturation" value={saturation} min={0} max={200} step={1} onChange={setSaturation}/>}
        <div className="text-xs text-zinc-600 leading-relaxed">{gamut==='full'
          ? "Builds a palette from the photo's own colours and maps each pixel to the nearest — the image keeps its real hues instead of a fixed look."
          : `Maps the photo onto the ${(DEVICE_GAMUTS[gamut]||{label:gamut}).label} color set — authentic hardware colors, approximated from your image.`}</div>
      </> : <>
        <Field label="Palette">
          <Dropdown value={paletteKey||'__custom'}
            onChange={k=>{ if(k!=='__custom') applyPalettePreset(k); }}
            options={(paletteKey?[]:[['__custom','Custom']]).concat(Object.entries(PALETTE_PRESETS).map(([k,p])=>[k,p.name]))}
            preview={k=>{ const cols=k==='__custom'?displayPalette.map(e=>e.color):PALETTE_PRESETS[k].colors;
              return <span className="flex h-3.5 w-11 overflow-hidden border border-zinc-700">{cols.map((c,i)=><span key={i} style={{background:c,flex:1}}/>)}</span>; }}/>
        </Field>
        <div className="flex flex-col gap-1.5">
          {displayPalette.map(entry=>(
            <div key={entry.id} className="flex items-center gap-2">
              <div className="swatch relative w-7 h-7 border border-zinc-700 shrink-0">
                <input type="color" value={entry.color} onChange={e=>updateColor(entry.id,e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                <div className="w-full h-full" style={{background:entry.color}}/>
              </div>
              <HexInput value={entry.color} onChange={hex=>updateColor(entry.id,hex)}/>
              <input type="range" min={0} max={1} step={0.01} value={entry.anchor}
                onChange={e=>updateAnchor(entry.id,parseFloat(e.target.value))} className="flex-1"/>
              {palette.length>2 &&
                <button onClick={()=>removeColor(entry.id)} data-tip="Remove color" aria-label="remove color"
                  className="remove-btn text-zinc-600 hover:text-amber-400 w-4 flex items-center justify-center shrink-0">
                  <X size={10}/>
                </button>}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-zinc-700 mt-1"><span>Shadows</span><span>Highlights</span></div>
        {palette.length===2 &&
          <button onClick={invertPalette}
            className="tap-target mt-1 w-full py-1 border border-zinc-800 hover:border-amber-700 text-zinc-600 hover:text-amber-400 flex items-center justify-center gap-1.5 text-xs">
            <ArrowLeftRight size={10}/> Invert
          </button>}
        <button onClick={addColor} disabled={palette.length>=8}
          data-tip={palette.length>=8?'Maximum of 8 colors reached':'Add a color'}
          className="mt-1 w-full py-1 border border-dashed border-zinc-800 enabled:hover:border-amber-700 text-zinc-600 enabled:hover:text-amber-400 disabled:opacity-40 disabled:cursor-default flex items-center justify-center gap-1 text-xs">
          <Plus size={10}/> Add color
        </button>
      </>}
    </Panel>
  );

  const asciiSubjectPanel = (
    <Panel label="Subject">
      <Field label="Characters on">
        <Segmented options={[[false,'Bright'],[true,'Dark']]} value={asciiInvert} onChange={setAsciiInvert}/>
      </Field>
      <Field label="Weight">
        <Segmented options={[[false,'Regular'],[true,'Bold']]} value={asciiBold} onChange={setAsciiBold}/>
      </Field>
      <NumSlider label="Clear background" value={asciiCutout} min={0} max={95} step={1} onChange={setAsciiCutout}/>
      <div className="text-xs text-zinc-600 leading-relaxed">Raise to leave flat areas blank so only the subject is drawn. Toggle whether bright or dark pixels get characters.</div>
    </Panel>
  );

  const asciiColorsPanel = (
    <Panel label="Colors">
      <div className="flex items-center gap-4">
        <ColorSwatch label="Text" value={asciiFg} onChange={setAsciiFg}/>
        <ColorSwatch label="Bg"   value={asciiBg} onChange={setAsciiBg}/>
        <InvertButton onClick={invertAscii} title="swap text and background"/>
      </div>
    </Panel>
  );

  const halftonePrintPanel = (
    <Panel label="Print">
      <div className="flex items-center gap-4 mb-1">
        <ColorSwatch label="Ink"   value={htInk}   onChange={setHtInk}/>
        <ColorSwatch label="Paper" value={htPaper} onChange={setHtPaper}/>
        <InvertButton onClick={invertHalftone} title="swap ink and paper"/>
      </div>
    </Panel>
  );

  const atmospherePanel = (
    <Panel label="Effects" action={atmosphereDirty && <ResetButton onClick={resetAtmosphere} title="Reset effects"/>}>
      <NumSlider label="Phosphor glow"  value={phosphorGlow}  min={0} max={100} step={1} onChange={setPhosphorGlow}/>
      <NumSlider label="Luminance lift" value={luminanceLift} min={0} max={100} step={1} onChange={setLuminanceLift}/>
      <NumSlider label="Scanlines" value={scanlines} min={0} max={100} step={1} onChange={setScanlines}/>
      <NumSlider label="Noise"     value={noise}     min={0} max={100} step={1} onChange={setNoise}/>
      <NumSlider label="Chroma shift" value={chromaShift} min={0} max={20} step={0.5} onChange={setChromaShift}/>
      <NumSlider label="Phosphor grid" value={phosphorGrid} min={0} max={100} step={1} onChange={setPhosphorGrid}/>
    </Panel>
  );

  const shareLinkPanel = (
    <Panel label="Share settings">
      <button onClick={shareSettings}
        className="tap-target flex items-center justify-center gap-2 py-2 border border-zinc-800 text-zinc-400 hover:text-amber-400 hover:border-amber-800 text-xs tracking-wider transition-colors">
        <Share2 size={11}/> {shared?'Link copied!':'Copy settings link'}
      </button>
      <div className="text-xs text-zinc-600 leading-relaxed">Copies a link that reopens the tool with all of the current settings applied.</div>
    </Panel>
  );

  // Mode-specific colour grouping used by both layouts (ASCII keeps subject + colours together on desktop).
  const desktopModeGroup = mode==='dither'
    ? <div key="dither" className="anim-fadein flex flex-col">{ditherColorPanel}</div>
    : mode==='ascii'
    ? <div key="ascii" className="anim-fadein flex flex-col">{asciiSubjectPanel}{asciiColorsPanel}</div>
    : <div key="halftone" className="anim-fadein flex flex-col">{halftonePrintPanel}</div>;

  const mobileColorPanel = mode==='dither' ? ditherColorPanel : mode==='ascii' ? asciiColorsPanel : halftonePrintPanel;

  // Icon tabs for the mobile layout. Section names live in each panel header, so icons carry the bar.
  const MOBILE_TABS = [
    ['presets','Presets',FilterIcon],
    ['rendering','Rendering',Grid3x3],
    ['appearance','Light',Sun],   // internal key stays 'appearance'
    ['color','Color',Palette],
    ['atmosphere','Effects',Radio],   // internal key stays 'atmosphere'
    ['share','Save',Save],
  ];
  const mobileTabIds = MOBILE_TABS.map(t=>t[0]);
  const lb = lightbox && isNarrow;   // full-screen photo view (mobile only)
  // Size the mobile preview to the photo — enough to fill the width — plus a slice of
  // breathing room (the +7dvh) so a landscape shot isn't jammed against the bar and tabs.
  // A portrait photo would otherwise peg the max and eat the whole screen, so cap it lower
  // (44dvh vs 54dvh) — it stays plenty readable and leaves the presets gallery real room.
  const previewMax = imgAspect < 1 ? 44 : 54;
  const previewHeight = `clamp(34dvh, calc(${(100/imgAspect).toFixed(1)}vw + 7dvh), ${previewMax}dvh)`;

  // Fast icon tooltips (desktop / hover-capable pointers only). Native `title` waits ~1s to
  // appear, which feels broken on the icon actions (section reset, before, remove colour…). A
  // single delegated listener shows a styled tooltip for any [data-tip] element after a short
  // delay instead. Touch devices keep their native behaviour (no hover) and are skipped.
  const [tip, setTip] = useState(null);
  useEffect(() => {
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    let timer, cur = null;
    const clear = () => { clearTimeout(timer); cur = null; setTip(null); };
    const over = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el === cur) return;
      clearTimeout(timer); cur = el;
      const text = el?.getAttribute('data-tip');
      if (!text) { setTip(null); return; }
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const above = r.top > 44;
        setTip({ text, x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above });
      }, 150);
    };
    const out = (e) => { if (e.target.closest?.('[data-tip]')) clear(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', clear, true);
    window.addEventListener('scroll', clear, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('scroll', clear, true);
    };
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-300 font-mono overflow-hidden"
      style={{height:'100svh',paddingTop:'env(safe-area-inset-top)',paddingLeft:'env(safe-area-inset-left)',paddingRight:'env(safe-area-inset-right)'}}>
      <style>{`
        input[type=range]{-webkit-appearance:none;appearance:none;height:2px;background:#3f3f46;width:100%;touch-action:pan-y}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;background:#f4e4c1;border-radius:0;cursor:pointer;margin-top:-4px}
        input[type=range]:disabled{opacity:0.35}
        input[type=number]{-moz-appearance:textfield;background:#18181b;color:#a1a1aa;border:1px solid #3f3f46;padding:2px 4px;font-size:11px;width:52px;text-align:right;font-family:monospace}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}
        input[type=number]:focus{outline:none;border-color:#b45309}
        .btn{padding:5px 0;font-size:11px;border:1px solid #3f3f46;color:#71717a;letter-spacing:.05em;cursor:pointer;text-align:center;background:transparent}
        .btn:hover{color:#d4d4d8;border-color:#71717a}
        .btn.on{border-color:#b45309;color:#fef3c7;background:#1c0a00}
        .ctrl > div:last-child > div:last-child{border-bottom-width:0}
        .rotate-lock{display:none}
        @media (orientation:landscape) and (max-height:450px){ .rotate-lock{display:flex} }
        .ctrl::-webkit-scrollbar{width:3px}
        .ctrl::-webkit-scrollbar-thumb{background:#3f3f46}
        @keyframes fadein{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}
        .anim-fadein{animation:fadein 0.18s ease-out}
        @keyframes boot{0%{transform:translateX(-120%)}100%{transform:translateX(420%)}}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}
        .no-scrollbar::-webkit-scrollbar{display:none}
        .checker{background-image:linear-gradient(45deg,#26262b 25%,transparent 25%),linear-gradient(-45deg,#26262b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#26262b 75%),linear-gradient(-45deg,transparent 75%,#26262b 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;background-color:#161619}
        @media (pointer:coarse){
          .btn{padding:12px 0;min-height:44px}
          .icon-btn{width:44px;height:44px}
          .swatch{width:44px;height:44px}
          .tap-target{min-height:44px;padding-top:10px;padding-bottom:10px}
          .collapsible-header{min-height:44px}
          .remove-btn{width:44px}
          /* Tall, transparent hit area with a thin visible track so the thumb is easy to grab. */
          input[type=range]{height:34px;background:transparent}
          input[type=range]::-webkit-slider-runnable-track{height:2px;background:#3f3f46;border-radius:2px}
          input[type=range]::-webkit-slider-thumb{width:22px;height:22px;margin-top:-10px}
          input[type=range]::-moz-range-track{height:2px;background:#3f3f46}
          input[type=range]::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:0;background:#f4e4c1}
          input[type=checkbox]{width:18px;height:18px}
        }
      `}</style>

      {tip &&
        <div className="pointer-events-none fixed z-[100] whitespace-nowrap px-2 py-1 text-[11px] tracking-wide text-zinc-200 bg-zinc-900 border border-zinc-700 shadow-md"
          style={{left:tip.x, top:tip.y, transform:`translate(-50%, ${tip.above?'-100%':'0'})`}}>
          {tip.text}
        </div>}

      {/* HEADER */}
      <div className={`${lb?'hidden':'flex'} items-center justify-between px-2 sm:px-4 py-1 sm:py-2.5 border-b border-zinc-800 shrink-0 gap-2`}>
        <div className="flex items-center gap-4 sm:gap-6 md:gap-8 min-w-0">
          <button onClick={()=>setAboutOpen(true)} data-tip="About Phosphor Studio" aria-label="About Phosphor Studio"
            className="group flex items-center gap-2 min-w-0 cursor-pointer">
            <img src="/favicon.png" alt="Phosphor Studio" className="w-6 h-6 shrink-0 rounded-[3px] transition-opacity group-hover:opacity-80"/>
            <h1 className="hidden sm:block text-base whitespace-nowrap tracking-tight">
              <span className="text-amber-100 group-hover:underline decoration-amber-100/40 underline-offset-4">Phosphor</span> <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors">Studio</span>
            </h1>
          </button>
          <div className="flex items-center gap-1">
            <button onClick={undo} disabled={!canUndo} data-tip="undo (⌘Z)" aria-label="undo"
              className="tap-target flex items-center justify-center w-7 h-7 shrink-0 md:border md:border-zinc-700 text-zinc-500 enabled:hover:text-amber-300 md:enabled:hover:border-amber-600 disabled:opacity-30 disabled:cursor-default transition-colors">
              <Undo2 size={14}/>
            </button>
            <button onClick={redo} disabled={!canRedo} data-tip="redo (⌘⇧Z)" aria-label="redo"
              className="tap-target flex items-center justify-center w-7 h-7 shrink-0 md:border md:border-zinc-700 text-zinc-500 enabled:hover:text-amber-300 md:enabled:hover:border-amber-600 disabled:opacity-30 disabled:cursor-default transition-colors">
              <Redo2 size={14}/>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label data-tip="upload" aria-label="upload photo"
            className="tap-target flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-amber-300 cursor-pointer md:border md:border-zinc-700 md:hover:border-amber-600 tracking-wide transition-colors">
            <ImagePlus size={15}/> <span>UPLOAD</span>
            <input type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </label>
          <div className="hidden md:block">
            <ExportMenu format={format} setFormat={setFormat}
              transparentBg={transparentBg} setTransparentBg={setTransparentBg} onDownload={handleDownload} onCopy={handleCopy} copied={copied}/>
          </div>
        </div>
      </div>


        <div className="flex flex-1 overflow-hidden flex-col md:flex-row" onDrop={handleDrop} onDragOver={e=>e.preventDefault()}>

          {/* IMAGE */}
          <div className={`relative bg-zinc-900 flex flex-col overflow-hidden shrink-0 md:h-auto md:flex-1 ${lb?'flex-1':''}`}
            style={(!lb && isNarrow) ? {height:previewHeight} : undefined}>
            <div ref={zoomAreaRef} onContextMenu={e=>e.preventDefault()}
              className="flex-1 overflow-hidden relative touch-none select-none" style={{cursor:'grab'}}>
              <div className="w-full h-full flex items-center justify-center" style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`,transformOrigin:'center center'}}>
                <img ref={previewImgRef} onLoad={checkSmooth} src={showingOriginal ? imageSrc : (outputUrl||imageSrc)} alt="preview" draggable={false}
                  onContextMenu={e=>e.preventDefault()}
                  className={`w-full h-full object-contain block ${transparentBg&&!showingOriginal?'checker':''}`}
                  style={{imageRendering:(mode==='ascii'||showingOriginal||smoothScale)?'auto':'pixelated',WebkitTouchCallout:'none',WebkitUserSelect:'none',userSelect:'none'}}/>
              </div>
              {showingOriginal &&
                <div className="absolute top-3 left-3 px-2 py-1 text-[10px] tracking-widest text-amber-100 bg-black/70 border border-amber-700/60 pointer-events-none">ORIGINAL</div>}
              {/* Mobile: pinch to zoom; floating reset appears only once zoomed/panned */}
              {isNarrow && (zoom!==1 || pan.x!==0 || pan.y!==0) &&
                <button onClick={resetView}
                  className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] tracking-wide text-amber-100 bg-black/70 border border-amber-700/60 rounded backdrop-blur">
                  <RotateCcw size={12}/> {Math.round(zoom*100)}%
                </button>}
              {lb && zoom===1 &&
                <div className="absolute left-1/2 -translate-x-1/2 bottom-4 px-3 py-1.5 text-[11px] tracking-wide text-zinc-300 bg-black/60 rounded-full backdrop-blur pointer-events-none anim-fadein">
                  Tap to exit
                </div>}
            </div>

            <div className="hidden md:flex relative items-center px-3 py-2 border-t border-zinc-800 shrink-0">
              <div className="flex items-center gap-1.5">
                {/* Cohesive zoom-control group: −  100%  +  Fit */}
                <div className="flex items-center border border-zinc-700 divide-x divide-zinc-700">
                  <button onClick={()=>zoomAt(viewRef.current.zoom-0.25,0,0)} data-tip="Zoom out  (−)" aria-label="zoom out"
                    className="icon-btn w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-amber-300 hover:bg-amber-950/30">
                    <ZoomOut size={12}/>
                  </button>
                  <button onClick={()=>zoomAt(1,0,0)} data-tip="Zoom to 100%" aria-label="Zoom to 100%"
                    className="text-xs text-zinc-500 hover:text-amber-300 hover:bg-amber-950/30 w-11 h-7 flex items-center justify-center tabular-nums">
                    {Math.round(zoom*100)}%
                  </button>
                  <button onClick={()=>zoomAt(viewRef.current.zoom+0.25,0,0)} data-tip="Zoom in  (+)" aria-label="zoom in"
                    className="icon-btn w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-amber-300 hover:bg-amber-950/30">
                    <ZoomIn size={12}/>
                  </button>
                  <button onClick={resetView} data-tip="Fit image to view  (0)" aria-label="Fit image to view"
                    className="text-xs text-zinc-500 hover:text-amber-300 hover:bg-amber-950/30 px-2.5 h-7 flex items-center tracking-wide">
                    FIT
                  </button>
                </div>
                <div className="hidden md:block ml-2">
                  <button
                    onPointerDown={e=>{ if(outputUrl){ e.preventDefault(); setComparing(true); } }}
                    onPointerUp={()=>setComparing(false)} onPointerLeave={()=>setComparing(false)}
                    disabled={!outputUrl} data-tip="Hold to view original" aria-label="Hold to view original"
                    className={`flex select-none items-center gap-1.5 px-2 h-7 border text-xs transition-colors ${comparing?'border-amber-600 text-amber-100 bg-amber-950/40':'border-zinc-700 text-zinc-500'} enabled:hover:border-amber-600 enabled:hover:text-amber-300 disabled:opacity-30 disabled:cursor-default`}>
                    <Eye size={12}/> BEFORE
                  </button>
                </div>
              </div>
              <a href="https://rodrigosilva.design" target="_blank" rel="noopener noreferrer"
                className="hidden lg:block ml-auto text-xs text-zinc-600 hover:text-amber-400 transition-colors">
                by rodrigosilva.design
              </a>
            </div>
          </div>

          {/* CONTROLS */}
          <div className={`${lb?'hidden':'flex'} w-full md:w-72 xl:w-80 flex-1 md:flex-none min-h-0 flex-col bg-zinc-950 border-t md:border-t-0 md:border-l border-zinc-800`}>

            {/* TAB BAR — two tabs on desktop, per-section icon tabs on mobile */}
            {isNarrow ? (
              <div className="flex shrink-0 border-b border-zinc-800">
                {MOBILE_TABS.map(([v,label,Icon])=>{
                  const on = (activeTab===v) || (v==='rendering' && !mobileTabIds.includes(activeTab));
                  return (
                    <button key={v} onClick={()=>setActiveTab(v)} data-tip={label} aria-label={label}
                      className={`tap-target flex-1 flex items-center justify-center py-3 border-b-2 transition-colors ${on?'text-amber-100 border-amber-600':'text-zinc-500 hover:text-zinc-300 border-transparent'}`}>
                      <Icon size={17}/>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex shrink-0 border-b border-zinc-800">
                {[['presets','PRESETS'],['edit','EDIT']].map(([v,l])=>(
                  <button key={v} onClick={()=>setActiveTab(v)}
                    className={`tap-target flex-1 py-2.5 text-xs font-medium tracking-wide transition-colors ${(activeTab===v||(v==='edit'&&!['presets','edit'].includes(activeTab)))?'text-amber-100 border-b-2 border-amber-600':'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'}`}>{l}</button>
                ))}
              </div>
            )}

            <div ref={ctrlRef} className="ctrl flex-1 overflow-y-auto flex flex-col"
              style={{paddingBottom:'calc(0.5rem + env(safe-area-inset-bottom))'}}>

            {isNarrow ? (
              /* MOBILE: one section per tab */
              activeTab==='presets' ? presetsBodyMobile
              : activeTab==='appearance' ? <div className="anim-fadein flex flex-col">{appearancePanel}</div>
              : activeTab==='color' ? <div className="anim-fadein flex flex-col">{mobileColorPanel}</div>
              : activeTab==='atmosphere' ? <div className="anim-fadein flex flex-col">{atmospherePanel}</div>
              : activeTab==='share' ? <div className="anim-fadein flex flex-col">
                  <Panel label="Export">
                    <ExportBody format={format} setFormat={setFormat}
                      transparentBg={transparentBg} setTransparentBg={setTransparentBg} onDownload={handleDownload} onCopy={handleCopy} copied={copied}/>
                  </Panel>
                  {shareLinkPanel}
                </div>
              : /* rendering (default) */ <div className="anim-fadein flex flex-col">
                  {renderingPanel}
                  {mode==='ascii' && asciiSubjectPanel}
                </div>
            ) : (
              /* DESKTOP: two tabs, edit is the full scroll */
              activeTab==='presets' ? presetsBody
              : <div className="anim-fadein flex flex-col">
                  {renderingPanel}
                  {appearancePanel}
                  {desktopModeGroup}
                  {atmospherePanel}
                  {shareLinkPanel}
                </div>
            )}
            </div>
          </div>
        </div>

      {aboutOpen && <AboutModal onClose={()=>setAboutOpen(false)}/>}
      {booting && <Splash hiding={bootHiding}/>}

      {/* Phones only: this is a portrait experience. Manifest orientation covers installed
          PWAs where supported (Android, newer iOS); this covers everything else. */}
      <div className="rotate-lock fixed inset-0 z-[60] flex-col items-center justify-center gap-4 bg-zinc-950 text-center px-10">
        <RotateCcw size={30} className="text-amber-400"/>
        <div className="text-sm text-zinc-300">Rotate your device to portrait</div>
        <div className="text-xs text-zinc-600">Phosphor Studio is designed for vertical screens.</div>
      </div>
    </div>
  );
}

// Professional-software boot screen: covers the first-render flash, fades into the app.
// The logo "powers on" with a phosphor/CRT flicker before the app appears.
function Splash({hiding}) {
  return (
    <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 transition-opacity duration-500 ${hiding?'opacity-0 pointer-events-none':'opacity-100'}`}>
      <img src="/icon-512.png" alt="" className="w-20 h-20 rounded-lg"/>
      <h1 className="mt-5 text-lg tracking-tight"><span className="text-amber-100">Phosphor</span> <span className="text-zinc-500">Studio</span></h1>
      <div className="mt-5 w-40 h-px bg-zinc-800 overflow-hidden">
        <div className="h-full w-1/3 bg-amber-500/80" style={{animation:'boot 1.1s ease-in-out infinite'}}/>
      </div>
      <div className="mt-4 text-[10px] tracking-[0.3em] text-zinc-600">INITIALIZING</div>
    </div>
  );
}

// Brand glyphs — lucide dropped its brand icons, so these are inline.
const GithubIcon = ({size=15}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.4-1.27.74-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.28 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z"/>
  </svg>
);
const LinkedinIcon = ({size=15}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0Z"/>
  </svg>
);
const XIcon = ({size=14}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z"/>
  </svg>
);

// Dismissable about: full-height sheet on mobile, centred card on desktop.
function AboutModal({onClose}) {
  useEffect(() => {
    const onKey = e => { if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const socials = [
    ['Website', AUTHOR_URL, <Globe size={15}/>],
    ['GitHub', GITHUB_URL, <GithubIcon/>],
    ['LinkedIn', LINKEDIN_URL, <LinkedinIcon/>],
  ].filter(s => s[1]);
  const steps = [
    [<ImageIcon size={15}/>, 'Start with a photo', 'Upload your own photo or use the built-in sample.'],
    [<Sparkles size={15}/>, 'Choose a look', 'Browse the curated selection of presets to give your photo a quick new look, or hit a device to match its palette and pixel density.'],
    [<SlidersHorizontal size={15}/>, 'Fine-tune the render', 'Dial in the edit options for different rendering modes, tone and light controls, colour and atmosphere effects like glow, noise and scanlines.'],
    [<Download size={15}/>, 'Export full resolution', 'Download JPEG, PNG or SVG, or copy to clipboard. No watermark, no account.'],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}
      style={{paddingTop:'calc(1rem + env(safe-area-inset-top))',paddingBottom:'calc(1rem + env(safe-area-inset-bottom))'}}>
      <div onClick={e=>e.stopPropagation()}
        className="anim-fadein w-full sm:w-[440px] max-h-full overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-7 h-7 shrink-0 rounded-[3px]"/>
            <h2 className="text-base tracking-tight"><span className="text-amber-100">Phosphor</span> <span className="text-zinc-500">Studio</span></h2>
          </div>
          <button onClick={onClose} aria-label="close" className="tap-target flex items-center justify-center w-7 h-7 shrink-0 text-zinc-500 hover:text-amber-300 border border-zinc-700 hover:border-amber-600 transition-colors">
            <X size={14}/>
          </button>
        </div>

        <p className="text-base sm:text-xl text-amber-100 leading-snug">A lo-fi visual studio.</p>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Convert photos into dithered, halftone, and ASCII retro-display art.
          Features CRT atmospheric effects and a curated collection of presets inspired by
          my favorite films, series, and video games.
        </p>

        {/* author + social icons */}
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-zinc-800 pt-4">
          <p className="text-sm text-zinc-400">
            Made with <span className="text-red-500">♥</span> by{' '}
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer"
              className="text-amber-300 hover:text-amber-200 hover:underline">Rodrigo Silva</a>
          </p>
          <div className="flex items-center gap-2">
            {socials.map(([label,href,icon]) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}
                className="tap-target flex items-center justify-center w-9 h-9 border border-zinc-700 text-zinc-400 hover:text-amber-300 hover:border-amber-600 transition-colors">
                {icon}
              </a>
            ))}
          </div>
        </div>

        {/* how to */}
        <div className="border border-zinc-800 rounded-lg p-4 flex flex-col gap-4">
          <div className="text-[10px] tracking-[0.2em] text-zinc-600">HOW TO CREATE RETRO ART</div>
          {steps.map(([icon,title,desc]) => (
            <div key={title} className="flex gap-3">
              <div className="mt-0.5 shrink-0 text-zinc-100">{icon}</div>
              <div>
                <div className="text-sm text-zinc-200 leading-tight">{title}</div>
                <div className="text-xs text-zinc-500 leading-relaxed mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InvertButton({onClick,title}) {
  return (
    <button onClick={onClick} data-tip={title} aria-label={title}
      className="icon-btn flex items-center justify-center w-7 h-7 shrink-0 border border-zinc-700 hover:border-amber-600 text-zinc-500 hover:text-amber-300 transition-colors">
      <ArrowLeftRight size={11}/>
    </button>
  );
}

function ResetButton({onClick,title}) {
  return (
    <button onClick={onClick} data-tip={title} aria-label={title}
      className="flex items-center justify-center w-6 h-6 -my-1 shrink-0 text-zinc-600 hover:text-amber-300 transition-colors">
      <RotateCcw size={12}/>
    </button>
  );
}

function Panel({label,children,action,bare}) {
  return (
    <div className={`px-4 py-3 ${bare?'':'border-b border-zinc-800'}`}>
      <div className="flex items-center justify-between mb-2 min-h-5">
        <div className="text-xs font-medium tracking-wide text-zinc-300">{label}</div>
        {action}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function NumSlider({label,value,min,max,step,onChange,hint,disabled}) {
  const handleNum = (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) onChange(Math.max(min,Math.min(max,v)));
  };
  return (
    <div className={disabled?'opacity-40':''}>
      <div className="text-xs text-zinc-500 mb-0.5">{label}</div>
      <div className="flex items-center gap-2.5">
        {hint
          ? <span className="text-xs text-zinc-600 shrink-0 w-14">{hint}</span>
          : <input type="number" value={value} min={min} max={max} step={step}
              disabled={disabled} onChange={handleNum} className="shrink-0"/>
        }
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          onChange={e=>onChange(parseFloat(e.target.value))} className="flex-1"/>
      </div>
    </div>
  );
}

// A labeled field: dim label on top, control below.
function Field({label,children}) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

// Custom dropdown for many-option selectors: filled box + value + chevron, popover list.
function Dropdown({options,value,onChange,preview}) {
  const [open,setOpen] = useState(false);
  const [menuStyle,setMenuStyle] = useState({});
  const ref = useRef(null);
  const btnRef = useRef(null);
  const selRef = useRef(null);
  useEffect(() => {
    if(!open) return;
    const onDoc = e => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',onDoc);
    return () => document.removeEventListener('mousedown',onDoc);
  },[open]);
  // Place the menu with position:fixed (viewport-anchored) so it escapes the clipping of any
  // scrollable ancestor — on mobile the tab body has overflow, which used to cut the menu off
  // and break its internal scroll. Flip above the button when there isn't room below, cap the
  // height to the available space, and re-place on scroll/resize so it stays glued to the button.
  useEffect(() => {
    if(!open) return;
    const place = () => {
      if(!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 10;
      const above = r.top - 10;
      const up = below < 200 && above > below;
      const maxHeight = Math.max(120, Math.min(288, up ? above : below));
      setMenuStyle({
        position:'fixed', left:r.left, width:r.width, maxHeight,
        ...(up ? {bottom:window.innerHeight - r.top + 4} : {top:r.bottom + 4}),
      });
    };
    place();
    selRef.current?.scrollIntoView({block:'nearest'});
    window.addEventListener('scroll', place, true);   // capture: catch ancestor scrolls too
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  },[open]);
  const current = options.find(o=>o[0]===value);
  return (
    <div ref={ref} className="relative">
      <button ref={btnRef} onClick={()=>setOpen(o=>!o)}
        className="tap-target w-full flex items-center justify-between gap-2 px-2.5 py-2 border border-zinc-700 text-xs text-zinc-200 hover:border-zinc-600 transition-colors">
        <span className="truncate">{current?current[1]:'—'}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {preview && preview(value)}
          <ChevronDown size={12} className={`text-zinc-500 transition-transform ${open?'rotate-180':''}`}/>
        </span>
      </button>
      {open &&
        <div style={{...menuStyle, touchAction:'pan-y'}} className="fixed z-50 overflow-y-auto overscroll-contain border border-zinc-700 bg-zinc-900 shadow-xl">
          {options.map(([v,l,desc])=>(
            <button key={v} ref={v===value?selRef:null} onClick={()=>{onChange(v); setOpen(false);}}
              className={`w-full text-left px-2.5 py-2 transition-colors ${v===value?'bg-amber-950/40':'hover:bg-zinc-800'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className={`text-xs truncate ${v===value?'text-amber-100':'text-zinc-300'}`}>{l}</div>
                {preview && preview(v)}
              </div>
              {desc && <div className="text-[10px] text-zinc-500 break-all mt-0.5">{desc}</div>}
            </button>
          ))}
        </div>}
    </div>
  );
}

// Connected segmented pill: gap between cells, rounded only on the outer edges.
function Segmented({options,value,onChange}) {
  return (
    <div className="flex gap-1">
      {options.map(([v,l],i)=>{
        const on=value===v;
        const edge=i===0?'rounded-l':i===options.length-1?'rounded-r':'';
        return (
          <button key={v} onClick={()=>onChange(v)}
            className={`tap-target flex-1 py-1.5 text-xs flex items-center justify-center transition-colors ${edge} ${on?'bg-amber-950/50 text-amber-100 border border-amber-600':'border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}`}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

// Export button with an options popover: format, resolution, transparency, then Download.
function ExportMenu({format,setFormat,transparentBg,setTransparentBg,onDownload,onCopy,copied}) {
  const [open,setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if(!open) return;
    const onDoc = e => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',onDoc);
    return () => document.removeEventListener('mousedown',onDoc);
  },[open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={()=>setOpen(o=>!o)}
        className="tap-target flex items-center gap-1.5 text-xs text-amber-100 border border-amber-600 hover:bg-amber-950 px-2.5 py-1.5 tracking-wide transition-colors">
        <Download size={12}/> EXPORT <ChevronDown size={12} className={`transition-transform ${open?'rotate-180':''}`}/>
      </button>
      {open &&
        <div className="absolute right-0 mt-1 w-60 z-30 border border-zinc-700 bg-zinc-900 shadow-xl p-4">
          <ExportBody format={format} setFormat={setFormat}
            transparentBg={transparentBg} setTransparentBg={setTransparentBg}
            onDownload={()=>{ onDownload(); setOpen(false); }} onCopy={onCopy} copied={copied}/>
        </div>}
    </div>
  );
}

// Export options body: format, resolution/vector notes, transparency, download.
// Shared between the desktop header popover and the mobile Share tab.
function ExportBody({format,setFormat,transparentBg,setTransparentBg,onDownload,onCopy,copied}) {
  const formats = [['jpeg','JPEG'],['png','PNG'],['svg','SVG']];
  return (
    <div className="flex flex-col gap-3">
      <Field label="Format">
        <Segmented options={formats} value={format} onChange={setFormat}/>
      </Field>
      {(format==='png'||format==='jpeg') &&
        <div className="text-[10px] text-zinc-600 leading-relaxed">Exports at your image's full resolution.</div>}
      {(format==='png'||format==='svg') &&
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={transparentBg} onChange={e=>setTransparentBg(e.target.checked)} className="accent-amber-600"/>
          <span>Transparent background</span>
        </label>}
      {format==='svg' &&
        <div className="text-[10px] text-zinc-600 leading-relaxed">Scalable vector — ASCII exports as editable text, halftone as shapes. Effects are omitted.</div>}
      <button onClick={onDownload}
        className="tap-target flex items-center justify-center gap-2 py-2 border border-amber-600 bg-amber-950/40 text-amber-100 hover:bg-amber-900 text-xs tracking-wide transition-colors">
        <Download size={12}/> Download
      </button>
      {format!=='svg' && onCopy &&
        <button onClick={onCopy}
          className="tap-target flex items-center justify-center gap-2 py-2 border border-zinc-700 text-zinc-300 hover:text-amber-300 hover:border-amber-700 text-xs tracking-wide transition-colors">
          <Copy size={12}/> {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>}
    </div>
  );
}

// Editable hex field: type freely, commit a valid #rrggbb on blur/Enter, revert otherwise.
function HexInput({value,onChange}) {
  const [t,setT] = useState(value);
  const [prev,setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setT(value); }   // sync to external changes without an effect
  const commit = (v) => {
    const m = v.trim().replace(/^#/,'');
    if (/^[0-9a-fA-F]{6}$/.test(m)) onChange('#'+m.toLowerCase());
    else setT(value);
  };
  return (
    <input value={t} onChange={e=>setT(e.target.value)} onBlur={e=>commit(e.target.value)}
      onKeyDown={e=>{ if(e.key==='Enter') e.currentTarget.blur(); }}
      spellCheck={false} maxLength={7} aria-label="hex color"
      className="shrink-0 w-[62px] bg-zinc-900 border border-zinc-700 focus:border-amber-700 outline-none text-[11px] text-zinc-300 px-1.5 py-1 font-mono lowercase"/>
  );
}

function ColorSwatch({label,value,onChange}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="swatch relative w-7 h-7 border border-zinc-700 shrink-0">
          <input type="color" value={value} onChange={e=>onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
          <div className="w-full h-full" style={{background:value}}/>
        </div>
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <HexInput value={value} onChange={onChange}/>
    </div>
  );
}
