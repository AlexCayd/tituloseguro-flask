/* Título Seguro · Modo explicador.
 *
 *   Interruptor:  <button type="button" data-accion="explicador" aria-pressed="false">…</button>
 *   Al activarlo: <html data-explicador="on"> y un pin numerado sobre cada elemento con
 *                 data-explica="texto" [data-explica-titulo="…"]. La tarjeta aparece con
 *                 hover / foco / clic (clic la fija). Esc la cierra. El estado se recuerda.
 *   API:  TS.explicador.activar() · desactivar() · alternar() · refrescar() · activo
 */
(() => {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const d = document;
  const html = d.documentElement;
  const CLAVE = 'ts.explicador';

  let activo = false;
  let capa = null;
  let tarjeta = null;
  let pines = [];
  let actual = null;
  let fijo = false;
  let raf = 0;
  let ro = null;
  let mo = null;
  let rehacer = 0;

  const botones = () => TS.$$('[data-accion="explicador"]');
  function sincronizar() {
    html.dataset.explicador = activo ? 'on' : 'off';
    botones().forEach((b) => b.setAttribute('aria-pressed', activo ? 'true' : 'false'));
  }
  function visible(el) {
    if (el.closest('[hidden], dialog:not([open]), [inert], .tour')) return false;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function asegurarCapa() {
    capa = d.getElementById('ts-pines');
    if (!capa) {
      capa = TS.el('div', { id: 'ts-pines', class: 'pines' });
      d.body.append(capa);
    }
    if (!tarjeta) {
      tarjeta = TS.el('div', { id: 'ts-explica-tarjeta', class: 'explica-tarjeta', role: 'tooltip', hidden: true },
        TS.el('p', null, TS.el('span', { class: 'explica-tarjeta__num' }), TS.el('span', { class: 'explica-tarjeta__titulo' })),
        TS.el('p', { class: 'explica-tarjeta__texto' }));
      d.body.append(tarjeta);
      tarjeta.addEventListener('mouseenter', () => { tarjeta.dataset.sobre = '1'; });
      tarjeta.addEventListener('mouseleave', () => { delete tarjeta.dataset.sobre; if (!fijo) ocultar(); });
    }
  }

  function construir() {
    asegurarCapa();
    ocultar();
    capa.replaceChildren();
    pines = [];
    TS.$$('[data-explica]').filter(visible).forEach((el, i) => {
      const titulo = el.dataset.explicaTitulo || '';
      const b = TS.el('button', {
        type: 'button', class: 'pin', style: { '--n': String(i) },
        'aria-label': `Explicación ${i + 1}${titulo ? `: ${titulo}` : ''}`,
        'aria-describedby': 'ts-explica-tarjeta', 'aria-expanded': 'false',
      }, String(i + 1));
      b.addEventListener('mouseenter', () => { if (!fijo) mostrar(p); });
      b.addEventListener('mouseleave', () => {
        window.setTimeout(() => { if (!fijo && actual === p && !tarjeta.dataset.sobre) ocultar(); }, 120);
      });
      b.addEventListener('focus', () => { if (!fijo || actual !== p) { fijo = false; mostrar(p); } });
      b.addEventListener('blur', () => { window.setTimeout(() => { if (!fijo && actual === p && !tarjeta.dataset.sobre) ocultar(); }, 80); });
      b.addEventListener('click', () => {
        if (fijo && actual === p) { fijo = false; ocultar(); return; }
        fijo = true;
        mostrar(p);
      });
      const p = { el, b, n: i + 1, titulo, texto: el.dataset.explica };
      pines.push(p);
      capa.append(b);
    });
    posicionar();
  }

  function posicionar() {
    raf = 0;
    if (!activo) return;
    const ancho = d.documentElement.clientWidth;
    const usados = [];
    for (const p of pines) {
      const r = p.el.getBoundingClientRect();
      if (!r.width && !r.height) { p.b.hidden = true; continue; }
      p.b.hidden = false;
      let x = Math.min(Math.max(r.left + window.scrollX + 4, 18), ancho + window.scrollX - 18);
      const y = Math.max(r.top + window.scrollY + 4, 18);
      // evita que dos pines caigan uno sobre otro
      while (usados.some(([ux, uy]) => Math.abs(ux - x) < 30 && Math.abs(uy - y) < 30)) x += 32;
      usados.push([x, y]);
      p.b.style.left = `${Math.round(x)}px`;
      p.b.style.top = `${Math.round(y)}px`;
    }
    if (actual) colocarTarjeta();
  }
  const pedir = () => { if (activo && !raf) raf = window.requestAnimationFrame(posicionar); };

  function mostrar(p) {
    if (actual && actual !== p) actual.b.setAttribute('aria-expanded', 'false');
    actual = p;
    TS.$('.explica-tarjeta__num', tarjeta).textContent = String(p.n);
    TS.$('.explica-tarjeta__titulo', tarjeta).textContent = p.titulo || 'Qué es esto';
    TS.$('.explica-tarjeta__texto', tarjeta).textContent = p.texto;
    tarjeta.hidden = false;
    p.b.setAttribute('aria-expanded', 'true');
    colocarTarjeta();
  }
  function colocarTarjeta() {
    if (!actual || tarjeta.hidden) return;
    if (window.matchMedia('(max-width: 40rem)').matches) { tarjeta.style.left = ''; tarjeta.style.top = ''; return; }
    const r = actual.b.getBoundingClientRect();
    const w = tarjeta.offsetWidth;
    const h = tarjeta.offsetHeight;
    const m = 12;
    let x = r.right + 10;
    if (x + w > window.innerWidth - m) x = r.left - w - 10;
    x = Math.max(m, Math.min(x, window.innerWidth - w - m));
    let y = r.top - 6;
    if (y + h > window.innerHeight - m) y = window.innerHeight - h - m;
    y = Math.max(m, y);
    tarjeta.style.left = `${Math.round(x)}px`;
    tarjeta.style.top = `${Math.round(y)}px`;
  }
  function ocultar() {
    if (tarjeta) tarjeta.hidden = true;
    if (actual) actual.b.setAttribute('aria-expanded', 'false');
    actual = null;
    fijo = false;
  }

  function activar() {
    activo = true;
    TS.guardar(CLAVE, 'on');
    sincronizar();
    construir();
    if (!ro && 'ResizeObserver' in window) {
      ro = new ResizeObserver(pedir);
      ro.observe(d.body);
    }
    if (!mo) {
      // solo reconstruye si entran/salen elementos explicados o cambia su visibilidad;
      // la carrera reescribe texto cada 300 ms y eso no debe tocar los pines
      const tiene = (n) => n.nodeType === 1 && (n.matches('[data-explica]') || !!n.querySelector('[data-explica]'));
      const relevante = (m) => {
        if (capa.contains(m.target) || m.target === tarjeta || tarjeta.contains(m.target)) return false;
        if (m.type === 'attributes') return m.attributeName === 'data-explica' || tiene(m.target);
        return [...m.addedNodes, ...m.removedNodes].some(tiene);
      };
      mo = new MutationObserver((muts) => {
        if (!muts.some(relevante)) { pedir(); return; }
        window.clearTimeout(rehacer);
        rehacer = window.setTimeout(() => activo && construir(), 200);
      });
    }
    mo.observe(d.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-explica', 'hidden'] });
  }
  function desactivar() {
    activo = false;
    TS.guardar(CLAVE, 'off');
    sincronizar();
    ocultar();
    if (capa) capa.replaceChildren();
    pines = [];
    if (mo) mo.disconnect();
  }
  const alternar = () => (activo ? desactivar() : activar());

  d.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-accion="explicador"]');
    if (b) { ev.preventDefault(); alternar(); TS.anunciar(activo ? 'Modo explicador activado: cada parte tiene un número con su explicación.' : 'Modo explicador desactivado.'); return; }
    if (fijo && tarjeta && !tarjeta.contains(ev.target) && !ev.target.closest('.pin')) ocultar();
  });
  d.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && actual) {
      const p = actual;
      ocultar();
      p.b.focus();
    }
  });
  window.addEventListener('resize', pedir);
  d.addEventListener('scroll', (ev) => { if (ev.target !== d) pedir(); else if (actual) colocarTarjeta(); }, { capture: true, passive: true });
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(pedir);
  window.addEventListener('load', pedir);

  TS.explicador = {
    activar, desactivar, alternar,
    refrescar: () => activo && construir(),
    get activo() { return activo; },
  };

  TS.listo(() => {
    if (html.dataset.explicador === 'on' || TS.leer(CLAVE) === 'on') activar();
    else sincronizar();
  });
})();
