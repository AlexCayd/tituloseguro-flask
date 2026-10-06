// LA ÓRBITA DE CONSENSO — la red viva de instituciones, elemento firma de Título Seguro.
//
// Lectura del instrumento:
//   · Cada nodo es una INSTITUCIÓN (su sigla fuera del anillo; debajo, su id técnico y la cola de la
//     huella de su cabeza). Nombre completo y tipo en el tooltip y en la etiqueta accesible. Su HALO toma el color derivado de la huella de su
//     cabeza: mismo color = misma cadena. Cuando un bloque se difunde, el color nuevo recorre
//     el anillo de nodo en nodo.
//   · En sincronía → sobre la órbita. Desfasado → deriva hacia fuera. Desconectado → más fuera,
//     hueco y punteado. Cadena corrupta → contorno roto en rojo. Deshonesto → rombo rojo.
//   · El núcleo muestra la altura de la cadena de referencia y cuántos nodos la comparten.
//
// API pública (el shell la expone a las vistas como ctx.red):
//   actualizar(estado, cambios)   previsualizar(n | null)   despertar()
//   seleccionar(id | null)        resaltar(id, ms?)         destello(id, 'rechazo'|'defensa'|'acento')
//   difundir(origen | null, destinos[])                     marcar(id, clase, activa)
//   posicion(id) → {x, y, angulo} | null                    capa() → <g> SVG para dibujar encima

import { h, s, texto, attr, cssVar } from './util/dom.js';
import { hashCorto, tonoHash, num, plural } from './util/fmt.js';
import { animar, reducido, DUR, CURVA } from './util/anim.js';
import { sigla, nombre, tipo, rotulo, creditos } from './dominio.js';

const R = 160;           // radio de la órbita (unidades del viewBox)
const DERIVA = 22;       // desfasado
const FUERA = 40;        // desconectado
const SEP_ETIQUETA = 30; // distancia de la etiqueta al nodo

function radioNodo(n) { return n <= 12 ? 15 : n <= 16 ? 13.5 : 12; }
function angulo(i, n) { return -Math.PI / 2 + (2 * Math.PI * i) / n; }

export class RedViva {
  constructor(host, { alSeleccionar = () => {} } = {}) {
    this.host = host;
    this.alSeleccionar = alSeleccionar;
    this.nodos = new Map();       // id → { g, cuerpo, halo, altura, etiqueta, idTxt, hashTxt, i, n, r, estado }
    this.orden = [];
    this.seleccionado = null;
    this.foco = null;
    this.estado = null;
    this.modoFantasma = 0;

    this.svg = s('svg.anillo', { viewBox: '-250 -250 500 500', role: 'group', 'aria-roledescription': 'anillo de instituciones', 'aria-label': 'Anillo de instituciones del consorcio' });
    this.pista = s('g.anillo__pista', { 'aria-hidden': 'true' },
      s('circle.anillo__deriva', { r: R + FUERA }),
      s('circle.anillo__orbita', { r: R }),
      s('circle.anillo__marcas', { r: R + 7, pathLength: '360' }),
      s('circle.anillo__interior', { r: R - 52 }),
    );
    this.capaDifusion = s('g.anillo__difusion', { 'aria-hidden': 'true' });
    this.nucleo = this._crearNucleo();
    this.capaNodos = s('g.anillo__nodos');
    this.capaLibre = s('g.anillo__capa-libre', { 'aria-hidden': 'true' });
    this.svg.append(this.pista, this.capaDifusion, this.nucleo, this.capaNodos, this.capaLibre);

    this.tooltip = h('div.anillo__tooltip', { role: 'tooltip', id: 'anillo-tooltip', hidden: true });
    host.replaceChildren(this.svg, this.tooltip);

    this.svg.addEventListener('keydown', (e) => this._teclado(e));
    this.svg.addEventListener('click', (e) => {
      const g = e.target instanceof Element ? e.target.closest('.nodo') : null;
      if (g && !g.classList.contains('nodo--fantasma')) this._elegir(g.dataset.id);
    });
    this.svg.addEventListener('pointerover', (e) => {
      const g = e.target instanceof Element ? e.target.closest('.nodo') : null;
      if (g && !g.classList.contains('nodo--fantasma')) this._mostrarTooltip(g.dataset.id);
    });
    this.svg.addEventListener('pointerleave', () => this._ocultarTooltip());
    this.svg.addEventListener('focusin', (e) => {
      const g = e.target instanceof Element ? e.target.closest('.nodo') : null;
      if (g) { this.foco = g.dataset.id; this._mostrarTooltip(g.dataset.id); }
    });
    this.svg.addEventListener('focusout', () => this._ocultarTooltip());
  }

