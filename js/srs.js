// Repetición espaciada con FSRS-5 (Free Spaced Repetition Scheduler), el algoritmo que usa Anki
// desde la versión 23.10 y el que hoy se recomienda para estudiar medicina.
// Modelo DSR: cada tarjeta tiene Dificultad (D, 1-10), Estabilidad (S, días hasta que la probabilidad
// de recordarla cae al 90 %) y Recuperabilidad (R, probabilidad de recordarla hoy).
// Parámetros por defecto de FSRS-5 (entrenados con millones de repasos de Anki).
export const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;
const MIN = 60e3, DAY = 864e5;
export const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
export const NEW = 0, LEARNING = 1, REVIEW = 2, RELEARNING = 3;
export const DEFAULTS = {
  retention: 0.9,          // retención deseada (Anki: 0.90 por defecto; para medicina se usa 0.85-0.95)
  learnSteps: [1, 10],     // minutos: pasos de aprendizaje de tarjetas nuevas (todos < 1 día)
  relearnSteps: [10],      // minutos: pasos de reaprendizaje tras olvidar una tarjeta
  maxIvl: 36500,           // días
  learnAhead: 20,          // minutos: se pueden mostrar antes de tiempo dentro de la misma sesión
  dayStartsAt: 4           // hora local en la que empieza un nuevo día de estudio (como Anki)
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const retrievability = (t, s) => Math.pow(1 + FACTOR * t / s, DECAY);
const rawInterval = (s, r) => s / FACTOR * (Math.pow(r, 1 / DECAY) - 1);
const initS = g => Math.max(W[g - 1], 0.1);
const initD = g => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
function nextD(d, g) {
  const delta = -W[6] * (g - 3);
  const damped = d + delta * (10 - d) / 9;                 // amortiguación lineal (FSRS-5)
  return clamp(W[7] * initD(EASY) + (1 - W[7]) * damped, 1, 10); // reversión a la media
}
function recallS(d, s, r, g) {
  const hard = g === HARD ? W[15] : 1, easy = g === EASY ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
}
function forgetS(d, s, r) {
  const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  return Math.min(sf, s / Math.exp(W[17] * W[18])); // FSRS-5: tope tras olvido
}
const shortTermS = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18])); // repasos del mismo día (FSRS-5)

