// ESQUEMA 3 · Demostrar sin revelar (pruebas de conocimiento cero).
//  A · «El horario sin choques» (la protagonista): Peggy, la coordinadora, asegura que su horario de 7
//      materias en 3 turnos no tiene choques. Tú (Víctor) lo compruebas SIN verlo: en cada ronda Peggy
//      revuelve los turnos y cierra 7 sobres; tú pides UNA línea y solo se abren sus dos extremos.
//      Medidor «probabilidad de engaño» = (13/14)^k, 187 rondas seguidas (el momento firma) y tres
//      trampas: Peggy miente, Peggy cambia un turno al abrir (la huella se recalcula aquí, en el
//      navegador) y Víctor intenta espiar. «Detrás del telón» enseña el horario real.
//  B · «Entrar sin decir la contraseña»: la UNAM demuestra que tiene su llave secreta en 4 mensajes
//      (protocolo Σ de Schnorr). Trampas: impostor, número al azar repetido (PS3), conversación fabricada.
// API: GET zk/coloreo · POST zk/coloreo/compromiso | /abrir | /rondas
//      POST zk/compromiso | /responder | /extraer | /simular | /probar | /verificar   (ver ./LEEME.md)

import * as K from './_kit.js';

const { h, s, icono, texto, attr } = K;

const INST = 'N02';                            // demostración B: la UNAM
const LETRA = ['M', 'T', 'N'];                 // el turno nunca va solo con color
const ESPIAS = 6;                              // rondas de la trampa «Víctor intenta espiar»
const MAX_PUNTOS = 561;                        // tres tandas de 187 en la tira
const MAX_HISTORIAL = 400;
const MENSAJE_FS = 'Acceso al sistema del consorcio · UNAM';
const ICONO_ESTADO = { ok: 'ok', mal: 'x', aviso: 'alerta', info: 'info' };

// dibujo del grafo (viewBox 440 × 380): materias en círculo, la primera arriba
const VB_W = 440;
const VB_H = 380;
const CX = 220;
const CY = 192;
const R = 128;
const RN = 22;

export default {
  async montar(host, ctx, meta) {
    const L = Object.assign(ctx.local, {
      grafo: null, m: 14, tramposa: false, trabajando: false, bTrabajando: false,
      fase: 'inicio', ronda: null, compromisos: null, apertura: null, falsa: null, abierta: null,
      resultadoOk: true, lote: false, rotulo: '', lineaEstado: null,
      puntos: [], descubierta: null, historial: [], hover: null, enfoque: null, raf: 0, alCortar: null,
      b: { paso: 0 }, bExtra: null, fs: null, fsResultado: null,
    });
    L.id = (x) => `esq-zk-${ctx.modo}-${x}`;

    L.seg = K.segmentado({
      nombre: 'demo', etiqueta: 'Elige la demostración', valor: 'a',
      opciones: [{ valor: 'a', texto: 'A · El horario sin choques' }, { valor: 'b', texto: 'B · Entrar sin decir la contraseña' }],
      alCambiar: (v) => verDemo(ctx, v),
    });
    L.selector = h('div.zk-selector', h('p.zk-selector__titulo', 'Dos demostraciones. Empieza por la A:'), L.seg);
    L.secA = seccionA(ctx);
    L.secB = seccionB(ctx);
    L.secB.hidden = true;

    host.append(
      K.cabecera({ numero: meta.numero, icono: meta.icono, titulo: meta.titulo, id: L.id('titulo'),
        metafora: 'Convencer a alguien de que sabes un secreto… sin decirle nada del secreto.',
        historia: 'En el consorcio pasa todo el tiempo: la coordinadora de exámenes asegura que su horario no tiene choques, y la UNAM asegura que es la UNAM. Con una «prueba de conocimiento cero» lo demuestran sin enseñar ni el horario ni la llave secreta.',
        tecnico: 'pruebas de conocimiento cero: 3-coloración de Goldreich, Micali y Wigderson (1986) y protocolo Σ de Schnorr. Peggy es quien prueba; Víctor, quien verifica.' }),
      L.selector,
      L.secA,
      L.secB,
      saberMas(),
    );
    pintarB(ctx);
    await cargarGrafo(ctx);
  },

  ocultar(ctx) { cortarConteo(ctx.local); },
};

// ================================================================ selector A/B
function verDemo(ctx, cual, { enfocar = false } = {}) {
  const L = ctx.local;
  L.seg.fijar(cual);
  L.secA.hidden = cual !== 'a';
  L.secB.hidden = cual !== 'b';
  const sec = cual === 'a' ? L.secA : L.secB;
  K.anim.entrar(sec);
  if (enfocar) {
    L.selector.scrollIntoView({ block: 'start', behavior: K.anim.reducido() ? 'auto' : 'smooth' });
    sec.querySelector('.zk-demo__titulo')?.focus({ preventScroll: true });
  }
}

/** Lleva a la vista un resultado que quedó fuera de la pantalla (después de una trampa). */
function revelar(el, bloque = 'nearest') {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top >= 64 && r.top < window.innerHeight * 0.6) return;
  el.scrollIntoView({ block: bloque, behavior: K.anim.reducido() ? 'auto' : 'smooth' });
}

// ================================================================ A · el horario sin choques
function seccionA(ctx) {
  const L = ctx.local;
  const id = L.id;

  // ---------------------------------------------------------- el dibujo
  L.svg = s('svg.zk-grafo__svg', { viewBox: `0 0 ${VB_W} ${VB_H}`, role: 'group', 'aria-label': 'Mapa de las 7 materias', 'aria-describedby': id('grafo-d') });
  L.lienzo = h('div.zk-grafo__lienzo', h('p.zk-grafo__cargando', 'Cargando el mapa de materias…'));
  L.rondaEl = h('span.zk-grafo__ronda', 'Sin sobres todavía');
  L.interruptor = h('button.interruptor.zk-interruptor', { type: 'button', role: 'switch', 'aria-checked': 'false' }, 'Peggy hace trampa');
  L.interruptor.addEventListener('click', () => fijarTramposa(ctx, !L.tramposa, { sellar: true }));
  L.chipTrampa = h('span.chip.zk-grafo__aviso', { dataset: { estado: 'rechazado' }, hidden: true }, 'su horario esconde un choque');
  L.estado = h('p.zk-grafo__estado', { dataset: { estado: 'info' } }, icono('info'), h('span', 'Cargando el mapa de materias…'));
  L.leyenda = h('ul.zk-leyenda', { role: 'list', 'aria-label': 'Cómo leer el dibujo' });
  L.figura = h('figure.zk-grafo', { 'aria-busy': 'true' },
    h('div.zk-grafo__barra', L.rondaEl, h('div.zk-grafo__trampa', L.chipTrampa, L.interruptor)),
    h('p.solo-lectores', { id: id('grafo-d') }, 'Cada línea une dos materias que comparten alumnos. Usa las flechas para cambiar de línea y Enter para abrir sus dos sobres.'),
    L.lienzo,
    L.estado,
    L.leyenda);

  // ---------------------------------------------------------- paso 1
  L.botonSellar = h('button.boton.boton--primario', { type: 'button' }, icono('candado'), h('span', 'Cerrar los 7 sobres'));
  L.botonSellar.addEventListener('click', () => cerrarSobres(ctx, L.botonSellar));
  L.p1 = K.paso({ n: 1, id: id('p1'), titulo: 'Peggy cierra los sobres',
    ayuda: 'Revuelve los tres turnos y mete el de cada materia en un sobre cerrado. Tú solo ves siete sobres: ninguno deja ver qué turno trae.' },
  h('div.esq-acciones', L.botonSellar));

  // ---------------------------------------------------------- paso 2
  L.botonAzar = h('button.boton.boton--primario', { type: 'button' }, icono('dado'), h('span', 'Elegir una línea al azar'));
  L.botonAzar.addEventListener('click', () => lineaAlAzar(ctx));
  L.p2 = K.paso({ n: 2, id: id('p2'), estado: 'espera', titulo: 'Pide abrir una línea',
    ayuda: 'Toca cualquier línea del dibujo, o deja que el azar elija (así lo haría Víctor de verdad). Peggy abre solo los dos sobres de sus extremos: si traen turnos distintos, esas dos materias no chocan.' },
  h('div.esq-acciones', L.botonAzar));

  // ---------------------------------------------------------- paso 3
  L.medNumero = h('span.zk-medidor__numero', '100 %');
  L.medTexto = h('p.zk-medidor__texto', 'Todavía no compruebas nada: podría estar mintiendo.');
  L.tira = h('div.zk-tira', { role: 'img', 'aria-label': 'Todavía no hay rondas.' });
  L.medidorEl = h('div.zk-medidor', { dataset: { estado: 'duda' } },
    h('p.zk-medidor__etiqueta', 'Probabilidad de que Peggy te esté engañando'),
    h('p.zk-medidor__valor', L.medNumero),
    h('span.zk-medidor__barra', { 'aria-hidden': 'true' }, h('span.zk-medidor__relleno')),
    L.medTexto,
    h('div.zk-tira-marco',
      h('p.zk-tira__titulo', h('span', 'Cada marca es una ronda:'),
        h('span.zk-tira__clave', h('span.zk-punto', { dataset: { r: 'ok' } }), 'superada'),
        h('span.zk-tira__clave', h('span.zk-punto', { dataset: { r: 'mal' } }), 'choque')),
      L.tira));
  L.botonLote = h('button.boton.boton--primario', { type: 'button' }, icono('play'), h('span', 'Hacer 187 rondas seguidas'));
  L.botonLote.addEventListener('click', () => rondasSeguidas(ctx, L.botonLote));
  L.botonReiniciar = h('button.boton.boton--fantasma', { type: 'button' }, icono('reiniciar'), h('span', 'Empezar de nuevo'));
  L.botonReiniciar.addEventListener('click', () => { if (L.trabajando) return; reiniciarA(ctx); pintarA(ctx); });
  L.p3 = K.paso({ n: 3, id: id('p3'), estado: 'espera', titulo: 'Repite hasta convencerte',
    ayuda: 'Peggy no sabe qué línea vas a pedir. Si mintiera, tarde o temprano pedirías justo la del choque.' },
  L.medidorEl,
  h('div.esq-acciones', L.botonLote, L.botonReiniciar));

  L.escena = h('div.zk-escena', L.figura, h('div.esq-pasos.zk-pasos', L.p1, L.p2, L.p3));
  L.veredicto = K.veredicto({ vacio: 'Cuando abras una línea, aquí verás qué descubriste.' });
  L.explica = K.explicacion();

  // ---------------------------------------------------------- trampas
  const trampas = K.trampas([
    { etiqueta: 'Peggy miente: su horario tiene un choque', texto: 'Dos materias que comparten alumnos van en el mismo turno. ¿Aguanta 187 rondas?', fn: (b) => trampaMiente(ctx, b) },
    { etiqueta: 'Peggy cambia un turno al abrir', texto: 'Le piden justo la línea del choque y dice un turno distinto del que cerró.', fn: (b) => trampaCambia(ctx, b) },
    { etiqueta: 'Víctor intenta espiar el horario', texto: `Pide ${ESPIAS} veces la misma línea para averiguar en qué turno va cada materia.`, fn: (b) => trampaEspia(ctx, b) },
  ]);

  // ---------------------------------------------------------- detrás del telón
  L.telonCuerpo = h('div.zk-telon', h('p.texto-3', 'Cargando…'));
  L.telon = h('details.detalles.esq-cuentas.zk-telon-det',
    h('summary', icono('velo'), h('span', 'Detrás del telón: lo que solo sabe Peggy')),
    h('div.esq-cuentas__cuerpo', L.telonCuerpo));
  L.telon.addEventListener('toggle', () => { if (L.telon.open) pintarTelon(ctx); });

  // ---------------------------------------------------------- cuentas
  L.cuentasA = h('div.zk-cuentas');
  L.cuentasAExtra = h('div.zk-cuentas');
  L.cuentasADet = K.cuentas('Ver las cuentas',
    h('p', 'Cada sobre es una huella SHA-256 del turno (0 = mañana, 1 = tarde, 2 = noche, ya revueltos) pegado a un número al azar de 256 bits: ', h('code', 'sobre = SHA-256(turno ‖ número al azar)'), '. Sin el número al azar no se adivina el turno (el sobre lo oculta); y una vez entregado el sobre, Peggy no puede decir que traía otro turno (el sobre la amarra). El documento lo llama un compromiso ocultador y vinculante.'),
    L.cuentasA,
    h('h4.zk-subtitulo', '¿Cuántas rondas hacen falta?'),
    L.cuentasAExtra);
  L.cuentasADet.addEventListener('toggle', () => { if (L.cuentasADet.open) pintarCuentasA(ctx); });

  const irB = h('button.boton.boton--secundario.zk-siguiente', { type: 'button' },
    h('span', '¿Ya te convenciste? Sigue con la demostración B: entrar sin decir la contraseña'), icono('flecha'));
  irB.addEventListener('click', () => verDemo(ctx, 'b', { enfocar: true }));

  return h('section.zk-demo', { dataset: { demo: 'a' }, 'aria-labelledby': id('a-t') },
    h('div.zk-demo__intro',
      h('p.zk-demo__marca', 'Demostración A'),
      h('h3.zk-demo__titulo', { id: id('a-t'), tabindex: '-1' }, 'El horario sin choques'),
      h('p', 'Peggy, la coordinadora de exámenes, dice que puede poner los exámenes de 7 materias en 3 turnos —mañana, tarde y noche— sin que nadie tenga dos exámenes a la vez. En el dibujo, una línea une dos materias que comparten alumnos: esas dos no pueden ir en el mismo turno.'),
      h('ul.zk-reparto', { role: 'list' },
        h('li', icono('diploma'), h('span', h('strong', 'Peggy'), ' · la coordinadora. Sabe el horario y dice que no tiene choques.')),
        h('li', icono('buscar'), h('span', h('strong', 'Víctor'), ' · eres tú. Quieres comprobarlo sin ver el horario.')))),
    L.escena,
    L.veredicto,
    L.explica,
    trampas,
    L.telon,
    L.cuentasADet,
    h('div.zk-siguiente-marco', irB));
}

