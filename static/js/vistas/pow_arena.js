// VISTA · Arena de minería (Proof of Work) — «Título Seguro»
//
// Idea rectora: «las instituciones compiten por sellar el siguiente bloque de registros, y la
// carrera es de suerte, no de velocidad». Cada institución minera prueba k nonces por ronda en
// su carril (i, i+N, i+2N…): nadie es más rápida ni repite trabajo. Lo único que las distingue
// es lo cerca que queda su última huella del OBJETIVO de d ceros. Cada carril muestra esa huella
// como casillas con el objetivo enmarcado; cuando una institución llena el marco, sella el bloque
// y todas se detienen. La ganadora cobra créditos de certificación que maduran 6 bloques después.
//
// Piezas: mesa de control · marcador (ronda, intentos frente a 16^d) · telar de nonces (k por
// ronda, carriles disjuntos) · pista (un carril por institución) · desenlace (bloque, límite,
// cancelación, error) · empate de ronda · maduración de los créditos ganados (h → h+6 → gastable
// en h+7) · cómo funciona.
//
// Durante una carrera `actualizar` llega cada 250 ms: todo se parchea en sitio (nada se
// reconstruye), así no se pierde el foco ni se cortan las animaciones.

import { registrarFrase } from '../narrador.js';
import { registrarTermino } from '../glosario.js';
import { num, plural, hashCorto, cerosIniciales } from '../util/fmt.js';
import { marcaInst, etiqueta, etiquetaLarga, siglaDe, nombre as nombreInst, cc, conInstituciones } from './_bloque_ui.js';

const CELDAS = 12;              // caracteres de la huella dibujados como casillas
const FILAS_TELAR = 8;          // nonces por minero que se dibujan en el telar (k puede ser 2000)
const MADURAS_VISIBLES = 2;     // recompensas ya maduras que se conservan en la línea de tiempo
const RE_ENTERO = /^\d+$/;
const PCT = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 });

const MINERO = {
  probando: ['probando', 'acento'],
  ganador: ['sella', 'valido'],
  obsoleto: ['obsoleta', 'obsoleto'],
  detenido: ['detenida', 'neutro'],
  inactivo: ['no sella', 'neutro'],
  espera: ['en espera', 'neutro'],
};
const TRABAJO = {
  minando: ['sellando', 'acento'],
  ganado: ['folio sellado', 'valido'],
  cancelado: ['cancelada', 'obsoleto'],
  limite: ['límite de rondas', 'advertencia'],
  error: ['error', 'rechazado'],
};

const sup = (d) => String(d).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]).join('');
const pct = (x) => (x > 0 && x < 0.001 ? '< 0.1 %' : PCT.format(x));
const primerDistinto = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; return i; };

// ======================================================= glosario y narrador
registrarTermino('ronda', {
  titulo: 'Ronda de sellado',
  texto: 'Un paso de la carrera: cada institución selladora activa prueba k nonces de su carril. Si alguna acierta, la carrera se cierra al terminar la ronda; si ninguna lo logra, empieza la siguiente.',
  ejemplo: 'Con 10 instituciones y k = 7, cada ronda prueba 70 nonces distintos.',
  ver: ['nonce', 'carril', 'obsoleta'],
});
registrarTermino('carril', {
  titulo: 'Carril de nonces',
  texto: 'La parte del espacio de nonces que le toca a cada institución selladora: la institución i solo prueba los nonces que dejan resto i al dividir entre N (i, i+N, i+2N…). Los carriles no se cruzan, así que ninguna repite el trabajo de otra.',
  ejemplo: 'Con N = 10, la institución de índice 3 prueba 3, 13, 23, 33… y nunca el 14, que es de la de índice 4.',
  ver: ['nonce', 'ronda'],
});
registrarTermino('objetivo', {
  titulo: 'Objetivo (target)',
  texto: 'La condición que debe cumplir la huella de un folio de registros para quedar sellado: empezar con d ceros hexadecimales. Cada dígito es 0 con probabilidad 1/16, así que hacen falta unos 16^d intentos de media.',
  ver: ['dificultad', 'hash', 'nonce'],
});
registrarTermino('obsoleta', {
  titulo: 'Huella obsoleta',
  texto: 'Una huella válida que perdió el desempate: otra institución acertó en la MISMA ronda con una huella numéricamente menor. Su folio no se agrega y no cobra créditos.',
  ver: ['ronda', 'hash'],
});
registrarTermino('maduracion', {
  titulo: 'Maduración de los créditos ganados',
  texto: 'En Proof of Work, los créditos de certificación que gana la institución que sella el folio h no se pueden gastar enseguida: quedan pendientes y pasan a disponibles cuando el libro de registros llega al folio h+6 (6 confirmaciones). Desde el folio h+7 ya puede usarlos para registrar credenciales.',
  ejemplo: 'Sella el folio #4 → créditos pendientes hasta cerrar el #10 → los gasta en registros del #11.',
  ver: ['recompensa', 'confirmacion'],
});

/** El trabajo del estado, solo si corresponde al bloque del evento (el autopiloto encadena carreras). */
function trabajoDe(est, bloque) {
  const t = est?.trabajo;
  return t && (bloque === undefined || t.numero_bloque === bloque) ? t : null;
}

registrarFrase('trabajo_inicio', (e, est) => {
  const bloque = e.datos?.bloque;
  const t = trabajoDe(est, bloque);
  const d = t?.dificultad ?? est?.parametros?.dificultad ?? 'd';
  const activos = t ? t.mineros.filter((m) => m.activo).length : null;
  const quien = activos ? `${plural(activos, 'institución selladora prueba', 'instituciones selladoras prueban')} ${num(t.k)} nonces por ronda` : 'Cada institución selladora prueba k nonces por ronda';
  return {
    titulo: `Empieza la carrera por sellar el folio #${bloque ?? '?'}`,
    texto: `${quien}, cada una en su propio carril (i, i+N, i+2N…): ninguna repite. Buscan una huella que empiece con ${d} ceros; de media hacen falta ${typeof d === 'number' ? num(16 ** d) : '16^d'} intentos.`,
    detalle: t && !t.automatico ? 'Modo paso a paso: nada avanza hasta que pulses «Avanzar 1 ronda» en la arena.' : null,
    nivel: 'info',
  };
});

registrarFrase('ganador', (e, est) => {
  const g = e.datos || {};
  const t = est?.trabajo?.ganador?.hash === g.hash ? est.trabajo : null;
  const d = t?.dificultad ?? est?.parametros?.dificultad;
  const otros = t?.ronda_empate ? t.ronda_empate.candidatos.filter((c) => !c.gana).map((c) => siglaDe(c.id)) : [];
  const empate = otros.length ? ` En la misma ronda también ${otros.length === 1 ? 'acertó' : 'acertaron'} ${otros.join(', ')}: gana la huella numéricamente menor y ${otros.length === 1 ? 'la otra queda obsoleta' : 'las otras quedan obsoletas'}.` : '';
  // el narrador elige `ganador` antes que `recompensa_madura` en el mismo lote: que no se pierda
  const conf = est?.recompensas?.confirmaciones ?? 6;
  const madura = t ? (est.recompensas?.items || []).find((i) => i.estado === 'madura' && i.bloque === t.numero_bloque - conf) : null;
  const maduraTxt = madura ? ` Con este folio maduran los créditos del folio #${madura.bloque}: ${etiqueta(madura.beneficiario)} ya puede gastar sus ${cc(madura.monto)}.` : '';
  const quien = etiqueta(g.id || e.nodo);
  return {
    titulo: `${quien} selló el folio: todas se detienen`,
    texto: `Con el nonce ${num(g.nonce)}, la huella ${hashCorto(g.hash, 6)} empieza con ${cerosIniciales(g.hash)} ceros y cumple el objetivo${d ? ` de ${d}` : ''} en la ronda ${num((g.ronda ?? 0) + 1)}. Las demás instituciones paran: su trabajo en este folio ya no sirve.${empate}${maduraTxt}`,
    detalle: t ? `Encontrarlo costó ${num(t.intentos_total)} intentos a todas las instituciones; verificarlo, a cualquiera de ellas, un solo cálculo de SHA-256.` : null,
    nivel: 'ok',
  };
});

registrarFrase('empate_ronda', (e) => {
  const re = e.datos;
  if (!re?.candidatos?.length) return null;
  const orden = [...re.candidatos].sort((a, b) => (a.hash < b.hash ? -1 : 1));
  const gan = orden.find((c) => c.gana) || orden[0];
  const perd = orden.filter((c) => c !== gan);
  return {
    titulo: `Empate en la ronda ${num(re.ronda + 1)}: sella ${etiqueta(gan.id)}`,
    texto: `${orden.map((c) => siglaDe(c.id)).join(' y ')} acertaron a la vez. Todas las huellas cumplen el objetivo, pero solo cabe un folio: gana la menor como número (${hashCorto(gan.hash, 6)}) y ${perd.map((c) => siglaDe(c.id)).join(', ')} ${perd.length === 1 ? 'queda obsoleta' : 'quedan obsoletas'}.`,
    nivel: 'aviso',
  };
});

registrarFrase('trabajo_limite', (e, est) => {
  const t = est?.trabajo?.estado === 'limite' ? est.trabajo : null;
  return {
    titulo: 'Límite de rondas: ninguna institución acertó',
    texto: t
      ? `Tras ${num(t.ronda)} rondas y ${num(t.intentos_total)} intentos (de ≈ ${num(16 ** t.dificultad)} esperados), ninguna huella empezó con ${t.dificultad} ceros. El libro y los registros pendientes quedan intactos: vuelve a sellar o reinicia con más rondas, más k o menos dificultad.`
      : 'Ninguna institución encontró un nonce válido antes del límite. El libro y los registros pendientes quedan intactos: sube el límite o baja la dificultad.',
    nivel: 'aviso',
  };
});

registrarFrase('trabajo_cancelado', (e, est) => {
  const t = est?.trabajo?.estado === 'cancelado' ? est.trabajo : null;
  return {
    titulo: 'Carrera cancelada',
    texto: `Se detuvo la búsqueda${t ? ` tras ${num(t.intentos_total)} intentos` : ''}: ningún folio se selló y los registros de credencial siguen pendientes. El trabajo hecho se pierde: el próximo intento empieza de cero.`,
    nivel: 'aviso',
  };
});

