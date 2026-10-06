// Piezas de interfaz compartidas: toasts, errores, confirmación, copiar, anuncios,
// hash-chip, términos del glosario, estados vacíos, chips y medidores.

import { ErrorApi, ErrorRed } from './api.js';
import { h, icono, texto, cssVar, attr } from './util/dom.js';
import { hashCorto, cerosIniciales, capital } from './util/fmt.js';
import { animar, DUR, CURVA, sacudir } from './util/anim.js';
import { TERMINOS } from './glosario.js';

let regionToasts = null;
let regionCortes = null;      // anuncios corteses (polite)
let regionUrgente = null;     // anuncios urgentes (assertive)
let dialogoConfirmar = null;

export function iniciarUI({ toasts, cortes, urgente, confirmar }) {
  regionToasts = toasts;
  regionCortes = cortes;
  regionUrgente = urgente;
  dialogoConfirmar = confirmar;
  // copiar: cualquier [data-copiar] (los hash-chip lo usan)
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-copiar]') : null;
    if (b) copiar(b.dataset.copiar, b);
  });
}

// ------------------------------------------------------------------ anuncios
/** Texto para lectores de pantalla (región viva). */
export function anunciar(mensaje, { urgente = false } = {}) {
  const region = urgente ? regionUrgente : regionCortes;
  if (!region) return;
  region.textContent = '';
  // un tick después para que el lector lo detecte aunque el texto se repita
  setTimeout(() => { region.textContent = mensaje; }, 30);
}

// --------------------------------------------------------------------- toast
const ICONO_NIVEL = { info: 'info', ok: 'ok', aviso: 'alerta', error: 'x', red: 'desconectado' };

/**
 * toast('Texto', { nivel: 'info|ok|aviso|error|red', titulo, duracion, accion: { etiqueta, fn } })
 * Devuelve una función para cerrarlo.
 */
export function toast(mensaje, { nivel = 'info', titulo = null, duracion = 6000, accion = null } = {}) {
  if (!regionToasts) return () => {};
  const cerrarBtn = h('button.boton.boton--fantasma.boton--chico.boton--icono', { type: 'button', 'aria-label': 'Cerrar aviso' }, icono('x'));
  const el = h('div.toast', { dataset: { nivel }, role: nivel === 'error' || nivel === 'red' ? 'alert' : 'status' },
    icono(ICONO_NIVEL[nivel] || 'info'),
    h('div',
      titulo ? h('strong.toast__titulo', titulo) : null,
      h('span.toast__texto.mensaje-servidor', capital(mensaje)),
      accion ? h('div.toast__acciones', h('button.boton.boton--secundario.boton--chico', { type: 'button', on: { click: () => { accion.fn(); cerrar(); } } }, accion.etiqueta)) : null,
    ),
    cerrarBtn,
  );
  let timer = 0;
  const cerrar = () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    const a = animar(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(12px)' }], { duration: DUR.micro, easing: CURVA.salida, fill: 'forwards' });
    if (a) a.finished.then(() => el.remove(), () => el.remove()); else el.remove();
  };
  cerrarBtn.addEventListener('click', cerrar);
  // pausar el temporizador mientras se lee
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { if (duracion) timer = setTimeout(cerrar, 2500); });
  el.addEventListener('focusin', () => clearTimeout(timer));
  regionToasts.appendChild(el);
  while (regionToasts.children.length > 4) regionToasts.firstElementChild.remove();
  animar(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: DUR.entrada, easing: CURVA.firma });
  if (duracion) timer = setTimeout(cerrar, duracion);
  return cerrar;
}

// ------------------------------------------------------------------- errores
/**
 * Muestra un error de la API como corresponde:
 *  - ErrorApi con `campo` y `form` → marca el campo y escribe el mensaje debajo (además, toast si se pide).
 *  - ErrorApi sin campo → toast con el mensaje EXACTO del servidor (es un rechazo didáctico, no un fallo).
 *  - ErrorRed → toast de conexión.
 * Devuelve true si el error quedó marcado en un campo del formulario.
 */
export function mostrarError(err, { form = null, titulo = null, toastSiempre = false } = {}) {
  if (err instanceof ErrorApi) {
    // la época obsoleta (otra pestaña reinició) ya la avisa y la reconcilia el shell
    if (err.codigo === 'epoca_obsoleta') return false;
    let marcado = false;
    if (form && err.campo) marcado = marcarCampo(form, err.campo, err.message);
    if (!marcado || toastSiempre) {
      const nivel = err.status >= 500 ? 'error' : 'aviso';
      toast(err.message, { nivel, titulo: titulo || (err.status >= 500 ? 'El simulador no pudo completar la acción' : 'El consorcio no lo aceptó'), duracion: 9000 });
    }
    return marcado;
  }
  if (err instanceof ErrorRed) {
    toast(err.message, { nivel: 'red', titulo: 'Sin conexión con el consorcio' });
    return false;
  }
  if (err?.name === 'AbortError') return false;
  console.error(err);
  toast(String(err?.message || err), { nivel: 'error', titulo: 'Algo falló en esta página' });
  return false;
}

