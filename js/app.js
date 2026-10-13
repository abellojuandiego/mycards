// MyCards — estudio médico con tarjetas, repetición espaciada (FSRS-5), exámenes y mazos compartidos.
import * as SRS from './srs.js';
import * as IMP from './importer.js';
const B = window.__MOCK_BACKEND__ || (await import('./backend.js')).default;

// ---------- utilidades ----------
const MIN = 6e4;
const ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...kids) { const e = document.createElement(tag); for (const k in attrs) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v); } for (const c of kids) if (c != null && c !== false) e.append(c); return e; }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function iconBtn(svg, label, fn, title) { const b = el('button', { class: 'iconbtn', type: 'button', title, 'aria-label': label ? null : title, onclick: e => { e.stopPropagation(); fn(); } }); b.innerHTML = svg; if (label) b.append(label); return b; }
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'es');
function toast(msg) { const t = el('div', { class: 'toast', role: 'status', text: msg }); document.body.append(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700); }
function plural(n, s, p) { return n + ' ' + (n === 1 ? s : p); }
const fmtCode = c => c ? c.slice(0, 4) + '-' + c.slice(4) : '';
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function deckLink(code) { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('serie', code); return u.toString(); }
async function copyText(t, msg) { try { await navigator.clipboard.writeText(t); toast(msg || 'Copiado.'); } catch (e) { toast('Cópialo a mano: ' + t); } }
const VIS = {
  private: ['Privado', 'Sólo tú y las personas que agregues por correo. Con el número de serie nadie más puede abrirlo.'],
  link: ['Con número de serie', 'Cualquier persona con cuenta que tenga el número de serie o el enlace puede agregarlo y estudiarlo. No aparece en Explorar.'],
  public: ['Público', 'Además aparece en “Explorar mazos públicos” para que cualquiera lo encuentre.']
};

// ---------- estado ----------
let USER = null, UDOC = { library: [], current: null, settings: {} };
let LISTS = { owned: [], shared: [], saved: [] };
let CUR = null; // {id, meta, cards, loading, canEdit, isOwner, unsub}
let P = emptyP(), ED = emptyED();
let mode = 'decks', EDIT = null, SHARE = null, CS = null, QS = null, OS = null;
const F = { topic: 'all' };
const IMG = {};
let INCOMING = null, installEvt = null;
function emptyP() { return { cards: {}, quiz: {}, wrong: [], newDay: { d: '', n: 0 }, updated: 0 }; }
function emptyED() { return { edits: {}, updated: 0 }; }
function normP(x) { return { cards: x && x.cards || {}, quiz: x && x.quiz || {}, wrong: Array.isArray(x && x.wrong) ? x.wrong : [], newDay: x && x.newDay || { d: '', n: 0 }, updated: x && x.updated || 0 }; }
function normED(x) { return { edits: x && x.edits || {}, updated: x && x.updated || 0 }; }
function opts() { const s = UDOC.settings || {}; return { retention: s.retention || 0.9 }; }
function newPerDay() { const s = UDOC.settings || {}; return s.newPerDay == null ? 20 : s.newPerDay; }

// ---------- guardado ----------
const SAVE = { timers: {}, fns: {}, pending: 0, err: null };
function queueSave(key, fn, delay = 1200) { SAVE.fns[key] = fn; clearTimeout(SAVE.timers[key]); SAVE.timers[key] = setTimeout(() => runSave(key), delay); syncUI(); }
async function runSave(key) { const fn = SAVE.fns[key]; delete SAVE.fns[key]; clearTimeout(SAVE.timers[key]); delete SAVE.timers[key]; if (!fn) return; SAVE.pending++; syncUI();
  try { await fn(); SAVE.err = null; } catch (e) { SAVE.err = e; toast(B.errorMessage(e)); } finally { SAVE.pending--; syncUI(); } }
function flushAll() { for (const k of Object.keys(SAVE.fns)) runSave(k); }
function syncUI() { const s = $('sync'); if (!s) return; const waiting = Object.keys(SAVE.fns).length + SAVE.pending;
  let cls = 'ok', txt = 'Guardado en tu cuenta';
  if (!navigator.onLine) { cls = 'local'; txt = waiting ? 'Sin conexión · se guardará al volver' : 'Sin conexión'; }
  else if (waiting) { cls = 'busy'; txt = 'Guardando…'; } else if (SAVE.err) { cls = 'err'; txt = 'No se pudo guardar'; }
  s.className = 'sync ' + cls; s.querySelector('span').textContent = txt; }
addEventListener('online', syncUI); addEventListener('offline', syncUI);
addEventListener('pagehide', flushAll); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
function saveP() { if (!CUR) return; const id = CUR.id, obj = P; obj.updated = Date.now(); const merge = !!obj._fail;
  queueSave('p:' + id, () => { const { _fail, ...data } = obj; return B.setProgress(id, data, merge); }); }
function saveED() { if (!CUR) return; const id = CUR.id, obj = ED; obj.updated = Date.now(); const merge = !!obj._fail;
  queueSave('e:' + id, () => { const { _fail, ...data } = obj; return B.setEdits(id, data, merge); }, 600); }

// ---------- permisos y mazos ----------
function canEditMeta(m) { if (!m || !USER) return false; return m.owner === USER.uid || (['link', 'public'].includes(m.visibility) && m.anyoneCanEdit) || (USER.emailVerified && (m.editorEmails || []).includes(USER.email)); }
function allDecks() { return [...LISTS.owned, ...LISTS.shared, ...LISTS.saved]; }
function findMeta(id) { return allDecks().find(d => d.id === id) || null; }
const topics = () => (CUR && CUR.meta && CUR.meta.topics) || {};
const topicIds = () => Object.keys(topics()).map(Number).sort((a, b) => a - b);
function topicName(ch) { const t = topics(); return ch != null && t[ch] ? t[ch] : 'Sin tema'; }

// ---------- tarjetas del mazo activo ----------
function applyEd(c) { const e = ED.edits[c.id]; return e ? { ...c, q: e.q, a: e.a, img: Array.isArray(e.img) ? e.img : [], personal: true, oq: c.q, oa: c.a, oimg: c.img || [] } : c; }
function allCards() { if (!CUR) return []; return CUR.cards.slice().sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id).localeCompare(String(b.id))); }
function deckCards() { const list = allCards().filter(c => c.type !== 'mcq').map(c => ({ ...c, img: c.img || [] })); return CUR && CUR.canEdit ? list : list.map(applyEd); }
function deckMcqs() { return allCards().filter(c => c.type === 'mcq' && Array.isArray(c.o)); }
function hasTopics() { return topicIds().length > 0; }
function inFilter(c) { if (!hasTopics() || F.topic === 'all') return true; if (F.topic === 'none') return c.ch == null || !topics()[c.ch]; return c.ch === +F.topic; }
function cards() { return deckCards().filter(inFilter); }
function cardLabel(c) { return hasTopics() ? topicName(c.ch) : CUR.meta.name; }

async function switchDeck(id) {
  flushAll();
  if (CUR && CUR.unsub) CUR.unsub();
  CS = QS = OS = null; EDIT = null; SHARE = null; F.topic = 'all';
  if (!id) { CUR = null; render(); return; }
  const meta = findMeta(id) || await B.getDeck(id).catch(() => null);
  if (!meta) { toast('No se pudo abrir ese mazo: puede que lo hayan borrado o dejado de compartir.'); CUR = null; if (UDOC.current === id) { UDOC.current = null; B.setUserDoc({ current: null }).catch(() => {}); } render(); return; }
  CUR = { id, meta, cards: [], loading: true, canEdit: canEditMeta(meta), isOwner: meta.owner === USER.uid, unsub: null };
  P = emptyP(); ED = emptyED(); render();
  const [p, e] = await Promise.all([B.getProgress(id).catch(() => 'fail'), B.getEdits(id).catch(() => 'fail')]);
  if (!CUR || CUR.id !== id) return;
  P = p === 'fail' ? Object.assign(emptyP(), { _fail: true }) : normP(p); ED = e === 'fail' ? Object.assign(emptyED(), { _fail: true }) : normED(e);
  CUR.unsub = B.watchCards(id, list => { if (!CUR || CUR.id !== id) return; CUR.cards = list; CUR.loading = false; onCardsChanged(); },
    err => { if (!CUR || CUR.id !== id) return; if (err && err.code === 'permission-denied') { toast('Ya no tienes acceso a este mazo.'); switchDeck(null); } else { CUR.loading = false; render(); } });
  if (UDOC.current !== id) { UDOC.current = id; B.setUserDoc({ current: id }).catch(() => {}); }
  render();
}
function onCardsChanged() {
  if (CS) { const map = new Map(deckCards().map(c => [c.id, c])); CS.queue = CS.queue.map(c => map.get(c.id) || c); }
  if (EDIT || SHARE) return;
  if (mode === 'search') { renderResults(); return; }
  render();
}

// ---------- imágenes ----------
function imgEl(id, alt) { const im = el('img', { alt: alt || 'Imagen', loading: 'lazy' });
  const fail = () => { const b = im.closest('.thumb'); if (b) { b.className = 'thumb broken'; b.textContent = 'Imagen no disponible'; } };
  if (IMG[id]) im.src = IMG[id]; else B.getImage(id).then(d => { if (d) { IMG[id] = d; im.src = d; } else fail(); }).catch(fail);
  return im; }
// Las primeras c.qi imágenes van con la pregunta (p. ej., mazos de Anki con imagen en el frente); el resto, con la respuesta.
function qiOf(c) { return c.personal ? 0 : Math.max(0, Math.min(c.qi || 0, (c.img || []).length)); }
function qImgs(c) { return (c.img || []).slice(0, qiOf(c)); }
function aImgs(c) { return (c.img || []).slice(qiOf(c)); }
function imgGrid(ids, small) {
  if (!ids || !ids.length) return null;
  const g = el('div', { class: small ? 'rthumbs' : 'imgs' + (ids.length === 1 ? ' one' : '') });
  ids.forEach((id, i) => g.append(el('button', { class: 'thumb', type: 'button', 'aria-label': 'Ampliar imagen ' + (i + 1), onclick: e => { e.stopPropagation(); openLightbox(id); } }, imgEl(id, 'Imagen ' + (i + 1) + ' de la respuesta'))));
  return g; }
let LB = null;
function openLightbox(id) { closeLightbox(); LB = el('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Imagen ampliada', onclick: closeLightbox }, imgEl(id, 'Imagen ampliada'), el('button', { type: 'button', 'aria-label': 'Cerrar', onclick: closeLightbox }, '×')); document.body.append(LB); }
function closeLightbox() { if (LB) { LB.remove(); LB = null; } }
function readAsDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }
async function compressImage(file) {
  if (file.type === 'image/gif' && file.size < 700000) return { data: await readAsDataURL(file), w: 0, h: 0 };
  const bmp = await createImageBitmap(file);
  let maxDim = 1600, q = 0.82;
  for (let i = 0; i < 7; i++) {
    const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    let data = cv.toDataURL('image/webp', q); if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/jpeg', q);
    if (data.length <= 900000) return { data, w: cv.width, h: cv.height };
    maxDim = Math.round(maxDim * 0.8); q = Math.max(0.6, q - 0.06);
  }
  throw { code: 'too_large' };
}
async function addImages(files) {
  const E = EDIT; if (!E) return;
  const list = [...files].filter(f => f && f.type && f.type.startsWith('image/'));
  if (!list.length) { E.imgErr = 'Elige un archivo de imagen (PNG, JPG, WEBP o GIF).'; render(); return; }
  const room = 12 - E.img.length - E.busy; if (room <= 0) { E.imgErr = 'Máximo 12 imágenes por tarjeta.'; render(); return; }
  if (list.length > room) { list.length = room; E.imgErr = 'Sólo se añadieron ' + room + ': el máximo es 12 imágenes por tarjeta.'; } else E.imgErr = '';
  E.busy += list.length; render();
  for (const f of list) {
    try { const { data, w, h } = await compressImage(f); const id = await B.putImage(data, w, h); IMG[id] = data; E.img.push(id); }
    catch (e) { E.imgErr = e && e.code === 'too_large' ? 'La imagen es demasiado grande incluso comprimida.' : B.errorMessage(e); }
    finally { E.busy--; if (EDIT === E) render(); }
  }
}
document.addEventListener('paste', e => { if (!EDIT) return; const fs = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); addImages(fs); } });

