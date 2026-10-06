// VISTA · Registros de credenciales (id técnico: `transacciones`, no cambia)
//  · Formulario institución emisora → institución que avala · créditos de certificación, con
//    tarifas orientativas (título, diploma, certificado, constancia) que solo rellenan el monto.
//    Se valida en cliente Y servidor (mensaje exacto del servidor en su campo; desglose si faltan
//    créditos).
//  · «Qué se firma»: el JSON canónico se arma en vivo, su SHA-256 (= id del registro) se calcula en
//    el navegador y, al enviar, se compara con el id que devuelve el servidor. La credencial y el
//    alumno NO forman parte del mensaje: solo emisor, receptor, monto y timestamp.
//  · Falsificaciones didácticas: firma alterada / firmada con la clave de otra institución.
//  · Registros en espera de sello (los 8 primeros entran en el próximo bloque), al azar y sellado
//    automático (demostración).

import { sigla, nombre, rotulo, creditos, TARIFAS, UNIDAD, tarifaPorMonto } from '../dominio.js';

const RE_ENTERO = /^\d+$/;

export default {
  id: 'transacciones',
  titulo: 'Registro de credenciales',
  etiqueta: 'Registros',
  icono: 'diploma',
  modos: ['pow', 'pos'],
  orden: 20,
  descripcion: 'Una institución emisora firma con su clave privada el pago de créditos de certificación a la institución que avala el registro; el consorcio comprueba la firma y los créditos antes de dejarlo en espera de sello.',
  insignia: (e) => e.pendientes_total || null,

  montar(host, ctx) {
    const { h } = ctx;
    ctx.local = { ultimoTs: null, enviada: null, idsClave: '' };
    const izquierda = h('div.tx-col');
    const derecha = h('div.tx-col');
    host.append(h('div.tx-rejilla', izquierda, derecha));
    construirFormulario(izquierda, ctx);
    construirPendientes(derecha, ctx);
    construirAtajos(derecha, ctx);
  },

  actualizar(e, ctx) {
    sincronizarOpciones(e, ctx);
    pintarGastable(e, ctx);
    pintarPendientes(e, ctx);
    if (ctx.local.reloj !== e.reloj) { ctx.local.reloj = e.reloj; vistaPrevia(ctx); }
  },
};

/** «registro de un título profesional» para el monto, si coincide con una tarifa. */
function queSeRegistra(monto) {
  const t = tarifaPorMonto(monto);
  if (!t) return null;
  const n = t.nombre.toLowerCase();
  return `registro de ${n.startsWith('constancia') ? 'una' : 'un'} ${n}`;
}

