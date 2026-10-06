// Estado por modo + sondeo + detección de diferencias.
//
// Eventos (store.on(nombre, fn) → devuelve la función para desuscribirse):
//   'estado'          (modo, estado, cambios)   — llegó un estado nuevo (ver diferencias())
//   'eventos'         (modo, entradas, estado)  — entradas NUEVAS de la bitácora (seq creciente)
//   'conexion'        (estado: 'ok' | 'caida' | 'pausa')
//   'epoca_obsoleta'  (modo)                    — otra pestaña reinició la red
//   'error'           (modo, error)
//
// Reglas de sondeo: solo el modo activo; cada `sondeo_ms` (250 carrera PoW, 1000 ronda PoS,
// 2000 reposo); con `desde=rev&epoca=` para recibir {sin_cambios}; pausa con la pestaña oculta;
// backoff exponencial (1 s → 15 s) ante fallos de red REALES. Un 4xx no es fallo de red.

import { api, ErrorRed } from './api.js';

const SONDEO_SIN_RED = 5000;

function vacio() {
  return { estado: null, timer: 0, enVuelo: false, repetir: false, completo: false, fallos: 0, version: 0 };
}

/** ¿`nuevo` es anterior a `actual`? (misma época y rev menor) */
function esMasViejo(nuevo, actual) {
  return !!(actual?.existe && nuevo?.existe && nuevo.epoca === actual.epoca && nuevo.rev < actual.rev);
}

export class Store {
  constructor() {
    this.modos = { pow: vacio(), pos: vacio() };
    this.activo = 'pow';
    this.conexion = 'ok';
    this.oyentes = new Map();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        for (const m of Object.values(this.modos)) clearTimeout(m.timer);
        this._conexion('pausa');
      } else {
        this.refrescar(this.activo);
      }
    });
  }

  // --------------------------------------------------------------- eventos
  on(evento, fn) {
    if (!this.oyentes.has(evento)) this.oyentes.set(evento, new Set());
    this.oyentes.get(evento).add(fn);
    return () => this.oyentes.get(evento)?.delete(fn);
  }

  emitir(evento, ...args) {
    for (const fn of this.oyentes.get(evento) || []) {
      try { fn(...args); } catch (e) { console.error(`[store] oyente de «${evento}» falló`, e); }
    }
  }

  // ---------------------------------------------------------------- lectura
  estado(modo = this.activo) { return this.modos[modo]?.estado || null; }
  existe(modo = this.activo) { return !!this.modos[modo]?.estado?.existe; }
  epoca(modo = this.activo) { return this.modos[modo]?.estado?.epoca ?? null; }
  nodo(modo, id) { return this.estado(modo)?.nodos?.find((n) => n.id === id) || null; }

  // ---------------------------------------------------------------- control
  activar(modo) {
    if (!this.modos[modo]) return;
    for (const [m, s] of Object.entries(this.modos)) if (m !== modo) clearTimeout(s.timer);
    this.activo = modo;
    this.refrescar(modo);
  }

  /** Pide el estado ya (si hay una petición en vuelo, repite al terminar). */
  async refrescar(modo = this.activo, { completo = false } = {}) {
    const m = this.modos[modo];
    if (!m) return;
    if (completo) m.completo = true;
    if (m.enVuelo) { m.repetir = true; return; }
    clearTimeout(m.timer);
    m.enVuelo = true;
    try {
      const e = m.estado;
      const q = !m.completo && e?.existe ? { desde: e.rev, epoca: e.epoca } : undefined;
      m.completo = false;
      const version = m.version;
      const datos = await api.get(`/api/${modo}/estado`, q);
      m.fallos = 0;
      this._conexion('ok');
      // descarta respuestas viejas: alguien fijó un estado mientras esta petición viajaba
      if (m.version !== version) m.repetir = true;
      else if (!datos.sin_cambios && !esMasViejo(datos, m.estado)) this.establecer(modo, datos);
    } catch (err) {
      if (err instanceof ErrorRed) {
        m.fallos += 1;
        this._conexion('caida');
      } else {
        this.emitir('error', modo, err);
      }
    } finally {
      m.enVuelo = false;
      if (m.repetir) {
        m.repetir = false;
        this.refrescar(modo);
      } else {
        this._programar(modo);
      }
    }
  }

  _programar(modo) {
    const m = this.modos[modo];
    clearTimeout(m.timer);
    if (modo !== this.activo || document.hidden) return;
    const base = m.estado?.existe ? (m.estado.sondeo_ms || 2000) : SONDEO_SIN_RED;
    const espera = m.fallos ? Math.min(15000, 1000 * 2 ** (m.fallos - 1)) : base;
    m.timer = setTimeout(() => this.refrescar(modo), espera);
  }

  _conexion(valor) {
    if (this.conexion === valor) return;
    this.conexion = valor;
    this.emitir('conexion', valor);
  }

  /** Fija un estado completo (sondeo o respuesta de creación) y avisa con las diferencias. */
  establecer(modo, nuevo, { creada = false } = {}) {
    const m = this.modos[modo];
    const previo = m.estado;
    const cambios = diferencias(previo, nuevo, { creada });
    m.estado = nuevo;
    m.version += 1;
    this.emitir('estado', modo, nuevo, cambios);
    if (cambios.eventos.length) this.emitir('eventos', modo, cambios.eventos, nuevo);
    if (modo === this.activo) this._programar(modo);
  }
}

