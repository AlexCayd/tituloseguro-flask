// SHELL de Título Seguro (registro compartido de credenciales académicas).
// Orquesta: store (sondeo por modo) → cabecera, red viva, narrador, ficha de institución y la vista
// activa. Cada vista se monta UNA vez por modo (instancias independientes): cambiar de modo no
// destruye nada y cada modo conserva su estado de interfaz. Contrato en static/js/vistas/LEEME.md.

import { Store } from './store.js';
import { apiDeModo } from './api.js';
import * as ui from './ui.js';
import { iniciarGlosario, cerrar as cerrarGlosario } from './glosario.js';
import { Narrador, narrarLote, narrarEvento, siguientePaso } from './narrador.js';
import { RedViva } from './red_viva.js';
import { FichaNodo } from './ficha_nodo.js';
import { Recorrido } from './recorrido.js';
import * as registro from './vistas/registro.js';
import { h, s, $, texto, attr, icono, reemplazar } from './util/dom.js';
import * as dom from './util/dom.js';
import * as fmt from './util/fmt.js';
import * as anim from './util/anim.js';
import { sigla, rotulo, nombreModo, MODO_ACADEMICO } from './dominio.js';

const MODOS = ['pow', 'pos'];
const VISTAS = Object.values(registro)
  .filter((v) => v && typeof v === 'object' && v.id && typeof v.montar === 'function')
  .sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100));
const POR_ID = new Map(VISTAS.map((v) => [v.id, v]));
const MARCA = 'Título Seguro';
const LEMA = { pow: MODO_ACADEMICO.pow.lema, pos: MODO_ACADEMICO.pos.lema };

// localStorage puede no existir (modo privado estricto): nunca debe romper el arranque
const memoria = {
  leer(k) { try { return localStorage.getItem(k); } catch { return null; } },
  guardar(k, v) { try { localStorage.setItem(k, v); } catch { /* sin persistencia */ } },
};

function leerLimites() {
  try { return JSON.parse($('#datos-limites')?.textContent || '{}'); } catch { return {}; }
}
const LIMITES = Object.freeze(leerLimites());
const SIN_PARAMETROS = Object.freeze({});

// ------------------------------------------------------------------ núcleo
const store = new Store();
const apis = { pow: apiDeModo('pow', store), pos: apiDeModo('pos', store) };
const shell = { modo: 'pow', vista: 'red', pendiente: null };
const instancias = new Map();     // `${modo}:${id}` → instancia
const cssCargado = new Map();     // id → Promise

ui.iniciarUI({
  toasts: $('#toasts'),
  cortes: $('#anuncio-cortes'),
  urgente: $('#anuncio-urgente'),
  confirmar: $('#confirmar'),
});
iniciarGlosario($('#glosario-pop'));

const red = new RedViva($('#anillo'), { alSeleccionar: (id) => ficha.abrir(shell.modo, id) });
const ficha = new FichaNodo($('#ficha-nodo'), {
  store, ui, red, apiDe: (m) => apis[m], navegar: (v, op) => navegar(v, op),
});
const recorrido = new Recorrido($('#recorrido'), {
  memoria,
  modo: () => shell.modo,
  movil: () => esMovil(),
  alAbrirPaso: () => cerrarRedMovil({ devolverFoco: false }),
});
const narrador = new Narrador($('#narrador'), {
  navegar: (v) => navegar(v),
  abrirNodo: (id) => ficha.abrir(shell.modo, id),
  anunciar: (t) => ui.anunciar(t),
  alRecorrido: () => recorrido.iniciar({ forzado: true }),
});

// ------------------------------------------------------------------ rutas
function vistasDe(modo) { return VISTAS.filter((v) => !v.modos || v.modos.includes(modo)); }