/** Busca el control por name (o data-campo) dentro del form, lo marca y muestra el mensaje. */
export function marcarCampo(form, campo, mensaje) {
  const control = form.querySelector(`[name="${CSS.escape(campo)}"]`) || form.querySelector(`[data-campo="${CSS.escape(campo)}"]`);
  if (!control) return false;
  // un campo dentro de un <details> cerrado no se vería: se abre
  for (let d = control.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  const contenedor = control.closest('.campo') || control.parentElement;
  contenedor?.setAttribute('data-invalido', '');
  attr(control, 'aria-invalid', 'true');
  let caja = contenedor?.querySelector('.campo__error');
  if (!caja && contenedor) {
    caja = h('p.campo__error', { id: `${control.id || campo}-error` });
    contenedor.appendChild(caja);
  }
  if (caja) {
    texto(caja, capital(mensaje));
    if (!caja.id) caja.id = `${control.id || campo}-error`;
    const desc = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    desc.add(caja.id);
    control.setAttribute('aria-describedby', [...desc].join(' '));
    sacudir(contenedor);
  }
  if (typeof control.focus === 'function') control.focus({ preventScroll: false });
  return true;
}

export function limpiarCampo(control) {
  const contenedor = control.closest('.campo') || control.parentElement;
  contenedor?.removeAttribute('data-invalido');
  contenedor?.removeAttribute('data-advertencia');
  attr(control, 'aria-invalid', null);
  const caja = contenedor?.querySelector('.campo__error');
  if (caja) caja.textContent = '';
}

export function limpiarCampos(form) {
  for (const c of form.querySelectorAll('[aria-invalid="true"]')) limpiarCampo(c);
  for (const c of form.querySelectorAll('.campo[data-invalido]')) c.removeAttribute('data-invalido');
}

// ---------------------------------------------------------------- confirmar
/**
 * confirmar({ titulo, texto, lista: [..], confirmar: 'Reiniciar', cancelar: 'Cancelar', peligro: true })
 * → Promise<boolean>. Usa <dialog> nativo (foco atrapado, Esc cancela, inert del resto).
 */
export function confirmar({ titulo, texto: cuerpo = '', lista = [], confirmar: si = 'Confirmar', cancelar: no = 'Cancelar', peligro = false } = {}) {
  const d = dialogoConfirmar;
  if (!d || typeof d.showModal !== 'function') return Promise.resolve(window.confirm(`${titulo}\n\n${cuerpo}`));
  return new Promise((resolver) => {
    const bSi = h(`button.boton.${peligro ? 'boton--peligro-lleno' : 'boton--primario'}`, { type: 'button', value: 'si' }, si);
    const bNo = h('button.boton.boton--fantasma', { type: 'button', value: 'no' }, no);
    d.replaceChildren(
      h('div.dialogo__cuerpo',
        h('h2', { id: 'confirmar-titulo' }, titulo),
        cuerpo ? h('p', cuerpo) : null,
        lista.length ? h('ul.dialogo__lista', lista.map((x) => h('li', x))) : null,
      ),
      h('div.dialogo__pie', bNo, bSi),
    );
    d.setAttribute('aria-labelledby', 'confirmar-titulo');
    let resultado = false;
    const fin = () => { d.removeEventListener('close', fin); resolver(resultado); };
    bSi.addEventListener('click', () => { resultado = true; d.close(); });
    bNo.addEventListener('click', () => { resultado = false; d.close(); });
    d.addEventListener('close', fin);
    d.showModal();
    bNo.focus();       // lo destructivo nunca tiene el foco por defecto
  });
}

// --------------------------------------------------------------------- copiar
export async function copiar(valor, boton = null) {
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(valor); ok = true; }
  } catch { ok = false; }
  if (!ok) {
    const ta = h('textarea', { readonly: '', 'aria-hidden': 'true', class: 'solo-lectores' });
    ta.value = valor;
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (boton) {
    boton.setAttribute('data-copiado', '');
    setTimeout(() => boton.removeAttribute('data-copiado'), 1400);
  }
  anunciar(ok ? 'Copiado al portapapeles.' : 'No se pudo copiar.');
  if (!ok) toast('Tu navegador no permitió copiar automáticamente. Selecciona el texto y cópialo a mano.', { nivel: 'aviso' });
  return ok;
}