// ---------- edición de tarjetas ----------
function editKind(card) { if (!CUR) return null; if (!card) return CUR.canEdit ? 'remote' : null; return CUR.canEdit ? 'remote' : 'personal'; }
function openEdit(card, returnTo) {
  const kind = editKind(card); if (!kind) return;
  EDIT = { kind, id: card ? card.id : null, q: card ? card.q : '', a: card ? (card.a || '') : '', ch: card ? (card.ch == null ? null : card.ch) : (F.topic !== 'all' && F.topic !== 'none' ? +F.topic : null),
    newTopic: '', addingTopic: false,
    img: card && card.img ? card.img.slice() : [], orig: card && kind === 'personal' ? { q: card.oq || card.q, a: card.oa || card.a, img: (card.oimg || card.img || []).slice() } : null,
    personal: !!(card && card.personal), busy: 0, imgErr: '', err: '', confirmDel: false, returnTo: returnTo || mode };
  if (!['cards', 'search', 'decks'].includes(mode)) mode = 'cards';
  render(); scrollTo({ top: 0, behavior: 'smooth' });
}
function closeEdit() { const r = EDIT ? EDIT.returnTo : 'cards'; EDIT = null; mode = r; render(); }
function topicField(E) {
  const sel = el('select', { id: 'ed-ch' });
  sel.append(new Option('Sin tema', ''));
  for (const id of topicIds()) sel.append(new Option(topics()[id], id));
  sel.append(new Option('+ Nuevo tema…', 'new'));
  sel.value = E.addingTopic ? 'new' : (E.ch == null || !topics()[E.ch] ? '' : String(E.ch));
  sel.addEventListener('change', () => { if (sel.value === 'new') { E.addingTopic = true; render(); setTimeout(() => { const i = $('ed-newtopic'); if (i) i.focus(); }, 0); } else { E.addingTopic = false; E.ch = sel.value === '' ? null : +sel.value; } });
  const f = el('div', { class: 'field' }, el('label', { for: 'ed-ch', text: 'Tema' }), sel);
  if (E.addingTopic) { const i = el('input', { type: 'text', id: 'ed-newtopic', maxlength: '120', placeholder: 'Nombre del tema (p. ej., Nervio laríngeo recurrente)' }); i.value = E.newTopic; i.addEventListener('input', () => E.newTopic = i.value); f.append(i); }
  return f;
}
function editForm() {
  const E = EDIT, isNew = !E.id;
  const box = el('div', { class: 'card' });
  box.append(el('div', { class: 'meta' }, el('span', { class: 'ch', text: (isNew ? 'Nueva tarjeta · ' : 'Editar tarjeta · ') + CUR.meta.name }),
    E.kind === 'personal' ? el('span', { class: 'badge', text: 'Sólo para ti' }) : null));
  const f = el('div', { class: 'form' });
  const qa = el('textarea', { id: 'ed-q', style: 'min-height:80px', maxlength: '5000' }); qa.value = E.q; qa.addEventListener('input', () => E.q = qa.value);
  const aa = el('textarea', { id: 'ed-a', maxlength: '20000' }); aa.value = E.a; aa.addEventListener('input', () => E.a = aa.value);
  f.append(el('div', { class: 'field' }, el('label', { for: 'ed-q', text: 'Pregunta (anverso)' }), qa));
  f.append(el('div', { class: 'field' }, el('label', { for: 'ed-a', text: 'Respuesta (reverso)' }), aa));
  f.append(imgEditor(E));
  if (E.kind === 'remote') f.append(topicField(E));
  if (E.kind === 'personal' && E.personal) f.append(el('div', { class: 'orig' }, el('b', { text: 'Original: ' }), E.orig.q + ' → ' + E.orig.a));
  box.append(f);
  const row = el('div', { class: 'btnrow', style: 'margin-top:14px' },
    el('button', { class: 'b primary', type: 'button', onclick: saveEdit, disabled: E.busy ? true : null }, E.busy ? 'Subiendo imagen…' : (isNew ? 'Añadir tarjeta' : 'Guardar cambios')),
    el('button', { class: 'b', type: 'button', onclick: closeEdit }, 'Cancelar'));
  if (E.kind === 'personal' && E.personal) row.append(el('button', { class: 'b', type: 'button', onclick: () => { delete ED.edits[E.id]; saveED(); refreshQueue(); closeEdit(); } }, 'Restaurar original'));
  if (!isNew && E.kind === 'remote') {
    if (!E.confirmDel) row.append(el('button', { class: 'b danger', type: 'button', onclick: () => { E.confirmDel = true; render(); } }, 'Eliminar tarjeta'));
    else row.append(el('span', { class: 'note', text: CUR.isOwner ? '¿Eliminar esta tarjeta?' : '¿Eliminar esta tarjeta del mazo compartido?' }), el('button', { class: 'b danger', type: 'button', onclick: deleteEdited }, 'Sí, eliminar'));
  }
  box.append(row);
  if (E.err) box.append(el('p', { class: 'note', style: 'color:var(--bad);margin-top:8px', text: E.err }));
  const note = E.kind === 'personal' ? 'No puedes editar este mazo: tus cambios se guardan sólo para ti.'
    : !CUR.isOwner ? 'Estás editando un mazo compartido: los cambios los verán todas las personas que lo usan.' : 'Los cambios se guardan en tu cuenta.';
  box.append(el('p', { class: 'note', style: 'margin-top:10px', text: note }));
  return box;
}
function imgEditor(E) {
  const wrap = el('div', { class: 'field' }, el('label', { text: 'Imágenes de la respuesta' }));
  if (E.img.length || E.busy) {
    const g = el('div', { class: 'imgs edimgs' });
    E.img.forEach((id, i) => g.append(el('div', { class: 'it' },
      el('button', { class: 'thumb', type: 'button', 'aria-label': 'Ampliar imagen ' + (i + 1), onclick: () => openLightbox(id) }, imgEl(id, 'Imagen ' + (i + 1))),
      el('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar imagen ' + (i + 1), title: 'Quitar', onclick: () => { E.img.splice(i, 1); render(); } }, '×'))));
    for (let i = 0; i < E.busy; i++) g.append(el('div', { class: 'busy', text: 'Subiendo…' }));
    wrap.append(g);
  }
  const inp = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, id: 'ed-file' });
  inp.addEventListener('change', () => { addImages(inp.files); inp.value = ''; });
  const dz = el('div', { class: 'dropzone' }, el('button', { class: 'b small', type: 'button', onclick: () => inp.click() }, 'Añadir imagen'),
    el('span', { class: 'note', text: 'Desde el celular puedes tomar una foto o elegirla de tu galería. En computador también puedes arrastrarla o pegarla (Ctrl/⌘ + V).' }), inp);
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addImages(e.dataTransfer.files); });
  wrap.append(dz);
  if (E.imgErr) wrap.append(el('p', { class: 'note', style: 'color:var(--bad)', text: E.imgErr }));
  return wrap;
}
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function saveEdit() {
  const E = EDIT; const q = E.q.trim(), a = E.a.trim();
  if (E.busy) return;
  if (!q || !a) { E.err = 'Escribe la pregunta y la respuesta.'; render(); return; }
  const img = E.img.slice();
  if (E.kind === 'personal') {
    if (q === E.orig.q && a === E.orig.a && sameArr(img, E.orig.img)) delete ED.edits[E.id]; else ED.edits[E.id] = { q, a, img, at: Date.now() };
    saveED();
  } else {
    let ch = E.ch;
    if (E.addingTopic) {
      const name = E.newTopic.trim().slice(0, 120);
      if (!name) { E.err = 'Escribe el nombre del nuevo tema.'; render(); return; }
      const existing = topicIds().find(id => norm(topics()[id]) === norm(name));
      if (existing != null) ch = existing;
      else { ch = (topicIds().length ? Math.max(...topicIds()) : 0) + 1; const t = { ...topics(), [ch]: name }; CUR.meta.topics = t; B.updateDeck(CUR.id, { topics: t, updated: Date.now() }).catch(e => toast(B.errorMessage(e))); }
    }
    const isNew = !E.id; const id = E.id || B.newId();
    const data = { q, a, img }; if (ch != null) data.ch = ch;
    const local = CUR.cards.find(c => c.id === id);
    if (local) { Object.assign(local, data); if (ch == null) delete local.ch; } else CUR.cards.push({ id, ...data, created: Date.now() });
    B.saveCard(CUR.id, id, isNew ? data : { ...data, ch: ch == null ? null : ch }, isNew).catch(e => toast(B.errorMessage(e)));
    if (isNew) { CUR.meta.cardCount = (CUR.meta.cardCount || 0) + 1; if (CS && !CS.cram && newLeft() > 0) CS.queue.push({ id, ...data, img }); }
  }
  refreshQueue(); closeEdit();
}
function deleteEdited() {
  const E = EDIT;
  CUR.cards = CUR.cards.filter(c => c.id !== E.id); B.deleteCard(CUR.id, E.id).catch(e => toast(B.errorMessage(e))); CUR.meta.cardCount = Math.max(0, (CUR.meta.cardCount || 1) - 1);
  if (P.cards[E.id]) { delete P.cards[E.id]; saveP(); }
  if (CS) { CS.queue = CS.queue.filter(c => c.id !== E.id); CS.cur = Math.min(CS.cur, CS.queue.length); }
  closeEdit();
}
function refreshQueue() { if (!CS) return; const map = new Map(deckCards().map(c => [c.id, c])); CS.queue = CS.queue.map(c => map.get(c.id) || c); }

// ---------- render general ----------
const MODES = ['cards', 'quiz', 'open', 'prog', 'decks', 'search', 'account', 'explore'];
function setMode(m) { mode = m; EDIT = null; SHARE = null; render(); scrollTo({ top: 0 }); if (m === 'search') setTimeout(() => { const i = $('search-in'); if (i) i.focus(); }, 0); }
function render() {
  if (!USER) return;
  if (!CUR && ['cards', 'quiz', 'open', 'prog'].includes(mode)) mode = 'decks';
  if (mode === 'search' && !allDecks().length) mode = 'decks';
  $('deck-kicker').textContent = CUR ? 'MyCards · ' + (CUR.isOwner ? 'Mi mazo' : 'Mazo de ' + (CUR.meta.ownerName || 'otra persona')) : 'Estudio médico';
  $('deck-title').textContent = CUR ? CUR.meta.name : 'MyCards';
  document.querySelector('nav.modes').hidden = !CUR;
  document.querySelectorAll('nav.modes button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.mode === mode)));
  $('btn-decks').setAttribute('aria-pressed', String(mode === 'decks' || mode === 'explore')); $('btn-search').setAttribute('aria-pressed', String(mode === 'search')); $('btn-account').setAttribute('aria-pressed', String(mode === 'account'));
  $('btn-search').hidden = !allDecks().length;
  for (const m of MODES) $('panel-' + m).hidden = m !== mode;
  const showFilters = !!(CUR && hasTopics() && ['cards', 'quiz', 'open'].includes(mode) && !EDIT);
  $('filters').hidden = !showFilters; if (showFilters) fillFilters();
  renderBanner();
  ({ cards: renderCards, quiz: renderQuiz, open: renderOpen, prog: renderProg, decks: renderDecks, search: renderSearch, account: renderAccount, explore: renderExplore })[mode]();
  syncUI();
}
function fillFilters() {
  const sc = $('sel-topic'); sc.innerHTML = ''; sc.append(new Option('Todos los temas', 'all'));
  const all = [...deckCards(), ...deckMcqs()];
  for (const id of topicIds()) if (all.some(c => c.ch === id)) sc.append(new Option(topics()[id], id));
  if (all.some(c => c.ch == null || !topics()[c.ch])) sc.append(new Option('Sin tema', 'none'));
  if (![...sc.options].some(o => o.value === String(F.topic))) F.topic = 'all'; sc.value = F.topic;
}
function renderBanner() {
  const b = $('banner'); b.innerHTML = '';
  if (INCOMING) {
    const m = INCOMING; const mine = m.owner === USER.uid;
    b.append(el('div', { class: 'banner info' }, el('div', {}, el('b', { text: '“' + m.name + '”' }), el('span', { text: (mine ? ' · tuyo' : ' de ' + (m.ownerName || 'otra persona')) + ' · ' + plural(m.cardCount || 0, 'tarjeta', 'tarjetas') + ' · N.º ' + fmtCode(m.code) })),
      el('div', { class: 'btnrow' }, el('button', { class: 'b small primary', onclick: async () => { INCOMING = null; await addToLibrary(m); await switchDeck(m.id); setMode('cards'); } }, mine ? 'Abrir' : 'Agregar a mis mazos'),
        el('button', { class: 'b small', onclick: () => { INCOMING = null; render(); } }, 'Ahora no'))));
  }
  if (USER.provider === 'password' && !USER.emailVerified && mode !== 'account') {
    b.append(el('div', { class: 'banner' }, el('span', { text: 'Verifica tu correo para que otras personas puedan compartirte mazos por correo.' }), el('button', { class: 'b small', onclick: () => setMode('account') }, 'Ver cómo')));
  }
}
document.querySelectorAll('nav.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('btn-decks').addEventListener('click', () => setMode(mode === 'decks' && CUR ? 'cards' : 'decks'));
$('btn-search').addEventListener('click', () => setMode(mode === 'search' ? (CUR ? 'cards' : 'decks') : 'search'));
$('btn-account').addEventListener('click', () => setMode(mode === 'account' ? (CUR ? 'cards' : 'decks') : 'account'));
$('sel-topic').addEventListener('change', e => { F.topic = e.target.value; CS = QS = OS = null; render(); });

// ---------- tarjetas: repetición espaciada FSRS ----------
const st = id => SRS.normalize(P.cards[id]);
const isNewCard = id => st(id).st === SRS.NEW;
const today = () => SRS.dayKey(Date.now());
function newSeenToday() { return P.newDay && P.newDay.d === today() ? P.newDay.n : 0; }
function newLeft() { return Math.max(0, newPerDay() - newSeenToday()); }
function dueCards() { const now = Date.now(); return cards().filter(c => P.cards[c.id] && SRS.isDue(P.cards[c.id], now)); }
function newCards() { return cards().filter(c => isNewCard(c.id)); }
function interleave(rev, fresh) { if (!fresh.length) return rev; if (!rev.length) return fresh; const out = []; const every = Math.max(1, Math.round(rev.length / fresh.length)); let fi = 0;
  rev.forEach((c, i) => { out.push(c); if ((i + 1) % every === 0 && fi < fresh.length) out.push(fresh[fi++]); }); while (fi < fresh.length) out.push(fresh[fi++]); return out; }
function startCards(cram, list) {
  if (list || cram) { CS = { queue: shuffle(list || cards()), cur: 0, flipped: false, done: 0, cram: true, fromSearch: !!list }; return; }
  const due = dueCards();
  const learning = due.filter(c => st(c.id).st !== SRS.REVIEW).sort((x, y) => st(x.id).due - st(y.id).due);
  const reviews = shuffle(due.filter(c => st(c.id).st === SRS.REVIEW));
  const fresh = shuffle(newCards()).slice(0, newLeft());
  CS = { queue: [...learning, ...interleave(reviews, fresh)], cur: 0, flipped: false, done: 0, cram: false, fromSearch: false };
}
function compact(c) { const o = { st: c.st, s: +(+c.s).toFixed(4), d: +(+c.d).toFixed(3), due: c.due, last: c.last, reps: c.reps, lapses: c.lapses }; if (c.step) o.step = c.step; return o; }
function grade(c, g) {
  const prev = st(c.id), now = Date.now();
  const next = SRS.schedule(prev, g, now, opts());
  if (prev.st === SRS.NEW) { const d = today(); P.newDay = { d, n: newSeenToday() + 1 }; }
  P.cards[c.id] = compact(next); saveP();
  return next;
}
function rate(g) {
  const c = CS.queue[CS.cur]; const next = grade(c, g);
  if ((next.st === SRS.LEARNING || next.st === SRS.RELEARNING) && next.due <= Date.now() + 20 * MIN) {
    const mins = (next.due - Date.now()) / MIN;
    CS.queue.splice(Math.min(CS.queue.length, mins <= 1.5 ? CS.cur + 4 : CS.queue.length), 0, c);
  }
  CS.done++; CS.cur++; CS.flipped = false; renderCards();
}
const RATES = [[SRS.AGAIN, 'Otra vez', 'r0'], [SRS.HARD, 'Difícil', 'r1'], [SRS.GOOD, 'Bien', 'r2'], [SRS.EASY, 'Fácil', 'r3']];
function rateButtons(card, onRate) {
  const pv = SRS.preview(st(card.id), Date.now(), opts());
  return el('div', { class: 'rate' }, ...RATES.map(([g, t, cl]) => el('button', { class: 'b ' + cl, onclick: () => onRate(g), title: 'Tecla ' + g }, t, el('span', { text: SRS.fmtIvl(pv[g]) }))));
}
function welcome() {
  return el('div', { class: 'card welcome' },
    el('div', { class: 'q', text: 'Bienvenido a MyCards' }),
    el('p', { text: 'Tu cuenta empieza sin mazos. Crea el primero, agrega uno con su número de serie o sube un archivo (Excel, CSV, Quizlet, Anki o JSON).' }),
    el('div', { class: 'btnrow' },
      el('button', { class: 'b primary', onclick: () => { DK.creating = true; DK.adding = false; renderDecks(); setTimeout(() => { const i = $('new-deck'); if (i) i.focus(); }, 0); } }, 'Crear un mazo'),
      el('button', { class: 'b', onclick: () => { DK.adding = true; DK.creating = false; renderDecks(); setTimeout(() => { const i = $('code-in'); if (i) i.focus(); }, 0); } }, 'Agregar con número de serie'),
      el('button', { class: 'b', onclick: () => openImport() }, 'Importar un archivo'),
      el('button', { class: 'b', onclick: () => setMode('explore') }, 'Explorar mazos públicos')));
}
function fmtWhen(t) { const m = Math.round((t - Date.now()) / MIN); if (m < 60) return 'en ' + Math.max(1, m) + ' min'; const h = Math.round(m / 60); if (h < 20) return 'en ' + h + ' h'; return new Date(t).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }); }
function renderCards() {
  const p = $('panel-cards'); p.innerHTML = '';
  if (EDIT) { p.append(editForm()); return; }
  if (CUR.loading) { p.append(el('div', { class: 'card empty', text: 'Cargando tarjetas…' })); return; }
  const list = cards(), total = list.length, due = dueCards().length, nw = Math.min(newCards().length, newLeft()), mature = list.filter(c => SRS.isMature(P.cards[c.id])).length;
  p.append(el('div', { class: 'btnrow', style: 'justify-content:space-between' },
    el('div', { class: 'stats' }, el('span', { class: 'stat' }, 'Para repasar: ', el('b', { text: String(due) })), el('span', { class: 'stat' }, 'Nuevas hoy: ', el('b', { text: String(nw) })),
      el('span', { class: 'stat' }, 'Maduras: ', el('b', { text: mature + '/' + total }))),
    editKind(null) ? iconBtn(ICON_PLUS, 'Nueva tarjeta', () => openEdit(null, 'cards')) : null));
  if (!CS || (CS.cur >= CS.queue.length && CS.done === 0 && !CS.cram)) startCards(false);
  if (CS.cur >= CS.queue.length) {
    const left = newCards().length;
    const msg = !total ? 'Este mazo todavía no tiene tarjetas.' + (editKind(null) ? ' Añade la primera con “Nueva tarjeta”.' : '')
      : CS.done ? '¡Listo por ahora! ' + plural(CS.done, 'respuesta', 'respuestas') + ' en esta sesión.' : 'No tienes tarjetas pendientes en este momento.';
    const nextDue = list.map(c => P.cards[c.id] ? st(c.id).due : Infinity).filter(x => x > Date.now() && x < Infinity).sort((a, b) => a - b)[0];
    p.append(el('div', { class: 'card empty' }, el('p', { text: msg }),
      total && (nextDue || (left && !newLeft())) ? el('p', { class: 'note', text: (nextDue ? 'Próximo repaso: ' + fmtWhen(nextDue) + '. ' : '') + (left && !newLeft() ? 'Ya viste tus ' + newPerDay() + ' tarjetas nuevas de hoy en este mazo.' : '') }) : null,
      el('div', { class: 'btnrow', style: 'justify-content:center;margin-top:12px' },
        total ? el('button', { class: 'b primary', onclick: () => { startCards(false); renderCards(); } }, 'Buscar pendientes') : (editKind(null) ? el('button', { class: 'b primary', onclick: () => openEdit(null, 'cards') }, 'Nueva tarjeta') : null),
        total && left && !newLeft() ? el('button', { class: 'b', onclick: () => { P.newDay = { d: today(), n: newSeenToday() - 10 }; saveP(); startCards(false); renderCards(); } }, '+10 nuevas hoy') : null,
        total ? el('button', { class: 'b', onclick: () => { startCards(true); renderCards(); } }, 'Repaso libre') : null)));
    return;
  }
  const c = CS.queue[CS.cur]; const s = st(c.id);
  const right = el('span', { class: 'btnrow', style: 'gap:8px' }, c.personal ? el('span', { class: 'badge', text: 'Editada' }) : null,
    c.img && c.img.length ? el('span', { class: 'badge teal', text: plural(c.img.length, 'imagen', 'imágenes') }) : null,
    el('span', { text: SRS.stateLabel(s).replace('Para hoy', 'Repaso').replace(/^Repaso en.*/, 'Repaso anticipado') + ' · ' + (CS.cur + 1) + '/' + CS.queue.length }), iconBtn(ICON_EDIT, 'Editar', () => openEdit(c, 'cards')));
  const card = el('div', { class: 'card flip', tabindex: CS.flipped ? null : '0', role: CS.flipped ? null : 'button', 'aria-label': CS.flipped ? null : 'Mostrar respuesta', onclick: () => { if (!CS.flipped) { CS.flipped = true; renderCards(); } } },
    el('div', { class: 'meta' }, el('span', { class: 'ch', text: cardLabel(c) }), right), el('div', { class: 'q', text: c.q }), imgGrid(qImgs(c)),
    CS.flipped ? el('div', {}, el('div', { class: 'a', text: c.a }), imgGrid(aImgs(c))) : el('div', { class: 'hint', text: 'Piensa la respuesta y toca la tarjeta para verla.' }));
  p.append(el('div', { class: 'progressbar' }, el('i', { style: 'width:' + Math.round(100 * CS.cur / CS.queue.length) + '%' })), card);
  if (CS.flipped) p.append(rateButtons(c, rate));
  else p.append(el('div', { class: 'btnrow' }, el('button', { class: 'b primary', onclick: () => { CS.flipped = true; renderCards(); } }, 'Mostrar respuesta'),
    !CS.cram ? el('button', { class: 'b', onclick: () => { startCards(true); renderCards(); } }, 'Repaso libre') : el('button', { class: 'b', onclick: () => { startCards(false); renderCards(); } }, 'Volver a pendientes')));
  if (CS.cram) p.append(el('p', { class: 'note', text: CS.fromSearch ? 'Estás repasando los resultados de una búsqueda. Tus calificaciones también ajustan la programación.' : 'Repaso libre: tarjetas al azar, aunque no les toque. Tus calificaciones también ajustan la programación.' }));
  p.append(el('p', { class: 'note hide-touch', text: 'Atajos: Espacio para voltear, 1-4 para calificar (Otra vez, Difícil, Bien, Fácil), E para editar.' }));
}

