import { engine, state, api, checkpoint, saveStudio, flushSaves, emit } from '../store.js';
import { mergeProjectFonts } from '../project-fonts.js';
import { h, modal, toast, selectInput } from './helpers.js';

const encode = async file => {
  if (file.size > 32 * 1024 * 1024) throw Error('Choose a font file smaller than 32 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return btoa(binary);
};
const covers = (font, layer) => font.family === layer.fontFamily && font.style === (layer.figmaText?.italic ? 'italic' : 'normal') && (() => { const [min, max = min] = String(font.weight).split(' ').map(Number); return (layer.weight ?? 400) >= min && (layer.weight ?? 400) <= max; })();

/** Reusable in the Figma preview and for collecting fonts in an existing document. */
export function importFontControls({ active, onChange = () => {}, existing = engine.project?.fonts?.files ?? [], allowReplacement = true }) {
  let fonts = [], required = [], loading = false, cancelled = false, installed = [];
  const replacements=new Map();
  const faceKey=l=>JSON.stringify([l.fontFamily,l.weight??400,Boolean(l.figmaText?.italic)]);
  let reviewDialog=null,refreshReview=()=>{},fileError='';
  const attempted = new Set(), controller = new AbortController();
  const post = body => api('/api/import/fonts', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) });
  const list = h('div'), status = h('p', { class: 'hint', role: 'status' });
  const fallbackRow = h('button', { type:'button', class:'btn', onClick:()=>void reviewMissing() }, 'Resolve missing fonts…');
  const picker = h('input', { type: 'file', accept: '.ttf,.otf', multiple: true, 'aria-label': 'Add font files', onChange: async () => {
    if (!picker.files.length || loading) return;
    let changed = false;
    loading = true; fileError=''; picker.disabled = true; status.textContent = 'Reading font files…'; refreshReview(); onChange();
    try {
      const data = await post({ action: 'inspect', fonts: await Promise.all([...picker.files].map(async file => ({ data: await encode(file) }))) });
      if (!active() || cancelled) return;
      fonts = mergeProjectFonts(fonts, data.fonts); changed = true; status.textContent = 'Font files added. Preview again to check the typography.';
    } catch (error) { if (active()) {fileError=error.message;status.textContent = error.message;} }
    finally { loading = false; picker.disabled = false; picker.value = ''; refresh(); refreshReview(); onChange(changed ? 'fonts' : undefined); }
  } });
  const available = () => mergeProjectFonts(existing, fonts);
  const missing = () => required.filter(layer => !replacements.has(faceKey(layer)) && !installed.includes(layer.fontFamily) && !available().some(font => covers(font, layer)));
  const familyFaces=family=>[...new Map(required.filter(l=>l.fontFamily===family).map(l=>[faceKey(l),l])).values()];
  const faceLabel=l=>`${l.weight??400}${l.figmaText?.italic?' italic':''}`;
  function fontOutcome(family){
    const faces=familyFaces(family),needs=missing().filter(l=>l.fontFamily===family),replaced=faces.filter(l=>replacements.has(faceKey(l)));
    const original=faces.filter(l=>!replacements.has(faceKey(l))),embedded=original.every(l=>available().some(f=>covers(f,l)));
    if(needs.length)return {kind:'missing',label:fonts.length?'Still missing':'Missing',detail:`Needed: ${[...new Set(needs.map(faceLabel))].join(', ')}`};
    if(replaced.length)return {kind:'resolved',label:'Resolved with replacement',detail:[...new Set(replaced.map(l=>replacements.get(faceKey(l))==='system-ui'?'System font':replacements.get(faceKey(l))))].join(', ')};
    return {kind:'resolved',label:embedded?'Original font included':'Available on this Mac',detail:faces.map(faceLabel).join(', ')};
  }
  function familyReport(family){const outcome=fontOutcome(family);return h('div',{class:'font-requirement',dataset:{family,status:outcome.kind}},h('div',null,h('b',null,family),h('div',{class:'hint'},outcome.detail)),h('span',{class:`font-state ${outcome.kind}`},outcome.label));}
  function refresh() {
    list.replaceChildren(...[...new Set(required.map(l=>l.fontFamily))].map(familyReport));
    fallbackRow.hidden = !missing().length;
  }
  async function reviewMissing() {
    if(!missing().length)return true;
    if(reviewDialog)return false;
    return new Promise(resolve=>{
      let choosingReplacement=false;
      const families=[...new Set(missing().map(l=>l.fontFamily))],list=h('div',{class:'missing-font-list','aria-live':'polite'}),uploads=h('div',{class:'font-upload-results','aria-live':'polite'}),count=h('span'),notice=h('p',{class:'hint',role:'status'}),slot=document.createComment('font picker');
      picker.before(slot);picker.classList.add('font-dialog-file');
      const bannerText=h('p'),warningIcon=h('span',{'aria-hidden':'true',class:'font-warning-icon'},'⚠');
      const replacement=selectInput({value:'system-ui',options:[['system-ui','System font']],onChange:()=>{}});replacement.setAttribute('aria-label','Replacement font');
      const replacementSection=h('section',{class:'font-replacement-section'},h('label',{class:'field'},'Replace remaining missing fonts with',replacement));
      const apply=h('button',{class:'btn primary',onClick:()=>{
        if(loading||!active())return;
        if(!choosingReplacement){choosingReplacement=true;refreshReview();replacement.focus();return;}
        for(const layer of missing())replacements.set(faceKey(layer),replacement.value);
        resolve(true);reviewDialog.close();refresh();onChange('fonts');
      }},'Replace fonts…');
      const original=h('button',{class:'btn primary',hidden:true,onClick:()=>{if(loading||!active())return;resolve(true);reviewDialog.close();onChange('fonts');}},'Continue');
      const addFonts=h('button',{type:'button',class:'btn primary',onClick:()=>picker.click()},'Add fonts…');
      refreshReview=()=>{
        const needs=missing();
        bannerText.textContent=needs.length?'This design uses fonts that are unavailable on this Mac.':'All required fonts are now available.';warningIcon.textContent=needs.length?'⚠':'✓';warningIcon.classList.toggle('resolved',!needs.length);
        list.replaceChildren(...families.map(familyReport));
        const selected=replacement.value;replacement.replaceChildren(h('option',{value:'system-ui'},'System font'),...[...new Set([...installed,...available().map(f=>f.family)])].sort().map(f=>h('option',{value:f},f)));replacement.value=[...replacement.options].some(o=>o.value===selected)?selected:'system-ui';replacement.disabled=loading;
        replacementSection.hidden=!needs.length||!allowReplacement||!choosingReplacement;
        count.textContent=`Missing fonts (${new Set(needs.map(l=>l.fontFamily)).size})`;
        apply.textContent=choosingReplacement?'Use replacement':'Replace fonts…';apply.classList.toggle('primary',choosingReplacement);addFonts.classList.toggle('primary',!choosingReplacement);addFonts.disabled=loading;addFonts.hidden=!needs.length;
        uploads.replaceChildren(...fonts.map(font=>{const matches=required.filter(l=>covers(font,l));return h('p',{class:'hint'},`${font.family} · ${String(font.weight).replace(' ','–')} ${font.style} — ${matches.length?'matches '+[...new Set(matches.map(l=>l.fontFamily+' '+faceLabel(l)))].join(', '):'does not match any requested font face'}`);}));
        notice.textContent=fileError|| (loading?'Reading font files…':needs.length?(allowReplacement?'Import the original .ttf or .otf files, or choose a replacement. Text stays editable.':'Import the original .ttf or .otf files to include them in the project.'):'All required fonts are now available.');
        apply.hidden=!needs.length||!allowReplacement;original.hidden=Boolean(needs.length);apply.disabled=original.disabled=loading;
      };
      const body=h('div',{class:'missing-font-dialog'},h('div',{class:'font-warning'},warningIcon,bannerText),h('div',{class:'font-report-head'},count,h('span',null,'Status')),list,h('section',{class:'font-upload-section'},picker,uploads,notice),replacementSection);
      reviewDialog=modal({title:'Missing fonts',body,actions:[apply,h('span',{class:'modal-action-spacer'}),h('button',{class:'btn',onClick:()=>reviewDialog.close()},'Cancel'),addFonts,original],onClose:()=>{picker.classList.remove('font-dialog-file');slot.replaceWith(picker);reviewDialog=null;refreshReview=()=>{};resolve(false);}});
      reviewDialog.el.classList.add('font-resolution-modal');refreshReview();
    });
  }
  const el = h('section', { class: 'import-fonts' }, h('h3', null, 'Fonts'), h('p', { class: 'hint' }, 'Google Fonts are included automatically with their licenses. For other families, add the original .ttf or .otf files that you can embed in this project.'), list, h('label', { class: 'f' }, 'Add font files…', picker), fallbackRow, status);
  return {
    el, get files() { return fonts; }, get ready() { return !loading && !missing().length; },
    get previewFonts() { return mergeProjectFonts(existing, fonts.map(font => ({ ...font, file: `data:font/${font.extension};base64,${font.data}` }))); },
    reviewMissing,
    replaceLayers(layers) { return layers.map(layer=>replacements.has(faceKey(layer))?{...layer,fontFamily:replacements.get(faceKey(layer))}:layer); },
    async resolve(layers) {
      required = layers.filter(l => l.type === 'text' && typeof l.fontFamily==='string' && l.fontFamily && !/^(system-ui|sans-serif|serif|monospace|ui-serif|ui-sans-serif|ui-rounded)$/.test(l.fontFamily)); loading = true; picker.disabled = true; refresh();
      if(!required.length){loading=false;picker.disabled=false;return;}
      try{installed=(await api('/api/fonts')).families??[];}catch{installed=[];}
      const families = [...new Set(required.filter(l=>!replacements.has(faceKey(l))&&!available().some(f=>covers(f,l))).map(l=>l.fontFamily))].filter(f => !attempted.has(f));
      try {
        if (families.length) {
          status.textContent = 'Collecting font files from Google Fonts…'; families.forEach(f => attempted.add(f));
          const data = await post({ action: 'resolve', families });
          if (!active() || cancelled) return;
          fonts = mergeProjectFonts(fonts, data.fonts);
        }
        status.textContent = missing().length ? 'Resolve the missing fonts before continuing.' : 'Required fonts are available. Added font files will travel with the project.';
      } catch (error) { if (active()) { families.forEach(f => attempted.delete(f)); status.textContent = error.message; } }
      finally { loading = false; picker.disabled = false; refresh(); }
    },
    async save() { return fonts.length ? (await post({ action: 'save', fonts })).fonts : []; },
    close() { cancelled = true; controller.abort(); reviewDialog?.close(); },
  };
}