  // ---------------------------------------------------------------- núcleo
  _crearNucleo() {
    this.nEtiqueta = s('text.nucleo__etiqueta', { y: -40 }, 'FOLIOS');
    this.nAltura = s('text.nucleo__altura', { y: 10 }, '—');
    this.nHash = s('text.nucleo__hash', { y: 38 }, '');
    this.nSinc = s('text.nucleo__sinc', { y: 60 }, '');
    return s('g.anillo__nucleo', { 'aria-hidden': 'true' },
      s('circle.nucleo__disco', { r: R - 62 }),
      this.nEtiqueta, this.nAltura, this.nHash, this.nSinc);
  }

  _pintarNucleo(e) {
    if (!e?.existe) {
      if (this.modoFantasma) {
        texto(this.nEtiqueta, 'VISTA PREVIA');
        texto(this.nAltura, String(this.modoFantasma));
        texto(this.nHash, 'instituciones');
        texto(this.nSinc, 'aún sin formar');
      } else {
        texto(this.nEtiqueta, 'SIN CONSORCIO');
        texto(this.nAltura, '·');
        texto(this.nHash, 'forma el consorcio');
        texto(this.nSinc, 'para empezar');
      }
      cssVar(this.nucleo, '--tono', 255);
      attr(this.nucleo, 'data-vacio', '');
      return;
    }
    attr(this.nucleo, 'data-vacio', null);
    const sinc = e.sincronia || {};
    texto(this.nEtiqueta, 'FOLIOS');
    texto(this.nAltura, e.altura ?? '—');
    texto(this.nHash, e.cabeza ? `huella ${hashCorto(e.cabeza.hash, 4)}` : '');
    texto(this.nSinc, `${sinc.sincronizados ?? 0}/${sinc.total ?? 0} en sincronía`);
    cssVar(this.nucleo, '--tono', tonoHash(e.cabeza?.hash));
    attr(this.nucleo, 'data-desfase', sinc.sincronizados < sinc.total ? '' : null);
  }

  // ---------------------------------------------------------------- nodos
  _crearNodo(id, i, n) {
    const r = radioNodo(n);
    const halo = s('circle.nodo__halo', { r: r + 5 });
    const rol = s('circle.nodo__rol', { r: r + 10, pathLength: '100' });
    const cuerpo = s('circle.nodo__cuerpo', { r });
    const altura = s('text.nodo__altura', { y: 0.5 }, '');
    const marca = s('path.nodo__marca', { d: `M ${r * 0.7} ${-r - 2} l 5 5 l -5 5 l -5 -5 z` });
    const idTxt = s('text.nodo__id', '');
    // segunda línea: id técnico + cola de la huella (la huella se oculta en anillos pequeños)
    const tecTxt = s('tspan.nodo__tec', id);
    const colaTxt = s('tspan.nodo__cola', '');
    const hashTxt = s('text.nodo__hash', tecTxt, colaTxt);
    const etiqueta = s('g.nodo__etiqueta', idTxt, hashTxt);
    const g = s('g.nodo', { dataset: { id }, tabindex: '-1', role: 'button', 'aria-describedby': 'anillo-tooltip' },
      rol, halo, cuerpo, altura, marca, etiqueta);
    texto(idTxt, sigla(id));
    const reg = { g, cuerpo, halo, rol, altura, etiqueta, idTxt, hashTxt, colaTxt, i, n, r, radio: R, tono: null };
    this._colocar(reg, R, true);
    return reg;
  }