// ---------- examen (preguntas de opción múltiple del mazo) ----------
function mcqs() { return deckMcqs().filter(inFilter); }
function startQuiz(n, onlyWrong) { let pool = mcqs(); if (onlyWrong) pool = pool.filter(q => P.wrong.includes(q.id)); pool = shuffle(pool); if (n) pool = pool.slice(0, n); QS = { qs: pool.map(q => ({ ...q, order: shuffle(q.o.map((_, i) => i)) })), i: 0, answers: [], picked: null }; }
function pick(idx) { if (QS.picked !== null) return; const q = QS.qs[QS.i]; QS.picked = idx; const ok = idx === q.k; QS.answers.push({ q, ok });
  const key = q.ch == null ? 'none' : String(q.ch); const cs = P.quiz[key] || [0, 0]; P.quiz[key] = [cs[0] + (ok ? 1 : 0), cs[1] + 1];
  if (ok) P.wrong = P.wrong.filter(x => x !== q.id); else if (!P.wrong.includes(q.id)) P.wrong.push(q.id); saveP(); renderQuiz(); }
function renderQuiz() {
  const p = $('panel-quiz'); p.innerHTML = '';
  if (!deckMcqs().length) { p.append(el('div', { class: 'card empty' }, el('p', { text: 'Este mazo no tiene preguntas de opción múltiple.' }), el('p', { class: 'note', text: 'Usa Tarjetas o Pregunta abierta. El mazo de Laringología importado desde Claude trae su examen.' }))); return; }
  const avail = mcqs().length, wr = mcqs().filter(q => P.wrong.includes(q.id)).length;
  if (!QS) { p.append(el('div', { class: 'card' }, el('div', { class: 'meta' }, el('span', { class: 'ch', text: F.topic !== 'all' ? topicName(F.topic === 'none' ? null : +F.topic) : 'Todos los temas' })),
      el('div', { class: 'q', text: 'Examen de opción múltiple' }), el('p', { text: avail + ' preguntas disponibles aquí. Cada respuesta muestra la explicación; las que falles quedan guardadas para repetirlas.' }),
      el('div', { class: 'btnrow' }, el('button', { class: 'b primary', onclick: () => { startQuiz(10); renderQuiz(); }, disabled: !avail }, '10 preguntas'), el('button', { class: 'b', onclick: () => { startQuiz(20); renderQuiz(); }, disabled: !avail }, '20 preguntas'),
        el('button', { class: 'b', onclick: () => { startQuiz(0); renderQuiz(); }, disabled: !avail }, 'Todas (' + avail + ')'), el('button', { class: 'b', onclick: () => { startQuiz(0, true); renderQuiz(); }, disabled: !wr }, 'Repetir falladas (' + wr + ')')))); return; }
  if (QS.i >= QS.qs.length) {
    const ok = QS.answers.filter(a => a.ok).length, n = QS.answers.length, pct = n ? Math.round(100 * ok / n) : 0;
    p.append(el('div', { class: 'card' }, el('div', { class: 'meta' }, el('span', { class: 'ch', text: 'Resultado' })), el('div', { class: 'q', text: ok + ' de ' + n + ' correctas (' + pct + ' %)' }), el('div', { class: 'progressbar' }, el('i', { style: 'width:' + pct + '%' }))));
    const wrongs = QS.answers.filter(a => !a.ok);
    if (wrongs.length) { const ul = el('ul', { class: 'wronglist' }); wrongs.forEach(a => ul.append(el('li', {}, el('div', { text: a.q.q }), el('div', {}, 'Correcta: ', el('b', { text: a.q.o[a.q.k] })), a.q.e ? el('div', { class: 'note', text: a.q.e }) : null))); p.append(el('h3', { text: 'Para repasar' }), ul); }
    p.append(el('div', { class: 'btnrow' }, el('button', { class: 'b primary', onclick: () => { QS = null; renderQuiz(); } }, 'Otro examen'), wrongs.length ? el('button', { class: 'b', onclick: () => { startQuiz(0, true); renderQuiz(); } }, 'Repetir falladas') : null)); return; }
  const q = QS.qs[QS.i];
  p.append(el('div', { class: 'progressbar' }, el('i', { style: 'width:' + Math.round(100 * QS.i / QS.qs.length) + '%' })));
  const box = el('div', { class: 'opts' });
  q.order.forEach((oi, pos) => { let cls = 'opt'; if (QS.picked !== null) { if (oi === q.k) cls += ' right'; else if (oi === QS.picked) cls += ' wrong'; }
    const b = el('button', { class: cls, onclick: () => pick(oi) }, el('span', { class: 'k', text: 'ABCDEFGH'[pos] }), el('span', { text: q.o[oi] })); if (QS.picked !== null) b.disabled = true; box.append(b); });
  const card = el('div', { class: 'card' }, el('div', { class: 'meta' }, el('span', { class: 'ch', text: hasTopics() ? topicName(q.ch) : CUR.meta.name }), el('span', { text: 'Pregunta ' + (QS.i + 1) + ' de ' + QS.qs.length })), el('div', { class: 'q', text: q.q }), box);
  if (QS.picked !== null) card.append(el('div', { class: 'expl' }, el('b', { text: QS.picked === q.k ? 'Correcto. ' : 'Incorrecto. ' }), q.e || ''));
  p.append(card);
  if (QS.picked !== null) p.append(el('div', { class: 'btnrow' }, el('button', { class: 'b primary', onclick: () => { QS.i++; QS.picked = null; renderQuiz(); } }, QS.i + 1 < QS.qs.length ? 'Siguiente' : 'Ver resultado')));
}

// ---------- pregunta abierta (autoevaluación) ----------
function newOpen() { const pool = cards(); OS = { card: pool.length ? pool[Math.floor(Math.random() * pool.length)] : null, answer: '', shown: false, rated: false }; }
function renderOpen() {
  const p = $('panel-open'); p.innerHTML = '';
  if (!OS) newOpen();
  if (!OS.card) { p.append(el('div', { class: 'card empty', text: 'No hay tarjetas aquí todavía.' })); return; }
  const c = OS.card;
  const card = el('div', { class: 'card' }, el('div', { class: 'meta' }, el('span', { class: 'ch', text: cardLabel(c) }), el('span', { text: 'Responde con tus palabras' })), el('div', { class: 'q', text: c.q }), imgGrid(qImgs(c)));
  const ta = el('textarea', { id: 'open-ans', placeholder: 'Escribe tu respuesta como la dirías en el examen oral…', 'aria-label': 'Tu respuesta' }); ta.value = OS.answer; ta.addEventListener('input', () => OS.answer = ta.value);
  card.append(ta);
  if (!OS.shown) card.append(el('div', { class: 'btnrow', style: 'margin-top:12px' }, el('button', { class: 'b primary', onclick: () => { OS.shown = true; renderOpen(); } }, 'Comparar con la respuesta'), el('button', { class: 'b', onclick: () => { newOpen(); renderOpen(); } }, 'Otra pregunta')));
  else {
    card.append(el('div', { class: 'expl', style: 'margin-top:14px' }, el('b', { text: 'Respuesta de la tarjeta: ' }), c.a));
    const g = imgGrid(aImgs(c)); if (g) card.append(g);
    if (!OS.rated) card.append(el('p', { class: 'note', style: 'margin-top:12px', text: '¿Cómo te fue? Tu calificación programa el próximo repaso de esta tarjeta.' }), el('div', { style: 'margin-top:8px' }, rateButtons(c, g => { grade(c, g); OS.rated = true; renderOpen(); })));
    card.append(el('div', { class: 'btnrow', style: 'margin-top:12px' }, el('button', { class: OS.rated ? 'b primary' : 'b', onclick: () => { newOpen(); renderOpen(); } }, 'Otra pregunta')));
  }
  p.append(card);
}

