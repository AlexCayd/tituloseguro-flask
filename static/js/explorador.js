/* Título Seguro · explorador.
 *   - El JSON de cada bloque se reescribe legible (con acentos) al abrir su «Detalle técnico».
 *   - Cifras vivas que no salen directo de /estado: hojas minadas y escribanos que han ganado.
 *   - Las hojas que TS.legajo.vivo inserta en vivo reciben el mismo detalle técnico y su línea en
 *     el índice (pidiendo el bloque completo a /api/bloque/<n>).
 */
(() => {
  'use strict';
  const TS = window.TS;
  if (!TS) return;

  /* JSON legible: el servidor lo manda con í; aquí se reescribe con los acentos */
  function bonito(pre) {
    if (!pre || pre.dataset.bonito) return;
    try { pre.textContent = JSON.stringify(JSON.parse(pre.textContent), null, 2); } catch { /* se queda como vino */ }
    pre.dataset.bonito = '1';
  }

  const termino = (clave, texto) => TS.el('button', { type: 'button', class: 'termino', 'data-termino': clave }, texto);
  const enlaceVerificar = (folio, texto) => TS.el('a', { class: 'boton boton--secundario boton--chico boton--flecha', href: `/verificar/${encodeURIComponent(folio)}` },
    TS.icono('lupa'), ` ${texto} `, TS.icono('flecha'));

  /* mismo marcado que la macro detalle() de explorador.html */
  function detalleDe(b) {
    const tx = b.transaccion || {};
    const c = tx.contenido || {};
    const genesis = tx.proposito === 'genesis' || b.numero === 0;
    const rev = tx.proposito === 'revocacion';
    const extra = TS.el('div', { class: 'folio__extra' });
    if (genesis) extra.append(TS.el('p', { class: 'folio__aviso' }, 'La primera hoja del libro. Nadie la minó y no tiene hoja anterior: por eso su «huella anterior» son 64 ceros.'));
    else if (rev) {
      extra.append(TS.el('p', { class: 'folio__aviso folio__aviso--lacre' }, 'Esta hoja no borra nada: anota, con la firma de la misma universidad, que el folio ',
        TS.el('a', { class: 'mono', href: `/verificar/${encodeURIComponent(c.folio_revocado)}` }, c.folio_revocado), ` queda anulado desde el ${c.fecha}. El registro original sigue en su hoja.`));
    }
    const acc = TS.el('div', { class: 'folio__acciones' });
    if (!genesis && !rev) acc.append(enlaceVerificar(c.folio, 'Verificar este folio'));
    else if (rev) acc.append(enlaceVerificar(c.folio_revocado, 'Ver el folio revocado'));
    extra.append(acc);

    const fila = (dt, ...dd) => [TS.el('dt', null, dt), TS.el('dd', null, ...dd)];
    const nota = (t) => TS.el('span', { class: 'nota' }, t);
    const ficha = TS.el('dl', { class: 'ficha' },
      fila(termino('huella', 'Huella'), TS.huella(b.hash, { dificultad: genesis ? null : b.dificultad })),
      fila(termino('huella-anterior', 'Huella anterior'), TS.huella(b.hash_anterior)),
      genesis ? null : fila(termino('nonce', 'Nonce'), TS.el('span', { class: 'mono' }, String(b.nonce)), ' ',
        nota(`— al dividirlo entre 4 sobra ${b.nonce % 4}: por eso es un número de ${b.minero}.`)),
      genesis ? null : fila(termino('dificultad', 'Dificultad'), `${b.dificultad} ceros `, nota('— quedó sellada dentro del bloque.')),
      genesis ? null : fila(termino('firma', 'Firma'), TS.el('code', { class: 'huella' }, b.firma)),
      genesis ? null : fila(termino('remitente', 'Remitente'), TS.el('code', { class: 'huella' }, tx.remitente), ' ', nota(`— llave pública de ${rev ? 'quien revoca' : c.universidad}.`)),
      fila('Hora', TS.el('span', { class: 'mono' }, b.timestamp)));
    const pre = TS.el('pre', { class: 'json', id: `json-${b.numero}`, tabindex: '0', 'aria-label': `Bloque ${b.numero} en formato JSON`, 'data-json': '', 'data-bonito': '1' }, JSON.stringify(b, null, 2));
    const det = TS.el('details', { class: 'detalle', 'data-detalle': b.numero },
      TS.el('summary', null, 'Detalle técnico ', nota('(huella, nonce, firma y el bloque completo)')),
      TS.el('div', { class: 'detalle__cuerpo' }, ficha,
        TS.el('div', { class: 'json__cabeza' },
          TS.el('p', { class: 'rotulo' }, 'El bloque completo, en ', termino('json', 'JSON')),
          TS.el('button', { type: 'button', class: 'boton boton--secundario boton--chico', 'data-copiar': `#json-${b.numero}` },
            TS.el('span', { 'data-copiar-etiqueta': '' }, 'Copiar JSON'))),
        pre));
    extra.append(det);
    return extra;
  }

  /* el índice se reconstruye leyendo el propio legajo: siempre en su orden y con las mismas hojas */
  function lineaDesdeFolio(li, nuevo) {
    const n = li.dataset.numero;
    const tipo = li.classList.contains('folio--genesis') ? 'genesis' : li.classList.contains('folio--revocacion') ? 'revocacion' : 'registro';
    const asunto = (li.querySelector('.folio__asunto') || {}).textContent || '';
    const sello = [...li.querySelectorAll('.folio__meta span')].find((s) => /^Lo selló/.test(s.textContent));
    const quien = tipo === 'genesis' ? '—' : (sello && sello.querySelector('strong') ? sello.querySelector('strong').textContent : '');
    return TS.el('li', { class: `indice__item indice__item--${tipo}${nuevo ? ' indice__item--nuevo' : ''}` },
      TS.el('a', { href: `#folio-${n}` },
        TS.el('span', { class: 'indice__num' }, `#${n}`),
        TS.el('span', { class: 'indice__que' }, asunto.trim()),
        TS.el('span', { class: 'indice__quien' }, quien)));
  }

  TS.listo(() => {
    if (document.body.dataset.pagina !== 'explorador') return;

    document.addEventListener('toggle', (ev) => {
      const det = ev.target;
      if (det.matches && det.matches('details.detalle') && det.open) bonito(det.querySelector('pre[data-json]'));
    }, true);

    /* cifras vivas */
    const minados = TS.$('[data-x="minados"]');
    const ganadores = TS.$('[data-x="ganadores"]');
    TS.estado.suscribir((e) => {
      if (!e || e.longitud == null) return;
      if (minados) minados.textContent = TS.fmt.miles(Math.max(0, e.longitud - 1));
      if (ganadores && Array.isArray(e.nodos)) ganadores.textContent = String(e.nodos.filter((n) => n.saldo > 0).length);
    });

    /* hojas nuevas: detalle técnico + línea del índice */
    const ol = TS.$('.legajo[data-legajo-vivo]');
    const indice = TS.$('[data-indice]');
    if (!ol) return;
    const pedidos = new Set();
    const desde = TS.$('[data-x="desde"]');
    const hasta = TS.$('[data-x="hasta"]');
    let rehacer = 0;
    function rehacerIndice() {
      rehacer = 0;
      const folios = TS.$$('.folio', ol);
      if (!folios.length) return;
      if (indice) {
        const antes = new Set(TS.$$('.indice__num', indice).map((x) => x.textContent));
        indice.replaceChildren(...folios.map((li) => lineaDesdeFolio(li, !antes.has(`#${li.dataset.numero}`))));
      }
      if (desde) desde.textContent = folios[0].dataset.numero;
      if (hasta) hasta.textContent = folios[folios.length - 1].dataset.numero;
    }
    new MutationObserver((muts) => {
      let hubo = false;
      for (const m of muts) {
        if (m.removedNodes.length) hubo = true;
        for (const li of m.addedNodes) {
          if (li.nodeType !== 1 || !li.classList.contains('folio')) continue;
          hubo = true;
          if (li.querySelector('.folio__extra')) continue;
          const n = +li.dataset.numero;
          if (pedidos.has(n)) continue;
          pedidos.add(n);
          TS.api(`/api/bloque/${n}`).then((r) => {
            if (r.ok && r.data && li.isConnected) li.append(detalleDe(r.data));
          });
        }
      }
      if (hubo && !rehacer) rehacer = window.setTimeout(rehacerIndice, 120);
    }).observe(ol, { childList: true });
  });
})();
