import { h } from './helpers.js';
export function creatorCredit() {
  return h('footer', { class: 'creator-credit' },
    h('picture', null, h('img', { class: 'palusa-logo light', src: '/app/icons/palusa-logo.svg', alt: 'PALUSA', width: 192, height: 64 }), h('img', { class: 'palusa-logo dark', src: '/app/icons/palusa-logo-white.svg', alt: 'PALUSA', width: 192, height: 64 })),
    h('div', null, h('span', null, 'Created by Giovanni Palusa'), h('a', { href: 'https://www.palusa.se', target: '_blank', rel: 'noopener' }, 'www.palusa.se')));
}


/** The supplied Ram glyph is Screenshot Studio's product signature in PALUSA 3.0. */
export function productMark({ large = false } = {}) {
  return h('span', { class: `product-mark${large ? ' large' : ''}`, title: 'Screenshot Studio · PALUSA', 'aria-hidden': 'true' }, h('img', { src: '/app/icons/palusa-frame.svg', alt: '', width: 30, height: 30 }));
}