registrarFrase('recompensa_pendiente', (e, est) => {
  const items = (est?.recompensas?.items || []).filter((i) => i.beneficiario === e.nodo && i.estado === 'pendiente');
  const it = items.at(-1);
  const monto = it?.monto ?? est?.parametros?.recompensa;
  const quien = etiqueta(e.nodo);
  if (!it) return { titulo: `Los créditos de ${quien} esperan`, texto: `${quien} cobrará sus créditos de certificación cuando el folio tenga 6 confirmaciones. Mientras tanto son créditos pendientes: suyos, pero no gastables.`, nivel: 'info' };
  return {
    titulo: `${quien} gana ${cc(monto)}… pero aún no puede gastarlos`,
    texto: `Los créditos del folio #${it.bloque} llegan en un sobre sellado: se acreditan al cerrar el folio #${it.madura_en} (6 confirmaciones) y se pueden gastar en registros desde el #${it.madura_en + 1}.`,
    nivel: 'info',
  };
});

registrarFrase('recompensa_madura', (e) => {
  const b = e.datos?.bloque;
  return {
    titulo: `Maduran los créditos del folio #${b ?? '?'}`,
    texto: `Ya tienen 6 confirmaciones: ${etiqueta(e.nodo)} los recibe como créditos de certificación disponibles y puede usarlos en registros del folio #${b !== undefined ? b + 7 : 'h+7'} en adelante.`,
    nivel: 'ok',
  };
});

