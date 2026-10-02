/* Título Seguro · recorrido guiado con foco.
 *
 *   Pasos:  data-tour="1" data-tour-titulo="…" data-tour-texto="…"  (orden numérico; los que no
 *           se ven en pantalla —ocultos o en un menú cerrado— se saltan solos)
 *   Botón:  [data-accion="tour"]  (en la cabecera: «¿Cómo funciona?»)
 *   Primera visita a cada página: invitación discreta, nunca se impone.
 *   Memoria: localStorage "ts.tour.<pagina>" = visto | descartado   (pagina = body[data-pagina])
 *   API:    TS.tour.iniciar(desde=0) · TS.tour.cerrar() · TS.tour.hayPasos()
 */
(() => {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const d = document;

  const pagina = () => d.body.dataset.pagina || window.location.pathname;
  const clave = () => `ts.tour.${pagina()}`;

  let raiz = null;
  let foco = null;
  let tarjeta = null;
  let vivo = null;
  let pasos = [];
  let i = 0;
  let previo = null;
  let raf = 0;
  let invitacion = null;

  function visible(el) {
    if (el.closest('[hidden], dialog:not([open])')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }
  const recolectar = () => TS.$$('[data-tour]').filter(visible).sort((a, b) => (+a.dataset.tour || 0) - (+b.dataset.tour || 0));
  // la página "tiene recorrido" si marca pasos propios (los de la cabecera no cuentan)
  const hayPasos = () => TS.$$('[data-tour]').some((el) => !el.closest('.cabecera'));

  function construir() {
    tarjeta = TS.el('section', { class: 'tour__tarjeta', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-titulo', 'aria-describedby': 'tour-texto' },
      TS.el('button', { type: 'button', class: 'tour__cerrar', 'aria-label': 'Cerrar recorrido', 'data-t': 'cerrar' }, TS.icono('cerrar')),
      TS.el('p', { class: 'tour__paso', 'data-t': 'paso' }),
      TS.el('h2', { class: 'tour__titulo', id: 'tour-titulo' }),
      TS.el('p', { class: 'tour__texto', id: 'tour-texto' }),
      TS.el('div', { class: 'tour__puntos', 'aria-hidden': 'true' }),
      TS.el('div', { class: 'tour__acciones' },
        TS.el('button', { type: 'button', class: 'boton boton--fantasma boton--chico tour__saltar', 'data-t': 'cerrar' }, 'Saltar recorrido'),
        TS.el('button', { type: 'button', class: 'boton boton--secundario boton--chico', 'data-t': 'anterior' }, 'Anterior'),
        TS.el('button', { type: 'button', class: 'boton boton--primario boton--chico', 'data-t': 'siguiente' }, 'Siguiente')),
      TS.el('p', { class: 'solo-lectores', 'aria-live': 'polite' }));
    foco = TS.el('div', { class: 'tour__foco', 'aria-hidden': 'true' });
    raiz = TS.el('div', { class: 'tour' }, TS.el('div', { class: 'tour__velo' }), foco, tarjeta);
    vivo = TS.$('[aria-live]', tarjeta);
    tarjeta.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-t]');
      if (!b) return;
      const t = b.dataset.t;
      if (t === 'cerrar') cerrar();
      else if (t === 'anterior') ir(i - 1);
      else if (t === 'siguiente') (i >= pasos.length - 1 ? cerrar() : ir(i + 1));
    });
    raiz.addEventListener('keydown', teclado);
  }

  function teclado(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); cerrar(); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); if (i < pasos.length - 1) ir(i + 1); return; }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); if (i > 0) ir(i - 1); return; }
    if (ev.key !== 'Tab') return;
    const f = TS.$$('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])', tarjeta).filter((x) => !x.hidden);
    if (!f.length) return;
    const primero = f[0];
    const ultimo = f[f.length - 1];
    if (ev.shiftKey && d.activeElement === primero) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && d.activeElement === ultimo) { ev.preventDefault(); primero.focus(); }
    else if (!tarjeta.contains(d.activeElement)) { ev.preventDefault(); primero.focus(); }
  }

  function colocar() {
    raf = 0;
    const el = pasos[i];
    if (!el || !raiz) return;
    const r = el.getBoundingClientRect();
    const vw = d.documentElement.clientWidth;
    const vh = window.innerHeight;
    const pad = 8;
    const x = Math.max(6, r.left - pad);
    const y = Math.max(6, r.top - pad);
    const x2 = Math.min(vw - 6, r.right + pad);
    const y2 = Math.min(vh - 6, r.bottom + pad);
    Object.assign(foco.style, {
      left: `${Math.round(x)}px`, top: `${Math.round(y)}px`,
      width: `${Math.round(Math.max(0, x2 - x))}px`, height: `${Math.round(Math.max(0, y2 - y))}px`,
    });
    if (window.matchMedia('(max-width: 40rem)').matches) { tarjeta.style.left = ''; tarjeta.style.top = ''; return; }
    const w = tarjeta.offsetWidth;
    const h = tarjeta.offsetHeight;
    const m = 16;
    const lim = (v, a, b) => Math.max(a, Math.min(v, b));
    let tx = null;
    let ty;
    if (y2 + m + h <= vh) ty = y2 + m;
    else if (y - m - h >= 0) ty = y - m - h;
    else if (x2 + m + w <= vw) { tx = x2 + m; ty = lim(y, m, vh - h - m); }
    else if (x - m - w >= 0) { tx = x - m - w; ty = lim(y, m, vh - h - m); }
    else { tx = vw - w - m; ty = vh - h - m; }
    if (tx == null) tx = lim(x, m, vw - w - m);
    tarjeta.style.left = `${Math.round(tx)}px`;
    tarjeta.style.top = `${Math.round(ty)}px`;
  }
  const pedir = () => { if (raiz && !raf) raf = window.requestAnimationFrame(colocar); };

  function ir(n) {
    i = Math.max(0, Math.min(n, pasos.length - 1));
    const el = pasos[i];
    const total = pasos.length;
    const titulo = el.dataset.tourTitulo || 'Esta parte';
    const texto = el.dataset.tourTexto || el.dataset.explica || '';
    TS.$('[data-t="paso"]', tarjeta).textContent = `Paso ${i + 1} de ${total}`;
    TS.$('#tour-titulo', tarjeta).textContent = titulo;
    TS.$('#tour-texto', tarjeta).textContent = texto;
    TS.$('.tour__puntos', tarjeta).replaceChildren(...pasos.map((_, k) => TS.el('span', k === i ? { 'data-actual': '' } : k < i ? { 'data-visto': '' } : null)));
    const ant = TS.$('[data-t="anterior"]', tarjeta);
    ant.hidden = i === 0;
    const sig = TS.$('[data-t="siguiente"]', tarjeta);
    sig.textContent = i === total - 1 ? 'Terminar' : 'Siguiente';
    vivo.textContent = `Paso ${i + 1} de ${total}: ${titulo}. ${texto}`;
    const r = el.getBoundingClientRect();
    const cabe = r.top >= 0 && r.bottom <= window.innerHeight;
    if (!cabe) el.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? 'start' : 'center', inline: 'nearest', behavior: TS.reducido() ? 'auto' : 'smooth' });
    colocar();
    // sigue al elemento mientras dura el desplazamiento suave
    const t0 = performance.now();
    const seguir = () => { colocar(); if (performance.now() - t0 < 900 && raiz) window.requestAnimationFrame(seguir); };
    window.requestAnimationFrame(seguir);
    sig.focus({ preventScroll: true });
  }

  function iniciar(desde = 0) {
    quitarInvitacion();
    const menu = d.getElementById('menu-principal');
    try { if (menu && menu.matches(':popover-open')) menu.hidePopover(); } catch { /* sin popover */ }
    pasos = hayPasos() ? recolectar() : [];
    if (!pasos.length) {
      if (TS.glosario) TS.glosario.abrir();
      return;
    }
    if (!raiz) construir();
    previo = d.activeElement;
    d.body.append(raiz);
    window.addEventListener('resize', pedir);
    window.addEventListener('scroll', pedir, { passive: true, capture: true });
    ir(desde);
  }
  function cerrar() {
    if (!raiz || !raiz.isConnected) return;
    raiz.remove();
    window.removeEventListener('resize', pedir);
    window.removeEventListener('scroll', pedir, { capture: true });
    TS.guardar(clave(), 'visto');
    if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus({ preventScroll: true });
    TS.anunciar('Recorrido cerrado. Puedes repetirlo con el botón «¿Cómo funciona?».');
  }

  /* ------------------------------------------------------------------ invitación */
  function quitarInvitacion(marcar) {
    if (!invitacion) return;
    if (marcar) TS.guardar(clave(), 'descartado');
    invitacion.remove();
    invitacion = null;
  }
  function invitar() {
    if (!hayPasos() || TS.leer(clave())) return;
    invitacion = TS.el('aside', { class: 'tour-invita', 'aria-label': 'Invitación al recorrido' },
      TS.el('span', { class: 'sello sello--s', 'data-sello': 'TITULO SEGURO', 'data-estado': 'ok', role: 'img', 'aria-label': 'Sello de Título Seguro' }),
      TS.el('p', null, TS.el('strong', null, '¿Primera vez aquí?'), 'Te muestro esta página en un minuto, paso a paso.'),
      TS.el('div', { class: 'grupo' },
        TS.el('button', { type: 'button', class: 'boton boton--oro boton--chico', onclick: () => iniciar(0) }, 'Empezar recorrido'),
        TS.el('button', { type: 'button', class: 'boton boton--fantasma boton--chico', style: { color: 'var(--hoja)' }, onclick: () => quitarInvitacion(true) }, 'Ahora no')));
    d.body.append(invitacion);
  }

  d.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-accion="tour"]');
    if (!b) return;
    ev.preventDefault();
    iniciar(0);
  });

  TS.tour = { iniciar, cerrar, hayPasos };
  TS.listo(() => window.setTimeout(invitar, 1400));
})();