function dayStart(now, o) { const d = new Date(now - o.dayStartsAt * 36e5); d.setHours(0, 0, 0, 0); return d.getTime() + o.dayStartsAt * 36e5; }
export function dayKey(now, o = DEFAULTS) { const d = new Date(dayStart(now, o)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function ivlDays(s, o) { return clamp(Math.round(rawInterval(s, o.retention)), 1, o.maxIvl); }
function fuzz(ivl, seed) {
  if (ivl < 3) return ivl;
  const span = Math.max(1, Math.round(ivl * 0.05));
  const x = Math.sin(seed) * 10000; const f = x - Math.floor(x);
  return ivl + Math.round((f * 2 - 1) * span);
}

export function newCard() { return { st: NEW, s: 0, d: 0, due: 0, last: 0, step: 0, reps: 0, lapses: 0 }; }

// Normaliza lo que haya guardado (incluye el formato antiguo [caja, vence] del sistema Leitner).
const OLD_IVL = [0, 1, 3, 7, 16, 35];
export function normalize(v) {
  if (!v) return newCard();
  if (Array.isArray(v)) {
    const [box, due] = v;
    const when = Number.isFinite(due) ? due : Date.now();
    if (!box) return { st: RELEARNING, s: 0.5, d: 7, due: when, last: when, step: 0, reps: 1, lapses: 1 };
    const ivl = OLD_IVL[Math.min(box, 5)];
    return { st: REVIEW, s: ivl, d: 5, due: when, last: when - ivl * DAY, step: 0, reps: box, lapses: 0 };
  }
  return { ...newCard(), ...v };
}

// Calcula el nuevo estado de la tarjeta tras calificarla. `fuzzSeed` = null desactiva la variación aleatoria.
export function schedule(card, g, now = Date.now(), opts = {}, fuzzSeed = now) {
  const o = { ...DEFAULTS, ...opts };
  const c = normalize(card);
  const out = { ...c, reps: c.reps + 1, last: now };
  const graduate = (s, minIvl = 1) => {
    let ivl = Math.max(ivlDays(s, o), minIvl);
    if (fuzzSeed != null) ivl = clamp(fuzz(ivl, fuzzSeed), 1, o.maxIvl);
    return { ...out, s, st: REVIEW, step: 0, ivl, due: dayStart(now, o) + ivl * DAY };
  };
  const stepDelay = (steps, step, rating) => {
    if (rating === AGAIN) return steps[0];
    if (rating === HARD) return step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : Math.min(steps[step] * 1.5, steps[step] + 1440);
    return steps[step];
  };

  if (c.st === NEW) {
    out.d = initD(g); out.s = initS(g);
    const steps = o.learnSteps;
    if (g === EASY || !steps.length || (g === GOOD && steps.length < 2)) return graduate(out.s);
    if (g === GOOD) return { ...out, st: LEARNING, step: 1, ivl: 0, due: now + steps[1] * MIN };
    return { ...out, st: LEARNING, step: 0, ivl: 0, due: now + stepDelay(steps, 0, g) * MIN };
  }

  const days = c.last ? Math.max(0, Math.round((dayStart(now, o) - dayStart(c.last, o)) / DAY)) : 0; // días transcurridos (enteros)
  if (c.st === LEARNING || c.st === RELEARNING) {
    const steps = c.st === LEARNING ? o.learnSteps : o.relearnSteps;
    const s0 = Math.max(c.s, 0.1);
    if (days >= 1) { const r = retrievability(days, s0); out.s = g === AGAIN ? forgetS(c.d, s0, r) : recallS(c.d, s0, r, g); } // volvió otro día: fórmulas de largo plazo
    else out.s = shortTermS(s0, g);                                                                          // mismo día: estabilidad de corto plazo
    out.d = nextD(c.d, g);
    const step = Math.min(c.step, Math.max(steps.length - 1, 0));
    if (g === EASY) return graduate(out.s, c.st === RELEARNING ? 1 : 2);
    if (g === GOOD) {
      if (step + 1 < steps.length) return { ...out, step: step + 1, ivl: 0, due: now + steps[step + 1] * MIN };
      return graduate(out.s);
    }
    if (!steps.length) return graduate(out.s);
    return { ...out, step: g === AGAIN ? 0 : step, ivl: 0, due: now + stepDelay(steps, step, g) * MIN };
  }

  // REVIEW
  const r = retrievability(days, c.s);
  const d1 = nextD(c.d, g);
  const sameDay = days === 0; // repaso anticipado el mismo día (p. ej. repaso libre): estabilidad de corto plazo
  const nextS = gg => sameDay ? shortTermS(c.s, gg) : (gg === AGAIN ? forgetS(c.d, c.s, r) : recallS(c.d, c.s, r, gg));
  if (g === AGAIN) {
    const s1 = Math.min(nextS(AGAIN), c.s);
    out.d = d1; out.s = s1; out.lapses = c.lapses + 1;
    if (!o.relearnSteps.length) return graduate(s1);
    return { ...out, st: RELEARNING, step: 0, ivl: 0, due: now + o.relearnSteps[0] * MIN };
  }
  // Intervalos ordenados: Difícil ≤ Bien < Fácil
  const sH = nextS(HARD), sG = nextS(GOOD), sE = nextS(EASY);
  let iH = ivlDays(sH, o), iG = ivlDays(sG, o), iE = ivlDays(sE, o);
  iH = Math.min(iH, iG); iG = Math.max(iG, iH + 1); iE = Math.max(iE, iG + 1);
  let ivl = g === HARD ? iH : g === GOOD ? iG : iE;
  if (fuzzSeed != null) ivl = fuzz(ivl, fuzzSeed);
  ivl = clamp(ivl, 1, o.maxIvl);
  out.d = d1; out.s = g === HARD ? sH : g === GOOD ? sG : sE;
  return { ...out, st: REVIEW, step: 0, ivl, due: dayStart(now, o) + ivl * DAY };
}

// Vista previa del próximo intervalo de cada botón (sin variación aleatoria).
export function preview(card, now = Date.now(), opts = {}) {
  const res = {};
  for (const g of [AGAIN, HARD, GOOD, EASY]) { const n = schedule(card, g, now, opts, null); res[g] = n.st === REVIEW ? { days: n.ivl } : { min: Math.round((n.due - now) / MIN) }; }
  return res;
}
export function fmtIvl(p) {
  if (p.min != null) return p.min < 60 ? Math.max(1, p.min) + ' min' : Math.round(p.min / 60) + ' h';
  const d = p.days; if (d < 30) return d + ' d'; if (d < 365) return (Math.round(d / 3.04) / 10).toString().replace('.', ',') + ' m';
  return (Math.round(d / 36.5) / 10).toString().replace('.', ',') + ' a';
}

export function isDue(card, now = Date.now(), opts = {}) {
  const o = { ...DEFAULTS, ...opts }; const c = normalize(card);
  if (c.st === NEW) return false;
  if (c.st === LEARNING || c.st === RELEARNING) return c.due <= now + o.learnAhead * MIN;
  return c.due <= now;
}
export function currentR(card, now = Date.now()) {
  const c = normalize(card); if (c.st === NEW || !c.s) return null;
  return retrievability(Math.max(0, (now - c.last) / DAY), c.s);
}
export const isMature = c => { const x = normalize(c); return x.st === REVIEW && x.s >= 21; };
export function stateLabel(card, now = Date.now()) {
  const c = normalize(card);
  if (c.st === NEW) return 'Nueva';
  if (c.st === LEARNING) return 'Aprendiendo';
  if (c.st === RELEARNING) return 'Reaprendiendo';
  const days = Math.round((c.due - now) / DAY);
  return days <= 0 ? 'Para hoy' : 'Repaso en ' + fmtIvl({ days });
}