// ============================================================ formulario
function construirFormulario(col, ctx) {
  const { h, ui, icono, modo } = ctx;
  const L = ctx.local;
  const id = (x) => `tx-${modo}-${x}`;

  const emisor = h('select.selector', { id: id('emisor'), name: 'emisor', 'aria-describedby': id('gastable') });
  const receptor = h('select.selector', { id: id('receptor'), name: 'receptor' });
  const monto = h('input.entrada.entrada--mono', { id: id('monto'), name: 'monto', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: String(TARIFAS[0]?.monto ?? 10), 'aria-describedby': id('monto-ayuda') });
  const gastable = h('div.tx-gastable', { id: id('gastable'), 'aria-live': 'polite' });
  const campo = (control, etiqueta, ...extra) => h('div.campo', h('label.campo__etiqueta', { for: control.id }, etiqueta), control, ...extra, h('p.campo__error'));
  const montoAyuda = h('p.campo__ayuda', { id: id('monto-ayuda') });

  // ---- tarifas orientativas: solo rellenan el monto --------------------------
  const tarifas = h('div.segmentado.tx-tarifas', { role: 'radiogroup', 'aria-labelledby': id('tarifa-et'), 'aria-describedby': id('tarifa-ayuda') },
    [...TARIFAS, { id: 'otro', nombre: 'Otro monto', monto: null }].map((t) => h('label',
      h('input', { type: 'radio', name: `tarifa-${modo}`, value: t.id, checked: t.id === TARIFAS[0]?.id }),
      h('span.tx-tarifas__nombre', t.nombre),
      h('span.tx-tarifas__monto.mono', t.monto === null ? 'a mano' : `${t.monto} ${UNIDAD.sigla}`))));
  tarifas.addEventListener('change', () => {
    const v = tarifas.querySelector('input:checked')?.value;
    const t = TARIFAS.find((x) => x.id === v);
    if (t) monto.value = String(t.monto);
    else monto.focus();
    ui.limpiarCampo(monto);
    alCambiar();
  });
  /** Si el monto escrito a mano coincide con una tarifa, la marca; si no, «Otro monto». */
  const reflejarTarifa = () => {
    const t = tarifaPorMonto(monto.value.trim());
    const v = t ? t.id : 'otro';
    const r = tarifas.querySelector(`input[value="${v}"]`);
    if (r && !r.checked) r.checked = true;
    const que = queSeRegistra(monto.value.trim());
    montoAyuda.textContent = que ? `Número entero positivo · ${que}.` : 'Número entero positivo.';
  };

  const enviar = h('button.boton.boton--primario', { type: 'submit' }, icono('firma'), h('span', 'Firmar y registrar'));
  const trampaFirma = h('button.boton.boton--secundario.boton--chico', { type: 'button' }, icono('grieta'), h('span', 'Falsificar la firma'));
  const trampaClave = h('button.boton.boton--secundario.boton--chico', { type: 'button' }, icono('llave'), h('span', 'Firmar con la clave de otra institución'));

  // ---- «qué se firma» ----
  const mensaje = h('code.tx-firma__mensaje', { 'aria-live': 'off' });
  const huella = h('code.tx-firma__huella');
  const firma = h('div.tx-firma__firma');
  const coincide = h('p.tx-firma__coincide', { hidden: true });
  L.firmaUI = { mensaje, huella, firma, coincide };

  const resultado = h('div.tx-resultado', { 'aria-live': 'polite' });
  L.resultado = resultado;

  const form = h('form.panel.panel--instrumento.tx-form', { novalidate: true, 'aria-labelledby': id('titulo') },
    h('div.panel__cabecera', h('h2', { id: id('titulo') }, 'Registrar una credencial')),
    h('div.panel__cuerpo.pila',
      h('div.campo.tx-tarifa',
        h('p.campo__etiqueta', { id: id('tarifa-et') }, 'Qué se registra', h('span.opcional', 'tarifa orientativa')),
        tarifas,
        h('p.campo__ayuda', { id: id('tarifa-ayuda') }, 'Tarifas orientativas: solo son un atajo de esta interfaz para elegir cuántos ',
          ui.termino('credito_certificacion', 'créditos de certificación'), ' pagar. El libro de registros no sabe qué credencial es ni de qué estudiante: guarda únicamente los créditos.')),
      h('div.tx-campos',
        campo(emisor, 'Institución emisora'),
        h('span.tx-campos__flecha', { 'aria-hidden': 'true' }, icono('flecha')),
        campo(receptor, 'Institución que avala'),
        campo(monto, 'Créditos de certificación', montoAyuda),
      ),
      gastable,
      h('figure.tx-firma', { 'aria-labelledby': id('firma-tit') },
        h('figcaption.tx-firma__titulo', { id: id('firma-tit') }, 'Qué se firma, exactamente'),
        h('ol.tx-firma__pasos', { role: 'list' },
          h('li.tx-firma__paso',
            h('span.tx-firma__num', '1'),
            h('div', h('p.tx-firma__et', ui.termino('serializacion_canonica', 'Texto canónico'), ' ', h('small', '(llaves ordenadas, sin espacios: el mismo texto en todas las instituciones)')), mensaje)),
          h('li.tx-firma__paso',
            h('span.tx-firma__num', '2'),
            h('div', h('p.tx-firma__et', ui.termino('hash', 'Huella SHA-256'), ' del texto = id del registro'), huella)),
          h('li.tx-firma__paso',
            h('span.tx-firma__num', '3'),
            h('div', h('p.tx-firma__et', ui.termino('firma', 'Firma Ed25519'), ' con la clave privada de la institución emisora'), firma, coincide)),
        ),
        h('p.tx-firma__nota', 'La firma vale solo para estos bytes. Cambia un carácter (5 → 50) y la comprobación con la ',
          ui.termino('clave_publica', 'clave pública'), ' de la emisora falla: por eso nadie puede alterar un registro ya firmado ni registrar en nombre de otra institución. ',
          h('strong', 'Fíjate: no hay datos de la credencial ni del estudiante'), ', solo qué institución paga, a cuál, cuántos créditos y cuándo.'),
      ),
      h('div.tx-acciones',
        enviar,
        h('div.tx-trampas', h('span.etiqueta-instrumento', 'Intentar una falsificación'), h('div.grupo', trampaFirma, trampaClave))),
      resultado,
    ),
  );

  const alCambiar = () => { L.enviada = null; reflejarTarifa(); vistaPrevia(ctx); pintarGastable(ctx.estado(), ctx); };
  for (const el of [emisor, receptor, monto]) {
    el.addEventListener('input', () => { ui.limpiarCampo(el); alCambiar(); });
    el.addEventListener('change', alCambiar);
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); enviarTx(ctx, null, enviar); });
  trampaFirma.addEventListener('click', () => enviarTx(ctx, 'firma_alterada', trampaFirma));
  trampaClave.addEventListener('click', () => enviarTx(ctx, 'otra_clave', trampaClave));

  Object.assign(L, { form, emisor, receptor, monto, gastable, tarifas });
  col.append(form);
  reflejarTarifa();
}

