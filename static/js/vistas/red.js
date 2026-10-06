// VISTA · Red de instituciones
//  · Sin red: asistente de creación del consorcio (N con vista previa en el anillo y en el catálogo
//    de instituciones, semilla, créditos de certificación y los parámetros del modo, con una frase
//    del dominio para cada uno). Valida en cliente y muestra el error exacto del servidor en su campo.
//  · Con red: parámetros, conservación de los créditos, registro de instituciones (acciones rápidas)
//    y auditoría de invariantes. «Reiniciar» reabre el asistente con la configuración actual.
//  · Siempre: el aviso de honestidad (qué modela el simulador y qué no guarda la cadena).

import { sigla, nombre, tipo, rotulo, idsCatalogo, TARIFAS, UNIDAD, AVISO_HONESTIDAD, nombreModo, MODO_ACADEMICO } from '../dominio.js';

const RE_SEMILLA = /^[A-Za-z0-9_.:-]{1,40}$/;
const RE_ENTERO = /^\d+$/;
const RE_ALFA = /^(0(\.\d{1,3})?|1(\.0{1,3})?|\.\d{1,3})$/;

function semillaAleatoria() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function kPorDefecto(d, n, kMax) { return Math.max(5, Math.min(kMax, Math.ceil(16 ** d / (60 * n)))); }

export default {
  id: 'red',
  titulo: 'Instituciones del consorcio',
  etiqueta: 'Instituciones',
  icono: 'institucion',
  modos: ['pow', 'pos'],
  orden: 10,
  requiereRed: false,
  descripcion: 'Forma el consorcio de instituciones educativas que comparte el libro de registros, consulta la copia que guarda cada una y actúa sobre ellas.',

  montar(host, ctx) {
    const { h, icono } = ctx;
    ctx.local = { reconfigurando: false, filas: new Map(), existia: null };
    ctx.local.asistente = h('div.red-asistente');
    ctx.local.panel = h('div.red-panel');
    host.append(ctx.local.asistente, ctx.local.panel,
      h('aside.red-honestidad', { 'aria-label': 'Acerca de Título Seguro' },
        icono('info'),
        h('p', h('strong', 'Acerca de Título Seguro. '), AVISO_HONESTIDAD)));
    construirAsistente(ctx);
    construirPanel(ctx);
  },

  mostrar(ctx) {
    // al volver a la vista sin red, la vista previa del anillo refleja el N del asistente
    if (!ctx.estado()?.existe || ctx.local.reconfigurando) ctx.red.previsualizar(Number(ctx.local.campos?.n.value) || null);
  },

  actualizar(e, ctx) {
    const existe = !!e?.existe;
    const L = ctx.local;
    if (existe && L.existia === false && !L.reconfigurando) ctx.red.previsualizar(null);
    if (existe !== L.existia || L.forzar) {
      L.forzar = false;
      L.existia = existe;
      const verAsistente = !existe || L.reconfigurando;
      L.asistente.hidden = !verAsistente;
      L.panel.hidden = !existe || L.reconfigurando;
      pintarModoAsistente(ctx, e);
      if (verAsistente && !existe) ctx.red.previsualizar(Number(L.campos.n.value));
    }
    if (existe && !L.reconfigurando) pintarPanel(e, ctx);
  },
};

