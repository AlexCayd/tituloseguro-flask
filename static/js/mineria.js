/* Título Seguro · minería (la carrera la maneja carrera.js).
 *   - «Lo último sellado»: pinta las 3 hojas más recientes y las deja vivas (TS.legajo.vivo).
 *   - La fila se mantiene al día: marca la credencial que se está sellando y retira las ya selladas.
 *   - Los tiempos esperados por dificultad se recalculan con la velocidad real del servidor.
 */
(() => {
  'use strict';
  const TS = window.TS;
  if (!TS) return;

  TS.listo(() => {
    if (document.body.dataset.pagina !== 'mineria') return;
    const M = (k) => document.querySelector(`[data-m="${k}"]`);

    /* lo último sellado */
    const ol = M('legajo');
    if (ol) {
      TS.api('/api/cadena?limite=3').then((r) => {
        if (r.ok && r.data && Array.isArray(r.data.bloques)) {
          const malos = new Set((r.data.problemas || []).map((x) => x.bloque));
          ol.replaceChildren(...r.data.bloques.map((b) => TS.folio.crear(b, { valido: !malos.has(b.numero) })));
        }
        ol.dataset.max = '3';
        ol.setAttribute('data-legajo-vivo', '');
        TS.legajo.vivo(ol);
      });
    }

    /* la fila */
    const fila = M('fila');
    if (fila) {
      TS.estado.suscribir((e) => {
        if (!e) return;
        const items = TS.$$('.papeleta', fila);
        const enJuego = e.minando ? e.folio : null;
        const meta = enJuego || e.proximo_folio;
        if (meta && items.some((li) => li.dataset.folio === meta)) {
          for (const li of items) {
            if (li.dataset.folio === meta) break;
            if (TS.reducido()) li.remove();
            else li.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(1rem)' }], { duration: 220, easing: 'ease-in' })
              .finished.then(() => li.remove(), () => li.remove());
          }
        }
        TS.$$('.papeleta', fila).forEach((li) => {
          const sellando = !!enJuego && li.dataset.folio === enJuego;
          li.classList.toggle('papeleta--minando', sellando);
          const est = li.querySelector('[data-p="estado"]');
          if (est) est.textContent = sellando ? 'Sellándose ahora' : '';
        });
      });
    }

    /* tiempos esperados */
    const nota = M('t-vel');
    TS.estado.suscribir((e) => {
      if (!e || !Array.isArray(e.nodos)) return;
      const vel = e.hashrate_ultima || e.nodos.reduce((s, n) => s + (n.hashrate || 0), 0);
      if (!vel) return;
      [3, 4, 5].forEach((d) => {
        const td = M(`t${d}`);
        if (td) td.textContent = `≈ ${TS.fmt.segundos(16 ** d / vel)}`;
      });
      if (nota) {
        nota.textContent = `Calculado con la velocidad real de la última carrera: ${TS.fmt.miles(vel)} intentos por segundo entre los cuatro.`;
      }
    });
  });
})();
