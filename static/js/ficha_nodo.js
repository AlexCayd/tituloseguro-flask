// Ficha de una institución (nodo): hoja lateral (derecha en escritorio, inferior en móvil) que deja
// la red visible. Abre con el nombre de la institución; muestra tipo, id técnico, créditos de
// certificación, SU propia copia del registro (últimos bloques), créditos ganados y las acciones:
// conectar/desconectar, sincronizar y, en PoS, marcarla deshonesta.
//
// La abre el shell (clic en un nodo del anillo, ctx.abrirNodo(id), narrador, bitácora…).

import { h, icono, texto, attr, reemplazar } from './util/dom.js';
import { num, grupos, plural, capital } from './util/fmt.js';
import { entrar } from './util/anim.js';
import { sigla, nombre, tipo, creditos, nombreModo } from './dominio.js';

export class FichaNodo {
  /** dialogo: <dialog class="hoja">; deps: { store, apiDe(modo), ui, red, navegar } */
  constructor(dialogo, deps) {
    this.d = dialogo;
    this.deps = deps;
    this.modo = null;
    this.id = null;
    this.hashVisto = null;
    this.peticion = 0;
    this.d.addEventListener('close', () => {
      this.deps.red?.seleccionar(null);
      this.id = null;
    });
    // clic en el fondo (fuera de la hoja) cierra
    this.d.addEventListener('click', (e) => { if (e.target === this.d) this.d.close(); });
    this._construir();
  }

  get abierta() { return this.d.open; }

  _construir() {
    this.sigla = h('span.ficha__sigla');
    this.nombre = h('span.ficha__nombre');
    this.titulo = h('h2.ficha__id', { id: 'ficha-titulo' }, this.sigla, ' ', this.nombre);
    this.tec = h('p.ficha__tec');
    this.chips = h('div.grupo.ficha__chips');
    this.cerrarBtn = h('button.boton.boton--fantasma.boton--icono', { type: 'button', 'aria-label': 'Cerrar ficha' }, icono('x'));
    this.cerrarBtn.addEventListener('click', () => this.d.close());

    this.saldo = h('div.ficha__saldo');
    this.acciones = h('div.ficha__acciones');
    this.mensaje = h('div.ficha__mensaje', { 'aria-live': 'polite' });
    this.identidad = h('div.ficha__identidad');
    this.cadena = h('div.ficha__cadena');
    this.recompensas = h('div.ficha__recompensas');

    this.d.setAttribute('aria-labelledby', 'ficha-titulo');
    this.d.replaceChildren(
      h('div.ficha',
        h('header.ficha__cabecera',
          h('div.ficha__identidad-cab', h('p.etiqueta-instrumento', { id: 'ficha-modo' }, 'Institución'), this.titulo, this.tec),
          this.cerrarBtn,
        ),
        this.chips,
        h('section.ficha__seccion', h('h3.etiqueta-instrumento', 'Créditos de certificación'), this.saldo),
        h('section.ficha__seccion', h('h3.etiqueta-instrumento', 'Acciones'), this.acciones, this.mensaje),
        h('section.ficha__seccion', h('h3.etiqueta-instrumento', 'Firma institucional'), this.identidad),
        h('section.ficha__seccion', h('h3.etiqueta-instrumento', 'Su copia del libro de registros'), this.cadena),
        this.recompensas,
      ),
    );
  }

  abrir(modo, id) {
    const n = this.deps.store.nodo(modo, id);
    if (!n) return;
    this.modo = modo;
    this.id = id;
    this.hashVisto = null;
    for (const el of [this.chips, this.saldo, this.acciones]) delete el.dataset.clave;
    this.mensaje.replaceChildren();
    texto(this.d.querySelector('#ficha-modo'), `Institución · ${nombreModo(modo)}`);
    this.deps.red?.seleccionar(id);
    this._pintar(this.deps.store.estado(modo));
    if (!this.d.open) this.d.showModal();
    this.cerrarBtn.focus();
  }

  cerrar() { if (this.d.open) this.d.close(); }

  /** Llamado por el shell en cada estado nuevo del modo activo. */
  actualizar(modo, estado) {
    if (!this.d.open || modo !== this.modo) return;
    if (!estado?.existe || !estado.nodos.some((n) => n.id === this.id)) { this.cerrar(); return; }
    this._pintar(estado);
  }

