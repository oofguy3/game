import { GAME_NAME } from '../../shared/constants';
import { h } from './dom';

export const LOGO_BLUE = '#3b82f6';
export const LOGO_RED = '#ef4444';

/** The jagged north–south border that splits the globe, top to bottom. */
const BORDER = '50,0 44,12 55,24 45,36 56,48 44,60 55,72 46,84 52,100';
const LEFT = `0,0 ${BORDER} 0,100`;
const RIGHT = `${BORDER.split(' ').reverse().join(' ')} 100,100 100,0`;
/** Lighter land shapes on both halves, so the badge reads as a globe of territories. */
const CONTINENTS = [
  'M18 30C26 22 38 26 40 34C42 42 34 46 30 54C26 62 16 58 14 48C12 40 12 36 18 30Z',
  'M24 70C30 66 38 70 38 78C38 86 30 88 26 84C22 80 20 74 24 70Z',
  'M62 22C72 18 84 24 86 34C88 42 80 46 74 44C68 42 60 40 60 32C60 28 60 24 62 22Z',
  'M64 58C72 54 82 58 84 66C86 74 78 82 70 80C64 78 60 72 60 66C60 62 62 60 64 58Z',
];

/**
 * The badge as SVG markup: a round globe, blue on the left and red on the right, cut by a jagged white border, with
 * lighter continents, faint grid lines and a white rim. The same every time (it is also the tab icon file).
 */
export function badgeSvg(): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '<defs>',
    '<clipPath id="bl-globe"><circle cx="50" cy="50" r="47"/></clipPath>',
    '<radialGradient id="bl-shine" cx="35%" cy="30%" r="75%">',
    '<stop offset="0" stop-color="#fff" stop-opacity="0.35"/>',
    '<stop offset="0.6" stop-color="#fff" stop-opacity="0"/>',
    '<stop offset="1" stop-color="#000" stop-opacity="0.25"/>',
    '</radialGradient>',
    '</defs>',
    '<g clip-path="url(#bl-globe)">',
    `<polygon points="${LEFT}" fill="${LOGO_BLUE}"/>`,
    `<polygon points="${RIGHT}" fill="${LOGO_RED}"/>`,
    ...CONTINENTS.map((d) => `<path d="${d}" fill="#fff" fill-opacity="0.22"/>`),
    '<g fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="1.5">',
    '<ellipse cx="50" cy="50" rx="22" ry="47"/>',
    '<path d="M3 50H97M8 30H92M8 70H92"/>',
    '</g>',
    `<polyline class="border" points="${BORDER}" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`,
    '<circle cx="50" cy="50" r="47" fill="url(#bl-shine)"/>',
    '</g>',
    '<circle cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-width="3"/>',
    '</svg>',
  ].join('');
}

/** The badge next to the BORDERLINE wordmark, in the large (title screen) or small size. */
export function createLogo(size: 'large' | 'small'): HTMLElement {
  const badge = h('span', { class: 'logo-badge' });
  badge.innerHTML = badgeSvg();
  return h('div', { class: `logo logo-${size}`, attrs: { role: 'img', 'aria-label': GAME_NAME } },
    badge, h('span', { class: 'logo-word', text: GAME_NAME.toUpperCase() }));
}