// ============================================================== asistente
function construirAsistente(ctx) {
  const { h, ui, icono, limites: lim, modo } = ctx;
  const L = ctx.local;
  const nMin = lim.n_min ?? 10;
  const nMax = lim.n_max ?? 20;
  const campos = {};
  const id = (x) => `red-${modo}-${x}`;

  const campo = (nombreCampo, etiquetaCampo, control, { ayuda = null, opcional = false } = {}) => h('div.campo',
    h('label.campo__etiqueta', { for: id(nombreCampo) }, etiquetaCampo, opcional ? h('span.opcional', 'opcional') : null),
    control,
    ayuda ? h('p.campo__ayuda', { id: id(`${nombreCampo}-ayuda`) }, ayuda) : null,
    h('p.campo__error', { 'aria-live': 'polite' }),
  );
  const entrada = (nombreCampo, props = {}) => {
    const el = h('input.entrada', { id: id(nombreCampo), name: nombreCampo, type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': id(`${nombreCampo}-ayuda`), ...props });
    campos[nombreCampo] = el;
    return el;
  };

  // ---- 1. tamaño del consorcio ------------------------------------------------
  const nSalida = h('output.red-n__cifra', { for: id('n'), 'aria-hidden': 'true' }, '12');
  const nRango = h('input.deslizador', { id: id('n'), name: 'n', type: 'range', min: nMin, max: nMax, step: 1, value: 12, 'aria-describedby': id('n-ayuda') });
  campos.n = nRango;
  const nMenos = h('button.boton.boton--secundario.boton--icono', { type: 'button', 'aria-label': 'Una institución menos' }, icono('menos'));
  const nMas = h('button.boton.boton--secundario.boton--icono', { type: 'button', 'aria-label': 'Una institución más' }, icono('mas'));
  const nFrase = h('p.red-n__frase', { id: id('n-ayuda') });
  const catalogo = construirCatalogo(ctx, nMax);
  const fijarN = (v) => {
    const n = Math.max(nMin, Math.min(nMax, v));
    nRango.value = String(n);
    actualizarN();
  };
  nMenos.addEventListener('click', () => fijarN(Number(nRango.value) - 1));
  nMas.addEventListener('click', () => fijarN(Number(nRango.value) + 1));
  nRango.addEventListener('input', () => actualizarN());
  function actualizarN() {
    const n = Number(nRango.value);
    nSalida.textContent = String(n);
    nRango.style.setProperty('--relleno', `${((n - nMin) / (nMax - nMin)) * 100}%`);
    nMenos.disabled = n <= nMin;
    nMas.disabled = n >= nMax;
    nFrase.replaceChildren(
      h('strong', `${n} instituciones`), `: ${n} pares de claves de firma (Ed25519) y ${n} copias independientes del libro de registros. Puedes elegir de ${nMin} a ${nMax}.`);
    ctx.red.previsualizar(n);
    catalogo.fijar(n);
    actualizarEstimacion();
  }

  // ---- 2. identidad -------------------------------------------------------
  const semilla = h('input.entrada.entrada--mono', { id: id('semilla'), name: 'semilla', type: 'text', maxlength: 40, autocomplete: 'off', spellcheck: 'false', placeholder: 'vacía = la elige el simulador', 'aria-describedby': id('semilla-ayuda') });
  campos.semilla = semilla;
  const dado = h('button.boton.boton--secundario', { type: 'button' }, icono('dado'), h('span', 'Aleatoria'));
  dado.addEventListener('click', () => { semilla.value = semillaAleatoria(); ui.limpiarCampo(semilla); semilla.focus(); });

  // ---- 3. economía de créditos -----------------------------------------------
  const saldo = entrada('saldo_inicial', { value: String(lim.saldo_defecto ?? 100) });
  const recompensa = entrada('recompensa', { value: String(lim.recompensa_defecto ?? 50) });
  const alcance = h('p.red-alcance', { 'aria-live': 'polite' });
  const titulo = TARIFAS.find((t) => t.id === 'titulo') || { monto: 10, nombre: 'Título profesional' };
  const constancia = TARIFAS.find((t) => t.id === 'constancia') || { monto: 1 };
  function actualizarAlcance() {
    const t = saldo.value.trim();
    if (!RE_ENTERO.test(t)) { alcance.replaceChildren(); return; }
    const v = Number(t);
    alcance.replaceChildren(icono('diploma'), h('span',
      'Con ', h('strong', ctx.fmt.num(v)), ` ${UNIDAD.plural}, cada institución puede registrar unos `,
      h('strong', ctx.fmt.num(Math.floor(v / titulo.monto))), ' títulos profesionales o ',
      h('strong', ctx.fmt.num(Math.floor(v / constancia.monto))), ' constancias (tarifas orientativas).'));
  }
  saldo.addEventListener('input', actualizarAlcance);

  // ---- 4. parámetros del modo ---------------------------------------------
  const estimacion = h('div.red-estimacion', { 'aria-live': 'polite' });
  let bloqueModo;
  if (modo === 'pow') {
    const dDef = lim.dificultad_defecto ?? 4;
    const seg = h('div.segmentado.red-dificultad', { role: 'radiogroup', 'aria-labelledby': id('dif-et') },
      [lim.dificultad_min ?? 3, 4, lim.dificultad_max ?? 5].filter((v, i, a) => a.indexOf(v) === i).map((d) => h('label',
        h('input', { type: 'radio', name: 'dificultad', value: String(d), checked: d === dDef }),
        h('span.red-dificultad__d', String(d)),
        h('span.red-dificultad__ceros.mono', '0'.repeat(d) + '…'),
      )));
    seg.addEventListener('change', actualizarEstimacion);
    campos.dificultad = seg;
    const k = entrada('k', { placeholder: 'automático' });
    const maxRondas = entrada('max_rondas', { value: '2000' });
    const pausa = entrada('pausa_ms', { value: '40' });
    for (const el of [k, maxRondas, pausa]) el.addEventListener('input', actualizarEstimacion);
    bloqueModo = h('fieldset.red-paso',
      h('legend.red-paso__titulo', h('span.red-paso__num', '04'), 'Sellado por trabajo'),
      h('p.red-paso__explica', 'Para sellar un folio de registros, las ', ui.termino('institucion_selladora', 'instituciones selladoras'), ' compiten buscando una huella (el sello de autenticidad del folio) que empiece con ceros. Más ceros = más trabajo por folio y más difícil reescribir el libro.'),
      h('div.campo',
        h('p.campo__etiqueta', { id: id('dif-et') }, ui.termino('dificultad', 'Dificultad'), h('span.opcional', '— ceros que exige la huella')),
        seg,
        h('p.campo__error', { 'data-campo': 'dificultad' }),
      ),
      estimacion,
      h('details.detalles.red-finos',
        h('summary', 'Ajustes finos del sellado'),
        h('div.red-rejilla',
          campo('k', 'k · nonces por institución y ronda', k, { opcional: true, ayuda: `Vacío = automático (≈ 60 rondas por folio). Máximo ${ctx.fmt.num(lim.k_max ?? 2000)}.` }),
          campo('max_rondas', 'Límite de rondas', maxRondas, { ayuda: `Si ninguna institución acierta antes, el sellado se detiene sin tocar el libro. Máximo ${ctx.fmt.num(lim.max_rondas_max ?? 100000)}.` }),
          campo('pausa_ms', 'Pausa entre rondas (ms)', pausa, { ayuda: `Hace visible la competencia. De 0 a ${lim.pausa_ms_max ?? 500}.` }),
        ),
      ),
    );
  } else {
    const nVal = entrada('n_validadores', { placeholder: 'vacío = todas las que tengan créditos' });
    nVal.addEventListener('input', actualizarEstimacion);
    const regla = h('div.red-reglas', { role: 'radiogroup', 'aria-labelledby': id('regla-et') },
      [['A', 'Pierde toda la apuesta', 'Disuasión máxima y simple: proponer un folio con un registro fraudulento cuesta todo lo apostado.'],
        ['B', 'Pierde en proporción al daño', 'Pierde α × los créditos de los registros del folio, con su apuesta como tope.']]
        .map(([v, t, d]) => h('label.red-regla',
          h('input', { type: 'radio', name: 'regla_castigo', value: v, checked: v === 'A' }),
          h('span.red-regla__letra', v),
          h('span.red-regla__texto', h('strong', t), h('span', d)),
        )));
    campos.regla_castigo = regla;
    const alfa = entrada('alfa', { inputmode: 'decimal', value: String(lim.alfa_defecto ?? 0.5) });
    const campoAlfa = campo('alfa', 'α (alfa)', alfa, { ayuda: 'Entre 0 y 1, con hasta 3 decimales (por ejemplo, 0.5).' });
    regla.addEventListener('change', () => { campoAlfa.hidden = regla.querySelector('input:checked')?.value !== 'B'; actualizarEstimacion(); });
    alfa.addEventListener('input', actualizarEstimacion);
    campoAlfa.hidden = true;
    bloqueModo = h('fieldset.red-paso',
      h('legend.red-paso__titulo', h('span.red-paso__num', '04'), 'Aval por apuesta y castigo'),
      h('p.red-paso__explica', 'Para avalar un folio de registros, las ', ui.termino('institucion_avaladora', 'instituciones avaladoras'), ' apuestan créditos. La que intente colar un registro fraudulento pierde su apuesta.'),
      campo('n_validadores', ['Número de ', ui.termino('validador', 'instituciones avaladoras'), ' por ronda'], nVal, { opcional: true, ayuda: 'Vacío = todas las instituciones con créditos. Si indicas menos, en cada ronda se elige un subconjunto reproducible.' }),
      h('div.campo',
        h('p.campo__etiqueta', { id: id('regla-et') }, 'Regla de ', ui.termino('castigo', 'castigo')),
        regla,
        h('p.campo__error', { 'data-campo': 'regla_castigo' }),
      ),
      campoAlfa,
      estimacion,
    );
  }

  function actualizarEstimacion() {
    const n = Number(nRango.value);
    if (modo === 'pow') {
      const d = Number(campos.dificultad.querySelector('input:checked')?.value || 4);
      const kTxt = campos.k.value.trim();
      const k = RE_ENTERO.test(kTxt) && Number(kTxt) > 0 ? Number(kTxt) : kPorDefecto(d, n, lim.k_max ?? 2000);
      const R = RE_ENTERO.test(campos.max_rondas.value.trim()) ? Number(campos.max_rondas.value) : 2000;
      const pausa = RE_ENTERO.test(campos.pausa_ms.value.trim()) ? Number(campos.pausa_ms.value) : 40;
      const esperado = 16 ** d;
      const rondas = esperado / (n * k);
      const seg = (rondas * (pausa + n * k * 0.0015)) / 1000;
      const prob = 1 - Math.exp(-(n * k * R) / esperado);
      const probTxt = prob > 0.9999 ? '> 99,99 %' : `${(prob * 100).toFixed(prob > 0.99 ? 2 : 1)} %`;
      estimacion.replaceChildren(
        h('div.red-estimacion__dato', h('span.etiqueta-instrumento', 'Intentos esperados'), h('strong.mono', ctx.fmt.num(esperado)), h('small', `1 de cada 16${sup(d)} huellas sirve`)),
        h('div.red-estimacion__dato', h('span.etiqueta-instrumento', 'Por ronda'), h('strong.mono', ctx.fmt.num(n * k)), h('small', `${n} instituciones × k = ${ctx.fmt.num(k)}${kTxt ? '' : ' (auto)'}`)),
        h('div.red-estimacion__dato', h('span.etiqueta-instrumento', 'Duración estimada'), h('strong.mono', `≈ ${Math.max(1, Math.round(rondas))} rondas`), h('small', `≈ ${seg < 1 ? seg.toFixed(1) : Math.round(seg)} s por folio sellado`)),
        h('div.red-estimacion__dato', { dataset: { aviso: prob < 0.95 ? 'si' : null } }, h('span.etiqueta-instrumento', 'Termina antes del límite'), h('strong.mono', probTxt), h('small', `con ${ctx.fmt.num(R)} rondas como máximo`)),
      );
    } else {
      const nvTxt = campos.n_validadores.value.trim();
      const nv = RE_ENTERO.test(nvTxt) ? Math.min(Number(nvTxt), n) : n;
      const reglaB = campos.regla_castigo.querySelector('input:checked')?.value === 'B';
      const alfaTxt = campos.alfa.value.trim().replace(',', '.');
      const alfa = RE_ALFA.test(alfaTxt) && Number(alfaTxt) > 0 ? Number(alfaTxt) : null;
      const ejemplo = reglaB && alfa
        ? `Ej.: apuesta 30, folio con 40 créditos en registros → pierde min(30, ⌈${alfa} × 40⌉) = ${Math.min(30, Math.ceil(alfa * 40))}.`
        : 'Ej.: apuesta 30 → si su folio se rechaza, se le anulan los 30 créditos.';
      estimacion.replaceChildren(
        h('div.red-estimacion__dato', h('span.etiqueta-instrumento', 'Avaladoras por ronda'), h('strong.mono', String(nv)), h('small', nvTxt ? 'subconjunto reproducible' : 'todas las que tengan créditos')),
        h('div.red-estimacion__dato', h('span.etiqueta-instrumento', 'Quórum'), h('strong.mono', '3V ≥ 2A'), h('small', 'dos tercios de lo apostado deben avalar el folio')),
        h('div.red-estimacion__dato.red-estimacion__dato--ancho', h('span.etiqueta-instrumento', 'Castigo'), h('strong', reglaB ? `Regla B · α = ${alfa ?? '?'}` : 'Regla A'), h('small', ejemplo)),
      );
    }
  }

  // ---- envío --------------------------------------------------------------
  const crear = h('button.boton.boton--primario.red-crear', { type: 'submit' }, icono('institucion'), h('span.red-crear__texto', 'Formar el consorcio'));
  const cancelar = h('button.boton.boton--fantasma', { type: 'button', hidden: true }, 'Cancelar');
  cancelar.addEventListener('click', () => {
    L.reconfigurando = false;
    L.forzar = true;
    ctx.red.previsualizar(null);
    repintar(ctx);
  });
  const encabezado = h('div.red-asistente__encabezado',
    h('h2.red-asistente__titulo'),
    h('p.red-asistente__bajada'),
  );

  const form = h('form.red-form', { novalidate: true, 'aria-labelledby': id('titulo') },
    encabezado,
    h('fieldset.red-paso.red-paso--n',
      h('legend.red-paso__titulo', h('span.red-paso__num', '01'), 'Tamaño del consorcio'),
      h('div.red-n',
        nSalida,
        h('div.red-n__control.campo',
          h('label.solo-lectores', { for: id('n') }, 'Número de instituciones'),
          h('p.red-n__etiqueta', { 'aria-hidden': 'true' }, 'Número de instituciones'),
          h('div.red-n__fila', nMenos, nRango, nMas),
          h('div.red-n__escala', { 'aria-hidden': 'true' }, h('span', String(nMin)), h('span', String(nMax))),
          nFrase,
          h('p.campo__error', { 'data-campo': 'n' }),
        ),
      ),
      catalogo.el,
    ),
    h('fieldset.red-paso',
      h('legend.red-paso__titulo', h('span.red-paso__num', '02'), 'Claves de firma'),
      campo('semilla', ui.termino('semilla', 'Semilla'), h('div.entrada-compuesta', semilla, dado), { opcional: true, ayuda: 'De la semilla salen las claves de firma de cada institución y todos los sorteos. Letras, números, «_», «.», «:» o «-» (máx. 40). Misma semilla y mismas acciones ⇒ mismo libro de registros, bit a bit.' }),
    ),
    h('fieldset.red-paso',
      h('legend.red-paso__titulo', h('span.red-paso__num', '03'), 'Créditos de certificación'),
      h('p.red-paso__explica', 'Cada registro de una credencial cuesta ', ui.termino('credito_certificacion', 'créditos de certificación'), ': la institución emisora los paga a la que avala el registro. La institución que sella un folio gana ', ui.termino('recompensa', 'créditos por sellarlo'), '.'),
      h('div.red-rejilla',
        campo('saldo_inicial', 'Créditos iniciales de cada institución', saldo, { ayuda: `Lo que cada institución puede usar en registros al empezar. Número entero de 0 a ${ctx.fmt.num(lim.saldo_max ?? 1000000)}.` }),
        campo('recompensa', 'Créditos ganados por sellar un folio', recompensa, { ayuda: modo === 'pow' ? 'Los gana la institución que sella el folio; maduran tras 6 confirmaciones.' : 'Los gana la institución proponente cuando su folio se avala; se acreditan al instante.' }),
      ),
      alcance,
    ),
    bloqueModo,
    h('div.red-form__pie', cancelar, crear),
  );
  form.querySelector('.red-asistente__titulo').id = id('titulo');
  form.addEventListener('input', (e) => { if (e.target.matches('input')) ui.limpiarCampo(e.target); });
  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(ctx, form, crear); });

  L.campos = campos;
  L.form = form;
  L.crear = crear;
  L.cancelar = cancelar;
  L.alcance = actualizarAlcance;
  L.asistente.append(form);
  actualizarN();
  actualizarAlcance();
}