function sincronizarOpciones(e, ctx) {
  const L = ctx.local;
  const clave = (e.ids || []).join(',');
  if (clave === L.idsClave) return;
  L.idsClave = clave;
  for (const [sel, def] of [[L.emisor, e.ids[0]], [L.receptor, e.ids[1]]]) {
    const previo = sel.value;
    sel.replaceChildren(...e.ids.map((id) => ctx.h('option', { value: id }, `${sigla(id)} — ${nombre(id)}`)));
    sel.value = e.ids.includes(previo) ? previo : def;
  }
  vistaPrevia(ctx);
}

function pintarGastable(e, ctx) {
  const { h, fmt } = ctx;
  const L = ctx.local;
  const n = e?.nodos?.find((x) => x.id === L.emisor.value);
  if (!n) { L.gastable.replaceChildren(); return; }
  const s = n.saldo;
  const m = L.monto.value.trim();
  const excede = RE_ENTERO.test(m) && Number(m) > s.gastable;
  const clave = `${n.id}|${s.gastable}|${s.disponible}|${s.bloqueado}|${s.castigos_pendientes}|${s.pendiente}|${excede}`;
  if (L.gastable.dataset.clave === clave) return;
  L.gastable.dataset.clave = clave;
  const campoMonto = L.monto.closest('.campo');
  if (excede) campoMonto.setAttribute('data-advertencia', ''); else campoMonto.removeAttribute('data-advertencia');
  ctx.dom.reemplazar(L.gastable,       // reemplazar() ignora null (replaceChildren lo pintaría como texto)
    h('p', h('span.etiqueta-instrumento', `${sigla(n.id)} (${n.id}) puede usar`), ' ', h('strong.mono.tx-gastable__cifra', fmt.num(s.gastable)), ' ', h('span.texto-2', s.gastable === 1 ? 'crédito de certificación' : 'créditos de certificación')),
    h('p.texto-3.tx-gastable__desglose',
      `en su copia del libro ${fmt.num(s.disponible)}`,
      s.bloqueado ? ` · apostados ${fmt.num(s.bloqueado)}` : '',
      s.castigos_pendientes ? ` · castigo ${fmt.num(s.castigos_pendientes)}` : '',
      s.pendiente ? ` · ${fmt.num(s.pendiente)} ganados por sellar aún sin madurar` : ''),
    excede ? h('p.tx-gastable__aviso', ctx.icono('alerta'), ` Supera los créditos que ${sigla(n.id)} puede usar: el consorcio rechazará el registro y te explicará por qué. Puedes enviarlo igualmente para verlo.`) : null,
  );
}

// ---------------------------------------------------- vista previa de la firma
function txPrevista(ctx) {
  const L = ctx.local;
  const e = ctx.estado();
  const m = L.monto.value.trim();
  const ts = e?.reloj ? ctx.fmt.tiempoSiguiente(e.reloj) : null;
  return {
    emisor: L.emisor.value || '?',
    receptor: L.receptor.value || '?',
    monto: RE_ENTERO.test(m) && Number(m) > 0 ? Number(m) : null,
    timestamp: ts,
  };
}

