// VISTA · Laboratorio de falsificación — «¿puede una institución colar un registro falso?»
//  · Las reglas con las que una institución acepta una copia del libro: (a) huellas y enlaces,
//    (b) firmas y créditos, (c) consenso, (d) más larga que la propia.
//  · Catálogo de los 13 ataques (falsificaciones) agrupados por la regla que ponen a prueba, con
//    institución víctima y bloque objetivo. Cada uno se evalúa contra la copia de una
//    institución SIN modificarla. Historia en clave de credenciales + detalle técnico del servidor.
//  · El resultado como escena: copia propia frente a copia falsificada, veredicto bloque a
//    bloque, regla que saltó, si se detectó lo esperado y prueba de que la víctima no cambió.
//    En el anillo, el paquete falsificado rebota al llegar a la víctima.
//  · «Probar los 13» (secuencial, tabla resumen) e historial de la sesión.
//  · Enganche del shell: `ocultar(ctx)` retira la mira del anillo (con `hashchange` de respaldo).

import {
  REGLAS, NOMBRE_ATAQUE, HISTORIA_ATAQUE, TECNICA_ATAQUE, GRUPOS_ATAQUE, ESPERADO_TIPO, TIPOS_CON_BLOQUE, TIPOS_REQUIEREN_BLOQUES,
  reglaDe, explicar, chipRegla, estadoReglas, listaProblemas,
  marcaInst, etiqueta, etiquetaLarga, siglaDe, nombre as nombreInst, conInstituciones,
} from './_bloque_ui.js';

const ORDEN = GRUPOS_ATAQUE.flatMap((g) => g.tipos);
const MAX_HISTORIAL = 60;

const VISTA = {
  id: 'laboratorio',
  etiqueta: 'Falsificaciones',
  titulo: 'Falsificaciones: ¿puede colarse un registro falso?',
  icono: 'matraz',
  modos: ['pow', 'pos'],
  orden: 50,
  descripcion: 'Envía copias manipuladas del libro de registros a una institución y comprueba que su validación las detecta y las rechaza. La institución atacada nunca cambia su copia.',
  insignia: () => null,

  montar(host, ctx) {
    Object.assign(ctx.local, {
      victima: null, bloque: '', historial: [], lote: null, idsClave: '', alturaClave: null,
      marcados: [], marcasClave: '', epoca: null, contador: 0, ultimoPorTipo: new Map(),
    });
    construir(host, ctx);
    // respaldo por si el shell no llama a ocultar(): al salir de la ruta se retira la mira
    window.addEventListener('hashchange', () => { if (!rutaActiva(ctx)) desmarcar(ctx); });
  },

  mostrar(ctx) { ctx.local.marcasClave = ''; },

  /** El shell la llama al dejar de mostrar la vista: la víctima deja de llevar la mira en el anillo. */
  ocultar(ctx) { desmarcar(ctx); ctx.local.marcasClave = ''; },

  actualizar(e, ctx) {
    const L = ctx.local;
    if (L.epoca !== e.epoca) {
      if (L.epoca !== null) L.ultimoPorTipo.clear();
      L.epoca = e.epoca;
      for (const card of L.tarjetas.values()) pintarUltimo(ctx, card);
    }
    sincronizarVictima(e, ctx);
    sincronizarBloques(e, ctx);
    pintarMando(e, ctx);
    const marcas = `${e.epoca}|${L.victima}`;
    if (marcas !== L.marcasClave && rutaActiva(ctx)) { L.marcasClave = marcas; marcar(ctx); }
  },
};
export default VISTA;

function rutaActiva(ctx) { return location.hash.startsWith(`#/${ctx.modo}/laboratorio`); }

/** Descripción técnica de una falsificación (la propia, o la del servidor si el tipo es nuevo). */
function tecnicaDe(ctx, tipo) { return TECNICA_ATAQUE[tipo] || conInstituciones(ctx.limites.ataques?.[tipo] || ''); }