// ---------------------------------------------------------------- carga y dibujo
async function cargarGrafo(ctx) {
  const L = ctx.local;
  let g;
  try {
    g = await K.get('zk/coloreo');
  } catch (e) {
    attr(L.figura, 'aria-busy', null);
    const reintentar = h('button.boton.boton--secundario', { type: 'button' }, icono('reiniciar'), h('span', 'Reintentar'));
    reintentar.addEventListener('click', () => {
      K.reemplazar(L.lienzo, h('p.zk-grafo__cargando', 'Cargando el mapa de materias…'));
      cargarGrafo(ctx);
    });
    K.reemplazar(L.lienzo, h('div.aviso', { dataset: { nivel: 'error' }, role: 'alert' }, icono('alerta'),
      h('div', h('strong', 'No se pudo cargar el mapa de materias. '), String(e?.message || e), h('p', reintentar))));
    return;
  }
  L.grafo = g;
  L.m = g.aristas.length;
  construirGrafo(ctx);
  K.reemplazar(L.lienzo, L.svg);
  attr(L.figura, 'aria-busy', null);
  K.reemplazar(L.leyenda,
    g.turnos.map((_, c) => h('li', chipTurno(g, c))),
    h('li.zk-leyenda__linea', 'comparten alumnos'),
    h('li.zk-leyenda__sobre', icono('candado'), 'sobre cerrado'));
  K.reemplazar(L.botonLote, icono('play'), h('span', `Hacer ${g.rondas_recomendadas} rondas seguidas`));
  pintarCuentasAExtra(ctx);
  pintarA(ctx);
}

/** Posición de cada materia y hacia dónde va su etiqueta (fuera del círculo). */
function geometria(n) {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    let ancla = 'middle';
    let lx = 0;
    let ly;
    if (sn < -0.9) ly = -RN - 24;                       // arriba: nombre y turno encima
    else if (sn > 0.8) ly = RN + 17;                    // abajo: debajo
    else { ancla = c > 0 ? 'start' : 'end'; lx = (c > 0 ? 1 : -1) * (RN + 8); ly = -1; }
    return { x: CX + R * c, y: CY + R * sn, ancla, lx, ly };
  });
}

function construirGrafo(ctx) {
  const L = ctx.local;
  const g = L.grafo;
  L.geo = geometria(g.vertices.length);

  L.aristasEl = g.aristas.map(([u, v], k) => {
    const a = L.geo[u];
    const b = L.geo[v];
    const c = { x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1) };
    const el = s('g.zk-arista', { role: 'button', tabindex: k === 0 ? '0' : '-1', 'aria-disabled': 'true',
      'aria-label': `Abrir los sobres de ${g.vertices[u]} y ${g.vertices[v]}`, dataset: { k } },
    s('line.zk-arista__halo', c), s('line.zk-arista__linea', c), s('line.zk-arista__zona', c));
    el.addEventListener('click', () => { enfocarArista(L, k, false); abrirArista(ctx, k); });
    el.addEventListener('keydown', (e) => teclaArista(ctx, e, k));
    el.addEventListener('pointerenter', () => { L.hover = k; resaltar(L); });
    el.addEventListener('pointerleave', () => { if (L.hover === k) L.hover = null; resaltar(L); });
    el.addEventListener('focus', () => { L.enfoque = el.matches(':focus-visible') ? k : null; resaltar(L); });
    el.addEventListener('blur', () => { if (L.enfoque === k) L.enfoque = null; resaltar(L); });
    return el;
  });

  L.nodos = g.vertices.map((nombre, i) => {
    const p = L.geo[i];
    const letra = s('text.zk-nodo__letra', { 'text-anchor': 'middle', y: 7 });
    const ficha = s('g.zk-nodo__ficha',
      s('circle.zk-nodo__disco', { r: RN }),
      s('use.zk-nodo__candado', { href: '#i-candado', x: -11, y: -12, width: 22, height: 22 }),
      letra);
    const turno = s('text.zk-nodo__turno', { x: p.lx, y: p.ly + 16, 'text-anchor': p.ancla });
    const el = s('g.zk-nodo', { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, dataset: { i, estado: 'inicio' } },
      ficha,
      s('text.zk-nodo__nombre', { x: p.lx, y: p.ly, 'text-anchor': p.ancla }, nombre),
      turno);
    return { el, ficha, letra, turno };
  });

  L.marcaIcono = s('use.zk-marca__icono', { href: '#i-ok', x: -9, y: -9, width: 18, height: 18 });
  L.marcaCuerpo = s('g.zk-marca__cuerpo', s('circle.zk-marca__disco', { r: 13 }), L.marcaIcono);
  L.marca = s('g.zk-marca', { dataset: { visible: 'no' } }, L.marcaCuerpo);

  K.reemplazar(L.svg,
    s('g.zk-capa-aristas', L.aristasEl),
    s('g', { 'aria-hidden': 'true' }, L.nodos.map((n) => n.el)),
    s('g', { 'aria-hidden': 'true' }, L.marca));
}

/** Resalta la línea bajo el puntero o con el foco del teclado, y sus dos materias. */
function resaltar(L) {
  const g = L.grafo;
  const activas = new Set([L.hover, L.enfoque].filter((x) => x !== null && x !== undefined));
  const nodos = new Set();
  L.aristasEl.forEach((el, k) => {
    attr(el, 'data-foco', activas.has(k) ? '' : null);
    if (activas.has(k)) { nodos.add(g.aristas[k][0]); nodos.add(g.aristas[k][1]); }
  });
  L.nodos.forEach((n, i) => attr(n.el, 'data-foco', nodos.has(i) ? '' : null));
}

