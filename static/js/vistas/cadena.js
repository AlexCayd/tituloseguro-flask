// VISTA · Explorador de cadena — «el libro de registros» de «Título Seguro»
//  · Cada institución guarda SU copia del libro: se elige cuál explorar y, opcionalmente, con
//    cuál compararla (bloque a bloque, por huella guardada y por contenido).
//  · La cadena como objeto físico: tarjetas enlazadas por eslabones hash_anterior → hash
//    (horizontal con teclado y arrastre; vertical en pantallas estrechas). Carga progresiva.
//  · Detalle del bloque con todos sus campos y «cómo se calcula esta huella»: la serialización
//    canónica (igual que json.dumps(sort_keys=True) de Python) y SHA-256 en el navegador.
//  · Veredicto de validación de esa copia (problemas → saltan al bloque) y alteración en vivo
//    (/laboratorio/corromper, 4 tipos) con la propagación de la invalidez y la reparación.
//    Con un informe de alteración a la vista, el veredicto se pliega: manda la propagación.
//  · Enganches del shell: `ocultar(ctx)` retira las marcas del anillo (con `hashchange` de
//    respaldo) y `ctx.parametros?.nodo` preselecciona la institución al venir de su ficha.

import {
  explicar, reglaDe, chipRegla, listaProblemas, eslabon, hashCompacto, hexConDiff,
  serializarBloque, camposDelHash, pyJson, bytesDe, fraseAlteracion,
  marcaInst, etiqueta, etiquetaLarga, siglaDe, nombre as nombreInst, cc, conInstituciones,
} from './_bloque_ui.js';

const LOTE = 50;                 // bloques por carga (el servidor admite hasta 100)
const TIPOS_MANIP = [
  { id: 'contenido', titulo: 'Cambiar los créditos de un registro', texto: 'Suma 1 crédito al primer registro de credencial del folio y no toca nada más.' },
  { id: 'hash', titulo: 'Cambiar la huella guardada', texto: 'Modifica el último carácter del campo «hash» del folio: como raspar el sello de autenticidad de un título.' },
  { id: 'firma', titulo: 'Falsificar una firma', texto: 'Cambia el primer carácter de la primera firma: la de la institución emisora.' },
  { id: 'contenido_recalculado', titulo: 'Alterar y volver a sellar', texto: 'El falsificador «astuto»: cambia los créditos del registro y recalcula la huella del folio con SHA-256.' },
];

const VISTA = {
  id: 'cadena',
  etiqueta: 'Libro de registros',
  titulo: 'Libro de registros',
  icono: 'cadena',
  modos: ['pow', 'pos'],
  orden: 40,
  descripcion: 'El libro de registros: cada institución conserva su propia copia. Recórrela folio a folio (cada folio es un «bloque» de registros sellado), recalcula sus huellas en tu navegador y altérala para ver cómo se delata y cómo se repara.',

  montar(host, ctx) {
    Object.assign(ctx.local, {
      nodo: null, comparar: null, epoca: null, clave: '', claveOtra: '', idsClave: '',
      cad: null, otra: null, sel: null, pet: 0, petOtra: 0, accion: false, marcados: [],
      claveDetalle: '', claveVeredicto: '', informeTipo: null, paramObj: null, paramNodo: null,
    });
    construir(host, ctx);
    // respaldo por si el shell no llama a ocultar(): al salir de la ruta se retiran las marcas
    window.addEventListener('hashchange', () => { if (!rutaActiva(ctx)) desmarcarAnillo(ctx); });
  },

  mostrar(ctx) {
    if (!aplicarParametros(ctx)) marcarAnillo(ctx);
  },

  /** El shell la llama al dejar de mostrar la vista: el anillo deja de marcar la copia explorada. */
  ocultar(ctx) { desmarcarAnillo(ctx); },

  actualizar(e, ctx, cambios) {
    const L = ctx.local;
    if (L.epoca !== e.epoca || cambios.epocaCambio) {
      L.epoca = e.epoca;
      L.cad = null; L.otra = null; L.sel = null; L.clave = ''; L.claveOtra = '';
      L.claveDetalle = ''; L.claveVeredicto = ''; L.informeTipo = null;
      ctx.dom.reemplazar(L.informe);
      ctx.dom.reemplazar(L.lista);
      ctx.dom.reemplazar(L.detalle);
    }
    sincronizarSelectores(e, ctx);
    // «Abrir en el explorador» desde la ficha de una institución: se preselecciona su copia
    if (aplicarParametros(ctx, e)) return;
    pintarMando(e, ctx);
    // el anillo se reconstruye con cada red nueva: las marcas se reponen si faltan
    const marcas = `${e.epoca}|${L.nodo}|${L.comparar}`;
    if (marcas !== L.marcasClave && rutaActiva(ctx)) { L.marcasClave = marcas; marcarAnillo(ctx); }
    if (L.accion) return;                      // una acción propia recarga al terminar
    const n = e.nodos.find((x) => x.id === L.nodo);
    if (!n) return;
    const clave = `${e.epoca}|${n.id}|${n.altura}|${n.hash_cabeza}|${n.cadena_integra}`;
    if (clave !== L.clave) {
      const previa = L.cad;
      L.clave = clave;
      const extiende = previa && previa.nodo === n.id && previa.validacion?.valida && n.cadena_integra && n.altura + 1 > previa.total
        && n.altura + 1 - previa.total <= 100;
      cargar(ctx, { modo: extiende ? 'cola' : 'completo' });
    }
    const o = L.comparar ? e.nodos.find((x) => x.id === L.comparar) : null;
    const claveOtra = o ? `${e.epoca}|${o.id}|${o.altura}|${o.hash_cabeza}|${o.cadena_integra}|${L.cad?.desde ?? ''}` : '';
    if (claveOtra !== L.claveOtra) {
      L.claveOtra = claveOtra;
      if (o && L.cad) cargarOtra(ctx); else if (!o) { L.otra = null; pintarTodo(ctx); }
    }
  },
};
export default VISTA;

// ================================================================ construcción
function construir(host, ctx) {
  const { h, icono, ui, modo } = ctx;
  const L = ctx.local;
  const id = (x) => `cad-${modo}-${x}`;

  L.selNodo = h('select.selector', { id: id('nodo'), name: 'nodo' });
  L.selComparar = h('select.selector', { id: id('comparar'), name: 'comparar' });
  L.selNodo.addEventListener('change', () => elegirNodo(ctx, L.selNodo.value));
  L.selComparar.addEventListener('change', () => elegirComparar(ctx, L.selComparar.value || null));

  L.lAltura = h('dd.lectura__valor');
  L.lCabeza = h('dd.lectura__valor', ui.hash(null, { n: 5, ceros: modo === 'pow', etiqueta: 'Huella de la cabeza' }));
  L.lEstado = h('dd.lectura__valor');
  L.tono = h('span.cad-tono', { 'aria-hidden': 'true' });
  L.comparacion = h('p.cad-comparacion', { 'aria-live': 'polite' });

  L.nombreNodo = h('p.cad-mando__nombre');
  const mando = h('section.panel.panel--instrumento.cad-mando', { 'aria-labelledby': id('mando') },
    h('div.panel__cabecera', h('h2.etiqueta-instrumento', { id: id('mando') }, 'La copia del libro que exploras'),
      h('p.texto-3.cad-mando__nota', 'Cada institución conserva su ', ui.termino('copia_local', 'propia copia'), ' del libro de registros.')),
    h('div.panel__cuerpo.cad-mando__cuerpo',
      h('div.campo.cad-mando__nodo', h('label.campo__etiqueta', { for: L.selNodo.id }, 'Institución'), L.selNodo, L.nombreNodo),
      h('dl.cad-mando__lecturas',
        h('div.lectura', h('dt.lectura__etiqueta', 'Altura'), L.lAltura),
        h('div.lectura', h('dt.lectura__etiqueta', L.tono, 'Cabeza'), L.lCabeza),
        h('div.lectura', h('dt.lectura__etiqueta', 'Estado'), L.lEstado)),
      h('div.campo.cad-mando__comparar', h('label.campo__etiqueta', { for: L.selComparar.id }, '¿Coincide con la copia de…?'), L.selComparar),
      L.comparacion,
    ),
  );

  L.veredicto = h('div.cad-veredicto', { 'aria-live': 'polite' });
  L.informe = h('div.cad-informe', { 'aria-live': 'polite' });

  // ---- el carril -----------------------------------------------------------
  L.titCarril = h('h2.cad-carril__titulo', { id: id('carril') });
  L.cuenta = h('p.cad-carril__cuenta.texto-3');
  L.irGenesis = h('button.boton.boton--fantasma.boton--chico', { type: 'button' }, icono('flecha', { clase: 'cad-girado' }), h('span', 'Génesis'));
  L.irCabeza = h('button.boton.boton--fantasma.boton--chico', { type: 'button' }, h('span', 'Cabeza'), icono('flecha'));
  L.irGenesis.addEventListener('click', () => irA(ctx, 0));
  L.irCabeza.addEventListener('click', () => irA(ctx, (L.cad?.total ?? 1) - 1));
  L.anteriores = h('button.boton.boton--secundario.boton--chico.cad-anteriores', { type: 'button', hidden: true });
  L.anteriores.addEventListener('click', () => cargarAnteriores(ctx));
  L.lista = h('ol.cad-lista', { role: 'list', 'aria-labelledby': id('carril') });
  L.carril = h('div.cad-carril', L.anteriores, L.lista);
  L.estadoCarril = h('div.cad-carril__estado');

  const leyenda = h('ul.cad-leyenda', { role: 'list', 'aria-label': 'Leyenda' },
    h('li', h('i.cad-leyenda__marca', { dataset: { tipo: 'valido' } }), 'válido'),
    h('li', h('i.cad-leyenda__marca', { dataset: { tipo: 'invalido' } }), 'alterado o inválido'),
    h('li', h('i.cad-leyenda__marca', { dataset: { tipo: 'arrastrado' } }), 'cuelga de un inválido'),
    h('li', eslabon({ roto: true }), 'eslabón roto'));

  const carrilPanel = h('section.cad-carril-panel', { 'aria-labelledby': id('carril') },
    h('header.cad-carril__cabecera',
      h('div', L.titCarril, L.cuenta),
      h('div.grupo.cad-carril__saltos', L.irGenesis, L.irCabeza)),
    L.estadoCarril,
    L.carril,
    h('div.cad-carril__pie', leyenda, h('p.texto-3.cad-carril__ayuda', 'Flechas para recorrer · arrastra para desplazar · cada eslabón es el «hash anterior» que encaja con la huella del folio previo: si alguien altera un registro, el eslabón siguiente deja de encajar.')),
  );

  L.detalle = h('section.cad-detalle', { 'aria-labelledby': id('detalle') });

  // el informe de una alteración va ANTES del veredicto: cuando existe, manda él (el veredicto se pliega)
  host.append(h('div.cad', mando, L.informe, L.veredicto, carrilPanel, L.detalle));

  // ---- interacción del carril ---------------------------------------------
  L.lista.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('.cad-tarjeta') : null;
    if (b) seleccionar(ctx, Number(b.dataset.numero));
  });
  L.lista.addEventListener('keydown', (ev) => tecladoCarril(ev, ctx));
  arrastre(L.carril);
}

