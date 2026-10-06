// Recorrido guiado de primera visita (sin librerías).
// Seis pasos con una caja anclada al elemento que explica y un foco que oscurece el resto (sin
// bloquear la página: es no modal). Saltable con «Saltar» o Esc; no se repite (localStorage, envuelto
// en try/catch por el shell) y se puede volver a ver desde «Ver el recorrido» en el narrador.
//
//   const r = new Recorrido(contenedor, { memoria, modo: () => 'pow', movil: () => false, alAbrirPaso })
//   r.iniciar({ forzado })   r.cerrar()

import { h, icono, texto, attr, reemplazar } from './util/dom.js';
import { animar, DUR, CURVA } from './util/anim.js';

const CLAVE = 'ts:recorrido:visto';

function pasos(modo, movil) {
  const arena = modo === 'pow' ? 'pow_arena' : 'pos_escenario';
  return [
    {
      ancla: movil ? '#franja-red' : '#anillo',
      titulo: 'Estas son las instituciones del consorcio',
      texto: movil
        ? 'Universidades e institutos comparten un mismo libro de registros de credenciales. Pulsa «Ver instituciones» para desplegar el anillo: cada punto es una institución (UNAM, IPN, TEC…) con su propia copia del libro.'
        : 'Universidades e institutos comparten un mismo libro de registros de credenciales. Cada punto del anillo es una institución (UNAM, IPN, TEC…) con su propia copia: mismo color de halo, mismo libro. Pulsa una para abrir su ficha.',
    },
    {
      ancla: '.seccion[data-vista="transacciones"]',
      titulo: 'Registra una credencial',
      texto: 'En «Registros», una institución emisora paga créditos de certificación a otra que avala el registro de una credencial (título, diploma, constancia…). Lo firma con su clave privada y el consorcio comprueba la firma y los créditos.',
    },
    {
      ancla: `.seccion[data-vista="${arena}"]`,
      titulo: modo === 'pow' ? 'Las instituciones sellan los folios' : 'Las instituciones avalan los folios',
      texto: modo === 'pow'
        ? 'En «Sellado» (Proof of Work), las instituciones selladoras compiten por cerrar el siguiente folio del libro probando nonces. La primera que lo logra lo sella y gana créditos de certificación, que maduran tras 6 confirmaciones.'
        : 'En «Avales» (Proof of Stake), las instituciones avaladoras apuestan créditos para avalar el siguiente folio. Un sorteo elige quién lo propone; si una institución deshonesta intenta colar un registro fraudulento, pierde su apuesta.',
    },
    {
      ancla: '#narrador',
      titulo: 'Sigue cómo se sella y se comparte',
      texto: 'Cuando se sella un folio, viaja de institución en institución y cada una lo revisa por su cuenta antes de aceptarlo. Este panel te cuenta cada paso y te sugiere el siguiente; en «Libro de registros» consultas los folios sellados.',
    },
    {
      ancla: '.seccion[data-vista="laboratorio"]',
      titulo: 'Intenta falsificar un registro',
      texto: 'En «Falsificaciones» puedes alterar un registro ya sellado, registrar dos veces los mismos créditos o firmar con la clave de otra institución. Verás exactamente por qué el consorcio lo rechaza.',
    },
    {
      ancla: '.narrador__recorrido',
      titulo: 'Todo listo para empezar',
      texto: 'Puedes repetir este recorrido cuando quieras desde aquí. Es una simulación didáctica: el libro guarda qué institución paga, a cuál, cuántos créditos y cuándo; nunca los datos de la credencial ni del estudiante.',
    },
  ];
}

