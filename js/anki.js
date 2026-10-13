// MyCards · lector de mazos de Anki (.apkg / .colpkg).
// Lee los dos formatos de Anki sin librerías pesadas:
//   · antiguo (collection.anki2 / collection.anki21): zip + SQLite, notetipos en JSON;
//   · actual (collection.anki21b, Anki 2.1.50+): zip + Zstandard + SQLite (esquema 18), notetipos en protobuf.
// Pasos: abre el zip → descomprime la colección → la lee con un lector SQLite propio (sólo lectura)
// → arma cada tarjeta con las plantillas del tipo de nota (igual que Anki) → texto limpio + imágenes.
// Las imágenes no se leen hasta el momento de importar (media(name) → Blob), para no cargar cientos de MB.

import { decompress as zstd } from './vendor/fzstd.js';
import { htmlToText } from './importer.js';

// ================================================================ zip
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 4294967296;

export function fileSource(file) {
  return { size: file.size, read: async (off, len) => new Uint8Array(await file.slice(off, off + len).arrayBuffer()) };
}
export function bytesSource(u8) { return { size: u8.length, read: async (off, len) => u8.subarray(off, off + len) }; }

async function openZip(src) {
  const tailLen = Math.min(src.size, 65557 + 22);
  const tail = await src.read(src.size - tailLen, tailLen);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('no-zip');
  let count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) { // zip64
    const loc = e - 20;
    if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
      const recOff = u64(tail, loc + 8); const rec = await src.read(recOff, 56);
      if (u32(rec, 0) === 0x06064b50) { count = u64(rec, 32); cdSize = u64(rec, 40); cdOff = u64(rec, 48); }
    }
  }
  const cd = await src.read(cdOff, cdSize);
  const entries = new Map(); let p = 0;
  const dec = new TextDecoder();
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10); let csize = u32(cd, p + 20), usize = u32(cd, p + 24);
    const nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32); let off = u32(cd, p + 42);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
    let x = p + 46 + nlen; const xend = x + xlen;
    while (x + 4 <= xend) { const id = u16(cd, x), sz = u16(cd, x + 2); if (id === 1) { let q = x + 4; if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; } if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; } if (off === 0xffffffff) { off = u64(cd, q); } } x += 4 + sz; }
    entries.set(name, { method, csize, usize, off });
    p = xend + clen;
  }
  return {
    has: n => entries.has(n),
    names: () => [...entries.keys()],
    async read(name) {
      const en = entries.get(name); if (!en) return null;
      const h = await src.read(en.off, 30); if (u32(h, 0) !== 0x04034b50) throw new Error('zip-corrupt');
      const data = await src.read(en.off + 30 + u16(h, 26) + u16(h, 28), en.csize);
      if (en.method === 0) return data.slice();
      if (en.method === 8) return inflateRaw(data);
      throw new Error('zip-method-' + en.method);
    }
  };
}
async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const isZstd = b => b && b.length >= 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

