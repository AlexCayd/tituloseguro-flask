// ESQUEMA 4 · Firmar sin decir quién (firmas de anillo AOS y LSAG).
//  A · Denuncia anónima (AOS). 1 elige el grupo · 2 elige quién eres (secreto) · 3 escribe y firma ·
//      4 el periódico comprueba: un destello recorre el anillo con las llaves públicas del grupo y, si
//      regresa al mismo número con el que salió («la vuelta cierra»), la firma es auténtica. Ninguna
//      institución se distingue: «1 de n». Trampas: cambiar una palabra, cambiar el grupo, firmar desde fuera.
//  B · Votación anónima (LSAG). Cada voto lleva un «folio anónimo» (imagen de clave): el mismo para la
//      misma institución, sin decir cuál. La urna rechaza el segundo voto sin saber de quién es.
//  Debajo: las cuentas de verdad (c₀, rᵢ, la cadena de retos, la imagen de clave) y dónde se usa.
// API: POST /api/esquemas/anillo/firmar | /verificar | /urna

import * as K from './_kit.js';

const { h, s, icono, texto, attr } = K;

const MIN = 3;
const MAX = 8;
const GRUPO_INICIAL = ['N01', 'N02', 'N03', 'N04', 'N05'];
const FIRMANTE_INICIAL = 'N03';
const DENUNCIA = 'El título 4471 de 2025 es falso';
const PREGUNTA = '¿El consorcio adopta el título 100 % digital en 2027?';
const MAX_BYTES = 280;

const bytes = (t) => new TextEncoder().encode(t).length;
const sigla = (i) => K.inst.sigla(i);
const enOrden = (ids) => K.IDS.filter((i) => ids.includes(i));
const NUM = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const porcentaje = (n) => `${NUM.format(100 / n)} %`;
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n) => String(n).split('').map((d) => SUB[Number(d)]).join('');

/** «UAN, UNAM e IPN»: la «y» pasa a «e» ante sonido /i/. */
function enumerar(ids) {
  const xs = ids.map(sigla);
  if (xs.length < 2) return xs.join('');
  const ultima = xs[xs.length - 1];
  return `${xs.slice(0, -1).join(', ')} ${/^I/i.test(ultima) ? 'e' : 'y'} ${ultima}`;
}

// ---- geometría del anillo (SVG de 300 × 300)
const CX = 150;
const CY = 150;
const R = 108;                                                     // radio del anillo
const RN = 24;                                                     // radio de cada institución
const CORTE = 0.8;                                                 // lo que se dibuja del último eslabón si NO cierra
const HOLGURA = (Math.asin((RN + 6) / R) * 180) / Math.PI;         // grados que tapa cada institución
const rad = (g) => (g * Math.PI) / 180;
const punto = (g, r = R) => [CX + r * Math.cos(rad(g)), CY + r * Math.sin(rad(g))];
const angulo = (i, n) => -90 + (i * 360) / n;
const f2 = (x) => x.toFixed(2);

const urnaVacia = () => ({ papeletas: [], ultimoRechazo: null, votaron: new Set(), ultimo: null, ultima: null });

export default {
  montar(host, ctx, meta) {
    const L = Object.assign(ctx.local, {
      grupo: [...GRUPO_INICIAL], firmante: FIRMANTE_INICIAL,
      firmada: null,          // la carta firmada: { res, grupo, firmante }
      verif: null,            // la última comprobación: { res, contexto }
      desfasada: false,
      votante: GRUPO_INICIAL[0], opcion: 'Sí', urna: urnaVacia(),
      anims: [], temporizador: null, vuelta: null, el: null,
    });
    const id = (x) => `esq-anillo-${ctx.modo}-${x}`;
    L.id = id;

    // ------------------------------------------------------------ paso 1
    L.chips = h('div.an-chips', { role: 'group', 'aria-labelledby': `${id('p1')}-t` },
      K.IDS.map((i) => {
        const b = h('button.an-chip', { type: 'button', title: K.inst.nombre(i), 'aria-pressed': L.grupo.includes(i) ? 'true' : 'false' },
          icono('ok', { clase: 'an-chip__si' }), icono('mas', { clase: 'an-chip__no' }), h('span', sigla(i)));
        b.addEventListener('click', () => alternar(ctx, i, b));
        return b;
      }));
    L.frase1 = h('p.esq-frase', { 'aria-live': 'polite' });
    pintarFrase1(L);
    L.paso1 = K.paso({ n: 1, titulo: 'Elige el grupo', id: id('p1'),
      ayuda: 'Las instituciones entre las que te vas a esconder. No necesitas pedirles permiso: basta con sus llaves públicas, que todo el mundo conoce.' },
    L.chips, L.frase1);

    // ------------------------------------------------------------ paso 2
    L.quien = h('fieldset.an-quien');
    L.secreto = h('p.an-secreto');
    pintarQuien(ctx);
    L.paso2 = K.paso({ n: 2, titulo: '¿Quién eres tú? (es secreto)', id: id('p2'),
      ayuda: 'Elige qué institución del grupo escribe la denuncia.' },
    L.quien, L.secreto);

    // ------------------------------------------------------------ paso 3
    L.entrada = h('textarea.entrada.an-mensaje', { id: id('mensaje'), name: 'mensaje', rows: 2, spellcheck: 'false', autocomplete: 'off', value: DENUNCIA });
    L.contador = h('p.campo__ayuda', { id: id('mensaje-ayuda') });
    L.entrada.setAttribute('aria-describedby', L.contador.id);
    L.entrada.addEventListener('input', () => {
      if (/[\r\n]/.test(L.entrada.value)) L.entrada.value = L.entrada.value.replace(/[\r\n]+/g, ' ');
      pintarContador(L);
      ctx.ui.limpiarCampos(L.form);
      marcarDesfase(ctx);
    });
    // una carta de una línea: Intro firma (el servidor no acepta saltos de línea)
    L.entrada.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (L.form.requestSubmit) L.form.requestSubmit(L.botonFirmar); else firmar(ctx);
    });
    L.botonFirmar = h('button.boton.boton--primario', { type: 'submit' }, icono('firma'), h('span', 'Firmar en nombre del grupo'));
    L.form = h('form.an-form', { novalidate: true },
      h('div.campo', h('label.campo__etiqueta', { for: L.entrada.id }, 'La denuncia'), L.entrada, L.contador),
      h('div.esq-acciones', L.botonFirmar));
    L.form.addEventListener('submit', (e) => { e.preventDefault(); firmar(ctx); });
    pintarContador(L);
    L.cartaEl = h('div.an-carta', { hidden: true });
    L.paso3 = K.paso({ n: 3, titulo: 'Escribe y firma', id: id('p3'),
      ayuda: 'Cada institución tiene una llave secreta (solo ella la tiene) y una pública (la conoce todo el mundo). Tu computadora firma con tu llave secreta y con las públicas de todo el grupo, para que no se note cuál es la tuya.' },
    L.form, L.cartaEl);

    // ------------------------------------------------------------ paso 4
    L.botonComprobar = h('button.boton.boton--primario', { type: 'button', disabled: true }, icono('buscar'), h('span', 'Comprobar la firma'));
    L.botonComprobar.addEventListener('click', () => comprobar(ctx));
    L.svg = s('svg.an-anillo', { viewBox: '0 0 300 300', role: 'img', 'data-estado': 'neutro' });
    L.lectura = h('div.an-lectura', { dataset: { estado: 'listo' } });
    L.escena = h('div.an-escena', { hidden: true }, h('div.an-escena__lienzo', L.svg), L.lectura);
    L.espera4 = h('p.an-espera', 'Primero firma la carta en el paso 3.');
    L.veredicto = K.veredicto({ vacio: 'Pulsa «Comprobar la firma» para ver qué descubre el periódico.' });
    L.explica = K.explicacion();
    L.paso4 = K.paso({ n: 4, titulo: 'Lo que ve el periódico', estado: 'espera', id: id('p4'),
      ayuda: 'El periódico no sabe quién eres: solo tiene la carta y la lista del grupo. Con las llaves públicas de esas instituciones comprueba si la firma es auténtica.' },
    L.espera4, h('div.esq-acciones', L.botonComprobar), L.escena, L.veredicto, L.explica);

    // ------------------------------------------------------------ trampas
    L.trampas = K.trampas([
      { etiqueta: 'Cambiar una palabra de la denuncia', texto: 'Alguien retoca la carta antes de publicarla.', fn: (b) => trampaPalabra(ctx, b) },
      { etiqueta: 'Decir que la firmó otro grupo', texto: 'Se cambia una institución de la lista para culpar a otra.', fn: (b) => trampaGrupo(ctx, b) },
      { etiqueta: 'Firmar con alguien de fuera', texto: 'Una institución que no está en el grupo intenta firmar en su nombre.', fn: (b) => trampaFuera(ctx, b) },
    ], { titulo: 'Prueba a hacer trampa con la denuncia' });
    L.trampas.hidden = true;

    const demoA = h('section.an-demo', { 'aria-labelledby': id('a') },
      cabeceraDemo('A', id('a'), 'Denuncia anónima',
        'Una institución del consorcio descubre un título falso y quiere avisar al periódico sin delatarse.'),
      h('div.esq-pasos', [L.paso1, L.paso2, L.paso3, L.paso4].map((p) => bajarTitulo(p, '.esq-paso__titulo'))),
      bajarTitulo(L.trampas, '.esq-trampas__titulo'));

    host.append(
      K.cabecera({ numero: meta.numero, icono: meta.icono, titulo: meta.titulo, id: id('titulo'),
        metafora: 'Una carta firmada por «alguien de este grupo»: cualquiera comprueba que es auténtica, pero nadie puede saber quién la escribió.',
        historia: 'Una institución del consorcio descubre un título falso y quiere avisar sin delatarse. Y cuando el consorcio vota, nadie debe saber qué votó cada quien… pero nadie puede votar dos veces.',
        tecnico: 'firmas de anillo: AOS (Abe, Ohkubo y Suzuki, 2002) para la denuncia y LSAG enlazable (Liu, Wei y Wong, 2004) para la votación, sobre la curva secp256k1.' }),
      demoA,
      demoUrna(ctx),
      cuentas(ctx),
      saberMas(),
    );
  },

  ocultar(ctx) {
    // si se va a mitad de la vuelta, el resultado queda pintado y no queda nada corriendo
    terminarVuelta(ctx);
  },
};

