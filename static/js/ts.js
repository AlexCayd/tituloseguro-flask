/* Título Seguro · núcleo. Expone window.TS (espacio de nombres único).
 *
 *   TS.api(url, {method, body})  → Promise<{ok, status, data}>  (CSRF + X-Requested-With + JSON)
 *   TS.el(tag, props, ...hijos)  → crea nodos ("svg:path" para SVG). props: class, text, dataset,
 *                                  style (objeto), on<evento> (función), aria-*, resto como atributo
 *   TS.$(sel, raiz) / TS.$$(sel, raiz)
 *   TS.fmt.miles(n) · hexcorto(s, n=8) · ceros(hex) · segundos(s) · reloj(s) · hora(iso) · fecha(iso)
 *   TS.huella(hex, {dificultad, n})  → <code class="huella"> con los ceros resaltados
 *   TS.leer(clave, def) / TS.guardar(clave, valor)   (localStorage con try/catch)
 *   TS.reducido()  · TS.alCambiarMovimiento(fn)       (prefers-reduced-motion en caliente)
 *   TS.anunciar(texto)            → región aria-live="polite" global (#ts-anuncios)
 *   TS.estado.suscribir(fn) → desuscribir · TS.estado.ultimo · TS.estado.ahora()
 *                                  sondea /estado: 300 ms si hay carrera, 2 s si no, pausa si la
 *                                  pestaña está oculta. Solo sondea si alguien está suscrito.
 *   TS.folio.crear(bloque, {valido}) → <li class="folio"> igual al de la macro Jinja
 *   TS.legajo.vivo(ol)            → inserta folios nuevos sin recargar ([data-legajo-vivo])
 *   [data-vivo="campo"] (+ data-vivo-fmt="miles")   se actualiza solo con /estado
 *   [data-revela]                 aparece al entrar en pantalla (una vez)
 *   time[data-local]              se reescribe en la hora local del navegador
 */