async function vistaPrevia(ctx) {
  const L = ctx.local;
  const { h } = ctx;
  if (!L.firmaUI) return;
  const { mensaje, huella, firma, coincide } = L.firmaUI;
  const enviada = L.enviada;                       // si hay una enviada, se muestra la real
  const tx = enviada ? enviada.tx : txPrevista(ctx);
  // mensaje con cada valor como token (destella el que cambió)
  const anteriores = L.tokens || {};
  const tokens = {};
  const partes = ['{'];
  const claves = ['emisor', 'monto', 'receptor', 'timestamp'];
  claves.forEach((k, i) => {
    const valor = tx[k] === null || tx[k] === undefined ? '?' : JSON.stringify(tx[k]);
    const tok = h('span.tx-tok__valor', valor);
    tokens[k] = valor;
    partes.push(h('span.tx-tok__clave', `"${k}"`), ':', tok, i < claves.length - 1 ? ',' : '');
    if (anteriores[k] !== undefined && anteriores[k] !== valor) ctx.anim.destello(tok);
  });
  partes.push('}');
  L.tokens = tokens;
  mensaje.replaceChildren(...partes);

  const valido = tx.monto !== null && tx.emisor !== tx.receptor && tx.timestamp;
  const yo = (L.previa = (L.previa || 0) + 1);
  if (!valido) {
    huella.replaceChildren(h('span.texto-3', 'completa el registro para calcularla'));
  } else {
    const idCalc = await ctx.fmt.sha256(ctx.fmt.canonico(tx));
    if (yo !== L.previa) return;                    // llegó otra edición mientras calculaba
    L.idPrevisto = idCalc;
    huella.replaceChildren(idCalc ? h('span.tx-firma__hex', idCalc) : h('span.texto-3', 'tu navegador no permite calcularla aquí (requiere localhost o https)'));
  }
  if (enviada) {
    firma.replaceChildren(h('p.hex-completo.tx-firma__hex-firma', ctx.fmt.grupos(enviada.firma, 8).map((g) => h('span', g))));
    coincide.hidden = false;
    const igual = L.idPrevisto && L.idPrevisto === enviada.id;
    coincide.dataset.ok = igual ? 'si' : 'no';
    coincide.replaceChildren(ctx.icono(igual ? 'ok' : 'info'),
      igual ? ' El id que calculó tu navegador coincide con el del simulador: se firmaron exactamente estos bytes.'
        : ` El simulador asignó el id ${ctx.fmt.hashCorto(enviada.id, 6)} (el reloj lógico avanzó antes de firmar).`);
  } else {
    coincide.hidden = true;
    firma.replaceChildren(h('p.tx-firma__espera', ctx.icono('llave'), ` Se calcula al enviar, con la clave privada de ${sigla(tx.emisor)}: nunca sale de la institución.`));
  }
}

// ---------------------------------------------------------------- envío
function validarCliente(ctx) {
  const L = ctx.local;
  const max = ctx.limites.monto_max ?? 1e9;
  if (!L.emisor.value) return { campo: 'emisor', mensaje: 'Elige la institución emisora.' };
  if (!L.receptor.value) return { campo: 'receptor', mensaje: 'Elige la institución que avala el registro.' };
  if (L.emisor.value === L.receptor.value) return { campo: 'receptor', mensaje: 'La institución emisora y la que avala deben ser distintas: elige otra institución para avalar.' };
  const m = L.monto.value.trim();
  if (!m) return { campo: 'monto', mensaje: 'Faltan los créditos: escribe un número entero positivo o elige una tarifa.' };
  if (/^-/.test(m)) return { campo: 'monto', mensaje: 'Los créditos no pueden ser negativos: escribe una cantidad mayor que cero.' };
  if (/^[+]?\d*[.,]\d+$|e/i.test(m)) return { campo: 'monto', mensaje: 'Escribe los créditos como número entero, sin decimales ni notación científica.' };
  if (!RE_ENTERO.test(m)) return { campo: 'monto', mensaje: `«${m.slice(0, 20)}» no es un número: escribe solo dígitos.` };
  if (Number(m) === 0) return { campo: 'monto', mensaje: 'Un registro necesita al menos 1 crédito: escribe una cantidad mayor que cero.' };
  if (Number(m) > max) return { campo: 'monto', mensaje: `Son demasiados créditos para un solo registro (máximo ${ctx.fmt.num(max)}).` };
  return null;
}

const EXPLICA_TRAMPA = {
  firma_alterada: (tx) => `Tras firmar, se cambió el primer carácter de la firma. Al comprobarla con la clave pública de ${sigla(tx.emisor)}, ya no corresponde al registro: cualquier institución lo descarta. Así se detecta una credencial con la firma falsificada.`,
  otra_clave: (tx, det) => `Lo firmó ${det?.firmante ? sigla(det.firmante) : 'otra institución'} con SU clave privada, pero dice venir de ${sigla(tx.emisor)}. El consorcio lo comprueba con la clave pública registrada de ${sigla(tx.emisor)} y no coincide: nadie puede registrar credenciales en nombre de otra institución.`,
};