/** Catálogo de instituciones: las N primeras forman el consorcio; el resto espera a que suba N. */
function construirCatalogo(ctx, nMax) {
  const { h, icono } = ctx;
  const ids = idsCatalogo().slice(0, nMax);
  const resumen = h('p.red-catalogo__resumen', { 'aria-live': 'polite' });
  const items = new Map();
  const lista = h('ol.red-catalogo', { role: 'list', 'aria-label': 'Catálogo de instituciones' }, ids.map((id) => {
    const t = tipo(id);
    const estado = h('span.solo-lectores');
    const li = h('li.red-inst', { dataset: { tipo: t === 'privada' ? 'privada' : 'publica' }, title: `${rotulo(id)} (${id})` },
      h('span.red-inst__cab', h('span.mono', id), h('span.red-inst__tipo', t)),
      h('span.red-inst__sigla', sigla(id)),
      h('span.red-inst__nombre', nombre(id)),
      estado);
    items.set(id, { li, estado });
    return li;
  }));
  let previo = null;
  return {
    el: h('div.red-catalogo-marco',
      h('div.red-catalogo__cabeza',
        h('h3.red-catalogo__titulo', icono('institucion'), 'Instituciones del consorcio'),
        resumen),
      lista,
      h('p.campo__ayuda', 'Instituciones ilustrativas. Cada una es un nodo de la red: su identificador técnico (N01…) se conserva en los datos.')),
    fijar(n) {
      ids.forEach((id, i) => {
        const activa = i < n;
        const it = items.get(id);
        const antes = it.li.dataset.activa;
        it.li.dataset.activa = activa ? 'si' : 'no';
        it.estado.textContent = activa ? ' (participa)' : ' (no participa)';
        if (previo !== null && antes === 'no' && activa) ctx.anim.animar(it.li, [{ opacity: 0.4, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: ctx.anim.DUR.entrada, easing: ctx.anim.CURVA.acuse });
      });
      const pub = ids.slice(0, n).filter((id) => tipo(id) === 'pública').length;
      resumen.textContent = `${n} de ${ids.length} participan · ${pub} públicas y ${n - pub} privadas.${n < ids.length ? ' Las demás se suman al subir el número.' : ''}`;
      previo = n;
    },
  };
}

/** Superíndice para «16^d». */
function sup(d) { return String(d).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]).join(''); }

