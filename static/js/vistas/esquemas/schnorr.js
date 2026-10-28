// ESQUEMA 5 · Una firma digital con números pequeños (firma de Schnorr de juguete y multifirma MuSig).
//  Arriba: con qué números se juega — un reloj de 23 horas (potencias de 2) o una curva pequeña.
//  A · La UAN firma un título: 1) sus llaves  2) firmar (sobre cerrado → reto → respuesta)
//      3) verificar (lo puede hacer cualquiera). Al lado, un mapa: dónde caen y, r y r_v.
//      Trampas: cambiar el título, inventar una firma, repetir el número al azar.
//  B · Doble titulación (MuSig): llave conjunta → ronda 1 (huellas) → ronda 2 (abren los sobres)
//      → ronda 3 (cada uno su parte) → una sola firma. Trampas: llave tramposa, parte equivocada.
//  Debajo: «Ver las cuentas» (receta y tablas del documento) y «Para saber más».
// Con los valores iniciales, pulsar los botones en orden reproduce el documento: firma (4, 5) en el
// reloj y (8, 16) en la curva; multifirma (5, 4) con llave conjunta 16 / (9, 16).
// API: GET /api/esquemas/schnorr/tablas · POST …/firmar | /verificar | /nonce | /multifirma | /ataque

import * as K from './_kit.js';

const { h, s, icono, texto } = K;

const GRUPOS = Object.freeze({
  zp: {
    q: 11,
    nombre: 'Reloj de 23 horas',
    sub: 'potencias de 2',
    frase: 'Las cuentas se hacen como en un reloj de 23 horas: al pasar de 22 se vuelve a empezar. Si empiezas en 1 y multiplicas por 2 una y otra vez, solo visitas 11 de esas horas: son los lugares de este juego.',
    Y: 'y', R: 'r', conj: 'ỹ', inicio: 'inicio',
    mapa: 'El reloj de 23 horas',
    def: { x: 6, k: 7, M: 14, x1: 6, x2: 4, k1: 2, k2: 8 },
  },
  curva: {
    q: 19,
    nombre: 'Curva elíptica pequeña',
    sub: 'la idea de Bitcoin, en miniatura',
    frase: 'Los lugares son las 18 casillas de una cuadrícula de 17 × 17 que cumplen la ecuación de una curva. Un salto lleva de una casilla a otra con una regla fija («sumar G»). Es lo que usa Bitcoin, en miniatura.',
    Y: 'Y', R: 'R', conj: 'Ỹ', inicio: 'G',
    mapa: 'La curva, en una cuadrícula de 17 × 17',
    def: { x: 7, k: 10, M: 14, x1: 7, x2: 8, k1: 2, k2: 4 },
  },
});

// potencias de 2 en el reloj de 23: [1, 2, 4, 8, 16, 9, 18, 13, 3, 6, 12]
const POT2 = Array.from({ length: 11 }, (_, a) => potencia(2, a, 23));
const VISITADAS = new Set(POT2);
const INICIO_CURVA = [5, 1];

function potencia(b, e, m) {
  let r = 1;
  let base = b % m;
  let exp = e;
  while (exp > 0) {
    if (exp & 1) r = (r * base) % m;
    base = (base * base) % m;
    exp >>= 1;
  }
  return r;
}

const ver = (v) => (v === null || v === undefined ? '𝒪' : Array.isArray(v) ? `(${v[0]}, ${v[1]})` : String(v));
const igual = (a, b) => ver(a) === ver(b);
const numero = (input) => (input.value.trim() === '' ? null : Number(input.value));
const pegado = (r, M) => [...(Array.isArray(r) ? r : [r]), M].join('');
const pegadoTexto = (r, M) => `${Array.isArray(r) ? `${r[0]}, ${r[1]}` : r} y ${M} → ${pegado(r, M)}`;

function alAzar(min, max, evitar = null) {
  let v;
  do { v = min + Math.floor(Math.random() * (max - min + 1)); } while (v === evitar && max > min);
  return v;
}

/** «r_v» → r<sub>v</sub>, «x1» → x<sub>1</sub>; el resto, tal cual. */
function simbolo(t) {
  const m = String(t).match(/^(.+?)(?:_(\w+)|(\d+))$/);
  return h('var.sch-sim', m ? [m[1], h('sub', m[2] ?? m[3])] : String(t));
}

export default {
  montar(host, ctx, meta) {
    const L = Object.assign(ctx.local, { grupo: 'zp', tablas: {}, errorTablas: false, A: null, B: null });
    L.id = (x) => `esq-schnorr-${ctx.modo}-${x}`;

    // ------------------------------------------------------------ con qué números
    L.frase = h('p.sch-grupo__frase', { 'aria-live': 'polite' });
    const seg = K.segmentado({
      nombre: 'grupo', etiqueta: '¿Con qué números quieres jugar?', valor: L.grupo,
      opciones: Object.entries(GRUPOS).map(([valor, g]) => ({ valor, texto: [h('strong', g.nombre), h('small', g.sub)] })),
      alCambiar: (v) => cambiarGrupo(ctx, v),
    });
    const grupo = h('section.sch-grupo', { 'aria-labelledby': L.id('grupo') },
      h('div.sch-grupo__cabeza',
        h('h3.sch-grupo__titulo', { id: L.id('grupo') }, '¿Con qué números quieres jugar?'),
        h('p.sch-juguete', icono('alerta'),
          h('span', h('strong', 'Es un juguete: '), 'con 11 o 19 posibilidades, cualquiera adivina la clave probando una por una. Sirve para entender cómo funciona, no para proteger nada.'))),
      seg, L.frase);

    L.zonaA = h('section.sch-bloque', { 'aria-labelledby': L.id('a') });
    L.zonaB = h('section.sch-bloque', { 'aria-labelledby': L.id('b') });
    L.cuentasCuerpo = h('div.sch-cuentas');

    host.append(
      K.cabecera({ numero: meta.numero, icono: meta.icono, titulo: meta.titulo, id: L.id('titulo'),
        metafora: 'La misma firma que protege a Bitcoin, pero con números que caben en una calculadora: puedes revisar cada cuenta.',
        historia: 'La UAN firma cada título que emite. Quien lo reciba —un empleador, otra universidad— debe poder comprobar que la firma es de la UAN y que nadie cambió el título, sin conocer jamás la clave secreta de la UAN.',
        tecnico: 'firma de Schnorr con las potencias de 2 módulo 23 y con la curva y² = x³ + 2x + 2 sobre F₁₇; multifirma MuSig de dos firmantes.' }),
      grupo,
      L.zonaA,
      L.zonaB,
      K.cuentas('Ver las cuentas (la receta y las tablas del documento)', L.cuentasCuerpo),
      saberMas(),
    );
    pintarTodo(ctx);
    cargarTablas(ctx);
  },
};

// ================================================================ grupo
function cambiarGrupo(ctx, v) {
  const L = ctx.local;
  if (v === L.grupo || !GRUPOS[v]) return;
  L.grupo = v;
  pintarTodo(ctx);
  K.anim.entrar(L.zonaA);
  K.anim.entrar(L.zonaB, { retraso: 60 });
  K.narrar(ctx, `Ahora con: ${GRUPOS[v].nombre.toLowerCase()}`, 'Mismos pasos, otros números. Todo volvió a los valores del documento.', 'info');
}

function pintarTodo(ctx) {
  const L = ctx.local;
  texto(L.frase, GRUPOS[L.grupo].frase);
  armarA(ctx);
  armarB(ctx);
  pintarCuentas(ctx);
}

async function cargarTablas(ctx) {
  const L = ctx.local;
  try {
    const [zp, curva] = await Promise.all([K.get('schnorr/tablas', { grupo: 'zp' }), K.get('schnorr/tablas', { grupo: 'curva' })]);
    L.tablas = { zp, curva };
  } catch (e) {
    L.errorTablas = true;
    ctx.ui.mostrarError(e, { titulo: 'No se pudieron cargar las tablas' });
  }
  pintarClave(ctx);
  pintarMapa(ctx, { animar: false });
  pintarCuentas(ctx);
}

/** k·G leído de la tabla del servidor (k se reduce módulo 19; 0 → 𝒪 = null). undefined si aún no hay tabla. */
function multiplo(L, k) {
  const t = L.tablas.curva;
  if (!t) return undefined;
  const kk = ((k % 19) + 19) % 19;
  return kk === 0 ? null : t.multiplos[kk - 1].punto;
}

function clavePublica(L, x) {
  return L.grupo === 'zp' ? POT2[(11 - x) % 11] : multiplo(L, 19 - x);
}

function cuentaClave(L, x, y) {
  if (L.grupo === 'zp') {
    const e = (11 - x) % 11;
    const crudo = 2 ** e;
    return `y = g^(−x) = 2^(−${x}) = 2^${e} = ${crudo}${crudo >= 23 ? ` ≡ ${y}` : ''} (mod 23)`;
  }
  return `Y = −x·G = −(${x}·G) = −${ver(multiplo(L, x))} = ${ver(y)}`;
}

