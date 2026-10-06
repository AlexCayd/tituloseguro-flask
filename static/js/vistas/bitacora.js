// VISTA · Bitácora
// Línea de tiempo (orden cronológico, lo nuevo abajo) con filtros por nivel y tipo (en el
// servidor) y por nodo (en el cliente), iconos propios por tipo, nodo clicable que se resalta en
// el anillo, tiempo lógico y «seguir en vivo» que se pausa solo si el usuario sube a leer.
// Carga: GET /api/<modo>/bitacora?limite=&nivel=&tipo= y luego ?desde_seq= para lo nuevo.

import { sigla, rotulo, conInstituciones } from '../dominio.js';

const TIPOS = {
  simulacion_creada: ['Consorcio formado', 'institucion', 'red'],
  bloque_difundido: ['Folio enviado al consorcio', 'onda', 'red'],
  cadena_aceptada: ['Libro aceptado', 'capas', 'red'],
  cadena_rechazada: ['Libro rechazado', 'escudo', 'red'],
  nodo_conexion: ['Conexión', 'conectado', 'red'],
  nodo_sincronizado: ['Sincronización', 'sync', 'red'],
  autopiloto_detenido: ['Sellado automático detenido', 'pausa', 'red'],
  tx_aceptada: ['Credencial registrada', 'diploma', 'tx'],
  tx_rechazada: ['Registro de credencial rechazado', 'diploma', 'tx'],
  tx_descartada: ['Registro en espera retirado', 'x', 'tx'],
  trabajo_inicio: ['Empieza el sellado', 'buscar', 'pow'],
  ganador: ['Folio sellado (nonce hallado)', 'sello', 'pow'],
  empate_ronda: ['Empate en la ronda', 'empate', 'pow'],
  recompensa_pendiente: ['Créditos ganados por madurar', 'reloj', 'pow'],
  recompensa_madura: ['Créditos ganados disponibles', 'moneda', 'pow'],
  trabajo_limite: ['Se agotaron las rondas', 'alerta', 'pow'],
  trabajo_cancelado: ['Sellado cancelado', 'pausa', 'pow'],
  trabajo_error: ['Sellado interrumpido', 'alerta', 'pow'],
  nodo_deshonesto: ['Institución deshonesta', 'mascara', 'pos'],
  ronda_inicio: ['Ronda de avales iniciada', 'play', 'pos'],
  apuestas_fijadas: ['Apuestas cerradas', 'apuesta', 'pos'],
  sorteo: ['Sorteo', 'ruleta', 'pos'],
  candidato: ['Folio propuesto', 'bloque', 'pos'],
  voto: ['Voto', 'voto', 'pos'],
  ronda_aceptada: ['Folio avalado', 'ok', 'pos'],
  ronda_rechazada: ['Folio rechazado', 'x', 'pos'],
  castigo: ['Castigo', 'martillo', 'pos'],
  ronda_abortada: ['Ronda interrumpida', 'alerta', 'pos'],
  ataque: ['Intento de falsificación', 'escudo', 'lab'],
  corrupcion_local: ['Copia alterada', 'grieta', 'lab'],
};
const GRUPOS = { red: 'Consorcio y libro de registros', tx: 'Registros de credenciales', pow: 'Sellado (Proof of Work)', pos: 'Avales (Proof of Stake)', lab: 'Falsificaciones' };
const NIVELES = [['', 'Todo'], ['info', 'Información'], ['ok', 'Correcto'], ['aviso', 'Aviso'], ['error', 'Error']];
const LIMITE_INICIAL = 200;
const LIMITE_MAX = 500;
const RE_ID = /^N\d{2}$/;

