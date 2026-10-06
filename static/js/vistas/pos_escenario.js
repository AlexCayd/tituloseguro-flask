// VISTA · Escenario de Proof of Stake — «la mesa de consenso» de «Título Seguro».
//
// Las instituciones apuestan créditos de certificación para avalar el siguiente bloque de
// registros; una institución deshonesta intenta avalar un registro fraudulento (firma alterada o
// créditos que no tiene) y lo paga: pierde créditos, que se queman.
//
// Una ronda decide UN bloque:
//   APUESTAS → SORTEO → CANDIDATO → VOTACION → ACEPTADO
//                 ↑                      └──→ RECHAZADO (castigo) ─┐
//                 └────────────── intento + 1, sin el castigado ───┘      ABORTADA
//
//  · Mando: iniciar (paso a paso / automática, nº de validadores), avanzar enviando siempre
//    `fase_esperada`, cancelar y autopiloto. Errores del servidor en línea con su texto exacto.
//  · Máquina de estados visible: 7 fases con el bucle de rechazo dibujado como bucle.
//  · Ruleta ponderada (pieza firma): sectores ∝ apuesta (`sorteo.intervalos`), aguja en (r+½)/A,
//    semilla y r en mono, recálculo con SHA-256 real en el navegador. Es PERSISTENTE: solo gira
//    cuando cambia el sorteo; repite los intentos de una ronda automática; tras un rechazo se
//    recompone sin el castigado y vuelve a girar. Los refrescos de ~1 s no la reinician.
//  · Bloque candidato, votación (barra apilada con marca fija en 2/3 y 3V ≥ 2A), castigo con la
//    fórmula real (regla A/B), resultado. Libro de validadores: apuestas editables y votos.
//  · Nodos deshonestos y «preparar un rechazo»: calcula en el navegador a quién sorteará la red.
//
// Estado de la instancia en ctx.local. actualizar() parchea el DOM; nunca lo reconstruye.

import { registrarFrase } from '../narrador.js';
import { registrarTermino } from '../glosario.js';
import { num, plural } from '../util/fmt.js';
import { marcaInst, etiqueta, etiquetaLarga, siglaDe, nombre as nombreInst, cc, conInstituciones } from './_bloque_ui.js';

// ======================================================================= datos fijos
const FASES = ['APUESTAS', 'SORTEO', 'CANDIDATO', 'VOTACION', 'ACEPTADO', 'RECHAZADO', 'ABORTADA'];
const PRINCIPALES = ['APUESTAS', 'SORTEO', 'CANDIDATO', 'VOTACION'];
const RE_ENTERO = /^\d+$/;
const RE_ENTERO_SIGNO = /^[-+]?\d+$/;

const FASE = {
  APUESTAS: {
    nombre: 'Apuestas', icono: 'apuesta',
    que: 'Cada institución avaladora bloquea parte de sus créditos de certificación. Su apuesta es su peso: en el sorteo y en la votación.',
    avanzar: 'se cierran y bloquean las apuestas y se sortea qué institución propone el folio.',
    boton: 'Cerrar apuestas y sortear',
  },
  SORTEO: {
    nombre: 'Sorteo', icono: 'ruleta',
    que: 'Un número reproducible, r = SHA-256(semilla) mod A, cae en el intervalo de una institución: esa es la proponente.',
    avanzar: 'la proponente arma el folio con hasta 8 registros pendientes y lo firma.',
    boton: 'Armar el folio candidato',
  },
  CANDIDATO: {
    nombre: 'Candidato', icono: 'bloque',
    que: 'La institución proponente armó y firmó el folio candidato. Cada avaladora lo revisa por su cuenta: firmas, créditos y enlace.',
    avanzar: 'se abre la votación (la proponente ya cuenta como voto a favor por haberlo firmado).',
    boton: 'Abrir la votación',
  },
  VOTACION: {
    nombre: 'Votación', icono: 'voto',
    que: 'Cada institución avaladora vota a favor o en contra con un peso igual a los créditos que apostó. Se avala si 3V ≥ 2A: dos tercios de lo apostado deben avalar el folio.',
    avanzar: 'las que aún no votaron votan según su revisión y se hace el recuento.',
    boton: 'Escrutar los votos',
  },
  ACEPTADO: {
    nombre: 'Aceptado', icono: 'ok',
    que: 'Los votos a favor llegaron a 2/3: el folio de registros entra en todas las copias, la proponente cobra sus créditos al instante y se liberan las apuestas.',
    avanzar: '', boton: '',
  },
  RECHAZADO: {
    nombre: 'Rechazado', icono: 'x',
    que: 'El folio no pasó: la institución proponente pierde créditos de su apuesta (castigo, se anulan) y queda fuera de la ronda. Ninguna otra pierde nada.',
    avanzar: 'se vuelve a sortear entre las que quedan, sin la castigada (intento + 1).',
    boton: 'Nuevo sorteo',
  },
  ABORTADA: {
    nombre: 'Abortada', icono: 'alerta',
    que: 'La ronda terminó sin folio: apuestas liberadas, registros pendientes intactos y castigos arrastrados al próximo folio aceptado.',
    avanzar: '', boton: '',
  },
};

const TRAMPA = { firma: 'firma alterada', gasto: 'créditos que no tiene' };
const EXPLICA_TRAMPA = {
  firma: (p) => `${p} retocó un carácter de la firma de un registro de credencial después de firmarlo: es un registro fraudulento. Al verificarlo con la clave pública de la institución emisora no cuadra, y cualquier avaladora honesta lo detecta.`,
  gasto: (p) => `${p} coló un registro de credencial suyo, bien firmado, pagando más créditos de certificación de los que tiene. Al aplicarlo se quedaría en números rojos: son créditos que no existen.`,
};
const EXPLICA_VOTO = {
  voto_no_validador: 'Solo votan las instituciones avaladoras que siguen en esta ronda: una institución sin apuesta (o ya castigada) no tiene peso que poner.',
  voto_duplicado: 'Un voto por institución y por ronda. Ojo: la proponente ya votó a favor al firmar su propio folio.',
  fase_incorrecta: 'Los votos solo se aceptan durante la fase de VOTACION.',
  sin_ronda: 'No hay ninguna ronda en curso a la que votar.',
  nodo_inexistente: 'Esa institución no existe en esta red.',
};

// ============================================================ glosario y narrador
registrarTermino('semilla_sorteo', {
  titulo: 'Semilla del sorteo', alias: 'huella | número | intento',
  texto: 'El texto público del que sale el número del sorteo: la huella del último folio, el número del folio que se decide y el intento. Ninguna institución la elige y cualquiera puede recalcularla.',
  ejemplo: 'r = SHA-256("ab12…|5|0") mod A. Tras un rechazo cambia el intento (…|5|1), así que cambia r.',
  ver: ['sorteo_ponderado', 'proponente', 'hash'],
});
registrarTermino('sorteo_ponderado', {
  titulo: 'Sorteo ponderado',
  texto: 'Las apuestas se ponen en fila, ordenadas por id: cada institución avaladora ocupa un intervalo tan ancho como los créditos que apuesta. Se toma un número r entre 0 y A − 1 y propone la institución que tenga el intervalo donde cae. Más apuesta da más probabilidad, no certeza.',
  ejemplo: 'UAN (N01) apuesta 10 CC y UNAM (N02) 30 CC: UAN ocupa [0, 10) y UNAM [10, 40). Con r = 17 propone UNAM (tenía un 75 %).',
  ver: ['semilla_sorteo', 'stake', 'proponente'],
});
registrarTermino('ronda_pos', {
  titulo: 'Ronda de aval (Proof of Stake)',
  texto: 'El proceso que decide UN folio de registros: apuestas → sorteo → folio candidato → votación. Si el folio se rechaza, la proponente es castigada y hay nuevo sorteo dentro de la misma ronda; si no queda ninguna institución, la ronda se aborta.',
  ver: ['stake', 'quorum', 'castigo'],
});
registrarTermino('quemar', {
  titulo: 'Anular créditos',
  texto: 'Destruirlos para siempre: no pasan a ninguna institución. El castigo de una proponente deshonesta se anula, así la trampa cuesta créditos de verdad y nadie gana nada acusando a otra.',
  ejemplo: 'La conservación de los créditos lo cuenta aparte: disponibles + por madurar + anulados = emitidos.',
  ver: ['castigo', 'stake'],
});

registrarFrase('ronda_inicio', (e, est) => {
  const n = e.datos?.validadores?.length || 0;
  const r = est?.ronda?.id === e.datos?.ronda ? est.ronda : null;
  return {
    titulo: `Ronda #${e.datos?.ronda ?? '?'}: ${plural(n, 'institución apuesta', 'instituciones apuestan')} créditos`,
    texto: `Cada una bloquea parte de sus créditos de certificación${r ? ` (A = ${cc(r.A)} en total)` : ''}: su apuesta será su peso en el sorteo y en la votación para avalar el folio.${r?.modo === 'paso' ? ' Antes de cerrarlas puedes cambiarlas en el escenario.' : ''}`,
    nivel: 'info',
  };
});
registrarFrase('apuestas_fijadas', (e) => {
  if (/^Apuestas actualizadas/.test(e.texto || '')) {
    return { titulo: 'Apuestas cambiadas', texto: `${conInstituciones(e.texto.replace(/^Apuestas actualizadas:\s*/, 'Ahora: '))}. Cambia el ancho de cada sector de la ruleta y, con él, su probabilidad.`, nivel: 'info' };
  }
  const a = (e.texto || '').match(/A = (\d+)/)?.[1];
  return { titulo: 'Apuestas cerradas y bloqueadas', texto: `Los créditos apostados${a ? ` (A = ${cc(Number(a))})` : ''} quedan bloqueados: ninguna institución puede gastarlos ni cambiarlos mientras dure la ronda.`, nivel: 'info' };
});
registrarFrase('sorteo', (e, est) => {
  const v = est?.ronda?.validadores?.find((x) => x.id === e.nodo);
  const p = v && e.datos?.A ? Math.round((100 * v.apuesta) / e.datos.A) : null;
  return {
    titulo: `Sorteo: propone ${etiqueta(e.nodo)}`,
    texto: `r = ${num(e.datos?.r)} de A = ${num(e.datos?.A)} cae en el intervalo de ${siglaDe(e.nodo)}${p !== null ? `, que tenía un ${p} % de probabilidad` : ''}. Más créditos apostados dan más probabilidad, no certeza; y cualquiera puede recalcular r con la semilla pública.`,
    nivel: 'info',
  };
});
registrarFrase('candidato', (e) => {
  const t = e.datos?.trampa;
  const quien = etiqueta(e.nodo);
  return {
    titulo: `${quien} propone el folio candidato`,
    texto: t
      ? `${quien} es una institución deshonesta: armó y firmó un folio con un registro fraudulento (${TRAMPA[t] || t}). Las avaladoras honestas lo revisarán y deberían votar en contra.`
      : `${quien} armó el folio con los registros pendientes y lo firmó. Ahora cada institución avaladora lo revisa y vota con el peso de su apuesta.`,
    nivel: t ? 'aviso' : 'info',
  };
});
registrarFrase('ronda_aceptada', (e, est) => {
  const v = est?.ronda?.resultado?.bloque === e.datos?.bloque ? est.ronda.votacion : null;
  return {
    titulo: `Folio #${e.datos?.bloque} avalado`,
    texto: `${v ? `${cc(v.V_si)} de ${cc(v.A)} a favor: 3 × ${num(v.V_si)} ≥ 2 × ${num(v.A)}. ` : 'Los votos a favor llegaron a 2/3 de los créditos apostados. '}${etiqueta(e.nodo)} cobra sus créditos ganados por sellar al instante (PoS no espera confirmaciones) y se liberan las apuestas.`,
    nivel: 'ok',
  };
});
registrarFrase('ronda_rechazada', (e) => ({
  titulo: `Folio de ${etiqueta(e.nodo)} rechazado`,
  texto: `${siglaDe(e.nodo)} pierde ${cc(e.datos?.monto)} de su apuesta (regla ${e.datos?.regla}), que se anulan, y queda fuera de la ronda. Al avanzar se sortea otra proponente sin ella.`,
  nivel: 'error',
}));
registrarFrase('ronda_abortada', (e) => ({
  titulo: /^Cancelada/.test(e.datos?.motivo || '') ? 'Ronda cancelada' : 'Ronda abortada',
  texto: `${conInstituciones(e.datos?.motivo || e.texto)} Las apuestas se liberan, los registros pendientes siguen en espera y los castigos se registrarán en el próximo folio aceptado.`,
  nivel: 'aviso',
}));

// ========================================================================= ayudas
const suma = (xs) => xs.reduce((a, v) => a + (v.apuesta || 0), 0);
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const espera = (ms) => new Promise((ok) => { setTimeout(ok, ms); });
const f2 = (x) => x.toFixed(2);