// ================================================================ piezas
function deslizador({ id, nombre, sim, llano, min, max, valor, nota = null, alCambiar }) {
  const input = h('input.deslizador', { type: 'range', id, name: nombre, min, max, step: 1, value: String(valor) });
  const salida = h('span.sch-desl__valor', { 'aria-hidden': 'true' });
  const pintar = () => {
    const v = Number(input.value);
    texto(salida, String(v));
    input.style.setProperty('--relleno', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
  };
  input.addEventListener('input', () => { pintar(); alCambiar?.(Number(input.value)); });
  pintar();
  const campo = h('div.campo.sch-desl',
    h('div.sch-desl__cabeza', h('label.campo__etiqueta', { for: id }, simbolo(sim), h('span', `· ${llano}`)), salida),
    input,
    nota ? h('p.campo__ayuda', nota) : null);
  campo.input = input;
  campo.fijar = (v) => { input.value = String(v); pintar(); };
  return campo;
}

function campoNumero({ id, nombre, sim, llano, min, max, valor, ayuda = null }) {
  const input = h('input.entrada.entrada--mono', { id, name: nombre, type: 'number', inputmode: 'numeric', min, max, step: 1, value: valor === null ? '' : String(valor), autocomplete: 'off' });
  const ayudaEl = ayuda ? h('p.campo__ayuda', { id: `${id}-ayuda` }, ayuda) : null;
  if (ayudaEl) input.setAttribute('aria-describedby', ayudaEl.id);
  const campo = h('div.campo.sch-campo-num',
    h('label.campo__etiqueta', { for: id }, simbolo(sim), h('span', `· ${llano}`)),
    input, ayudaEl);
  campo.input = input;
  return campo;
}

function display(sim, llano, valor, { tono = null, grande = false } = {}) {
  return h(`div.sch-display${grande ? '.sch-display--grande' : ''}`, { dataset: { tono } },
    h('span.sch-display__etiqueta', simbolo(sim), ` · ${llano}`),
    h('span.sch-display__valor', String(valor)));
}

/** Una línea de cuentas: número, qué es (en llano), la cuenta del servidor y el valor grande. */
function linea(n, titulo, sim, valor, tono, llano, cuenta) {
  return h('li.sch-linea', { dataset: { tono } },
    h('span.sch-linea__num', { 'aria-hidden': 'true' }, String(n)),
    h('div.sch-linea__texto',
      h('p.sch-linea__titulo', titulo),
      h('p.sch-linea__llano', llano),
      cuenta ? h('p.esq-cuenta', cuenta) : null),
    h('p.sch-linea__valor', simbolo(sim), ' = ', h('strong', String(valor))));
}

function cabezaBloque(letra, id, titulo, sub) {
  return h('header.sch-bloque__cabeza',
    h('span.sch-bloque__letra', { 'aria-hidden': 'true' }, letra),
    h('div.sch-bloque__texto',
      h('h3.sch-bloque__titulo', { id }, h('span.solo-lectores', `Parte ${letra}: `), titulo),
      h('p.sch-bloque__sub', sub)));
}

const quien = (nombre, sigla) => h('p.sch-quien', icono('institucion'), h('strong', nombre), h('span', `· firma por la ${sigla}`));
const lado = (nombre, sigla, ...hijos) => h('div.sch-par__lado', quien(nombre, sigla), ...hijos);

function check(ok, siTexto, noTexto) {
  return h('p.sch-check', { dataset: { ok: ok ? 'si' : 'no' } }, icono(ok ? 'ok' : 'x'), h('span', ok ? siTexto : noTexto));
}

function avisoEn(area, mensaje) {
  K.reemplazar(area, h('div.aviso', { dataset: { nivel: 'aviso' }, role: 'alert' }, icono('alerta'),
    h('div', h('strong', 'Con estos números no se puede. '), mensaje)));
}

// ================================================================ A · firma individual
function armarA(ctx) {
  const L = ctx.local;
  const G = GRUPOS[L.grupo];
  const d = G.def;
  const id = L.id;
  const A = { x: d.x, k: d.k, firma: null, verif: null, caminoPintado: null };
  L.A = A;

  // ---------------------------------------------------------- paso 1 · llaves
  A.deslX = deslizador({ id: id('x'), nombre: 'x', sim: 'x', llano: 'clave privada', min: 1, max: G.q - 1, valor: A.x,
    nota: 'Secreta: solo la UAN la conoce.',
    // mientras se arrastra no se anima nada: solo se repinta
    alCambiar: (v) => { A.x = v; olvidarFirma(ctx, { mapa: false }); pintarClave(ctx); pintarMapa(ctx, { animar: false }); } });
  A.clave = h('div.sch-clave');
  A.claveViva = h('p.solo-lectores', { 'aria-live': 'polite' });
  A.paso1 = K.paso({ n: 1, titulo: 'Las llaves de la UAN', id: id('a1'),
    ayuda: 'La UAN elige una clave privada: un número que solo ella sabe. De ese número sale su clave pública, que se anuncia a todo el mundo.' },
  h('div.sch-campos', A.deslX), A.clave, A.claveViva);

  // ---------------------------------------------------------- paso 2 · firmar
  A.campoM = campoNumero({ id: id('m'), nombre: 'M', sim: 'M', llano: 'número de título', min: 0, max: 999, valor: d.M, ayuda: 'El título que se firma (del 0 al 999).' });
  A.campoM.input.addEventListener('input', () => { ctx.ui.limpiarCampos(A.formFirma); olvidarFirma(ctx); });
  A.deslK = deslizador({ id: id('k'), nombre: 'k', sim: 'k', llano: 'número al azar', min: 1, max: G.q - 1, valor: A.k,
    nota: 'Se inventa para esta firma y se tira después.',
    alCambiar: (v) => { A.k = v; olvidarFirma(ctx); } });
  const dado = h('button.boton.boton--secundario', { type: 'button' }, icono('dado'), h('span', 'Otro al azar'));
  dado.addEventListener('click', () => { const v = alAzar(1, G.q - 1, A.k); A.k = v; A.deslK.fijar(v); olvidarFirma(ctx); });
  A.botonFirmar = h('button.boton.boton--primario', { type: 'submit' }, icono('firma'), h('span', 'Firmar el título'));
  A.formFirma = h('form.sch-form', { novalidate: true },
    h('div.sch-campos', A.campoM, h('div.sch-con-dado', A.deslK, dado)),
    h('div.esq-acciones', A.botonFirmar));
  A.formFirma.addEventListener('submit', (e) => { e.preventDefault(); firmar(ctx); });
  A.lineasFirma = h('ol.sch-lineas', { role: 'list', hidden: true, 'aria-label': 'Las cuentas de la firma' });
  A.tarjetaFirma = h('div.sch-firma', { hidden: true, 'aria-live': 'polite' });
  A.paso2 = K.paso({ n: 2, titulo: 'La UAN firma el título', id: id('a2'),
    ayuda: 'Firmar es una cuenta de tres pasos que mezcla el número del título, un número al azar inventado en el momento y la clave privada.' },
  A.formFirma, A.lineasFirma, A.tarjetaFirma);

  // ---------------------------------------------------------- paso 3 · verificar
  A.esperaVerif = h('p.sch-espera', 'Primero firma el título en el paso 2.');
  A.publico = h('div.sch-publico');
  A.vM = campoNumero({ id: id('vm'), nombre: 'M', sim: 'M', llano: 'número de título', min: 0, max: 999, valor: null });
  A.vS = campoNumero({ id: id('vs'), nombre: 's', sim: 's', llano: 'respuesta', min: 0, max: G.q - 1, valor: null });
  A.vE = campoNumero({ id: id('ve'), nombre: 'e', sim: 'e', llano: 'reto', min: 0, max: G.q - 1, valor: null });
  for (const c of [A.vM, A.vS, A.vE]) c.input.addEventListener('input', () => ctx.ui.limpiarCampos(A.formVerif));
  A.botonVerificar = h('button.boton.boton--primario', { type: 'submit' }, icono('sello'), h('span', 'Verificar la firma'));
  A.botonOriginal = h('button.boton.boton--fantasma', { type: 'button' }, icono('reiniciar'), h('span', 'Volver a la firma de la UAN'));
  A.botonOriginal.addEventListener('click', () => { llenarVerificacion(ctx); ctx.ui.limpiarCampos(A.formVerif); A.vM.input.focus(); });
  A.formVerif = h('form.sch-form', { novalidate: true, hidden: true },
    A.publico,
    h('div.sch-campos', A.vM, A.vS, A.vE),
    h('p.campo__ayuda', 'Puedes cambiar a mano cualquiera de estos tres números para ver qué pasa.'),
    h('div.esq-acciones', A.botonVerificar, A.botonOriginal));
  A.formVerif.addEventListener('submit', (e) => { e.preventDefault(); verificar(ctx); });
  A.lineasVerif = h('ol.sch-lineas', { role: 'list', hidden: true, 'aria-label': 'Las cuentas de quien verifica' });
  A.veredicto = K.veredicto({ vacio: 'Pulsa «Verificar la firma»: se repite la cuenta solo con lo público.' });
  A.veredicto.hidden = true;
  A.explica = K.explicacion();
  A.paso3 = K.paso({ n: 3, titulo: 'Verificar (lo puede hacer cualquiera)', estado: 'espera', id: id('a3'),
    ayuda: 'Quien recibe el título no conoce ningún secreto: solo la clave pública, el número de título y la firma. Con eso repite la cuenta. Si sale el mismo reto, la firma es auténtica.' },
  A.esperaVerif, A.formVerif, A.lineasVerif, A.veredicto, A.explica);

  // ---------------------------------------------------------- mapa y trampas
  const mapa = armarMapa(ctx);
  A.trampas = K.trampas([
    { etiqueta: 'Cambiar el número de título', texto: 'Alguien pega la misma firma en otro título.', fn: (b) => trampaTitulo(ctx, b) },
    { etiqueta: 'Inventar una firma', texto: 'Un falsificador, sin la clave privada, pone dos números al azar.', fn: (b) => trampaInventar(ctx, b) },
    { etiqueta: 'Firmar dos títulos con el mismo número al azar', texto: 'Por descuido, la UAN repite su número al azar en otro título.', fn: (b) => trampaRepetir(ctx, b) },
  ]);
  A.trampas.hidden = true;
  A.tVer = K.veredicto({ vacio: '' });
  A.tVer.hidden = true;
  A.tExp = K.explicacion();
  A.trampas.append(A.tVer, A.tExp);

  K.reemplazar(L.zonaA,
    cabezaBloque('A', id('a'), 'La UAN firma un título', 'Una universidad, un título y una firma de solo dos números.'),
    h('div.sch-mesa', h('div.esq-pasos', A.paso1, A.paso2, A.paso3), mapa),
    A.trampas);
  pintarClave(ctx);
  pintarMapa(ctx, { animar: false });
}

function pintarClave(ctx) {
  const L = ctx.local;
  const A = L.A;
  const G = GRUPOS[L.grupo];
  const y = clavePublica(L, A.x);
  if (y === undefined) {
    K.reemplazar(A.clave, h('p.sch-espera', L.errorTablas ? 'No se pudieron cargar las tablas de la curva.' : 'Cargando la tabla de la curva…'));
    return;
  }
  K.reemplazar(A.clave,
    h('div.sch-fila',
      display(G.Y, 'clave pública', ver(y), { tono: 'publica', grande: true }),
      h('p.sch-llano', 'Esta sí se anuncia: todo el mundo la conoce.')),
    h('p.esq-cuenta', cuentaClave(L, A.x, y)),
    h('p.sch-nota', `¿Se puede adivinar x mirando ${ver(y)}? Aquí sí: basta probar las ${G.q - 1} opciones. Con los números de verdad (de 78 cifras) no hay manera práctica de hacerlo.`));
  texto(A.claveViva, `Clave pública: ${ver(y)}`);
}

function olvidarFirma(ctx, { mapa = true } = {}) {
  const A = ctx.local.A;
  if (!A.firma) return;
  A.firma = null;
  A.verif = null;
  pintarFirma(ctx, false);
  K.marcarPaso(A.paso1, 'activo');
  K.marcarPaso(A.paso2, 'activo');
  K.marcarPaso(A.paso3, 'espera');
  texto(A.esperaVerif, 'Cambiaste un número: la firma anterior ya no corresponde. Vuelve a firmar en el paso 2.');
  A.esperaVerif.hidden = false;
  A.formVerif.hidden = true;
  A.lineasVerif.hidden = true;
  K.pintarVeredicto(A.veredicto, null);
  A.veredicto.hidden = true;
  K.explicar(A.explica);
  A.trampas.hidden = true;
  A.tVer.hidden = true;
  K.explicar(A.tExp);
  if (mapa) pintarMapa(ctx, { animar: false });
}

async function firmar(ctx) {
  const L = ctx.local;
  const A = L.A;
  const cuerpo = { grupo: L.grupo, x: A.x, k: A.k, M: numero(A.campoM.input) };
  let r;
  try {
    r = await ctx.ui.ocupado(A.botonFirmar, K.post('schnorr/firmar', cuerpo));
  } catch (e) {
    ctx.ui.mostrarError(e, { form: A.formFirma, titulo: 'No se pudo firmar' });
    return;
  }
  // si mientras tanto cambió el grupo o algún número, esta firma ya no corresponde
  if (L.A !== A || cuerpo.x !== A.x || cuerpo.k !== A.k || cuerpo.M !== numero(A.campoM.input)) return;
  A.firma = r;
  A.verif = null;
  pintarFirma(ctx, true);
  K.marcarPaso(A.paso1, 'hecho');
  K.marcarPaso(A.paso2, 'hecho');
  K.marcarPaso(A.paso3, 'activo');
  A.esperaVerif.hidden = true;
  A.formVerif.hidden = false;
  llenarVerificacion(ctx);
  A.lineasVerif.hidden = true;
  K.pintarVeredicto(A.veredicto, null);
  A.veredicto.hidden = false;
  K.explicar(A.explica);
  A.trampas.hidden = false;
  A.tVer.hidden = true;
  K.explicar(A.tExp);
  pintarMapa(ctx);
  K.narrar(ctx, `La UAN firmó el título ${r.M}`, `Su firma es la pareja (${r.s}, ${r.e}). Cualquiera puede comprobarla con la clave pública ${ver(r.y)}.`, 'ok');
}

function pintarFirma(ctx, animar) {
  const L = ctx.local;
  const A = L.A;
  const G = GRUPOS[L.grupo];
  const f = A.firma;
  if (!f) {
    K.reemplazar(A.lineasFirma);
    K.reemplazar(A.tarjetaFirma);
    A.lineasFirma.hidden = true;
    A.tarjetaFirma.hidden = true;
    return;
  }
  K.reemplazar(A.lineasFirma,
    linea(1, 'Sobre cerrado', G.R, ver(f.r), 'sobre',
      L.grupo === 'zp'
        ? `Con su número al azar da ${f.k} saltos en el reloj y cae en ${f.r}. Enseña dónde cayó, no cuántos saltos dio.`
        : `Con su número al azar suma G ${f.k} veces y cae en ${ver(f.r)}. Enseña dónde cayó, no cuántas veces sumó.`,
      f.cuentas.compromiso),
    linea(2, 'El reto lo pone la huella', 'e', f.e, 'reto',
      `Pega el sobre y el título (${pegadoTexto(f.r, f.M)}) y se queda con lo que sobra al dividir entre ${G.q}. Nadie lo elige.`,
      f.cuentas.reto),
    linea(3, 'La respuesta', 's', f.s, 'respuesta',
      `Junta el número al azar con la clave privada: ${f.k} + ${f.x} × ${f.e}. Solo quien sabe x puede hacer esta cuenta.`,
      f.cuentas.respuesta));
  A.lineasFirma.hidden = false;
  K.reemplazar(A.tarjetaFirma,
    h('p.sch-firma__etiqueta', 'La firma del título ', h('strong', String(f.M)), ' es la pareja (s, e):'),
    h('p.sch-firma__valor', `(${f.s}, ${f.e})`),
    h('p.sch-firma__nota', 'Viaja junto al título. La clave privada nunca sale de la UAN, y el número al azar ya se tiró.'));
  A.tarjetaFirma.hidden = false;
  if (animar) {
    const PASO = 200;
    K.anim.escalonar(A.lineasFirma.children, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: K.anim.DUR.entrada }, PASO);
    K.anim.animar(A.tarjetaFirma, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }],
      { duration: K.anim.DUR.entrada, delay: 3 * PASO, fill: 'backwards', easing: K.anim.CURVA.firma });
  }
}