/** Desplazar el carril arrastrando con el ratón (el táctil ya desplaza solo). */
function arrastre(carril) {
  let inicio = null;
  let movio = false;
  carril.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    inicio = { x: e.clientX, y: e.clientY, l: carril.scrollLeft, t: carril.scrollTop, id: e.pointerId };
    movio = false;
  });
  carril.addEventListener('pointermove', (e) => {
    if (!inicio || e.pointerId !== inicio.id) return;
    const dx = e.clientX - inicio.x;
    const dy = e.clientY - inicio.y;
    if (!movio && Math.hypot(dx, dy) < 6) return;
    if (!movio) { movio = true; carril.setPointerCapture(e.pointerId); carril.dataset.arrastrando = ''; }
    carril.scrollLeft = inicio.l - dx;
    carril.scrollTop = inicio.t - dy;
  });
  const fin = () => {
    if (!inicio) return;
    inicio = null;
    delete carril.dataset.arrastrando;
  };
  carril.addEventListener('pointerup', fin);
  carril.addEventListener('pointercancel', fin);
  // un arrastre no debe acabar en «clic» sobre la tarjeta donde se soltó
  carril.addEventListener('click', (e) => { if (movio) { e.stopPropagation(); e.preventDefault(); movio = false; } }, true);
}

function rutaActiva(ctx) { return location.hash.startsWith(`#/${ctx.modo}/cadena`); }

/**
 * `ctx.parametros` lo añade el shell (aditivo; puede no existir): `{ nodo }` al llegar desde
 * «Abrir en el explorador» de la ficha de una institución. Cada objeto nuevo se aplica una vez;
 * después, el selector manda. Devuelve true si cambió la copia explorada.
 */
function aplicarParametros(ctx, e = ctx.estado()) {
  const L = ctx.local;
  const p = ctx.parametros;
  const id = p?.nodo;
  if (!id || !e?.ids?.includes(id)) return false;      // aún sin estado: se reintenta en actualizar()
  if (p === L.paramObj && id === L.paramNodo) return false;
  L.paramObj = p;
  L.paramNodo = id;
  if (id === L.nodo) return false;
  elegirNodo(ctx, id);
  return true;
}

// ============================================================ selección de nodo
function sincronizarSelectores(e, ctx) {
  const L = ctx.local;
  const clave = e.ids.join(',');
  if (clave !== L.idsClave) {
    L.idsClave = clave;
    L.selNodo.replaceChildren(...e.ids.map((id) => ctx.h('option', { value: id, title: nombreInst(id) }, etiqueta(id))));
    L.selComparar.replaceChildren(ctx.h('option', { value: '' }, '— no comparar —'), ...e.ids.map((id) => ctx.h('option', { value: id, title: nombreInst(id) }, etiqueta(id))));
    if (!e.ids.includes(L.nodo)) L.nodo = e.ids[0];
    if (L.comparar && !e.ids.includes(L.comparar)) L.comparar = null;
  }
  L.selNodo.value = L.nodo;
  L.selComparar.value = L.comparar || '';
  ctx.dom.texto(L.nombreNodo, L.nodo ? nombreInst(L.nodo) : '');
  // la etiqueta de cada opción dice cómo está esa copia (se lee al desplegar)
  for (const n of e.nodos) {
    const t = `${etiqueta(n.id)} · altura ${n.altura} · ${estadoNodo(n)[0].toLowerCase()}`;
    for (const sel of [L.selNodo, L.selComparar]) {
      const op = sel.querySelector(`option[value="${n.id}"]`);
      if (op && op.textContent !== t) op.textContent = t;
      if (sel === L.selComparar && op) op.disabled = n.id === L.nodo;
    }
  }
}

function estadoNodo(n) {
  if (!n.conectado) return ['Desconectada', 'obsoleto'];
  if (!n.cadena_integra) return ['Copia alterada', 'rechazado'];
  return n.sincronizado ? ['Sincronizada', 'valido'] : ['Atrasada', 'advertencia'];
}

function pintarMando(e, ctx) {
  const L = ctx.local;
  const n = e.nodos.find((x) => x.id === L.nodo);
  if (!n) return;
  ctx.dom.texto(L.lAltura, `${n.altura} · ${ctx.fmt.plural(n.altura + 1, 'folio', 'folios')}`);
  ctx.ui.actualizarHash(L.lCabeza.firstChild, n.hash_cabeza);
  ctx.dom.cssVar(L.tono, '--tono', ctx.fmt.tonoHash(n.hash_cabeza));
  const [txt, est] = estadoNodo(n);
  if (L.lEstado.dataset.clave !== txt) {
    L.lEstado.dataset.clave = txt;
    L.lEstado.replaceChildren(ctx.ui.chip(txt, est));
  }
}

function elegirNodo(ctx, id) {
  const L = ctx.local;
  if (id === L.nodo) return;
  L.nodo = id;
  if (L.comparar === id) L.comparar = null;
  L.cad = null; L.otra = null; L.sel = null; L.clave = ''; L.claveOtra = '';
  L.claveDetalle = ''; L.claveVeredicto = ''; L.informeTipo = null;
  ctx.dom.reemplazar(L.informe);
  L.lista.replaceChildren();
  marcarAnillo(ctx);
  const e = ctx.estado();
  if (e?.existe) VISTA.actualizar(e, ctx, {});
}

function elegirComparar(ctx, id) {
  const L = ctx.local;
  L.comparar = id;
  L.claveOtra = '';
  L.otra = null;
  pintarTodo(ctx);
  marcarAnillo(ctx);
  const e = ctx.estado();
  if (e?.existe) VISTA.actualizar(e, ctx, {});
}


function marcarAnillo(ctx) {
  const L = ctx.local;
  desmarcarAnillo(ctx);
  if (!rutaActiva(ctx)) return;
  if (L.nodo) { ctx.red.marcar(L.nodo, 'cad-explorado', true); L.marcados.push([L.nodo, 'cad-explorado']); }
  if (L.comparar) { ctx.red.marcar(L.comparar, 'cad-comparado', true); L.marcados.push([L.comparar, 'cad-comparado']); }
}
function desmarcarAnillo(ctx) {
  for (const [id, clase] of ctx.local.marcados) ctx.red.marcar(id, clase, false);
  ctx.local.marcados = [];
}

// ================================================================== carga
/**
 * modo: 'completo' (los últimos LOTE bloques), 'cola' (solo lo nuevo), 'anteriores' (LOTE más viejos).
 * Devuelve true si los datos se aplicaron.
 */
async function cargar(ctx, { modo = 'completo', desde: desdePedido = null } = {}) {
  const L = ctx.local;
  const id = L.nodo;
  const yo = ++L.pet;
  const nEst = ctx.store.nodo(ctx.modo, id);
  const total = (nEst?.altura ?? 0) + 1;
  let desde;
  let hasta;
  if (modo === 'cola' && L.cad) { desde = L.cad.desde + L.cad.bloques.length; hasta = Math.max(desde + 1, total); }
  else if (modo === 'anteriores' && L.cad) { desde = Math.max(0, L.cad.desde - LOTE); hasta = Math.max(desde + 1, L.cad.desde); }
  else { modo = 'completo'; desde = desdePedido ?? Math.max(0, total - LOTE); hasta = Math.max(desde + 1, total); }

  if (modo === 'completo' && !L.cad) pintarCargando(ctx);
  L.carril.setAttribute('aria-busy', 'true');
  let r;
  try {
    r = await pedirRango(ctx, id, desde, hasta);
  } catch (err) {
    if (yo !== L.pet) return false;
    L.carril.removeAttribute('aria-busy');
    pintarErrorCarga(ctx, err);
    return false;
  }
  if (yo !== L.pet || id !== L.nodo) return false;
  L.carril.removeAttribute('aria-busy');
  ctx.dom.reemplazar(L.estadoCarril);

  const previa = L.cad;
  if (modo === 'cola' && previa) {
    const ultimo = previa.bloques[previa.bloques.length - 1];
    if (r.desde !== previa.desde + previa.bloques.length || (r.bloques[0] && r.bloques[0].hash_anterior !== ultimo?.hash)) {
      return cargar(ctx, { modo: 'completo' });          // la cadena no solo creció: se recarga entera
    }
    previa.bloques.push(...r.bloques);
    Object.assign(previa, { total: r.total, validacion: r.validacion });
  } else if (modo === 'anteriores' && previa) {
    previa.bloques.unshift(...r.bloques.filter((b) => b.numero < previa.desde));
    Object.assign(previa, { desde: r.desde, total: r.total, validacion: r.validacion });
  } else {
    L.cad = { nodo: id, desde: r.desde, total: r.total, bloques: r.bloques, validacion: r.validacion };
  }
  L.cad.canon = new Map(L.cad.bloques.map((b) => [b.numero, serializarBloque(b)]));
  L.cad.fallas = new Map((r.validacion?.bloques || []).map((x) => [x.numero, x]));
  const cabeza = L.cad.total - 1;
  if (L.sel === null || L.sel > cabeza || L.sel < L.cad.desde && modo === 'completo') L.sel = cabeza;

  const mismoNodo = previa && previa.nodo === id;
  const alFinal = !mismoNodo || estaAlFinal(L.carril);
  const antes = medidaScroll(L.carril);
  pintarTodo(ctx);
  if (modo === 'anteriores') compensarScroll(L.carril, antes);
  else if (!mismoNodo) irAlFinal(L.carril, false);
  else if (alFinal && modo === 'cola') irAlFinal(L.carril, true);
  if (L.comparar) cargarOtra(ctx);
  return true;
}