// ================================================================ construcción
function construir(host, ctx) {
  const { h, ui, icono, modo } = ctx;
  const L = ctx.local;
  const id = (x) => `lab-${modo}-${x}`;

  // ---- reglas -------------------------------------------------------------
  const termino = { a: ['hash', 'huella'], b: ['firma', 'firma'], c: [modo === 'pow' ? 'proof_of_work' : 'quorum', modo === 'pow' ? 'trabajo' : 'quórum'], d: ['regla_cadena_mas_larga', 'libro más completo'] };
  L.reglasEl = new Map();
  const reglas = h('section.lab-reglas', { 'aria-labelledby': id('reglas') },
    h('header.lab-reglas__cabecera',
      h('h2', { id: id('reglas') }, '¿Cuándo acepta una institución una copia del libro?'),
      h('p.texto-2', 'Cada institución valida ENTERA la copia que recibe, desde el ', ui.termino('genesis', 'génesis'), '. Solo la adopta si pasa las cuatro reglas; si falla una, la rechaza y conserva la suya. Una ', ui.termino('ataque_cadena', 'falsificación'), ' intenta colar una copia que viole alguna: un título retocado, una firma ajena, créditos usados dos veces…')),
    h('ol.lab-reglas__lista', { role: 'list' }, Object.entries(REGLAS).map(([l, r]) => {
      const li = h('li.lab-regla', { dataset: { regla: l } },
        h('span.lab-regla__letra', { 'aria-hidden': 'true' }, l),
        h('div.lab-regla__texto',
          h('h3', h('span.solo-lectores', `Regla ${l}: `), r.titulo),
          h('p', r.texto),
          h('p.lab-regla__ver', 'Ver ', ui.termino(termino[l][0], termino[l][1]), l === 'a' ? [' · ', ui.termino('huella_recalculada', 'huella recalculada')] : null)));
      L.reglasEl.set(l, li);
      return li;
    })),
    h('p.lab-reglas__orden.texto-3', 'Orden: primero se valida (a, b, c) folio a folio sin detenerse en el primer error; solo si todo es válido se mira la longitud (d).'),
  );

  // ---- mando: víctima + probar los 13 --------------------------------------
  L.selVictima = h('select.selector', { id: id('victima'), name: 'destino' });
  L.selVictima.addEventListener('change', () => { L.victima = L.selVictima.value; L.marcasClave = ''; const e = ctx.estado(); if (e?.existe) VISTA.actualizar(e, ctx, {}); });
  L.vNombre = h('p.lab-mando__nombre');
  L.vAltura = h('dd.lectura__valor');
  L.vCabeza = h('dd.lectura__valor', ui.hash(null, { n: 4, ceros: modo === 'pow', etiqueta: 'Cabeza de la víctima' }));
  L.vEstado = h('dd.lectura__valor');
  L.botonLote = h('button.boton.boton--primario.lab-lote__boton', { type: 'button' }, icono('play'), h('span', 'Probar los 13'));
  L.botonLote.addEventListener('click', () => (L.lote?.corriendo ? detenerLote(ctx) : probarTodos(ctx)));
  const mando = h('section.panel.panel--instrumento.lab-mando', { 'aria-labelledby': id('mando') },
    h('div.panel__cabecera', h('h2.etiqueta-instrumento', { id: id('mando') }, 'Institución víctima')),
    h('div.panel__cuerpo.lab-mando__cuerpo',
      h('div.campo', h('label.campo__etiqueta', { for: L.selVictima.id }, 'Intentar engañar a'), L.selVictima, L.vNombre),
      h('dl.lab-mando__lecturas',
        h('div.lectura', h('dt.lectura__etiqueta', 'Altura'), L.vAltura),
        h('div.lectura', h('dt.lectura__etiqueta', 'Cabeza'), L.vCabeza),
        h('div.lectura', h('dt.lectura__etiqueta', 'Estado'), L.vEstado)),
      h('div.lab-mando__lote', L.botonLote,
        h('p.campo__ayuda', 'Lanza las 13 falsificaciones seguidas contra esta institución (con el folio automático) y resume el resultado en una tabla.')),
    ));

  // ---- catálogo ------------------------------------------------------------
  L.selBloque = h('select.selector', { id: id('bloque'), name: 'bloque' });
  L.selBloque.addEventListener('change', () => { L.bloque = L.selBloque.value; });
  L.tarjetas = new Map();
  let n = 0;
  const catalogo = h('section.lab-catalogo', { 'aria-labelledby': id('catalogo') },
    h('h2.lab-catalogo__titulo', { id: id('catalogo') }, 'Las 13 falsificaciones'),
    GRUPOS_ATAQUE.map((g) => h('section.lab-grupo', { dataset: { regla: g.regla }, 'aria-labelledby': id(`g-${g.id}`) },
      h('header.lab-grupo__cabecera',
        chipRegla(g.regla, 'esperada'),
        h('div', h('h3', { id: id(`g-${g.id}`) }, g.titulo), h('p.texto-3', g.bajada))),
      g.id === 'integridad' ? h('div.campo.lab-grupo__bloque',
        h('label.campo__etiqueta', { for: L.selBloque.id }, 'Folio objetivo', h('span.opcional', 'para estas 4 falsificaciones')), L.selBloque,
        h('p.campo__ayuda', 'Automático: la cabeza para «huella alterada» y «eslabón alterado»; un folio intermedio para las otras dos. El 0 es el génesis.')) : null,
      h('ol.lab-grupo__lista', { role: 'list' }, g.tipos.map((tipo) => {
        n += 1;
        const card = tarjetaAtaque(ctx, tipo, n);
        L.tarjetas.set(tipo, card);
        return card.li;
      })),
    )),
  );

  // ---- escena --------------------------------------------------------------
  L.escena = h('section.lab-escena', { 'aria-labelledby': id('escena'), tabindex: '-1' },
    h('h2.solo-lectores', { id: id('escena') }, 'Resultado de la falsificación'),
    h('div.lab-escena__cuerpo', { 'aria-live': 'polite' }, escenaVacia(ctx)));

  // ---- lote e historial ----------------------------------------------------
  L.loteEl = h('section.lab-lote', { 'aria-labelledby': id('lote'), hidden: true });
  L.loteEl.dataset.titulo = id('lote');
  L.historialEl = h('section.lab-historial', { 'aria-labelledby': id('historial') });
  L.historialEl.dataset.titulo = id('historial');
  pintarHistorial(ctx);

  host.append(h('div.lab', reglas, h('div.lab-mesa', h('div.lab-mesa__izq', mando, catalogo), h('div.lab-mesa__der', L.escena)), L.loteEl, L.historialEl));
}

