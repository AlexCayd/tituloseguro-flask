// Formato de cifras, hashes, tiempos lógicos y plurales (todo en español).

const NUM = new Intl.NumberFormat('es-MX');
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);   // el reloj lógico del servidor arranca aquí

export function num(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return NUM.format(n);
}

/** «ab12…ef90». Con `n` caracteres a cada lado. */
export function hashCorto(h, n = 4) {
  if (!h) return '—';
  const s = String(h);
  return s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}

/** Cantidad de ceros hexadecimales al inicio (la «dificultad» que cumple una huella). */
export function cerosIniciales(h) {
  if (!h) return 0;
  const m = String(h).match(/^0*/);
  return m ? m[0].length : 0;
}

/** Hex largo en grupos de `t` caracteres (para firmas y claves completas). */
export function grupos(hex, t = 8) {
  const out = [];
  for (let i = 0; i < String(hex).length; i += t) out.push(String(hex).slice(i, i + t));
  return out;
}

/** plural(3, 'nodo', 'nodos') → «3 nodos». Sin número: plural(3, 'nodo', 'nodos', false) → «nodos». */
export function plural(n, uno, varios, conNumero = true) {
  const palabra = Math.abs(n) === 1 ? uno : varios;
  return conNumero ? `${num(n)} ${palabra}` : palabra;
}

/** Segundos lógicos desde el arranque de la simulación ("2026-01-01T00:00:12Z" → 12). */
export function segundosLogicos(t) {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? Math.round((ms - T0) / 1000) : null;
}

/** Tiempo lógico compacto: «t+12», «t+1:05», «t+2:03:10». */
export function tiempo(t) {
  const s = segundosLogicos(t);
  if (s === null) return '—';
  if (s < 60) return `t+${s}`;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `t+${hh}:${String(mm).padStart(2, '0')}:${ss}` : `t+${mm}:${ss}`;
}

/** Siguiente marca del reloj lógico (la que el servidor usará en la próxima transacción). */
export function tiempoSiguiente(t, pasos = 1) {
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return t;
  return new Date(ms + pasos * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function porcentaje(a, b, decimales = 0) {
  if (!b) return '0 %';
  return `${(100 * a / b).toFixed(decimales)} %`;
}

export const NOMBRE_MODO = { pow: 'Proof of Work', pos: 'Proof of Stake' };
export const APODO_MODO = { pow: 'sellado', pos: 'avales' };

/**
 * Tono (0–360) derivado de una huella: dos nodos con la misma cabeza tienen el mismo color.
 * Usa el FINAL de la huella: en PoW todas empiezan con ceros y el principio no distingue nada.
 * Se limita a 150°–330° (verde azulado → azul → violeta → magenta): nunca cae en el rojo de
 * «rechazado» ni en el amarillo de «advertencia».
 */
export function tonoHash(h) {
  if (!h) return 255;
  const x = parseInt(String(h).slice(-6), 16);
  return Number.isFinite(x) ? 150 + (x % 181) : 255;
}

/** Serialización canónica como la del servidor: llaves ordenadas, sin espacios. */
export function canonico(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonico).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`).join(',')}}`;
}

/** SHA-256 en hex (si el navegador lo permite: contexto seguro, p. ej. localhost). */
export async function sha256(texto) {
  if (!globalThis.crypto?.subtle) return null;
  const datos = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Primera letra en mayúscula (los mensajes del servidor a veces empiezan en minúscula). */
export function capital(t) {
  const s = String(t ?? '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