function pct(p) {
  const v = p * 100;
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 && v < 10 ? v.toFixed(1) : Math.round(v)} %`;
}
function alfaTexto(pm) { return String(pm / 1000); }

/** Intervalos acumulados como `consenso.sortear` (orden por id, solo apuestas > 0). */
function intervalosDe(validadores) {
  const ids = validadores.filter((v) => v.apuesta > 0).slice().sort(porId);
  let acum = 0;
  const intervalos = ids.map((v) => { const t = { id: v.id, desde: acum, hasta: acum + v.apuesta }; acum += v.apuesta; return t; });
  return { intervalos, A: acum };
}
const ganadorDe = (intervalos, r) => intervalos.find((t) => r < t.hasta)?.id ?? null;
const intentoDeSemilla = (s) => Number(String(s || '').split('|').pop()) || 0;

/** r = SHA-256(semilla) mod A, exactamente como el servidor (BigInt). null si no hay crypto.subtle. */
async function rDeSemilla(fmt, semilla, A) {
  if (!A) return null;
  const hex = await fmt.sha256(semilla);
  if (!hex) return null;
  return { hex, r: Number(BigInt(`0x${hex}`) % BigInt(A)) };
}

/** Sorteo que haría la red en el intento `intento` (sin los castigados antes de él). */
async function predecir(ctx, hashAnterior, r, intento = 0) {
  const elim = new Set((r.castigos_ronda || []).filter((c) => c.intento < intento).map((c) => c.proponente));
  const { intervalos, A } = intervalosDe(r.validadores.filter((v) => !elim.has(v.id)));
  if (!A || !hashAnterior) return null;
  const semilla = `${hashAnterior}|${r.numero_bloque}|${intento}`;
  const x = await rDeSemilla(ctx.fmt, semilla, A);
  if (!x) return null;
  return { semilla, r: x.r, A, intervalos, ganador: ganadorDe(intervalos, x.r), intento };
}


function formulaCastigo(c, regla, alfaPm) {
  if (regla === 'B') {
    const prod = Math.floor((alfaPm * Math.max(c.valor_tx, 0) + 999) / 1000);
    const minimo = prod < 1 ? ' (mínimo 1)' : '';
    return `Regla B: min(apuesta, ⌈α × créditos del registro⌉) = min(${num(c.apuesta)}, ⌈${alfaTexto(alfaPm)} × ${num(c.valor_tx)}⌉) = min(${num(c.apuesta)}, ${num(prod)}) = ${cc(c.monto)}${minimo}`;
  }
  return `Regla A: pierde toda la apuesta = ${cc(c.monto)}`;
}

function estadoChipFase(f) {
  return { ACEPTADO: 'valido', RECHAZADO: 'rechazado', ABORTADA: 'advertencia' }[f] || 'acento';
}

// ======================================================================== la vista
export default {
  id: 'pos_escenario',
  etiqueta: 'Avales',
  titulo: 'Ronda de aval',
  icono: 'apuesta',
  modos: ['pos'],
  orden: 30,
  descripcion: 'Las instituciones apuestan créditos para avalar el siguiente folio de registros (el «bloque»): un sorteo ponderado elige a la proponente y las demás votan con el peso de su apuesta. Una institución deshonesta intenta avalar un registro fraudulento… y lo paga con los créditos que apostó.',
  insignia: (e) => (e.ronda?.activa ? e.ronda.fase.toLowerCase() : null),

  montar(host, ctx) {
    const { h } = ctx;
    const L = Object.assign(ctx.local, { uid: ctx.dom.uid('esc'), filaFoco: null });
    L.mando = construirMando(ctx);
    L.ruleta = construirRuleta(ctx);
    L.bloque = construirBloque(ctx);
    L.libro = construirLibro(ctx);
    L.trampas = construirTrampas(ctx);
    L.hist = construirHistorial(ctx);
    L.raiz = h('div.esc', { dataset: { fase: 'ninguna' } },
      L.mando.raiz,
      h('div.esc-escena', L.ruleta.raiz, L.bloque.raiz),
      L.libro.raiz,
      h('div.esc-pie', L.trampas.raiz, L.hist.raiz),
      construirComo(ctx),
    );
    host.append(L.raiz);
    // si cambia la preferencia de movimiento a mitad de un giro, se salta al estado final
    ctx.anim.alCambiarMovimiento(() => saltarAnimacion(ctx));
  },

  actualizar(e, ctx, cambios = {}) {
    if (!e?.existe) return;
    const L = ctx.local;
    L.raiz.dataset.fase = e.ronda?.fase || 'ninguna';
    L.raiz.dataset.activa = e.ronda?.activa ? 'si' : 'no';
    pintarMando(e, ctx, cambios);
    pintarFases(e, ctx, cambios);
    pintarRuleta(e, ctx, cambios);
    pintarBloque(e, ctx, cambios);
    pintarLibro(e, ctx, cambios);
    pintarTrampas(e, ctx);
    pintarHistorial(e, ctx, cambios);
  },
};

// ==================================================================== avisos en línea
function aviso(ctx, nivel, titulo, mensaje, { codigo = null, explica = null, extra = null, servidor = true } = {}) {
  const { h, icono, fmt } = ctx;
  const ico = { ok: 'ok', aviso: 'alerta', error: 'x', acento: 'escudo', info: 'info' }[nivel] || 'info';
  return h('div.aviso.esc-aviso', { dataset: { nivel }, role: nivel === 'error' ? 'alert' : 'status' },
    icono(ico),
    h('div.esc-aviso__cuerpo',
      h('p', h('strong', titulo), mensaje ? ' ' : null, mensaje ? h(servidor ? 'span.mensaje-servidor' : 'span', fmt.capital(servidor ? conInstituciones(mensaje) : mensaje)) : null),
      explica ? h('p.texto-2', explica) : null,
      extra,
      codigo ? h('p.esc-aviso__codigo', 'código ', h('code', codigo)) : null,
    ));
}

function ponerAviso(ctx, destino, el) {
  ctx.dom.reemplazar(destino, el);
  if (el) ctx.anim.sacudir(el);
}

function accionesSinPendientes(ctx, destino) {
  const { h, icono, ui } = ctx;
  const generar = h('button.boton.boton--fantasma.boton--chico', { type: 'button' }, icono('dado'), h('span', 'Generar 3 registros al azar'));
  generar.addEventListener('click', async () => {
    try {
      const r = await ui.ocupado(generar, ctx.api.accion('tx/aleatorias', { cantidad: 3 }));
      ctx.dom.reemplazar(destino);
      ui.toast(`Se firmaron ${plural(r.txs.length, 'registro de credencial', 'registros de credencial')}: ya hay algo que proponer.`, { nivel: 'ok' });
    } catch (err) { ui.mostrarError(err); }
  });
  return h('div.grupo',
    h('button.boton.boton--secundario.boton--chico', { type: 'button', on: { click: () => ctx.navegar('transacciones') } }, icono('firma'), h('span', 'Registrar credenciales')),
    generar);
}

/** Errores de las acciones de ronda: los didácticos van en línea; el resto, a ui.mostrarError. */
function errorRonda(ctx, err, { form = null, destino = null } = {}) {
  const { ui } = ctx;
  if (err?.name !== 'ErrorApi') { ui.mostrarError(err); return; }
  if (err.codigo === 'epoca_obsoleta') return;
  const caja = destino || ctx.local.mando.aviso;
  if (err.campo === 'apuestas' && err.detalle?.nodo && marcarApuesta(ctx, err.detalle.nodo, err.message)) {
    ponerAviso(ctx, caja, aviso(ctx, 'aviso', 'Revisa esa apuesta.', err.message, { codigo: err.codigo, explica: 'Los créditos de esa institución cambiaron desde que apostó: corrige la apuesta en su fila y vuelve a avanzar.' }));
    return;
  }
  const CASOS = {
    sin_pendientes: { titulo: 'No hay nada que avalar.', explica: 'Una ronda decide un folio y un folio necesita al menos un registro de credencial pendiente. Las apuestas no llegaron a bloquearse: ninguna institución perdió créditos.', extra: () => accionesSinPendientes(ctx, caja) },
    sin_validadores: { titulo: 'No hay instituciones avaladoras posibles.', explica: 'Para validar hay que apostar, y para apostar hay que tener créditos de certificación gastables y estar conectada y sincronizada.' },
    ronda_en_curso: { titulo: 'Ya hay una ronda en marcha.', explica: 'Termínala avanzando hasta el final o cancélala antes.' },
    fase_cambio: { titulo: 'Otra pestaña se adelantó.', explica: 'Mandamos la fase que veías («fase_esperada») y el servidor vio que ya no era la actual: así dos pestañas nunca avanzan dos veces la misma ronda. Ya tienes el estado nuevo; míralo antes de volver a avanzar.' },
    sin_ronda: { titulo: 'No hay ronda en curso.', explica: 'Quizá terminó o se canceló desde otra pestaña.' },
    fase_incorrecta: { titulo: 'No se puede en esta fase.', explica: null },
    cadena_llena: { titulo: 'El libro de registros está lleno.', explica: null },
    sin_referencia: { titulo: 'No hay libro de referencia.', explica: null },
  };
  const c = CASOS[err.codigo];
  if (!c) { ui.mostrarError(err, { form }); return; }
  ponerAviso(ctx, caja, aviso(ctx, 'aviso', c.titulo, err.message, { codigo: err.codigo, explica: c.explica, extra: c.extra?.() }));
}

// ============================================================================ mando
function construirMando(ctx) {
  const { h, ui, icono } = ctx;
  const L = ctx.local;
  const id = (x) => `${L.uid}-${x}`;
  const M = {};

  M.titulo = h('h2.esc-mando__titulo', { id: id('mando-t') }, 'Sin ronda en curso');
  M.chips = h('div.esc-mando__chips');
  M.fases = construirFases(ctx);

  M.ahoraFase = h('span');
  M.ahoraQue = h('p.esc-ahora__que');
  M.ahoraSig = h('p.esc-ahora__sig');
  M.ahora = h('div.esc-ahora', h('p.etiqueta-instrumento.esc-ahora__et', 'Ahora · ', M.ahoraFase), M.ahoraQue, M.ahoraSig);

  // ---- ronda en curso
  M.avanzarTxt = h('span', 'Avanzar');
  M.avanzar = h('button.boton.boton--primario.esc-avanzar', { type: 'button' }, icono('play'), M.avanzarTxt);
  M.cancelar = h('button.boton.boton--peligro', { type: 'button' }, icono('x'), h('span', 'Cancelar ronda'));
  M.avanzar.addEventListener('click', () => avanzarRonda(ctx));
  M.cancelar.addEventListener('click', () => cancelarRonda(ctx));
  M.enCurso = h('div.esc-mando__acciones', M.avanzar, M.cancelar);

  // ---- configurar e iniciar
  M.nVal = h('input.entrada.entrada--mono', { id: id('nval'), name: 'n_validadores', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', placeholder: 'todas', 'aria-describedby': id('nval-ayuda') });
  M.nVal.addEventListener('input', () => ui.limpiarCampo(M.nVal));
  M.iniciar = h('button.boton.boton--primario.esc-iniciar', { type: 'submit' }, icono('ruleta'), h('span', 'Iniciar ronda'));
  M.modoAyuda = h('p.campo__ayuda', { id: id('modo-ayuda') });
  const modo = h('div.segmentado.esc-modo', { role: 'radiogroup', 'aria-labelledby': id('modo-t'), 'aria-describedby': id('modo-ayuda') },
    [['paso', 'Paso a paso'], ['auto', 'Automática']].map(([v, t]) => h('label', h('input', { type: 'radio', name: 'modo', value: v, checked: v === 'paso' }), t)));
  const ayudaModo = () => {
    const auto = M.form.querySelector('input[name="modo"]:checked')?.value === 'auto';
    M.modoAyuda.textContent = auto
      ? 'La ronda corre entera de una vez; aquí verás la repetición del sorteo y el resultado.'
      : 'Tú avanzas cada fase: puedes editar apuestas, votar a mano como cualquier institución y ver girar la ruleta.';
  };
  M.form = h('form.esc-config', { novalidate: true, 'aria-label': 'Configurar una ronda nueva' },
    h('div.campo.esc-config__val',
      h('label.campo__etiqueta', { for: M.nVal.id }, 'Instituciones avaladoras'),
      M.nVal,
      h('p.campo__ayuda', { id: id('nval-ayuda') }, 'Vacío = todas las que tengan créditos.'),
      h('p.campo__error', { 'aria-live': 'polite' })),
    h('div.campo.esc-config__modo', h('p.campo__etiqueta', { id: id('modo-t') }, 'Modo'), modo, M.modoAyuda),
    h('div.esc-config__ir', M.iniciar));
  modo.addEventListener('change', ayudaModo);
  M.form.addEventListener('submit', (ev) => { ev.preventDefault(); iniciarRonda(ctx); });
  ayudaModo();

  // ---- autopiloto (atajo)
  M.bloques = h('input.entrada.entrada--mono', { id: id('bloques'), name: 'bloques', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: '3' });
  M.producir = h('button.boton.boton--secundario', { type: 'submit' }, icono('play'), h('span', 'Producir'));
  M.formAuto = h('form.esc-auto', { novalidate: true },
    h('p.esc-auto__aviso', icono('alerta'), h('span', h('strong', 'Atajo de demostración. '),
      'Encadena rondas automáticas completas (y firma registros de credencial al azar si faltan). Sirve para acumular folios; para entender Proof of Stake, sigue una ronda paso a paso.')),
    h('div.campo.esc-auto__campo',
      h('label.campo__etiqueta', { for: M.bloques.id }, 'Folios a producir (1 a 20)'),
      h('div.entrada-compuesta', M.bloques, M.producir),
      h('p.campo__error', { 'aria-live': 'polite' })));
  M.bloques.addEventListener('input', () => ui.limpiarCampo(M.bloques));
  M.formAuto.addEventListener('submit', (ev) => { ev.preventDefault(); autopiloto(ctx); });

  M.previo = h('div.esc-mando__previo');
  M.aviso = h('div.esc-mando__aviso', { 'aria-live': 'polite' });
  M.raiz = h('section.panel.panel--instrumento.esc-mando', { 'aria-labelledby': id('mando-t') },
    h('div.panel__cabecera.esc-mando__cab',
      h('span.esc-mando__icono', { 'aria-hidden': 'true' }, icono('ruleta')),
      h('div.esc-mando__cab-txt', h('p.etiqueta-instrumento', ui.termino('ronda_pos', 'Ronda de aval')), M.titulo),
      M.chips),
    h('div.panel__cuerpo.esc-mando__cuerpo',
      M.fases.raiz,
      h('div.esc-mando__fila', M.ahora, h('div.esc-mando__control', M.enCurso, M.form)),
      M.previo,
      M.aviso,
      h('details.detalles.esc-mando__auto', h('summary', 'Autopiloto: producir varios folios seguidos'), M.formAuto),
    ));
  return M;
}

function leerConfig(ctx) {
  const M = ctx.local.mando;
  const N = ctx.estado()?.nodos?.length || ctx.limites.n_max || 20;
  const cuerpo = { modo: M.form.querySelector('input[name="modo"]:checked')?.value || 'paso' };
  const t = M.nVal.value.trim();
  if (t) {
    if (!RE_ENTERO.test(t) || Number(t) < 1 || Number(t) > N) {
      throw { campo: 'n_validadores', mensaje: `El número de instituciones avaladoras debe ser un entero entre 1 y ${N} (vacío = todas las que tengan créditos).` };
    }
    cuerpo.n_validadores = Number(t);
  }
  return cuerpo;
}

async function iniciarRonda(ctx, { modo = null, boton = null, destino = null } = {}) {
  const { ui } = ctx;
  const M = ctx.local.mando;
  ui.limpiarCampos(M.form);
  let cuerpo;
  try { cuerpo = leerConfig(ctx); } catch (err) {
    if (err?.campo) { ui.marcarCampo(M.form, err.campo, err.mensaje); return null; }
    throw err;
  }
  if (modo) cuerpo.modo = modo;
  try {
    const r = await ui.ocupado(boton || M.iniciar, ctx.api.accion('ronda', cuerpo));
    ctx.dom.reemplazar(M.aviso);
    return r.ronda;
  } catch (err) {
    errorRonda(ctx, err, { form: M.form, destino });
    return null;
  }
}

async function avanzarRonda(ctx) {
  const { ui } = ctx;
  const M = ctx.local.mando;
  const r = ctx.estado()?.ronda;
  if (!r?.activa) return;
  try {
    await ui.ocupado(M.avanzar, ctx.api.accion('ronda/avanzar', { fase_esperada: r.fase }));
    ctx.dom.reemplazar(M.aviso);
  } catch (err) { errorRonda(ctx, err); }
}

async function cancelarRonda(ctx) {
  const { ui } = ctx;
  const M = ctx.local.mando;
  const r = ctx.estado()?.ronda;
  if (!r?.activa) return;
  const castigos = r.castigos_ronda || [];
  const ok = await ui.confirmar({
    titulo: `¿Cancelar la ronda #${r.id}?`,
    texto: 'La ronda termina sin folio:',
    lista: [
      'Se liberan las apuestas: ninguna institución pierde los créditos que apostó.',
      'Los registros de credencial pendientes siguen en espera.',
      castigos.length ? `Los castigos ya aplicados (${castigos.map((c) => `${siglaDe(c.proponente)} −${cc(c.monto)}`).join(', ')}) se mantienen y se registrarán en el próximo folio aceptado.` : null,
    ].filter(Boolean),
    confirmar: 'Cancelar la ronda',
    cancelar: 'Seguir con la ronda',
    peligro: true,
  });
  if (!ok) return;
  try {
    await ui.ocupado(M.cancelar, ctx.api.accion('ronda/cancelar'));
    ctx.dom.reemplazar(M.aviso);
  } catch (err) { errorRonda(ctx, err); }
}

async function autopiloto(ctx) {
  const { ui } = ctx;
  const M = ctx.local.mando;
  ui.limpiarCampos(M.formAuto);
  const t = M.bloques.value.trim();
  if (!RE_ENTERO.test(t) || Number(t) < 1 || Number(t) > 20) {
    ui.marcarCampo(M.formAuto, 'bloques', 'El número de folios debe ser un entero entre 1 y 20.');
    return;
  }
  try {
    const r = await ui.ocupado(M.producir, ctx.api.accion('autopiloto', { bloques: Number(t) }));
    if (r.detenido_por) ui.toast(`Se avalaron ${r.producidos} de ${t} folios. Se detuvo: ${conInstituciones(r.detenido_por)}`, { nivel: 'aviso', titulo: 'Autopiloto detenido' });
    else ui.toast(`Se avalaron ${plural(r.producidos, 'folio', 'folios')} de registros con rondas automáticas completas.`, { nivel: 'ok', titulo: 'Autopiloto' });
  } catch (err) { errorRonda(ctx, err, { form: M.formAuto }); }
}

function pintarMando(e, ctx, cambios) {
  const { ui, dom } = ctx;
  const M = ctx.local.mando;
  const r = e.ronda;
  const activa = !!r?.activa;
  dom.texto(M.titulo, activa ? `Ronda #${r.id} · decide el folio #${r.numero_bloque}`
    : r ? `Ronda #${r.id} terminada · ${FASE[r.fase].nombre.toLowerCase()}` : 'Sin ronda en curso');
  const claveChips = r ? `${r.id}|${r.fase}|${r.modo}|${r.intento}` : 'nada';
  if (M.chips.dataset.clave !== claveChips) {
    M.chips.dataset.clave = claveChips;
    dom.reemplazar(M.chips, r
      ? [ui.chip(FASE[r.fase].nombre, estadoChipFase(r.fase)), ui.chip(r.modo === 'paso' ? 'paso a paso' : 'automática', 'neutro', { sinPunto: true }),
        r.intento ? ui.chip(`intento ${r.intento}`, 'rechazado', { sinPunto: true }) : null]
      : ui.chip('en reposo', 'neutro'));
  }
  M.enCurso.hidden = !activa;
  M.form.hidden = activa;
  const castigado = r?.fase === 'RECHAZADO' ? r.proponente : null;
  if (activa) {
    dom.texto(M.avanzarTxt, castigado ? `Nuevo sorteo sin ${siglaDe(castigado)}` : FASE[r.fase].boton);
    M.avanzar.dataset.fase = r.fase;
  }
  const f = r?.fase || null;
  dom.texto(M.ahoraFase, f ? `${FASE[f].nombre}${r.intento ? ` · intento ${r.intento}` : ''}` : 'sin ronda');
  dom.texto(M.ahoraQue, f ? FASE[f].que
    : 'Una ronda decide UN folio de registros: las instituciones apuestan créditos, un sorteo ponderado elige cuál lo propone y las demás lo avalan (o no) con el peso de su apuesta.');
  let sig;
  if (activa && castigado) sig = `Al avanzar: se vuelve a sortear entre las que quedan, sin ${etiqueta(castigado)} (intento ${r.intento + 1}).`;
  else if (activa) sig = `Al avanzar: ${FASE[f].avanzar}`;
  else if (r) sig = 'Inicia otra ronda para decidir el siguiente folio de registros.';
  else sig = 'Al iniciar: se eligen las instituciones avaladoras y cada una apuesta, por defecto, entre el 10 % y el 50 % de los créditos que puede gastar.';
  dom.texto(M.ahoraSig, sig);
  pintarPrevio(e, ctx, activa);
  if (cambios.fase && !cambios.primera) ctx.anim.entrar(M.ahora);
}

/** Estados vacíos anticipados (el 409 del servidor sigue siendo la verdad si se insiste). */
function pintarPrevio(e, ctx, activa) {
  const M = ctx.local.mando;
  const sinPend = !activa && !e.pendientes_total;
  const conSaldo = e.nodos.filter((n) => n.conectado && n.sincronizado && n.cadena_integra && n.saldo.gastable >= 1).length;
  const sinVal = !activa && conSaldo === 0;
  const clave = `${sinPend}|${sinVal}`;
  if (M.previo.dataset.clave === clave) return;
  M.previo.dataset.clave = clave;
  ctx.dom.reemplazar(M.previo,
    sinPend ? aviso(ctx, 'aviso', 'Sin registros de credencial pendientes.', 'Una ronda necesita algo que avalar en el folio. Puedes pulsar «Iniciar ronda» igualmente para ver cómo responde la red.', { servidor: false, extra: accionesSinPendientes(ctx, M.previo) }) : null,
    sinVal ? aviso(ctx, 'aviso', 'Ninguna institución puede apostar.', 'Todas están sin créditos gastables, desconectadas o desfasadas: la red no tendría avaladoras.', { servidor: false }) : null);
}