/** Foco itinerante: una sola parada de tabulador para las 14 líneas; las flechas cambian de línea. */
function enfocarArista(L, k, mover) {
  L.aristasEl.forEach((el, j) => attr(el, 'tabindex', j === k ? '0' : '-1'));
  if (mover) L.aristasEl[k].focus();
}

function teclaArista(ctx, e, k) {
  const L = ctx.local;
  const n = L.aristasEl.length;
  let j = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (k + 1) % n;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (k - 1 + n) % n;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = n - 1;
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirArista(ctx, k); return; }
  if (j === null) return;
  e.preventDefault();
  enfocarArista(L, j, true);
}

// ---------------------------------------------------------------- pintar A
function pintarA(ctx, { desde = null } = {}) {
  const L = ctx.local;
  const g = L.grafo;
  pintarPasosA(L);
  if (!g) return;
  const ab = L.fase === 'abierto' ? L.apertura : null;

  L.nodos.forEach((n, i) => {
    let estado = L.fase === 'inicio' ? 'inicio' : 'cerrado';
    let turno = null;
    let rotulo = '';
    const lado = ab ? (ab.u.vertice === i ? ab.u : ab.v.vertice === i ? ab.v : null) : null;
    if (lado) {
      estado = 'abierto';
      turno = lado.color;
      rotulo = g.turnos[turno];
      if (L.falsa && L.falsa.vertice === i) {
        estado = 'alterado';
        turno = L.falsa.color;
        rotulo = `dice «${g.turnos[turno]}»`;
      }
    }
    attr(n.el, 'data-estado', estado);
    attr(n.el, 'data-turno', turno === null ? null : String(turno));
    texto(n.letra, turno === null ? '' : LETRA[turno]);
    texto(n.turno, rotulo);
  });

  L.aristasEl.forEach((el, k) => {
    attr(el, 'data-estado', ab && L.abierta === k ? (L.resultadoOk ? 'ok' : 'mal') : null);
    attr(el, 'aria-disabled', L.fase === 'cerrado' ? null : 'true');
  });
  attr(L.svg, 'data-fase', L.fase);

  if (ab && L.abierta !== null) {
    const [u, v] = g.aristas[L.abierta];
    const mx = (L.geo[u].x + L.geo[v].x) / 2;
    const my = (L.geo[u].y + L.geo[v].y) / 2;
    attr(L.marca, 'transform', `translate(${mx.toFixed(1)} ${my.toFixed(1)})`);
    attr(L.marca, 'data-estado', L.resultadoOk ? 'ok' : 'mal');
    attr(L.marcaIcono, 'href', L.resultadoOk ? '#i-ok' : '#i-x');
    attr(L.marca, 'data-visible', 'si');
  } else attr(L.marca, 'data-visible', 'no');

  texto(L.rondaEl, L.rotulo || 'Sin sobres todavía');
  pintarEstado(L);
  pintarMedidor(ctx, { desde });
  if (L.telon.open) pintarTelon(ctx);
  if (L.cuentasADet.open) pintarCuentasA(ctx);
}

function pintarPasosA(L) {
  K.marcarPaso(L.p1, L.fase === 'cerrado' ? 'hecho' : 'activo');
  K.marcarPaso(L.p2, L.fase === 'cerrado' ? 'activo' : L.fase === 'abierto' ? 'hecho' : 'espera');
  K.marcarPaso(L.p3, L.fase === 'inicio' && !L.puntos.length ? 'espera' : 'activo');
  const nuevo = !L.puntos.length && L.fase !== 'abierto';
  K.reemplazar(L.botonSellar, icono(nuevo ? 'candado' : 'reiniciar'), h('span', nuevo ? 'Cerrar los 7 sobres' : 'Otra ronda: revolver y cerrar'));
}

function pintarEstado(L) {
  const e = L.lineaEstado || (L.fase === 'inicio'
    ? { estado: 'info', partes: ['Peggy todavía no cierra los sobres. Empieza en el paso 1.'] }
    : { estado: 'info', partes: ['Los 7 sobres están cerrados. Toca una línea para abrir sus dos sobres.'] });
  attr(L.estado, 'data-estado', e.estado);
  K.reemplazar(L.estado, icono(ICONO_ESTADO[e.estado] || 'info'), h('span', e.partes));
}

function lineaRonda(L, u, v, ok) {
  const g = L.grafo;
  return { estado: ok ? 'ok' : 'mal', partes: [
    g.vertices[u.vertice], ' ', chipTurno(g, u.color), ' · ', g.vertices[v.vertice], ' ', chipTurno(g, v.color), ' → ',
    h('strong', ok ? 'distintos: no chocan' : '¡el mismo turno!')] };
}

function chipTurno(g, c) {
  return h('span.zk-turno', { dataset: { turno: c } }, h('span.zk-turno__letra', { 'aria-hidden': 'true' }, LETRA[c]), g.turnos[c]);
}

/** Si alguien pulsa fuera de turno: qué falta y por qué (en el dibujo y para lectores de pantalla). */
function pista(ctx) {
  const L = ctx.local;
  const msg = L.fase === 'inicio'
    ? 'Primero Peggy tiene que cerrar los sobres: pulsa «Cerrar los 7 sobres» (paso 1).'
    : 'En cada ronda solo se abre una línea: si Peggy abriera más sobres, empezarías a ver su horario. Pide otra ronda (paso 1).';
  attr(L.estado, 'data-estado', 'aviso');
  K.reemplazar(L.estado, icono('alerta'), h('span', msg));
  ctx.ui.anunciar?.(msg);
  K.anim.destello(L.botonSellar);
}

// ---------------------------------------------------------------- medidor y tira
const superadas = (L) => (L.descubierta ? L.descubierta - 1 : L.puntos.length);
const prob = (L) => Math.max(1e-300, (1 - 1 / L.m) ** superadas(L));

function formatoProb(p) {
  if (p >= 0.9995) return '100 %';
  if (p >= 0.01) return `${(p * 100).toFixed(1)} %`;
  const n = 1 / p;
  if (n < 1e6) return `1 en ${Math.round(n).toLocaleString('es-MX')}`;
  const m = n / 1e6;
  if (m < 10) { const t = m.toFixed(2); return `1 en ${t} ${t === '1.00' ? 'millón' : 'millones'}`; }
  if (m < 1000) return `1 en ${Math.round(m)} millones`;
  return '1 en más de mil millones';
}

function pintarMedidor(ctx, { desde = null } = {}) {
  const L = ctx.local;
  const sup = superadas(L);
  const p = prob(L);
  const meta = L.grafo?.rondas_recomendadas ?? 187;
  const eps = L.grafo?.epsilon ?? 1e-6;
  attr(L.medidorEl, 'data-estado', L.descubierta ? 'descubierta' : p < eps ? 'convencido' : 'duda');
  L.medidorEl.style.setProperty('--p', L.descubierta ? '1' : p.toFixed(6));
  cortarConteo(L);
  if (L.descubierta) {
    texto(L.medNumero, '¡Descubierta!');
    texto(L.medTexto, `Peggy cayó en la ronda ${L.descubierta}. Basta una sola ronda que falle para saber que mintió.`);
  } else {
    if (desde !== null && desde !== p) contarProb(L, desde, p);
    else texto(L.medNumero, formatoProb(p));
    texto(L.medTexto, sup === 0 ? 'Todavía no compruebas nada: podría estar mintiendo.'
      : `${sup} ${sup === 1 ? 'ronda superada' : 'rondas superadas'} · ${p < eps
        ? 'ya es menos de una en un millón: puedes estar tranquilo.'
        : `con ${meta} rondas baja a menos de una en un millón.`}`);
  }
  const n = L.puntos.length;
  const mal = L.puntos.filter((x) => !x).length;
  attr(L.tira, 'aria-label', n
    ? `${n} ${n === 1 ? 'ronda' : 'rondas'}: ${n - mal} ${n - mal === 1 ? 'superada' : 'superadas'}${mal ? ` y ${mal} con choque` : ''}.`
    : 'Todavía no hay rondas.');
}

/** El momento firma: la duda cae en escala logarítmica mientras se llena la tira (fundido si el movimiento está reducido). */
function contarProb(L, desde, hasta) {
  cortarConteo(L);
  if (K.anim.reducido() || !(desde > 0)) { texto(L.medNumero, formatoProb(hasta)); return; }
  const a = Math.log(desde);
  const b = Math.log(hasta);
  const t0 = performance.now();
  const dur = 640;
  L.alCortar = () => texto(L.medNumero, formatoProb(hasta));
  const paso = (t) => {
    const x = Math.min(1, (t - t0) / dur);
    const e = 1 - (1 - x) ** 3;
    texto(L.medNumero, formatoProb(Math.exp(a + (b - a) * e)));
    if (x < 1) L.raf = requestAnimationFrame(paso);
    else { L.raf = 0; L.alCortar = null; }
  };
  L.raf = requestAnimationFrame(paso);
}

function cortarConteo(L) {
  if (L.raf) cancelAnimationFrame(L.raf);
  L.raf = 0;
  const fin = L.alCortar;
  L.alCortar = null;
  fin?.();
}

function agregarPuntos(L, oks, { animar = false } = {}) {
  const nuevos = oks.map((ok) => h('span.zk-punto', { dataset: { r: ok ? 'ok' : 'mal' } }));
  L.tira.append(...nuevos);
  while (L.tira.childElementCount > MAX_PUNTOS) L.tira.firstElementChild.remove();
  const kf = [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'none' }];
  if (animar) K.anim.escalonar(nuevos, kf, { duration: K.anim.DUR.micro }, 3);
  else nuevos.forEach((el) => K.anim.animar(el, kf, { duration: 220, easing: K.anim.CURVA.acuse }));
}

function registrar(L, entrada) {
  L.historial.push(entrada);
  if (L.historial.length > MAX_HISTORIAL) L.historial.splice(0, L.historial.length - MAX_HISTORIAL);
}

function animarApertura(L, vertices) {
  vertices.forEach((i) => K.anim.animar(L.nodos[i].ficha, [{ opacity: 0.3, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }],
    { duration: 340, easing: K.anim.CURVA.acuse }));
  K.anim.animar(L.marcaCuerpo, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }],
    { duration: 300, delay: 140, easing: K.anim.CURVA.acuse, fill: 'backwards' });
}