function tarjetaAtaque(ctx, tipo, n) {
  const { h, icono } = ctx;
  const regla = reglaDe(ESPERADO_TIPO[tipo]);
  const boton = h('button.boton.boton--secundario.boton--chico.lab-ataque__lanzar', { type: 'button', 'aria-label': `Lanzar la falsificación «${NOMBRE_ATAQUE[tipo]}»` }, icono('flecha'), h('span', 'Lanzar'));
  const ultimo = h('span.lab-ataque__ultimo');
  const requiere = h('p.lab-ataque__requiere', { hidden: true }, icono('alerta'), ' Necesita al menos un folio de registros sellado.');
  boton.addEventListener('click', () => lanzar(ctx, tipo, boton));
  const tecnico = tecnicaDe(ctx, tipo);
  const li = h('li.lab-ataque', { dataset: { tipo } },
    h('span.lab-ataque__num.mono', String(n).padStart(2, '0')),
    h('div.lab-ataque__texto',
      h('h4', NOMBRE_ATAQUE[tipo] || tipo),
      h('p', HISTORIA_ATAQUE[tipo] || tecnico),
      tecnico && HISTORIA_ATAQUE[tipo] ? h('p.lab-ataque__tecnico', h('span.lab-ataque__en-cadena', 'lo que se envía · '), tecnico) : null,
      h('p.lab-ataque__espera', 'debe saltar ', h('code', ESPERADO_TIPO[tipo]), regla ? [' · regla ', h('strong', `(${regla})`)] : null, TIPOS_CON_BLOQUE.has(tipo) ? ' · usa el folio objetivo' : null),
      requiere),
    h('div.lab-ataque__acciones', boton, ultimo));
  return { li, boton, ultimo, requiere, tipo };
}

// ================================================================ víctima y bloque
function sincronizarVictima(e, ctx) {
  const L = ctx.local;
  const clave = e.ids.join(',');
  if (clave !== L.idsClave) {
    L.idsClave = clave;
    L.selVictima.replaceChildren(...e.ids.map((id) => ctx.h('option', { value: id, title: nombreInst(id) }, etiqueta(id))));
    if (!e.ids.includes(L.victima)) L.victima = (e.nodos.find((x) => x.conectado && x.cadena_integra) || e.nodos[0])?.id;
  }
  if (L.selVictima.value !== L.victima) L.selVictima.value = L.victima;
  ctx.dom.texto(L.vNombre, L.victima ? nombreInst(L.victima) : '');
  for (const n of e.nodos) {
    const t = `${etiqueta(n.id)} · altura ${n.altura}${!n.conectado ? ' · desconectada' : !n.cadena_integra ? ' · copia alterada' : ''}`;
    const op = L.selVictima.querySelector(`option[value="${n.id}"]`);
    if (op && op.textContent !== t) op.textContent = t;
  }
}

function sincronizarBloques(e, ctx) {
  const L = ctx.local;
  if (L.alturaClave === e.altura) return;
  L.alturaClave = e.altura;
  const { h } = ctx;
  L.selBloque.replaceChildren(h('option', { value: '' }, 'Automático'),
    ...Array.from({ length: e.altura + 1 }, (_, i) => h('option', { value: String(i) }, i === 0 ? '#0 · génesis' : i === e.altura ? `#${i} · cabeza` : `#${i}`)));
  if (L.bloque !== '' && Number(L.bloque) > e.altura) L.bloque = '';
  L.selBloque.value = L.bloque;
  for (const card of L.tarjetas.values()) card.requiere.hidden = !(TIPOS_REQUIEREN_BLOQUES.has(card.tipo) && e.altura < 1);
}

function pintarMando(e, ctx) {
  const L = ctx.local;
  const n = e.nodos.find((x) => x.id === L.victima);
  if (!n) return;
  ctx.dom.texto(L.vAltura, `${n.altura} · ${ctx.fmt.plural(n.altura + 1, 'folio', 'folios')}`);
  ctx.ui.actualizarHash(L.vCabeza.firstChild, n.hash_cabeza);
  const [txt, est] = !n.conectado ? ['Desconectada', 'obsoleto'] : !n.cadena_integra ? ['Copia alterada', 'rechazado'] : n.sincronizado ? ['Sincronizada', 'valido'] : ['Atrasada', 'advertencia'];
  if (L.vEstado.dataset.clave !== txt) { L.vEstado.dataset.clave = txt; L.vEstado.replaceChildren(ctx.ui.chip(txt, est)); }
}

function marcar(ctx) {
  desmarcar(ctx);
  const L = ctx.local;
  if (!L.victima) return;
  ctx.red.marcar(L.victima, 'lab-objetivo', true);
  L.marcados.push(L.victima);
}
function desmarcar(ctx) {
  for (const id of ctx.local.marcados) ctx.red.marcar(id, 'lab-objetivo', false);
  ctx.local.marcados = [];
}