/** Reaplica la lógica de actualizar() tras cancelar (sin esperar un sondeo). */
function repintar(ctx) {
  const e = ctx.estado();
  const L = ctx.local;
  const existe = !!e?.existe;
  L.existia = existe;
  L.asistente.hidden = existe && !L.reconfigurando;
  L.panel.hidden = !existe || L.reconfigurando;
  pintarModoAsistente(ctx, e);
  if (existe) pintarPanel(e, ctx);
}

function pintarModoAsistente(ctx) {
  const L = ctx.local;
  const lema = MODO_ACADEMICO[ctx.modo]?.lema || '';
  const titulo = L.form.querySelector('.red-asistente__titulo');
  const bajada = L.form.querySelector('.red-asistente__bajada');
  if (L.reconfigurando) {
    titulo.textContent = `Reiniciar el consorcio del ${lema}`;
    bajada.textContent = 'Ajusta la configuración y forma un consorcio nuevo. El libro de registros actual de este modo se descartará; el del otro modo no se toca.';
    L.crear.querySelector('.red-crear__texto').textContent = 'Reiniciar con esta configuración';
    L.cancelar.hidden = false;
  } else {
    titulo.textContent = `Forma un consorcio para el ${lema}`;
    bajada.textContent = ctx.modo === 'pow'
      ? 'Elige cuántas instituciones comparten el libro de registros de credenciales. Cada una competirá por sellar los folios con su propio carril de nonces y guardará su propia copia del libro.'
      : 'Elige cuántas instituciones comparten el libro de registros de credenciales. Cada una podrá apostar créditos, salir sorteada para proponer el siguiente folio y avalar con su voto los de las demás.';
    L.crear.querySelector('.red-crear__texto').textContent = 'Formar el consorcio';
    L.cancelar.hidden = true;
  }
}

