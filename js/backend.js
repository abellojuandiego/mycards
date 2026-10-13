// MyCards · capa de datos: Firebase Authentication + Cloud Firestore.
// La interfaz (app.js) sólo habla con este objeto, así que se puede cambiar de proveedor sin tocar la app.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider,
  sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot,
  increment, limit, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let B;
const configured = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('PEGA'));
let app, auth, db;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'es';
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  getRedirectResult(auth).catch(e => { B.redirectError = e; });
}

const toUser = u => u ? {
  uid: u.uid,
  name: u.displayName || (u.email ? u.email.split('@')[0] : 'Usuario'),
  email: (u.email || '').toLowerCase(),
  emailVerified: !!u.emailVerified,
  photo: u.photoURL || '',
  provider: (u.providerData[0] && u.providerData[0].providerId) || 'password'
} : null;

const uid = () => auth.currentUser && auth.currentUser.uid;
const strip = o => JSON.parse(JSON.stringify(o)); // quita undefined

B = {
  configured, redirectError: null,
  kind: 'firebase',

  // ---------- cuenta ----------
  onUser(cb) { if (!configured) { cb(null); return () => {}; } return onAuthStateChanged(auth, u => cb(toUser(u))); },
  async signUp(name, email, pass) {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    if (name) await updateProfile(cred.user, { displayName: name.trim() });
    try { await sendEmailVerification(cred.user); } catch (e) {}
    return toUser(auth.currentUser);
  },
  async signIn(email, pass) { const c = await signInWithEmailAndPassword(auth, email.trim(), pass); return toUser(c.user); },
  async signInGoogle() {
    const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { const c = await signInWithPopup(auth, p); return toUser(c.user); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
        await signInWithRedirect(auth, p); return null;
      }
      throw e;
    }
  },
  async resetPassword(email) { await sendPasswordResetEmail(auth, email.trim()); },
  async resendVerification() { if (auth.currentUser) await sendEmailVerification(auth.currentUser); },
  async refreshUser() { if (!auth.currentUser) return null; await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); return toUser(auth.currentUser); },
  async updateName(name) { await updateProfile(auth.currentUser, { displayName: name }); return toUser(auth.currentUser); },
  async signOut() { await fbSignOut(auth); },

  // ---------- datos personales ----------
  async getUserDoc() { const s = await getDoc(doc(db, 'users', uid())); return s.exists() ? s.data() : null; },
  async setUserDoc(patch) { await setDoc(doc(db, 'users', uid()), strip(patch), { merge: true }); },
  async getProgress(deckId) { const s = await getDoc(doc(db, 'users', uid(), 'progress', deckId)); return s.exists() ? s.data() : null; },
  async setProgress(deckId, data, merge) { await setDoc(doc(db, 'users', uid(), 'progress', deckId), strip(data), { merge: !!merge }); },
  async deleteProgress(deckId) { await deleteDoc(doc(db, 'users', uid(), 'progress', deckId)); },
  async getEdits(deckId) { const s = await getDoc(doc(db, 'users', uid(), 'edits', deckId)); return s.exists() ? s.data() : null; },
  async setEdits(deckId, data, merge) { await setDoc(doc(db, 'users', uid(), 'edits', deckId), strip(data), { merge: !!merge }); },

  // ---------- mazos ----------
  newId() { return doc(collection(db, 'decks')).id; },
  async listOwnedDecks() { const s = await getDocs(query(collection(db, 'decks'), where('owner', '==', uid()))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
  async listSharedDecks(email) {
    if (!email) return [];
    const s = await getDocs(query(collection(db, 'decks'), where('sharedWith', 'array-contains', email)));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async listPublicDecks() { const s = await getDocs(query(collection(db, 'decks'), where('visibility', '==', 'public'), limit(200))); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
  async getDeck(id) {
    try { const s = await getDoc(doc(db, 'decks', id)); return s.exists() ? { id: s.id, ...s.data() } : null; }
    catch (e) { if (e.code === 'permission-denied') return null; throw e; }
  },
  // Crea el mazo y su número de serie único en una sola operación (si el número ya existe, se genera otro).
  async createDeck(data) {
    const id = B.newId();
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const b = writeBatch(db);
      b.set(doc(db, 'codes', code), { deck: id, owner: uid(), created: Date.now() });
      b.set(doc(db, 'decks', id), strip({ ...data, code }));
      try { await b.commit(); return { id, code }; }
      catch (e) { if (e.code !== 'permission-denied' || i === 5) throw e; }
    }
  },
  // Busca un mazo por su número de serie. Devuelve {deckId, deck} (deck = null si es privado y no tienes acceso).
  async findByCode(code) {
    const s = await getDoc(doc(db, 'codes', code));
    if (!s.exists()) return null;
    const deckId = s.data().deck;
    return { deckId, deck: await B.getDeck(deckId) };
  },
  async updateDeck(id, patch) { await updateDoc(doc(db, 'decks', id), strip(patch)); },
  async deleteDeck(id, code) {
    const s = await getDocs(collection(db, 'decks', id, 'cards'));
    await runChunks(s.docs, d => deleteDoc(d.ref));
    await deleteDoc(doc(db, 'decks', id));
    if (code) await deleteDoc(doc(db, 'codes', code)).catch(() => {});
  },
  async bumpCount(id, n) { await updateDoc(doc(db, 'decks', id), { cardCount: increment(n), updated: Date.now() }); },

  // ---------- tarjetas ----------
  watchCards(deckId, cb, onErr) {
    return onSnapshot(collection(db, 'decks', deckId, 'cards'),
      s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => onErr && onErr(e));
  },
  async listCards(deckId) { const s = await getDocs(collection(db, 'decks', deckId, 'cards')); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
  async saveCard(deckId, cardId, data, isNew) {
    const body = strip({ ...data, by: uid(), updated: Date.now() });
    if (isNew) body.created = Date.now();
    await setDoc(doc(db, 'decks', deckId, 'cards', cardId), body, { merge: !isNew });
    if (isNew) B.bumpCount(deckId, 1).catch(() => {});
    return cardId;
  },
  async addCards(deckId, cards, counts) { // [{id?, q, a, img, ch, type, o, k, e}]
    const now = Date.now();
    await runChunks(cards.map((c, i) => ({ ...c, _t: c.created || now + i })), c => {
      const id = c.id || doc(collection(db, 'decks', deckId, 'cards')).id;
      const body = strip({ q: c.q, a: c.a, img: c.img && c.img.length ? c.img : undefined, qi: c.qi && c.img && c.img.length ? Math.min(c.qi, c.img.length) : undefined, ch: c.ch == null ? undefined : c.ch,
        type: c.type, o: c.o, k: c.k, e: c.e, by: uid(), created: c._t, updated: now });
      return setDoc(doc(db, 'decks', deckId, 'cards', id), body);
    });
    await updateDoc(doc(db, 'decks', deckId), strip({ cardCount: counts ? counts.cards : cards.length, qCount: counts ? counts.questions : undefined, updated: Date.now() }));
  },
  async deleteCard(deckId, cardId) { await deleteDoc(doc(db, 'decks', deckId, 'cards', cardId)); B.bumpCount(deckId, -1).catch(() => {}); },

  // ---------- imágenes ----------
  async putImage(dataUrl, w, h) {
    const ref = doc(collection(db, 'images'));
    await setDoc(ref, { owner: uid(), data: dataUrl, w: w || 0, h: h || 0, bytes: dataUrl.length, created: Date.now() });
    return ref.id;
  },
  async getImage(id) { const s = await getDoc(doc(db, 'images', id)); return s.exists() ? s.data().data : null; },
  async deleteImage(id) { await deleteDoc(doc(db, 'images', id)); },

  // ---------- mensajes de error ----------
  errorMessage(e) {
    const m = {
      'auth/invalid-email': 'El correo no es válido.',
      'auth/missing-password': 'Escribe tu contraseña.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Entra con tu contraseña o con Google.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/wrong-password': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
      'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
      'auth/cancelled-popup-request': 'Se cerró la ventana de Google antes de terminar.',
      'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados).',
      'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
      'auth/account-exists-with-different-credential': 'Ese correo ya está registrado con otro método de acceso.',
      'permission-denied': 'No tienes permiso para hacer esto en este mazo.',
      'unavailable': 'Sin conexión: se guardará cuando vuelvas a tener internet.',
      'resource-exhausted': 'Se alcanzó el límite gratuito de hoy. Inténtalo mañana.'
    };
    return m[e && e.code] || (e && e.message) || 'Algo salió mal. Inténtalo de nuevo.';
  }
};

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { const r = crypto.getRandomValues(new Uint32Array(8)); return Array.from(r, x => CODE_CHARS[x % CODE_CHARS.length]).join(''); }

async function runChunks(items, fn, size = 40) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

export default B;
