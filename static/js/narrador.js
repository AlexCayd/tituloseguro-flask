// «¿Qué está pasando?» — traduce la bitácora y el estado a frases sencillas, en el idioma de la
// vida universitaria: instituciones, registros de credenciales, folios del libro de registros y
// créditos de certificación (con el término técnico entre paréntesis cuando aporta precisión).
//
//   narrarEvento(entrada, estado)  → { titulo, texto, nivel, nodo? }
//   narrarLote(entradas, estado)   → la narración del lote (elige lo más importante y resume ráfagas)
//   siguientePaso(estado, modo)    → { texto, vista?, etiqueta?, nodo? } | null
//   registrarFrase(tipo, fn)       → otra vista puede afinar la frase de un tipo de evento
//                                    fn(entrada, estado) → { titulo, texto, nivel? } | null
//
// La clase Narrador pinta el panel persistente del observatorio.

import { h, icono, texto, attr } from './util/dom.js';
import { plural, cerosIniciales, num } from './util/fmt.js';
import { animar, DUR, CURVA } from './util/anim.js';
import { sigla, creditos, tarifaPorMonto, conSiglas, nombreModo, MODO_ACADEMICO } from './dominio.js';

// Prioridad: qué evento manda cuando llegan varios juntos (mayor = más importante).
const PRIORIDAD = {
  ganador: 90, ronda_aceptada: 90, ronda_rechazada: 88, castigo: 70, ronda_abortada: 86,
  empate_ronda: 85, ataque: 84, corrupcion_local: 80, trabajo_limite: 80, trabajo_error: 82,
  simulacion_creada: 95, tx_rechazada: 75, sorteo: 72, candidato: 70, trabajo_inicio: 68,
  autopiloto_detenido: 66, trabajo_cancelado: 65, nodo_sincronizado: 64, nodo_deshonesto: 62,
  nodo_conexion: 60, recompensa_madura: 58, tx_aceptada: 55, cadena_rechazada: 54,
  ronda_inicio: 52, apuestas_fijadas: 40, voto: 45, bloque_difundido: 50, recompensa_pendiente: 42,
  cadena_aceptada: 30, tx_descartada: 48,
};

const S = (id) => (id ? sigla(id) : '?');

const MOTIVO_TX = {
  tx_firma: 'la firma no corresponde al registro: alguien lo alteró después de firmarlo. Con la clave pública de la institución emisora, la verificación falla.',
  tx_otra_clave: 'lo firmó otra institución. Ninguna institución puede registrar credenciales en nombre de otra sin su clave privada.',
  tx_saldo: 'la institución emisora no tiene suficientes créditos de certificación disponibles.',
  tx_duplicada: 'ese mismo registro ya existía: aceptarlo sería registrar dos veces los mismos créditos (doble gasto).',
  tx_mismo_nodo: 'la institución emisora y la que avala son la misma.',
  tx_nodo_inexistente: 'la institución emisora o la que avala no forma parte del consorcio.',
  tx_monto: 'la cantidad de créditos no es válida.',
};

const MOTIVO_CADENA = {
  no_mas_larga: 'el libro recibido no era más completo que el suyo (prevalece el libro más completo y verificable)',
  cadena_invalida: 'el libro recibido no pasó la revisión',
  genesis_distinto: 'pertenece a otro consorcio (su folio de apertura, el génesis, es distinto)',
  desconectado: 'está desconectada',
};

function frase(titulo, textoFrase, nivel = 'info') { return { titulo, texto: textoFrase, nivel }; }

/** «10 créditos de certificación (lo que cuesta registrar un título profesional)» si el monto coincide con una tarifa. */
function montoConContexto(monto) {
  const t = tarifaPorMonto(monto);
  return `${creditos(num(monto))}${t ? ` (lo que cuesta registrar ${articulo(t.nombre)})` : ''}`;
}
function articulo(nombreTarifa) {
  const n = String(nombreTarifa || '').toLowerCase();
  return /^(constancia)/.test(n) ? `una ${n}` : `un ${n}`;
}

