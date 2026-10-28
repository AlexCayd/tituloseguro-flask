// KIT COMPARTIDO de la sección «Criptografía» (los cinco esquemas).
// Piezas para que las cinco herramientas se sientan iguales y MUY sencillas:
//   cabecera (metáfora + historia), pasos numerados, veredicto grande, «¿Qué acaba de pasar?»,
//   «Ver las cuentas» (lo técnico, plegado), botones de «Prueba a hacer trampa» y el dibujo de un QR.
// Contrato y guía de tono: ./LEEME.md

import { api } from '../../api.js';
import { h, s, icono, texto, attr, reemplazar } from '../../util/dom.js';
import * as anim from '../../util/anim.js';
import { sigla, nombre } from '../../dominio.js';

// ------------------------------------------------------------------ API
/** POST /api/esquemas/<ruta>. Lanza ErrorApi (rechazo explicado) o ErrorRed (sin conexión). */
export const post = (ruta, cuerpo = {}) => api.post(`/api/esquemas/${ruta}`, cuerpo);
/** GET /api/esquemas/<ruta>?… */
export const get = (ruta, params) => api.get(`/api/esquemas/${ruta}`, params);

/** Identificador aleatorio en hexadecimal (rondas, sesiones). */
export function token(bytes = 8) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Escalar al azar menor que el orden de secp256k1 (64 hex): el «reto» que lanza Víctor. */
export function retoAlAzar() {
  // con el primer byte < 0xff el número queda siempre por debajo del orden del grupo
  const t = token(32);
  return (t[0] === 'f' && t[1] === 'f' ? '7f' : t.slice(0, 2)) + t.slice(2);
}

/** Semilla de la sesión (una por instancia de la vista): las claves de cada institución salen de aquí. */
export function semilla(ctx) {
  if (!ctx.local.semilla) ctx.local.semilla = `ses-${token(6)}`;
  return ctx.local.semilla;
}

// -------------------------------------------------------------- formato
/** «9f3a…c41e» */
export function corto(hex, n = 6) {
  const t = String(hex ?? '');
  return t.length <= n * 2 + 1 ? t : `${t.slice(0, n)}…${t.slice(-n)}`;
}
export const inst = { sigla, nombre };
/** Instituciones del catálogo para las demos (N01 = UAN, N02 = UNAM…). */
export const IDS = ['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09', 'N10', 'N11', 'N12'];

// ------------------------------------------------------------- piezas
/**
 * Cabecera de un esquema: número, icono, título llano, metáfora (grande), historia del consorcio y
 * nombre técnico (pequeño, al final).
 */
export function cabecera({ numero, icono: ico, titulo, metafora, historia, tecnico, id }) {
  return h('header.esq-cabecera',
    h('div.esq-cabecera__marca', { 'aria-hidden': 'true' }, h('span.esq-cabecera__num', String(numero)), icono(ico)),
    h('div.esq-cabecera__texto',
      h('h2.esq-cabecera__titulo', { id }, titulo),
      h('p.esq-cabecera__metafora', metafora),
      historia ? h('p.esq-cabecera__historia', historia) : null,
      tecnico ? h('p.esq-cabecera__tecnico', h('span.etiqueta-instrumento', 'Nombre técnico'), ' ', tecnico) : null));
}

/**
 * Paso numerado. `estado`: 'activo' (se puede usar), 'hecho' o 'espera' (todavía no toca).
 *   const p = paso({ n: 1, titulo: 'Escribe el secreto', ayuda: '…' }, ...hijos)
 *   marcarPaso(p, 'hecho')
 */
export function paso({ n, titulo, ayuda = null, estado = 'activo', id = null }, ...hijos) {
  const tid = id ? `${id}-t` : null;
  return h('section.esq-paso', { dataset: { estado }, 'aria-labelledby': tid, id },
    h('div.esq-paso__num', { 'aria-hidden': 'true' }, h('span', String(n)), icono('ok', { clase: 'esq-paso__hecho' })),
    h('div.esq-paso__cuerpo',
      h('h3.esq-paso__titulo', { id: tid }, h('span.solo-lectores', `Paso ${n}: `), titulo),
      ayuda ? h('p.esq-paso__ayuda', ayuda) : null,
      ...hijos));
}
export function marcarPaso(el, estado) { if (el) attr(el, 'data-estado', estado); }

