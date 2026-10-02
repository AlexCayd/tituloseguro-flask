/* Título Seguro · verificar.
 *   - Sin folio: propone uno real de la cadena para probar.
 *   - Con constancia: escribe la hora local de la consulta.
 *   - Pendiente: vigila /estado y avisa en cuanto la credencial queda sellada (sin recargar a la fuerza).
 */
(() => {
  'use strict';
  const TS = window.TS;
  if (!TS) return;

  TS.listo(() => {
    const pagina = document.body.dataset.pagina || '';
    if (!pagina.startsWith('verificar')) return;

    /* hora de la consulta */
    TS.$$('[data-v="ahora"]').forEach((t) => {
      const ahora = new Date();
      t.setAttribute('datetime', ahora.toISOString());
      t.textContent = `el ${TS.fmt.fecha(ahora.toISOString())}`;
    });

    /* folio de ejemplo (el registro más reciente de la cadena) */
    const ej = TS.$('[data-v="ejemplo"]');
    if (ej) {
      TS.api('/api/cadena?limite=12').then((r) => {
        if (!r.ok || !r.data || !Array.isArray(r.data.bloques)) return;
        const b = r.data.bloques.find((x) => x.transaccion && x.transaccion.proposito === 'registro_academico');
        if (!b) return;
        const folio = b.transaccion.contenido.folio;
        ej.replaceChildren('¿No tienes uno a la mano? Prueba con uno real: ',
          TS.el('a', { href: `/verificar/${encodeURIComponent(folio)}`, class: 'mono' }, folio));
        ej.hidden = false;
      });
    }

    /* pendiente: avisar cuando se selle */
    const vivo = TS.$('[data-v="vivo"]');
    const folioEl = TS.$('.expediente--veredicto [data-estado="pendiente"]') ? TS.$('#folio-otro') : null;
    if (vivo && folioEl) {
      const folio = folioEl.value;
      let largo = null;
      let listo = false;
      const desuscribir = TS.estado.suscribir(async (e) => {
        if (listo || !e || e.longitud == null) return;
        if (largo === null) { largo = e.longitud; return; }
        if (e.longitud === largo) return;
        largo = e.longitud;
        const r = await TS.api(`/api/verificar/${encodeURIComponent(folio)}`);
        if (!r.ok || !r.data || r.data.estado === 'pendiente') return;
        listo = true;
        desuscribir();
        vivo.replaceChildren(
          TS.el('strong', null, '¡Ya quedó sellada! '),
          `Un minero la cosió en la hoja #${r.data.bloque ? r.data.bloque.numero : '?'}. `,
          TS.el('a', { class: 'boton boton--primario boton--chico', href: window.location.pathname }, 'Ver la constancia'));
        vivo.dataset.listo = '1';
        TS.anunciar('La credencial ya quedó sellada en la cadena. Recarga para ver su constancia.');
      });
    }
  });
})();