// ================================================================ lanzar
/** Lanza un ataque. Devuelve la entrada del historial (o null si fue un error de red/interfaz). */
async function lanzar(ctx, tipo, boton, { lote = false } = {}) {
  const { ui } = ctx;
  const L = ctx.local;
  const destino = L.victima;
  if (!destino) return null;
  const previo = ctx.store.nodo(ctx.modo, destino);
  const antes = previo ? { hash: previo.hash_cabeza, altura: previo.altura } : null;
  const cuerpo = { destino, tipo };
  const bloquePedido = !lote && TIPOS_CON_BLOQUE.has(tipo) && L.bloque !== '' ? Number(L.bloque) : null;
  if (bloquePedido !== null) cuerpo.bloque = bloquePedido;
  L.contador += 1;
  const entrada = { n: L.contador, hora: new Date(), tipo, destino, bloquePedido, antes, despues: null, ataque: null, error: null, epoca: L.epoca };
  try {
    const r = await (boton ? ui.ocupado(boton, ctx.api.accion('laboratorio/ataque', cuerpo)) : ctx.api.accion('laboratorio/ataque', cuerpo));
    entrada.ataque = r.ataque;
    try {
      const v = await ctx.api.get(`nodos/${destino}`);
      entrada.despues = { hash: v.nodo.hash_cabeza, altura: v.nodo.altura };
    } catch { entrada.despues = null; }
  } catch (err) {
    if (err?.name !== 'ErrorApi') { ui.mostrarError(err); return null; }
    if (err.codigo === 'epoca_obsoleta') return null;
    entrada.error = { codigo: err.codigo, mensaje: err.message, status: err.status, campo: err.campo };
  }
  L.historial.unshift(entrada);
  L.historial.length = Math.min(L.historial.length, MAX_HISTORIAL);
  L.ultimoPorTipo.set(tipo, entrada);
  pintarUltimo(ctx, L.tarjetas.get(tipo));
  pintarEscena(ctx, entrada);
  pintarHistorial(ctx);
  if (entrada.ataque) {
    animarRebote(ctx, destino, entrada.ataque.resultado?.aceptada);
    const ac = entrada.ataque.resultado?.aceptada;
    if (!lote) ui.anunciar(ac ? `¡Atención! ${etiqueta(destino)} ACEPTÓ la copia falsificada.` : `${etiqueta(destino)} rechazó la falsificación «${NOMBRE_ATAQUE[tipo]}». ${entrada.ataque.detectado ? 'Se detectó lo esperado.' : ''}`, { urgente: !!ac });
  } else if (!lote) {
    ui.anunciar(`La falsificación no se pudo lanzar: ${conInstituciones(entrada.error.mensaje)}`);
  }
  if (!lote && matchMedia('(max-width: 999px)').matches) {
    L.escena.scrollIntoView({ behavior: ctx.anim.reducido() ? 'auto' : 'smooth', block: 'start' });
  }
  return entrada;
}

function pintarUltimo(ctx, card) {
  if (!card) return;
  const e = ctx.local.ultimoPorTipo.get(card.tipo);
  const { h, icono } = ctx;
  if (!e) { ctx.dom.reemplazar(card.ultimo); delete card.li.dataset.ultimo; return; }
  const ac = e.ataque?.resultado?.aceptada;
  const est = e.error ? 'error' : ac ? 'aceptado' : 'rechazado';
  card.li.dataset.ultimo = est;
  ctx.dom.reemplazar(card.ultimo, h('span.lab-ataque__marca', { dataset: { estado: est } },
    icono(est === 'rechazado' ? 'escudo' : est === 'aceptado' ? 'alerta' : 'info'),
    est === 'rechazado' ? 'rechazada' : est === 'aceptado' ? '¡ACEPTADA!' : e.error.codigo === 'sin_bloques' ? 'sin folios' : 'no se lanzó'));
}

// ================================================================ escena
function escenaVacia(ctx) {
  const { h, icono } = ctx;
  return h('div.lab-escena__vacia',
    h('span.vacio__icono', icono('escudo')),
    h('h3', 'Elige una falsificación y lánzala'),
    h('p', 'Aquí verás la copia del libro de la institución víctima frente a la copia falsificada, qué regla saltó, el veredicto folio a folio y la prueba de que la víctima no cambió su copia.'),
    h('p.texto-3', 'En el anillo, la institución víctima lleva un punto de mira rojo.'));
}

function pintarEscena(ctx, entrada) {
  const L = ctx.local;
  const cuerpo = L.escena.querySelector('.lab-escena__cuerpo');
  ctx.dom.reemplazar(cuerpo, entrada.error ? escenaError(ctx, entrada) : escenaResultado(ctx, entrada));
  ctx.anim.entrar(cuerpo.firstChild);
  const ver = cuerpo.querySelector('.lab-veredicto');
  if (ver && entrada.ataque?.resultado?.aceptada === false) ctx.anim.animar(ver, [{ transform: 'translateX(10px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' }], { duration: 360, easing: ctx.anim.CURVA.acuse });
  else if (ver) ctx.anim.sacudir(ver);
}

function cabeceraEscena(ctx, e) {
  const { h } = ctx;
  return h('header.lab-escena__cabecera',
    h('p.etiqueta-instrumento', { title: etiquetaLarga(e.destino) }, `Falsificación ${e.n} · contra ${etiqueta(e.destino)} · ${e.hora.toLocaleTimeString('es-MX')}`),
    h('h3.lab-escena__titulo', NOMBRE_ATAQUE[e.tipo] || e.tipo),
    h('p.texto-2', HISTORIA_ATAQUE[e.tipo] || tecnicaDe(ctx, e.tipo)),
    HISTORIA_ATAQUE[e.tipo] ? h('p.lab-ataque__tecnico', h('span.lab-ataque__en-cadena', 'lo que se envía · '), tecnicaDe(ctx, e.tipo)) : null);
}

