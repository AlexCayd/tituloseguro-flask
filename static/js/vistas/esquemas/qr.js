// ESQUEMA 2 · Respaldo en códigos QR (Shamir sobre GF(2⁸) + QR · criptografía visual).
//  Idea 1 · el QR GUARDA un pedazo:  1 escribe el secreto y elige «k de n» → 2 se imprimen n hojas con
//    un QR cada una (sola, ninguna dice nada) → 3 escanea hojas y recupera. Trampas: una hoja manchada
//    (la delata su código de control), una alterada y disimulada (la delata la comprobación escondida
//    dentro del secreto) y una de otro respaldo (la delata el número de serie). Plegado: «¿Y si el
//    secreto es largo?» (documento cifrado en un QR público + su llave repartida en QR chiquitos).
//  Idea 2 · el QR ES el secreto:  un QR partido en dos acetatos de ruido; al encimarlos aparece, y un
//    paso de limpieza lo deja legible para un teléfono. Plegado: la versión digital con 3 sombras.
//  Las cuentas (GF(2⁸), CRC-32, Base32, SHA-256) se rehacen aquí con los datos reales del servidor.
// API: POST /api/esquemas/qr/repartir | /leer | /alterar | /boveda | /boveda/abrir | /visual

import * as K from './_kit.js';

const { h, icono, texto, attr } = K;
const SECRETO_INICIAL = 'Clave de la bóveda de títulos: TS-7F3A-91C2';
const OTRO_SECRETO = 'Clave del archivo histórico: AH-22B9-0C41';
const URL_INICIAL = 'https://titulo-seguro.mx/verificar?folio=7F3A-91C2';
const DOC_INICIAL = [
  'Instrucciones de emergencia · Bóveda de títulos',
  '1. Reunir a 2 de los 3 custodios en la sala de servidores.',
  '2. Escanear sus llaves en un equipo sin conexión a internet.',
  '3. Abrir la bóveda y levantar un acta firmada por los presentes.',
].join('\n');
const MAX_BYTES = 120;
const PLANES = [{ k: 2, n: 3 }, { k: 3, n: 5 }, { k: 4, n: 7 }];
// a quién se entrega cada hoja (hoja x → CUSTODIOS[x − 1]): un lugar distinto para cada una
const CUSTODIOS = ['Rectoría de la UAN', 'Notaría pública 7', 'Caja fuerte del banco', 'Rectoría de la UNAM',
  'Auditoría externa', 'Servicios Escolares', 'Rectoría del IPN'];