// ------------------------------------------------------------------- hash-chip
/**
 * Botón con el hash truncado («ab12…ef90») que copia el valor completo al hacer clic.
 *   ui.hash(h, { n: 4, ceros: true, etiqueta: 'Huella de la cabeza', plano: false })
 * `ceros` resalta los ceros iniciales (útil en PoW). Para actualizarlo: ui.actualizarHash(el, h)
 */
export function hash(valor, { n = 4, ceros = false, etiqueta = 'Huella', plano = false } = {}) {
  const b = h(`button.hash${plano ? '.hash--plano' : ''}`, { type: 'button' });
  b._opciones = { n, ceros, etiqueta };
  actualizarHash(b, valor);
  return b;
}

export function actualizarHash(b, valor) {
  if (!b) return b;
  const { n = 4, ceros = false, etiqueta = 'Huella' } = b._opciones || {};
  if (b.dataset.copiar === (valor || '') && b.childNodes.length) return b;
  b.replaceChildren();
  if (!valor) {
    b.append(h('span.hash__elipsis', '—'));
    b.disabled = true;
    b.dataset.copiar = '';
    return b;
  }
  b.disabled = false;
  b.dataset.copiar = valor;
  const corto = hashCorto(valor, n);
  const z = ceros ? Math.min(cerosIniciales(valor), n) : 0;
  // todo el texto en UN elemento: si no, cada trozo sería un ítem flex y el gap los separaría
  const txt = h('span.hash__texto');
  if (z) txt.append(h('span.hash__ceros', corto.slice(0, z)));
  const resto = corto.slice(z);
  const i = resto.indexOf('…');
  if (i >= 0) txt.append(resto.slice(0, i), h('span.hash__elipsis', '…'), resto.slice(i + 1));
  else txt.append(resto);
  b.append(txt, icono('copiar', { clase: 'hash__icono' }));
  b.title = `${etiqueta}: ${valor} (clic para copiar)`;
  b.setAttribute('aria-label', `${etiqueta} ${corto}. Copiar completo`);
  return b;
}

// -------------------------------------------------------------------- glosario
/** Disparador del glosario: ui.termino('nonce') o ui.termino('nonce', 'nonces'). */
export function termino(clave, etiqueta = null) {
  const t = TERMINOS[clave];
  return h('button.termino', { type: 'button', dataset: { term: clave }, 'aria-expanded': 'false', 'aria-haspopup': 'dialog' },
    etiqueta ?? (t ? t.titulo.toLowerCase() : clave));
}

// ---------------------------------------------------------------- piezas
/** Estado vacío: ui.vacio({ icono, titulo, texto, accion: { etiqueta, fn, primario } }) */
export function vacio({ icono: ico = 'red', titulo, texto: t = '', accion = null, extra = null } = {}) {
  return h('div.vacio',
    h('span.vacio__icono', icono(ico)),
    h('h3', titulo),
    t ? h('p', t) : null,
    extra,
    accion ? h(`button.boton.${accion.primario === false ? 'boton--secundario' : 'boton--primario'}`, { type: 'button', on: { click: accion.fn } }, accion.etiqueta) : null,
  );
}

/** Chip de estado: ui.chip('Sincronizado', 'valido') */
export function chip(t, estado = 'neutro', { sinPunto = false } = {}) {
  return h(`span.chip${sinPunto ? '.chip--sin-punto' : ''}`, { dataset: { estado } }, t);
}

/** Medidor: ui.medidor(3, 50, { etiqueta: 'Pendientes' }); actualizar con ui.fijarMedidor(el, v, max) */
export function medidor(valor, max, { etiqueta = '', estado = null } = {}) {
  const el = h('div.medidor', { role: 'meter', 'aria-label': etiqueta, 'aria-valuemin': '0' });
  fijarMedidor(el, valor, max, estado);
  return el;
}
export function fijarMedidor(el, valor, max, estado = null) {
  const v = max ? Math.max(0, Math.min(1, valor / max)) : 0;
  cssVar(el, '--valor', v.toFixed(4));
  attr(el, 'aria-valuemax', String(max));
  attr(el, 'aria-valuenow', String(valor));
  attr(el, 'data-estado', estado);
  return el;
}

/** Marca un botón como ocupado mientras dura la promesa. */
export async function ocupado(boton, promesa) {
  boton?.setAttribute('aria-busy', 'true');
  try { return await promesa; } finally { boton?.removeAttribute('aria-busy'); }
}
