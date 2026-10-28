// ESQUEMA 1 · Partir un secreto en pedazos (esquema de Shamir) — implementación de referencia del kit.
//  Paso 1: escribe el secreto y elige «k de n».  Paso 2: cada rector recibe un pedazo (parece ruido).
//  Paso 3: junta pedazos en la mesa y abre: con k se abre; con menos sale basura; con uno falso, la
//  huella pública lo delata. Debajo: la idea en un dibujo (2 puntos ≠ 1 parábola), las cuentas de
//  verdad con números pequeños (p = 31) y dónde se usa.
// API: POST /api/esquemas/shamir/repartir | /reconstruir | /juguete

import * as K from './_kit.js';

const { h, s, icono, texto, attr } = K;
const SECRETO_INICIAL = 'Llave maestra del consorcio · 2026';
const MAX_BYTES = 60;
const bytes = (t) => new TextEncoder().encode(t).length;

export default {
  montar(host, ctx, meta) {
    const L = Object.assign(ctx.local, { n: 5, k: 3, reparto: null, elegidos: new Set(), tramposo: null, ultimo: null });
    const id = (x) => `esq-shamir-${ctx.modo}-${x}`;

    // ------------------------------------------------------------ paso 1
    L.entrada = h('input.entrada', { id: id('secreto'), name: 'secreto', value: SECRETO_INICIAL, autocomplete: 'off', spellcheck: 'false' });
    L.contador = h('p.campo__ayuda', { id: id('secreto-ayuda') });
    L.entrada.setAttribute('aria-describedby', L.contador.id);
    L.entrada.addEventListener('input', () => { pintarContador(L); ctx.ui.limpiarCampos(L.form); });
    L.segN = K.segmentado({ nombre: 'n', etiqueta: '¿Entre cuántos rectores?', valor: L.n,
      opciones: [3, 4, 5, 6, 7].map((v) => ({ valor: v })), alCambiar: (v) => { L.n = v; ajustarK(L); pintarFrase(L); } });
    L.segK = K.segmentado({ nombre: 'k', etiqueta: '¿Cuántos hacen falta para abrir?', valor: L.k,
      opciones: [], alCambiar: (v) => { L.k = v; pintarFrase(L); } });
    ajustarK(L);
    L.frase = h('p.esq-frase', { 'aria-live': 'polite' });
    L.botonRepartir = h('button.boton.boton--primario', { type: 'submit' }, icono('piezas'), h('span', 'Partir en pedazos'));
    L.form = h('form.esq-form', { novalidate: true },
      h('div.esq-campos',
        h('div.campo.campo--ancho', h('label.campo__etiqueta', { for: L.entrada.id }, 'El secreto'), L.entrada, L.contador),
        h('div.campo', h('span.campo__etiqueta', '¿Entre cuántos rectores?'), L.segN),
        h('div.campo', h('span.campo__etiqueta', '¿Cuántos hacen falta para abrir?'), L.segK)),
      L.frase,
      h('div.esq-acciones', L.botonRepartir));
    L.form.addEventListener('submit', (e) => { e.preventDefault(); repartir(ctx); });
    pintarContador(L);
    pintarFrase(L);
    L.paso1 = K.paso({ n: 1, titulo: 'Escribe el secreto y decide cuántas personas', ayuda: 'Puede ser cualquier frase corta: la llave de la bóveda, una contraseña, un PIN. Luego elige entre cuántos rectores se reparte y cuántos deben reunirse para abrirla.', id: id('p1') }, L.form);

    // ------------------------------------------------------------ paso 2
    L.custodios = h('ol.sh-custodios', { role: 'list' });
    L.huella = h('p.sh-huella', { hidden: true });
    L.paso2 = K.paso({ n: 2, titulo: 'Cada rector recibe un pedazo', estado: 'espera', id: id('p2'),
      ayuda: 'Cada pedazo parece ruido: por sí solo no dice NADA del secreto. Pulsa los pedazos que quieras llevar a la mesa de reunión.' },
    h('p.sh-espera', 'Primero parte el secreto en el paso 1.'), L.custodios, L.huella);

    // ------------------------------------------------------------ paso 3
    L.mesa = h('div.sh-mesa', { 'aria-hidden': 'true' });
    L.mesaTexto = h('p.sh-mesa__texto', { 'aria-live': 'polite' });
    L.botonAbrir = h('button.boton.boton--primario', { type: 'button', disabled: true }, icono('candado'), h('span', 'Intentar abrir'));
    L.botonAzar = h('button.boton.boton--secundario', { type: 'button', disabled: true }, icono('dado'), h('span', 'Elegir al azar'));
    L.botonVaciar = h('button.boton.boton--fantasma', { type: 'button', disabled: true }, 'Vaciar la mesa');
    L.botonAbrir.addEventListener('click', () => abrirCaja(ctx));
    L.botonAzar.addEventListener('click', () => { elegirAlAzar(L, L.k); pintarCustodios(ctx); });
    L.botonVaciar.addEventListener('click', () => { L.elegidos.clear(); pintarCustodios(ctx); });
    L.veredicto = K.veredicto({ vacio: 'Lleva pedazos a la mesa y pulsa «Intentar abrir».' });
    L.explica = K.explicacion();
    L.paso3 = K.paso({ n: 3, titulo: 'Reúne pedazos y abre la caja', estado: 'espera', id: id('p3'),
      ayuda: 'Prueba con menos pedazos de los necesarios y con distintos grupos de rectores.' },
    h('div.sh-mesa-marco', L.mesa, L.mesaTexto),
    h('div.esq-acciones', L.botonAbrir, L.botonAzar, L.botonVaciar), L.veredicto, L.explica);

    // ------------------------------------------------------------ trampas
    const trampas = K.trampas([
      { etiqueta: 'Abrir con un pedazo de menos', texto: 'Dos rectores intentan abrir sin el tercero.', fn: (b) => conMenos(ctx, b) },
      { etiqueta: 'Un rector entrega un pedazo falso', texto: 'Cambia su pedazo a escondidas antes de la reunión.', fn: (b) => conFalso(ctx, b) },
      { etiqueta: 'Abrir con otro grupo de rectores', texto: 'Otros rectores, el mismo número: ¿sale lo mismo?', fn: (b) => conOtros(ctx, b) },
    ]);
    L.trampas = trampas;
    trampas.hidden = true;

    host.append(
      K.cabecera({ numero: meta.numero, icono: meta.icono, titulo: meta.titulo, id: id('titulo'),
        metafora: 'Imagina una caja fuerte con cinco llaveros: se abre con tres cualesquiera, y con dos no se abre ni se adivina nada.',
        historia: 'El consorcio guarda una llave maestra con la que firma los títulos. Para que nadie pueda usarla solo —y para no perderla si alguien falta— se parte en pedazos y cada rector guarda uno.',
        tecnico: 'esquema de Shamir (1979). Los pedazos son puntos de una curva; el secreto es donde la curva corta el eje.' }),
      h('div.esq-pasos', L.paso1, L.paso2, L.paso3),
      trampas,
      dibujo(ctx),
      cuentasJuguete(ctx),
      K.saberMas(
        h('ul',
          h('li', h('strong', 'Internet: '), 'la llave que protege los respaldos de la raíz del DNS se reparte entre 7 personas de distintos países; hacen falta 5.'),
          h('li', h('strong', 'Centros de datos: '), 'HashiCorp Vault arranca «sellado»; 3 de 5 operadores deben entregar su parte para abrirlo.'),
          h('li', h('strong', 'Criptomonedas: '), 'Trezor (SLIP-39) reparte la semilla de la billetera en frases de palabras; Ledger Recover la reparte 2 de 3 entre tres empresas.'),
          h('li', h('strong', 'Firmas de umbral: '), 'FROST (RFC 9591) firma con los pedazos sin reconstruir nunca la llave.')),
        h('p', h('strong', 'Límites: '), 'un pedazo falso da un resultado equivocado sin avisar (por eso aquí se publica la huella del secreto); quien reparte ve el secreto; y al reconstruir, el secreto vuelve a existir completo en una máquina.')),
    );
  },
};