const ESTADOS = {
  manchada: { sello: 'Manchada', nivel: 'aviso' },
  alterada: { sello: 'Alterada a escondidas', nivel: 'mal' },
  ajena: { sello: 'De otro respaldo', nivel: 'mal' },
};
const bytes = (t) => new TextEncoder().encode(t).length;
const custodio = (x) => CUSTODIOS[x - 1] ?? `Custodio ${x}`;
const serie = (id) => `${id.slice(0, 4)}·${id.slice(4)}`;
const enLista = (xs) => (xs.length <= 1 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
const nHojas = (n) => (n === 1 ? '1 hoja' : `${n} hojas`);
const miles = (n) => n.toLocaleString('es-MX');

export default {
  montar(host, ctx, meta) {
    const L = Object.assign(ctx.local, {
      k: 3, n: 5, reparto: null, hojas: [], lector: new Set(), ultimo: null, otros: new Map(), secretoImpreso: '',
      vis: null, visTexto: '', visP: 0, visVisto: false, xor: null, xorSel: new Set([1, 2]), bov: null, bovSel: new Set(),
    });
    const id = (x) => `esq-qr-${ctx.modo}-${x}`;
    L.id = id;

    // ------------------------------------------------------------ paso 1
    L.entrada = h('input.entrada', { id: id('secreto'), name: 'secreto', value: SECRETO_INICIAL, autocomplete: 'off', spellcheck: 'false' });
    L.contador = h('p.campo__ayuda', { id: id('secreto-ayuda') });
    L.entrada.setAttribute('aria-describedby', L.contador.id);
    L.entrada.addEventListener('input', () => { pintarContador(L); ctx.ui.limpiarCampos(L.form); });
    L.segPlan = K.segmentado({ nombre: 'plan', etiqueta: '¿Cuántas hojas hacen falta?', valor: `${L.k}-${L.n}`,
      opciones: PLANES.map((p) => ({ valor: `${p.k}-${p.n}`, texto: `${p.k} de ${p.n}` })),
      alCambiar: (v) => { [L.k, L.n] = String(v).split('-').map(Number); pintarFrase(L); } });
    L.frase = h('p.esq-frase', { 'aria-live': 'polite' });
    L.botonImprimir = h('button.boton.boton--primario', { type: 'submit' }, icono('qr'), h('span', 'Imprimir 5 hojas'));
    L.form = h('form.esq-form', { novalidate: true },
      h('div.esq-campos',
        h('div.campo.campo--ancho', h('label.campo__etiqueta', { for: L.entrada.id }, 'El secreto'), L.entrada, L.contador),
        h('div.campo', h('span.campo__etiqueta', '¿Cuántas hojas hacen falta?'), L.segPlan)),
      L.frase,
      h('div.esq-acciones', L.botonImprimir));
    L.form.addEventListener('submit', (e) => { e.preventDefault(); imprimir(ctx); });
    pintarContador(L);
    pintarFrase(L);
    L.paso1 = K.paso({ n: 1, titulo: 'Escribe el secreto y elige cuántas hojas', id: id('p1'),
      ayuda: 'Puede ser una contraseña, una clave o una frase corta. Luego elige cuántas hojas se imprimen y cuántas hacen falta para recuperarlo.' }, L.form);

    // ------------------------------------------------------------ paso 2
    L.hojasLista = h('ol.qr-hojas', { role: 'list' });
    L.espera2 = h('p.qr-espera', 'Primero imprime las hojas en el paso 1.');
    L.botonAzar = h('button.boton.boton--primario', { type: 'button' }, icono('dado'), h('span', 'Escanear 3 hojas al azar'));
    L.botonRestaurar = h('button.boton.boton--fantasma', { type: 'button', hidden: true }, icono('reiniciar'), h('span', 'Volver a las hojas originales'));
    L.botonAzar.addEventListener('click', () => { elegirAlAzar(L, L.reparto.k); pintarSeleccion(ctx); });
    L.botonRestaurar.addEventListener('click', () => {
      restaurar(ctx);
      K.pintarVeredicto(L.veredicto, null);
      K.explicar(L.explica);
      L.botonAzar.focus();
    });
    L.acciones2 = h('div.esq-acciones', { hidden: true }, L.botonAzar, L.botonRestaurar);
    L.paso2 = K.paso({ n: 2, titulo: 'Las hojas impresas: una para cada quien', estado: 'espera', id: id('p2'),
      ayuda: 'Cada hoja lleva un QR distinto y, sola, no dice nada del secreto. Por eso cada una va a una persona y a un lugar distinto. Pulsa «Escanear» en las hojas que quieras llevar al lector.' },
    L.espera2, L.hojasLista, L.acciones2);

    // ------------------------------------------------------------ paso 3
    L.ranuras = h('ol.qr-ranuras', { role: 'list', 'aria-hidden': 'true' });
    L.barrido = h('span.qr-lector__barrido', { 'aria-hidden': 'true' });
    L.lectorTexto = h('p.qr-lector__texto', { 'aria-live': 'polite' });
    L.botonLeer = h('button.boton.boton--primario', { type: 'button', disabled: true }, icono('llave'), h('span', 'Recuperar el secreto'));
    L.botonVaciar = h('button.boton.boton--fantasma', { type: 'button', disabled: true }, 'Vaciar el lector');
    L.botonLeer.addEventListener('click', () => leer(ctx));
    L.botonVaciar.addEventListener('click', () => { L.lector.clear(); pintarSeleccion(ctx); });
    L.veredicto = K.veredicto({ vacio: 'Escanea hojas y pulsa «Recuperar el secreto».' });
    L.explica = K.explicacion();
    L.paso3 = K.paso({ n: 3, titulo: 'Escanea y recupera el secreto', estado: 'espera', id: id('p3'),
      ayuda: 'El lector junta las hojas escaneadas. Prueba con menos de las necesarias y con distintas combinaciones.' },
    h('div.qr-lector', h('div.qr-lector__visor', L.ranuras, L.barrido), L.lectorTexto),
    h('div.esq-acciones', L.botonLeer, L.botonVaciar), L.veredicto, L.explica);
    pintarLector(ctx);

    // ------------------------------------------------------------ trampas
    L.trampas = K.trampas([
      { etiqueta: 'Mancha una hoja', texto: 'Se le cae café encima y, al leerla, una letra sale mal.', fn: (b) => trampa(ctx, b, 'mancha') },
      { etiqueta: 'Un custodio altera su hoja y lo disimula', texto: 'La cambia a escondidas y arregla su código de control para que no se note.', fn: (b) => trampa(ctx, b, 'trampa') },
      { etiqueta: 'Mezclar con una hoja de otro respaldo', texto: 'Alguien llega con la hoja equivocada: es de otro respaldo.', fn: (b) => trampa(ctx, b, 'ajena') },
    ]);
    L.trampas.hidden = true;

    host.append(
      K.cabecera({ numero: meta.numero, icono: meta.icono, titulo: meta.titulo, id: id('titulo'),
        metafora: 'Imprime el secreto en cinco hojas con código QR y repártelas: tres hojas cualesquiera lo recuperan; una o dos no dicen nada.',
        historia: 'La clave de la bóveda donde el consorcio guarda los títulos no puede vivir en una sola computadora: si se descompone, se pierde. Su respaldo va en papel, y cada hoja queda en manos de alguien distinto. Al final, un truco: un QR que solo aparece al encimar dos acetatos de ruido.',
        tecnico: 'esquema de Shamir sobre GF(2⁸), un byte a la vez, con cada parte impresa en un QR (formato SSQR1) · criptografía visual de Naor y Shamir (1994).' }),
      h('div.qr-bloque',
        h('p.qr-idea', h('span', 'Idea 1'), ' El QR guarda un pedazo del secreto'),
        h('div.esq-pasos', L.paso1, L.paso2, L.paso3)),
      L.trampas,
      boveda(ctx),
      parteVisual(ctx),
      cuentas(ctx),
      K.saberMas(
        h('ul',
          h('li', h('strong', 'Banana Split: '), 'una página que funciona sin internet. Cifra el secreto, reparte la llave con Shamir y la imprime en varios QR; para recuperarlo se escanea la mayoría.'),
          h('li', h('strong', 'SSKR y Gordian SeedTool: '), 'reparten con Shamir sobre GF(2⁸), incluso en grupos con umbrales distintos. Recomiendan el «sobre»: cifrar y repartir solo la llave, como la bóveda de arriba.'),
          h('li', h('strong', 'ShardQuorum: '), 'app de Android sin conexión, con partes en QR, código de control contra errores de copia y una página para recuperar sin depender de la app.'),
          h('li', h('strong', 'Herencia digital: '), 'una persona reparte su contraseña maestra 2 de 3 entre su pareja, una notaría y un hermano. Nadie puede usarla solo en vida de la titular; dos juntos pueden recuperarla cuando haga falta.'),
          h('li', h('strong', 'Emergencias en una universidad: '), 'la contraseña del administrador se reparte 3 de 5 en sobres sellados, en cajas fuertes de distintos responsables.'),
          h('li', h('strong', 'En clase: '), 'los dos acetatos impresos son una demostración memorable: cada uno es ruido y el QR aparece al encimarlos.')),
        h('p', h('strong', 'Recomendaciones del documento:')),
        h('ul',
          h('li', 'Nunca uses generadores ni lectores de QR en línea: pueden guardar lo que leen.'),
          h('li', 'Imprime en una impresora local y no fotografíes las hojas con un teléfono que se respalda en la nube.'),
          h('li', 'No guardes dos hojas en el mismo lugar: lo que protege es que estén separadas.'),
          h('li', 'La computadora que reparte ve el secreto: usa una sin conexión.'),
          h('li', 'Cada hoja deja ver cuántas hacen falta, su número y el tamaño del secreto. Si el tamaño importa, rellénalo a un largo fijo.'),
          h('li', 'Prueba a recuperar antes de repartir, repite la prueba de vez en cuando y reimprime las hojas gastadas.'),
          h('li', 'Escribe en cada hoja qué es, cuántas hacen falta y cómo se recupera (por eso las de arriba lo dicen).')),
        h('p', h('strong', 'Límites: '), 'los acetatos son vistosos pero poco prácticos: exigen todas las partes y pierden contraste. Para guardar claves de verdad conviene la Idea 1: partes chicas, que aguantan daño y admiten cualquier «k de n».')),
    );
  },
};

// ================================================================ paso 1
function pintarContador(L) {
  const n = bytes(L.entrada.value);
  texto(L.contador, `${n} de ${MAX_BYTES} bytes${n > MAX_BYTES ? ' · demasiado largo' : ''} (las letras con acento ocupan 2).`);
  attr(L.contador, 'data-excede', n > MAX_BYTES ? '' : null);
}

function pintarFrase(L) {
  K.reemplazar(L.frase, 'Se imprimen ', h('strong', nHojas(L.n)), '. Cualesquiera ', h('strong', String(L.k)), ' recuperan el secreto; ',
    L.k - 1 === 1 ? 'con 1 sola no se sabe nada.' : `con ${L.k - 1} o menos no se sabe nada.`);
  texto(L.botonImprimir.querySelector('span'), `Imprimir ${L.n} hojas`);
}

async function imprimir(ctx) {
  const L = ctx.local;
  let r;
  try {
    r = await ctx.ui.ocupado(L.botonImprimir, K.post('qr/repartir', { secreto: L.entrada.value, k: L.k, n: L.n }));
  } catch (e) {
    ctx.ui.mostrarError(e, { form: L.form });
    return;
  }
  Object.assign(L, { reparto: r, lector: new Set(), ultimo: null, secretoImpreso: L.entrada.value });
  L.hojas = r.partes.map((p) => ({ x: p.x, texto: p.texto, qr: p.qr, original: p.texto, qrOriginal: p.qr, estado: 'intacta' }));
  K.marcarPaso(L.paso1, 'hecho');
  K.marcarPaso(L.paso2, 'activo');
  K.marcarPaso(L.paso3, 'activo');
  L.espera2.hidden = true;
  L.acciones2.hidden = false;
  L.botonRestaurar.hidden = true;
  L.trampas.hidden = false;
  texto(L.botonAzar.querySelector('span'), `Escanear ${r.k} hojas al azar`);
  K.pintarVeredicto(L.veredicto, null);
  K.explicar(L.explica);
  K.reemplazar(L.hojasLista, L.hojas.map((hoja) => crearHoja(ctx, hoja)));
  K.anim.escalonar(L.hojasLista.children, [{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }],
    { duration: K.anim.DUR.entrada }, 60);
  pintarSeleccion(ctx);
  pintarFormato(ctx);
  K.reemplazar(L.realCuerpo, h('p.texto-3', 'Cuando recuperes el secreto arriba, aquí verás las cuentas con tus hojas.'));
  const q = r.partes[0].qr;
  texto(L.qrInfo, `Tus hojas: QR versión ${q.version} (${q.modulos} × ${q.modulos} módulos), nivel ${r.nivel}. El secreto mide ${r.bytes_secreto} bytes; cada pedazo, ${r.bytes_secreto + 4}.`);
  K.narrar(ctx, `Respaldo impreso en ${r.n} hojas`, `Cada hoja va a un lugar distinto. Cualesquiera ${r.k} recuperan la clave; ${r.k - 1} o menos no revelan nada.`, 'ok');
}

// ================================================================ paso 2 · hojas
function crearHoja(ctx, hoja) {
  const L = ctx.local;
  const r = L.reparto;
  const c = partir(hoja.texto);
  const est = ESTADOS[hoja.estado];
  const papel = h('div.qr-papel',
    h('div.qr-papel__cabeza',
      h('span.qr-papel__serie', 'Respaldo ', c ? h(hoja.estado === 'ajena' ? 'mark' : 'span', serie(c.id)) : '—'),
      est ? h('span.qr-sello', { dataset: { nivel: est.nivel } }, est.sello) : null),
    h('p.qr-papel__titulo', `Hoja ${hoja.x} de ${r.n}`),
    h('p.qr-papel__regla', `Hacen falta ${r.k} para recuperar`),
    h('div.qr-papel__codigo',
      K.qrSvg(hoja.qr.filas, { margen: 2, titulo: `Código QR de la hoja ${hoja.x}${est ? ` (${est.sello.toLowerCase()})` : ''}` }),
      hoja.estado === 'manchada' ? h('span.qr-mancha', { 'aria-hidden': 'true' }) : null),
    h('p.qr-papel__para', 'Para: ', h('strong', custodio(hoja.x))));
  const boton = h('button.boton.boton--secundario.qr-hoja__escanear', { type: 'button', 'aria-pressed': 'false' },
    icono('buscar'), h('span', 'Escanear'), h('span.solo-lectores', ` la hoja ${hoja.x}`));
  boton.addEventListener('click', () => {
    if (L.lector.has(hoja.x)) L.lector.delete(hoja.x); else L.lector.add(hoja.x);
    pintarSeleccion(ctx);
  });
  const cambio = hoja.texto !== hoja.original;
  const detalle = h('details.detalles.qr-hoja__detalle',
    h('summary', h('span', 'Qué dice este QR')),
    h('p.qr-hoja__texto', marcarCambios(hoja)),
    h('p.qr-hoja__nota', cambio ? 'Resaltado: lo que cambió respecto a la hoja original.' : 'Es solo texto: cualquier lector de QR lo muestra así.'));
  const li = h('li.qr-hoja', { dataset: { x: hoja.x, estado: hoja.estado, escaneada: 'no' } }, papel, boton, detalle);
  Object.assign(hoja, { el: li, boton, papel });
  return li;
}

function repintarHoja(ctx, hoja) {
  const viejo = hoja.el;
  const nuevo = crearHoja(ctx, hoja);
  if (viejo?.isConnected) viejo.replaceWith(nuevo);
}

/** El texto del QR con lo que cambió envuelto en <mark>. */
function marcarCambios(hoja) {
  const { original, texto: actual, estado } = hoja;
  if (estado === 'ajena') {
    const c = partir(actual);
    if (!c) return actual;
    const i = actual.indexOf(c.id);
    return [actual.slice(0, i), h('mark', c.id), actual.slice(i + c.id.length)];
  }
  if (original === actual || original.length !== actual.length) return actual;
  const trozos = [];
  for (let i = 0; i < actual.length;) {
    const distinto = actual[i] !== original[i];
    let j = i;
    while (j < actual.length && (actual[j] !== original[j]) === distinto) j++;
    trozos.push(distinto ? h('mark', actual.slice(i, j)) : actual.slice(i, j));
    i = j;
  }
  return trozos;
}

function pintarSeleccion(ctx) {
  const L = ctx.local;
  for (const hoja of L.hojas) {
    const dentro = L.lector.has(hoja.x);
    attr(hoja.boton, 'aria-pressed', dentro ? 'true' : 'false');
    hoja.el.dataset.escaneada = dentro ? 'si' : 'no';
    const ico = hoja.boton.querySelector('use');
    ico?.setAttribute('href', dentro ? '#i-ok' : '#i-buscar');
    // el texto dice el estado (no solo el icono): «Escaneada» / «Escanear»
    const rotulo = hoja.boton.querySelector('span:not(.solo-lectores)');
    if (rotulo) rotulo.textContent = dentro ? 'Escaneada' : 'Escanear';
  }
  pintarLector(ctx);
}

function elegirAlAzar(L, cuantos, incluir = null) {
  const xs = L.hojas.map((hoja) => hoja.x).filter((x) => x !== incluir);
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  L.lector = new Set([...(incluir ? [incluir] : []), ...xs].slice(0, cuantos));
}

function restaurar(ctx) {
  const L = ctx.local;
  for (const hoja of L.hojas) {
    if (hoja.estado === 'intacta') continue;
    Object.assign(hoja, { texto: hoja.original, qr: hoja.qrOriginal, estado: 'intacta' });
    repintarHoja(ctx, hoja);
  }
  L.botonRestaurar.hidden = true;
  pintarSeleccion(ctx);
  pintarFormato(ctx);
}

// ================================================================ paso 3 · lector
function pintarLector(ctx) {
  const L = ctx.local;
  const r = L.reparto;
  const k = r?.k ?? L.k;
  const xs = [...L.lector].sort((a, b) => a - b);
  const t = xs.length;
  K.reemplazar(L.ranuras, Array.from({ length: Math.max(k, t) }, (_, i) => {
    const hoja = L.hojas.find((hh) => hh.x === xs[i]);
    if (!hoja) return h('li.qr-ranura', { dataset: { estado: 'vacia' } }, h('span.qr-ranura__marco', icono('qr')), h('span.qr-ranura__nombre', 'falta'));
    return h('li.qr-ranura', { dataset: { estado: i < k ? 'llena' : 'extra' } },
      h('span.qr-ranura__marco', K.qrSvg(hoja.qr.filas, { margen: 1 })), h('span.qr-ranura__nombre', `Hoja ${hoja.x}`));
  }));
  texto(L.lectorTexto, !r ? `El lector espera las hojas: harán falta ${k}.`
    : t === 0 ? `El lector está vacío: hacen falta ${k} hojas.`
      : t < k ? `En el lector: ${t === 1 ? 'hoja' : 'hojas'} ${enLista(xs)} · ${t} de ${k}, ${k - t === 1 ? 'falta 1' : `faltan ${k - t}`}.`
        : t === k ? `En el lector: hojas ${enLista(xs)} · justo las ${k} necesarias.`
          : `En el lector: hojas ${enLista(xs)} · ${t - k} de sobra (también sirve).`);
  L.botonLeer.disabled = !r || t === 0;
  L.botonVaciar.disabled = !r || t === 0;
}

async function leer(ctx, boton = ctx.local.botonLeer) {
  const L = ctx.local;
  const r = L.reparto;
  if (!r || !L.lector.size) return;
  const hojas = [...L.lector].sort((a, b) => a - b).map((x) => L.hojas.find((hh) => hh.x === x)).filter(Boolean);
  K.anim.animar(L.barrido,
    [{ opacity: 1, transform: 'translateY(-100%)' }, { opacity: 1, transform: 'translateY(0%)', offset: 0.8 }, { opacity: 0, transform: 'translateY(0%)' }],
    { duration: 620, easing: K.anim.CURVA.func }, { reducido: [{ opacity: 0.5 }, { opacity: 0 }] });
  const res = await K.accion(ctx, boton, K.post('qr/leer', { textos: hojas.map((hh) => hh.texto) }));
  if (!res) return;
  L.ultimo = { res, hojas: hojas.map((hh) => ({ x: hh.x, texto: hh.texto, estado: hh.estado })) };
  pintarResultado(ctx, res, hojas);
  pintarCuentasReales(ctx);
}

function pintarResultado(ctx, res, hojas) {
  const L = ctx.local;
  const r = L.reparto;
  const xs = hojas.map((hh) => hh.x);
  const rara = (estado) => hojas.find((hh) => hh.estado === estado)?.x ?? null;
  const t = res.partes_leidas;
  switch (res.codigo) {
    case 'abierto':
      K.pintarVeredicto(L.veredicto, { estado: 'ok', titulo: '¡Secreto recuperado!',
        texto: `Con las hojas ${enLista(xs)}, el lector armó el secreto:`, extra: h('p', h('q', res.secreto)) });
      K.explicar(L.explica,
        h('p', 'Cada hoja guarda un pedazo del secreto. Con ', h('strong', `${r.k} hojas cualesquiera`), ' el lector junta los pedazos y lo reconstruye.'),
        'Antes de darlo por bueno revisó dos cosas: que cada hoja se leyó bien (su código de control) y que el resultado cuadra con una comprobación escondida dentro del propio secreto. Prueba con otras hojas, o con menos.');
      K.marcarPaso(L.paso2, 'hecho');
      K.marcarPaso(L.paso3, 'hecho');
      K.narrar(ctx, 'Secreto recuperado', `Las hojas ${enLista(xs)} bastaron: hacen falta ${r.k} cualesquiera.`, 'ok');
      break;
    case 'insuficientes':
      K.pintarVeredicto(L.veredicto, { estado: 'aviso', titulo: `Faltan hojas: hay ${t} de ${r.k}`,
        texto: 'Con menos hojas de las necesarias el lector ni siquiera lo intenta.' });
      K.explicar(L.explica,
        h('p', 'Y no es que falte «poquito»: con ', h('strong', nHojas(t)), ' el secreto podría ser cualquiera. Para cualquier secreto que imagines hay hojas que se verían exactamente así.'),
        'Por eso perder o robar una hoja no es grave: ni se pierde el secreto (quedan otras) ni se descubre.');
      K.narrar(ctx, 'No alcanza', `Solo hubo ${nHojas(t)} de ${r.k}: no revelan nada del secreto.`, 'aviso');
      break;
    case 'danada': {
      const delMensaje = /parte (\d+)/.exec(res.mensaje || '')?.[1];
      const x = rara('manchada') ?? (delMensaje ? Number(delMensaje) : null);
      K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: 'Una hoja está dañada',
        texto: `La hoja ${x ?? '?'} se leyó mal: su código de control no cuadra.` });
      K.explicar(L.explica,
        h('p', 'Cada hoja trae al final un ', h('strong', 'código de control'), ': un número que se calcula con todo lo demás de la hoja. Si cambia una sola letra, ya no cuadra y el lector la rechaza antes de usarla.'),
        `Una mancha chica casi nunca llega hasta aquí: el propio QR aguanta hasta un 30 % de daño. Este código es la segunda red. Saca la hoja ${x ?? 'dañada'} del lector y usa otra.`);
      K.narrar(ctx, 'Hoja dañada', `La hoja ${x ?? '?'} no pasó su código de control: el lector no la usa.`, 'error');
      break;
    }
    case 'incorrecta': {
      const x = rara('alterada');
      K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: '¡Hoja alterada!',
        texto: 'Cada hoja, por separado, parecía perfecta. Pero al juntarlas, la comprobación escondida dentro del secreto no cuadró.' });
      K.explicar(L.explica,
        h('p', x ? [h('strong', `La hoja ${x} (${custodio(x)})`), ' fue alterada a escondidas. '] : null,
          'Quien la cambió arregló también su código de control, así que la hoja, sola, pasaba la revisión. Lo que no puede falsificar es la comprobación que viaja ', h('strong', 'dentro'), ' del secreto repartido: solo cuadra con las hojas originales.'),
        `El lector sabe que algo está mal, pero no cuál hoja; aquí tú sí lo sabes. Quita la hoja ${x ?? 'sospechosa'} y prueba con otras.`);
      K.narrar(ctx, 'Hoja alterada detectada', 'La comprobación escondida dentro del secreto no cuadró: alguien cambió su hoja.', 'error');
      break;
    }
    case 'mezcladas': {
      const x = rara('ajena');
      K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: 'Hojas de dos respaldos distintos',
        texto: `${x ? `La hoja ${x}` : 'Una de las hojas'} es de otro respaldo: su número de serie no coincide.` });
      K.explicar(L.explica,
        'Cada hoja lleva impreso el número de serie de su respaldo (arriba, en letra chica). El lector se niega a mezclar hojas de respaldos distintos: el resultado sería basura.',
        x ? `Quita la hoja ${x} del lector o vuelve a las hojas originales.` : 'Quita la hoja ajena del lector.');
      K.narrar(ctx, 'Hojas mezcladas', 'Los números de serie no coinciden: el lector no mezcla respaldos.', 'error');
      break;
    }
    case 'repetidas':
      K.pintarVeredicto(L.veredicto, { estado: 'aviso', titulo: 'Hay una hoja repetida', texto: 'Cada hoja cuenta una sola vez: una copia no suma.' });
      K.explicar(L.explica, res.mensaje);
      break;
    default:
      K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: 'Eso no es una hoja de este respaldo', texto: res.mensaje });
      K.explicar(L.explica);
  }
}

