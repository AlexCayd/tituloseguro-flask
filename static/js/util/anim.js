// Movimiento con propósito sobre Web Animations API.
// Regla: el estado visual final vive en CSS/DOM; la animación solo interpola hacia él.
// Con prefers-reduced-motion el desplazamiento se sustituye por un fundido breve (nunca se
// elimina la señal de que algo pasó).

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

export const reducido = () => mq.matches;
export function alCambiarMovimiento(fn) { mq.addEventListener('change', () => fn(mq.matches)); }

// Mismos valores que tokens.css
export const DUR = { micro: 160, entrada: 280, escena: 480, difusion: 620 };
export const CURVA = {
  firma: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  func: 'cubic-bezier(0.33, 1, 0.68, 1)',
  salida: 'cubic-bezier(0.4, 0, 1, 1)',
  acuse: 'cubic-bezier(0.34, 1.56, 0.64, 1)',   // ≈ back.out: solo para acuses celebratorios
};

function soloOpacidad(keyframes) {
  const lista = Array.isArray(keyframes) ? keyframes : [keyframes];
  const ops = lista.map((k) => (k && 'opacity' in k ? { opacity: k.opacity } : null));
  if (ops.every(Boolean)) return ops;
  return [{ opacity: 0.35 }, { opacity: 1 }];
}

/**
 * animar(el, keyframes, opciones, { reducido })
 *  - reducido: keyframes alternativos para movimiento reducido; `false` = no animar nada.
 *    Por defecto se derivan solo las opacidades (o un fundido 0.35 → 1).
 * Devuelve la Animation o null.
 */
export function animar(el, keyframes, opciones = {}, { reducido: alternativa } = {}) {
  if (!el || typeof el.animate !== 'function') return null;
  const op = { duration: DUR.entrada, easing: CURVA.firma, ...opciones };
  if (reducido()) {
    if (alternativa === false) return null;
    return el.animate(alternativa ?? soloOpacidad(keyframes), { ...op, duration: Math.min(op.duration ?? 200, 160), delay: 0, easing: 'linear' });
  }
  return el.animate(keyframes, op);
}

/** Entrada estándar de contenido: sube 6px y aparece. */
export function entrar(el, { retraso = 0, distancia = 6 } = {}) {
  return animar(el, [{ opacity: 0, transform: `translateY(${distancia}px)` }, { opacity: 1, transform: 'none' }],
    { duration: DUR.entrada, delay: retraso, easing: CURVA.firma, fill: 'backwards' });
}

/** Escalonado por grupos (nunca elemento a elemento en listas largas: `paso` pequeño). */
export function escalonar(els, keyframes, opciones = {}, paso = 24) {
  return Array.from(els).map((el, i) => animar(el, keyframes, { fill: 'backwards', ...opciones, delay: (opciones.delay || 0) + i * paso }));
}

/** Destello de atención (acuse de una acción o de un cambio de dato). */
export function destello(el, color = 'var(--acento)') {
  return animar(el, [
    { boxShadow: `0 0 0 0 color-mix(in oklab, ${color} 60%, transparent)` },
    { boxShadow: `0 0 0 6px color-mix(in oklab, ${color} 0%, transparent)` },
  ], { duration: DUR.escena, easing: CURVA.func });
}

/** Rechazo: sacudida corta horizontal (reducido: parpadeo). */
export function sacudir(el) {
  return animar(el, [
    { transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
    { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' },
  ], { duration: 320, easing: 'linear' }, { reducido: [{ opacity: 0.4 }, { opacity: 1 }] });
}

/** Cifra que cuenta de `desde` a `hasta` (solo para cifras que no hay que leer «ya»). */
export function contar(el, desde, hasta, { duracion = DUR.escena, formato = String } = {}) {
  if (!el) return;
  if (reducido() || desde === hasta || !Number.isFinite(desde) || !Number.isFinite(hasta)) {
    el.textContent = formato(hasta);
    return;
  }
  const t0 = performance.now();
  const paso = (t) => {
    const p = Math.min(1, (t - t0) / duracion);
    const e = 1 - (1 - p) ** 3;
    el.textContent = formato(Math.round(desde + (hasta - desde) * e));
    if (p < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/**
 * Envuelve un cambio de DOM en una View Transition si existe y el movimiento no está reducido.
 * Devuelve una promesa que se resuelve cuando el DOM ya cambió.
 */
export function transicion(cambio) {
  if (typeof document.startViewTransition !== 'function' || reducido() || document.hidden) {
    cambio();
    return Promise.resolve();
  }
  const vt = document.startViewTransition(cambio);
  // si otra transición la interrumpe, `ready`/`finished` se rechazan: no es un error
  vt.ready.catch(() => {});
  vt.finished.catch(() => {});
  // red de seguridad: si el navegador no llega a pintar (pestaña sin fotogramas), saltar la
  // transición ejecuta el cambio igualmente. El DOM nunca se queda a medio camino.
  const guarda = setTimeout(() => { try { vt.skipTransition(); } catch { /* ya terminó */ } }, 600);
  return vt.updateCallbackDone.catch(() => {}).finally(() => clearTimeout(guarda));
}
