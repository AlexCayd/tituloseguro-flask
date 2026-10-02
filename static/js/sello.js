/* Título Seguro · sellos de lacre generados a partir de los bytes de una firma.
 *
 * Marcado:  <span class="sello sello--m" data-sello="{hex}" data-estado="ok|pendiente|roto"
 *                 [data-sello-letras="UAN"] role="img" aria-label="…"></span>
 * API:      TS.sello.hidratar(raiz)    dibuja los sellos dentro de raiz (también se hace solo al
 *                                      cargar y cuando aparecen nodos nuevos: MutationObserver)
 *           TS.sello.estampar(el, hex?) pasa a "ok" con animación de prensa
 *           TS.sello.agrietar(el)       pasa a "roto" con grietas que se dibujan
 *           TS.sello.dibujar(el)        redibuja según sus atributos
 * Determinista: el mismo hex produce siempre el mismo sello. Otro hex, otro sello.
 * Sin JS: el CSS muestra un disco de cera con monograma.
 */
(() => {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const d = document;
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;

  /* ------------------------------------------------------------------ azar determinista */
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function bytesDe(s, rnd) {
    const hex = /^[0-9a-f]{16,}$/i.test(s) ? s : '';
    const out = [];
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    while (out.length < 24) out.push(Math.floor(rnd() * 256));
    return out;
  }

  /* ------------------------------------------------------------------ geometría */
  const r1 = (x) => Math.round(x * 10) / 10;
  const polar = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];
  function curvaCerrada(p) {
    const n = p.length;
    let s = `M${r1(p[0][0])} ${r1(p[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = p[(i - 1 + n) % n];
      const a = p[i];
      const b = p[(i + 1) % n];
      const p3 = p[(i + 2) % n];
      s += `C${r1(a[0] + (b[0] - p0[0]) / 6)} ${r1(a[1] + (b[1] - p0[1]) / 6)} ${r1(b[0] - (p3[0] - a[0]) / 6)} ${r1(b[1] - (p3[1] - a[1]) / 6)} ${r1(b[0])} ${r1(b[1])}`;
    }
    return `${s}Z`;
  }
  function charco(rnd, base) {
    const N = 60;
    const ondas = [[2, 1.3], [3, 1.9], [5, 1.0], [7, 0.7], [11, 0.35]].map(([k, a]) => [k, a * (0.55 + rnd() * 0.9), rnd() * Math.PI * 2]);
    const gotas = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => [rnd() * Math.PI * 2, 3 + rnd() * 6.5, 0.14 + rnd() * 0.22]);
    const pts = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      let r = base;
      for (const [k, a, f] of ondas) r += a * Math.sin(k * t + f);
      for (const [c, a, w] of gotas) {
        const dt = Math.atan2(Math.sin(t - c), Math.cos(t - c));
        r += a * Math.exp(-(dt * dt) / (2 * w * w));
      }
      r += (rnd() - 0.5) * 0.8;
      pts.push(polar(r, t));
    }
    return curvaCerrada(pts);
  }
  function petalo(forma, ra, rb, w) {
    const m = ra + (rb - ra) * 0.38;
    if (forma === 0) { // gota
      return `M0 ${-ra}C${w} ${-m} ${w * 0.75} ${-(rb - 3)} 0 ${-rb}C${-w * 0.75} ${-(rb - 3)} ${-w} ${-m} 0 ${-ra}Z`;
    }
    if (forma === 1) { // lanza
      return `M0 ${-ra}Q${w * 1.05} ${-(ra + rb) / 2} 0 ${-rb}Q${-w * 1.05} ${-(ra + rb) / 2} 0 ${-ra}Z`;
    }
    // hoja con muesca
    return `M0 ${-ra}C${w * 1.1} ${-m} ${w * 0.5} ${-(rb - 1)} 0 ${-rb + 3}L0 ${-rb}L0 ${-rb + 3}C${-w * 0.5} ${-(rb - 1)} ${-w * 1.1} ${-m} 0 ${-ra}Z`;
  }
  function poligono(n, r, giro = 0, rIn = null) {
    const p = [];
    const pasos = rIn ? n * 2 : n;
    for (let i = 0; i < pasos; i++) {
      const rr = rIn && i % 2 ? rIn : r;
      p.push(polar(rr, giro + (i / pasos) * Math.PI * 2));
    }
    return `M${p.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;
  }
  const circulo = (r) => `M0 ${-r}A${r} ${r} 0 1 1 -0.01 ${-r}Z`;
  function glifo(tipo) {
    switch (tipo) {
      case 0: return poligono(6, 8.5, Math.PI / 6);
      case 1: return poligono(8, 9.5, 0, 4);
      case 2: return 'M0 -9.5L6.5 0L0 9.5L-6.5 0Z';
      case 3: return `${circulo(7.5)}${circulo(3)}`;
      case 4: return 'M-2.6 -9H2.6V-2.6H9V2.6H2.6V9H-2.6V2.6H-9V-2.6H-2.6Z';
      case 5: return poligono(3, 9.5, 0);
      case 6: return poligono(5, 9.5, 0, 4.2);
      default: return poligono(4, 8.5, Math.PI / 4, 3.6);
    }
  }

  /* ------------------------------------------------------------------ SVG */
  const E = (tag, attrs, ...hijos) => {
    const n = d.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
    for (const h of hijos) if (h) n.append(h);
    return n;
  };
  /* trazo grabado (hundido en la cera): pared de sombra arriba-izquierda, luz abajo-derecha */
  function hundido(dd, extra = {}) {
    return E('g', extra,
      E('path', { d: dd, class: 's-luz', transform: 'translate(0.8 0.9)' }),
      E('path', { d: dd, class: 's-hondo', transform: 'translate(-0.55 -0.65)' }),
      E('path', { d: dd, class: 's-relieve' }));
  }
  function anilloRepujado(r, ancho) {
    return E('g', null,
      E('circle', { r, class: 's-hondo-trazo', 'stroke-width': ancho, transform: 'translate(0.9 1.1)' }),
      E('circle', { r, class: 's-luz-trazo', 'stroke-width': ancho, transform: 'translate(-0.7 -0.8)' }),
      E('circle', { r, class: 's-relieve-trazo', 'stroke-width': ancho * 0.8 }));
  }

  function rasgos(semilla) {
    const rnd = mulberry32(fnv1a(semilla || 'TITULO SEGURO'));
    const b = bytesDe(semilla, rnd);
    return {
      rnd,
      b,
      petalos: 5 + (b[0] % 8),
      giro: (b[1] / 255) * Math.PI * 2,
      forma: b[2] % 3,
      doble: (b[3] & 1) === 1,
      puntos: (b[3] & 2) === 2,
      glifo: b[4] % 8,
      largos: b.slice(5, 17).map((x) => 31 + (x / 255) * 9),
      giroTexto: (b[17] / 255) * 360,
    };
  }

  function construir(semilla, estado, tam, letras) {
    const R = rasgos(semilla);
    const id = `ts-s${++uid}`;
    const detalle = tam >= 72;
    const minimo = tam < 38;
    const svg = E('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true', focusable: 'false' });
    const defs = E('defs');
    svg.append(defs);
    const anilloTexto = E('path', { id: `${id}-t`, d: 'M0 -52A52 52 0 1 1 -0.01 -52Z' });
    defs.append(anilloTexto);

    const textoHex = (semilla && /^[0-9a-f]{16,}$/i.test(semilla) ? semilla.toUpperCase() : 'TITULO SEGURO · TITULO SEGURO · ')
      .replace(/(.{4})/g, '$1 ').slice(0, 56).trim();
    const motivo = (clase) => {
      const g = E('g', { class: clase });
      const paso = (Math.PI * 2) / R.petalos;
      for (let i = 0; i < R.petalos; i++) {
        const ang = R.giro + i * paso;
        const largo = minimo ? 34 : R.largos[i % R.largos.length];
        const p = petalo(R.forma, 11, largo, 6.5 + (R.b[6 + (i % 8)] % 4) * 0.6);
        g.append(clase === 'molde'
          ? E('path', { d: p, class: 's-molde', transform: `rotate(${r1((ang * 180) / Math.PI)})` })
          : hundido(p, { transform: `rotate(${r1((ang * 180) / Math.PI)})` }));
        if (R.doble && !minimo) {
          const p2 = petalo((R.forma + 1) % 3, 13, 23, 3.4);
          const a2 = ((ang + paso / 2) * 180) / Math.PI;
          g.append(clase === 'molde'
            ? E('path', { d: p2, class: 's-molde', transform: `rotate(${r1(a2)})` })
            : hundido(p2, { transform: `rotate(${r1(a2)})` }));
        }
        if (R.puntos && detalle) {
          const [x, y] = polar(42.5, ang + paso / 2);
          const c = `M${r1(x)} ${r1(y - 1.6)}a1.6 1.6 0 1 1 -0.01 0Z`;
          g.append(clase === 'molde' ? E('path', { d: c, class: 's-molde' }) : hundido(c));
        }
      }
      // centro: glifo o letras
      if (letras && !minimo) {
        const t = (cls, dx, dy) => E('text', {
          class: `${cls} s-letras`, x: dx, y: dy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': letras.length > 2 ? 11 : 14, 'letter-spacing': 0.6,
        }, d.createTextNode(letras.slice(0, 3).toUpperCase()));
        if (clase === 'molde') g.append(t('s-molde-texto', 0, 0));
        else g.append(t('s-luz', 0.7, 0.8), t('s-hondo', -0.5, -0.6), t('s-relieve', 0, 0));
        g.append(E('circle', { r: 11.5, class: clase === 'molde' ? 's-molde' : 's-hondo-trazo', 'stroke-width': 0.8, fill: 'none' }));
      } else {
        const gl = glifo(R.glifo);
        g.append(clase === 'molde' ? E('path', { d: gl, class: 's-molde' }) : hundido(gl));
      }
      return g;
    };

    if (estado === 'pendiente') {
      // solo el molde: un sello sin estampar, como la marca en seco de la matriz
      svg.append(
        E('circle', { r: 86, class: 's-molde-tenue' }),
        E('circle', { r: 66, class: 's-molde' }),
        E('circle', { r: 46, class: 's-molde', 'stroke-dasharray': '1.5 2.5' }),
        motivo('molde'));
      if (detalle) {
        svg.append(E('text', { class: 's-molde-texto', 'font-size': 7.2, transform: `rotate(${r1(R.giroTexto)})` },
          E('textPath', { href: `#${id}-t`, textLength: 318, lengthAdjust: 'spacing' }, d.createTextNode(textoHex))));
      }
      return svg;
    }

    const roto = estado === 'roto';
    const contorno = charco(R.rnd, 84);
    // grietas y astilla (se calculan siempre para no alterar la secuencia del azar)
    const grietas = [];
    const nGrietas = 3 + (R.b[18] % 2);
    for (let k = 0; k < nGrietas; k++) {
      const a0 = R.giro + (k / nGrietas) * Math.PI * 2 + (R.rnd() - 0.5) * 0.9;
      let r = 90;
      let a = a0;
      const pts = [polar(r, a)];
      const fin = k === 0 ? 4 : 14 + R.rnd() * 26;
      while (r > fin) {
        r -= 7 + R.rnd() * 11;
        a += (R.rnd() - 0.5) * 0.55;
        pts.push(polar(Math.max(r, fin), a));
      }
      grietas.push(`M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`);
    }
    const ac = R.giro + Math.PI * (0.7 + R.rnd() * 0.6);
    const astilla = [polar(96, ac - 0.24), polar(96, ac + 0.22), polar(74, ac + 0.15), polar(69, ac + 0.02), polar(76, ac - 0.12)];
    const astillaD = `M${astilla.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;

    const cera = E('g', { class: 's-cera' });
    if (roto) {
      const m = E('mask', { id: `${id}-m`, maskUnits: 'userSpaceOnUse', x: -110, y: -110, width: 220, height: 220 },
        E('rect', { x: -110, y: -110, width: 220, height: 220, fill: 'white' }),
        E('path', { d: astillaD, fill: 'black' }));
      defs.append(m);
      cera.setAttribute('mask', `url(#${id}-m)`);
    }
    cera.append(
      E('path', { d: contorno, class: 's-grosor', transform: 'translate(0.6 2.4)' }),
      E('path', { d: contorno, class: 's-cuerpo' }),
      E('path', { d: contorno, class: 's-canto', transform: 'translate(-0.6 -0.8)' }),
      E('circle', { r: 70, class: 's-disco' }),
      anilloRepujado(67, 4.2),
      E('circle', { r: 46.5, class: 's-hondo-trazo', 'stroke-width': 0.9 }),
      motivo('cera'));
    if (detalle) {
      cera.append(
        E('text', { class: 's-texto-luz', 'font-size': 7.2, transform: `rotate(${r1(R.giroTexto)}) translate(0.5 0.6)` },
          E('textPath', { href: `#${id}-t`, textLength: 318, lengthAdjust: 'spacing' }, d.createTextNode(textoHex))),
        E('text', { class: 's-texto', 'font-size': 7.2, transform: `rotate(${r1(R.giroTexto)})` },
          E('textPath', { href: `#${id}-t`, textLength: 318, lengthAdjust: 'spacing' }, d.createTextNode(textoHex))));
    }
    cera.append(E('ellipse', { class: 's-brillo', cx: -28, cy: -40, rx: 40, ry: 22, transform: 'rotate(-32 -28 -40)' }));

    svg.append(
      E('path', { d: contorno, class: 's-sombra', transform: 'translate(2.5 4.5)' }),
      E('circle', { r: 86, class: 's-onda' }),
      cera);

    if (roto) {
      const g = E('g', { class: 's-grietas' });
      grietas.forEach((gd, i) => {
        g.append(
          E('path', { d: gd, class: 's-grieta-luz', transform: 'translate(0.9 0.9)', pathLength: 1, style: `--i:${i}` }),
          E('path', { d: gd, class: 's-grieta', pathLength: 1, style: `--i:${i}` }));
      });
      svg.append(g, E('path', { d: astillaD, class: 's-astilla' }));
    }
    return svg;
  }

  /* ------------------------------------------------------------------ gradientes compartidos */
  function definiciones() {
    if (d.getElementById('ts-sello-defs')) return;
    const stop = (offset, color, op) => E('stop', { offset, style: `stop-color:${color}${op != null ? `;stop-opacity:${op}` : ''}` });
    const svg = E('svg', { id: 'ts-sello-defs', 'aria-hidden': 'true', focusable: 'false', width: 0, height: 0, style: 'position:absolute;width:0;height:0;overflow:hidden' },
      E('defs', null,
        E('radialGradient', { id: 'ts-cera', cx: '36%', cy: '30%', r: '80%' },
          stop(0, 'var(--lacre-brillo)'), stop(0.48, 'var(--lacre)'), stop(1, 'var(--lacre-hondo)')),
        E('radialGradient', { id: 'ts-cera-disco', cx: '40%', cy: '36%', r: '72%' },
          stop(0, 'var(--lacre-brillo)', 0.85), stop(0.7, 'var(--lacre)'), stop(1, 'var(--lacre)')),
        E('radialGradient', { id: 'ts-brillo', cx: '50%', cy: '50%', r: '50%' },
          stop(0, 'white', 0.3), stop(1, 'white', 0))));
    d.body.prepend(svg);
  }

  /* ------------------------------------------------------------------ API */
  const firmaDe = (el) => `${el.dataset.sello || ''}|${el.dataset.estado || 'ok'}|${el.dataset.selloLetras || ''}`;
  function dibujar(el) {
    if (!el || !el.isConnected) return;
    definiciones();
    const tam = el.getBoundingClientRect().width || parseFloat(getComputedStyle(el).inlineSize) || 64;
    el.replaceChildren(construir((el.dataset.sello || '').trim(), el.dataset.estado || 'ok', tam, (el.dataset.selloLetras || '').trim()));
    el.setAttribute('data-hidratado', '');
    el.dataset.dibujado = firmaDe(el);
  }
  function hidratar(raiz = d) {
    if (!raiz || raiz.nodeType !== 1 && raiz !== d) return;
    const lista = [];
    if (raiz.matches && raiz.matches('.sello[data-sello]')) lista.push(raiz);
    if (raiz.querySelectorAll) lista.push(...raiz.querySelectorAll('.sello[data-sello]'));
    for (const el of lista) if (el.dataset.dibujado !== firmaDe(el)) dibujar(el);
  }
  function reanimar(el, clase, ms) {
    el.classList.remove(clase);
    void el.getBoundingClientRect();
    el.classList.add(clase);
    if (ms) window.setTimeout(() => el.classList.remove(clase), ms);
  }
  function estampar(el, hex) {
    if (!el) return;
    if (hex != null) el.dataset.sello = hex;
    el.dataset.estado = 'ok';
    dibujar(el);
    reanimar(el, 'sello--estampa', 1100);
  }
  function agrietar(el) {
    if (!el) return;
    el.dataset.estado = 'roto';
    dibujar(el);
    reanimar(el, 'sello--agrieta', 0);
  }

  TS.sello = { hidratar, dibujar, estampar, agrietar, construir };

  const arrancar = () => {
    hidratar(d);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') {
          const el = m.target;
          if (el.classList && el.classList.contains('sello') && el.dataset.dibujado !== firmaDe(el)) dibujar(el);
        } else {
          for (const n of m.addedNodes) if (n.nodeType === 1 && !(n instanceof SVGElement)) hidratar(n);
        }
      }
    });
    obs.observe(d.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sello', 'data-estado', 'data-sello-letras'] });
  };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', arrancar, { once: true });
  else arrancar();
})();