(() => {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const d = document;
  const html = d.documentElement;

  /* ------------------------------------------------------------------ movimiento */
  const mqReducido = window.matchMedia('(prefers-reduced-motion: reduce)');
  TS.reducido = () => mqReducido.matches;
  TS.alCambiarMovimiento = (fn) => mqReducido.addEventListener('change', fn);

  /* ------------------------------------------------------------------ DOM */
  TS.$ = (s, r = d) => r.querySelector(s);
  TS.$$ = (s, r = d) => Array.from(r.querySelectorAll(s));
  const SVGNS = 'http://www.w3.org/2000/svg';
  TS.el = function el(tag, props, ...hijos) {
    const esSvg = tag.startsWith('svg:');
    const n = esSvg ? d.createElementNS(SVGNS, tag.slice(4)) : d.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.setAttribute('class', v);
        else if (k === 'text') n.textContent = v;
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k === 'style' && typeof v === 'object') {
          for (const [p, val] of Object.entries(v)) n.style.setProperty(p, val);
        } else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const h of hijos.flat(Infinity)) {
      if (h == null || h === false) continue;
      n.append(h instanceof Node ? h : d.createTextNode(String(h)));
    }
    return n;
  };
  TS.icono = (nombre, clase = 'icono') =>
    TS.el('svg:svg', { class: clase, 'aria-hidden': 'true', focusable: 'false', viewBox: '0 0 24 24' },
      TS.el('svg:use', { href: `#i-${nombre}` }));

  /* ------------------------------------------------------------------ formato */
  const nf = new Intl.NumberFormat('es-MX');
  const nf1 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
  TS.fmt = {
    miles: (n) => (n == null || n === '' || Number.isNaN(+n) ? '—' : nf.format(Math.round(+n))),
    decimal: (n) => nf1.format(+n || 0),
    hexcorto: (s, n = 8) => {
      s = String(s ?? '');
      return s.length <= 2 * n + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
    },
    ceros: (h) => (/^0*/.exec(String(h || ''))[0] || '').length,
    segundos: (s) => {
      s = +s || 0;
      if (s > 0 && s < 1) return `${nf2.format(s)} s`;   // 0.02 s, no «0 s»
      if (s < 10) return `${nf1.format(s)} s`;
      if (s < 90) return `${Math.round(s)} s`;
      const m = Math.floor(s / 60);
      return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
    },
    reloj: (s) => {
      s = Math.max(0, +s || 0);
      const m = Math.floor(s / 60);
      const r = s - m * 60;
      return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
    },
    hora: (iso) => {
      const t = new Date(iso);
      return Number.isNaN(+t) ? '' : t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },
    fecha: (iso) => {
      const t = new Date(iso);
      return Number.isNaN(+t) ? String(iso || '') : t.toLocaleString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    },
  };

  /* huella con ceros resaltados (mismo marcado que la macro huella() de Jinja) */
  TS.huella = (hex, { dificultad = null, n = 0, clase = '' } = {}) => {
    hex = String(hex || '');
    const c = TS.fmt.ceros(hex);
    const tope = n && hex.length > n ? n : hex.length;
    const ceros = hex.slice(0, Math.min(c, tope));
    const resto = hex.slice(ceros.length, tope);
    const cumple = dificultad != null && c >= dificultad;
    return TS.el('code', { class: `huella${cumple ? ' huella--cumple' : ''}${clase ? ` ${clase}` : ''}`, title: hex || null },
      TS.el('span', { class: 'huella__ceros' }, ceros),
      TS.el('span', { class: 'huella__resto' }, resto),
      tope < hex.length ? TS.el('span', { class: 'huella__elipsis', 'aria-hidden': 'true' }, '…') : null);
  };

  /* ------------------------------------------------------------------ almacenamiento */
  TS.leer = (k, def = null) => {
    try { const v = window.localStorage.getItem(k); return v === null ? def : v; } catch { return def; }
  };
  TS.guardar = (k, v) => {
    try { window.localStorage.setItem(k, String(v)); } catch { /* modo privado o lleno: no pasa nada */ }
  };

  /* ------------------------------------------------------------------ red */
  TS.csrf = () => (d.querySelector('meta[name="csrf-token"]') || {}).content || '';
  TS.api = async (url, { method = 'GET', body } = {}) => {
    const m = String(method).toUpperCase();
    const lectura = m === 'GET' || m === 'HEAD';
    const headers = { 'X-Requested-With': 'fetch', Accept: 'application/json' };
    if (!lectura) {
      headers['X-CSRF-Token'] = TS.csrf();
      headers['Content-Type'] = 'application/json';
    }
    try {
      const r = await fetch(url, {
        method: m, headers, credentials: 'same-origin', cache: 'no-store',
        body: lectura ? undefined : JSON.stringify(body ?? {}),
      });
      let data = null;
      try { data = await r.json(); } catch { data = null; }
      return { ok: r.ok && !(data && data.ok === false), status: r.status, data };
    } catch {
      return { ok: false, status: 0, data: { ok: false, error: 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.' } };
    }
  };

  /* ------------------------------------------------------------------ anuncios accesibles */
  TS.anunciar = (texto) => {
    const r = d.getElementById('ts-anuncios');
    if (!r || !texto) return;
    r.textContent = '';
    window.setTimeout(() => { r.textContent = texto; }, 80);
  };

  /* ------------------------------------------------------------------ sondeo de /estado */
  TS.estado = (() => {
    const subs = new Set();
    let ultimo = null;
    let timer = 0;
    let enVuelo = false;
    let fallos = 0;
    const semilla = d.getElementById('ts-estado-inicial');
    if (semilla) {
      try { ultimo = JSON.parse(semilla.textContent); } catch { ultimo = null; }
    }
    const intervalo = () => (ultimo && ultimo.minando ? 300 : Math.min(2000 * 2 ** fallos, 16000));
    const emitir = () => {
      for (const fn of subs) {
        try { fn(ultimo); } catch (e) { console.error(e); }
      }
    };
    function programar(ms) {
      window.clearTimeout(timer);
      timer = 0;
      if (!subs.size || d.hidden || ms < 0) return;
      timer = window.setTimeout(sondear, ms);
    }
    async function sondear() {
      timer = 0;
      if (enVuelo) return;
      enVuelo = true;
      const r = await TS.api('/estado');
      enVuelo = false;
      if (r.ok && r.data && r.data.nodos) {
        fallos = 0;
        ultimo = r.data;
        emitir();
      } else {
        fallos = Math.min(fallos + 1, 3);
      }
      programar(intervalo());
    }
    d.addEventListener('visibilitychange', () => programar(d.hidden ? -1 : 0));
    return {
      get ultimo() { return ultimo; },
      suscribir(fn) {
        subs.add(fn);
        if (ultimo) {
          try { fn(ultimo); } catch (e) { console.error(e); }
        }
        if (!timer && !enVuelo) programar(ultimo && ultimo.minando ? 300 : 1500);
        return () => subs.delete(fn);
      },
      ahora() { programar(0); },
    };
  })();

  /* ------------------------------------------------------------------ folios (bloques) */
  const TIPO = { 'título': 'Título', diploma: 'Diploma', certificado: 'Certificado', constancia: 'Constancia' };
  const tono = (h) => {
    const c = TS.fmt.ceros(h);
    return parseInt(String(h || '').slice(c, c + 3) || '0', 16) % 360;
  };
  TS.folio = {
    muestra: (h) => `oklch(64% 0.13 ${tono(h)})`,
    tipo: (t) => TIPO[t] || t || '',
    crear(b, { valido = true } = {}) {
      const tx = b.transaccion || {};
      const c = tx.contenido || {};
      const prop = tx.proposito;
      const num = b.numero;
      const genesis = prop === 'genesis' || num === 0;
      const rev = prop === 'revocacion';
      const clase = genesis ? 'genesis' : rev ? 'revocacion' : 'registro';
      const fecha = String(b.timestamp || '');
      const fila = (mod, rotulo, hash, dif) => TS.el('p', { class: `folio__fila folio__fila--${mod}` },
        TS.el('span', { class: 'folio__rotulo' },
          TS.el('span', { class: 'folio__muestra', style: { '--muestra': TS.folio.muestra(hash) }, 'aria-hidden': 'true' }), rotulo),
        TS.huella(hash, { dificultad: dif }));

      let asunto;
      let meta;
      if (genesis) {
        asunto = TS.el('p', { class: 'folio__asunto' }, 'Primera hoja del libro');
        meta = TS.el('p', { class: 'folio__meta' }, TS.el('span', null, c.mensaje || 'Bloque génesis'));
      } else if (rev) {
        asunto = TS.el('p', { class: 'folio__asunto' }, 'Revocación de ', TS.el('span', { class: 'mono' }, c.folio_revocado));
        meta = TS.el('p', { class: 'folio__meta' }, TS.el('span', null, 'Motivo: ', TS.el('strong', null, c.motivo)));
      } else {
        asunto = TS.el('p', { class: 'folio__asunto' }, `${TS.folio.tipo(c.tipo)} en `, TS.el('em', null, c.programa));
        meta = TS.el('p', { class: 'folio__meta' },
          TS.el('span', null, 'Folio ', TS.el('strong', { class: 'mono' }, c.folio)),
          TS.el('span', null, c.universidad),
          TS.el('span', null, `Emitido ${c.fecha_emision}`));
      }
      const quien = genesis
        ? TS.el('p', { class: 'folio__meta' }, TS.el('span', null, 'Nadie lo minó: es el punto de partida.'))
        : TS.el('p', { class: 'folio__meta' },
          TS.el('span', null, 'Lo selló ', TS.el('strong', null, b.minero)),
          TS.el('span', null, 'nonce ', TS.el('strong', { class: 'mono' }, TS.fmt.miles(b.nonce))),
          TS.el('span', null, `${b.dificultad} ceros`),
          TS.el('span', null, `+${b.recompensa} TS`));

      const sello = genesis
        ? TS.el('span', { class: 'sello sello--m', 'data-sello': b.hash, 'data-estado': 'pendiente', role: 'img', 'aria-label': 'El génesis no lleva firma: solo el molde del sello' },
          TS.el('span', { class: 'sello__respaldo', 'aria-hidden': 'true' }, 'TS'))
        : TS.el('span', {
          class: 'sello sello--m', 'data-sello': b.firma, 'data-estado': valido ? 'ok' : 'roto',
          'data-sello-letras': rev ? null : c.universidad, role: 'img',
          'aria-label': `Sello de la firma del folio ${num}${valido ? '' : ' (agrietado: algo no cuadra)'}`,
        }, TS.el('span', { class: 'sello__respaldo', 'aria-hidden': 'true' }, (rev ? '' : c.universidad) || 'TS'));

      return TS.el('li', { class: `folio folio--${clase}${num % 2 === 0 ? ' folio--par' : ''}${valido ? '' : ' folio--roto'}`, 'data-numero': num, id: `folio-${num}` },
        TS.el('span', { class: 'ojal folio__ojal folio__ojal--arriba', 'aria-hidden': 'true' }),
        TS.el('span', { class: 'ojal folio__ojal folio__ojal--abajo', 'aria-hidden': 'true' }),
        TS.el('span', { class: 'cordon folio__cordon', 'aria-hidden': 'true' }),
        TS.el('span', { class: 'folio__nudo', 'aria-hidden': 'true' }, 'misma huella'),
        TS.el('header', { class: 'folio__cabeza' },
          TS.el('h3', { class: 'folio__num' }, TS.el('small', null, 'Folio'), String(num)),
          TS.el('time', { class: 'folio__fecha', datetime: fecha, 'data-local': '' }, fecha ? TS.fmt.fecha(fecha) : ''),
          TS.el('span', { class: 'sello-goma sello-goma--chico', 'data-estado': valido ? 'valida' : 'invalida' }, valido ? 'Íntegro' : 'Alterado')),
        fila('huella', 'Huella de este folio', b.hash, genesis ? null : b.dificultad),
        TS.el('div', { class: 'folio__cuerpo' }, asunto, meta, quien),
        TS.el('figure', { class: 'folio__sello' }, sello,
          TS.el('figcaption', null, genesis ? 'Sin firma' : rev ? 'Firma de quien revoca' : `Firma de ${c.universidad}`)),
        fila('anterior', genesis ? 'Antes no hay nada' : `Huella del folio ${num - 1}`, b.hash_anterior, null));
    },
  };

  /* ------------------------------------------------------------------ legajo en vivo */
  TS.legajo = {
    vivo(ol) {
      if (!ol || ol.dataset.vivoListo) return;
      ol.dataset.vivoListo = '1';
      const max = +(ol.dataset.max || 6);
      let ocupado = false;
      const tope = () => {
        const li = ol.querySelector('.folio[data-numero]');
        return li ? +li.dataset.numero : -1;
      };
      TS.estado.suscribir(async (e) => {
        const ultimo = (e.longitud || 0) - 1;
        if (ocupado || ultimo <= tope()) return;
        ocupado = true;
        try {
          // se pide siempre la ventana completa: si se sella otra hoja entre el sondeo y esta
          // petición, pedir solo «las que faltan» devolvería una ventana corrida y dejaría huecos
          const r = await TS.api(`/api/cadena?limite=${max}`);
          if (!r.ok || !r.data || !Array.isArray(r.data.bloques)) return;
          const malos = new Set((r.data.problemas || []).map((p) => p.bloque));
          const nuevos = r.data.bloques.filter((b) => b.numero > tope()).sort((a, b) => a.numero - b.numero);
          if (!nuevos.length) return;
          const previos = TS.$$('.folio', ol);
          const antes = new Map(previos.map((li) => [li, li.getBoundingClientRect().top]));
          let ultimoLi = null;
          for (const b of nuevos) {
            ultimoLi = TS.folio.crear(b, { valido: !malos.has(b.numero) });
            ultimoLi.classList.add('folio--nuevo');
            ol.prepend(ultimoLi);
          }
          const sobran = TS.$$('.folio', ol).slice(max);
          if (!TS.reducido()) {
            for (const [li, top] of antes) {
              const dy = top - li.getBoundingClientRect().top;
              if (dy && li.isConnected) {
                li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
                  { duration: 460, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' });
              }
            }
          }
          for (const li of sobran) {
            if (TS.reducido()) li.remove();
            else li.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in' }).finished.then(() => li.remove(), () => li.remove());
          }
          if (ultimoLi && TS.sello) {
            const s = ultimoLi.querySelector('.sello[data-estado="ok"]');
            if (s) window.setTimeout(() => TS.sello.estampar(s), 260);
          }
          window.setTimeout(() => TS.$$('.folio--nuevo', ol).forEach((li) => li.classList.remove('folio--nuevo')), 1200);
          // sello de validez de la cadena (si la página lo tiene)
          TS.$$('[data-cadena-valida]').forEach((el) => {
            const ok = !!r.data.valida;
            if (el.dataset.estado === (ok ? 'valida' : 'invalida')) return;
            el.dataset.estado = ok ? 'valida' : 'invalida';
            el.textContent = ok ? (el.dataset.textoOk || 'Cadena íntegra') : (el.dataset.textoMal || 'Cadena rota');
            el.classList.remove('sello-goma--estampa');
            void el.offsetWidth;
            el.classList.add('sello-goma--estampa');
          });
        } finally {
          ocupado = false;
        }
      });
    },
  };

  /* ------------------------------------------------------------------ enlaces vivos */
  const valorDe = (obj, ruta) => ruta.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  function enlazarVivos() {
    const vivos = TS.$$('[data-vivo]');
    if (!vivos.length) return;
    TS.estado.suscribir((e) => {
      for (const el of vivos) {
        const v = valorDe(e, el.dataset.vivo);
        if (v == null) continue;
        const t = el.dataset.vivoFmt === 'miles' ? TS.fmt.miles(v) : String(v);
        if (el.textContent !== t) el.textContent = t;
      }
    });
  }

  /* ------------------------------------------------------------------ apariciones */
  function revelar() {
    const els = TS.$$('[data-revela]');
    if (!els.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entradas) => {
      for (const en of entradas) {
        if (en.isIntersecting) {
          en.target.classList.add('visto');
          io.unobserve(en.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });
    const alto = window.innerHeight;
    for (const el of els) {
      if (el.getBoundingClientRect().top < alto * 0.92) el.classList.add('visto');
      else io.observe(el);
    }
    html.classList.add('revela-listo');
  }

  /* ------------------------------------------------------------------ cordón de la historia */
  function cordonHistoria() {
    const h = TS.$('.historia');
    if (!h) return;
    const svg = TS.$('.historia__cordon', h);
    if (!svg) return;
    const trazos = TS.$$('[data-cordon-trazo]', svg);
    const dibujar = () => {
      const alto = h.offsetHeight;
      const ojales = TS.$$('.capitulo__ojal', h).map((o) => o.offsetTop + o.offsetHeight / 2 + (o.offsetParent === h ? 0 : o.offsetParent.offsetTop));
      const angosto = window.matchMedia('(max-width: 40rem)').matches;
      const amp = angosto ? 3 : 9;
      const x = 16;
      let dd = `M${x} 0`;
      let y0 = 0;
      let lado = 1;
      for (const y of [...ojales, alto]) {
        const m = (y - y0) / 2;
        dd += ` C${x + amp * lado} ${y0 + m * 0.6} ${x + amp * lado} ${y - m * 0.6} ${x} ${y}`;
        y0 = y;
        lado = -lado;
      }
      svg.setAttribute('viewBox', `0 0 32 ${alto}`);
      svg.setAttribute('height', alto);
      trazos.forEach((p) => p.setAttribute('d', dd));
      h.classList.add('tiene-cordon');
    };
    dibujar();
    if ('ResizeObserver' in window) new ResizeObserver(() => window.requestAnimationFrame(dibujar)).observe(h);
    window.addEventListener('load', dibujar, { once: true });

    // respaldo para navegadores sin animation-timeline: el JS mueve el trazo con el scroll
    if (!(window.CSS && CSS.supports('animation-timeline: view()'))) {
      let pendiente = false;
      const avanzar = () => {
        pendiente = false;
        if (TS.reducido()) { svg.style.setProperty('--cordon-avance', '0'); return; }
        const r = h.getBoundingClientRect();
        const linea = window.innerHeight * 0.62;
        const p = Math.min(1, Math.max(0, (linea - r.top) / r.height));
        svg.style.setProperty('--cordon-avance', String(1 - p));
      };
      const pedir = () => { if (!pendiente) { pendiente = true; window.requestAnimationFrame(avanzar); } };
      window.addEventListener('scroll', pedir, { passive: true });
      window.addEventListener('resize', pedir);
      TS.alCambiarMovimiento(pedir);
      avanzar();
    }
  }

  /* ------------------------------------------------------------------ sellos que se agrietan al verse */
  function agrietarAlVer() {
    const els = TS.$$('[data-agrietar]');
    if (!els.length) return;
    const agrietar = (el) => TS.sello && TS.sello.agrietar(el);
    if (!('IntersectionObserver' in window)) { els.forEach(agrietar); return; }
    const io = new IntersectionObserver((entradas) => {
      for (const en of entradas) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        window.setTimeout(() => agrietar(en.target), TS.reducido() ? 0 : 650);
      }
    }, { threshold: 0.7 });
    els.forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------------------ hora local */
  function horasLocales(raiz = d) {
    TS.$$('time[data-local]', raiz).forEach((t) => {
      const iso = t.getAttribute('datetime');
      if (iso) t.textContent = TS.fmt.fecha(iso);
    });
  }

  /* ------------------------------------------------------------------ mensajes flash */
  function avisos() {
    d.addEventListener('click', (ev) => {
      const b = ev.target.closest('.alerta__cerrar');
      if (!b) return;
      const a = b.closest('.alerta');
      if (!a) return;
      a.setAttribute('data-saliendo', '');
      window.setTimeout(() => a.remove(), TS.reducido() ? 0 : 200);
    });
  }

  /* ------------------------------------------------------------------ menú móvil */
  function menu() {
    const m = d.getElementById('menu-principal');
    if (!m || typeof m.hidePopover !== 'function') return;
    const ancho = window.matchMedia('(min-width: 64rem)');
    ancho.addEventListener('change', () => {
      try { if (m.matches(':popover-open')) m.hidePopover(); } catch { /* sin soporte */ }
    });
  }

  /* ------------------------------------------------------------------ arranque */
  /* TS.listo(fn): corre fn cuando el DOM está listo Y todos los módulos defer (sello, glosario,
     tour, explicador, carrera) ya se cargaron. Ojo: los scripts defer se ejecutan con
     readyState === 'interactive' pero ANTES de DOMContentLoaded; por eso se encola. */
  const pendientes = [];
  let domListo = d.readyState === 'complete';
  const correr = (fn) => { try { fn(); } catch (e) { console.error(e); } };
  if (!domListo) {
    d.addEventListener('DOMContentLoaded', () => {
      domListo = true;
      pendientes.splice(0).forEach(correr);
    }, { once: true });
  }
  TS.listo = (fn) => (domListo ? correr(fn) : pendientes.push(fn));
  TS.listo(() => {
    horasLocales();
    avisos();
    menu();
    revelar();
    cordonHistoria();
    enlazarVivos();
    agrietarAlVer();
    TS.$$('[data-legajo-vivo]').forEach((ol) => TS.legajo.vivo(ol));
  });
})();
