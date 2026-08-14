import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, Plus, X, ZoomIn, ZoomOut, Share2, ArrowLeftRight, ChevronDown, Circle, Square, Diamond, Minus, RotateCcw, Undo2, Redo2, Info, Code2, Eye, LayoutGrid, Grid3x3, Contrast, Palette, Radio, Save, Copy } from 'lucide-react';
import LZString from 'lz-string';

const GITHUB_URL = 'https://github.com/dreegu/phosphor';
const AUTHOR_URL = 'https://rodrigosilva.design';





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
const LOOK_BASE = { contrast:0, midtones:1, highlights:1, shadows:1, phosphorGlow:0, luminanceLift:0, scanlines:0, noise:0, chromaShift:0, asciiInvert:false, asciiCutout:0, asciiBold:true, dcolor:'palette', adaptiveCount:16, gamut:'full' };

// Unified "detail": 0-100 where higher = more detail. Maps to each mode's underlying
// cell/dot size (smaller size = finer = more detail), so the control reads intuitively.
// [finest, coarsest] cell size in px, calibrated to the 900px preview. Finest = 1px so the
// top of the slider is meaningful in the preview (below that is sub-pixel and invisible);
// coarsest raised for chunkier dots/cells at detail 0.
const DETAIL_RANGE = { dither:[1,26], ascii:[5,26], halftone:[1.5,26] };
// Geometric mapping: equal ratio per step, so dragging feels even across the whole range.
function detailToSize(mode, detail){
  const [min,max] = DETAIL_RANGE[mode] || DETAIL_RANGE.halftone;
  const d = Math.max(0, Math.min(100, detail))/100;
  return max * Math.pow(min/max, d);
}
function sizeToDetail(mode, size){
  const [min,max] = DETAIL_RANGE[mode] || DETAIL_RANGE.halftone;
  const s = Math.max(min, Math.min(max, size));
  return Math.round(Math.max(0, Math.min(100, 100*Math.log(s/max)/Math.log(min/max))));
}

// Look categories, in display order.
const CATEGORIES = [
  ['hardware','Hardware'], ['soft','Soft'], ['cinematic','Cinematic'], ['poster','Poster'],
  ['vivid','Vivid'], ['duotone','Duotone'], ['mono','Monochrome'], ['riso','Riso'], ['type','Type'],
];