// ================================================================ protobuf (sólo lectura, lo mínimo)
function pbRead(buf) { // → Map<campo, [valores]> (varint como Number, length-delimited como Uint8Array)
  const out = new Map(); let p = 0;
  const varint = () => { let r = 0, m = 1, b; do { b = buf[p++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80 && p < buf.length); return r; };
  while (p < buf.length) {
    const key = varint(), f = Math.floor(key / 8), t = key & 7; let v;
    if (t === 0) v = varint(); else if (t === 2) { const n = varint(); v = buf.subarray(p, p + n); p += n; } else if (t === 1) { v = buf.subarray(p, p + 8); p += 8; } else if (t === 5) { v = buf.subarray(p, p + 4); p += 4; } else break;
    if (!out.has(f)) out.set(f, []); out.get(f).push(v);
  }
  return out;
}
const pbStr = (m, f) => m.has(f) ? new TextDecoder().decode(m.get(f)[0]) : '';
const pbNum = (m, f) => m.has(f) ? m.get(f)[0] : 0;

// ================================================================ SQLite (sólo lectura)
export function openSqlite(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (new TextDecoder().decode(buf.subarray(0, 15)) !== 'SQLite format 3') throw new Error('no-sqlite');
  let pageSize = dv.getUint16(16); if (pageSize === 1) pageSize = 65536;
  const usable = pageSize - buf[20];
  const encNum = dv.getUint32(56); const td = new TextDecoder(encNum === 2 ? 'utf-16le' : encNum === 3 ? 'utf-16be' : 'utf-8');
  const page = n => buf.subarray((n - 1) * pageSize, n * pageSize);
  function varint(b, p) { let r = 0; for (let i = 0; i < 8; i++) { const c = b[p + i]; r = r * 128 + (c & 0x7f); if (!(c & 0x80)) return [r, p + i + 1]; } return [r * 256 + b[p + 8], p + 9]; }
  function payload(pg, p, size, isIndex) {
    const X = isIndex ? Math.floor((usable - 12) * 64 / 255) - 23 : usable - 35;
    if (size <= X) return pg.subarray(p, p + size);
    const M = Math.floor((usable - 12) * 32 / 255) - 23;
    let K = M + ((size - M) % (usable - 4)); const local = K <= X ? K : M;
    const out = new Uint8Array(size); out.set(pg.subarray(p, p + local), 0);
    let got = local, next = new DataView(pg.buffer, pg.byteOffset + p + local, 4).getUint32(0);
    while (got < size && next) { const op = page(next); const n = Math.min(usable - 4, size - got); out.set(op.subarray(4, 4 + n), got); got += n; next = (op[0] * 16777216) + (op[1] << 16) + (op[2] << 8) + op[3]; }
    return out;
  }
  function record(b) {
    let [hs, p] = varint(b, 0); const types = []; while (p < hs) { let t; [t, p] = varint(b, p); types.push(t); }
    const vals = []; let q = hs; const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (const t of types) {
      if (t === 0) vals.push(null);
      else if (t >= 1 && t <= 6) { const n = [0, 1, 2, 3, 4, 6, 8][t]; let r = 0; for (let i = 0; i < n; i++) r = r * 256 + b[q + i]; if (b[q] & 0x80) r -= Math.pow(2, 8 * n); vals.push(r); q += n; }
      else if (t === 7) { vals.push(v.getFloat64(q)); q += 8; }
      else if (t === 8) vals.push(0); else if (t === 9) vals.push(1);
      else if (t >= 12 && t % 2 === 0) { const n = (t - 12) / 2; vals.push(b.subarray(q, q + n)); q += n; }
      else if (t >= 13) { const n = (t - 13) / 2; vals.push(td.decode(b.subarray(q, q + n))); q += n; }
      else vals.push(null);
    }
    return vals;
  }
  function* walk(root) { // recorre un árbol B (tabla o índice) en orden; produce [rowid, valores]
    const stack = [root];
    while (stack.length) {
      const n = stack.pop(); if (typeof n === 'object') { yield n.row; continue; }
      const pg = page(n); const h = n === 1 ? 100 : 0; const type = pg[h];
      const cells = (pg[h + 3] << 8) | pg[h + 4]; const hdr = type === 2 || type === 5 ? 12 : 8;
      const ptr = i => (pg[h + hdr + 2 * i] << 8) | pg[h + hdr + 2 * i + 1];
      const right = hdr === 12 ? (pg[h + 8] * 16777216) + (pg[h + 9] << 16) + (pg[h + 10] << 8) + pg[h + 11] : 0;
      const todo = [];
      for (let i = 0; i < cells; i++) {
        let p = ptr(i);
        if (type === 13) { let size, rowid; [size, p] = varint(pg, p); [rowid, p] = varint(pg, p); todo.push({ row: [rowid, record(payload(pg, p, size, false))] }); }
        else if (type === 5) { const child = (pg[p] * 16777216) + (pg[p + 1] << 16) + (pg[p + 2] << 8) + pg[p + 3]; todo.push(child); }
        else if (type === 10) { let size; [size, p] = varint(pg, p); todo.push({ row: [null, record(payload(pg, p, size, true))] }); }
        else if (type === 2) { const child = (pg[p] * 16777216) + (pg[p + 1] << 16) + (pg[p + 2] << 8) + pg[p + 3]; let size; [size, p] = varint(pg, p + 4); todo.push(child, { row: [null, record(payload(pg, p, size, true))] }); }
      }
      if (right) todo.push(right);
      for (let i = todo.length - 1; i >= 0; i--) stack.push(todo[i]);
    }
  }
  // Esquema: nombres de columnas y página raíz de cada tabla
  const tables = {};
  for (const [, r] of walk(1)) {
    const [type, name, , root, sql] = r;
    if (type !== 'table' || !sql) continue;
    tables[String(name).toLowerCase()] = { root, ...parseCreate(sql) };
  }
  return {
    has: t => !!tables[t],
    *rows(t) {
      const T = tables[t]; if (!T) return;
      for (const [rowid, vals] of walk(T.root)) {
        const o = {};
        if (T.withoutRowid) { T.pkOrder.forEach((c, i) => { o[c] = vals[i]; }); }
        else T.cols.forEach((c, i) => { o[c] = i === T.alias ? rowid : (i < vals.length ? vals[i] : null); });
        yield o;
      }
    },
    all(t) { return [...this.rows(t)]; }
  };
}
function parseCreate(sql) {
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  const parts = []; let depth = 0, cur = '';
  for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  const cols = []; let alias = -1, pk = null;
  for (let raw of parts) {
    const s = raw.replace(/--[^\n]*/g, '').trim(); if (!s) continue;
    const m = s.match(/^(?:primary\s+key|unique|check|foreign\s+key|constraint)\b/i);
    if (m) { const k = s.match(/^primary\s+key\s*\(([^)]*)\)/i); if (k) pk = k[1].split(',').map(x => x.trim().replace(/^["`\[]|["`\]]$/g, '').toLowerCase()); continue; }
    const name = s.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/)[1].replace(/^["`\[]|["`\]]$/g, '').toLowerCase();
    if (/\binteger\b/i.test(s) && /\bprimary\s+key\b/i.test(s)) alias = cols.length;
    else if (/\bprimary\s+key\b/i.test(s)) pk = [name];
    cols.push(name);
  }
  const withoutRowid = /\)\s*without\s+rowid\s*;?\s*$/i.test(sql);
  const pkOrder = withoutRowid ? [...(pk || []), ...cols.filter(c => !(pk || []).includes(c))] : null;
  return { cols, alias, withoutRowid, pkOrder };
}

// ================================================================ plantillas de Anki
function tokenize(fmt) {
  const out = []; const re = /\{\{([\s\S]*?)\}\}/g; let last = 0, m;
  while ((m = re.exec(fmt))) { if (m.index > last) out.push({ t: fmt.slice(last, m.index) }); out.push({ tag: m[1].trim() }); last = re.lastIndex; }
  if (last < fmt.length) out.push({ t: fmt.slice(last) });
  return out;
}
function parseTpl(tokens) {
  const root = []; const stack = [{ kids: root }];
  for (const tk of tokens) {
    const top = stack[stack.length - 1];
    if (tk.t != null) { top.kids.push(tk); continue; }
    const c = tk.tag[0];
    if (c === '#' || c === '^') { const node = { sec: c, name: tk.tag.slice(1).trim(), kids: [] }; top.kids.push(node); stack.push(node); }
    else if (c === '/') { if (stack.length > 1) stack.pop(); }
    else if (c === '!') { /* comentario */ }
    else top.kids.push({ field: tk.tag });
  }
  return root;
}
const tplCache = new Map();
const nonEmpty = v => !!htmlToText(String(v || '')).text.trim() || /<img\b/i.test(String(v || ''));
const CLOZE_RE = /\{\{c(\d+)::((?:(?!\{\{c\d+::)[\s\S])*?)(?:::((?:(?!\{\{c\d+::)[\s\S])*?))?\}\}/;
export function applyCloze(text, ord, side) {
  let s = String(text || ''), guard = 0;
  while (CLOZE_RE.test(s) && guard++ < 500) {
    s = s.replace(CLOZE_RE, (m, n, inner, hint) => {
      if (+n !== ord) return inner;
      return side === 'q' ? '[' + (hint ? hint : '…') + ']' : inner;
    });
  }
  return s;
}
const hasClozeNum = (text, ord) => new RegExp('\\{\\{c' + ord + '::').test(String(text || ''));
function render(fmt, ctx) {
  let tree = tplCache.get(fmt); if (!tree) { tree = parseTpl(tokenize(fmt || '')); tplCache.set(fmt, tree); }
  const out = [];
  const val = name => {
    if (name === 'FrontSide') return ctx.front || '';
    if (name === 'Tags') return ctx.tags || '';
    if (name === 'Deck') return ctx.deck || '';
    if (name === 'Subdeck') return (ctx.deck || '').split('::').pop();
    if (name === 'Type') return ctx.ntName || '';
    if (name === 'Card' || name === 'CardFlag' || name === 'CardID') return '';
    return ctx.fields[name] != null ? ctx.fields[name] : (ctx.fieldsLower[name.toLowerCase()] != null ? ctx.fieldsLower[name.toLowerCase()] : '');
  };
  const walk = nodes => {
    for (const n of nodes) {
      if (n.t != null) out.push(n.t);
      else if (n.sec) { const v = nonEmpty(val(n.name)); if ((n.sec === '#') === v) walk(n.kids); }
      else {
        const parts = n.field.split(':'); const name = parts.pop().trim(); const filters = parts.map(f => f.trim().toLowerCase());
        if (filters.includes('type') || filters.includes('tts') || filters.includes('cloze-only')) continue;
        let v = val(name);
        for (const f of filters.slice().reverse()) {
          if (f === 'cloze') v = applyCloze(v, ctx.clozeOrd, ctx.side);
          else if (f === 'text') v = htmlToText(v).text;
          else if (f === 'furigana' || f === 'kana' || f === 'kanji') v = v.replace(/\[[^\]]*\]/g, '');
        }
        out.push(v);
      }
    }
  };
  walk(tree);
  return out.join('');
}

// ================================================================ lectura del paquete
// onProgress(texto) informa el avance. Devuelve { format:'Anki', decks:[...], media(name)→Blob|null, stats }.
export async function parseApkg(src, fileName, onProgress = () => {}) {
  const zip = await openZip(src).catch(() => { throw new Error('El archivo no es un .apkg válido (no se pudo abrir como zip).'); });
  // Versión del paquete (igual que Anki: archivo "meta" → si no, collection.anki21 → si no, collection.anki2)
  let version = 1;
  if (zip.has('meta')) { const m = pbRead(await zip.read('meta')); version = pbNum(m, 1) || 1; }
  else if (zip.has('collection.anki21')) version = 2;
  const colName = version >= 3 ? 'collection.anki21b' : version === 2 ? 'collection.anki21' : 'collection.anki2';
  if (!zip.has(colName)) throw new Error('El .apkg no trae la colección de Anki (' + colName + ').');
  onProgress('Descomprimiendo la colección de Anki…');
  let colBytes = await zip.read(colName);
  if (isZstd(colBytes)) colBytes = zstd(colBytes);
  onProgress('Leyendo notas y tarjetas…');
  const db = openSqlite(colBytes);

  // ---- tipos de nota y mazos
  const nts = new Map(); const deckNames = new Map();
  if (db.has('notetypes')) { // esquema 18
    const flds = new Map(), tmpls = new Map();
    for (const r of db.rows('fields')) { if (!flds.has(r.ntid)) flds.set(r.ntid, []); flds.get(r.ntid).push({ ord: r.ord, name: r.name }); }
    for (const r of db.rows('templates')) { const c = pbRead(r.config || new Uint8Array()); if (!tmpls.has(r.ntid)) tmpls.set(r.ntid, []); tmpls.get(r.ntid).push({ ord: r.ord, name: r.name, qfmt: pbStr(c, 1), afmt: pbStr(c, 2) }); }
    for (const r of db.rows('notetypes')) {
      const c = pbRead(r.config || new Uint8Array());
      nts.set(r.id, { name: r.name, cloze: pbNum(c, 1) === 1, io: pbNum(c, 9) === 6 || /image occlusion/i.test(r.name),
        fields: (flds.get(r.id) || []).sort((a, b) => a.ord - b.ord).map(f => f.name), tmpls: (tmpls.get(r.id) || []).sort((a, b) => a.ord - b.ord) });
    }
    for (const r of db.rows('decks')) deckNames.set(r.id, String(r.name).split('\x1f').join('::'));
  } else { // esquema 11 (JSON dentro de la tabla col)
    const col = db.all('col')[0] || {};
    let models = {}, decks = {};
    try { models = JSON.parse(col.models || '{}'); } catch (e) {}
    try { decks = JSON.parse(col.decks || '{}'); } catch (e) {}
    for (const k in models) { const m = models[k];
      nts.set(+k, { name: m.name, cloze: m.type === 1, io: m.originalStockKind === 6 || /image occlusion/i.test(m.name || ''),
        fields: (m.flds || []).slice().sort((a, b) => a.ord - b.ord).map(f => f.name), tmpls: (m.tmpls || []).slice().sort((a, b) => a.ord - b.ord).map(t => ({ ord: t.ord, name: t.name, qfmt: t.qfmt, afmt: t.afmt })) }); }
    for (const k in decks) deckNames.set(+k, decks[k].name);
  }

  // ---- notas
  const notes = new Map();
  for (const r of db.rows('notes')) notes.set(r.id, { mid: r.mid, flds: String(r.flds || '').split('\x1f'), tags: String(r.tags || '').trim() });

  // ---- tarjetas
  const cardsRaw = [];
  for (const r of db.rows('cards')) cardsRaw.push({ id: r.id, nid: r.nid, did: r.odid ? r.odid : r.did, ord: r.ord });
  cardsRaw.sort((a, b) => a.nid - b.nid || a.ord - b.ord);
  if (!cardsRaw.length && notes.size) for (const [nid] of notes) cardsRaw.push({ nid, did: 1, ord: 0 }); // paquete sin tarjetas (raro)

  // ---- media: nombre → índice dentro del zip
  const mediaIdx = new Map();
  if (zip.has('media')) {
    let mb = await zip.read('media');
    if (isZstd(mb)) mb = zstd(mb);
    if (version >= 3) { const m = pbRead(mb); (m.get(1) || []).forEach((e, i) => { const en = pbRead(e); const legacy = en.has(255) ? pbNum(en, 255) : i; mediaIdx.set(pbStr(en, 1).normalize('NFC'), String(legacy)); }); }
    else { try { const j = JSON.parse(new TextDecoder().decode(mb)); for (const k in j) mediaIdx.set(String(j[k]).normalize('NFC'), k); } catch (e) {} }
  }
  const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  const findMedia = raw => {
    let n = String(raw || '').trim(); if (!n || /^(https?:|data:)/i.test(n)) return /^(https?:|data:image\/)/i.test(n) ? n : null;
    const tries = [n]; try { tries.push(decodeURIComponent(n)); } catch (e) {}
    for (const t of tries) { const k = t.normalize('NFC'); if (mediaIdx.has(k) && IMG_EXT.test(k)) return 'anki-media:' + k; }
    return null;
  };

  // ---- armar las tarjetas
  onProgress('Armando las tarjetas…');
  const out = []; let skipped = 0, ioCount = 0, missingImgs = 0, svgSkipped = 0;
  for (const c of cardsRaw) {
    const note = notes.get(c.nid); if (!note) { skipped++; continue; }
    const nt = nts.get(note.mid); if (!nt) { skipped++; continue; }
    const fields = {}, fieldsLower = {};
    nt.fields.forEach((f, i) => { fields[f] = note.flds[i] != null ? note.flds[i] : ''; fieldsLower[f.toLowerCase()] = fields[f]; });
    const deck = deckNames.get(c.did) || '';
    let qHtml, aHtml;
    if (nt.io) { // oclusión de imagen: no se pueden dibujar las máscaras; se importa la imagen con encabezado y notas
      ioCount++;
      const img = fieldsLower['image'] || fieldsLower['imagen'] || nt.fields.map(f => fields[f]).find(v => /<img/i.test(v)) || '';
      const head = fieldsLower['header'] || fieldsLower['encabezado'] || '';
      const extra = [fieldsLower['back extra'], fieldsLower['comments'], fieldsLower['remarks'], fieldsLower['extra'], fieldsLower['sources']].filter(v => v && nonEmpty(v)).join('<br>');
      qHtml = (head || 'Oclusión de imagen') + '<br>' + img; aHtml = extra || ' ';
    } else {
      const ctx = { fields, fieldsLower, tags: note.tags, deck, ntName: nt.name, clozeOrd: c.ord + 1 };
      const tpl = nt.cloze ? nt.tmpls[0] : nt.tmpls.find(t => t.ord === c.ord) || nt.tmpls[c.ord];
      if (!tpl) { skipped++; continue; }
      if (nt.cloze && !nt.fields.some(f => hasClozeNum(fields[f], c.ord + 1))) { skipped++; continue; }
      qHtml = render(tpl.qfmt, { ...ctx, side: 'q' });
      aHtml = render(tpl.afmt, { ...ctx, side: 'a', front: render(tpl.qfmt, { ...ctx, side: 'a' }) });
      const hr = aHtml.search(/<hr[^>]*\bid\s*=\s*["']?answer["']?[^>]*>/i);
      if (hr >= 0) aHtml = aHtml.slice(hr).replace(/^<hr[^>]*>/i, '');
      else if (/\{\{\s*FrontSide\s*\}\}/.test(tpl.afmt)) { const front = render(tpl.qfmt, { ...ctx, side: 'a', front: '' }); const i = front ? aHtml.indexOf(front) : -1; if (i >= 0) aHtml = aHtml.slice(0, i) + aHtml.slice(i + front.length); }
    }
    const q = htmlToText(qHtml), a = htmlToText(aHtml);
    const resolve = list => { const res = []; for (const n of list) { if (/\.svg$/i.test(n)) { svgSkipped++; continue; } const m = findMedia(n); if (m) { if (!res.includes(m)) res.push(m); } else missingImgs++; } return res; };
    const qimg = resolve(q.imgs); const aimg = resolve(a.imgs).filter(x => !qimg.includes(x));
    let qt = q.text, at = a.text;
    if (!at && !nt.io && !nt.cloze) { /* reverso vacío: Anki muestra sólo el frente */ }
    if (!at && nt.cloze) { const rev = htmlToText(render((nt.tmpls[0] || {}).qfmt || '', { fields, fieldsLower, tags: note.tags, deck, ntName: nt.name, clozeOrd: c.ord + 1, side: 'a' })).text; if (rev && rev !== qt) at = rev; }
    if (nt.cloze && at === qt) { skipped++; continue; }
    if (!qt && qimg.length) qt = '¿Qué muestra la imagen?';
    if (!at && aimg.length) at = '(ver imagen)';
    if (!qt || !at) { skipped++; continue; }
    out.push({ q: qt, a: at, deck, qimg, img: aimg });
  }

  // ---- agrupar por mazo de Anki: un mazo de MyCards por cada mazo principal; los submazos pasan a temas
  const groups = new Map();
  for (const c of out) { const top = (c.deck || 'Anki').split('::')[0]; if (!groups.has(top)) groups.set(top, []); groups.get(top).push(c); }
  const base = String(fileName || 'Mazo de Anki').replace(/^.*[\\/]/, '').replace(/\.(apkg|colpkg)$/i, '').replace(/[_]+/g, ' ').trim();
  const decks = [];
  for (const [top, list] of groups) {
    const paths = list.map(c => c.deck.split('::').map(s => s.trim()));
    let k = 0; while (paths.every(p => p.length > k + 1 && p[k] === paths[0][k])) k++;
    const prefix = paths[0].slice(0, k + (paths.every(p => p.length === k + 1 && p[k] === paths[0][k]) ? 1 : 0));
    const name = groups.size === 1 && /^(default|predeterminado|por defecto|anki)$/i.test(prefix[prefix.length - 1] || '') ? base : (prefix[prefix.length - 1] || top || base);
    list.forEach((c, i) => { c.topic = paths[i].slice(prefix.length).join(' › '); delete c.deck; });
    decks.push({ name, description: '', topics: [], cards: list, questions: [], warnings: [], notes: [] });
  }
  const W = decks.length ? decks[0].warnings : [];
  if (skipped) W.push(skipped === 1 ? '1 tarjeta de Anki quedó vacía (por ejemplo, sólo audio) y no se incluyó.' : skipped + ' tarjetas de Anki quedaron vacías (por ejemplo, sólo audio) y no se incluyeron.');
  if (ioCount) W.push(ioCount + ' tarjeta' + (ioCount === 1 ? ' es' : 's son') + ' de oclusión de imagen: se importan con la imagen completa y el encabezado, sin las máscaras.');
  if (missingImgs) W.push(missingImgs === 1 ? '1 imagen citada en las tarjetas no venía dentro del .apkg.' : missingImgs + ' imágenes citadas en las tarjetas no venían dentro del .apkg.');
  if (svgSkipped) W.push(svgSkipped === 1 ? '1 imagen SVG no se puede importar y se omitió.' : svgSkipped + ' imágenes SVG no se pueden importar y se omitieron.');
  const cache = new Map();
  return {
    format: version >= 3 ? 'Anki (formato actual)' : 'Anki',
    decks,
    stats: { notes: notes.size, cards: cardsRaw.length, media: mediaIdx.size },
    async media(src) { // 'anki-media:nombre' → Blob de la imagen
      const name = src.replace(/^anki-media:/, ''); if (cache.has(name)) return cache.get(name);
      const idx = mediaIdx.get(name); if (idx == null) return null;
      let b = await zip.read(idx); if (!b) return null; if (isZstd(b)) b = zstd(b);
      const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'png';
      const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' }[ext.toLowerCase()] || 'image/png';
      const blob = new Blob([b], { type }); cache.set(name, blob); return blob;
    }
  };
}