const FRASES = {
  simulacion_creada: (e) => frase('El consorcio abrió su libro de registros',
    `${e.datos?.n ?? ''} instituciones, cada una con su par de claves de firma (Ed25519) y su propia copia del libro, que empieza en el mismo folio de apertura (génesis). Todas parten de acuerdo y con los mismos créditos de certificación.`, 'ok'),
  tx_aceptada: (e, est) => {
    const p = (est?.pendientes || []).find((x) => x.id === e.datos?.id);
    const receptor = p?.tx?.receptor;
    return frase('Registro firmado y aceptado',
      `${S(e.nodo)} registró una credencial por ${montoConContexto(e.datos?.monto)}${receptor ? `, avalada por ${S(receptor)}` : ''}. La firma es auténtica y hay créditos suficientes: queda en espera de que el consorcio la selle en un folio.`, 'ok');
  },
  tx_rechazada: (e) => frase('Registro rechazado',
    `El consorcio no aceptó el registro de ${S(e.nodo)}: ${MOTIVO_TX[e.datos?.codigo] || 'no pasó la revisión.'}`, 'aviso'),
  tx_descartada: () => frase('Registro en espera retirado',
    'Un registro en espera dejó de ser válido (los créditos de su institución emisora cambiaron desde que se aceptó) y se retiró antes de sellar el folio.', 'aviso'),
  trabajo_inicio: (e, est) => frase('Empieza el sellado por trabajo',
    `Cada institución selladora prueba números de su propio carril (nonces) buscando una huella para el folio #${e.datos?.bloque ?? '?'} que empiece con ${est?.parametros?.dificultad ?? 'd'} ceros. La primera que lo logre sellará los registros en espera.`),
  ganador: (e) => {
    const id = e.datos?.id || e.nodo;
    return frase(`${S(id)} selló el folio`,
      `${S(id)} encontró el nonce ${num(e.datos?.nonce)}: su huella —el sello de autenticidad del folio— empieza con ${cerosIniciales(e.datos?.hash)} ceros. Las demás instituciones dejan de buscar y revisan su folio.`, 'ok');
  },
  empate_ronda: () => frase('Empate en la misma ronda',
    'Varias instituciones acertaron a la vez. Prevalece la huella numéricamente menor; las demás quedan obsoletas y no cuentan.', 'aviso'),
  bloque_difundido: (e) => frase('Folio enviado al consorcio',
    `${S(e.nodo)} añadió el folio #${e.datos?.bloque} a su copia del libro y lo envía a todas las instituciones. Cada una lo revisará por su cuenta antes de aceptarlo.`),
  cadena_aceptada: (e) => frase('Libro aceptado',
    `${S(e.nodo)} revisó el libro completo (huellas, enlaces entre folios, firmas y créditos) y adoptó esa versión.`, 'ok'),
  cadena_rechazada: (e) => frase('Libro rechazado',
    `${S(e.nodo)} no aceptó el libro recibido: ${MOTIVO_CADENA[e.datos?.codigo] || 'no pasó la revisión'}.`, 'aviso'),
  recompensa_pendiente: (e) => frase('Créditos ganados por sellar, aún sin madurar',
    `${S(e.nodo)} cobrará los créditos ganados por sellar cuando el folio tenga 6 confirmaciones (seis folios sellados encima). Hasta entonces son suyos, pero todavía no puede usarlos.`),
  recompensa_madura: (e) => frase('Créditos ganados ya disponibles',
    `Los créditos ganados por sellar el folio #${e.datos?.bloque} ya tienen 6 confirmaciones: ${S(e.nodo)} puede usarlos para registrar credenciales.`, 'ok'),
  trabajo_limite: () => frase('Se agotaron las rondas',
    'Ninguna institución encontró un nonce válido antes del límite de rondas. El libro y los registros en espera quedan intactos: sube el límite o baja la dificultad y vuelve a intentarlo.', 'aviso'),
  trabajo_cancelado: () => frase('Sellado cancelado',
    'Se detuvo la búsqueda: no se selló ningún folio y los registros siguen en espera.', 'aviso'),
  trabajo_error: (e) => frase('El sellado se interrumpió', conSiglas(e.texto), 'error'),
  autopiloto_detenido: (e) => frase('Sellado automático detenido', conSiglas(e.texto), 'aviso'),
  nodo_conexion: (e, est) => {
    const n = est?.nodos?.find((x) => x.id === e.nodo);
    return n?.conectado
      ? frase(`${S(e.nodo)} se reconectó`, `${S(e.nodo)} vuelve al consorcio, pero su libro puede estar atrasado: sincronízala para que pida la versión más completa a las demás.`, 'info')
      : frase(`${S(e.nodo)} se desconectó`, `${S(e.nodo)} ya no recibirá folios nuevos: su copia del libro se quedará atrás mientras el consorcio avanza.`, 'aviso');
  },
  nodo_sincronizado: (e) => (e.datos?.codigo === 'aceptada'
    ? frase(`${S(e.nodo)} se puso al día`, `${S(e.nodo)} pidió el libro más completo a las demás instituciones, lo revisó entero y lo adoptó.`, 'ok')
    : frase(`${S(e.nodo)} ya estaba al día`, `${S(e.nodo)} comparó su copia con la de las demás: ${MOTIVO_CADENA[e.datos?.codigo] || 'no había una versión mejor que adoptar'}.`)),
  nodo_deshonesto: (e, est) => {
    const n = est?.nodos?.find((x) => x.id === e.nodo);
    return n?.deshonesto
      ? frase(`${S(e.nodo)} intentará un fraude`, `Si sale sorteada para proponer el folio, intentará avalar un registro fraudulento (${n.trampa === 'gasto' ? 'créditos que no tiene' : 'firma alterada'}). Las instituciones honestas deberían rechazarlo y castigarla.`, 'aviso')
      : frase(`${S(e.nodo)} vuelve a ser honesta`, `${S(e.nodo)} ya no intentará avalar registros fraudulentos.`);
  },
  ataque: (e) => (e.datos?.aceptada
    ? frase('La falsificación pasó', conSiglas(e.texto), 'error')
    : frase('Falsificación detectada', `${S(e.nodo)} recibió un registro alterado («${e.datos?.tipo}»), lo revisó y lo rechazó. Su copia del libro sigue intacta.`, 'ok')),
  corrupcion_local: (e) => frase(`Alguien alteró la copia de ${S(e.nodo)}`,
    'Su libro ya no cuadra al recalcular huellas y firmas, así que no participa hasta sincronizarse con el consorcio.', 'aviso'),
  ronda_inicio: (e) => frase('Nueva ronda de aval por apuesta',
    `${plural(e.datos?.validadores?.length || 0, 'institución avaladora apuesta', 'instituciones avaladoras apuestan')} parte de sus créditos para avalar el siguiente folio de registros.`),
  apuestas_fijadas: () => frase('Apuestas cerradas', 'Los créditos apostados quedan bloqueados: no se pueden usar para registrar credenciales mientras dure la ronda.'),
  sorteo: (e) => frase(`Sorteo: sale ${S(e.nodo)}`,
    `El número reproducible r = ${num(e.datos?.r)} cae en el tramo de ${S(e.nodo)} (de ${num(e.datos?.A)} créditos apostados en total). Quien más apuesta tiene más probabilidad de proponer, pero no garantía.`),
  candidato: (e) => frase(`${S(e.nodo)} propone un folio`,
    e.datos?.trampa
      ? `${S(e.nodo)} armó y firmó su folio… con un registro fraudulento («${e.datos.trampa}»). Ahora votan las instituciones avaladoras.`
      : `${S(e.nodo)} armó y firmó el folio con los registros en espera. Cada institución avaladora lo revisa y vota con el peso de su apuesta.`,
    e.datos?.trampa ? 'aviso' : 'info'),
  voto: (e) => frase(`${S(e.nodo)} vota`, `${S(e.nodo)} vota ${e.datos?.voto ? 'a favor' : 'en contra'} con un peso de ${num(e.datos?.peso)} créditos apostados.`),
  ronda_aceptada: (e) => frase(`Folio #${e.datos?.bloque} avalado`,
    `Los votos a favor alcanzaron dos tercios de lo apostado. ${S(e.nodo)} cobra sus créditos ganados y se liberan las apuestas.`, 'ok'),
  ronda_rechazada: (e) => frase('Folio rechazado',
    `${S(e.nodo)} propuso un folio que no pasó: pierde ${creditos(num(e.datos?.monto))} de su apuesta (regla ${e.datos?.regla}) y queda fuera de la ronda. Se sortea otra institución proponente.`, 'error'),
  castigo: (e) => frase(`${S(e.nodo)} castigada`, `Se anulan ${creditos(num(e.datos?.monto))} de su apuesta: en el aval por apuesta, avalar un registro fraudulento cuesta créditos.`, 'aviso'),
  ronda_abortada: (e) => frase('Ronda interrumpida', conSiglas(e.datos?.motivo || e.texto), 'aviso'),
};

