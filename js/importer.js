// MyCards · lector de archivos para importar mazos.
// Convierte CSV / TSV / TXT (Excel, Google Sheets, Quizlet, Anki en texto), Excel (.xlsx) y JSON
// en "mazos" listos para crear:  { name, description, topics: [nombres], cards: [...], questions: [...] }
//   tarjeta:  { q, a, topic, img: [url o data:] }
//   pregunta: { q, o: [opciones], k: índice correcto (0 = primera), e: explicación, topic }
// No toca la base de datos: sólo lee y normaliza. Así se puede probar por separado.

export const LIMITS = { q: 5000, a: 20000, e: 5000, opt: 1000, name: 100, desc: 1000, topics: 300, imgs: 12, maxCards: 15000 };

// ---------------------------------------------------------------- utilidades de texto
const strip = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  uuml: 'ü', Uuml: 'Ü', iquest: '¿', iexcl: '¡', deg: '°', micro: 'µ', plusmn: '±', times: '×', divide: '÷', le: '≤', ge: '≥', rarr: '→', larr: '←', uarr: '↑', darr: '↓',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', shy: '' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e] != null ? ENT[e] : (ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m);
  });
}
const looksHtml = s => /<\s*(br|div|p|b|i|u|span|img|li|ul|ol|sub|sup|font|strong|em|table|tr|td|hr|h\d)\b[^>]*>|&(nbsp|amp|lt|gt|#\d+);/i.test(s);

// Quita el HTML (Anki y Quizlet lo usan) dejando saltos de línea y viñetas. Devuelve también las imágenes encontradas.
export function htmlToText(s) {
  const imgs = [];
  let t = String(s == null ? '' : s);
  t = t.replace(/<img\b[^>]*?src\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (m, _q, a, b, c) => { imgs.push(decodeEntities(a || b || c || '')); return ''; });
  t = t.replace(/\[sound:[^\]]*\]/gi, '');
  t = t.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|tr|table|ul|ol)>/gi, '\n').replace(/<(p|div|h\d|tr)\b[^>]*>/gi, '\n');
  t = t.replace(/<li\b[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '').replace(/<\/t[dh]>/gi, '  ').replace(/<hr\b[^>]*>/gi, '\n—\n');
  t = t.replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '^$1').replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, '_$1');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeEntities(t).replace(/ /g, ' ');
  return { text: clean(t.replace(/[ \t]{2,}/g, ' ')), imgs };
}