const indiceArista = (g, [a, b]) => g.aristas.findIndex(([u, v]) => (u === a && v === b) || (u === b && v === a));
const enLa = (t) => `en la ${t.toLowerCase()}`;

// ---------------------------------------------------------------- acciones A
function reiniciarA(ctx) {
  const L = ctx.local;
  cortarConteo(L);
  Object.assign(L, { fase: 'inicio', ronda: null, compromisos: null, apertura: null, falsa: null, abierta: null,
    resultadoOk: true, lote: false, rotulo: '', lineaEstado: null, puntos: [], descubierta: null, historial: [] });
  K.reemplazar(L.tira);
  K.pintarVeredicto(L.veredicto, null);
  K.explicar(L.explica);
}

function fijarTramposa(ctx, on, { sellar = false } = {}) {
  const L = ctx.local;
  if (!L.grafo || L.trabajando) return false;
  L.tramposa = on;
  attr(L.interruptor, 'aria-checked', on ? 'true' : 'false');
  L.chipTrampa.hidden = !on;
  attr(L.figura, 'data-trampa', on ? '' : null);
  reiniciarA(ctx);
  pintarA(ctx);
  K.narrar(ctx, on ? 'Peggy va a hacer trampa' : 'Peggy vuelve a decir la verdad',
    on ? 'Su horario esconde un choque: dos materias que comparten alumnos van en el mismo turno. ¿La descubres?' : 'Su horario ya no tiene choques.',
    on ? 'aviso' : 'info');
  if (sellar) cerrarSobres(ctx, L.botonSellar);
  return true;
}

async function cerrarSobres(ctx, boton) {
  const L = ctx.local;
  if (!L.grafo || L.trabajando) return;
  const ronda = K.token();
  L.trabajando = true;
  const r = await K.accion(ctx, boton, K.post('zk/coloreo/compromiso', { ronda, tramposa: L.tramposa }));
  L.trabajando = false;
  if (!r) return;
  const primera = !L.puntos.length && L.fase === 'inicio';
  Object.assign(L, { fase: 'cerrado', ronda, compromisos: r.compromisos, apertura: null, falsa: null, abierta: null,
    lote: false, lineaEstado: null, rotulo: `Ronda ${L.puntos.length + 1}` });
  pintarA(ctx);
  K.anim.escalonar(L.nodos.map((n) => n.ficha), [{ opacity: 0, transform: 'scale(1.3)' }, { opacity: 1, transform: 'none' }],
    { duration: K.anim.DUR.entrada }, 35);
  if (primera) K.narrar(ctx, 'Peggy cerró los sobres', 'Revolvió los turnos y cerró un sobre por materia. Ahora tú eliges qué línea abrir.', 'info');
}

function lineaAlAzar(ctx) {
  const L = ctx.local;
  if (!L.grafo || L.trabajando) return;
  if (L.fase !== 'cerrado') { pista(ctx); return; }
  const azar = new Uint32Array(1);
  crypto.getRandomValues(azar);
  const k = azar[0] % L.m;
  enfocarArista(L, k, false);
  abrirArista(ctx, k, L.botonAzar);
}

async function abrirArista(ctx, k, boton = null) {
  const L = ctx.local;
  const g = L.grafo;
  if (!g || L.trabajando) return;
  if (L.fase !== 'cerrado') { pista(ctx); return; }
  const [u, v] = g.aristas[k];
  const el = L.aristasEl[k];
  L.trabajando = true;
  attr(el, 'data-pidiendo', '');
  const r = await K.accion(ctx, boton, K.post('zk/coloreo/abrir', { ronda: L.ronda, tramposa: L.tramposa, arista: [u, v] }));
  attr(el, 'data-pidiendo', null);
  L.trabajando = false;
  if (!r) return;

  const ok = r.verificacion.ok;
  const pAntes = prob(L);
  L.puntos.push(ok);
  const n = L.puntos.length;
  if (!ok && !L.descubierta) L.descubierta = n;
  registrar(L, { etiqueta: `Ronda ${n}`, u, v, cu: r.u.color, cv: r.v.color, ok });
  Object.assign(L, { fase: 'abierto', compromisos: r.compromisos, apertura: r, falsa: null, abierta: k, resultadoOk: ok, lote: false, rotulo: `Ronda ${n}` });
  L.lineaEstado = lineaRonda(L, r.u, r.v, ok);
  agregarPuntos(L, [ok]);
  pintarA(ctx, { desde: pAntes });
  animarApertura(L, [u, v]);
  veredictoRonda(ctx, r, ok, n);
}

function veredictoRonda(ctx, r, ok, n) {
  const L = ctx.local;
  const g = L.grafo;
  const A = g.vertices[r.u.vertice];
  const B = g.vertices[r.v.vertice];
  const tA = g.turnos[r.u.color];
  const tB = g.turnos[r.v.color];
  if (ok) {
    K.pintarVeredicto(L.veredicto, { estado: 'ok', titulo: 'Turnos distintos: ronda superada',
      texto: [`${A} salió ${enLa(tA)} y ${B} ${enLa(tB)}: no chocan. `,
        L.descubierta ? `(Ya la descubriste en la ronda ${L.descubierta}: esta ronda no la salva.)` : `Probabilidad de que te esté engañando: ${formatoProb(prob(L))}.`] });
    K.explicar(L.explica,
      `Solo viste dos turnos, y Peggy los revolvió antes de cerrar los sobres: en otra ronda, ${A} puede salir en cualquier turno. Lo único que aprendiste es que esas dos materias no chocan.`,
      `Una ronda no basta: si Peggy mintiera, el choque estaría en alguna de las ${L.m} líneas y tú solo pediste una. Pide otra ronda: cada una es otra oportunidad de cacharla.`);
  } else {
    const mismo = r.verificacion.distintos === false;
    K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: mismo ? '¡Choque! Las dos tienen el mismo turno' : '¡Un sobre no cuadra!',
      texto: mismo ? `${A} y ${B} salieron las dos ${enLa(tA)}, y comparten alumnos. Peggy mintió: su horario no sirve.`
        : 'Lo que Peggy dice no coincide con lo que cerró en el sobre. Peggy hizo trampa.' });
    K.explicar(L.explica,
      'Peggy cerró los sobres antes de saber qué línea ibas a pedir, así que no pudo esconder el choque. Le bastaba con que no pidieras esta línea… pero no tenía forma de saberlo.',
      'Una sola ronda con choque basta para descubrirla, sin importar cuántas haya pasado antes.');
    K.narrar(ctx, 'Peggy quedó descubierta', `En la ronda ${n}, ${A} y ${B} traían el mismo turno.`, 'error');
  }
}

async function rondasSeguidas(ctx, boton) {
  const L = ctx.local;
  const g = L.grafo;
  if (!g || L.trabajando) return false;
  const k = g.rondas_recomendadas;
  L.trabajando = true;
  const r = await K.accion(ctx, boton, K.post('zk/coloreo/rondas', { ronda: K.token(), tramposa: L.tramposa, k }));
  L.trabajando = false;
  if (!r) return false;

  const antes = L.puntos.length;
  const pAntes = prob(L);
  const yaDescubierta = L.descubierta;
  r.rondas.forEach((x, j) => {
    L.puntos.push(x.ok);
    if (!x.ok && !L.descubierta) L.descubierta = antes + j + 1;
    registrar(L, { etiqueta: `Ronda ${antes + j + 1}`, u: x.arista[0], v: x.arista[1], cu: x.colores[0], cv: x.colores[1], ok: x.ok });
  });
  const fallas = r.rondas.filter((x) => !x.ok).length;
  // en el dibujo: la primera ronda con choque de la tanda, o la última
  const j = r.primera_falla ? r.primera_falla - 1 : r.rondas.length - 1;
  const x = r.rondas[j];
  const apertura = { u: { vertice: x.arista[0], color: x.colores[0] }, v: { vertice: x.arista[1], color: x.colores[1] } };
  Object.assign(L, { fase: 'abierto', ronda: null, compromisos: null, apertura, falsa: null, abierta: indiceArista(g, x.arista),
    resultadoOk: x.ok, lote: true, rotulo: `Ronda ${antes + j + 1}${r.primera_falla ? ' · la primera con choque' : ' · la última'}` });
  L.lineaEstado = lineaRonda(L, apertura.u, apertura.v, x.ok);
  agregarPuntos(L, r.rondas.map((y) => y.ok), { animar: true });
  pintarA(ctx, { desde: pAntes });
  animarApertura(L, x.arista);

  const A = g.vertices[x.arista[0]];
  const B = g.vertices[x.arista[1]];
  if (r.aceptada && !yaDescubierta) {
    const total = superadas(L);
    K.pintarVeredicto(L.veredicto, { estado: 'ok', titulo: '¡Convencido!',
      texto: `Peggy superó las ${k} rondas${antes ? ` (${total} en total)` : ''}. La probabilidad de que te esté engañando es menor que una en un millón.` });
    K.explicar(L.explica,
      `Si su horario tuviera aunque sea un choque, en cada ronda tenías al menos una posibilidad entre ${L.m} de pedir justo esa línea. Escaparse ${k} veces seguidas es prácticamente imposible.`,
      'Y aun así no viste su horario: en cada ronda solo viste dos turnos recién revueltos. Abre «Detrás del telón» para comprobarlo.');
    K.narrar(ctx, 'Víctor quedó convencido', `Peggy superó ${k} rondas sin un solo choque.`, 'ok');
  } else if (r.aceptada) {
    K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: 'Peggy ya estaba descubierta',
      texto: `Pasó estas ${k} rondas, pero en la ronda ${yaDescubierta} ya la habías cachado: un solo choque basta.` });
    K.explicar(L.explica, 'Las rondas superadas después no borran el choque que ya viste.');
  } else {
    K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: '¡Descubriste el choque!',
      texto: `En la ronda ${antes + r.primera_falla} pediste la línea ${A}–${B} y los dos sobres traían el mismo turno. En estas ${k} rondas la cachaste ${fallas} ${fallas === 1 ? 'vez' : 'veces'}.` });
    K.explicar(L.explica,
      `Su horario solo tenía un choque entre ${L.m} líneas, pero Peggy no sabía cuál ibas a pedir. Con ${k} rondas, caer en ella es prácticamente seguro.`,
      'Fíjate en la tira del paso 3: cada rombo rojo es una ronda en la que pediste justo esa línea.');
    K.narrar(ctx, 'Peggy quedó descubierta', `En ${k} rondas, Víctor pidió ${fallas} ${fallas === 1 ? 'vez' : 'veces'} la línea del choque.`, 'error');
  }
  return true;
}