export function registrarFrase(tipo, fn) { FRASES[tipo] = fn; }

export function narrarEvento(e, estado) {
  const fn = FRASES[e.tipo];
  let r = null;
  try { r = fn ? fn(e, estado) : null; } catch { r = null; }
  if (!r) r = frase('Novedad en el libro de registros', conSiglas(e.texto), e.nivel === 'error' ? 'error' : e.nivel === 'aviso' ? 'aviso' : 'info');
  return { ...r, nodo: e.nodo, tipo: e.tipo, seq: e.seq, t: e.t };
}

/** Elige el evento principal de un lote y resume las ráfagas (revisiones, votos). */
export function narrarLote(entradas, estado) {
  if (!entradas?.length) return null;
  const aceptaron = entradas.filter((e) => e.tipo === 'cadena_aceptada');
  const rechazaron = entradas.filter((e) => e.tipo === 'cadena_rechazada');
  const votos = entradas.filter((e) => e.tipo === 'voto');
  let principal = entradas[0];
  for (const e of entradas) {
    if ((PRIORIDAD[e.tipo] ?? 35) >= (PRIORIDAD[principal.tipo] ?? 35)) principal = e;
  }
  const n = narrarEvento(principal, estado);
  const extras = [];
  if (aceptaron.length > 1 || (aceptaron.length && principal.tipo !== 'cadena_aceptada')) {
    extras.push(`${plural(aceptaron.length, 'institución revisó', 'instituciones revisaron')} el libro por su cuenta y lo ${aceptaron.length === 1 ? 'adoptó' : 'adoptaron'}.`);
  }
  if (rechazaron.length && principal.tipo !== 'cadena_rechazada') {
    extras.push(`${plural(rechazaron.length, 'institución lo rechazó', 'instituciones lo rechazaron')}.`);
  }
  if (votos.length > 1 && !['ronda_aceptada', 'ronda_rechazada'].includes(principal.tipo)) {
    const si = votos.filter((v) => v.datos?.voto).length;
    extras.push(`Votaron ${votos.length}: ${si} a favor, ${votos.length - si} en contra.`);
  }
  // ronda automática PoS: si hubo rechazos antes del folio aceptado, que no se pierdan
  const rechazos = entradas.filter((e) => e.tipo === 'ronda_rechazada');
  if (rechazos.length && principal.tipo !== 'ronda_rechazada') {
    extras.unshift(`Antes, ${rechazos.map((e) => `${S(e.nodo)} (−${num(e.datos?.monto)} créditos)`).join(', ')} ${rechazos.length === 1 ? 'propuso un folio inválido, fue castigada' : 'propusieron folios inválidos, fueron castigadas'} y se volvió a sortear.`);
  }
  if (principal.tipo === 'cadena_aceptada' && aceptaron.length > 1) {
    n.titulo = 'El consorcio revisa el folio';
    n.texto = `${plural(aceptaron.length, 'institución revisó', 'instituciones revisaron')} el libro completo (huellas, enlaces entre folios, firmas y créditos) y lo ${aceptaron.length === 1 ? 'adoptó' : 'adoptaron'}: el folio queda sellado en sus copias del libro de registros.`;
    extras.length = 0;
  }
  if (extras.length) n.detalle = extras.join(' ');
  return n;
}

