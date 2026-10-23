import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOUNDS } from './catalog';
import { SYNTH_NAMES } from './synth';

const dir = new URL('../../../public/sounds/', import.meta.url);
const files = Object.values(SOUNDS).flatMap((s) => s.files);

describe('sound catalogue', () => {
  it('every file in the catalogue exists in public/sounds', () => {
    for (const f of files) expect(existsSync(new URL(f, dir)), f).toBe(true);
  });

  it('all sound files together are under 500 KB', () => {
    const total = files.reduce((sum, f) => sum + statSync(new URL(f, dir)).size, 0);
    expect(total).toBeLessThan(500 * 1024);
  });

  it('credits Kenney', () => {
    expect(readFileSync(new URL('CREDITS.txt', dir), 'utf8')).toMatch(/Kenney/);
  });

  it('keeps the gaps and groups the spec sets', () => {
    expect(SOUNDS.thud.gapMs).toBe(330);
    expect(SOUNDS.warning.gapMs).toBe(2000);
    expect(SOUNDS.radar.gapMs).toBe(3000);
    expect(SOUNDS.boom.gapMs).toBe(150);
    expect(SOUNDS.send.gapMs).toBe(150);
    expect(SOUNDS.built.gapMs).toBe(100);
    expect(SOUNDS.click.group).toBe('ui');
    for (const name of ['warning', 'radar', 'offer', 'accepted', 'declined', 'betrayal', 'lost', 'warStart', 'knockout', 'victory', 'defeat'] as const) {
      expect(SOUNDS[name].group).toBe('alert');
    }
    expect(SOUNDS.thud.files).toHaveLength(5);
    expect(SOUNDS.boom.files).toHaveLength(2);
  });

  it('every sound made in code has a file of the same name', () => {
    for (const name of SYNTH_NAMES) expect(SOUNDS[name].files).toEqual([`${name}.mp3`]);
  });
});