/**
 * Veredicto grande (región viva). pintarVeredicto(el, { estado, titulo, texto, extra })
 *   estado: 'ok' (verde) | 'mal' (rojo) | 'aviso' (ámbar) | 'info' (neutro) | null (vacío)
 */
export function veredicto({ vacio = 'Aquí aparecerá el resultado.' } = {}) {
  const el = h('div.esq-veredicto', { dataset: { estado: 'vacio' }, role: 'status', 'aria-live': 'polite' });
  el._vacio = vacio;
  pintarVeredicto(el, null);
  return el;
}
const ICONO_VEREDICTO = { ok: 'ok', mal: 'x', aviso: 'alerta', info: 'info' };
export function pintarVeredicto(el, v) {
  if (!el) return;
  if (!v) {
    attr(el, 'data-estado', 'vacio');
    reemplazar(el, h('p.esq-veredicto__vacio', el._vacio));
    return;
  }
  attr(el, 'data-estado', v.estado || 'info');
  reemplazar(el,
    h('span.esq-veredicto__icono', icono(ICONO_VEREDICTO[v.estado] || 'info')),
    h('div.esq-veredicto__texto',
      h('p.esq-veredicto__titulo', v.titulo),
      v.texto ? h('p.esq-veredicto__detalle', v.texto) : null,
      v.extra || null));
  anim.animar(el, [{ opacity: 0.4, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }],
    { duration: anim.DUR.entrada, easing: anim.CURVA.firma });
  if (v.estado === 'mal') anim.sacudir?.(el);
}

/** «¿Qué acaba de pasar?»: una o dos frases llanas después de cada resultado. */
export function explicacion() {
  const el = h('aside.esq-explica', { hidden: true },
    h('p.esq-explica__titulo', icono('info'), ' ¿Qué acaba de pasar?'),
    h('div.esq-explica__texto'));
  return el;
}
export function explicar(el, ...contenido) {
  if (!el) return;
  const caja = el.querySelector('.esq-explica__texto');
  reemplazar(caja, ...contenido.map((c) => (typeof c === 'string' ? h('p', c) : c)));
  el.hidden = !contenido.length;
}

/** Lo técnico, siempre plegado: <details> «Ver las cuentas». */
export function cuentas(titulo = 'Ver las cuentas', ...hijos) {
  return h('details.detalles.esq-cuentas',
    h('summary', icono('calculadora'), h('span', titulo)),
    h('div.esq-cuentas__cuerpo', ...hijos));
}

/** Renglones «etiqueta → valor» en mono (para las cuentas). filas = [[etiqueta, valor], …] */
export function renglones(filas) {
  return h('dl.esq-renglones', filas.filter(Boolean).map(([e, v]) => h('div', h('dt', e), h('dd', v))));
}

/**
 * Bloque «Prueba a hacer trampa»: botones que intentan engañar al esquema.
 *   trampas([{ etiqueta, texto, fn }])  → cada botón llama fn(boton)
 */
export function trampas(lista, { titulo = 'Prueba a hacer trampa' } = {}) {
  return h('section.esq-trampas',
    h('h3.esq-trampas__titulo', icono('mascara'), ' ', titulo),
    h('ul.esq-trampas__lista', { role: 'list' }, lista.map((t) => {
      const b = h('button.boton.boton--secundario.esq-trampas__boton', { type: 'button' }, icono('flecha'), h('span', t.etiqueta));
      b.addEventListener('click', () => t.fn(b));
      return h('li.esq-trampa', b, t.texto ? h('p.esq-trampa__texto', t.texto) : null);
    })));
}

/** «Para saber más»: usos reales y límites (plegado). */
export function saberMas(...hijos) {
  return h('details.detalles.esq-mas', h('summary', icono('libro'), h('span', 'Para saber más: dónde se usa y sus límites')),
    h('div.esq-mas__cuerpo', ...hijos));
}

/**
 * Selector segmentado (radios nativos, accesible con flechas).
 *   const seg = segmentado({ nombre: 'n', etiqueta: 'Partes', opciones: [{ valor: 3, texto: '3' }, …], valor: 5,
 *                            alCambiar: (v) => … })
 *   seg.valor  /  seg.fijar(v)  /  seg.opciones(nuevas, valor)
 */