export default {
  id: 'bitacora',
  titulo: 'Bitácora',
  icono: 'libro',
  modos: ['pow', 'pos'],
  orden: 60,
  descripcion: 'Todo lo que pasó en el libro de registros, en orden y con su tiempo lógico. Pulsa una institución para localizarla en el anillo.',

  montar(host, ctx) {
    const L = (ctx.local = {
      entradas: [], ultimoSeq: 0, epoca: null, limite: LIMITE_INICIAL, seguir: true, nuevasSinVer: 0,
      filtro: { nivel: '', tipo: '', nodo: '' }, cargando: false,
    });
    construir(host, ctx);
    // lo nuevo llega por el sondeo del shell, aunque la vista esté oculta
    ctx.alEvento((entradas, estado) => recibir(ctx, entradas, estado));
    // si entre dos sondeos hubo más eventos de los que trae el estado (30), se piden los que faltan
    ctx.alEstado((estado, cambios) => {
      if (estado?.existe && estado.epoca === L.epoca && cambios.huecoBitacora) cargarNuevas(ctx);
    });
  },

  mostrar(ctx) {
    if (ctx.local.seguir) alFinal(ctx);
  },

  actualizar(e, ctx) {
    const L = ctx.local;
    // red nueva (o primera vez visible): carga completa una sola vez por época
    if (L.epoca !== e.epoca && L.pidiendo !== e.epoca) { L.pidiendo = e.epoca; cargar(ctx); }
    const clave = (e.ids || []).join(',');
    if (L.idsClave !== clave) {
      L.idsClave = clave;
      L.selNodo.replaceChildren(ctx.h('option', { value: '' }, 'Todas las instituciones'), ...e.ids.map((id) => ctx.h('option', { value: id }, `${sigla(id)} — ${id}`)));
      L.selNodo.value = e.ids.includes(L.filtro.nodo) ? L.filtro.nodo : '';
    }
    ctx.dom.texto(L.total, `${ctx.fmt.num(e.bitacora_seq)} eventos en total`);
  },
};

function construir(host, ctx) {
  const { h, icono, modo } = ctx;
  const L = ctx.local;
  const id = (x) => `bit-${modo}-${x}`;

  const niveles = h('div.segmentado.bit-niveles', { role: 'radiogroup', 'aria-label': 'Filtrar por nivel' },
    NIVELES.map(([v, t]) => h('label', { dataset: { nivel: v || 'todo' } },
      h('input', { type: 'radio', name: id('nivel'), value: v, checked: v === '' }), t)));
  niveles.addEventListener('change', () => { L.filtro.nivel = niveles.querySelector('input:checked').value; cargar(ctx); });

  const selTipo = h('select.selector', { id: id('tipo'), 'aria-label': 'Filtrar por tipo de evento' },
    h('option', { value: '' }, 'Todos los tipos'),
    Object.entries(GRUPOS).filter(([g]) => g !== (modo === 'pow' ? 'pos' : 'pow')).map(([g, nombre]) => h('optgroup', { label: nombre },
      Object.entries(TIPOS).filter(([, v]) => v[2] === g).map(([k, v]) => h('option', { value: k }, v[0])))));
  selTipo.addEventListener('change', () => { L.filtro.tipo = selTipo.value; cargar(ctx); });

  const selNodo = h('select.selector', { id: id('nodo'), 'aria-label': 'Filtrar por institución' }, h('option', { value: '' }, 'Todas las instituciones'));
  selNodo.addEventListener('change', () => { L.filtro.nodo = selNodo.value; pintarTodo(ctx); });

  const seguir = h('button.interruptor', { type: 'button', role: 'switch', 'aria-checked': 'true' }, 'Seguir en vivo');
  seguir.addEventListener('click', () => fijarSeguir(ctx, !L.seguir));

  const lista = h('ol.bit-lista', { role: 'list', 'aria-label': 'Eventos de la bitácora', tabindex: '0' });
  lista.addEventListener('scroll', () => {
    const cerca = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 48;
    if (cerca && !L.seguir && L.nuevasSinVer) fijarSeguir(ctx, true);
    else if (!cerca && L.seguir && !L.desplazandoSolo) fijarSeguir(ctx, false);
  }, { passive: true });
  lista.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-nodo-bit]') : null;
    if (!b) return;
    ctx.red.resaltar(b.dataset.nodoBit);
    ctx.ui.anunciar(`${rotulo(b.dataset.nodoBit)} resaltada en el anillo.`);
  });

  const nuevas = h('button.boton.boton--primario.boton--chico.bit-nuevas', { type: 'button', hidden: true }, icono('abajo'), h('span'));
  nuevas.addEventListener('click', () => fijarSeguir(ctx, true));

  const mas = h('button.boton.boton--fantasma.boton--chico', { type: 'button', hidden: true }, `Cargar más (hasta ${LIMITE_MAX})`);
  mas.addEventListener('click', () => { L.limite = LIMITE_MAX; cargar(ctx); });
  const resumen = h('p.bit-resumen.texto-3', { 'aria-live': 'polite' });
  const total = h('span.bit-total.texto-3');
  const vacio = h('div.bit-vacio', { hidden: true });

  Object.assign(L, { lista, seguir: true, seguirBtn: seguir, nuevas, mas, resumen, total, vacio, selNodo, selTipo, niveles });
  host.append(h('div.bit',
    h('div.bit-barra',
      niveles,
      h('div.bit-barra__selects', selTipo, selNodo),
      h('div.bit-barra__vivo', seguir, total)),
    h('div.bit-cabeza', resumen, mas),
    h('div.bit-marco', lista, vacio, nuevas),
  ));
}