export class Recorrido {
  constructor(contenedor, { memoria, modo, movil, alAbrirPaso } = {}) {
    this.c = contenedor;
    this.memoria = memoria;
    this.modo = modo || (() => 'pow');
    this.movil = movil || (() => false);
    this.alAbrirPaso = alAbrirPaso;
    this.activo = false;
    this.i = 0;
    this.ancla = null;
    this.previo = null;
    if (!this.c) return;

    this.foco = h('div.recorrido__foco', { 'aria-hidden': 'true' });
    this.num = h('p.recorrido__num.etiqueta-instrumento');
    this.titulo = h('h2.recorrido__titulo', { id: 'recorrido-titulo', tabindex: '-1' });
    this.texto = h('p.recorrido__texto', { id: 'recorrido-texto' });
    this.puntos = h('ol.recorrido__puntos', { role: 'list', 'aria-hidden': 'true' });
    this.saltar = h('button.boton.boton--fantasma.boton--chico', { type: 'button' }, 'Saltar recorrido');
    this.anterior = h('button.boton.boton--secundario.boton--chico', { type: 'button' }, 'Anterior');
    this.siguiente = h('button.boton.boton--primario.boton--chico', { type: 'button' }, 'Siguiente');
    this.caja = h('div.recorrido__caja', { role: 'dialog', 'aria-modal': 'false', 'aria-roledescription': 'recorrido guiado', 'aria-labelledby': 'recorrido-titulo', 'aria-describedby': 'recorrido-texto' },
      h('div.recorrido__cabeza', h('span.recorrido__icono', icono('recorrido')), this.num),
      this.titulo, this.texto,
      h('div.recorrido__pie', this.puntos, h('div.recorrido__botones', this.saltar, this.anterior, this.siguiente)),
    );
    this.c.replaceChildren(this.foco, this.caja);

    this.saltar.addEventListener('click', () => this.cerrar());
    this.anterior.addEventListener('click', () => this.ir(this.i - 1));
    this.siguiente.addEventListener('click', () => (this.i >= this.lista.length - 1 ? this.cerrar() : this.ir(this.i + 1)));
    this.c.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.cerrar(); }
    });
    this._recolocar = () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this._colocar(); });
    };
  }

  /** forzado = true: desde «Ver el recorrido». Si no, solo la primera visita. */
  iniciar({ forzado = false } = {}) {
    if (!this.c || this.activo) return;
    if (!forzado && this.memoria?.leer(CLAVE)) return;
    if (!forzado && document.querySelector('dialog[open]')) return;   // no interrumpir una ficha abierta
    this.previo = document.activeElement;
    this.lista = pasos(this.modo(), this.movil());
    this.activo = true;
    this.c.hidden = false;
    document.body.setAttribute('data-recorrido', '');
    window.addEventListener('resize', this._recolocar);
    window.addEventListener('scroll', this._recolocar, { passive: true, capture: true });
    this.ir(0);
  }

  ir(i) {
    if (!this.activo) return;
    this.i = Math.max(0, Math.min(this.lista.length - 1, i));
    const p = this.lista[this.i];
    this.alAbrirPaso?.(this.i);
    texto(this.num, `Paso ${this.i + 1} de ${this.lista.length}`);
    texto(this.titulo, p.titulo);
    texto(this.texto, p.texto);
    reemplazar(this.puntos, this.lista.map((_, j) => h('li', { dataset: { actual: j === this.i ? 'si' : j < this.i ? 'visto' : 'no' } })));
    this.anterior.hidden = this.i === 0;
    texto(this.siguiente, this.i === this.lista.length - 1 ? 'Empezar' : 'Siguiente');
    this.saltar.hidden = this.i === this.lista.length - 1;

    const el = document.querySelector(p.ancla);
    this.ancla = el && el.getClientRects().length ? el : null;
    if (this.ancla) this.ancla.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    this._colocar();
    animar(this.caja, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: DUR.entrada, easing: CURVA.firma });
    this.titulo.focus({ preventScroll: true });
  }

  _colocar() {
    if (!this.activo) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 12;
    const caja = this.caja;
    const cw = caja.offsetWidth;
    const ch = caja.offsetHeight;
    if (!this.ancla || !this.ancla.isConnected) {
      this.foco.hidden = true;
      caja.style.left = `${Math.round((vw - cw) / 2)}px`;
      caja.style.top = `${Math.round(Math.max(m, (vh - ch) / 2))}px`;
      attr(caja, 'data-lado', null);
      return;
    }
    const r = this.ancla.getBoundingClientRect();
    // foco: el rectángulo del ancla recortado al viewport, con holgura
    const pad = 6;
    const fx = Math.max(2, r.left - pad);
    const fy = Math.max(2, r.top - pad);
    const fr = Math.min(vw - 2, r.right + pad);
    const fb = Math.min(vh - 2, r.bottom + pad);
    this.foco.hidden = false;
    this.foco.style.left = `${Math.round(fx)}px`;
    this.foco.style.top = `${Math.round(fy)}px`;
    this.foco.style.width = `${Math.max(0, Math.round(fr - fx))}px`;
    this.foco.style.height = `${Math.max(0, Math.round(fb - fy))}px`;

    // caja: abajo, arriba, derecha, izquierda; si nada cabe, abajo del todo
    const cx = r.left + r.width / 2;
    const x = Math.min(Math.max(m, cx - cw / 2), vw - cw - m);
    let lado = null;
    let left = x;
    let top = 0;
    if (fb + 14 + ch <= vh - m) { lado = 'abajo'; top = fb + 14; }
    else if (fy - 14 - ch >= m) { lado = 'arriba'; top = fy - 14 - ch; }
    else if (fr + 14 + cw <= vw - m) { lado = 'derecha'; left = fr + 14; top = Math.min(Math.max(m, r.top + r.height / 2 - ch / 2), vh - ch - m); }
    else if (fx - 14 - cw >= m) { lado = 'izquierda'; left = fx - 14 - cw; top = Math.min(Math.max(m, r.top + r.height / 2 - ch / 2), vh - ch - m); }
    else { top = vh - ch - m; }
    caja.style.left = `${Math.round(left)}px`;
    caja.style.top = `${Math.round(top)}px`;
    attr(caja, 'data-lado', lado);
    if (lado === 'abajo' || lado === 'arriba') caja.style.setProperty('--flecha-x', `${Math.round(Math.min(Math.max(18, cx - left), cw - 18))}px`);
    else if (lado) caja.style.setProperty('--flecha-y', `${Math.round(Math.min(Math.max(18, r.top + r.height / 2 - top), ch - 18))}px`);
  }

  cerrar() {
    if (!this.activo) return;
    this.activo = false;
    this.memoria?.guardar(CLAVE, '1');
    this.c.hidden = true;
    document.body.removeAttribute('data-recorrido');
    window.removeEventListener('resize', this._recolocar);
    window.removeEventListener('scroll', this._recolocar, { capture: true });
    const volver = this.previo && this.previo.isConnected && this.previo !== document.body ? this.previo : document.querySelector('.narrador__recorrido');
    volver?.focus?.({ preventScroll: true });
  }
}