// ================================================================ trampas
async function trampa(ctx, boton, modo) {
  const L = ctx.local;
  const r = L.reparto;
  if (!r) return;
  restaurar(ctx);
  const x = 1 + Math.floor(Math.random() * r.n);
  const hoja = L.hojas[x - 1];
  if (modo === 'ajena') {
    const otro = await K.accion(ctx, boton, otroRespaldo(ctx));
    if (!otro) return;
    const p = otro.partes.find((pp) => pp.x === x) ?? otro.partes[0];
    Object.assign(hoja, { texto: p.texto, qr: p.qr, estado: 'ajena' });
  } else {
    const res = await K.accion(ctx, boton, K.post('qr/alterar', { texto: hoja.original, modo }));
    if (!res) return;
    Object.assign(hoja, { texto: res.texto, estado: modo === 'mancha' ? 'manchada' : 'alterada' });
  }
  repintarHoja(ctx, hoja);
  L.botonRestaurar.hidden = false;
  elegirAlAzar(L, r.k, x);
  pintarSeleccion(ctx);
  pintarFormato(ctx);
  K.anim.destello(hoja.papel, ESTADOS[hoja.estado].nivel === 'aviso' ? 'var(--advertencia)' : 'var(--rechazado)');
  await leer(ctx, boton);
}