/** Siguiente paso sugerido según el estado (lo que una persona estudiante haría ahora). */
export function siguientePaso(estado, modo) {
  if (!estado?.existe) {
    const m = MODO_ACADEMICO[modo];
    const cual = m ? `para el ${m.lema} (${m.nombre})` : `en ${nombreModo(modo)}`;
    return { texto: `Para empezar, forma un consorcio ${cual}: elige cuántas instituciones participan y pulsa «Formar el consorcio».`, vista: 'red', etiqueta: 'Ir a formar el consorcio' };
  }
  const nodos = estado.nodos || [];
  const corrupto = nodos.find((n) => n.conectado && !n.cadena_integra);
  if (corrupto) return { texto: `La copia del libro de ${S(corrupto.id)} fue alterada: sincronízala para que la reemplace por una válida.`, nodo: corrupto.id, etiqueta: `Abrir ${S(corrupto.id)}` };
  const t = estado.trabajo;
  if (modo === 'pow' && t?.estado === 'minando') {
    return { texto: `Las instituciones selladoras buscan el nonce del folio #${t.numero_bloque} (ronda ${num(t.ronda)}). Mira cómo avanza cada una por su carril.`, vista: 'pow_arena', etiqueta: 'Ver el sellado' };
  }
  const r = estado.ronda;
  if (modo === 'pos' && r?.activa) {
    return { texto: `La ronda #${r.id} está en la fase ${r.fase}. Avánzala paso a paso para ver el sorteo y la votación.`, vista: 'pos_escenario', etiqueta: 'Ir a los avales' };
  }
  const desfasado = nodos.find((n) => n.conectado && n.cadena_integra && !n.sincronizado);
  if (desfasado) return { texto: `${S(desfasado.id)} está conectada pero atrasada: sincronízala para que adopte el libro más completo.`, nodo: desfasado.id, etiqueta: `Abrir ${S(desfasado.id)}` };
  if (!estado.pendientes_total) {
    return { texto: 'No hay registros en espera: registra una credencial (o varias al azar) para tener algo que sellar en el próximo folio.', vista: 'transacciones', etiqueta: 'Registrar credencial' };
  }
  if (modo === 'pow') {
    const madura = (estado.recompensas?.items || []).find((i) => i.estado === 'pendiente');
    const extra = madura ? ` Los créditos ganados en el folio #${madura.bloque} maduran en el #${madura.madura_en}.` : '';
    return { texto: `Hay ${plural(estado.pendientes_total, 'registro en espera', 'registros en espera')}: inicia el sellado para cerrarlos en un folio.${extra}`, vista: 'pow_arena', etiqueta: 'Sellar registros' };
  }
  return { texto: `Hay ${plural(estado.pendientes_total, 'registro en espera', 'registros en espera')}: inicia una ronda para que las instituciones avaladoras apuesten y avalen el siguiente folio.`, vista: 'pos_escenario', etiqueta: 'Iniciar ronda de avales' };
}