function escenaError(ctx, e) {
  const { h, icono } = ctx;
  const sinBloques = e.error.codigo === 'sin_bloques';
  const destinoProd = ctx.modo === 'pow' ? 'pow_arena' : 'pos_escenario';
  return h('div.lab-escena__caja',
    cabeceraEscena(ctx, e),
    h('div.aviso', { dataset: { nivel: 'aviso' }, role: 'alert' }, icono('alerta'),
      h('div.pila', { style: { '--pila': 'var(--e-2)' } },
        h('p', h('strong', sinBloques ? 'Todavía no hay ningún registro que falsificar. ' : 'La falsificación no se pudo lanzar. '), h('span.mensaje-servidor', ctx.fmt.capital(conInstituciones(e.error.mensaje)))),
        sinBloques ? h('p.texto-2', 'El libro solo tiene el génesis. Sella un folio de registros y vuelve a lanzarla.') : null,
        h('p.texto-3', `código ${e.error.codigo} · HTTP ${e.error.status}`),
        sinBloques ? h('div.grupo',
          h('button.boton.boton--primario.boton--chico', { type: 'button', on: { click: () => ctx.navegar(destinoProd) } }, icono(ctx.modo === 'pow' ? 'martillo' : 'apuesta'), h('span', ctx.modo === 'pow' ? 'Sellar un folio' : 'Hacer una ronda')),
          h('button.boton.boton--fantasma.boton--chico', { type: 'button', on: { click: () => ctx.navegar('transacciones') } }, h('span', 'Usar el autopiloto'))) : null)));
}

const REGLA_NODO = { no_mas_larga: 'd', genesis_distinto: 'a', aceptada: null };

function escenaResultado(ctx, e) {
  const { h, icono, fmt, ui } = ctx;
  const a = e.ataque;
  const r = a.resultado || {};
  const aceptada = !!r.aceptada;
  const reglas = estadoReglas(a.codigos || [], { codigoNodo: r.codigo });
  const esperadaLetra = reglaDe(a.esperado);
  const intacta = e.antes && e.despues ? e.antes.hash === e.despues.hash && e.antes.altura === e.despues.altura : null;

  const veredicto = h('div.lab-veredicto', { dataset: { aceptada: aceptada ? 'si' : 'no' }, role: aceptada ? 'alert' : null },
    h('span.lab-veredicto__icono', icono(aceptada ? 'alerta' : 'escudo')),
    h('div',
      h('p.lab-veredicto__palabra', aceptada ? '¡ACEPTADA!' : 'RECHAZADA'),
      h('p.lab-veredicto__motivo', h('span.mensaje-servidor', fmt.capital(conInstituciones(r.motivo || '')))),
      aceptada ? h('p.lab-veredicto__grito', 'Esto no debería pasar nunca: la institución adoptó una copia falsificada. Revisa la validación.') : null));

  // la regla que decidió: la del código del nodo o, si la cadena era inválida, las violadas
  const decisiva = REGLA_NODO[r.codigo] ?? null;
  const filaReglas = h('div.lab-reglas-fila', { role: 'list', 'aria-label': 'Reglas evaluadas' },
    ['a', 'b', 'c', 'd'].map((l) => h('div.lab-reglas-fila__item', { role: 'listitem', dataset: { esperada: l === esperadaLetra ? 'si' : null, decisiva: l === decisiva ? 'si' : null } },
      chipRegla(l, reglas[l], { conTitulo: true }),
      l === esperadaLetra ? h('span.lab-reglas-fila__nota', 'la que debía saltar') : null)));

  const deteccion = h('p.lab-deteccion', { dataset: { ok: a.detectado ? 'si' : 'no' } },
    icono(a.detectado ? 'ok' : 'x'),
    h('span', 'Se esperaba ', h('code', a.esperado), esperadaLetra ? ` (regla ${esperadaLetra})` : '', a.detectado ? ' → detectado.' : ' → NO apareció entre lo detectado.',
      h('span.texto-3', ` Saltó: ${(a.codigos || []).join(', ') || '—'}.`)));

  const problemas = r.problemas || [];
  return h('div.lab-escena__caja', { dataset: { aceptada: aceptada ? 'si' : 'no' } },
    cabeceraEscena(ctx, e),
    veredicto,
    h('p.lab-intacta', { dataset: { ok: intacta === false || aceptada ? 'no' : 'si' } },
      icono(intacta === false || aceptada ? 'alerta' : 'escudo'),
      intacta === null ? h('span', `La validación no modifica la copia de ${etiqueta(e.destino)}.`)
        : intacta ? h('span', h('strong', `El libro de ${etiqueta(e.destino)} no cambió. `), 'Cabeza ', ui.hash(e.despues.hash, { n: 4, ceros: ctx.modo === 'pow', etiqueta: 'Cabeza después de la falsificación', plano: true }), ` antes y después; sigue en la altura ${e.despues.altura}.`)
          : h('span', h('strong', `¡El libro de ${etiqueta(e.destino)} cambió! `), `Cabeza ${fmt.hashCorto(e.antes.hash)} → ${fmt.hashCorto(e.despues.hash)}, altura ${e.antes.altura} → ${e.despues.altura}.`)),
    duelo(ctx, e),
    h('div.lab-escena__bloque',
      h('p.etiqueta-instrumento', 'Reglas evaluadas por ', siglaDe(e.destino)),
      filaReglas,
      deteccion),
    problemas.length ? h('div.lab-escena__bloque',
      h('p.etiqueta-instrumento', `Lo que encontró la validación · ${fmt.plural(r.total_problemas ?? problemas.length, 'problema', 'problemas')}`),
      listaProblemas(problemas, { max: 12 }),
      (r.total_problemas ?? 0) > Math.min(12, problemas.length) ? h('p.texto-3', `y ${(r.total_problemas) - Math.min(12, problemas.length)} más.`) : null)
      : h('div.lab-escena__bloque', h('p.lab-escena__explica', icono('info'), h('span', explicar(r.codigo), r.identica ? ` (${siglaDe(e.destino)} ya tenía exactamente esa copia.)` : ''))),
  );
}

