import { h } from './helpers.js';
export function creatorCredit() {
  return h('footer', { class: 'creator-credit' },
    h('img', { src: '/app/icons/palusa-logo.svg', alt: 'PALUSA', width: 192, height: 64 }),
    h('div', null, h('span', null, 'Created by Giovanni Palusa'), h('a', { href: 'https://www.palusa.se', target: '_blank', rel: 'noopener' }, 'www.palusa.se')));
}