// ===================================================================== vista
export default {
  id: 'pow_arena',
  etiqueta: 'Sellado',
  titulo: 'Sellado de registros',
  icono: 'calor',
  modos: ['pow'],
  orden: 30,
  descripcion: 'Las instituciones compiten por sellar el siguiente folio de registros (en la jerga, un «bloque»): prueban nonces —números de intento— hasta que la huella, su sello de autenticidad, empiece con los ceros exigidos. Todas prueban lo mismo por ronda: no gana la más rápida, gana la suerte; y la ganadora cobra créditos de certificación.',
  insignia: (e) => (e.trabajo?.estado === 'minando' ? 'en curso' : null),

  montar(host, ctx) {
    const { h } = ctx;
    const L = ctx.local;
    Object.assign(L, {
      clave: null, carriles: new Map(), trabajoId: null, previo: null, record: new Map(),
      liderId: null, liderMarcado: null, recPrev: null, auto: null, seleccion: null, intento: null,
    });
    L.raiz = h('div.arena');
    construirMesa(ctx);
    construirMarcador(ctx);
    L.desenlace = h('div.arena-desenlace', { hidden: true });
    L.empate = h('section.panel.arena-empate', { hidden: true, 'aria-labelledby': idDe(ctx)('empate-t') });
    construirPista(ctx);
    construirRecompensas(ctx);
    construirComo(ctx);
    L.raiz.append(h('div.arena-cabeza', L.mesa, L.marcador), L.desenlace, L.empate, L.pistaSec, L.recSec, L.como);
    host.append(L.raiz);

    // las marcas en el anillo solo tienen sentido con la arena a la vista
    window.addEventListener('hashchange', () => {
      if (!/^#\/pow\/pow_arena\b/.test(location.hash)) limpiarAnillo(ctx);
    });
    ctx.alEstado(() => { if (!ctx.activa) limpiarAnillo(ctx); });
  },

  actualizar(e, ctx, cambios = {}) {
    const L = ctx.local;
    const t = e.trabajo;
    const previo = L.previo;
    const mismo = !!(previo && t && previo.id === t.id && previo.epoca === e.epoca);
    const trans = {
      primera: !!cambios.primera || !previo || !!cambios.epocaCambio,
      gano: !cambios.primera && mismo && previo.estado === 'minando' && t.estado === 'ganado',
      termino: !cambios.primera && mismo && previo.estado === 'minando' && t.estado !== 'minando',
      altura: cambios.primera ? null : cambios.altura,
    };
    pintarMesa(e, ctx);
    pintarMarcador(e, ctx);
    pintarTelar(e, ctx);
    pintarPista(e, ctx, trans);
    pintarDesenlace(e, ctx, trans);
    pintarEmpate(e, ctx, trans);
    pintarRecompensas(e, ctx, trans);
    pintarComo(e, ctx);
    marcarAnillo(e, ctx, trans);
    L.previo = t ? { id: t.id, estado: t.estado, epoca: e.epoca } : null;
  },
};

function idDe(ctx) { return (x) => `arena-${ctx.modo}-${x}`; }

function lectura(ctx, etiqueta, valor) {
  return ctx.h('div.lectura', ctx.h('dt.lectura__etiqueta', etiqueta), ctx.h('dd.lectura__valor', valor));
}

function boton(ctx, variante, ico, texto, props = {}) {
  return ctx.h(`button.boton.boton--${variante}`, { type: 'button', ...props }, ctx.icono(ico), ctx.h('span', texto));
}

/** Datos de la carrera que se usan en todas partes (con o sin carrera en curso). */
function datos(e) {
  const t = e.trabajo;
  const d = t?.dificultad ?? e.parametros.dificultad;
  const k = t?.k ?? e.config.k;
  const activos = t ? t.mineros.filter((m) => m.activo).length : e.nodos.filter((n) => n.sincronizado).length;
  return { t, d, k, activos, esp: 16 ** d, n: e.nodos.length };
}

// ============================================================ mesa de control
function construirMesa(ctx) {
  const { h, ui, icono } = ctx;
  const L = ctx.local;
  const id = idDe(ctx);

  L.mBloque = h('span.arena-mesa__bloque');
  L.mTx = h('span.arena-mesa__tx');
  L.mParam = h('span.arena-mesa__param');
  L.bMinar = boton(ctx, 'primario', 'martillo', 'Sellar');
  L.bPaso = boton(ctx, 'secundario', 'pulso', 'Sellar paso a paso');
  L.bAv1 = boton(ctx, 'primario', 'play', 'Avanzar 1 ronda');
  L.bAv10 = boton(ctx, 'secundario', 'play', 'Avanzar 10 rondas');
  L.bCancelar = boton(ctx, 'peligro', 'x', 'Cancelar carrera');
  L.motivo = h('p.arena-motivo', { id: id('motivo') });
  L.gInicio = h('div.arena-mesa__grupo', L.bMinar, L.bPaso);
  L.gManual = h('div.arena-mesa__grupo', { hidden: true }, L.bAv1, L.bAv10);

  L.bMinar.addEventListener('click', () => iniciar(ctx, 'auto', L.bMinar));
  L.bPaso.addEventListener('click', () => iniciar(ctx, 'manual', L.bPaso));
  L.bAv1.addEventListener('click', () => avanzar(ctx, 1, L.bAv1));
  L.bAv10.addEventListener('click', () => avanzar(ctx, 10, L.bAv10));
  L.bCancelar.addEventListener('click', () => {
    ui.ocupado(L.bCancelar, ctx.api.accion('cancelar')).catch((err) => ui.mostrarError(err));
  });

  const irTx = boton(ctx, 'secundario', 'firma', 'Registrar credenciales');
  irTx.classList.add('boton--chico');
  irTx.addEventListener('click', () => ctx.navegar('transacciones'));
  L.sinTx = h('div.arena-sin-tx', { hidden: true },
    h('span.arena-sin-tx__icono', icono('firma')),
    h('div.arena-sin-tx__texto',
      h('p', h('strong', 'No hay registros de credencial pendientes.'), ' Un folio sella registros firmados que esperan turno: sin ellos no hay nada que sellar.'),
      h('div.grupo', irTx, h('span.texto-3', 'o usa el autopiloto, que firma algunos al azar.'))));

  // autopiloto: atajo de demostración, separado y rotulado como tal
  const nAuto = h('input.entrada.entrada--mono', { id: id('auto'), name: 'bloques', type: 'text', inputmode: 'numeric', value: '5', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': id('auto-ayuda') });
  L.bAuto = h('button.boton.boton--secundario', { type: 'submit' }, icono('play'), h('span', 'Producir'));
  L.formAuto = h('form.arena-auto', { novalidate: true, 'aria-labelledby': id('auto-t') },
    h('p.arena-auto__cabeza', { id: id('auto-t') }, icono('alerta'), h('strong', 'Autopiloto'), ui.chip('atajo de demostración', 'advertencia', { sinPunto: true })),
    h('div.campo',
      h('label.campo__etiqueta', { for: nAuto.id }, 'Folios a producir'),
      h('div.entrada-compuesta', nAuto, L.bAuto),
      h('p.campo__ayuda', { id: id('auto-ayuda') }, 'De 1 a 20. Encadena carreras completas (y firma registros de credencial al azar si faltan). Útil para llegar a 10 folios o ver madurar los créditos ganados; para entender el proceso, sella paso a paso.'),
      h('p.campo__error')));
  L.formAuto.addEventListener('input', () => ui.limpiarCampo(nAuto));
  L.formAuto.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    ui.limpiarCampos(L.formAuto);
    const v = nAuto.value.trim();
    if (!RE_ENTERO.test(v) || Number(v) < 1 || Number(v) > 20) {
      ui.marcarCampo(L.formAuto, 'bloques', 'El número de folios debe ser un entero entre 1 y 20.');
      return;
    }
    const e0 = ctx.estado();
    try {
      const r = await ui.ocupado(L.bAuto, ctx.api.accion('autopiloto', { bloques: Number(v) }));
      L.auto = { total: Number(v), desde: e0.altura, epoca: e0.epoca, rev: r.rev ?? 0 };
      ui.toast(`Encadena ${plural(Number(v), 'carrera', 'carreras')} de sellado: cada folio de registros es una carrera completa que puedes seguir en la pista.`, { nivel: 'info', titulo: 'Autopiloto en marcha' });
    } catch (err) { ui.mostrarError(err, { form: L.formAuto }); }
  });

  L.mesa = h('section.panel.panel--instrumento.arena-mesa', { 'aria-labelledby': id('mesa-t') },
    h('div.panel__cabecera', h('h2.etiqueta-instrumento', { id: id('mesa-t') }, 'Mesa de control')),
    h('div.panel__cuerpo.arena-mesa__cuerpo',
      h('div.arena-mesa__siguiente',
        h('span.etiqueta-instrumento', 'Folio de registros en juego'),
        L.mBloque,
        h('p.arena-mesa__resumen', L.mTx, L.mParam)),
      h('div.arena-mesa__acciones', L.gInicio, L.gManual, L.bCancelar),
      L.motivo,
      L.sinTx,
      L.formAuto));
}

async function iniciar(ctx, ejecucion, b) {
  try {
    await ctx.ui.ocupado(b, ctx.api.accion('minar', { ejecucion }));
  } catch (err) { ctx.ui.mostrarError(err, { titulo: 'La red no inició la carrera' }); }
}

async function avanzar(ctx, rondas, b) {
  try {
    const r = await ctx.ui.ocupado(b, ctx.api.accion('avanzar', { rondas }));
    const t = r?.trabajo;
    if (t?.estado === 'minando') narrarRondas(ctx, t, rondas);
  } catch (err) { ctx.ui.mostrarError(err); }
}

/** En paso a paso no hay eventos de bitácora por ronda: la arena narra lo que pasó. */
function narrarRondas(ctx, t, rondas) {
  const activos = t.mineros.filter((m) => m.activo);
  const mejor = activos.reduce((a, m) => (!a || m.ceros > a.ceros ? m : a), null);
  if (!mejor) return;
  const desde = t.ronda - rondas + 1;
  ctx.narrar({
    titulo: rondas === 1 ? `Ronda ${num(t.ronda)}: ninguna institución acertó` : `Rondas ${num(desde)} a ${num(t.ronda)}: ninguna institución acertó`,
    texto: `Se probaron ${num(activos.length * t.k * rondas)} nonces nuevos, ninguno repetido. ${mejor.ceros
      ? `La última huella más cercana fue la de ${etiqueta(mejor.id)}: ${mejor.ceros} de ${t.dificultad} ceros (${hashCorto(mejor.ultimo_hash, 5)}).`
      : `Ninguna de las últimas huellas empezó siquiera con un 0: hace falta empezar con ${t.dificultad}.`}`,
    detalle: `Llevan ${num(t.intentos_total)} intentos de ≈ ${num(16 ** t.dificultad)} esperados · ronda ${num(t.ronda)} de ${num(t.max_rondas)}.`,
    nivel: 'info',
  });
}

function pintarMesa(e, ctx) {
  const { dom, icono, h } = ctx;
  const L = ctx.local;
  const { t, d, k, activos } = datos(e);
  const p = e.parametros;
  const minando = t?.estado === 'minando';
  const manual = minando && !t.automatico;
  const sinTx = !e.pendientes_total;
  const llena = e.altura >= p.max_altura;
  const foco = document.activeElement;

  L.gInicio.hidden = minando;
  L.gManual.hidden = !manual;
  L.bCancelar.hidden = !minando;
  L.sinTx.hidden = !(sinTx && !minando);
  const bloquea = sinTx || llena;
  for (const b of [L.bMinar, L.bPaso]) {
    dom.attr(b, 'aria-disabled', bloquea ? 'true' : null);
    dom.attr(b, 'aria-describedby', L.motivo.id);
  }
  dom.attr(L.bAuto, 'aria-disabled', minando || llena ? 'true' : null);

  dom.texto(L.mBloque, `#${minando ? t.numero_bloque : e.altura + 1}`);
  const entran = Math.min(e.pendientes_total, p.max_tx_bloque);
  dom.texto(L.mTx, minando
    ? `${plural(t.tx_ids.length, 'registro de credencial', 'registros de credencial')} dentro`
    : sinTx ? 'Sin registros pendientes' : `Entrarán ${entran} de ${plural(e.pendientes_total, 'registro pendiente', 'registros pendientes')} (máx. ${p.max_tx_bloque} por folio)`);
  dom.texto(L.mParam, ` · dificultad ${d} · k = ${num(k)} · ${plural(activos, 'institución selladora activa', 'instituciones selladoras activas')}`);

  // motivo visible (nunca solo gris)
  let nivel = 'info';
  let ico = 'info';
  let txt;
  if (minando && t.automatico) {
    ico = 'reloj';
    txt = `La carrera avanza sola: el servidor ejecuta una ronda tras otra en segundo plano (pausa de ${num(e.config.pausa_ms)} ms). Para seguirla ronda a ronda, cancélala y usa «Sellar paso a paso».`;
  } else if (manual) {
    ico = 'pulso';
    txt = 'Paso a paso: entre clic y clic nadie avanza. Cada clic ejecuta rondas completas en las que todas las instituciones prueban k nonces de su carril.';
  } else if (llena) {
    nivel = 'aviso'; ico = 'alerta';
    txt = `El libro de registros llegó al máximo de ${p.max_altura} folios de esta simulación: reinicia la red en «Red» para seguir minando.`;
  } else if (sinTx) {
    nivel = 'aviso'; ico = 'alerta';
    txt = 'Sellar está en pausa hasta que haya registros de credencial pendientes. Si pulsas igualmente, verás el rechazo de la red.';
  } else {
    txt = '«Sellar» deja que la carrera corra sola (el servidor la mide); «Paso a paso» te deja avanzarla ronda a ronda.';
  }
  const clave = `${nivel}|${txt}`;
  if (L.motivo.dataset.clave !== clave) {
    L.motivo.dataset.clave = clave;
    L.motivo.dataset.nivel = nivel;
    dom.reemplazar(L.motivo, icono(ico), h('span', txt));
  }

  // si el botón con el foco acaba de ocultarse, el foco pasa al control que lo sustituye
  if (foco instanceof HTMLElement && L.mesa.contains(foco) && foco.closest('[hidden]')) {
    const destino = [L.bAv1, L.bCancelar, L.bMinar].find((b) => !b.closest('[hidden]'));
    destino?.focus({ preventScroll: true });
  }
}

// ================================================================== marcador
function construirMarcador(ctx) {
  const { h, ui } = ctx;
  const L = ctx.local;
  const id = idDe(ctx);
  L.kEstado = h('span.arena-marcador__estado');
  L.kTitulo = h('p.arena-marcador__titulo');
  L.kRondaTxt = h('span.arena-marcador__ronda-txt.mono');
  L.kRonda = ui.medidor(0, 1, { etiqueta: 'Rondas usadas del límite' });
  L.kIntentos = h('span');
  L.kEsperado = h('span');
  L.kPorRonda = h('span');
  L.kProb = h('span');
  L.kBarra = h('div.arena-esperado', { role: 'meter', 'aria-label': 'Intentos de todas las instituciones frente a los esperados', 'aria-valuemin': '0' },
    h('span.arena-esperado__marca', { 'aria-hidden': 'true' }, h('span', 'esperado')));
  L.kNota = h('p.arena-marcador__nota');
  L.kAuto = h('p.arena-marcador__auto', { hidden: true });
  L.marcador = h('section.panel.panel--instrumento.arena-marcador', { 'aria-labelledby': id('marc-t') },
    h('div.panel__cabecera', h('h2.etiqueta-instrumento', { id: id('marc-t') }, 'Marcador'), h('span.empuja', L.kEstado)),
    h('div.panel__cuerpo.arena-marcador__cuerpo',
      L.kTitulo,
      h('div.arena-marcador__ronda', h('span.etiqueta-instrumento', ctx.ui.termino('ronda', 'Rondas')), L.kRondaTxt, L.kRonda),
      h('dl.cuadro-lecturas.arena-marcador__lecturas',
        lectura(ctx, 'Intentos de todas', L.kIntentos),
        lectura(ctx, 'Esperados · 16^d', L.kEsperado),
        lectura(ctx, 'Nonces por ronda', L.kPorRonda),
        lectura(ctx, 'Cada huella sirve con', L.kProb)),
      L.kBarra,
      L.kNota,
      L.kAuto));
}

function pintarMarcador(e, ctx) {
  const { dom, ui } = ctx;
  const L = ctx.local;
  const { t, d, k, activos, esp } = datos(e);
  const est = t ? TRABAJO[t.estado] || ['—', 'neutro'] : ['sin carrera', 'neutro'];
  const clave = est.join('|');
  if (L.kEstado.dataset.clave !== clave) {
    L.kEstado.dataset.clave = clave;
    dom.reemplazar(L.kEstado, ui.chip(est[0], est[1]));
  }
  dom.texto(L.kTitulo, t
    ? `Folio #${t.numero_bloque} · carrera ${t.automatico ? 'automática' : 'paso a paso'}`
    : `Próximo folio de registros: #${e.altura + 1}`);
  const ronda = t?.ronda ?? 0;
  const maxR = t?.max_rondas ?? e.config.max_rondas;
  dom.texto(L.kRondaTxt, `${num(ronda)} de ${num(maxR)}`);
  ui.fijarMedidor(L.kRonda, ronda, maxR, t?.estado === 'limite' ? 'advertencia' : null);
  const intentos = t?.intentos_total ?? 0;
  dom.texto(L.kIntentos, num(intentos));
  dom.texto(L.kEsperado, `≈ ${num(esp)}`);
  dom.texto(L.kPorRonda, `${activos} × ${num(k)} = ${num(activos * k)}`);
  dom.texto(L.kProb, `1 de ${num(esp)}`);
  const v = intentos / (2 * esp);
  dom.cssVar(L.kBarra, '--valor', Math.min(1, v).toFixed(4));
  dom.attr(L.kBarra, 'aria-valuemax', String(2 * esp));
  dom.attr(L.kBarra, 'aria-valuenow', String(intentos));
  dom.attr(L.kBarra, 'aria-valuetext', `${num(intentos)} intentos; se esperan unos ${num(esp)}`);
  dom.attr(L.kBarra, 'data-estado', v >= 1 ? 'excede' : v >= 0.5 ? 'pasado' : null);
  const r = intentos / esp;
  dom.texto(L.kNota, !t
    ? `Con dificultad ${d}, una huella cualquiera sirve 1 de cada 16${sup(d)} = ${num(esp)} veces. Repartidos entre ${plural(activos, 'institución', 'instituciones')}, se esperan unas ${num(Math.max(1, Math.round(esp / Math.max(1, activos * k))))} rondas.`
    : t.estado === 'ganado'
      ? `Acertaron con ${pct(r)} de los intentos esperados: ${r < 1 ? 'buena suerte' : 'mala suerte'}. La media manda a la larga, no en cada folio.`
      : t.estado !== 'minando'
        ? `Se detuvieron con el ${pct(r)} de los intentos esperados: ningún folio se selló.`
        : `Llevan ${pct(r)} de los intentos esperados. ${r > 1 ? 'Ya superaron la media: en un sorteo, la mala racha es normal.' : 'Cada intento tiene la misma probabilidad: no hay «calentamiento».'}`);

  // autopiloto (seguimiento en cliente: el servidor no publica cuántos faltan)
  const a = L.auto;
  if (a && a.epoca !== e.epoca) L.auto = null;
  else if (a && e.rev >= a.rev && (e.altura - a.desde >= a.total || t?.estado !== 'minando')) L.auto = null;
  L.kAuto.hidden = !L.auto;
  if (L.auto) dom.texto(L.kAuto, `Autopiloto en marcha: folio ${Math.min(L.auto.total, e.altura - L.auto.desde + 1)} de ${L.auto.total}. Cada uno es una carrera completa entre instituciones.`);
}

// ============================================================ telar de nonces
function armarTelar(ctx, n, filas) {
  const { s } = ctx;
  const W = 320;
  const paso = W / n;
  const alto = 11;
  const arriba = 14;
  const H = arriba + filas * alto + 2;
  const r = Math.min(3.4, paso * 0.27);
  const svg = s('svg.arena-telar__svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
  const cols = [];
  for (let i = 0; i < n; i += 1) {
    const x = paso * i + paso / 2;
    const g = s('g.arena-telar__col');
    g.append(s('text.arena-telar__i', { x: x.toFixed(1), y: 9 }, String(i)));
    const puntos = [];
    for (let j = 0; j < filas; j += 1) {
      const c = s('circle.arena-telar__p', { cx: x.toFixed(1), cy: (arriba + j * alto + alto / 2).toFixed(1), r: r.toFixed(2) });
      c.style.setProperty('--j', String(j));
      g.append(c);
      puntos.push(c);
    }
    svg.append(g);
    cols.push({ g, puntos });
  }
  return { svg, cols };
}

function pintarTelar(e, ctx) {
  const { dom } = ctx;
  const L = ctx.local;
  const { t, k, n } = datos(e);
  const filas = Math.min(k, FILAS_TELAR);
  const clave = `${e.epoca}|${n}|${filas}`;
  if (L.telarClave !== clave) {
    L.telarClave = clave;
    L.telar = armarTelar(ctx, n, filas);
    dom.reemplazar(L.telarHost, L.telar.svg);
    L.telarAciertos = '';
  }
  const estados = t ? t.mineros.map((m) => m.estado) : e.nodos.map((nd) => (nd.sincronizado ? 'espera' : 'inactivo'));
  dom.attr(L.telar.svg, 'data-estado', t?.estado ?? 'reposo');
  L.telar.cols.forEach((c, i) => dom.attr(c.g, 'data-estado', estados[i] || 'espera'));

  // el nonce exacto que acertó (y los obsoletos) dentro de su ronda
  let aciertos = [];
  if (t?.ganador) {
    const lista = t.ronda_empate ? t.ronda_empate.candidatos : [{ ...t.ganador, gana: true }];
    const ronda = t.ganador.ronda;
    aciertos = lista.map((c) => {
      const m = t.mineros.find((x) => x.id === c.id);
      const j = Math.round((c.nonce - m.indice) / n) - ronda * k;
      return { i: m.indice, j: Math.min(filas - 1, Math.max(0, j)), gana: !!c.gana };
    });
  }
  const claveA = aciertos.map((a) => `${a.i}:${a.j}:${a.gana}`).join(',');
  if (claveA !== L.telarAciertos) {
    L.telarAciertos = claveA;
    for (const c of L.telar.cols) for (const p of c.puntos) dom.attr(p, 'data-acierto', null);
    for (const a of aciertos) dom.attr(L.telar.cols[a.i]?.puntos[a.j], 'data-acierto', a.gana ? 'gana' : 'obsoleta');
  }

  const kTxt = filas < k ? `se dibujan ${filas} de los ${num(k)}` : `los ${num(k)}`;
  let cap;
  if (t?.estado === 'minando') {
    const base = t.ronda * k;
    const m0 = t.mineros[0];
    const m1 = t.mineros[1];
    cap = `Ronda ${num(t.ronda + 1)}: cada columna i prueba i + (${num(base)} + j)·${n}, con j = 0…${num(k - 1)} (${kTxt}). ${etiqueta(m0.id)} (columna 0) va de ${num(base * n)} a ${num((base + k - 1) * n)} de ${n} en ${n}; ${etiqueta(m1.id)} empieza en ${num(base * n + 1)}. Ninguna repite.`;
  } else if (t?.ganador) {
    const g = t.ganador;
    const gi = t.mineros.find((x) => x.id === g.id)?.indice ?? 0;
    const j = (g.nonce - gi) / n - g.ronda * k;
    cap = `Ronda ${num(g.ronda + 1)}: ${etiqueta(g.id)} (columna ${gi}) acertó con el nonce ${num(g.nonce)} = ${gi} + ${num((g.nonce - gi) / n)}·${n}, de su propio carril (resto ${gi} al dividir entre ${n}): su intento ${num(j + 1)} de ${num(k)} en esa ronda${j >= filas ? ' (se marca en la última fila dibujada)' : ''}.`;
  } else {
    cap = `Cada columna es el carril de una institución: la de índice i solo prueba nonces con resto i al dividir entre ${n}. Cada punto es un nonce; cada fila, uno de los k = ${num(k)} intentos que hace por ronda (${kTxt}).`;
  }
  dom.texto(L.telarCap, cap);
}

// ===================================================================== pista
function construirPista(ctx) {
  const { h, ui } = ctx;
  const L = ctx.local;
  const id = idDe(ctx);
  L.leyObjetivo = h('span.arena-ley__muestra', { 'aria-hidden': 'true' });
  L.leyTexto = h('span');
  L.telarHost = h('div.arena-telar');
  L.telarCap = h('figcaption.arena-telar__cap');
  L.lista = h('ol.arena-pista', { role: 'list', 'aria-labelledby': id('pista-t') });
  L.pistaSec = h('section.arena-pista-sec', { 'aria-labelledby': id('pista-t') },
    h('div.arena-pista-sec__cabeza',
      h('div.arena-pista-sec__intro',
        h('h2', { id: id('pista-t') }, 'La pista: quién sella el folio'),
        h('p.arena-ley', L.leyObjetivo, L.leyTexto),
        h('p.texto-3.arena-pista-sec__ayuda', 'Cada fila es una institución selladora. Las casillas son el principio de su última ', ui.termino('hash', 'huella'),
          '; el marco punteado es el ', ui.termino('objetivo', 'objetivo'), ': se llena de ámbar con cada cero inicial y el primer dígito que no es cero queda subrayado en rojo. La línea inferior compara sus intentos con la media esperada (marca central).')),
      h('figure.arena-telar-fig',
        h('p.etiqueta-instrumento', 'Telar de nonces · ', ui.termino('carril', 'carriles'), ' disjuntos'),
        L.telarHost,
        L.telarCap)),
    h('div.arena-pista__columnas', { 'aria-hidden': 'true' },
      h('span', 'Institución'), h('span', 'Última huella'), h('span', 'Ceros'), h('span', 'Nonce'), h('span', 'Intentos'), h('span', 'Carril · próximos')),
    L.lista);
}

function crearCarril(ctx, mid, d) {
  const { h } = ctx;
  const L = ctx.local;
  const btn = marcaInst(mid, { tag: 'button', clase: 'arena-carril__id', props: { type: 'button' } });
  btn.title = `${etiquetaLarga(mid)}: abrir su ficha`;
  btn.addEventListener('click', () => ctx.abrirNodo(mid));
  const chip = h('span.chip.arena-carril__chip', { dataset: { estado: 'neutro' } });
  const celdas = [];
  const obj = h('span.arena-huella__objetivo');
  const resto = h('span.arena-huella__resto');
  for (let i = 0; i < CELDAS; i += 1) {
    const c = h('span.arena-hex', '·');
    if (i >= 8) c.classList.add('arena-hex--ancho');
    celdas.push(c);
    (i < d ? obj : resto).append(c);
  }
  const cola = h('span.arena-huella__cola');
  const huella = h('span.arena-huella', { role: 'img' }, obj, resto, cola);
  const marca = h('span.arena-carril__ceros');
  const max = h('span.arena-carril__max');
  const nonce = h('span.arena-dato__v');
  const intentos = h('span.arena-dato__v');
  const residuo = h('span.arena-carril__residuo');
  const proximos = h('span.arena-carril__proximos');
  const li = h('li.arena-carril', { dataset: { estado: 'espera' } },
    h('div.arena-carril__quien', btn, chip),
    huella,
    h('span.arena-carril__marca', marca, max),
    h('div.arena-carril__datos',
      h('span.arena-dato.arena-dato--nonce', h('span.arena-dato__e', 'nonce'), nonce),
      h('span.arena-dato.arena-dato--intentos', h('span.arena-dato__e', 'intentos'), intentos),
      h('span.arena-dato.arena-dato--carril', residuo, proximos)));
  const marcar = (on) => ctx.red.marcar(mid, 'es-resaltado', on);
  li.addEventListener('pointerenter', () => marcar(true));
  li.addEventListener('pointerleave', () => marcar(false));
  li.addEventListener('focusin', () => marcar(true));
  li.addEventListener('focusout', () => marcar(false));
  L.carriles.set(mid, { li, btn, chip, celdas, objetivo: celdas.slice(0, d), cola, huella, marca, max, nonce, intentos, residuo, proximos, estado: null, hash: null });
  return li;
}

function pintarPista(e, ctx, trans) {
  const { dom } = ctx;
  const L = ctx.local;
  const { t, d, activos, esp, n } = datos(e);

  // la pista solo se reconstruye con una red nueva (otros nodos u otra dificultad)
  const clave = `${e.epoca}|${e.ids.join(',')}|${d}`;
  if (L.clave !== clave) {
    L.clave = clave;
    L.carriles.clear();
    L.lista.replaceChildren();
    L.record.clear();
    L.trabajoId = null;
    L.liderId = null;
    dom.reemplazar(L.leyObjetivo, ...Array.from({ length: d }, () => ctx.h('i', '0')));
  }
  if ((t?.id ?? null) !== L.trabajoId) {
    L.trabajoId = t?.id ?? null;
    L.record.clear();
    L.liderId = null;
  }
  dom.texto(L.leyTexto, `Objetivo: ${plural(d, 'cero', 'ceros')} al inicio · 1 de cada ${num(esp)} huellas lo cumple`);

  const filas = t ? t.mineros : e.nodos.map((nd) => ({
    id: nd.id, indice: nd.indice, activo: nd.sincronizado, estado: nd.sincronizado ? 'espera' : 'inactivo',
    nonce_actual: null, intentos: 0, ultimo_hash: '', ceros: 0,
    carril: { residuo: nd.indice, modulo: n, proximos: [nd.indice, nd.indice + n, nd.indice + 2 * n] },
  }));
  const porMinero = esp / Math.max(1, activos);
  const gIndice = trans.gano ? t.mineros.find((m) => m.id === t.ganador?.id)?.indice ?? null : null;
  const o = { d, porMinero, gIndice, t, animar: !trans.primera, gano: trans.gano };
  dom.reconciliar(L.lista, filas, (m) => m.id, (m) => crearCarril(ctx, m.id, d), (li, m) => pintarCarril(ctx, m, o));

  // líder: la mejor huella vista durante la carrera (estable ante empates)
  if (t?.estado === 'minando') {
    let mejor = null;
    for (const m of t.mineros) {
      const r = L.record.get(m.id) ?? 0;
      if (r > 0 && (!mejor || r > mejor.r)) mejor = { id: m.id, r };
    }
    if (mejor && L.liderId && (L.record.get(L.liderId) ?? 0) === mejor.r) mejor.id = L.liderId;
    L.liderId = mejor?.id ?? null;
  } else {
    L.liderId = null;
  }
  for (const [mid, c] of L.carriles) dom.attr(c.li, 'data-lider', mid === L.liderId ? '' : null);
}

function pintarCarril(ctx, m, o) {
  const { dom, anim } = ctx;
  const L = ctx.local;
  const c = L.carriles.get(m.id);
  if (!c) return;
  const { d } = o;

  // estado: el barrido «todos se detienen» sale del ganador hacia fuera
  if (c.estado !== m.estado) {
    const retraso = o.gIndice !== null && m.estado !== 'ganador' ? Math.abs(m.indice - o.gIndice) * 32 : 0;
    c.li.style.setProperty('--retraso', `${retraso}ms`);
    c.estado = m.estado;
    c.li.dataset.estado = m.estado;
    const [txt, chip] = MINERO[m.estado] || MINERO.espera;
    dom.texto(c.chip, txt);
    c.chip.dataset.estado = chip;
    dom.attr(c.btn, 'aria-label', `${etiquetaLarga(m.id)}, ${txt}. Abrir su ficha`);
    if (o.gano && m.estado === 'ganador') momentoGanador(ctx, c, o.t);
  }

  dom.texto(c.nonce, m.nonce_actual === null || m.nonce_actual === undefined ? '—' : num(m.nonce_actual));
  dom.texto(c.intentos, num(m.intentos));
  dom.cssVar(c.li, '--avance', Math.min(1, m.intentos / (2 * o.porMinero)).toFixed(3));
  dom.texto(c.residuo, `≡ ${m.carril.residuo} (mod ${m.carril.modulo})`);
  dom.texto(c.proximos, `${m.nonce_actual === null || m.nonce_actual === undefined ? 'empieza:' : 'luego:'} ${m.carril.proximos.map(num).join(' · ')}`);

  const hash = m.ultimo_hash || '';
  const previo = L.record.get(m.id);
  if (hash && (previo === undefined || m.ceros > previo)) {
    L.record.set(m.id, m.ceros);
    // destello cuando un minero mejora su mejor marca (y la mejora significa algo)
    if (o.animar && previo !== undefined && m.estado === 'probando' && m.ceros >= Math.max(1, d - 2)) {
      anim.destello(c.li);
      anim.animar(c.marca, [{ transform: 'scale(1.5)', color: 'var(--acento)' }, { transform: 'none' }], { duration: anim.DUR.escena, easing: anim.CURVA.acuse });
    }
  }
  const rec = L.record.get(m.id);
  dom.texto(c.max, hash && rec !== undefined ? `máx ${rec}` : '');

  if (hash === c.hash) return;
  c.hash = hash;
  const z = hash ? cerosIniciales(hash) : 0;
  c.celdas.forEach((el, i) => {
    dom.texto(el, hash ? hash[i] : '·');
    dom.attr(el, 'data-ok', hash && i < z ? '' : null);
    dom.attr(el, 'data-falla', hash && i === z && i < d ? '' : null);
  });
  dom.texto(c.cola, hash ? `…${hash.slice(-4)}` : '');
  dom.texto(c.marca, hash ? `${Math.min(z, 64)}/${d}` : `—/${d}`);
  dom.attr(c.marca, 'data-nivel', !hash ? null : z >= d ? 'logrado' : z === d - 1 ? 'cerca' : null);
  dom.attr(c.huella, 'aria-label', hash
    ? `Última huella ${hashCorto(hash, 6)}: ${z} de ${d} ceros exigidos${z >= d ? ', cumple el objetivo' : `, se quedó a ${d - z}`}`
    : 'Todavía no ha probado ningún nonce');
}

/** El momento firma: el carril ganador se sella y el resto se apaga desde él hacia fuera. */
function momentoGanador(ctx, c, t) {
  const { anim } = ctx;
  anim.animar(c.li, [{ transform: 'scale(1)' }, { transform: 'scale(1.02)', offset: 0.35 }, { transform: 'none' }],
    { duration: anim.DUR.escena, easing: anim.CURVA.firma });
  anim.animar(c.chip, [{ opacity: 0, transform: 'scale(2.4) rotate(-16deg)' }, { opacity: 1, transform: 'none' }],
    { duration: 420, delay: 140, easing: anim.CURVA.acuse, fill: 'backwards' });
  anim.escalonar(c.objetivo, [{ transform: 'scale(0.3)', opacity: 0.2 }, { transform: 'none', opacity: 1 }],
    { duration: 260, easing: anim.CURVA.acuse }, 70);
  if (t?.ganador?.id) ctx.red.resaltar(t.ganador.id, 3600);
}

// ================================================================ desenlace
function pintarDesenlace(e, ctx, trans) {
  const L = ctx.local;
  const t = e.trabajo;
  if (!t || t.estado === 'minando') {
    L.desenlace.hidden = true;
    L.desenlace.dataset.clave = '';
    return;
  }
  const clave = `${e.epoca}|${t.id}|${t.estado}`;
  if (L.desenlace.dataset.clave !== clave) {
    L.desenlace.dataset.clave = clave;
    ctx.dom.reemplazar(L.desenlace, t.estado === 'ganado' ? tarjetaBloque(e, ctx) : avisoFinal(e, ctx));
    L.desenlace.hidden = false;
    if (trans.termino) ctx.anim.entrar(L.desenlace.firstChild, { retraso: 180, distancia: 10 });
  }
  if (t.estado === 'ganado' && L.dDifusion) {
    const sc = e.sincronia || {};
    const enCabeza = e.altura === t.numero_bloque;
    ctx.dom.texto(L.dDifusion, enCabeza ? `${sc.sincronizados}/${sc.total}` : `libro en #${e.altura}`);
    ctx.dom.texto(L.dDifusionTxt, enCabeza
      ? `Difundido a ${plural(Math.max(0, (sc.total ?? 1) - 1), 'institución', 'instituciones')}: cada una lo validó por su cuenta antes de añadirlo a su copia del libro.${sc.sincronizados < sc.total ? ' Las que faltan están desconectadas o desfasadas.' : ''}`
      : 'Ya hay folios de registros posteriores encima de este.');
  }
}

function hexResaltado(ctx, hash) {
  const z = cerosIniciales(hash);
  return ctx.h('code.arena-hexfull', ctx.h('span.arena-hexfull__ceros', hash.slice(0, z)), ctx.h('span', hash.slice(z)));
}

function tarjetaBloque(e, ctx) {
  const { h, ui, icono } = ctx;
  const L = ctx.local;
  const t = e.trabajo;
  const g = t.ganador;
  const id = idDe(ctx);
  const esp = 16 ** t.dificultad;
  const prop = marcaInst(g.id, { tag: 'button', clase: 'arena-enlace-nodo', props: { type: 'button', 'aria-label': `${etiquetaLarga(g.id)}: abrir su ficha` } });
  prop.addEventListener('click', () => ctx.abrirNodo(g.id));
  const ver = boton(ctx, 'secundario', 'cadena', 'Ver en el libro de registros');
  ver.addEventListener('click', () => ctx.navegar('cadena'));
  L.dDifusion = h('span');
  L.dDifusionTxt = h('span');
  const conf = e.recompensas?.confirmaciones ?? 6;
  const premio = e.parametros?.recompensa;
  return h('article.panel.arena-bloque', { 'aria-labelledby': id('bloque-t') },
    h('div.arena-bloque__sello', { 'aria-hidden': 'true' }, icono('bloque'), h('span', `#${t.numero_bloque}`)),
    h('div.arena-bloque__cuerpo',
      h('p.etiqueta-instrumento', 'Folio de registros sellado · agregado y difundido'),
      h('h2.arena-bloque__titulo', { id: id('bloque-t') }, `Folio #${t.numero_bloque} `, h('span.arena-bloque__por', 'sellado por ', prop)),
      h('p.arena-bloque__nombre', nombreInst(g.id)),
      h('div.arena-bloque__huella',
        h('div.grupo', h('span.etiqueta-instrumento', 'Huella'), ui.hash(g.hash, { n: 6, ceros: true, etiqueta: 'Huella del folio' })),
        hexResaltado(ctx, g.hash)),
      h('dl.cuadro-lecturas.arena-bloque__datos',
        lectura(ctx, 'Nonce', num(g.nonce)),
        lectura(ctx, 'Ronda', `${num(g.ronda + 1)} de ${num(t.max_rondas)}`),
        lectura(ctx, 'Intentos de todas', num(t.intentos_total)),
        lectura(ctx, 'Registros sellados', String(t.tx_ids.length)),
        lectura(ctx, 'Instituciones al día', L.dDifusion),
        premio !== undefined ? lectura(ctx, 'Créditos ganados', `+${cc(premio)}`) : lectura(ctx, 'Dificultad', `${t.dificultad} ceros`)),
      h('p.arena-bloque__difusion', icono('onda'), L.dDifusionTxt),
      premio !== undefined ? h('p.arena-bloque__difusion', icono('llave'),
        h('span', `${siglaDe(g.id)} gana ${cc(premio)} por sellar, en sobre sellado: se acreditan al cerrar el folio #${t.numero_bloque + conf} (${conf} confirmaciones) y podrá gastarlos desde el #${t.numero_bloque + conf + 1}.`)) : null,
      h('p.arena-bloque__asimetria',
        h('span.arena-bloque__costo', h('strong.mono', num(t.intentos_total)), h('small', 'intentos para encontrarlo')),
        h('span.arena-bloque__vs', { 'aria-hidden': 'true' }, 'vs'),
        h('span.arena-bloque__costo', h('strong.mono', '1'), h('small', 'cálculo para verificarlo')),
        h('span.arena-bloque__explica', `Cualquier institución recalcula SHA-256 con el nonce ${num(g.nonce)} y comprueba los ${t.dificultad} ceros: por eso la red acepta el folio sin tener que confiar en ${siglaDe(g.id)}. Se esperaban ≈ ${num(esp)} intentos y se usó el ${pct(t.intentos_total / esp)} de esa cifra.`)),
      h('div.grupo', ver)));
}

function avisoFinal(e, ctx) {
  const { h, icono } = ctx;
  const t = e.trabajo;
  const esp = 16 ** t.dificultad;
  const mensaje = t.mensaje ? h('p.mensaje-servidor', ctx.fmt.capital(conInstituciones(t.mensaje))) : null;
  const reintentar = boton(ctx, 'primario', 'martillo', 'Volver a sellar');
  reintentar.addEventListener('click', () => iniciar(ctx, 'auto', reintentar));
  if (t.estado === 'limite') {
    const prob = 1 - Math.exp(-t.intentos_total / esp);
    const irRed = boton(ctx, 'secundario', 'red', 'Ajustar la red');
    irRed.addEventListener('click', () => ctx.navegar('red'));
    return h('div.aviso.arena-final', { dataset: { nivel: 'aviso' } }, icono('reloj'),
      h('div.arena-final__cuerpo',
        h('h2.arena-final__titulo', 'Ninguna institución encontró el nonce antes del límite'),
        mensaje,
        h('p', `Se probaron ${num(t.intentos_total)} nonces en ${plural(t.ronda, 'ronda', 'rondas')}: el ${pct(t.intentos_total / esp)} de los ≈ ${num(esp)} que hacen falta de media. Con tan pocos intentos, la probabilidad de acertar era del ${pct(prob)}. No es un fallo: es la dificultad haciendo su trabajo.`),
        h('p', h('strong', 'Qué significa: '), 'ningún folio se selló; el libro de registros y los registros de credencial pendientes quedan intactos, y nadie cobra créditos.'),
        h('p', h('strong', 'Cómo reintentar: '), 'vuelve a sellar (la carrera empieza de cero con otra marca de tiempo y puede tener suerte) o reinicia la red con más rondas, una k mayor o menos dificultad.'),
        h('div.grupo', reintentar, irRed)));
  }
  if (t.estado === 'cancelado') {
    return h('div.aviso.arena-final', { dataset: { nivel: 'info' } }, icono('pausa'),
      h('div.arena-final__cuerpo',
        h('h2.arena-final__titulo', 'Carrera cancelada'),
        mensaje,
        h('p', `Se habían probado ${num(t.intentos_total)} nonces en ${plural(t.ronda, 'ronda', 'rondas')}. Ese trabajo se descarta: en Proof of Work no se puede «guardar» el esfuerzo, el siguiente intento empieza de cero.`),
        h('p', t.tx_ids.length === 1 ? 'El registro de credencial sigue pendiente.' : `Los ${t.tx_ids.length} registros de credencial siguen pendientes.`),
        h('div.grupo', reintentar)));
  }
  return h('div.aviso.arena-final', { dataset: { nivel: 'error' }, role: 'alert' }, icono('x'),
    h('div.arena-final__cuerpo',
      h('h2.arena-final__titulo', 'La carrera falló'),
      mensaje,
      h('p', 'La red quedó como estaba: ningún folio se selló. Puedes volver a intentarlo.'),
      h('div.grupo', reintentar)));
}

// ==================================================================== empate
function pintarEmpate(e, ctx, trans) {
  const { h, ui, icono } = ctx;
  const L = ctx.local;
  const t = e.trabajo;
  const re = t?.ronda_empate;
  const clave = re ? `${e.epoca}|${t.id}` : '';
  if (L.empate.dataset.clave === clave) return;
  L.empate.dataset.clave = clave;
  L.empate.hidden = !re;
  if (!re) { L.empate.replaceChildren(); return; }

  const id = idDe(ctx);
  const d = t.dificultad;
  // mismo largo y minúsculas: el orden de texto ES el orden numérico
  const orden = [...re.candidatos].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const gan = orden.find((c) => c.gana) || orden[0];
  const decide = new Map(orden.filter((c) => c !== gan).map((c) => [c.id, primerDistinto(gan.hash, c.hash)]));
  const ventana = Math.min(64, Math.max(16, ...[...decide.values()].map((p) => p + 4)));
  const pGan = Math.min(...decide.values());

  const hexDe = (c) => {
    const z = cerosIniciales(c.hash);
    const p = c === gan ? pGan : decide.get(c.id);
    const partes = [];
    for (let i = 0; i < ventana; i += 1) {
      const ch = c.hash[i];
      const cls = i < z ? 'arena-empate__z' : i === p ? (c === gan ? 'arena-empate__d--gana' : 'arena-empate__d') : i < p ? 'arena-empate__igual' : 'arena-empate__resto';
      partes.push(h(`span.${cls}`, ch));
    }
    partes.push(h('span.arena-empate__resto', '…'));
    return h('code.arena-empate__hex', partes);
  };

  const filas = [];
  orden.forEach((c, i) => {
    if (i > 0) filas.push(h('li.arena-empate__menor', { 'aria-hidden': 'true' }, `${i}.º < ${i + 1}.º`));
    const quien = marcaInst(c.id, { tag: 'button', clase: 'arena-enlace-nodo', props: { type: 'button', 'aria-label': `${etiquetaLarga(c.id)}: abrir su ficha` } });
    quien.addEventListener('click', () => ctx.abrirNodo(c.id));
    filas.push(h('li.arena-empate__fila', { dataset: { gana: c.gana ? 'si' : 'no' } },
      h('span.arena-empate__pos', `${i + 1}.º`),
      h('span.arena-empate__quien', quien, h('small.mono', `nonce ${num(c.nonce)}`)),
      hexDe(c),
      h('span.arena-empate__veredicto',
        c.gana ? ui.chip('gana · huella menor', 'valido') : ui.chip('obsoleta', 'obsoleto'),
        c.motivo ? h('small.mensaje-servidor', ctx.fmt.capital(conInstituciones(c.motivo))) : null)));
  });

  // las dos comparaciones más reñidas, explicadas; el resto, resumido
  const perdedores = orden.filter((c) => c !== gan);
  const sg = siglaDe(gan.id);
  const porque = perdedores.slice(0, 2).map((c) => {
    const p = decide.get(c.id);
    const a = gan.hash[p];
    const b = c.hash[p];
    return h('li',
      h('strong', `${sg} contra ${siglaDe(c.id)}: `),
      `coinciden los primeros ${p} dígitos; en el ${p + 1}.º, `,
      h('code.arena-empate__cmp', a), ' < ', h('code.arena-empate__cmp', b),
      ` (${parseInt(a, 16)} < ${parseInt(b, 16)} en decimal). Como número, la huella de ${sg} es menor: sella el folio. La de ${siglaDe(c.id)} queda `, ui.termino('obsoleta', 'obsoleta'), '.');
  });
  const resto = perdedores.slice(2);
  if (resto.length) {
    porque.push(h('li', h('strong', `${sg} contra ${resto.map((c) => siglaDe(c.id)).join(', ')}: `),
      'lo mismo; en su primer dígito distinto, el de ', sg, ' es menor (',
      resto.map((c, i) => [i ? ', ' : '', h('code.arena-empate__cmp', gan.hash[decide.get(c.id)]), ' < ', h('code.arena-empate__cmp', c.hash[decide.get(c.id)])]),
      '). Todas quedan obsoletas.'));
  }

  L.empate.replaceChildren(
    h('div.panel__cabecera',
      icono('empate'),
      h('h2', { id: id('empate-t') }, `Empate en la ronda ${num(re.ronda + 1)}`),
      h('span.empuja', ui.chip(`${orden.length} huellas válidas a la vez`, 'advertencia'))),
    h('div.panel__cuerpo.arena-empate__cuerpo',
      h('p', `${orden.map((c) => etiqueta(c.id)).join(', ')} hallaron un nonce válido en la misma ronda: todas sus huellas empiezan con ${d} ceros y cumplen el objetivo. Pero el folio #${t.numero_bloque} solo puede sellarlo una institución, así que se aplica una regla que cualquiera de ellas puede comprobar sin preguntar a nadie:`),
      h('blockquote.arena-empate__regla', h('p.mensaje-servidor', ctx.fmt.capital(conInstituciones(re.regla)))),
      h('ol.arena-empate__lista', { role: 'list', 'aria-label': 'Huellas empatadas, de menor a mayor' }, filas),
      h('ul.arena-empate__porque', { role: 'list' }, porque),
      h('p.texto-3', 'Comparar dos huellas «como número» es leerlas dígito a dígito desde la izquierda: el primer dígito distinto decide. Las obsoletas eran válidas, pero perdieron el desempate: su folio no se agrega y su institución no cobra créditos.')));
  if (!trans.primera) ctx.anim.entrar(L.empate, { retraso: 320, distancia: 10 });
}

// =============================================================== recompensas
function construirRecompensas(ctx) {
  const { h, ui } = ctx;
  const L = ctx.local;
  const id = idDe(ctx);
  L.rDisp = h('strong.arena-saldo__cifra');
  L.rPend = h('strong.arena-saldo__cifra');
  L.rBarDisp = h('span', { dataset: { parte: 'gastable' } });
  L.rBarPend = h('span', { dataset: { parte: 'pendiente' } });
  L.rLinea = h('div.arena-linea');
  L.rVacio = h('p.arena-rec__vacio', 'Aún nadie ha ganado créditos: el primer folio sellado dará los primeros créditos ganados por sellar. Llegará como sobre sellado y se abrirá 6 folios después.');
  L.rDetalle = h('div.arena-rec__detalle');
  L.rIntento = h('div.arena-rec__intento', { 'aria-live': 'polite' });
  L.rMineros = h('ul.arena-rec__mineros', { role: 'list' });
  L.rMinerosVacio = h('p.texto-3.arena-rec__vacio', 'Ninguna institución ha sellado un folio todavía.');
  L.recSec = h('section.panel.arena-rec', { 'aria-labelledby': id('rec-t') },
    h('div.panel__cabecera',
      h('h2', { id: id('rec-t') }, ui.termino('maduracion', 'Maduración'), ' de los créditos ganados'),
      h('span.empuja', ui.chip('6 confirmaciones', 'pendiente'))),
    h('div.panel__cuerpo.arena-rec__cuerpo',
      h('p.arena-rec__regla',
        'Los ', ui.termino('recompensa', 'créditos ganados por sellar'), ' el folio ', h('b.mono', 'h'), ' se acreditan al terminar el folio ',
        h('b.mono', 'h+6'), ' (6 ', ui.termino('confirmacion', 'confirmaciones'), ') y se pueden gastar desde el ', h('b.mono', 'h+7'),
        '. Hasta entonces son un sobre sellado: ya tienen dueña, pero la institución no puede usar esos créditos para registrar credenciales. Así, si el folio se revirtiera, los créditos no se habrían gastado.'),
      h('div.arena-saldos',
        h('div.arena-saldo', { dataset: { tipo: 'disponible' } }, h('span.etiqueta-instrumento', 'Créditos disponibles · toda la red'), L.rDisp, h('small', 'créditos de certificación que se pueden gastar')),
        h('div.arena-saldo', { dataset: { tipo: 'pendiente' } }, h('span.etiqueta-instrumento', 'Créditos ganados pendientes'), L.rPend, h('small', 'esperan sus 6 confirmaciones')),
        h('div.desglose__barra.arena-saldos__barra', { 'aria-hidden': 'true' }, L.rBarDisp, L.rBarPend)),
      h('div.arena-rec__linea-marco',
        h('p.etiqueta-instrumento', 'Línea de tiempo · h → h+6 → gastable en h+7'),
        h('div.arena-rec__desliza', L.rLinea),
        L.rVacio),
      L.rDetalle,
      L.rIntento,
      h('div.arena-rec__por-minero',
        h('h3.etiqueta-instrumento', 'Por institución que selló folios'),
        L.rMineros,
        L.rMinerosVacio)));
}

function filasRecompensa(e) {
  const items = e.recompensas?.items || [];
  const maduras = items.filter((i) => i.estado === 'madura').slice(-MADURAS_VISIBLES);
  const pend = items.filter((i) => i.estado === 'pendiente');
  return [...maduras, ...pend];
}

function pintarRecompensas(e, ctx, trans) {
  const { dom, anim } = ctx;
  const L = ctx.local;
  const tot = e.totales;
  const antesDisp = Number(L.rDisp.dataset.valor);
  const total = Math.max(1, tot.disponible + tot.pendiente_recompensas);
  if (L.rDisp.dataset.valor !== String(tot.disponible)) {
    L.rDisp.dataset.valor = String(tot.disponible);
    if (!trans.primera && Number.isFinite(antesDisp) && tot.disponible > antesDisp) {
      anim.contar(L.rDisp, antesDisp, tot.disponible, { formato: cc, duracion: 700 });
    } else {
      L.rDisp.textContent = cc(tot.disponible);
    }
  }
  dom.texto(L.rPend, cc(tot.pendiente_recompensas));
  dom.cssVar(L.rBarDisp, '--peso', (tot.disponible / total).toFixed(4));
  dom.cssVar(L.rBarPend, '--peso', (tot.pendiente_recompensas / total).toFixed(4));

  pintarLinea(e, ctx, trans);
  pintarDetalle(e, ctx);
  pintarPorMinero(e, ctx);

  // recompensas que acaban de madurar: el importe «viaja» al saldo disponible
  const ahora = new Map((e.recompensas?.items || []).map((i) => [i.bloque, i.estado]));
  if (L.recPrev && L.recPrev.epoca === e.epoca && !trans.primera) {
    for (const it of e.recompensas?.items || []) {
      if (it.estado === 'madura' && L.recPrev.mapa.get(it.bloque) === 'pendiente') madurarAnimado(ctx, it);
    }
  }
  L.recPrev = { epoca: e.epoca, mapa: ahora };
}

function pintarLinea(e, ctx, trans) {
  const { h, icono, dom, anim } = ctx;
  const L = ctx.local;
  const filas = filasRecompensa(e);
  L.rVacio.hidden = filas.length > 0;
  L.rLinea.hidden = !filas.length;
  if (!filas.length) { L.rLinea.replaceChildren(); L.rLinea.dataset.clave = ''; return; }
  const conf = e.recompensas.confirmaciones;
  const h0 = filas[0].bloque;
  const h1 = filas.at(-1).bloque + conf + 1;
  const cols = h1 - h0 + 1;
  // elegida por defecto: la pendiente más antigua (o la última madura)
  if (!filas.some((f) => f.bloque === L.seleccion)) L.seleccion = (filas.find((f) => f.estado === 'pendiente') || filas.at(-1)).bloque;
  const clave = `${e.epoca}|${e.altura}|${filas.map((f) => `${f.bloque}${f.estado[0]}`).join(',')}`;
  if (L.rLinea.dataset.clave === clave) {
    for (const b of L.rLinea.querySelectorAll('.arena-linea__etq')) dom.attr(b, 'aria-pressed', Number(b.dataset.bloque) === L.seleccion ? 'true' : 'false');
    return;
  }
  L.rLinea.dataset.clave = clave;
  const enfocado = document.activeElement?.closest?.('.arena-linea__etq')?.dataset.bloque;
  dom.cssVar(L.rLinea, '--cols', String(cols));
  const columna = (alt) => String(2 + alt - h0);

  const eje = h('div.arena-linea__eje', { 'aria-hidden': 'true' }, h('span.arena-linea__esq', 'altura'));
  for (let alt = h0; alt <= h1; alt += 1) {
    const el = h('span.arena-linea__h', String(alt));
    el.style.gridColumn = columna(alt);
    if (alt === e.altura) el.dataset.ahora = '';
    if (alt === h0 || alt === h1 || alt === e.altura) el.dataset.fijo = '';
    eje.append(el);
  }

  const lista = h('ol.arena-linea__filas', { role: 'list', 'aria-label': 'Créditos ganados por folio' });
  const nuevas = [];
  for (const it of filas) {
    const etq = h('button.arena-linea__etq', { type: 'button', dataset: { bloque: it.bloque }, 'aria-pressed': it.bloque === L.seleccion ? 'true' : 'false',
      title: etiquetaLarga(it.beneficiario),
      'aria-label': `Créditos del folio ${it.bloque} para ${etiquetaLarga(it.beneficiario)}, ${cc(it.monto)}: ${it.estado === 'madura' ? 'maduros, ya disponibles' : `${it.confirmaciones} de ${conf} confirmaciones, pendientes`}. Ver detalle` },
    icono(it.estado === 'madura' ? 'moneda' : 'llave'),
    h('span.arena-linea__etq-b', `#${it.bloque}`),
    h('span.arena-linea__etq-n', siglaDe(it.beneficiario)));
    etq.addEventListener('click', () => {
      L.seleccion = it.bloque;
      L.intento = null;
      L.rIntento.replaceChildren();
      for (const b of L.rLinea.querySelectorAll('.arena-linea__etq')) dom.attr(b, 'aria-pressed', b === etq ? 'true' : 'false');
      pintarDetalle(ctx.estado(), ctx);
    });
    const fila = h('li.arena-linea__fila', { dataset: { estado: it.estado } }, etq);
    const origen = h('span.arena-linea__celda', { dataset: { tipo: 'origen' }, 'aria-hidden': 'true', title: `Folio #${it.bloque}: ${etiqueta(it.beneficiario)} gana ${cc(it.monto)}` }, icono('bloque'));
    origen.style.gridColumn = columna(it.bloque);
    fila.append(origen);
    for (let j = 1; j <= conf; j += 1) {
      const alt = it.bloque + j;
      const lleno = e.altura >= alt;
      const celda = h('span.arena-linea__celda', { dataset: { tipo: 'conf', j }, 'aria-hidden': 'true', title: `Confirmación ${j}: folio #${alt}` }, String(j));
      celda.style.gridColumn = columna(alt);
      if (lleno) celda.dataset.lleno = '';
      if (alt === e.altura) celda.dataset.ahora = '';
      if (lleno && trans.altura && alt > trans.altura.antes && alt <= trans.altura.despues) nuevas.push(celda);
      fila.append(celda);
    }
    const gasto = h('span.arena-linea__celda', { dataset: { tipo: 'gasto' }, 'aria-hidden': 'true', title: `Gastable desde el folio #${it.madura_en + 1}` }, icono('moneda'));
    gasto.style.gridColumn = columna(it.madura_en + 1);
    if (it.estado === 'madura') gasto.dataset.lleno = '';
    fila.append(gasto);
    lista.append(fila);
  }
  const ahora = h('span.arena-linea__ahora', { 'aria-hidden': 'true' });
  ahora.style.setProperty('--c', String(e.altura - h0));
  ahora.hidden = e.altura < h0 || e.altura > h1;
  lista.append(ahora);
  L.rLinea.replaceChildren(eje, lista);
  if (enfocado) L.rLinea.querySelector(`.arena-linea__etq[data-folio="${enfocado}"]`)?.focus({ preventScroll: true });
  // cada bloque nuevo suma una confirmación a TODOS los sobres a la vez
  if (nuevas.length) anim.escalonar(nuevas, [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: anim.CURVA.acuse }, 40);
}

function pintarDetalle(e, ctx) {
  const { h, icono } = ctx;
  const L = ctx.local;
  const it = (e.recompensas?.items || []).find((i) => i.bloque === L.seleccion);
  const nodo = it ? e.nodos.find((n) => n.id === it.beneficiario) : null;
  const clave = it && nodo ? `${e.epoca}|${it.bloque}|${it.estado}|${it.confirmaciones}|${nodo.saldo.gastable}|${nodo.saldo.pendiente}|${nodo.saldo.disponible}` : '';
  if (L.rDetalle.dataset.clave === clave) return;
  L.rDetalle.dataset.clave = clave;
  if (!it || !nodo) { L.rDetalle.replaceChildren(); return; }
  const conf = e.recompensas.confirmaciones;
  const s = nodo.saldo;
  const quien = etiqueta(it.beneficiario);
  if (it.estado === 'madura') {
    L.rDetalle.replaceChildren(h('div.arena-rec__ficha', { dataset: { estado: 'madura' } },
      h('span.arena-rec__ficha-icono', icono('moneda')),
      h('div',
        h('p.arena-rec__ficha-titulo', `Folio #${it.bloque} → ${quien}: ${cc(it.monto)} ya disponibles`),
        h('p', `Se acreditaron al cerrar el folio #${it.madura_en} (${conf} confirmaciones). Desde el #${it.madura_en + 1}, ${siglaDe(it.beneficiario)} puede usarlos para registrar credenciales: forman parte de sus ${cc(s.disponible)} disponibles.`))));
    return;
  }
  const intentar = boton(ctx, 'secundario', 'moneda', 'Intentar gastar estos créditos');
  intentar.classList.add('boton--chico');
  intentar.addEventListener('click', () => intentarGastar(ctx, it.bloque, intentar));
  const encima = it.confirmaciones ? `los folios #${it.bloque + 1}${it.confirmaciones > 1 ? `…#${it.bloque + it.confirmaciones}` : ''} ya están encima` : 'todavía no tiene ningún folio encima';
  L.rDetalle.replaceChildren(h('div.arena-rec__ficha', { dataset: { estado: 'pendiente' } },
    h('span.arena-rec__ficha-icono', icono('llave')),
    h('div',
      h('p.arena-rec__ficha-titulo', `Folio #${it.bloque} → ${quien}: ${cc(it.monto)} en un sobre sellado`),
      h('p', `Tiene ${it.confirmaciones}/${conf} confirmaciones (${encima}). Se acreditan al cerrar el folio #${it.madura_en} y se pueden gastar desde el #${it.madura_en + 1}: ${it.faltan === 1 ? 'falta' : 'faltan'} ${plural(it.faltan, 'folio', 'folios')}.`),
      h('p.texto-2', `Ahora ${siglaDe(it.beneficiario)} puede gastar ${cc(s.gastable)} y tiene ${cc(s.pendiente)} por madurar. Prueba a usar estos créditos: se pagarán ${cc(s.gastable + it.monto)} a otra institución (lo gastable + estos ${cc(it.monto)}) y la red decidirá.`),
      h('div.grupo', intentar))));
}

async function intentarGastar(ctx, bloque, b) {
  const { h, ui, icono } = ctx;
  const L = ctx.local;
  const e = ctx.estado();
  const it = (e?.recompensas?.items || []).find((i) => i.bloque === bloque);
  const nodo = it ? e.nodos.find((n) => n.id === it.beneficiario) : null;
  if (!it || !nodo) return;
  const receptor = e.ids.find((x) => x !== it.beneficiario);
  const monto = nodo.saldo.gastable + it.monto;
  try {
    await ui.ocupado(b, ctx.api.accion('tx', { emisor: it.beneficiario, receptor, monto }));
    L.rIntento.replaceChildren(h('div.aviso', { dataset: { nivel: 'ok' } }, icono('ok'),
      h('div', h('strong', 'La red lo aceptó. '), `Para entonces los créditos del folio #${bloque} ya habían madurado: el registro ${etiqueta(it.beneficiario)} → ${etiqueta(receptor)} por ${cc(monto)} queda pendiente de verdad.`)));
    ctx.anim.entrar(L.rIntento.firstChild);
  } catch (err) {
    if (err?.name !== 'ErrorApi') { ui.mostrarError(err); return; }
    const det = err.detalle || {};
    L.rIntento.replaceChildren(h('div.aviso.arena-rec__rechazo', { dataset: { nivel: 'acento' } }, icono('escudo'),
      h('div.pila',
        h('p', h('strong', 'Rechazado por la red: '), h('span.mensaje-servidor', ctx.fmt.capital(conInstituciones(err.message)))),
        err.codigo === 'saldo_insuficiente'
          ? h('p.texto-2', `Se pidió pagar ${cc(monto)} = ${cc(nodo.saldo.gastable)} gastables + ${cc(it.monto)} ganados en el folio #${bloque}. Cada institución solo cuenta los créditos disponibles: con ${it.confirmaciones}/${e.recompensas.confirmaciones} confirmaciones, esos créditos aún no se pueden gastar. Podrán usarse desde el folio #${it.madura_en + 1}.`)
          : null,
        det.pendiente_recompensa !== undefined
          ? h('dl.renglones.arena-rec__renglones',
            h('div', h('dt', 'Gastable ahora'), h('dd', cc(det.gastable))),
            h('div', h('dt', 'Créditos ganados sin madurar'), h('dd', cc(det.pendiente_recompensa))),
            h('div', h('dt', 'Necesitaba'), h('dd', cc(det.necesario ?? monto))))
          : null,
        h('p.texto-3', 'código ', h('code', err.codigo)))));
    ctx.anim.sacudir(L.rIntento.firstChild);
  }
}

function pintarPorMinero(e, ctx) {
  const { h, dom } = ctx;
  const L = ctx.local;
  const ids = new Set((e.recompensas?.items || []).map((i) => i.beneficiario));
  for (const n of e.nodos) if (n.saldo.pendiente > 0) ids.add(n.id);
  const nodos = e.nodos.filter((n) => ids.has(n.id));
  L.rMinerosVacio.hidden = nodos.length > 0;
  const proxima = new Map();
  for (const it of e.recompensas?.items || []) if (it.estado === 'pendiente' && !proxima.has(it.beneficiario)) proxima.set(it.beneficiario, it.madura_en);
  dom.reconciliar(L.rMineros, nodos, (n) => n.id, (n) => {
    const b = marcaInst(n.id, { tag: 'button', clase: 'arena-enlace-nodo', props: { type: 'button', 'aria-label': `${etiquetaLarga(n.id)}: abrir su ficha` } });
    b.addEventListener('click', () => ctx.abrirNodo(n.id));
    return h('li.arena-minero', b,
      h('span.arena-minero__v', { dataset: { tipo: 'disponible' } }),
      h('span.arena-minero__v', { dataset: { tipo: 'pendiente' } }),
      h('div.desglose__barra.arena-minero__barra', { 'aria-hidden': 'true' }, h('span', { dataset: { parte: 'gastable' } }), h('span', { dataset: { parte: 'pendiente' } })),
      h('span.arena-minero__nota'));
  }, (li, n) => {
    const [vd, vp] = li.querySelectorAll('.arena-minero__v');
    const [bd, bp] = li.querySelectorAll('.arena-minero__barra > span');
    const tot = Math.max(1, n.saldo.disponible + n.saldo.pendiente);
    dom.texto(vd, `${cc(n.saldo.disponible)} disponibles`);
    dom.texto(vp, `${cc(n.saldo.pendiente)} pendientes`);
    dom.cssVar(bd, '--peso', (n.saldo.disponible / tot).toFixed(4));
    dom.cssVar(bp, '--peso', (n.saldo.pendiente / tot).toFixed(4));
    const p = proxima.get(n.id);
    dom.texto(li.querySelector('.arena-minero__nota'), p ? `próximos créditos maduran al cerrar #${p}` : 'sin créditos por madurar');
  });
}

/** El sobre se abre: el importe vuela de la línea de tiempo al saldo disponible. */
function madurarAnimado(ctx, it) {
  const { h, anim } = ctx;
  const L = ctx.local;
  ctx.red.destello(it.beneficiario, 'defensa');
  const destino = L.rDisp.closest('.arena-saldo');
  const fila = L.rLinea.querySelector(`.arena-linea__etq[data-folio="${it.bloque}"]`)?.closest('.arena-linea__fila');
  const origen = fila?.querySelector('[data-tipo="gasto"]');
  if (!origen || !destino || anim.reducido() || !L.raiz.isConnected) {
    anim.destello(destino, 'var(--valido)');
    return;
  }
  const caja = L.raiz.getBoundingClientRect();
  const a = origen.getBoundingClientRect();
  const b = L.rDisp.getBoundingClientRect();
  if (!a.width || !b.width) { anim.destello(destino, 'var(--valido)'); return; }
  const ficha = h('span.arena-moneda', { 'aria-hidden': 'true' }, `+${cc(it.monto)}`);
  ficha.style.left = `${Math.round(a.left - caja.left)}px`;
  ficha.style.top = `${Math.round(a.top - caja.top)}px`;
  L.raiz.append(ficha);
  const dx = b.left - a.left;
  const dy = b.top - a.top;
  const v = anim.animar(ficha, [
    { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
    { transform: 'translate(0, -14px) scale(1.1)', opacity: 1, offset: 0.2 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.9)`, opacity: 1, offset: 0.85 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0 },
  ], { duration: 900, easing: anim.CURVA.firma, fill: 'forwards' });
  const fin = () => { ficha.remove(); anim.destello(destino, 'var(--valido)'); };
  if (v) v.finished.then(fin, fin); else fin();
}

// ============================================================ cómo funciona
function construirComo(ctx) {
  const { h, ui } = ctx;
  const L = ctx.local;
  L.comoD = h('b.mono');
  L.comoEsp = h('b.mono');
  const paso = (n, ...hijos) => h('li.arena-como__paso', h('span.arena-como__num', String(n)), h('p', ...hijos));
  L.como = h('details.detalles.arena-como',
    h('summary', 'Cómo funciona: sellar un folio de registros, en seis pasos'),
    h('div.arena-como__cuerpo',
      h('ol.arena-como__pasos', { role: 'list' },
        paso(1, 'El folio candidato (los registros de credencial pendientes, la huella del folio anterior, la institución que lo propone, los créditos que ganará por sellarlo…) se resume con ', ui.termino('hash', 'SHA-256'), ' en una huella de 64 dígitos hexadecimales: el sello de autenticidad del folio, que cambia por completo si alguien altera un solo dato de un título ya registrado. Los datos de cada título no viajan: solo quién paga, a quién, cuántos créditos y cuándo.'),
        paso(2, 'Lo único que la institución selladora cambia es el ', ui.termino('nonce', 'nonce'), ': el número que se prueba una y otra vez hasta lograr una huella con los ceros exigidos. Cada nonce produce una huella distinta e impredecible: no hay atajo, solo probar.'),
        paso(3, 'El ', ui.termino('objetivo', 'objetivo'), ' exige que la huella empiece con ', L.comoD, ' ceros (la ', ui.termino('dificultad', 'dificultad'), '). Cada dígito es 0 con probabilidad 1/16, así que hacen falta unos ', L.comoEsp, ' intentos de media.'),
        paso(4, h('strong', 'Costoso sellar, barato verificar. '), 'Hallar el nonce exige miles de intentos; comprobarlo, un solo cálculo. Por eso las demás instituciones aceptan el folio sin tener que confiar en quien lo selló.'),
        paso(5, 'Cada institución recorre su ', ui.termino('carril', 'carril'), ': la de índice i prueba i, i+N, i+2N… En cada ', ui.termino('ronda', 'ronda'), ' todas prueban k nonces: ninguna repite trabajo ni va más rápido.'),
        paso(6, 'Si dos aciertan en la misma ronda, gana la huella numéricamente menor y la otra queda ', ui.termino('obsoleta', 'obsoleta'), '. Los créditos de certificación de la ganadora maduran 6 folios después.')),
      h('p.arena-como__nota', 'La pista muestra la última huella que probó cada institución en cada refresco (cuatro por segundo): es una muestra de su trabajo, no cada intento. «máx» es la mejor de las que se vieron.')));
}

function pintarComo(e, ctx) {
  const { d, esp } = datos(e);
  ctx.dom.texto(ctx.local.comoD, String(d));
  ctx.dom.texto(ctx.local.comoEsp, `16${sup(d)} = ${num(esp)}`);
}

// ==================================================================== anillo
function marcarAnillo(e, ctx) {
  const L = ctx.local;
  const lider = e.trabajo?.estado === 'minando' && ctx.activa ? L.liderId : null;
  if (lider === L.liderMarcado) return;
  if (L.liderMarcado) ctx.red.marcar(L.liderMarcado, 'arena-lider', false);
  if (lider) ctx.red.marcar(lider, 'arena-lider', true);
  L.liderMarcado = lider;
}

/** Quita las marcas de la arena del anillo (también si el modo ya cambió y la fachada no actúa). */
function limpiarAnillo(ctx) {
  ctx.local.liderMarcado = null;
  for (const el of document.querySelectorAll('.nodo.arena-lider')) el.classList.remove('arena-lider');
}