/** Un segundo respaldo (otro secreto, mismo «k de n»), del que se toma la hoja equivocada. */
function otroRespaldo(ctx) {
  const L = ctx.local;
  const r = L.reparto;
  const clave = `${r.k}-${r.n}`;
  if (!L.otros.has(clave)) {
    L.otros.set(clave, K.post('qr/repartir', { secreto: OTRO_SECRETO, k: r.k, n: r.n })
      .catch((e) => { L.otros.delete(clave); throw e; }));
  }
  return L.otros.get(clave);
}

// ================================================================ bóveda (secretos largos)
function boveda(ctx) {
  const L = ctx.local;
  const id = L.id;
  L.bovDoc = h('textarea.entrada.qr-documento', { id: id('documento'), name: 'documento', rows: 5, spellcheck: 'false', value: DOC_INICIAL });
  L.bovDoc.addEventListener('input', () => ctx.ui.limpiarCampos(L.bovForm));
  L.bovBoton = h('button.boton.boton--primario', { type: 'submit' }, icono('candado'), h('span', 'Guardar en una bóveda'));
  L.bovForm = h('form.esq-form', { novalidate: true },
    h('div.campo',
      h('label.campo__etiqueta', { for: L.bovDoc.id }, 'Un documento largo'),
      L.bovDoc,
      h('p.campo__ayuda', 'Hasta 800 bytes. La llave se reparte «2 de 3».')),
    h('div.esq-acciones', L.bovBoton));
  L.bovForm.addEventListener('submit', (e) => { e.preventDefault(); guardarBoveda(ctx); });
  L.bovAbrir = h('button.boton.boton--primario', { type: 'button', disabled: true }, icono('llave'), h('span', 'Abrir la bóveda'));
  L.bovAbrir.addEventListener('click', () => abrirBoveda(ctx));
  L.bovResultado = h('div.qr-boveda', { hidden: true });
  L.bovVeredicto = K.veredicto({ vacio: 'Guarda el documento, elige llaves y pulsa «Abrir la bóveda».' });
  L.bovExplica = K.explicacion();
  return h('details.detalles.esq-cuentas.qr-plegable',
    h('summary', icono('candado'), h('span', '¿Y si el secreto es largo? Guárdalo en una bóveda')),
    h('div.esq-cuentas__cuerpo',
      h('p', 'Un QR tiene un límite, y repartir un documento entero daría hojas enormes. El truco: el documento se guarda ',
        h('strong', 'cerrado con llave'), ' en un QR grande, que puede quedar a la vista de todos. Lo que se reparte es solo la llave, en QR chiquitos.'),
      L.bovForm, L.bovResultado, L.bovVeredicto, L.bovExplica));
}