// ================================================================ piezas
function cabeceraDemo(letra, idTitulo, titulo, ...lema) {
  return h('header.an-demo__cabecera',
    h('span.an-demo__letra', { 'aria-hidden': 'true' }, letra),
    h('div.an-demo__texto',
      h('h3.an-demo__titulo', { id: idTitulo }, h('span.solo-lectores', `Demostración ${letra}: `), titulo),
      h('p.an-demo__lema', ...lema)));
}

/** Dentro de cada demostración los pasos cuelgan de su título: h3 del kit → h4 (mismas clases e id). */
function bajarTitulo(raiz, selector) {
  const t = raiz.querySelector(selector);
  if (!t) return raiz;
  const nuevo = h('h4', { id: t.id || null, class: t.className });
  nuevo.append(...t.childNodes);
  t.replaceWith(nuevo);
  return raiz;
}

/** Tarjetas de institución con radios nativos (flechas del teclado gratis). La marca «Tú» la muestra el CSS. */
function opciones(nombre, ids, valor, alElegir, extra = () => null) {
  return ids.map((i) => {
    const input = h('input.an-op__radio', { type: 'radio', name: nombre, value: i, checked: i === valor });
    input.addEventListener('change', () => { if (input.checked) alElegir(i); });
    return h('label.an-op', input,
      h('span.an-op__sigla', sigla(i)),
      h('span.an-op__nombre', K.inst.nombre(i)),
      h('span.an-op__marca', icono('mascara'), 'Tú'),
      extra(i));
  });
}

// ================================================================ paso 1 · el grupo
function pintarFrase1(L, aviso = null) {
  const n = L.grupo.length;
  K.reemplazar(L.frase1, 'Quien firme se esconderá entre ', h('strong', `${n} instituciones`),
    ': desde fuera, cada una tendrá la misma probabilidad, ', h('strong', `1 de ${n} (${porcentaje(n)})`), '. ',
    aviso ? h('span.an-limite', aviso) : h('span.texto-3', `Elige entre ${MIN} y ${MAX}; cuantas más, mejor te escondes.`));
}

function alternar(ctx, idInst, boton) {
  const L = ctx.local;
  const esta = L.grupo.includes(idInst);
  if (esta && L.grupo.length <= MIN) {
    pintarFrase1(L, `Mínimo ${MIN}: con menos, esconderse casi no sirve.`);
    K.anim.sacudir(boton);
    return;
  }
  if (!esta && L.grupo.length >= MAX) {
    pintarFrase1(L, `Máximo ${MAX} en esta demostración: quita una antes de añadir otra.`);
    K.anim.sacudir(boton);
    return;
  }
  L.grupo = esta ? L.grupo.filter((x) => x !== idInst) : enOrden([...L.grupo, idInst]);
  attr(boton, 'aria-pressed', esta ? 'false' : 'true');
  if (!L.grupo.includes(L.firmante)) L.firmante = L.grupo[0];
  if (!L.grupo.includes(L.votante)) L.votante = L.grupo[0];
  pintarFrase1(L);
  pintarQuien(ctx);
  marcarDesfase(ctx);
  // la urna vota con este mismo padrón: si cambia, empieza de nuevo
  if (L.urna.papeletas.length || L.urna.ultimoRechazo) vaciarUrna(ctx, 'Cambiaste el grupo de arriba: la urna empezó de nuevo con el nuevo padrón.');
  else pintarVotantes(ctx);
}

// ================================================================ paso 2 · quién eres
function pintarQuien(ctx) {
  const L = ctx.local;
  K.reemplazar(L.quien, h('legend.solo-lectores', '¿Quién eres tú?'),
    opciones(`an-firmante-${ctx.modo}`, L.grupo, L.firmante, (i) => { L.firmante = i; pintarSecreto(L); marcarDesfase(ctx); }));
  pintarSecreto(L);
}