function fijarSeguir(ctx, valor) {
  const L = ctx.local;
  L.seguir = valor;
  L.seguirBtn.setAttribute('aria-checked', String(valor));
  if (valor) {
    L.nuevasSinVer = 0;
    L.nuevas.hidden = true;
    alFinal(ctx);
  }
}

function alFinal(ctx) {
  const L = ctx.local;
  L.desplazandoSolo = true;
  L.lista.scrollTop = L.lista.scrollHeight;
  requestAnimationFrame(() => { L.desplazandoSolo = false; });
}

async function cargar(ctx) {
  const L = ctx.local;
  const e = ctx.estado();
  if (!e?.existe) return;
  const yo = (L.peticion = (L.peticion || 0) + 1);
  L.lista.setAttribute('aria-busy', 'true');
  try {
    const r = await ctx.api.get('bitacora', { limite: L.limite, nivel: L.filtro.nivel || undefined, tipo: L.filtro.tipo || undefined });
    if (yo !== L.peticion) return;
    L.pidiendo = null;
    L.entradas = r.entradas;
    L.ultimoSeq = r.seq;
    L.epoca = e.epoca;
    L.mas.hidden = !(r.entradas.length >= L.limite && L.limite < LIMITE_MAX);
    pintarTodo(ctx);
  } catch (err) {
    if (yo === L.peticion) L.pidiendo = null;      // se reintentará en el próximo estado
    if (err?.name === 'ErrorApi') ctx.ui.mostrarError(err);   // la caída de red ya la avisa el shell
  } finally {
    if (yo === L.peticion) L.lista.removeAttribute('aria-busy');
  }
}

async function cargarNuevas(ctx) {
  const L = ctx.local;
  try {
    const r = await ctx.api.get('bitacora', { desde_seq: L.ultimoSeq, limite: LIMITE_MAX, nivel: L.filtro.nivel || undefined, tipo: L.filtro.tipo || undefined });
    agregar(ctx, r.entradas);
    L.ultimoSeq = Math.max(L.ultimoSeq, r.seq);
  } catch (err) {
    if (err?.name !== 'ErrorApi') ctx.ui.mostrarError(err);
  }
}

function recibir(ctx, entradas, estado) {
  const L = ctx.local;
  if (L.epoca === null || estado.epoca !== L.epoca) return;      // la carga completa se encarga
  const f = L.filtro;
  const nuevas = entradas.filter((x) => x.seq > L.ultimoSeq && (!f.nivel || x.nivel === f.nivel) && (!f.tipo || x.tipo === f.tipo));
  L.ultimoSeq = Math.max(L.ultimoSeq, ...entradas.map((x) => x.seq));
  agregar(ctx, nuevas);
}