async function guardarBoveda(ctx) {
  const L = ctx.local;
  let r;
  try {
    r = await ctx.ui.ocupado(L.bovBoton, K.post('qr/boveda', { documento: L.bovDoc.value, k: 2, n: 3 }));
  } catch (e) {
    ctx.ui.mostrarError(e, { form: L.bovForm });
    return;
  }
  L.bov = r;
  L.bovSel = new Set([1, r.n]);
  const m = r.boveda.qr.modulos;
  const mp = r.partes[0].qr.modulos;
  L.bovLlaves = r.partes.map((p) => {
    const b = h('button.qr-llave', { type: 'button', 'aria-pressed': 'false' },
      h('span.qr-llave__qr', K.qrSvg(p.qr.filas, { margen: 2 })),
      h('span.qr-llave__nombre', `Llave ${p.x}`), h('span.qr-llave__quien', custodio(p.x)));
    b.addEventListener('click', () => {
      if (L.bovSel.has(p.x)) L.bovSel.delete(p.x); else L.bovSel.add(p.x);
      pintarLlaves(L);
    });
    b.dataset.x = p.x;
    return b;
  });
  K.reemplazar(L.bovResultado,
    h('figure.qr-boveda__publica',
      h('div.qr-boveda__qr', K.qrSvg(r.boveda.qr.filas, { margen: 2, titulo: 'QR de la bóveda: el documento, cerrado con llave' })),
      h('figcaption', h('strong', 'La bóveda'), ` · un QR grande (${m} × ${m}). Va cerrada: se puede copiar y dejar a la vista.`)),
    h('div.qr-boveda__llaves',
      h('p', h('strong', `${r.n} llaves chiquitas`), ` (${mp} × ${mp}), una por persona. Hacen falta ${r.k}. Elige cuáles se juntan:`),
      h('div.qr-llaves', { role: 'group', 'aria-label': 'Llaves que se juntan' }, L.bovLlaves),
      h('div.esq-acciones', L.bovAbrir)));
  L.bovResultado.hidden = false;
  pintarLlaves(L);
  K.pintarVeredicto(L.bovVeredicto, null);
  K.explicar(L.bovExplica);
  K.anim.entrar(L.bovResultado);
}

function pintarLlaves(L) {
  for (const b of L.bovLlaves || []) attr(b, 'aria-pressed', L.bovSel.has(Number(b.dataset.x)) ? 'true' : 'false');
  L.bovAbrir.disabled = !L.bov || L.bovSel.size === 0;
}

async function abrirBoveda(ctx) {
  const L = ctx.local;
  const r = L.bov;
  if (!r || !L.bovSel.size) return;
  const elegidas = r.partes.filter((p) => L.bovSel.has(p.x));
  const res = await K.accion(ctx, L.bovAbrir, K.post('qr/boveda/abrir', { boveda: r.boveda.texto, textos: elegidas.map((p) => p.texto) }));
  if (!res) return;
  if (res.abierto) {
    K.pintarVeredicto(L.bovVeredicto, { estado: 'ok', titulo: '¡Bóveda abierta!',
      texto: `Con las llaves ${enLista(elegidas.map((p) => p.x))} se rearmó la llave y salió el documento:`, extra: h('pre.qr-abierto', res.documento) });
    K.explicar(L.bovExplica,
      'El documento viaja cerrado en el QR grande; lo único que se reparte es su llave, que es cortita. Por eso cada persona guarda un QR chiquito, sin importar lo largo del documento.',
      'Si alguna llave fuera falsa, la bóveda no abriría a medias: se negaría a abrir. Es el diseño de Banana Split y de los «sobres» de SSKR.');
    K.narrar(ctx, 'Bóveda abierta', `${elegidas.length} llaves bastaron para abrir el documento.`, 'ok');
  } else if (res.codigo === 'insuficientes') {
    K.pintarVeredicto(L.bovVeredicto, { estado: 'aviso', titulo: `Falta una llave: hay ${elegidas.length} de ${r.k}`,
      texto: 'Con media llave la bóveda sigue siendo ruido: no se lee ni una letra del documento.' });
    K.explicar(L.bovExplica, 'Prueba con dos llaves cualesquiera: cualquier par abre.');
  } else {
    K.pintarVeredicto(L.bovVeredicto, { estado: 'mal', titulo: 'La bóveda no abrió', texto: res.mensaje });
    K.explicar(L.bovExplica);
  }
}

// ================================================================ idea 2 · el QR invisible
function parteVisual(ctx) {
  const L = ctx.local;
  const id = L.id;

  // 1 · partir
  L.visEntrada = h('input.entrada', { id: id('vis-texto'), name: 'texto', value: URL_INICIAL, autocomplete: 'off', spellcheck: 'false' });
  L.visEntrada.addEventListener('input', () => ctx.ui.limpiarCampos(L.visForm));
  L.visBoton = h('button.boton.boton--primario', { type: 'submit' }, icono('capas'), h('span', 'Partir en 2 acetatos'));
  L.visForm = h('form.esq-form', { novalidate: true },
    h('div.esq-campos',
      h('div.campo.campo--ancho',
        h('label.campo__etiqueta', { for: L.visEntrada.id }, 'Lo que dirá el QR secreto'),
        L.visEntrada,
        h('p.campo__ayuda', 'Un enlace o un texto corto. Aquí: la página para verificar un título.'))),
    h('div.esq-acciones', L.visBoton));
  L.visForm.addEventListener('submit', (e) => { e.preventDefault(); partirVisual(ctx); });
  L.v1 = K.paso({ n: 1, titulo: 'Esconde el QR en dos acetatos', id: id('v1'),
    ayuda: 'La computadora parte el QR en dos hojas transparentes llenas de puntitos al azar.' }, L.visForm);

  // 2 · encimar
  L.acetatoA = h('div.qr-acetato.qr-acetato--a');
  L.acetatoB = h('div.qr-acetato.qr-acetato--b');
  L.mesa = h('div.qr-mesa', { role: 'img', 'aria-label': 'Dos acetatos de ruido, separados.' }, L.acetatoA, L.acetatoB);
  L.mesa.style.setProperty('--p', '0');
  L.acetatoB.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') attr(L.mesa, 'data-animando', null); });
  arrastre(ctx);
  L.visRango = h('input.deslizador.qr-rango', { type: 'range', id: id('vis-rango'), min: '0', max: '100', step: '1', value: '0', 'aria-valuetext': 'separados' });
  L.visRango.addEventListener('input', () => fijarP(ctx, Number(L.visRango.value) / 100));
  L.visEncimar = h('button.boton.boton--primario.qr-encimar', { type: 'button', 'aria-pressed': 'false' }, icono('capas'), h('span', 'Encimar los acetatos'));
  L.visEncimar.addEventListener('click', () => fijarP(ctx, L.visP < 1 ? 1 : 0, { animar: true }));
  L.visMensaje = h('p.qr-mesa__mensaje', { 'aria-live': 'polite' });
  L.visEscena = h('div.qr-escena', { hidden: true },
    L.mesa,
    h('div.qr-control',
      h('label.campo__etiqueta', { for: L.visRango.id }, 'Desliza el acetato B sobre el A'),
      L.visRango,
      h('div.esq-acciones', L.visEncimar)),
    L.visMensaje);
  L.visEspera = h('p.qr-espera', 'Primero parte el QR en el paso 1.');
  L.v2 = K.paso({ n: 2, titulo: 'Encímalos', estado: 'espera', id: id('v2'),
    ayuda: 'Arrastra el acetato B hacia la derecha (o usa el control) hasta que quede exactamente sobre el A.' },
  L.visEspera, L.visEscena);

  // 3 · limpiar
  L.visLimpiar = h('button.boton.boton--primario', { type: 'button', disabled: true }, icono('chispa'), h('span', 'Limpiar la imagen'));
  L.visLimpiar.addEventListener('click', () => limpiar(ctx));
  L.visLimpio = h('div.qr-limpio', { hidden: true });
  L.v3 = K.paso({ n: 3, titulo: 'Límpialo para que lo lea un teléfono', estado: 'espera', id: id('v3'),
    ayuda: 'El ojo ve el QR encimado, pero la textura gris confunde a la cámara. Un paso sencillo lo deja nítido.' },
  h('div.esq-acciones', L.visLimpiar), L.visLimpio);

  return h('section.qr-bloque.qr-bloque--visual', { 'aria-labelledby': id('vis-titulo') },
    h('p.qr-idea', h('span', 'Idea 2'), ' El QR es el secreto'),
    h('div.qr-bloque__cabeza',
      h('h3.qr-bloque__titulo', { id: id('vis-titulo') }, 'El QR invisible'),
      h('p.qr-bloque__metafora', 'Dos acetatos llenos de puntitos al azar. Cada uno, solo, es ruido puro. Encímalos y aparece un código QR.'),
      h('p.qr-bloque__historia', 'Así se podría entregar el enlace para verificar un título en dos sobres distintos: con un solo sobre no se puede leer nada.'),
      h('p.esq-cabecera__tecnico', h('span.etiqueta-instrumento', 'Nombre técnico'), ' criptografía visual (2, 2) de Naor y Shamir, 1994.')),
    h('div.esq-pasos', L.v1, L.v2, L.v3),
    varianteXor(ctx));
}