  _pintar(estado) {
    const n = estado.nodos.find((x) => x.id === this.id);
    if (!n) return;
    texto(this.sigla, sigla(n.id));
    texto(this.nombre, nombre(n.id));
    const t = tipo(n.id);
    texto(this.tec, `${n.id}${t ? ` · institución ${t}` : ''}`);
    const ui = this.deps.ui;
    const ocupadoReposo = !!((estado.trabajo?.estado === 'minando') || estado.ronda?.activa);
    const s = n.saldo || {};
    // solo se repinta lo que cambió (el sondeo llega cada 250 ms en una carrera: no perder el foco)
    const claveChips = `${n.conectado}|${n.cadena_integra}|${n.sincronizado}|${n.deshonesto}|${n.trampa}|${n.bloques_propuestos}`;
    const claveSaldo = `${s.disponible}|${s.pendiente}|${s.bloqueado}|${s.castigos_pendientes}|${s.gastable}`;
    const claveAcciones = `${n.id}|${n.conectado}|${n.deshonesto}|${n.trampa}|${ocupadoReposo}`;
    if (this.chips.dataset.clave !== claveChips) { this.chips.dataset.clave = claveChips; this._pintarChips(n, ui); }
    if (this.saldo.dataset.clave !== claveSaldo) { this.saldo.dataset.clave = claveSaldo; this._pintarSaldo(n); }
    if (this.acciones.dataset.clave !== claveAcciones) { this.acciones.dataset.clave = claveAcciones; this._pintarAcciones(n, ocupadoReposo); }
    this._pintarIdentidad(n);
    if (n.hash_cabeza !== this.hashVisto) {
      this.hashVisto = n.hash_cabeza;
      this._cargarCadena(n);
    }
  }

  _pintarChips(n, ui) {
    const chips = [];
    if (!n.conectado) chips.push(ui.chip('Desconectada', 'obsoleto'));
    else if (!n.cadena_integra) chips.push(ui.chip('Copia alterada', 'rechazado'));
    else chips.push(n.sincronizado ? ui.chip('En sincronía', 'valido') : ui.chip('Atrasada', 'advertencia'));
    if (n.deshonesto) chips.push(ui.chip(`Deshonesta · ${n.trampa === 'gasto' ? 'créditos que no tiene' : 'firma alterada'}`, 'rechazado'));
    if (n.bloques_propuestos) {
      chips.push(ui.chip(this.modo === 'pos'
        ? plural(n.bloques_propuestos, 'folio propuesto y avalado', 'folios propuestos y avalados')
        : plural(n.bloques_propuestos, 'folio sellado', 'folios sellados'), 'acento'));
    }
    this.chips.replaceChildren(...chips);
  }

  _pintarSaldo(n) {
    const s = n.saldo || {};
    const partes = [
      ['gastable', s.gastable, 'disponibles'],
      ['bloqueado', s.bloqueado, 'apostados (bloqueados)'],
      ['castigo', s.castigos_pendientes, 'castigo por aplicar'],
      ['pendiente', s.pendiente, 'ganados por madurar'],
    ].filter(([, v]) => v > 0);
    const total = partes.reduce((a, [, v]) => a + v, 0) || 1;
    reemplazar(this.saldo,
      h('p.ficha__cifra', h('span.cifra', num(s.gastable)), h('small', ` ${Number(s.gastable) === 1 ? 'crédito disponible' : 'créditos disponibles'} para registrar`)),
      h('div.desglose',
        h('div.desglose__barra', { 'aria-hidden': 'true' }, partes.map(([p, v]) => h('span', { dataset: { parte: p }, style: { '--peso': v / total } }))),
        h('div.desglose__leyenda', partes.map(([p, v, et]) => h('span', h('i', { dataset: { parte: p } }), et, ' ', h('b', num(v))))),
      ),
      h('dl.renglones',
        h('div', h('dt', 'Créditos en su copia del libro'), h('dd', num(s.disponible))),
        h('div', h('dt', [this.deps.ui.termino('recompensa', 'Créditos ganados'), ' por madurar']), h('dd', num(s.pendiente))),
        this.modo === 'pos' ? h('div', h('dt', [this.deps.ui.termino('stake', 'Apuesta'), ' bloqueada']), h('dd', num(s.bloqueado))) : null,
        s.castigos_pendientes ? h('div', h('dt', 'Castigos por aplicar'), h('dd', `−${num(s.castigos_pendientes)}`)) : null,
      ),
    );
  }