function leerRuta() {
  const [, m, v] = (location.hash || '').match(/^#\/(pow|pos)(?:\/([\w-]+))?/) || [];
  const modo = MODOS.includes(m) ? m : (memoria.leer('lab:modo') || 'pow');
  let vista = v && POR_ID.has(v) ? v : (memoria.leer(`lab:vista:${modo}`) || 'red');
  if (!vistasDe(modo).some((x) => x.id === vista)) vista = 'red';
  return { modo: MODOS.includes(modo) ? modo : 'pow', vista };
}

/**
 * Navega a una vista (del modo actual o de otro).
 *   navegar('cadena')                     → sección del modo actual
 *   navegar('cadena', { modo: 'pos' })    → y cambia de modo
 *   navegar('cadena', { nodo: 'N03' })    → cualquier otra clave viaja como parámetro: la vista
 *                                           destino la lee en ctx.parametros (ver LEEME, §3)
 */
function navegar(vista, { modo = shell.modo, ...parametros } = {}) {
  shell.pendiente = Object.keys(parametros).length ? { vista, modo, parametros: Object.freeze({ ...parametros }) } : null;
  const destino = `#/${modo}/${vista}`;
  if (location.hash === destino) aplicarRuta({ enfocar: true });
  else location.hash = destino;
}

/** Vista equivalente al cambiar de modo (mismo id o el mismo «orden», p. ej. arena PoW ↔ escenario PoS). */
function equivalente(vistaId, modo) {
  const lista = vistasDe(modo);
  if (lista.some((v) => v.id === vistaId)) return vistaId;
  const orden = POR_ID.get(vistaId)?.orden;
  return lista.find((v) => v.orden === orden)?.id || 'red';
}

function cambiarModo(modo) {
  if (modo === shell.modo) return;
  navegar(equivalente(shell.vista, modo), { modo });
}

window.addEventListener('hashchange', () => { cerrarGlosario(); aplicarRuta({ enfocar: true }); });

let rutaPedida = 0;

async function aplicarRuta({ enfocar = false } = {}) {
  const yo = ++rutaPedida;
  const { modo, vista } = leerRuta();
  const primeraVez = !shell.iniciado;
  const cambioModo = primeraVez || modo !== shell.modo;
  shell.iniciado = true;
  memoria.guardar('lab:modo', modo);
  memoria.guardar(`lab:vista:${modo}`, vista);
  // parámetros de navegación: solo valen para la navegación que los pidió
  const p = shell.pendiente;
  shell.pendiente = null;
  const parametros = p && p.vista === vista && p.modo === modo ? p.parametros : SIN_PARAMETROS;

  // la vista se prepara ANTES de animar (CSS + montar), para que modo y vista cambien juntos
  const inst = await asegurarInstancia(modo, vista, parametros);
  if (yo !== rutaPedida) return;                      // llegó otra navegación mientras cargaba
  if (inst.ctx) inst.ctx.parametros = parametros;
  if (cambioModo) ficha.cerrar();

  // `ocultar` se llama ANTES de cambiar de modo/sección: la fachada ctx.red de la vista saliente
  // aún actúa sobre el anillo, así puede retirar sus marcas
  for (const otra of instancias.values()) {
    if (otra === inst || otra.seccion.hidden || !otra.montada) continue;
    try { otra.vista.ocultar?.(otra.ctx); } catch (e) { console.error(e); }
  }
  const cambio = () => {
    if (cambioModo) aplicarModo(modo);
    activarSeccion(inst);
  };
  const yaVisible = !cambioModo && !inst.seccion.hidden;
  // el primer pintado no se anima: el contenido aparece ya en su sitio
  if (primeraVez || yaVisible) cambio(); else await anim.transicion(cambio);
  if (cambioModo) store.activar(modo);

  pintarInstancia(inst, { primera: true, eventos: [], parametros });
  try { inst.vista.mostrar?.(inst.ctx); } catch (e) { console.error(e); }
  if (enfocar && !cambioModo) inst.titulo.focus({ preventScroll: true });
}

/** Lo que cambia al pasar de PoW a PoS (o viceversa). Va dentro de la transición. */
function aplicarModo(modo) {
  shell.modo = modo;
  document.body.dataset.modo = modo;
  for (const b of document.querySelectorAll('.modo__opcion')) attr(b, 'aria-pressed', b.dataset.modo === modo ? 'true' : 'false');
  $('.marca')?.setAttribute('href', `#/${modo}/red`);
  pintarNavegacion();
  narrador.reiniciar();
  const e = store.estado(modo);
  if (e) alEstado(modo, e, { primera: true, eventos: [] });
  else { red.actualizar(null, {}); pintarCabecera(null); }
}

// --------------------------------------------------------------- navegación
function pintarNavegacion() {
  const ul = $('#secciones');
  reemplazar(ul, vistasDe(shell.modo).map((v) => h('li',
    h('a.seccion', { href: `#/${shell.modo}/${v.id}`, dataset: { vista: v.id } },
      icono(v.icono || 'bloque'),
      h('span.seccion__titulo', v.etiqueta || v.titulo),
      h('span.seccion__insignia.insignia', { hidden: true }),
    ))));
  marcarNavegacion();
}

function marcarNavegacion() {
  for (const a of document.querySelectorAll('.seccion')) attr(a, 'aria-current', a.dataset.vista === shell.vista ? 'page' : null);
}

function pintarInsignias(estado) {
  for (const a of document.querySelectorAll('.seccion')) {
    const v = POR_ID.get(a.dataset.vista);
    const ins = a.querySelector('.seccion__insignia');
    let valor = null;
    try { valor = v?.insignia && estado?.existe ? v.insignia(estado) : null; } catch { valor = null; }
    ins.hidden = valor === null || valor === undefined || valor === '' || valor === 0;
    texto(ins, valor ?? '');
  }
}

// ----------------------------------------------------------------- vistas
function cargarCss(id) {
  if (!cssCargado.has(id)) {
    cssCargado.set(id, new Promise((resolver) => {
      const link = h('link', { rel: 'stylesheet', href: new URL(`../css/vistas/${id}.css`, import.meta.url).href, dataset: { vista: id } });
      link.addEventListener('load', () => resolver(true));
      link.addEventListener('error', () => { console.warn(`[shell] no se encontró css/vistas/${id}.css`); link.remove(); resolver(false); });
      document.head.appendChild(link);
    }));
  }
  return cssCargado.get(id);
}

function fachadaRed(modo) {
  const activa = () => shell.modo === modo;
  return {
    resaltar: (id, ms) => activa() && red.resaltar(id, ms),
    seleccionar: (id) => activa() && red.seleccionar(id),
    destello: (id, tipo) => activa() && red.destello(id, tipo),
    difundir: (o, d) => activa() && red.difundir(o, d),
    marcar: (id, c, on) => activa() && red.marcar(id, c, on),
    previsualizar: (n) => activa() && red.previsualizar(n),
    posicion: (id) => (activa() ? red.posicion(id) : null),
    capa: () => red.capa(),
  };
}

function crearContexto(modo, vista, seccion, host, parametros = SIN_PARAMETROS) {
  const ctx = {
    modo, vista: vista.id, limites: LIMITES, store, api: apis[modo], ui, fmt, anim, dom, h, s, icono,
    red: fachadaRed(modo),
    host, seccion, local: {},
    /** Parámetros de la navegación que trajo a esta vista (objeto congelado; {} si no hubo). */
    parametros,
    /** Alias de `parametros`. */
    get params() { return this.parametros; },
    estado: () => store.estado(modo),
    navegar: (v, op) => navegar(v, op),
    abrirNodo: (id) => { if (shell.modo === modo) ficha.abrir(modo, id); },
    narrar: (x) => narrarDesdeVista(modo, x),
    get activa() { return shell.modo === modo && shell.vista === vista.id; },
    /** Entradas nuevas de la bitácora de ESTE modo (aunque la vista esté oculta). */
    alEvento: (fn) => store.on('eventos', (m, entradas, estado) => { if (m === modo) fn(entradas, estado); }),
    /** Cada estado nuevo de ESTE modo (aunque la vista esté oculta). Úsalo con moderación. */
    alEstado: (fn) => store.on('estado', (m, estado, cambios) => { if (m === modo) fn(estado, cambios); }),
  };
  return ctx;
}

async function asegurarInstancia(modo, id, parametros = SIN_PARAMETROS) {
  const clave = `${modo}:${id}`;
  if (instancias.has(clave)) return instancias.get(clave);
  const vista = POR_ID.get(id);
  const tituloId = `vista-${modo}-${id}-titulo`;
  const titulo = h('h1.vista__titulo', { id: tituloId, tabindex: '-1' }, vista.titulo);
  const host = h('div.vista__cuerpo');
  const sinRed = h('div.vista__sin-red', { hidden: true });
  const seccion = h('section.vista', { dataset: { vista: id, modo }, 'aria-labelledby': tituloId, hidden: true },
    h('header.vista__cabecera',
      h('p.vista__ceja.etiqueta-instrumento', nombreModo(modo)),
      titulo,
      vista.descripcion ? h('p.vista__descripcion', vista.descripcion) : null,
    ),
    sinRed, host);
  $('#vistas').appendChild(seccion);
  const inst = { clave, modo, vista, seccion, host, sinRed, titulo, ctx: null, montada: false, fallo: null, pintadaRev: null };
  instancias.set(clave, inst);
  if (vista.css !== false) await cargarCss(id);
  inst.ctx = crearContexto(modo, vista, seccion, host, parametros);
  try {
    await vista.montar(host, inst.ctx);
    inst.montada = true;
  } catch (e) {
    fallarVista(inst, e);
  }
  return inst;
}

function fallarVista(inst, e) {
  console.error(`[shell] la vista «${inst.vista.id}» falló`, e);
  inst.fallo = e;
  reemplazar(inst.host, h('div.aviso', { dataset: { nivel: 'error' }, role: 'alert' }, icono('alerta'),
    h('div', h('strong', 'Esta sección no pudo mostrarse.'), ' ', String(e?.message || e),
      h('p.texto-3', 'El resto de Título Seguro sigue funcionando y el libro de registros no se alteró. Recarga la página para volver a intentarlo.'))));
}

function pintarInstancia(inst, cambios = {}) {
  const estado = store.estado(inst.modo);
  const requiere = inst.vista.requiereRed !== false;
  const sinRed = requiere && !estado?.existe;
  inst.sinRed.hidden = !sinRed;
  inst.host.hidden = sinRed;
  if (sinRed) {
    if (!inst.sinRed.firstChild) {
      inst.sinRed.appendChild(ui.vacio({
        icono: 'institucion',
        titulo: estado ? `Todavía no hay un consorcio en ${nombreModo(inst.modo)}` : 'Consultando al consorcio…',
        texto: 'Esta sección trabaja con un consorcio que ya comparte su libro de registros. Fórmalo en «Instituciones»: eliges cuántas participan, la semilla y los créditos de certificación de cada una, y el consorcio abre su libro.',
        accion: { etiqueta: 'Ir a formar el consorcio', fn: () => navegar('red', { modo: inst.modo }) },
      }));
    }
    return;
  }
  inst.sinRed.replaceChildren();
  if (!inst.montada || inst.fallo || typeof inst.vista.actualizar !== 'function') return;
  try {
    inst.vista.actualizar(estado, inst.ctx, cambios);
    inst.pintadaRev = estado?.existe ? `${estado.epoca}:${estado.rev}` : 'sin';
  } catch (e) {
    fallarVista(inst, e);
  }
}

/** Muestra la sección de una instancia y oculta las demás (síncrono: cabe en una transición). */
function activarSeccion(inst) {
  for (const otra of instancias.values()) if (otra !== inst) otra.seccion.hidden = true;
  inst.seccion.hidden = false;
  shell.vista = inst.vista.id;
  document.body.dataset.vista = inst.vista.id;
  marcarNavegacion();
  document.title = `${inst.vista.titulo} · ${fmt.NOMBRE_MODO[inst.modo]} · ${MARCA}`;
}

// --------------------------------------------------------------- narrador
function narrarDesdeVista(modo, x) {
  if (modo !== shell.modo || !x) return;
  if (x.seq !== undefined && x.tipo) narrador.mostrar(narrarEvento(x, store.estado(modo)));
  else narrador.mostrar({ titulo: x.titulo || 'Ahora mismo', texto: x.texto || '', nivel: x.nivel || 'info', detalle: x.detalle });
}

// --------------------------------------------------------------- cabecera
const lect = {
  altura: $('#lect-altura'), sincTxt: $('#lect-sinc-txt'), sincBarra: $('.sinc-barra'),
  pendientes: $('#lect-pendientes'), salud: $('#lect-salud'), reloj: $('#lect-reloj'),
  conexion: $('#lect-conexion'), conexionTxt: $('#lect-conexion-txt'), banner: $('#banner-sinc'),
};

function pintarCabecera(e) {
  const hay = !!e?.existe;
  document.body.toggleAttribute('data-sin-red', !hay);
  pintarFranja(e);
  if (!hay) {
    texto(lect.altura, '—'); texto(lect.sincTxt, '—'); texto(lect.pendientes, '—'); texto(lect.reloj, '—');
    reemplazar(lect.salud, h('span.texto-3', '—'));
    lect.sincBarra.replaceChildren();
    reemplazar(lect.banner, h('p.banner__texto.texto-3', 'Todavía no hay un consorcio de instituciones en este modo: fórmalo en «Instituciones».'));
    attr(lect.banner, 'data-estado', null);
    delete lect.banner.dataset.clave;
    delete lect.salud.dataset.ok;
    return;
  }
  const prev = Number(lect.altura.textContent);
  if (Number.isFinite(prev) && prev !== e.altura && lect.altura.textContent !== '—') {
    anim.contar(lect.altura, prev, e.altura, { duracion: 360 });
    anim.animar(lect.altura, [{ color: 'var(--acento)' }, { color: 'var(--texto)' }], { duration: 900 });
  } else texto(lect.altura, e.altura);

  const sc = e.sincronia || {};
  texto(lect.sincTxt, `${sc.sincronizados}/${sc.total}`);
  // barra de segmentos: uno por institución, encendido si está sincronizada
  if (lect.sincBarra.childElementCount !== e.nodos.length) lect.sincBarra.replaceChildren(...e.nodos.map(() => h('i')));
  e.nodos.forEach((n, i) => attr(lect.sincBarra.children[i], 'data-estado', !n.conectado ? 'fuera' : n.sincronizado ? 'si' : 'no'));

  const pmax = e.parametros?.max_pendientes ?? LIMITES.max_pendientes ?? 50;
  texto(lect.pendientes, `${e.pendientes_total}/${pmax}`);
  attr(lect.pendientes, 'title', `${fmt.plural(e.pendientes_total, 'registro', 'registros')} de credenciales en espera de que el consorcio los selle en un folio (máximo ${pmax})`);
  texto(lect.reloj, fmt.tiempo(e.reloj));
  attr(lect.reloj, 'title', `Reloj lógico: ${e.reloj}`);
  const ok = e.salud?.consistente;
  if (lect.salud.dataset.ok !== String(ok)) {
    lect.salud.dataset.ok = String(ok);
    reemplazar(lect.salud, ui.chip(ok ? 'en orden' : 'con discrepancias', ok ? 'valido' : 'rechazado'));
    attr(lect.salud, 'title', ok
      ? 'Las cuentas de créditos cuadran y las copias del libro están íntegras.'
      : 'Algo no cuadra: una copia del libro fue alterada o las cuentas de créditos no coinciden. Audítalo en «Instituciones».');
  }
  pintarBanner(e);
}

function pintarBanner(e) {
  const sc = e.sincronia || {};
  const fuera = e.nodos.filter((n) => !n.conectado);
  const corruptos = e.nodos.filter((n) => n.conectado && !n.cadena_integra);
  const atras = e.nodos.filter((n) => n.conectado && n.cadena_integra && !n.sincronizado);
  const clave = `${sc.sincronizados}/${sc.total}|${fuera.map((n) => n.id)}|${corruptos.map((n) => n.id)}|${atras.map((n) => n.id)}`;
  if (lect.banner.dataset.clave === clave) return;
  lect.banner.dataset.clave = clave;
  const todo = sc.sincronizados === sc.total;
  attr(lect.banner, 'data-estado', todo ? 'ok' : 'aviso');
  const boton = (n) => h('button.banner__nodo', { type: 'button', title: `${rotulo(n.id)} (${n.id})`, 'aria-label': `${rotulo(n.id)}: abrir su ficha`, on: { click: () => ficha.abrir(shell.modo, n.id) } }, sigla(n.id));
  const grupo = (lista, etiqueta) => (lista.length ? h('span.banner__grupo', h('span.texto-3', etiqueta), lista.map(boton)) : null);
  reemplazar(lect.banner,
    h('p.banner__texto',
      h('strong.cifra', `${sc.sincronizados}/${sc.total}`),
      todo ? ' instituciones en sincronía: todas tienen el mismo libro de registros.' : ' instituciones tienen al día el libro de referencia.'),
    todo ? null : h('div.banner__detalle', grupo(fuera, 'desconectadas'), grupo(corruptos, 'copia alterada'), grupo(atras, 'atrasadas')),
  );
}

function pintarEstadoModo(modo, e) {
  const el = document.querySelector(`[data-estado-modo="${modo}"]`);
  if (!el) return;
  const n = el.querySelector('.modo__n');
  const alt = el.querySelector('.modo__alt');
  texto(el.querySelector('.modo__lema'), LEMA[modo]);
  texto(n, e?.existe ? fmt.plural(e.nodos.length, 'institución', 'instituciones') : e ? 'sin consorcio' : 'consultando…');
  texto(alt, e?.existe ? ` · ${fmt.plural(e.altura, 'folio', 'folios')}` : '');
}

// ------------------------------------------------------- franja (móvil)
const franja = {
  raiz: $('#franja-red'), mini: $('#franja-mini'), sinc: $('#franja-sinc'), detalle: $('#franja-detalle'),
  boton: $('#franja-boton'), panel: $('#observatorio-red'),
};
const mqMovil = window.matchMedia('(max-width: 720px)');
function esMovil() { return mqMovil.matches; }

/** Miniatura del anillo: un punto por institución, coloreado por su estado. */
function pintarFranja(e) {
  if (!franja.raiz) return;
  const hay = !!e?.existe;
  const nodos = hay ? e.nodos : [];
  const clave = nodos.map((n) => (!n.conectado ? 'f' : !n.cadena_integra ? 'c' : n.sincronizado ? 's' : 'n')).join('');
  if (franja.mini.dataset.clave !== clave) {
    franja.mini.dataset.clave = clave;
    const total = nodos.length;
    franja.mini.replaceChildren(
      s('circle.franja-red__orbita', { r: 14 }),
      ...nodos.map((n, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / total;
        return s('circle.franja-red__punto', { cx: (Math.cos(a) * 14).toFixed(2), cy: (Math.sin(a) * 14).toFixed(2), r: total > 14 ? 2.1 : 2.6, dataset: { estado: clave[i] } });
      }),
      s('path.franja-red__birrete', { d: 'M0 -4.5 -6.5 -1.3 0 1.9 6.5 -1.3z M-3.8 0.4v2.8c0 1 1.7 1.9 3.8 1.9s3.8-.9 3.8-1.9v-2.8L0 2.3z' }),
    );
  }
  if (!hay) {
    texto(franja.sinc, '—');
    texto(franja.detalle, e ? 'Aún no hay consorcio en este modo' : 'Consultando al consorcio…');
    attr(franja.raiz, 'data-estado', null);
    return;
  }
  const sc = e.sincronia || {};
  texto(franja.sinc, `${sc.sincronizados}/${sc.total} en sincronía`);
  texto(franja.detalle, `${fmt.plural(e.altura, 'folio', 'folios')} · ${fmt.num(e.pendientes_total)} en espera${e.salud?.consistente === false ? ' · con discrepancias' : ''}`);
  attr(franja.raiz, 'data-estado', sc.sincronizados === sc.total ? 'ok' : 'aviso');
}

let seguirFranja = 0;
function colocarPanel() {
  const r = franja.raiz.getBoundingClientRect();
  document.documentElement.style.setProperty('--franja-abajo', `${Math.max(0, Math.round(r.bottom))}px`);
}
function alDesplazar() {
  if (seguirFranja) return;
  seguirFranja = requestAnimationFrame(() => { seguirFranja = 0; colocarPanel(); });
}
function abrirRedMovil() {
  colocarPanel();
  document.body.setAttribute('data-red-abierta', '');
  attr(franja.boton, 'aria-expanded', 'true');
  texto(franja.boton.querySelector('span'), 'Ocultar');
  window.addEventListener('scroll', alDesplazar, { passive: true });
  anim.animar(franja.panel, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: anim.DUR.entrada, easing: anim.CURVA.firma });
  ui.anunciar('Anillo de instituciones desplegado. Usa las flechas para recorrerlas y Enter para abrir la ficha de cada una.');
}
function cerrarRedMovil({ devolverFoco = true } = {}) {
  if (!document.body.hasAttribute('data-red-abierta')) return;
  document.body.removeAttribute('data-red-abierta');
  attr(franja.boton, 'aria-expanded', 'false');
  texto(franja.boton.querySelector('span'), 'Ver instituciones');
  window.removeEventListener('scroll', alDesplazar);
  if (devolverFoco && franja.panel.contains(document.activeElement)) franja.boton.focus({ preventScroll: true });
}
franja.boton?.addEventListener('click', () => {
  if (document.body.hasAttribute('data-red-abierta')) cerrarRedMovil(); else abrirRedMovil();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && document.body.hasAttribute('data-red-abierta') && !document.querySelector('dialog[open]')) cerrarRedMovil();
});
document.addEventListener('pointerdown', (ev) => {
  if (!document.body.hasAttribute('data-red-abierta') || document.querySelector('dialog[open]')) return;
  const t = ev.target instanceof Element ? ev.target : null;
  if (t && (franja.panel.contains(t) || franja.raiz.contains(t) || t.closest('.glosario-pop, .recorrido'))) return;
  cerrarRedMovil({ devolverFoco: false });
});
mqMovil.addEventListener('change', () => { if (!esMovil()) cerrarRedMovil({ devolverFoco: false }); });