function pintarSecreto(L) {
  K.reemplazar(L.secreto, icono('mascara'),
    h('span', h('strong', 'Solo tú lo sabes: '), 'firmas como ', h('strong', sigla(L.firmante)), '. Este dato no va en la carta ni en la firma.'));
}

// ================================================================ paso 3 · firmar
function pintarContador(L) {
  const n = bytes(L.entrada.value);
  texto(L.contador, n > MAX_BYTES
    ? `Demasiado larga: sobran ${n - MAX_BYTES} (las letras con acento cuentan doble).`
    : `Te quedan ${MAX_BYTES - n} de ${MAX_BYTES} (las letras con acento cuentan doble).`);
  attr(L.contador, 'data-excede', n > MAX_BYTES ? '' : null);
}

function marcarDesfase(ctx) {
  const L = ctx.local;
  if (!L.firmada || L.desfasada) return;
  L.desfasada = true;
  if (L.desfaseEl) L.desfaseEl.hidden = false;
  K.marcarPaso(L.paso3, 'activo');
}

async function firmar(ctx) {
  const L = ctx.local;
  let r;
  try {
    r = await ctx.ui.ocupado(L.botonFirmar, K.post('anillo/firmar', {
      semilla: K.semilla(ctx), anillo: L.grupo, firmante: L.firmante, mensaje: L.entrada.value, variante: 'aos' }));
  } catch (e) {
    ctx.ui.mostrarError(e, { form: L.form });          // marca la denuncia si el servidor la señala
    return;
  }
  terminarVuelta(ctx, { silencioso: true });
  Object.assign(L, { firmada: { res: r, grupo: [...L.grupo], firmante: L.firmante }, verif: null, desfasada: false });
  pintarCarta(ctx);
  for (const p of [L.paso1, L.paso2, L.paso3]) K.marcarPaso(p, 'hecho');
  K.marcarPaso(L.paso4, 'activo');
  L.espera4.hidden = true;
  L.botonComprobar.disabled = false;
  L.trampas.hidden = false;
  // lo que ve el periódico antes de comprobar: el anillo, todas con «?»
  construirAnillo(ctx, r.anillo.map((a) => a.id));
  pintarLectura(ctx, null, 'listo');
  L.escena.hidden = false;
  K.pintarVeredicto(L.veredicto, null);
  K.explicar(L.explica);
  pintarCuentasAOS(ctx);
  K.narrar(ctx, 'Denuncia firmada', `Firmada en nombre de ${enumerar(r.anillo.map((a) => a.id))}. La firma no dice cuál de ellas la escribió.`, 'info');
}

function pintarCarta(ctx) {
  const L = ctx.local;
  const { res } = L.firmada;
  L.desfaseEl = h('p.an-carta__desfase', { hidden: true }, icono('alerta'),
    h('span', 'Cambiaste algo arriba. Esta es la carta que ya firmaste: pulsa «Firmar» otra vez para escribir una nueva.'));
  K.reemplazar(L.cartaEl,
    h('p.etiqueta-instrumento', 'La carta que recibe el periódico'),
    h('blockquote.an-carta__texto', res.mensaje),
    h('div.an-carta__firma',
      h('span', 'Firmada por: alguien de'),
      h('ul.an-carta__grupo', { role: 'list' }, res.anillo.map((a) => h('li', sigla(a.id))))),
    h('div.an-carta__sello',
      K.ruido(res.firma.c0 + res.firma.r.join(''), { barras: 40 }),
      h('span.an-carta__bytes', `firma · ${res.tamano_bytes} bytes`)),
    h('p.an-carta__nota', icono('info'),
      h('span', 'No dice quién la firmó. Y si vuelves a firmar, la firma sale distinta: cada vez lleva un número al azar nuevo.')),
    L.desfaseEl);
  L.cartaEl.hidden = false;
  K.anim.entrar(L.cartaEl);
}

// ================================================================ paso 4 · comprobar
async function comprobar(ctx, boton = ctx.local.botonComprobar, contexto = { tipo: 'normal' }) {
  const L = ctx.local;
  const f = L.firmada;
  if (!f) return null;
  const res = await K.accion(ctx, boton, K.post('anillo/verificar', {
    semilla: K.semilla(ctx), anillo: contexto.grupo || f.grupo, mensaje: contexto.mensaje ?? f.res.mensaje, firma: f.res.firma }));
  if (!res) return null;
  L.verif = { res, contexto };
  darVuelta(ctx, res, contexto);
  pintarCuentasAOS(ctx);
  return res;
}