  _colocar(reg, radio, inmediato = false) {
    const a = angulo(reg.i, reg.n);
    const x = Math.cos(a) * radio;
    const y = Math.sin(a) * radio;
    reg.radio = radio;
    reg.x = x; reg.y = y; reg.angulo = a;
    if (inmediato) reg.g.classList.add('sin-transicion');
    reg.g.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    if (inmediato) requestAnimationFrame(() => reg.g.classList.remove('sin-transicion'));
    // etiqueta radial: siempre hacia fuera, con el ancla según el lado
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const ex = c * SEP_ETIQUETA;
    const ey = sn * SEP_ETIQUETA;
    const ancla = Math.abs(c) < 0.35 ? 'middle' : c > 0 ? 'start' : 'end';
    attr(reg.idTxt, 'x', ex.toFixed(1));
    attr(reg.hashTxt, 'x', ex.toFixed(1));
    const base = Math.abs(c) < 0.35 ? (sn < 0 ? ey - 6 : ey + 4) : ey - 4;
    attr(reg.idTxt, 'y', base.toFixed(1));
    attr(reg.hashTxt, 'y', (base + 12).toFixed(1));
    attr(reg.idTxt, 'text-anchor', ancla);
    attr(reg.hashTxt, 'text-anchor', ancla);
  }

  /** Reconstruye los nodos si cambió el conjunto de ids (nueva red o distinto N). */
  _asegurarNodos(ids) {
    const mismo = ids.length === this.orden.length && ids.every((id, i) => this.orden[i] === id);
    if (mismo && !this.modoFantasma) return false;
    this.capaNodos.replaceChildren();
    this.nodos.clear();
    this.modoFantasma = 0;
    ids.forEach((id, i) => {
      const reg = this._crearNodo(id, i, ids.length);
      this.nodos.set(id, reg);
      this.capaNodos.appendChild(reg.g);
    });
    this.orden = ids.slice();
    const primero = this.nodos.get(this.foco) || this.nodos.get(ids[0]);
    if (primero) primero.g.setAttribute('tabindex', '0');
    attr(this.svg, 'data-n', ids.length);
    return true;
  }

  /** Vista previa del asistente: N nodos «fantasma» (sin red creada). null la quita. */
  previsualizar(n) {
    if (this.estado?.existe) return;
    if (!n) {
      if (this.modoFantasma) { this.capaNodos.replaceChildren(); this.nodos.clear(); this.orden = []; this.modoFantasma = 0; }
      this._pintarNucleo(this.estado);
      return;
    }
    const antes = this.capaNodos.children.length;
    this.capaNodos.replaceChildren();
    this.nodos.clear();
    this.orden = [];
    for (let i = 0; i < n; i += 1) {
      const id = `N${String(i + 1).padStart(2, '0')}`;
      const reg = this._crearNodo(id, i, n);
      reg.g.classList.add('nodo--fantasma');
      reg.g.removeAttribute('tabindex');
      reg.g.removeAttribute('role');
      reg.g.setAttribute('aria-hidden', 'true');
      texto(reg.colaTxt, '');
      this.capaNodos.appendChild(reg.g);
      // los nodos nuevos «aparecen»: feedback inmediato del control de N
      if (i >= antes && antes) animar(reg.cuerpo, [{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'none' }], { duration: DUR.entrada, easing: CURVA.acuse });
    }
    this.modoFantasma = n;
    attr(this.svg, 'data-n', n);
    this._pintarNucleo(this.estado);
  }