// ---------- progreso ----------
let confirmReset = false;
function renderProg() {
  const p = $('panel-prog'); p.innerHTML = '';
  const now = Date.now(), all = deckCards();
  const mature = all.filter(c => SRS.isMature(P.cards[c.id])).length, due = all.filter(c => P.cards[c.id] && SRS.isDue(P.cards[c.id], now)).length;
  const seen = all.filter(c => !isNewCard(c.id)); const rs = seen.map(c => SRS.currentR(P.cards[c.id], now)).filter(x => x != null);
  const avgR = rs.length ? Math.round(100 * rs.reduce((a, b) => a + b, 0) / rs.length) : null;
  let qok = 0, qn = 0; for (const k in P.quiz) { qok += P.quiz[k][0]; qn += P.quiz[k][1]; }
  p.append(el('div', { class: 'summary' },
    el('div', { class: 'tile' }, el('b', { text: seen.length + '/' + all.length }), el('span', { text: 'tarjetas estudiadas' })),
    el('div', { class: 'tile' }, el('b', { text: String(mature) }), el('span', { text: 'maduras (estabilidad ≥ 21 días)' })),
    el('div', { class: 'tile' }, el('b', { text: avgR == null ? '—' : avgR + ' %' }), el('span', { text: 'retención estimada hoy' })),
    el('div', { class: 'tile' }, el('b', { text: String(due) }), el('span', { text: 'para repasar ahora' })),
    deckMcqs().length ? el('div', { class: 'tile' }, el('b', { text: qn ? Math.round(100 * qok / qn) + ' %' : '—' }), el('span', { text: 'aciertos en examen (' + qn + ')' })) : null));
  if (hasTopics()) {
    const tb = el('tbody'); const mq = deckMcqs();
    const rows = [...topicIds().map(id => [id, topics()[id]]), [null, 'Sin tema']];
    for (const [id, name] of rows) {
      const match = c => id == null ? (c.ch == null || !topics()[c.ch]) : c.ch === id;
      const cs = all.filter(match); if (!cs.length && !mq.some(match)) continue;
      const m = cs.filter(c => SRS.isMature(P.cards[c.id])).length, sn = cs.filter(c => !isNewCard(c.id)).length, d = cs.filter(c => P.cards[c.id] && SRS.isDue(P.cards[c.id], now)).length;
      const qq = P.quiz[id == null ? 'none' : String(id)]; const pct = qq && qq[1] ? Math.round(100 * qq[0] / qq[1]) : null;
      tb.append(el('tr', {}, el('td', { text: name }), el('td', {}, el('div', { class: 'mini' }, el('div', { class: 'progressbar' }, el('i', { style: 'width:' + (cs.length ? Math.round(100 * sn / cs.length) : 0) + '%' })), el('span', { class: 'num', text: sn + '/' + cs.length }))),
        el('td', { class: 'num', text: String(m) }), el('td', { class: 'num', text: String(d) }), el('td', { class: 'num', text: pct === null ? '—' : pct + ' % (' + qq[1] + ')' })));
    }
    p.append(el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Tema' }), el('th', { text: 'Estudiadas' }), el('th', { text: 'Maduras' }), el('th', { text: 'Ahora' }), el('th', { text: 'Examen' }))), tb)));
  }
  p.append(el('p', { class: 'note', text: 'Programación FSRS-5 con retención deseada del ' + Math.round(opts().retention * 100) + ' % y ' + (newPerDay() >= 9999 ? 'sin límite de' : newPerDay()) + ' tarjetas nuevas por día. Puedes ajustarlo en Cuenta.' }));
  const row = el('div', { class: 'btnrow' });
  if (!confirmReset) row.append(el('button', { class: 'b danger', onclick: () => { confirmReset = true; renderProg(); } }, 'Borrar mi progreso en este mazo'));
  else row.append(el('span', { class: 'note', text: '¿Seguro? Se borran tus repasos y resultados de examen de este mazo. Las tarjetas se conservan.' }),
    el('button', { class: 'b danger', onclick: () => { P = emptyP(); saveP(); confirmReset = false; CS = QS = OS = null; renderProg(); } }, 'Sí, borrar'),
    el('button', { class: 'b', onclick: () => { confirmReset = false; renderProg(); } }, 'Cancelar'));
  p.append(row);
}

// ---------- mis mazos ----------
const DK = { creating: false, newName: '', newVis: 'private', adding: false, code: '', found: null, findErr: '', finding: false, renaming: null, renameVal: '', confirmDel: null, busy: null };
async function loadLists() {
  const [o, s] = await Promise.all([B.listOwnedDecks().catch(() => []), B.listSharedDecks(USER.emailVerified ? USER.email : '').catch(() => [])]);
  LISTS.owned = o.sort(byName); LISTS.shared = s.filter(d => d.owner !== USER.uid).sort(byName);
  const lib = (UDOC.library || []).filter(id => !o.some(d => d.id === id) && !s.some(d => d.id === id));
  const saved = await Promise.all(lib.map(id => B.getDeck(id).catch(() => null)));
  LISTS.saved = saved.filter(Boolean).sort(byName);
}
async function addToLibrary(m) {
  if (m.owner === USER.uid || LISTS.shared.some(d => d.id === m.id)) return;
  if (!(UDOC.library || []).includes(m.id)) { UDOC.library = [...(UDOC.library || []), m.id]; B.setUserDoc({ library: UDOC.library }).catch(() => {}); }
  if (!LISTS.saved.some(d => d.id === m.id)) { LISTS.saved.push(m); LISTS.saved.sort(byName); }
}
function removeFromLibrary(id) { UDOC.library = (UDOC.library || []).filter(x => x !== id); B.setUserDoc({ library: UDOC.library }).catch(() => {}); LISTS.saved = LISTS.saved.filter(d => d.id !== id); if (CUR && CUR.id === id) switchDeck(null); else renderDecks(); }
function newDeckData(name, extra = {}) { const now = Date.now(); const d = { name: String(name).slice(0, 100), owner: USER.uid, ownerName: USER.name.slice(0, 120), visibility: 'private', anyoneCanEdit: false, sharedWith: [], editorEmails: [], cardCount: 0, created: now, updated: now, ...extra }; for (const k in d) if (d[k] === undefined) delete d[k]; return d; }
async function createDeck() {
  const name = DK.newName.trim().slice(0, 100); if (!name) { const i = $('new-deck'); if (i) i.focus(); return; }
  DK.busy = 'new'; renderDecks();
  try { const data = newDeckData(name, { visibility: DK.newVis }); const { id, code } = await B.createDeck(data);
    LISTS.owned.push({ id, ...data, code }); LISTS.owned.sort(byName); DK.newName = ''; DK.creating = false; DK.busy = null; DK.newVis = 'private';
    await switchDeck(id); setMode('cards'); toast('Mazo creado · N.º de serie ' + fmtCode(code)); }
  catch (e) { DK.busy = null; toast(B.errorMessage(e)); renderDecks(); }
}
async function findCode() {
  const code = cleanCode(DK.code); DK.found = null; DK.findErr = '';
  if (code.length !== 8) { DK.findErr = 'El número de serie tiene 8 caracteres (por ejemplo, K7QP-3XMA).'; renderDecks(); return; }
  DK.finding = true; renderDecks();
  try {
    const r = await B.findByCode(code);
    if (!r) DK.findErr = 'No existe ningún mazo con ese número de serie. Revisa que esté bien escrito.';
    else if (!r.deck) DK.findErr = 'Ese mazo es privado. Pídele a su dueño que lo cambie a “Con número de serie” o que te agregue con tu correo.';
    else DK.found = r.deck;
  } catch (e) { DK.findErr = B.errorMessage(e); }
  DK.finding = false; renderDecks();
}
async function duplicateDeck(m) {
  DK.busy = 'dup:' + m.id; render();
  let newId = null, newCode = null;
  try {
    const list = await B.listCards(m.id); const ed = canEditMeta(m) ? { edits: {} } : normED(await B.getEdits(m.id).catch(() => null));
    const src = list.map(c => { const e = ed.edits[c.id]; return e ? { ...c, q: e.q, a: e.a, img: e.img || [] } : c; }).filter(c => c.q && (c.a || c.type === 'mcq'));
    const data = newDeckData(String(m.name).slice(0, 100) + ' (copia)', { topics: m.topics, description: m.description ? String(m.description).slice(0, 1000) : undefined });
    const { id, code } = await B.createDeck(data); newId = id; newCode = code;
    const cs = src.map(c => ({ id: c.id, q: String(c.q).slice(0, 5000), a: c.a == null ? undefined : String(c.a).slice(0, 20000), img: (c.img || []).slice(0, 12), qi: c.qi, ch: c.ch == null ? null : c.ch, type: c.type, o: c.o, k: c.k, e: c.e, created: c.created }));
    const counts = { cards: cs.filter(c => c.type !== 'mcq').length, questions: cs.filter(c => c.type === 'mcq').length };
    await B.addCards(id, cs, counts);
    const prog = await B.getProgress(m.id).catch(() => null); if (prog && prog.cards) await B.setProgress(id, { ...normP(prog), updated: Date.now() });
    LISTS.owned.push({ id, ...data, code, cardCount: counts.cards, qCount: counts.questions }); LISTS.owned.sort(byName); DK.busy = null;
    toast('Copia creada: ahora es tuya. N.º de serie ' + fmtCode(code)); await switchDeck(id); setMode('decks');
  } catch (e) { if (newId) B.deleteDeck(newId, newCode).catch(() => {}); DK.busy = null; toast(B.errorMessage(e)); render(); }
}
async function deleteDeck(m) {
  DK.busy = 'del:' + m.id; renderDecks();
  try { await B.deleteDeck(m.id, m.code); B.deleteProgress(m.id).catch(() => {}); LISTS.owned = LISTS.owned.filter(d => d.id !== m.id); DK.confirmDel = null; DK.busy = null; if (CUR && CUR.id === m.id) await switchDeck(null); render(); toast('Mazo eliminado.'); }
  catch (e) { DK.busy = null; toast(B.errorMessage(e)); renderDecks(); }
}
function doRename(m) { const name = DK.renameVal.trim().slice(0, 100); if (!name) return; DK.renaming = null; m.name = name; render(); B.updateDeck(m.id, { name, updated: Date.now() }).catch(e => toast(B.errorMessage(e))); }
function serialRow(m) { return m.code ? el('div', { class: 'serial' }, el('span', { class: 'lbl', text: 'N.º de serie' }), el('code', { text: fmtCode(m.code) }), iconBtn(ICON_COPY, '', () => copyText(fmtCode(m.code), 'Número de serie copiado.'), 'Copiar número de serie')) : null; }
function deckBox(m, kind) {
  const cur = CUR && m.id === CUR.id, editable = canEditMeta(m), busy = DK.busy && DK.busy.endsWith(m.id);
  const kicker = kind === 'owned' ? VIS[m.visibility || 'private'][0] + ((m.sharedWith || []).length ? ' · compartido' : '') : 'De ' + (m.ownerName || 'otra persona');
  const box = el('div', { class: 'deck' + (cur ? ' current' : '') }, el('span', { class: 'kind', text: kicker + (cur ? ' · activo' : '') }));
  if (DK.renaming === m.id) { const inp = el('input', { type: 'text', id: 'rn-' + m.id, maxlength: '100', 'aria-label': 'Nuevo nombre' }); inp.value = DK.renameVal; inp.addEventListener('input', () => DK.renameVal = inp.value); inp.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(m); });
    box.append(inp, el('div', { class: 'btnrow' }, el('button', { class: 'b small primary', onclick: () => doRename(m) }, 'Guardar'), el('button', { class: 'b small', onclick: () => { DK.renaming = null; renderDecks(); } }, 'Cancelar'))); }
  else box.append(el('h3', { text: m.name }));
  const n = cur && !CUR.loading ? deckCards().length : (m.cardCount || 0); const nq = cur && !CUR.loading ? deckMcqs().length : (m.qCount || 0);
  box.append(el('div', { class: 'pills' }, el('span', { class: 'pill', text: plural(n, 'tarjeta', 'tarjetas') }), nq ? el('span', { class: 'pill', text: plural(nq, 'pregunta', 'preguntas') + ' de examen' }) : null,
    kind !== 'owned' ? el('span', { class: 'pill ' + (editable ? 'ok' : ''), text: editable ? 'Puedes editar' : 'Sólo lectura' }) : null,
    kind === 'owned' && m.visibility !== 'private' && m.anyoneCanEdit ? el('span', { class: 'pill', text: 'Todos pueden editar' }) : null,
    kind === 'owned' && (m.editorEmails || []).length ? el('span', { class: 'pill', text: plural(m.editorEmails.length, 'editor', 'editores') }) : null));
  if (m.description) box.append(el('p', { class: 'note', text: m.description }));
  const sr = serialRow(m); if (sr) box.append(sr);
  const row = el('div', { class: 'btnrow' }, el('button', { class: 'b small primary', onclick: async () => { if (!cur) await switchDeck(m.id); setMode('cards'); } }, cur ? 'Estudiar' : 'Abrir y estudiar'));
  if (editable) row.append(el('button', { class: 'b small', onclick: async () => { if (!cur) await switchDeck(m.id); mode = 'decks'; openEdit(null, 'decks'); } }, 'Añadir tarjeta'));
  if (kind === 'owned') row.append(el('button', { class: 'b small', onclick: () => openShare(m) }, 'Compartir'));
  row.append(el('button', { class: 'b small', disabled: busy ? true : null, onclick: () => duplicateDeck(m) }, DK.busy === 'dup:' + m.id ? 'Duplicando…' : 'Duplicar'));
  row.append(el('button', { class: 'b small', disabled: busy ? true : null, title: 'Descargar el mazo como archivo JSON de MyCards', onclick: () => exportDeck(m) }, DK.busy === 'exp:' + m.id ? 'Exportando…' : 'Exportar'));
  if (kind === 'owned' && DK.renaming !== m.id) { row.append(el('button', { class: 'b small', onclick: () => { DK.renaming = m.id; DK.renameVal = m.name; renderDecks(); setTimeout(() => { const i = $('rn-' + m.id); if (i) i.focus(); }, 0); } }, 'Renombrar'));
    if (DK.confirmDel !== m.id) row.append(el('button', { class: 'b small danger', onclick: () => { DK.confirmDel = m.id; renderDecks(); } }, 'Eliminar')); }
  if (kind === 'saved') row.append(el('button', { class: 'b small', onclick: () => removeFromLibrary(m.id) }, 'Quitar'));
  box.append(row);
  if (DK.confirmDel === m.id) box.append(el('div', { class: 'btnrow' }, el('span', { class: 'note', text: 'Se eliminará el mazo y sus tarjetas para todas las personas que lo usan. El número de serie dejará de funcionar.' }),
    el('button', { class: 'b small danger', disabled: busy ? true : null, onclick: () => deleteDeck(m) }, DK.busy === 'del:' + m.id ? 'Eliminando…' : 'Sí, eliminar'), el('button', { class: 'b small', onclick: () => { DK.confirmDel = null; renderDecks(); } }, 'Cancelar')));
  return box;
}
function visChoices(val, onPick, name) {
  return Object.keys(VIS).map(k => el('label', { class: 'choice' + (val === k ? ' on' : '') }, el('input', { type: 'radio', name, value: k, checked: val === k ? true : null, onchange: () => onPick(k) }), el('div', {}, el('b', { text: VIS[k][0] }), el('span', { class: 'note', text: VIS[k][1] }))));
}
function renderDecks() {
  const p = $('panel-decks'); p.innerHTML = '';
  if (EDIT) { p.append(editForm()); return; }
  if (SHARE) { p.append(shareForm()); return; }
  const none = !allDecks().length;
  if (none && !DK.creating && !DK.adding && !IM.open) { p.append(welcome()); return; }
  p.append(el('div', { class: 'btnrow', style: 'justify-content:space-between' }, el('h2', { class: 'h2', text: 'Mis mazos' }),
    el('div', { class: 'btnrow' }, el('button', { class: 'b small primary', onclick: () => { DK.creating = !DK.creating; DK.adding = false; IM.open = false; renderDecks(); setTimeout(() => { const i = $('new-deck'); if (i) i.focus(); }, 0); } }, 'Nuevo mazo'),
      el('button', { class: 'b small', onclick: () => { DK.adding = !DK.adding; DK.creating = false; IM.open = false; renderDecks(); setTimeout(() => { const i = $('code-in'); if (i) i.focus(); }, 0); } }, 'Agregar con n.º de serie'),
      el('button', { class: 'b small', onclick: () => { IM.open ? closeImport() : openImport(); } }, 'Importar archivo'),
      el('button', { class: 'b small', onclick: () => setMode('explore') }, 'Explorar públicos'))));
  if (DK.creating) {
    const inp = el('input', { type: 'text', id: 'new-deck', maxlength: '100', placeholder: 'Nombre del mazo (p. ej., Rinología)', 'aria-label': 'Nombre del nuevo mazo' }); inp.value = DK.newName;
    inp.addEventListener('input', () => DK.newName = inp.value); inp.addEventListener('keydown', e => { if (e.key === 'Enter') createDeck(); });
    p.append(el('div', { class: 'card', style: 'padding:16px' }, el('div', { class: 'form', style: 'margin-top:0' },
      el('div', { class: 'field' }, el('label', { for: 'new-deck', text: 'Nuevo mazo' }), inp),
      el('div', { class: 'field' }, el('label', { text: '¿Quién puede verlo?' }), ...visChoices(DK.newVis, v => { DK.newVis = v; renderDecks(); }, 'newvis'))),
      el('div', { class: 'btnrow', style: 'margin-top:12px' }, el('button', { class: 'b small primary', disabled: DK.busy === 'new' ? true : null, onclick: createDeck }, DK.busy === 'new' ? 'Creando…' : 'Crear mazo'), el('button', { class: 'b small', onclick: () => { DK.creating = false; renderDecks(); } }, 'Cancelar')),
      el('p', { class: 'note', style: 'margin-top:8px', text: 'Cada mazo recibe un número de serie único al crearse. Puedes cambiar quién lo ve cuando quieras desde “Compartir”.' })));
  }
  if (IM.open) p.append(importPanel());
  if (DK.adding) {
    const inp = el('input', { type: 'text', id: 'code-in', maxlength: '12', placeholder: 'Ej.: K7QP-3XMA', 'aria-label': 'Número de serie', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', class: 'codein' }); inp.value = DK.code;
    inp.addEventListener('input', () => { DK.code = inp.value; }); inp.addEventListener('keydown', e => { if (e.key === 'Enter') findCode(); });
    const box = el('div', { class: 'card', style: 'padding:16px' }, el('div', { class: 'field' }, el('label', { for: 'code-in', text: 'Agregar un mazo con su número de serie' }),
      el('div', { class: 'addrow' }, inp, el('button', { class: 'b small primary', disabled: DK.finding ? true : null, onclick: findCode }, DK.finding ? 'Buscando…' : 'Buscar'), el('button', { class: 'b small', onclick: () => { DK.adding = false; DK.found = null; DK.findErr = ''; renderDecks(); } }, 'Cerrar'))));
    if (DK.findErr) box.append(el('p', { class: 'note', style: 'color:var(--bad);margin-top:8px', text: DK.findErr }));
    if (DK.found) { const m = DK.found; const mine = m.owner === USER.uid; const have = mine || allDecks().some(d => d.id === m.id);
      box.append(el('div', { class: 'deck', style: 'margin-top:12px' }, el('span', { class: 'kind', text: mine ? 'Tuyo' : 'De ' + (m.ownerName || 'otra persona') }), el('h3', { text: m.name }),
        el('div', { class: 'pills' }, el('span', { class: 'pill', text: plural(m.cardCount || 0, 'tarjeta', 'tarjetas') }), m.qCount ? el('span', { class: 'pill', text: plural(m.qCount, 'pregunta', 'preguntas') + ' de examen' }) : null, el('span', { class: 'pill ' + (canEditMeta(m) ? 'ok' : ''), text: canEditMeta(m) ? 'Puedes editar' : 'Sólo lectura' })),
        el('div', { class: 'btnrow' }, el('button', { class: 'b small primary', onclick: async () => { await addToLibrary(m); DK.found = null; DK.code = ''; DK.adding = false; await switchDeck(m.id); setMode('cards'); toast(have ? 'Abriendo el mazo.' : 'Mazo agregado a tus mazos.'); } }, have ? 'Abrir' : 'Agregar a mis mazos')))); }
    p.append(box);
  }
  const sec = (title, list, kind, empty) => { p.append(el('h3', { class: 'sec', text: title })); if (!list.length) { if (empty) p.append(el('p', { class: 'note', text: empty })); return; } const g = el('div', { class: 'decks' }); list.forEach(m => g.append(deckBox(m, kind))); p.append(g); };
  sec('Míos', LISTS.owned, 'owned', 'Todavía no creaste mazos.');
  if (LISTS.shared.length || USER.emailVerified) sec('Compartidos conmigo', LISTS.shared, 'shared', 'Cuando alguien te agregue a un mazo con tu correo aparecerá aquí.');
  if (LISTS.saved.length) sec('Agregados', LISTS.saved, 'saved');
}

// ---------- importar y exportar mazos como archivo ----------
const IM = { open: false, parsing: false, res: null, file: null, err: '', vis: 'private', busy: '' };
function openImport() { AC.imp = null; IM.open = true; IM.res = null; IM.err = ''; IM.busy = ''; DK.creating = false; DK.adding = false; if (mode !== 'decks') setMode('decks'); else renderDecks(); scrollTo({ top: 0 }); }
function closeImport() { if (IM.busy || (AC.imp && AC.imp.busy)) return; IM.open = false; IM.res = null; IM.err = ''; AC.imp = null; render(); }
let xlsxLib = null;
function loadXLSX() { // la librería de Excel (≈ 900 KB) sólo se descarga si alguien sube un .xlsx
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxLib || (xlsxLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = () => res(window.XLSX); sc.onerror = () => { xlsxLib = null; sc.remove(); rej(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión o guarda el archivo como CSV.')); }; document.head.append(sc); }));
}
async function pickImportFile(file) {
  if (!file) return;
  if (file.size > 60 * 1024 * 1024) { IM.err = 'El archivo pesa más de 60 MB. Divídelo en partes más pequeñas.'; IM.res = null; renderDecks(); return; }
  IM.parsing = true; IM.parseMsg = ''; IM.err = ''; IM.res = null; IM.file = file; IM.withImg = true; renderDecks();
  try {
    const r = await IMP.parseFile(file, { loadXLSX, onProgress: t => { IM.parseMsg = t; if (IM.parsing) renderDecks(); } });
    IM.parsing = false;
    if (r.format === 'claude-app') { readImport(file); return; }
    if (r.unsupported) { IM.err = r.unsupported; renderDecks(); return; }
    const usable = r.decks.filter(d => d.cards.length || d.questions.length);
    if (!usable.length) { IM.err = (r.decks[0] && r.decks[0].warnings[0]) || 'No encontré tarjetas en ese archivo.'; renderDecks(); return; }
    r.decks = usable; IM.res = r; renderDecks();
  } catch (e) { IM.parsing = false; IM.err = 'No se pudo leer el archivo: ' + (e.message || e); renderDecks(); }
}
const imgCount = d => [...d.cards, ...d.questions].reduce((n, c) => n + (c.img || []).length + (c.qimg || []).length, 0);
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const safeName = s => String(s || 'mazo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'mazo';
const short = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
function importPanel() {
  const box = el('div', { class: 'card', style: 'padding:16px;display:flex;flex-direction:column;gap:12px' });
  const fi = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.json,.xlsx,.xls,.ods,.apkg,text/csv,text/plain,application/json', hidden: true, id: 'imp-deck-file' });
  fi.addEventListener('change', () => { const f = fi.files[0]; fi.value = ''; pickImportFile(f); });
  box.append(fi);
  if (AC.imp) return claudeImportBox();
  if (IM.parsing) { box.append(el('p', { class: 'note', style: 'font-size:14px', text: IM.parseMsg || 'Leyendo ' + (IM.file ? '“' + IM.file.name + '”' : 'el archivo') + '…' })); return box; }
  if (!IM.res) {
    box.append(el('h3', { class: 'sec', style: 'margin:0', text: 'Importar un mazo desde un archivo' }),
      el('p', { style: 'margin:0;font-size:14px', text: 'Sube el archivo y MyCards arma el mazo solo: detecta las columnas de pregunta, respuesta y tema, las preguntas de opción múltiple y las tarjetas repetidas. Antes de crearlo verás una vista previa.' }),
      el('ul', { class: 'tips', style: 'margin:0' },
        el('li', { text: 'Excel o Google Sheets (.xlsx o .csv): una fila por tarjeta, con columnas “pregunta”, “respuesta” y, si quieres, “tema”. Si el libro tiene varias hojas, cada hoja queda como un tema.' }),
        el('li', { text: 'Quizlet: en el set, ⋯ → Exportar, copia el texto y guárdalo como archivo .txt.' }),
        el('li', { text: 'Anki (.apkg): el mazo tal cual, con sus imágenes. Los submazos quedan como temas y cada tarjeta se arma con las plantillas del mazo (básicas, invertidas y cloze). También sirve “Notas en texto plano (.txt)”.' }),
        el('li', { text: 'JSON de MyCards: el que descargas con “Exportar” en cualquier mazo, o el que te prepare Claude con las instrucciones de abajo. También reconoce el archivo “Exportar para la web” de la app Repaso de Laringología.' })));
    const dz = el('div', { class: 'dropzone' }, el('button', { class: 'b primary', type: 'button', onclick: () => fi.click() }, 'Elegir archivo'),
      el('span', { class: 'note', text: 'En el computador también puedes arrastrar el archivo aquí.' }));
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); pickImportFile(e.dataTransfer.files[0]); });
    box.append(dz);
    if (IM.err) box.append(el('p', { class: 'note', style: 'color:var(--bad);font-size:14px', text: IM.err }));
    box.append(el('div', {}, el('h3', { class: 'sec', style: 'margin:0 0 8px', text: 'Plantillas' }),
      el('div', { class: 'btnrow' },
        el('button', { class: 'b small', onclick: () => download('plantilla-mycards.csv', IMP.TEMPLATE_CSV, 'text/csv;charset=utf-8') }, 'Plantilla para Excel (.csv)'),
        el('button', { class: 'b small', onclick: () => download('plantilla-mycards.json', IMP.TEMPLATE_JSON, 'application/json') }, 'Plantilla JSON'),
        el('button', { class: 'b small', onclick: () => copyText(IMP.AI_PROMPT, 'Instrucciones copiadas: pégalas en Claude y cambia [TEMA].') }, 'Copiar instrucciones para Claude')),
      el('p', { class: 'note', style: 'margin-top:8px', text: 'En la plantilla de Excel, una tarjeta normal lleva pregunta y respuesta. Una pregunta de opción múltiple lleva la pregunta, las opciones, la letra correcta y, si quieres, la explicación.' })),
      el('div', { class: 'btnrow' }, el('button', { class: 'b small', onclick: closeImport }, 'Cerrar')));
    return box;
  }
  const r = IM.res, many = r.decks.length > 1;
  const total = r.decks.reduce((n, d) => n + d.cards.length + d.questions.length, 0);
  box.append(el('h3', { class: 'sec', style: 'margin:0', text: 'Vista previa · ' + r.format }), el('p', { class: 'note', text: IM.file ? IM.file.name : '' }));
  r.decks.forEach((d, di) => {
    const dk = el('div', { class: 'deck' });
    const nm = el('input', { type: 'text', maxlength: '100', 'aria-label': 'Nombre del mazo', disabled: IM.busy ? true : null }); nm.value = d.name; nm.addEventListener('input', () => { d.name = nm.value; });
    dk.append(el('div', { class: 'field' }, el('label', { text: many ? 'Mazo ' + (di + 1) + ' de ' + r.decks.length : 'Nombre del mazo' }), nm));
    const nImg = imgCount(d);
    dk.append(el('div', { class: 'pills' }, el('span', { class: 'pill ok', text: plural(d.cards.length, 'tarjeta', 'tarjetas') }),
      d.questions.length ? el('span', { class: 'pill ok', text: plural(d.questions.length, 'pregunta', 'preguntas') + ' de examen' }) : null,
      el('span', { class: 'pill', text: d.topics.length ? plural(d.topics.length, 'tema', 'temas') : 'Sin temas' }),
      nImg ? el('span', { class: 'pill', text: plural(nImg, 'imagen', 'imágenes') }) : null));
    if (d.topics.length) dk.append(el('p', { class: 'note', text: 'Temas: ' + d.topics.slice(0, 15).join(' · ') + (d.topics.length > 15 ? ' y ' + (d.topics.length - 15) + ' más' : '') }));
    const sample = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    d.cards.slice(0, 3).forEach(c => sample.append(el('div', { class: 'choice', style: 'cursor:default' }, el('div', { style: 'min-width:0' },
      el('b', { style: 'white-space:pre-line', text: short(c.q, 220) }), el('span', { class: 'note', style: 'white-space:pre-line', text: '→ ' + short(c.a, 260) }),
      (c.qimg || []).length || (c.img || []).length ? el('span', { class: 'note', text: [(c.qimg || []).length ? plural(c.qimg.length, 'imagen', 'imágenes') + ' en la pregunta' : '', (c.img || []).length ? plural(c.img.length, 'imagen', 'imágenes') + ' en la respuesta' : ''].filter(Boolean).join(' · ') }) : null,
      c.topic ? el('span', { class: 'note', text: 'Tema: ' + c.topic }) : null))));
    d.questions.slice(0, 1).forEach(q => sample.append(el('div', { class: 'choice', style: 'cursor:default' }, el('div', { style: 'min-width:0' },
      el('b', { style: 'white-space:pre-line', text: short(q.q, 220) }),
      ...q.o.map((o, i) => el('span', { class: 'note', style: i === q.k ? 'color:var(--good);font-weight:700' : null, text: String.fromCharCode(65 + i) + ') ' + short(o, 160) + (i === q.k ? '  ✓ correcta' : '') }))))));
    dk.append(el('p', { class: 'note', text: 'Así se verán las primeras. Revisa que la pregunta y la respuesta no estén al revés:' }), sample);
    for (const n of d.notes) dk.append(el('p', { class: 'note', text: n }));
    for (const w of d.warnings) dk.append(el('p', { class: 'note', style: 'color:var(--warn)', text: w }));
    box.append(dk);
  });
  const allImgs = r.decks.reduce((n, d) => n + imgCount(d), 0);
  if (allImgs) { const cb = el('input', { type: 'checkbox', checked: IM.withImg ? true : null, disabled: IM.busy ? true : null, onchange: e => { IM.withImg = e.target.checked; renderDecks(); } });
    box.append(el('label', { class: 'choice' + (IM.withImg ? ' on' : '') }, cb, el('div', {}, el('b', { text: 'Incluir las imágenes (' + allImgs + ')' }),
      el('span', { class: 'note', text: allImgs > 300 ? 'Son muchas: subirlas toma tiempo y ocupa espacio del plan gratuito de Firebase (1 GB, unos 100 KB por imagen). Puedes importar sólo el texto y agregar imágenes después.' : 'Se comprimen y se guardan en tu cuenta.' })))); }
  if (total > 4000) box.append(el('p', { class: 'note', style: 'color:var(--warn)', text: 'Son ' + total + ' elementos: la importación usa ' + total + ' de las 20 000 escrituras gratuitas del día de Firebase y puede tardar unos minutos. No cierres la página mientras termina.' }));
  box.append(el('div', { class: 'field' }, el('label', { text: '¿Quién puede ver ' + (many ? 'estos mazos' : 'el mazo') + '?' }), ...visChoices(IM.vis, v => { if (!IM.busy) { IM.vis = v; renderDecks(); } }, 'impvis')));
  if (IM.err) box.append(el('p', { class: 'note', style: 'color:var(--bad);font-size:14px', text: IM.err }));
  box.append(el('div', { class: 'btnrow' },
    el('button', { class: 'b primary', disabled: IM.busy ? true : null, onclick: runDeckImport }, IM.busy || (many ? 'Crear ' + r.decks.length + ' mazos' : 'Crear mazo')),
    el('button', { class: 'b', disabled: IM.busy ? true : null, onclick: () => fi.click() }, 'Elegir otro archivo'),
    el('button', { class: 'b', disabled: IM.busy ? true : null, onclick: closeImport }, 'Cancelar')));
  return box;
}
// Archivo exportado de la app de Claude (Repaso de Laringología): se reconoce desde “Importar archivo”.
function claudeImportBox() {
  const imp = el('div', { class: 'card' }, el('h3', { class: 'sec', style: 'margin-top:0', text: 'Archivo de la app de Claude' }),
    el('p', { class: 'note', text: 'Este archivo viene de la app “Repaso de Laringología” de Claude. Se crea el mazo Laringología (con su examen) como mazo tuyo y privado, con tu progreso, ediciones, tarjetas propias, otros mazos e imágenes.' }));
  const fi = el('input', { type: 'file', accept: 'application/json,.json', id: 'imp-file', hidden: true }); fi.addEventListener('change', () => { if (fi.files[0]) readImport(fi.files[0]); fi.value = ''; });
  if (!AC.imp) imp.append(fi, el('button', { class: 'b', style: 'margin-top:10px', onclick: () => fi.click() }, 'Elegir archivo'));
  else if (AC.imp.error) imp.append(el('p', { class: 'note', style: 'color:var(--bad)', text: AC.imp.error }), fi, el('button', { class: 'b small', onclick: () => fi.click() }, 'Elegir otro archivo'));
  else if (AC.imp.done) imp.append(el('p', { class: 'note', style: 'color:var(--good)', text: AC.imp.done }));
  else { const sm = AC.imp.summary; imp.append(...[el('ul', { class: 'tips' }, el('li', { text: 'Mazo “' + sm.baseName + '”: ' + plural(sm.base, 'tarjeta', 'tarjetas') + ' y ' + plural(sm.mcq, 'pregunta', 'preguntas') + ' de examen' }),
      el('li', { text: plural(sm.prog, 'tarjeta', 'tarjetas') + ' con progreso y ' + plural(sm.edits, 'edición', 'ediciones') }), el('li', { text: plural(sm.decks, 'mazo propio', 'mazos propios') + ' más' }), el('li', { text: plural(sm.images, 'imagen', 'imágenes') })),
      AC.imp.already ? el('p', { class: 'note', style: 'color:var(--warn)', text: 'Ya importaste este archivo antes: si lo importas otra vez, los mazos se duplicarán.' }) : null,
      el('div', { class: 'btnrow' }, el('button', { class: 'b primary', disabled: AC.imp.busy ? true : null, onclick: runImport }, AC.imp.busy || 'Importar'), el('button', { class: 'b', disabled: AC.imp.busy ? true : null, onclick: () => { AC.imp = null; closeImport(); } }, 'Cancelar'))].filter(Boolean)); }
  return imp;
}
async function imageToId(src) { // data: o https:// → imagen comprimida y guardada en Firebase
  let file;
  if (src.startsWith('anki-media:')) { const b = IM.res && IM.res.media ? await IM.res.media(src) : null; if (!b) throw new Error('img'); file = new File([b], 'img', { type: b.type }); }
  else if (src.startsWith('data:')) file = await dataUrlToFile(src);
  else { const res = await fetch(src, { mode: 'cors' }); if (!res.ok) throw new Error('img'); const b = await res.blob(); if (!b.type.startsWith('image/')) throw new Error('img'); file = new File([b], 'img', { type: b.type }); }
  const r = await compressImage(file); const id = await B.putImage(r.data, r.w, r.h); IMG[id] = r.data; return id;
}
async function runDeckImport() {
  const r = IM.res; if (!r || IM.busy) return;
  for (const d of r.decks) { d.name = String(d.name || '').trim().slice(0, 100); if (!d.name) { IM.err = 'Ponle nombre a cada mazo.'; renderDecks(); return; } }
  IM.err = ''; const set = t => { IM.busy = t; renderDecks(); };
  const created = []; let lostImgs = 0; const upl = new Map(); // misma imagen en varias tarjetas → se sube una sola vez
  try {
    for (const [di, d] of r.decks.entries()) {
      const pre = r.decks.length > 1 ? 'Mazo ' + (di + 1) + '/' + r.decks.length + ': ' : '';
      const withImg = IM.withImg ? [...d.cards, ...d.questions].filter(c => ((c.img || []).length || (c.qimg || []).length) && !c.imgIds) : [];
      const uniq = new Set(); withImg.forEach(c => [...(c.qimg || []), ...(c.img || [])].forEach(s => uniq.add(s))); let k = 0;
      const one = async src => { if (upl.has(src)) return upl.get(src); set(pre + 'subiendo imágenes ' + (++k) + '/' + uniq.size + '…'); let id = null; try { id = await imageToId(src); } catch (e) { lostImgs++; } upl.set(src, id); return id; };
      for (const c of withImg) { const q = [], a = []; for (const s of c.qimg || []) { const id = await one(s); if (id) q.push(id); } for (const s of c.img || []) { const id = await one(s); if (id) a.push(id); } c.imgIds = [...q, ...a]; c.qi = q.length; }
      const topics = {}; d.topics.forEach((t, i) => { topics[i] = t; });
      const ch = t => { const i = d.topics.indexOf(t); return i < 0 ? null : i; };
      const flash = d.cards.map((c, i) => ({ q: c.q, a: c.a, img: IM.withImg ? c.imgIds || [] : [], qi: IM.withImg && c.qi ? c.qi : undefined, ch: ch(c.topic), created: i + 1 }));
      const mcq = d.questions.map((q, i) => ({ type: 'mcq', q: q.q, o: q.o, k: q.k, e: q.e || undefined, img: IM.withImg ? q.imgIds || [] : [], qi: IM.withImg && q.qi ? q.qi : undefined, ch: ch(q.topic), created: 200000 + i }));
      set(pre + 'creando el mazo…');
      const data = newDeckData(d.name, { visibility: IM.vis, topics: d.topics.length ? topics : undefined, description: d.description ? d.description.slice(0, 1000) : undefined });
      const res = await B.createDeck(data); created.push(res);
      set(pre + 'guardando ' + plural(flash.length + mcq.length, 'elemento', 'elementos') + '…');
      await B.addCards(res.id, [...flash, ...mcq], { cards: flash.length, questions: mcq.length });
      LISTS.owned.push({ id: res.id, ...data, code: res.code, cardCount: flash.length, qCount: mcq.length });
    }
    LISTS.owned.sort(byName);
    const first = created[0], n = created.length;
    IM.busy = ''; IM.open = false; IM.res = null;
    await switchDeck(first.id); setMode('decks');
    toast((n > 1 ? n + ' mazos creados.' : 'Mazo creado · N.º de serie ' + fmtCode(first.code)) + (lostImgs ? ' ' + plural(lostImgs, 'imagen no se pudo', 'imágenes no se pudieron') + ' descargar.' : ''));
  } catch (e) {
    for (const c of created) B.deleteDeck(c.id, c.code).catch(() => {});
    LISTS.owned = LISTS.owned.filter(d => !created.some(c => c.id === d.id));
    const needsRules = e && e.code === 'permission-denied' && r.decks.some(d => d.cards.some(c => c.qi));
    IM.busy = ''; IM.err = 'La importación se interrumpió y se deshizo: ' + (needsRules ? 'faltan las reglas nuevas de Firebase para imágenes en la pregunta. Pega de nuevo firestore.rules en Firebase → Firestore → Reglas → Publicar, o desmarca “Incluir las imágenes”.' : B.errorMessage(e)); renderDecks();
  }
}
async function exportDeck(m) {
  DK.busy = 'exp:' + m.id; renderDecks();
  try {
    const cur = CUR && CUR.id === m.id && !CUR.loading;
    let list = cur ? CUR.cards.slice() : await B.listCards(m.id);
    if (!canEditMeta(m)) { const ed = cur ? ED : normED(await B.getEdits(m.id).catch(() => null)); list = list.map(c => { const e = ed.edits[c.id]; return e ? { ...c, q: e.q, a: e.a, img: e.img || [] } : c; }); }
    const out = await IMP.buildExport(m, list.filter(c => c.q && (c.a || c.type === 'mcq')), m.topics || {}, async id => IMG[id] || (IMG[id] = await B.getImage(id).catch(() => null)));
    download(safeName(m.name) + '.mycards.json', JSON.stringify(out, null, 1), 'application/json');
    toast('Mazo exportado: ' + plural(out.cards.length, 'tarjeta', 'tarjetas') + (out.questions ? ' y ' + plural(out.questions.length, 'pregunta', 'preguntas') : '') + '.');
  } catch (e) { toast(B.errorMessage(e)); }
  DK.busy = null; renderDecks();
}

// ---------- compartir ----------
function openShare(m) { SHARE = { m, visibility: m.visibility || 'private', anyoneCanEdit: !!m.anyoneCanEdit, people: (m.sharedWith || []).map(e => ({ email: e, role: (m.editorEmails || []).includes(e) ? 'edit' : 'view' })), newEmail: '', newRole: 'edit', saving: false, err: '', dirty: false }; mode = 'decks'; render(); scrollTo({ top: 0 }); }
function shareForm() {
  const S = SHARE, m = S.m;
  const box = el('div', { class: 'card' });
  box.append(el('div', { class: 'meta' }, el('span', { class: 'ch', text: 'Compartir' }), el('span', { text: plural(m.cardCount || 0, 'tarjeta', 'tarjetas') })), el('div', { class: 'q', text: m.name }));
  box.append(el('div', { class: 'serial big' }, el('span', { class: 'lbl', text: 'Número de serie' }), el('code', { text: fmtCode(m.code) }),
    el('button', { class: 'b small', type: 'button', onclick: () => copyText(fmtCode(m.code), 'Número de serie copiado.') }, 'Copiar'),
    el('button', { class: 'b small', type: 'button', onclick: async () => { const link = deckLink(m.code); try { if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: m.name, text: 'Mazo de MyCards: ' + m.name + ' · N.º de serie ' + fmtCode(m.code), url: link }); else copyText(link, 'Enlace copiado.'); } catch (e) {} } }, 'Copiar enlace')));
  if (S.visibility === 'private') box.append(el('p', { class: 'note', style: 'margin-top:6px', text: 'Mientras sea privado, el número de serie sólo sirve para las personas que agregues abajo.' }));
  box.append(el('div', { class: 'form' },
    el('div', { class: 'field' }, el('label', { text: '¿Quién puede verlo?' }), ...visChoices(S.visibility, v => { S.visibility = v; S.dirty = true; render(); }, 'vis')),
    S.visibility !== 'private' ? el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: S.anyoneCanEdit ? true : null, onchange: e => { S.anyoneCanEdit = e.target.checked; S.dirty = true; render(); } }),
      el('span', {}, el('b', { text: 'Cualquiera puede editar' }), el('span', { class: 'note', text: S.anyoneCanEdit ? 'Toda persona con acceso puede añadir, cambiar y borrar tarjetas.' : 'Desactivado: sólo tú y los editores que elijas pueden cambiar tarjetas.' }))) : null,
    peopleEditor(S)));
  box.append(el('div', { class: 'btnrow', style: 'margin-top:16px' },
    el('button', { class: 'b primary', disabled: S.saving ? true : null, onclick: saveShare }, S.saving ? 'Guardando…' : 'Guardar'),
    el('button', { class: 'b', onclick: () => { SHARE = null; renderDecks(); } }, S.dirty ? 'Cancelar' : 'Cerrar')));
  if (S.err) box.append(el('p', { class: 'note', style: 'color:var(--bad);margin-top:8px', text: S.err }));
  return box;
}
function peopleEditor(S) {
  const wrap = el('div', { class: 'field' }, el('label', { text: 'Personas' }));
  const ul = el('ul', { class: 'people' });
  if (!S.people.length) ul.append(el('li', { class: 'note', text: 'Todavía no agregaste a nadie.' }));
  S.people.forEach((p, i) => { const sel = el('select', { 'aria-label': 'Permiso de ' + p.email }); sel.append(new Option('Puede editar', 'edit'), new Option('Sólo ver', 'view')); sel.value = p.role; sel.addEventListener('change', () => { p.role = sel.value; S.dirty = true; });
    ul.append(el('li', {}, el('span', { class: 'em', text: p.email }), sel, el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Quitar a ' + p.email, onclick: () => { S.people.splice(i, 1); S.dirty = true; render(); } }, 'Quitar'))); });
  wrap.append(ul);
  const inp = el('input', { type: 'email', id: 'share-email', placeholder: 'correo@ejemplo.com', 'aria-label': 'Correo de la persona', autocomplete: 'off' }); inp.value = S.newEmail; inp.addEventListener('input', () => S.newEmail = inp.value);
  const sel = el('select', { 'aria-label': 'Permiso' }); sel.append(new Option('Puede editar', 'edit'), new Option('Sólo ver', 'view')); sel.value = S.newRole; sel.addEventListener('change', () => S.newRole = sel.value);
  const add = () => { const e = S.newEmail.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { S.err = 'Escribe un correo válido.'; render(); return; }
    if (e === USER.email) { S.err = 'Ese es tu propio correo.'; render(); return; }
    if (S.people.some(p => p.email === e)) { S.err = 'Esa persona ya está en la lista.'; render(); return; }
    S.people.push({ email: e, role: S.newRole }); S.newEmail = ''; S.err = ''; S.dirty = true; render(); setTimeout(() => { const i = $('share-email'); if (i) i.focus(); }, 0); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  wrap.append(...[el('div', { class: 'addrow' }, inp, sel, el('button', { class: 'b small', type: 'button', onclick: add }, 'Agregar')),
    el('p', { class: 'note', text: 'La persona debe entrar con ese mismo correo (con Google, o con correo y contraseña ya verificado). El mazo le aparecerá en “Compartidos conmigo”.' }),
    S.visibility !== 'private' && S.people.length ? el('p', { class: 'note', style: 'color:var(--warn)', text: 'Ojo: en un mazo con número de serie o público, quien lo abra puede ver estos correos.' }) : null].filter(Boolean));
  return wrap;
}
async function saveShare() {
  const S = SHARE, m = S.m; S.saving = true; S.err = ''; render();
  const patch = { visibility: S.visibility, anyoneCanEdit: S.visibility !== 'private' && S.anyoneCanEdit, sharedWith: S.people.map(p => p.email), editorEmails: S.people.filter(p => p.role === 'edit').map(p => p.email), updated: Date.now() };
  try { await B.updateDeck(m.id, patch); Object.assign(m, patch); if (CUR && CUR.id === m.id) CUR.meta = m; SHARE = null; toast('Cambios guardados.'); renderDecks(); }
  catch (e) { S.saving = false; S.err = B.errorMessage(e); render(); }
}

// ---------- explorar ----------
const EX = { list: null, q: '', loading: false, err: '' };
async function loadExplore() { EX.loading = true; EX.err = ''; renderExplore(); try { EX.list = (await B.listPublicDecks()).sort((a, b) => (b.updated || 0) - (a.updated || 0)); } catch (e) { EX.err = B.errorMessage(e); } EX.loading = false; if (mode === 'explore') renderExplore(); }
function renderExplore() {
  const p = $('panel-explore'); p.innerHTML = '';
  p.append(el('div', { class: 'btnrow', style: 'justify-content:space-between' }, el('h2', { class: 'h2', text: 'Mazos públicos' }), el('button', { class: 'b small', onclick: () => setMode('decks') }, 'Volver a mis mazos')));
  const inp = el('input', { type: 'search', id: 'ex-q', placeholder: 'Filtra por nombre, autor o número de serie', 'aria-label': 'Filtrar mazos públicos' }); inp.value = EX.q;
  inp.addEventListener('input', () => { EX.q = inp.value; renderExploreList(); });
  p.append(inp, el('div', { id: 'ex-list', class: 'panel' }));
  if (EX.list === null && !EX.loading) loadExplore(); else renderExploreList();
}
function renderExploreList() {
  const box = $('ex-list'); if (!box) return; box.innerHTML = '';
  if (EX.loading) { box.append(el('p', { class: 'note', text: 'Cargando…' })); return; }
  if (EX.err) { box.append(el('p', { class: 'note', text: EX.err })); return; }
  const t = norm(EX.q), tc = cleanCode(EX.q); const list = (EX.list || []).filter(d => !t || norm(d.name + ' ' + (d.ownerName || '') + ' ' + (d.description || '')).includes(t) || (tc.length >= 4 && (d.code || '').includes(tc)));
  if (!list.length) { box.append(el('div', { class: 'card empty', text: EX.list && EX.list.length ? 'Ningún mazo coincide.' : 'Todavía no hay mazos públicos.' })); return; }
  const g = el('div', { class: 'decks' });
  list.forEach(m => { const mine = m.owner === USER.uid; const have = mine || allDecks().some(d => d.id === m.id);
    g.append(el('div', { class: 'deck' }, el('span', { class: 'kind', text: mine ? 'Tuyo' : 'De ' + (m.ownerName || 'otra persona') }), el('h3', { text: m.name }),
      el('div', { class: 'pills' }, el('span', { class: 'pill', text: plural(m.cardCount || 0, 'tarjeta', 'tarjetas') }), m.qCount ? el('span', { class: 'pill', text: plural(m.qCount, 'pregunta', 'preguntas') }) : null, m.anyoneCanEdit ? el('span', { class: 'pill ok', text: 'Abierto a ediciones' }) : null),
      m.description ? el('p', { class: 'note', text: m.description }) : null, serialRow(m),
      el('div', { class: 'btnrow' }, el('button', { class: 'b small primary', onclick: async () => { await addToLibrary(m); await switchDeck(m.id); setMode('cards'); } }, have ? 'Abrir' : 'Agregar y estudiar'),
        el('button', { class: 'b small', disabled: DK.busy === 'dup:' + m.id ? true : null, onclick: () => duplicateDeck(m) }, 'Duplicar')))); });
  box.append(g);
}

// ---------- búsqueda ----------
const SR = { q: '', all: false, cache: {} };
function highlight(text, terms) {
  const frag = document.createDocumentFragment(); if (!terms.length) { frag.append(text); return frag; }
  const nt = norm(text); const ranges = [];
  for (const t of terms) { let i = nt.indexOf(t); while (i >= 0) { ranges.push([i, i + t.length]); i = nt.indexOf(t, i + t.length); } }
  ranges.sort((a, b) => a[0] - b[0]); const merged = []; for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); }
  let pos = 0; for (const [s, e] of merged) { if (s > pos) frag.append(text.slice(pos, s)); frag.append(el('mark', { text: text.slice(s, e) })); pos = e; } if (pos < text.length) frag.append(text.slice(pos));
  return frag;
}
async function cardsOfDeck(m) {
  if (CUR && m.id === CUR.id) return deckCards().map(c => ({ ...c, deckId: m.id, deckName: m.name, deckMeta: m }));
  if (SR.cache[m.id]) return SR.cache[m.id];
  const list = await B.listCards(m.id).catch(() => []);
  return SR.cache[m.id] = list.filter(c => c.type !== 'mcq').map(c => ({ ...c, deckId: m.id, deckName: m.name, deckMeta: m }));
}
let searchSeq = 0;
async function searchResults() {
  const terms = norm(SR.q).split(/\s+/).filter(t => t.length >= 2); if (!terms.length) return { terms, list: [] };
  const decks = SR.all || !CUR ? allDecks() : [CUR.meta];
  const pools = await Promise.all(decks.map(cardsOfDeck));
  const list = pools.flat().filter(c => { const tn = c.ch != null && c.deckMeta.topics && c.deckMeta.topics[c.ch] ? c.deckMeta.topics[c.ch] : ''; const h = norm(c.q + ' ' + (c.a || '') + ' ' + tn); return terms.every(t => h.includes(t)); });
  return { terms, list };
}
function renderSearch() {
  const p = $('panel-search'); p.innerHTML = '';
  if (EDIT) { p.append(editForm()); return; }
  SR.cache = {};
  const inp = el('input', { type: 'search', id: 'search-in', placeholder: 'Busca por palabra: recurrente, Zenker, Cernea…', 'aria-label': 'Buscar tarjetas' }); inp.value = SR.q;
  let t = null; inp.addEventListener('input', () => { SR.q = inp.value; clearTimeout(t); t = setTimeout(renderResults, 150); });
  const chk = el('input', { type: 'checkbox', id: 'search-all', checked: SR.all || !CUR ? true : null, disabled: !CUR ? true : null }); chk.addEventListener('change', () => { SR.all = chk.checked; renderResults(); });
  p.append(el('div', { class: 'card', style: 'padding:16px' }, inp, el('label', { for: 'search-all', class: 'note', style: 'display:flex;gap:8px;align-items:center;margin-top:10px;cursor:pointer' }, chk, 'Buscar en todos mis mazos' + (CUR ? ' (si no, sólo en “' + CUR.meta.name + '”)' : ''))));
  p.append(el('div', { id: 'search-res', class: 'panel' }));
  renderResults();
}
async function renderResults() {
  const box = $('search-res'); if (!box) return; const seq = ++searchSeq;
  const { terms, list } = await searchResults(); if (seq !== searchSeq || !$('search-res')) return;
  box.innerHTML = '';
  if (!terms.length) { box.append(el('p', { class: 'note', text: 'Escribe al menos una palabra de 2 letras. Se busca en la pregunta, la respuesta y el tema, sin importar tildes ni mayúsculas.' })); return; }
  const local = CUR && list.every(c => c.deckId === CUR.id);
  box.append(el('div', { class: 'btnrow', style: 'justify-content:space-between' }, el('span', { class: 'stat' }, el('b', { text: String(list.length) }), list.length === 1 ? ' tarjeta encontrada' : ' tarjetas encontradas'),
    list.length && local ? el('button', { class: 'b small primary', onclick: () => { startCards(true, list); mode = 'cards'; render(); } }, 'Repasar estos resultados') : null));
  if (!list.length) { box.append(el('div', { class: 'card empty', text: 'Sin resultados. Prueba con otra palabra o busca en todos los mazos.' })); return; }
  const ul = el('ul', { class: 'results' });
  list.slice(0, 80).forEach(c => { const here = CUR && c.deckId === CUR.id;
    const tn = c.ch != null && c.deckMeta.topics && c.deckMeta.topics[c.ch] ? c.deckMeta.topics[c.ch] : '';
    const label = [SR.all || !CUR ? c.deckName : '', tn].filter(Boolean).join(' · ');
    ul.append(el('li', {}, el('div', { class: 'rmeta' }, el('span', { text: label }),
        el('span', { class: 'btnrow', style: 'gap:8px' }, here ? el('span', { class: 'note', text: SRS.stateLabel(P.cards[c.id]) }) : null,
          iconBtn(ICON_EDIT, 'Editar', async () => { if (!here) { await switchDeck(c.deckId); mode = 'search'; } const fresh = deckCards().find(x => x.id === c.id) || c; openEdit(fresh, 'search'); }))),
      el('div', { class: 'rq' }, highlight(c.q, terms)), el('div', { class: 'ra' }, highlight(c.a || '', terms)), imgGrid(c.img, true))); });
  box.append(ul);
  if (list.length > 80) box.append(el('p', { class: 'note', text: 'Se muestran las primeras 80. Afina la búsqueda con otra palabra.' }));
}

// ---------- cuenta ----------
const AC = { editingName: false, name: '', imp: null };
function renderAccount() {
  const p = $('panel-account'); p.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'acct' }, avatar(48), el('div', { style: 'min-width:0' }, el('div', { class: 'q', style: 'margin:0', text: USER.name }), el('div', { class: 'note', text: USER.email + (USER.provider === 'google.com' ? ' · Google' : USER.provider === 'apple.com' ? ' · Apple' : ' · correo y contraseña') }))));
  if (AC.editingName) { const inp = el('input', { type: 'text', id: 'acct-name', maxlength: '100', 'aria-label': 'Tu nombre' }); inp.value = AC.name; inp.addEventListener('input', () => AC.name = inp.value);
    card.append(el('div', { class: 'addrow', style: 'margin-top:12px' }, inp, el('button', { class: 'b small primary', onclick: async () => { const n = AC.name.trim(); if (!n) return; try { USER = await B.updateName(n); AC.editingName = false; B.setUserDoc({ name: n }).catch(() => {}); $('acct-avatar').replaceChildren(avatar()); renderAccount(); } catch (e) { toast(B.errorMessage(e)); } } }, 'Guardar'), el('button', { class: 'b small', onclick: () => { AC.editingName = false; renderAccount(); } }, 'Cancelar'))); }
  const row = el('div', { class: 'btnrow', style: 'margin-top:14px' });
  if (!AC.editingName) row.append(el('button', { class: 'b small', onclick: () => { AC.editingName = true; AC.name = USER.name; renderAccount(); } }, 'Cambiar nombre'));
  row.append(el('button', { class: 'b small', onclick: async () => { flushAll(); await B.signOut(); } }, 'Cerrar sesión'));
  card.append(row);
  if (USER.provider === 'password') {
    card.append(el('div', { class: 'banner' + (USER.emailVerified ? ' ok' : ''), style: 'margin-top:14px' }, el('span', { text: USER.emailVerified ? 'Tu correo está verificado.' : 'Te enviamos un correo para verificar tu cuenta (revisa también spam). Verificarlo permite que otras personas te compartan mazos por correo.' }),
      USER.emailVerified ? null : el('div', { class: 'btnrow' }, el('button', { class: 'b small', onclick: async () => { try { await B.resendVerification(); toast('Correo reenviado.'); } catch (e) { toast(B.errorMessage(e)); } } }, 'Reenviar'),
        el('button', { class: 'b small primary', onclick: async () => { USER = await B.refreshUser(); if (USER.emailVerified) { toast('¡Correo verificado!'); await loadLists(); } else toast('Aún no aparece verificado.'); render(); } }, 'Ya lo verifiqué'))));
  }
  p.append(card);
  // repetición espaciada
  const s = UDOC.settings || {};
  const ret = el('select', { id: 'set-ret' }); [[0.85, '85 % · menos repasos, intervalos más largos'], [0.9, '90 % · recomendado'], [0.93, '93 % · más seguro'], [0.95, '95 % · cerca de un examen']].forEach(([v, t]) => ret.append(new Option(t, v))); ret.value = String(s.retention || 0.9);
  const npd = el('select', { id: 'set-new' }); [5, 10, 20, 30, 50, 100, 9999].forEach(v => npd.append(new Option(v === 9999 ? 'Sin límite' : String(v), v))); npd.value = String(newPerDay());
  const saveSet = () => { UDOC.settings = { ...(UDOC.settings || {}), retention: +ret.value, newPerDay: +npd.value }; B.setUserDoc({ settings: UDOC.settings }).catch(e => toast(B.errorMessage(e))); CS = null; toast('Ajustes guardados.'); };
  ret.addEventListener('change', saveSet); npd.addEventListener('change', saveSet);
  p.append(el('div', { class: 'card' }, el('h3', { class: 'sec', style: 'margin-top:0', text: 'Repetición espaciada' }),
    el('p', { class: 'note', style: 'margin:6px 0 12px', text: 'MyCards programa cada tarjeta con FSRS-5, el algoritmo moderno de Anki. Estima la dificultad de cada tarjeta y cuánto tiempo la recordarás, y te la muestra justo cuando la probabilidad de recordarla cae a tu retención deseada.' }),
    el('div', { class: 'form', style: 'margin-top:0' }, el('div', { class: 'field' }, el('label', { for: 'set-ret', text: 'Retención deseada' }), ret),
      el('div', { class: 'field' }, el('label', { for: 'set-new', text: 'Tarjetas nuevas por día (en cada mazo)' }), npd)),
    el('ul', { class: 'tips' }, el('li', { text: 'Otra vez: no la recordaste. Vuelve en minutos y su estabilidad baja.' }), el('li', { text: 'Difícil: la recordaste con mucho esfuerzo o incompleta. Intervalo más corto.' }),
      el('li', { text: 'Bien: la recordaste tras pensarlo. Es la respuesta habitual.' }), el('li', { text: 'Fácil: la recordaste al instante. Intervalo mucho más largo.' }),
      el('li', { text: 'Cada botón muestra cuándo volverás a ver la tarjeta.' }))));
  // instalar
  const inst = el('div', { class: 'card' }, el('h3', { class: 'sec', style: 'margin-top:0', text: 'Úsala como app en tu celular o tablet' }));
  if (installEvt) inst.append(el('button', { class: 'b primary', onclick: async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; renderAccount(); } }, 'Instalar MyCards'));
  inst.append(el('ul', { class: 'tips' }, el('li', { text: 'iPhone o iPad (Safari): botón Compartir → “Agregar a inicio”.' }), el('li', { text: 'Android (Chrome): menú ⋮ → “Instalar app”.' }),
    el('li', { text: 'Tu progreso es el mismo en todos tus dispositivos. Sin internet puedes seguir estudiando; se sincroniza al reconectar.' })));
  p.append(inst);
  p.append(deleteAccountCard());
}
// ---------- privacidad y eliminar la cuenta ----------
function deleteAccountCard() {
  const box = el('div', { class: 'card' }, el('h3', { class: 'sec', style: 'margin-top:0', text: 'Privacidad y cuenta' }),
    el('p', { class: 'note', style: 'margin:6px 0 12px;font-size:14px' }, 'Lee qué datos guarda MyCards y para qué en la ', el('a', { href: 'privacidad.html', target: '_blank', rel: 'noopener', text: 'política de privacidad' }), '.'));
  const D = AC.del;
  if (!D) { box.append(el('button', { class: 'b small danger', onclick: () => { AC.del = { text: '', pass: '', busy: '', err: '' }; renderAccount(); setTimeout(() => { const i = $('del-confirm'); if (i) i.focus(); }, 0); } }, 'Eliminar mi cuenta')); return box; }
  const owned = LISTS.owned.length;
  box.append(el('div', { class: 'banner', style: 'border-color:var(--bad);background:var(--bad-soft);flex-direction:column;align-items:stretch;gap:8px' },
    el('b', { text: 'Eliminar tu cuenta es definitivo y no se puede deshacer.' }),
    el('ul', { class: 'tips', style: 'margin:0' },
      el('li', { text: 'Se borran tus mazos (' + owned + ') con sus tarjetas, imágenes y números de serie, también para las personas con quienes los compartiste.' }),
      el('li', { text: 'Se borran tu progreso, tus ediciones personales y tus ajustes.' }),
      el('li', { text: 'Las tarjetas que agregaste a mazos de otras personas se quedan en esos mazos.' }),
      el('li', { text: 'Si quieres conservar algo, usa antes “Exportar” en cada mazo.' }))));
  const f = el('div', { class: 'form' });
  const ci = el('input', { type: 'text', id: 'del-confirm', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', disabled: D.busy ? true : null }); ci.value = D.text;
  ci.addEventListener('input', () => { D.text = ci.value; const b = $('del-go'); if (b) b.disabled = !delReady(); });
  f.append(el('div', { class: 'field' }, el('label', { for: 'del-confirm', text: 'Escribe ELIMINAR para confirmar' }), ci));
  if (USER.provider === 'password') { const pi = el('input', { type: 'password', id: 'del-pass', autocomplete: 'current-password', disabled: D.busy ? true : null }); pi.value = D.pass; pi.addEventListener('input', () => { D.pass = pi.value; const b = $('del-go'); if (b) b.disabled = !delReady(); }); f.append(el('div', { class: 'field' }, el('label', { for: 'del-pass', text: 'Tu contraseña' }), pi)); }
  else f.append(el('p', { class: 'note', text: 'Al confirmar se abrirá ' + (USER.provider === 'apple.com' ? 'Apple' : 'Google') + ' para verificar que eres tú.' }));
  box.append(f);
  if (D.err) box.append(el('p', { class: 'note', style: 'color:var(--bad);font-size:14px;margin-top:8px', text: D.err }));
  if (D.busy) box.append(el('p', { class: 'note', style: 'font-size:14px;margin-top:8px', text: D.busy }));
  box.append(el('div', { class: 'btnrow', style: 'margin-top:12px' },
    el('button', { class: 'b danger', id: 'del-go', disabled: D.busy || !delReady() ? true : null, onclick: runDeleteAccount }, D.busy ? 'Eliminando…' : 'Eliminar mi cuenta definitivamente'),
    el('button', { class: 'b', disabled: D.busy ? true : null, onclick: () => { AC.del = null; renderAccount(); } }, 'Cancelar')));
  return box;
}
function delReady() { const D = AC.del; return !!D && D.text.trim().toUpperCase() === 'ELIMINAR' && (USER.provider !== 'password' || D.pass.length > 0); }
async function runDeleteAccount() {
  const D = AC.del; if (!D || D.busy || !delReady()) return;
  const set = t => { D.busy = t; renderAccount(); };
  D.err = ''; set('Confirmando que eres tú…');
  try { await B.reauth(D.pass); }
  catch (e) { D.busy = ''; D.err = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(e.code) ? 'La contraseña no es correcta.' : B.errorMessage(e); renderAccount(); return; }
  // Detiene todo lo que podría volver a escribir datos mientras se borran.
  for (const k of Object.keys(SAVE.timers)) clearTimeout(SAVE.timers[k]);
  SAVE.timers = {}; SAVE.fns = {};
  if (CUR && CUR.unsub) CUR.unsub(); CUR = null;
  try {
    await B.deleteAccount(set);
    AC.del = null; AU.tab = 'in'; AU.err = ''; AU.msg = 'Tu cuenta y tus datos se eliminaron. Gracias por usar MyCards.';
    if (!USER) renderAuth();
    toast('Cuenta eliminada.');
  } catch (e) {
    D.busy = '';
    D.err = e && e.code === 'auth/requires-recent-login'
      ? 'Tus datos ya se borraron, pero la confirmación de identidad venció antes de terminar. Cierra sesión, vuelve a entrar y repite “Eliminar mi cuenta” para terminar.'
      : 'No se pudo completar: ' + B.errorMessage(e) + ' Vuelve a intentarlo; lo que ya se borró no se recupera.';
    renderAccount();
  }
}
function avatar(size) { const a = el('span', { class: 'avatar', style: size ? 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.42) + 'px' : null });
  if (USER && USER.photo) { const im = el('img', { src: USER.photo, alt: '', referrerpolicy: 'no-referrer' }); im.addEventListener('error', () => { im.remove(); a.textContent = (USER.name || '?')[0].toUpperCase(); }); a.append(im); }
  else a.textContent = ((USER && USER.name) || '?')[0].toUpperCase(); return a; }

// ---------- importar desde la app de Claude ----------
async function readImport(file) {
  try { const data = JSON.parse(await file.text());
    if (!data || data.app !== 'repaso-laringologia' || !data.S || !data.C) throw new Error('bad');
    if (!data.base || !Array.isArray(data.base.cards)) { AC.imp = { error: 'Este archivo es de una versión anterior. Vuelve a exportarlo desde la app de Claude (Progreso → Exportar para la web) y elige el archivo nuevo.' }; renderDecks(); return; }
    const S = data.S, C = data.C;
    AC.imp = { data, summary: { baseName: data.base.name || 'Laringología', base: data.base.cards.length + (C.cards || []).filter(c => c.deck === 'laringo').length, mcq: (data.base.mcqs || []).length, prog: Object.keys(S.cards || {}).length, edits: Object.keys(C.edits || {}).length,
      decks: (C.decks || []).length, images: Object.keys(data.images || {}).length }, already: (UDOC.imports || []).includes(String(data.exported)) };
  } catch (e) { AC.imp = { error: 'Ese archivo no es una exportación de la app de Claude.' }; }
  renderDecks();
}
async function dataUrlToFile(d) { const r = await fetch(d); const b = await r.blob(); return new File([b], 'img', { type: b.type }); }
async function runImport() {
  const I = AC.imp, { S, C, images, base } = I.data; const set = t => { I.busy = t; renderDecks(); };
  const created = [];
  try {
    const map = {}; const ids = Object.keys(images || {}); let n = 0;
    for (const id of ids) { set('Subiendo imágenes ' + (++n) + '/' + ids.length + '…'); try { let d = images[id]; let w = 0, h = 0; if (d.length > 900000 || !/^data:image\/(webp|jpeg|png|gif);/.test(d)) { const r = await compressImage(await dataUrlToFile(d)); d = r.data; w = r.w; h = r.h; } map[id] = await B.putImage(d, w, h); IMG[map[id]] = d; } catch (e) {} }
    const mi = a => (a || []).map(x => map[x]).filter(Boolean).slice(0, 12);
    const cut = (s, k) => String(s || '').slice(0, k);
    const progFor = idsSet => { const pc = {}; for (const id in (S.cards || {})) if (idsSet.has(id)) pc[id] = compact(SRS.normalize(S.cards[id])); return pc; };
    set('Creando el mazo ' + (base.name || 'Laringología') + '…');
    const edits = C.edits || {};
    const baseCards = base.cards.map((c, i) => { const e = edits[c.id]; return { id: c.id, ch: c.ch, q: cut(e ? e.q : c.q, 5000), a: cut(e ? e.a : c.a, 20000), img: e ? mi(e.img) : [], created: 1 + i }; });
    const extras = (C.cards || []).filter(c => c.deck === 'laringo').map((c, i) => ({ id: c.id, ch: c.ch || 0, q: cut(c.q, 5000), a: cut(c.a, 20000), img: mi(c.img), created: 100000 + i }));
    const mcq = (base.mcqs || []).filter(q => q && q.q && Array.isArray(q.o) && q.o.length >= 2 && q.o.length <= 8 && Number.isInteger(q.k) && q.k >= 0 && q.k < q.o.length)
      .map((q, i) => ({ id: q.id, ch: Number.isInteger(q.ch) ? q.ch : null, type: 'mcq', q: cut(q.q, 5000), o: q.o.map(x => cut(x, 1000)), k: q.k, e: cut(q.e, 5000), created: 200000 + i }));
    const topicsMap = { ...(base.topics || {}) }; if (extras.some(c => c.ch === 0)) topicsMap[0] = 'Mis tarjetas';
    const flashAll = [...baseCards, ...extras].filter(c => c.q && c.a);
    const d1 = newDeckData(base.name || 'Laringología', { topics: topicsMap, description: base.description ? cut(base.description, 1000) : undefined });
    const r1 = await B.createDeck(d1); created.push(r1);
    set('Guardando ' + flashAll.length + ' tarjetas y ' + mcq.length + ' preguntas…');
    await B.addCards(r1.id, [...flashAll, ...mcq], { cards: flashAll.length, questions: mcq.length });
    const quiz = {}; for (const ch in (S.quiz || {})) quiz[String(ch)] = S.quiz[ch];
    await B.setProgress(r1.id, { cards: progFor(new Set(flashAll.map(c => c.id))), quiz, wrong: S.wrong || [], newDay: { d: '', n: 0 }, updated: Date.now() });
    LISTS.owned.push({ id: r1.id, ...d1, code: r1.code, cardCount: flashAll.length, qCount: mcq.length });
    let k = 0;
    for (const d of (C.decks || [])) {
      set('Creando mazos ' + (++k) + '/' + C.decks.length + '…');
      const cs = (C.cards || []).filter(c => c.deck === d.id && c.q && c.a).map((c, i) => ({ id: c.id, q: cut(c.q, 5000), a: cut(c.a, 20000), img: mi(c.img), created: c.created || i + 1 }));
      const data = newDeckData(d.name || 'Mazo importado');
      const r = await B.createDeck(data); created.push(r);
      await B.addCards(r.id, cs);
      const pc = progFor(new Set(cs.map(c => c.id))); if (Object.keys(pc).length) await B.setProgress(r.id, { cards: pc, quiz: {}, wrong: [], newDay: { d: '', n: 0 }, updated: Date.now() });
      LISTS.owned.push({ id: r.id, ...data, code: r.code, cardCount: cs.length });
    }
    LISTS.owned.sort(byName);
    UDOC.imports = [...(UDOC.imports || []), String(I.data.exported)]; B.setUserDoc({ imports: UDOC.imports }).catch(() => {});
    const msg = 'Listo: se creó el mazo “' + (base.name || 'Laringología') + '”' + (C.decks && C.decks.length ? ' y ' + plural(C.decks.length, 'mazo más', 'mazos más') : '') + ' con tu progreso.';
    AC.imp = null; IM.open = false; await switchDeck(r1.id); setMode('decks'); toast(msg);
  } catch (e) { for (const r of created) B.deleteDeck(r.id, r.code).catch(() => {}); LISTS.owned = LISTS.owned.filter(d => !created.some(r => r.id === d.id)); I.busy = false; I.error = 'La importación se interrumpió y se deshizo: ' + B.errorMessage(e); renderDecks(); }
}

// ---------- autenticación ----------
const AU = { tab: 'in', name: '', email: '', pass: '', busy: false, err: '', msg: '' };
function renderAuth() {
  const p = $('auth'); p.innerHTML = '';
  if (!B.configured) { p.append(el('div', { class: 'card' }, el('div', { class: 'q', text: 'Falta conectar Firebase' }), el('p', { text: 'Abre js/firebase-config.js y pega la configuración de tu proyecto, como indica la guía (GUIA.md, paso 5).' }))); return; }
  const card = el('div', { class: 'card auth' });
  card.append(el('div', { class: 'logo' }, el('span', { class: 'mark', html: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="14" height="14" rx="3"/><path d="M7 3h11a3 3 0 0 1 3 3v11"/></svg>' }), el('div', {}, el('b', { text: 'MyCards' }), el('span', { class: 'note', text: 'Estudio médico con repetición espaciada' }))));
  if (AU.tab !== 'reset') card.append(el('div', { class: 'seg', role: 'tablist' },
    el('button', { role: 'tab', 'aria-selected': String(AU.tab === 'in'), onclick: () => { AU.tab = 'in'; AU.err = ''; renderAuth(); } }, 'Entrar'),
    el('button', { role: 'tab', 'aria-selected': String(AU.tab === 'up'), onclick: () => { AU.tab = 'up'; AU.err = ''; renderAuth(); } }, 'Crear cuenta')));
  card.append(el('button', { class: 'gbtn', type: 'button', disabled: AU.busy ? true : null, onclick: async () => { AU.busy = true; AU.err = ''; renderAuth(); try { await B.signInGoogle(); } catch (e) { AU.err = B.errorMessage(e); } AU.busy = false; if (!USER) renderAuth(); } },
    el('span', { html: '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>' }), 'Continuar con Google'),
    B.appleEnabled ? el('button', { class: 'gbtn apple', type: 'button', disabled: AU.busy ? true : null, onclick: async () => { AU.busy = true; AU.err = ''; renderAuth(); try { await B.signInApple(); } catch (e) { AU.err = B.errorMessage(e); } AU.busy = false; if (!USER) renderAuth(); } },
      el('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.75 2.21 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.87.69 1.19-.02 1.94-1.08 2.66-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.31-3.55zM14.17 6.13c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.58-2.57 1.32-.56.65-1.06 1.7-.92 2.7.98.08 1.97-.5 2.58-1.24z"/></svg>' }), 'Continuar con Apple') : null,
    el('div', { class: 'divider' }, el('span', { text: 'o con tu correo' })));
  const f = el('form', { class: 'form', onsubmit: e => { e.preventDefault(); submitAuth(); } });
  if (AU.tab === 'up') f.append(field('au-name', 'Nombre', 'text', AU.name, v => AU.name = v, 'name'));
  f.append(field('au-email', 'Correo', 'email', AU.email, v => AU.email = v, 'email'));
  if (AU.tab !== 'reset') f.append(field('au-pass', 'Contraseña' + (AU.tab === 'up' ? ' (mínimo 6 caracteres)' : ''), 'password', AU.pass, v => AU.pass = v, AU.tab === 'up' ? 'new-password' : 'current-password'));
  f.append(el('button', { class: 'b primary', type: 'submit', disabled: AU.busy ? true : null }, AU.busy ? 'Un momento…' : AU.tab === 'in' ? 'Entrar' : AU.tab === 'up' ? 'Crear cuenta' : 'Enviar enlace'));
  card.append(f);
  if (!AU.err && B.redirectError) { AU.err = B.errorMessage(B.redirectError); B.redirectError = null; }
  if (AU.err) card.append(el('p', { class: 'note', style: 'color:var(--bad);margin-top:10px', text: AU.err }));
  if (AU.msg) card.append(el('p', { class: 'note', style: 'color:var(--good);margin-top:10px', text: AU.msg }));
  card.append(el('div', { class: 'btnrow', style: 'margin-top:12px;justify-content:center' },
    AU.tab === 'in' ? el('button', { class: 'linkbtn', onclick: () => { AU.tab = 'reset'; AU.err = ''; AU.msg = ''; renderAuth(); } }, '¿Olvidaste tu contraseña?') : null,
    AU.tab === 'reset' ? el('button', { class: 'linkbtn', onclick: () => { AU.tab = 'in'; AU.err = ''; AU.msg = ''; renderAuth(); } }, 'Volver a entrar') : null));
  card.append(el('p', { class: 'note', style: 'margin-top:14px;text-align:center' }, (AU.tab === 'up' ? 'Al crear tu cuenta aceptas la ' : 'Consulta la '), el('a', { href: 'privacidad.html', target: '_blank', rel: 'noopener', text: 'política de privacidad' }), '.'));
  p.append(card);
}
function field(id, label, type, val, set, ac) { const i = el('input', { type, id, autocomplete: ac, required: true }); i.value = val; i.addEventListener('input', () => set(i.value)); return el('div', { class: 'field' }, el('label', { for: id, text: label }), i); }
async function submitAuth() {
  AU.busy = true; AU.err = ''; AU.msg = ''; renderAuth();
  try {
    if (AU.tab === 'in') await B.signIn(AU.email, AU.pass);
    else if (AU.tab === 'up') { if (!AU.name.trim()) throw { message: 'Escribe tu nombre.' }; await B.signUp(AU.name, AU.email, AU.pass); const u = await B.refreshUser().catch(() => null); if (u) { USER = u; B.setUserDoc({ name: u.name }).catch(() => {}); $('acct-avatar').replaceChildren(avatar()); render(); } }
    else { await B.resetPassword(AU.email); AU.msg = 'Te enviamos un enlace para crear una nueva contraseña. Revisa tu correo (y spam).'; }
  } catch (e) { AU.err = B.errorMessage(e); }
  AU.busy = false; if (!USER) renderAuth();
}

// ---------- teclado ----------
document.addEventListener('keydown', e => {
  if (LB) { if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); } return; }
  const tg = e.target.tagName; if (!USER || !CUR || tg === 'TEXTAREA' || tg === 'SELECT' || tg === 'INPUT' || e.altKey || e.ctrlKey || e.metaKey || EDIT || SHARE) return;
  if (mode === 'cards' && CS && CS.cur < CS.queue.length) {
    if (e.key === ' ' || e.key === 'Enter') { if (!CS.flipped) { e.preventDefault(); CS.flipped = true; renderCards(); } }
    else if (CS.flipped && ['1', '2', '3', '4'].includes(e.key)) rate(+e.key);
    else if (e.key.toLowerCase() === 'e') { e.preventDefault(); openEdit(CS.queue[CS.cur], 'cards'); }
  } else if (mode === 'quiz' && QS && QS.i < QS.qs.length) {
    const q = QS.qs[QS.i]; const k = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 }[e.key.toLowerCase()];
    if (QS.picked === null && k !== undefined && q.order[k] !== undefined) pick(q.order[k]);
    else if (QS.picked !== null && e.key === 'Enter') { e.preventDefault(); QS.i++; QS.picked = null; renderQuiz(); }
  }
});

// ---------- arranque ----------
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (mode === 'account') renderAccount(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.__MOCK_BACKEND__) navigator.serviceWorker.register('sw.js').catch(() => {});
const wantedCode = cleanCode(new URL(location.href).searchParams.get('serie') || '');
function showApp(on) { $('boot').hidden = true; $('auth').hidden = on; $('main').hidden = !on; }
B.onUser(async u => {
  USER = u;
  if (!u) { if (CUR && CUR.unsub) CUR.unsub(); CUR = null; LISTS = { owned: [], shared: [], saved: [] }; mode = 'decks'; showApp(false); renderAuth(); return; }
  showApp(true); $('acct-avatar').replaceChildren(avatar());
  for (const m of MODES) $('panel-' + m).hidden = m !== 'decks';
  $('panel-decks').replaceChildren(el('div', { class: 'card empty', text: 'Cargando tus mazos…' }));
  const d = await B.getUserDoc().catch(() => null);
  UDOC = Object.assign({ library: [], current: null, settings: {} }, d || {});
  if (!d) B.setUserDoc({ name: u.name, email: u.email, created: Date.now(), library: [], current: null, settings: {} }).catch(() => {});
  await loadLists();
  let start = UDOC.current && findMeta(UDOC.current) ? UDOC.current : null;
  if (wantedCode) {
    history.replaceState(null, '', location.pathname);
    const r = wantedCode.length === 8 ? await B.findByCode(wantedCode).catch(() => null) : null;
    if (!r) toast('No existe ningún mazo con el número de serie ' + fmtCode(wantedCode) + '.');
    else if (!r.deck) toast('Ese mazo es privado: pídele a su dueño que te dé acceso.');
    else if (findMeta(r.deck.id)) start = r.deck.id; else INCOMING = r.deck;
  }
  mode = start ? 'cards' : 'decks';
  await switchDeck(start);
});