function llenarVerificacion(ctx) {
  const L = ctx.local;
  const A = L.A;
  const G = GRUPOS[L.grupo];
  const f = A.firma;
  if (!f) return;
  A.vM.input.value = String(f.M);
  A.vS.input.value = String(f.s);
  A.vE.input.value = String(f.e);
  K.reemplazar(A.publico,
    h('span', 'Quien verifica solo tiene cosas públicas:'),
    display(G.Y, 'clave pública de la UAN', ver(f.y), { tono: 'publica' }),
    h('span', 'y lo que llegó con el título:'));
}

async function verificar(ctx) {
  const L = ctx.local;
  const A = L.A;
  const f = A.firma;
  if (!f) return;
  const cuerpo = { grupo: L.grupo, y: f.y, M: numero(A.vM.input), s: numero(A.vS.input), e: numero(A.vE.input) };
  let v;
  try {
    v = await ctx.ui.ocupado(A.botonVerificar, K.post('schnorr/verificar', cuerpo));
  } catch (e) {
    ctx.ui.mostrarError(e, { form: A.formVerif, titulo: 'No se pudo verificar' });
    return;
  }
  if (L.A !== A || A.firma !== f) return;
  A.verif = v;
  const G = GRUPOS[L.grupo];
  const RV = `${G.R}_v`;
  K.reemplazar(A.lineasVerif,
    linea(1, 'Rehace el sobre', RV, ver(v.rv), 'verif',
      v.rv === null
        ? 'Solo usa cosas públicas: la firma (s, e) y la clave pública. Esta vez la cuenta no cae en ningún lugar de la curva.'
        : `Solo usa cosas públicas: la firma (s, e) y la clave pública. Cae en ${ver(v.rv)}.`,
      [v.cuentas.gs, v.cuentas.ye, v.cuentas.rv].join('\n')),
    linea(2, 'Saca otra vez el reto', 'e_v', v.ev === null ? '—' : v.ev, 'reto',
      v.ev === null
        ? 'No hay sobre que pegar con el título: la firma no puede valer.'
        : `Pega el sobre rehecho y el título (${pegadoTexto(v.rv, v.M)}) y se queda con lo que sobra al dividir entre ${G.q}.`,
      v.cuentas.ev));
  A.lineasVerif.hidden = false;
  K.anim.escalonar(A.lineasVerif.children, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: K.anim.DUR.entrada }, 140);
  const j = juzgar(G, f, v);
  K.pintarVeredicto(A.veredicto, { estado: j.estado, titulo: j.titulo, texto: j.texto });
  K.explicar(A.explica, ...j.explicacion);
  K.marcarPaso(A.paso3, j.estado === 'ok' ? 'hecho' : 'activo');
  pintarMapa(ctx, { aterrizar: true });
  K.narrar(ctx, ...j.narrar);
}

/** Lee el resultado de una verificación frente a la firma original de la UAN. */
function juzgar(G, f, v) {
  const RV = `${G.R}_v`;
  const original = v.M === f.M && v.s === f.s && v.e === f.e;
  if (v.valida && original) {
    return {
      estado: 'ok', titulo: '¡Firma auténtica!',
      texto: ['Coincide: ', simbolo('e_v'), ` = ${v.ev} = e. La hizo quien tiene la clave privada de la UAN, y el título ${v.M} no cambió.`],
      explicacion: [
        h('p', 'Quien verifica nunca vio ', h('strong', 'k ni x'), ', y aun así rehízo el mismo sobre: ', simbolo(RV), ` = ${ver(v.rv)} = `, simbolo(G.R),
          '. La clave pública cancela justo la parte secreta de la respuesta.'),
        'Prueba a cambiar a mano el número de título o la firma, y vuelve a verificar.'],
      narrar: ['Firma auténtica', `La firma (${v.s}, ${v.e}) del título ${v.M} es de la UAN.`, 'ok'],
    };
  }
  if (v.valida) {
    return {
      estado: 'aviso', titulo: 'Pasó… por pura casualidad',
      texto: ['Esta no es la firma que hizo la UAN, y aun así ', simbolo('e_v'), ` = ${v.ev} = e.`],
      explicacion: [
        `Con solo ${G.q} retos posibles, más o menos una de cada ${G.q} combinaciones cuadra por suerte. Es justo el defecto del juguete.`,
        'Con los números de verdad (de 78 cifras), atinarle así es imposible en la práctica.'],
      narrar: ['Pasó por casualidad', `Con solo ${G.q} retos posibles, a veces una firma cualquiera cuadra. Con números de verdad, no.`, 'aviso'],
    };
  }
  let explicacion;
  if (v.rv === null) {
    explicacion = ['La cuenta no cae en ningún lugar de la curva (da el «punto al infinito»): no hay sobre que pegar con el título, así que la firma no vale.'];
  } else if (igual(v.rv, f.r) && v.M !== f.M) {
    explicacion = [
      h('p', `El sobre rehecho es el mismo de la firma, ${ver(v.rv)}. Pero ahora se pega con el título ${v.M} en vez del ${f.M}: la huella cambia y ya no da el reto de la firma.`),
      'La firma queda amarrada a SU título: no sirve para ningún otro.'];
  } else {
    explicacion = [
      `Con esos números, quien verifica cae en ${ver(v.rv)} y no en el sobre de la firma, ${ver(f.r)}: la huella sale distinta.`,
      'Sin la clave privada no hay forma de fabricar una respuesta que cuadre.'];
  }
  return {
    estado: 'mal', titulo: 'Firma rechazada',
    texto: v.ev === null ? 'La cuenta no llega a ningún lugar: no hay reto que comparar.' : ['No coincide: ', simbolo('e_v'), ` = ${v.ev}, pero la firma dice e = ${v.e}.`],
    explicacion,
    narrar: ['Firma rechazada', v.ev === null ? 'La cuenta no llegó a ningún lugar de la curva.' : `El reto recalculado (${v.ev}) no coincide con el de la firma (${v.e}).`, 'aviso'],
  };
}