// ================================================================ paso 1
function pintarContador(L) {
  const n = bytes(L.entrada.value);
  texto(L.contador, `${n} de ${MAX_BYTES} bytes${n > MAX_BYTES ? ' · demasiado largo' : ''} (las letras con acento ocupan 2).`);
  attr(L.contador, 'data-excede', n > MAX_BYTES ? '' : null);
}

function ajustarK(L) {
  if (L.k > L.n) L.k = L.n;
  L.segK.opciones(Array.from({ length: L.n - 1 }, (_, i) => ({ valor: i + 2 })), L.k);
}

function pintarFrase(L) {
  K.reemplazar(L.frase, 'Cualesquiera ', h('strong', `${L.k} de ${L.n}`), ' rectores podrán abrirla; ',
    L.k - 1 === 1 ? 'uno solo no sabrá nada.' : `${L.k - 1} o menos no sabrán nada.`);
  texto(L.botonRepartir.querySelector('span'), `Partir en ${L.n} pedazos`);
}

async function repartir(ctx) {
  const L = ctx.local;
  let r;
  try {
    r = await ctx.ui.ocupado(L.botonRepartir, K.post('shamir/repartir', { secreto: L.entrada.value, k: L.k, n: L.n }));
  } catch (e) {
    ctx.ui.mostrarError(e, { form: L.form });      // marca el campo «secreto» si el servidor lo señala
    return;
  }
  Object.assign(L, { reparto: r, elegidos: new Set(), tramposo: null, ultimo: null });
  K.marcarPaso(L.paso1, 'hecho');
  K.marcarPaso(L.paso2, 'activo');
  K.marcarPaso(L.paso3, 'activo');
  L.paso2.querySelector('.sh-espera').hidden = true;
  L.trampas.hidden = false;
  K.reemplazar(L.huella, icono('sello'), ' Huella pública del secreto: ', h('code.esq-valor', r.huella),
    h('span.texto-3', ' · se anuncia a todos para comprobar, al abrir, que nadie entregó un pedazo falso.'));
  L.huella.hidden = false;
  K.pintarVeredicto(L.veredicto, null);
  K.explicar(L.explica);
  pintarCustodios(ctx, { nuevo: true });
  K.narrar(ctx, `Llave repartida en ${r.n} pedazos`, `Cada rector guarda un pedazo. Cualesquiera ${r.k} la recuperan; ${r.k - 1} o menos no saben nada de ella.`, 'ok');
}

