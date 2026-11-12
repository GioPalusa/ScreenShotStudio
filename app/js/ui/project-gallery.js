import { h, selectInput, toast } from './helpers.js';
import { icon } from './icons.js';
import { productMark } from './brand.js';
import { projectCover } from '../project-cover.js';

const count = (n, singular, plural = singular + 's') => `${n} ${n === 1 ? singular : plural}`;
const edited = value => {
  const date = new Date(value), days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (!Number.isFinite(days)) return 'Saved on your Mac';
  if (days === 0) return 'Edited today';
  if (days === 1) return 'Edited yesterday';
  if (days < 7) return `Edited ${days} days ago`;
  return `Edited ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)}`;
};

export function projectGallery({ desktop, onNew, onOpen }) {
  let projects = [], query = '', sort = 'opened', disposed = false, loading = false, running = 0;
  const records = new Map(), queue = [];
  const grid = h('div', { class: 'home-project-list' });
  const status = h('p', { class: 'hint home-results', role: 'status', 'aria-live': 'polite' });
  const empty = h('div', { class: 'home-empty', hidden: true });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search projects', 'aria-label': 'Search projects', onInput: () => { query = search.value.trim().toLocaleLowerCase(); render(); } });
  const order = selectInput({ value: sort, options: [['opened', 'Last opened'], ['modified', 'Last edited'], ['name', 'Name']], onChange: value => { sort = value; render(); } }); order.setAttribute('aria-label', 'Sort projects');
  const toolbar = h('div', { class: 'home-library-toolbar' }, status, h('div', { class: 'row' }, h('label', { class: 'home-sort' }, 'Sort by', order), h('button', { class: 'btn icon', 'aria-label': 'Refresh projects', title: 'Refresh projects', onClick: () => void refresh() }, '↻')));
  const el = h('section', { class: 'welcome-recent home-projects', 'aria-label': 'Recent projects' }, toolbar, grid, empty);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const record = [...records.values()].find(record => record.button === entry.target);
      if (record) enqueue(record); observer.unobserve(entry.target);
    }
  }, { rootMargin: '200px' }) : null;

  function enqueue(record) { if (record.state !== 'idle') return; record.state = 'queued'; queue.push(record); void pump(); }
  async function pump() {
    if (running >= 2 || disposed) return;
    const record = queue.shift(); if (!record) return;
    running++;
    try {
      if (!record.project.previewURL) throw Error('Open this project to view it');
      const response = await fetch(`${record.project.previewURL}/bundle`);
      if (!response.ok) throw Error('Preview unavailable');
      const cover = await projectCover(await response.json(), `${record.project.previewURL}/project`, { active: () => !disposed && records.get(record.project.path) === record });
      if (!cover) return;
      if (disposed || records.get(record.project.path) !== record) { URL.revokeObjectURL(cover.url); return; }
      record.url = cover.url;
      record.art.replaceChildren(h('img', { src: cover.url, alt: '', draggable: false, class: 'home-cover' }), ...(cover.empty ? [h('span', { class: 'home-cover-note' }, 'Add your first screenshots')] : []));
      record.state = 'ready';
    } catch {
      if (!disposed) { record.art.classList.add('unavailable'); record.art.replaceChildren(icon('photo'), h('span', null, 'Preview unavailable')); record.state = 'failed'; }
    } finally { running--; void pump(); }
  }
  function card(project) {
    let record = records.get(project.path);
    if (record && record.project.modified === project.modified) return record;
    if (record?.url) URL.revokeObjectURL(record.url);
    const art = h('span', { class: 'home-project-art', 'aria-hidden': 'true' }, icon('photo'), h('span', null, 'Loading preview…'));
    const button = h('button', { class: 'home-project', title: project.path, 'aria-label': `Open ${project.name}`, onClick: async () => { try { await desktop.action(`recent:${project.path}`); } catch (error) { toast(error.message, { error: true }); } } },
      art, h('span', { class: 'home-project-info' }, productMark(), h('span', { class: 'home-project-name' }, h('strong', null, project.name), h('span', { class: 'home-project-meta' }, h('time', { datetime: project.modified, title: project.modified }, edited(project.modified)), h('span', { 'aria-hidden': 'true' }, '·'), h('span', null, count(project.screens ?? 0, 'screen'))))));
    record = { project, art, button, state: 'idle' }; records.set(project.path, record);
    return record;
  }
  function render() {
    const matches = projects.filter(p => `${p.name} ${p.path}`.toLocaleLowerCase().includes(query));
    if (sort === 'name') matches.sort((a,b) => a.name.localeCompare(b.name));
    if (sort === 'modified') matches.sort((a,b) => new Date(b.modified) - new Date(a.modified));
    const cards = matches.map(card); grid.replaceChildren(...cards.map(record => record.button));
    for (const record of cards) { if (observer) observer.observe(record.button); else enqueue(record); }
    status.textContent = loading ? 'Loading projects…' : query ? `${count(matches.length, 'project')} matching “${search.value.trim()}”` : `${count(projects.length, 'recent project')}`;
    empty.hidden = loading || !!matches.length;
    if (!matches.length) empty.replaceChildren(icon(query ? 'square.dashed' : 'rectangle.3.group'), h('h2', null, query ? 'No matching projects' : 'A home for your next idea'), h('p', null, query ? 'Try another name, or clear your search to see recent projects.' : 'Create a screenshot project or open an existing .sss file. Your designs will appear here.'),
      query ? h('button', { class: 'btn', onClick: () => { search.value = ''; query = ''; render(); search.focus(); } }, 'Clear search') : h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: onNew }, 'New project…'), h('button', { class: 'btn', onClick: onOpen }, 'Open project…')));
  }
  async function refresh() {
    if (loading) return; loading = true; render();
    try {
      projects = desktop ? await desktop.recentProjects() : [];
      if (disposed) return;
      for (const [folder, record] of records) if (!projects.some(p => p.path === folder)) { if (record.url) URL.revokeObjectURL(record.url); observer?.unobserve(record.button); records.delete(folder); }
    } catch (error) { toast(error.message, { error: true }); }
    finally { loading = false; if (!disposed) render(); }
  }
  function dispose() { disposed = true; observer?.disconnect(); for (const record of records.values()) if (record.url) URL.revokeObjectURL(record.url); }
  window.addEventListener('pagehide', dispose, { once: true });
  void refresh();
  return { el, search, refresh };
}