// ========================================================= máquina de estados (fases)
function construirFases(ctx) {
  const { h, icono } = ctx;
  const F = { items: new Map() };
  F.lista = h('ol.esc-fases__lista', { role: 'list' });
  FASES.forEach((f, i) => {
    const cuenta = h('span.esc-fase__cuenta.mono');
    const li = h('li.esc-fase', { dataset: { fase: f, estado: 'pendiente' } },
      h('span.esc-fase__marca', { 'aria-hidden': 'true' }, icono(FASE[f].icono)),
      h('span.esc-fase__texto',
        h('span.esc-fase__num.mono', { 'aria-hidden': 'true' }, i < 4 ? `0${i + 1}` : 'fin'),
        h('span.esc-fase__nombre', FASE[f].nombre)),
      cuenta,
      h('span.solo-lectores.esc-fase__sr'));
    F.items.set(f, { li, cuenta, sr: li.querySelector('.esc-fase__sr') });
    F.lista.append(li);
  });
  F.bucleTxt = h('span.esc-fases__bucle-txt');
  F.bucle = h('div.esc-fases__bucle', { 'aria-hidden': 'true' }, h('span.esc-fases__bucle-et', icono('reiniciar'), F.bucleTxt));
  F.raiz = h('div.esc-fases', { role: 'group', 'aria-label': 'Fases de la ronda' }, F.lista, F.bucle);
  return F;
}