/** Pide los bloques [desde, hasta) en páginas de 100 (el máximo del servidor). */
async function pedirRango(ctx, id, desde, hasta) {
  let d = desde;
  let ultimo = null;
  const bloques = [];
  do {
    const r = await ctx.api.get(`nodos/${id}/cadena`, { desde: d, limite: Math.max(1, Math.min(100, hasta - d)) });
    ultimo = r;
    bloques.push(...r.bloques);
    if (!r.bloques.length) break;
    d += r.bloques.length;
  } while (d < Math.min(hasta, ultimo.total));
  return { total: ultimo.total, desde, bloques, validacion: ultimo.validacion };
}

async function cargarAnteriores(ctx) {
  const L = ctx.local;
  if (!L.cad || L.cad.desde === 0) return;
  await ctx.ui.ocupado(L.anteriores, cargar(ctx, { modo: 'anteriores' }));
}

/** Copia del nodo con el que se compara, en el mismo rango que la explorada. */
async function cargarOtra(ctx) {
  const L = ctx.local;
  if (!L.comparar || !L.cad) return;
  const id = L.comparar;
  const yo = ++L.petOtra;
  const bloques = new Map();
  let total = null;
  let desde = L.cad.desde;
  try {
    while (desde < L.cad.total && (total === null || desde < total)) {
      const r = await ctx.api.get(`nodos/${id}/cadena`, { desde, limite: 100 });
      if (yo !== L.petOtra) return;
      total = r.total;
      for (const b of r.bloques) bloques.set(b.numero, { hash: b.hash, canon: serializarBloque(b) });
      if (!r.bloques.length) break;
      desde += r.bloques.length;
    }
  } catch (err) {
    if (yo === L.petOtra) ctx.ui.mostrarError(err, { titulo: `No se pudo leer la copia de ${etiqueta(id)}` });
    return;
  }
  if (yo !== L.petOtra || id !== L.comparar) return;
  L.otra = { nodo: id, total: total ?? 0, bloques };
  pintarTodo(ctx);
}

function pintarCargando(ctx) {
  const { h } = ctx;
  ctx.dom.reemplazar(ctx.local.lista, Array.from({ length: 6 }, () => h('li.cad-item.cad-item--esqueleto', { 'aria-hidden': 'true' }, h('span.esqueleto'))));
}

function pintarErrorCarga(ctx, err) {
  const { h, icono } = ctx;
  const L = ctx.local;
  const reintentar = h('button.boton.boton--secundario.boton--chico', { type: 'button', on: { click: () => { L.clave = ''; cargar(ctx, { modo: 'completo' }); } } }, icono('reiniciar'), h('span', 'Reintentar'));
  ctx.dom.reemplazar(L.estadoCarril, h('div.aviso', { dataset: { nivel: 'aviso' }, role: 'alert' }, icono('alerta'),
    h('div.pila', { style: { '--pila': 'var(--e-2)' } }, h('p', h('strong', 'No se pudo leer esta copia del libro. '), h('span.mensaje-servidor', conInstituciones(err?.message || ''))), h('div', reintentar))));
  if (L.lista.querySelector('.cad-item--esqueleto')) L.lista.replaceChildren();
}

// ============================================================ estado por bloque
function primeraInvalida(L) {
  let p = null;
  for (const [n, x] of L.cad.fallas) if (!x.valido && (p === null || n < p)) p = n;
  return p;
}

/** valido | invalido | arrastrado | sin-evaluar */
function estadoBloque(L, numero, p = primeraInvalida(L)) {
  const f = L.cad.fallas.get(numero);
  if (!f) return 'sin-evaluar';
  if (!f.valido) return 'invalido';
  return p !== null && numero > p ? 'arrastrado' : 'valido';
}

/** Eslabón que llega al bloque `numero`: ok | roto (enlace) | sello (apunta a una huella falsa). */
function estadoEslabon(L, numero) {
  if (numero === 0) return null;
  const f = L.cad.fallas.get(numero)?.fallas || [];
  if (f.includes('enlace')) return 'roto';
  const prev = L.cad.fallas.get(numero - 1)?.fallas || [];
  if (prev.includes('hash')) return 'sello';
  return 'ok';
}

function comparacion(L, b) {
  if (!L.otra) return null;
  const o = L.otra.bloques.get(b.numero);
  if (!o) return b.numero >= L.otra.total ? 'falta' : null;
  if (o.hash !== b.hash) return 'difiere';
  if (o.canon !== L.cad.canon.get(b.numero)) return 'contenido';
  return 'igual';
}

// ================================================================ pintado
function pintarTodo(ctx) {
  const L = ctx.local;
  if (!L.cad) return;
  pintarCarril(ctx);
  pintarVeredicto(ctx);
  pintarComparacion(ctx);
  pintarDetalle(ctx);
}

function pintarCarril(ctx) {
  const { fmt } = ctx;
  const L = ctx.local;
  const c = L.cad;
  ctx.dom.texto(L.titCarril, `El libro de ${etiqueta(c.nodo)}`);
  L.titCarril.title = etiquetaLarga(c.nodo);
  const hasta = c.desde + c.bloques.length - 1;
  ctx.dom.texto(L.cuenta, `${fmt.plural(c.total, 'folio', 'folios')}${c.desde > 0 ? ` · se muestran del #${c.desde} al #${hasta}` : ''}`);
  L.anteriores.hidden = c.desde === 0;
  if (c.desde > 0) {
    const n = Math.min(LOTE, c.desde);
    ctx.dom.texto(L.anteriores, `← Cargar ${fmt.plural(n, 'folio anterior', 'folios anteriores')}`);
  }
  for (const x of L.lista.querySelectorAll('.cad-item--esqueleto')) x.remove();
  ctx.dom.reconciliar(L.lista, c.bloques, (b) => `${b.numero}:${b.hash}:${b.proponente}:${b.transacciones?.length}`, (b) => crearItem(b, ctx));
  const p = primeraInvalida(L);
  for (const li of L.lista.children) {
    const numero = Number(li.dataset.numero);
    const b = c.bloques[numero - c.desde];
    if (b) actualizarItem(li, b, ctx, p);
  }
}

function crearItem(b, ctx) {
  const { h, fmt } = ctx;
  const esG = b.numero === 0;
  const ntx = Array.isArray(b.transacciones) ? b.transacciones.length : 0;
  const tarjeta = h('button.cad-tarjeta', { type: 'button', tabindex: '-1', dataset: { numero: b.numero } },
    h('span.cad-tarjeta__cab',
      h('span.cad-tarjeta__num', `#${b.numero}`),
      h('span.cad-tarjeta__estado')),
    h('span.cad-tarjeta__hash', hashCompacto(String(b.hash || ''), { n: 5, ceros: ctx.modo === 'pow' })),
    h('span.cad-tarjeta__meta', esG ? 'génesis · reglas de la red'
      : [h('span.cad-tarjeta__quien', siglaDe(b.proponente)), ` · ${fmt.plural(ntx, 'registro', 'registros')}`]),
    h('span.cad-tarjeta__comp', { hidden: true }),
  );
  const li = h('li.cad-item', { dataset: { numero: b.numero, genesis: esG ? 'si' : null } },
    esG ? null : eslabon({ cola: `…${String(b.hash_anterior || '').slice(-4)}` }),
    tarjeta);
  return li;
}

const ETQ_ESTADO = { valido: ['ok', 'válido'], invalido: ['x', 'inválido'], arrastrado: ['alerta', 'cuelga'], 'sin-evaluar': ['info', 'sin evaluar'] };

function actualizarItem(li, b, ctx, p) {
  const L = ctx.local;
  const est = estadoBloque(L, b.numero, p);
  const tarjeta = li.querySelector('.cad-tarjeta');
  if (tarjeta.dataset.estado !== est) {
    tarjeta.dataset.estado = est;
    const [ico, txt] = ETQ_ESTADO[est];
    tarjeta.querySelector('.cad-tarjeta__estado').replaceChildren(ctx.icono(ico), txt);
  }
  const enl = li.querySelector('.blq-eslabon');
  if (enl) {
    const e = estadoEslabon(L, b.numero);
    const v = e === 'ok' ? 'no' : e === 'roto' ? 'si' : 'sello';
    if (enl.dataset.roto !== v) enl.dataset.roto = v;
  }
  const comp = comparacion(L, b);
  const compEl = tarjeta.querySelector('.cad-tarjeta__comp');
  compEl.hidden = !comp;
  if (comp) {
    const o = siglaDe(L.otra.nodo);
    const t = { igual: `= ${o}`, difiere: `≠ ${o}`, contenido: `≠ contenido de ${o}`, falta: `${o} no lo tiene` }[comp];
    ctx.dom.texto(compEl, t);
    compEl.dataset.comp = comp;
  }
  tarjeta.dataset.comp = comp || '';
  const sel = L.sel === b.numero;
  ctx.dom.attr(tarjeta, 'aria-pressed', sel ? 'true' : 'false');
  ctx.dom.attr(tarjeta, 'tabindex', sel ? '0' : '-1');
  const ntx = Array.isArray(b.transacciones) ? b.transacciones.length : 0;
  const compTxt = comp ? `; frente a la copia de ${etiqueta(L.otra.nodo)}: ${{ igual: 'idéntico', difiere: 'huella distinta', contenido: 'misma huella guardada pero contenido distinto', falta: 'no lo tiene' }[comp]}` : '';
  const enlTxt = b.numero > 0 ? `; eslabón con el anterior ${{ ok: 'intacto', roto: 'roto', sello: 'apunta a una huella falsa' }[estadoEslabon(L, b.numero)]}` : '';
  ctx.dom.attr(tarjeta, 'aria-label', `Folio ${b.numero}${b.numero === 0 ? ' (génesis)' : ''}, ${ETQ_ESTADO[est][1]}, ${b.numero === 0 ? '' : `sellado por ${etiquetaLarga(b.proponente)}, ${ntx} registros de credencial, `}huella ${ctx.fmt.hashCorto(b.hash, 4)}${enlTxt}${compTxt}.`);
}

// ------------------------------------------------------------ scroll del carril
const vertical = (carril) => getComputedStyle(carril.querySelector('.cad-lista') || carril).flexDirection === 'column';
function medidaScroll(c) { return { w: c.scrollWidth, h: c.scrollHeight, l: c.scrollLeft, t: c.scrollTop }; }
function compensarScroll(c, a) { c.scrollLeft = a.l + (c.scrollWidth - a.w); c.scrollTop = a.t + (c.scrollHeight - a.h); }
function estaAlFinal(c) { return vertical(c) ? c.scrollTop + c.clientHeight >= c.scrollHeight - 40 : c.scrollLeft + c.clientWidth >= c.scrollWidth - 40; }
function irAlFinal(c, suave) {
  const op = { behavior: suave && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' };
  if (vertical(c)) c.scrollTo({ top: c.scrollHeight, ...op }); else c.scrollTo({ left: c.scrollWidth, ...op });
}

function tarjetaDe(ctx, numero) { return ctx.local.lista.querySelector(`.cad-tarjeta[data-numero="${numero}"]`); }

function mostrarTarjeta(ctx, numero, { enfocar = false } = {}) {
  const t = tarjetaDe(ctx, numero);
  if (!t) return null;
  const suave = !ctx.anim.reducido();
  // solo desplaza el carril (y la página lo justo para verlo), sin saltos bruscos
  t.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'nearest', inline: 'center' });
  if (enfocar) t.focus({ preventScroll: true });
  return t;
}