  // ------------------------------------------------------------- actualizar
  actualizar(e, cambios = {}) {
    const previo = this.estado;
    this.estado = e;
    if (!e?.existe) {
      this._ocultarTooltip();
      if (!this.modoFantasma) {
        this.capaNodos.replaceChildren(); this.nodos.clear(); this.orden = [];
      }
      attr(this.svg, 'data-vacio', '');
      attr(this.svg, 'aria-label', 'Anillo de instituciones: todavía no hay un consorcio formado en este modo.');
      this._pintarNucleo(e);
      return;
    }
    attr(this.svg, 'data-vacio', null);
    const reconstruida = this._asegurarNodos(e.ids || e.nodos.map((n) => n.id));
    if (reconstruida || (previo && previo.epoca !== e.epoca)) this._ocultarTooltip();
    const roles = this._roles(e);

    // ¿quién recibe un bloque nuevo? (para retrasar su cambio de color hasta que «llegue»)
    const llegadas = new Map();
    const animarDifusion = !reconstruida && !reducido() && (cambios.recibieron?.length || 0) > 0;
    if (animarDifusion) {
      const origen = cambios.origen ? this.nodos.get(cambios.origen) : null;
      const dist = (reg) => (origen ? Math.hypot(reg.x - origen.x, reg.y - origen.y) : reg.radio);
      const max = Math.max(1, ...cambios.recibieron.map((id) => (this.nodos.get(id) ? dist(this.nodos.get(id)) : 0)));
      for (const id of cambios.recibieron) {
        const reg = this.nodos.get(id);
        if (!reg || id === cambios.origen) continue;
        llegadas.set(id, 90 + (dist(reg) / max) * 360);
      }
    }

    for (const n of e.nodos) {
      const reg = this.nodos.get(n.id);
      if (!reg) continue;
      const g = reg.g;
      attr(g, 'data-conectado', n.conectado ? 'si' : 'no');
      attr(g, 'data-sinc', n.sincronizado ? 'si' : 'no');
      attr(g, 'data-integra', n.cadena_integra ? 'si' : 'no');
      attr(g, 'data-deshonesto', n.deshonesto ? 'si' : null);
      attr(g, 'data-rol', roles.get(n.id) || null);
      attr(g, 'aria-pressed', this.seleccionado === n.id ? 'true' : 'false');
      texto(reg.altura, n.altura);
      // la cola de la huella (el principio, en PoW, son siempre ceros)
      texto(reg.colaTxt, n.hash_cabeza ? ` …${n.hash_cabeza.slice(-4)}` : '');
      attr(g, 'aria-label', this._descripcion(n, roles.get(n.id)));

      const radio = !n.conectado ? R + FUERA : (!n.sincronizado || !n.cadena_integra) ? R + DERIVA : R;
      if (radio !== reg.radio) this._colocar(reg, radio, reconstruida);

      const tono = tonoHash(n.hash_cabeza);
      if (tono !== reg.tono) {
        const espera = llegadas.get(n.id);
        reg.tono = tono;
        if (espera) {
          clearTimeout(reg.timerTono);
          reg.timerTono = setTimeout(() => { cssVar(g, '--tono', tono); this._pulso(reg, 'acento'); }, espera);
        } else {
          cssVar(g, '--tono', tono);
        }
      }
    }

    if (animarDifusion) this.difundir(cambios.origen, cambios.recibieron.filter((id) => id !== cambios.origen), llegadas);
    if (cambios.creada || cambios.epocaCambio || (cambios.existeCambio && !cambios.primera)) this.despertar();
    if (previo?.existe && cambios.eventos?.length) this._reaccionar(cambios.eventos);

    this._pintarNucleo(e);
    const s0 = e.sincronia || {};
    attr(this.svg, 'aria-label', `Anillo de instituciones: ${plural(e.nodos.length, 'institución', 'instituciones')} del consorcio, ${s0.sincronizados}/${s0.total} en sincronía con ${plural(e.altura, 'folio sellado', 'folios sellados')} en el libro. Usa las flechas para recorrerlas y Enter para abrir su ficha.`);
    if (this.foco && this.tooltip && !this.tooltip.hidden) this._mostrarTooltip(this.foco);
  }

  /** Rol visible por nodo según la carrera PoW o la ronda PoS. */
  _roles(e) {
    const roles = new Map();
    const t = e.trabajo;
    if (t) {
      for (const m of t.mineros || []) {
        if (t.estado === 'minando' && m.estado === 'probando') roles.set(m.id, 'minando');
        else if (m.estado === 'ganador' && t.estado === 'ganado' && e.cabeza?.proponente === m.id) roles.set(m.id, 'ganador');
        else if (m.estado === 'obsoleto' && t.estado === 'ganado') roles.set(m.id, 'obsoleto');
      }
    }
    const r = e.ronda;
    if (r) {
      for (const v of r.validadores || []) {
        if (v.estado === 'eliminado' && r.activa) roles.set(v.id, 'eliminado');
        else if (v.estado === 'proponente') roles.set(v.id, 'proponente');
        else if (r.activa) roles.set(v.id, 'validador');
      }
      if (!r.activa && r.resultado?.estado === 'ACEPTADO' && e.cabeza?.proponente === r.proponente) roles.set(r.proponente, 'ganador');
    }
    return roles;
  }

