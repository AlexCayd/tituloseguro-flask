/* Título Seguro · emitir (ceremonia de firma).
 *   - Vista previa en vivo de la ficha (la matrícula se ve tachada: nunca se guarda).
 *   - Al firmar (fetch a /transaccion): el sello se estampa con los bytes de la firma devuelta,
 *     se explica qué pasó (firma → fila → falta minar) y se vigila /estado hasta que se mine.
 *   - Revocar (fetch a /revocar) con aviso en línea.
 *   Sin JS, ambos formularios funcionan igual: el servidor redirige con un mensaje.
 */
(() => {
  'use strict';
  const TS = window.TS;
  if (!TS) return;
  const TIPO = { 'título': 'Título', diploma: 'Diploma', certificado: 'Certificado', constancia: 'Constancia' };

  /* pistas extra para los errores más comunes de las reglas */
  function pista(msg) {
    if (/vigente/.test(msg)) return ' Si quieres reemplazarla, primero revoca la anterior (abajo, en «Revocar un folio»).';
    if (/huella no puede registrarse/.test(msg)) return ' Ese mismo documento ya existe en la cadena o en la fila.';
    if (/propio código/.test(msg)) return ' Cada universidad solo firma con su propio código.';
    if (/sesión expiró/.test(msg)) return ' Recarga la página e inténtalo de nuevo.';
    return '';
  }

  TS.listo(() => {
    if (document.body.dataset.pagina !== 'emitir') return;
    const E = (k, r = document) => r.querySelector(`[data-e="${k}"]`);
    const form = E('form');
    if (!form) return;
    const acta = E('acta');
    const sello = E('sello');
    const firmado = E('firmado');
    const boton = E('boton');
    const errorCaja = E('error');
    const original = {
      folio: E('folio') ? E('folio').textContent : '',
      pie: E('pie') ? E('pie').textContent : '',
      sello: sello ? sello.dataset.sello : '',
    };
    let pendiente = null;   // folio firmado que esperamos ver minado
    let largo = null;
    let ocupado = false;

    /* -------------------------------------------------------------- vista previa */
    const campos = {
      matricula: form.elements.matricula,
      programa: form.elements.programa,
      fecha: form.elements.fecha_emision,
    };
    function previa() {
      const m = (campos.matricula.value || '').trim();
      E('v-matricula').textContent = m || '—';
      const pr = (campos.programa.value || '').trim();
      E('v-programa').replaceChildren(pr ? TS.el('em', null, pr) : TS.el('span', { class: 'previa__falta' }, 'Falta el programa'));
      const t = (form.querySelector('input[name="tipo"]:checked') || {}).value;
      E('v-tipo').textContent = TIPO[t] || t || '';
      E('v-fecha').textContent = campos.fecha.value || '—';
    }
    form.addEventListener('input', previa);
    form.addEventListener('change', previa);
    previa();

    /* -------------------------------------------------------------- estado de la fila */
    function textoCola(n) {
      return n ? `Quedó en el lugar #${TS.fmt.miles(n)} de la fila. Las credenciales se sellan en orden de llegada, una por carrera.` : 'Quedó al final de la fila. Se sellan en orden de llegada.';
    }
    TS.estado.suscribir(async (e) => {
      if (!e || e.longitud == null) return;
      if (largo === null) { largo = e.longitud; return; }
      if (e.longitud === largo || !pendiente) { largo = e.longitud; return; }
      largo = e.longitud;
      const folio = pendiente;
      const r = await TS.api(`/api/verificar/${encodeURIComponent(folio)}`);
      if (!r.ok || !r.data || r.data.estado !== 'vigente' || folio !== pendiente) return;
      pendiente = null;
      const paso = E('paso-minar');
      paso.dataset.hecho = 'si';
      paso.querySelector('.pasos-firma__marca').replaceChildren(TS.icono('check'));
      E('minar-titulo').textContent = `¡Sellada en la hoja #${r.data.bloque.numero}!`;
      E('minar-texto').textContent = `${r.data.bloque.minero} encontró su número de intento. Ya está cosida a la cadena: cualquiera puede verificarla.`;
      TS.anunciar(`La credencial ${folio} ya quedó sellada en la cadena, en la hoja ${r.data.bloque.numero}.`);
    });

    /* -------------------------------------------------------------- firmar */
    function mostrarError(msg) {
      E('error-texto').textContent = msg + pista(msg);
      errorCaja.hidden = false;
    }
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (ocupado) return;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      ocupado = true;
      errorCaja.hidden = true;
      boton.setAttribute('aria-disabled', 'true');
      E('boton-texto').textContent = 'Firmando…';
      const datos = {
        matricula: campos.matricula.value,
        programa: campos.programa.value,
        tipo: (form.querySelector('input[name="tipo"]:checked') || {}).value,
        fecha_emision: campos.fecha.value,
      };
      const r = await TS.api(form.getAttribute('action'), { method: 'POST', body: datos });
      ocupado = false;
      boton.setAttribute('aria-disabled', 'false');
      E('boton-texto').textContent = 'Firmar y mandar a la fila';
      if (!r.ok || !r.data || !r.data.folio) {
        const msg = (r.data && r.data.error) || 'No se pudo firmar. Inténtalo de nuevo.';
        mostrarError(r.status === 403 ? 'Tu cuenta no puede firmar credenciales.' : msg);
        TS.anunciar(msg);
        return;
      }
      const { folio, firma } = r.data;
      pendiente = folio;
      // el acta queda firmada: folio real, sello estampado con la firma
      E('folio').textContent = folio;
      E('folio').classList.add('acta__folio--nuevo');
      E('v-huella').textContent = 'calculada en el servidor';
      E('pie').textContent = `Firmada por ${(acta.querySelector('.etiqueta') || {}).textContent || 'tu universidad'}. Este sello sale de los 64 bytes de su firma.`;
      // en pantallas angostas la ficha está debajo del formulario: primero se lleva a la vista y
      // después se estampa, para que el sello no caiga fuera de pantalla
      const angosta = window.matchMedia('(max-width: 62rem)').matches;
      if (angosta) acta.scrollIntoView({ block: 'start', behavior: TS.reducido() ? 'auto' : 'smooth' });
      if (sello && TS.sello) {
        sello.setAttribute('aria-label', `Sello de la firma de la credencial ${folio}`);
        window.setTimeout(() => TS.sello.estampar(sello, firma), angosta && !TS.reducido() ? 550 : 0);
      }
      acta.classList.add('acta--firmada');
      E('firma-corta').textContent = `${firma.slice(0, 24)}…`;
      E('verificar').href = `/verificar/${encodeURIComponent(folio)}`;
      const paso = E('paso-minar');
      paso.dataset.hecho = 'no';
      paso.querySelector('.pasos-firma__marca').replaceChildren(TS.icono('pluma'));
      E('minar-titulo').textContent = 'Falta que un minero la selle';
      E('minar-texto').textContent = 'Un minero tiene que encontrar su número de intento ganador. Cuando pase, quedará cosida a la cadena y podrá verificarse. Te avisamos aquí.';
      E('cola-texto').textContent = textoCola(0);
      firmado.hidden = false;
      form.classList.add('ficha-emitir--firmada');
      TS.anunciar(`Credencial ${folio} firmada y en la fila de minería.`);
      if (!angosta) window.setTimeout(() => firmado.scrollIntoView({ block: 'nearest', behavior: TS.reducido() ? 'auto' : 'smooth' }), TS.reducido() ? 0 : 700);
      // lugar en la fila (las pendientes se cuentan sin la que se está minando)
      const est = await TS.api('/estado');
      if (est.ok && est.data) {
        E('cola-texto').textContent = textoCola(est.data.cola);
        const ol = E('fila');
        const resto = E('fila-resto');
        if (ol && est.data.cola <= TS.$$('.papeleta', ol).length + 1) {
          const t = (TIPO[datos.tipo] || datos.tipo);
          ol.append(TS.el('li', { class: 'papeleta papeleta--tuya', 'data-folio': folio },
            TS.el('span', { class: 'papeleta__turno', 'aria-label': `Turno ${est.data.cola}` }, String(est.data.cola)),
            TS.el('span', { class: 'papeleta__folio mono' }, folio),
            TS.el('span', { class: 'papeleta__que' }, `${t} · ${datos.programa.trim()}`),
            TS.el('span', { class: 'papeleta__estado' }, 'La tuya')));
        } else if (resto) {
          resto.textContent = `… y más detrás. La tuya, ${folio}, va en el lugar #${TS.fmt.miles(est.data.cola)}.`;
        }
      }
    });

    /* -------------------------------------------------------------- firmar otra */
    E('otra').addEventListener('click', () => {
      pendiente = null;
      firmado.hidden = true;
      form.classList.remove('ficha-emitir--firmada');
      acta.classList.remove('acta--firmada');
      E('folio').textContent = original.folio;
      E('folio').classList.remove('acta__folio--nuevo');
      E('pie').textContent = original.pie;
      E('v-huella').textContent = 'se calcula al firmar';
      if (sello) {
        sello.dataset.sello = original.sello;
        sello.dataset.estado = 'pendiente';
        sello.setAttribute('aria-label', 'Lugar del sello: todavía sin firmar');
      }
      campos.matricula.value = '';
      campos.programa.value = '';
      previa();
      campos.matricula.focus();
    });

    /* -------------------------------------------------------------- revocar */
    const rev = E('revocar');
    if (rev) {
      const aviso = E('revocar-aviso');
      const cuenta = E('motivo-cuenta');
      const motivo = rev.elements.motivo;
      const contar = () => { if (cuenta) cuenta.textContent = `Llevas ${motivo.value.trim().length} de 200.`; };
      motivo.addEventListener('input', contar);
      contar();
      let revOcupado = false;
      rev.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (revOcupado) return;
        if (!rev.checkValidity()) { rev.reportValidity(); return; }
        revOcupado = true;
        const btn = E('revocar-boton');
        btn.setAttribute('aria-disabled', 'true');
        const r = await TS.api(rev.getAttribute('action'), { method: 'POST', body: { folio: rev.elements.folio.value, motivo: motivo.value } });
        revOcupado = false;
        btn.setAttribute('aria-disabled', 'false');
        const ok = r.ok && r.data && r.data.folio;
        aviso.className = `alerta alerta--${ok ? 'ok' : 'error'}`;
        aviso.setAttribute('role', ok ? 'status' : 'alert');
        E('revocar-texto').textContent = ok
          ? `La revocación de ${r.data.folio} quedó firmada y en la fila. Cuando un minero la selle, ese folio aparecerá como «revocado» al verificarlo.`
          : ((r.data && r.data.error) || 'No se pudo firmar la revocación.');
        aviso.hidden = false;
        if (ok) { rev.reset(); contar(); }
        TS.anunciar(E('revocar-texto').textContent);
      });
    }
  });
})();