async function enviarTx(ctx, trampa, boton) {
  const { ui, h, icono } = ctx;
  const L = ctx.local;
  ui.limpiarCampos(L.form);
  const err = validarCliente(ctx);
  if (err) { ui.marcarCampo(L.form, err.campo, err.mensaje); return; }
  const cuerpo = { emisor: L.emisor.value, receptor: L.receptor.value, monto: Number(L.monto.value.trim()) };
  if (trampa) cuerpo.trampa = trampa;
  try {
    const r = await ui.ocupado(boton, ctx.api.accion('tx', cuerpo));
    L.enviada = r.tx;
    await vistaPrevia(ctx);
    const tx = r.tx.tx;
    const que = queSeRegistra(tx.monto);
    L.resultado.replaceChildren(h('div.aviso.tx-veredicto', { dataset: { nivel: 'ok' } }, icono('ok'),
      h('div', h('strong', trampa ? 'Inesperado: la falsificación pasó.' : 'Registro aceptado: en espera de sello'), ' ',
        `${sigla(tx.emisor)} → ${sigla(tx.receptor)}: ${creditos(ctx.fmt.num(tx.monto))}${que ? ` (${que})` : ''}. Firma auténtica y créditos suficientes. Hay ${ctx.fmt.plural(r.pendientes_total, 'registro en espera', 'registros en espera')} de que el consorcio los selle en un folio.`)));
    ctx.anim.entrar(L.resultado.firstChild);
  } catch (e) {
    if (e?.name !== 'ErrorApi') { ui.mostrarError(e); return; }
    if (e.campo && ['emisor', 'receptor', 'monto'].includes(e.campo)) ui.marcarCampo(L.form, e.campo, e.message);
    L.enviada = null;
    vistaPrevia(ctx);
    const explica = trampa && EXPLICA_TRAMPA[trampa] ? EXPLICA_TRAMPA[trampa](cuerpo, e.detalle) : null;
    L.resultado.replaceChildren(h('div.aviso.tx-veredicto', { dataset: { nivel: trampa ? 'acento' : 'error' }, role: 'alert' },
      icono(trampa ? 'escudo' : 'x'),
      h('div.pila', { style: { '--pila': 'var(--e-2)' } },
        h('p', h('strong', trampa ? 'Falsificación detectada: el consorcio rechazó el registro' : 'El consorcio no aceptó el registro'), ' ', h('span.mensaje-servidor', ctx.fmt.capital(e.message))),
        explica ? h('p.texto-2', explica) : null,
        e.codigo === 'saldo_insuficiente' && e.detalle ? desgloseSaldo(e.detalle, ctx) : null,
        h('p.texto-3.tx-veredicto__codigo', 'código ', h('code', e.codigo)),
      )));
    ctx.anim.sacudir(L.resultado.firstChild);
  }
}

/** Desglose del rechazo por falta de créditos (detalle del servidor). */
function desgloseSaldo(d, ctx) {
  const { h, fmt } = ctx;
  const partes = [
    ['gastable', d.gastable, 'disponibles ahora'],
    ['comprometido', d.comprometido, 'comprometidos en registros en espera o castigos'],
    ['bloqueado', d.bloqueado, 'apostados'],
    ['pendiente', d.pendiente_recompensa, 'ganados por sellar, sin madurar'],
  ].filter(([, v]) => v > 0);
  const suma = partes.reduce((a, [, v]) => a + v, 0);
  const total = Math.max(d.necesario || 0, suma) || 1;
  const marca = Math.min(100, ((d.necesario || 0) / total) * 100);
  return h('div.desglose.tx-desglose',
    h('div.tx-desglose__pista',
      h('div.desglose__barra', { 'aria-hidden': 'true' }, partes.map(([p, v]) => h('span', { dataset: { parte: p }, style: { '--peso': v / total } })),
        suma < total ? h('span', { style: { '--peso': (total - suma) / total } }) : null),
      h('span.tx-desglose__marca', { style: { '--pos': `${marca}%` }, 'aria-hidden': 'true' }, h('span', `necesita ${fmt.num(d.necesario)}`))),
    h('div.desglose__leyenda', partes.map(([p, v, et]) => h('span', h('i', { dataset: { parte: p } }), et, ' ', h('b', fmt.num(v))))),
    h('p.texto-3', `Créditos en su copia del libro: ${fmt.num(d.disponible)}. Para registrar ${creditos(fmt.num(d.necesario))} necesita tenerlos disponibles ahora mismo: no cuentan los apostados, los comprometidos ni los que aún no maduran. Prueba con menos créditos o con otra institución emisora.`),
  );
}