async function partirVisual(ctx) {
  const L = ctx.local;
  const textoQr = L.visEntrada.value;
  let r;
  try {
    r = await ctx.ui.ocupado(L.visBoton, K.post('qr/visual', { texto: textoQr, tipo: 'naor_shamir' }));
  } catch (e) {
    ctx.ui.mostrarError(e, { form: L.visForm });
    return;
  }
  Object.assign(L, { vis: r, visTexto: textoQr, visVisto: false });
  K.reemplazar(L.acetatoA, K.qrSvg(r.sombras[0], { margen: 0, clase: 'qr-acetato__svg' }), h('span.qr-acetato__nombre', 'Acetato A'));
  K.reemplazar(L.acetatoB, K.qrSvg(r.sombras[1], { margen: 0, clase: 'qr-acetato__svg' }), h('span.qr-acetato__nombre', 'Acetato B'));
  L.visEspera.hidden = true;
  L.visEscena.hidden = false;
  L.visLimpiar.disabled = false;
  L.visLimpio.hidden = true;
  K.reemplazar(L.visLimpio);
  fijarP(ctx, 0);
  K.marcarPaso(L.v1, 'hecho');
  K.marcarPaso(L.v2, 'activo');
  K.marcarPaso(L.v3, 'activo');
  K.anim.escalonar([L.acetatoA, L.acetatoB], [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }],
    { duration: K.anim.DUR.entrada }, 90);
  K.narrar(ctx, 'QR escondido en dos acetatos', 'Cada acetato es ruido puro. Solo al encimarlos aparece el QR.', 'info');
  if (L.xor) pedirXor(ctx);           // la versión digital sigue el mismo texto
}

/** Posición del acetato B: 0 = separado, 1 = exactamente encima del A. */
function fijarP(ctx, p, { animar = false } = {}) {
  const L = ctx.local;
  if (!L.vis) return;
  const antes = L.visP;
  L.visP = Math.max(0, Math.min(1, p));
  attr(L.mesa, 'data-animando', animar && !K.anim.reducido() && antes !== L.visP ? '' : null);
  L.mesa.style.setProperty('--p', String(L.visP));
  L.visRango.value = String(Math.round(L.visP * 100));
  L.visRango.style.setProperty('--relleno', `${L.visP * 100}%`);
  const juntos = L.visP === 1;
  attr(L.mesa, 'data-encimados', juntos ? '' : null);
  attr(L.visEncimar, 'aria-pressed', juntos ? 'true' : 'false');
  attr(L.visRango, 'aria-valuetext', juntos ? 'encimados: aparece el QR' : L.visP === 0 ? 'separados' : `${Math.round(L.visP * 100)} % del camino`);
  attr(L.mesa, 'aria-label', juntos ? 'Los dos acetatos encimados: aparece un código QR gris sobre negro.' : 'Dos acetatos de ruido; todavía no coinciden.');
  texto(L.visMensaje, juntos ? '¡Ahí está el QR! Donde el QR es negro, los dos acetatos tapan todo; donde es blanco, queda medio gris.'
    : L.visP === 0 ? 'Cada acetato, solo, es ruido puro: ni con lupa se adivina nada.'
      : 'Casi… Solo cuando quedan exactamente uno sobre otro aparece el dibujo.');
  if (juntos && antes !== 1 && !L.visVisto) {
    L.visVisto = true;
    K.marcarPaso(L.v2, 'hecho');
    K.anim.destello(L.mesa, 'var(--valido)');
    K.narrar(ctx, 'Apareció el QR', 'Encimados, los dos acetatos de ruido dejan ver el código.', 'ok');
  }
}