store.on('conexion', (estado) => {
  attr(lect.conexion, 'data-estado', estado);
  attr(franja.raiz, 'data-conexion', estado);
  texto(lect.conexionTxt, estado === 'ok' ? 'en vivo' : estado === 'pausa' ? 'en pausa' : 'sin conexión · reintentando');
  if (estado === 'caida') ui.toast('Se perdió la conexión con el simulador del libro de registros. Seguimos intentándolo solos, cada vez con algo más de espera: no hace falta recargar.', { nivel: 'red', titulo: 'Sin conexión con el consorcio', duracion: 8000 });
});

store.on('epoca_obsoleta', (modo) => {
  ui.toast(`El consorcio de ${nombreModo(modo)} se reinició desde otra pestaña. Ya tienes a la vista su libro nuevo: si tu última acción no se aplicó, repítela.`, { nivel: 'aviso', titulo: 'El consorcio se reinició en otra pestaña' });
});

// --------------------------------------------------------- flujo de estado
function alEstado(modo, estado, cambios) {
  pintarEstadoModo(modo, estado);
  if (modo !== shell.modo) return;
  pintarCabecera(estado);
  red.actualizar(estado, cambios);
  ficha.actualizar(modo, estado);
  pintarInsignias(estado);

  if (cambios.primera || cambios.epocaCambio || cambios.existeCambio) {
    const ultima = estado?.existe ? (estado.bitacora || []).at(-1) : null;
    if (cambios.eventos?.length) narrador.mostrar(narrarLote(cambios.eventos, estado));
    else if (ultima) narrador.mostrar(narrarEvento(ultima, estado), { anunciar: false });
    else narrador.mostrar({ titulo: `Cómo funciona el ${MODO_ACADEMICO[modo].lema}`, texto: modo === 'pow'
      ? 'En el sellado por trabajo, las instituciones selladoras compiten por cerrar el siguiente folio: prueban números (nonces) hasta lograr un sello de autenticidad con los ceros exigidos. La primera que lo consigue sella el folio y gana créditos de certificación.'
      : 'En el aval por apuesta, las instituciones avaladoras apuestan créditos de certificación: un sorteo, ponderado por lo apostado, elige quién propone el siguiente folio, y las demás lo avalan votando con el peso de su apuesta.', nivel: 'info' }, { anunciar: false });
  }
  narrador.sugerir(siguientePaso(estado, modo));

  const inst = instancias.get(`${modo}:${shell.vista}`);
  if (inst && !inst.seccion.hidden) pintarInstancia(inst, cambios);
  if (estado && !arrancoRecorrido) {
    arrancoRecorrido = true;
    // primera visita: el recorrido espera a que la interfaz ya esté pintada
    setTimeout(() => recorrido.iniciar({ forzado: false }), 900);
  }
}
let arrancoRecorrido = false;

