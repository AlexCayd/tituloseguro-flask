// Dominio del proyecto: Certificados y Credenciales Académicas.
// Cada nodo es una INSTITUCIÓN EDUCATIVA de un registro compartido; la unidad que se transfiere es el
// «crédito de certificación». Los datos vienen del servidor (nucleo/instituciones.py) incrustados en
// #datos-limites, así que están disponibles de forma síncrona desde el primer pintado.
//
// API (las firmas existentes NO cambian; lo nuevo es aditivo):
//   institucion(id) sigla(id) nombre(id) etiqueta(id) creditos(n,{corto}) creditosBreve(n)
//   conInstituciones(texto) UNIDAD TARIFAS
//   + tipo(id) → 'pública' | 'privada' | ''      + rotulo(id) → «UNAM · Universidad Nacional…»
//   + idsCatalogo() → ['N01', …, 'N20']           + tarifaPorMonto(monto) → tarifa | null
//   + conSiglas(texto) → «N03» → «IPN» (para frases donde el id técnico sobra)
//   + AVISO_HONESTIDAD (texto para el pie del asistente)
//   + MODO_ACADEMICO.pow|pos → { nombre, lema, rol, roles }   + nombreModo(modo) → «Proof of Work · sellado por trabajo»

const datos = (() => {
  try { return JSON.parse(document.getElementById('datos-limites')?.textContent || '{}'); }
  catch { return {}; }
})();

export const UNIDAD = datos.unidad || {
  nombre: 'crédito de certificación', plural: 'créditos de certificación', sigla: 'CC', explicacion: '',
};
export const TARIFAS = datos.tarifas || [];
const INST = datos.instituciones || {};

/** {sigla, nombre, tipo} de la institución que representa un nodo (nunca devuelve null). */
export function institucion(id) {
  return INST[id] || { sigla: id, nombre: id, tipo: '' };
}
export const sigla = (id) => institucion(id).sigla;
export const nombre = (id) => institucion(id).nombre;
/** «N03 · IPN»: identificador técnico + siglas. */
export const etiqueta = (id) => (INST[id] ? `${id} · ${INST[id].sigla}` : String(id));

/** «1 crédito de certificación» / «10 créditos de certificación»; con {corto:true}: «10 CC». */
export function creditos(n, { corto = false } = {}) {
  if (corto) return `${n} ${UNIDAD.sigla}`;
  return `${n} ${Number(n) === 1 ? UNIDAD.nombre : UNIDAD.plural}`;
}
/** Versión breve: «10 créditos» / «1 crédito». */
export const creditosBreve = (n) => `${n} ${Number(n) === 1 ? 'crédito' : 'créditos'}`;

/** Sustituye «N03» por «N03 · IPN» en un texto del servidor (sin duplicar si ya viene etiquetado). */
export function conInstituciones(texto) {
  return String(texto ?? '').replace(/\bN(\d{2})\b(?! · )/g, (m) => (INST[m] ? `${m} · ${INST[m].sigla}` : m));
}

// ------------------------------------------------------------------ aditivo
/** 'pública' | 'privada' | '' */
export const tipo = (id) => institucion(id).tipo || '';

/** «UNAM · Universidad Nacional Autónoma de México» (para selectores, títulos y lectores). */
export function rotulo(id) {
  const i = INST[id];
  return i ? `${i.sigla} · ${i.nombre}` : String(id);
}

/** Todos los ids del catálogo, en orden (N01…N20). */
export function idsCatalogo() {
  return Object.keys(INST).sort();
}

/** La tarifa orientativa cuyo monto coincide, o null. */
export function tarifaPorMonto(monto) {
  const m = Number(monto);
  return TARIFAS.find((t) => t.monto === m) || null;
}

/** «N03» → «IPN» (solo donde el id técnico no aporta; los datos y las rutas siguen usando N03). */
export function conSiglas(texto) {
  return String(texto ?? '').replace(/\bN(\d{2})\b(?: · [A-ZÁÉÍÓÚÑ]+)?/g, (m) => {
    const id = m.slice(0, 3);
    return INST[id] ? INST[id].sigla : m;
  });
}

export const AVISO_HONESTIDAD = 'Simulación didáctica: modela un consorcio de instituciones educativas que comparte un '
  + 'libro de registros, sus firmas institucionales, la forma en que se ponen de acuerdo (consenso) y los créditos de '
  + 'certificación. El libro no guarda los datos de ninguna credencial (estudiante, programa, calificaciones): solo qué '
  + 'institución paga, a cuál, cuántos créditos y cuándo. Las instituciones son ilustrativas y no representan a las '
  + 'reales ni a sus sistemas.';

/**
 * Cada mecanismo de consenso con su nombre técnico y su lema académico (selector de modo, cejas,
 * títulos). El nombre técnico se conserva: el lema es la frase que lo explica.
 */
export const MODO_ACADEMICO = Object.freeze({
  pow: Object.freeze({ nombre: 'Proof of Work', lema: 'sellado por trabajo', rol: 'institución selladora', roles: 'instituciones selladoras' }),
  pos: Object.freeze({ nombre: 'Proof of Stake', lema: 'aval por apuesta', rol: 'institución avaladora', roles: 'instituciones avaladoras' }),
});

/** «Proof of Work · sellado por trabajo» (o el id tal cual si no es un modo conocido). */
export function nombreModo(modo) {
  const m = MODO_ACADEMICO[modo];
  return m ? `${m.nombre} · ${m.lema}` : String(modo ?? '');
}