/** Arrastrar el acetato B con el dedo o el ratón (el deslizador es la alternativa con teclado). */
function arrastre(ctx) {
  const L = ctx.local;
  const B = L.acetatoB;
  let inicio = null;
  B.addEventListener('pointerdown', (e) => {
    if (!L.vis || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const recorrido = L.acetatoA.offsetLeft - B.offsetLeft;
    if (recorrido <= 0) return;
    inicio = { x: e.clientX, p: L.visP, recorrido };
    B.setPointerCapture?.(e.pointerId);
    attr(L.mesa, 'data-arrastrando', '');
  });
  B.addEventListener('pointermove', (e) => {
    if (inicio) fijarP(ctx, inicio.p + (e.clientX - inicio.x) / inicio.recorrido);
  });
  const soltar = () => {
    if (!inicio) return;
    inicio = null;
    attr(L.mesa, 'data-arrastrando', null);
    if (L.visP > 0.94 && L.visP < 1) fijarP(ctx, 1, { animar: true });     // imán: casi encima = encima
  };
  B.addEventListener('pointerup', soltar);
  B.addEventListener('pointercancel', soltar);
}

function limpiar(ctx) {
  const L = ctx.local;
  const v = L.vis;
  if (!v) return;
  if (L.visP < 1) fijarP(ctx, 1, { animar: true });
  const encimado = K.combinar(v.sombras, 'or');
  const limpio = promediar(encimado);
  let iguales = 0;
  let total = 0;
  limpio.forEach((fila, i) => { for (let j = 0; j < fila.length; j++) { total++; if (fila[j] === v.secreto[i][j]) iguales++; } });
  K.reemplazar(L.visLimpio,
    h('figure.qr-limpio__figura',
      K.qrSvg(limpio, { margen: 2, titulo: `Código QR limpio. Dice: ${L.visTexto}` }),
      h('figcaption', 'La imagen limpia')),
    h('div.qr-limpio__texto',
      h('p', 'Cada cuadrito de 2 × 2 puntos se vuelve uno solo: si sus 4 puntos son negros, queda negro; si solo 2, queda blanco.'),
      h('p', h('strong', iguales === total ? `Idéntico al QR original: ${miles(total)} de ${miles(total)} cuadros.` : `Coincide en ${miles(iguales)} de ${miles(total)} cuadros.`)),
      h('p', 'Dice: ', h('q.esq-valor', L.visTexto)),
      h('p.texto-3', 'Pruébalo: apúntale con la cámara de tu teléfono.')));
  L.visLimpio.hidden = false;
  K.anim.entrar(L.visLimpio);
  K.marcarPaso(L.v3, 'hecho');
  K.narrar(ctx, 'Imagen limpia', 'Promediando cada bloque de 2 × 2 puntos, el QR queda nítido para un teléfono.', 'ok');
}

/** Bloques de 2 × 2 subpuntos → un módulo: negro solo si los 4 son negros (umbral 3/4). */
function promediar(T) {
  const out = [];
  for (let i = 0; i + 1 < T.length; i += 2) {
    let fila = '';
    for (let j = 0; j + 1 < T[i].length; j += 2) {
      const n = (T[i][j] === '1') + (T[i][j + 1] === '1') + (T[i + 1][j] === '1') + (T[i + 1][j + 1] === '1');
      fila += n > 3 ? '1' : '0';
    }
    out.push(fila);
  }
  return out;
}

// ------------------------------------------------------------ variante XOR (3 sombras)
function varianteXor(ctx) {
  const L = ctx.local;
  L.xorSombras = h('div.qr-sombras', { role: 'group', 'aria-label': 'Sombras que se combinan' });
  L.xorResultado = h('figure.qr-xor__resultado');
  L.xorMensaje = h('p.qr-xor__mensaje', { 'aria-live': 'polite' });
  L.xorCaja = h('div.qr-xor', { hidden: true }, L.xorSombras, h('span.qr-xor__igual', { 'aria-hidden': 'true' }, '='), L.xorResultado);
  L.xorCargando = h('p.texto-3', 'Preparando las sombras…');
  const det = h('details.detalles.esq-cuentas.qr-plegable',
    h('summary', icono('capas'), h('span', 'Versión digital: tres sombras que solo funcionan juntas')),
    h('div.esq-cuentas__cuerpo',
      h('p', 'Aquí el QR se parte en ', h('strong', '3 sombras'), '. No se enciman: la computadora revisa cada cuadrito y cuenta en cuántas sombras está negro. Si es un número impar, lo pinta negro; si es par, blanco (eso se llama XOR).'),
      L.xorCargando, L.xorCaja, L.xorMensaje,
      h('p.texto-3', 'Encimar acetatos solo suma tinta; esta cuenta no se puede hacer a simple vista. Por eso esta versión la combina una computadora o un teléfono, y a cambio el QR sale perfecto, sin textura gris.')));
  det.addEventListener('toggle', () => { if (det.open && !L.xor && !L.xorPidiendo) pedirXor(ctx); });
  return det;
}

async function pedirXor(ctx) {
  const L = ctx.local;
  L.xorPidiendo = true;
  let r;
  try {
    r = await K.post('qr/visual', { texto: L.visTexto || L.visEntrada.value, tipo: 'xor', sombras: 3 });
  } catch (e) {
    ctx.ui.mostrarError(e);
    texto(L.xorCargando, 'No se pudieron preparar las sombras. Cierra y vuelve a abrir para reintentar.');
    return;
  } finally {
    L.xorPidiendo = false;
  }
  L.xor = r;
  L.xorCargando.hidden = true;
  L.xorCaja.hidden = false;
  K.reemplazar(L.xorSombras, r.sombras.map((S, i) => {
    const n = i + 1;
    const b = h('button.qr-sombra', { type: 'button', 'aria-pressed': 'false', dataset: { n } },
      h('span.qr-sombra__qr', K.qrSvg(S, { margen: 1 })), h('span.qr-sombra__nombre', `Sombra ${n}`));
    b.addEventListener('click', () => {
      if (L.xorSel.has(n)) L.xorSel.delete(n); else L.xorSel.add(n);
      pintarXor(ctx);
    });
    return b;
  }));
  pintarXor(ctx);
}

function pintarXor(ctx) {
  const L = ctx.local;
  const r = L.xor;
  if (!r) return;
  for (const b of L.xorSombras.children) attr(b, 'aria-pressed', L.xorSel.has(Number(b.dataset.n)) ? 'true' : 'false');
  const elegidas = [...L.xorSel].sort((a, b) => a - b).map((n) => r.sombras[n - 1]);
  const todas = elegidas.length === r.sombras.length;
  attr(L.xorResultado, 'data-completo', todas ? '' : null);
  K.reemplazar(L.xorResultado,
    elegidas.length
      ? K.qrSvg(K.combinar(elegidas, 'xor'), { margen: 1, titulo: todas ? 'Resultado: el QR secreto' : 'Resultado: ruido' })
      : h('span.qr-xor__vacio', 'Elige sombras'),
    h('figcaption', todas ? '¡El QR!' : 'Resultado'));
  texto(L.xorMensaje, elegidas.length === 0 ? 'Elige qué sombras combinar.'
    : todas ? '¡Las tres juntas devuelven el QR exacto, cuadro por cuadro!'
      : elegidas.length === 1 ? 'Una sombra sola: ruido. No se lee nada.'
        : `${elegidas.length} de ${r.sombras.length}: sigue siendo ruido. Falta una.`);
}

// ================================================================ cuentas
function cuentas(ctx) {
  const L = ctx.local;
  L.qrInfo = h('p', 'Cuando imprimas las hojas, aquí verás de qué tamaño salió su QR.');
  L.formatoCuerpo = h('div.qr-cuentas-bloque', h('p.texto-3', 'Imprime las hojas y aquí verás, campo por campo, qué dice una.'));
  L.realCuerpo = h('div.qr-cuentas-bloque', h('p.texto-3', 'Cuando recuperes el secreto arriba, aquí verás las cuentas con tus hojas.'));
  return K.cuentas('Ver las cuentas',
    h('h4.qr-subtitulo', 'Un byte a la vez, en GF(2⁸)'),
    h('p', 'Cada byte del secreto se reparte por separado, con su propia curva al azar de grado k − 1. Las cuentas se hacen en GF(2⁸): 256 valores donde sumar es XOR (⊕) y multiplicar es multiplicar polinomios módulo x⁸ + x⁴ + x³ + x + 1 (el de AES, 0x11B). Así cada pedazo mide lo mismo que el secreto y no hay que elegir primos.'),
    h('p', 'El ejemplo a mano del documento: el byte 0x53, umbral 2 de 3, con el coeficiente al azar a₁ = 0xCA.'),
    h('p.esq-cuenta', [
      'f(x) = 0x53 ⊕ 0xCA·x',
      'f(1) = 0x99    f(2) = 0xDC    f(3) = 0x16',
      'con las partes 1 y 2:  λ₁ = 2/(2⊕1) = 2/3 = 0xF7    λ₂ = 1/(1⊕2) = 1/3 = 0xF6',
      's = 0x99·0xF7 ⊕ 0xDC·0xF6 = 0xEE ⊕ 0xBD = 0x53  ✓',
    ].join('\n')),
    h('h4.qr-subtitulo', 'Y con tu último escaneo'),
    L.realCuerpo,
    h('h4.qr-subtitulo', 'Qué dice cada hoja: el formato SSQR1'),
    h('p.esq-cuenta', 'SSQR1 : ID : k : n : x : DATOS : CRC'),
    L.formatoCuerpo,
    h('h4.qr-subtitulo', 'Dos niveles de protección'),
    h('p', h('strong', 'El CRC-32'), ' protege cada hoja contra errores accidentales (una mancha, una letra mal copiada). Pero quien altera su hoja a propósito puede recalcularlo.'),
    h('p', h('strong', 'La comprobación interna'), ' cubre ese hueco: antes de repartir se añaden al secreto 4 bytes de su huella SHA-256, S′ = S ‖ SHA-256(S)[0..3]. Viajan repartidos como el resto, no revelan nada con menos de k hojas y, al reconstruir, una hoja alterada los hace fallar con probabilidad 1 − 2⁻³². Es la misma idea que el «digest share» de SLIP-39 y SSKR.'),
    h('h4.qr-subtitulo', 'El QR por dentro'),
    h('p', 'Un QR versión v es una cuadrícula de (17 + 4v) × (17 + 4v) módulos. Su corrección de errores (Reed–Solomon) tiene cuatro niveles: L, M, Q y H recuperan cerca de 7 %, 15 %, 25 % y 30 % de daño. Para un respaldo que puede mancharse conviene Q o H; aquí se usa H.'),
    L.qrInfo,
    h('h4.qr-subtitulo', 'Los acetatos (Naor y Shamir)'),
    h('p', 'Cada módulo del QR se vuelve un bloque de 2 × 2 puntos. Se elige al azar uno de los 6 patrones con dos puntos negros. Si el módulo es blanco, los dos acetatos reciben el mismo patrón; si es negro, patrones opuestos. Encimados (tinta sobre tinta, un OR), el negro queda 4/4 y el blanco 2/4: cada acetato solo es una colección uniforme de bloques «medio negros» y no dice nada.'),
    h('p.esq-cuenta', 'blanco: A = ▚, B = ▚  →  A ∨ B = ▚  (2/4: gris)\nnegro:  A = ▚, B = ▞  →  A ∨ B = █  (4/4: negro)\nlimpiar: módulo negro si el promedio del bloque > 3/4'),
    h('p', 'La versión de 3 sombras: S₁ y S₂ son ruido uniforme y S₃ = M ⊕ S₁ ⊕ S₂. Cualesquiera dos son ruido; las tres juntas, S₁ ⊕ S₂ ⊕ S₃ = M. Es el cifrado de Vernam en dos dimensiones.'),
    h('h4.qr-subtitulo', 'La bóveda'),
    h('p', 'El documento se cifra con AES-GCM bajo una llave al azar de 16 bytes; el QR grande lleva SSQRV:Base32(número al azar ‖ cifrado ‖ etiqueta). Solo la llave se reparte con Shamir. La etiqueta de GCM hace que una llave equivocada produzca un error, nunca un documento falso.'));
}

/** La hoja más interesante (la alterada, si hay) explicada campo por campo, con su CRC recalculado. */
function pintarFormato(ctx) {
  const L = ctx.local;
  if (!L.formatoCuerpo) return;
  const hoja = L.hojas.find((hh) => hh.estado !== 'intacta') ?? L.hojas[0];
  const c = hoja && partir(hoja.texto);
  if (!c) return;
  const calculado = crc32(c.cuerpo);
  const est = ESTADOS[hoja.estado];
  K.reemplazar(L.formatoCuerpo,
    h('p', `La hoja ${hoja.x}${est ? ` (${est.sello.toLowerCase()})` : ''} dice:`),
    h('p.esq-cuenta.qr-ssqr',
      h('span', { dataset: { campo: 'pre' } }, 'SSQR1'), ':', h('span', { dataset: { campo: 'id' } }, c.id), ':',
      h('span', { dataset: { campo: 'kn' } }, `${c.k}:${c.n}`), ':', h('span', { dataset: { campo: 'x' } }, String(c.x)), ':',
      h('span', { dataset: { campo: 'datos' } }, c.datos), ':', h('span', { dataset: { campo: 'crc' } }, c.crc)),
    K.renglones([
      ['Formato y versión', 'SSQR1'],
      ['ID: número de serie del respaldo (4 bytes al azar; no sale del secreto, para no dar pistas)', c.id],
      ['k y n: hacen falta k de n', `${c.k} de ${c.n}`],
      ['x: número de hoja', String(c.x)],
      ['DATOS: el pedazo en Base32 (secreto + 4 bytes de comprobación)', `${K.corto(c.datos, 8)} · ${deB32(c.datos)?.length ?? '?'} bytes`],
      ['CRC impreso', c.crc],
      ['CRC-32 recalculado aquí', `${calculado} ${calculado === c.crc ? '✓ cuadra' : '✗ no cuadra'}`],
    ]),
    h('p', 'Por qué Base32: solo usa A–Z y 2–7, que caben en el modo alfanumérico del QR (5.5 bits por letra). El pedazo crece 10 %, contra 33 % con Base64.'));
}

/** Rehace en el navegador el algoritmo de lectura con las hojas del último escaneo. */
async function pintarCuentasReales(ctx) {
  const L = ctx.local;
  const u = L.ultimo;
  if (!u || !L.realCuerpo) return;
  const k = L.reparto.k;
  const hojas = u.hojas.map((hh) => ({ ...hh, c: partir(hh.texto) }));
  const revisadas = hojas.map((hh) => ({ ...hh, calc: hh.c ? crc32(hh.c.cuerpo) : null }));
  const piezas = [
    h('p', `Se escanearon ${nHojas(hojas.length)}. Primero, cada una por separado (su CRC-32):`),
    K.renglones(revisadas.map((hh) => [`Hoja ${hh.x}`,
      hh.c ? `impreso ${hh.c.crc} · calculado ${hh.calc} ${hh.calc === hh.c.crc ? '✓' : '✗'}` : 'no es una hoja SSQR1'])),
  ];
  const mala = revisadas.find((hh) => !hh.c || hh.calc !== hh.c.crc);
  const ids = [...new Set(revisadas.map((hh) => hh.c?.id))];
  let alto = null;
  if (mala) alto = `La hoja ${mala.x} no pasa: el lector se detiene aquí («dañada»).`;
  else if (ids.length !== 1) alto = `Los números de serie no coinciden (${ids.join(' ≠ ')}): el lector se detiene aquí («mezcladas»).`;
  else if (hojas.length < k) alto = `Hay ${hojas.length} de ${k} hojas: el lector se detiene aquí («insuficientes»).`;
  if (alto) {
    K.reemplazar(L.realCuerpo, ...piezas, h('p', h('strong', alto)));
    return;
  }
  const xs = hojas.map((hh) => hh.x);
  const ys = hojas.map((hh) => deB32(hh.c.datos));
  const lam = lagrange(xs);
  const largo = ys[0].length;
  const salida = Array.from({ length: largo }, (_, t) => ys.reduce((a, y, j) => a ^ mul(y[t], lam[j]), 0));
  const secreto = salida.slice(0, -4);
  const dentro = salida.slice(-4);
  const original = new TextEncoder().encode(L.secretoImpreso)[0];
  piezas.push(
    h('p', 'Todas pasan. Luego los pesos λ (dependen solo de qué hojas se juntan; en GF(2⁸) restar también es ⊕):'),
    h('p.esq-cuenta', xs.map((xj, j) => {
      const otros = xs.filter((xm) => xm !== xj);
      return `λ${sub(xj)} = (${otros.join('·')}) / (${otros.map((xm) => `(${xm}⊕${xj})`).join('·')}) = ${hex(lam[j])}`;
    }).join('\n')),
    h('p', 'El primer byte del secreto es la suma (⊕) de cada pedazo por su peso:'),
    h('p.esq-cuenta', `${ys.map((y, j) => `${hex(y[0])}·${hex(lam[j])}`).join(' ⊕ ')}\n= ${ys.map((y, j) => hex(mul(y[0], lam[j]))).join(' ⊕ ')}\n= ${hex(salida[0])}  → ${letra(salida[0])}`),
    salida[0] !== original
      ? h('p', h('strong', `Con la hoja alterada, el primer byte salió ${hex(salida[0])} ${letra(salida[0])} en vez de ${hex(original)} ${letra(original)}.`))
      : null,
    h('p', `Lo mismo, byte por byte, con los ${largo} bytes. Los últimos 4 son la comprobación escondida: deben ser iguales a los primeros 4 bytes de SHA-256 del resto.`));
  const huella = await sha256(secreto);
  const renglones = [
    ['Secreto reconstruido', new TextDecoder().decode(Uint8Array.from(secreto))],
    ['Comprobación que venía dentro', dentro.map(hex).join(' ')],
  ];
  if (huella) {
    const cuadra = huella.slice(0, 4).every((b, i) => b === dentro[i]);
    renglones.push(['SHA-256 del secreto, primeros 4 bytes', huella.slice(0, 4).map(hex).join(' ')], ['¿Cuadra?', cuadra ? 'sí ✓' : 'no ✗: alguna hoja fue alterada']);
  } else {
    renglones.push(['¿Cuadra? (según el lector)', u.res.codigo === 'abierto' ? 'sí ✓' : 'no ✗: alguna hoja fue alterada']);
  }
  piezas.push(K.renglones(renglones));
  if (L.ultimo !== u) return;               // llegó otro escaneo mientras se calculaba la huella
  K.reemplazar(L.realCuerpo, ...piezas);
}

// ================================================================ utilidades (cuentas en el navegador)
const RE_SSQR1 = /^SSQR1:([0-9A-F]{8}):(\d{1,3}):(\d{1,3}):(\d{1,3}):([A-Z2-7]+):([0-9A-F]{8})$/;
function partir(t) {
  const limpio = String(t ?? '').trim();
  const m = RE_SSQR1.exec(limpio);
  return m ? { id: m[1], k: Number(m[2]), n: Number(m[3]), x: Number(m[4]), datos: m[5], crc: m[6], cuerpo: limpio.slice(0, limpio.lastIndexOf(':')) } : null;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function deB32(t) {
  let bits = 0;
  let valor = 0;
  const out = [];
  for (const ch of t) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    valor = ((valor << 5) | v) & 0xfff;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((valor >> bits) & 0xff); }
  }
  return out;
}