// Cloze de Anki: {{c1::respuesta::pista}} → en la pregunta "[…]" (o la pista); en la respuesta, el texto completo.
const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
export const hasCloze = s => /\{\{c\d+::/.test(s);
export function clozeQ(s) { return s.replace(CLOZE, (m, ans, hint) => '[' + (hint ? hint : '…') + ']'); }
export function clozeA(s) { return s.replace(CLOZE, (m, ans) => ans); }

// ---------------------------------------------------------------- lectura de bytes
// Excel en Windows guarda CSV en "ANSI" (windows-1252); si no es UTF-8 válido, se lee así para no dañar tildes.
export function decodeBytes(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
  catch (e) { return new TextDecoder('windows-1252').decode(u8); }
}

// ---------------------------------------------------------------- CSV
const SEP_NAMES = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', colon: ':', space: ' ', '\\t': '\t' };

function guessDelimiter(lines) {
  const sample = lines.slice(0, 30);
  const cands = ['\t', ';', ',', '|'];
  let best = null, bestScore = -1;
  for (const d of cands) {
    const counts = sample.map(l => countOutsideQuotes(l, d)).filter(n => n > 0);
    if (!counts.length) continue;
    const mode = counts.sort((a, b) => counts.filter(x => x === b).length - counts.filter(x => x === a).length)[0];
    const consistent = counts.filter(n => n === mode).length / sample.length;
    const score = consistent * 10 + (d === '\t' ? 2 : 0) + Math.min(mode, 6) * 0.1; // la tabulación casi nunca aparece en el texto
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best || ',';
}
function countOutsideQuotes(line, d) { let n = 0, q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; }

// Analizador CSV (RFC 4180): comillas dobles, saltos de línea dentro de una celda, "" para comillas.
export function parseDelimited(text, delim) {
  const rows = []; let row = [], cell = '', q = false, i = 0; const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell.trim() === '') { q = true; cell = ''; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// ---------------------------------------------------------------- columnas
const COLS = {
  q: ['pregunta', 'preguntas', 'frente', 'anverso', 'front', 'question', 'questions', 'term', 'termino', 'terminos', 'q', 'enunciado', 'concepto', 'palabra', 'cara a', 'lado a', 'side a', 'text', 'texto', 'prompt', 'cue'],
  a: ['respuesta', 'respuestas', 'reverso', 'dorso', 'back', 'answer', 'answers', 'definition', 'definicion', 'definiciones', 'a', 'significado', 'cara b', 'lado b', 'side b', 'back extra', 'extra', 'response'],
  topic: ['tema', 'temas', 'topic', 'topics', 'capitulo', 'chapter', 'categoria', 'category', 'seccion', 'section', 'unidad', 'unit', 'modulo', 'subtema', 'subject', 'asignatura', 'deck', 'mazo', 'subdeck'],
  tags: ['etiqueta', 'etiquetas', 'tag', 'tags'],
  correct: ['correcta', 'respuesta correcta', 'opcion correcta', 'correct', 'correct answer', 'correct option', 'answer key', 'clave', 'key', 'solucion', 'solution', 'right answer', 'k'],
  expl: ['explicacion', 'explanation', 'justificacion', 'rationale', 'comentario', 'comentarios', 'feedback', 'retroalimentacion', 'nota', 'notas', 'notes', 'razon', 'e'],
  type: ['tipo', 'type', 'clase'],
  img: ['imagen', 'imagenes', 'image', 'images', 'img', 'foto', 'figura']
};
const COLMAP = {}; for (const k in COLS) for (const name of COLS[k]) COLMAP[name] = k;
function optionCol(h) { // "opción a", "opcion 1", "option b", "a)", "alternativa c", "distractor 2"
  const m = h.match(/^(?:opcion|option|alternativa|alternativas|alt|choice|respuesta|answer|distractor|incorrecta|wrong)?\s*([a-h]|[1-8])$/);
  if (m && (h.length > 1 || /[b-h]/.test(h))) return isNaN(m[1]) ? m[1].charCodeAt(0) - 97 : +m[1] - 1;
  return null;
}
function classifyHeader(row) {
  const map = { opts: [] }; let known = 0;
  row.forEach((cell, i) => {
    const h = strip(cell); if (!h) return;
    const o = h === 'a' || h === 'q' || h === 'e' || h === 'k' ? null : optionCol(h);
    if (o != null) { map.opts.push({ i, idx: o }); known++; return; }
    const k = COLMAP[h];
    if (k && map[k] == null) { map[k] = i; known++; }
  });
  // "a" y "b"... si hay columnas a, b, c, d juntas son opciones, no "respuesta".
  const letters = row.map((c, i) => ({ h: strip(c), i })).filter(x => /^[a-h]$/.test(x.h));
  if (letters.length >= 3) { map.opts = letters.map(x => ({ i: x.i, idx: x.h.charCodeAt(0) - 97 })); if (map.a != null && letters.some(x => x.i === map.a)) delete map.a; }
  map.opts.sort((x, y) => x.idx - y.idx);
  const isHeader = known >= 1 && (map.q != null || (map.a != null && known >= 2));
  return { isHeader, map };
}

// Interpreta la respuesta correcta: letra (B), número (2 = segunda) o el texto de una opción.
export function parseCorrect(v, opts, zeroBased) {
  if (v == null) return -1;
  if (typeof v === 'number') { if (!Number.isInteger(v)) return -1; if (zeroBased) return v >= 0 && v < opts.length ? v : (v === opts.length ? v - 1 : -1); return v >= 1 && v <= opts.length ? v - 1 : -1; }
  const s = String(v).trim(); if (!s) return -1;
  const exact = opts.findIndex(o => strip(o) === strip(s)); if (exact >= 0) return exact;
  const m = s.match(/^\(?([a-hA-H])[).:]?(?:\s|$)/); if (m) { const k = m[1].toLowerCase().charCodeAt(0) - 97; if (k < opts.length) return k; }
  const n = s.match(/^\(?([1-8])[).:]?$/); if (n) { const k = +n[1] - 1; if (k < opts.length) return k; }
  const part = opts.findIndex(o => strip(o) && (strip(o).startsWith(strip(s)) || strip(s).startsWith(strip(o)))); return part;
}

// ---------------------------------------------------------------- tabla → mazo
// rows: arreglo de filas (arreglos de celdas). meta: { name, html, deckCol, tagsCol, notetypeCol, guidCol, sheet }
export function tableToDeck(rows, meta = {}) {
  const deck = newSpec(meta.name);
  const W = deck.warnings;
  if (!rows.length) { W.push('El archivo no tiene filas con contenido.'); return deck; }
  let { isHeader, map } = classifyHeader(rows[0]);
  let body = rows;
  if (isHeader) body = rows.slice(1);
  else {
    // Sin encabezados: columna 1 = pregunta, 2 = respuesta, 3 = tema (como exportan Quizlet y Anki).
    const width = Math.max(...rows.slice(0, 50).map(r => r.length));
    map = { opts: [], q: 0, a: width > 1 ? 1 : null };
    if (width > 2 && meta.deckCol == null && meta.tagsCol == null) {
      // la 3.ª columna se usa como tema sólo si se repite (parece una categoría, no una nota larga)
      const vals = rows.map(r => clean(r[2] || '')).filter(Boolean);
      const uniq = new Set(vals);
      if (vals.length && uniq.size <= Math.max(1, vals.length / 2) && [...uniq].every(v => v.length <= 80)) map.topic = 2;
    }
  }
  if (meta.deckCol != null && map.topic == null) map.deckTopic = meta.deckCol;
  if (meta.tagsCol != null && map.tags == null) map.tags = meta.tagsCol;
  if (map.q == null) { W.push('No encontré una columna de preguntas. Pon “pregunta” y “respuesta” como encabezados de la primera fila.'); return deck; }

  const html = meta.html === true || (meta.html == null && body.slice(0, 40).some(r => r.some(c => looksHtml(String(c)))));
  let deckTopics = null;
  if (map.deckTopic != null) {
    const decks = body.map(r => String(r[map.deckTopic] || '').trim());
    if (decks.length && decks.every(x => x === decks[0])) { if (decks[0] && meta.fromFileName) deck.name = decks[0].split('::').pop().trim(); }
    else deckTopics = commonPrefixStrip(decks);
  }
  const txt = (v, keep) => { const s = String(v == null ? '' : v); if (!html) return { text: clean(s), imgs: [] }; const r = htmlToText(s); if (keep) keep.push(...r.imgs); return r; };

  let mcqSkipped = 0, emptySkipped = 0;
  body.forEach((r, ri) => {
    const imgs = [];
    let q = txt(r[map.q], imgs).text;
    let a = map.a != null ? txt(r[map.a], imgs).text : '';
    const topic = map.topic != null ? txt(r[map.topic]).text : deckTopics ? deckTopics[ri] : map.tags != null ? firstTag(r[map.tags]) : (meta.sheet || '');
    const opts = map.opts.map(o => txt(r[o.i]).text).filter(Boolean);
    const typ = map.type != null ? strip(r[map.type]) : '';
    if (map.img != null) String(r[map.img] || '').split(/[\s,;]+/).filter(u => /^(https?:|data:image\/)/.test(u)).forEach(u => imgs.push(u));
    const wantsMcq = opts.length >= 2 && (map.correct != null || typ.startsWith('opc') || typ === 'mcq');
    if (wantsMcq) {
      const k = parseCorrect(map.correct != null ? txt(r[map.correct]).text : a, opts, false);
      if (!q || k < 0 || opts.length > 8) { mcqSkipped++; return; }
      deck.questions.push({ q, o: opts, k, e: map.expl != null ? txt(r[map.expl]).text : (map.correct != null ? a : ''), topic });
      return;
    }
    if (hasCloze(q)) { const full = q; q = clozeQ(full); a = a ? clozeA(full) + '\n\n' + a : clozeA(full); }
    if (!q || !a) { if (q || a) emptySkipped++; return; }
    if (map.expl != null) { const e = txt(r[map.expl]).text; if (e) a += '\n\n' + e; }
    deck.cards.push({ q, a, topic, img: imgs });
  });
  if (emptySkipped) W.push(plural(emptySkipped, 'fila no tenía', 'filas no tenían') + ' pregunta y respuesta completas y no se incluyeron.');
  if (mcqSkipped) W.push(plural(mcqSkipped, 'pregunta de opción múltiple no tenía', 'preguntas de opción múltiple no tenían') + ' una respuesta correcta válida y no se incluyeron.');
  if (!isHeader && !meta.anki) deck.notes.push('El archivo no tiene encabezados: usé la 1.ª columna como pregunta y la 2.ª como respuesta' + (map.topic != null ? ' y la 3.ª como tema' : '') + '.');
  return finish(deck);
}
function firstTag(v) { const t = String(v || '').trim().split(/\s+/).filter(Boolean)[0] || ''; return t.split('::').pop().replace(/[_-]+/g, ' ').trim(); }
function commonPrefixStrip(list) { // "AnKing::Anatomía::Laringe" → quita la parte común y deja el subtema
  const parts = list.map(s => s.split('::').map(x => x.trim()));
  let k = 0; while (parts.length && parts.every(p => p.length > k + 1 && p[k] === parts[0][k])) k++;
  return parts.map(p => p.slice(k).join(' › '));
}

// ---------------------------------------------------------------- texto (CSV / TSV / TXT de Anki o Quizlet)
export function parseText(text, fileName) {
  const name = baseName(fileName);
  let lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const meta = { name, fromFileName: true };
  // Encabezados de Anki: #separator:tab, #html:true, #deck column:3, #tags column:4 ...
  let skip = 0;
  for (const l of lines) {
    const m = l.match(/^#([a-z ]+):(.*)$/i); if (!m) break; skip++;
    const key = m[1].trim().toLowerCase(), val = m[2].trim();
    meta.anki = true;
    if (key === 'separator') meta.sep = SEP_NAMES[val.toLowerCase()] || val[0];
    else if (key === 'html') meta.html = val === 'true';
    else if (key === 'deck column') meta.deckCol = +val - 1;
    else if (key === 'tags column') meta.tagsCol = +val - 1;
    else if (key === 'notetype column') meta.notetypeCol = +val - 1;
    else if (key === 'guid column') meta.guidCol = +val - 1;
    else if (key === 'deck') meta.name = meta.name || val;
  }
  const bodyText = lines.slice(skip).join('\n');
  const delim = meta.sep || guessDelimiter(lines.slice(skip).filter(l => l.trim()));
  let rows = parseDelimited(bodyText, delim);
  // Si Anki incluye columnas técnicas (guid / tipo de nota), se quitan antes de leer.
  const drop = [meta.guidCol, meta.notetypeCol].filter(x => x != null).sort((a, b) => b - a);
  if (drop.length) {
    rows = rows.map(r => { r = r.slice(); drop.forEach(i => r.splice(i, 1)); return r; });
    const shift = i => i == null ? i : i - drop.filter(d => d < i).length;
    meta.deckCol = shift(meta.deckCol); meta.tagsCol = shift(meta.tagsCol);
  }
  // Una sola columna con "pregunta - respuesta" (exportación rápida de Quizlet).
  if (rows.length && rows.every(r => r.length === 1)) {
    const seps = [' - ', ' – ', ' — ', ': ', ' = '];
    const sep = seps.find(s => rows.filter(r => r[0].includes(s)).length >= rows.length * 0.8);
    if (sep) rows = rows.map(r => { const i = r[0].indexOf(sep); return i < 0 ? [r[0]] : [r[0].slice(0, i), r[0].slice(i + sep.length)]; });
  }
  const deck = tableToDeck(rows, meta);
  return { format: delim === '\t' ? 'Texto con tabulaciones' : 'CSV', decks: [deck] };
}

// ---------------------------------------------------------------- Excel
export function parseSheets(sheets, fileName) { // sheets: [{ name, rows }]
  const name = baseName(fileName);
  const used = sheets.filter(s => s.rows.some(r => r.some(c => String(c == null ? '' : c).trim())));
  if (!used.length) { const d = newSpec(name); d.warnings.push('El libro de Excel está vacío.'); return { format: 'Excel', decks: [d] }; }
  // Varias hojas: cada hoja pasa a ser un tema del mismo mazo (si la hoja no trae su propia columna de tema).
  const parts = used.map(s => tableToDeck(s.rows.map(r => r.map(c => c == null ? '' : String(c))), { name, sheet: used.length > 1 ? s.name : '' }));
  if (parts.length === 1) return { format: 'Excel', decks: parts };
  const d = newSpec(name);
  for (const p of parts) { d.cards.push(...p.cards); d.questions.push(...p.questions); d.warnings.push(...p.warnings.map(w => '“' + used[parts.indexOf(p)].name + '”: ' + w)); }
  d.notes.push('El libro tiene ' + used.length + ' hojas: cada hoja quedó como un tema.');
  return { format: 'Excel', decks: [finish(d)] };
}

// ---------------------------------------------------------------- JSON
const KEYS = {
  q: ['q', 'pregunta', 'question', 'front', 'frente', 'anverso', 'term', 'termino', 'prompt', 'enunciado', 'concepto', 'text', 'texto', 'stem'],
  a: ['a', 'respuesta', 'answer', 'back', 'reverso', 'dorso', 'definition', 'definicion', 'significado', 'response'],
  o: ['o', 'options', 'opciones', 'choices', 'alternativas', 'alternatives', 'answers', 'respuestas', 'distractores'],
  k0: ['k', 'correctindex', 'answerindex', 'correct_index', 'answer_index', 'correctoption', 'indicecorrecto', 'indice_correcto'],
  k: ['correct', 'correcta', 'correctanswer', 'correct_answer', 'respuestacorrecta', 'respuesta_correcta', 'key', 'clave', 'solution', 'solucion', 'answer', 'respuesta'],
  e: ['e', 'explanation', 'explicacion', 'rationale', 'justificacion', 'feedback', 'comentario', 'notes', 'nota', 'extra'],
  topic: ['topic', 'tema', 'chapter', 'capitulo', 'category', 'categoria', 'section', 'seccion', 'unit', 'unidad', 'subject', 'deck', 'tag', 'tags', 'etiquetas'],
  img: ['img', 'imgs', 'image', 'images', 'imagen', 'imagenes', 'figura', 'figure', 'picture']
};
const keyOf = (obj, list) => { const ks = Object.keys(obj); for (const want of list) { const f = ks.find(k => strip(k).replace(/ /g, '') === want.replace(/_/g, '')); if (f != null && obj[f] != null && obj[f] !== '') return f; } return null; };
const LIST_KEYS = ['cards', 'tarjetas', 'flashcards', 'notes', 'notas', 'items', 'questions', 'preguntas', 'quiz', 'mcqs', 'data', 'entries', 'terms', 'deck', 'mazo'];
const toText = v => Array.isArray(v) ? v.map(toText).join('\n') : v != null && typeof v === 'object' ? (v.text || v.value || v.content || JSON.stringify(v)) : String(v == null ? '' : v);

export function parseJSONText(text, fileName) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); }
  catch (e) {
    // JSON con comas finales o comentarios (frecuente al copiarlo de un chat): se intenta reparar una vez.
    try { data = JSON.parse(text.replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '$1')); }
    catch (e2) { const d = newSpec(baseName(fileName)); d.warnings.push('El archivo JSON tiene un error de formato y no se pudo leer (' + (e.message || 'JSON inválido').replace(/^JSON\.parse: /, '') + ').'); return { format: 'JSON', decks: [d] }; }
  }
  if (data && data.app === 'repaso-laringologia') return { format: 'claude-app', decks: [], raw: data };
  const name = baseName(fileName);
  // Varios mazos: { decks: [ {...}, {...} ] }
  if (data && !Array.isArray(data) && Array.isArray(data.decks || data.mazos) && (data.decks || data.mazos).some(x => x && typeof x === 'object' && !Array.isArray(x) && findLists(x).length)) {
    return { format: data.format === 'mycards' ? 'MyCards' : 'JSON', decks: (data.decks || data.mazos).filter(x => x && typeof x === 'object').map((x, i) => jsonDeck(x, (x.name || x.nombre || x.title || name + ' ' + (i + 1)))) };
  }
  return { format: data && data.format === 'mycards' ? 'MyCards' : 'JSON', decks: [jsonDeck(data, name)] };
}
function findLists(obj) { // arreglos de objetos dentro del objeto (cards, questions...)
  if (Array.isArray(obj)) return [obj];
  if (!obj || typeof obj !== 'object') return [];
  const out = [];
  for (const k of Object.keys(obj)) { const v = obj[k]; if (Array.isArray(v) && v.length && v.some(x => (x && typeof x === 'object') || Array.isArray(x))) out.push({ key: k, list: v }); }
  // { "Anatomía": [ ... ], "Fisiología": [ ... ] } → cada clave es un tema
  return out;
}
function jsonDeck(src, fallbackName) {
  const d = newSpec(fallbackName);
  if (src && !Array.isArray(src) && typeof src === 'object') {
    const nm = src.name || src.nombre || src.title || src.titulo || src.deck || src.mazo; if (typeof nm === 'string' && nm.trim()) d.name = nm.trim();
    const ds = src.description || src.descripcion; if (typeof ds === 'string') d.description = ds.trim();
  }
  let lists = Array.isArray(src) ? [{ key: '', list: src }] : findLists(src);
  if (!lists.length && src && typeof src === 'object') { // { "pregunta": "respuesta", ... }
    const pairs = Object.entries(src).filter(([k, v]) => typeof v === 'string' && !['name', 'nombre', 'title', 'description', 'descripcion', 'format', 'version'].includes(k));
    if (pairs.length) lists = [{ key: '', list: pairs.map(([q, a]) => ({ q, a })) }];
  }
  const topicKeys = lists.length > 1 && lists.every(l => !LIST_KEYS.includes(strip(l.key).replace(/ /g, '')));
  let bad = 0, badMcq = 0;
  for (const { key, list } of lists) {
    const listTopic = topicKeys ? key : '';
    for (const it of list) {
      let item = it;
      if (Array.isArray(it)) item = { q: it[0], a: it[1], topic: it[2] };
      if (!item || typeof item !== 'object') { bad++; continue; }
      const kq = keyOf(item, KEYS.q), ko = keyOf(item, KEYS.o), ke = keyOf(item, KEYS.e), kt = keyOf(item, KEYS.topic), ki = keyOf(item, KEYS.img);
      const htmlish = s => looksHtml(s) ? htmlToText(s).text : clean(s);
      const q = kq ? htmlish(toText(item[kq])) : '';
      let topic = kt ? toText(Array.isArray(item[kt]) ? item[kt][0] : item[kt]).split('::').pop().trim() : listTopic;
      const imgs = ki ? [].concat(item[ki]).filter(u => typeof u === 'string' && /^(https?:|data:image\/)/.test(u.trim())).map(u => u.trim()) : [];
      let opts = ko && Array.isArray(item[ko]) ? item[ko] : null;
      if (!opts && ko && item[ko] && typeof item[ko] === 'object') opts = Object.keys(item[ko]).sort().map(k => item[ko][k]); // {A: "...", B: "..."}
      if (opts && opts.length >= 2 && opts.every(o => o == null || typeof o !== 'object' || 'text' in o || 'texto' in o)) {
        // Opciones como objetos { text, correct: true }
        let kFromObj = -1;
        const texts = opts.map((o, i) => { if (o && typeof o === 'object') { if (o.correct === true || o.correcta === true || o.isCorrect === true) kFromObj = i; return htmlish(String(o.text || o.texto || '')); } return htmlish(String(o == null ? '' : o)); });
        const kk0 = keyOf(item, KEYS.k0), kk = keyOf(item, KEYS.k);
        let k = kFromObj;
        if (k < 0 && kk0 != null) k = parseCorrect(item[kk0], texts, true);
        if (k < 0 && kk != null && kk !== ko) k = parseCorrect(item[kk], texts, typeof item[kk] === 'number');
        if (!q || k < 0 || texts.length > 8 || texts.some(t => !t)) { badMcq++; continue; }
        d.questions.push({ q, o: texts, k, e: ke ? htmlish(toText(item[ke])) : '', topic, img: imgs });
        continue;
      }
      const ka = keyOf(item, KEYS.a);
      let a = ka && ka !== kq ? htmlish(toText(item[ka])) : '';
      let qq = q;
      if (hasCloze(qq)) { const full = qq; qq = clozeQ(full); a = a ? clozeA(full) + '\n\n' + a : clozeA(full); }
      if (ke && ke !== ka) { const e = htmlish(toText(item[ke])); if (e) a = a ? a + '\n\n' + e : a; }
      if (!qq || !a) { bad++; continue; }
      d.cards.push({ q: qq, a, topic, img: imgs });
    }
  }
  if (!lists.length) d.warnings.push('No encontré tarjetas en el archivo. Revisa que tenga una lista “cards” con “q” y “a”.');
  if (bad) d.warnings.push(plural(bad, 'elemento no tenía', 'elementos no tenían') + ' pregunta y respuesta y no se incluyeron.');
  if (badMcq) d.warnings.push(plural(badMcq, 'pregunta de opción múltiple no tenía', 'preguntas de opción múltiple no tenían') + ' una respuesta correcta válida y no se incluyeron.');
  return finish(d);
}

// ---------------------------------------------------------------- entrada principal
// file: File del navegador. loadXLSX: función que carga la librería de Excel sólo cuando hace falta.
export async function parseFile(file, { loadXLSX } = {}) {
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
  const e = ext.toLowerCase();
  if (e === 'apkg' || e === 'colpkg') return { format: 'Anki', decks: [], unsupported: 'Los mazos de Anki (.apkg) todavía no se pueden subir directamente. Mientras tanto, en Anki usa Archivo → Exportar → “Notas en texto plano (.txt)” y sube ese archivo.' };
  if (e === 'xlsx' || e === 'xls' || e === 'ods' || e === 'xlsm') {
    if (!loadXLSX) throw new Error('Excel no disponible');
    const XLSX = await loadXLSX();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const sheets = wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }) }));
    return parseSheets(sheets, file.name);
  }
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'zip', 'png', 'jpg', 'jpeg'].includes(e)) return { format: e.toUpperCase(), decks: [], unsupported: 'Ese tipo de archivo (.' + e + ') no es un mazo. Sube un CSV, TXT, Excel o JSON.' };
  const text = decodeBytes(await file.arrayBuffer());
  return parseAnyText(text, file.name);
}
export function parseAnyText(text, fileName) {
  const t = text.replace(/^﻿/, '').trim();
  if (/\.json$/i.test(fileName) || /^[\[{]/.test(t)) {
    const r = parseJSONText(t, fileName);
    if (r.format !== 'JSON' || r.decks.some(d => d.cards.length || d.questions.length) || /\.json$/i.test(fileName)) return r;
  }
  return parseText(text, fileName);
}

// ---------------------------------------------------------------- normalización final
function newSpec(name) { return { name: name || 'Mazo importado', description: '', topics: [], cards: [], questions: [], warnings: [], notes: [], dupes: 0 }; }
function finish(d) {
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  let trimmed = 0, lostImgs = 0;
  const okImg = u => /^(https?:\/\/|data:image\/)/i.test(u);
  for (const c of [...d.cards, ...d.questions]) { const all = c.img || []; c.img = all.filter(okImg); lostImgs += all.length - c.img.length; }
  if (lostImgs) d.warnings.push(plural(lostImgs, 'imagen no venía', 'imágenes no venían') + ' dentro del archivo (sólo su nombre) y no se pudo incluir. Puedes agregarlas después editando la tarjeta.');
  const seen = new Set(); let dupes = 0;
  d.cards = d.cards.filter(c => { const key = strip(c.q) + '|' + strip(c.a); if (seen.has(key)) { dupes++; return false; } seen.add(key); return true; });
  d.questions = d.questions.filter(c => { const key = 'mcq|' + strip(c.q) + '|' + c.o.map(strip).join('|'); if (seen.has(key)) { dupes++; return false; } seen.add(key); return true; });
  for (const c of d.cards) { if (c.q.length > LIMITS.q || c.a.length > LIMITS.a) trimmed++; c.q = cut(c.q, LIMITS.q); c.a = cut(c.a, LIMITS.a); c.img = (c.img || []).slice(0, LIMITS.imgs); }
  for (const c of d.questions) { if (c.q.length > LIMITS.q) trimmed++; c.q = cut(c.q, LIMITS.q); c.o = c.o.map(o => cut(o, LIMITS.opt)); c.e = cut(c.e, LIMITS.e); c.img = (c.img || []).slice(0, LIMITS.imgs); }
  d.name = cut(String(d.name).replace(/\s+/g, ' ').trim() || 'Mazo importado', LIMITS.name);
  d.description = cut(d.description, LIMITS.desc);
  // Temas: en orden de aparición. Si hay más de 300 o son casi uno por tarjeta, no se usan.
  const order = []; const set = new Set();
  for (const c of [...d.cards, ...d.questions]) { c.topic = cut(String(c.topic || '').replace(/\s+/g, ' ').trim(), 120); if (c.topic && !set.has(c.topic)) { set.add(c.topic); order.push(c.topic); } }
  const total = d.cards.length + d.questions.length;
  if (order.length > LIMITS.topics || (order.length > 30 && order.length > total * 0.6)) {
    d.warnings.push('Los temas eran demasiados (' + order.length + ') y parecían ser texto, no categorías: el mazo se creará sin temas.');
    for (const c of [...d.cards, ...d.questions]) c.topic = '';
    d.topics = [];
  } else d.topics = order;
  if (total > LIMITS.maxCards) { d.warnings.push('El archivo tiene ' + total + ' elementos; se importarán los primeros ' + LIMITS.maxCards + '.'); const keepQ = Math.max(0, LIMITS.maxCards - d.cards.length); d.cards = d.cards.slice(0, LIMITS.maxCards); d.questions = d.questions.slice(0, keepQ); }
  if (dupes) d.notes.push(plural(dupes, 'tarjeta repetida se omitió', 'tarjetas repetidas se omitieron') + '.');
  if (trimmed) d.warnings.push(plural(trimmed, 'texto era demasiado largo y se recortó', 'textos eran demasiado largos y se recortaron') + '.');
  d.dupes = dupes;
  return d;
}
function baseName(f) { return String(f || 'Mazo importado').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Mazo importado'; }
function plural(n, s, p) { return n + ' ' + (n === 1 ? s : p); }

// ---------------------------------------------------------------- exportar (formato MyCards)
// cards: tarjetas del mazo (como las guarda la app). imgData(id) → data: URL o null.
export async function buildExport(meta, cards, topicsMap, imgData) {
  const tname = ch => ch != null && topicsMap && topicsMap[ch] ? topicsMap[ch] : '';
  const imgs = async ids => { const out = []; for (const id of ids || []) { const d = await imgData(id); if (d) out.push(d); } return out; };
  const sorted = cards.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
  const out = { format: 'mycards', version: 1, name: meta.name, exported: new Date().toISOString() };
  if (meta.description) out.description = meta.description;
  const topics = Object.keys(topicsMap || {}).sort((a, b) => a - b).map(k => topicsMap[k]).filter(Boolean);
  if (topics.length) out.topics = topics;
  out.cards = [];
  out.questions = [];
  for (const c of sorted) {
    if (c.type === 'mcq') { const q = { q: c.q, options: c.o, correct: String.fromCharCode(65 + c.k) }; if (c.e) q.explanation = c.e; if (tname(c.ch)) q.topic = tname(c.ch); out.questions.push(q); }
    else { const x = { q: c.q, a: c.a }; if (tname(c.ch)) x.topic = tname(c.ch); const im = await imgs(c.img); if (im.length) x.img = im; out.cards.push(x); }
  }
  if (!out.questions.length) delete out.questions;
  return out;
}

// ---------------------------------------------------------------- plantillas e instrucciones
export const TEMPLATE_CSV = '﻿' + [
  'pregunta;respuesta;tema;opcion_a;opcion_b;opcion_c;opcion_d;correcta;explicacion',
  '¿Qué músculo es el único abductor de las cuerdas vocales?;Cricoaritenoideo posterior;Laringe;;;;;;',
  '¿Qué nervio inerva el músculo cricotiroideo?;Rama externa del nervio laríngeo superior;Laringe;;;;;;',
  '"¿Cuál es la causa más frecuente de parálisis bilateral de cuerdas vocales en adultos?";;Laringe;Cirugía de tiroides;Intubación prolongada;Enfermedad neurológica;Idiopática;A;"La lesión iatrogénica tras tiroidectomía es la causa más frecuente."',
].join('\r\n') + '\r\n';

export const TEMPLATE_JSON = JSON.stringify({
  format: 'mycards', version: 1,
  name: 'Laringología – ejemplo',
  description: 'Opcional: de qué trata el mazo.',
  cards: [
    { q: '¿Qué músculo es el único abductor de las cuerdas vocales?', a: 'Cricoaritenoideo posterior.', topic: 'Anatomía' },
    { q: '¿Qué nervio inerva el músculo cricotiroideo?', a: 'La rama externa del nervio laríngeo superior.', topic: 'Anatomía' }
  ],
  questions: [
    { q: '¿Cuál es la causa más frecuente de parálisis bilateral de cuerdas vocales en adultos?', options: ['Cirugía de tiroides', 'Intubación prolongada', 'Enfermedad neurológica', 'Idiopática'], correct: 'A', explanation: 'La lesión iatrogénica tras tiroidectomía es la causa más frecuente.', topic: 'Parálisis' }
  ]
}, null, 2) + '\n';

export const AI_PROMPT = `Crea un mazo de estudio para la app MyCards sobre: [TEMA]. Entrégalo como un archivo .json con exactamente esta estructura:

{
  "format": "mycards",
  "version": 1,
  "name": "Nombre del mazo",
  "description": "Una frase sobre el contenido",
  "cards": [
    { "q": "Pregunta de la tarjeta", "a": "Respuesta", "topic": "Tema" }
  ],
  "questions": [
    { "q": "Pregunta de opción múltiple", "options": ["Opción A", "Opción B", "Opción C", "Opción D"], "correct": "B", "explanation": "Por qué es correcta", "topic": "Tema" }
  ]
}

Reglas:
- "cards" son tarjetas de pregunta y respuesta; "questions" son preguntas de examen de opción múltiple (2 a 8 opciones).
- "correct" es la LETRA de la opción correcta (A = la primera).
- "topic" agrupa las tarjetas por tema; usa pocos temas y repítelos.
- Una idea por tarjeta, respuestas breves y precisas. Texto plano, sin HTML ni Markdown.
- Si no hay preguntas de opción múltiple, omite "questions".`;