// ------------------------------------------------------------------- panel
const ICONO_NIVEL = { ok: 'ok', aviso: 'alerta', error: 'x', info: 'onda' };

export class Narrador {
  /** host: contenedor; navegar(vista), abrirNodo(id) y alRecorrido() los pone el shell; anunciar → región viva. */
  constructor(host, { navegar, abrirNodo, anunciar, alRecorrido = null }) {
    this.navegar = navegar;
    this.abrirNodo = abrirNodo;
    this.anunciar = anunciar;
    this.historial = [];
    this.icono = h('span.narrador__icono', icono('onda'));
    this.titulo = h('p.narrador__titulo');
    this.texto = h('p.narrador__texto', { id: 'narrador-texto' });
    this.detalle = h('p.narrador__detalle');
    this.paso = h('p.narrador__paso-texto');
    this.botonPaso = h('button.boton.boton--secundario.boton--chico', { type: 'button' });
    this.botonPaso.addEventListener('click', () => this._accion());
    // en móvil el texto se recorta a pocas líneas: este botón lo despliega
    this.mas = h('button.narrador__mas', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'narrador-texto' }, 'Leer todo');
    this.mas.addEventListener('click', () => {
      const abierto = host.toggleAttribute('data-expandido');
      attr(this.mas, 'aria-expanded', String(abierto));
      texto(this.mas, abierto ? 'Leer menos' : 'Leer todo');
    });
    const recorrido = alRecorrido
      ? h('button.boton.boton--fantasma.boton--chico.narrador__recorrido', { type: 'button', 'aria-label': 'Ver el recorrido guiado', title: 'Ver el recorrido guiado', on: { click: () => alRecorrido() } }, icono('recorrido'), h('span', 'Ver el recorrido'))
      : null;
    this.lista = h('ol.narrador__historial', { role: 'list', 'aria-label': 'Narraciones anteriores' });
    host.replaceChildren(
      h('div.narrador__cabecera', h('h2.etiqueta-instrumento', { id: 'narrador-titulo' }, '¿Qué está pasando?'), h('span.narrador__vivo', { 'aria-hidden': 'true' }), recorrido),
      h('div.narrador__actual', this.icono, h('div.narrador__cuerpo', this.titulo, this.texto, this.detalle, this.mas)),
      h('div.narrador__paso', h('span.etiqueta-instrumento', 'Siguiente paso'), this.paso, this.botonPaso),
      this.lista,
    );
    host.setAttribute('aria-labelledby', 'narrador-titulo');
    this.host = host;
    this.actual = host.querySelector('.narrador__actual');
    this.siguiente = null;
  }

  _accion() {
    const s = this.siguiente;
    if (!s) return;
    if (s.nodo) this.abrirNodo?.(s.nodo);
    else if (s.vista) this.navegar?.(s.vista);
  }

  /** Muestra una narración { titulo, texto, nivel, detalle? }. `anunciar` la lee en voz. */
  mostrar(n, { anunciar = true } = {}) {
    if (!n) return;
    const clave = `${n.titulo}|${n.texto}|${n.detalle || ''}`;
    if (clave === this._ultima) return;
    if (this._ultimaN) {
      this.historial.unshift(this._ultimaN);
      this.historial = this.historial.slice(0, 3);
      this.lista.replaceChildren(...this.historial.map((x) => h('li', { dataset: { nivel: x.nivel || 'info' } }, h('strong', x.titulo), ' ', x.texto)));
    }
    this._ultima = clave;
    this._ultimaN = n;
    attr(this.actual, 'data-nivel', n.nivel || 'info');
    this.icono.replaceChildren(icono(ICONO_NIVEL[n.nivel] || 'onda'));
    texto(this.titulo, n.titulo);
    texto(this.texto, n.texto);
    texto(this.detalle, n.detalle || '');
    this.detalle.hidden = !n.detalle;
    // cada narración nueva vuelve a la vista compacta (móvil); «Leer todo» solo si hay algo recortado
    this.host.removeAttribute('data-expandido');
    attr(this.mas, 'aria-expanded', 'false');
    texto(this.mas, 'Leer todo');
    requestAnimationFrame(() => {
      if (this.host.hasAttribute('data-expandido')) return;
      this.mas.hidden = !n.detalle && this.texto.scrollHeight <= this.texto.clientHeight + 1;
    });
    animar(this.actual, [{ opacity: 0.2, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: DUR.entrada, easing: CURVA.firma });
    if (anunciar) this.anunciar?.(`${n.titulo}. ${n.texto}`);
  }

  /** Actualiza la sugerencia de siguiente paso. */
  sugerir(s) {
    this.siguiente = s;
    const contenedor = this.paso.parentElement;
    contenedor.hidden = !s;
    if (!s) return;
    texto(this.paso, s.texto);
    this.botonPaso.hidden = !(s.vista || s.nodo);
    texto(this.botonPaso, s.etiqueta || 'Ir');
  }

  reiniciar() {
    this.historial = [];
    this._ultima = null;
    this._ultimaN = null;
    this.lista.replaceChildren();
  }
}
