// Project I.G.I. in the browser: copies the player's own game (disc image, disc or folder) into OPFS (once; it never leaves the
// computer), starts the recompiled build (build/recomp.js), replays its frames with WebGPU and feeds it
// input and audio.
//
// URL options: ?mute (no audio) ?fps (frame rate in the console) ?log (host log) ?autoplay
//              ?exe=<name> (the executable inside the game folder, if not the profile's default)
//              ?pads=N (game controllers to expose, default 1, at most 4)
//              ?queue=1 (frames queued ahead of the display, default 2: 1 cuts 16 ms of input latency on a
//              machine that simulates a frame well within 16 ms, else it hitches)
'use strict';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const OPFS_DIR = 'rcgame';
const MARKER = '.installed.json';   // { version } once every file is copied
const status = (t) => { $('status').textContent = t; };
// the launcher's screens (index.html): loading, home
const show = (view) => { for (const v of document.querySelectorAll('#panel .view')) v.classList.toggle('hidden', v.id !== 'view-' + view); };
// Usage counts (GoatCounter: no cookies, nothing personal), only on a site whose page names a counter in
// <meta name="goatcounter" content="https://CODE.goatcounter.com/count"> (deploy_web.sh adds it). A path is
// a page view; an event is something done on the page: play, installed, no-webgpu, no-adapter, error.
function count(path, event) {
  const url = document.querySelector('meta[name="goatcounter"]')?.content;
  if (!url || !navigator.sendBeacon) return;
  let ref = document.referrer;   // where the visitor came from (coi.js keeps it across its reload)
  try { ref = sessionStorage.getItem('rc-referrer') ?? ref; } catch {}
  if (ref.startsWith(location.origin)) ref = '';
  const q = new URLSearchParams({ p: path, t: event ? path : document.title, r: event ? '' : ref,
    s: `${screen.width},${screen.height},${devicePixelRatio || 1}`, rnd: Math.random().toString(36).slice(2) });
  if (event) q.set('e', 'true');
  try { navigator.sendBeacon(`${url}?${q}`); } catch {}
}
const fail = (e) => { count('error', true); status('Error: ' + e.message); $('panel').classList.remove('hidden'); show('loading'); };
const mb = (n) => (n / 1e6).toFixed(0);

// ------------------------------------------------------------------ game files in OPFS

async function gameDir(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create });
}

async function readMarker() {
  try {
    const f = await (await (await gameDir(false)).getFileHandle(MARKER)).getFile();
    return JSON.parse(await f.text());
  } catch { return null; }
}

async function writeMarker(version) {
  const fh = await (await gameDir(true)).getFileHandle(MARKER, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify({ version, at: new Date().toISOString() }));
  await w.close();
}

async function fileHandle(dir, relPath, create) {
  const parts = relPath.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

// IGI's disc check looks for three one-byte files from the CD's root (host/profile.h); they sit next to IGI.exe
const CD_FILES = ['ymbe.afp', 'anys.afp', 'mpzm.afp'];

// A folder the player picks: the installed game (IGI.exe at its top) or the disc itself (the game in pc/)
function folderFiles(fileList) {
  // the whole folder, minus its own name: <picked>/a/b.dat -> a/b.dat
  return [...fileList].map((f) => ({ f, dest: f.webkitRelativePath.split('/').slice(1).join('/') })).filter((e) => e.dest);
}

// The disc image (.iso): ISO 9660, read in place, with Joliet's long names when the image has them. Each file
// is a slice of the image, so nothing is held in memory.
async function isoFiles(file) {
  const SEC = 2048;
  const bytes = async (off, n) => new Uint8Array(await file.slice(off, off + n).arrayBuffer());
  const u32 = (b, at) => b[at] | b[at + 1] << 8 | b[at + 2] << 16 | (b[at + 3] << 24 >>> 0);
  let root = null, joliet = false;
  for (let s = 16; s < 32; s++) {   // volume descriptors: 1 primary, 2 supplementary (Joliet), 255 the end
    const d = await bytes(s * SEC, SEC);
    if (String.fromCharCode(...d.subarray(1, 6)) !== 'CD001' || d[0] === 255) break;
    const isJoliet = d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && [0x40, 0x43, 0x45].includes(d[90]);
    if ((d[0] === 1 && !root) || isJoliet) { root = { lba: u32(d, 158), size: u32(d, 166) }; joliet = isJoliet; }
  }
  if (!root) throw new Error('That file is not a CD image (.iso).');
  const name = (b) => {
    if (joliet) { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] << 8 | b[i + 1]); return s.replace(/;\d+$/, ''); }
    return String.fromCharCode(...b).replace(/;\d+$/, '').replace(/\.$/, '').toLowerCase();
  };
  const list = [], seen = new Set();
  const walk = async (dir, prefix) => {
    if (seen.has(dir.lba) || seen.size > 4096) return;
    seen.add(dir.lba);
    const d = await bytes(dir.lba * SEC, dir.size);
    for (let at = 0; at < d.length;) {
      const len = d[at];
      if (!len) { at = (Math.floor(at / SEC) + 1) * SEC; continue; }   // records don't cross a sector
      const n = d[at + 32], raw = d.subarray(at + 33, at + 33 + n);
      const entry = { lba: u32(d, at + 2), size: u32(d, at + 10) };
      if (!(n === 1 && raw[0] <= 1)) {   // not . or ..
        const path = prefix + name(raw);
        if (d[at + 25] & 2) await walk(entry, path + '/');
        else list.push({ f: file.slice(entry.lba * SEC, entry.lba * SEC + entry.size), dest: path });
      }
      at += len;
    }
  };
  await walk(root, '');
  return list;
}

