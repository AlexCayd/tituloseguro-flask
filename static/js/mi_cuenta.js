/* Título Seguro · mi cuenta (alumno).
 *   Las credenciales en la fila se vigilan con /estado: cuando una queda sellada, su sello se estampa,
 *   el sello de goma pasa a «vigente» y se avisa (también a lectores de pantalla). Sin recargar.
 */
(() => {
  'use strict';
  const TS = window.TS;
  if (!TS) return;

  TS.listo(() => {
    if (document.body.dataset.pagina !== 'mi_cuenta') return;
    const pendientes = () => TS.$$('.diploma[data-estado="pendiente"]');
    if (!pendientes().length) return;
    let largo = null;
    let revisando = false;

    async function revisar() {
      revisando = true;
      try {
        for (const art of pendientes()) {
          const folio = art.dataset.folio;
          const r = await TS.api(`/api/verificar/${encodeURIComponent(folio)}`);
          if (!r.ok || !r.data || r.data.estado !== 'vigente' || !r.data.bloque) continue;
          const b = r.data.bloque;
          const D = (k) => art.querySelector(`[data-d="${k}"]`);
          art.dataset.estado = 'vigente';
          const goma = D('goma');
          if (goma) {
            goma.dataset.estado = 'vigente';
            goma.textContent = 'Vigente';
            goma.classList.add('sello-goma--estampa');
          }
          const s = D('sello');
          if (s && TS.sello) {
            s.setAttribute('aria-label', `Sello del bloque ${b.numero}`);
            TS.sello.estampar(s, b.hash);
          }
          const st = D('sello-texto');
          if (st) st.textContent = `Sello de la hoja #${b.numero}`;
          const cad = D('cadena');
          if (cad) cad.replaceChildren('Hoja ', TS.el('a', { href: `/explorador?hasta=${b.numero}#folio-${b.numero}` }, `#${b.numero}`), ` · la selló ${b.minero}`);
          const av = D('aviso');
          if (av) {
            av.classList.add('diploma__aviso--ok');
            av.textContent = `¡Ya quedó sellada! ${b.minero} la cosió a la cadena en la hoja #${b.numero}. Desde ahora cualquiera puede verificarla.`;
          }
          const vig = TS.$('[data-x="vigentes"]');
          const pen = TS.$('[data-x="pendientes"]');
          if (vig) vig.textContent = String(+vig.textContent + 1);
          if (pen) pen.textContent = String(Math.max(0, +pen.textContent - 1));
          TS.anunciar(`Tu credencial ${folio} ya quedó sellada en la cadena.`);
        }
      } finally {
        revisando = false;
      }
    }

    TS.estado.suscribir((e) => {
      if (!e || e.longitud == null) return;
      if (largo === null) { largo = e.longitud; return; }
      if (e.longitud === largo || revisando) return;
      largo = e.longitud;
      if (pendientes().length) revisar();
    });
  });
})();