function pintarFases(e, ctx, cambios) {
  const F = ctx.local.mando.fases;
  const r = e.ronda;
  const actual = r?.fase || null;
  const vistas = new Set((r?.historial || []).map((x) => x.fase));
  if (r) vistas.add('APUESTAS');
  const i = PRINCIPALES.indexOf(actual);
  let previa = null;
  if (i > 0) previa = actual === 'SORTEO' && r.intento > 0 ? 'RECHAZADO' : PRINCIPALES[i - 1];
  else if (actual === 'ACEPTADO' || actual === 'RECHAZADO') previa = 'VOTACION';
  else if (actual === 'ABORTADA') previa = [...(r.historial || [])].reverse().find((x) => x.fase !== 'ABORTADA')?.fase || 'APUESTAS';
  const rechazos = r?.castigos_ronda?.length || 0;
  for (const f of FASES) {
    const it = F.items.get(f);
    let est = 'pendiente';
    if (r) {
      if (f === actual) est = 'actual';
      else if (PRINCIPALES.includes(f)) est = (i >= 0 ? PRINCIPALES.indexOf(f) < i : vistas.has(f)) ? 'hecha' : 'pendiente';
      else if (vistas.has(f)) est = 'hecha';
    }
    it.li.dataset.estado = est;
    ctx.dom.attr(it.li, 'data-previa', f === previa ? '' : null);
    ctx.dom.attr(it.li, 'aria-current', est === 'actual' ? 'step' : null);
    ctx.dom.texto(it.sr, est === 'actual' ? ' (fase actual)' : est === 'hecha' ? ' (completada)' : f === previa ? ' (anterior)' : '');
    if (f === 'RECHAZADO') ctx.dom.texto(it.cuenta, rechazos ? `×${rechazos}` : '');
  }
  const bucle = actual === 'RECHAZADO' ? 'siguiente' : (r?.intento > 0 ? 'usado' : 'inactivo');
  F.bucle.dataset.estado = bucle;
  ctx.dom.texto(F.bucleTxt, bucle === 'siguiente' ? `castigo → nuevo sorteo (intento ${r.intento + 1})`
    : bucle === 'usado' ? `${plural(r.intento, 'rechazo', 'rechazos')} → se volvió a sortear`
      : 'si se rechaza: castigo y nuevo sorteo');
  if (cambios.fase && !cambios.primera && actual) {
    const li = F.items.get(actual)?.li;
    ctx.anim.animar(li, [{ transform: 'scale(0.92)', opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: ctx.anim.CURVA.acuse });
  }
}

// ============================================================ ruleta ponderada (firma)
const R_EXT = 100;
const R_INT = 70;

function punto(radio, grados) {
  const a = (grados * Math.PI) / 180;
  return [radio * Math.sin(a), -radio * Math.cos(a)];
}

function arco(a0, a1, R1 = R_EXT, R0 = R_INT) {
  const span = a1 - a0;
  if (!(span > 0.01)) return '';
  if (span >= 359.99) return arco(a0, a0 + 180, R1, R0) + arco(a0 + 180, a0 + 359.99, R1, R0);
  const g = span > 180 ? 1 : 0;
  const [x1, y1] = punto(R1, a0);
  const [x2, y2] = punto(R1, a1);
  const [x3, y3] = punto(R0, a1);
  const [x4, y4] = punto(R0, a0);
  return `M${f2(x1)} ${f2(y1)}A${R1} ${R1} 0 ${g} 1 ${f2(x2)} ${f2(y2)}L${f2(x3)} ${f2(y3)}A${R0} ${R0} 0 ${g} 0 ${f2(x4)} ${f2(y4)}Z`;
}

const anguloDe = (r, A) => ((r + 0.5) / A) * 360;

function tramosDe(intervalos, A) {
  const m = new Map();
  for (const t of intervalos) m.set(t.id, { a0: (t.desde / A) * 360, a1: (t.hasta / A) * 360 });
  return m;
}
const firmaTramos = (m) => [...m].map(([id, t]) => `${id}:${t.a0.toFixed(3)}-${t.a1.toFixed(3)}`).join(',');

function construirRuleta(ctx) {
  const { h, s, ui, icono } = ctx;
  const L = ctx.local;
  const id = (x) => `${L.uid}-${x}`;
  const R = { sectores: new Map(), tramos: new Map(), angulo: 0, token: 0, animando: false, claveGiro: undefined, claveSect: null, raf: 0, prediccion: false, giro: null };

  let d = '';
  for (let i = 0; i < 60; i += 1) {
    const largo = i % 15 === 0;
    const [x1, y1] = punto(104, i * 6);
    const [x2, y2] = punto(largo ? 112 : 107.5, i * 6);
    d += `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
  }
  R.cNum = s('text.esc-rul__c-num', { y: 3 });
  R.cEt = s('text.esc-rul__c-et', { y: -27 });
  R.cSub = s('text.esc-rul__c-sub', { y: 22 });
  R.cGan = s('text.esc-rul__c-gan', { y: 41 });
  R.capaSect = s('g.esc-rul__sectores');
  R.fantasma = s('g.esc-rul__fantasma', s('line', { x1: 0, y1: -66, x2: 0, y2: -103 }), s('path', { d: 'M0 -101 L-5.5 -113 L5.5 -113 Z' }));
  R.aguja = s('g.esc-rul__aguja',
    s('line.esc-rul__aguja-linea', { x1: 0, y1: -67, x2: 0, y2: -104 }),
    s('path.esc-rul__aguja-punta', { d: 'M0 -99 L-7.5 -118 L7.5 -118 Z' }),
    s('circle.esc-rul__aguja-base', { cy: -67, r: 2.6 }));
  R.svg = s('svg.esc-rul', { viewBox: '-125 -125 250 250', role: 'img', 'aria-label': 'Ruleta ponderada', dataset: { tipo: 'vacio', aguja: 'no' } },
    s('defs', s('pattern', { id: 'esc-trama', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect.esc-trama__fondo', { width: 5, height: 5 }), s('line.esc-trama__linea', { x1: 0.5, y1: 0, x2: 0.5, y2: 5 }))),
    s('g.esc-rul__escala', { 'aria-hidden': 'true' }, s('path', { d }), s('text.esc-rul__cero', { x: 0, y: -116 }, '0')),
    s('circle.esc-rul__pista', { r: (R_EXT + R_INT) / 2, 'aria-hidden': 'true' }),
    R.capaSect,
    R.fantasma,
    R.aguja,
    s('g.esc-rul__centro', { 'aria-hidden': 'true' }, s('circle.esc-rul__disco', { r: 63 }), R.cEt, R.cNum, R.cSub, R.cGan));
  R.fantasma.setAttribute('aria-hidden', 'true');
  R.aguja.setAttribute('aria-hidden', 'true');

  R.saltar = h('button.boton.boton--fantasma.boton--chico.esc-rul__saltar', { type: 'button', hidden: true }, icono('play'), h('span', 'Saltar animación'));
  R.saltar.addEventListener('click', () => saltarAnimacion(ctx));
  R.estado = h('p.esc-rul__estado', { 'aria-hidden': 'true' });

  // ---- datos legibles (todo lo que la ruleta dice, también en texto)
  R.semilla = h('p.esc-rul__semilla');
  R.formula = h('p.esc-rul__formula');
  R.cae = h('p.esc-rul__cae');
  R.verificar = h('button.boton.boton--secundario.boton--chico', { type: 'button' }, icono('hash'), h('span', 'Recalcular en este navegador'));
  R.verifOut = h('p.esc-rul__verif', { 'aria-live': 'polite' });
  R.verificar.addEventListener('click', () => verificarSorteo(ctx));
  R.predecir = h('button.boton.boton--secundario.boton--chico', { type: 'button', 'aria-pressed': 'false' }, icono('dado'), h('span', 'Calcular el sorteo ya'));
  R.predOut = h('p.esc-rul__verif', { 'aria-live': 'polite' });
  R.predecir.addEventListener('click', () => {
    R.prediccion = !R.prediccion;
    R.predecir.setAttribute('aria-pressed', String(R.prediccion));
    R.claveFantasma = null;
    pintarFantasma(ctx);
  });
  R.intentos = h('ol.esc-rul__intentos', { role: 'list', 'aria-label': 'Sorteos de esta ronda' });
  R.fuera = h('p.esc-rul__fuera');
  R.bloqueSorteo = h('div.esc-rul__bloque', R.semilla, R.formula, R.cae, h('div.esc-rul__verificar', R.verificar, R.verifOut));
  R.bloquePrev = h('div.esc-rul__bloque', R.prevTxt = h('p.esc-rul__prev'), h('div.esc-rul__verificar', R.predecir, R.predOut));
  R.vacio = h('p.esc-rul__vacio', 'Cuando empiece una ronda, cada institución avaladora ocupará un sector tan ancho como los créditos que apueste.');
  // leyenda: la ruleta dicha en texto (con 20 instituciones algunos sectores no caben rotulados)
  R.leyenda = h('ol.esc-ley', { role: 'list', 'aria-label': 'Sectores de la ruleta: institución, créditos apostados y probabilidad', hidden: true });

  R.chip = h('span.esc-sorteo__chip');
  R.marco = h('div.esc-rul__marco', { tabindex: '-1' }, R.svg, R.saltar);
  R.raiz = h('section.panel.esc-sorteo', { 'aria-labelledby': id('rul-t') },
    h('div.panel__cabecera', h('h2', { id: id('rul-t') }, ui.termino('sorteo_ponderado', 'Sorteo ponderado')), R.chip),
    h('div.panel__cuerpo.esc-sorteo__cuerpo',
      R.marco,
      R.estado,
      R.leyenda,
      R.vacio, R.bloquePrev, R.bloqueSorteo, R.intentos, R.fuera));
  return R;
}

/** Qué debe mostrar la ruleta para un estado. */
function modeloRuleta(e) {
  const r = e?.ronda;
  if (!r) return { tipo: 'vacio' };
  const deshonestos = new Set((e.nodos || []).filter((n) => n.deshonesto).map((n) => n.id));
  const eliminados = new Set(r.validadores.filter((v) => v.estado === 'eliminado').map((v) => v.id));
  if (r.sorteo && r.fase !== 'APUESTAS') {
    const so = r.sorteo;
    return {
      tipo: 'sorteo', ronda: r.id, intervalos: so.intervalos, A: so.A, r: so.r, ganador: so.ganador,
      castigado: eliminados.has(so.ganador) ? so.ganador : null, semilla: so.semilla,
      intento: intentoDeSemilla(so.semilla), deshonestos, eliminados, apagada: !r.activa,
      clave: `${r.id}|${so.semilla}|${so.A}`,
    };
  }
  const { intervalos, A } = intervalosDe(r.validadores.filter((v) => v.estado !== 'eliminado'));
  return { tipo: 'apuestas', ronda: r.id, intervalos, A, deshonestos, eliminados, apagada: !r.activa };
}

function asegurarSector(ctx, id) {
  const R = ctx.local.ruleta;
  let sc = R.sectores.get(id);
  if (sc) return sc;
  const { s } = ctx;
  const n = Number(String(id).slice(1)) || 0;
  const sg = siglaDe(id);
  sc = {
    path: s('path.esc-sector__arco'),
    et: s('text.esc-sector__et', { x: 0, y: 0 }, sg),
    rombo: s('path.esc-sector__rombo', { d: 'M-2.6 -2.6h5.2v5.2h-5.2z' }),
    titulo: s('title'),
    largo: sg.length,
  };
  sc.g = s('g.esc-sector', { dataset: { id, tono: String(n % 3), largo: sg.length > 4 ? 'largo' : 'corto' } }, sc.titulo, sc.path, sc.rombo, sc.et);
  R.sectores.set(id, sc);
  R.capaSect.appendChild(sc.g);
  return sc;
}

/**
 * Rótulo del sector en RADIAL (como las marcas de un dial): una sigla de 6 letras ocupa ~26 de
 * los 30 px de la banda, así que cabe en sectores de pocos grados. Se lee siempre derecha: en la
 * mitad izquierda se gira 180°. Por debajo de ~6° no cabe ni de canto: lo dice la leyenda.
 */
function colocarSector(ctx, sc, a0, a1) {
  sc.path.setAttribute('d', arco(a0, a1));
  const mid = (a0 + a1) / 2;
  const [x, y] = punto((R_EXT + R_INT) / 2, mid);
  const giro = mid <= 180 ? mid - 90 : mid + 90;
  sc.et.setAttribute('transform', `translate(${f2(x)} ${f2(y)}) rotate(${f2(giro)})`);
  const [rx, ry] = punto(R_EXT - 4.5, mid);
  sc.rombo.setAttribute('transform', `translate(${f2(rx)} ${f2(ry)}) rotate(${f2(mid + 45)})`);
  // alto del rótulo (≈ 1.1 × cuerpo) frente al ancho del sector en el radio medio
  const ancho = ((a1 - a0) * Math.PI / 180) * ((R_EXT + R_INT) / 2);
  ctx.dom.attr(sc.g, 'data-estrecho', ancho < (sc.largo > 4 ? 8.5 : 10) ? '' : null);
}

function aplicarTramos(ctx, mapa) {
  const R = ctx.local.ruleta;
  for (const [id, t] of mapa) colocarSector(ctx, asegurarSector(ctx, id), t.a0, t.a1);
  for (const [id, sc] of R.sectores) {
    if (!mapa.has(id)) { sc.g.remove(); R.sectores.delete(id); }
  }
  R.tramos = new Map(mapa);
}

/** Interpola los sectores hacia `destino` (los que salen se cierran sobre su centro). */
function transicionSectores(ctx, destino) {
  const R = ctx.local.ruleta;
  cancelAnimationFrame(R.raf);
  const origen = new Map(R.tramos);
  const final = new Map(destino);
  const hasta = new Map(destino);
  for (const [id, t] of origen) {
    if (!hasta.has(id)) { const m = (t.a0 + t.a1) / 2; hasta.set(id, { a0: m, a1: m }); }
  }
  for (const [id, t] of hasta) {
    if (!origen.has(id)) { const m = (t.a0 + t.a1) / 2; origen.set(id, { a0: m, a1: m }); }
  }
  if (ctx.anim.reducido() || !R.tramos.size) {
    aplicarTramos(ctx, final);
    if (!R.tramos.size || ctx.anim.reducido()) ctx.anim.animar(R.capaSect, [{ opacity: 0.3 }, { opacity: 1 }], { duration: 200 });
    return Promise.resolve();
  }
  return new Promise((listo) => {
    const t0 = performance.now();
    const dur = 480;
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const k = 1 - (1 - p) ** 3;
      const actual = new Map();
      for (const [id, b] of hasta) {
        const a = origen.get(id);
        actual.set(id, { a0: a.a0 + (b.a0 - a.a0) * k, a1: a.a1 + (b.a1 - a.a1) * k });
      }
      for (const [id, t2] of actual) colocarSector(ctx, asegurarSector(ctx, id), t2.a0, t2.a1);
      if (p < 1) R.raf = requestAnimationFrame(paso);
      else { aplicarTramos(ctx, final); listo(); }
    };
    R.raf = requestAnimationFrame(paso);
  });
}

/** Marca de cada sector: ganadora, castigada, deshonesta; su <title> y la leyenda en texto. */
function estadosSectores(ctx, { intervalos, A, ganador = null, castigados = new Set(), deshonestos = new Set() }) {
  const R = ctx.local.ruleta;
  const filas = [];
  for (const t of intervalos) {
    const est = castigados.has(t.id) ? 'castigado' : t.id === ganador ? 'ganador' : 'normal';
    const desh = deshonestos.has(t.id);
    const apuesta = t.hasta - t.desde;
    const txt = `${etiquetaLarga(t.id)}: apuesta ${cc(apuesta)} (${pct(apuesta / A)}), intervalo [${num(t.desde)}, ${num(t.hasta)})${est === 'castigado' ? ' · castigada' : est === 'ganador' ? ' · proponente' : ''}${desh ? ' · deshonesta' : ''}`;
    filas.push({ id: t.id, est, desh, apuesta, txt });
    const sc = R.sectores.get(t.id);
    if (!sc) continue;
    sc.g.dataset.estado = est;
    ctx.dom.attr(sc.g, 'data-deshonesto', desh ? '' : null);
    ctx.dom.texto(sc.titulo, txt);
  }
  pintarLeyenda(ctx, filas, A);
}

/** Leyenda de la ruleta: una pastilla por institución, en el mismo orden que los sectores. */
function pintarLeyenda(ctx, filas, A) {
  const { h, dom } = ctx;
  const R = ctx.local.ruleta;
  const clave = `${A}|${filas.map((f) => `${f.id}:${f.apuesta}:${f.est}:${f.desh ? 1 : 0}`).join(',')}`;
  if (R.leyenda.dataset.clave === clave) return;
  R.leyenda.dataset.clave = clave;
  R.leyenda.hidden = !filas.length;
  dom.reemplazar(R.leyenda, filas.map((f) => {
    const n = Number(String(f.id).slice(1)) || 0;
    return h('li.esc-ley__item', { dataset: { tono: String(n % 3), estado: f.est, deshonesto: f.desh ? 'si' : null }, title: f.txt },
      h('span.esc-ley__muestra', { 'aria-hidden': 'true' }),
      h('span.esc-ley__sigla', { 'aria-hidden': 'true' }, siglaDe(f.id)),
      h('span.esc-ley__pct.mono', { 'aria-hidden': 'true' }, pct(f.apuesta / A)),
      h('span.solo-lectores', f.txt));
  }));
}

function centroRuleta(ctx, { et = '', numero = '', sub = '', gan = '', estado = null }) {
  const R = ctx.local.ruleta;
  ctx.dom.texto(R.cEt, et);
  ctx.dom.texto(R.cNum, numero);
  ctx.dom.texto(R.cSub, sub);
  ctx.dom.texto(R.cGan, gan);
  ctx.dom.attr(R.cGan, 'data-estado', estado);
}

function fijarAguja(ctx, ang) {
  const R = ctx.local.ruleta;
  const n = ((ang % 360) + 360) % 360;
  R.angulo = n;
  R.aguja.style.transform = `rotate(${f2(n)}deg)`;
}

/** Gira la aguja con propósito: arranca rápido, desacelera, se pasa un poco y se asienta. */
function girarA(ctx, r, A, { duracion = 1800 } = {}) {
  const R = ctx.local.ruleta;
  const objetivo = anguloDe(r, A);
  const desde = R.angulo;
  const destino = desde + 720 + ((((objetivo - desde) % 360) + 360) % 360);
  R.svg.dataset.aguja = 'si';
  R.aguja.style.transform = `rotate(${f2(destino)}deg)`;
  R.angulo = destino;
  const normalizar = () => fijarAguja(ctx, R.angulo);
  if (ctx.anim.reducido()) {
    normalizar();
    const a = ctx.anim.animar(R.aguja, [{ opacity: 0.15 }, { opacity: 1 }], { duration: 160 });
    return a ? a.finished.catch(() => {}) : Promise.resolve();
  }
  R.svg.dataset.girando = '';
  const a = R.aguja.animate([
    { transform: `rotate(${f2(desde)}deg)`, easing: 'cubic-bezier(0.22, 0.61, 0.3, 1)' },
    { transform: `rotate(${f2(destino + 6)}deg)`, offset: 0.84, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
    { transform: `rotate(${f2(destino)}deg)` },
  ], { duration: duracion });
  R.animGiro = a;
  const fin = () => { delete R.svg.dataset.girando; normalizar(); };
  return a.finished.then(fin, fin);
}

/** El sorteo «toca» el anillo de nodos: un rayo del núcleo al proponente. */
function rayo(ctx, id, tipo = 'acento') {
  if (!ctx.activa) return;
  const p = ctx.red.posicion(id);
  const capa = ctx.red.capa();
  if (!p || !capa) return;
  if (tipo === 'rechazo') { ctx.red.destello(id, 'rechazo'); return; }
  ctx.red.resaltar(id, 2600);
  if (ctx.anim.reducido()) return;
  const linea = ctx.s('line.esc-rayo', { x1: 0, y1: 0, x2: f2(p.x), y2: f2(p.y), pathLength: '1' });
  capa.appendChild(linea);
  const a = linea.animate([
    { strokeDashoffset: 1, opacity: 1 },
    { strokeDashoffset: 0, opacity: 1, offset: 0.45 },
    { strokeDashoffset: 0, opacity: 0 },
  ], { duration: 1100, easing: ctx.anim.CURVA.firma, fill: 'both' });
  const quitar = () => linea.remove();
  a.finished.then(quitar, quitar);
}

function destelloSector(ctx, id) {
  const sc = ctx.local.ruleta.sectores.get(id);
  if (!sc) return;
  ctx.anim.animar(sc.path, [{ opacity: 0.35 }, { opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], { duration: 640, easing: 'linear' });
}

function pintarRuleta(e, ctx, cambios) {
  const R = ctx.local.ruleta;
  const m = modeloRuleta(e);
  R.modelo = m;
  R.e = e;
  pintarDatosRuleta(e, m, ctx);
  pintarFantasma(ctx);
  if (R.animando) return;               // la secuencia en curso pintará el estado final al terminar
  const primera = !!cambios.primera || R.claveGiro === undefined;
  if (m.tipo === 'sorteo' && m.clave !== R.claveGiro && !primera) {
    const previo = R.giro;
    R.claveGiro = m.clave;
    secuenciaSorteo(ctx, e, m, previo);
    return;
  }
  R.claveGiro = m.tipo === 'sorteo' ? m.clave : null;
  renderEstatico(ctx, m, { animar: !primera });
}

/** Dibuja el modelo sin girar (primer pintado, cambios de apuestas, refrescos). */
function renderEstatico(ctx, m, { animar = false } = {}) {
  const R = ctx.local.ruleta;
  R.svg.dataset.tipo = m.tipo;
  ctx.dom.attr(R.svg, 'data-apagada', m.apagada ? '' : null);
  if (m.tipo === 'vacio') {
    cancelAnimationFrame(R.raf);
    aplicarTramos(ctx, new Map());
    pintarLeyenda(ctx, [], 0);
    R.claveSect = '';
    R.svg.dataset.aguja = 'no';
    centroRuleta(ctx, { et: 'SIN RONDA', numero: '·', sub: 'inicia una ronda', gan: '' });
    ctx.dom.attr(R.svg, 'aria-label', 'Ruleta ponderada vacía: todavía no hay ronda.');
    return;
  }
  const destino = tramosDe(m.intervalos, m.A);
  const firma = firmaTramos(destino);
  if (firma !== R.claveSect) {
    R.claveSect = firma;
    if (animar) transicionSectores(ctx, destino); else { cancelAnimationFrame(R.raf); aplicarTramos(ctx, destino); }
  }
  const castigados = new Set(m.castigado ? [m.castigado] : []);
  estadosSectores(ctx, { intervalos: m.intervalos, A: m.A, ganador: m.tipo === 'sorteo' ? m.ganador : null, castigados, deshonestos: m.deshonestos });
  if (m.tipo === 'sorteo') {
    R.svg.dataset.aguja = 'si';
    fijarAguja(ctx, anguloDe(m.r, m.A));
    R.giro = { ronda: m.ronda, intento: m.intento };
    centroRuleta(ctx, { et: `SORTEO · INTENTO ${m.intento}`, numero: num(m.r), sub: `de A = ${cc(m.A)}`, gan: m.castigado ? `✗ ${siglaDe(m.ganador)}` : `→ ${siglaDe(m.ganador)}`, estado: m.castigado ? 'castigado' : 'ganador' });
    if (animar && m.castigado && R.claveCastigo !== `${m.clave}|${m.castigado}`) destelloSector(ctx, m.castigado);
    R.claveCastigo = m.castigado ? `${m.clave}|${m.castigado}` : null;
    const t = m.intervalos.find((x) => x.id === m.ganador);
    ctx.dom.attr(R.svg, 'aria-label', `Ruleta ponderada de ${plural(m.intervalos.length, 'institución avaladora', 'instituciones avaladoras')}, A = ${cc(m.A)}. r = ${m.r} cae en el intervalo [${t?.desde}, ${t?.hasta}) de ${etiquetaLarga(m.ganador)}${m.castigado ? ', que fue castigada' : ', la proponente'}.`);
  } else {
    R.svg.dataset.aguja = 'no';
    centroRuleta(ctx, { et: 'APOSTADO', numero: num(m.A), sub: `CC · ${plural(m.intervalos.length, 'institución', 'instituciones')}`, gan: m.apagada ? 'sin sorteo' : 'aún sin sortear' });
    const mayor = m.intervalos.slice().sort((a, b) => (b.hasta - b.desde) - (a.hasta - a.desde))[0];
    ctx.dom.attr(R.svg, 'aria-label', `Ruleta ponderada con las apuestas actuales: ${plural(m.intervalos.length, 'institución avaladora', 'instituciones avaladoras')}, A = ${cc(m.A)}.${mayor ? ` El sector mayor es de ${etiquetaLarga(mayor.id)} (${pct((mayor.hasta - mayor.desde) / m.A)}).` : ''}`);
  }
}

/**
 * Gira la ruleta para cada intento nuevo. En una ronda automática con rechazos, repite
 * los intentos anteriores (reconstruidos con SHA-256 en el navegador): cae en el tramposo,
 * su sector se tacha, la ruleta se cierra sin él y vuelve a girar.
 */
async function secuenciaSorteo(ctx, e, m, previo) {
  const R = ctx.local.ruleta;
  const r = e.ronda;
  const token = ++R.token;
  const final = m.intento;
  let desde = previo && previo.ronda === r.id ? previo.intento + 1 : 0;
  if (desde > final) desde = final;
  const hashAnterior = String(m.semilla).split('|')[0];
  R.animando = true;
  R.saltar.hidden = false;
  try {
    for (let i = desde; i <= final; i += 1) {
      if (token !== R.token) return;
      const paso = i === final
        ? { intervalos: m.intervalos, A: m.A, r: m.r, ganador: m.ganador }
        : await predecir(ctx, hashAnterior, r, i);
      if (token !== R.token) return;
      if (!paso) continue;
      const fuera = (r.castigos_ronda || []).filter((c) => c.intento < i).map((c) => siglaDe(c.proponente));
      ctx.dom.texto(R.estado, fuera.length ? `Intento ${i}: sorteando sin ${fuera.join(', ')}…` : `Intento ${i}: sorteando…`);
      await transicionSectores(ctx, tramosDe(paso.intervalos, paso.A));
      if (token !== R.token) return;
      estadosSectores(ctx, { intervalos: paso.intervalos, A: paso.A, deshonestos: m.deshonestos });
      centroRuleta(ctx, { et: `SORTEO · INTENTO ${i}`, numero: num(paso.r), sub: `de A = ${cc(paso.A)}`, gan: '…' });
      await girarA(ctx, paso.r, paso.A, { duracion: i < final ? 1300 : 1800 });
      if (token !== R.token) return;
      estadosSectores(ctx, { intervalos: paso.intervalos, A: paso.A, ganador: paso.ganador, deshonestos: m.deshonestos });
      centroRuleta(ctx, { et: `SORTEO · INTENTO ${i}`, numero: num(paso.r), sub: `de A = ${cc(paso.A)}`, gan: `→ ${siglaDe(paso.ganador)}`, estado: 'ganador' });
      destelloSector(ctx, paso.ganador);
      rayo(ctx, paso.ganador);
      R.giro = { ronda: r.id, intento: i };
      if (i < final) {
        await espera(ctx.anim.reducido() ? 250 : 700);
        if (token !== R.token) return;
        estadosSectores(ctx, { intervalos: paso.intervalos, A: paso.A, ganador: paso.ganador, castigados: new Set([paso.ganador]), deshonestos: m.deshonestos });
        centroRuleta(ctx, { et: `SORTEO · INTENTO ${i}`, numero: num(paso.r), sub: `de A = ${cc(paso.A)}`, gan: `✗ ${siglaDe(paso.ganador)}`, estado: 'castigado' });
        ctx.dom.texto(R.estado, `${etiqueta(paso.ganador)} intentó avalar un registro fraudulento: castigada y fuera de la ruleta.`);
        rayo(ctx, paso.ganador, 'rechazo');
        destelloSector(ctx, paso.ganador);
        await espera(ctx.anim.reducido() ? 300 : 900);
      }
    }
  } finally {
    if (token === R.token) {
      R.animando = false;
      R.saltar.hidden = true;
      ctx.dom.texto(R.estado, '');
      const nuevo = R.modelo;
      if (nuevo?.tipo === 'sorteo' && nuevo.clave !== m.clave && R.e?.ronda) {
        // llegó otro sorteo mientras giraba (p. ej. otra pestaña avanzó): se encadena
        R.claveGiro = nuevo.clave;
        secuenciaSorteo(ctx, R.e, nuevo, R.giro);
      } else {
        R.claveSect = null;
        R.claveCastigo = nuevo?.castigado ? `${nuevo.clave}|${nuevo.castigado}` : null;
        if (nuevo) renderEstatico(ctx, nuevo, { animar: false });
        R.claveGiro = nuevo?.tipo === 'sorteo' ? nuevo.clave : null;
      }
    }
  }
}

function saltarAnimacion(ctx) {
  const R = ctx.local.ruleta;
  if (!R?.animando) return;
  const teniaFoco = document.activeElement === R.saltar;
  R.token += 1;
  cancelAnimationFrame(R.raf);
  R.animGiro?.cancel();
  R.animando = false;
  R.saltar.hidden = true;
  ctx.dom.texto(R.estado, '');
  delete R.svg.dataset.girando;
  R.claveSect = null;
  if (R.modelo) renderEstatico(ctx, R.modelo, { animar: false });
  R.claveGiro = R.modelo?.tipo === 'sorteo' ? R.modelo.clave : null;
  if (teniaFoco) R.marco.focus({ preventScroll: true });   // el botón desaparece: el foco no se pierde
}

/** Aguja «fantasma»: dónde caería el sorteo si se cerraran las apuestas ahora (APUESTAS). */
async function pintarFantasma(ctx) {
  const R = ctx.local.ruleta;
  const e = R.e;
  const m = R.modelo;
  const r = e?.ronda;
  const activa = R.prediccion && m?.tipo === 'apuestas' && r?.activa && r.fase === 'APUESTAS';
  R.bloquePrev.hidden = !(m?.tipo === 'apuestas' && r?.activa);
  if (!activa) {
    R.svg.dataset.fantasma = 'no';
    if (!R.prediccion) ctx.dom.reemplazar(R.predOut);
    return;
  }
  const clave = `${e.cabeza?.hash}|${r.numero_bloque}|${firmaTramos(tramosDe(m.intervalos, m.A))}`;
  if (clave === R.claveFantasma) return;
  R.claveFantasma = clave;
  const p = await predecir(ctx, e.cabeza?.hash, r, 0);
  if (clave !== R.claveFantasma) return;
  if (!p) {
    ctx.dom.reemplazar(R.predOut, 'Tu navegador no permite calcular SHA-256 aquí (hace falta localhost o https).');
    return;
  }
  R.svg.dataset.fantasma = 'si';
  R.fantasma.style.transform = `rotate(${f2(anguloDe(p.r, p.A))}deg)`;
  const t = p.intervalos.find((x) => x.id === p.ganador);
  ctx.dom.reemplazar(R.predOut,
    'Si se cerraran ahora: r = SHA-256(', ctx.h('code', `…|${r.numero_bloque}|0`), `) mod ${num(p.A)} = `, ctx.h('strong.mono', num(p.r)),
    ` → cae en [${num(t.desde)}, ${num(t.hasta)}) de `, ctx.h('strong', { title: nombreInst(p.ganador) }, etiqueta(p.ganador)),
    '. Cambia una apuesta y verás que puede caer en otra institución: por eso se cierran antes de sortear.');
}

function pintarDatosRuleta(e, m, ctx) {
  const { h, ui, dom } = ctx;
  const R = ctx.local.ruleta;
  const r = e.ronda;
  R.vacio.hidden = m.tipo !== 'vacio';
  R.bloqueSorteo.hidden = m.tipo !== 'sorteo';
  const clave = m.tipo === 'sorteo' ? `${m.clave}|${m.castigado}|${r.fase}` : m.tipo === 'apuestas' ? `ap|${r.id}|${m.A}|${m.intervalos.length}|${r.numero_bloque}|${e.cabeza?.hash}` : 'vacio';
  if (R.datosClave === clave) return;
  const cambioSorteo = R.datosSorteo !== m.clave;
  R.datosClave = clave;
  R.datosSorteo = m.clave;
  dom.reemplazar(R.chip, m.tipo === 'sorteo' ? ui.chip(`intento ${m.intento}`, m.castigado ? 'rechazado' : 'acento', { sinPunto: true }) : m.tipo === 'apuestas' ? ui.chip(`A = ${cc(m.A)}`, 'neutro', { sinPunto: true }) : null);

  if (m.tipo === 'apuestas') {
    dom.reemplazar(R.prevTxt,
      'Cada sector mide los créditos que apuesta cada institución: con A = ', h('strong.mono', cc(m.A)),
      ' apostados, la que pone el doble ocupa el doble. Al cerrar las apuestas se sorteará con la ', ui.termino('semilla_sorteo', 'semilla pública'),
      ' ', h('code.esc-rul__sem-corta', `${ctx.fmt.hashCorto(e.cabeza?.hash, 4)}|${r.numero_bloque}|0`), '.');
  }
  if (m.tipo === 'sorteo') {
    const [hashAnt, nb, it] = String(m.semilla).split('|');
    const copiar = h('button.hash.esc-rul__copiar', { type: 'button', dataset: { copiar: m.semilla }, title: `Semilla completa: ${m.semilla} (clic para copiar)`, 'aria-label': 'Copiar la semilla completa' },
      h('span.hash__texto', h('span.esc-rul__sem-hash', ctx.fmt.hashCorto(hashAnt, 6)), h('span.esc-rul__sem-sep', '|'), nb, h('span.esc-rul__sem-sep', '|'), h('span.esc-rul__sem-int', it)),
      ctx.icono('copiar', { clase: 'hash__icono' }));
    dom.reemplazar(R.semilla,
      h('span.etiqueta-instrumento', ui.termino('semilla_sorteo', 'Semilla pública')), ' ', copiar,
      h('span.esc-rul__sem-leyenda', 'huella del folio anterior | folio que se decide | intento'));
    dom.reemplazar(R.formula,
      h('span.mono', 'r = SHA-256(semilla) mod A = '), h('strong.mono.esc-rul__r', num(m.r)),
      h('span.texto-3', ` · A = ${cc(m.A)}, los créditos apostados por ${plural(m.intervalos.length, 'institución', 'instituciones')} en la ruleta`));
    const t = m.intervalos.find((x) => x.id === m.ganador);
    const v = r.validadores.find((x) => x.id === m.ganador);
    dom.reemplazar(R.cae,
      h('strong.mono', num(m.r)), ' cae en ', h('span.mono', `[${num(t?.desde)}, ${num(t?.hasta)})`), ', el intervalo de ', h('strong', { title: nombreInst(m.ganador) }, etiqueta(m.ganador)),
      v ? ` (apostó ${cc(v.apuesta)}: ${pct(v.apuesta / m.A)} de probabilidad)` : '',
      m.castigado ? h('span.esc-rul__cae-mal', ` → intentó avalar un registro fraudulento y fue castigada.${r.activa ? ' Al avanzar se sortea de nuevo sin ella.' : ''}`) : ` → ${siglaDe(m.ganador)} es la proponente.`);
    if (cambioSorteo) dom.reemplazar(R.verifOut, h('span.texto-3', 'Cualquiera puede comprobarlo: no hace falta fiarse del servidor.'));
  }

  // historia de sorteos de la ronda
  const items = [];
  if (r) {
    for (const c of r.castigos_ronda || []) items.push({ intento: c.intento, id: c.proponente, mal: true, monto: c.monto });
    if (m.tipo === 'sorteo' && !items.some((x) => x.intento === m.intento)) items.push({ intento: m.intento, id: m.ganador, mal: false });
  }
  items.sort((a, b) => a.intento - b.intento);
  R.intentos.hidden = items.length < 2 && !items.some((x) => x.mal);
  dom.reemplazar(R.intentos, items.map((x) => h('li.esc-rul__intento', { dataset: { mal: x.mal ? 'si' : 'no' }, title: etiquetaLarga(x.id) },
    h('span.texto-3', `intento ${x.intento}`), ' → ', h('strong', siglaDe(x.id)), x.mal ? h('span.esc-rul__quemado', ` castigada −${cc(x.monto)}`) : h('span.texto-3', r.activa ? ' propone' : ''))));
  const fuera = r ? r.validadores.filter((v) => v.estado === 'eliminado' && !(m.intervalos || []).some((t) => t.id === v.id)) : [];
  R.fuera.hidden = !fuera.length;
  dom.reemplazar(R.fuera, fuera.length ? ['Fuera de la ruleta: ', fuera.map((v, i) => [i ? ', ' : '', h('s', { title: etiquetaLarga(v.id) }, siglaDe(v.id)), ` (−${cc(v.castigo)})`])] : null);
}

async function verificarSorteo(ctx) {
  const { h, dom } = ctx;
  const R = ctx.local.ruleta;
  const m = R.modelo;
  if (m?.tipo !== 'sorteo') return;
  const x = await ctx.ui.ocupado(R.verificar, rDeSemilla(ctx.fmt, m.semilla, m.A));
  if (!x) { dom.reemplazar(R.verifOut, 'Tu navegador no permite calcular SHA-256 aquí (hace falta localhost o https).'); return; }
  const ok = x.r === m.r;
  dom.reemplazar(R.verifOut,
    h('span.mono.esc-rul__hex', `SHA-256 = ${x.hex.slice(0, 16)}…${x.hex.slice(-6)}`), h('br'),
    h('span.mono', `→ como número, mod ${num(m.A)} = `), h('strong.mono', num(x.r)), ' ',
    ok ? h('span.esc-rul__ok', ctx.icono('ok'), ' coincide con el servidor: el sorteo es reproducible.') : h('span.esc-rul__cae-mal', 'no coincide.'));
  ctx.anim.entrar(R.verifOut);
}

// ============================================================= bloque y votación
function construirBloque(ctx) {
  const { h } = ctx;
  const L = ctx.local;
  const id = (x) => `${L.uid}-${x}`;
  const B = {};
  B.resultado = h('div.esc-bloque__resultado');
  B.cand = h('div.esc-bloque__cand');
  B.votos = construirVotos(ctx);
  B.castigo = construirCastigo(ctx);
  B.prueba = construirPruebaVoto(ctx);
  B.raiz = h('section.panel.esc-bloque', { 'aria-labelledby': id('blq-t') },
    h('div.panel__cabecera', h('h2', { id: id('blq-t') }, 'Folio candidato y aval'), B.chip = h('span.esc-bloque__chip')),
    h('div.panel__cuerpo.esc-bloque__cuerpo', B.resultado, B.cand, B.votos.raiz, B.castigo.raiz, B.prueba.raiz, construirDosTercios(ctx)));
  return B;
}

function pintarBloque(e, ctx, cambios) {
  const B = ctx.local.bloque;
  const r = e.ronda;
  const clave = r ? `${r.fase}|${r.candidato?.valido}` : '';
  if (B.chip.dataset.clave !== clave) {
    B.chip.dataset.clave = clave;
    ctx.dom.reemplazar(B.chip, !r?.candidato ? null
      : r.fase === 'ACEPTADO' ? ctx.ui.chip('aceptado', 'valido')
        : r.fase === 'RECHAZADO' ? ctx.ui.chip('rechazado', 'rechazado')
          : ctx.ui.chip(r.candidato.valido ? 'en revisión' : 'en revisión · inválido', r.candidato.valido ? 'pendiente' : 'advertencia'));
  }
  pintarResultado(e, ctx, cambios);
  pintarCandidato(e, ctx, cambios);
  pintarVotos(e, ctx, cambios);
  pintarCastigos(e, ctx, cambios);
  pintarPruebaVoto(e, ctx);
}

function botonNodo(ctx, id) {
  return marcaInst(id, { tag: 'button', clase: 'esc-nodo', props: { type: 'button', 'aria-label': `${etiquetaLarga(id)}: abrir su ficha`, on: { click: () => ctx.abrirNodo(id) } } });
}

function dato(ctx, et, valor, nota = null) {
  const { h } = ctx;
  return h('div.esc-dato', h('dt', et), h('dd', valor, nota ? h('small.esc-dato__nota', nota) : null));
}

// ---------------------------------------------------------------- resultado
function pintarResultado(e, ctx, cambios) {
  const { h, ui, icono } = ctx;
  const B = ctx.local.bloque;
  const r = e.ronda;
  const s0 = e.sincronia || {};
  const terminal = r && !r.activa;
  const clave = terminal ? `${r.id}|${r.fase}|${s0.sincronizados}/${s0.total}|${e.pendientes_total}|${e.totales.castigos_pendientes}` : '';
  if (B.resultado.dataset.clave === clave) return;
  const nuevo = (B.resultado.dataset.ronda || '') !== `${r?.id}|${r?.fase}`;
  B.resultado.dataset.clave = clave;
  B.resultado.dataset.ronda = `${r?.id}|${r?.fase}`;
  if (!terminal) { ctx.dom.reemplazar(B.resultado); return; }
  let el;
  if (r.fase === 'ACEPTADO') {
    const res = r.resultado;
    const v = r.votacion || { V_si: 0, A: 1 };
    el = h('div.esc-resultado', { dataset: { estado: 'aceptado' } },
      h('div.esc-resultado__cab',
        h('span.esc-resultado__icono', { 'aria-hidden': 'true' }, icono('ok')),
        h('div',
          h('p.etiqueta-instrumento', `Ronda #${r.id} · ${r.intento ? `tras ${plural(r.intento, 'rechazo', 'rechazos')}` : 'a la primera'}`),
          h('h3.esc-resultado__titulo', `Folio #${res.bloque} avalado`))),
      h('dl.esc-resultado__datos',
        dato(ctx, 'Proponente', botonNodo(ctx, res.proponente), nombreInst(res.proponente)),
        dato(ctx, 'Huella', ui.hash(res.hash, { etiqueta: `Huella del folio #${res.bloque}` })),
        dato(ctx, 'Votos a favor', `${cc(v.V_si)} de ${cc(v.A)}`, `${pct(v.V_si / v.A)} ≥ 2/3`),
        dato(ctx, 'Créditos ganados', `+${cc(e.parametros.recompensa)}`, `por sellar el folio, pagados al instante a ${siglaDe(res.proponente)}: PoS usa 0 confirmaciones`),
        dato(ctx, 'Instituciones al día', `${s0.sincronizados}/${s0.total}`, s0.sincronizados === s0.total ? 'todas las copias tienen el folio' : 'hay instituciones atrasadas'),
        r.castigos_ronda.length ? dato(ctx, 'Castigos registrados', r.castigos_ronda.map((c) => `${siglaDe(c.proponente)} −${cc(c.monto)}`).join(', '), 'créditos anulados en este folio') : null),
      h('div.grupo',
        h('button.boton.boton--secundario.boton--chico', { type: 'button', on: { click: () => ctx.navegar('cadena') } }, icono('cadena'), h('span', 'Ver el folio en el libro de registros'))));
  } else {
    const cancelada = /^Cancelada/.test(r.resultado?.motivo || '');
    el = h('div.esc-resultado', { dataset: { estado: 'abortada' } },
      h('div.esc-resultado__cab',
        h('span.esc-resultado__icono', { 'aria-hidden': 'true' }, icono('alerta')),
        h('div',
          h('p.etiqueta-instrumento', `Ronda #${r.id}`),
          h('h3.esc-resultado__titulo', cancelada ? 'Ronda cancelada' : 'Ronda abortada: sin folio'))),
      h('p.mensaje-servidor', conInstituciones(r.resultado?.motivo || '')),
      h('ul.esc-resultado__lista', { role: 'list' },
        h('li', icono('ok'), h('span', h('strong', 'Apuestas liberadas: '), 'cada institución recupera los créditos que apostó (salvo lo castigado).')),
        h('li', icono('ok'), h('span', h('strong', 'Registros intactos: '), `${e.pendientes_total === 1 ? 'sigue 1 registro de credencial' : `siguen ${e.pendientes_total} registros de credencial`} en espera.`)),
        h('li', icono(r.castigos_ronda.length ? 'fuego' : 'ok'), h('span', h('strong', 'Castigos arrastrados: '),
          r.castigos_ronda.length
            ? `${r.castigos_ronda.map((c) => `${siglaDe(c.proponente)} −${cc(c.monto)}`).join(', ')}. Esos créditos ya no se pueden gastar y se anularán en el próximo folio aceptado (castigos pendientes: ${cc(e.totales.castigos_pendientes)}).`
            : 'no hubo castigos en esta ronda.'))));
  }
  ctx.dom.reemplazar(B.resultado, el);
  if (nuevo && !cambios.primera) ctx.anim.animar(el, [{ opacity: 0, transform: 'translateY(8px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: ctx.anim.DUR.escena, easing: ctx.anim.CURVA.firma });
}

// ---------------------------------------------------------------- candidato
function pintarCandidato(e, ctx, cambios) {
  const { h, ui, icono } = ctx;
  const B = ctx.local.bloque;
  const r = e.ronda;
  const c = r?.candidato;
  const n = r ? e.nodos.find((x) => x.id === r.proponente) : null;
  const clave = c ? `c|${r.id}|${r.intento}|${c.hash_candidato}|${r.fase}` : `v|${r?.id}|${r?.fase}|${r?.proponente}|${e.pendientes.map((p) => p.id).slice(0, 8).join(',')}|${e.pendientes_total}|${n?.deshonesto}`;
  if (B.cand.dataset.clave === clave) return;
  const antes = B.cand.dataset.clave || '';
  B.cand.dataset.clave = clave;
  const maxTx = e.parametros.max_tx_bloque || 8;

  if (!c) {
    if (r && !r.activa && r.fase === 'ACEPTADO') { ctx.dom.reemplazar(B.cand); return; }
    const lista = e.pendientes.slice(0, maxTx);
    let frase;
    if (!r || !r.activa) frase = 'El folio candidato aparecerá cuando el sorteo elija a una institución proponente.';
    else if (r.fase === 'SORTEO') frase = `${etiqueta(r.proponente)} salió sorteada: al avanzar armará el folio con los registros pendientes y lo firmará.${n?.deshonesto ? ` Ojo: ${siglaDe(r.proponente)} es una institución deshonesta (${TRAMPA[n.trampa] || 'firma alterada'}).` : ''}`;
    else frase = 'Primero se cierran las apuestas y se sortea qué institución lo propone.';
    ctx.dom.reemplazar(B.cand, h('div.esc-cand.esc-cand--vacio',
      h('p.esc-cand__frase', frase),
      lista.length
        ? h('div.esc-cand__prev',
          h('p.etiqueta-instrumento', `Entrarían ${lista.length} de ${plural(e.pendientes_total, 'registro pendiente', 'registros pendientes')}`),
          h('ol.esc-txs', { role: 'list' }, lista.map((p) => filaTx(ctx, p.tx))))
        : h('p.texto-3', 'No hay registros de credencial pendientes.')));
    return;
  }

  const trampaTx = c.trampa === 'gasto' ? c.transacciones.length - 1 : c.trampa === 'firma' ? 0 : -1;
  const veredicto = r.fase === 'RECHAZADO' ? 'rechazado' : r.fase === 'ACEPTADO' ? 'aceptado' : null;
  const card = h('article.esc-cand', { dataset: { valido: c.valido ? 'si' : 'no', veredicto: veredicto || 'ninguno' }, 'aria-label': `Folio candidato #${r.numero_bloque} de ${etiquetaLarga(c.proponente)}` },
    h('header.esc-cand__cab',
      h('span.esc-cand__icono', { 'aria-hidden': 'true' }, icono('bloque')),
      h('div', h('p.etiqueta-instrumento', `Folio candidato · intento ${r.intento}`), h('h3.esc-cand__titulo', `#${r.numero_bloque} de ${siglaDe(c.proponente)}`)),
      veredicto
        ? h('p.esc-sello', { dataset: { tipo: veredicto } }, veredicto === 'rechazado' ? 'Rechazado' : 'Avalado')
        : h('span.esc-cand__revision', ui.chip(c.valido ? 'revisión: válido' : 'revisión: fraudulento', c.valido ? 'valido' : 'rechazado'))),
    h('dl.esc-cand__datos',
      dato(ctx, 'Proponente', [botonNodo(ctx, c.proponente), n?.deshonesto ? ui.chip(`deshonesta · ${TRAMPA[n.trampa] || 'firma alterada'}`, 'rechazado') : null], nombreInst(c.proponente)),
      dato(ctx, 'Registros', String(c.tx_ids.length), `de ${plural(e.pendientes_total + (r.fase === 'ACEPTADO' ? c.tx_ids.length : 0), 'pendiente', 'pendientes')}`),
      dato(ctx, 'Hash candidato', ui.hash(c.hash_candidato, { n: 6, etiqueta: 'Hash del folio candidato' })),
      dato(ctx, ui.termino('firma', 'Firma'), `Ed25519 de ${siglaDe(c.proponente)}`, 'sobre el hash candidato: también es su voto a favor')),
    !c.valido ? h('div.esc-cand__problemas', { role: 'note' },
      h('p', ctx.icono('alerta'), h('strong', ' Lo que encuentra cada institución avaladora al revisarlo: '), h('span.mensaje-servidor', conInstituciones(c.motivo || 'el folio no es válido.'))),
      c.problemas?.length > 1 ? h('ul', c.problemas.slice(1).map((p) => h('li.mensaje-servidor', conInstituciones(p.mensaje)))) : null,
      c.trampa && EXPLICA_TRAMPA[c.trampa] ? h('p.esc-cand__trampa', h('strong', `Registro fraudulento «${TRAMPA[c.trampa]}»: `), EXPLICA_TRAMPA[c.trampa](etiqueta(c.proponente))) : null) : null,
    h('details.esc-cand__txs', { open: c.transacciones.length <= 4 },
      h('summary', `Sus ${plural(c.transacciones.length, 'registro de credencial', 'registros de credencial')}`),
      h('ol.esc-txs', { role: 'list' }, c.transacciones.map((tx, i) => filaTx(ctx, tx, i === trampaTx ? c.trampa : null)))));
  ctx.dom.reemplazar(B.cand, card);
  if (cambios.primera) return;
  const eraEste = antes.startsWith(`c|${r.id}|${r.intento}|${c.hash_candidato}|`);
  if (!eraEste) ctx.anim.entrar(card, { distancia: 10 });
  else if (veredicto === 'rechazado') {
    ctx.anim.sacudir(card);
    const sello = card.querySelector('.esc-sello');
    ctx.anim.animar(sello, [{ opacity: 0, transform: 'rotate(-8deg) scale(1.6)' }, { opacity: 1, transform: 'rotate(-8deg) scale(1)' }], { duration: 380, easing: ctx.anim.CURVA.acuse });
  } else if (veredicto === 'aceptado') {
    const sello = card.querySelector('.esc-sello');
    ctx.anim.animar(sello, [{ opacity: 0, transform: 'rotate(-8deg) scale(1.4)' }, { opacity: 1, transform: 'rotate(-8deg) scale(1)' }], { duration: 380, easing: ctx.anim.CURVA.acuse });
  }
}

function filaTx(ctx, tx, trampa = null) {
  const { h, icono } = ctx;
  return h('li.esc-tx', { dataset: { trampa: trampa || null }, title: `${etiquetaLarga(tx.emisor)} paga ${cc(tx.monto)} a ${etiquetaLarga(tx.receptor)} para que avale una credencial` },
    h('span.esc-tx__ruta', marcaInst(tx.emisor), icono('flecha'), marcaInst(tx.receptor)),
    h('span.esc-tx__monto.mono', cc(tx.monto)),
    trampa ? h('span.esc-tx__trampa', icono('grieta'), trampa === 'gasto' ? ' paga con créditos que no tiene' : ' firma alterada: registro fraudulento') : null);
}

// ---------------------------------------------------------------- votación
function construirVotos(ctx) {
  const { h, ui } = ctx;
  const V = { segs: new Map() };
  const lect = (et, cls) => { const v = h(`dd.lectura__valor.${cls}`); return [h('div.lectura', h('dt.lectura__etiqueta', et), v), v]; };
  const [lSi, vSi] = lect('A favor (V)', 'esc-votos__si');
  const [lNo, vNo] = lect('En contra', 'esc-votos__no');
  const [lSin, vSin] = lect('Sin votar', 'esc-votos__sin');
  const [lA, vA] = lect('Apostado (A)', 'esc-votos__a');
  Object.assign(V, { vSi, vNo, vSin, vA });
  V.marca = h('span.esc-votos__marca', { 'aria-hidden': 'true' }, h('span.esc-votos__marca-et', '2/3'));
  V.barra = h('div.esc-votos__barra', { role: 'img', 'aria-label': 'Votos ponderados por créditos apostados' });
  V.ecuacion = h('p.esc-votos__ecuacion');
  V.veredicto = h('p.esc-votos__veredicto');
  V.prevision = h('p.esc-votos__prevision');
  V.estado = h('span');
  V.raiz = h('div.esc-votos', { hidden: true },
    h('div.esc-votos__cab', h('h3', ui.termino('quorum', 'Votación ponderada'), h('span.esc-votos__unidad', ' · cada voto pesa los créditos (CC) que apostó su institución')), V.estado),
    h('dl.esc-votos__cifras', lSi, lNo, lSin, lA),
    h('div.esc-votos__pista', V.barra, V.marca, h('div.esc-votos__escala', { 'aria-hidden': 'true' }, h('span', '0'), h('span.esc-votos__dos', '⅔ A'), h('span', 'A'))),
    V.ecuacion, V.veredicto, V.prevision);
  return V;
}

function pintarVotos(e, ctx, cambios) {
  const { h, dom, ui } = ctx;
  const V = ctx.local.bloque.votos;
  const r = e.ronda;
  const visible = !!(r?.candidato && ['VOTACION', 'ACEPTADO', 'RECHAZADO'].includes(r.fase)) || !!(r && r.fase === 'ABORTADA' && r.validadores.some((v) => v.voto !== null));
  V.raiz.hidden = !visible;
  if (!visible) return;
  // quienes votaron ESTE candidato: los que siguen en la ronda y, si acaba de ser rechazado,
  // también su proponente (su voto a favor contó en el recuento antes de ser castigado)
  const activos = r.validadores.filter((v) => v.estado !== 'eliminado' || (r.fase === 'RECHAZADO' && v.id === r.proponente));
  const A = r.votacion?.A ?? suma(activos);
  const si = activos.filter((v) => v.voto === true).sort((a, b) => (a.id === r.proponente ? -1 : b.id === r.proponente ? 1 : porId(a, b)));
  const sin = activos.filter((v) => v.voto === null);
  const no = activos.filter((v) => v.voto === false);
  const Vsi = r.votacion?.V_si ?? suma(si);
  const Vno = suma(no);
  const Vsin = suma(sin);
  // segmentos: a favor | sin votar | en contra (cada voto con su peso)
  let acum = 0;
  const vistos = new Set();
  const orden = [...si.map((v) => [v, 'si']), ...sin.map((v) => [v, 'sin']), ...no.map((v) => [v, 'no'])];
  orden.forEach(([v, tipo], i) => {
    let sg = V.segs.get(v.id);
    if (!sg) {
      sg = { seg: h('span.esc-votos__seg', { title: etiquetaLarga(v.id) }), et: h('span.esc-votos__et', { 'aria-hidden': 'true' }, siglaDe(v.id)) };
      V.barra.append(sg.seg, sg.et);
      V.segs.set(v.id, sg);
    }
    vistos.add(v.id);
    const peso = A ? v.apuesta / A : 0;
    const desde = A ? acum / A : 0;
    acum += v.apuesta;
    sg.seg.dataset.voto = tipo;
    sg.seg.dataset.alt = String(i % 2);
    dom.cssVar(sg.seg, '--desde', desde.toFixed(5));
    dom.cssVar(sg.seg, '--peso', peso.toFixed(5));
    dom.cssVar(sg.et, '--centro', (desde + peso / 2).toFixed(5));
    sg.et.dataset.voto = tipo;
    // la sigla solo se rotula si cabe en su tramo (6 letras piden más ancho que «UV»)
    dom.attr(sg.et, 'data-visible', peso >= (siglaDe(v.id).length > 4 ? 0.1 : 0.07) ? '' : null);
  });
  for (const [id, sg] of V.segs) if (!vistos.has(id)) { sg.seg.remove(); sg.et.remove(); V.segs.delete(id); }

  dom.texto(V.vSi, num(Vsi));
  dom.texto(V.vNo, num(Vno));
  dom.texto(V.vSin, num(Vsin));
  dom.texto(V.vA, num(A));
  const necesario = Math.ceil((2 * A) / 3);
  const cumple = 3 * Vsi >= 2 * A;
  dom.attr(V.barra, 'aria-label', `Votos ponderados por créditos: ${cc(Vsi)} a favor (${si.map((x) => siglaDe(x.id)).join(', ') || 'ninguna'}), ${cc(Vno)} en contra (${no.map((x) => siglaDe(x.id)).join(', ') || 'ninguna'}) y ${cc(Vsin)} sin votar, de A = ${cc(A)}. Hacen falta ${cc(necesario)} a favor (2/3).`);
  dom.reemplazar(V.ecuacion,
    h('span.esc-votos__regla', '3V ≥ 2A'), h('span.esc-votos__flecha', ' → '),
    h('span.mono', `3 × ${num(Vsi)} = ${num(3 * Vsi)} `), h('strong.mono', { dataset: { cumple: cumple ? 'si' : 'no' } }, cumple ? '≥' : '<'), h('span.mono', ` ${num(2 * A)} = 2 × ${num(A)}`));
  const claveEst = `${r.fase}|${cumple}`;
  if (V.estado.dataset.clave !== claveEst) {
    V.estado.dataset.clave = claveEst;
    dom.reemplazar(V.estado, r.fase === 'VOTACION' ? ui.chip(cumple ? 'ya llega a 2/3' : `faltan ${cc(necesario - Vsi)}`, cumple ? 'valido' : 'pendiente')
      : ui.chip(r.votacion?.cumple ? 'cumple 2/3' : 'no llega a 2/3', r.votacion?.cumple ? 'valido' : 'rechazado'));
  }
  let ver;
  let prev = '';
  if (r.fase === 'VOTACION') {
    ver = cumple ? `Ya hay ${cc(Vsi)} a favor de ${cc(necesario)} necesarios: aunque el resto vote en contra, el recuento lo avalará (si el folio es válido).`
      : `Hacen falta ${cc(necesario)} a favor (⌈2A/3⌉); faltan ${cc(necesario - Vsi)}.`;
    const deshon = new Set(e.nodos.filter((x) => x.deshonesto).map((x) => x.id));
    const honestos = sin.filter((v) => !deshon.has(v.id));
    const tramposos = sin.filter((v) => deshon.has(v.id));
    if (sin.length) {
      prev = `Al escrutar votarán solas: ${honestos.length ? `${plural(honestos.length, 'institución honesta', 'instituciones honestas')} ${r.candidato.valido ? 'a favor (el folio es válido)' : 'en contra (hay un registro fraudulento)'}` : ''}${honestos.length && tramposos.length ? ' y ' : ''}${tramposos.length ? `${plural(tramposos.length, 'deshonesta', 'deshonestas')} a favor sin revisar` : ''}.`;
    }
  } else if (r.fase === 'ACEPTADO') {
    ver = `Cumple: ${cc(Vsi)} de ${cc(A)} es al menos 2/3. Folio avalado.`;
  } else if (r.fase === 'RECHAZADO' || r.fase === 'ABORTADA') {
    const ultimo = r.castigos_ronda.at(-1);
    ver = r.votacion?.cumple
      ? `Llegó a 2/3 (las deshonestas avalaron sin revisar), pero cada institución valida el folio final antes de aceptarlo: ${conInstituciones(ultimo?.motivo?.replace(/^votos suficientes \([^)]*\) pero /, '') || 'tenía un registro fraudulento')}. Rechazado igualmente.`
      : `No llega a 2/3: ${cc(Vsi)} a favor de ${cc(necesario)} necesarios. Folio rechazado.`;
  }
  dom.texto(V.veredicto, ver || '');
  V.veredicto.dataset.tipo = r.fase === 'ACEPTADO' ? 'ok' : r.fase === 'VOTACION' ? (cumple ? 'ok' : 'espera') : 'mal';
  dom.texto(V.prevision, prev);
  V.prevision.hidden = !prev;
  if (cambios.fase?.despues === 'VOTACION' && !cambios.primera) ctx.anim.entrar(V.raiz);
}

/** «Exactamente 2/3 se acepta; un peso menos, no» con A = 30. */
function construirDosTercios(ctx) {
  const { h, ui } = ctx;
  const ejemplo = (v, ok) => h('div.esc-ej',
    h('div.esc-ej__barra', { 'aria-hidden': 'true' }, h('span.esc-ej__si', { style: { '--peso': (v / 30).toFixed(4) } }), h('span.esc-ej__marca')),
    h('p.mono.esc-ej__cuenta', `V = ${v}: 3 × ${v} = ${3 * v} ${ok ? '≥' : '<'} 60 = 2 × 30`),
    ui.chip(ok ? 'se avala' : 'se rechaza', ok ? 'valido' : 'rechazado'));
  return h('details.detalles.esc-dos-tercios',
    h('summary', 'Exactamente 2/3 se avala; un crédito menos, no'),
    h('div.esc-dos-tercios__cuerpo',
      h('p', 'Con A = 30 créditos apostados, la marca de 2/3 está en 20:'),
      ejemplo(20, true), ejemplo(19, false),
      h('p.texto-3', 'Por eso se compara 3V con 2A en números enteros: 20/30 = 0,666… nunca se redondea, y nadie discute si «casi» llegó.')));
}

// ---------------------------------------------------------------- castigo
function construirCastigo(ctx) {
  const { h, ui, icono } = ctx;
  const C = {};
  C.regla = h('p.esc-castigo__regla');
  C.lista = h('ol.esc-castigo__lista', { role: 'list' });
  C.totales = h('p.esc-castigo__totales');
  C.raiz = h('div.esc-castigos', { hidden: true },
    h('div.esc-castigos__cab', h('h3', icono('fuego'), ' ', ui.termino('castigo', 'Castigo'), ' a la institución deshonesta')),
    C.regla, C.lista, C.totales,
    h('p.esc-castigo__nota', 'El castigo se descuenta ya de los créditos que puede gastar y se ', ui.termino('quemar', 'anula'),
      ' de verdad al registrarse en el siguiente folio aceptado. Las demás instituciones avaladoras no pierden nada.'));
  return C;
}

function pintarCastigos(e, ctx, cambios) {
  const { h, dom, icono } = ctx;
  const C = ctx.local.bloque.castigo;
  const r = e.ronda;
  const lista = r?.castigos_ronda || [];
  C.raiz.hidden = !lista.length;
  if (!lista.length) { dom.reemplazar(C.lista); C.lista.dataset.clave = ''; C.lista.dataset.n = '0'; return; }
  const p = e.parametros.castigo || { regla: 'A', alfa_pm: 500 };
  const clave = `${r.id}|${lista.length}|${r.fase}|${e.totales.quemado}|${e.totales.castigos_pendientes}`;
  if (C.lista.dataset.clave === clave) return;
  const mismaRonda = C.lista.dataset.ronda === String(r.id);
  const previos = mismaRonda ? Number(C.lista.dataset.n || 0) : 0;
  C.lista.dataset.clave = clave;
  C.lista.dataset.ronda = String(r.id);
  C.lista.dataset.n = String(lista.length);
  dom.reemplazar(C.regla, h('span.etiqueta-instrumento', 'Regla de esta red'), ' ',
    p.regla === 'B' ? [h('strong', `B · α = ${alfaTexto(p.alfa_pm)}`), ': pierde α × los créditos de los registros que propuso, con su apuesta como tope.']
      : [h('strong', 'A'), ': pierde toda su apuesta en créditos.']);
  const items = lista.map((c) => {
    const resto = h('strong.mono.esc-castigo__resto', cc(c.apuesta - c.monto));
    const monto = h('span.esc-castigo__monto.mono', icono('fuego'), ` −${cc(c.monto)}`);
    const li = h('li.esc-castigo', { dataset: { intento: String(c.intento) } },
      h('div.esc-castigo__cab', botonNodo(ctx, c.proponente), h('span.texto-3', `intento ${c.intento}`), monto),
      h('p.esc-castigo__formula.mono', formulaCastigo(c, p.regla, p.alfa_pm)),
      h('p.esc-castigo__apuesta', 'Apostó ', h('span.mono', cc(c.apuesta)), ', pierde ', h('span.mono', cc(c.monto)), ' (anulados) → le quedan ', resto,
        c.apuesta - c.monto > 0 ? ' (se liberan al terminar la ronda)' : ''),
      h('p.esc-castigo__motivo', h('span.texto-3', 'Motivo: '), h('span.mensaje-servidor', conInstituciones(c.motivo))));
    li._anim = { resto, monto, c };
    return li;
  });
  dom.reemplazar(C.lista, items);
  const quemado = e.totales.quemado;
  const pend = e.totales.castigos_pendientes;
  dom.reemplazar(C.totales,
    h('span', 'Créditos anulados en el libro: ', h('strong.mono', cc(quemado))),
    h('span', 'Castigos pendientes de registrar: ', h('strong.mono', cc(pend))),
    r.fase === 'ACEPTADO' ? h('span.esc-castigo__ok', ctx.icono('ok'), ' registrados en el folio avalado') : null);
  if (cambios.primera) return;
  items.slice(previos).forEach((li) => {
    const { resto, monto, c } = li._anim;
    ctx.anim.entrar(li, { distancia: 10 });
    ctx.anim.contar(resto, c.apuesta, c.apuesta - c.monto, { duracion: 900, formato: cc });
    ctx.anim.animar(monto, [{ opacity: 0, transform: 'translateY(6px) scale(0.6)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 200, easing: ctx.anim.CURVA.acuse, fill: 'backwards' });
  });
}

// ---------------------------------------------------------------- probar votos
function construirPruebaVoto(ctx) {
  const { h, icono } = ctx;
  const L = ctx.local;
  const id = (x) => `${L.uid}-${x}`;
  const P = {};
  P.sel = h('select.selector', { id: id('pv-sel'), name: 'votante' });
  P.enviar = h('button.boton.boton--secundario', { type: 'submit' }, icono('voto'), h('span', 'Enviar voto'));
  const voto = h('div.segmentado', { role: 'radiogroup', 'aria-label': 'Sentido del voto' },
    [['si', 'A favor'], ['no', 'En contra']].map(([v, t]) => h('label', h('input', { type: 'radio', name: 'voto', value: v, checked: v === 'si' }), t)));
  P.salida = h('div.esc-prueba__salida', { 'aria-live': 'polite' });
  P.rapidos = h('div.esc-prueba__rapidos.grupo');
  P.form = h('form.esc-prueba__form', { novalidate: true },
    h('div.campo', h('label.campo__etiqueta', { for: P.sel.id }, 'Votar como la institución'), P.sel, h('p.campo__error')),
    h('div.campo', h('p.campo__etiqueta', 'Sentido'), voto),
    h('div.esc-prueba__ir', P.enviar));
  P.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviarVoto(ctx, P.sel.value, P.form.querySelector('input[name="voto"]:checked')?.value !== 'no', { boton: P.enviar, salida: P.salida });
  });
  P.raiz = h('details.detalles.esc-prueba',
    h('summary', 'Probar votos que la red rechaza'),
    h('div.esc-prueba__cuerpo',
      h('p.campo__ayuda', 'Elige cualquier institución, aunque no sea avaladora. El servidor decide: un voto por institución avaladora, solo durante la VOTACION y solo de quien apostó créditos.'),
      P.rapidos, P.form, P.salida));
  return P;
}

function pintarPruebaVoto(e, ctx) {
  const { h, icono } = ctx;
  const P = ctx.local.bloque.prueba;
  const r = e.ronda;
  const ids = e.ids || e.nodos.map((n) => n.id);
  const claveIds = ids.join(',');
  if (P.sel.dataset.clave !== claveIds) {
    P.sel.dataset.clave = claveIds;
    const previo = P.sel.value;
    P.sel.replaceChildren(...ids.map((x) => h('option', { value: x, title: nombreInst(x) }, etiqueta(x))));
    if (ids.includes(previo)) P.sel.value = previo;
  }
  if (P.salida.dataset.ronda !== String(r?.id)) {      // el resultado de la ronda anterior ya no aplica
    P.salida.dataset.ronda = String(r?.id);
    ctx.dom.reemplazar(P.salida);
  }
  const val = new Set((r?.validadores || []).filter((v) => v.estado !== 'eliminado').map((v) => v.id));
  const noVal = ids.find((x) => !val.has(x));
  const yaVoto = r?.validadores.find((v) => v.voto !== null && v.estado !== 'eliminado')?.id;
  const clave = `${r?.id}|${r?.fase}|${noVal}|${yaVoto}`;
  if (P.rapidos.dataset.clave === clave) return;
  P.rapidos.dataset.clave = clave;
  const rap = (txt, votante, voto) => h('button.boton.boton--fantasma.boton--chico', { type: 'button', on: { click: (ev) => enviarVoto(ctx, votante, voto, { boton: ev.currentTarget, salida: P.salida }) } }, icono('voto'), h('span', txt));
  ctx.dom.reemplazar(P.rapidos,
    r?.fase === 'VOTACION' && noVal ? rap(`Votar como ${siglaDe(noVal)} (no es avaladora)`, noVal, true) : null,
    r?.fase === 'VOTACION' && yaVoto ? rap(`Hacer que ${siglaDe(yaVoto)} vote otra vez`, yaVoto, false) : null,
    r && r.fase !== 'VOTACION' ? rap(`Votar ahora, en ${r.fase}`, r.validadores[0]?.id || ids[0], true) : null);
}

async function enviarVoto(ctx, votante, voto, { boton = null, salida = null } = {}) {
  const { ui } = ctx;
  try {
    const r = await ui.ocupado(boton, ctx.api.accion('ronda/voto', { votante, voto }));
    const v = r.ronda?.validadores?.find((x) => x.id === votante);
    if (salida) {
      ctx.dom.reemplazar(salida, aviso(ctx, 'ok', 'Voto registrado.', `${etiqueta(votante)} votó ${voto ? 'a favor' : 'en contra'} con peso ${cc(v?.apuesta)}.`, { servidor: false }));
      ctx.anim.entrar(salida.firstChild);
    }
  } catch (err) {
    if (err?.name !== 'ErrorApi') { ui.mostrarError(err); return; }
    if (err.codigo === 'epoca_obsoleta') return;
    if (!salida) { ui.mostrarError(err, { titulo: `El voto de ${etiqueta(votante)} no cuenta` }); return; }
    ponerAviso(ctx, salida, aviso(ctx, 'acento', 'La red rechazó el voto:', err.message, { codigo: err.codigo, explica: EXPLICA_VOTO[err.codigo] || null }));
  }
}

// ============================================================ libro de validadores
function construirLibro(ctx) {
  const { h, ui } = ctx;
  const L = ctx.local;
  const id = (x) => `${L.uid}-${x}`;
  const B = { filas: new Map() };
  B.total = h('strong.esc-libro__total.mono');
  B.totalSub = h('span.esc-libro__total-sub');
  B.estado = h('span.esc-libro__estado');
  B.ayuda = h('p.esc-libro__ayuda');
  const prueba = (txt, tipo) => h('button.boton.boton--fantasma.boton--chico', { type: 'button', on: { click: () => probarApuesta(ctx, tipo) } }, txt);
  B.pruebasNota = h('span.esc-libro__pruebas-nota');
  B.pruebas = h('div.esc-libro__pruebas',
    h('span.etiqueta-instrumento', 'Probar una apuesta que la red rechaza'),
    h('div.grupo', prueba('Cero', 'cero'), prueba('Negativa', 'negativa'), prueba('Más créditos de los que tiene', 'excede'), prueba('Decimal', 'decimal')),
    B.pruebasNota);
  const cols = ['Institución', 'Puede apostar', 'Apuesta (CC)', 'Probabilidad', 'Intervalo', 'Voto'];
  B.cab = h('div.esc-fila.esc-fila--cab', { 'aria-hidden': 'true' }, cols.map((c) => h('span.esc-fila__celda', c)));
  B.lista = h('ul.esc-libro__lista', { role: 'list', 'aria-labelledby': id('lib-t') });
  B.vacio = h('div.esc-libro__vacio',
    h('p', 'Aún no hay ronda. Al iniciarla se eligen las instituciones avaladoras (conectadas, sincronizadas y con créditos) y cada una apuesta por defecto entre el 10 % y el 50 % de los créditos de certificación que puede gastar. En una ronda paso a paso podrás cambiar esas apuestas antes de cerrarlas.'),
    h('div.esc-libro__esqueleto', { 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('span.esqueleto'))));
  B.raiz = h('section.panel.esc-libro', { 'aria-labelledby': id('lib-t') },
    h('div.panel__cabecera.esc-libro__cabecera',
      h('h2', { id: id('lib-t') }, 'Instituciones ', ui.termino('validador', 'avaladoras'), ' y sus ', ui.termino('stake', 'apuestas')),
      B.estado,
      h('div.esc-libro__a.empuja', h('span.etiqueta-instrumento', 'Créditos en juego'), h('span', B.total, B.totalSub))),
    h('div.panel__cuerpo.esc-libro__cuerpo', B.ayuda, B.pruebas, B.vacio, h('div.esc-libro__tabla', B.cab, B.lista)));
  return B;
}

function crearFila(ctx, id) {
  const { h, ui, icono } = ctx;
  const L = ctx.local;
  const fid = `${L.uid}-ap-${id}`;
  const f = { id, enviando: false };
  f.nodo = h('button.esc-fila__nodo', { type: 'button', 'aria-label': `${etiquetaLarga(id)}: abrir su ficha`, title: etiquetaLarga(id) },
    h('span.esc-fila__rombo', { 'aria-hidden': 'true' }), marcaInst(id));
  f.nodo.addEventListener('click', () => ctx.abrirNodo(id));
  f.chips = h('span.esc-fila__chips');
  f.saldo = h('span.esc-fila__valor.mono');
  f.input = h('input.entrada.entrada--mono.esc-fila__input', { id: fid, name: 'apuestas', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `${fid}-ayuda` });
  f.guardar = h('button.boton.boton--secundario.boton--icono.esc-fila__ok', { type: 'submit', 'aria-label': `Fijar la apuesta de ${etiqueta(id)}`, title: 'Fijar la apuesta (Enter)' }, icono('ok'));
  f.campo = h('div.campo',
    h('label.solo-lectores', { for: fid }, `Apuesta de ${etiquetaLarga(id)}, en créditos de certificación`),
    h('div.entrada-compuesta', f.input, f.guardar),
    h('p.solo-lectores', { id: `${fid}-ayuda` }, 'Número entero de créditos, mayor que cero y como máximo los que puede apostar. Enter para fijarla.'),
    h('p.campo__error', { 'aria-live': 'polite' }));
  f.form = h('form.esc-fila__form', { novalidate: true }, f.campo);
  f.form.addEventListener('submit', (ev) => { ev.preventDefault(); guardarApuesta(ctx, f); });
  f.input.addEventListener('change', () => guardarApuesta(ctx, f));
  f.input.addEventListener('input', () => ui.limpiarCampo(f.input));
  f.input.addEventListener('focus', () => { L.filaFoco = id; });
  f.fijaValor = h('span.mono.esc-fila__fija-valor');
  f.fijaChip = h('span');
  f.fija = h('span.esc-fila__fija', f.fijaValor, f.fijaChip);
  f.barra = h('span.esc-prob', { 'aria-hidden': 'true' }, h('span.esc-prob__relleno'));
  f.pct = h('span.esc-fila__pct.mono');
  f.tramo = h('span.esc-fila__tramo.mono');
  f.voto = h('div.esc-fila__voto');
  f.li = h('li.esc-fila', { dataset: { id } },
    h('div.esc-fila__celda.esc-fila__id', f.nodo, f.chips),
    h('div.esc-fila__celda.esc-fila__saldo', h('span.esc-fila__et', 'Puede apostar '), f.saldo),
    h('div.esc-fila__celda.esc-fila__apuesta', h('span.esc-fila__et', { 'aria-hidden': 'true' }, 'Apuesta'), f.form, f.fija),
    h('div.esc-fila__celda.esc-fila__prob', h('span.esc-fila__et', 'Probabilidad '), h('span.esc-fila__prob-fila', f.barra, f.pct)),
    h('div.esc-fila__celda.esc-fila__tramo-c', h('span.esc-fila__et', 'Intervalo '), f.tramo),
    h('div.esc-fila__celda.esc-fila__voto-c', h('span.esc-fila__et', 'Voto '), f.voto));
  return f;
}

function pintarLibro(e, ctx, cambios) {
  const { dom, ui } = ctx;
  const B = ctx.local.libro;
  const r = e.ronda;
  B.vacio.hidden = !!r;
  B.cab.hidden = !r;
  const enApuestas = !!(r?.activa && r.fase === 'APUESTAS');
  B.pruebas.hidden = !enApuestas;
  if (!r) {
    B.lista.replaceChildren();
    B.filas.clear();
    B.claveSet = null;
    dom.texto(B.total, '—');
    dom.texto(B.totalSub, '');
    dom.reemplazar(B.estado);
    dom.texto(B.ayuda, '');
    B.ayuda.hidden = true;
    return;
  }
  B.ayuda.hidden = false;
  const claveSet = `${r.id}|${r.validadores.map((v) => v.id).join(',')}`;
  if (claveSet !== B.claveSet) {
    B.claveSet = claveSet;
    B.filas.clear();
    B.lista.replaceChildren(...r.validadores.map((v) => {
      const f = crearFila(ctx, v.id);
      B.filas.set(v.id, f);
      return f.li;
    }));
  }
  dom.texto(B.total, `A = ${cc(r.A_activo)}`);
  dom.texto(B.totalSub, r.A !== r.A_activo ? ` de ${cc(r.A)} al inicio` : '');
  const estadoAp = enApuestas ? ['libres · editables', 'acento'] : r.activa ? ['bloqueadas', 'advertencia'] : ['liberadas', 'neutro'];
  if (B.estado.dataset.clave !== estadoAp[0]) {
    B.estado.dataset.clave = estadoAp[0];
    dom.reemplazar(B.estado, ui.chip(`Apuestas ${estadoAp[0]}`, estadoAp[1]));
  }
  dom.texto(B.ayuda, enApuestas
    ? 'Escribe una apuesta en créditos y pulsa Enter (o sal del campo) para fijarla. El sector de la ruleta y la probabilidad cambian al instante. Al avanzar, todas quedan bloqueadas.'
    : r.activa ? (r.fase === 'VOTACION' && r.modo === 'paso'
      ? 'Las apuestas están bloqueadas: ahora pesan como votos. Vota a mano como cualquier institución avaladora pendiente, o deja que voten solas al escrutar.'
      : 'Las apuestas están bloqueadas: esos créditos no se pueden gastar ni cambiar hasta que termine la ronda.')
      : 'La ronda terminó: los créditos apostados se liberaron (salvo lo castigado).');
  const sorteo = r.sorteo && r.fase !== 'APUESTAS' ? r.sorteo : null;
  const prev = !sorteo ? intervalosDe(r.validadores.filter((v) => v.estado !== 'eliminado')).intervalos : null;
  const deshon = new Map(e.nodos.map((n) => [n.id, n]));
  for (const v of r.validadores) {
    const f = B.filas.get(v.id);
    if (f) actualizarFila(ctx, f, v, r, deshon.get(v.id), { sorteo, prev, enApuestas, primera: cambios.primera });
  }
}

function actualizarFila(ctx, f, v, r, n, { sorteo, prev, enApuestas, primera }) {
  const { dom, ui, h, icono } = ctx;
  const eliminado = v.estado === 'eliminado';
  f.li.dataset.estado = v.estado;
  dom.attr(f.li, 'data-deshonesto', n?.deshonesto ? '' : null);
  dom.attr(f.li, 'data-ganador', v.id === r.proponente && ['SORTEO', 'CANDIDATO', 'VOTACION', 'ACEPTADO'].includes(r.fase) ? '' : null);
  const claveChips = `${v.estado}|${n?.deshonesto}|${n?.trampa}|${r.fase}|${v.id === r.proponente}`;
  if (f.chips.dataset.clave !== claveChips) {
    f.chips.dataset.clave = claveChips;
    dom.reemplazar(f.chips,
      v.estado === 'proponente' || (v.id === r.proponente && r.fase === 'ACEPTADO') ? ui.chip('proponente', 'acento') : null,
      eliminado ? ui.chip('castigada', 'rechazado') : null,
      n?.deshonesto ? ui.chip(`deshonesta · ${n.trampa === 'gasto' ? 'créditos' : 'firma'}`, 'rechazado', { sinPunto: true }) : null);
  }
  const puede = n ? n.saldo.gastable + (n.saldo.bloqueado || 0) : null;
  dom.texto(f.saldo, puede === null ? '—' : cc(puede));
  // apuesta
  f.form.hidden = !enApuestas;
  f.fija.hidden = enApuestas;
  if (enApuestas) {
    const ocupado = document.activeElement === f.input || f.campo.hasAttribute('data-invalido') || f.enviando;
    if (!ocupado && f.input.value !== String(v.apuesta)) {
      const antes = f.input.value;
      f.input.value = String(v.apuesta);
      if (antes && !primera) ctx.anim.destello(f.input);
    }
  } else {
    if (f.campo.hasAttribute('data-invalido')) ui.limpiarCampo(f.input);
    dom.texto(f.fijaValor, num(v.apuesta));
    const c = eliminado ? ['anulada', 'rechazado', `−${cc(v.castigo)} anulados`] : r.activa ? ['bloqueada', 'advertencia'] : ['liberada', 'neutro'];
    const claveF = c.join('|');
    if (f.fijaChip.dataset.clave !== claveF) {
      f.fijaChip.dataset.clave = claveF;
      dom.reemplazar(f.fijaChip, eliminado ? h('span.esc-fila__quema', icono('fuego'), ` ${c[2]}`) : ui.chip(c[0], c[1], { sinPunto: true }));
    }
  }
  // probabilidad
  const A = r.A_activo;
  const p = eliminado || !A ? 0 : v.apuesta / A;
  dom.cssVar(f.barra, '--p', p.toFixed(4));
  dom.texto(f.pct, eliminado ? 'fuera' : pct(p));
  // intervalo
  const t = sorteo ? sorteo.intervalos.find((x) => x.id === v.id) : prev?.find((x) => x.id === v.id);
  dom.texto(f.tramo, t ? `[${num(t.desde)}, ${num(t.hasta)})` : '—');
  // voto
  const puedeVotar = r.activa && r.fase === 'VOTACION' && r.modo === 'paso' && v.voto === null && !eliminado;
  const claveV = `${r.fase}|${v.voto}|${v.motivo_voto}|${eliminado}|${puedeVotar}`;
  if (f.voto.dataset.clave !== claveV) {
    f.voto.dataset.clave = claveV;
    let cont;
    if (puedeVotar) {
      const si = h('button.boton.boton--secundario.boton--chico.esc-votar', { type: 'button', 'aria-label': `${etiqueta(v.id)} vota a favor` }, icono('ok'), h('span', 'A favor'));
      const no = h('button.boton.boton--peligro.boton--chico.esc-votar', { type: 'button', 'aria-label': `${etiqueta(v.id)} vota en contra` }, icono('x'), h('span', 'En contra'));
      si.addEventListener('click', () => enviarVoto(ctx, v.id, true, { boton: si }));
      no.addEventListener('click', () => enviarVoto(ctx, v.id, false, { boton: no }));
      cont = h('div.esc-fila__votar', si, no);
    } else if (v.voto === true || v.voto === false) {
      cont = [h('span.esc-fila__voto-l', ui.chip(v.voto ? 'a favor' : 'en contra', v.voto ? 'valido' : 'rechazado'), h('span.mono.texto-3', ` peso ${cc(v.apuesta)}`)),
        v.motivo_voto ? h('small.esc-fila__motivo', conInstituciones(v.motivo_voto)) : null];
    } else {
      cont = h('span.texto-3', eliminado ? 'no vota' : r.fase === 'VOTACION' ? 'sin votar' : '—');
    }
    dom.reemplazar(f.voto, cont);
  }
}

function marcarApuesta(ctx, id, mensaje) {
  const f = ctx.local.libro.filas.get(id);
  if (!f || f.form.hidden) return false;
  ctx.ui.marcarCampo(f.form, 'apuestas', mensaje);
  return true;
}

async function guardarApuesta(ctx, f) {
  const { ui } = ctx;
  const r = ctx.estado()?.ronda;
  if (!r?.activa || r.fase !== 'APUESTAS' || f.enviando) return;
  const actual = r.validadores.find((v) => v.id === f.id)?.apuesta;
  const t = f.input.value.trim();
  if (t === String(actual)) { ui.limpiarCampo(f.input); return; }
  ui.limpiarCampo(f.input);
  if (!t) { ui.marcarCampo(f.form, 'apuestas', 'Escribe la apuesta: un número entero.'); return; }
  if (!RE_ENTERO_SIGNO.test(t)) {
    ui.marcarCampo(f.form, 'apuestas', /[.,]/.test(t) ? 'La apuesta debe ser un número entero (sin decimales).' : `«${t.slice(0, 16)}» no es un número entero.`);
    return;
  }
  const valor = Number(t);
  if (!Number.isSafeInteger(valor)) { ui.marcarCampo(f.form, 'apuestas', 'Ese número es demasiado grande.'); return; }
  f.enviando = true;
  try {
    await ui.ocupado(f.guardar, ctx.api.accion('ronda/apuestas', { apuestas: { [f.id]: valor } }));
    ui.anunciar(`Apuesta de ${etiqueta(f.id)} fijada en ${cc(valor)}.`);
    ctx.anim.destello(f.input, 'var(--valido)');
  } catch (err) {
    if (err?.name === 'ErrorApi' && err.campo === 'apuestas') ui.marcarCampo(f.form, 'apuestas', err.message);
    else errorRonda(ctx, err);
  } finally {
    f.enviando = false;
  }
}

/** Botones de prueba: escriben un valor inválido en la fila enfocada (o la primera) y lo envían. */
function probarApuesta(ctx, tipo) {
  const L = ctx.local;
  const e = ctx.estado();
  const r = e?.ronda;
  if (!r?.activa || r.fase !== 'APUESTAS') return;
  const id = L.libro.filas.has(L.filaFoco) ? L.filaFoco : r.validadores[0]?.id;
  const f = L.libro.filas.get(id);
  const n = e.nodos.find((x) => x.id === id);
  if (!f || !n) return;
  const valor = { cero: '0', negativa: '-5', excede: String(n.saldo.gastable + n.saldo.bloqueado + 1), decimal: '2.5' }[tipo];
  ctx.dom.texto(L.libro.pruebasNota, `Probando con ${etiqueta(id)} (enfoca otra fila para elegir otra institución).`);
  f.input.value = valor;
  f.input.focus();
  guardarApuesta(ctx, f);
}

// ===================================================================== tramposos
function construirTrampas(ctx) {
  const { h, icono } = ctx;
  const L = ctx.local;
  const id = (x) => `${L.uid}-${x}`;
  const T = { botones: new Map() };
  T.tipo = h('div.segmentado.esc-trampas__tipo', { role: 'radiogroup', 'aria-labelledby': id('tr-tipo') },
    [['firma', 'Firma alterada'], ['gasto', 'Créditos que no tiene']].map(([v, t]) => h('label', h('input', { type: 'radio', name: 'trampa', value: v, checked: v === 'firma' }), t)));
  T.rejilla = h('div.esc-trampas__rejilla', { role: 'group', 'aria-label': 'Honestidad de cada institución' });
  T.preparar = h('button.boton.boton--primario.esc-trampas__preparar', { type: 'button' }, icono('mascara'), h('span', 'Preparar un rechazo para el video'));
  T.todos = h('button.boton.boton--secundario.boton--chico', { type: 'button' }, icono('alerta'), h('span', 'Todas las avaladoras deshonestas'));
  T.honestos = h('button.boton.boton--fantasma.boton--chico', { type: 'button' }, icono('escudo'), h('span', 'Volver todas honestas'));
  T.preparar.addEventListener('click', () => prepararRechazo(ctx));
  T.todos.addEventListener('click', () => todosTramposos(ctx));
  T.honestos.addEventListener('click', () => todosHonestos(ctx));
  T.bloqueo = h('p.esc-trampas__bloqueo');
  T.msg = h('div.esc-trampas__msg', { 'aria-live': 'polite' });
  T.cuenta = h('span');
  T.raiz = h('section.panel.esc-trampas', { 'aria-labelledby': id('tr-t') },
    h('div.panel__cabecera', h('h2', { id: id('tr-t') }, 'Instituciones deshonestas'), T.cuenta),
    h('div.panel__cuerpo.esc-trampas__cuerpo',
      h('p.esc-trampas__intro', 'Una institución deshonesta, si sale sorteada, propone un folio con un registro fraudulento; como avaladora, avala sin revisar. Las honestas lo detectan, votan en contra y la deshonesta pierde créditos.'),
      h('div.campo', h('p.campo__etiqueta', { id: id('tr-tipo') }, 'Registro fraudulento para las que marques'), T.tipo),
      T.rejilla,
      h('p.esc-trampas__leyenda', h('span.esc-trampas__muestra', { 'aria-hidden': 'true' }), 'raya de acento: avaladora de la ronda en curso · rombo rojo: deshonesta'),
      T.bloqueo,
      h('div.esc-trampas__atajo',
        T.preparar,
        h('p.campo__ayuda', 'Inicia (si hace falta) una ronda paso a paso, calcula en tu navegador qué institución va a sortear la red con las apuestas actuales y la vuelve deshonesta. Al avanzar verás votos en contra, el rechazo, el castigo en créditos y el nuevo sorteo sin ella.')),
      h('div.grupo', T.todos, T.honestos),
      h('p.campo__ayuda', '«Todas deshonestas» lleva a una ronda ABORTADA: cada sorteada es castigada hasta que no queda ninguna.'),
      T.msg));
  return T;
}

function pintarTrampas(e, ctx) {
  const { h, dom, ui } = ctx;
  const T = ctx.local.trampas;
  const r = e.ronda;
  const ids = e.ids || e.nodos.map((n) => n.id);
  const claveIds = ids.join(',');
  if (T.rejilla.dataset.clave !== claveIds) {
    T.rejilla.dataset.clave = claveIds;
    T.botones.clear();
    T.rejilla.replaceChildren(...ids.map((id) => {
      const est = h('span.esc-trampa__estado');
      const b = h('button.esc-trampa', { type: 'button', role: 'switch', 'aria-checked': 'false', dataset: { id }, title: etiquetaLarga(id) },
        h('span.esc-trampa__id', siglaDe(id)), h('span.esc-trampa__num', id), est);
      b.addEventListener('click', () => alternarDeshonesto(ctx, id, b));
      T.botones.set(id, { b, est });
      return b;
    }));
  }
  const val = new Set((r?.activa ? r.validadores : []).map((v) => v.id));
  let n = 0;
  for (const nd of e.nodos) {
    const x = T.botones.get(nd.id);
    if (!x) continue;
    if (nd.deshonesto) n += 1;
    dom.attr(x.b, 'aria-checked', nd.deshonesto ? 'true' : 'false');
    dom.attr(x.b, 'data-validador', val.has(nd.id) ? '' : null);
    dom.texto(x.est, nd.deshonesto ? (nd.trampa === 'gasto' ? 'créditos' : 'firma') : 'honesta');
    dom.attr(x.b, 'aria-label', `${etiquetaLarga(nd.id)}: ${nd.deshonesto ? `deshonesta, registro fraudulento por ${TRAMPA[nd.trampa] || 'firma alterada'}` : 'honesta'}${val.has(nd.id) ? ', avaladora de esta ronda' : ''}`);
  }
  if (T.cuenta.dataset.n !== String(n)) {
    T.cuenta.dataset.n = String(n);
    dom.reemplazar(T.cuenta, ui.chip(n ? plural(n, 'deshonesta', 'deshonestas') : 'todas honestas', n ? 'rechazado' : 'valido'));
  }
  T.honestos.hidden = !n;
  const bloqueada = r?.activa && r.fase !== 'APUESTAS';
  dom.texto(T.bloqueo, bloqueada ? `Ronda en fase ${r.fase}: el servidor no deja cambiar la honestidad de una institución hasta que termine (solo antes de cerrar las apuestas). Pruébalo y verás su respuesta.` : '');
  T.bloqueo.hidden = !bloqueada;
}

function tipoTrampa(ctx) { return ctx.local.trampas.tipo.querySelector('input:checked')?.value || 'firma'; }

function errorTrampas(ctx, err) {
  const T = ctx.local.trampas;
  if (err?.name !== 'ErrorApi') { ctx.ui.mostrarError(err); return; }
  if (err.codigo === 'epoca_obsoleta') return;
  const explica = err.codigo === 'ronda_en_curso'
    ? 'Si se pudiera cambiar con la ronda en marcha, una institución podría «volverse» deshonesta después de salir sorteada. Solo se permite antes de cerrar las apuestas.'
    : null;
  if (['ronda_en_curso', 'trampa_invalida', 'nodo_inexistente'].includes(err.codigo)) ponerAviso(ctx, T.msg, aviso(ctx, 'aviso', 'La red no lo permite:', err.message, { codigo: err.codigo, explica }));
  else errorRonda(ctx, err, { destino: T.msg });
}

async function alternarDeshonesto(ctx, id, b) {
  const { ui } = ctx;
  const T = ctx.local.trampas;
  const n = ctx.store.nodo(ctx.modo, id);
  const activo = !n?.deshonesto;
  const trampa = tipoTrampa(ctx);
  try {
    await ui.ocupado(b, ctx.api.accion(`nodos/${id}/deshonesto`, activo ? { activo: true, trampa } : { activo: false }));
    ctx.dom.reemplazar(T.msg, aviso(ctx, 'ok', activo ? `${etiqueta(id)} será deshonesta.` : `${etiqueta(id)} vuelve a ser honesta.`,
      activo ? `Si sale sorteada propondrá un folio con un registro fraudulento (${TRAMPA[trampa]}); como avaladora avalará sin revisar.` : 'Revisará los folios y votará según lo que encuentre.', { servidor: false }));
  } catch (err) { errorTrampas(ctx, err); }
}

async function prepararRechazo(ctx) {
  const { ui, h } = ctx;
  const T = ctx.local.trampas;
  let e = ctx.estado();
  let r = e?.ronda;
  ctx.dom.reemplazar(T.msg);
  T.preparar.setAttribute('aria-busy', 'true');
  try {
    if (!r?.activa) {
      const nueva = await iniciarRonda(ctx, { modo: 'paso', boton: T.preparar, destino: T.msg });
      if (!nueva) return;
      T.preparar.setAttribute('aria-busy', 'true');
      r = nueva;
      e = ctx.estado();
    }
    if (r.fase !== 'APUESTAS') {
      ponerAviso(ctx, T.msg, aviso(ctx, 'aviso', 'Ahora no se puede preparar.', `La ronda #${r.id} ya pasó las apuestas (fase ${r.fase}).`, { servidor: false, explica: 'Avánzala hasta el final o cancélala y vuelve a pulsar: se preparará en una ronda nueva.' }));
      return;
    }
    const p = await predecir(ctx, e?.cabeza?.hash, r, 0);
    const objetivo = p?.ganador || r.validadores.slice().sort((a, b) => b.apuesta - a.apuesta)[0]?.id;
    if (!objetivo) return;
    const trampa = tipoTrampa(ctx);
    await ctx.api.accion(`nodos/${objetivo}/deshonesto`, { activo: true, trampa });
    const t = p?.intervalos.find((x) => x.id === objetivo);
    const quien = etiqueta(objetivo);
    ctx.dom.reemplazar(T.msg, aviso(ctx, 'acento', `Listo: ${quien} saldrá sorteada e intentará avalar un registro fraudulento.`, null, {
      servidor: false,
      extra: h('div.pila.esc-trampas__plan',
        p ? h('p', 'Con las apuestas actuales, r = SHA-256(', h('code', `…|${r.numero_bloque}|0`), `) mod ${num(p.A)} = `, h('strong.mono', num(p.r)),
          ` cae en [${num(t.desde)}, ${num(t.hasta)}), el intervalo de ${quien}. Ya es deshonesta (${TRAMPA[trampa]}).`)
          : h('p', `Tu navegador no puede calcular SHA-256 aquí: se eligió a la de mayor apuesta (${quien}), la más probable.`),
        h('ol.esc-trampas__pasos',
          h('li', 'Pulsa «Cerrar apuestas y sortear»: la ruleta cae en ', h('strong', quien), '.'),
          h('li', 'Avanza: arma un folio con el registro fraudulento y las honestas votan en contra.'),
          h('li', 'Escruta: rechazo, castigo (pierde créditos de su apuesta, que se anulan) y nuevo sorteo sin ella.')),
        h('p.texto-3', 'No cambies las apuestas: con otro A, r cae en otro sitio.')),
    }));
    ctx.anim.entrar(T.msg.firstChild);
    ui.anunciar(`${quien} saldrá sorteada y es deshonesta. Avanza la ronda para ver el rechazo.`);
  } catch (err) {
    errorTrampas(ctx, err);
  } finally {
    T.preparar.removeAttribute('aria-busy');
  }
}

async function todosTramposos(ctx) {
  const T = ctx.local.trampas;
  const r = ctx.estado()?.ronda;
  if (!r?.activa || r.fase !== 'APUESTAS') {
    ponerAviso(ctx, T.msg, aviso(ctx, 'aviso', 'Primero inicia una ronda paso a paso.', 'Así se sabe qué instituciones son avaladoras; mientras esté en APUESTAS se pueden volver deshonestas todas.', { servidor: false }));
    return;
  }
  const trampa = tipoTrampa(ctx);
  try {
    await ctx.ui.ocupado(T.todos, (async () => {
      for (const v of r.validadores) await ctx.api.accion(`nodos/${v.id}/deshonesto`, { activo: true, trampa });
    })());
    ctx.dom.reemplazar(T.msg, aviso(ctx, 'acento', `Las ${r.validadores.length} avaladoras son deshonestas.`, 'Cada sorteada propondrá un folio con un registro fraudulento y las demás lo avalarán sin revisar, pero cada institución valida el folio final: rechazo tras rechazo (y castigo tras castigo), hasta que no quede ninguna y la ronda se aborte.', { servidor: false }));
  } catch (err) { errorTrampas(ctx, err); }
}

async function todosHonestos(ctx) {
  const T = ctx.local.trampas;
  const lista = (ctx.estado()?.nodos || []).filter((n) => n.deshonesto);
  try {
    await ctx.ui.ocupado(T.honestos, (async () => {
      for (const n of lista) await ctx.api.accion(`nodos/${n.id}/deshonesto`, { activo: false });
    })());
    ctx.dom.reemplazar(T.msg, aviso(ctx, 'ok', 'Todas las instituciones son honestas otra vez.', null, { servidor: false }));
  } catch (err) { errorTrampas(ctx, err); }
}

// ===================================================================== historial
function construirHistorial(ctx) {
  const { h } = ctx;
  const L = ctx.local;
  const id = (x) => `${L.uid}-${x}`;
  const Hh = {};
  Hh.titulo = h('h2', { id: id('hist-t') }, 'Historia de la ronda');
  Hh.lista = h('ol.esc-hist', { role: 'list', tabindex: '0', 'aria-label': 'Pasos de la ronda, en orden' });
  Hh.vacio = h('p.esc-hist__vacio', 'Cada paso de la ronda (sorteos, folios candidatos, rechazos, castigos y resultado) quedará aquí, con su hora lógica.');
  Hh.raiz = h('section.panel.esc-historial', { 'aria-labelledby': id('hist-t') },
    h('div.panel__cabecera', Hh.titulo),
    h('div.panel__cuerpo', Hh.vacio, Hh.lista));
  return Hh;
}

function pintarHistorial(e, ctx, cambios) {
  const { h, dom, fmt } = ctx;
  const Hh = ctx.local.hist;
  const r = e.ronda;
  const items = r ? r.historial.map((x, i) => ({ ...x, clave: `${r.id}:${i}` })) : [];
  Hh.vacio.hidden = items.length > 0;
  dom.texto(Hh.titulo, r ? `Historia de la ronda #${r.id}` : 'Historia de la ronda');
  const animar = !cambios.primera && Hh.ronda === r?.id;
  dom.reconciliar(Hh.lista, items, (x) => x.clave, (x) => {
    const li = h('li.esc-hist__item', { dataset: { fase: x.fase } },
      h('span.esc-hist__punto', { 'aria-hidden': 'true' }),
      h('div.esc-hist__meta',
        h('span.esc-hist__fase', FASE[x.fase]?.nombre || x.fase),
        x.intento ? h('span.esc-hist__intento.mono', `intento ${x.intento}`) : null,
        h('span.esc-hist__t.mono', { title: x.t }, fmt.tiempo(x.t))),
      h('p.esc-hist__texto', conInstituciones(x.texto)));
    if (animar) ctx.anim.entrar(li);
    return li;
  });
  Hh.ronda = r?.id;
}

// ================================================================= cómo funciona
function construirComo(ctx) {
  const { h, ui } = ctx;
  const idea = (n, titulo, texto) => h('li.esc-como__idea', h('span.esc-como__num.mono', { 'aria-hidden': 'true' }, n), h('div', h('h3.esc-como__titulo', titulo), h('p', texto)));
  return h('details.detalles.esc-como',
    h('summary', 'Cómo funciona Proof of Stake en «Título Seguro», en cuatro ideas'),
    h('ol.esc-como__lista', { role: 'list' },
      idea('01', ['Se arriesgan créditos: la ', ui.termino('stake', 'apuesta')],
        ['Para avalar folios, cada institución ', ui.termino('validador', 'avaladora'), ' bloquea parte de sus créditos de certificación. No gasta energía: arriesga créditos. Su apuesta es su peso en todo lo que sigue.']),
      idea('02', ['Un ', ui.termino('sorteo_ponderado', 'sorteo proporcional')],
        ['Las apuestas se ponen en fila y forman intervalos. r = SHA-256(', ui.termino('semilla_sorteo', 'semilla'), ') mod A elige un punto: la institución que tiene ese intervalo propone el folio de registros. El doble de apuesta da el doble de probabilidad, nunca certeza.']),
      idea('03', ['Un ', ui.termino('quorum', 'quórum de 2/3')],
        ['Las avaladoras revisan cada registro de credencial (firma de la emisora, créditos disponibles) y votan con su peso. Se avala si 3V ≥ 2A, en enteros. Hacen falta dos tercios de los créditos apostados, y basta algo más de un tercio honesto para frenar un registro fraudulento.']),
      idea('04', ['Un ', ui.termino('castigo', 'castigo'), ' (slashing)'],
        ['Si el folio se rechaza, la institución proponente pierde su apuesta (regla A) o parte de ella (regla B), y esos créditos se ', ui.termino('quemar', 'anulan'), '. Queda fuera y se sortea otra. Por eso colar un título falso sale caro.'])),
    h('p.esc-como__pie', 'Los créditos ganados por sellar se pagan en cuanto el folio se avala: PoS usa 0 confirmaciones porque la votación ya es la confirmación. Y todo es reproducible: misma semilla y mismas acciones dan los mismos sorteos.'));
}