async function importFiles(list) {
  // the disc's layout: the game in pc/, the check files at the root
  const lower = (e) => e.dest.toLowerCase();
  if (list.some((e) => lower(e) === 'pc/igi.exe'))
    list = list.filter((e) => lower(e).startsWith('pc/')).map((e) => ({ f: e.f, dest: e.dest.slice(3) }))
      .concat(list.filter((e) => CD_FILES.includes(lower(e))));
  if (!list.some((e) => lower(e).endsWith('.exe')))
    throw new Error('No IGI.exe there: choose the IGI disc image (.iso), the disc itself, or your installed IGI folder.');
  const names = new Set(list.map((e) => e.dest.split('/').pop().toLowerCase()));
  const cd = CD_FILES.filter((n) => !names.has(n));
  if (cd.length) throw new Error(`Copy ${cd.map((n) => n.toUpperCase()).join(', ')} from the root of the IGI disc into that folder, ` +
    'next to IGI.exe: the game checks for them. Or choose the disc image (.iso) instead.');
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(OPFS_DIR, { recursive: true }); } catch {}
  await navigator.storage.persist?.();
  const dir = await gameDir(true);
  const total = list.reduce((s, e) => s + e.f.size, 0);
  let done = 0;
  $('progress').classList.remove('hidden');
  for (const e of list) {
    status(`Copying ${e.dest} (${mb(done)} / ${mb(total)} MB)`);
    const w = await (await fileHandle(dir, e.dest, true)).createWritable();
    await w.write(e.f);
    await w.close();
    done += e.f.size;
    $('progress').value = done / total;
  }
  const sig = list.map((e) => `${e.dest}:${e.f.size}`).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sig));
  await writeMarker([...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join(''));
  $('progress').classList.add('hidden');
}

// ------------------------------------------------------------------ a game the site hosts
// Off unless the site was built with one (deploy_web.sh GAME=<disc image>), which is only for a game the site
// may share: one whose rights holder agreed in writing, or a freely redistributable demo. The image sits beside
// the page in parts (tools/gameparts.py), listed in the file <meta name="rc-game"> names:
//   { version, name, size, parts: [{ file, size, sha256 }] }
// The parts are downloaded into OPFS (DL_DIR, resumed part by part after a reload), each checked, then the image
// is installed as a picked one would be and the download deleted.
const DL_DIR = 'rcdownload';
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hostedGame() {
  const url = document.querySelector('meta[name="rc-game"]')?.content;
  if (!url) return null;
  try {
    const abs = new URL(url, location.href);
    const r = await fetch(abs, { cache: 'no-cache' });
    if (!r.ok) return null;
    return { ...(await r.json()), base: new URL('.', abs).href };
  } catch { return null; }
}

