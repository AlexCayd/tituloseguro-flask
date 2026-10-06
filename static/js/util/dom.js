// Hiperscript mínimo y ayudas de DOM, compatibles con la CSP estricta:
// nunca se escribe el atributo `style` ni HTML como texto; los estilos dinámicos van por CSSOM.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Interpreta 'tag.clase.otra#id' → { tag, clases, id }. */
function analizar(sel) {
  const m = sel.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
  if (!m) throw new Error(`Selector inválido para h(): ${sel}`);
  const tag = m[1] || 'div';
  const clases = [];
  let id = null;
  for (const parte of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (parte[0] === '.') clases.push(parte.slice(1));
    else id = parte.slice(1);
  }
  return { tag, clases, id };
}

const PROPIEDADES = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'indeterminate', 'open', 'readOnly', 'required', 'multiple']);

function aplicar(el, props, esSvg) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false && !PROPIEDADES.has(k)) continue;
    if (k === 'class' || k === 'className') {
      for (const c of String(v).split(/\s+/).filter(Boolean)) el.classList.add(c);
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
    } else if (k === 'style') {
      // CSSOM: permitido por la CSP (no es el atributo style)
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === undefined || sv === null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
        else el.style[sk] = sv;
      }
    } else if (k === 'on') {
      for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (k === 'ref') {
      v(el);
    } else if (!esSvg && PROPIEDADES.has(k)) {
      el[k] = v;
    } else if (k.startsWith('on')) {
      throw new Error('Usa { on: { evento: fn } }: los atributos on* están prohibidos por la CSP.');
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

function agregar(el, hijos) {
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false || hijo === true) continue;
    if (Array.isArray(hijo)) agregar(el, hijo);
    else if (hijo instanceof Node) el.appendChild(hijo);
    else el.appendChild(document.createTextNode(String(hijo)));
  }
}

/**
 * h('button.boton.boton--primario', { type: 'button', on: { click } }, 'Enviar')
 * El segundo argumento es opcional: si es un nodo, texto o arreglo, cuenta como hijo.
 */
export function h(sel, props, ...hijos) {
  if (props instanceof Node || Array.isArray(props) || typeof props !== 'object' || props === null) {
    if (props !== undefined && props !== null) hijos.unshift(props);
    props = null;
  }
  const { tag, clases, id } = analizar(sel);
  const el = document.createElement(tag);
  if (clases.length) el.classList.add(...clases);
  if (id) el.id = id;
  aplicar(el, props, false);
  agregar(el, hijos);
  return el;
}

/** Igual que h() pero en el espacio de nombres SVG. */
export function s(sel, props, ...hijos) {
  if (props instanceof Node || Array.isArray(props) || typeof props !== 'object' || props === null) {
    if (props !== undefined && props !== null) hijos.unshift(props);
    props = null;
  }
  const { tag, clases, id } = analizar(sel);
  const el = document.createElementNS(SVG_NS, tag);
  if (clases.length) el.classList.add(...clases);
  if (id) el.id = id;
  aplicar(el, props, true);
  agregar(el, hijos);
  return el;
}

/** Icono del sprite (templates/_iconos.html): <svg class="icono"><use href="#i-nombre"/></svg> */
export function icono(nombre, { clase = '', titulo = null } = {}) {
  const svg = s('svg', { class: `icono ${clase}`.trim(), viewBox: '0 0 24 24', 'aria-hidden': titulo ? null : 'true', role: titulo ? 'img' : null, 'aria-label': titulo });
  svg.appendChild(s('use', { href: `#i-${nombre}` }));
  return svg;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

export function vaciar(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function reemplazar(el, ...hijos) { vaciar(el); agregar(el, hijos); return el; }

/** Cambia el texto solo si es distinto (evita trabajo y anuncios repetidos en regiones vivas). */
export function texto(el, valor) {
  const t = valor === null || valor === undefined ? '' : String(valor);
  if (el && el.textContent !== t) el.textContent = t;
  return el;
}

/** Atributo idempotente: null/false lo quita. */
export function attr(el, nombre, valor) {
  if (!el) return el;
  if (valor === null || valor === undefined || valor === false) {
    if (el.hasAttribute(nombre)) el.removeAttribute(nombre);
  } else {
    const v = valor === true ? '' : String(valor);
    if (el.getAttribute(nombre) !== v) el.setAttribute(nombre, v);
  }
  return el;
}

export function clase(el, nombre, activa) { if (el) el.classList.toggle(nombre, !!activa); return el; }

/** Variable CSS por CSSOM (nunca por atributo style). */
export function cssVar(el, nombre, valor) {
  if (!el) return el;
  const v = String(valor);
  if (el.style.getPropertyValue(nombre) !== v) el.style.setProperty(nombre, v);
  return el;
}

/** Delegación de eventos: fn(evento, elementoCoincidente). Devuelve la función para quitarla. */
export function delegar(raiz, evento, selector, fn, opciones) {
  const manejador = (e) => {
    const objetivo = e.target instanceof Element ? e.target.closest(selector) : null;
    if (objetivo && raiz.contains(objetivo)) fn(e, objetivo);
  };
  raiz.addEventListener(evento, manejador, opciones);
  return () => raiz.removeEventListener(evento, manejador, opciones);
}

let contador = 0;
export function uid(prefijo = 'id') { contador += 1; return `${prefijo}-${contador}`; }

/**
 * Reconciliación por clave: mantiene un hijo por clave dentro de `contenedor`, en orden.
 * crear(item) → Element ; actualizar(el, item) → void. Útil para listas que se repintan cada sondeo.
 */
export function reconciliar(contenedor, items, clave, crear, actualizar) {
  const existentes = new Map();
  for (const el of Array.from(contenedor.children)) {
    if (el.dataset.clave !== undefined) existentes.set(el.dataset.clave, el);
  }
  let anterior = null;
  const vistos = new Set();
  for (const item of items) {
    const k = String(clave(item));
    vistos.add(k);
    let el = existentes.get(k);
    if (!el) {
      el = crear(item);
      el.dataset.clave = k;
    }
    if (actualizar) actualizar(el, item);
    const siguiente = anterior ? anterior.nextSibling : contenedor.firstChild;
    if (siguiente !== el) contenedor.insertBefore(el, siguiente);
    anterior = el;
  }
  for (const [k, el] of existentes) if (!vistos.has(k)) el.remove();
}