// Curated looks. A look sets colour + tone + mode, but NOT detail — that stays the
// user's, global. The exceptions carry `detail` and set carriesDetail:true (Hardware
// devices at native resolution, and STIPPLE); those stash and restore the user's detail.
const LOOK_PRESETS = [
  // ── Hardware (adaptive + device gamut, native resolution) ──
  { name:'GAME BOY', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'gameboy', detail:47 } },
  { name:'GAME BOY COLOR', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'gbcolor', detail:47 } },
  { name:'PLAYSTATION', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'playstation', detail:68 } },
  { name:'COMMODORE 64', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'c64', detail:68 } },
  { name:'AMIGA', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'amiga', detail:68 } },
  { name:'ATARI ST', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'bayer', dcolor:'adaptive', gamut:'atarist', detail:68 } },
  { name:'MACINTOSH', category:'hardware', carriesDetail:true, settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#000000',anchor:0},{color:'#ffffff',anchor:1}], detail:83 } },
  // ── Soft ──
  { name:'HER', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#2d0f0f',anchor:0},{color:'#7a3030',anchor:0.2},{color:'#c47850',anchor:0.5},{color:'#e8b090',anchor:0.78},{color:'#faeae0',anchor:1}], contrast:15, midtones:1.3, highlights:0.85, shadows:0.85, phosphorGlow:40 } },
  { name:'CELESTE', category:'soft', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#1a0a20',anchor:0},{color:'#3a2050',anchor:0.2},{color:'#c07090',anchor:0.55},{color:'#e8b8a0',anchor:0.82},{color:'#f8f0e0',anchor:1}], contrast:20, midtones:1.25, highlights:0.85, shadows:0.85, phosphorGlow:20 } },
  { name:'SILENT HILL', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#0c0c10',anchor:0},{color:'#2c2121',anchor:0.16},{color:'#5f534e',anchor:0.33},{color:'#7b7656',anchor:0.5},{color:'#a8a180',anchor:0.66},{color:'#cfcaab',anchor:0.83},{color:'#e9e5d3',anchor:1}], midtones:0.95, phosphorGlow:30, luminanceLift:10 } },
  { name:'PERFECT BLUE', category:'soft', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#030726',anchor:0},{color:'#172445',anchor:0.1},{color:'#082c76',anchor:0.18},{color:'#2477b7',anchor:0.31},{color:'#a6cbcd',anchor:0.69},{color:'#f3f4e6',anchor:1}], contrast:-11, midtones:1.1, highlights:1.5, shadows:1.2 } },
  { name:'METAL GEAR SOLID', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#041513',anchor:0.08},{color:'#1a5148',anchor:0.14},{color:'#117449',anchor:0.25},{color:'#3a9862',anchor:0.32},{color:'#83ce92',anchor:0.78},{color:'#a5dfc4',anchor:0.84},{color:'#d0e2da',anchor:0.95}], phosphorGlow:15, luminanceLift:30, scanlines:20 } },
  { name:'GHOST IN THE SHELL', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#1a1d1f',anchor:0.08},{color:'#21313f',anchor:0.13},{color:'#38658c',anchor:0.25},{color:'#7ac0e3',anchor:0.52},{color:'#7ac0e3',anchor:0.72},{color:'#ddc292',anchor:1}], contrast:-10, midtones:0.75, highlights:1.3, shadows:1.05, phosphorGlow:20, luminanceLift:20 } },
  { name:'TOEM', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#0c0c10',anchor:0.04},{color:'#333333',anchor:0.17},{color:'#616161',anchor:0.33},{color:'#808080',anchor:0.45},{color:'#a8a8a8',anchor:0.64},{color:'#cfcfcf',anchor:0.81},{color:'#e9e9e9',anchor:0.96}], contrast:10, midtones:0.95, highlights:0.95, shadows:0.95, phosphorGlow:15, luminanceLift:15 } },
  { name:'ANOTHER WORLD', category:'soft', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#302d1c',anchor:0.03},{color:'#584b38',anchor:0.13},{color:'#484967',anchor:0.21},{color:'#888888',anchor:0.33},{color:'#ada190',anchor:0.48},{color:'#c9a189',anchor:0.64},{color:'#e5c884',anchor:0.89}] } },
  // ── Cinematic ──
  { name:'DUNE', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#330d0a',anchor:0.07},{color:'#73230e',anchor:0.16},{color:'#b44b12',anchor:0.41},{color:'#df781d',anchor:0.53},{color:'#f39a2b',anchor:0.62},{color:'#fcc95d',anchor:0.73},{color:'#fcd788',anchor:0.82},{color:'#ecdec5',anchor:1}], contrast:-24, midtones:1.1, highlights:1.15, shadows:1.45 } },
  { name:'STRANGER THINGS', category:'cinematic', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#030726',anchor:0},{color:'#172445',anchor:0.1},{color:'#082c76',anchor:0.18},{color:'#b12323',anchor:0.33},{color:'#a6cbcd',anchor:0.69},{color:'#f3f4e6',anchor:1}], contrast:-11, midtones:1.1, highlights:1.5, shadows:1.2 } },
  { name:'VIDEODROME', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#0e132b',anchor:0.08},{color:'#035a8f',anchor:0.27},{color:'#9f3e8c',anchor:0.36},{color:'#c50012',anchor:0.46},{color:'#ea7d9c',anchor:0.52},{color:'#86b5c4',anchor:0.67},{color:'#3ac6bd',anchor:0.76},{color:'#e3ead9',anchor:0.92}], contrast:1 } },
  { name:'EDGERUNNERS', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#061012',anchor:0.04},{color:'#1f4240',anchor:0.19},{color:'#1f706b',anchor:0.37},{color:'#847ab7',anchor:0.46},{color:'#76c1a1',anchor:0.63},{color:'#e8f901',anchor:0.75},{color:'#c7dee5',anchor:0.83},{color:'#ece0f0',anchor:0.97}], phosphorGlow:18, luminanceLift:13 } },
  { name:'BACK TO THE FUTURE', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#16171d',anchor:0},{color:'#050f3e',anchor:0.08},{color:'#1a2a67',anchor:0.22},{color:'#b15527',anchor:0.39},{color:'#dd6227',anchor:0.52},{color:'#eab130',anchor:0.59},{color:'#d8c3ae',anchor:0.85}], noise:50 } },
  { name:'ANDOR', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#101826',anchor:0},{color:'#3a3d4a',anchor:0.14},{color:'#e8785a',anchor:0.41},{color:'#f0d8b0',anchor:0.91}], noise:45 } },
  { name:'FINAL FANTASY', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#021618',anchor:0},{color:'#1a4951',anchor:0.18},{color:'#2c8090',anchor:0.4},{color:'#6bbcae',anchor:0.5},{color:'#1ab788',anchor:0.61},{color:'#ebd0a7',anchor:0.76},{color:'#fce2e1',anchor:0.83},{color:'#fef3f1',anchor:0.96}], midtones:0.75, highlights:1.3, shadows:1.05, phosphorGlow:15, luminanceLift:20 } },
  { name:'DOOM', category:'cinematic', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#020202',anchor:0.05},{color:'#502f30',anchor:0.21},{color:'#cd3c32',anchor:0.49},{color:'#c87d50',anchor:0.59},{color:'#67975c',anchor:0.71},{color:'#97c47e',anchor:0.83},{color:'#f2d673',anchor:1}], contrast:-4, highlights:0.85, shadows:0.95 } },
  // ── Poster ──
  { name:'DISCO ELYSIUM', category:'poster', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#382015',anchor:0},{color:'#4e3f22',anchor:0.2},{color:'#545416',anchor:0.33},{color:'#7192a3',anchor:0.5},{color:'#b45629',anchor:0.63},{color:'#f5ac8a',anchor:0.73},{color:'#fcfcf0',anchor:0.91}], contrast:35, midtones:0.75, highlights:0.9, shadows:0.8, noise:20 } },
  { name:'BLADE RUNNER', category:'poster', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#251f30',anchor:0.11},{color:'#103a4a',anchor:0.36},{color:'#693238',anchor:0.55},{color:'#e93835',anchor:0.52},{color:'#237879',anchor:0.64},{color:'#f9f0da',anchor:0.84}], shadows:1.25 } },
  { name:'MAD MAX', category:'poster', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#010508',anchor:0.13},{color:'#0e3f3a',anchor:0.02},{color:'#347abc',anchor:0.27},{color:'#943b12',anchor:0.36},{color:'#c08316',anchor:0.61},{color:'#eeca03',anchor:0.77},{color:'#7bb7c1',anchor:0.87},{color:'#c6e5e6',anchor:0.94}], contrast:5, midtones:0.9, highlights:0.9, shadows:1.15, noise:40 } },
  { name:'CASTLEVANIA', category:'poster', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#000302',anchor:0.05},{color:'#18363f',anchor:0.34},{color:'#ca0507',anchor:0.76},{color:'#e2a99d',anchor:0.94}], phosphorGlow:15, luminanceLift:10 } },
  // ── Vivid ──
  { name:'CYBERPUNK', category:'vivid', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#0a0010',anchor:0.04},{color:'#330022',anchor:0.14},{color:'#880044',anchor:0.24},{color:'#ff0088',anchor:0.37},{color:'#50818b',anchor:0.42},{color:'#babc50',anchor:0.48},{color:'#ffee00',anchor:0.88}], phosphorGlow:25, luminanceLift:10, scanlines:10, chromaShift:3 } },
  { name:'AVATAR', category:'vivid', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#000814',anchor:0},{color:'#001a33',anchor:0.35},{color:'#003366',anchor:0.6},{color:'#0099aa',anchor:0.82},{color:'#44ffcc',anchor:1}], contrast:45, highlights:1.2, shadows:1.2, phosphorGlow:60 } },
  { name:'STREETS OF RAGE', category:'vivid', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#000820',anchor:0},{color:'#001850',anchor:0.25},{color:'#0044aa',anchor:0.55},{color:'#ff8800',anchor:0.82},{color:'#ffeeaa',anchor:1}], contrast:40, highlights:1.1, phosphorGlow:25 } },
  { name:'CHANTS OF SENNAAR', category:'vivid', settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#8e2111',anchor:0.11},{color:'#c92c3d',anchor:0.36},{color:'#9f5417',anchor:0.52},{color:'#61bc81',anchor:0.55},{color:'#cc9e24',anchor:0.64},{color:'#ffea38',anchor:0.84}] } },
  { name:'ASTRAL CHAIN', category:'vivid', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#010103',anchor:0},{color:'#10146a',anchor:0.1},{color:'#2436d6',anchor:0.55},{color:'#973fac',anchor:0.63},{color:'#b3a3dc',anchor:0.83}], midtones:1.6, highlights:0.85, shadows:2.05, phosphorGlow:25, luminanceLift:25 } },
  // ── Duotone ──
  { name:'ROSE', category:'duotone', settings:{ mode:'halftone', htShape:'circle', htInk:'#4a1020', htPaper:'#f6d5c9', htAngle:45, contrast:20, midtones:1.1, highlights:0.9 } },
  { name:'NAVY', category:'duotone', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#0a1428',anchor:0},{color:'#e8dfc8',anchor:1}], contrast:35, midtones:1.1, highlights:0.9 } },
  { name:'FOREST', category:'duotone', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#0a2010',anchor:0},{color:'#eef4e0',anchor:1}], contrast:30, midtones:1.15, highlights:0.9 } },
  { name:'VIOLET', category:'duotone', settings:{ mode:'dither', algo:'bayer', palette:[{color:'#1a0838',anchor:0},{color:'#e8e0f4',anchor:1}], contrast:40 } },
  // ── Monochrome ──
  { name:'2001', category:'mono', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#000000',anchor:0},{color:'#ffffff',anchor:1}], contrast:55, midtones:0.85, highlights:1.2, shadows:1.35 } },
  { name:'GATTACA', category:'mono', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#141810',anchor:0},{color:'#c8b46c',anchor:1}], contrast:40, highlights:0.95 } },
  { name:'HOLLOW KNIGHT', category:'mono', settings:{ mode:'dither', algo:'atkinson', palette:[{color:'#000000',anchor:0},{color:'#d8e8f8',anchor:1}], contrast:45, midtones:0.95, highlights:1.1 } },
  { name:'STIPPLE', category:'mono', carriesDetail:true, settings:{ mode:'dither', algo:'diffusion', palette:[{color:'#050505',anchor:0},{color:'#f4f2ec',anchor:1}], detail:85, contrast:40, midtones:0.9, highlights:1.15, shadows:1.3 } },
  // ── Riso ──
  { name:'AKIRA MANGA', category:'riso', settings:{ mode:'halftone', htShape:'square', htInk:'#0a0808', htPaper:'#f4f0e8', htAngle:45, contrast:30 } },
  { name:'PAPRIKA', category:'riso', settings:{ mode:'halftone', htShape:'diamond', htInk:'#6600aa', htPaper:'#ff6600', htAngle:30, phosphorGlow:30 } },
  { name:'ARRIVAL', category:'riso', settings:{ mode:'halftone', htShape:'circle', htInk:'#0a0f1a', htPaper:'#8899aa', htAngle:60, contrast:20, phosphorGlow:20 } },
  { name:'JOURNEY', category:'riso', settings:{ mode:'halftone', htShape:'line', htInk:'#3a1a00', htPaper:'#f0c860', htAngle:0, contrast:20, midtones:1.1, highlights:0.9, phosphorGlow:25 } },
  // ── Type ──
  { name:'THE MATRIX', category:'type', settings:{ mode:'ascii', asciiRamp:'standard', asciiFg:'#00ff41', asciiBg:'#000000', asciiCutout:22, phosphorGlow:30, scanlines:25 } },
  { name:'AMBER TERMINAL', category:'type', settings:{ mode:'ascii', asciiRamp:'standard', asciiFg:'#ffb000', asciiBg:'#140e06', asciiCutout:20, phosphorGlow:30 } },
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
  playstation: { label:'PlayStation',    bits:5, max:48 },
  c64:         { label:'Commodore 64',   palette:['#000000','#ffffff','#880000','#aaffee','#cc44cc','#00cc55','#0000aa','#eeee77','#dd8855','#664400','#ff7777','#333333','#777777','#aaff66','#0088ff','#bbbbbb'] },
  amiga:       { label:'Amiga',          bits:4, max:32 },
  atarist:     { label:'Atari ST',       bits:3, max:16 },
};

// Dither the image toward a palette derived FROM the image (hue preserved), optionally
// constrained to a device gamut. Fills `out`; returns the palette.
function ditherAdaptive(data,sw,sh,out,algo,getY,n,gamut){
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
    pal = medianCutPalette(samples, gm.max).map(([r,g,b])=>[snap(r),snap(g),snap(b)]);  // snap to console grid
  } else {
    pal = vividPalette(medianCutPalette(samples, Math.max(2,Math.min(16,n||16))));
  }
  const ordered = algo==='bluenoise'||!!ORDERED_PATTERNS[algo];
  if(ordered){
    const{matrix,size,max}=algo==='bluenoise'?getBlueNoise():ORDERED_PATTERNS[algo];
    const amp=48;
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
      const r=Math.max(0,Math.min(255,R[i]+ar)),g=Math.max(0,Math.min(255,G[i]+ag)),b=Math.max(0,Math.min(255,B[i]+ab));
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
        const f=1/8, push=(nx,ny)=>{ if(nx>=0&&nx<sw&&ny>=0&&ny<sh){const j=ny*sw+nx;R[j]+=er*f;G[j]+=eg*f;B[j]+=eb*f;} };
        push(x+1,y);push(x+2,y);push(x-1,y+1);push(x,y+1);push(x+1,y+1);push(x,y+2);
      } else {
        const{div,taps}=DIFFUSION_KERNELS[algo]||DIFFUSION_KERNELS.diffusion;
        for(const[dx,dy,wt]of taps){ const nx=x+dx,ny=y+dy; if(nx>=0&&nx<sw&&ny>=0&&ny<sh){const j=ny*sw+nx,f=wt/div;R[j]+=er*f;G[j]+=eg*f;B[j]+=eb*f;} }
      }
    }
  }
  return pal;
}

// ─── RENDER: DITHER ──────────────────────────────────────────────────────────
function renderDither({img,w,h,px,palette,algo,getY,transparent,colorMode,adaptiveCount,gamut}) {
  const sw = Math.max(1,Math.round(w/px)), sh = Math.max(1,Math.round(h/px));
  const small = document.createElement('canvas');
  small.width=sw; small.height=sh;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(img, 0, 0, sw, sh);
  const data = sctx.getImageData(0,0,sw,sh).data;
  const out = new Uint8ClampedArray(sw*sh*4);
  if (colorMode==='adaptive') {
    ditherAdaptive(data,sw,sh,out,algo,getY,adaptiveCount,gamut);
    sctx.putImageData(new ImageData(out,sw,sh),0,0);
    const canvas=document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(small,0,0,sw,sh,0,0,w,h);
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
        return t>(matrix[y%size][x%size]+0.5)/maxVal?k+1:k;
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
      const v=Math.max(0,Math.min(255,base+acc));
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
        const e=err/8;
        if(x+1<sw)work[i+1]+=e; if(x+2<sw)work[i+2]+=e;
        if(x-1>=0&&y+1<sh)work[i+sw-1]+=e; if(y+1<sh)work[i+sw]+=e;
        if(x+1<sw&&y+1<sh)work[i+sw+1]+=e; if(y+2<sh)work[i+sw*2]+=e;
      } else {
        const {div,taps}=DIFFUSION_KERNELS[algo]||DIFFUSION_KERNELS.diffusion;
        for(const [dx,dy,wt] of taps){
          const nx=x+dx, ny=y+dy;
          if(nx>=0&&nx<sw&&ny<sh) work[ny*sw+nx]+=err*wt/div;
        }
      }
    }
  }
  sctx.putImageData(new ImageData(out,sw,sh),0,0);
  const canvas=document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(small,0,0,sw,sh,0,0,w,h);
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
function applyAtmosphere(canvas,{phosphorGlow,luminanceLift,scanlines,noise,chromaShift,darkColor}) {
  const ctx=canvas.getContext('2d');
  const{width:w,height:h}=canvas;
  if(phosphorGlow>0){
    const g=phosphorGlow/100;
    const blurPx=g*Math.min(w,h)*0.06;
    // Bloom the brightest tones by VALUE (max channel), not luminance, so vivid colours —
    // a saturated blue, a light lavender — glow too, not only near-white. A soft knee ramps
    // each pixel's contribution in instead of the old hard >0.8 luminance cutoff.
    const src=ctx.getImageData(0,0,w,h); const sd=src.data;
    const bright=document.createElement('canvas'); bright.width=w; bright.height=h;
    const brctx=bright.getContext('2d');
    const bimg=brctx.createImageData(w,h); const bd=bimg.data;
    const knee=0.5;
    for(let i=0;i<sd.length;i+=4){
      const v=Math.max(sd[i],sd[i+1],sd[i+2])/255;
      const wt=v>knee?(v-knee)/(1-knee):0;
      if(wt>0){ bd[i]=sd[i]*wt; bd[i+1]=sd[i+1]*wt; bd[i+2]=sd[i+2]*wt; bd[i+3]=255; }
    }
    brctx.putImageData(bimg,0,0);
    // blur the isolated highlights and screen-composite back
    const blur=document.createElement('canvas'); blur.width=w; blur.height=h;
    const blctx=blur.getContext('2d'); blctx.filter=`blur(${blurPx}px)`; blctx.drawImage(bright,0,0);
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=Math.min(1,g*1.5); ctx.drawImage(blur,0,0); ctx.restore();
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
}

// Build the tone-mapping function from a settings object (mirrors process()).
function makeGetY(s){
  const cf=(100+(s.contrast||0))/100, mid=s.midtones||1, hi=s.highlights||1, sh=s.shadows||1;
  return (r,g,b)=>{
    let y=luminance([r,g,b]);
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
  if(mode==='dither') canvas=renderDither({img,w,h,px:Math.max(1,sizeFor('dither',s.pixelSize||5)),palette:(s.palette||[]).map(p=>({...p})),algo:s.algo||'bayer',getY,colorMode:s.dcolor,adaptiveCount:s.adaptiveCount,gamut:s.gamut});
  else if(mode==='ascii') canvas=renderAscii({img,w,h,ramp:s.asciiRamp||'standard',fgColor:s.asciiFg||'#00ff41',bgColor:s.asciiBg||'#000000',cellSize:Math.max(3,sizeFor('ascii',s.asciiSize||8)),getY,invert:s.asciiInvert,cutout:s.asciiCutout,bold:s.asciiBold!==false});
  else canvas=renderHalftone({img,w,h,shape:s.htShape||'circle',dotSize:Math.max(0.8,sizeFor('halftone',s.htSize||3.5)),angle:s.htAngle||45,inkColor:s.htInk||'#2a2420',paperColor:s.htPaper||'#f2ede4',getY});
  const darkColor=mode==='dither'?(([...(s.palette||[])].sort((a,b)=>a.anchor-b.anchor)[0]||{}).color||'#000'):mode==='ascii'?(s.asciiBg||'#000'):'#000';
  applyAtmosphere(canvas,{phosphorGlow:s.phosphorGlow||0,luminanceLift:s.luminanceLift||0,scanlines:s.scanlines||0,noise:s.noise||0,chromaShift:s.chromaShift||0,darkColor});
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
function buildDitherSVG({img,w,h,px,palette,algo,getY,transparent,colorMode,adaptiveCount,gamut}){
  const canvas=renderDither({img,w,h,px,palette,algo,getY,transparent,colorMode,adaptiveCount,gamut});
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
  return buildDitherSVG({img,w,h,px:Math.max(1,detailToSize('dither',s.detail??55)),palette:(s.palette||[]).map(p=>({...p})),algo:s.algo||'bayer',getY,transparent:tp,colorMode:s.dcolor,adaptiveCount:s.adaptiveCount,gamut:s.gamut});
}

const EXPORT_MAX = 4096;    // raster export ceiling (long side) — safe across browsers

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function Phosphor() {
  const [imageSrc, setImageSrc] = useState('/samples/landscape-1.jpg');
  const [fileName, setFileName] = useState('creation-of-adam.jpg');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x:0,y:0});
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
  const [detail, setDetail] = useState(55);   // unified 0-100, higher = more detail

  const [asciiRamp, setAsciiRamp] = useState('standard');
  const [asciiFg, setAsciiFg] = useState('#00ff41');
  const [asciiBg, setAsciiBg] = useState('#000000');
  const [asciiInvert, setAsciiInvert] = useState(false);
  const [asciiCutout, setAsciiCutout] = useState(0);
  const [asciiBold, setAsciiBold] = useState(true);

  const [htShape, setHtShape] = useState('circle');
  const [htAngle, setHtAngle] = useState(45);
  const [htInk, setHtInk] = useState('#2a2420');
  const [htPaper, setHtPaper] = useState('#f2ede4');

  const [contrast, setContrast] = useState(0);
  const [midtones, setMidtones] = useState(1);
  const [highlights, setHighlights] = useState(1);
  const [shadows, setShadows] = useState(1);

  const [phosphorGlow, setPhosphorGlow] = useState(0);
  const [luminanceLift, setLuminanceLift] = useState(0);
  const [scanlines, setScanlines] = useState(0);
  const [noise, setNoise] = useState(0);
  const [chromaShift, setChromaShift] = useState(0);

  const [transparentBg, setTransparentBg] = useState(false);
  const [format, setFormat] = useState('jpeg');
  const [outputUrl, setOutputUrl] = useState(null);
  const [shared, setShared] = useState(false);
  const [copied, setCopied] = useState(false);
  const imgRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const ctrlRef = useRef(null);
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

  // ── Hold to compare ──
  const [comparing, setComparing] = useState(false);
  const canCompareRef = useRef(false);

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
    if(s.contrast!==undefined) setContrast(s.contrast);
    if(s.midtones!==undefined) setMidtones(s.midtones);
    if(s.highlights!==undefined) setHighlights(s.highlights);
    if(s.shadows!==undefined) setShadows(s.shadows);
    if(s.phosphorGlow!==undefined) setPhosphorGlow(s.phosphorGlow);
    if(s.luminanceLift!==undefined) setLuminanceLift(s.luminanceLift);
    if(s.scanlines!==undefined) setScanlines(s.scanlines);
    if(s.noise!==undefined) setNoise(s.noise);
    if(s.chromaShift!==undefined) setChromaShift(s.chromaShift);
  };

  // Fresh entry: a random sample image paired with a random look, so the landing frame
  // is different every visit. (Add more images to DEFAULT_POOL to vary the photo too.)
  const shuffleAll = () => {
    const img = DEFAULT_POOL[nextSampleIndex(DEFAULT_POOL.length)];
    // Landing look is a random photographic one — skip the stylised/text categories.
    const pickable = LOOK_PRESETS.filter(p => !['type','riso','duotone','mono'].includes(p.category));
    const look = pickable[Math.floor(Math.random()*pickable.length)];
    applyLookPreset(look);
    if(img.fileName) setFileName(img.fileName);
    setZoom(1); setPan({x:0,y:0});
    setImageSrc(img.image);
  };

  const getSettings = useCallback(() => ({
    mode, algo, dcolor, adaptiveCount, gamut, detail,
    palette: palette.map(({color,anchor})=>({color,anchor})),
    asciiRamp, asciiFg, asciiBg, asciiInvert, asciiCutout, asciiBold,
    htShape, htAngle, htInk, htPaper,
    contrast, midtones, highlights, shadows, phosphorGlow, luminanceLift, scanlines, noise, chromaShift,
  }), [mode,algo,dcolor,adaptiveCount,gamut,detail,palette,asciiRamp,asciiFg,asciiBg,asciiInvert,asciiCutout,asciiBold,htShape,htAngle,htInk,htPaper,contrast,midtones,highlights,shadows,phosphorGlow,luminanceLift,scanlines,noise,chromaShift]);

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

  // Pan by dragging; zoom to the cursor via wheel/trackpad-pinch; zoom to the midpoint via touch pinch.
  useEffect(() => {
    const el = zoomAreaRef.current;
    if (!el) return;
    const rel = (cx, cy) => { const r = el.getBoundingClientRect(); return [cx - r.left - r.width/2, cy - r.top - r.height/2]; };

    const onWheel = (e) => {
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
      if(e.button!==0) return;
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

    let last = null, pinch = null;
    // Touch "hold to compare": a still one-finger press reveals the original; any real
    // movement cancels it and becomes a pan, so the gesture never fights scrolling/panning.
    let pressTimer = null, pressStart = null, compareOn = false;
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    const endCompare = () => { if (compareOn) { compareOn = false; setComparing(false); } };

    const onTouchMove = (e) => {
      if(e.touches.length===1 && !pinch){
        const t=e.touches[0];
        if (compareOn) { e.preventDefault(); return; }              // holding original: swallow movement
        if (pressStart && Math.hypot(t.clientX-pressStart[0], t.clientY-pressStart[1]) < 10) {
          if (pressTimer) { e.preventDefault(); return; }           // within threshold, still deciding
        } else { clearPress(); }                                    // moved → it's a pan
        e.preventDefault();
        if(last){ const dx=t.clientX-last[0], dy=t.clientY-last[1]; setPan(p=>({x:p.x+dx, y:p.y+dy})); }
        last=[t.clientX,t.clientY];
      } else if(e.touches.length===2){
        e.preventDefault();
        clearPress(); endCompare();
        const [a,b]=e.touches;
        const dist=Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
        const [mx,my]=rel((a.clientX+b.clientX)/2, (a.clientY+b.clientY)/2);
        if(pinch){ zoomAt(viewRef.current.zoom*(dist/pinch.dist), mx, my); }
        pinch={dist};
      }
    };
    const onTouchStart = (e) => {
      last = e.touches.length? [e.touches[0].clientX,e.touches[0].clientY] : null;
      clearPress(); pressStart = null;
      if (e.touches.length === 1 && canCompareRef.current) {
        pressStart = [e.touches[0].clientX, e.touches[0].clientY];
        pressTimer = setTimeout(() => { pressTimer = null; compareOn = true; setComparing(true); }, 280);
      }
    };
    const onTouchEnd = (e) => {
      if(e.touches.length<2) pinch=null;
      if(e.touches.length===0){ last=null; clearPress(); endCompare(); pressStart=null; }
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

    const cf=(100+contrast)/100;
    const getY=(r,g,b)=>{
      let y=luminance([r,g,b]);
      y=(y-0.5)*cf+0.5;
      y=Math.pow(Math.max(0,Math.min(1,y)),1/midtones);
      if(y>0.5) y=0.5+(y-0.5)*highlights; else y=0.5-(0.5-y)*shadows;
      return Math.max(0,Math.min(1,y));
    };

    let canvas;
    const tp=transparentBg;
    if(mode==='dither') canvas=renderDither({img,w,h,px:Math.max(1,detailToSize('dither',detail)*scale),palette,algo,getY,transparent:tp,colorMode:dcolor,adaptiveCount,gamut});
    else if(mode==='ascii') canvas=renderAscii({img,w,h,ramp:asciiRamp,fgColor:asciiFg,bgColor:asciiBg,cellSize:Math.max(3,detailToSize('ascii',detail)*scale),getY,transparent:tp,invert:asciiInvert,cutout:asciiCutout,bold:asciiBold});
    else canvas=renderHalftone({img,w,h,shape:htShape,dotSize:Math.max(0.8,detailToSize('halftone',detail)*scale),angle:htAngle,inkColor:htInk,paperColor:htPaper,getY,transparent:tp});
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

    applyAtmosphere(canvas,{phosphorGlow,luminanceLift,scanlines,noise,chromaShift,darkColor});

    if(tp&&alphaMask){
      const ctx=canvas.getContext('2d');
      const id=ctx.getImageData(0,0,canvas.width,canvas.height);
      const d=id.data;
      for(let i=0,p=0;i<d.length;i+=4,p++) d[i+3]=alphaMask[p];
      ctx.putImageData(id,0,0);
    }
    return canvas;
  }, [mode,palette,algo,dcolor,adaptiveCount,gamut,detail,asciiRamp,asciiFg,asciiBg,asciiInvert,asciiCutout,asciiBold,htShape,htAngle,htInk,htPaper,contrast,midtones,highlights,shadows,phosphorGlow,luminanceLift,scanlines,noise,chromaShift,transparentBg]);

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
    img.onload = () => { if (!cancelled) { imgRef.current = img; setImgTick(t => t + 1); } };
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
  // Safety net: never trap the user behind the splash if a render never lands.
  useEffect(() => {
    const t = setTimeout(() => { setBootHiding(true); setTimeout(() => setBooting(false), 550); }, 5000);
    return () => clearTimeout(t);
  }, []);

  // Compare is only meaningful once processed output exists (read by the touch handlers).
  canCompareRef.current = !!outputUrl;
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
  const appearanceDirty = contrast!==0 || midtones!==1 || highlights!==1 || shadows!==1;
  const resetAppearance = () => { setContrast(0); setMidtones(1); setHighlights(1); setShadows(1); };
  const atmosphereDirty = phosphorGlow!==0 || luminanceLift!==0 || scanlines!==0 || noise!==0 || chromaShift!==0;
  const resetAtmosphere = () => { setPhosphorGlow(0); setLuminanceLift(0); setScanlines(0); setNoise(0); setChromaShift(0); };

  // ── Control panels, factored so the desktop sidebar (long scroll) and the mobile
  //    per-section tabs can compose the same pieces without duplicating markup. ──
  const presetsBody = (<>
    <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
      <NumSlider label="Detail" value={detail} min={0} max={100} step={1} onChange={setDetailOwned}/>
    </div>
    <div className="anim-fadein flex flex-col">
      {CATEGORIES.map(([key,label])=>{
        const looks = LOOK_PRESETS.filter(p=>p.category===key);
        if(!looks.length) return null;
        return (
        <Panel key={key} label={label}>
          <div className="grid grid-cols-2 gap-1.5">
            {looks.map(p=>{
              const on=activeLook===p.name;
              return (
              <button key={p.name} onClick={()=>applyLookPreset(p)} title={p.name}
                className={`group flex flex-col overflow-hidden border transition-colors ${on?'border-amber-600':'border-zinc-800 hover:border-zinc-600'}`}>
                <div className="relative aspect-[16/10] w-full bg-zinc-900 overflow-hidden">
                  {lookThumbs[p.name]
                    ? <img src={lookThumbs[p.name]} alt="" className="w-full h-full object-cover" style={{imageRendering:p.settings.mode==='ascii'?'auto':'pixelated'}}/>
                    : <div className="w-full h-full animate-pulse bg-zinc-800"/>}
                </div>
                <div className={`text-[11px] leading-tight py-1.5 px-1 text-center ${on?'text-amber-100 bg-amber-950/40':'text-zinc-400 group-hover:text-zinc-200'}`}>{p.name}</div>
              </button>
            );})}
          </div>
        </Panel>
        );
      })}
    </div>
  </>);

  const renderingPanel = (
    <Panel label="Rendering">
      <Field label="Mode">
        <Segmented options={[['dither','Dither'],['ascii','ASCII'],['halftone','Halftone']]} value={mode} onChange={handleModeChange}/>
      </Field>
      {mode==='dither' &&
        <Field label="Pattern">
          <Dropdown value={algo} onChange={setAlgo}
            options={[['bayer2','Grid 2×2'],['bayer','Grid 4×4'],['bayer8','Grid 8×8'],['diamond','Diamond'],['bluenoise','Blue noise'],['diffusion','Floyd–Steinberg'],['jjn','Jarvis'],['stucki','Stucki'],['sierra','Sierra'],['atkinson','Atkinson'],['riemersma','Riemersma']]}/>
        </Field>}
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
      <NumSlider label="Detail" value={detail} min={0} max={100} step={1} onChange={setDetailOwned}/>
    </Panel>
  );

  const appearancePanel = (
    <Panel label="Appearance" action={appearanceDirty && <ResetButton onClick={resetAppearance} title="Reset appearance"/>}>
      <NumSlider label="Contrast"   value={contrast}   min={-100} max={100} step={1}    onChange={setContrast}/>
      <NumSlider label="Midtones"   value={midtones}   min={0.3}  max={2.5} step={0.05} onChange={setMidtones}/>
      <NumSlider label="Highlights" value={highlights} min={0.3}  max={2.5} step={0.05} onChange={setHighlights}/>
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
        <div className="text-xs text-zinc-600 leading-relaxed">{gamut==='full'
          ? "Builds a palette from the photo's own colours and maps each pixel to the nearest — the image keeps its real hues instead of a fixed look."
          : `Maps the photo onto the ${DEVICE_GAMUTS[gamut].label} color set — authentic hardware colors, approximated from your image.`}</div>
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
                <button onClick={()=>removeColor(entry.id)} title="Remove color" aria-label="remove color"
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
          title={palette.length>=8?'Maximum of 8 colors reached':'Add a color'}
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
    <Panel label="Atmosphere" action={atmosphereDirty && <ResetButton onClick={resetAtmosphere} title="Reset atmosphere"/>}>
      <NumSlider label="Phosphor glow"  value={phosphorGlow}  min={0} max={100} step={1} onChange={setPhosphorGlow}/>
      <NumSlider label="Luminance lift" value={luminanceLift} min={0} max={100} step={1} onChange={setLuminanceLift}/>
      <NumSlider label="Scanlines" value={scanlines} min={0} max={100} step={1} onChange={setScanlines}/>
      <NumSlider label="Noise"     value={noise}     min={0} max={100} step={1} onChange={setNoise}/>
      <NumSlider label="Chroma shift" value={chromaShift} min={0} max={20} step={0.5} onChange={setChromaShift}/>
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
    ['presets','Presets',LayoutGrid],
    ['rendering','Rendering',Grid3x3],
    ['appearance','Appearance',Contrast],
    ['color','Color',Palette],
    ['atmosphere','Atmosphere',Radio],
    ['share','Save',Save],
  ];
  const mobileTabIds = MOBILE_TABS.map(t=>t[0]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-300 font-mono overflow-hidden"
      style={{paddingTop:'env(safe-area-inset-top)',paddingLeft:'env(safe-area-inset-left)',paddingRight:'env(safe-area-inset-right)'}}>
      <style>{`
        input[type=range]{-webkit-appearance:none;height:2px;background:#3f3f46;width:100%}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;background:#f4e4c1;border-radius:0;cursor:pointer;margin-top:-4px}
        input[type=range]:disabled{opacity:0.35}
        input[type=number]{-moz-appearance:textfield;background:#18181b;color:#a1a1aa;border:1px solid #3f3f46;padding:2px 4px;font-size:11px;width:52px;text-align:right;font-family:monospace}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}
        input[type=number]:focus{outline:none;border-color:#b45309}
        .btn{padding:5px 0;font-size:11px;border:1px solid #3f3f46;color:#71717a;letter-spacing:.05em;cursor:pointer;text-align:center;background:transparent}
        .btn:hover{color:#d4d4d8;border-color:#71717a}
        .btn.on{border-color:#b45309;color:#fef3c7;background:#1c0a00}
        .ctrl::-webkit-scrollbar{width:3px}
        .ctrl::-webkit-scrollbar-thumb{background:#3f3f46}
        @keyframes fadein{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}
        .anim-fadein{animation:fadein 0.18s ease-out}
        @keyframes boot{0%{transform:translateX(-120%)}100%{transform:translateX(420%)}}
        .checker{background-image:linear-gradient(45deg,#26262b 25%,transparent 25%),linear-gradient(-45deg,#26262b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#26262b 75%),linear-gradient(-45deg,transparent 75%,#26262b 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;background-color:#161619}
        @media (pointer:coarse){
          .btn{padding:12px 0;min-height:44px}
          .icon-btn{width:44px;height:44px}
          .swatch{width:44px;height:44px}
          .tap-target{min-height:44px;padding-top:10px;padding-bottom:10px}
          .collapsible-header{min-height:44px}
          .remove-btn{width:44px}
          input[type=range]::-webkit-slider-thumb{width:20px;height:20px;margin-top:-9px}
          input[type=checkbox]{width:18px;height:18px}
        }
      `}</style>

      {/* HEADER */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-zinc-800 shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/favicon.png" alt="Phosphor Studio" className="w-6 h-6 shrink-0 rounded-[3px]"/>
            <h1 className="hidden sm:block text-base whitespace-nowrap tracking-tight">
              <span className="text-amber-100">Phosphor</span> <span className="text-zinc-500">Studio</span>
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={undo} disabled={!canUndo} title="undo (⌘Z)" aria-label="undo"
              className="tap-target flex items-center justify-center w-7 h-7 shrink-0 border border-zinc-700 enabled:hover:border-amber-600 text-zinc-500 enabled:hover:text-amber-300 disabled:opacity-30 disabled:cursor-default transition-colors">
              <Undo2 size={13}/>
            </button>
            <button onClick={redo} disabled={!canRedo} title="redo (⌘⇧Z)" aria-label="redo"
              className="tap-target flex items-center justify-center w-7 h-7 shrink-0 border border-zinc-700 enabled:hover:border-amber-600 text-zinc-500 enabled:hover:text-amber-300 disabled:opacity-30 disabled:cursor-default transition-colors">
              <Redo2 size={13}/>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={()=>setAboutOpen(true)} title="about" aria-label="about"
            className="tap-target flex items-center justify-center w-7 h-7 border border-zinc-700 hover:border-amber-600 text-zinc-500 hover:text-amber-300 transition-colors">
            <Info size={13}/>
          </button>
          <label className="tap-target flex items-center gap-1.5 text-xs text-zinc-400 hover:text-amber-300 cursor-pointer border border-zinc-700 hover:border-amber-600 px-2.5 py-1.5 tracking-wide transition-colors">
            <Upload size={12}/> <span className="hidden sm:inline">UPLOAD</span>
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
          <div className="relative bg-zinc-900 flex flex-col overflow-hidden shrink-0 h-[40vh] md:h-auto md:flex-1">
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
            </div>

            <div className="hidden md:flex relative items-center px-3 py-2 border-t border-zinc-800 shrink-0">
              <div className="flex items-center gap-1.5">
                <button onClick={()=>zoomAt(viewRef.current.zoom-0.25,0,0)} title="zoom out" aria-label="zoom out"
                  className="icon-btn w-7 h-7 flex items-center justify-center border border-zinc-700 hover:border-amber-600 text-zinc-500 hover:text-amber-300">
                  <ZoomOut size={12}/>
                </button>
                <span className="text-xs text-zinc-600 w-10 text-center">{Math.round(zoom*100)}%</span>
                <button onClick={()=>zoomAt(viewRef.current.zoom+0.25,0,0)} title="zoom in" aria-label="zoom in"
                  className="icon-btn w-7 h-7 flex items-center justify-center border border-zinc-700 hover:border-amber-600 text-zinc-500 hover:text-amber-300">
                  <ZoomIn size={12}/>
                </button>
                <button onClick={resetView} className="text-xs text-zinc-600 hover:text-amber-400 ml-1">Reset</button>
                <button
                  onPointerDown={e=>{ if(outputUrl){ e.preventDefault(); setComparing(true); } }}
                  onPointerUp={()=>setComparing(false)} onPointerLeave={()=>setComparing(false)}
                  disabled={!outputUrl} title="hold to see the original"
                  className={`hidden md:flex select-none items-center gap-1.5 ml-2 px-2 h-7 border text-xs transition-colors ${comparing?'border-amber-600 text-amber-100 bg-amber-950/40':'border-zinc-700 text-zinc-500'} enabled:hover:border-amber-600 enabled:hover:text-amber-300 disabled:opacity-30 disabled:cursor-default`}>
                  <Eye size={12}/> HOLD
                </button>
              </div>
              <a href="https://rodrigosilva.design" target="_blank" rel="noopener noreferrer"
                className="hidden md:block absolute left-1/2 -translate-x-1/2 text-xs text-zinc-600 hover:text-amber-400 transition-colors">
                by rodrigosilva.design
              </a>
            </div>
          </div>

          {/* CONTROLS */}
          <div className="w-full md:w-72 xl:w-80 flex-1 md:flex-none min-h-0 flex flex-col bg-zinc-950 border-t md:border-t-0 md:border-l border-zinc-800">

            {/* TAB BAR — two tabs on desktop, per-section icon tabs on mobile */}
            {isNarrow ? (
              <div className="flex shrink-0 border-b border-zinc-800">
                {MOBILE_TABS.map(([v,label,Icon])=>{
                  const on = (activeTab===v) || (v==='rendering' && !mobileTabIds.includes(activeTab));
                  return (
                    <button key={v} onClick={()=>setActiveTab(v)} title={label} aria-label={label}
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

            <div ref={ctrlRef} className="ctrl flex-1 overflow-y-auto flex flex-col">

            {isNarrow ? (
              /* MOBILE: one section per tab */
              activeTab==='presets' ? presetsBody
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

            <div className="pb-2"/>
            </div>
          </div>
        </div>

      {aboutOpen && <AboutModal onClose={()=>setAboutOpen(false)}/>}
      {booting && <Splash hiding={bootHiding}/>}
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

// Dismissable about: modal on desktop, bottom sheet on mobile.
function AboutModal({onClose}) {
  useEffect(() => {
    const onKey = e => { if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}
        className="anim-fadein w-full sm:w-[440px] max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 sm:rounded p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-7 h-7 shrink-0 rounded-[3px]"/>
            <h2 className="text-base tracking-tight"><span className="text-amber-100">Phosphor</span> <span className="text-zinc-500">Studio</span></h2>
          </div>
          <button onClick={onClose} aria-label="close" className="tap-target flex items-center justify-center w-7 h-7 shrink-0 text-zinc-500 hover:text-amber-300 border border-zinc-700 hover:border-amber-600 transition-colors">
            <X size={14}/>
          </button>
        </div>
        <p className="text-xl text-amber-100 leading-snug">A lo-fi visual studio.</p>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Convert photos into dithered, halftone, and ASCII retro-display art.
          Features CRT atmospheric effects and a curated collection of presets inspired by
          my favorite films, series, and video games.
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer"
            className="tap-target flex items-center gap-2 text-xs text-zinc-400 hover:text-amber-300 border border-zinc-800 hover:border-amber-800 px-3 py-2 transition-colors">
            <Info size={13}/> Built by Rodrigo Silva — rodrigosilva.design
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
            className="tap-target flex items-center gap-2 text-xs text-zinc-400 hover:text-amber-300 border border-zinc-800 hover:border-amber-800 px-3 py-2 transition-colors">
            <Code2 size={13}/> Source on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

function InvertButton({onClick,title}) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className="icon-btn flex items-center justify-center w-7 h-7 shrink-0 border border-zinc-700 hover:border-amber-600 text-zinc-500 hover:text-amber-300 transition-colors">
      <ArrowLeftRight size={11}/>
    </button>
  );
}

function ResetButton({onClick,title}) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className="flex items-center justify-center w-6 h-6 -my-1 shrink-0 text-zinc-600 hover:text-amber-300 transition-colors">
      <RotateCcw size={12}/>
    </button>
  );
}

function Panel({label,children,action}) {
  return (
    <div className="border-b border-zinc-800 px-4 py-4">
      <div className="flex items-center justify-between mb-3 min-h-6">
        <div className="text-xs font-medium tracking-wide text-zinc-300">{label}</div>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
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
      <div className="text-xs text-zinc-500 mb-1.5">{label}</div>
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
      <div className="text-xs text-zinc-500 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

// Custom dropdown for many-option selectors: filled box + value + chevron, popover list.
function Dropdown({options,value,onChange,preview}) {
  const [open,setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if(!open) return;
    const onDoc = e => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',onDoc);
    return () => document.removeEventListener('mousedown',onDoc);
  },[open]);
  const current = options.find(o=>o[0]===value);
  return (
    <div ref={ref} className="relative">
      <button onClick={()=>setOpen(o=>!o)}
        className="tap-target w-full flex items-center justify-between gap-2 px-2.5 py-2 border border-zinc-700 text-xs text-zinc-200 hover:border-zinc-600 transition-colors">
        <span className="truncate">{current?current[1]:'—'}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {preview && preview(value)}
          <ChevronDown size={12} className={`text-zinc-500 transition-transform ${open?'rotate-180':''}`}/>
        </span>
      </button>
      {open &&
        <div className="absolute z-20 mt-1 left-0 right-0 max-h-64 overflow-y-auto border border-zinc-700 bg-zinc-900 shadow-xl">
          {options.map(([v,l,desc])=>(
            <button key={v} onClick={()=>{onChange(v); setOpen(false);}}
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
        <div className="text-[10px] text-zinc-600 leading-relaxed">Scalable vector — ASCII exports as editable text, halftone as shapes. Atmosphere effects are omitted.</div>}
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