let contadorSeg = 0;
export function segmentado({ nombre, etiqueta, opciones, valor, alCambiar }) {
  contadorSeg += 1;
  const grupo = `esq-seg-${nombre}-${contadorSeg}`;
  const el = h('div.segmentado.esq-seg', { role: 'radiogroup', 'aria-label': etiqueta });
  el.dataset.campo = nombre;
  const pintar = (lista, v) => {
    reemplazar(el, lista.map((o) => {
      const input = h('input', { type: 'radio', name: grupo, value: String(o.valor), checked: String(o.valor) === String(v) });
      input.addEventListener('change', () => { if (input.checked) { el.valor = o.valor; alCambiar?.(o.valor); } });
      return h('label', input, h('span', o.texto ?? String(o.valor)));
    }));
    el.valor = v;
  };
  pintar(opciones, valor);
  el.fijar = (v) => {
    for (const i of el.querySelectorAll('input')) i.checked = i.value === String(v);
    el.valor = v;
  };
  el.opciones = (lista, v) => pintar(lista, v);
  return el;
}

/** Botón que muestra «ocupado» mientras dura la promesa y muestra los errores como corresponde. */
export async function accion(ctx, boton, promesa) {
  try {
    return await ctx.ui.ocupado(boton, promesa);
  } catch (e) {
    ctx.ui.mostrarError(e, { titulo: 'No se pudo completar' });
    return null;
  }
}

/** Escribe en el panel «¿Qué está pasando?» del shell. */
export function narrar(ctx, titulo, textoNarrado, nivel = 'info') {
  ctx.narrar({ titulo, texto: textoNarrado, nivel });
}

// -------------------------------------------------------------- QR (SVG)
/**
 * Dibuja una matriz de módulos ('0'/'1' por fila) como un único <path> nítido.
 *   qrSvg(filas, { margen: 2, titulo: 'Parte 1', clase: 'esq-qr' })
 * El color lo pone el CSS (fill: currentColor); el fondo, la clase.
 */
export function qrSvg(filas, { margen = 2, titulo = null, clase = 'esq-qr' } = {}) {
  const n = filas.length;
  const w = filas[0]?.length || 0;
  let d = '';
  for (let y = 0; y < n; y++) {
    const fila = filas[y];
    let x = 0;
    while (x < w) {
      if (fila[x] === '1') {
        let fin = x;
        while (fin < w && fila[fin] === '1') fin++;
        d += `M${x + margen} ${y + margen}h${fin - x}v1h-${fin - x}z`;
        x = fin;
      } else x++;
    }
  }
  return s(`svg.${clase}`, {
    viewBox: `0 0 ${w + 2 * margen} ${n + 2 * margen}`, 'shape-rendering': 'crispEdges',
    role: titulo ? 'img' : null, 'aria-label': titulo, 'aria-hidden': titulo ? null : 'true',
  }, s('rect.esq-qr__fondo', { width: w + 2 * margen, height: n + 2 * margen }), s('path.esq-qr__modulos', { d }));
}

/** Combina matrices de módulos: 'xor' (sombras digitales) u 'or' (acetatos encimados). */
export function combinar(matrices, modo = 'xor') {
  if (!matrices.length) return [];
  return matrices[0].map((_, i) => {
    let fila = '';
    for (let j = 0; j < matrices[0][i].length; j++) {
      let v = 0;
      for (const M of matrices) v = modo === 'or' ? (v | (M[i][j] === '1')) : (v ^ (M[i][j] === '1'));
      fila += v ? '1' : '0';
    }
    return fila;
  });
}

/** Ruido visual a partir de un hex (barritas): «este pedazo parece basura». */
export function ruido(hex, { barras = 24, clase = 'esq-ruido' } = {}) {
  const t = String(hex || '').replace(/[^0-9a-f]/gi, '');
  const svg = s(`svg.${clase}`, { viewBox: `0 0 ${barras * 4} 16`, 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  for (let i = 0; i < barras; i++) {
    const v = parseInt(t[(i * 5) % Math.max(1, t.length)] || '0', 16);
    const alto = 3 + (v / 15) * 13;
    svg.append(s('rect', { x: i * 4, y: 16 - alto, width: 3, height: alto, rx: 0.6 }));
  }
  return svg;
}

export { h, s, icono, texto, attr, reemplazar, anim };