/** Rellena el asistente con la configuración de la red actual (para «Reiniciar»). */
function precargar(ctx, e) {
  const c = e.config || {};
  const f = ctx.local.campos;
  f.n.value = String(c.n);
  f.n.dispatchEvent(new Event('input'));
  f.semilla.value = c.semilla || '';
  f.saldo_inicial.value = String(c.saldo_inicial ?? 100);
  f.recompensa.value = String(c.recompensa ?? 50);
  ctx.local.alcance?.();
  if (ctx.modo === 'pow') {
    const r = f.dificultad.querySelector(`input[value="${c.dificultad}"]`);
    if (r) r.checked = true;
    f.k.value = String(c.k ?? '');
    f.max_rondas.value = String(c.max_rondas ?? 2000);
    f.pausa_ms.value = String(c.pausa_ms ?? 40);
    f.k.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    f.n_validadores.value = c.n_validadores ? String(c.n_validadores) : '';
    const r = f.regla_castigo.querySelector(`input[value="${c.regla_castigo || 'A'}"]`);
    if (r) r.checked = true;
    if (c.alfa_pm) f.alfa.value = String(c.alfa_pm / 1000);
    f.regla_castigo.dispatchEvent(new Event('change'));
  }
}

/** Validación en cliente: devuelve { cuerpo } o { campo, mensaje }. Los mensajes imitan al servidor. */
function leerFormulario(ctx) {
  const f = ctx.local.campos;
  const lim = ctx.limites;
  const cuerpo = { n: Number(f.n.value) };
  // `etiqueta` va en minúscula y con artículo («los créditos iniciales»): las frases no dependen del género
  const ent = (campo, etiqueta, min, max, { opcional = false } = {}) => {
    const t = f[campo].value.trim();
    if (!t) { if (opcional) return undefined; throw { campo, mensaje: `Falta un dato: escribe ${etiqueta}.` }; }
    if (!RE_ENTERO.test(t)) throw { campo, mensaje: `Escribe ${etiqueta} como un número entero, sin decimales ni signos.` };
    const v = Number(t);
    if (v < min || v > max) throw { campo, mensaje: `Indica ${etiqueta} entre ${ctx.fmt.num(min)} y ${ctx.fmt.num(max)}.` };
    return v;
  };
  const sem = f.semilla.value.trim();
  if (sem) {
    if (!RE_SEMILLA.test(sem)) throw { campo: 'semilla', mensaje: 'La semilla debe tener de 1 a 40 caracteres: letras, números, «_», «.», «:» o «-».' };
    cuerpo.semilla = sem;
  }
  cuerpo.saldo_inicial = ent('saldo_inicial', 'los créditos iniciales de cada institución', 0, lim.saldo_max ?? 1000000);
  cuerpo.recompensa = ent('recompensa', 'los créditos ganados por sellar', 0, 1000000);
  if (ctx.modo === 'pow') {
    cuerpo.dificultad = Number(f.dificultad.querySelector('input:checked')?.value);
    const k = ent('k', 'el valor de «k»', 1, lim.k_max ?? 2000, { opcional: true });
    if (k !== undefined) cuerpo.k = k;
    cuerpo.max_rondas = ent('max_rondas', 'el límite de rondas', 1, lim.max_rondas_max ?? 100000);
    cuerpo.pausa_ms = ent('pausa_ms', 'la pausa entre rondas', 0, lim.pausa_ms_max ?? 500);
  } else {
    const nv = ent('n_validadores', 'el número de instituciones avaladoras', 1, cuerpo.n, { opcional: true });
    if (nv !== undefined) cuerpo.n_validadores = nv;
    cuerpo.regla_castigo = f.regla_castigo.querySelector('input:checked')?.value || 'A';
    if (cuerpo.regla_castigo === 'B') {
      const a = f.alfa.value.trim().replace(',', '.');
      if (!RE_ALFA.test(a) || !(Number(a) > 0)) throw { campo: 'alfa', mensaje: 'Escribe α como un número mayor que 0 y hasta 1, con un máximo de 3 decimales (por ejemplo, 0.5).' };
      cuerpo.alfa = a;          // como texto: el servidor lo convierte a milésimas exactas
    }
  }
  return cuerpo;
}