function crc32(cadena) {
  let crc = 0xffffffff;
  for (const b of new TextEncoder().encode(cadena)) {
    let c = (crc ^ b) & 0xff;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

async function sha256(lista) {
  try {
    if (!globalThis.crypto?.subtle) return null;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(lista))));
  } catch {
    return null;
  }
}

// GF(2⁸) con el polinomio de AES (0x11B) y tablas de exponentes/logaritmos (algoritmo 1 del documento)
const GF = (() => {
  const EXP = new Array(510);
  const LOG = new Array(256).fill(0);
  let v = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = EXP[i + 255] = v;
    LOG[v] = i;
    v ^= (v << 1) ^ (v & 0x80 ? 0x11b : 0);         // v ← 3·v
    v &= 0xff;
  }
  return { EXP, LOG };
})();
const mul = (a, b) => (a && b ? GF.EXP[GF.LOG[a] + GF.LOG[b]] : 0);
const inv = (a) => GF.EXP[255 - GF.LOG[a]];
function lagrange(xs) {
  return xs.map((xj) => {
    let num = 1;
    let den = 1;
    for (const xm of xs) if (xm !== xj) { num = mul(num, xm); den = mul(den, xm ^ xj); }
    return mul(num, inv(den));
  });
}

const hex = (b) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`;
const letra = (b) => (b >= 0x20 && b < 0x7f ? `«${String.fromCharCode(b)}»` : '(no es una letra)');
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n) => String(n).split('').map((d) => SUB[Number(d)]).join('');