  _descripcion(n, rol) {
    const t = tipo(n.id);
    const partes = [`${rotulo(n.id)} (${n.id}${t ? `, ${t}` : ''})`];
    if (!n.conectado) partes.push('desconectada');
    else if (!n.cadena_integra) partes.push('copia del libro alterada');
    else partes.push(n.sincronizado ? 'en sincronía' : 'atrasada');
    partes.push(`${plural(n.altura, 'folio', 'folios')} en su libro`);
    if (n.deshonesto) partes.push('deshonesta');
    const ROL = { minando: 'compitiendo por sellar', ganador: 'selló el último folio', obsoleto: 'su hallazgo llegó tarde (obsoleto)', proponente: 'institución proponente', validador: 'institución avaladora', eliminado: 'castigada y fuera de la ronda' };
    if (rol) partes.push(ROL[rol]);
    partes.push(`${creditos(num(n.saldo?.gastable))} disponibles`);
    return `${partes.join(', ')}. Abrir ficha.`;
  }

  // -------------------------------------------------------------- reacciones
  _reaccionar(eventos) {
    for (const ev of eventos) {
      if (!ev.nodo) continue;
      if (ev.tipo === 'cadena_rechazada' || ev.tipo === 'tx_rechazada' || ev.tipo === 'ronda_rechazada' || ev.tipo === 'castigo') this.destello(ev.nodo, 'rechazo');
      else if (ev.tipo === 'ataque') this.destello(ev.nodo, ev.datos?.aceptada ? 'rechazo' : 'defensa');
      else if (ev.tipo === 'corrupcion_local') this.destello(ev.nodo, 'rechazo');
      else if (ev.tipo === 'tx_aceptada' || ev.tipo === 'sorteo') this.destello(ev.nodo, 'acento');
    }
  }

  _pulso(reg, tipo) {
    const anillo = s('circle.nodo__destello', { r: reg.r + 5, dataset: { tipo } });
    reg.g.appendChild(anillo);
    const a = animar(anillo, [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.1)' }],
      { duration: DUR.escena + 200, easing: CURVA.func }, { reducido: [{ opacity: 0.8 }, { opacity: 0 }] });
    const quitar = () => anillo.remove();
    if (a) a.finished.then(quitar, quitar); else quitar();
  }

  destello(id, tipo = 'acento') {
    const reg = this.nodos.get(id);
    if (reg) this._pulso(reg, tipo);
  }

  /** Líneas de difusión desde el origen (o el núcleo) hasta cada destino. */
  difundir(origenId, destinos, llegadas = null) {
    if (reducido()) return;
    const o = origenId ? this.nodos.get(origenId) : null;
    const ox = o ? o.x : 0;
    const oy = o ? o.y : 0;
    if (o) this._pulso(o, 'acento');
    for (const id of destinos) {
      const d = this.nodos.get(id);
      if (!d) continue;
      const linea = s('line.difusion', { x1: ox.toFixed(1), y1: oy.toFixed(1), x2: d.x.toFixed(1), y2: d.y.toFixed(1), pathLength: '1' });
      this.capaDifusion.appendChild(linea);
      const retraso = Math.max(0, (llegadas?.get(id) ?? 200) - 260);
      const a = linea.animate([
        { strokeDashoffset: 1, opacity: 0.95 },
        { strokeDashoffset: 0, opacity: 0.95, offset: 0.55 },
        { strokeDashoffset: 0, opacity: 0 },
      ], { duration: DUR.difusion, delay: retraso, easing: CURVA.firma, fill: 'both' });
      const quitar = () => linea.remove();
      a.finished.then(quitar, quitar);
    }
  }