/** Cadena propia frente a cadena atacante, celda a celda, con el veredicto de cada bloque. */
function duelo(ctx, e) {
  const { h, fmt } = ctx;
  const a = e.ataque;
  const r = a.resultado || {};
  const propia = (r.altura_propia ?? -1) + 1;
  const recibida = (r.altura_recibida ?? -1) + 1;
  const max = Math.max(propia, recibida, 1);
  const por = new Map((r.bloques || []).map((b) => [b.numero, b]));
  const celdas = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  const invalidos = (r.bloques || []).filter((b) => !b.valido);
  const objetivo = a.bloque;
  const filaPropia = h('div.lab-duelo__fila', { dataset: { lado: 'propia' } },
    h('span.lab-duelo__nombre', { title: etiquetaLarga(e.destino) }, siglaDe(e.destino), h('small', 'su copia')),
    h('div.lab-duelo__celdas', { 'aria-hidden': 'true' }, celdas(propia, (i) => h('span.lab-celda', { dataset: { estado: 'propia' } }))),
    h('span.lab-duelo__cuenta.mono', String(propia)));
  const filaAtaque = h('div.lab-duelo__fila', { dataset: { lado: 'atacante' } },
    h('span.lab-duelo__nombre', 'Falsificada', h('small', 'la que llega')),
    h('div.lab-duelo__celdas', { 'aria-hidden': 'true' }, celdas(recibida, (i) => {
      const b = por.get(i);
      const est = !b ? 'sin-evaluar' : b.valido ? 'valido' : 'invalido';
      return h('span.lab-celda', { dataset: { estado: est, objetivo: i === objetivo ? 'si' : null }, title: `#${i}: ${!b ? 'sin evaluar (la validación se detuvo antes)' : b.valido ? 'válido' : b.fallas.join(', ')}` });
    })),
    h('span.lab-duelo__cuenta.mono', String(recibida)));
  const lado = recibida > propia ? `${recibida} > ${propia}: más larga` : recibida === propia ? `${recibida} = ${propia}: igual de larga` : `${recibida} < ${propia}: más corta`;
  const resumen = `${etiqueta(e.destino)} tiene ${fmt.plural(propia, 'folio', 'folios')}; la copia falsificada, ${fmt.plural(recibida, 'folio', 'folios')}. ${invalidos.length ? `Folios inválidos: ${invalidos.map((b) => `#${b.numero} (${b.fallas.join(', ')})`).join('; ')}.` : 'Todos sus folios son válidos.'}${objetivo !== null && objetivo !== undefined ? ` Folio manipulado: #${objetivo}.` : ''}`;
  const d = h('figure.lab-duelo', { 'aria-label': resumen },
    h('figcaption.lab-duelo__titulo', h('span.etiqueta-instrumento', 'Copia propia frente a copia falsificada'), h('span.lab-duelo__lado.mono', { dataset: { mas: recibida > propia ? 'si' : 'no' } }, `(d) ${lado}`)),
    filaPropia, filaAtaque,
    h('ul.lab-duelo__leyenda', { role: 'list', 'aria-hidden': 'true' },
      h('li', h('i.lab-celda', { dataset: { estado: 'valido' } }), 'válido'),
      h('li', h('i.lab-celda', { dataset: { estado: 'invalido' } }), 'inválido'),
      h('li', h('i.lab-celda', { dataset: { estado: 'sin-evaluar' } }), 'sin evaluar'),
      objetivo !== null && objetivo !== undefined ? h('li', h('i.lab-celda', { dataset: { estado: 'valido', objetivo: 'si' } }), `manipulado (#${objetivo})`) : null));
  d.style.setProperty('--n', String(max));
  return d;
}

// ============================================================ anillo: el rebote
function animarRebote(ctx, destino, aceptada) {
  const p = ctx.red.posicion(destino);
  if (!p) return;
  if (ctx.anim.reducido()) { ctx.red.destello(destino, aceptada ? 'rechazo' : 'defensa'); return; }
  const capa = ctx.red.capa();
  const { s } = ctx;
  const ang = p.angulo + 0.75;
  const ini = { x: Math.cos(ang) * 248, y: Math.sin(ang) * 248 };
  const dx = p.x - ini.x;
  const dy = p.y - ini.y;
  const largo = Math.hypot(dx, dy) || 1;
  const choque = { x: p.x - (dx / largo) * (p.r + 12), y: p.y - (dy / largo) * (p.r + 12) };
  // rebota hacia fuera, desviado: sale por donde vino pero torcido
  const rebote = { x: choque.x - (dx / largo) * 70 + (dy / largo) * 40, y: choque.y - (dy / largo) * 70 - (dx / largo) * 40 };
  const tr = (q, rot = 0, esc = 1) => `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px) rotate(${rot}deg) scale(${esc})`;
  const paquete = s('g.lab-paquete', null,
    s('rect.lab-paquete__cuerpo', { x: -8, y: -8, width: 16, height: 16, rx: 3 }),
    s('path.lab-paquete__grieta', { d: 'M-4 -6 L0 -1 L-2 1 L3 6' }));
  capa.appendChild(paquete);
  const quitar = () => paquete.remove();
  const kf = aceptada
    ? [{ transform: tr(ini, 0, 0.6), opacity: 0 }, { transform: tr(ini, 0, 1), opacity: 1, offset: 0.12 }, { transform: tr(choque, 120, 1), opacity: 1, offset: 0.6 }, { transform: tr(p, 180, 0.2), opacity: 0 }]
    : [{ transform: tr(ini, 0, 0.6), opacity: 0 }, { transform: tr(ini, 0, 1), opacity: 1, offset: 0.12 }, { transform: tr(choque, 120, 1), opacity: 1, offset: 0.55 }, { transform: tr(rebote, 260, 0.8), opacity: 0 }];
  const an = paquete.animate(kf, { duration: 950, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)', fill: 'forwards' });
  an.finished.then(quitar, quitar);
  setTimeout(() => {
    ctx.red.destello(destino, aceptada ? 'rechazo' : 'defensa');
    if (aceptada) return;
    // el escudo: un arco que se enciende en el lado del impacto
    const escudo = s('circle.lab-escudo', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (p.r + 11).toFixed(1) });
    capa.appendChild(escudo);
    const ae = escudo.animate([{ opacity: 0.95, strokeWidth: 4 }, { opacity: 0, strokeWidth: 1 }], { duration: 620, easing: 'ease-out', fill: 'forwards' });
    const q = () => escudo.remove();
    ae.finished.then(q, q);
  }, 520);
}