// ---------------------------------------------------------------- trampas A
async function trampaMiente(ctx, boton) {
  const L = ctx.local;
  if (!fijarTramposa(ctx, true)) return;
  if (await rondasSeguidas(ctx, boton)) revelar(L.escena, 'start');
}

async function trampaCambia(ctx, boton) {
  const L = ctx.local;
  const g = L.grafo;
  if (!fijarTramposa(ctx, true)) return;
  const k = g.aristas.findIndex(([u, v]) => g.coloreo_tramposo[u] === g.coloreo_tramposo[v]);
  if (k < 0) return;
  const [u, v] = g.aristas[k];
  const ronda = K.token();
  L.trabajando = true;
  const r = await K.accion(ctx, boton, K.post('zk/coloreo/abrir', { ronda, tramposa: true, arista: [u, v] }));
  L.trabajando = false;
  if (!r) return;

  // Peggy dice otro turno para el segundo sobre (conserva su número al azar): Víctor recalcula la huella
  const color = (r.v.color + 1) % 3;
  const huellaFalsa = huella(color, r.v.nonce);
  const coincide = huellaFalsa === r.compromisos[v];
  L.puntos.push(false);
  const n = L.puntos.length;
  if (!L.descubierta) L.descubierta = n;
  registrar(L, { etiqueta: `Ronda ${n}`, u, v, cu: r.u.color, cv: r.v.color, ok: false });
  Object.assign(L, { fase: 'abierto', ronda, compromisos: r.compromisos, apertura: r, falsa: { vertice: v, color, huella: huellaFalsa, coincide },
    abierta: k, resultadoOk: false, lote: false, rotulo: `Ronda ${n}` });
  const A = g.vertices[v];
  const B = g.vertices[u];
  const tFalso = g.turnos[color];
  L.lineaEstado = { estado: 'mal', partes: [B, ' ', chipTurno(g, r.u.color), ' · ', A, ' dice ', chipTurno(g, color), ' → ', h('strong', '¡su sobre no cuadra!')] };
  agregarPuntos(L, [false]);
  pintarA(ctx);
  animarApertura(L, [u, v]);
  K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: '¡El sobre no coincide!',
    texto: `Pediste ${B}–${A}, justo la línea del choque. Para salvarse, Peggy dijo que ${A} va ${enLa(tFalso)}… pero lo que cerró en su sobre era otra cosa.`,
    extra: K.renglones([
      [`Huella del sobre de ${A}`, K.corto(r.compromisos[v], 8)],
      [`Huella de «${tFalso}» con su número al azar`, K.corto(huellaFalsa, 8)],
      ['¿Coinciden?', coincide ? 'sí' : 'no: Peggy cambió el turno'],
    ]) });
  K.explicar(L.explica,
    'Un sobre cerrado no se puede cambiar: Víctor recalcula la huella con lo que Peggy dice y la compara con la que recibió al principio. Si no coincide, la descubre.',
    'Por eso Peggy tiene que decidir todo ANTES de saber qué línea le vas a pedir. Y justo eso es lo que la atrapa.');
  K.narrar(ctx, 'Peggy quiso cambiar un sobre', `Dijo que ${A} va ${enLa(tFalso)}, pero la huella de su sobre no coincide.`, 'error');
  revelar(L.escena, 'start');
}

async function trampaEspia(ctx, boton) {
  const L = ctx.local;
  const g = L.grafo;
  if (!g || L.trabajando) return;
  const k = 0;
  const [u, v] = g.aristas[k];
  L.trabajando = true;
  const pedir = () => K.post('zk/coloreo/abrir', { ronda: K.token(), tramposa: L.tramposa, arista: [u, v] });
  const rs = await K.accion(ctx, boton, Promise.all(Array.from({ length: ESPIAS }, pedir)));
  L.trabajando = false;
  if (!rs) return;

  rs.forEach((r, j) => registrar(L, { etiqueta: `Espía ${j + 1}`, u, v, cu: r.u.color, cv: r.v.color, ok: r.verificacion.ok }));
  const ultimo = rs[rs.length - 1];
  Object.assign(L, { fase: 'abierto', ronda: ultimo.ronda, compromisos: ultimo.compromisos, apertura: ultimo, falsa: null, abierta: k,
    resultadoOk: ultimo.verificacion.ok, lote: false, rotulo: `Ronda espía ${ESPIAS} de ${ESPIAS}` });
  L.lineaEstado = lineaRonda(L, ultimo.u, ultimo.v, ultimo.verificacion.ok);
  pintarA(ctx);
  animarApertura(L, [u, v]);

  const A = g.vertices[u];
  const B = g.vertices[v];
  const turnosA = new Set(rs.map((r) => r.u.color));
  K.pintarVeredicto(L.veredicto, { estado: 'info', titulo: 'Víctor no averiguó nada',
    texto: `Pidió ${ESPIAS} veces la misma línea (${A} y ${B}). Mira cómo cambian los turnos:`,
    extra: h('ol.zk-espias', { role: 'list' }, rs.map((r, j) => h('li',
      h('span.zk-espias__n', `Ronda ${j + 1}`),
      h('span', A, ' ', chipTurno(g, r.u.color)),
      h('span', B, ' ', chipTurno(g, r.v.color))))) });
  K.explicar(L.explica,
    h('p', '¿En qué turno va ', h('strong', A), ' de verdad? ', turnosA.size > 1
      ? `Salió en ${turnosA.size} turnos distintos: imposible saberlo.`
      : `Salió siempre ${enLa(g.turnos[[...turnosA][0]])}, pero fue casualidad: cada ronda es un sorteo nuevo.`),
    'Peggy revuelve los nombres de los turnos antes de cada ronda. Lo único que se mantiene es que esas dos materias son distintas, y eso Víctor ya lo sabía. Eso es el «conocimiento cero»: te convences sin aprender nada más.');
  K.narrar(ctx, 'Víctor intentó espiar', `Abrió ${ESPIAS} veces ${A} y ${B}: los turnos cambian en cada ronda.`, 'info');
  revelar(L.escena, 'start');
}

// ---------------------------------------------------------------- detrás del telón
function pintarTelon(ctx) {
  const L = ctx.local;
  const g = L.grafo;
  if (!g) return;
  const col = L.tramposa ? g.coloreo_tramposo : g.secreto_de_peggy;
  const choques = g.aristas.filter(([u, v]) => col[u] === col[v]);
  const enChoque = new Set(choques.flat());

  const partes = [
    h('p', L.tramposa
      ? 'Este es el horario que Peggy guarda en secreto (el de la trampa). Víctor nunca lo ve: solo ve sobres cerrados y, en cada ronda, dos turnos.'
      : 'Este es el horario que Peggy guarda en secreto. Víctor nunca lo ve: solo ve sobres cerrados y, en cada ronda, dos turnos.'),
    h('div.zk-horario', g.turnos.map((t, c) => h('div.zk-horario__turno', { dataset: { turno: c } },
      h('p.zk-horario__titulo', h('span.zk-turno__letra', { 'aria-hidden': 'true' }, LETRA[c]), t),
      h('ul', { role: 'list' }, g.vertices.map((nombre, i) => (col[i] !== c ? null
        : h('li', { dataset: { choque: enChoque.has(i) ? 'si' : null } }, nombre, enChoque.has(i) ? h('span.zk-horario__choque', ' · choque') : null))))))),
  ];
  if (choques.length) {
    partes.push(h('p.zk-telon__choque', icono('alerta'), h('span',
      choques.map(([u, v]) => `${g.vertices[u]} y ${g.vertices[v]}`).join(', '),
      ` van las dos ${enLa(g.turnos[col[choques[0][0]]])} y comparten alumnos: ese es el choque escondido.`)));
  }

  // la materia que más veces se abrió: sus turnos cambian de ronda en ronda
  const vistos = new Map();
  for (const e of L.historial.slice(-60)) {
    for (const [i, c] of [[e.u, e.cu], [e.v, e.cv]]) {
      if (!vistos.has(i)) vistos.set(i, []);
      vistos.get(i).push(c);
    }
  }
  let mejor = null;
  for (const par of vistos) if (!mejor || par[1].length > mejor[1].length) mejor = par;
  if (mejor && mejor[1].length >= 2) {
    const [i, lista] = mejor;
    partes.push(h('div.zk-telon__revelacion',
      h('p', h('strong', g.vertices[i]), ` va de verdad ${enLa(g.turnos[col[i]])}. Pero en tus últimas rondas salió así: `,
        lista.slice(-6).map((c, j) => [j ? ' ' : null, chipTurno(g, c)])),
      h('p', 'Antes de cada ronda Peggy revuelve los nombres de los turnos (lo que era «Mañana» puede llamarse «Noche» en la siguiente). Lo que ves es un disfraz nuevo cada vez: solo dice que dos materias vecinas son distintas, nada más.')));
  } else {
    partes.push(h('p.texto-3', 'Abre varias rondas y vuelve aquí: verás que la misma materia sale en turnos distintos.'));
  }

  if (L.historial.length) {
    partes.push(h('h4.zk-subtitulo', 'Lo que viste en las últimas rondas'),
      h('ol.zk-historial', { role: 'list' }, L.historial.slice(-8).reverse().map((e) => h('li', { dataset: { ok: e.ok ? 'si' : 'no' } },
        h('span.zk-historial__n', e.etiqueta),
        h('span', g.vertices[e.u], ' ', chipTurno(g, e.cu)),
        h('span', g.vertices[e.v], ' ', chipTurno(g, e.cv)),
        h('span.zk-historial__res', icono(e.ok ? 'ok' : 'x'), e.ok ? 'distintos' : 'choque')))));
  }
  K.reemplazar(L.telonCuerpo, ...partes);
}