/**
 * Diferencias útiles para animar y narrar entre dos estados del MISMO modo.
 * {
 *   primera,          // no había estado previo (carga inicial): no animar «historia»
 *   creada,           // la red se acaba de crear desde esta pestaña
 *   epocaCambio,      // la red fue reiniciada (aquí o en otra pestaña)
 *   existeCambio,     // pasó de no existir a existir o al revés
 *   altura: { antes, despues } | null,
 *   cabezas: [ids],   // nodos cuya cabeza (hash) cambió
 *   recibieron: [ids] // nodos cuya altura SUBIÓ (recibieron bloque o se sincronizaron)
 *   origen,           // quién originó el último bloque (si se puede saber) o null
 *   conexion: [ids], sincronia: [ids], deshonesto: [ids], integridad: [ids],
 *   eventos: [entradas nuevas de bitácora], huecoBitacora: bool,
 *   trabajo: { antes, despues } | null,   // estados de la carrera PoW
 *   fase: { antes, despues } | null,      // fase de la ronda PoS
 *   pendientes: { antes, despues } | null,
 * }
 */
export function diferencias(previo, nuevo, { creada = false } = {}) {
  const c = {
    primera: !previo, creada, epocaCambio: false, existeCambio: false,
    altura: null, cabezas: [], recibieron: [], origen: null,
    conexion: [], sincronia: [], deshonesto: [], integridad: [],
    eventos: [], huecoBitacora: false, trabajo: null, fase: null, pendientes: null,
  };
  if (!nuevo) return c;
  const existiaAntes = !!previo?.existe;
  c.existeCambio = existiaAntes !== !!nuevo.existe;
  if (!nuevo.existe) return c;
  c.epocaCambio = existiaAntes && previo.epoca !== nuevo.epoca;
  if (!existiaAntes || c.epocaCambio) {
    // red nueva: los eventos son «actuales» solo si la acabamos de crear o cambió la época
    if (creada || c.epocaCambio || c.existeCambio && !c.primera) c.eventos = nuevo.bitacora || [];
    return c;
  }
  if (previo.altura !== nuevo.altura) c.altura = { antes: previo.altura, despues: nuevo.altura };

  const antes = new Map((previo.nodos || []).map((n) => [n.id, n]));
  for (const n of nuevo.nodos || []) {
    const a = antes.get(n.id);
    if (!a) continue;
    if (a.hash_cabeza !== n.hash_cabeza) c.cabezas.push(n.id);
    if (n.altura > a.altura) c.recibieron.push(n.id);
    if (a.conectado !== n.conectado) c.conexion.push(n.id);
    if (a.sincronizado !== n.sincronizado) c.sincronia.push(n.id);
    if (a.deshonesto !== n.deshonesto || a.trampa !== n.trampa) c.deshonesto.push(n.id);
    if (a.cadena_integra !== n.cadena_integra) c.integridad.push(n.id);
  }
  if (c.recibieron.length) {
    const ur = nuevo.ultimo_resultado;
    const prop = nuevo.cabeza?.proponente;
    if (ur && ur.bloque === nuevo.altura && c.recibieron.includes(ur.proponente)) c.origen = ur.proponente;
    else if (prop && c.recibieron.includes(prop) && c.altura) c.origen = prop;
  }

  const seqPrevio = previo.bitacora_seq || 0;
  c.eventos = (nuevo.bitacora || []).filter((e) => e.seq > seqPrevio);
  const primeraNueva = (nuevo.bitacora || [])[0]?.seq;
  c.huecoBitacora = nuevo.bitacora_seq - seqPrevio > (nuevo.bitacora || []).length && primeraNueva > seqPrevio + 1;

  const ta = previo.trabajo?.estado ?? null;
  const tb = nuevo.trabajo?.estado ?? null;
  if (ta !== tb || previo.trabajo?.id !== nuevo.trabajo?.id) c.trabajo = { antes: ta, despues: tb };

  const fa = previo.ronda?.fase ?? null;
  const fb = nuevo.ronda?.fase ?? null;
  if (fa !== fb || previo.ronda?.id !== nuevo.ronda?.id || previo.ronda?.intento !== nuevo.ronda?.intento) c.fase = { antes: fa, despues: fb };

  if (previo.pendientes_total !== nuevo.pendientes_total) c.pendientes = { antes: previo.pendientes_total, despues: nuevo.pendientes_total };
  return c;
}
