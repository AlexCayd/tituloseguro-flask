/* Título Seguro · laboratorio de alteraciones.
 *
 *   POST /api/laboratorio {bloque, tipo} → el servidor altera una COPIA y la valida completa.
 *   Aquí se dibuja: el antes/después del dato, la copia (hojas vecinas con sellos agrietados y el
 *   cordón roto), cada falla en lenguaje llano y, para «el tramposo listo», el efecto dominó.
 *
 *   La huella recalculada se obtiene en el navegador con un serializador idéntico al de Python
 *   (json.dumps con sort_keys y ensure_ascii) + SHA-256 de WebCrypto. Antes de usarla se comprueba
 *   con una hoja intacta: si no da la huella guardada, no se muestra (nunca inventamos un dato).
 */
(() => {
  'use strict';
  const TS = window.TS;
  if (!TS) return;

  const TIPO = { 'título': 'Título', diploma: 'Diploma', certificado: 'Certificado', constancia: 'Constancia' };
  const miles = (n) => TS.fmt.miles(n);
  const pl = (n, uno, varios) => (n === 1 ? uno : varios);

  /* ------------------------------------------------------------------ huella como en Python */
  function pystr(s) {
    let o = '"';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === '"') o += '\\"';
      else if (ch === '\\') o += '\\\\';
      else if (ch === '\n') o += '\\n';
      else if (ch === '\r') o += '\\r';
      else if (ch === '\t') o += '\\t';
      else if (ch === '\b') o += '\\b';
      else if (ch === '\f') o += '\\f';
      else if (c < 0x20 || c > 0x7e) {
        if (c > 0xffff) {
          const v = c - 0x10000;
          o += `\\u${(0xd800 + (v >> 10)).toString(16)}\\u${(0xdc00 + (v & 0x3ff)).toString(16)}`;
        } else o += `\\u${c.toString(16).padStart(4, '0')}`;
      } else o += ch;
    }
    return `${o}"`;
  }
  function pyjson(v) {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    if (typeof v === 'string') return pystr(v);
    if (Array.isArray(v)) return `[${v.map(pyjson).join(', ')}]`;
    return `{${Object.keys(v).sort().map((k) => `${pystr(k)}: ${pyjson(v[k])}`).join(', ')}}`;
  }
  const puedeHash = !!(window.crypto && window.crypto.subtle && window.TextEncoder);
  async function sha256(texto) {
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function huellaDe(b) {
    const copia = { ...b };
    delete copia.hash;
    return sha256(pyjson(copia));
  }

  /* ------------------------------------------------------------------ fallas en lenguaje llano */
  const CORTO = { hash: 'huella', enlace: 'cordón', dificultad: 'trabajo', firma: 'firma', recompensa: 'recompensa', particion: 'reparto', credencial: 'ficha', numero: 'número', genesis: 'génesis' };
  function explicar(codigo, n, b, tipo) {
    const uni = (b && b.transaccion && b.transaccion.contenido && b.transaccion.contenido.universidad) || 'la universidad';
    const d = (b && b.dificultad) || 0;
    switch (codigo) {
      case 'hash':
        return ['La huella ya no coincide', tipo === 'hash'
          ? `Escribiste otra huella en la hoja #${n}, pero la huella no se escribe: se calcula. Recalculada con lo que dice la hoja, sale la de siempre, no la tuya.`
          : `Recalculamos la huella de la hoja #${n} con lo que dice ahora y sale distinta a la guardada. Es como una huella digital que ya no corresponde a la persona.`];
      case 'enlace':
        return ['El cordón se rompió', `La hoja #${n} guarda la huella de la hoja #${n - 1}, pero esa huella ya no es la que tiene la hoja #${n - 1}: apunta a una hoja que cambió.`];
      case 'dificultad':
        return ['Le falta el trabajo de minado', `La huella nueva de la hoja #${n} no empieza con ${d} ceros. Para tenerlos habría que volver a minarla: en promedio, ${miles(16 ** d)} intentos.`];
      case 'firma':
        return ['El sello no corresponde', tipo === 'firma'
          ? `La firma que quedó en la hoja #${n} no es la que produce la llave de ${uni} para este contenido. Inventar una firma válida sin su llave privada es imposible en la práctica.`
          : `La firma de ${uni} se hizo sobre el contenido original. Con lo que dice ahora, la comprobación falla, y nadie más tiene su llave privada para volver a firmar.`];
      case 'credencial':
        return ['La ficha no cuadra por dentro', `La huella del documento guardada en la hoja #${n} ya no corresponde a sus datos (alumno, programa, tipo y fecha).`];
      case 'recompensa':
        return ['La recompensa o el escribano no son válidos', `La hoja #${n} paga una recompensa distinta a ${50} TS o nombra a un escribano que no existe.`];
      case 'particion':
        return ['Ese número de intento no era de ese escribano', `El nonce de la hoja #${n} no está en la serie de quien dice haberla sellado.`];
      case 'numero':
        return ['La hoja está fuera de lugar', `El número de la hoja no corresponde a su posición en la cadena.`];
      case 'genesis':
        return ['La primera hoja no es la original', 'El bloque génesis cambió: toda la cadena cuelga de él.'];
      default:
        return [codigo, ''];
    }
  }

  TS.listo(() => {
    const form = TS.$('#lab');
    if (!form) return;
    const L_ = (k, raiz = document) => raiz.querySelector(`[data-l="${k}"]`);
    const sel = TS.$('#lab-bloque', form);
    const boton = L_('boton', form);
    const error = L_('error', form);
    const res = L_('resultado');
    if (!sel || !boton || !res) return;
    const etiquetaBoton = boton.lastChild ? boton.lastChild.textContent : ' Intentar la trampa';
    const cache = new Map();
    let serializadorOk = null;
    let velocidad = 0;

    TS.api('/estado').then((r) => {
      if (!r.ok || !r.data) return;
      velocidad = r.data.hashrate_ultima || (r.data.nodos || []).reduce((s, n) => s + (n.hashrate || 0), 0) || +TS.leer('ts.velocidad', 0) || 0;
    });

    async function bloque(n) {
      if (cache.has(n)) return cache.get(n);
      const r = await TS.api(`/api/bloque/${n}`);
      if (!r.ok || !r.data) throw new Error((r.data && r.data.error) || 'No se pudo leer la hoja.');
      cache.set(n, r.data);
      return r.data;
    }
    async function serializadorFiable(b) {
      if (serializadorOk !== null) return serializadorOk;
      if (!puedeHash) { serializadorOk = false; return false; }
      try { serializadorOk = (await huellaDe(b)) === b.hash; } catch { serializadorOk = false; }
      return serializadorOk;
    }

    /* -------------------------------------------------------------- vista previa de la hoja */
    async function vista() {
      const n = +sel.value;
      let b;
      try { b = await bloque(n); } catch { return; }
      if (+sel.value !== n) return;
      const c = b.transaccion.contenido;
      const rev = b.transaccion.proposito === 'revocacion';
      const s = L_('vista-sello');
      if (s) {
        s.dataset.sello = b.firma;
        s.dataset.selloLetras = rev ? '' : c.universidad;
        s.setAttribute('aria-label', `Sello de la firma de la hoja ${n}`);
      }
      L_('vista-num').textContent = String(n);
      L_('vista-minero').textContent = b.minero;
      L_('vista-asunto').replaceChildren(...(rev
        ? ['Revocación de ', TS.el('span', { class: 'mono' }, c.folio_revocado)]
        : [`${TIPO[c.tipo] || c.tipo} en `, TS.el('em', null, c.programa)]));
      const h = L_('vista-huella');
      if (h) {
        const nueva = TS.huella(b.hash, { dificultad: b.dificultad, n: 20 });
        nueva.dataset.l = 'vista-huella';
        h.replaceWith(nueva);
      }
      const destino = c.programa === 'Medicina' ? 'Medicina*' : 'Medicina';
      L_('texto-contenido').replaceChildren(...(rev
        ? ['Cambio la fecha de la revocación. No toco nada más.']
        : ['Cambio el programa: de ', TS.el('em', null, c.programa), ' a ', TS.el('em', null, destino), '. No toco nada más.']));
      L_('texto-recalculado').replaceChildren(...(rev
        ? ['Cambio la fecha y recalculo la huella para que cuadre. ¿Bastará?']
        : ['Cambio el programa a ', TS.el('em', null, destino), ' y además recalculo la huella para que cuadre. ¿Bastará?']));
    }
    sel.addEventListener('change', vista);
    vista();

    /* -------------------------------------------------------------- piezas */
    function difHex(texto, otro) {
      const code = TS.el('code', { class: 'huella lab-dif' });
      let i = 0;
      while (i < texto.length && texto[i] === otro[i]) i++;
      code.append(texto.slice(0, i));
      if (i < texto.length) code.append(TS.el('mark', null, texto[i]), texto.slice(i + 1));
      return code;
    }
    const fila = (rotulo, ...valor) => TS.el('div', { class: 'lab-cambio__fila' }, TS.el('span', { class: 'rotulo' }, rotulo), TS.el('span', null, ...valor));
    const selloMini = (hex, etiqueta, letras) => TS.el('figure', { class: 'lab-cambio__sello' },
      TS.el('span', { class: 'sello sello--m', 'data-sello': hex, 'data-estado': 'ok', 'data-sello-letras': letras || null, role: 'img', 'aria-label': etiqueta },
        TS.el('span', { class: 'sello__respaldo', 'aria-hidden': 'true' }, letras || 'TS')),
      TS.el('figcaption', null, etiqueta));
    const salto = (texto) => TS.el('li', { class: 'legajo__salto' }, texto);

    function folio(b, est, alterado) {
      const fallas = (est && est.fallas) || [];
      const li = TS.folio.crear(b, { valido: true });
      li.classList.add('lab-folio');
      if (alterado) li.classList.add('lab-folio--alterado');
      if (fallas.length) {
        li.dataset.fallas = fallas.join(' ');
        if (fallas.includes('hash') || fallas.includes('dificultad')) li.querySelector('.folio__fila--huella').classList.add('lab-falla');
        if (fallas.includes('enlace')) li.querySelector('.folio__fila--anterior').classList.add('lab-falla');
        if (fallas.includes('credencial')) li.querySelector('.folio__cuerpo').classList.add('lab-falla');
        li.append(TS.el('p', { class: 'folio__extra lab-folio__fallas' },
          TS.el('span', { class: 'rotulo' }, fallas.length === 1 ? 'Falla:' : 'Fallas:'),
          ...fallas.map((f) => TS.el('span', { class: 'etiqueta etiqueta--lacre' }, CORTO[f] || f))));
      }
      return li;
    }

    function animarFolios(ol, k) {
      TS.$$('.lab-folio[data-fallas]', ol).forEach((li, i) => {
        const fallas = li.dataset.fallas.split(' ');
        const n = +li.dataset.numero;
        const esperar = TS.reducido() ? 0 : 380 + i * 260;
        window.setTimeout(() => {
          li.classList.add('folio--roto');
          const goma = li.querySelector('.folio__cabeza .sello-goma');
          if (goma) {
            goma.dataset.estado = 'invalida';
            goma.textContent = n === k ? 'Alterado' : fallas.includes('enlace') ? 'Cordón roto' : 'Con fallas';
            goma.classList.add('sello-goma--estampa');
          }
          if (fallas.includes('firma')) {
            const s = li.querySelector('.folio__sello .sello');
            if (s && TS.sello) {
              TS.sello.agrietar(s);
              s.setAttribute('aria-label', `Sello de la firma de la hoja ${n}: agrietado, la firma no corresponde`);
            }
          }
          if (fallas.includes('enlace')) {
            const cord = li.querySelector('.folio__cordon');
            if (cord) cord.classList.add('cordon--roto', 'lab-cordon-roto');
            const nudo = li.querySelector('.folio__nudo');
            if (nudo) { nudo.textContent = 'ya no coincide'; nudo.classList.add('lab-nudo-roto'); }
          }
        }, esperar);
      });
    }

    function pintarCambio(d, orig, recalculada) {
      const cont = L_('cambio');
      const alt = d.alteracion;
      const NOMBRES = { programa: 'El programa', tipo: 'El tipo', fecha_emision: 'La fecha de emisión', fecha: 'La fecha', motivo: 'El motivo', folio_revocado: 'El folio revocado', hash: 'La huella guardada', firma: 'La firma' };
      const partes = [TS.el('p', { class: 'lab-cambio__campo' }, NOMBRES[alt.campo] || alt.campo)];
      if (alt.campo === 'hash' || alt.campo === 'firma') {
        partes.push(
          fila('Antes', difHex(String(alt.antes), String(alt.despues))),
          fila('Después', difHex(String(alt.despues), String(alt.antes))),
          TS.el('p', { class: 'nota' }, `Solo cambió 1 de ${String(alt.antes).length} caracteres (el resaltado).`));
        if (alt.campo === 'firma') {
          const letras = orig.transaccion.proposito === 'revocacion' ? '' : orig.transaccion.contenido.universidad;
          partes.push(TS.el('div', { class: 'lab-cambio__sellos' },
            selloMini(alt.antes, 'Sello original', letras),
            TS.el('span', { class: 'lab-cambio__flecha', 'aria-hidden': 'true' }, TS.icono('flecha')),
            selloMini(alt.despues, 'Sello con la firma alterada', letras)),
          TS.el('p', { class: 'nota' }, 'El sello ya es otro (fíjate en el contorno de la cera): se dibuja con los bytes de la firma. Pero lo que delata la trampa no es el dibujo, sino la comprobación matemática de la firma.'));
        }
        if (alt.campo === 'hash' && recalculada) {
          partes.push(TS.el('p', { class: 'nota' }, 'Pero si la recalculas con lo que dice la hoja, sale la de siempre: ', TS.huella(recalculada, { dificultad: orig.dificultad, n: 16 }), '. No coincide con la que escribiste.'));
        }
      } else {
        partes.push(
          TS.el('p', { class: 'lab-cambio__antes' }, TS.el('span', { class: 'rotulo' }, 'Decía'), TS.el('del', null, String(alt.antes))),
          TS.el('p', { class: 'lab-cambio__despues' }, TS.el('span', { class: 'rotulo' }, 'Ahora dice'), TS.el('ins', null, String(alt.despues))));
        if (recalculada) {
          const listo = d.tipo === 'contenido_recalculado';
          partes.push(
            TS.el('p', { class: 'lab-cambio__campo lab-cambio__campo--sep' }, 'Y la huella…'),
            fila(listo ? 'Original' : 'Guardada', TS.huella(orig.hash, { dificultad: orig.dificultad })),
            fila(listo ? 'Recalculada' : 'Recalculada ahora', TS.huella(recalculada, { dificultad: orig.dificultad })),
            TS.el('p', { class: 'nota' }, listo
              ? `La recalculaste para que cuadre, pero ya no empieza con ${orig.dificultad} ceros: esa es la marca de que falta el trabajo de minado.`
              : 'Una sola palabra distinta y la huella cambia por completo, aunque la guardada siga igual.'));
        }
      }
      cont.replaceChildren(...partes);
    }

    function pintarFallas(d, porNum) {
      const ol = L_('fallas');
      const grupos = new Map();
      for (const p of d.problemas) {
        if (!grupos.has(p.bloque)) grupos.set(p.bloque, []);
        grupos.get(p.bloque).push(p);
      }
      const items = [...grupos.keys()].sort((a, b) => a - b).map((n) => TS.el('li', { class: 'lab-falla-hoja' },
        TS.el('p', { class: 'lab-falla-hoja__num' }, `Hoja #${n}`, n === d.bloque ? TS.el('span', { class: 'nota' }, ' · la que alteraste') : n === d.bloque + 1 ? TS.el('span', { class: 'nota' }, ' · la siguiente') : null),
        TS.el('ul', { class: 'lab-falla-hoja__lista', role: 'list' }, ...grupos.get(n).map((p) => {
          const [titulo, texto] = explicar(p.codigo, n, porNum.get(n) || porNum.get(d.bloque), d.tipo);
          return TS.el('li', { class: 'lab-falla-item' },
            TS.el('strong', null, titulo),
            TS.el('span', null, texto),
            TS.el('small', null, 'El verificador dice: «', p.mensaje, '»'));
        }))));
      if (!items.length) items.push(TS.el('li', null, 'Ninguna prueba falló.'));
      ol.replaceChildren(...items);
    }

    function pintarDomino(d, orig, L) {
      const caja = L_('domino');
      const cuerpo = L_('domino-cuerpo');
      if (d.tipo !== 'contenido_recalculado') { caja.hidden = true; return; }
      const k = d.bloque;
      const N = L - k;
      const dif = orig.dificultad;
      const intentos = N * 16 ** dif;
      const seg = velocidad ? intentos / velocidad : 0;
      const tope = Math.min(N, 10);
      const fichas = Array.from({ length: tope }, (_, i) => TS.el('li', { style: { '--i': String(i) } }, `#${k + i}`));
      if (N > tope) fichas.push(TS.el('li', { class: 'lab-domino__mas' }, `+${miles(N - tope)}`));
      cuerpo.replaceChildren(
        TS.el('p', null, N === 1
          ? `Recalcular la huella no basta: la nueva no tiene los ${dif} ceros. Como la hoja #${k} es la última, «solo» tendrías que volver a minarla.`
          : `Recalcular la huella no basta: la nueva no tiene los ${dif} ceros. Para esconder la trampa tendrías que volver a minar la hoja #${k}; entonces la hoja #${k + 1} deja de apuntarle, así que también hay que cambiarla y minarla… y así hasta la última, la #${L - 1}.`),
        TS.el('ol', { class: 'lab-domino__fichas', role: 'list', 'aria-label': `Hojas que habría que volver a minar: de la #${k} a la #${L - 1}` }, ...fichas),
        TS.el('dl', { class: 'lab-domino__cifras' },
          TS.el('div', null, TS.el('dt', null, 'Hojas por volver a minar'), TS.el('dd', null, miles(N))),
          TS.el('div', null, TS.el('dt', null, 'Intentos esperados'), TS.el('dd', null, `≈ ${miles(intentos)}`)),
          seg ? TS.el('div', null, TS.el('dt', null, 'Con la velocidad de este servidor'), TS.el('dd', null, `≈ ${TS.fmt.segundos(seg)}`)) : null),
        TS.el('p', null, 'Y aunque lo lograras, la firma te seguiría delatando: solo la universidad puede firmar el contenido nuevo. Mientras tanto, los mineros honestos siguen agregando hojas a la cadena real: siempre irías detrás.'));
      caja.hidden = false;
    }

    function pintarSiguiente(d) {
      const p = L_('siguiente');
      const SUG = {
        contenido: ['contenido_recalculado', '¿Y si además recalculas la huella para que cuadre?', 'Probar «el tramposo listo»'],
        hash: ['firma', '¿Y si en vez de la huella tocas la firma?', 'Probar cambiando la firma'],
        firma: ['contenido_recalculado', '¿Y si cambias el texto y recalculas la huella?', 'Probar «el tramposo listo»'],
        contenido_recalculado: [null, 'Elige una hoja más antigua: el dominó se hace más largo.', null],
      }[d.tipo];
      if (!SUG) { p.replaceChildren(); return; }
      const [tipo, texto, accion] = SUG;
      if (!tipo) { p.replaceChildren(texto); return; }
      p.replaceChildren(texto, ' ', TS.el('button', {
        type: 'button', class: 'boton boton--secundario boton--chico',
        onclick: () => {
          const r = form.querySelector(`input[name="tipo"][value="${tipo}"]`);
          if (r) r.checked = true;
          form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
        },
      }, accion));
    }

    async function pintar(d) {
      const k = d.bloque;
      const L = d.bloques.length;
      const estados = new Map(d.bloques.map((x) => [x.bloque, x]));
      const nums = [k + 1, k, k - 1].filter((n) => n >= 0 && n < L);
      const originales = await Promise.all(nums.map(bloque));
      const porNum = new Map(nums.map((n, i) => [n, originales[i]]));
      const orig = porNum.get(k);
      const fiable = await serializadorFiable(orig);

      const alt = d.alteracion;
      const alterado = JSON.parse(JSON.stringify(orig));
      if (alt.campo === 'hash') alterado.hash = alt.despues;
      else if (alt.campo === 'firma') alterado.firma = alt.despues;
      else alterado.transaccion.contenido[alt.campo] = alt.despues;
      const recalculada = fiable ? await huellaDe(alterado) : null;
      if (d.tipo === 'contenido_recalculado' && recalculada) alterado.hash = recalculada;
      const vistaNum = new Map(porNum);
      vistaNum.set(k, alterado);

      // la copia: hojas vecinas y huecos «N hojas más»
      const ol = L_('legajo');
      const malas = (a, b) => d.bloques.slice(a, b).filter((x) => !x.valido).length;
      const nuevas = L - k - 2;
      const viejas = k - 1;
      const textoSalto = (n, cual, m) => `${miles(n)} ${pl(n, 'hoja', 'hojas')} ${cual} ${m ? `(${m} con fallas)` : pl(n, 'que sigue íntegra', 'que siguen íntegras')}`;
      ol.replaceChildren(...[
        nuevas > 0 ? salto(textoSalto(nuevas, pl(nuevas, 'más reciente', 'más recientes'), malas(k + 2, L))) : null,
        ...nums.map((n) => folio(vistaNum.get(n), estados.get(n), n === k)),
        viejas > 0 ? salto(textoSalto(viejas, pl(viejas, 'más antigua', 'más antiguas'), malas(0, k - 1))) : null,
      ].filter(Boolean));
      if (alt.campo === 'hash') {
        const code = ol.querySelector(`.lab-folio--alterado .folio__fila--huella .huella`);
        if (code) code.replaceWith(difHex(String(alt.despues), String(alt.antes)));
      }

      pintarCambio(d, orig, recalculada);
      pintarFallas(d, porNum);
      pintarDomino(d, orig, L);
      pintarSiguiente(d);

      // veredicto
      const n = d.problemas.length;
      const hojas = new Set(d.problemas.map((x) => x.bloque)).size;
      L_('titulo').textContent = d.copia_valida ? 'La copia pasó las pruebas.' : d.tipo === 'contenido_recalculado' ? 'Ni recalculando te salvaste.' : 'Te cacharon.';
      L_('resumen').textContent = d.copia_valida
        ? 'Esto no debería pasar. Revisa la cadena en el explorador.'
        : `${miles(n)} ${pl(n, 'prueba falló', 'pruebas fallaron')} en ${hojas} ${pl(hojas, 'hoja', 'hojas')} de la copia.${hojas > 1 ? ' El daño alcanzó a la hoja siguiente: el cordón la delata.' : ''}`;
      const goma = L_('goma-copia');
      goma.dataset.estado = d.copia_valida ? 'valida' : 'invalida';
      goma.textContent = d.copia_valida ? 'Copia: íntegra' : 'Copia: alterada';
      const real = L_('goma-real');
      const cabeza = L_('real-cabeza');
      [real, cabeza].forEach((g) => {
        if (!g) return;
        g.dataset.estado = d.original_valida ? 'valida' : 'invalida';
        g.textContent = d.original_valida ? 'Real: íntegra' : 'Real: con fallas';
      });
      L_('real').textContent = d.original_valida
        ? 'La cadena real sigue intacta. La copia alterada ya se tiró.'
        : 'La cadena real ya traía fallas antes de tu trampa (no las causaste tú). Revísala en el explorador.';

      res.hidden = false;
      [goma, real].forEach((g) => { g.classList.remove('sello-goma--estampa'); void g.offsetWidth; g.classList.add('sello-goma--estampa'); });
      animarFolios(ol, k);
      res.scrollIntoView({ block: 'start', behavior: TS.reducido() ? 'auto' : 'smooth' });
      res.focus({ preventScroll: true });
      TS.anunciar(`${L_('titulo').textContent} ${L_('resumen').textContent} La cadena real no se tocó.`);
    }

    /* -------------------------------------------------------------- enviar */
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (form.dataset.ocupado) return;
      form.dataset.ocupado = '1';
      boton.setAttribute('aria-disabled', 'true');
      if (boton.lastChild) boton.lastChild.textContent = ' Haciendo trampa en la copia…';
      error.hidden = true;
      const tipo = (form.querySelector('input[name="tipo"]:checked') || {}).value || 'contenido';
      const r = await TS.api('/api/laboratorio', { method: 'POST', body: { bloque: +sel.value, tipo } });
      try {
        if (!r.ok || !r.data) {
          error.textContent = r.status === 400 && /sesión/i.test((r.data && r.data.error) || '')
            ? 'Tu sesión expiró. Recarga la página e inténtalo de nuevo.'
            : (r.data && r.data.error) || 'No se pudo hacer la prueba. Inténtalo de nuevo.';
          error.hidden = false;
          return;
        }
        await pintar(r.data);
      } catch (e) {
        console.error(e);
        error.textContent = 'Algo falló al dibujar el resultado. Inténtalo de nuevo.';
        error.hidden = false;
      } finally {
        delete form.dataset.ocupado;
        boton.setAttribute('aria-disabled', 'false');
        if (boton.lastChild) boton.lastChild.textContent = etiquetaBoton;
      }
    });
  });
})();