// ================================================================ paso 2
function pintarCustodios(ctx, { nuevo = false } = {}) {
  const L = ctx.local;
  const r = L.reparto;
  if (!r) return;
  const items = r.partes.map((p, i) => {
    const idInst = K.IDS[i];
    const elegido = L.elegidos.has(p.x);
    const falso = L.tramposo === p.x;
    const boton = h('button.sh-custodio__boton', { type: 'button', 'aria-pressed': elegido ? 'true' : 'false' },
      h('span.sh-custodio__pedazo', h('span.etiqueta-instrumento', `Pedazo ${p.x}`), falso ? h('span.sh-custodio__falso', 'falso') : null),
      h('span.sh-custodio__inst', h('strong', K.inst.sigla(idInst)), h('span', `Rectoría · ${K.inst.nombre(idInst)}`)),
      K.ruido(falso ? textoFalso(p.y) : p.y),
      h('span.sh-custodio__valor.mono', K.corto((falso ? textoFalso(p.y) : p.y).replace(/^0+/, ''), 5)),
      h('span.sh-custodio__accion', icono(elegido ? 'ok' : 'mas'), elegido ? 'En la mesa' : 'Llevar a la mesa'));
    boton.addEventListener('click', () => {
      if (L.elegidos.has(p.x)) L.elegidos.delete(p.x); else L.elegidos.add(p.x);
      pintarCustodios(ctx);
      L.custodios.querySelector(`[data-x="${p.x}"] button`)?.focus();
    });
    return h('li.sh-custodio', { dataset: { x: p.x, elegido: elegido ? 'si' : 'no', falso: falso ? 'si' : 'no' } }, boton);
  });
  K.reemplazar(L.custodios, items);
  if (nuevo) K.anim.escalonar(L.custodios.children, [{ opacity: 0, transform: 'translateY(8px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: K.anim.DUR.entrada }, 50);
  pintarMesa(L);
}

function textoFalso(y) {
  // el «pedazo falso»: el mismo número con la última cifra cambiada
  const u = parseInt(y.slice(-1), 16);
  return y.slice(0, -1) + ((u + 1) % 16).toString(16);
}

function pintarMesa(L) {
  const r = L.reparto;
  const t = L.elegidos.size;
  const k = r?.k ?? L.k;
  K.reemplazar(L.mesa, Array.from({ length: Math.max(k, t) }, (_, i) => h('span.sh-cerradura', {
    dataset: { estado: i < t ? (i < k ? 'llena' : 'extra') : 'vacia' },
  }, icono(i < t ? 'llave' : 'candado'))));
  K.texto(L.mesaTexto, !r ? '' : t === 0 ? `La mesa está vacía: hacen falta ${k} pedazos.`
    : t < k ? `${t} de ${k} pedazos en la mesa · faltan ${k - t}.`
      : t === k ? `${t} de ${k} pedazos en la mesa · justo los necesarios.`
        : `${t} pedazos en la mesa · ${t - k} de sobra (también funciona).`);
  L.botonAbrir.disabled = !r || t === 0;
  L.botonAzar.disabled = !r;
  L.botonVaciar.disabled = !r || t === 0;
}

function elegirAlAzar(L, cuantos, incluir = null) {
  const xs = L.reparto.partes.map((p) => p.x).filter((x) => x !== incluir);
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  L.elegidos = new Set([...(incluir ? [incluir] : []), ...xs].slice(0, cuantos));
}

// ================================================================ paso 3
async function abrirCaja(ctx, boton = ctx.local.botonAbrir) {
  const L = ctx.local;
  const r = L.reparto;
  if (!r || !L.elegidos.size) return;
  const partes = r.partes.filter((p) => L.elegidos.has(p.x)).map((p) => ({ x: p.x, y: L.tramposo === p.x ? textoFalso(p.y) : p.y }));
  const res = await K.accion(ctx, boton, K.post('shamir/reconstruir', { partes, k: r.k, huella: r.huella }));
  if (!res) return;
  L.ultimo = res;
  const quienes = partes.map((p) => K.inst.sigla(K.IDS[p.x - 1])).join(', ');
  if (res.veredicto === 'abierto') {
    K.pintarVeredicto(L.veredicto, { estado: 'ok', titulo: '¡Se abrió la caja!',
      texto: `Con ${res.partes_usadas} pedazos (${quienes}) salió el secreto:`, extra: h('p', h('q', res.resultado.texto)) });
    K.explicar(L.explica,
      h('p', 'Cada pedazo es un punto de una curva escondida. Con ', h('strong', `${r.k} puntos`), ' la curva queda fija y se puede leer dónde corta el eje: ese número es el secreto.'),
      'Prueba con otro grupo: cualesquiera que sean los rectores, si son suficientes, sale lo mismo.');
    K.narrar(ctx, 'La caja se abrió', `${quienes} reunieron ${res.partes_usadas} pedazos: bastan ${r.k}.`, 'ok');
  } else if (res.veredicto === 'insuficiente') {
    K.pintarVeredicto(L.veredicto, { estado: 'aviso', titulo: `No alcanza: ${res.faltan === 1 ? 'falta 1 pedazo' : `faltan ${res.faltan} pedazos`}`,
      texto: `Con ${res.partes_usadas} ${res.partes_usadas === 1 ? 'pedazo' : 'pedazos'} la cuenta da basura sin sentido:`,
      extra: h('p', h('q', res.resultado.texto || '·'), h('span.texto-3', ' — y un programa bien hecho ni siquiera lo intenta: exige conocer cuántos hacen falta.')) });
    K.explicar(L.explica,
      h('p', 'No es que el secreto esté «casi» descubierto: con menos de ', h('strong', `${r.k} pedazos`), ', por esos puntos pasan curvas para ', h('strong', 'cualquier'), ' secreto posible, y todas son igual de probables.'),
      'Mira el dibujo de abajo: por dos puntos pasan infinitas parábolas.');
    K.narrar(ctx, 'No se pudo abrir', `Solo hubo ${res.partes_usadas} de ${r.k} pedazos: lo que sale no revela nada.`, 'aviso');
  } else {
    const falso = L.tramposo ? K.inst.sigla(K.IDS[L.tramposo - 1]) : null;
    K.pintarVeredicto(L.veredicto, { estado: 'mal', titulo: '¡Pedazo falso detectado!',
      texto: 'La caja «abrió», pero lo que salió no coincide con la huella pública del secreto:', extra: h('p', h('q', res.resultado.texto || '·')) });
    K.explicar(L.explica,
      h('p', falso ? [h('strong', falso), ' cambió su pedazo. '] : null, 'Con un pedazo alterado la cuenta da otro número sin avisar; por eso se publica una huella del secreto: si no coincide, alguien hizo trampa.'),
      'Quita ese pedazo de la mesa y prueba con otros rectores.');
    K.narrar(ctx, 'Pedazo falso detectado', 'El resultado no coincide con la huella pública del secreto.', 'error');
  }
  pintarCuentasReales(ctx);
}

// ================================================================ trampas
async function conMenos(ctx, boton) {
  const L = ctx.local;
  if (!L.reparto) return;
  L.tramposo = null;
  elegirAlAzar(L, L.reparto.k - 1);
  pintarCustodios(ctx);
  await abrirCaja(ctx, boton);
}

async function conFalso(ctx, boton) {
  const L = ctx.local;
  if (!L.reparto) return;
  const xs = L.reparto.partes.map((p) => p.x);
  L.tramposo = xs[Math.floor(Math.random() * xs.length)];
  elegirAlAzar(L, L.reparto.k, L.tramposo);
  pintarCustodios(ctx);
  await abrirCaja(ctx, boton);
}

async function conOtros(ctx, boton) {
  const L = ctx.local;
  if (!L.reparto) return;
  const antes = [...L.elegidos].sort().join();
  L.tramposo = null;
  for (let i = 0; i < 8; i++) {
    elegirAlAzar(L, L.reparto.k);
    if ([...L.elegidos].sort().join() !== antes) break;
  }
  pintarCustodios(ctx);
  await abrirCaja(ctx, boton);
}

// ================================================================ dibujo
// Intuición geométrica (como la figura 1 del documento): sobre números reales, sólo para ver la idea.
const F = (x) => 13 + 7 * x + 4 * x * x;              // el polinomio del ejemplo del documento
const PX = (x) => 44 + (x / 5.4) * 268;
const PY = (y) => 186 - ((y + 10) / 175) * 172;

function dibujo(ctx) {
  const L = ctx.local;
  const svg = s('svg.sh-dibujo__svg', { viewBox: '0 0 320 200', role: 'img' });
  L.dibujoSvg = svg;
  L.recorte = `sh-recorte-${ctx.modo}`;
  const seg = K.segmentado({ nombre: 'puntos', etiqueta: 'Cuántos pedazos conoces', valor: 3,
    opciones: [{ valor: 2, texto: 'Con 2 pedazos' }, { valor: 3, texto: 'Con 3 pedazos' }], alCambiar: (v) => pintarDibujo(L, v) });
  L.dibujoPie = h('p.sh-dibujo__pie', { 'aria-live': 'polite' });
  pintarDibujo(L, 3);
  return h('section.sh-dibujo', { 'aria-labelledby': `esq-shamir-${ctx.modo}-dibujo` },
    h('div.sh-dibujo__texto',
      h('h3', { id: `esq-shamir-${ctx.modo}-dibujo` }, 'La idea en un dibujo'),
      h('p', 'Cada pedazo es un punto. Por 3 puntos pasa una sola parábola, y donde corta la línea vertical de la izquierda está el secreto. Con 2 puntos, en cambio, pasan parábolas para todos los gustos.'),
      seg, L.dibujoPie,
      h('p.texto-3.sh-dibujo__nota', 'Dibujo para la intuición, con números reales. La versión de verdad hace las cuentas «en reloj» (módulo un número primo), y ahí la curva no se ve: queda como un montón de puntos sueltos.')),
    h('div.sh-dibujo__lienzo', svg));
}

function curva(fn, clase, recorte) {
  let d = '';
  for (let i = 0; i <= 80; i++) {
    const x = (i / 80) * 5.4;
    d += `${i ? 'L' : 'M'}${PX(x).toFixed(1)} ${PY(fn(x)).toFixed(1)}`;
  }
  return s(`path.${clase}`, { d, 'clip-path': `url(#${recorte})` });
}

function pintarDibujo(L, cuantos) {
  const svg = L.dibujoSvg;
  const puntos = cuantos === 3 ? [1, 3, 5] : [1, 3];
  const ejes = [
    s('defs', s('clipPath', { id: L.recorte }, s('rect', { x: 44, y: 8, width: 270, height: 178 }))),
    s('line.sh-eje', { x1: PX(0), y1: PY(0), x2: PX(5.4), y2: PY(0) }),
    s('line.sh-eje.sh-eje--y', { x1: PX(0), y1: PY(-10), x2: PX(0), y2: PY(165) }),
    ...[1, 2, 3, 4, 5].map((x) => s('text.sh-marca', { x: PX(x), y: PY(0) + 12, 'text-anchor': 'middle' }, String(x))),
    s('text.sh-marca', { x: PX(0) - 6, y: PY(165) + 4, 'text-anchor': 'end' }, 'y'),
  ];
  let curvas;
  let etiquetas;
  if (cuantos === 3) {
    curvas = [curva(F, 'sh-curva', L.recorte)];
    etiquetas = [s('circle.sh-secreto', { cx: PX(0), cy: PY(13), r: 5 }),
      s('text.sh-secreto__texto', { x: PX(0) + 10, y: PY(13) + 19 }, 'secreto = 13')];
    attr(svg, 'aria-label', 'Tres puntos fijan una sola parábola, que corta el eje vertical en 13: el secreto.');
    K.texto(L.dibujoPie, 'Con 3 puntos la curva queda fija: corta el eje en 13, el secreto.');
  } else {
    // parábolas que pasan por (1, 24) y (3, 70) con distintos cortes S: b = (S − 1)/3, a = 24 − S − b
    const cortes = [0, 13, 32, 48];
    curvas = cortes.map((S) => { const b = (S - 1) / 3; const a = 24 - S - b; return curva((x) => S + a * x + b * x * x, 'sh-curva.sh-curva--duda', L.recorte); });
    etiquetas = cortes.flatMap((S) => [s('circle.sh-duda', { cx: PX(0), cy: PY(S), r: 3.5 }),
      s('text.sh-duda__texto', { x: PX(0) - 7, y: PY(S) + 4, 'text-anchor': 'end' }, `¿${S}?`)]);
    attr(svg, 'aria-label', 'Por dos puntos pasan muchas parábolas, cada una con un corte distinto en el eje: el secreto podría ser cualquiera.');
    K.texto(L.dibujoPie, 'Con 2 puntos: ¿el secreto es 0, 13, 32, 48…? Todas las curvas pasan por los dos puntos. No hay forma de saberlo.');
  }
  const puntosSvg = puntos.flatMap((x) => [s('circle.sh-punto', { cx: PX(x), cy: PY(F(x)), r: 5 }),
    s('text.sh-punto__texto', { x: PX(x) + (x === 5 ? -8 : 8), y: PY(F(x)) + (x === 5 ? 16 : -6), 'text-anchor': x === 5 ? 'end' : 'start' }, `pedazo ${x}`)]);
  K.reemplazar(svg, ...ejes, ...curvas, ...etiquetas, ...puntosSvg);
}

// ================================================================ cuentas
function cuentasJuguete(ctx) {
  const L = ctx.local;
  L.jugElegidas = new Set([1, 2, 3]);
  L.jugChips = h('div.sh-chips', { role: 'group', 'aria-label': 'Pedazos que se juntan' });
  L.jugCuerpo = h('div.sh-juguete');
  L.realCuerpo = h('div.sh-real', h('p.texto-3', 'Cuando abras la caja de arriba, aquí verás los números de verdad.'));
  pintarChipsJuguete(ctx);
  const det = K.cuentas('Ver las cuentas (con números pequeños)',
    h('p', 'El ejemplo del documento: secreto ', h('strong', '13'), ', se necesitan 3 de 5 pedazos y todo se hace módulo ', h('strong', '31'), ' (como un reloj de 31 horas). El repartidor elige al azar la curva ', h('code', 'f(x) = 13 + 7x + 4x²'), ' y cada pedazo es ', h('code', '(x, f(x) mod 31)'), '.'),
    h('p.campo__etiqueta', 'Elige qué pedazos se juntan'), L.jugChips, L.jugCuerpo,
    h('h4.sh-subtitulo', 'Y en la caja de arriba'), L.realCuerpo);
  det.addEventListener('toggle', () => { if (det.open && !L.jugCargado) { L.jugCargado = true; pedirJuguete(ctx); } });
  return det;
}

function pintarChipsJuguete(ctx) {
  const L = ctx.local;
  K.reemplazar(L.jugChips, [1, 2, 3, 4, 5].map((x) => {
    const b = h('button.sh-chip', { type: 'button', 'aria-pressed': L.jugElegidas.has(x) ? 'true' : 'false' }, `pedazo ${x}`);
    b.addEventListener('click', () => {
      if (L.jugElegidas.has(x)) { if (L.jugElegidas.size > 1) L.jugElegidas.delete(x); } else L.jugElegidas.add(x);
      pintarChipsJuguete(ctx);
      pedirJuguete(ctx);
    });
    return b;
  }));
}

async function pedirJuguete(ctx) {
  const L = ctx.local;
  const elegidas = [...L.jugElegidas].sort((a, b) => a - b);
  let r;
  try { r = await K.post('shamir/juguete', { elegidas }); } catch (e) { ctx.ui.mostrarError(e); return; }
  const tabla = h('div.tabla-marco', h('table.tabla.sh-tabla',
    h('thead', h('tr', h('th', 'Pedazo x'), h('th.num', 'f(x) sin reducir'), h('th.num', 'pedazo = f(x) mod 31'))),
    h('tbody', r.tabla.map((f) => h('tr', { 'aria-selected': elegidas.includes(f.x) ? 'true' : null },
      h('td', `x = ${f.x}`), h('td.num', String(f.sin_reducir)), h('td.num', h('strong', String(f.y))))))));
  let resto;
  if (r.suficientes) {
    const lam = r.lambdas.map((l) => `λ${sub(l.x)} = ${l.den === 1 ? l.num : `${l.num}/${l.den} ≡ ${l.mod}`}`).join('    ');
    const suma = r.terminos.map((t) => `${t.y}·${t.lambda < 0 ? `(${t.lambda})` : t.lambda}`).join(' + ');
    resto = [
      h('p', 'Los «coeficientes de Lagrange» dicen cuánto pesa cada pedazo; dependen solo de qué pedazos se juntan:'),
      h('p.esq-cuenta', lam),
      h('p', 'El secreto es la suma de cada pedazo por su peso, módulo 31:'),
      h('p.esq-cuenta', `S = ${suma} = ${r.total} ≡ ${r.reconstruido} (mod 31)  ✓`),
    ];
  } else if (r.candidatos) {
    resto = [
      h('p', 'Con 2 pedazos no alcanza: para ', h('strong', 'cada'), ' secreto del 0 al 30 existe exactamente una curva que pasa por ellos. Los 31 son igual de posibles:'),
      h('ol.sh-candidatos', { role: 'list' }, r.candidatos.map((c) => h('li', { title: `f(x) = ${c.secreto} + ${c.a1}x + ${c.a2}x²` }, String(c.secreto)))),
    ];
  } else {
    resto = [h('p', 'Con un solo pedazo, cualquier secreto es posible (y de muchísimas maneras).')];
  }
  K.reemplazar(L.jugCuerpo, tabla, ...resto);
}

function pintarCuentasReales(ctx) {
  const L = ctx.local;
  const r = L.ultimo;
  if (!r) return;
  K.reemplazar(L.realCuerpo,
    h('p', 'Lo mismo, pero con un primo enorme: 2', h('sup', '521'), ' − 1 (157 cifras). El secreto se convierte en un número, la curva tiene grado ', h('strong', String(L.reparto.grado)), ' y cada pedazo es un número de 132 cifras hexadecimales.'),
    K.renglones([
      ['Pedazos usados', String(r.partes_usadas)],
      ['Hacían falta', String(r.k)],
      ...r.lambdas.map((l) => [`Peso λ del pedazo ${l.x}`, K.corto(l.lambda, 10)]),
      ['Resultado', r.resultado.legible ? r.resultado.texto : `basura (${K.corto(r.resultado.hex, 10)})`],
      ['¿Coincide con la huella?', r.coincide_huella === null ? '—' : r.coincide_huella ? 'sí' : 'no'],
    ]));
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n) => String(n).split('').map((d) => SUB[Number(d)]).join('');