  _pintarAcciones(n, ocupadoReposo) {
    const api = this.deps.apiDe(this.modo);
    const enfocado = this.acciones.contains(document.activeElement) ? document.activeElement.dataset.accion : null;
    const botones = [];

    const S = sigla(n.id);
    const bConexion = h('button.interruptor', { type: 'button', role: 'switch', 'aria-checked': String(n.conectado), dataset: { accion: 'conexion' } }, n.conectado ? 'Conectada al consorcio' : 'Desconectada');
    bConexion.addEventListener('click', () => this._ejecutar(bConexion, () => api.accion(`nodos/${n.id}/conexion`, { conectado: !n.conectado }),
      n.conectado ? `${S} se desconectó: dejará de recibir folios nuevos del libro.` : `${S} se reconectó. Si su libro quedó atrás, sincronízala.`));
    botones.push(bConexion);

    const bSinc = h('button.boton.boton--secundario.boton--chico', { type: 'button', disabled: !n.conectado, dataset: { accion: 'sincronizar' } }, icono('sync'), h('span', 'Sincronizar'));
    bSinc.addEventListener('click', () => this._ejecutar(bSinc, () => api.accion(`nodos/${n.id}/sincronizar`), null, (r) => r?.resultado?.motivo));
    botones.push(bSinc);

    const extra = [];
    if (this.modo === 'pos') {
      const bDes = h('button.interruptor', { type: 'button', role: 'switch', 'aria-checked': String(!!n.deshonesto), dataset: { accion: 'deshonesto' } }, 'Institución deshonesta');
      const trampa = n.trampa || 'firma';
      const seg = h('div.segmentado.ficha__trampa', { role: 'radiogroup', 'aria-label': 'Tipo de registro fraudulento' },
        ['firma', 'gasto'].map((t) => h('label', h('input', { type: 'radio', name: `trampa-${n.id}`, value: t, checked: trampa === t }), t === 'firma' ? 'Firma alterada' : 'Créditos que no tiene')));
      bDes.addEventListener('click', () => {
        const elegida = seg.querySelector('input:checked')?.value || 'firma';
        this._ejecutar(bDes, () => api.accion(`nodos/${n.id}/deshonesto`, n.deshonesto ? { activo: false } : { activo: true, trampa: elegida }),
          n.deshonesto ? `${S} vuelve a ser honesta.` : `${S} intentará avalar un registro fraudulento si sale sorteada como proponente.`);
      });
      seg.addEventListener('change', () => {
        if (!n.deshonesto) return;
        const elegida = seg.querySelector('input:checked')?.value;
        this._ejecutar(null, () => api.accion(`nodos/${n.id}/deshonesto`, { activo: true, trampa: elegida }), `Fraude que intentará ${S}: ${elegida === 'gasto' ? 'avalar créditos que no tiene' : 'firma alterada'}.`);
      });
      extra.push(h('div.ficha__deshonesto', bDes, seg,
        h('p.campo__ayuda', 'Una institución deshonesta, si sale sorteada, propone un folio con un registro fraudulento; como avaladora, aprueba sin revisar. Solo puede cambiarse cuando no hay ronda en curso o durante la fase de APUESTAS.')));
    }

    reemplazar(this.acciones,
      h('div.grupo', botones),
      ocupadoReposo ? h('p.campo__ayuda', 'Hay un sellado o una ronda de avales en curso: conectar, desconectar o sincronizar se habilitan al terminar (si lo intentas antes, el consorcio te explicará por qué).') : null,
      extra,
    );
    if (enfocado) this.acciones.querySelector(`[data-accion="${enfocado}"]`)?.focus();
  }

  async _ejecutar(boton, fn, ok, mensajeDe) {
    const { ui } = this.deps;
    this.mensaje.replaceChildren();
    try {
      const r = await ui.ocupado(boton, fn());
      const m = (mensajeDe && mensajeDe(r)) || ok;
      if (m) this.mensaje.replaceChildren(h('p.aviso', { dataset: { nivel: 'ok' } }, icono('ok'), h('span.mensaje-servidor', capital(m))));
    } catch (e) {
      if (e?.name === 'ErrorApi') {
        // el rechazo es parte de la lección: se muestra aquí, junto a la acción
        this.mensaje.replaceChildren(h('p.aviso', { dataset: { nivel: 'aviso' }, role: 'alert' }, icono('alerta'), h('span.mensaje-servidor', capital(e.message))));
      } else {
        ui.mostrarError(e);
      }
    }
    entrar(this.mensaje.firstElementChild);
  }

  _pintarIdentidad(n) {
    if (this.identidad.dataset.pub === `${this.modo}:${n.pub}`) return;
    this.identidad.dataset.pub = `${this.modo}:${n.pub}`;
    const ui = this.deps.ui;
    reemplazar(this.identidad,
      h('dl.renglones',
        h('div', h('dt', ui.termino('clave_publica', 'Clave pública')), h('dd', ui.hash(n.pub, { n: 6, etiqueta: `Clave pública de ${sigla(n.id)}` }))),
        this.modo === 'pow' ? h('div', h('dt', [ui.termino('nonce', 'Nonces'), ' que prueba']), h('dd', `i = ${n.indice} (prueba ${n.indice}, ${n.indice}+N…)`)) : null,
      ),
      h('details.detalles',
        h('summary', 'Ver la clave completa (Ed25519, 32 bytes)'),
        h('p.hex-completo', grupos(n.pub, 8).map((g) => h('span', g))),
      ),
    );
  }