async function fetchPart(url, size, progress) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Could not download ${url.split('/').pop()} (${r.status}). Check your connection and reload the page: it carries on where it stopped.`);
  const buf = new Uint8Array(size);
  let n = 0;
  for (const reader = r.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > size) throw new Error('A part of the download is larger than expected: reload the page to try again.');
    buf.set(value, n);
    n += value.length;
    progress(n);
  }
  if (n !== size) throw new Error('The download stopped early. Check your connection and reload the page: it carries on where it stopped.');
  return buf;
}

async function downloadGame(game) {
  const root = await navigator.storage.getDirectory();
  await navigator.storage.persist?.();
  let dl = await root.getDirectoryHandle(DL_DIR, { create: true });
  let state = null;
  try { state = JSON.parse(await (await (await dl.getFileHandle('state.json')).getFile()).text()); } catch {}
  if (state?.version !== game.version) {   // a download of another version starts over
    await root.removeEntry(DL_DIR, { recursive: true });
    dl = await root.getDirectoryHandle(DL_DIR, { create: true });
    state = { version: game.version, done: 0 };
  }
  const image = await dl.getFileHandle('image.iso', { create: true });
  let at = game.parts.slice(0, state.done).reduce((s, p) => s + p.size, 0);
  $('progress').classList.remove('hidden');
  for (let i = state.done; i < game.parts.length; i++) {
    const p = game.parts[i];
    const shown = (n) => {
      status(`Downloading the game: ${mb(at + n)} of ${mb(game.size)} MB`);
      $('progress').value = (at + n) / game.size;
    };
    shown(0);
    const buf = await fetchPart(game.base + p.file, p.size, shown);
    if (hex(await crypto.subtle.digest('SHA-256', buf)) !== p.sha256)
      throw new Error('Part of the download arrived damaged. Reload the page to try again.');
    const w = await image.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: at, data: buf });
    await w.close();
    at += p.size;
    state.done = i + 1;
    const s = await (await dl.getFileHandle('state.json', { create: true })).createWritable();
    await s.write(JSON.stringify(state));
    await s.close();
  }
  status('Installing the game…');
  await importFiles(await isoFiles(await image.getFile()));
  await root.removeEntry(DL_DIR, { recursive: true });
}

// ------------------------------------------------------------------ texture and model packs
// The game reads packs from its user data folder, /opfs/userdata (host/texpack.c: textures/, host/modelpack.c:
// models/), which sits beside the game folder and survives choosing a new one.

async function userDir(...path) {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('userdata', { create: true });
  for (const p of path) d = await d.getDirectoryHandle(p, { create: true });
  return d;
}

// Packs that ship with the site (deploy_web.sh: CC0 models; packs/index.json lists them), copied in once a version
async function installShippedPacks() {
  let index;
  try {
    const r = await fetch('packs/index.json', { cache: 'no-cache' });
    if (!r.ok) return;
    index = await r.json();
  } catch { return; }
  const ud = await userDir();
  try {
    const f = await (await ud.getFileHandle('.shipped-packs.json')).getFile();
    if (JSON.parse(await f.text()).version === index.version) return;
  } catch {}
  for (const [i, rel] of index.files.entries()) {
    status(`Getting the HD models (${i + 1} of ${index.files.length})`);
    const r = await fetch('packs/' + rel.split('/').map(encodeURIComponent).join('/'));
    if (!r.ok) throw new Error(`Could not download packs/${rel}`);
    const w = await (await fileHandle(ud, rel, true)).createWritable();
    await w.write(await r.blob());
    await w.close();
  }
  const m = await (await ud.getFileHandle('.shipped-packs.json', { create: true })).createWritable();
  await m.write(JSON.stringify({ version: index.version }));
  await m.close();
}

// A pack folder the player picks: a model pack (it has models.txt) goes to models/<name>, a texture pack (PNGs
// named by their texture's 16-digit hash, as tools/texup makes them) to textures/<name>
async function importPack(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const name = files[0].webkitRelativePath.split('/')[0];
  const isModels = files.some((f) => /(^|\/)models\.txt$/.test(f.webkitRelativePath));
  const keep = isModels ? files : files.filter((f) => /^[0-9a-f]{16}\.png$/i.test(f.name));
  if (!keep.length) throw new Error('That folder has neither models.txt nor textures named by hash (16 hex digits .png).');
  const dir = await userDir(isModels ? 'models' : 'textures', name);
  for (const [i, f] of keep.entries()) {
    $('pack-status').textContent = `Copying ${name}: ${i + 1} of ${keep.length}`;
    const rel = isModels ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name;
    const w = await (await fileHandle(dir, rel, true)).createWritable();
    await w.write(f);
    await w.close();
  }
  count('pack-added', true);
  return `${isModels ? 'Model' : 'Texture'} pack "${name}" added (${keep.length} files). It shows in Remastered graphics (F10).`;
}

// ------------------------------------------------------------------ input

// KeyboardEvent.code -> USB HID usage (what host/input.c's key table uses)
const HID = {};
for (let i = 0; i < 26; i++) HID['Key' + String.fromCharCode(65 + i)] = 4 + i;
for (let i = 1; i <= 9; i++) HID['Digit' + i] = 29 + i;
HID.Digit0 = 39;
Object.assign(HID, {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
  Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
});
for (let i = 1; i <= 12; i++) HID['F' + i] = 57 + i;
for (let i = 1; i <= 9; i++) HID['Numpad' + i] = 88 + i;

function hookInput(M) {
  const canvas = $('canvas');
  const key = (down) => (e) => {
    const u = HID[e.code];
    if (u === undefined || e.repeat) return;
    if (!(e.metaKey && !down)) e.preventDefault();
    M._input_key_hid(u, down ? 1 : 0);
  };
  window.addEventListener('keydown', key(true));
  window.addEventListener('keyup', key(false));
  // The game draws its own cursor and reads relative motion. Lock the pointer when the browser allows
  // it (then the system cursor can't leave the game); without a lock, motion over the canvas still works.
  // Raw motion (unadjustedMovement) skips the system's pointer acceleration, as shooter players expect;
  // browsers without it get a plain lock.
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); });
    }
    if (e.button > 2) e.preventDefault();   // thumb buttons: the dive, not Back / Forward
    M._input_mouse_button([0, 2, 1, 3, 4][e.button] ?? 0, 1);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button > 2 && document.pointerLockElement === canvas) e.preventDefault();
    M._input_mouse_button([0, 2, 1, 3, 4][e.button] ?? 0, 0);
  });
  canvas.addEventListener('mousemove', (e) => M._input_mouse_move(e.movementX, e.movementY));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // The wheel, as 120-unit notches. Mice send one event per notch; trackpads send many small ones, which add up.
  let wheel = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheel -= e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 120 : e.deltaY * 1.2;
    const notches = Math.trunc(wheel / 120);
    if (notches) { M._input_mouse_wheel(notches * 120); wheel -= notches * 120; }
  }, { passive: false });
  // Switching away (Cmd+Tab, another tab) would leave held keys held: the player would keep walking or firing.
  window.addEventListener('blur', () => M._input_release_all());
  document.addEventListener('visibilitychange', () => { if (document.hidden) M._input_release_all(); });
}

// Gamepads (Gamepad API, polled every animation frame). Browsers only expose a pad after a button press
// on it. The game sees each pad as a DirectInput "Logitech Dual Action USB" (host/dinput.c); ?pads=N exposes
// N of them (default 1, at most 4). Like the native feeder (host/window.c), slots are DirectInput pad
// numbers handed out in connection order, not the browser's gamepad.index (which can start above 0, e.g.
// after a reconnect), and a pad keeps its slot until it is unplugged.
// With mapping 'standard' buttons and axes are already in the layout input_gamepad() takes. Other pads
// (older DirectInput-era ones such as the Logitech Precision) report buttons in HID order, as Windows
// DirectInput presents them and as the game's controltypes.csv expects; their axes are indexed by HID
// usage (X Y Z Rx Ry Rz ...), so the right stick is Z/Rz and Chrome puts the hat switch at axes[9].
const PAD_SLOTS = 4;
const padLast = Array.from({ length: PAD_SLOTS }, () => '');
const padSlotIndex = Array(PAD_SLOTS).fill(-1);   // slot -> gamepad.index
const padHats = new Set();   // gamepad.index of pads whose axes[9] is a hat switch
// raw button n -> standard-layout bit that host/dinput.c turns back into DirectInput button n
const STD_FOR_RAW = [2, 0, 1, 3, 4, 5, 6, 7, 9, 8, 10, 11];
// Chrome's hat axis: -1 = up, then clockwise in steps of 2/7; anything outside [-1, 1] is centred
const HAT_DIRS = [1 << 12, (1 << 12) | (1 << 15), 1 << 15, (1 << 13) | (1 << 15), 1 << 13, (1 << 13) | (1 << 14), 1 << 14, (1 << 12) | (1 << 14)];
const axis16 = (v) => Math.round(Math.max(-1, Math.min(1, v || 0)) * 32767);

function readPad(g) {
  let buttons = 0;
  if (g.mapping === 'standard') {
    g.buttons.forEach((b, i) => { if (i < 17 && (b.pressed || b.value > 0.3)) buttons |= 1 << i; });
    return { buttons, ax: [0, 1, 2, 3].map((i) => axis16(g.axes[i])) };
  }
  g.buttons.forEach((b, i) => { if (i < STD_FOR_RAW.length && (b.pressed || b.value > 0.3)) buttons |= 1 << STD_FOR_RAW[i]; });
  // axes[9] is only taken as a hat once it has shown the centred value, so a plain axis resting at 0 isn't
  // read as d-pad down
  const hat = g.axes[9];
  if (hat > 1.1) padHats.add(g.index);
  else if (padHats.has(g.index) && hat >= -1.01) buttons |= HAT_DIRS[Math.round((hat + 1) * 3.5) % 8];
  const ry = g.axes.length > 5 ? g.axes[5] : g.axes[3];
  return { buttons, ax: [axis16(g.axes[0]), axis16(g.axes[1]), axis16(g.axes[2]), axis16(ry)] };
}

function pollGamepads(M) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((g) => g && g.connected) : [];
  // free the slots of unplugged pads, then give new pads the lowest free slot
  for (let s = 0; s < PAD_SLOTS; s++)
    if (padSlotIndex[s] >= 0 && !pads.some((g) => g.index === padSlotIndex[s])) { padHats.delete(padSlotIndex[s]); padSlotIndex[s] = -1; }
  for (const g of pads) {
    if (padSlotIndex.includes(g.index)) continue;
    const s = padSlotIndex.indexOf(-1);
    if (s < 0) break;
    padSlotIndex[s] = g.index;
    console.log(`gamepad ${g.index} -> pad ${s}: ${g.id} (${g.mapping || 'non-standard'} mapping, ${g.buttons.length} buttons, ${g.axes.length} axes)`);
  }
  for (let slot = 0; slot < PAD_SLOTS; slot++) {
    const g = pads.find((p) => p.index === padSlotIndex[slot]);
    const { buttons, ax } = g ? readPad(g) : { buttons: 0, ax: [0, 0, 0, 0] };
    const connected = g ? 1 : 0;
    const key = `${connected}:${buttons}:${ax.join(',')}`;
    if (key === padLast[slot]) continue;
    padLast[slot] = key;
    M._input_gamepad(slot, connected, buttons, ax[0], ax[1], ax[2], ax[3]);
  }
}

// ------------------------------------------------------------------ audio

async function startAudio(M) {
  if (params.has('mute')) return;
  const ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('audio-worklet.js');
  const node = new AudioWorkletNode(ctx, 'rc-ring', { outputChannelCount: [2] });
  node.port.postMessage({ memory: M.wasmMemory, ring: M._rc_audio_ring() });
  node.connect(ctx.destination);
  const resume = () => ctx.resume();
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
}

// ------------------------------------------------------------------ run

function sizeCanvas() {
  const canvas = $('canvas');
  const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(640, Math.round(r.width * dpr));
  canvas.height = Math.max(480, Math.round(r.height * dpr));
}

async function run() {
  await installShippedPacks().catch((e) => console.warn('packs:', e));
  $('panel').classList.add('hidden');
  fullscreenTip();
  sizeCanvas();
  const script = document.createElement('script');
  script.src = 'build/recomp.js';
  await new Promise((ok, fail) => {
    script.onload = ok;
    script.onerror = () => fail(new Error('Could not load build/recomp.js: build it with ./build_web.sh.'));
    document.head.appendChild(script);
  });
  const M = await createRecomp({
    arguments: ['/opfs/' + OPFS_DIR],
    print: (t) => console.log(t),
    printErr: (t) => console.log(t),
    preRun: [(m) => {
      if (params.has('mute')) m.ENV.RC_NO_AUDIO = '1';
      if (params.get('exe')) m.ENV.RC_EXE = params.get('exe');
      if (params.has('log')) m.ENV.RC_LOG = '1';
      if (params.has('pads')) m.ENV.RC_PADS = params.get('pads');
      if (params.has('queue')) m.ENV.RC_QUEUE = params.get('queue');
      m.ENV.RC_LOG_FPS = params.has('fps') ? '1' : '';
      if (!params.has('fps')) delete m.ENV.RC_LOG_FPS;
      Object.assign(m.ENV, window.rcTestEnv || {});   // the desktop app's test runs (desktop/main.js, IGI_TEST_ENV)
    }],
  });
  const canvas = $('canvas');
  M._rc_gpu_init(canvas.width, canvas.height);
  new ResizeObserver(() => { sizeCanvas(); M._rc_set_canvas_size(canvas.width, canvas.height); }).observe(canvas);
  hookInput(M);
  startAudio(M).catch((e) => console.warn('audio unavailable:', e));
  // the game presents as the display does; each animation frame shows the next finished frame, if any
  const frame = () => {
    pollGamepads(M);
    M._rc_gpu_pump(1);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setInterval(() => M._rc_gpu_pump(0), 1);   // readbacks mid-frame are answered without waiting for vsync
  canvas.focus();
  window.recomp = M;
}

async function boot() {
  // the visit counts once the page is isolated (coi.js may reload it first), or once that has failed
  let coiTried = !navigator.serviceWorker;
  try { coiTried ||= sessionStorage.getItem('rc-coi-reloaded') === '1'; } catch { coiTried = true; }
  if (crossOriginIsolated || coiTried) count(location.pathname);
  if (!crossOriginIsolated) { if (coiTried) count('not-isolated', true); status('This page needs cross-origin isolation (COOP/COEP headers; see web/serve.py).'); return; }
  if (!navigator.gpu) { count('no-webgpu', true); status('This browser has no WebGPU. Use a current Chrome, Edge or Safari.'); return; }
  // navigator.gpu can exist with no usable adapter (GPU or driver blocklisted, hardware acceleration off,
  // Remote Desktop / VM): say so instead of starting a game that can only show a black screen
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null) ||
    await navigator.gpu.requestAdapter().catch(() => null) ||
    await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null);
  if (!adapter) {
    count('no-adapter', true);
    const firefox = /Firefox\//.test(navigator.userAgent);
    status('WebGPU is switched on in this browser but it found no usable graphics adapter. ' +
      (firefox ? 'Firefox only enables WebGPU for some GPUs and drivers (see about:support, "WebGPU"); Chrome or Edge usually work. '
        : 'Check that hardware acceleration is on in the browser settings and the graphics driver is up to date. ') +
      'Remote Desktop and virtual machines often have no GPU for the browser.');
    return;
  }
  if (adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter)
    console.warn('WebGPU: only a software (fallback) adapter is available; the game will be slow');
  if (!navigator.storage?.getDirectory) { status('This browser has no Origin Private File System.'); return; }
  const ready = () => {
    show('home');
    if (params.has('autoplay')) $('play').click();
  };
  $('play').onclick = () => { count('play', true); run().catch(fail); };
  const install = async (files) => {
    $('pick').classList.add('hidden');
    try { await importFiles(await files()); count('installed', true); ready(); }
    catch (err) { status(err.message); $('pick').classList.remove('hidden'); }
  };
  $('folder').onchange = (e) => { const l = e.target.files; e.target.value = ''; install(async () => folderFiles(l)); };
  $('iso').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) install(() => isoFiles(f)); };
  // or the disc image dropped on the page
  addEventListener('dragover', (e) => { if (!$('pick').classList.contains('hidden')) e.preventDefault(); });
  addEventListener('drop', (e) => {
    if ($('pick').classList.contains('hidden')) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) install(() => isoFiles(f));
  });
  // a game the site hosts comes first, the player's own copy second
  const game = await hostedGame();
  if (game) {
    $('download').textContent = `Download ${game.name || 'the game'} (${mb(game.size)} MB)`;
    $('download').classList.remove('hidden');
    $('iso-btn').classList.add('ghost');
    $('own-copy').classList.add('hidden');   // the footer's "runs your own copy"
    $('help').textContent = 'Downloads once, then plays straight away, even offline. Or use your own copy: the disc image ' +
      '(.iso, or drop it on this page), the disc itself, or the folder you installed it to.';
    $('download').onclick = async () => {
      $('pick').classList.add('hidden');
      try { await downloadGame(game); count('downloaded', true); ready(); }
      catch (err) { status(err.message); $('pick').classList.remove('hidden'); $('progress').classList.add('hidden'); }
    };
  }
  const showPicker = (msg) => {
    status(msg);
    $('pick').classList.remove('hidden');
    $('help').classList.remove('hidden');
  };

  $('reset').onclick = (e) => { e.preventDefault(); show('loading'); showPicker(game ? 'Download the game, or use your own copy.' : 'Choose your copy of IGI.'); };
  $('pack').onchange = async (e) => {
    const s = $('pack-status');
    s.classList.remove('hidden');
    try { s.textContent = await importPack(e.target.files); } catch (err) { s.textContent = err.message; }
    e.target.value = '';
  };
  if (!(await readMarker())) {
    showPicker(game ? 'Download the game to start, or use your own copy.' : 'Choose your copy of IGI to start.');
    if (game && params.has('autoplay')) $('download').click();
    return;
  }
  ready();
}

// ------------------------------------------------------------------ fullscreen

// The stage (game + overlays) goes fullscreen; the canvas grows with it and the game letterboxes its 4:3
// picture inside. Alt+Enter (Option+Enter on a Mac) toggles it, as in PC games of the time; it is caught
// before the game's own key handling so Enter doesn't also reach a menu.
function setupFullscreen() {
  const stage = $('stage');
  const active = () => document.fullscreenElement || document.webkitFullscreenElement;
  const toggle = () => {
    if (active()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage)?.catch?.(() => {});
    $('canvas').focus();
  };
  if (!stage.requestFullscreen && !stage.webkitRequestFullscreen) { $('fs').classList.add('hidden'); return; }
  $('fs').onclick = toggle;
  const swallow = (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (!e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'keydown' && !e.repeat) toggle();
  };
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', swallow, true);
  const sync = () => {
    $('fs-icon').setAttribute('d', active() ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
    $('fs').title = active() ? 'Exit fullscreen (Alt+Enter or Esc)' : 'Fullscreen (Alt+Enter)';
  };
  // In fullscreen, Keyboard Lock (Chrome, Edge) hands keys like Esc, Ctrl+W and Tab to the game instead of the
  // browser; holding Esc still leaves fullscreen.
  document.addEventListener('fullscreenchange', () => {
    if (active()) navigator.keyboard?.lock?.().catch(() => {});
    else navigator.keyboard?.unlock?.();
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  // the button shows while the mouse moves over the stage and fades after a few still seconds
  let idle;
  const wake = () => { stage.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => stage.classList.remove('awake'), 2500); };
  stage.addEventListener('mousemove', wake);
  stage.addEventListener('mouseleave', () => stage.classList.remove('awake'));
  wake();
}

// once the game starts: a short hint, so players learn the shortcut
function fullscreenTip() {
  const tip = $('fstip');
  if (document.fullscreenElement || document.webkitFullscreenElement || $('fs').classList.contains('hidden')) return;
  tip.classList.remove('hidden');
  tip.style.opacity = '1';
  setTimeout(() => { tip.style.opacity = '0'; }, 5000);
  setTimeout(() => tip.classList.add('hidden'), 5500);
}

// Keyboard cheat sheet beside the stage: IGI's controls aren't shown anywhere in the game. The CSS (index.html) reserves the panel's space on
// viewports wide enough and shrinks the stage to match; the body's .kbd-off class (set when the player
// dismisses the panel, remembered in localStorage) hides the panel and lets the stage reclaim the space.
function setupKbdHelp() {
  const off = () => { try { return localStorage.getItem('rc-kbd') === 'hide'; } catch { return false; } };
  const save = (v) => { try { localStorage.setItem('rc-kbd', v); } catch { /* storage blocked */ } };
  const apply = () => document.body.classList.toggle('kbd-off', off());
  $('kbd-close').onclick = () => { save('hide'); apply(); };
  $('kbd-show').onclick = () => { save('show'); apply(); };
  apply();
}

setupFullscreen();
setupKbdHelp();
boot();