// ============================================================ pendientes
function construirPendientes(col, ctx) {
  const { h, ui } = ctx;
  const L = ctx.local;
  L.pendCuenta = h('span.mono.tx-pend__cuenta');
  L.pendMedidor = ui.medidor(0, 50, { etiqueta: 'Capacidad de registros en espera' });
  L.pendLista = h('ol.tx-pend__lista', { role: 'list' });
  L.pendVacio = h('p.tx-pend__vacio', 'No hay registros en espera. Registra una credencial o genera varias al azar.');
  col.append(h('section.panel.tx-pend', { 'aria-labelledby': `tx-${ctx.modo}-pend` },
    h('div.panel__cabecera', h('h2', { id: `tx-${ctx.modo}-pend` }, ui.termino('pendiente', 'Registros en espera de sello')), h('span.empuja', L.pendCuenta)),
    h('div.panel__cuerpo.pila', { style: { '--pila': 'var(--e-3)' } },
      L.pendMedidor,
      h('p.campo__ayuda', 'Esperan a que el consorcio los selle en un folio, en orden de llegada. Cada folio sella hasta 8.'),
      L.pendVacio,
      L.pendLista,
    ),
  ));
}

function pintarPendientes(e, ctx) {
  const { h, ui, fmt } = ctx;
  const L = ctx.local;
  const max = e.parametros.max_pendientes;
  const porBloque = e.parametros.max_tx_bloque;
  ctx.dom.texto(L.pendCuenta, `${e.pendientes_total}/${max}`);
  ui.fijarMedidor(L.pendMedidor, e.pendientes_total, max, e.pendientes_total >= max ? 'rechazado' : e.pendientes_total > max * 0.8 ? 'advertencia' : null);
  L.pendVacio.hidden = e.pendientes_total > 0;
  const claves = e.pendientes.map((p) => p.id).join(',');
  if (L.pendLista.dataset.clave === claves) return;
  const previos = new Set((L.pendLista.dataset.clave || '').split(',').filter(Boolean));
  L.pendLista.dataset.clave = claves;
  // reconstrucción simple: la lista cambia solo cuando entra o sale un registro
  const items = e.pendientes.map((p, i) => {
    const que = queSeRegistra(p.tx.monto);
    const li = h('li.tx-pend__item', { dataset: { proximo: i < porBloque ? 'si' : 'no' } },
      h('span.tx-pend__ruta',
        h('strong', { title: rotulo(p.tx.emisor) }, sigla(p.tx.emisor)), ctx.icono('flecha'),
        h('strong', { title: rotulo(p.tx.receptor) }, sigla(p.tx.receptor)),
        que ? h('span.tx-pend__que', que.replace(/^registro de (un|una) /, '')) : null),
      h('span.tx-pend__monto.mono', `${fmt.num(p.tx.monto)} ${UNIDAD.sigla}`),
      h('span.tx-pend__ids',
        h('span', 'id ', ui.hash(p.id, { n: 4, etiqueta: 'Id del registro', plano: true })),
        h('span', 'firma ', ui.hash(p.firma, { n: 4, etiqueta: 'Firma', plano: true }))),
      h('span.tx-pend__t.mono', { title: p.tx.timestamp }, fmt.tiempo(p.tx.timestamp)),
    );
    if (previos.size && !previos.has(p.id)) ctx.anim.entrar(li);
    return li;
  });
  if (items.length > porBloque) {
    items.splice(porBloque, 0, h('li.tx-pend__corte', { 'aria-hidden': 'true' }, h('span', '↑ se sellan en el próximo folio · esperan turno ↓')));
  }
  L.pendLista.replaceChildren(...items);
}