async function enviar(ctx, form, boton) {
  const { ui } = ctx;
  const L = ctx.local;
  ui.limpiarCampos(form);
  let cuerpo;
  try {
    cuerpo = leerFormulario(ctx);
  } catch (err) {
    if (err?.campo) { ui.marcarCampo(form, err.campo, err.mensaje); return; }
    throw err;
  }
  const e = ctx.estado();
  if (e?.existe) {
    const t = e.trabajo?.estado === 'minando';
    const r = e.ronda?.activa;
    const ok = await ui.confirmar({
      titulo: `¿Reiniciar el consorcio de ${nombreModo(ctx.modo)}?`,
      texto: 'Se abrirá un libro de registros nuevo desde el folio de apertura (génesis). Esto no se puede deshacer:',
      lista: [
        `Se pierde el libro con ${ctx.fmt.plural(e.altura, 'folio sellado', 'folios sellados')} (en las ${e.nodos.length} copias de las instituciones).`,
        `Se descartan ${ctx.fmt.plural(e.pendientes_total, 'registro en espera', 'registros en espera')} y la bitácora.`,
        t ? 'Se cancela el sellado en curso.' : null,
        r ? 'Se cancela la ronda de avales en curso (sin castigos).' : null,
        `El consorcio de ${nombreModo(ctx.modo === 'pow' ? 'pos' : 'pow')} no se toca.`,
      ].filter(Boolean),
      confirmar: 'Reiniciar el consorcio',
      peligro: true,
    });
    if (!ok) return;
  }
  try {
    await ui.ocupado(boton, ctx.api.crear(cuerpo));
    L.reconfigurando = false;
    L.forzar = true;
    repintar(ctx);
    ctx.seccion.querySelector('.vista__titulo')?.focus({ preventScroll: true });
    ctx.ui.anunciar(`Consorcio de ${nombreModo(ctx.modo)} formado con ${cuerpo.n} instituciones. Su libro de registros está abierto.`);
  } catch (err) {
    ui.mostrarError(err, { form });
  }
}

// ================================================================== panel
function construirPanel(ctx) {
  const { h, icono } = ctx;
  const L = ctx.local;
  L.parametros = h('dl.red-parametros');
  L.conservacion = h('div.red-conservacion');
  L.cuerpoTabla = h('tbody');
  L.auditoria = h('div.red-auditoria');
  const reiniciar = h('button.boton.boton--peligro.boton--chico', { type: 'button' }, icono('reiniciar'), h('span', 'Reiniciar…'));
  reiniciar.addEventListener('click', () => {
    const e = ctx.estado();
    if (!e?.existe) return;
    L.reconfigurando = true;
    L.forzar = true;
    precargar(ctx, e);
    repintar(ctx);
    ctx.red.previsualizar(null);
    L.form.querySelector('.red-asistente__titulo')?.setAttribute('tabindex', '-1');
    L.form.querySelector('.red-asistente__titulo')?.focus();
  });
  const auditar = h('button.boton.boton--secundario.boton--chico', { type: 'button', title: 'Comprueba las reglas que nunca deben romperse (invariantes)' }, icono('escudo'), h('span', 'Auditar el consorcio'));
  auditar.addEventListener('click', () => auditarInvariantes(ctx, auditar));
  const cols = ctx.modo === 'pos'
    ? ['Institución', 'Estado', 'Folios', 'Última huella', 'Créditos', 'Apostados', 'Propuestos', 'Acciones']
    : ['Institución', 'Estado', 'Folios', 'Última huella', 'Créditos', 'Por madurar', 'Sellados', 'Acciones'];

  L.panel.append(
    h('section.panel.panel--instrumento.red-ficha', { 'aria-labelledby': `red-${ctx.modo}-param` },
      h('div.panel__cabecera',
        h('h2.etiqueta-instrumento', { id: `red-${ctx.modo}-param` }, 'Parámetros de este consorcio'),
        h('div.grupo.empuja', auditar, reiniciar)),
      h('div.panel__cuerpo.red-ficha__cuerpo', L.parametros, L.conservacion),
      L.auditoria,
    ),
    h('section.red-registro', { 'aria-labelledby': `red-${ctx.modo}-reg` },
      h('div.red-registro__cabecera',
        h('h2', { id: `red-${ctx.modo}-reg` }, 'Estado de cada institución'),
        h('p.texto-3', 'Cada fila es una institución con su propia copia del libro de registros. El color de su última huella es el de su halo en el anillo: mismo color, mismo libro. «Créditos» son los créditos de certificación que puede usar ahora.')),
      h('div.tabla-marco', h('table.tabla.red-tabla',
        h('caption.solo-lectores', 'Estado de cada institución del consorcio'),
        h('thead', h('tr', cols.map((c, i) => h('th', { scope: 'col', class: i >= 4 && i <= 6 ? 'num' : null }, c)))),
        L.cuerpoTabla)),
    ),
  );
}

