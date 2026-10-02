/* Título Seguro · cronómetro (ADMIN).
 *   POST /api/cronometro/iniciar {rondas:{"3":n,"4":n,"5":n}} · POST /api/cronometro/cancelar
 *   GET  /api/cronometro/estado  (se sondea cada segundo mientras está activo)
 *   Mide en cadenas desechables: la cadena real no se toca.
 *   La gráfica es un SVG propio dibujado al ancho real de su caja (el texto nunca se encoge):
 *   barras en escala logarítmica de intentos medidos frente a teóricos (16^d). La tabla es su equivalente.
 */
(() => {
  'use strict';
  const TS = window.TS;
  if (!TS) return;
  const miles = (n) => TS.fmt.miles(n);
  const nf3 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const nf2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const compacto = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });

  TS.listo(() => {
    const form = TS.$('#crono');
    if (!form) return;
    const C = (k) => document.querySelector(`[data-c="${k}"]`);
    const inputs = TS.$$('input[data-dif]', form);
    const btnIniciar = C('iniciar');
    const btnCancelar = C('cancelar');
    const error = C('error');
    let estado = null;
    try { estado = JSON.parse(document.getElementById('ts-estado-inicial').textContent); } catch { estado = null; }
    let vel = 0;
    let timer = 0;
    let terminadoAntes = !!(estado && (estado.terminado || estado.cancelado));

    const filas = (res) => Object.values(res || {}).sort((a, b) => a.dificultad - b.dificultad);
    const velDe = (res) => {
      const xs = filas(res).map((x) => x.hashrate_medio).filter(Boolean);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };

    /* -------------------------------------------------------------- estimación */
    function estimar() {
      let total = 0;
      inputs.forEach((inp) => {
        const d = +inp.dataset.dif;
        const n = Math.max(0, Math.min(60, Math.round(+inp.value || 0)));
        const t = vel ? 16 ** d / vel : 0;
        total += n * t;
        const est = C(`est-${d}`);
        if (est) est.textContent = n === 0 ? 'Se salta esta dificultad.' : vel ? `≈ ${TS.fmt.segundos(t)} por ronda` : `${n} ${n === 1 ? 'ronda' : 'rondas'}`;
      });
      C('total').textContent = vel
        ? `Tiempo estimado: ≈ ${TS.fmt.segundos(total)} en total.`
        : 'El tiempo estimado aparece cuando el servidor ya hizo al menos una carrera o medición.';
    }
    vel = velDe(estado && estado.resultados);
    TS.api('/estado').then((r) => {
      if (r.ok && r.data && r.data.hashrate_ultima) { vel = r.data.hashrate_ultima; estimar(); }
    });
    form.addEventListener('input', estimar);
    estimar();

    /* -------------------------------------------------------------- tabla */
    function pintarTabla(res) {
      const tb = C('filas');
      const fs = filas(res);
      if (!fs.length) {
        tb.replaceChildren(TS.el('tr', { class: 'crono__vacia' }, TS.el('td', { colspan: '8' }, 'Cuando termine la primera ronda, aquí aparecerán los números.')));
        return;
      }
      tb.replaceChildren(...fs.map((x) => TS.el('tr', null,
        TS.el('th', { scope: 'row' }, `${x.dificultad} ceros`),
        TS.el('td', { class: 'num' }, String(x.rondas)),
        TS.el('td', { class: 'num' }, TS.el('strong', null, `${nf3.format(x.tiempo_medio)} s`)),
        TS.el('td', { class: 'num' }, `${nf3.format(x.tiempo_min)} – ${nf3.format(x.tiempo_max)} s`),
        TS.el('td', { class: 'num' }, miles(x.intentos_medios)),
        TS.el('td', { class: 'num' }, miles(x.intentos_teoricos)),
        TS.el('td', { class: 'num' }, `${nf2.format(x.intentos_medios / x.intentos_teoricos)}×`),
        TS.el('td', { class: 'num' }, miles(x.hashrate_medio)))));
      const fac = [];
      let lejos = false;
      for (let i = 1; i < fs.length; i++) {
        if (fs[i].dificultad === fs[i - 1].dificultad + 1 && fs[i - 1].tiempo_medio > 0) {
          const f = fs[i].tiempo_medio / fs[i - 1].tiempo_medio;
          if (f < 8 || f > 32) lejos = true;
          fac.push(`de ${fs[i - 1].dificultad} a ${fs[i].dificultad} ceros el tiempo se multiplicó por ${nf1.format(f)}`);
        }
      }
      C('factor').textContent = fac.length
        ? `En esta medición, ${fac.join('; ')}. La teoría dice 16.${lejos ? ' Con pocas rondas la suerte pesa mucho: mide más rondas para acercarte a 16.' : ''}`
        : '';
    }

    /* -------------------------------------------------------------- gráfica SVG (escala logarítmica) */
    const S = (tag, a, ...h) => TS.el(`svg:${tag}`, a, ...h);
    const ETIQ = { 3: '1 mil', 4: '10 mil', 5: '100 mil', 6: '1 millón', 7: '10 millones', 8: '100 millones' };
    let ultimoRes = null;
    let ultimoAncho = 0;
    function grafica(res) {
      ultimoRes = res;
      const caja = C('grafica');
      const fig = C('grafica-caja');
      const fs = filas(res);
      if (!caja || !fig) return;
      if (!fs.length) { fig.hidden = true; return; }
      fig.hidden = false;
      const W = Math.max(280, Math.round(caja.clientWidth));
      ultimoAncho = W;
      const H = Math.round(Math.min(340, Math.max(250, W * 0.48)));
      const m = { t: 34, r: 10, b: 46, l: 78 };
      const maxV = Math.max(...fs.map((x) => Math.max(x.intentos_medios, x.intentos_teoricos)));
      const lo = 3;
      const hi = Math.max(7, Math.ceil(Math.log10(maxV * 1.15)));
      const y = (v) => m.t + (H - m.t - m.b) * (1 - (Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo));
      const gw = (W - m.l - m.r) / fs.length;
      const bw = Math.min(44, gw * 0.26);
      const angosta = gw < 150;   // en móvil: cifras compactas y sin rótulo del teórico (sigue en la tabla)
      const cifra = (n) => (angosta ? compacto.format(n) : miles(n));
      const ejeY = H - m.b;
      const partes = [];
      for (let e = lo; e <= hi; e++) {
        const yy = y(10 ** e);
        partes.push(S('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: e === lo ? 'g-eje' : 'g-guia' }),
          S('text', { x: m.l - 8, y: yy + 4, class: 'g-escala', 'text-anchor': 'end' }, ETIQ[e] || `10^${e}`));
      }
      fs.forEach((x, i) => {
        const cx = m.l + gw * (i + 0.5);
        const yt = y(x.intentos_teoricos);
        const ym = y(x.intentos_medios);
        partes.push(
          S('rect', { x: cx - bw - 3, y: yt, width: bw, height: Math.max(0, ejeY - yt), class: 'g-teorico', rx: 2 }),
          S('rect', { x: cx + 3, y: ym, width: bw, height: Math.max(0, ejeY - ym), class: 'g-medido', rx: 2 }),
          angosta ? null : S('text', { x: cx - bw / 2 - 3, y: yt - 6, class: 'g-valor', 'text-anchor': 'middle' }, cifra(x.intentos_teoricos)),
          S('text', { x: angosta ? cx : cx + bw / 2 + 3, y: Math.min(ym, yt) - 6, class: 'g-valor g-valor--medido', 'text-anchor': 'middle' }, cifra(x.intentos_medios)),
          S('text', { x: cx, y: ejeY + 20, class: 'g-grupo', 'text-anchor': 'middle' }, `${x.dificultad} ceros`),
          S('text', { x: cx, y: ejeY + 38, class: 'g-tiempo', 'text-anchor': 'middle' }, angosta ? `≈ ${TS.fmt.segundos(x.tiempo_medio)}` : `≈ ${TS.fmt.segundos(x.tiempo_medio)} por bloque`));
      });
      const resumen = fs.map((x) => `${x.dificultad} ceros: ${miles(x.intentos_medios)} intentos medidos frente a ${miles(x.intentos_teoricos)} teóricos, ${TS.fmt.segundos(x.tiempo_medio)} en promedio`).join('; ');
      const svg = S('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'grafica', role: 'img', 'aria-labelledby': 'g-titulo g-desc' },
        S('title', { id: 'g-titulo' }, 'Intentos por bloque según la dificultad, en escala logarítmica'),
        S('desc', { id: 'g-desc' }, `${resumen}. Los mismos datos están en la tabla.`),
        ...partes);
      caja.replaceChildren(svg);
    }
    if ('ResizeObserver' in window) {
      const caja = C('grafica');
      let raf = 0;
      new ResizeObserver(() => {
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          if (ultimoRes && caja && Math.abs(caja.clientWidth - ultimoAncho) > 4) grafica(ultimoRes);
        });
      }).observe(caja);
    }

    /* -------------------------------------------------------------- copiar */
    function tablaCopiable(tsv) {
      const fs = filas(estado && estado.resultados);
      if (!fs.length) return '';
      const cab = ['Dificultad (ceros)', 'Rondas', 'Tiempo promedio (s)', 'Mínimo (s)', 'Máximo (s)', 'Intentos medidos (promedio)', 'Intentos teóricos (16^d)', 'Medido / teórico', 'Velocidad (intentos/s)'];
      const filasTxt = fs.map((x) => tsv
        ? [x.dificultad, x.rondas, x.tiempo_medio, x.tiempo_min, x.tiempo_max, x.intentos_medios, x.intentos_teoricos, (x.intentos_medios / x.intentos_teoricos).toFixed(3), x.hashrate_medio]
        : [x.dificultad, x.rondas, nf3.format(x.tiempo_medio), nf3.format(x.tiempo_min), nf3.format(x.tiempo_max), miles(x.intentos_medios), miles(x.intentos_teoricos), nf2.format(x.intentos_medios / x.intentos_teoricos), miles(x.hashrate_medio)]);
      if (tsv) return [cab, ...filasTxt].map((f) => f.join('\t')).join('\n');
      return [`| ${cab.join(' | ')} |`, `|${cab.map(() => '---:').join('|')}|`, ...filasTxt.map((f) => `| ${f.join(' | ')} |`)].join('\n');
    }
    [['copiar-md', false], ['copiar-tsv', true]].forEach(([k, tsv]) => {
      const b = C(k);
      if (!b) return;
      b.addEventListener('click', () => {
        const texto = tablaCopiable(tsv);
        if (!texto) { TS.anunciar('Todavía no hay resultados que copiar.'); return; }
        b.dataset.copiarTexto = texto;   // lo copia el manejador común de paginas.js
      }, true);
    });

    /* -------------------------------------------------------------- estado y progreso */
    function pintar(e) {
      if (!e) return;
      estado = e;
      const activo = !!e.activo;
      btnIniciar.hidden = activo;
      btnCancelar.hidden = !activo;
      inputs.forEach((i) => { i.disabled = activo; });
      const prog = C('progreso');
      prog.hidden = !activo && !e.hechas;
      const total = e.total || 0;
      const hechas = e.hechas || 0;
      const barra = C('barra');
      barra.setAttribute('aria-valuemax', String(Math.max(1, total)));
      barra.setAttribute('aria-valuenow', String(hechas));
      barra.style.setProperty('--p', String(total ? hechas / total : 0));
      C('ahora-rotulo').textContent = activo ? 'Midiendo' : 'Estado';
      if (activo && e.actual) {
        C('ahora').textContent = `${e.actual.dificultad} ceros · ronda ${e.actual.ronda} de ${e.actual.de}`;
        const r = C('ranuras');
        if (r.children.length !== e.actual.dificultad) r.replaceChildren(...Array.from({ length: e.actual.dificultad }, () => TS.el('span', { class: 'es-cero' }, '0')));
      } else {
        C('ahora').textContent = e.terminado ? 'Terminado' : e.cancelado ? 'Cancelado' : '—';
        C('ranuras').replaceChildren();
      }
      C('cuenta').textContent = total ? `${hechas} de ${total} rondas medidas.` : '';
      C('estado').textContent = activo ? 'Midiendo… la tabla se llena sola.' : e.terminado ? 'Medición terminada.' : e.cancelado ? 'La medición se canceló: estos son resultados parciales.' : (filas(e.resultados).length ? '' : 'Todavía no hay mediciones.');
      pintarTabla(e.resultados);
      grafica(e.resultados);
    }

    async function sondear() {
      window.clearTimeout(timer);
      const r = await TS.api('/api/cronometro/estado');
      if (r.ok && r.data) {
        pintar(r.data);
        if (r.data.activo) { timer = window.setTimeout(sondear, 1000); return; }
        if (!terminadoAntes && (r.data.terminado || r.data.cancelado)) {
          TS.anunciar(r.data.terminado ? 'La medición terminó. La tabla de resultados está lista para copiar.' : 'La medición se canceló.');
        }
        terminadoAntes = true;
        const v = velDe(r.data.resultados);
        if (v) { vel = v; estimar(); }
      } else {
        timer = window.setTimeout(sondear, 2000);
      }
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.hidden = true;
      const rondas = {};
      let malo = false;
      inputs.forEach((inp) => {
        const n = Math.round(+inp.value);
        if (!Number.isFinite(n) || n < 0 || n > 60) malo = true;
        else if (n > 0) rondas[inp.dataset.dif] = n;
      });
      if (malo) { error.textContent = 'Cada dificultad admite de 0 a 60 rondas.'; error.hidden = false; return; }
      if (!Object.keys(rondas).length) { error.textContent = 'Elige al menos una ronda en alguna dificultad.'; error.hidden = false; return; }
      btnIniciar.setAttribute('aria-disabled', 'true');
      const r = await TS.api(form.getAttribute('action'), { method: 'POST', body: { rondas } });
      btnIniciar.setAttribute('aria-disabled', 'false');
      if (!r.ok) {
        const msg = (r.data && r.data.error) || 'No se pudo empezar la medición.';
        error.textContent = r.status === 409 ? `Ahora no se puede: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}` : msg;
        error.hidden = false;
        TS.anunciar(error.textContent);
        return;
      }
      terminadoAntes = false;
      TS.anunciar('Comenzó la medición. Te aviso cuando termine.');
      sondear();
    });

    btnCancelar.addEventListener('click', async () => {
      btnCancelar.setAttribute('aria-disabled', 'true');
      await TS.api('/api/cronometro/cancelar', { method: 'POST' });
      btnCancelar.setAttribute('aria-disabled', 'false');
      C('estado').textContent = 'Cancelando…';
      sondear();
    });

    pintar(estado);
    if (estado && estado.activo) sondear();
  });
})();