export async function openProjectFonts() {
  const project = engine.project, projectId = state.projectId; let closed = false;
  const active = () => !closed && project === engine.project && projectId === state.projectId;
  const status = h('p', { role: 'status', class: 'hint' });
  const controls = importFontControls({ active, allowReplacement:false, onChange: () => { save.disabled = !controls.ready; } });
  const save = h('button', { class: 'btn primary', disabled: true, onClick: async () => {
    if (!active() || !controls.ready) return; save.disabled = true;
    try {
      const fonts = await controls.save(); if (!active()) return;
      if (fonts.length) { checkpoint(); project.fonts ??= {}; project.fonts.files = mergeProjectFonts(project.fonts.files, fonts); engine.invalidate(); saveStudio(); emit('restored'); await flushSaves(); }
      dialog.close(); toast('Project fonts collected.');
    } catch (error) { if (active()) { status.textContent = error.message; save.disabled = !controls.ready; } }
  } }, 'Save project fonts');
  const dialog = modal({ title: 'Collect project fonts', body: h('div', null, controls.el, status), actions: [h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), save], onClose: () => { closed = true; controls.close(); } });
  const { resolveLayers } = await import('../layouts.js');
  const layers = project.slides.flatMap(slide => Object.keys(project.devices).flatMap(deviceId => project.locales.flatMap(locale => resolveLayers({ project, slide, deviceId, localeId: locale.id }).layers.map(l => ({ ...l, fontFamily: l.fontFamily || engine.fontsFor(locale.id).family || 'system-ui' })))));
  await controls.resolve(layers);
  if (active()) save.disabled = !controls.ready;
}

/** Resolve pasted SVG text before mutating the destination document. */
export async function resolveDesignFonts(layers,active) {
  const controls=importFontControls({active});
  try{
    await controls.resolve(layers);if(!active())return null;
    if(!(await controls.reviewMissing())||!active())return null;
    const fonts=await controls.save();if(!active())return null;
    return {layers:controls.replaceLayers(layers),fonts};
  }finally{controls.close();}
}