function pintarPanel(e, ctx) {
  const { h, ui, fmt, icono } = ctx;
  const L = ctx.local;
  const c = e.config;
  const p = e.parametros;

  // parámetros (solo cambian con una red nueva)
  const claveParam = `${e.epoca}`;
  if (L.parametros.dataset.clave !== claveParam) {
    L.parametros.dataset.clave = claveParam;
    L.filas.clear();
    L.cuerpoTabla.replaceChildren();
    L.auditoria.replaceChildren();
    const dato = (et, v, termino) => h('div.lectura', h('dt.lectura__etiqueta', termino ? ui.termino(termino, et) : et), h('dd.lectura__valor', v));
    const semillaBtn = h('button.hash', { type: 'button', dataset: { copiar: c.semilla }, title: 'Copiar la semilla' }, c.semilla, icono('copiar', { clase: 'hash__icono' }));
    L.parametros.replaceChildren(
      dato('Instituciones', String(c.n), 'consorcio'),
      dato('Semilla', semillaBtn, 'semilla'),
      dato('Créditos iniciales', `${fmt.num(c.saldo_inicial)} ${UNIDAD.sigla}`, 'credito_certificacion'),
      dato('Créditos por sellar', `${fmt.num(p.recompensa)} ${UNIDAD.sigla}`, 'recompensa'),
      ...(ctx.modo === 'pow'
        ? [dato('Dificultad', `${p.dificultad} ceros`, 'dificultad'), dato('k por ronda', fmt.num(c.k)), dato('Límite', `${fmt.num(c.max_rondas)} rondas`), dato('Confirmaciones', String(p.confirmaciones), 'confirmacion')]
        : [dato('Avaladoras', c.n_validadores ? String(c.n_validadores) : 'todas', 'validador'), dato('Quórum', '3V ≥ 2A', 'quorum'),
          dato('Castigo', p.castigo?.regla === 'B' ? `B · α ${(p.castigo.alfa_pm / 1000).toFixed(3)}` : 'A · toda la apuesta', 'castigo')]),
      dato('Edición del libro', String(e.epoca)),
    );
  }

  // ecuación de conservación: el invariante que garantiza que nadie inventa créditos
  const t = e.totales;
  const suma = t.disponible + t.pendiente_recompensas + t.quemado;
  const cuadra = suma === t.emitido;
  const claveCons = `${t.disponible}|${t.pendiente_recompensas}|${t.quemado}|${t.emitido}`;
  if (L.conservacion.dataset.clave !== claveCons) {
    L.conservacion.dataset.clave = claveCons;
    const term = (v, et) => h('span.red-conservacion__termino', h('strong.mono', fmt.num(v)), h('small', et));
    L.conservacion.replaceChildren(
      h('p.etiqueta-instrumento', 'Conservación de los créditos de certificación'),
      h('p.red-conservacion__ecuacion', { dataset: { cuadra: cuadra ? 'si' : 'no' } },
        term(t.disponible, 'disponibles'), h('span.op', '+'),
        term(t.pendiente_recompensas, 'por madurar'), h('span.op', '+'),
        term(t.quemado, 'anulados'), h('span.op', '='),
        term(t.emitido, 'emitidos'),
        h('span.red-conservacion__veredicto', cuadra ? icono('ok') : icono('alerta'), cuadra ? 'cuadra' : 'no cuadra')),
      h('p.campo__ayuda', 'Emitidos = créditos iniciales de todas las instituciones + créditos por sellar × folios sellados. Si alguna institución inventara créditos para registrar credenciales falsas, las cuentas dejarían de cuadrar.'),
    );
  }

  // registro de instituciones: una fila por institución, actualizada celda a celda
  for (const n of e.nodos) {
    let f = L.filas.get(n.id);
    if (!f) { f = crearFila(n, ctx); L.filas.set(n.id, f); L.cuerpoTabla.appendChild(f.tr); }
    actualizarFila(f, n, e, ctx);
  }
}