// ------------------------------------------------------------ trampas A
function pintarTrampa(ctx, j, contexto, titulo = null) {
  const A = ctx.local.A;
  A.tVer.hidden = false;
  K.pintarVeredicto(A.tVer, { estado: j.estado, titulo: titulo || j.titulo, texto: j.texto, extra: contexto ? h('p.sch-contexto', contexto) : null });
  K.explicar(A.tExp, ...j.explicacion);
  K.narrar(ctx, ...j.narrar);
}

async function trampaTitulo(ctx, boton) {
  const L = ctx.local;
  const A = L.A;
  const f = A.firma;
  if (!f) return;
  const M2 = f.M < 999 ? f.M + 1 : f.M - 1;
  const v = await K.accion(ctx, boton, K.post('schnorr/verificar', { grupo: L.grupo, y: f.y, M: M2, s: f.s, e: f.e }));
  if (!v || L.A !== A || A.firma !== f) return;
  const j = juzgar(GRUPOS[L.grupo], f, v);
  pintarTrampa(ctx, j, `La UAN firmó el título ${f.M}. Alguien presenta la misma firma (${f.s}, ${f.e}) pegada al título ${M2}.`,
    j.estado === 'mal' ? '¡Rechazada! La firma no sirve para otro título' : null);
}

async function trampaInventar(ctx, boton) {
  const L = ctx.local;
  const A = L.A;
  const f = A.firma;
  if (!f) return;
  const q = GRUPOS[L.grupo].q;
  let s2;
  let e2;
  do { s2 = alAzar(0, q - 1); e2 = alAzar(0, q - 1); } while (s2 === f.s && e2 === f.e);
  const v = await K.accion(ctx, boton, K.post('schnorr/verificar', { grupo: L.grupo, y: f.y, M: f.M, s: s2, e: e2 }));
  if (!v || L.A !== A || A.firma !== f) return;
  const j = juzgar(GRUPOS[L.grupo], f, v);
  pintarTrampa(ctx, j, `Un falsificador, sin la clave privada, presenta (${s2}, ${e2}) como firma del título ${f.M}.`,
    j.estado === 'mal' ? '¡Rechazada! Inventar números no funciona' : null);
}

async function trampaRepetir(ctx, boton) {
  const L = ctx.local;
  const A = L.A;
  const f = A.firma;
  if (!f) return;
  let M2 = f.M + 2 <= 999 ? f.M + 2 : f.M - 2;
  let r = null;
  // si por casualidad los dos retos salen iguales no se puede despejar: se prueba con el título siguiente
  for (let i = 0; i < 6; i++) {
    r = await K.accion(ctx, boton, K.post('schnorr/nonce', { grupo: L.grupo, x: f.x, k: f.k, M1: f.M, M2 }));
    if (!r || L.A !== A || A.firma !== f) return;
    if (r.extraible) break;
    M2 = (M2 + 1) % 1000;
    if (M2 === f.M) M2 = (M2 + 1) % 1000;
  }
  A.tVer.hidden = false;
  if (!r.extraible) {
    K.pintarVeredicto(A.tVer, { estado: 'aviso', titulo: 'Esta vez no se pudo despejar', texto: r.cuenta });
    K.explicar(A.tExp, 'Los dos retos salieron iguales por casualidad. Con cualquier otro par de títulos, la clave queda expuesta.');
    return;
  }
  K.pintarVeredicto(A.tVer, {
    estado: 'mal', titulo: '¡La clave privada quedó expuesta!',
    texto: [`Dos firmas con el mismo número al azar (k = ${f.k}): (${r.firma1.s}, ${r.firma1.e}) para el título ${r.M1} y (${r.firma2.s}, ${r.firma2.e}) para el ${r.M2}. Con una resta y una división, cualquiera despeja `, simbolo('x'), ` = ${r.x_extraida}.`],
    extra: h('div.sch-extra',
      h('p.esq-cuenta', r.cuenta),
      h('p', r.coincide
        ? `Es justo la clave privada de la UAN (x = ${f.x}). Con ella, cualquiera podría firmar títulos falsos en su nombre. De paso, también sale k = ${r.k_extraido}.`
        : 'El número despejado no coincide con la clave: revisa las cuentas.')),
  });
  K.explicar(A.tExp,
    h('p', 'Las dos respuestas son ', h('code', 's = k + x·e'), ' con el mismo k. Al restarlas, k desaparece y solo queda x. Por eso el número al azar se usa ', h('strong', 'una sola vez'), '.'),
    'Este descuido es real: en su versión para ECDSA (prima hermana de esta firma) permitió sacar la clave con la que Sony firmaba el software de la PlayStation 3 (2010) y vaciar billeteras de Bitcoin en teléfonos Android (2013), cuyo generador de números al azar repetía valores.');
  K.narrar(ctx, '¡Clave privada expuesta!', `Dos firmas con el mismo número al azar delataron la clave de la UAN: x = ${r.x_extraida}.`, 'error');
}

// ------------------------------------------------------------ mapa
const RR = 92;                                           // radio del reloj (viewBox centrado en 0, 0)
function puntoReloj(hora, radio = RR) {
  const a = (hora / 23) * Math.PI * 2 - Math.PI / 2;
  return [radio * Math.cos(a), radio * Math.sin(a), a];
}
const CX = (i) => 24 + i * 11.5;                         // cuadrícula de la curva (viewBox 0 0 228 228)
const CY = (j) => 208 - j * 11.5;
const trazo = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

function armarMapa(ctx) {
  const L = ctx.local;
  const G = GRUPOS[L.grupo];
  const zp = L.grupo === 'zp';
  const pieId = L.id('mapa-pie');
  L.A.m = {
    svg: s('svg.sch-mapa__svg', { viewBox: zp ? '-140 -128 280 256' : '0 0 228 228', role: 'img', 'aria-describedby': pieId,
      'aria-label': zp ? 'Reloj de 23 horas con los saltos de la firma' : 'Cuadrícula de 17 por 17 con los 18 lugares de la curva y los saltos de la firma' }),
    pie: h('p.sch-mapa__pie', { id: pieId }),
  };
  return h('aside.sch-mapa', { 'aria-label': 'Mapa de la firma' },
    h('h4.sch-mapa__titulo', icono(zp ? 'reloj' : 'onda'), h('span', G.mapa)),
    h('div.sch-mapa__lienzo', L.A.m.svg),
    L.A.m.pie,
    h('ul.sch-leyenda', { role: 'list' },
      h('li', h('span.sch-leyenda__muestra', { dataset: { tono: 'inicio' }, 'aria-hidden': 'true' }), h('span', zp ? '1 · donde empiezan los saltos' : 'G · donde empiezan los saltos')),
      h('li', h('span.sch-leyenda__muestra', { dataset: { tono: 'publica' }, 'aria-hidden': 'true' }), h('span', simbolo(G.Y), ' · clave pública')),
      h('li', h('span.sch-leyenda__muestra', { dataset: { tono: 'sobre' }, 'aria-hidden': 'true' }), h('span', simbolo(G.R), ' · sobre cerrado')),
      h('li', h('span.sch-leyenda__muestra', { dataset: { tono: 'verif' }, 'aria-hidden': 'true' }), h('span', simbolo(`${G.R}_v`), ' · lo que rehace quien verifica'))));
}

