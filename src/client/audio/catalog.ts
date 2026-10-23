/** Every sound the game makes. */
export type SoundName = 'click' | 'place' | 'built' | 'send' | 'thud' | 'horn' | 'jet' | 'boom' | 'landing' | 'refused'
  | 'warning' | 'radar' | 'offer' | 'accepted' | 'declined' | 'betrayal' | 'lost' | 'warStart' | 'knockout' | 'victory'
  | 'defeat';

/**
 * A sound: its files under public/sounds (variants play in turn), its group (`ui` plays even while paused; `alert`
 * plays louder than `action`), the shortest gap between two of it, and its own volume within the group (1 if not set).
 */
export interface SoundSpec {
  files: string[];
  group: 'ui' | 'action' | 'alert';
  gapMs: number;
  volume?: number;
}

const one = (name: string, group: SoundSpec['group'], gapMs = 100): SoundSpec => ({ files: [`${name}.mp3`], group, gapMs });
const many = (name: string, count: number, group: SoundSpec['group'], gapMs: number, volume?: number): SoundSpec =>
  ({ files: Array.from({ length: count }, (_, i) => `${name}-${i}.mp3`), group, gapMs, volume });

export const SOUNDS: Record<SoundName, SoundSpec> = {
  click: one('click', 'ui'),
  place: one('place', 'action'),
  built: one('built', 'action'),
  send: one('send', 'action', 150),
  // land grows in many small steps, so its thud stays soft
  thud: many('thud', 5, 'action', 330, 0.6),
  horn: one('horn', 'action'),
  jet: one('jet', 'action'),
  boom: many('boom', 2, 'action', 150),
  landing: one('landing', 'action'),
  refused: one('refused', 'action'),
  warning: one('warning', 'alert', 2000),
  radar: one('radar', 'alert', 3000),
  offer: one('offer', 'alert'),
  accepted: one('accepted', 'alert'),
  declined: one('declined', 'alert'),
  betrayal: one('betrayal', 'alert'),
  lost: one('lost', 'alert'),
  warStart: one('warStart', 'alert'),
  knockout: one('knockout', 'alert'),
  victory: one('victory', 'alert'),
  defeat: one('defeat', 'alert'),
};