// ================================================================ atajos
function construirAtajos(col, ctx) {
  const { h, ui, icono, modo } = ctx;
  const id = (x) => `tx-${modo}-${x}`;
  const cantidad = h('input.entrada.entrada--mono', { id: id('cantidad'), name: 'cantidad', type: 'text', inputmode: 'numeric', value: '5', autocomplete: 'off' });
  const generar = h('button.boton.boton--secundario', { type: 'submit' }, icono('dado'), h('span', 'Registrar'));
  const formAleatorias = h('form.tx-atajo', { novalidate: true },
    h('div.campo', h('label.campo__etiqueta', { for: cantidad.id }, 'Registrar credenciales al azar (demostración)'),
      h('div.entrada-compuesta', cantidad, generar),
      h('p.campo__ayuda', 'Entre 1 y 20. Instituciones con créditos y montos pequeños, firmados por el simulador en nombre de cada emisora.'),
      h('p.campo__error')));
  formAleatorias.addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.limpiarCampos(formAleatorias);
    const t = cantidad.value.trim();
    if (!RE_ENTERO.test(t) || Number(t) < 1 || Number(t) > 20) { ui.marcarCampo(formAleatorias, 'cantidad', 'Indica cuántas credenciales registrar con un número entero entre 1 y 20.'); return; }
    try {
      const r = await ui.ocupado(generar, ctx.api.accion('tx/aleatorias', { cantidad: Number(t) }));
      ui.toast(`Se firmaron ${ctx.fmt.plural(r.txs.length, 'registro', 'registros')} de credenciales. Ahora hay ${r.pendientes_total} en espera de sello.`, { nivel: 'ok' });
    } catch (err) { ui.mostrarError(err, { form: formAleatorias }); }
  });

  const bloques = h('input.entrada.entrada--mono', { id: id('bloques'), name: 'bloques', type: 'text', inputmode: 'numeric', value: '5', autocomplete: 'off' });
  const producir = h('button.boton.boton--secundario', { type: 'submit' }, icono('play'), h('span', 'Sellar'));
  const formAuto = h('form.tx-atajo', { novalidate: true },
    h('div.campo', h('label.campo__etiqueta', { for: bloques.id }, 'Folios a sellar'),
      h('div.entrada-compuesta', bloques, producir),
      h('p.campo__error')));
  formAuto.addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.limpiarCampos(formAuto);
    const t = bloques.value.trim();
    if (!RE_ENTERO.test(t) || Number(t) < 1 || Number(t) > 20) { ui.marcarCampo(formAuto, 'bloques', 'Indica cuántos folios sellar con un número entero entre 1 y 20.'); return; }
    try {
      const r = await ui.ocupado(producir, ctx.api.accion('autopiloto', { bloques: Number(t) }));
      if (r.asincrono) ui.toast(`Se encadenan ${ctx.fmt.plural(Number(t), 'sellado', 'sellados')} seguidos. Sigue el avance en el anillo y en «Sellado».`, { nivel: 'info', titulo: 'Sellado automático en marcha' });
      else if (r.detenido_por) ui.toast(`Se sellaron ${r.producidos} de ${ctx.fmt.plural(Number(t), 'folio', 'folios')}. Se detuvo: ${r.detenido_por}`, { nivel: 'aviso', titulo: 'Sellado automático detenido' });
      else ui.toast(`Se sellaron ${ctx.fmt.plural(r.producidos, 'folio', 'folios')} con rondas automáticas.`, { nivel: 'ok', titulo: 'Sellado automático' });
    } catch (err) { ui.mostrarError(err, { form: formAuto }); }
  });

  col.append(
    h('section.panel.tx-atajos', { 'aria-labelledby': id('atajos') },
      h('div.panel__cabecera', h('h2', { id: id('atajos') }, 'Atajos de demostración')),
      h('div.panel__cuerpo.pila',
        formAleatorias,
        h('div.tx-autopiloto',
          h('p.tx-autopiloto__titulo', icono('alerta'), h('strong', 'Sellado automático'), h('span.chip.chip--sin-punto', { dataset: { estado: 'advertencia' } }, 'atajo de demostración')),
          h('p.campo__ayuda', modo === 'pow'
            ? 'Encadena sellados completos (y registra credenciales al azar si faltan). Útil para llegar rápido a 10 folios o ver madurar los créditos ganados; para entender el proceso, sella paso a paso en «Sellado».'
            : 'Encadena rondas completas de avales (y registra credenciales al azar si faltan). Útil para acumular folios; para entender el proceso, sigue una ronda paso a paso en «Avales».'),
          formAuto,
        ),
      ),
    ),
  );
}