  async _cargarCadena(n) {
    const yo = ++this.peticion;
    const api = this.deps.apiDe(this.modo);
    this.cadena.replaceChildren(h('span.esqueleto'), h('span.esqueleto'), h('span.esqueleto'));
    try {
      const desde = Math.max(0, n.altura - 5);
      const [c, info] = await Promise.all([
        api.get(`nodos/${n.id}/cadena`, { desde, limite: 6 }),
        this.modo === 'pow' ? api.get(`nodos/${n.id}`) : Promise.resolve(null),
      ]);
      if (yo !== this.peticion || this.id !== n.id) return;
      this._pintarCadena(n, c);
      this._pintarRecompensas(info?.recompensas || []);
    } catch (e) {
      if (yo !== this.peticion) return;
      this.cadena.replaceChildren(h('p.aviso', { dataset: { nivel: 'aviso' } }, icono('alerta'), h('span.mensaje-servidor', e.message || 'No se pudo consultar su copia del libro. Vuelve a abrir la ficha en unos segundos.')));
    }
  }

  _pintarCadena(n, c) {
    const ui = this.deps.ui;
    const v = c.validacion || {};
    const fallas = new Map((v.bloques || []).map((b) => [b.numero, b]));
    const bloques = (c.bloques || []).slice().reverse();
    reemplazar(this.cadena,
      h('p.ficha__veredicto', { dataset: { valida: v.valida ? 'si' : 'no' } },
        icono(v.valida ? 'ok' : 'alerta'),
        v.valida ? `Su copia del libro (folio de apertura + ${plural(Math.max(0, c.total - 1), 'folio sellado', 'folios sellados')}) es válida de punta a punta.` : `Su copia del libro NO es válida: ${plural(v.total_problemas, 'problema encontrado', 'problemas encontrados')}.`),
      h('ol.minicadena', { role: 'list' }, bloques.map((b) => {
        const f = fallas.get(b.numero);
        const malo = f && f.valido === false;
        return h('li.minicadena__bloque', { dataset: { valido: malo ? 'no' : 'si' } },
          h('span.minicadena__num', `#${b.numero}`),
          h('div.minicadena__datos',
            h('span', ui.hash(b.hash, { ceros: this.modo === 'pow', etiqueta: `Huella del folio ${b.numero}`, plano: true })),
            h('small', b.numero === 0 ? 'folio de apertura del consorcio' : `${this.modo === 'pow' ? 'sellado' : 'propuesto'} por ${sigla(b.proponente)} · ${plural(b.transacciones.length, 'registro', 'registros')}${this.modo === 'pow' ? ` · nonce ${num(b.nonce)}` : ''}`),
          ),
          malo ? h('span.chip', { dataset: { estado: 'rechazado' } }, 'alterado') : null,
        );
      })),
      c.desde > 0 ? h('p.campo__ayuda', `… y ${plural(c.desde, 'folio anterior', 'folios anteriores')}, enlazados por su huella.`) : null,
      !v.valida && v.problemas?.length ? h('ul.ficha__problemas', v.problemas.slice(0, 4).map((p) => h('li', h('strong', `#${p.bloque}`), ' ', p.mensaje))) : null,
      h('button.boton.boton--secundario.boton--chico.ficha__explorar', { type: 'button', on: { click: () => { const id = n.id; this.cerrar(); this.deps.navegar('cadena', { nodo: id }); } } },
        icono('cadena'), h('span', `Ver el libro de registros de ${sigla(n.id)}`)),
    );
  }

  _pintarRecompensas(items) {
    if (this.modo !== 'pow' || !items.length) { this.recompensas.replaceChildren(); return; }
    reemplazar(this.recompensas,
      h('section.ficha__seccion',
        h('h3.etiqueta-instrumento', 'Créditos ganados por sellar'),
        h('ul.ficha__recompensas-lista', { role: 'list' }, items.slice(-6).map((r) => h('li',
          h('span.mono', `#${r.bloque}`),
          r.estado === 'madura'
            ? this.deps.ui.chip('madura', 'valido')
            : this.deps.ui.chip(`faltan ${plural(r.faltan, 'folio', 'folios')}`, 'pendiente'),
          h('span.texto-3', r.estado === 'madura' ? `${creditos(num(r.monto))} ya disponibles` : `${creditos(num(r.monto))}: maduran en el folio #${r.madura_en}`),
        ))),
      ),
    );
  }
}