function crearFila(n, ctx) {
  const { h, ui, icono } = ctx;
  const S = sigla(n.id);
  const t = tipo(n.id);
  const nodo = h('button.red-tabla__nodo', { type: 'button', 'aria-label': `Abrir la ficha de ${rotulo(n.id)}`, title: `${rotulo(n.id)} (${n.id})` },
    h('span.red-tabla__punto', { 'aria-hidden': 'true' }),
    h('span.red-tabla__inst',
      h('span.red-tabla__sigla', S),
      h('span.red-tabla__nombre', nombre(n.id)),
      h('span.red-tabla__tec', `${n.id}${t ? ` · ${t}` : ''}`)));
  nodo.addEventListener('click', () => ctx.abrirNodo(n.id));
  const estado = h('td');
  const altura = h('td.num');
  const cabeza = h('td', ui.hash(n.hash_cabeza, { n: 4, ceros: ctx.modo === 'pow', etiqueta: `Última huella del libro de ${S}`, plano: true }));
  const gastable = h('td.num');
  const extra = h('td.num');
  const propuestos = h('td.num');
  const conectar = h('button.boton.boton--fantasma.boton--chico.boton--icono', { type: 'button' });
  const sinc = h('button.boton.boton--fantasma.boton--chico.boton--icono', { type: 'button', 'aria-label': `Sincronizar ${S}`, title: 'Sincronizar' }, icono('sync'));
  conectar.addEventListener('click', () => {
    const actual = ctx.store.nodo(ctx.modo, n.id);
    ui.ocupado(conectar, ctx.api.accion(`nodos/${n.id}/conexion`, { conectado: !actual?.conectado })).catch((err) => ui.mostrarError(err, { titulo: `${S}: no se pudo cambiar la conexión` }));
  });
  sinc.addEventListener('click', () => {
    ui.ocupado(sinc, ctx.api.accion(`nodos/${n.id}/sincronizar`))
      .then((r) => ui.toast(r?.resultado?.motivo || `${S} tiene su libro al día.`, { nivel: r?.resultado?.aceptada ? 'ok' : 'info', titulo: `${S} consultó a las demás instituciones` }))
      .catch((err) => ui.mostrarError(err, { titulo: `${S} no pudo sincronizarse` }));
  });
  const tr = h('tr', { dataset: { nodo: n.id } },
    h('th', { scope: 'row' }, nodo), estado, altura, cabeza, gastable, extra, propuestos,
    h('td', h('div.red-tabla__acciones', conectar, sinc)));
  return { tr, nodo, estado, altura, cabeza: cabeza.firstChild, gastable, extra, propuestos, conectar, sinc, clave: '' };
}

function actualizarFila(f, n, e, ctx) {
  const { ui, fmt, icono } = ctx;
  const S = sigla(n.id);
  const etiqueta = !n.conectado ? ['Desconectada', 'obsoleto'] : !n.cadena_integra ? ['Copia alterada', 'rechazado']
    : n.sincronizado ? ['En sincronía', 'valido'] : ['Atrasada', 'advertencia'];
  const clave = `${etiqueta[0]}|${n.deshonesto}|${n.conectado}`;
  if (f.clave !== clave) {
    f.clave = clave;
    f.estado.replaceChildren(ui.chip(etiqueta[0], etiqueta[1]), n.deshonesto ? ui.chip('deshonesta', 'rechazado') : '');
    f.conectar.replaceChildren(icono(n.conectado ? 'desconectado' : 'conectado'));
    f.conectar.setAttribute('aria-label', n.conectado ? `Desconectar ${S}` : `Conectar ${S}`);
    f.conectar.title = n.conectado ? 'Desconectar del consorcio' : 'Conectar al consorcio';
    f.sinc.disabled = !n.conectado;
    f.tr.dataset.estado = etiqueta[1];
  }
  if (f.altura.textContent !== String(n.altura)) f.altura.textContent = String(n.altura);
  ui.actualizarHash(f.cabeza, n.hash_cabeza);
  f.tr.style.setProperty('--tono', String(fmt.tonoHash(n.hash_cabeza)));
  const g = fmt.num(n.saldo.gastable);
  if (f.gastable.textContent !== g) f.gastable.textContent = g;
  const x = ctx.modo === 'pos' ? fmt.num(n.saldo.bloqueado) : fmt.num(n.saldo.pendiente);
  if (f.extra.textContent !== x) f.extra.textContent = x;
  const pr = String(n.bloques_propuestos);
  if (f.propuestos.textContent !== pr) f.propuestos.textContent = pr;
}

async function auditarInvariantes(ctx, boton) {
  const { h, ui, icono } = ctx;
  const NOMBRES = {
    referencia: 'Hay un libro de referencia válido',
    conservacion: 'Conservación: nadie crea ni destruye créditos de certificación (salvo los anulados por castigo)',
    sin_saldos_negativos: 'Ninguna institución tiene créditos negativos',
    apuestas_cubiertas: 'Toda apuesta está respaldada por créditos',
    pendientes_validas: 'Los registros en espera tienen firma auténtica y no se repiten',
    cadenas_integras: 'Todas las instituciones conectadas tienen su copia del libro íntegra',
  };
  try {
    const r = await ui.ocupado(boton, ctx.api.get('invariantes'));
    ctx.local.auditoria.replaceChildren(h('div.red-auditoria__cuerpo',
      h('p.red-auditoria__veredicto', { dataset: { ok: r.consistente ? 'si' : 'no' } }, icono(r.consistente ? 'escudo' : 'alerta'),
        r.consistente ? 'Todas las comprobaciones pasan: el consorcio está en orden.' : 'Hay comprobaciones que fallan: revisa las marcadas abajo.'),
      h('ul.red-auditoria__lista', { role: 'list' }, r.comprobaciones.map((c) => h('li', { dataset: { ok: c.ok ? 'si' : 'no' } },
        icono(c.ok ? 'ok' : 'x'), h('span', NOMBRES[c.nombre] || c.nombre), h('code', c.detalle)))),
    ));
    ctx.anim.entrar(ctx.local.auditoria.firstChild);
  } catch (err) {
    ui.mostrarError(err);
  }
}