function pintarMapa(ctx, { animar = true, aterrizar = false } = {}) {
  const L = ctx.local;
  const A = L.A;
  if (!A?.m) return;
  const G = GRUPOS[L.grupo];
  const zp = L.grupo === 'zp';
  const f = A.firma;
  const v = A.verif;
  if (!zp && !L.tablas.curva) {
    K.reemplazar(A.m.svg);
    K.reemplazar(A.m.pie, L.errorTablas ? 'No se pudo cargar la curva.' : 'Cargando la curva…');
    return;
  }
  const y = f ? f.y : clavePublica(L, A.x);
  const tipo = f ? 'sobre' : 'publica';
  let camino;
  if (zp) camino = f ? Array.from({ length: f.k + 1 }, (_, i) => POT2[i % 11]) : Array.from({ length: A.x + 1 }, (_, i) => POT2[(11 - i) % 11]);
  else camino = f ? Array.from({ length: f.k }, (_, i) => multiplo(L, i + 1)) : Array.from({ length: A.x }, (_, i) => multiplo(L, 19 - (i + 1)));

  // marcas por lugar: varias pueden caer en el mismo (p. ej. r = r_v)
  const marcas = new Map();
  const marcar = (valor, etq, tono) => {
    if (valor === null || valor === undefined) return;
    const k = ver(valor);
    if (!marcas.has(k)) marcas.set(k, { valor, tono, etqs: [] });
    marcas.get(k).etqs.push(etq);
  };
  marcar(zp ? 1 : INICIO_CURVA, G.inicio, 'inicio');
  marcar(y, G.Y, 'publica');
  if (f) marcar(f.r, G.R, 'sobre');
  for (const m of marcas.values()) m.tono = m.etqs.includes(G.R) ? 'sobre' : m.etqs.includes(G.Y) ? 'publica' : 'inicio';
  const rv = v && v.rv !== null ? { valor: v.rv, ok: v.valida } : null;
  if (rv) marcar(rv.valor, `${G.R}_v`, 'verif');

  const dib = zp ? dibujarReloj(camino, tipo, marcas, rv) : dibujarCurva(L.tablas.curva, camino, tipo, marcas, rv);
  K.reemplazar(A.m.svg, dib.elementos);
  K.reemplazar(A.m.pie, ...pieMapa(L, G, f, v, y));

  const clave = `${L.grupo}|${tipo}|${f ? f.k : A.x}`;
  if (animar && dib.camino && clave !== A.caminoPintado) {
    K.anim.animar(dib.camino, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
      { duration: 720, easing: K.anim.CURVA.func }, { reducido: [{ opacity: 0.25 }, { opacity: 1 }] });
  }
  A.caminoPintado = clave;
  if (aterrizar && dib.anillo) {
    // el momento de la verificación: el sobre rehecho «aterriza» donde corresponda
    K.anim.animar(dib.anillo, [{ opacity: 0, transform: 'scale(2.4)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: K.anim.DUR.escena, easing: K.anim.CURVA.firma });
  }
}

function etiquetaSvg(x, y, anchor, m) {
  const partes = [];
  m.etqs.forEach((t, i) => {
    if (i) partes.push(' = ');
    if (t.endsWith('_v')) partes.push(t.slice(0, -2), s('tspan.sch-etq__sub', { dy: 3 }, 'v'));   // r_v siempre va al final
    else partes.push(t);
  });
  return s(`text.sch-etq.sch-etq--${m.tono}`, { x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': anchor }, partes);
}

function dibujarReloj(camino, tipo, marcas, rv) {
  const els = [s('circle.sch-reloj__aro', { cx: 0, cy: 0, r: RR })];
  els.push(s('path.sch-reloj__ciclo', { d: `${trazo([...POT2, 1].map((v) => puntoReloj(v)))}` }));
  const caminoEl = camino.length > 1 ? s(`path.sch-camino.sch-camino--${tipo}`, { d: trazo(camino.map((v) => puntoReloj(v))), pathLength: 1 }) : null;
  if (caminoEl) els.push(caminoEl);
  const enCamino = new Set(camino.map((v) => String(v)));
  for (let hora = 0; hora < 23; hora++) {
    const [px, py] = puntoReloj(hora);
    if (!VISITADAS.has(hora)) {
      els.push(s('text.sch-reloj__hora', { x: px.toFixed(1), y: py.toFixed(1) }, String(hora)));
      continue;
    }
    const m = marcas.get(String(hora));
    const clases = ['sch-nodo', m && m.tono !== 'verif' ? `sch-nodo--${m.tono}` : '', enCamino.has(String(hora)) ? `sch-nodo--camino-${tipo}` : ''].filter(Boolean).join(' ');
    els.push(s('g', { class: clases }, s('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: 10.5 }), s('text', { x: px.toFixed(1), y: py.toFixed(1) }, String(hora))));
  }
  let anillo = null;
  if (rv) {
    const [px, py] = puntoReloj(rv.valor);
    anillo = s(`circle.sch-anillo.sch-anillo--${rv.ok ? 'ok' : 'mal'}`, { cx: px.toFixed(1), cy: py.toFixed(1), r: 15 });
    els.push(anillo);
  }
  for (const m of marcas.values()) {
    const [lx, ly, a] = puntoReloj(m.valor, RR + 21);
    const c = Math.cos(a);
    const anchor = Math.abs(c) < 0.35 ? 'middle' : c > 0 ? 'start' : 'end';
    els.push(etiquetaSvg(lx, ly + 3.5, anchor, m));
  }
  return { elementos: els, camino: caminoEl, anillo };
}

function dibujarCurva(t, camino, tipo, marcas, rv) {
  const els = [];
  for (let i = 0; i <= 16; i++) {
    const eje = i % 4 === 0;
    els.push(s(`line.sch-rejilla${eje ? '.sch-rejilla--eje' : ''}`, { x1: CX(i), y1: CY(0), x2: CX(i), y2: CY(16) }));
    els.push(s(`line.sch-rejilla${eje ? '.sch-rejilla--eje' : ''}`, { x1: CX(0), y1: CY(i), x2: CX(16), y2: CY(i) }));
    if (eje) {
      els.push(s('text.sch-rejilla__num', { x: CX(i), y: CY(0) + 13, 'text-anchor': 'middle' }, String(i)));
      els.push(s('text.sch-rejilla__num', { x: CX(0) - 7, y: CY(i) + 3, 'text-anchor': 'end' }, String(i)));
    }
  }
  const pts = camino.filter(Boolean);
  const caminoEl = pts.length > 1 ? s(`path.sch-camino.sch-camino--${tipo}`, { d: trazo(pts.map(([x, y]) => [CX(x), CY(y)])), pathLength: 1 }) : null;
  if (caminoEl) els.push(caminoEl);
  const enCamino = new Set(pts.map((p) => ver(p)));
  for (const p of t.puntos) {
    const m = marcas.get(ver(p));
    const conMarca = m && m.tono !== 'verif';
    const clases = ['sch-pt', conMarca ? `sch-pt--${m.tono}` : '', !conMarca && enCamino.has(ver(p)) ? `sch-pt--camino-${tipo}` : ''].filter(Boolean).join(' ');
    els.push(s('circle', { class: clases, cx: CX(p[0]), cy: CY(p[1]), r: conMarca ? 5.5 : 3.2 }));
  }
  let anillo = null;
  if (rv) {
    anillo = s(`circle.sch-anillo.sch-anillo--${rv.ok ? 'ok' : 'mal'}`, { cx: CX(rv.valor[0]), cy: CY(rv.valor[1]), r: 9.5 });
    els.push(anillo);
  }
  for (const m of marcas.values()) {
    const [x, y] = m.valor;
    const derecha = x >= 12;
    const arriba = y >= 15;
    els.push(etiquetaSvg(CX(x) + (derecha ? -9 : 9), CY(y) + (arriba ? 15 : -7), derecha ? 'end' : 'start', m));
  }
  return { elementos: els, camino: caminoEl, anillo };
}

function pieMapa(L, G, f, v, y) {
  const zp = L.grupo === 'zp';
  if (v) {
    if (v.rv === null) return ['Con esta firma, quien verifica no cae en ningún lugar de la curva.'];
    if (igual(v.rv, f.r)) {
      return ['Quien verifica no conoce k ni x, y aun así cae en el mismo lugar: ', simbolo(`${G.R}_v`), ` = ${ver(v.rv)} = `, simbolo(G.R), '.',
        v.valida ? '' : ' Pero el reto no coincide: el título no es el mismo.'];
    }
    return ['Con esa firma, quien verifica cae en ', h('strong', ver(v.rv)), ', no en el sobre ', h('strong', ver(f.r)), '.'];
  }
  if (f) {
    return zp
      ? [`El número al azar k = ${f.k} son ${f.k} saltos desde el 1 (cada salto multiplica por 2). Se cae en `, h('strong', String(f.r)), ': el sobre cerrado.']
      : [`El número al azar k = ${f.k}: sumar G ${f.k} veces. Se cae en `, h('strong', ver(f.r)), ': el sobre cerrado. Los saltos parecen al azar.'];
  }
  return zp
    ? [`La clave privada x = ${L.A.x} son ${L.A.x} saltos hacia atrás desde el 1. Se cae en `, h('strong', ver(y)), ': la clave pública.']
    : [`La clave privada x = ${L.A.x} son ${L.A.x} saltos «hacia atrás» (−G, −2·G, …). Se cae en `, h('strong', ver(y)), ': la clave pública.'];
}

// ================================================================ B · multifirma
function armarB(ctx) {
  const L = ctx.local;
  const G = GRUPOS[L.grupo];
  const d = G.def;
  const id = L.id;
  const B = { x1: d.x1, x2: d.x2, k1: d.k1, k2: d.k2, res: null, hecho: 0, boton: [], area: [], paso: [] };
  L.B = B;

  // ---------------------------------------------------------- paso 1 · llave conjunta
  B.dX1 = deslizador({ id: id('x1'), nombre: 'x1', sim: 'x1', llano: 'clave privada de Alicia', min: 1, max: G.q - 1, valor: B.x1,
    alCambiar: (v) => { B.x1 = v; reiniciarB(ctx, 1); } });
  B.dX2 = deslizador({ id: id('x2'), nombre: 'x2', sim: 'x2', llano: 'clave privada de Beto', min: 1, max: G.q - 1, valor: B.x2,
    alCambiar: (v) => { B.x2 = v; reiniciarB(ctx, 1); } });
  B.campoM = campoNumero({ id: id('bm'), nombre: 'M', sim: 'M', llano: 'número de título', min: 0, max: 999, valor: d.M, ayuda: 'El mismo título para las dos universidades.' });
  B.campoM.input.addEventListener('input', () => { ctx.ui.limpiarCampos(B.form1); reiniciarB(ctx, 1); });
  B.boton[1] = h('button.boton.boton--primario', { type: 'submit' }, icono('llave'), h('span', 'Calcular la llave conjunta'));
  B.form1 = h('form.sch-form', { novalidate: true },
    h('div.sch-par', lado('Alicia', 'UAN', B.dX1), lado('Beto', 'UNAM', B.dX2)),
    h('div.sch-campos', B.campoM),
    h('div.esq-acciones', B.boton[1]));
  B.form1.addEventListener('submit', (e) => { e.preventDefault(); avanzarB(ctx, 1); });
  for (let n = 1; n <= 4; n++) B.area[n] = h('div.sch-area', { 'aria-live': 'polite' });
  B.paso[1] = K.paso({ n: 1, titulo: 'Cada universidad pone su llave', id: id('b1'),
    ayuda: 'Alicia firma por la UAN y Beto por la UNAM. Cada uno tiene su clave privada. Con las dos claves públicas se arma una sola: la llave conjunta.' },
  B.form1, B.area[1]);

  // ---------------------------------------------------------- paso 2 · ronda 1
  B.dK1 = deslizador({ id: id('k1'), nombre: 'k1', sim: 'k1', llano: 'número al azar de Alicia', min: 1, max: G.q - 1, valor: B.k1,
    alCambiar: (v) => { B.k1 = v; reiniciarB(ctx, 2); } });
  B.dK2 = deslizador({ id: id('k2'), nombre: 'k2', sim: 'k2', llano: 'número al azar de Beto', min: 1, max: G.q - 1, valor: B.k2,
    alCambiar: (v) => { B.k2 = v; reiniciarB(ctx, 2); } });
  const dado = h('button.boton.boton--secundario', { type: 'button' }, icono('dado'), h('span', 'Otros números al azar'));
  dado.addEventListener('click', () => {
    let a;
    let b;
    do { a = alAzar(1, G.q - 1); b = alAzar(1, G.q - 1); } while ((a + b) % G.q === 0 || (a === B.k1 && b === B.k2));
    B.k1 = a;
    B.k2 = b;
    B.dK1.fijar(a);
    B.dK2.fijar(b);
    reiniciarB(ctx, 2);
  });
  B.boton[2] = h('button.boton.boton--primario', { type: 'submit', disabled: true }, icono('sello'), h('span', 'Mandar solo las huellas'));
  B.form2 = h('form.sch-form', { novalidate: true },
    h('div.sch-par', lado('Alicia', 'UAN', B.dK1), lado('Beto', 'UNAM', B.dK2)),
    h('div.esq-acciones', B.boton[2], dado));
  B.form2.addEventListener('submit', (e) => { e.preventDefault(); avanzarB(ctx, 2); });
  B.paso[2] = K.paso({ n: 2, titulo: 'Ronda 1 · Cada uno sella su sobre', estado: 'espera', id: id('b2'),
    ayuda: 'Cada uno inventa su número al azar y prepara su sobre cerrado, pero todavía no lo enseña: manda solo su huella. Así nadie puede cambiar su sobre después de ver el del otro.' },
  B.form2, B.area[2]);

  // ---------------------------------------------------------- paso 3 · ronda 2
  B.boton[3] = h('button.boton.boton--primario', { type: 'button', disabled: true }, icono('candado'), h('span', 'Abrir los sobres'));
  B.boton[3].addEventListener('click', () => avanzarB(ctx, 3));
  B.paso[3] = K.paso({ n: 3, titulo: 'Ronda 2 · Abren los sobres', estado: 'espera', id: id('b3'),
    ayuda: 'Con las dos huellas ya en la mesa, cada uno abre su sobre y el otro comprueba que coincide con la huella que recibió. Los dos sobres se juntan en uno.' },
  h('div.esq-acciones', B.boton[3]), B.area[3]);

  // ---------------------------------------------------------- paso 4 · ronda 3
  B.boton[4] = h('button.boton.boton--primario', { type: 'button', disabled: true }, icono('firma'), h('span', 'Poner las partes y firmar'));
  B.boton[4].addEventListener('click', () => avanzarB(ctx, 4));
  B.veredicto = K.veredicto({ vacio: '' });
  B.veredicto.hidden = true;
  B.explica = K.explicacion();
  B.paso[4] = K.paso({ n: 4, titulo: 'Ronda 3 · Cada uno pone su parte', estado: 'espera', id: id('b4'),
    ayuda: 'Del sobre conjunto y el título sale un solo reto para los dos. Cada uno responde con su parte; las partes se suman y queda una sola firma.' },
  h('div.esq-acciones', B.boton[4]), B.area[4], B.veredicto, B.explica);

  // ---------------------------------------------------------- trampas
  B.trampas = K.trampas([
    { etiqueta: 'Ataque de la llave tramposa', texto: 'Beto inventa su llave pública para «borrar» la de Alicia y firmar él solo.', fn: (b) => trampaLlaveTramposa(ctx, b) },
    { etiqueta: 'Beto manda una parte equivocada', texto: 'Cambia su parte de la firma para sabotearla.', fn: (b) => trampaParteFalsa(ctx, b) },
  ]);
  B.trampas.hidden = true;
  B.tVer = K.veredicto({ vacio: '' });
  B.tVer.hidden = true;
  B.tExp = K.explicacion();
  B.trampas.append(B.tVer, B.tExp);

  K.reemplazar(L.zonaB,
    cabezaBloque('B', id('b'), 'Doble titulación: UAN y UNAM firman juntas',
      'Una egresada termina un programa conjunto. Las dos universidades deben firmar su título, pero el resultado es una sola firma, igual de corta que la de una universidad sola.'),
    h('div.esq-pasos', B.paso[1], B.paso[2], B.paso[3], B.paso[4]),
    B.trampas);
}

/** Algo cambió en el paso `desde`: se borra lo hecho a partir de ahí. */
function reiniciarB(ctx, desde) {
  const B = ctx.local.B;
  const listo = Math.min(B.hecho, desde - 1);
  B.hecho = listo;
  for (let n = desde; n <= 4; n++) {
    K.reemplazar(B.area[n]);
    const toca = n === listo + 1;
    K.marcarPaso(B.paso[n], toca ? 'activo' : 'espera');
    B.boton[n].disabled = !toca;
  }
  K.pintarVeredicto(B.veredicto, null);
  B.veredicto.hidden = true;
  K.explicar(B.explica);
  B.trampas.hidden = true;
  B.tVer.hidden = true;
  K.explicar(B.tExp);
}

async function avanzarB(ctx, n) {
  const L = ctx.local;
  const B = L.B;
  if (n > B.hecho + 1) return;
  if (n <= B.hecho) reiniciarB(ctx, n);          // rehacer un paso ya hecho borra lo que venía después
  const cuerpo = { grupo: L.grupo, x1: B.x1, x2: B.x2, k1: B.k1, k2: B.k2, M: numero(B.campoM.input) };
  K.reemplazar(B.area[n]);
  let r;
  try {
    r = await ctx.ui.ocupado(B.boton[n], K.post('schnorr/multifirma', cuerpo));
  } catch (e) {
    if (L.B !== B) return;
    if (e?.codigo === 'caso_degenerado') { avisoEn(B.area[n], e.message); return; }
    ctx.ui.mostrarError(e, { form: ['k1', 'k2'].includes(e?.campo) ? B.form2 : B.form1, titulo: 'No se pudo firmar' });
    return;
  }
  if (L.B !== B || cuerpo.x1 !== B.x1 || cuerpo.x2 !== B.x2 || cuerpo.k1 !== B.k1 || cuerpo.k2 !== B.k2 || cuerpo.M !== numero(B.campoM.input)) return;
  B.res = r;
  B.hecho = n;
  pintarPasoB(ctx, n);
  K.marcarPaso(B.paso[n], 'hecho');
  if (n < 4) {
    K.marcarPaso(B.paso[n + 1], 'activo');
    B.boton[n + 1].disabled = false;
  }
  K.anim.entrar(B.area[n]);
}

function pintarPasoB(ctx, n) {
  const L = ctx.local;
  const B = L.B;
  const G = GRUPOS[L.grupo];
  const r = B.res;
  const [a, b] = r.firmantes;
  const zp = L.grupo === 'zp';
  if (n === 1) {
    K.reemplazar(B.area[1],
      h('div.sch-par',
        lado('Alicia', 'UAN', h('div.sch-fila', display(`${G.Y}1`, 'clave pública', ver(a.y), { tono: 'publica' }), display('a1', 'peso', a.a)), h('p.esq-cuenta', a.cuenta_a)),
        lado('Beto', 'UNAM', h('div.sch-fila', display(`${G.Y}2`, 'clave pública', ver(b.y), { tono: 'publica' }), display('a2', 'peso', b.a)), h('p.esq-cuenta', b.cuenta_a))),
      h('p.sch-llano', 'El peso de cada llave sale de la huella de las dos llaves juntas: nadie lo elige. Más abajo verás para qué sirve.'),
      h('div.sch-conjunta',
        display(G.conj, 'llave conjunta', ver(r.clave_conjunta), { tono: 'publica', grande: true }),
        h('div.sch-conjunta__texto',
          h('p', 'Es la única llave que verá quien verifique. Se arma con las dos llaves públicas y sus pesos: ',
            h('code', zp ? 'ỹ = y1^a1 · y2^a2' : 'Ỹ = a1·Y1 + a2·Y2'), '.'),
          h('p.sch-nota', `Su clave privada sería a1 × x1 + a2 × x2 = ${a.a} × ${a.x} + ${b.a} × ${b.x} = ${a.a * a.x + b.a * b.x} → ${r.x_conjunta_teorica} (módulo ${G.q}), pero nadie la calcula: Alicia no sabe x2 y Beto no sabe x1.`))));
    K.narrar(ctx, 'Llave conjunta lista', `UAN y UNAM juntaron sus llaves públicas en una sola: ${ver(r.clave_conjunta)}.`, 'info');
  } else if (n === 2) {
    K.reemplazar(B.area[2],
      h('div.sch-par',
        lado('Alicia', 'UAN', display('t1', 'huella de su sobre', a.huella, { tono: 'huella' }), h('p.sch-nota', `Su sobre ${G.R}1 sigue cerrado.`)),
        lado('Beto', 'UNAM', display('t2', 'huella de su sobre', b.huella, { tono: 'huella' }), h('p.sch-nota', `Su sobre ${G.R}2 sigue cerrado.`))),
      h('p.sch-llano', 'Lo único que viaja son estas huellas: 8 letras y números que no revelan el sobre. Como ya están en la mesa, nadie puede cambiar su sobre al ver el del otro.'));
    K.narrar(ctx, 'Ronda 1: huellas en la mesa', 'Alicia y Beto mandaron solo la huella de su sobre cerrado.', 'info');
  } else if (n === 3) {
    const c1 = h('p.sch-check', { dataset: { ok: 'espera' } }, 'Beto comprueba la huella…');
    const c2 = h('p.sch-check', { dataset: { ok: 'espera' } }, 'Alicia comprueba la huella…');
    const sumaR = zp
      ? `r = r1·r2 = ${a.r}·${b.r} = ${a.r * b.r}${a.r * b.r !== r.r ? ` ≡ ${r.r}` : ''} (mod 23)`
      : `R = R1 + R2 = ${ver(a.r)} + ${ver(b.r)} = ${ver(r.r)}`;
    K.reemplazar(B.area[3],
      h('div.sch-par',
        lado('Alicia', 'UAN', display(`${G.R}1`, 'su sobre', ver(a.r), { tono: 'sobre' }), c1),
        lado('Beto', 'UNAM', display(`${G.R}2`, 'su sobre', ver(b.r), { tono: 'sobre' }), c2)),
      h('div.sch-conjunta',
        display(G.R, 'sobre conjunto', ver(r.r), { tono: 'sobre', grande: true }),
        h('div.sch-conjunta__texto',
          h('p', zp ? 'Los dos sobres se juntan en uno multiplicándolos en el reloj:' : 'Los dos sobres se juntan en uno sumándolos en la curva:'),
          h('p.esq-cuenta', sumaR))));
    pintarCheck(L.grupo, a.r, a.huella, c1, 'Beto comprobó la huella: coincide');
    pintarCheck(L.grupo, b.r, b.huella, c2, 'Alicia comprobó la huella: coincide');
    K.narrar(ctx, 'Ronda 2: sobres abiertos', `Cada sobre coincide con su huella. El sobre conjunto es ${ver(r.r)}.`, 'info');
  } else {
    K.reemplazar(B.area[4],
      h('div.sch-fila', display('e', 'reto común', r.e, { tono: 'reto' }), h('p.esq-cuenta', r.cuentas.e)),
      h('div.sch-par',
        lado('Alicia', 'UAN', display('s1', 'su parte', a.s), h('p.esq-cuenta', a.cuenta_s), check(a.parcial_ok, 'Beto revisó esta parte: cuadra', 'Esta parte no cuadra')),
        lado('Beto', 'UNAM', display('s2', 'su parte', b.s), h('p.esq-cuenta', b.cuenta_s), check(b.parcial_ok, 'Alicia revisó esta parte: cuadra', 'Esta parte no cuadra'))),
      h('div.sch-firma',
        h('p.sch-firma__etiqueta', 'Una sola firma para el título ', h('strong', String(r.M)), ': la pareja (s, e)'),
        h('p.sch-firma__valor', `(${r.s}, ${r.e})`),
        h('p.esq-cuenta', r.cuentas.s),
        h('p.sch-firma__nota', `Se comprueba con la llave conjunta ${ver(r.clave_conjunta)}. Ocupa lo mismo que la firma de una universidad sola.`)));
    const v = r.verificacion;
    B.veredicto.hidden = false;
    K.pintarVeredicto(B.veredicto, v.valida
      ? { estado: 'ok', titulo: 'Una sola firma, y es válida',
        texto: ['Se comprobó como cualquier firma normal, con la llave conjunta: ', simbolo('e_v'), ` = ${v.ev} = e.`],
        extra: h('p.esq-cuenta', [v.cuentas.gs, v.cuentas.ye, v.cuentas.rv, v.cuentas.ev].join('\n')) }
      : { estado: 'mal', titulo: 'La firma conjunta no pasó', texto: v.cuentas.ev });
    K.explicar(B.explica,
      h('p', h('strong', 'Quien verifica no puede saber que firmaron dos:'), ' solo ve una llave y una firma, iguales a las de una sola universidad.'),
      'Funciona porque las respuestas se pueden sumar: la parte de Alicia más la de Beto es justo la respuesta que daría la llave conjunta. En Bitcoin (Taproot), así un pago que exige dos firmas se ve —y cuesta— igual que uno normal.');
    B.trampas.hidden = false;
    B.tVer.hidden = true;
    K.explicar(B.tExp);
    K.narrar(ctx, 'UAN y UNAM firmaron juntas', `Una sola firma (${r.s}, ${r.e}) con la llave conjunta ${ver(r.clave_conjunta)}. Nadie puede saber que fueron dos.`, 'ok');
  }
}

/** La huella se recalcula de verdad en el navegador: SHA-256(«com|r»), primeros 8 dígitos hexadecimales. */
async function pintarCheck(grupo, R, huella, el, siTexto) {
  let ok = null;
  try {
    if (globalThis.crypto?.subtle) {
      const contenido = grupo === 'zp' ? `com|${R}` : `com|${R[0]},${R[1]}`;
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contenido));
      ok = Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('').slice(0, 8) === huella;
    }
  } catch { ok = null; }
  if (!el.isConnected) return;
  if (ok === null) {
    K.reemplazar(el, icono('info'), h('span', 'Este navegador no puede recalcular la huella aquí.'));
    el.dataset.ok = 'espera';
    return;
  }
  K.reemplazar(el, icono(ok ? 'ok' : 'x'), h('span', ok ? `${siTexto} (la recalculó tu navegador)` : 'La huella NO coincide: alguien cambió su sobre'));
  el.dataset.ok = ok ? 'si' : 'no';
}

// ------------------------------------------------------------ trampas B
async function trampaLlaveTramposa(ctx, boton) {
  const L = ctx.local;
  const B = L.B;
  const r = await K.accion(ctx, boton, K.post('schnorr/ataque', {}));
  if (!r || L.B !== B) return;
  B.tVer.hidden = false;
  const defendido = r.acepta_ingenua && !r.acepta_con_coeficientes;
  K.pintarVeredicto(B.tVer, {
    estado: defendido ? 'ok' : 'aviso',
    titulo: defendido ? 'Los pesos frenan la trampa' : 'Resultado inesperado',
    texto: 'Sin pesos, Beto habría firmado él solo como si fueran los dos. Con pesos, esa misma firma se rechaza.',
    extra: h('ul.sch-comparar', { role: 'list' },
      h('li', h('span', 'Llave «conjunta» sin pesos: ', h('strong.mono', String(r.clave_ingenua))),
        ctx.ui.chip(r.acepta_ingenua ? 'acepta la firma de Beto solo' : 'la rechaza', r.acepta_ingenua ? 'rechazado' : 'valido')),
      h('li', h('span', 'Llave conjunta con pesos: ', h('strong.mono', String(r.clave_con_coeficientes))),
        ctx.ui.chip(r.acepta_con_coeficientes ? 'la acepta' : 'la rechaza', r.acepta_con_coeficientes ? 'rechazado' : 'valido'))),
  });
  K.explicar(B.tExp,
    h('p', `Beto ya conocía la llave pública de Alicia (${r.y1}). Eligió un secreto propio (${r.x_estrella}) y anunció como suya una llave falsa, ${r.y2_falsa}, calculada para que al multiplicarla por la de Alicia saliera ${r.y_estrella}: una llave que solo él controla. Con ella firmó solo: (${r.firma_beto_solo.s}, ${r.firma_beto_solo.e}).`),
    h('p.esq-cuenta', r.cuenta),
    'Con pesos, cada llave se eleva a un número que sale de la huella de las DOS llaves. Si Beto cambia la suya, cambian los dos pesos y ya no puede prever el resultado.',
    L.grupo === 'curva' ? h('p.sch-nota', 'Este ejemplo usa el reloj de 23 horas, como en el documento.') : null);
  K.narrar(ctx, 'Trampa frenada', 'Sin pesos, Beto podía firmar solo por los dos. Con pesos, no.', defendido ? 'ok' : 'aviso');
}

async function trampaParteFalsa(ctx, boton) {
  const L = ctx.local;
  const B = L.B;
  const r = B.res;
  if (!r || B.hecho < 4) return;
  const q = GRUPOS[L.grupo].q;
  const beto = r.firmantes[1];
  // Beto suma algo a su parte. Con tan pocos retos posibles, un cambio puede cuadrar por suerte
  // (eso ya lo enseña «Inventar una firma»); aquí se prueba con el siguiente hasta que no cuadre.
  let delta = 1;
  let v = null;
  for (let d = 1; d < Math.min(q, 6); d++) {
    delta = d;
    v = await K.accion(ctx, boton, K.post('schnorr/verificar', { grupo: L.grupo, y: r.clave_conjunta, M: r.M, s: (r.s + d) % q, e: r.e }));
    if (!v || L.B !== B || B.res !== r) return;
    if (!v.valida) break;
  }
  const s2 = (beto.s + delta) % q;
  const sMal = (r.s + delta) % q;
  B.tVer.hidden = false;
  if (v.valida) {
    K.pintarVeredicto(B.tVer, { estado: 'aviso', titulo: 'Pasó… por pura casualidad',
      texto: `Con la parte de Beto cambiada (${s2} en vez de ${beto.s}), la firma (${sMal}, ${r.e}) cuadró de suerte.` });
    K.explicar(B.tExp, `Con solo ${q} retos posibles, a veces pasa. Con números de verdad, no. Y aun así se detectaría: cada uno revisa la parte del otro antes de sumar.`);
    return;
  }
  K.pintarVeredicto(B.tVer, {
    estado: 'mal', titulo: 'Saboteo detectado: la firma no pasa',
    texto: [`Beto mandó ${s2} en vez de ${beto.s}. La suma da s = ${sMal} y quien verifica obtiene `, simbolo('e_v'), v.ev === null ? ' sin valor' : ` = ${v.ev}`, `, no e = ${r.e}.`],
    extra: h('p.esq-cuenta', [v.cuentas.rv, v.cuentas.ev].join('\n')),
  });
  K.explicar(B.tExp,
    'Una sola parte equivocada echa a perder la firma entera.',
    'Y no hace falta adivinar quién fue: antes de sumar, cada uno revisa la parte del otro con su llave pública (la regla está en «Ver las cuentas»). La de Beto no cuadraría.');
  K.narrar(ctx, 'Saboteo detectado', 'Con la parte de Beto alterada, la firma conjunta se rechaza.', 'aviso');
}

// ================================================================ cuentas
const RECETA = {
  zp: [
    'Parámetros:  p = 23, q = 11, g = 2   (reloj de 23 horas; los saltos tienen 11 posiciones)',
    'Claves:      x al azar (secreta);  y = g^(−x) mod 23',
    'Firmar M:    k al azar;  r = g^k;  e = H(r ‖ M);  s = k + x·e (mod 11)  →  firma (s, e)',
    'Verificar:   r_v = g^s · y^e;  e_v = H(r_v ‖ M);  vale si e_v = e',
    'Por qué:     g^s · y^e = g^(k + x·e) · g^(−x·e) = g^k = r',
  ].join('\n'),
  curva: [
    'Parámetros:  y² = x³ + 2x + 2 sobre F17;  G = (5, 1);  q = 19 (18 lugares + 𝒪)',
    'Claves:      x al azar (secreta);  Y = −x·G',
    'Firmar M:    k al azar;  R = k·G;  e = H(x_R ‖ y_R ‖ M);  s = k + x·e (mod 19)  →  firma (s, e)',
    'Verificar:   R_v = s·G + e·Y;  e_v = H(R_v ‖ M);  vale si e_v = e',
    'Por qué:     s·G + e·Y = (k + x·e)·G − x·e·G = k·G = R',
  ].join('\n'),
};

const MUSIG = {
  zp: [
    'Pesos:           a_i = H(y1 ‖ y2 ‖ y_i)',
    'Llave conjunta:  ỹ = y1^a1 · y2^a2      (su clave privada sería a1·x1 + a2·x2: nadie la calcula)',
    'Ronda 1:         cada uno elige k_i, calcula r_i = g^(k_i) y manda solo t_i = SHA-256(«com|r_i»)',
    'Ronda 2:         revelan r_i, comprueban la huella del otro;  r = r1·r2',
    'Ronda 3:         e = H(r ‖ M);  s_i = k_i + a_i·x_i·e (mod 11);  s = s1 + s2',
    'Revisar parte:   g^(s_i) · y_i^(a_i·e) = r_i',
    'Verificar:       igual que una firma sola, con ỹ',
  ].join('\n'),
  curva: [
    'Pesos:           a_i = H(x_Y1 ‖ x_Y2 ‖ x_Yi)   (solo la coordenada x, para que las cuentas sean cortas)',
    'Llave conjunta:  Ỹ = a1·Y1 + a2·Y2     (su clave privada sería a1·x1 + a2·x2: nadie la calcula)',
    'Ronda 1:         R_i = k_i·G;  se manda solo t_i = SHA-256(«com|x_R,y_R»)',
    'Ronda 2:         revelan R_i, comprueban la huella del otro;  R = R1 + R2',
    'Ronda 3:         e = H(x_R ‖ y_R ‖ M);  s_i = k_i + a_i·x_i·e (mod 19);  s = s1 + s2',
    'Revisar parte:   s_i·G + (a_i·e)·Y_i = R_i',
    'Verificar:       igual que una firma sola, con Ỹ',
  ].join('\n'),
};

function tablaFilas(titulo, filas) {
  return h('div.tabla-marco', h('table.tabla.sch-tabla',
    h('caption.solo-lectores', titulo),
    h('tbody', filas.map(([cabeza, ...valores]) => h('tr', h('th', { scope: 'row' }, cabeza), valores.map((v) => h('td', String(v))))))));
}

function pintarCuentas(ctx) {
  const L = ctx.local;
  const zp = L.grupo === 'zp';
  const t = L.tablas[L.grupo];
  const partes = [
    h('p', 'Todo lo de arriba sale de cinco renglones. ', h('code', 'H'), ' es la huella de juguete; ', h('code', '‖'), ' significa «escribir seguido».'),
    h('h4.sch-sub', 'La receta completa'),
    h('p.esq-cuenta', RECETA[L.grupo]),
    h('h4.sch-sub', 'La huella de juguete'),
    h('p', 'Una huella de verdad (SHA-256) no se puede calcular a mano. Aquí se usa una de juguete: se escriben seguidos los dígitos y se toma lo que sobra al dividir entre q. ',
      zp ? 'Por ejemplo, H(13 ‖ 14) = 1314 mod 11 = 5, porque 1314 = 11·119 + 5.' : 'Por ejemplo, H(7 ‖ 11 ‖ 14) = 71114 mod 19 = 16, porque 71114 = 19·3742 + 16.'),
  ];
  if (!t) {
    partes.push(h('p.texto-3', L.errorTablas ? 'No se pudieron cargar las tablas.' : 'Cargando las tablas…'));
  } else if (zp) {
    partes.push(
      h('h4.sch-sub', 'Tabla 1 · Potencias de 2 en el reloj de 23'),
      h('p', 'Cada casilla es la anterior por 2 (y se resta 23 si se pasa). Con ella se hacen todas las cuentas del reloj.'),
      tablaFilas('Potencias de 2 módulo 23', [['a', ...t.potencias.map((p) => p.a)], ['2^a mod 23', ...t.potencias.map((p) => p.valor)]]),
      h('h4.sch-sub', 'Inversos módulo 11 (para «dividir» con s, e, x y k)'),
      tablaFilas('Inversos módulo 11', [['a', ...t.inversos_q.map((p) => p.a)], ['a⁻¹ mod 11', ...t.inversos_q.map((p) => p.inverso)]]));
  } else {
    partes.push(
      h('h4.sch-sub', 'Tabla 3 · Múltiplos de G = (5, 1)'),
      h('p', 'Sumar G una y otra vez recorre los 18 lugares de la curva y, al paso 19, regresa al «punto al infinito» 𝒪. Fíjate: (19 − k)·G es el reflejo de k·G.'),
      h('ol.sch-multiplos', { role: 'list' }, t.multiplos.map((m) => h('li', h('span.sch-multiplos__k', `${m.k}·G`), h('span', ver(m.punto))))),
      h('h4.sch-sub', 'Inversos módulo 17 (para las coordenadas)'),
      tablaFilas('Inversos módulo 17', [['a', ...t.inversos_p.map((p) => p.a)], ['a⁻¹ mod 17', ...t.inversos_p.map((p) => p.inverso)]]),
      h('h4.sch-sub', 'Inversos módulo 19 (para s, e, x y k)'),
      tablaFilas('Inversos módulo 19', [['a', ...t.inversos_q.map((p) => p.a)], ['a⁻¹ mod 19', ...t.inversos_q.map((p) => p.inverso)]]));
  }
  partes.push(
    h('h4.sch-sub', 'La multifirma, renglón por renglón'),
    h('p.esq-cuenta', MUSIG[L.grupo]),
    h('p', h('strong', 'Dos simplificaciones del documento: '), 'el reto es e = H(r ‖ M), sin la llave conjunta (en MuSig de verdad va incluida, y la seguridad depende de ello), y de cada huella se muestran solo los primeros 8 dígitos hexadecimales.'),
    h('h4.sch-sub', 'El mismo esquema, dos maneras de escribirlo'),
    h('div.tabla-marco', h('table.tabla.sch-tabla.sch-tabla--dicc',
      h('caption.solo-lectores', 'Diccionario entre el reloj y la curva'),
      h('thead', h('tr', h('th', { scope: 'col' }, 'Concepto'), h('th', { scope: 'col' }, 'Reloj (se multiplica)'), h('th', { scope: 'col' }, 'Curva (se suma)'))),
      h('tbody', [
        ['Operación', 'a·b mod p', 'P + Q'],
        ['Neutro', '1', '𝒪'],
        ['Generador', 'g', 'G'],
        ['Repetir k veces', 'g^k', 'k·G'],
        ['Clave pública', 'y = g^(−x)', 'Y = −x·G'],
        ['Sobre cerrado', 'r = g^k', 'R = k·G'],
        ['Verificación', 'r_v = g^s·y^e', 'R_v = s·G + e·Y'],
      ].map(([c, a, b]) => h('tr', h('th', { scope: 'row' }, c), h('td', a), h('td', b)))))));
  K.reemplazar(L.cuentasCuerpo, partes);
}

function saberMas() {
  return K.saberMas(
    h('ul',
      h('li', h('strong', 'Bitcoin: '), 'desde Taproot (noviembre de 2021) acepta firmas de Schnorr sobre la curva secp256k1 (BIP-340). Es esta misma receta, con números de 78 cifras: la firma ocupa 64 bytes.'),
      h('li', h('strong', 'Ed25519: '), 'una firma de Schnorr sobre otra curva, con el número al azar sacado del propio mensaje para no depender de la suerte. Está en SSH, TLS 1.3 y Signal, y firma las transacciones de Solana, Cardano y otras cadenas.'),
      h('li', h('strong', 'Firmar entre varios: '), 'MuSig2 (BIP-327) hace la multifirma en dos rondas y la usan los canales de Lightning. FROST (RFC 9591, 2024) permite firmar con «cualesquiera 3 de 5», repartiendo la llave con el esquema 1 de esta sección (Shamir).'),
      h('li', h('strong', 'Firmas adaptadoras: '), 'una firma «a medias» que se completa al revelar un secreto. Permiten intercambios entre cadenas sin intermediarios y contratos que pagan según lo que firme un oráculo (DLC).')),
    h('p', h('strong', 'Lo que el juguete omite: '), 'números de 256 bits, una huella de verdad (SHA-256 con etiquetas), la clave pública dentro del reto y un número al azar que jamás se repite (muchas bibliotecas lo derivan de la clave y el mensaje).'),
    h('p', h('strong', 'Límites: '), 'una computadora cuántica grande rompería Schnorr igual que a ECDSA; en Bitcoin ya se discute cómo migrar (BIP-360, en borrador). La multifirma exige rondas de mensajes y guardar con cuidado los números al azar: repetir uno expone la llave. Y como no revela quién firmó, cuesta auditar responsabilidades dentro del grupo.'));
}