// ================================================================ selección
function seleccionar(ctx, numero, { enfocar = false } = {}) {
  const L = ctx.local;
  if (!L.cad) return;
  L.sel = numero;
  const p = primeraInvalida(L);
  for (const li of L.lista.children) {
    const b = L.cad.bloques[Number(li.dataset.numero) - L.cad.desde];
    if (b) actualizarItem(li, b, ctx, p);
  }
  pintarDetalle(ctx);
  if (enfocar) mostrarTarjeta(ctx, numero, { enfocar: true });
}

/** Lleva a un bloque cualquiera (cargando los anteriores si hace falta), lo enfoca y lo destaca. */
async function irA(ctx, numero, { destacar = false } = {}) {
  const L = ctx.local;
  if (!L.cad) return;
  while (L.cad && numero < L.cad.desde) {
    const ok = await cargar(ctx, { modo: 'anteriores' });
    if (!ok) return;
  }
  seleccionar(ctx, numero);
  const t = mostrarTarjeta(ctx, numero, { enfocar: true });
  if (t && destacar) ctx.anim.destello(t, t.dataset.estado === 'valido' ? 'var(--acento)' : 'var(--rechazado)');
}

function tecladoCarril(ev, ctx) {
  const L = ctx.local;
  const t = ev.target instanceof Element ? ev.target.closest('.cad-tarjeta') : null;
  if (!t || !L.cad) return;
  const actual = Number(t.dataset.numero);
  const ultimo = L.cad.total - 1;
  let destino = null;
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') destino = Math.min(ultimo, actual + 1);
  else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') destino = Math.max(0, actual - 1);
  else if (ev.key === 'Home') destino = 0;
  else if (ev.key === 'End') destino = ultimo;
  if (destino === null || destino === actual) return;
  ev.preventDefault();
  if (destino < L.cad.desde) irA(ctx, destino);
  else seleccionar(ctx, destino, { enfocar: true });
}

// ================================================================ veredicto
/** «Sincronizar con la red» + su explicación (en el veredicto y en el informe de una alteración). */
function accionSincronizar(ctx) {
  const { h, icono } = ctx;
  const L = ctx.local;
  const sinc = h('button.boton.boton--primario', { type: 'button' }, icono('sync'), h('span', 'Sincronizar con la red'));
  sinc.addEventListener('click', () => sincronizar(ctx, sinc));
  const n = ctx.store.nodo(ctx.modo, L.cad.nodo);
  const quien = etiqueta(L.cad.nodo);
  return h('div.cad-veredicto__accion', sinc,
    h('p.campo__ayuda', n?.conectado === false
      ? `${quien} está desconectada: reconéctala (en su ficha) para poder sincronizarla.`
      : `${quien} pedirá la mejor copia válida del libro a las demás instituciones, la validará entera y la adoptará: su copia dañada se reemplaza.`));
}