// ---------------------------------------------------------------- cuentas A
function pintarCuentasA(ctx) {
  const L = ctx.local;
  const g = L.grafo;
  if (!g) return;
  if (!L.compromisos) {
    K.reemplazar(L.cuentasA, h('p.texto-3', L.lote
      ? 'Las rondas seguidas no guardan sus sobres aquí: haz una ronda a mano para ver sus huellas.'
      : 'Cuando Peggy cierre los sobres, aquí verás sus huellas de verdad.'));
    return;
  }
  const partes = [
    h('p', `Los 7 sobres de la ${L.rotulo.toLowerCase()}:`),
    K.renglones(g.vertices.map((nombre, i) => [nombre, K.corto(L.compromisos[i], 10)])),
  ];
  const r = L.apertura;
  if (L.fase === 'abierto' && r?.u?.nonce) {
    const linea = (lado) => {
      const hh = huella(lado.color, lado.nonce);
      return `${g.vertices[lado.vertice]}: SHA-256( ${lado.color} ‖ ${K.corto(lado.nonce, 6)} ) = ${K.corto(hh, 8)}   ${hh === L.compromisos[lado.vertice] ? '✓ es su sobre' : '✗ no es su sobre'}`;
    };
    const lineas = [linea(r.u)];
    if (L.falsa) {
      const f = L.falsa;
      lineas.push(`${g.vertices[f.vertice]} según Peggy: SHA-256( ${f.color} ‖ el mismo número ) = ${K.corto(f.huella, 8)}   ${f.coincide ? '✓ es su sobre' : '✗ no es su sobre'}`,
        `   (lo que de verdad había: ${linea(r.v)})`);
    } else lineas.push(linea(r.v));
    partes.push(h('p', 'Peggy abre dos sobres: entrega el turno (0, 1 o 2, ya revuelto) y su número al azar. Víctor recalcula la huella aquí mismo, en tu navegador:'),
      h('p.esq-cuenta', lineas.join('\n')));
  }
  K.reemplazar(L.cuentasA, ...partes);
}

function pintarCuentasAExtra(ctx) {
  const L = ctx.local;
  const g = L.grafo;
  const m = g.aristas.length;
  const eps = g.epsilon;
  const exacto = Math.log(eps) / Math.log(1 - 1 / m);
  const k = Math.ceil(exacto);
  const cota = m * Math.log(1 / eps);
  const sup = (n) => String(n).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)] ?? (d === '-' ? '⁻' : d)).join('');
  const expo = Math.round(Math.log10(eps));
  const [mant, ex] = ((1 - 1 / m) ** k).toExponential(1).split('e');
  K.reemplazar(L.cuentasAExtra,
    h('p', `Si el horario tuviera un choque, al menos una de las |E| = ${m} líneas lo delata. Víctor elige al azar, así que en cada ronda lo atrapa con probabilidad de al menos 1/${m}, y Peggy se escapa con ${m - 1}/${m}:`),
    h('p.esq-cuenta', [
      `Pr[escapar k rondas] ≤ (1 − 1/${m})^k = (${m - 1}/${m})^k`,
      `k = ⌈ln ε / ln(${m - 1}/${m})⌉ = ⌈ln 10${sup(expo)} / ln(${m - 1}/${m})⌉ = ⌈${exacto.toFixed(1)}⌉ = ${k}`,
      `(${m - 1}/${m})^${k} ≈ ${mant} × 10${sup(Number(ex))}  <  ε = 10${sup(expo)}`,
    ].join('\n')),
    h('p', `La cuenta rápida del documento, k ≈ |E|·ln(1/ε) = ${m} × ${Math.log(1 / eps).toFixed(1)} ≈ ${Math.ceil(cota)}, usa (1 − 1/|E|)^k ≤ e^(−k/|E|) y deja unas rondas de margen; la exacta da ${k}.`),
    h('p', 'Las rondas van una tras otra, con turnos revueltos y números al azar nuevos cada vez. Hacerlas todas a la vez (en paralelo) puede romper el conocimiento cero; para no conversar, se aplica Fiat–Shamir a todas las rondas.'));
}

// ---------------------------------------------------------------- SHA-256 (para que Víctor recalcule la huella de un sobre)
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rot = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(datos) {
  const largo = datos.length;
  const m = new Uint8Array(((largo + 72) >> 6) << 6);
  m.set(datos);
  m[largo] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(m.length - 8, Math.floor((largo * 8) / 2 ** 32));
  dv.setUint32(m.length - 4, (largo * 8) >>> 0);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Uint32Array(64);
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((x, i) => { H[i] = (H[i] + x) | 0; });
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

function hexABytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}

/** sobre = SHA-256(turno ‖ número al azar), igual que el servidor. */
const huella = (color, nonceHex) => sha256(Uint8Array.of(color, ...hexABytes(nonceHex)));

// ================================================================ B · entrar sin decir la contraseña
function seccionB(ctx) {
  const L = ctx.local;
  const id = L.id;
  const unam = K.inst.sigla(INST);
  const boton = (ico, txt, fn) => {
    const b = h('button.boton.boton--primario', { type: 'button' }, icono(ico), h('span', txt));
    b.addEventListener('click', () => fn(b));
    return b;
  };
  L.bBotones = [
    boton('candado', 'Mandar el sobre', (b) => bSobre(ctx, b)),
    boton('dado', 'Lanzar el reto', () => bReto(ctx)),
    boton('llave', 'Responder', (b) => bResponder(ctx, b)),
    boton('escudo', 'Comprobar', () => bComprobar(ctx)),
  ];
  L.bMensajes = [nuevaBurbuja(), nuevaBurbuja(), nuevaBurbuja()];
  L.bBalanza = nuevaBalanza();
  const textos = [
    [`La ${unam} manda un sobre cerrado`, 'Piensa un número al azar, lo guarda en un sobre y se lo manda a Víctor. Desde ese momento ya no lo puede cambiar.'],
    ['Víctor lanza un reto al azar', `Otro número al azar, enorme, que la ${unam} no podía adivinar cuando cerró el sobre.`],
    [`La ${unam} responde`, 'Mezcla su número al azar, el reto y su llave secreta en un solo número. Ese número, por sí solo, no deja ver la llave.'],
    ['Víctor comprueba', `Con la llave pública de la ${unam} (la que todos conocen) hace la cuenta por dos caminos. Si los dos dan lo mismo, la ${unam} tiene la llave secreta.`],
  ];
  L.bPasos = textos.map(([titulo, ayuda], i) => K.paso({ n: i + 1, titulo, ayuda, estado: i ? 'espera' : 'activo', id: id(`b${i + 1}`) },
    h('div.esq-acciones', L.bBotones[i]),
    i < 3 ? L.bMensajes[i] : L.bBalanza));
  L.bPasosEl = h('div.esq-pasos.zk-pasos-b', L.bPasos);
  L.bVeredicto = K.veredicto({ vacio: `Sigue los cuatro pasos y aquí verás si Víctor deja pasar a la ${unam}.` });
  L.bExplica = K.explicacion();

  const trampas = K.trampas([
    { etiqueta: 'Un impostor intenta entrar', texto: `Alguien sin la llave de la ${unam} intenta pasar por ella.`, fn: (b) => bImpostor(ctx, b) },
    { etiqueta: `La ${unam} se descuida: repite su número al azar`, texto: 'Responde dos retos distintos usando el mismo sobre.', fn: (b) => bDescuido(ctx, b) },
    { etiqueta: 'Fabricar una conversación falsa', texto: 'Sin la llave: inventando primero el reto y la respuesta.', fn: (b) => bSimular(ctx, b) },
  ]);

  L.bCuentas = h('div.zk-cuentas');
  L.bCuentasDet = K.cuentas('Ver las cuentas',
    h('p', `La llave secreta de la ${unam} es un número enorme `, h('code', 'x'), '. La pública es ', h('code', 'Y = x·G'),
      ': el punto ', h('code', 'G'), ' de la curva secp256k1 (la de Bitcoin) «sumado» x veces. Ir de x a Y es fácil; regresar de Y a x es inviable.'),
    h('p.esq-cuenta', [
      '1. Sobre:      T = r·G              (r: número al azar, nuevo en cada intento)',
      '2. Reto:       c al azar, 0 ≤ c < N  (N ≈ 1.16 × 10⁷⁷)',
      '3. Respuesta:  s = r + c·x  (mod N)',
      '4. Comprueba:  ¿s·G = T + c·Y?   porque (r + c·x)·G = r·G + c·(x·G) = T + c·Y',
    ].join('\n')),
    L.bCuentas,
    h('h4.zk-subtitulo', 'Por qué jamás se repite r'),
    h('p', 'Dos respuestas al mismo sobre, con retos distintos, dejan despejar la llave:'),
    h('p.esq-cuenta', 's₁ − s₂ = (c₁ − c₂)·x   ⇒   x = (s₁ − s₂)·(c₁ − c₂)⁻¹  (mod N)'),
    h('h4.zk-subtitulo', 'Cómo se fabrica una conversación falsa'),
    h('p.esq-cuenta', 'elige c y s al azar   ⇒   T = s·G − c·Y      (cuadra sin conocer x)'),
    h('h4.zk-subtitulo', 'Sin conversación (Fiat–Shamir)'),
    h('p', 'Si el reto no lo pone Víctor sino una huella de todo lo público, ', h('code', 'c = H(dominio ‖ G ‖ Y ‖ T ‖ mensaje)'),
      `, la prueba se vuelve un par (T, s) que cualquiera comprueba después, sin hablar con la ${unam}. Es una firma digital.`),
    fiatShamir(ctx));
  L.bCuentasDet.addEventListener('toggle', () => { if (L.bCuentasDet.open) pintarCuentasB(ctx); });

  return h('section.zk-demo', { dataset: { demo: 'b' }, 'aria-labelledby': id('b-t') },
    h('div.zk-demo__intro',
      h('p.zk-demo__marca', 'Demostración B'),
      h('h3.zk-demo__titulo', { id: id('b-t'), tabindex: '-1' }, 'Entrar sin decir la contraseña'),
      h('p', `La ${unam} quiere entrar al sistema del consorcio. Con una contraseña normal hay un problema: para comprobarla, el sistema tiene que verla… y quien la ve puede usarla.`),
      h('p', `Aquí la ${unam} demuestra que tiene su llave secreta sin enseñarla nunca: ni a Víctor ni a quien esté espiando la conversación.`),
      h('ul.zk-reparto', { role: 'list' },
        h('li', icono('institucion'), h('span', h('strong', unam), ' · tiene la llave secreta. Es Peggy: la que prueba.')),
        h('li', icono('escudo'), h('span', h('strong', 'Víctor'), ' · el sistema del consorcio. Solo conoce la llave pública.')))),
    L.bPasosEl,
    L.bVeredicto,
    L.bExplica,
    trampas,
    L.bCuentasDet);
}