  /** «La red despierta»: los nodos se encienden en orden alrededor del anillo. */
  despertar() {
    const regs = this.orden.map((id) => this.nodos.get(id)).filter(Boolean);
    regs.forEach((reg, i) => {
      animar(reg.cuerpo, [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'none' }],
        { duration: DUR.escena, delay: 120 + i * 32, easing: CURVA.acuse, fill: 'backwards' });
      animar(reg.halo, [{ opacity: 0 }, { opacity: 1 }], { duration: DUR.escena, delay: 220 + i * 32, fill: 'backwards' });
      animar(reg.etiqueta, [{ opacity: 0 }, { opacity: 1 }], { duration: DUR.entrada, delay: 260 + i * 32, fill: 'backwards' });
    });
    animar(this.nucleo, [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }], { duration: DUR.escena, easing: CURVA.firma });
    if (!reducido()) {
      // el génesis compartido: un hilo del núcleo a cada nodo
      const llegadas = new Map(regs.map((reg, i) => [reg.g.dataset.id, 380 + i * 32]));
      this.difundir(null, regs.map((reg) => reg.g.dataset.id), llegadas);
    }
  }

  // ------------------------------------------------------------- selección
  seleccionar(id) {
    this.seleccionado = id;
    for (const [nid, reg] of this.nodos) {
      attr(reg.g, 'aria-pressed', nid === id ? 'true' : 'false');
      reg.g.classList.toggle('es-seleccionado', nid === id);
    }
  }

  /** Resalta un nodo unos segundos (p. ej. desde la bitácora). */
  resaltar(id, ms = 2400) {
    const reg = this.nodos.get(id);
    if (!reg) return;
    reg.g.classList.add('es-resaltado');
    this._pulso(reg, 'acento');
    clearTimeout(reg.timerResalte);
    reg.timerResalte = setTimeout(() => reg.g.classList.remove('es-resaltado'), ms);
  }

  /** Clase libre para otras vistas (p. ej. 'es-objetivo' en el laboratorio). */
  marcar(id, clase, activa = true) {
    const reg = this.nodos.get(id);
    if (reg) reg.g.classList.toggle(clase, !!activa);
  }

  posicion(id) {
    const reg = this.nodos.get(id);
    return reg ? { x: reg.x, y: reg.y, angulo: reg.angulo, radio: reg.radio, r: reg.r } : null;
  }

  /** Grupo SVG libre, encima de los nodos y sin eventos, para superposiciones de otras vistas. */
  capa() { return this.capaLibre; }

  _elegir(id) {
    this.foco = id;
    this.alSeleccionar(id);
  }

  _teclado(e) {
    const g = e.target instanceof Element ? e.target.closest('.nodo') : null;
    if (!g || !this.orden.length || this.modoFantasma) return;
    const i = this.orden.indexOf(g.dataset.id);
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % this.orden.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + this.orden.length) % this.orden.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = this.orden.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._elegir(g.dataset.id); return; }
    if (j === null) return;
    e.preventDefault();
    const dest = this.nodos.get(this.orden[j]);
    g.setAttribute('tabindex', '-1');
    dest.g.setAttribute('tabindex', '0');
    dest.g.focus();
  }

  _mostrarTooltip(id) {
    const n = this.estado?.nodos?.find((x) => x.id === id);
    const reg = this.nodos.get(id);
    if (!n || !reg) return;
    // la clave de estado es estable (la usa el CSS); el texto visible es la copia académica
    const [estadoClave, estadoTxt] = !n.conectado ? ['fuera', 'desconectada'] : !n.cadena_integra ? ['alterada', 'copia alterada']
      : n.sincronizado ? ['sinc', 'en sincronía'] : ['atrasada', 'atrasada'];
    const t = tipo(n.id);
    this.tooltip.replaceChildren(
      h('strong', sigla(n.id)), h('span', { dataset: { estado: estadoClave } }, estadoTxt),
      h('p.anillo__tooltip-nombre', nombre(n.id)),
      h('p.anillo__tooltip-tec', `${n.id}${t ? ` · institución ${t}` : ''}`),
      h('dl',
        h('div', h('dt', 'folios en su libro'), h('dd', String(n.altura))),
        h('div', h('dt', 'última huella'), h('dd', hashCorto(n.hash_cabeza, 4))),
        h('div', h('dt', 'créditos disponibles'), h('dd', num(n.saldo?.gastable))),
        n.saldo?.pendiente ? h('div', h('dt', 'ganados por madurar'), h('dd', num(n.saldo.pendiente))) : null,
        n.saldo?.bloqueado ? h('div', h('dt', 'apostados'), h('dd', num(n.saldo.bloqueado))) : null,
      ),
    );
    this.tooltip.hidden = false;
    const caja = this.host.getBoundingClientRect();
    const r = reg.cuerpo.getBoundingClientRect();
    const x = r.left + r.width / 2 - caja.left;
    const y = r.top - caja.top;
    const ancho = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${Math.round(Math.min(Math.max(4, x - ancho / 2), caja.width - ancho - 4))}px`;
    this.tooltip.style.top = `${Math.round(Math.max(4, y - this.tooltip.offsetHeight - 10))}px`;
  }

  _ocultarTooltip() { this.tooltip.hidden = true; }
}