/** «3 problemas: hash, tx_firma en #4 · enlace en #5»: el veredicto en una línea. */
function resumenProblemas(v, fmt) {
  const porBloque = new Map();
  for (const p of v.problemas || []) {
    const k = p.bloque >= 0 ? p.bloque : -1;
    if (!porBloque.has(k)) porBloque.set(k, new Set());
    porBloque.get(k).add(p.codigo);
  }
  const partes = [...porBloque].slice(0, 3).map(([b, cods]) => `${[...cods].join(', ')}${b >= 0 ? ` en #${b}` : ''}`);
  const mas = porBloque.size > 3 ? ' · …' : '';
  return `${fmt.plural(v.total_problemas ?? (v.problemas || []).length, 'problema', 'problemas')}: ${partes.join(' · ')}${mas}`;
}

function pintarVeredicto(ctx) {
  const { h, icono, fmt } = ctx;
  const L = ctx.local;
  const v = L.cad.validacion || {};
  // con el informe de una alteración a la vista, el veredicto se pliega a una línea: manda el informe
  const plegar = L.informeTipo === 'manipulacion' && !v.valida;
  const clave = `${L.cad.nodo}|${v.valida}|${v.total_problemas}|${(v.problemas || []).map((p) => `${p.bloque}${p.codigo}`).join(',')}|${plegar}`;
  if (clave === L.claveVeredicto) return;
  L.claveVeredicto = clave;
  const quien = etiqueta(L.cad.nodo);
  if (v.valida) {
    ctx.dom.reemplazar(L.veredicto, h('div.aviso.cad-veredicto__caja', { dataset: { nivel: 'ok' } }, icono('escudo'),
      h('p', h('strong', `La copia de ${quien} es válida de punta a punta. `),
        `${fmt.plural(L.cad.total, 'folio', 'folios')}: cada huella coincide con su contenido, cada eslabón encaja con el folio anterior y las firmas, los créditos y el consenso cuadran. Ningún registro fue alterado.`)));
    return;
  }
  const letras = [...new Set((v.problemas || []).map((p) => reglaDe(p.codigo)).filter(Boolean))].sort();
  const chips = h('span.grupo', letras.map((l) => chipRegla(l, 'viola', { conTitulo: true })));
  const detalle = [
    listaProblemas(v.problemas || [], { alElegir: (num) => irA(ctx, num, { destacar: true }) }),
    v.total_problemas > (v.problemas || []).length ? h('p.texto-3', `Se muestran los primeros ${v.problemas.length}.`) : null,
  ];
  if (plegar) {
    const abierto = !!L.veredicto.querySelector('details.cad-veredicto__plegable')?.open;
    ctx.dom.reemplazar(L.veredicto, h('details.detalles.cad-veredicto__plegable', { open: abierto },
      h('summary.cad-veredicto__resumen',
        icono('alerta'),
        h('span.cad-veredicto__linea', h('strong', `Copia de ${siglaDe(L.cad.nodo)}: inválida`), h('span', ` · ${resumenProblemas(v, fmt)}`))),
      h('div.pila.cad-veredicto__cuerpo.cad-veredicto__desplegado', { style: { '--pila': 'var(--e-3)' } },
        h('div.cad-veredicto__titular', h('p.texto-2', 'Basta un problema para rechazar el libro entero. Cada uno lleva a su folio:'), chips),
        detalle)));
    return;
  }
  ctx.dom.reemplazar(L.veredicto, h('div.aviso.cad-veredicto__caja', { dataset: { nivel: 'error' } }, icono('alerta'),
    h('div.pila.cad-veredicto__cuerpo', { style: { '--pila': 'var(--e-3)' } },
      h('div.cad-veredicto__titular',
        h('p', h('strong', `La copia de ${quien} NO es válida: `), `${fmt.plural(v.total_problemas, 'problema', 'problemas')}. Basta uno para que el libro entero se rechace.`),
        chips),
      detalle,
      accionSincronizar(ctx),
    )));
}

function pintarComparacion(ctx) {
  const { h, icono, fmt } = ctx;
  const L = ctx.local;
  if (!L.comparar) { ctx.dom.reemplazar(L.comparacion); L.comparacion.hidden = true; return; }
  L.comparacion.hidden = false;
  if (!L.otra || L.otra.nodo !== L.comparar) { ctx.dom.reemplazar(L.comparacion, h('span.texto-3', `Leyendo la copia de ${etiqueta(L.comparar)}…`)); return; }
  const c = { ...L.cad, nodo: siglaDe(L.cad.nodo) };
  const o = { ...L.otra, nodo: siglaDe(L.otra.nodo) };
  let primera = null;
  let contenido = null;
  let iguales = 0;
  for (const b of c.bloques) {
    const r = comparacion(L, b);
    if (r === 'igual') iguales += 1;
    else if (r && primera === null) primera = b.numero;
    if (r === 'contenido' && contenido === null) contenido = b.numero;
  }
  const rango = c.desde > 0 ? ` (en los folios cargados, #${c.desde}–#${c.total - 1})` : '';
  const partes = [];
  let nivel = 'ok';
  if (primera === null && o.total === c.total) {
    partes.push(h('strong', `Idénticas${rango}. `), `${c.nodo} y ${o.nodo} guardan los mismos ${fmt.plural(c.total, 'folio', 'folios')}, con las mismas huellas y el mismo contenido.`);
  } else if (primera === null && o.total > c.total) {
    nivel = 'aviso';
    partes.push(h('strong', `${o.nodo} va por delante. `), `Coinciden todos los folios de ${c.nodo}, pero ${o.nodo} tiene ${fmt.plural(o.total - c.total, 'folio más', 'folios más')} (#${c.total}–#${o.total - 1}): ${c.nodo} está atrasada.`);
  } else {
    nivel = 'error';
    if (primera !== null && primera > c.desde) partes.push(h('strong', `Coinciden del #${c.desde} al #${primera - 1}; `), `desde el #${primera} difieren. `);
    else if (primera !== null) partes.push(h('strong', `Difieren desde el #${primera}. `));
    if (contenido !== null) partes.push(`El #${contenido} tiene la misma huella guardada pero distinto contenido: en una de las dos copias alguien alteró un registro sin recalcular la huella. `);
    if (o.total < c.total) partes.push(`${o.nodo} solo tiene ${fmt.plural(o.total, 'folio', 'folios')}.`);
  }
  ctx.dom.reemplazar(L.comparacion, h('span.cad-comparacion__icono', { dataset: { nivel } }, icono(nivel === 'ok' ? 'ok' : nivel === 'aviso' ? 'alerta' : 'x')), h('span', partes),
    h('span.texto-3', ` · ${iguales} de ${c.bloques.length} folios idénticos`));
}

// ================================================================== detalle
function pintarDetalle(ctx) {
  const L = ctx.local;
  const c = L.cad;
  const b = c?.bloques[L.sel - c.desde];
  if (!b) { ctx.dom.reemplazar(L.detalle); L.claveDetalle = ''; return; }
  const f = c.fallas.get(b.numero);
  const prev = c.bloques[b.numero - 1 - c.desde];
  const clave = `${c.nodo}|${b.numero}|${b.hash}|${c.canon.get(b.numero)?.length}|${c.canon.get(b.numero)?.slice(-80)}|${f?.fallas?.join(',')}|${prev?.hash ?? ''}|${primeraInvalida(L)}`;
  if (clave === L.claveDetalle) return;
  L.claveDetalle = clave;
  construirDetalle(ctx, b, prev);
}

function construirDetalle(ctx, b, prev) {
  const { h, ui, icono, fmt, modo } = ctx;
  const L = ctx.local;
  const c = L.cad;
  const idT = `cad-${modo}-detalle`;
  const est = estadoBloque(L, b.numero);
  const f = c.fallas.get(b.numero)?.fallas || [];
  const anterior = h('button.boton.boton--fantasma.boton--chico.boton--icono', { type: 'button', 'aria-label': 'Folio anterior', disabled: b.numero === 0, on: { click: () => irA(ctx, b.numero - 1) } }, icono('flecha', { clase: 'cad-girado' }));
  const siguiente = h('button.boton.boton--fantasma.boton--chico.boton--icono', { type: 'button', 'aria-label': 'Folio siguiente', disabled: b.numero >= c.total - 1, on: { click: () => irA(ctx, b.numero + 1) } }, icono('flecha'));
  const chips = [
    est === 'valido' ? ui.chip('válido', 'valido') : est === 'invalido' ? ui.chip(`inválido · ${f.join(', ')}`, 'rechazado')
      : est === 'arrastrado' ? ui.chip(`válido por sí solo · cuelga del #${primeraInvalida(L)}`, 'advertencia') : ui.chip('sin evaluar', 'neutro'),
    b.numero === 0 ? ui.chip('génesis', 'acento') : null,
    b.numero === c.total - 1 ? ui.chip('cabeza', 'pendiente') : null,
  ];

  const cuerpo = h('div.cad-detalle__rejilla',
    h('div.pila.cad-detalle__campos', campos(ctx, b, prev), b.numero === 0 ? genesisParams(ctx, b) : null),
    figuraHuella(ctx, b, prev),
  );
  const extras = [tablaTx(ctx, b), modo === 'pos' || (b.votos || []).length ? seccionPos(ctx, b) : null, manipulacion(ctx, b)];

  ctx.dom.reemplazar(L.detalle,
    h('header.cad-detalle__cabecera',
      h('div',
        h('p.etiqueta-instrumento', { title: etiquetaLarga(c.nodo) }, `Copia de ${etiqueta(c.nodo)}`),
        h('h2.cad-detalle__titulo', { id: idT }, `Folio #${b.numero}`)),
      h('div.grupo.cad-detalle__chips', chips),
      h('div.grupo.empuja', anterior, siguiente)),
    cuerpo,
    extras,
  );
}

function fila(ctx, campo, etiqueta, valor, nota = null) {
  const { h } = ctx;
  return h('div.cad-campo',
    h('dt', h('code.cad-campo__nombre', campo), h('span.cad-campo__etq', etiqueta)),
    h('dd', h('div.cad-campo__valor', valor), nota ? h('p.cad-campo__nota', nota) : null));
}

function campos(ctx, b, prev) {
  const { h, ui, icono, fmt, modo } = ctx;
  const L = ctx.local;
  const e = ctx.estado();
  const n = e?.config?.n || e?.nodos?.length || 1;
  const ok = (v, t) => h('span.cad-check', { dataset: { ok: v ? 'si' : 'no' } }, icono(v ? 'ok' : 'x'), t);
  const filas = [
    fila(ctx, 'numero', 'posición en el libro', h('span.mono', String(b.numero))),
    fila(ctx, 'timestamp', 'reloj lógico', h('span.mono', String(b.timestamp)), `${fmt.tiempo(b.timestamp)} desde el arranque de la red`),
    fila(ctx, 'proponente', modo === 'pow' ? 'institución que halló el nonce' : 'institución sorteada para proponer',
      b.numero === 0 ? h('span.mono', String(b.proponente)) : marcaInst(b.proponente), b.numero === 0 ? null : nombreInst(b.proponente)),
    fila(ctx, 'nonce', 'número de prueba', h('span.mono', fmt.num(b.nonce)),
      b.numero === 0 ? 'el génesis no se sella' : modo === 'pow' ? `${fmt.num(b.nonce)} mod ${n} = ${b.nonce % n}: el carril de ${siglaDe(b.proponente)}` : 'en Proof of Stake no se sella: siempre 0'),
    fila(ctx, 'recompensa', 'qué institución cobra y cuántos créditos', b.recompensa?.beneficiario
      ? h('span.cad-recompensa', marcaInst(b.recompensa.beneficiario), h('span.mono', ` ← ${cc(b.recompensa.monto)}`))
      : h('span.mono', 'nadie (0 CC)')),
    modo === 'pos' ? fila(ctx, 'ronda_pos', 'ronda de apuestas', h('span.mono', String(b.ronda_pos))) : null,
  ];
  // hash_anterior: el eslabón
  const enl = estadoEslabon(L, b.numero);
  const hexAnt = hexConDiff(String(b.hash_anterior || ''), { contra: prev?.hash || null, ceros: modo === 'pow', etiqueta: 'Hash anterior' });
  filas.push(fila(ctx, 'hash_anterior', ['el ', ui.termino('enlace', 'eslabón'), ' con el folio previo'], hexAnt.el,
    b.numero === 0 ? 'el génesis no tiene anterior: 64 ceros por convención'
      : prev ? ok(prev.hash === b.hash_anterior && enl !== 'sello',
        prev.hash === b.hash_anterior ? (enl === 'sello' ? ` coincide con la huella guardada del #${prev.numero}, pero esa huella ya no corresponde a su contenido` : ` coincide con la huella del #${prev.numero}`) : ` NO coincide con la huella del #${prev.numero} (en rojo, lo que cambia)`)
        : `debe coincidir con la huella del #${b.numero - 1} (no cargado)`));
  filas.push(fila(ctx, 'hash', ['la ', ui.termino('hash', 'huella'), ' de este folio'],
    h('div.cad-campo__hash', hexConDiff(String(b.hash || ''), { ceros: modo === 'pow', etiqueta: 'Huella' }).el,
      ui.hash(b.hash, { n: 4, ceros: modo === 'pow', etiqueta: `Huella del folio ${b.numero}` })),
    'SHA-256 de todos los campos anteriores. Mira abajo cómo se calcula.'));
  return h('dl.cad-campos', filas);
}

function genesisParams(ctx, b) {
  const { h, fmt } = ctx;
  const g = b.genesis || {};
  const saldos = Object.values(g.saldos || {});
  const suma = saldos.reduce((a, x) => a + (Number(x) || 0), 0);
  const filas = [
    ['modo', g.modo === 'pow' ? 'Proof of Work' : g.modo === 'pos' ? 'Proof of Stake' : String(g.modo)],
    ['n', `${g.n} instituciones`],
    ['semilla', String(g.semilla)],
    g.modo === 'pow' ? ['dificultad', `${g.dificultad} ceros hexadecimales`] : ['umbral', g.umbral ? `${g.umbral.num}/${g.umbral.den} de los créditos apostados` : '—'],
    g.modo === 'pos' ? ['castigo', g.castigo ? `regla ${g.castigo.regla}${g.castigo.alfa_pm ? ` · α ${(g.castigo.alfa_pm / 1000).toFixed(3)}` : ''}` : '—'] : null,
    ['recompensa', `${cc(g.recompensa)} por folio`],
    ['confirmaciones', String(g.confirmaciones)],
    ['max_tx_bloque', `${g.max_tx_bloque} registros por folio`],
    ['saldos', `créditos iniciales de ${saldos.length} instituciones · suman ${cc(suma)}`],
    ['claves', `${Object.keys(g.claves || {}).length} claves públicas Ed25519 (una por institución)`],
  ].filter(Boolean);
  return h('section.cad-genesis',
    h('h3.etiqueta-instrumento', 'genesis · las reglas de la red, selladas en el folio 0'),
    h('dl.renglones', filas.map(([k, v]) => h('div', h('dt', h('code', k)), h('dd', v)))),
    h('p.campo__ayuda', 'Este campo también entra en la huella del génesis: cambiar los créditos iniciales o la clave de una institución cambia la huella y el libro pasa a ser «de otra red».'));
}

// ------------------------------------------------------ «cómo se calcula esta huella»
function figuraHuella(ctx, b, prev) {
  const { h, ui, icono, fmt, modo } = ctx;
  const L = ctx.local;
  const texto = L.cad.canon.get(b.numero) || serializarBloque(b);
  const claves = camposDelHash(b);
  const calc = h('div.cad-huella__calc', h('span.esqueleto'));
  const veredicto = h('div.cad-huella__veredicto', { 'aria-live': 'polite' });
  const avalancha = h('div.cad-huella__avalancha', { 'aria-live': 'polite' });
  const probar = h('button.boton.boton--secundario.boton--chico', { type: 'button' }, icono('chispa'), h('span', 'Cambiar 1 crédito (solo aquí)'));
  probar.disabled = !(b.transacciones || []).length && !b.genesis;

  // el texto canónico, con las llaves de primer nivel resaltadas (mismo texto exacto)
  const piezas = ['{'];
  claves.forEach((k, i) => {
    piezas.push(h('span.cad-canon__clave', JSON.stringify(k)), ': ', h('span.cad-canon__valor', pyJson(b[k])));
    if (i < claves.length - 1) piezas.push(', ');
  });
  piezas.push('}');

  const fig = h('figure.cad-huella', { 'aria-labelledby': `cad-${modo}-huella-t` },
    h('figcaption.cad-huella__titulo', { id: `cad-${modo}-huella-t` }, 'Cómo se calcula esta huella'),
    h('ol.cad-pasos', { role: 'list' },
      h('li.cad-paso',
        h('span.cad-paso__num', '1'),
        h('div', h('p.cad-paso__et', `Se toman ${claves.length} campos, todos menos «hash»`, h('small', ' (la huella no puede entrar en su propio cálculo)')),
          h('ul.cad-claves', { role: 'list' }, claves.map((k) => h('li', h('code', k))), h('li.cad-claves__fuera', h('code', 'hash'))))),
      h('li.cad-paso',
        h('span.cad-paso__num', '2'),
        h('div', h('p.cad-paso__et', 'Se escriben como texto ', ui.termino('serializacion_canonica', 'canónico'), h('small', ` · ${fmt.num(bytesDe(texto))} bytes`)),
          h('p.cad-paso__nota', 'Llaves en orden alfabético, separadores «, » y «: », todo lo no ASCII como \\uXXXX: exactamente ', h('code', 'json.dumps(folio, sort_keys=True)'), ' de Python. Cualquier institución obtiene los mismos bytes.'),
          h('pre.cad-canon', { tabindex: '0', 'aria-label': 'Texto canónico del folio' }, h('code', piezas)))),
      h('li.cad-paso',
        h('span.cad-paso__num', '3'),
        h('div', h('p.cad-paso__et', 'SHA-256 de ese texto, calculado ', h('strong', 'ahora, en tu navegador'), h('small', ' (WebCrypto)')), calc, veredicto)),
      h('li.cad-paso',
        h('span.cad-paso__num', '4'),
        h('div', h('p.cad-paso__et', '¿Y si alguien altera un solo dato?'),
          h('p.cad-paso__nota', b.genesis && !(b.transacciones || []).length
            ? 'Prueba a sumar 1 crédito a los créditos iniciales de la primera institución del génesis: la huella cambia por completo (efecto avalancha). Nada se envía al servidor.'
            : 'Prueba a sumar 1 crédito al primer registro de credencial, como quien retoca un título ya registrado: la huella cambia por completo (efecto avalancha). Nada se envía al servidor.'),
          probar, avalancha)),
    ),
  );

  // cálculo asíncrono: si mientras tanto se eligió otro bloque, el resultado se descarta
  const clave = L.claveDetalle;
  ctx.fmt.sha256(texto).then((hex) => {
    if (clave !== L.claveDetalle) return;
    if (!hex) {
      ctx.dom.reemplazar(calc, h('p.aviso', { dataset: { nivel: 'aviso' } }, icono('alerta'), h('span', 'Tu navegador no permite calcular SHA-256 aquí (WebCrypto exige localhost o https).')));
      return;
    }
    const iguales = hex === b.hash;
    ctx.dom.reemplazar(calc, h('div.cad-huella__hex', hexConDiff(hex, { contra: String(b.hash || ''), ceros: modo === 'pow', etiqueta: 'Huella calculada en el navegador' }).el));
    const lineas = [
      h('p.cad-check', { dataset: { ok: iguales ? 'si' : 'no' } }, icono(iguales ? 'ok' : 'x'),
        iguales ? h('span', h('strong', 'Coincide con la huella guardada. '), 'El contenido es exactamente el que se selló.')
          : h('span', h('strong', 'NO coincide con la huella guardada. '), 'El contenido cambió después de sellarlo, como un título retocado tras su registro (en rojo, los caracteres distintos). Por eso este folio falla con «hash».')),
    ];
    if (!iguales) {
      lineas.push(h('div.cad-huella__guardada', h('span.etiqueta-instrumento', 'guardada en el folio'), hexConDiff(String(b.hash || ''), { contra: hex, ceros: modo === 'pow', etiqueta: 'Huella guardada' }).el));
    }
    if (modo === 'pow' && b.numero > 0) {
      const d = ctx.estado()?.parametros?.dificultad ?? 0;
      const z = fmt.cerosIniciales(b.hash);
      lineas.push(h('p.cad-check', { dataset: { ok: z >= d ? 'si' : 'no' } }, icono(z >= d ? 'ok' : 'x'),
        z >= d
          ? h('span', `Además empieza con ${z} ${z === 1 ? 'cero' : 'ceros'} (se exigen ${d}): hubo `, ui.termino('proof_of_work', 'trabajo'), ' detrás de este nonce.')
          : h('span', `Su huella empieza con ${z} ${z === 1 ? 'cero' : 'ceros'} y se exigen ${d}: no hay `, ui.termino('proof_of_work', 'trabajo'), ' demostrado.')));
    } else if (modo === 'pos' && b.numero > 0) {
      const V = (b.votos || []).reduce((a, x) => a + (x.peso || 0), 0);
      const A = Object.values(b.apuestas || {}).reduce((a, x) => a + (x || 0), 0);
      const fallas = L.cad.fallas.get(b.numero)?.fallas || [];
      const firmasMal = fallas.some((x) => x.startsWith('pos_voto') || x === 'pos_quorum');
      const ok = 3 * V >= 2 * A && !firmasMal;
      lineas.push(h('p.cad-check', { dataset: { ok: ok ? 'si' : 'no' } }, icono(ok ? 'ok' : 'x'),
        firmasMal
          ? h('span', `Los votos declaran ${cc(V)} de ${cc(A)} apostados, pero sus firmas avalaban el contenido original: al cambiarlo dejan de valer y no hay `, ui.termino('quorum', 'quórum'), '.')
          : h('span', 'En PoS no hay objetivo de ceros: lo respaldan ', ui.termino('quorum', 'los votos'), ` — ${cc(V)} a favor de ${cc(A)} apostados (3V ${3 * V >= 2 * A ? '≥' : '<'} 2A), cada uno firmado por su institución avaladora.`)));
    }
    ctx.dom.reemplazar(veredicto, lineas);
  });

  probar.addEventListener('click', async () => {
    const copia = JSON.parse(JSON.stringify(b));
    let que;
    if ((copia.transacciones || []).length) { copia.transacciones[0].monto += 1; que = `créditos del registro 1: ${b.transacciones[0].monto} → ${copia.transacciones[0].monto} CC`; }
    else { const k = Object.keys(copia.genesis.saldos).sort()[0]; copia.genesis.saldos[k] += 1; que = `créditos iniciales de ${etiqueta(k)}: ${b.genesis.saldos[k]} → ${copia.genesis.saldos[k]} CC`; }
    const hex = await ctx.fmt.sha256(serializarBloque(copia));
    if (!hex) return;
    const { el, distintos } = hexConDiff(hex, { contra: String(b.hash || ''), ceros: modo === 'pow', etiqueta: 'Huella con el dato cambiado' });
    ctx.dom.reemplazar(avalancha,
      h('p.cad-paso__nota', h('strong', que), ` → cambian ${distintos} de 64 caracteres:`),
      h('div.cad-huella__hex', el),
      h('p.cad-paso__nota', modo === 'pow'
        ? `Para que el folio volviera a valer habría que buscar otro nonce (${fmt.cerosIniciales(hex) >= (ctx.estado()?.parametros?.dificultad ?? 0) ? 'por suerte ya cumple el objetivo, pero' : 'esta huella no cumple el objetivo, y además'} el «hash anterior» del folio siguiente dejaría de encajar).`
        : 'Las instituciones avaladoras firmaron el contenido original: con este cambio ninguna firma de voto encajaría, y el folio siguiente perdería su eslabón.'));
    ctx.anim.entrar(avalancha.firstChild);
  });
  return fig;
}

// ------------------------------------------------------------- transacciones, PoS
function tablaTx(ctx, b) {
  const { h, ui, fmt } = ctx;
  const txs = Array.isArray(b.transacciones) ? b.transacciones : [];
  const firmas = Array.isArray(b.firma) ? b.firma : [];
  const idT = `cad-${ctx.modo}-tx`;
  if (!txs.length) {
    return h('section.cad-seccion', { 'aria-labelledby': idT }, h('h3.cad-seccion__titulo', { id: idT }, ui.termino('transaccion', 'Registros de credencial'), h('span.insignia', '0')),
      h('p.texto-3', b.numero === 0 ? 'El génesis no lleva registros: reparte los créditos de certificación iniciales de cada institución en su campo «genesis».' : 'Sin registros de credencial.'));
  }
  return h('section.cad-seccion', { 'aria-labelledby': idT },
    h('h3.cad-seccion__titulo', { id: idT }, ui.termino('transaccion', 'Registros de credencial'), h('span.insignia', String(txs.length)),
      h('small.texto-3', ' · cada uno con la ', ui.termino('firma', 'firma'), ' de la institución emisora (campo «firma», en el mismo orden)')),
    h('p.texto-3.cad-seccion__nota', 'Cada registro dice qué institución paga, a cuál, cuántos créditos y cuándo: la emisora paga para que la otra avale su credencial. Se firma solo eso; los datos del título o diploma no viajan en el libro.'),
    h('div.tabla-marco', h('table.tabla.cad-tabla',
      h('caption.solo-lectores', `Registros de credencial del folio ${b.numero}`),
      h('thead', h('tr', ['#', 'Emisora → avaladora', 'Créditos', 'timestamp', 'firma[i]'].map((t, i) => h('th', { scope: 'col', class: i === 2 ? 'num' : null }, t)))),
      h('tbody', txs.map((t, i) => h('tr',
        h('td.mono.texto-3', String(i + 1)),
        h('td', h('span.cad-ruta', { title: `${etiquetaLarga(t.emisor)} → ${etiquetaLarga(t.receptor)}` }, marcaInst(t.emisor), ctx.icono('flecha'), marcaInst(t.receptor))),
        h('td.num', cc(t.monto)),
        h('td.mono.texto-2', { title: t.timestamp }, fmt.tiempo(t.timestamp)),
        h('td', firmas[i] ? ui.hash(firmas[i], { n: 6, etiqueta: `Firma del registro ${i + 1}`, plano: true }) : h('span.texto-3', 'falta')),
      ))))));
}

function seccionPos(ctx, b) {
  const { h, ui, fmt } = ctx;
  const votos = Array.isArray(b.votos) ? b.votos : [];
  const apuestas = Object.entries(b.apuestas || {});
  const castigos = Array.isArray(b.castigos) ? b.castigos : [];
  const A = apuestas.reduce((a, [, v]) => a + (v || 0), 0);
  const V = votos.reduce((a, x) => a + (x.peso || 0), 0);
  const idT = `cad-${ctx.modo}-pos`;
  if (!votos.length && !apuestas.length && !castigos.length) return null;
  return h('section.cad-seccion', { 'aria-labelledby': idT },
    h('h3.cad-seccion__titulo', { id: idT }, ui.termino('quorum', 'Votos'), ', apuestas y castigos'),
    h('div.cad-pos',
      h('div.cad-pos__votos',
        h('p.etiqueta-instrumento', `votos · ${cc(V)} de ${cc(A)} apostados`),
        ui.medidor(V, A || 1, { etiqueta: 'Créditos de los votos a favor sobre los apostados', estado: 3 * V >= 2 * A ? 'valido' : 'rechazado' }),
        h('div.tabla-marco', h('table.tabla.cad-tabla',
          h('caption.solo-lectores', `Votos del folio ${b.numero}`),
          h('thead', h('tr', ['Institución que vota', 'Peso', 'Firma del voto'].map((t, i) => h('th', { scope: 'col', class: i === 1 ? 'num' : null }, t)))),
          h('tbody', votos.map((v) => h('tr',
            h('td', marcaInst(v.votante), v.votante === b.proponente ? h('small.texto-3', ' · proponente') : null),
            h('td.num', cc(v.peso)),
            h('td', ui.hash(v.firma, { n: 6, etiqueta: `Firma del voto de ${etiqueta(v.votante)}`, plano: true })))))))),
      h('div.cad-pos__apuestas',
        h('p.etiqueta-instrumento', ui.termino('stake', 'apuestas'), ` · ${apuestas.length} instituciones avaladoras`),
        h('ul.cad-apuestas', { role: 'list' }, apuestas.map(([id, v]) => h('li', { title: `${etiquetaLarga(id)}: ${cc(v)}` }, h('span.cad-apuestas__sigla', siglaDe(id)), h('b.mono', fmt.num(v))))),
        h('p.etiqueta-instrumento.cad-pos__castigos-t', ui.termino('castigo', 'castigos')),
        castigos.length
          ? h('ul.cad-castigos', { role: 'list' }, castigos.map((x) => h('li', marcaInst(String(x.proponente)), ` intento ${x.intento ?? '?'} · pierde ${cc(x.monto)} de ${cc(x.apuesta)} (anulados)`, x.ronda_pos !== b.ronda_pos ? h('small.texto-3', ` (de la ronda ${x.ronda_pos})`) : null)))
          : h('p.texto-3.cad-pos__nada', 'Ninguno: la primera institución sorteada propuso un folio válido.')),
    ));
}

// ================================================================ manipulación
function manipulacion(ctx, b) {
  const { h, ui, icono, modo } = ctx;
  const L = ctx.local;
  const nodo = L.cad.nodo;
  const nombre = `cad-${modo}-manip`;
  const sinFirmas = !(b.firma || []).length;
  const quien = etiqueta(nodo);
  const opciones = h('div.cad-manip__tipos', { role: 'radiogroup', 'aria-label': 'Tipo de alteración' },
    TIPOS_MANIP.map((t, i) => h('label.cad-manip__tipo', { dataset: { tipo: t.id } },
      h('input', { type: 'radio', name: nombre, value: t.id, checked: i === 0, disabled: t.id === 'firma' && sinFirmas }),
      h('span.cad-manip__tipo-texto', h('strong', t.titulo), h('span', t.id === 'firma' && sinFirmas ? 'Este folio no tiene firmas.' : t.texto)))));
  const prevista = h('div.cad-manip__prevista', { 'aria-live': 'polite' });
  const boton = h('button.boton.boton--peligro', { type: 'button' }, icono('grieta'), h('span', `Alterar la copia de ${siglaDe(nodo)}`));
  const pintar = () => pintarPrevista(ctx, b, opciones.querySelector('input:checked')?.value || 'contenido', prevista);
  opciones.addEventListener('change', pintar);
  boton.addEventListener('click', () => manipular(ctx, b, opciones.querySelector('input:checked')?.value || 'contenido', boton));
  const det = h('details.detalles.cad-manip',
    h('summary', icono('grieta'), `Alterar este folio en la copia de ${quien}…`),
    h('div.cad-manip__cuerpo',
      h('p.texto-2', 'Esto edita el folio ', h('strong', `solo en la copia de ${quien}`), ', como si alguien entrara a su archivo y retocara un título ya registrado. Las demás instituciones no se enteran. Después verás cómo la validación de ', siglaDe(nodo), ' detecta el cambio y en qué folios se propaga.'),
      opciones, prevista, h('div.cad-manip__pie', boton)));
  det.addEventListener('toggle', () => { if (det.open && !prevista.firstChild) pintar(); });
  return det;
}

/** Diff antes/después previsto (en el navegador) y lo que debería detectar la validación. */
async function pintarPrevista(ctx, b, tipo, caja) {
  const { h, icono, fmt, modo } = ctx;
  const L = ctx.local;
  const sig = b.numero < L.cad.total - 1 ? b.numero + 1 : null;
  let campo; let antes; let despues; let esperado = [];
  const copia = JSON.parse(JSON.stringify(b));
  const genesisSinTx = !(b.transacciones || []).length && b.genesis;
  if (tipo === 'contenido' || tipo === 'contenido_recalculado') {
    if (genesisSinTx) {
      const k = Object.keys(b.genesis.saldos).sort()[0];
      campo = `genesis.saldos.${k}`; antes = b.genesis.saldos[k]; despues = antes + 1; copia.genesis.saldos[k] = despues;
      esperado = [['genesis_invalido', 0]];
    } else {
      campo = 'transacciones[0].monto'; antes = b.transacciones[0].monto; despues = antes + 1; copia.transacciones[0].monto = despues;
      esperado = tipo === 'contenido' ? [['hash', b.numero], ['tx_firma', b.numero]] : [['tx_firma', b.numero]];
    }
  } else if (tipo === 'hash') {
    campo = 'hash'; antes = b.hash; despues = b.hash.slice(0, -1) + (b.hash.slice(-1) === '0' ? '1' : '0');
    esperado = b.numero === 0 ? [['genesis_invalido', 0]] : [['hash', b.numero]];
  } else {
    campo = 'firma[0]'; antes = `${b.firma[0].slice(0, 16)}…`; const f = (b.firma[0][0] === '0' ? '1' : '0') + b.firma[0].slice(1); despues = `${f.slice(0, 16)}…`;
    esperado = [['hash', b.numero], ['tx_firma', b.numero]];
  }
  let huellaNueva = null;
  if (tipo === 'contenido_recalculado') {
    huellaNueva = await ctx.fmt.sha256(serializarBloque(copia));
    if (b.numero > 0 && modo === 'pow' && huellaNueva && fmt.cerosIniciales(huellaNueva) < (ctx.estado()?.parametros?.dificultad ?? 0)) esperado.push(['pow_objetivo', b.numero]);
    if (b.numero > 0 && modo === 'pos') esperado.push(['pos_voto_firma', b.numero]);
  }
  if (b.numero > 0 && modo === 'pos' && tipo === 'contenido_recalculado') esperado.push(['pos_quorum', b.numero]);
  if ((tipo === 'hash' || tipo === 'contenido_recalculado') && sig !== null && b.numero > 0) esperado.push(['enlace', sig]);
  // en el génesis la validación se detiene ahí: nada de lo que cuelga se llega a revisar
  if (b.numero === 0) {
    esperado = tipo === 'contenido' ? [['genesis_invalido', 0]]
      : tipo === 'hash' ? [['genesis_invalido', 0], ['genesis_distinto', 0]] : [['genesis_distinto', 0]];
  }

  const valor = (v) => (typeof v === 'string' && v.length > 20 && /^[0-9a-f]+$/.test(v) ? hexConDiff(v, { contra: v === antes ? despues : antes, etiqueta: campo }).el : h('code', String(v)));
  const que = campo.includes('monto') ? ' (créditos del primer registro de credencial)' : campo.startsWith('genesis.saldos') ? ` (créditos iniciales de ${etiqueta(campo.split('.').pop())})` : campo.startsWith('firma') ? ' (firma de la institución emisora)' : '';
  ctx.dom.reemplazar(caja,
    h('div.cad-diff', { role: 'group', 'aria-label': `Cambio previsto en ${campo}` },
      h('p.cad-diff__campo', h('span.etiqueta-instrumento', `folio #${b.numero} · campo`), ' ', h('code', campo), h('span.texto-3', que)),
      h('div.cad-diff__fila', { dataset: { lado: 'antes' } }, h('span.cad-diff__lado', 'antes'), valor(antes)),
      h('div.cad-diff__fila', { dataset: { lado: 'despues' } }, h('span.cad-diff__lado', 'después'), valor(despues)),
      huellaNueva ? h('div.cad-diff__fila', { dataset: { lado: 'despues' } }, h('span.cad-diff__lado', 'huella nueva'), hexConDiff(huellaNueva, { contra: b.hash, ceros: modo === 'pow', etiqueta: 'Huella recalculada' }).el) : null),
    h('div.cad-manip__espera',
      h('p.etiqueta-instrumento', 'Qué debería detectar la validación de ', etiqueta(L.cad.nodo)),
      h('ul.cad-manip__lista', { role: 'list' }, esperado.map(([cod, num]) => h('li', chipRegla(reglaDe(cod) || 'a', 'viola'), h('span', h('code', cod), ` en el #${num}: `, h('span.texto-2', explicar(cod)))))),
      tipo === 'contenido_recalculado'
        ? h('p.campo__ayuda', 'Volver a calcular la ', ctx.ui.termino('huella_recalculada', 'huella'), ' no basta: el folio siguiente guarda la vieja como «hash anterior», y las firmas y el ', modo === 'pow' ? 'trabajo' : 'aval de las instituciones avaladoras', ' eran del contenido original.')
        : null),
  );
}

async function manipular(ctx, b, tipo, boton) {
  const { ui, fmt } = ctx;
  const L = ctx.local;
  const nodo = L.cad.nodo;
  const t = TIPOS_MANIP.find((x) => x.id === tipo);
  const quien = etiqueta(nodo);
  const ok = await ui.confirmar({
    titulo: `¿Alterar la copia de ${quien}?`,
    texto: `Se aplicará «${t.titulo.toLowerCase()}» al folio #${b.numero}, solo en la copia de ${quien}:`,
    lista: [
      t.texto,
      `${quien} revalidará su libro: lo dará por inválido entero y quedará fuera del consenso (no minará, no votará, no se le tendrá en cuenta).`,
      'Las copias de las demás instituciones no cambian. Podrás repararla con «Sincronizar con la red».',
    ],
    confirmar: 'Alterar',
    peligro: true,
  });
  if (!ok) return;
  const antes = new Set([...L.cad.fallas].filter(([, x]) => !x.valido).map(([n]) => n));
  L.accion = true;
  try {
    const r = await ui.ocupado(boton, ctx.api.accion('laboratorio/corromper', { nodo, bloque: b.numero, tipo }));
    L.informeTipo = 'manipulacion';            // el veredicto se pliega: manda el informe
    L.claveVeredicto = '';
    await cargar(ctx, { modo: 'completo', desde: L.cad?.desde ?? null });
    L.sel = b.numero;
    pintarTodo(ctx);
    pintarInformeCorrupcion(ctx, r, nodo, b.numero);
    propagar(ctx, b.numero, antes);
    ui.anunciar(`La copia de ${quien} quedó inválida: ${fmt.plural(r.validacion?.total_problemas ?? 0, 'problema', 'problemas')}.`);
  } catch (err) {
    ui.mostrarError(err, { titulo: 'No se pudo alterar la copia' });
  } finally {
    L.accion = false;
    L.clave = claveActual(ctx);
  }
}

function claveActual(ctx) {
  const e = ctx.estado();
  const n = e?.nodos?.find((x) => x.id === ctx.local.nodo);
  return n ? `${e.epoca}|${n.id}|${n.altura}|${n.hash_cabeza}|${n.cadena_integra}` : '';
}

/** Resultado de la manipulación: qué cambió y cómo se propagó la invalidez. */
function pintarInformeCorrupcion(ctx, r, nodo, numero) {
  const { h, icono, fmt } = ctx;
  const L = ctx.local;
  const d = r.descripcion || {};
  const v = r.validacion || {};
  const malos = (v.bloques || []).filter((x) => !x.valido);
  const p = malos.length ? Math.min(...malos.map((x) => x.numero)) : null;
  const total = L.cad?.total ?? 0;
  const malosSet = new Set(malos.map((x) => x.numero));
  const colgados = [];
  if (p !== null) for (let k = p + 1; k < total; k += 1) if (!malosSet.has(k)) colgados.push(k);
  const arrastrados = colgados.length;
  const rangoColgados = arrastrados ? (arrastrados === 1 ? `#${colgados[0]}` : `#${colgados[0]}…#${colgados[arrastrados - 1]}`) : '';
  const esHex = (x) => typeof x === 'string' && /^[0-9a-f]{20,}/.test(x);
  const valor = (x, otro) => (esHex(x) && esHex(otro) && x.length === otro.length ? hexConDiff(x, { contra: otro }).el : h('code', String(x)));
  const cerrar = h('button.boton.boton--fantasma.boton--chico.boton--icono', { type: 'button', 'aria-label': 'Cerrar el informe' }, icono('x'));
  cerrar.addEventListener('click', () => cerrarInforme(ctx));
  const quien = etiqueta(nodo);
  ctx.dom.reemplazar(L.informe, h('section.cad-informe__caja', { 'aria-label': 'Resultado de la alteración' },
    h('header.cad-informe__cabecera', h('span.cad-informe__icono', icono('grieta')),
      h('div', h('p.etiqueta-instrumento', 'acabas de alterar un registro sellado'), h('h3', `La copia de ${quien}: ${fraseAlteracion(d) || `folio #${numero}`}`)), cerrar),
    h('div.cad-diff',
      h('p.cad-diff__campo', h('span.etiqueta-instrumento', `folio #${d.bloque ?? numero} · campo`), ' ', h('code', String(d.campo))),
      h('div.cad-diff__fila', { dataset: { lado: 'antes' } }, h('span.cad-diff__lado', 'antes'), valor(d.antes, d.despues)),
      h('div.cad-diff__fila', { dataset: { lado: 'despues' } }, h('span.cad-diff__lado', 'después'), valor(d.despues, d.antes)),
      d.huella_recalculada ? h('p.campo__ayuda', 'Y el falsificador volvió a calcular la huella del folio para que «cuadre».') : null),
    h('p.etiqueta-instrumento', 'Cómo se propaga la invalidez'),
    h('ol.cad-propagacion', { role: 'list' },
      malos.map((x) => h('li', { dataset: { tipo: 'invalido' } },
        h('button.cad-propagacion__ir', { type: 'button', 'aria-label': `Ir al folio ${x.numero}`, on: { click: () => irA(ctx, x.numero, { destacar: true }) } }, `#${x.numero}`),
        h('span', h('strong', 'inválido: '), x.fallas.map((c) => h('code', c)).reduce((a, el, i) => (i ? [...a, ', ', el] : [el]), []),
          h('span.texto-2', ` — ${explicar(x.fallas[0])}`)))),
      arrastrados > 0 ? h('li', { dataset: { tipo: 'arrastrado' } }, h('span.cad-propagacion__ir.mono', rangoColgados),
        h('span', h('strong', `${fmt.plural(arrastrados, 'folio', 'folios')} más `), 'son válidos por sí solos, pero cuelgan de un folio inválido: el libro es un todo y se rechaza entero.')) : null,
      h('li', { dataset: { tipo: 'veredicto' } }, h('span.cad-propagacion__ir', icono('alerta')),
        h('span', h('strong', `Libro de ${quien}: inválido`), ` (${fmt.plural(v.total_problemas ?? 0, 'problema', 'problemas')}). ${siglaDe(nodo)} sale del consenso hasta sincronizarse; mira el anillo: su contorno se rompe.`))),
    accionSincronizar(ctx),
  ));
  ctx.anim.entrar(L.informe.firstChild);
}

/** Cerrar el informe devuelve el protagonismo al veredicto (se despliega otra vez). */
function cerrarInforme(ctx) {
  const L = ctx.local;
  ctx.dom.reemplazar(L.informe);
  L.informeTipo = null;
  L.claveVeredicto = '';
  if (L.cad) pintarVeredicto(ctx);
}

/** La onda de invalidez: el bloque manipulado se sacude y la marca recorre lo que cuelga de él. */
function propagar(ctx, desde, invalidosAntes) {
  const L = ctx.local;
  if (!L.cad) return;
  mostrarTarjeta(ctx, desde);
  const items = [...L.lista.children].filter((li) => Number(li.dataset.numero) >= desde);
  const paso = Math.min(45, 700 / Math.max(1, items.length));
  items.forEach((li, i) => {
    const t = li.querySelector('.cad-tarjeta');
    const n = Number(li.dataset.numero);
    const retraso = 140 + i * paso;
    if (t.dataset.estado === 'invalido' && !invalidosAntes.has(n)) {
      setTimeout(() => ctx.anim.sacudir(t), retraso);
    } else if (t.dataset.estado === 'arrastrado') {
      ctx.anim.animar(t, [{ opacity: 1, transform: 'none' }, { opacity: 0.5, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, delay: retraso, easing: ctx.anim.CURVA.func });
    }
    const enl = li.querySelector('.blq-eslabon[data-roto="si"], .blq-eslabon[data-roto="sello"]');
    if (enl) ctx.anim.animar(enl, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, delay: retraso, easing: ctx.anim.CURVA.acuse });
  });
}

async function sincronizar(ctx, boton) {
  const { ui, h, icono, fmt } = ctx;
  const L = ctx.local;
  const nodo = L.cad?.nodo;
  if (!nodo) return;
  L.accion = true;
  const quien = etiqueta(nodo);
  try {
    const r = await ui.ocupado(boton, ctx.api.accion(`nodos/${nodo}/sincronizar`));
    const res = r.resultado || {};
    L.informeTipo = 'sincronizacion';
    L.claveVeredicto = '';
    await cargar(ctx, { modo: 'completo', desde: L.cad?.desde ?? null });
    const valida = L.cad?.validacion?.valida;
    const cerrar = h('button.boton.boton--fantasma.boton--chico.boton--icono', { type: 'button', 'aria-label': 'Cerrar el informe' }, icono('x'));
    cerrar.addEventListener('click', () => cerrarInforme(ctx));
    ctx.dom.reemplazar(L.informe, h('section.cad-informe__caja', { dataset: { nivel: valida ? 'ok' : 'aviso' }, 'aria-label': 'Resultado de la sincronización' },
      h('header.cad-informe__cabecera', h('span.cad-informe__icono', icono(valida ? 'escudo' : 'alerta')),
        h('div', h('p.etiqueta-instrumento', 'sincronización'),
          h('h3', valida ? `${quien} reparó su copia del libro` : `${quien} sigue con problemas`)), cerrar),
      h('p.texto-2', h('span.mensaje-servidor', fmt.capital(conInstituciones(res.motivo || ''))), ' ',
        valida ? `Pidió la mejor copia válida a las demás instituciones, la validó entera con las reglas (a), (b) y (c) y la adoptó: ${fmt.plural(L.cad.total, 'folio', 'folios')} de registros íntegros otra vez.` : ''),
    ));
    ctx.anim.entrar(L.informe.firstChild);
    if (valida) {
      const items = [...L.lista.children];
      const paso = Math.min(30, 500 / Math.max(1, items.length));
      items.forEach((li, i) => setTimeout(() => ctx.anim.destello(li.querySelector('.cad-tarjeta'), 'var(--valido)'), i * paso));
    }
    ui.anunciar(valida ? `${quien} sincronizada: su copia vuelve a ser válida.` : conInstituciones(res.motivo || 'Sincronización terminada.'));
  } catch (err) {
    ui.mostrarError(err, { titulo: `${quien} no pudo sincronizarse` });
  } finally {
    L.accion = false;
    L.clave = claveActual(ctx);
  }
}