function nuevaBurbuja() {
  return h('div.zk-mensaje', { hidden: true },
    h('span.zk-mensaje__quien'), h('span.zk-mensaje__que'), h('code.zk-mensaje__valor'));
}

function burbuja(el, datos) {
  el.hidden = !datos;
  if (!datos) return;
  attr(el, 'data-de', datos.de);
  const [quien, que, valor] = el.children;
  texto(quien, datos.quien);
  texto(que, datos.que);
  texto(valor, datos.valor);
}

function nuevaBalanza() {
  return h('div.zk-balanza', { hidden: true },
    h('div.zk-balanza__lado', h('span.zk-balanza__etiqueta', 'Camino 1 · con la respuesta'), h('code.zk-balanza__valor')),
    h('span.zk-balanza__signo', { 'aria-hidden': 'true' }),
    h('div.zk-balanza__lado', h('span.zk-balanza__etiqueta', 'Camino 2 · con el sobre, el reto y la llave pública'), h('code.zk-balanza__valor')),
    h('p.zk-balanza__lectura'));
}

function pintarBalanza(L, b) {
  const el = L.bBalanza;
  el.hidden = !b;
  if (!b) return;
  const ok = b.verif.ok;
  attr(el, 'data-estado', ok ? 'ok' : 'mal');
  const [v1, v2] = el.querySelectorAll('.zk-balanza__valor');
  texto(v1, K.corto(b.verif.sG, 8));
  texto(v2, K.corto(b.verif.T_mas_cY ?? '—', 8));
  texto(el.querySelector('.zk-balanza__signo'), ok ? '=' : '≠');
  K.reemplazar(el.querySelector('.zk-balanza__lectura'), icono(ok ? 'ok' : 'x'), ok ? ' Iguales: la cuenta cuadra' : ' Distintos: la cuenta no cuadra');
}

function pintarB(ctx, { nuevo = null } = {}) {
  const L = ctx.local;
  const b = L.b;
  const quien = b.impostor ? 'Impostor' : K.inst.sigla(INST);
  const de = b.impostor ? 'impostor' : 'peggy';
  L.bPasos.forEach((p, i) => K.marcarPaso(p, b.paso > i ? 'hecho' : b.paso === i ? 'activo' : 'espera'));
  L.bBotones.forEach((bt, i) => { if (i) bt.disabled = b.paso !== i; });
  K.reemplazar(L.bBotones[0], icono(b.paso ? 'reiniciar' : 'candado'), h('span', b.paso ? 'Empezar con un sobre nuevo' : 'Mandar el sobre'));
  burbuja(L.bMensajes[0], b.paso >= 1 && { de, quien: `${quien} → Víctor`, que: 'Un sobre cerrado', valor: `T = ${K.corto(b.T, 8)}` });
  burbuja(L.bMensajes[1], b.paso >= 2 && { de: 'victor', quien: `Víctor → ${quien}`, que: 'Un reto al azar', valor: `c = ${K.corto(b.c, 8)}` });
  burbuja(L.bMensajes[2], b.paso >= 3 && { de, quien: `${quien} → Víctor`, que: 'Su respuesta', valor: `s = ${K.corto(b.s, 8)}` });
  pintarBalanza(L, b.paso >= 4 ? b : null);
  if (nuevo !== null) K.anim.entrar(nuevo < 3 ? L.bMensajes[nuevo] : L.bBalanza);
  if (L.bCuentasDet?.open) pintarCuentasB(ctx);
}

async function bSobre(ctx, boton) {
  const L = ctx.local;
  if (L.bTrabajando) return;
  const ronda = K.token();
  L.bTrabajando = true;
  const r = await K.accion(ctx, boton, K.post('zk/compromiso', { semilla: K.semilla(ctx), institucion: INST, ronda }));
  L.bTrabajando = false;
  if (!r) return;
  L.b = { paso: 1, impostor: false, ronda, Y: r.Y, T: r.T };
  K.pintarVeredicto(L.bVeredicto, null);
  K.explicar(L.bExplica);
  pintarB(ctx, { nuevo: 0 });
}

function bReto(ctx) {
  const L = ctx.local;
  if (L.b.paso !== 1) return;
  L.b = { ...L.b, paso: 2, c: K.retoAlAzar() };
  pintarB(ctx, { nuevo: 1 });
}

async function bResponder(ctx, boton) {
  const L = ctx.local;
  const b = L.b;
  if (b.paso !== 2 || L.bTrabajando) return;
  L.bTrabajando = true;
  const r = await K.accion(ctx, boton, K.post('zk/responder', { semilla: K.semilla(ctx), institucion: INST, ronda: b.ronda, reto: b.c }));
  L.bTrabajando = false;
  if (!r) return;
  L.b = { ...b, paso: 3, Y: r.Y, T: r.T, s: r.s, verif: r.verificacion };
  pintarB(ctx, { nuevo: 2 });
}

function bComprobar(ctx) {
  const L = ctx.local;
  if (L.b.paso !== 3) return;
  L.b = { ...L.b, paso: 4 };
  pintarB(ctx, { nuevo: 3 });
  veredictoB(ctx);
}

function veredictoB(ctx) {
  const L = ctx.local;
  const unam = K.inst.sigla(INST);
  if (L.b.verif.ok) {
    K.pintarVeredicto(L.bVeredicto, { estado: 'ok', titulo: `¡Es la ${unam}! Puede entrar`,
      texto: 'Los dos caminos dan el mismo resultado: solo quien tiene la llave secreta podía responder así. Y Víctor nunca la vio.' });
    K.explicar(L.bExplica,
      `El sobre obliga a la ${unam} a comprometerse ANTES de conocer el reto. Sin la llave, no hay forma de preparar una respuesta que sirva para un reto que todavía no existe.`,
      '¿Y si alguien grabó la conversación? No le sirve para entrar: la próxima vez Víctor lanzará otro reto.');
    K.narrar(ctx, `Víctor dejó pasar a la ${unam}`, 'Demostró que tiene su llave secreta sin enseñarla.', 'ok');
  } else {
    K.pintarVeredicto(L.bVeredicto, { estado: 'mal', titulo: `Rechazado: no es la ${unam}`,
      texto: 'Los dos caminos no coinciden. El impostor tuvo que inventar la respuesta, y sin la llave secreta no cuadra.' });
    K.explicar(L.bExplica,
      'Para engañar a Víctor tendría que adivinar el reto antes de cerrar su sobre: una posibilidad entre un número de 78 cifras.',
      `Por eso basta un solo intento para rechazarlo, y la ${unam} nunca tuvo que enseñar su llave.`);
    K.narrar(ctx, 'Impostor rechazado', `Sin la llave de la ${unam}, su respuesta no cuadró.`, 'error');
  }
}

