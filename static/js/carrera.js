/* Título Seguro · carrera de minería en vivo + narrador.
 *
 *   Se engancha solo a cualquier contenedor [data-carrera] (macro carrera() de _carrera.html).
 *   Ganchos dentro del contenedor:
 *     [data-c="fase|bloque|titulo|folio-rotulo|folio|reloj|objetivo|ceros|prob|esperado|total|medidor|acumulada|
 *              ganador|ganador-sello|ganador-texto|ganador-detalle|narrador|anuncio|bitacora|
 *              iniciar|boton|ayuda|mensaje"]
 *     [data-c="nodo"][data-i="0..3"] con [data-n="intentos|hashrate|nonce|huella|ranuras|rastro|
 *              avance|avance-texto|resultado|saldo|sello|pie"]
 *   API: TS.carrera.montar(el) · TS.carrera.instancias
 *   Narrador: texto visible ~1 vez por segundo; solo los eventos importantes (inicio, ganador,
 *   obsoleta, error) van a la región aria-live del widget.
 */
(() => {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const d = document;

  const RESULTADO = { 'en espera': 'En espera', probando: 'Probando', 'ganó': '¡Ganó!', detenido: 'Se detuvo' };
  const FASE = {
    espera: ['pendiente', 'En espera'],
    carrera: ['carrera', 'En carrera'],
    terminada: ['valida', 'Sellado'],
    error: ['invalida', 'Detenida'],
  };
  const faseDe = (e) => (e.minando ? 'carrera' : e.ganador ? 'terminada' : e.error ? 'error' : 'espera');
  const caras = (n) => 16 ** n;
  const plural = (n, uno, varios) => (n === 1 ? uno : varios);

  function montar(raiz) {
    if (!raiz || raiz.dataset.carreraLista) return null;
    raiz.dataset.carreraLista = '1';
    const c = (k) => raiz.querySelector(`[data-c="${k}"]`);
    const nodos = TS.$$('[data-c="nodo"]', raiz).sort((a, b) => +a.dataset.i - +b.dataset.i);
    const n = (el, k) => el.querySelector(`[data-n="${k}"]`);
    const anuncio = c('anuncio');
    const form = c('iniciar');
    const boton = c('boton');

    let fase = raiz.dataset.fase || 'espera';
    let e = null;
    let previo = null;
    const rastros = nodos.map(() => []);
    const vistos = new Set();
    let primera = true;
    let relojBase = 0;
    let relojT0 = 0;
    let relojTimer = 0;
    let narrTimer = 0;
    let narrPaso = 0;
    let ocupado = false;

    const decir = (texto) => {
      if (!anuncio || !texto) return;
      anuncio.textContent = '';
      window.setTimeout(() => { anuncio.textContent = texto; }, 60);
    };
    const mensaje = (texto, tipo) => {
      const m = c('mensaje');
      if (!m) return;
      m.textContent = texto || '';
      if (tipo) m.dataset.tipo = tipo; else delete m.dataset.tipo;
    };
    const poner = (k, texto) => {
      const el = c(k);
      if (el && el.textContent !== texto) el.textContent = texto;
    };

    /* ---------------------------------------------------------------- ranuras (la cerradura) */
    function ranuras(cont, hex, nCeros, objetivo) {
      if (!cont) return;
      if (cont.children.length !== nCeros) cont.replaceChildren(...Array.from({ length: nCeros }, () => TS.el('span')));
      const chars = String(hex || '');
      const iniciales = TS.fmt.ceros(chars); // solo cuentan los ceros del INICIO
      Array.from(cont.children).forEach((s, k) => {
        const ch = objetivo ? '0' : (chars[k] || '·');
        if (s.textContent !== ch) s.textContent = ch;
        const hay = !objetivo && !!chars[k];
        s.classList.toggle('es-cero', hay && k < iniciales);
        s.classList.toggle('no-cero', hay && k >= iniciales);
      });
    }

    /* ---------------------------------------------------------------- reloj */
    function reloj() {
      const t = fase === 'carrera' ? relojBase + (performance.now() - relojT0) / 1000 : relojBase;
      poner('reloj', TS.fmt.reloj(t));
    }
    function relojEnMarcha(si) {
      window.clearInterval(relojTimer);
      relojTimer = 0;
      if (si) relojTimer = window.setInterval(reloj, 100);
    }

    /* ---------------------------------------------------------------- narrador */
    function textoNodo(nd, N) {
      const h = nd.ultimo || '';
      const cz = TS.fmt.ceros(h);
      const inicio = h.slice(0, 4);
      let fin;
      if (!h) fin = 'todavía no escribe su primera huella.';
      else if (cz >= N) fin = `¡son ${N} ceros!`;
      else if (cz === 0) fin = `no empieza con cero: no sirve, sigue.`;
      else fin = `tiene ${cz} ${plural(cz, 'cero', 'ceros')}, le ${plural(N - cz, 'falta', 'faltan')} ${N - cz}. Sigue.`;
      return [`${nd.nombre} lleva ${TS.fmt.miles(nd.intentos)} intentos. Su última huella empieza con `, mono(`${inicio}…`), `: ${fin}`];
    }
    const mono = (t) => TS.el('span', { class: 'mono' }, t);
    function narrar() {
      const el = c('narrador');
      if (!el || !e) return;
      const N = e.dificultad;
      let partes;
      if (fase === 'carrera') {
        const ns = e.nodos;
        const total = ns.reduce((s, x) => s + (x.intentos || 0), 0);
        const lider = [...ns].sort((a, b) => b.intentos - a.intentos)[0];
        const p = acumulada(total, N);
        const turno = narrPaso % 8;
        const nd = ns[Math.floor(narrPaso / 2) % ns.length];
        if (turno % 2 === 0) partes = textoNodo(nd, N);
        else if (turno === 1) partes = [`Cada intento es como lanzar un dado de ${TS.fmt.miles(caras(N))} caras: solo la cara «${'0'.repeat(N)}» gana.`];
        else if (turno === 3) partes = [`Entre los cuatro van ${TS.fmt.miles(total)} intentos. Con tantos, la probabilidad de que ya hubiera salido es de ${Math.round(p * 100)} %.`];
        else if (turno === 5) partes = [`${lider.nombre} lleva más intentos, pero eso no le asegura nada: cada intento tiene la misma probabilidad de ganar.`];
        else partes = [`${nd.nombre} prueba los números ${nd.i}, ${nd.i + 4}, ${nd.i + 8}…: ningún escribano repite un número de otro.`];
        narrPaso++;
      } else if (fase === 'terminada') {
        const g = e.nodos.find((x) => x.ganador) || {};
        partes = [`¡${e.ganador} lo logró! Su nonce `, mono(TS.fmt.miles(g.nonce)), ` produjo una huella con ${N} ceros. Estampa su sello y cobra ${e.recompensa} TS.`];
        const tarde = (e.bitacora || []).filter((b) => b.tipo === 'obsoleta');
        if (tarde.length) partes.push(` ${tarde.map((b) => b.texto.split(' ')[0]).join(' y ')} también ${plural(tarde.length, 'encontró', 'encontraron')} uno, pero llegó tarde: solución obsoleta.`);
      } else if (fase === 'error') {
        partes = [`La carrera se detuvo: ${e.error}. La credencial vuelve a la cola.`];
      } else if (!e.cola) {
        partes = ['No hay credenciales en la cola: por ahora no hay nada que sellar.'];
      } else {
        partes = [`Los cuatro escribanos esperan. Cuando alguien inicie la carrera, todos intentarán a la vez sellar la siguiente credencial: una huella que empiece con ${N} ceros.`];
      }
      const nuevo = TS.el('span', null, ...partes);
      if (el.textContent === nuevo.textContent) return;
      if (TS.reducido()) { el.replaceChildren(...nuevo.childNodes); return; }
      el.setAttribute('data-cambiando', '');
      window.setTimeout(() => { el.replaceChildren(...nuevo.childNodes); el.removeAttribute('data-cambiando'); }, 150);
    }
    function narradorEnMarcha(si) {
      window.clearInterval(narrTimer);
      narrTimer = 0;
      if (si) narrTimer = window.setInterval(narrar, 1100);
    }

    const acumulada = (total, N) => 1 - Math.exp(total * Math.log1p(-1 / caras(N)));

    /* ---------------------------------------------------------------- bitácora */
    const claveB = (b) => `${b.t}|${b.tipo}|${b.texto}`;
    function bitacora(lista) {
      const ol = c('bitacora');
      const nuevos = [];
      for (const b of lista) {
        const k = claveB(b);
        if (!vistos.has(k)) { vistos.add(k); nuevos.push(b); }
      }
      if (ol && (nuevos.length || !ol.dataset.pintada)) {
        ol.dataset.pintada = '1';
        const ult = lista.slice(-8).reverse();
        ol.replaceChildren(...(ult.length ? ult.map((b) => TS.el('li', { 'data-tipo': b.tipo },
          TS.el('span', { class: 'bitacora__marca', 'aria-hidden': 'true' }),
          TS.el('time', { datetime: b.t }, TS.fmt.hora(b.t)),
          TS.el('span', null, b.texto))) : [TS.el('li', { class: 'bitacora__vacia' }, 'Todavía no hay movimientos en esta sesión del servidor.')]));
      }
      return primera ? [] : nuevos;
    }

    /* ---------------------------------------------------------------- celebración */
    function celebrar(g, N) {
      const idx = e.nodos.findIndex((x) => x.ganador);
      const nodo = nodos[idx];
      const hash = (e.ultimo_bloque && e.ultimo_bloque.numero === e.numero ? e.ultimo_bloque.hash : g.ultimo) || g.ultimo;
      if (nodo) {
        const s = n(nodo, 'sello');
        if (s && TS.sello) TS.sello.estampar(s, hash);
        const pie = n(nodo, 'pie');
        if (pie) {
          const mon = TS.el('span', { class: 'moneda', 'aria-hidden': 'true' }, `+${e.recompensa} TS`);
          pie.append(mon);
          window.setTimeout(() => mon.remove(), 1800);
        }
      }
      const gs = c('ganador-sello');
      if (gs && TS.sello) window.setTimeout(() => TS.sello.estampar(gs, hash), 120);
    }

    /* ---------------------------------------------------------------- actualización */
    function actualizar(nuevo) {
      previo = e;
      e = nuevo;
      const N = e.dificultad;
      const f = faseDe(e);
      const cambio = f !== fase;
      const otraCarrera = previo && e.minando && previo.numero !== e.numero;
      if (otraCarrera || (cambio && f === 'carrera')) rastros.forEach((r) => { r.length = 0; });
      fase = f;
      raiz.dataset.fase = f;

      // cabecera
      const [estadoGoma, textoGoma] = FASE[f];
      const goma = c('fase');
      if (goma && (goma.dataset.estado !== estadoGoma || goma.textContent !== textoGoma)) {
        goma.dataset.estado = estadoGoma;
        goma.textContent = textoGoma;
        if (!primera) {
          goma.classList.remove('sello-goma--estampa');
          void goma.offsetWidth;
          goma.classList.add('sello-goma--estampa');
        }
      }
      poner('titulo', f === 'terminada' ? `Bloque #${e.numero} sellado` : f === 'carrera' ? `Carrera por el bloque #${e.numero}` : `Próximo bloque: #${e.numero}`);
      // en carrera: el folio en juego; en reposo: el que sigue en la fila (no el de la carrera anterior)
      const folioVer = f === 'carrera' ? (e.folio || '') : (e.proximo_folio || '');
      poner('folio-rotulo', f === 'carrera' ? 'Credencial en juego:' : folioVer ? 'Siguiente en la cola:' : 'La fila está vacía.');
      poner('folio', folioVer);

      // objetivo y probabilidades
      ranuras(c('objetivo'), '', N, true);
      poner('ceros', `${N} ${plural(N, 'cero', 'ceros')}`);
      poner('prob', `1 entre ${TS.fmt.miles(caras(N))}`);
      const velocidad = e.nodos.reduce((s, x) => s + (x.hashrate || 0), 0);
      if (f === 'carrera' && velocidad > 0) TS.guardar('ts.velocidad', String(velocidad));
      else if (e.hashrate_ultima > 0) TS.guardar('ts.velocidad', String(e.hashrate_ultima));
      // en reposo, la velocidad real de la última carrera del servidor sirve para estimar la siguiente
      const vel = velocidad || e.hashrate_ultima || +TS.leer('ts.velocidad', 0);
      poner('esperado', vel ? `≈ ${TS.fmt.segundos(caras(N) / vel)}` : 'depende del servidor');
      const total = e.nodos.reduce((s, x) => s + (x.intentos || 0), 0);
      poner('total', TS.fmt.miles(total));
      const p = f === 'espera' ? 0 : acumulada(total, N);
      const med = c('medidor');
      if (med) med.style.setProperty('--p', String(Math.round(p * 1000) / 10));
      poner('acumulada', `${Math.round(p * 100)} %`);

      // reloj
      relojBase = e.transcurrido || 0;
      relojT0 = performance.now();
      relojEnMarcha(f === 'carrera');
      reloj();

      // pupitres
      const esperado = caras(N) / 4;
      e.nodos.forEach((nd, k) => {
        const el = nodos[k];
        if (!el) return;
        el.dataset.resultado = nd.resultado;
        const ant = previo && previo.nodos[k];
        if (ant && ant.ultimo && ant.ultimo !== nd.ultimo && f === 'carrera') {
          rastros[k].unshift(ant.ultimo);
          rastros[k].length = Math.min(rastros[k].length, 3);
        }
        const tx = (key, v) => { const x = n(el, key); if (x && x.textContent !== v) x.textContent = v; };
        tx('intentos', TS.fmt.miles(nd.intentos));
        tx('hashrate', nd.hashrate ? TS.fmt.miles(nd.hashrate) : '—');
        tx('nonce', nd.nonce == null ? '—' : TS.fmt.miles(nd.nonce));
        tx('resultado', RESULTADO[nd.resultado] || nd.resultado);
        tx('saldo', TS.fmt.miles(nd.saldo));
        const hz = n(el, 'huella');
        if (hz && hz.dataset.valor !== (nd.ultimo || '')) {
          hz.dataset.valor = nd.ultimo || '';
          hz.replaceChildren(nd.ultimo ? TS.huella(nd.ultimo, { dificultad: N, n: 22 }) : TS.el('span', { class: 'huella' }, '—'));
        }
        ranuras(n(el, 'ranuras'), nd.ultimo, N, false);
        const ra = n(el, 'rastro');
        if (ra) {
          const vals = f === 'carrera' || f === 'terminada' ? rastros[k] : [];
          const firma = vals.join(',');
          if (ra.dataset.valor !== firma || !ra.firstChild) {
            ra.dataset.valor = firma;
            ra.replaceChildren(...(vals.length
              ? vals.map((h) => TS.el('li', null, `${h.slice(0, 16)}…`))
              : [TS.el('li', { class: 'pupitre__rastro-vacio' }, f === 'carrera' ? 'Escribiendo su primera huella…' : 'Aquí tacha sus intentos fallidos.')]));
          }
        }
        const pc = Math.min(100, (nd.intentos / esperado) * 100);
        const av = n(el, 'avance');
        if (av) av.style.setProperty('--p', String(Math.round(pc * 10) / 10));
        const real = Math.round((nd.intentos / esperado) * 100);
        tx('avance-texto', nd.intentos ? `${real} % de su parte del trabajo promedio` : 'Sin intentos todavía');
        const s = n(el, 'sello');
        if (s && f === 'carrera' && s.dataset.estado !== 'pendiente') { s.dataset.estado = 'pendiente'; s.dataset.sello = nd.nombre; }
        if (s && f !== 'terminada' && f !== 'carrera' && s.dataset.estado === 'ok' && !nd.ganador) { s.dataset.estado = 'pendiente'; s.dataset.sello = nd.nombre; }
      });

      // ganador
      const gan = c('ganador');
      const g = e.nodos.find((x) => x.ganador);
      if (gan) gan.hidden = f !== 'terminada';
      if (f === 'terminada' && g) {
        poner('ganador-texto', '');
        const gt = c('ganador-texto');
        if (gt) gt.replaceChildren('¡', TS.el('strong', null, e.ganador), ` sella el bloque #${e.numero}!`);
        const gd = c('ganador-detalle');
        if (gd) gd.replaceChildren('Su nonce ', mono(TS.fmt.miles(g.nonce)), ' produjo la huella ', TS.huella(g.ultimo, { dificultad: N, n: 14 }), `. Cobra ${e.recompensa} TS.`);
        const gs = c('ganador-sello');
        const hash = (e.ultimo_bloque && e.ultimo_bloque.numero === e.numero) ? e.ultimo_bloque.hash : g.ultimo;
        if (gs && (primera || !cambio) && gs.dataset.sello !== hash) { gs.dataset.sello = hash; gs.dataset.estado = 'ok'; }
        nodos.forEach((el, k) => {
          const s = n(el, 'sello');
          if (s && e.nodos[k].ganador && (primera || !cambio) && s.dataset.estado !== 'ok') { s.dataset.sello = hash; s.dataset.estado = 'ok'; }
        });
        if (cambio && !primera) celebrar(g, N);
      }

      // botón y ayuda
      if (boton) {
        let motivo = '';
        if (e.minando) motivo = 'Hay una carrera en curso: mira cómo compiten.';
        else if (e.cronometro_activo) motivo = 'El cronómetro está midiendo tiempos; espera a que termine.';
        else if (!e.cola) motivo = 'No hay credenciales pendientes por sellar.';
        const bloqueado = !!motivo || ocupado;
        boton.setAttribute('aria-disabled', bloqueado ? 'true' : 'false');
        poner('ayuda', motivo || `Hay ${TS.fmt.miles(e.cola)} ${plural(e.cola, 'credencial', 'credenciales')} en la cola. La carrera sella la primera.`);
      }

      // bitácora y anuncios
      const nuevos = bitacora(e.bitacora || []);
      for (const b of nuevos) {
        if (b.tipo === 'inicio') decir(`Comenzó la carrera por el bloque #${e.numero}. La huella debe empezar con ${N} ceros.`);
        else if (b.tipo === 'ganador') decir(b.texto);
        else if (b.tipo === 'obsoleta' || b.tipo === 'error') decir(b.texto);
      }

      narradorEnMarcha(f === 'carrera');
      if (cambio || primera || f !== 'carrera') narrar();
      primera = false;
    }

    /* ---------------------------------------------------------------- iniciar carrera */
    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (ocupado || (boton && boton.getAttribute('aria-disabled') === 'true')) {
          const ay = c('ayuda');
          if (ay && ay.textContent) mensaje(ay.textContent);
          return;
        }
        ocupado = true;
        if (boton) boton.setAttribute('aria-disabled', 'true');
        mensaje('Repartiendo la credencial a los cuatro escribanos…');
        const r = await TS.api(form.getAttribute('action') || '/minar', { method: 'POST' });
        ocupado = false;
        if (r.ok) {
          const rech = r.data && r.data.rechazadas;
          mensaje(rech ? `Antes de empezar se descartaron ${rech} ${plural(rech, 'credencial', 'credenciales')} con firma inválida.` : '');
          TS.estado.ahora();
          return;
        }
        if (boton) boton.setAttribute('aria-disabled', 'false');
        const err = (r.data && r.data.error) || '';
        let t;
        if (r.status === 401) t = 'Necesitas entrar como minero para iniciar una carrera.';
        else if (r.status === 403) t = 'Tu cuenta no puede iniciar carreras: solo los mineros y la administración pueden hacerlo.';
        else if (r.status === 409) t = `Ahora no se puede: ${err.charAt(0).toLowerCase()}${err.slice(1)}`;
        else if (r.status === 400) t = 'Tu sesión expiró. Recarga la página e inténtalo de nuevo.';
        else t = err || 'Algo falló al iniciar la carrera. Inténtalo de nuevo.';
        mensaje(t, 'error');
        decir(t);
        TS.estado.ahora();
      });
    }

    const inst = { raiz, actualizar, get estado() { return e; } };
    TS.estado.suscribir(actualizar);
    TS.alCambiarMovimiento(() => narrar());
    return inst;
  }

  TS.carrera = { montar, instancias: [] };
  TS.listo(() => {
    TS.$$('[data-carrera]').forEach((el) => {
      const i = montar(el);
      if (i) TS.carrera.instancias.push(i);
    });
  });
})();
