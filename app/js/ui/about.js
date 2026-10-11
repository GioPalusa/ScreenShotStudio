import { h } from './helpers.js';
import { creatorCredit } from './brand.js';
const version = new URL(location.href).searchParams.get('version');
document.getElementById('root').append(h('img', { class: 'about-app-icon', src: '/app/icons/screenshot-studio.png', alt: '', width: 80, height: 80 }), h('h1', null, 'Screenshot Studio'), h('p', { class: 'hint' }, `Version ${version ?? 'Development'}`), h('p', { class: 'about-description' }, 'Your screenshots. Your colours. Your design.'), creatorCredit());