// ============================================================ probar los 13
async function probarTodos(ctx) {
  const L = ctx.local;
  if (L.lote?.corriendo || !L.victima) return;
  const victima = L.victima;
  const previo = ctx.store.nodo(ctx.modo, victima);
  L.lote = { corriendo: true, cancelar: false, victima, filas: [], antes: previo ? { hash: previo.hash_cabeza, altura: previo.altura } : null };
  L.loteEl.hidden = false;
  L.botonLote.replaceChildren(ctx.icono('pausa'), ctx.h('span', 'Detener'));
  L.botonLote.classList.replace('boton--primario', 'boton--peligro');
  for (const card of L.tarjetas.values()) card.boton.disabled = true;
  pintarLote(ctx);
  ctx.ui.anunciar(`Probando las 13 falsificaciones contra ${etiqueta(victima)}.`);
  try {
    for (const tipo of ORDEN) {
      if (L.lote.cancelar) break;
      L.lote.actual = tipo;
      pintarLote(ctx);
      const f = await lanzar(ctx, tipo, null, { lote: true });
      if (!f) break;
      L.lote.filas.push(f);
      pintarLote(ctx);
      await new Promise((res) => { setTimeout(res, ctx.anim.reducido() ? 120 : 650); });
    }
  } finally {
    L.lote.corriendo = false;
    L.lote.actual = null;
    L.botonLote.replaceChildren(ctx.icono('play'), ctx.h('span', 'Probar los 13'));
    L.botonLote.classList.replace('boton--peligro', 'boton--primario');
    for (const card of L.tarjetas.values()) card.boton.disabled = false;
    const n = ctx.store.nodo(ctx.modo, victima);
    L.lote.despues = n ? { hash: n.hash_cabeza, altura: n.altura } : null;
    try { const v = await ctx.api.get(`nodos/${victima}`); L.lote.despues = { hash: v.nodo.hash_cabeza, altura: v.nodo.altura }; } catch { /* queda el del estado */ }
    pintarLote(ctx);
    const res = resumenLote(L.lote);
    ctx.ui.anunciar(res.frase, { urgente: res.aceptados > 0 });
    ctx.narrar({ titulo: res.aceptados ? `¡${res.aceptados} falsificación(es) pasaron!` : `${res.lanzados} falsificaciones contra ${siglaDe(L.lote.victima)}, ${res.rechazados} rechazadas`, texto: res.frase, nivel: res.aceptados ? 'error' : 'ok' });
    L.loteEl.querySelector('.lab-lote__resumen')?.focus({ preventScroll: false });
  }
}

function detenerLote(ctx) { if (ctx.local.lote) ctx.local.lote.cancelar = true; }

function resumenLote(lote) {
  const lanzados = lote.filas.filter((f) => f.ataque).length;
  const rechazados = lote.filas.filter((f) => f.ataque && !f.ataque.resultado?.aceptada).length;
  const aceptados = lanzados - rechazados;
  const detectados = lote.filas.filter((f) => f.ataque?.detectado).length;
  const sinBloques = lote.filas.filter((f) => f.error?.codigo === 'sin_bloques').length;
  const otros = lote.filas.filter((f) => f.error && f.error.codigo !== 'sin_bloques').length;
  const intacta = lote.antes && lote.despues ? lote.antes.hash === lote.despues.hash : null;
  const quien = etiqueta(lote.victima);
  const frase = `${rechazados}/${lanzados} rechazadas · ${detectados}/${lanzados} detectaron lo esperado${sinBloques ? ` · ${sinBloques} sin lanzar por falta de folios` : ''}${otros ? ` · ${otros} con error` : ''}${intacta === null ? '' : intacta ? ` · el libro de ${quien} no cambió` : ` · ¡el libro de ${quien} cambió!`}.`;
  return { lanzados, rechazados, aceptados, detectados, sinBloques, otros, intacta, frase };
}