// ---------------------------------------------------------------- trampas B
async function bImpostor(ctx, boton) {
  const L = ctx.local;
  if (L.bTrabajando) return;
  const ronda = K.token();
  L.bTrabajando = true;
  const r = await K.accion(ctx, boton, K.post('zk/responder', { semilla: K.semilla(ctx), institucion: INST, ronda, reto: K.retoAlAzar(), impostor: true }));
  L.bTrabajando = false;
  if (!r) return;
  L.b = { paso: 4, impostor: true, ronda, Y: r.Y, T: r.T, c: r.c, s: r.s, verif: r.verificacion };
  pintarB(ctx);
  K.anim.escalonar([...L.bMensajes, L.bBalanza], [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
    { duration: K.anim.DUR.entrada }, 90);
  veredictoB(ctx);
  revelar(L.bPasosEl, 'start');
}

async function bDescuido(ctx, boton) {
  const L = ctx.local;
  if (L.bTrabajando) return;
  const semilla = K.semilla(ctx);
  const ronda = K.token();
  const retos = [K.retoAlAzar(), K.retoAlAzar()];
  const unam = K.inst.sigla(INST);
  L.bTrabajando = true;
  const res = await K.accion(ctx, boton, (async () => {
    const [r1, r2] = await Promise.all(retos.map((reto) => K.post('zk/responder', { semilla, institucion: INST, ronda, reto })));
    const ex = await K.post('zk/extraer', { semilla, institucion: INST, transcripciones: [{ c: r1.c, s: r1.s }, { c: r2.c, s: r2.s }] });
    return { r1, r2, ex };
  })());
  L.bTrabajando = false;
  if (!res) return;
  const { r1, r2, ex } = res;
  L.bExtra = { tipo: 'extraccion', r1, r2, ex };
  K.pintarVeredicto(L.bVeredicto, { estado: 'mal', titulo: `¡La llave secreta de la ${unam} quedó expuesta!`,
    texto: 'Respondió dos retos distintos usando el mismo sobre. Con esas dos respuestas, cualquiera despeja la llave con una resta y una división:',
    extra: K.renglones([
      ['El mismo sobre, dos veces', `T = ${K.corto(r1.T, 8)}`],
      ['Respuesta al reto 1', `s₁ = ${K.corto(r1.s, 8)}`],
      ['Respuesta al reto 2', `s₂ = ${K.corto(r2.s, 8)}`],
      ['Llave que despejó Víctor', K.corto(ex.x_extraida, 8)],
      [`Llave secreta real de la ${unam}`, K.corto(ex.x_real, 8)],
      ['¿Es la misma?', ex.coincide ? 'sí, idéntica' : 'no'],
    ]) });
  K.explicar(L.bExplica,
    `Con esa llave, cualquiera puede hacerse pasar por la ${unam}. El número al azar es lo que tapa la llave dentro de la respuesta: si se usa dos veces, basta restar una respuesta de la otra para que la tapa se cancele.`,
    'Así se rompió la PlayStation 3 en 2010: Sony firmaba usando siempre el mismo número «al azar», y con dos firmas se despejó su llave. Por eso cada sobre lleva un número nuevo que nunca se repite.');
  K.narrar(ctx, `Llave de la ${unam} expuesta`, 'Repitió su número al azar con dos retos distintos.', 'error');
  if (L.bCuentasDet.open) pintarCuentasB(ctx);
  revelar(L.bVeredicto);
}

async function bSimular(ctx, boton) {
  const L = ctx.local;
  if (L.bTrabajando) return;
  L.bTrabajando = true;
  const r = await K.accion(ctx, boton, K.post('zk/simular', { semilla: K.semilla(ctx), institucion: INST }));
  L.bTrabajando = false;
  if (!r) return;
  L.bExtra = { tipo: 'simulada', ...r };
  K.pintarVeredicto(L.bVeredicto, { estado: 'info', titulo: 'También cuadra… y nadie usó la llave',
    texto: 'Esta conversación se fabricó al revés: primero el reto y la respuesta, y al final un sobre hecho a la medida.',
    extra: K.renglones([
      ['Reto (elegido primero)', `c = ${K.corto(r.c, 8)}`],
      ['Respuesta (elegida primero)', `s = ${K.corto(r.s, 8)}`],
      ['Sobre (calculado al final)', `T = ${K.corto(r.T, 8)}`],
      ['¿Cuadra la cuenta?', r.verifica ? 'sí ✓' : 'no'],
    ]) });
  K.explicar(L.bExplica,
    'En vivo esto no sirve para entrar: Víctor lanza el reto DESPUÉS de recibir el sobre, y así ya no se puede fabricar.',
    h('p', 'Pero significa que una conversación grabada no prueba nada a nadie más: cualquiera pudo inventarla. Víctor queda convencido, y no se lleva nada que pueda enseñar ni usar. Eso es el ', h('strong', '«conocimiento cero»'), '.'));
  K.narrar(ctx, 'Conversación fabricada', 'Cuadra sin la llave, pero solo si el reto se elige antes que el sobre.', 'info');
  revelar(L.bVeredicto);
}

// ---------------------------------------------------------------- cuentas B
function pintarCuentasB(ctx) {
  const L = ctx.local;
  const b = L.b;
  const partes = [];
  if (b.paso >= 3) {
    partes.push(h('p', b.impostor ? 'La última conversación (la del impostor):' : 'La última conversación:'),
      K.renglones([
        ['Llave pública', `Y = ${K.corto(b.Y, 10)}`],
        ['Sobre', `T = ${K.corto(b.T, 10)}`],
        ['Reto', `c = ${K.corto(b.c, 10)}`],
        ['Respuesta', `s = ${K.corto(b.s, 10)}`],
        b.paso >= 4 ? ['Camino 1', `s·G = ${K.corto(b.verif.sG, 10)}`] : null,
        b.paso >= 4 ? ['Camino 2', `T + c·Y = ${K.corto(b.verif.T_mas_cY ?? '—', 10)}`] : null,
        b.paso >= 4 ? ['¿Iguales?', b.verif.ok ? 'sí ✓' : 'no ✗'] : null,
      ]));
  } else {
    partes.push(h('p.texto-3', 'Cuando la UNAM responda (paso 3), aquí verás los números de verdad.'));
  }
  if (L.bExtra?.tipo === 'extraccion') {
    const { r1, r2, ex } = L.bExtra;
    partes.push(h('p', 'El descuido (mismo sobre, dos retos):'),
      K.renglones([
        ['c₁ · s₁', `${K.corto(r1.c, 6)} · ${K.corto(r1.s, 6)}`],
        ['c₂ · s₂', `${K.corto(r2.c, 6)} · ${K.corto(r2.s, 6)}`],
        ['x = (s₁ − s₂)/(c₁ − c₂) mod N', K.corto(ex.x_extraida, 10)],
        ['¿Es la llave real?', ex.coincide ? 'sí' : 'no'],
      ]));
  }
  K.reemplazar(L.bCuentas, ...partes);
}

function fiatShamir(ctx) {
  const L = ctx.local;
  L.fsEntrada = h('input.entrada', { id: L.id('fs'), name: 'mensaje', value: MENSAJE_FS, autocomplete: 'off', spellcheck: 'false', maxlength: '260' });
  L.fsSalida = h('div.zk-fs__salida', { 'aria-live': 'polite' });
  const crear = h('button.boton.boton--secundario', { type: 'button' }, icono('firma'), h('span', 'Crear la prueba'));
  L.fsVerificar = h('button.boton.boton--fantasma', { type: 'button', disabled: true }, icono('ok'), h('span', 'Comprobarla'));
  L.fsOtro = h('button.boton.boton--fantasma', { type: 'button', disabled: true }, icono('x'), h('span', 'Comprobarla con otro mensaje'));
  crear.addEventListener('click', () => fsCrear(ctx, crear));
  L.fsVerificar.addEventListener('click', () => fsComprobar(ctx, L.fsVerificar, false));
  L.fsOtro.addEventListener('click', () => fsComprobar(ctx, L.fsOtro, true));
  return h('div.zk-fs',
    h('div.campo', h('label.campo__etiqueta', { for: L.fsEntrada.id }, 'Mensaje que firma la UNAM'), L.fsEntrada),
    h('div.zk-fs__botones', crear, L.fsVerificar, L.fsOtro),
    L.fsSalida);
}

async function fsCrear(ctx, boton) {
  const L = ctx.local;
  const mensaje = L.fsEntrada.value;
  const r = await K.accion(ctx, boton, K.post('zk/probar', { semilla: K.semilla(ctx), institucion: INST, mensaje }));
  if (!r) return;
  L.fs = { ...r, mensaje };
  L.fsResultado = null;
  L.fsVerificar.disabled = false;
  L.fsOtro.disabled = false;
  K.reemplazar(L.fsSalida,
    K.renglones([
      ['Mensaje', `«${mensaje}»`],
      ['Sobre', `T = ${K.corto(r.T, 10)}`],
      ['Reto = huella de todo lo público', `c = ${K.corto(r.c, 10)}`],
      ['Respuesta', `s = ${K.corto(r.s, 10)}`],
    ]),
    h('p.texto-3', 'La prueba es solo el par (T, s): quien la comprueba recalcula el reto con el mensaje.'));
}

async function fsComprobar(ctx, boton, otro) {
  const L = ctx.local;
  if (!L.fs) return;
  const mensaje = otro ? `${L.fs.mensaje} (cambiado)` : L.fs.mensaje;
  const r = await K.accion(ctx, boton, K.post('zk/verificar', { Y: L.fs.Y, mensaje, T: L.fs.T, s: L.fs.s }));
  if (!r) return;
  L.fsResultado?.remove();
  L.fsResultado = h('p.zk-fs__resultado', { dataset: { estado: r.valida ? 'ok' : 'mal' } }, icono(r.valida ? 'ok' : 'x'),
    h('span', `Con «${mensaje}»: `, r.valida ? 'la prueba es válida.' : 'NO es válida: el reto cambia con el mensaje y la cuenta ya no cuadra.'));
  L.fsSalida.append(L.fsResultado);
}

// ================================================================ para saber más
function saberMas() {
  return K.saberMas(
    h('ul',
      h('li', h('strong', 'Títulos y calificaciones: '), 'demostrar que un título es válido, o que tu promedio es de 9 o más, sin entregar la boleta completa.'),
      h('li', h('strong', 'Mayoría de edad: '), 'Google Wallet prueba que tienes 18 años o más a partir de tu credencial, sin revelar tu fecha de nacimiento.'),
      h('li', h('strong', 'Persona única: '), 'World ID prueba que eres un humano registrado una sola vez, sin decir cuál.'),
      h('li', h('strong', 'Pagos privados: '), 'Zcash demuestra que un pago es válido sin mostrar quién paga, a quién ni cuánto.'),
      h('li', h('strong', 'Rollups: '), 'ZKsync, Starknet y otros prueban con una sola prueba corta que miles de transacciones hechas fuera de Ethereum se ejecutaron bien.'),
      h('li', h('strong', 'Firmas: '), 'las firmas Schnorr de Bitcoin (Taproot) y EdDSA son la demostración B «sin conversación» (Fiat–Shamir).')),
    h('p', h('strong', 'Límites: '), 'la demostración A es para aprender: pide 187 rondas de siete sobres. Los sistemas reales (SNARK, STARK) logran lo mismo con una sola prueba de unos cientos de bytes. Una prueba no es mejor que sus datos: si nadie firma la información de origen, quien prueba puede mentir sobre ella. El número al azar jamás se repite, y las rondas van una tras otra.'),
    h('p', h('strong', 'Y aun así fallan: '), 'según el documento, en mayo de 2026 Zcash tuvo que actualizarse (NU6.2) por una falla de solidez que llevaba cuatro años escondida, y RISC Zero pagó 50 000 USD por otra hallada después de sus auditorías.'));
}