/** Dibuja el anillo (orden canónico del servidor) en reposo: todas las instituciones iguales, con «?». */
function construirAnillo(ctx, ids, { cambiada = null, fuera = null } = {}) {
  const L = ctx.local;
  const n = ids.length;
  const tramo = 360 / n;
  const arcos = [];
  const luces = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = punto(angulo(i, n) + HOLGURA);
    const [x1, y1] = punto(angulo(i, n) + tramo - HOLGURA);
    const d = `M${f2(x0)} ${f2(y0)}A${R} ${R} 0 0 1 ${f2(x1)} ${f2(y1)}`;
    arcos.push(s('path.an-arco', { d }));
    luces.push(s(i === n - 1 ? 'path.an-luz.an-luz--cierre' : 'path.an-luz', { d, pathLength: 1 }));
  }
  const halos = [];
  const nodos = ids.map((idInst, i) => {
    const [x, y] = punto(angulo(i, n));
    const halo = s('circle.an-nodo__halo', { cx: f2(x), cy: f2(y), r: RN + 2 });
    halos.push(halo);
    return s('g.an-nodo', { 'data-cambiada': idInst === cambiada ? 'si' : null },
      halo,
      s('circle.an-nodo__circulo', { cx: f2(x), cy: f2(y), r: RN }),
      s('text.an-nodo__sigla', { x: f2(x), y: f2(y), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, sigla(idInst)),
      s('circle.an-nodo__duda', { cx: f2(x + 17), cy: f2(y - 17), r: 8 }),
      s('text.an-nodo__duda-txt', { x: f2(x + 17), y: f2(y - 17), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, '?'));
  });
  // el destello: lo mueve la animación (CSS transform en unidades del SVG); en reposo está oculto
  const destello = s('g.an-destello', s('circle.an-destello__halo', { r: 10 }), s('circle.an-destello__nucleo', { r: 4.5 }));
  const [xs, ys] = punto(-90);
  destello.style.transform = `translate(${f2(xs)}px, ${f2(ys)}px)`;
  // la «X» del hueco que queda cuando la vuelta no cierra
  const [xx, yx] = punto(angulo(n - 1, n) + HOLGURA + ((1 + CORTE) / 2) * (tramo - 2 * HOLGURA));
  const x = s('g.an-x', s('circle.an-x__fondo', { r: 8.5 }), s('path.an-x__trazo', { d: 'M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5' }));
  const extra = fuera ? s('g.an-fuera',
    s('text.an-fuera__etq', { x: 272, y: 243, 'text-anchor': 'middle' }, 'fuera'),
    s('circle.an-fuera__circulo', { cx: 272, cy: 272, r: 20 }),
    s('text.an-nodo__sigla', { x: 272, y: 272, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, sigla(fuera))) : null;
  const grande = s('text.an-centro__grande', { x: CX, y: CY - 6, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, '¿Quién?');
  const chico = s('text.an-centro__chico', { x: CX, y: CY + 20, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, `${n} posibles`);
  K.reemplazar(L.svg,
    s('g.an-arcos', arcos), s('g.an-luces', luces), destello, s('g.an-nodos', nodos),
    s('g', { transform: `translate(${f2(xx)} ${f2(yx)})` }, x), extra, grande, chico);
  attr(L.svg, 'data-estado', 'neutro');
  attr(L.svg, 'data-resultado', null);
  attr(L.svg, 'aria-label', `${describir(ids)} Todas se ven igual, con un signo de interrogación: no se sabe cuál firmó.`);
  L.el = { n, luces, halos, destello, x, grande, chico };
}

const describir = (ids) => `Anillo de ${ids.length} instituciones: ${enumerar(ids)}.`;

/**
 * El momento de esta pantalla: un destello da la vuelta al anillo, eslabón por eslabón (traza del
 * servidor), y regresa a la salida. El estado final vive en el CSS (data-estado); esto solo interpola.
 * Movimiento reducido: sin vuelta, el resultado aparece con un fundido.
 */
function darVuelta(ctx, res, contexto) {
  const L = ctx.local;
  terminarVuelta(ctx, { silencioso: true });
  construirAnillo(ctx, res.anillo.map((a) => a.id), { cambiada: contexto.cambiada });
  L.escena.hidden = false;
  attr(L.svg, 'data-resultado', res.valida ? 'cierra' : 'abierta');
  L.vuelta = { res, contexto };
  const E = L.el;
  const n = E.n;
  if (K.anim.reducido() || !res.traza?.length || typeof L.svg.animate !== 'function') {
    terminarVuelta(ctx);
    K.anim.animar(L.svg, [{ opacity: 0.4 }, { opacity: 1 }], { duration: K.anim.DUR.entrada });
    return;
  }
  attr(L.svg, 'data-estado', 'recorriendo');
  texto(E.grande, '…');
  texto(E.chico, 'dando la vuelta');
  pintarLectura(ctx, null, 'recorriendo');
  const t = Math.round(Math.min(220, Math.max(120, 1000 / n)));      // ms por eslabón (≈1 s la vuelta)
  const fr = HOLGURA / (360 / n);                                      // parte del eslabón que tapa cada nodo
  const util = t * (1 - 2 * fr);                                       // ms del destello sobre el arco visible
  const anims = [];
  E.luces.forEach((luz, i) => {
    const largo = i === n - 1 && !res.valida ? CORTE : 1;
    anims.push(luz.animate([{ strokeDashoffset: largo }, { strokeDashoffset: 0 }],
      { duration: util * largo, delay: t * i + t * fr, easing: 'linear', fill: 'backwards' }));
  });
  E.halos.forEach((halo, i) => {
    anims.push(halo.animate([{ opacity: 0.85, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.5)' }],
      { duration: 420, delay: t * i, easing: K.anim.CURVA.func }));
  });
  const total = res.valida ? t * n : t * (n - 1) + t * fr + util * CORTE;
  const giro = (360 * total) / (t * n);
  const pasos = Math.max(2, Math.ceil(giro / 6));
  const cuadros = Array.from({ length: pasos + 1 }, (_, k) => {
    const [x, y] = punto(-90 + (giro * k) / pasos);
    return { transform: `translate(${f2(x)}px, ${f2(y)}px)` };
  });
  anims.push(E.destello.animate(cuadros, { duration: total, easing: 'linear', fill: 'both' }));
  L.anims = anims;
  // temporizador (no `finished`): también termina con la pestaña en segundo plano
  L.temporizador = setTimeout(() => terminarVuelta(ctx), total + 60);
}

function terminarVuelta(ctx, { silencioso = false } = {}) {
  const L = ctx.local;
  clearTimeout(L.temporizador);
  L.temporizador = null;
  for (const a of L.anims) a.cancel();
  L.anims = [];
  const v = L.vuelta;
  L.vuelta = null;
  if (v && !silencioso) pintarResultado(ctx, v.res, v.contexto);
}

function pintarLectura(ctx, res, modo = 'final') {
  const L = ctx.local;
  const nota = h('p.an-lectura__nota', 'El anillo va en un orden fijo (según las llaves), no en el que elegiste: así el orden no da pistas.');
  if (modo === 'fuera') {
    attr(L.lectura, 'data-estado', 'abierta');
    K.reemplazar(L.lectura,
      h('p.an-lectura__aviso', icono('x'), h('span', 'No hay firma que comprobar: sin la llave secreta de alguien del grupo, la vuelta no se puede cerrar.')),
      nota);
    return;
  }
  const estado = modo === 'final' ? (res.valida ? 'cierra' : 'abierta') : modo;
  attr(L.lectura, 'data-estado', estado);
  const llegada = modo === 'final' ? (res.c_final ? K.corto(res.c_final, 6) : '—') : modo === 'recorriendo' ? '…' : '?';
  const [signo, frase] = {
    listo: ['?', 'Pulsa «Comprobar la firma»: el periódico dará la vuelta al anillo.'],
    recorriendo: ['…', 'Dando la vuelta…'],
    cierra: ['=', 'Iguales: la vuelta cierra.'],
    abierta: ['≠', 'Distintos: la vuelta no cierra.'],
  }[estado];
  K.reemplazar(L.lectura,
    h('div.an-numero',
      h('span.an-numero__etq', 'Número de salida · viene en la firma'),
      h('span.an-numero__valor', K.corto(L.firmada?.res.firma.c0, 6))),
    h('div.an-numero.an-numero--llegada',
      h('span.an-numero__etq', 'Número de llegada · tras dar la vuelta'),
      h('span.an-numero__valor', llegada)),
    h('p.an-comparacion', h('span.an-comparacion__signo', { 'aria-hidden': 'true' }, signo), h('span', frase)),
    nota);
}

function pintarResultado(ctx, res, contexto) {
  const L = ctx.local;
  const E = L.el;
  const ids = res.anillo.map((a) => a.id);
  const n = ids.length;
  attr(L.svg, 'data-estado', res.valida ? 'cierra' : 'abierta');
  texto(E.grande, res.valida ? `1 de ${n}` : 'No cierra');
  texto(E.chico, res.valida ? `${porcentaje(n)} cada una` : 'firma rechazada');
  attr(L.svg, 'aria-label', `${describir(ids)} ${res.valida
    ? `La vuelta cierra: la firma es auténtica. Todas se ven igual: 1 de ${n}.`
    : 'La vuelta no cierra: la firma se rechaza.'}`);
  pintarLectura(ctx, res);
  // acuse: la salida se enciende (cierra) o aparece la X en el hueco (no cierra)
  if (res.valida) {
    K.anim.animar(E.halos[0], [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2)' }],
      { duration: K.anim.DUR.escena, easing: K.anim.CURVA.func }, { reducido: false });
  } else {
    K.anim.animar(E.x, [{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'none' }],
      { duration: K.anim.DUR.entrada, easing: K.anim.CURVA.acuse });
  }

  if (contexto.tipo === 'palabra') {
    K.pintarVeredicto(L.veredicto, { estado: res.valida ? 'aviso' : 'mal',
      titulo: res.valida ? 'La firma sigue valiendo (no cambió nada)' : 'Firma rechazada: la vuelta no cierra',
      texto: 'Alguien cambió la carta después de firmarla. El periódico la descarta:',
      extra: h('dl.an-cambio',
        h('div', h('dt', 'Se firmó'), h('dd', h('q', contexto.original))),
        h('div', h('dt', 'Llegó'), h('dd', h('q', contexto.mensaje)))) });
    K.explicar(L.explica,
      'La carta entra en cada eslabón de la cadena. Con una sola palabra distinta cambian todos los números, y al final de la vuelta ya no sale el número de salida.',
      'Para cambiar la carta habría que volver a firmarla… y para eso hace falta una llave secreta del grupo.');
    K.narrar(ctx, 'Carta alterada', 'Cambió una palabra: la vuelta ya no cierra y el periódico rechaza la firma.', 'error');
  } else if (contexto.tipo === 'grupo') {
    K.pintarVeredicto(L.veredicto, { estado: res.valida ? 'aviso' : 'mal', titulo: 'Firma rechazada: no es de este grupo',
      texto: `Se cambió ${sigla(contexto.sale)} por ${sigla(contexto.entra)} en la lista. Con ese grupo la vuelta no cierra.` });
    K.explicar(L.explica,
      'La lista completa del grupo también entra en cada eslabón: la firma queda atada a ese grupo exacto.',
      'Así nadie puede presentarla como si la hubiera firmado otro grupo, ni culpar a quien no estaba.');
    K.narrar(ctx, 'Grupo cambiado', `Con ${sigla(contexto.entra)} en lugar de ${sigla(contexto.sale)}, la vuelta no cierra: la firma no es de ese grupo.`, 'error');
  } else if (res.valida) {
    K.pintarVeredicto(L.veredicto, { estado: 'ok', titulo: `Firma auténtica: la escribió alguien de estas ${n}`,
      texto: `¿Quién? Cualquiera de ellas: 1 de ${n} (${porcentaje(n)}). Ni el periódico ni nadie puede saber más.` });
    K.explicar(L.explica,
      h('p', 'Esta ', ctx.ui.termino('firma_anillo', 'firma de anillo'), ' es una cadena de números que da la vuelta al grupo: cada institución, con su llave pública, convierte un número en el siguiente. Al terminar salió ',
        h('strong', 'el mismo número con el que empezó'), ': la vuelta cierra.'),
      h('p', `Solo con la llave secreta de una de las ${n} se logra que cierre, y todos los eslabones se ven igual de aleatorios. Tú sabes quién fue (`,
        h('strong', sigla(L.firmada.firmante)), `); el periódico solo sabe «1 de ${n}».`));
    K.marcarPaso(L.paso4, 'hecho');
    K.narrar(ctx, 'Firma auténtica', `La escribió alguien de ${enumerar(ids)}. Nadie puede saber quién: 1 de ${n}.`, 'ok');
  } else {
    K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: 'La vuelta no cierra', texto: res.motivo });
    K.explicar(L.explica);
  }
}

// ================================================================ trampas
function alterar(m) {
  let a = /falso/i.test(m) ? m.replace(/falso/i, 'auténtico')
    : /\d/.test(m) ? m.replace(/\d(?=\D*$)/, (d) => String((Number(d) + 1) % 10))
      : `${m.replace(/[.!]?\s*$/, '')}, o tal vez no.`;
  if (a === m || bytes(a) > MAX_BYTES) a = m.slice(0, -1) + (m.endsWith('.') ? '!' : '.');
  return a;
}

function enfocarEscena(L) {
  L.escena.scrollIntoView({ block: 'nearest', behavior: K.anim.reducido() ? 'auto' : 'smooth' });
}

async function trampaPalabra(ctx, boton) {
  const L = ctx.local;
  const f = L.firmada;
  if (!f) return;
  const original = f.res.mensaje;
  if (await comprobar(ctx, boton, { tipo: 'palabra', mensaje: alterar(original), original })) enfocarEscena(L);
}

async function trampaGrupo(ctx, boton) {
  const L = ctx.local;
  const f = L.firmada;
  if (!f) return;
  const sale = [...f.grupo].reverse().find((i) => i !== f.firmante);     // nunca quien firmó: se culpa a otra
  const entra = K.IDS.find((i) => !f.grupo.includes(i));
  const grupo = f.grupo.map((i) => (i === sale ? entra : i));
  if (await comprobar(ctx, boton, { tipo: 'grupo', grupo, sale, entra, cambiada: entra })) enfocarEscena(L);
}

async function trampaFuera(ctx, boton) {
  const L = ctx.local;
  const f = L.firmada;
  if (!f) return;
  const fuera = K.IDS.find((i) => !f.grupo.includes(i));
  try {
    await ctx.ui.ocupado(boton, K.post('anillo/firmar', {
      semilla: K.semilla(ctx), anillo: f.grupo, firmante: fuera, mensaje: f.res.mensaje, variante: 'aos' }));
  } catch (e) {
    // el rechazo del servidor ES la lección; cualquier otro error se muestra como tal
    if (e?.codigo !== 'firmante_fuera') { ctx.ui.mostrarError(e, { titulo: 'No se pudo completar' }); return; }
    terminarVuelta(ctx, { silencioso: true });
    const ids = f.res.anillo.map((a) => a.id);
    construirAnillo(ctx, ids, { fuera });
    texto(L.el.grande, 'Sin firma');
    texto(L.el.chico, `${sigla(fuera)} queda fuera`);
    attr(L.svg, 'aria-label', `${describir(ids)} ${sigla(fuera)} está fuera del anillo: no pudo firmar.`);
    pintarLectura(ctx, null, 'fuera');
    L.escena.hidden = false;
    K.pintarVeredicto(L.veredicto, { estado: 'aviso', titulo: `No se pudo firmar: ${sigla(fuera)} no está en el grupo`, texto: e.message });
    K.explicar(L.explica,
      h('p', 'Para que la vuelta cierre hace falta la llave secreta de ', h('strong', 'alguien del grupo'),
        `. ${sigla(fuera)} tiene la suya, pero esa llave no cierra este anillo: sin ella no hay firma posible.`),
      `${sigla(fuera)} podría firmar con otro grupo que la incluya… pero entonces su nombre aparecería en la lista de la carta, a la vista de todos.`);
    K.narrar(ctx, 'Firma imposible', `${sigla(fuera)} no está en el grupo: sin una llave secreta del grupo, la vuelta no se puede cerrar.`, 'aviso');
    enfocarEscena(L);
  }
}

// ================================================================ B · la urna
function demoUrna(ctx) {
  const L = ctx.local;
  const id = L.id;
  L.votantes = h('fieldset.an-quien.an-quien--voto');
  L.segOpcion = K.segmentado({ nombre: 'voto', etiqueta: 'Su voto', valor: L.opcion,
    opciones: [{ valor: 'Sí' }, { valor: 'No' }], alCambiar: (v) => { L.opcion = v; } });
  L.botonVotar = h('button.boton.boton--primario', { type: 'button' }, icono('voto'), h('span', 'Depositar voto'));
  L.botonRepetir = h('button.boton.boton--secundario', { type: 'button', disabled: true }, icono('mascara'), h('span', 'Intentar votar otra vez'));
  L.botonVaciar = h('button.boton.boton--fantasma.boton--chico', { type: 'button', disabled: true }, icono('reiniciar'), h('span', 'Vaciar urna'));
  L.botonVotar.addEventListener('click', () => votar(ctx));
  L.botonRepetir.addEventListener('click', () => votarOtraVez(ctx));
  L.botonVaciar.addEventListener('click', () => { vaciarUrna(ctx, 'La urna está vacía otra vez.'); L.botonVotar.focus(); });
  L.recuento = h('div.an-recuento');
  L.papeletas = h('ol.an-papeletas', { role: 'list', 'aria-label': 'Votos en la urna' });
  L.urnaAviso = h('p.an-urna__aviso', { role: 'status' });
  L.veredictoUrna = K.veredicto({ vacio: 'Deposita un voto para ver qué hace la urna.' });
  L.explicaUrna = K.explicacion();
  pintarVotantes(ctx);
  pintarUrna(ctx);
  return h('section.an-demo', { 'aria-labelledby': id('b') },
    cabeceraDemo('B', id('b'), 'Votación anónima: una institución, un voto',
      'El consorcio vota una propuesta con el mismo grupo de arriba. Nadie debe saber qué votó cada institución… pero ninguna puede votar dos veces. Para eso cada voto lleva un ',
      ctx.ui.termino('imagen_clave', 'folio anónimo'), ': siempre el mismo para la misma institución, pero no dice cuál es.'),
    h('div.an-urna',
      h('div.an-urna__lado.an-urna__lado--secreto',
        h('p.an-rotulo', icono('mascara'), h('span', 'En secreto · solo lo ves tú')),
        h('div.an-pregunta', h('span.etiqueta-instrumento', 'Consulta del consorcio'), h('p', PREGUNTA)),
        L.votantes,
        h('div.an-campo', h('span.an-leyenda', 'Su voto'), L.segOpcion),
        h('div.esq-acciones', L.botonVotar, L.botonRepetir)),
      h('div.an-urna__lado.an-urna__lado--publico',
        h('p.an-rotulo', icono('voto'), h('span', 'La urna · lo ve todo el mundo')),
        L.recuento, L.papeletas, L.urnaAviso,
        h('div.an-urna__pie', L.botonVaciar))),
    L.veredictoUrna, L.explicaUrna);
}

function pintarVotantes(ctx) {
  const L = ctx.local;
  K.reemplazar(L.votantes, h('legend.an-leyenda', '¿Quién vota?'),
    opciones(`an-votante-${ctx.modo}`, L.grupo, L.votante, (i) => { L.votante = i; },
      (i) => (L.urna.votaron.has(i) ? h('span.an-op__ya', icono('ok'), 'ya votó') : null)));
}

function siguienteVotante(L, actual) {
  const g = L.grupo;
  const i = g.indexOf(actual);
  for (let k = 1; k <= g.length; k++) {
    const c = g[(i + k) % g.length];
    if (!L.urna.votaron.has(c)) return c;
  }
  return actual;
}

async function votar(ctx, boton = ctx.local.botonVotar, { votante = ctx.local.votante, opcion = ctx.local.opcion } = {}) {
  const L = ctx.local;
  const grupo = [...L.grupo];
  const mensaje = `${PREGUNTA} · Voto: ${opcion}`;
  const previas = L.urna.papeletas.map((p) => p.imagen);
  const semilla = K.semilla(ctx);
  const r = await K.accion(ctx, boton, (async () => {
    const f = await K.post('anillo/firmar', { semilla, anillo: grupo, firmante: votante, mensaje, variante: 'lsag' });
    const res = await K.post('anillo/urna', { semilla, anillo: grupo, mensaje, firma: f.firma, imagenes_previas: previas });
    return { f, res };
  })());
  if (!r || grupo.join() !== L.grupo.join()) return;           // falló, o el padrón cambió mientras tanto
  const { f, res } = r;
  const U = L.urna;
  U.ultima = { f, res, opcion, previas: previas.length };
  texto(L.urnaAviso, '');
  let nuevo;
  if (res.aceptada) {
    U.papeletas.push({ n: U.papeletas.length + 1, opcion, imagen: res.imagen });
    U.votaron.add(votante);
    U.ultimo = { votante, opcion };
    U.ultimoRechazo = null;
    L.votante = siguienteVotante(L, votante);                 // pulsar otra vez = vota la siguiente
    nuevo = 'aceptada';
  } else {
    const igual = U.papeletas.find((p) => p.imagen === res.imagen);
    U.ultimoRechazo = { opcion, imagen: res.imagen, igualA: igual ? igual.n : null };
    nuevo = 'rechazada';
  }
  pintarVotantes(ctx);
  pintarUrna(ctx, nuevo);
  pintarVeredictoUrna(ctx, res, votante);
  pintarCuentasLSAG(ctx);
}

async function votarOtraVez(ctx) {
  const L = ctx.local;
  const u = L.urna.ultimo;
  if (!u) return;
  const opcion = u.opcion === 'Sí' ? 'No' : 'Sí';            // y además cambia de opinión: da igual
  Object.assign(L, { votante: u.votante, opcion });
  L.segOpcion.fijar(opcion);
  pintarVotantes(ctx);
  await votar(ctx, L.botonRepetir, { votante: u.votante, opcion });
}

function folio(ctx, imagen) {
  const tono = ctx.fmt?.tonoHash ? ctx.fmt.tonoHash(imagen) : 255;
  return h('span.an-folio', { style: { '--tono': tono } },
    h('span.an-folio__punto', { 'aria-hidden': 'true' }),
    h('span.an-folio__etq', 'folio'),
    h('code.an-folio__hex', K.corto(imagen, 4)));
}

function pintarUrna(ctx, nuevo = null) {
  const L = ctx.local;
  const U = L.urna;
  const si = U.papeletas.filter((p) => p.opcion === 'Sí').length;
  const no = U.papeletas.length - si;
  K.reemplazar(L.recuento,
    h('p.an-recuento__cifra', h('span.an-recuento__num', String(si)), h('span.an-recuento__etq', 'Sí')),
    h('div.an-recuento__barra', { 'aria-hidden': 'true', style: { '--si': si, '--no': no } },
      h('span.an-recuento__si'), h('span.an-recuento__no')),
    h('p.an-recuento__cifra', h('span.an-recuento__num', String(no)), h('span.an-recuento__etq', 'No')));
  const filas = U.papeletas.map((p) => h('li.an-papeleta', { dataset: { estado: 'aceptada', n: p.n } },
    h('span.an-papeleta__num', `Voto ${p.n}`), h('span.an-papeleta__opcion', p.opcion), folio(ctx, p.imagen)));
  if (U.ultimoRechazo) {
    const r = U.ultimoRechazo;
    filas.push(h('li.an-papeleta', { dataset: { estado: 'rechazada' } },
      h('span.an-papeleta__num', 'Rechazado'), h('span.an-papeleta__opcion', r.opcion), folio(ctx, r.imagen),
      h('span.an-papeleta__nota', r.igualA ? `Mismo folio que el voto ${r.igualA}: esa institución ya votó.` : 'La firma no es del padrón.')));
  }
  K.reemplazar(L.papeletas, filas.length ? filas : h('li.an-papeletas__vacia', 'La urna está vacía.'));
  L.botonRepetir.disabled = !U.ultimo;
  L.botonVaciar.disabled = !U.papeletas.length && !U.ultimoRechazo;
  if (nuevo === 'aceptada') K.anim.entrar(L.papeletas.querySelector(`[data-n="${U.papeletas.length}"]`));
  if (nuevo === 'rechazada') {
    K.anim.sacudir(L.papeletas.querySelector('[data-estado="rechazada"]'));
    const igual = U.ultimoRechazo.igualA && L.papeletas.querySelector(`[data-n="${U.ultimoRechazo.igualA}"]`);
    if (igual) K.anim.destello(igual, 'var(--rechazado)');
  }
}

function pintarVeredictoUrna(ctx, res, votante) {
  const L = ctx.local;
  const U = L.urna;
  const n = res.anillo.length;
  if (res.aceptada) {
    const p = U.papeletas[U.papeletas.length - 1];
    K.pintarVeredicto(L.veredictoUrna, { estado: 'ok', titulo: `Voto ${p.n} aceptado: «${p.opcion}»`,
      texto: `Lo emitió alguien del padrón (1 de ${n}) y su folio anónimo es nuevo, así que cuenta. Nadie sabe de quién es.` });
    K.explicar(L.explicaUrna,
      h('p', 'El voto es una firma de anillo con un extra: el folio anónimo. Sale de la llave secreta de quien vota, así que ',
        h('strong', 'la misma institución produce siempre el mismo folio'), ', pero el folio no dice cuál es.'),
      U.votaron.size < n
        ? `Ya elegimos a la siguiente institución para que sigas votando. Prueba también a elegir otra vez ${sigla(votante)}, o pulsa «Intentar votar otra vez».`
        : `Ya votaron las ${n}. Pulsa «Intentar votar otra vez» para ver qué pasa si una repite.`);
    K.narrar(ctx, `Voto ${p.n} aceptado`, `Un voto «${p.opcion}» de alguien del padrón. Su folio anónimo es nuevo.`, 'ok');
  } else if (res.repetida) {
    const r = U.ultimoRechazo;
    K.pintarVeredicto(L.veredictoUrna, { estado: 'mal', titulo: 'Rechazado: ese folio anónimo ya votó',
      texto: `La firma es auténtica, pero su folio es igual al del voto ${r.igualA}. Alguien intentó votar dos veces… y la urna sigue sin saber quién.` });
    K.explicar(L.explicaUrna,
      'El folio no depende del voto: vote «Sí» o «No», la misma institución produce el mismo folio. Así la urna atrapa el segundo voto sin saber de quién es.',
      'Es lo mismo que hace Monero para que nadie gaste dos veces la misma moneda.');
    K.narrar(ctx, 'Voto repetido rechazado', `El folio anónimo coincide con el del voto ${r.igualA}. Nadie sabe de qué institución es.`, 'error');
  } else {
    K.pintarVeredicto(L.veredictoUrna, { estado: 'mal', titulo: 'Voto rechazado: la firma no es del padrón', texto: res.motivo });
    K.explicar(L.explicaUrna);
  }
}

function vaciarUrna(ctx, aviso) {
  const L = ctx.local;
  L.urna = urnaVacia();
  pintarVotantes(ctx);
  pintarUrna(ctx);
  K.pintarVeredicto(L.veredictoUrna, null);
  K.explicar(L.explicaUrna);
  pintarCuentasLSAG(ctx);
  texto(L.urnaAviso, aviso);
}

// ================================================================ cuentas
function cuentas(ctx) {
  const L = ctx.local;
  L.cuentasAOS = h('div.an-real', h('p.texto-3', 'Firma la denuncia de arriba: aquí aparecerán sus números de verdad.'));
  L.cuentasLSAG = h('div.an-real');
  pintarCuentasLSAG(ctx);
  return K.cuentas('Ver las cuentas',
    h('p', 'Cada institución tiene una llave secreta ', h('code', 'x'), ' (un número de 256 bits) y una pública ', h('code', 'Y = x·G'),
      ', un punto de la curva secp256k1 (la de Bitcoin). El grupo es la lista ', h('code', 'L = (Y₀, …, Yₙ₋₁)'),
      '. La firma AOS es ', h('code', 'σ = (c₀; r₀, …, rₙ₋₁)'), ': el número de salida y una respuesta por miembro.'),
    h('p', 'Comprobar es dar la vuelta (algoritmo 3 del documento):'),
    h('p.esq-cuenta', 'c ← c₀\npara i = 0, 1, …, n − 1:\n    Rᵢ = rᵢ·G + c·Yᵢ\n    c  ← Hs("AOS" ‖ L ‖ m ‖ Rᵢ)\nválida  ⇔  c = c₀          (la vuelta cierra)'),
    h('p', 'Quien firma, en la posición s, elige al azar un número ', h('code', 'a'), ' y las respuestas de los demás; al final cierra el anillo con su llave: ',
      h('code', 'rₛ = a − cₛ·xₛ (mod ℓ)'), '. Al comprobar, en su eslabón sale ', h('code', 'Rₛ = rₛ·G + cₛ·Yₛ = a·G'),
      ', el mismo punto con el que empezó la cadena. Como ', h('code', 'a'), ' es aleatorio, ', h('code', 'rₛ'),
      ' se ve tan al azar como las demás respuestas: ningún eslabón delata al firmante. Sin una ', h('code', 'x'),
      ' del grupo, cerrar la vuelta exigiría adivinar la salida de Hs.'),
    h('h4.an-subtitulo', 'La denuncia de arriba'),
    L.cuentasAOS,
    h('h4.an-subtitulo', 'La urna: el folio anónimo (LSAG)'),
    h('p', 'Cada voto publica además la imagen de clave ', h('code', 'I = xₛ·Hp(Yₛ)'),
      ' (Hp convierte una llave pública en otro punto de la curva) y cada eslabón comprueba dos ecuaciones con la misma respuesta: ',
      h('code', 'Rᵢ = rᵢ·G + cᵢ·Yᵢ'), ' y ', h('code', 'Vᵢ = rᵢ·Hp(Yᵢ) + cᵢ·I'),
      '. I no depende del mensaje ni del grupo: la misma llave da siempre la misma I. Saber a qué Yᵢ corresponde exigiría resolver un problema tipo Diffie–Hellman que se considera difícil.'),
    L.cuentasLSAG,
    h('h4.an-subtitulo', 'Tamaño y orden'),
    h('p', 'Con escalares de 32 bytes, la firma AOS ocupa ', h('strong', '32(n + 1) bytes'),
      ' y la LSAG 33 más: la imagen de clave es un punto comprimido de secp256k1 (en Ed25519, la curva del documento, ocupa 32 y el total queda en 32(n + 2)). Crece en línea recta con el grupo: más escondite, firma más grande.'),
    tablaTamanos(),
    h('p', 'El servidor ordena el grupo por la codificación de cada llave pública (orden canónico): así quien firma y quien comprueba recorren exactamente la misma lista L, que entra completa en cada Hs junto con el mensaje. Por eso cambiar un miembro o una palabra rompe la vuelta, y el orden en que alguien eligió el grupo no deja pistas.'),
    h('p.texto-3', 'Hs es SHA-512 con separación de dominio («TituloSeguro/anillo/AOS/v1»), codificación con prefijo de longitud y reducción de 64 bytes módulo ℓ (etapa 3 del documento). En esta simulación las llaves secretas viven en el servidor, que hace de «computadora de cada institución»: por eso el navegador le dice quién firma. La firma que devuelve no lo dice.'));
}

function tablaTamanos() {
  return h('div.tabla-marco', h('table.tabla.an-tabla',
    h('thead', h('tr', h('th', 'Grupo ', h('span.an-formula', '(n)')), h('th.num', 'AOS'), h('th.num', 'LSAG'), h('th.num', 'Probabilidad de cada una'))),
    h('tbody', [3, 4, 5, 6, 7, 8, 16].map((n) => h('tr',
      h('td', String(n)), h('td.num', `${32 * (n + 1)} B`), h('td.num', `${32 * (n + 1) + 33} B`), h('td.num', porcentaje(n)))))));
}

function pintarCuentasAOS(ctx) {
  const L = ctx.local;
  const f = L.firmada;
  if (!f) return;
  const { firma, anillo, tamano_bytes: tam } = f.res;
  const n = anillo.length;
  const partes = [K.renglones([
    ['Grupo L (orden canónico)', anillo.map((a) => sigla(a.id)).join(' → ')],
    ['c₀ (número de salida)', K.corto(firma.c0, 10)],
    ...firma.r.map((r, i) => [`r${sub(i)} · ${sigla(anillo[i].id)}`, K.corto(r, 10)]),
    ['Tamaño de la firma', `${tam} bytes = 32 × (${n} + 1)`],
  ])];
  const v = L.verif;
  if (v) {
    const como = { palabra: ' (con la carta alterada)', grupo: ' (con el grupo cambiado)' }[v.contexto.tipo] || '';
    const tr = v.res.traza;
    partes.push(h('p', `Última comprobación${como}: el reto cᵢ que entra en cada eslabón y el punto Rᵢ que sale de él.`));
    partes.push(h('div.tabla-marco', h('table.tabla.an-tabla',
      h('thead', h('tr', h('th.an-formula', 'i'), h('th', 'Institución'), h('th.an-formula', 'cᵢ (entra)'), h('th.an-formula', 'Rᵢ = rᵢ·G + cᵢ·Yᵢ (sale)'))),
      h('tbody', tr.map((t, i) => h('tr',
        h('td', String(i)), h('td', sigla(t.id)), h('td.mono', K.corto(t.c, 6)), h('td.mono', t.R ? K.corto(t.R, 6) : '—')))),
      h('tfoot', h('tr',
        h('td', String(tr.length)), h('td', 'llegada'), h('td.mono', v.res.c_final ? K.corto(v.res.c_final, 6) : '—'),
        h('td', v.res.valida ? '= c₀ ✓ la vuelta cierra' : '≠ c₀ ✗ la vuelta no cierra'))))));
  }
  K.reemplazar(L.cuentasAOS, ...partes);
}

function pintarCuentasLSAG(ctx) {
  const L = ctx.local;
  const u = L.urna.ultima;
  if (!u) {
    K.reemplazar(L.cuentasLSAG, h('p.texto-3', 'Deposita un voto en la urna: aquí aparecerán sus números.'));
    return;
  }
  const n = u.f.anillo.length;
  K.reemplazar(L.cuentasLSAG, K.renglones([
    ['Último voto', `«${u.opcion}» · ${u.res.aceptada ? 'aceptado' : 'rechazado'}`],
    ['I (folio anónimo)', K.corto(u.res.imagen, 12)],
    ['c₀', K.corto(u.f.firma.c0, 10)],
    ['Tamaño de la firma', `${u.f.tamano_bytes} bytes = 32 × (${n} + 1) + 33`],
    ['Folios que ya había en la urna', String(u.previas)],
    ['¿Folio repetido?', u.res.repetida ? 'sí: se rechaza' : 'no'],
  ]));
}

// ================================================================ para saber más
function saberMas() {
  return K.saberMas(
    h('ul',
      h('li', h('strong', 'Monero: '), 'cada pago se firma con un anillo que mezcla la moneda real con 15 señuelos tomados de la cadena (16 en total desde 2022, con la variante CLSAG). Los dueños de los señuelos ni se enteran. La imagen de clave impide gastar dos veces la misma moneda: los nodos guardan todas las usadas y rechazan cualquier repetición, como la urna de arriba. Su sucesor, FCMP++, esconderá cada pago entre todas las monedas (en red de pruebas desde octubre de 2026).'),
      h('li', h('strong', 'Filtrar información: '), 'el caso que dio origen a la idea («How to Leak a Secret», Rivest, Shamir y Tauman, 2001): alguien de un gabinete demuestra a un periodista que la información viene de dentro, sin identificarse. Es la denuncia de arriba.'),
      h('li', h('strong', 'Autenticación negable: '), 'con un anillo de dos llaves (quien escribe y quien recibe), quien recibe sabe quién escribió —él no fue—, pero no puede probarlo ante nadie: él mismo pudo haber hecho la firma.'),
      h('li', h('strong', 'Otros usos posibles: '), 'votación electrónica y evaluación docente anónima (LSAG: un voto por persona), canal de denuncias y revisión por pares (AOS), un consorcio de hospitales que aporta datos sin decir cuál, credenciales de pertenencia («soy alumno») y la gobernanza de una DAO.')),
    h('p', h('strong', 'Límites: '), 'la cuenta es perfecta, pero el anonimato real depende de cómo se use. La dirección IP, la hora de envío o el estilo de redacción pueden delatar a quien firma. En un grupo chico adivinar es fácil (1 de 3 es 33 %), y si los demás miembros son evidentemente de relleno, el grupo real es menor. Si alguien firma varias veces con grupos distintos, cruzar las listas reduce a los sospechosos. Y una computadora cuántica grande (algoritmo de Shor) rompería estas firmas; se investigan versiones basadas en retículas, como MatRiCT.'),
    h('p', h('strong', '¿Cuándo usarla? '), 'Cuando hay que probar que algo viene de un grupo sin decir de quién, ya existen llaves públicas auténticas de sus miembros y se acepta que nadie —ni un administrador— pueda descubrir al firmante. Si hace falta poder revelarlo en caso de abuso, lo indicado es una firma de grupo; si además cada quien debe firmar una sola vez, la variante enlazable (LSAG).'));
}