function pintarLote(ctx) {
  const { h, icono, ui, fmt } = ctx;
  const L = ctx.local;
  const lote = L.lote;
  if (!lote) return;
  const hechos = lote.filas.length;
  const res = resumenLote(lote);
  const porTipo = new Map(lote.filas.map((f) => [f.tipo, f]));
  const titulo = L.loteEl.dataset.titulo;
  const si = (ok, t) => h('span.lab-si', { dataset: { ok: ok ? 'si' : 'no' } }, icono(ok ? 'ok' : 'x'), t);
  ctx.dom.reemplazar(L.loteEl,
    h('header.lab-lote__cabecera',
      h('div', h('h2', { id: titulo, title: etiquetaLarga(lote.victima) }, `Las 13 falsificaciones contra ${etiqueta(lote.victima)}`),
        h('p.texto-3', lote.corriendo ? `Lanzando ${hechos + 1} de ${ORDEN.length}: ${NOMBRE_ATAQUE[lote.actual] || ''}…` : `Terminado. Cada fila es una falsificación real evaluada por la validación de ${siglaDe(lote.victima)} (${nombreInst(lote.victima)}).`)),
      ui.medidor(hechos, ORDEN.length, { etiqueta: 'Falsificaciones lanzadas', estado: !lote.corriendo ? (res.aceptados ? 'rechazado' : 'valido') : null })),
    lote.corriendo ? null : h('p.lab-lote__resumen', { tabindex: '-1', dataset: { ok: res.aceptados || res.intacta === false ? 'no' : 'si' } },
      icono(res.aceptados ? 'alerta' : 'escudo'), h('span', h('strong', res.aceptados ? `¡${res.aceptados} falsificación(es) aceptadas! ` : 'Ninguna falsificación pasó. '), res.frase)),
    h('div.tabla-marco', h('table.tabla.lab-tabla',
      h('caption.solo-lectores', `Resumen de las 13 falsificaciones contra ${etiquetaLarga(lote.victima)}`),
      h('thead', h('tr', ['#', 'Falsificación', 'Regla', 'Esperado', 'Detectado', '¿Aceptada?', 'Saltó'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', ORDEN.map((tipo, i) => {
        const f = porTipo.get(tipo);
        const a = f?.ataque;
        const enCurso = lote.corriendo && lote.actual === tipo;
        return h('tr', { dataset: { estado: !f ? (enCurso ? 'curso' : 'pendiente') : f.error ? 'error' : a.resultado?.aceptada ? 'aceptada' : 'rechazada' } },
          h('td.mono.texto-3', String(i + 1).padStart(2, '0')),
          h('th', { scope: 'row' }, NOMBRE_ATAQUE[tipo]),
          h('td', chipRegla(reglaDe(a?.esperado || ESPERADO_TIPO[tipo]) || 'a', 'esperada')),
          h('td', h('code', a?.esperado || ESPERADO_TIPO[tipo])),
          h('td', !f ? h('span.texto-3', enCurso ? 'lanzando…' : '—') : f.error ? h('span.lab-si', { dataset: { ok: 'aviso' } }, icono('alerta'), f.error.codigo === 'sin_bloques' ? 'requiere folios' : f.error.codigo) : si(a.detectado, a.detectado ? 'Sí' : 'No')),
          h('td', !a ? h('span.texto-3', '—') : si(!a.resultado?.aceptada, a.resultado?.aceptada ? 'SÍ' : 'No')),
          h('td.lab-tabla__codigos', a ? h('code', (a.codigos || []).join(', ')) : f?.error ? h('span.texto-3', fmt.capital(conInstituciones(f.error.mensaje)).slice(0, 80)) : null));
      })))));
}

// ================================================================ historial
function pintarHistorial(ctx) {
  const { h, icono } = ctx;
  const L = ctx.local;
  const titulo = L.historialEl.dataset.titulo;
  const vaciar = h('button.boton.boton--fantasma.boton--chico', { type: 'button', disabled: !L.historial.length }, icono('reiniciar'), h('span', 'Vaciar'));
  vaciar.addEventListener('click', () => { L.historial = []; pintarHistorial(ctx); });
  ctx.dom.reemplazar(L.historialEl,
    h('header.lab-historial__cabecera',
      h('div', h('h2', { id: titulo }, 'Historial de esta sesión'),
        h('p.texto-3', L.historial.length ? `${L.historial.length} falsificaciones (la más reciente arriba). «Ver» vuelve a mostrar su escena.` : 'Aún no has lanzado ninguna falsificación. Se guardan aquí mientras no recargues la página.')),
      vaciar),
    L.historial.length ? h('div.tabla-marco.lab-historial__marco', h('table.tabla.lab-tabla',
      h('caption.solo-lectores', 'Falsificaciones lanzadas en esta sesión'),
      h('thead', h('tr', ['Hora', 'Falsificación', 'Víctima', 'Folio', 'Resultado', 'Detectado', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', L.historial.map((e) => {
        const a = e.ataque;
        const ver = h('button.boton.boton--fantasma.boton--chico', { type: 'button', 'aria-label': `Ver la escena de la falsificación ${e.n}` }, 'Ver');
        ver.addEventListener('click', () => { pintarEscena(ctx, e); L.escena.focus({ preventScroll: false }); });
        return h('tr', { dataset: { estado: e.error ? 'error' : a.resultado?.aceptada ? 'aceptada' : 'rechazada' } },
          h('td.mono.texto-3', e.hora.toLocaleTimeString('es-MX')),
          h('th', { scope: 'row' }, NOMBRE_ATAQUE[e.tipo]),
          h('td', marcaInst(e.destino)),
          h('td.mono', a?.bloque ?? e.bloquePedido ?? '—'),
          h('td', e.error ? ctx.ui.chip(e.error.codigo === 'sin_bloques' ? 'sin folios' : 'no se lanzó', 'advertencia') : a.resultado?.aceptada ? ctx.ui.chip('ACEPTADA', 'rechazado') : ctx.ui.chip('rechazada', 'valido')),
          h('td', a ? (a.detectado ? ctx.ui.chip('sí', 'valido') : ctx.ui.chip('no', 'rechazado')) : h('span.texto-3', '—')),
          h('td', ver));
      })))) : null);
}
