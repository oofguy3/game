// Builds public/sounds/: picks recordings from Kenney's CC0 sound packs (downloaded once into .cache/kenney) and
// renders the sounds made in code (src/client/audio/synth.ts), converting all of them with ffmpeg to mono 44.1 kHz MP3.
// Needs network access, unzip and ffmpeg; the results are committed, so CI never runs it.
// Usage: npm run build:sounds
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { SOUNDS } from '../src/client/audio/catalog';
import { encodeWav, synthesize, SYNTH_NAMES } from '../src/client/audio/synth';

const PACKS = {
  interface: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
  impact: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
  scifi: 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip',
} as const;
const PACK_NAMES: Record<keyof typeof PACKS, string> = { interface: 'Interface Sounds', impact: 'Impact Sounds', scifi: 'Sci-fi Sounds' };

/** Each recorded file the game uses: what it is saved as, and where it comes from. */
const PICKS: { out: string; pack: keyof typeof PACKS; file: string }[] = [
  { out: 'click', pack: 'interface', file: 'click_002' },
  { out: 'place', pack: 'interface', file: 'drop_002' },
  { out: 'built', pack: 'interface', file: 'confirmation_001' },
  ...[0, 1, 2, 3, 4].map((i) => ({ out: `thud-${i}`, pack: 'impact' as const, file: `impactSoft_medium_00${i}` })),
  { out: 'boom-0', pack: 'scifi', file: 'lowFrequency_explosion_000' },
  { out: 'boom-1', pack: 'scifi', file: 'lowFrequency_explosion_001' },
  { out: 'landing', pack: 'impact', file: 'impactPunch_heavy_000' },
  { out: 'refused', pack: 'interface', file: 'error_004' },
  { out: 'offer', pack: 'interface', file: 'glass_002' },
  { out: 'accepted', pack: 'interface', file: 'confirmation_002' },
  { out: 'lost', pack: 'impact', file: 'impactMetal_heavy_000' },
  { out: 'warStart', pack: 'impact', file: 'impactBell_heavy_000' },
];

const root = new URL('..', import.meta.url).pathname;
const cache = `${root}.cache/kenney`;
const out = `${root}public/sounds`;
mkdirSync(`${cache}/raw`, { recursive: true });
mkdirSync(out, { recursive: true });

const toMp3 = (input: string, name: string): void => {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '44100', '-b:a', '96k',
    '-af', 'silenceremove=start_periods=1:start_threshold=-50dB', `${out}/${name}.mp3`]);
};

for (const [pack, url] of Object.entries(PACKS)) {
  const zip = `${cache}/${pack}.zip`;
  if (existsSync(zip)) continue;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(zip, new Uint8Array(await res.arrayBuffer()));
}
for (const pick of PICKS) {
  const raw = `${cache}/raw/${pick.out}.ogg`;
  writeFileSync(raw, execFileSync('unzip', ['-p', `${cache}/${pick.pack}.zip`, `Audio/${pick.file}.ogg`], { maxBuffer: 16 << 20 }));
  toMp3(raw, pick.out);
}
const RATE = 44100;
for (const name of SYNTH_NAMES) {
  const wav = `${cache}/raw/${name}.wav`;
  writeFileSync(wav, encodeWav(synthesize(name, RATE), RATE));
  toMp3(wav, name);
}

const credits = [
  'Sound effects in this folder',
  '',
  'Recordings: Kenney (www.kenney.nl), licensed CC0 1.0 (public domain):',
  ...PICKS.map((p) => `  ${p.out}.mp3 - ${PACK_NAMES[p.pack]}, ${p.file}.ogg`),
  '',
  'Made in code for this game (src/client/audio/synth.ts):',
  ...SYNTH_NAMES.map((n) => `  ${n}.mp3`),
  '',
];
writeFileSync(`${out}/CREDITS.txt`, credits.join('\n'));

const files = Object.values(SOUNDS).flatMap((s) => s.files);
const total = files.reduce((sum, f) => sum + statSync(`${out}/${f}`).size, 0);
console.log(`${files.length} sound files, ${(total / 1024).toFixed(0)} KB in total`);