store.on('estado', alEstado);
store.on('eventos', (modo, entradas, estado) => {
  if (modo !== shell.modo) return;
  narrador.mostrar(narrarLote(entradas, estado));
});

// botones de modo
for (const b of document.querySelectorAll('.modo__opcion')) b.addEventListener('click', () => cambiarModo(b.dataset.modo));

// ------------------------------------------------------------------ arranque
// la cabecera puede ocupar dos filas: los elementos pegajosos leen su alto real
const cabecera = $('.cabecera');
if ('ResizeObserver' in window) {
  new ResizeObserver(() => {
    const alto = cabecera && getComputedStyle(cabecera).position === 'sticky' ? cabecera.offsetHeight : 0;
    document.documentElement.style.setProperty('--alto-cabecera', `${alto}px`);
    const altoFranja = franja.raiz && getComputedStyle(franja.raiz).display !== 'none' ? franja.raiz.offsetHeight : 0;
    document.documentElement.style.setProperty('--alto-franja', `${altoFranja}px`);
  }).observe(document.body);
}
for (const m of MODOS) pintarEstadoModo(m, null);
pintarFranja(null);
$('.observatorio__carga')?.remove();
red.actualizar(null, {});
aplicarRuta();
// el otro modo se consulta una vez para mostrar su resumen en el selector
for (const m of MODOS) if (m !== leerRuta().modo) store.refrescar(m);

anim.alCambiarMovimiento(() => document.body.toggleAttribute('data-movimiento-reducido', anim.reducido()));
document.body.toggleAttribute('data-movimiento-reducido', anim.reducido());