function agregar(ctx, nuevas) {
  const L = ctx.local;
  const vistos = new Set(L.entradas.map((x) => x.seq));
  const frescas = nuevas.filter((x) => !vistos.has(x.seq));
  if (!frescas.length) return;
  L.entradas.push(...frescas);
  if (L.entradas.length > 1000) L.entradas.splice(0, L.entradas.length - 1000);
  const visibles = frescas.filter((x) => pasaNodo(x, L.filtro.nodo));
  const els = visibles.map((x) => fila(x, ctx));
  L.lista.append(...els);
  while (L.lista.childElementCount > 1000) L.lista.firstElementChild.remove();
  pintarResumen(ctx);
  if (L.seguir) {
    alFinal(ctx);
    if (els.length <= 6) els.forEach((el, i) => ctx.anim.entrar(el, { retraso: i * 18 }));
  } else if (visibles.length) {
    L.nuevasSinVer += visibles.length;
    L.nuevas.hidden = false;
    L.nuevas.querySelector('span').textContent = `${L.nuevasSinVer} ${L.nuevasSinVer === 1 ? 'nueva' : 'nuevas'}`;
  }
}

function pasaNodo(x, nodo) { return !nodo || x.nodo === nodo; }

function pintarTodo(ctx) {
  const L = ctx.local;
  const visibles = L.entradas.filter((x) => pasaNodo(x, L.filtro.nodo));
  L.lista.replaceChildren(...visibles.map((x) => fila(x, ctx)));
  pintarResumen(ctx);
  if (L.seguir) alFinal(ctx);
}

function pintarResumen(ctx) {
  const L = ctx.local;
  const visibles = L.lista.childElementCount;
  const hayFiltro = L.filtro.nivel || L.filtro.tipo || L.filtro.nodo;
  L.vacio.hidden = visibles > 0;
  L.lista.hidden = visibles === 0;
  if (!visibles) {
    L.vacio.replaceChildren(ctx.ui.vacio({
      icono: 'libro',
      titulo: hayFiltro ? 'Ningún evento con estos filtros' : 'Todavía no hay eventos',
      texto: hayFiltro ? 'Prueba con «Todo» o elige otro tipo de evento u otra institución.' : 'Cada acción sobre el consorcio (registros de credenciales, folios sellados, conexiones, falsificaciones…) quedará anotada aquí.',
    }));
  }
  ctx.dom.texto(L.resumen, `Mostrando ${ctx.fmt.plural(visibles, 'evento', 'eventos')}${hayFiltro ? ' que cumplen los filtros' : ''}.`);
}

function fila(x, ctx) {
  const { h, icono, fmt, ui } = ctx;
  const [nombre, ico] = TIPOS[x.tipo] || [x.tipo, 'info'];
  const icoReal = x.tipo === 'nodo_conexion' && /desconecta/.test(x.texto) ? 'desconectado' : ico;
  const datos = Object.entries(x.datos || {}).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object');
  return h('li.bit-item', { dataset: { nivel: x.nivel, tipo: x.tipo } },
    h('span.bit-item__t.mono', { title: `Reloj lógico ${x.t} · evento #${x.seq}` }, fmt.tiempo(x.t)),
    h('span.bit-item__icono', icono(icoReal)),
    h('div.bit-item__cuerpo',
      h('p.bit-item__cabeza',
        h('span.bit-item__tipo', nombre),
        x.nodo ? h('button.bit-item__nodo', { type: 'button', dataset: { nodoBit: x.nodo }, title: `${rotulo(x.nodo)} (${x.nodo})`, 'aria-label': `Resaltar ${rotulo(x.nodo)} en el anillo` },
          h('span.bit-item__sigla', sigla(x.nodo)), h('span.bit-item__id', x.nodo)) : null,
        h('span.bit-item__seq.mono', `#${x.seq}`)),
      h('p.bit-item__texto', conInstituciones(x.texto)),
      datos.length ? h('dl.bit-item__datos', datos.slice(0, 6).map(([k, v]) => h('div',
        h('dt', k),
        h('dd', typeof v === 'string' && /^[0-9a-f]{40,}$/.test(v) ? ui.hash(v, { n: 4, ceros: k === 'hash', etiqueta: k, plano: true })
          : typeof v === 'string' && RE_ID.test(v) ? `${v} · ${sigla(v)}` : String(v))))) : null,
    ),
  );
}
