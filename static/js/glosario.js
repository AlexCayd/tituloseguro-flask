// Glosario con popovers. Cualquier elemento con [data-term="clave"] abre la definición.
// Marcado recomendado (botón = enfocable y accesible por teclado):
//   <button type="button" class="termino" data-term="nonce">nonce</button>
// o desde JS:  ui.termino('nonce')  /  ui.termino('nonce', 'el nonce')
// Para añadir términos desde una vista:  registrarTermino('ruleta', { titulo, texto, ejemplo?, ver? })
//
// Tono: cada definición empieza por la idea académica (folio, libro de registros, institución
// selladora/avaladora…) y conserva el término técnico en el título o en `alias`. Las CLAVES no
// cambian aunque cambie el nombre visible (otros módulos las usan: ui.termino('bloque'), etc.).

import { h, icono, reemplazar } from './util/dom.js';

export const TERMINOS = {
  hash: {
    titulo: 'Huella (hash)', alias: 'SHA-256',
    texto: 'El sello de autenticidad de un folio: 64 caracteres que se calculan a partir de su contenido. Si alguien altera un solo dato de un título ya registrado, la huella cambia por completo, así que cualquier institución nota la alteración.',
    ejemplo: 'Cada folio guarda su propia huella y la del folio anterior: si alguien retoca un registro antiguo, su huella deja de cuadrar con la que guarda el folio siguiente.',
    ver: ['folio', 'libro_registros', 'nonce'],
  },
  nonce: {
    titulo: 'Nonce', alias: 'número de prueba',
    texto: 'El número que una institución selladora va probando hasta lograr una huella con los ceros exigidos. No significa nada por sí mismo: es el «boleto» de cada intento en el sellado por trabajo (Proof of Work).',
    ejemplo: 'Aquí la institución i solo prueba i, i+N, i+2N…: así dos instituciones nunca repiten el mismo número.',
    ver: ['dificultad', 'hash', 'sellado'],
  },
  dificultad: {
    titulo: 'Dificultad',
    texto: 'Cuántos ceros debe tener al inicio la huella de un folio para darlo por sellado. Cada cero extra multiplica por 16 el trabajo esperado.',
    ejemplo: 'Dificultad 3 ≈ 4 096 intentos de media; 4 ≈ 65 536; 5 ≈ 1 048 576.',
    ver: ['nonce', 'sellado'],
  },
  firma: {
    titulo: 'Firma institucional (firma digital)', alias: 'Ed25519',
    texto: 'La prueba matemática de que una institución, con su clave privada, aprobó exactamente este registro. Cualquiera puede comprobarla con su clave pública; nadie puede fabricarla sin la privada.',
    ejemplo: 'Si alguien cambia los créditos después de firmar, la comprobación falla: la firma valía solo para el registro original.',
    ver: ['clave_publica', 'transaccion', 'falsificacion'],
  },
  clave_publica: {
    titulo: 'Clave pública',
    texto: 'La mitad «visible» del par de claves de una institución: sirve para comprobar sus firmas. La clave privada, la que firma, nunca sale de la institución.',
    ejemplo: 'Todas las claves públicas quedan anotadas en el folio de apertura (génesis): así todo el consorcio sabe qué firma corresponde a cada institución.',
    ver: ['firma', 'genesis', 'nodo'],
  },
  transaccion: {
    titulo: 'Registro de credencial', alias: 'transacción',
    texto: 'La anotación firmada de que una institución emisora paga N créditos de certificación a la institución que avala el registro de una credencial. Solo se firman emisora, receptora, créditos y hora; el consorcio comprueba la firma y que haya créditos disponibles.',
    ejemplo: 'Los datos de la credencial (estudiante, programa, calificaciones) NO viajan en el registro ni se guardan en el libro.',
    ver: ['firma', 'pendiente', 'credito_certificacion', 'doble_gasto'],
  },
  pendiente: {
    titulo: 'Registro en espera de sello', alias: 'pendiente',
    texto: 'Ya se revisó (firma y créditos), pero todavía no está sellado en ningún folio. Cada folio sella hasta 8 registros, en orden de llegada.',
    ver: ['transaccion', 'folio', 'sellado'],
  },
  folio: {
    titulo: 'Folio', alias: 'bloque',
    texto: 'Una hoja sellada del libro de registros: agrupa registros de credenciales con su número, la huella del folio anterior, la institución que la selló o propuso, los créditos que ganó y su propia huella. En la jerga técnica se llama «bloque».',
    ejemplo: 'Cada folio sella hasta 8 registros en espera, en orden de llegada.',
    ver: ['libro_registros', 'hash', 'genesis', 'registro_inmutable'],
  },
  bloque: {
    titulo: 'Bloque (folio)',
    texto: 'El nombre técnico de cada folio sellado del libro de registros: un paquete de registros de credenciales con su número, la huella del folio anterior, la institución que lo selló o propuso, sus créditos ganados y su propia huella.',
    ver: ['folio', 'cadena', 'hash', 'genesis'],
  },
  cadena: {
    titulo: 'Libro de registros (cadena de bloques)', alias: 'blockchain',
    texto: 'Folios enlazados: cada uno guarda la huella del anterior. Por eso, alterar un registro ya sellado rompe todos los enlaces que vienen después.',
    ejemplo: 'Cada institución del consorcio guarda SU PROPIA copia del libro y la revisa entera al recibir una versión nueva.',
    ver: ['folio', 'cadena_mas_larga', 'sincronizacion', 'registro_inmutable'],
  },
  libro_registros: {
    titulo: 'Libro de registros', alias: 'cadena de bloques',
    texto: 'El libro compartido donde el consorcio anota, folio a folio, cada registro de credencial. No tiene dueño: cada institución guarda su propia copia completa y la revisa entera antes de aceptar una versión nueva.',
    ejemplo: 'Si alguien altera un registro ya sellado, su folio deja de cuadrar con los siguientes y las copias de las demás instituciones lo delatan.',
    ver: ['folio', 'copia_local', 'cadena_mas_larga', 'cadena'],
  },
  genesis: {
    titulo: 'Folio de apertura (bloque génesis)',
    texto: 'El folio 0: fija las reglas del consorcio (claves públicas de cada institución, créditos iniciales, dificultad o umbral de aval). Un libro con otro folio de apertura pertenece a otro consorcio y se rechaza.',
    ver: ['libro_registros', 'clave_publica', 'consorcio'],
  },
  confirmacion: {
    titulo: 'Confirmación',
    texto: 'Cada folio que se sella encima de otro es una confirmación para él. Cuantas más tiene, más difícil es revertirlo.',
    ejemplo: 'En el sellado por trabajo, los créditos ganados en el folio h se pueden usar cuando el libro llega al folio h+6 (6 confirmaciones).',
    ver: ['recompensa', 'folio'],
  },
  recompensa: {
    titulo: 'Créditos ganados por sellar', alias: 'recompensa',
    texto: 'Los créditos de certificación que gana la institución que sella (o propone) un folio aceptado. En el sellado por trabajo esperan hasta tener 6 confirmaciones; en el aval por apuesta se acreditan en cuanto se avala el folio.',
    ver: ['confirmacion', 'credito_certificacion', 'proof_of_work', 'proof_of_stake'],
  },
  saldo: {
    titulo: 'Créditos disponibles', alias: 'saldo',
    texto: 'Los créditos de certificación que una institución puede usar ahora mismo: lo que le queda para registrar credenciales. No cuentan los apostados, los comprometidos en registros en espera ni los ganados que aún no maduran.',
    ver: ['credito_certificacion', 'stake', 'recompensa'],
  },
  stake: {
    titulo: 'Apuesta (stake)',
    texto: 'Créditos de certificación que una institución avaladora deja bloqueados para participar en la ronda. Pesan en el sorteo de la proponente y en la votación, y son lo que pierde si avala un registro fraudulento.',
    ver: ['institucion_avaladora', 'castigo', 'aval'],
  },
  validador: {
    titulo: 'Institución avaladora (validadora)',
    texto: 'Una institución que apuesta créditos para revisar y votar el folio propuesto. Su voto pesa tanto como su apuesta.',
    ver: ['stake', 'quorum', 'proponente', 'aval'],
  },
  institucion_avaladora: {
    titulo: 'Institución avaladora', alias: 'validadora',
    texto: 'En el aval por apuesta, cada institución que bloquea parte de sus créditos para revisar el folio propuesto y votarlo. Su voto pesa tanto como su apuesta; si avala un registro fraudulento, pierde créditos.',
    ver: ['aval', 'stake', 'quorum', 'proponente'],
  },
  institucion_selladora: {
    titulo: 'Institución selladora', alias: 'minera',
    texto: 'En el sellado por trabajo, cada institución que compite por cerrar el siguiente folio probando nonces. La primera que logra una huella con los ceros exigidos lo sella y gana créditos de certificación.',
    ver: ['sellado', 'nonce', 'recompensa'],
  },
  proponente: {
    titulo: 'Institución proponente',
    texto: 'La institución avaladora elegida en el sorteo para armar y firmar el folio de la ronda. Su probabilidad de salir elegida es proporcional a su apuesta.',
    ver: ['institucion_avaladora', 'stake'],
  },
  quorum: {
    titulo: 'Quórum 2/3',
    texto: 'Dos tercios de lo apostado deben avalar el folio para aceptarlo: 3·V ≥ 2·A (V = créditos que votan a favor, A = total apostado), con enteros para no redondear.',
    ejemplo: 'Con A = 30 apostado, 20 a favor bastan (60 ≥ 60); 19 no (57 < 60).',
    ver: ['institucion_avaladora', 'aval', 'castigo'],
  },
  castigo: {
    titulo: 'Castigo (slashing)',
    texto: 'La institución que propone o avala un registro fraudulento pierde créditos: si su folio se rechaza, se le anula parte o toda su apuesta y queda fuera de la ronda; luego se sortea otra proponente.',
    ejemplo: 'Regla A: pierde toda la apuesta. Regla B: pierde α × los créditos de los registros del folio, con la apuesta como tope.',
    ver: ['stake', 'quorum', 'falsificacion'],
  },
  doble_gasto: {
    titulo: 'Registrar dos veces los mismos créditos', alias: 'doble gasto',
    texto: 'Usar los mismos créditos de certificación para dos registros que juntos superan lo que la institución tiene, o repetir un registro ya hecho. La revisión de cada institución lo detecta.',
    ver: ['transaccion', 'falsificacion', 'libro_registros'],
  },
  sincronizacion: {
    titulo: 'Sincronía',
    alias: 'sincronización',
    texto: 'Que todas las instituciones tengan el mismo libro. Una institución que se quedó atrás (por estar desconectada o con su copia alterada) pide el libro más completo a las demás, lo revisa entero y lo adopta si es válido.',
    ver: ['cadena_mas_larga', 'copia_local', 'libro_registros'],
  },
  cadena_mas_larga: {
    titulo: 'Prevalece el libro más completo', alias: 'regla de la cadena más larga',
    texto: 'Prevalece el libro más completo y verificable: una institución solo cambia su copia por otra si la recibida se puede comprobar de punta a punta y tiene estrictamente más folios. Si mide lo mismo o menos, conserva la suya.',
    ver: ['sincronizacion', 'libro_registros'],
  },
  proof_of_work: {
    titulo: 'Sellado por trabajo', alias: 'Proof of Work',
    texto: 'Forma de ponerse de acuerdo en la que las instituciones selladoras compiten probando nonces hasta hallar una huella con los ceros exigidos. La primera que lo logra sella el folio de registros y gana créditos de certificación.',
    ver: ['institucion_selladora', 'nonce', 'dificultad', 'recompensa'],
  },
  proof_of_stake: {
    titulo: 'Aval por apuesta', alias: 'Proof of Stake',
    texto: 'Forma de ponerse de acuerdo en la que las instituciones avaladoras apuestan créditos de certificación: un sorteo ponderado elige a la proponente del folio y las demás votan. Avalar un registro fraudulento cuesta la apuesta.',
    ver: ['institucion_avaladora', 'stake', 'quorum', 'castigo'],
  },
  sellado: {
    titulo: 'Sellado', alias: 'minería',
    texto: 'Cerrar un folio con los registros en espera para que entre en el libro. En el sellado por trabajo se logra probando nonces hasta dar con una huella válida; en el aval por apuesta, con el voto de dos tercios de lo apostado.',
    ver: ['proof_of_work', 'folio', 'nonce', 'institucion_selladora'],
  },
  aval: {
    titulo: 'Aval', alias: 'voto con apuesta',
    texto: 'El voto con el que una institución avaladora da por bueno un folio propuesto, respaldado por los créditos que apostó. Si avala un registro fraudulento, arriesga esos créditos.',
    ver: ['proof_of_stake', 'quorum', 'stake', 'castigo'],
  },
  reloj_logico: {
    titulo: 'Reloj lógico',
    texto: 'El simulador no usa la hora real: avanza un segundo por cada evento aceptado. Así, la misma semilla y las mismas acciones producen exactamente la misma historia.',
    ver: ['semilla'],
  },
  semilla: {
    titulo: 'Semilla',
    texto: 'Un texto del que se derivan las claves de firma de cada institución y todos los sorteos. Misma semilla y mismas acciones ⇒ mismo libro de registros, bit a bit.',
    ver: ['reloj_logico', 'clave_publica'],
  },

  // ------------------------------------------------- dominio académico
  nodo: {
    titulo: 'Institución (nodo)',
    texto: 'En Título Seguro, cada nodo de la red es una institución educativa (N01 = UAN, N02 = UNAM, N03 = IPN…). Tiene su par de claves de firma, sus créditos de certificación y su propia copia completa del libro de registros.',
    ejemplo: 'El identificador técnico (N03) se mantiene en los datos; la interfaz te muestra la institución (IPN).',
    ver: ['consorcio', 'clave_publica', 'copia_local'],
  },
  consorcio: {
    titulo: 'Consorcio',
    texto: 'El grupo de instituciones (de 10 a 20) que comparte el libro de registros. Ninguna manda sobre las demás: cada una revisa por su cuenta y el consenso decide qué folios entran.',
    ejemplo: 'Las instituciones del simulador son ilustrativas: no representan a las reales ni a sus sistemas.',
    ver: ['nodo', 'proof_of_work', 'proof_of_stake'],
  },
  credencial: {
    titulo: 'Credencial académica',
    texto: 'Un documento que acredita estudios: título profesional, diploma, certificado de estudios o constancia. En el libro se anota su registro pagando créditos de certificación; el documento y los datos del estudiante no se guardan en el libro.',
    ver: ['institucion_emisora', 'credito_certificacion', 'registro_inmutable'],
  },
  institucion_emisora: {
    titulo: 'Institución emisora',
    texto: 'La institución que registra una credencial: firma el registro con su clave privada y paga los créditos de certificación. La institución que avala el registro es la que los recibe.',
    ejemplo: 'UNAM registra un título por 10 créditos y lo avala IPN: UNAM es la emisora; IPN, la que avala.',
    ver: ['transaccion', 'firma', 'credencial'],
  },
  credito_certificacion: {
    titulo: 'Crédito de certificación', alias: 'CC',
    texto: 'La unidad de Título Seguro: lo que una institución emisora paga para que otra avale el registro de una credencial. Sus créditos disponibles son lo que le queda para registrar.',
    ejemplo: 'Tarifas orientativas de la interfaz: título profesional 10, diploma 6, certificado de estudios 4, constancia 1. El libro solo guarda la cantidad.',
    ver: ['saldo', 'recompensa', 'transaccion'],
  },
  registro_inmutable: {
    titulo: 'Registro inmutable',
    texto: 'Una vez sellado en un folio y confirmado, un registro no se puede alterar sin que se note: su huella dejaría de cuadrar y todos los folios posteriores quedarían desenlazados en las copias de las demás instituciones.',
    ver: ['hash', 'enlace', 'falsificacion'],
  },
  falsificacion: {
    titulo: 'Falsificación de credenciales', alias: 'ataque',
    texto: 'Intentar que el consorcio acepte un registro que no es legítimo: alterar un registro ya sellado, registrar dos veces los mismos créditos, firmar con la clave de otra institución o avalar créditos que no existen. Cada institución lo detecta al revisar.',
    ver: ['firma', 'doble_gasto', 'registro_inmutable', 'castigo'],
  },
  ataque_cadena: {
    titulo: 'Falsificación del libro', alias: 'ataque a la cadena',
    texto: 'Intentar que una institución adopte una copia del libro que viola alguna regla: un título retocado, una firma ajena, créditos usados dos veces… Cada institución revisa entera la copia que recibe y la rechaza si algo falla.',
    ver: ['falsificacion', 'registro_inmutable', 'cadena_mas_larga'],
  },
  copia_local: {
    titulo: 'Copia de cada institución', alias: 'copia local',
    texto: 'Cada institución guarda su propia copia completa del libro de registros y la revisa entera. No hay un original central: prevalece la versión más completa y verificable.',
    ver: ['libro_registros', 'sincronizacion', 'cadena_mas_larga'],
  },
  enlace: {
    titulo: 'Enlace entre folios', alias: 'hash anterior',
    texto: 'Cada folio guarda la huella del folio anterior, como un eslabón. Si alguien altera un folio, su huella cambia y el eslabón con el siguiente se rompe.',
    ver: ['hash', 'folio', 'registro_inmutable'],
  },
  serializacion_canonica: {
    titulo: 'Texto canónico', alias: 'serialización canónica',
    texto: 'La forma única de escribir un registro o un folio antes de calcular su huella o de firmarlo: llaves ordenadas y sin espacios. Así todas las instituciones obtienen exactamente los mismos bytes y la misma huella.',
    ver: ['hash', 'firma'],
  },
  huella_recalculada: {
    titulo: 'Huella recalculada',
    texto: 'El recurso de quien falsifica: tras alterar un folio, vuelve a calcular su huella para que «cuadre». No basta: el folio siguiente guarda la huella original como enlace, y las firmas (y el trabajo o el aval) eran del contenido original.',
    ver: ['hash', 'enlace', 'falsificacion'],
  },
};


export function registrarTermino(clave, def) { TERMINOS[clave] = def; }

// ------------------------------------------------------------------ popover
let pop = null;
let disparadorActual = null;
const conPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

function pintar(clave) {
  const t = TERMINOS[clave];
  if (!t) return false;
  const titulo = h('h3', { id: 'glosario-titulo', tabindex: '-1' }, t.titulo, t.alias ? h('small', t.alias) : null);
  reemplazar(pop,
    h('button.boton.boton--fantasma.boton--chico.boton--icono.glosario-pop__cerrar', { type: 'button', 'aria-label': 'Cerrar definición', on: { click: cerrar } }, icono('x')),
    titulo,
    h('p', t.texto),
    t.ejemplo ? h('p.glosario-pop__ejemplo', t.ejemplo) : null,
    t.ver?.length ? h('div.glosario-pop__ver', 'Relacionado:',
      t.ver.filter((v) => TERMINOS[v]).map((v) => h('button', { type: 'button', on: { click: () => { pintar(v); pop.querySelector('h3')?.focus?.(); } } }, TERMINOS[v].titulo))) : null,
  );
  pop.setAttribute('aria-labelledby', 'glosario-titulo');
  return true;
}

function posicionar(ancla) {
  const r = ancla.getBoundingClientRect();
  const ancho = pop.offsetWidth || 320;
  const alto = pop.offsetHeight || 160;
  const margen = 12;
  let x = Math.min(Math.max(margen, r.left + r.width / 2 - ancho / 2), window.innerWidth - ancho - margen);
  let y = r.bottom + 8;
  if (y + alto > window.innerHeight - margen) y = Math.max(margen, r.top - alto - 8);   // voltear arriba
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
}

export function abrir(clave, ancla, { enfocar = false } = {}) {
  if (!pop || !pintar(clave)) return;
  if (disparadorActual && disparadorActual !== ancla) disparadorActual.setAttribute('aria-expanded', 'false');
  disparadorActual = ancla;
  ancla?.setAttribute('aria-expanded', 'true');
  if (conPopover) {
    if (!pop.matches(':popover-open')) pop.showPopover();
  } else {
    pop.hidden = false;
  }
  if (ancla) posicionar(ancla);
  // con teclado el foco entra al popover (si no, Tab no llegaría: vive al final del documento)
  if (enfocar) pop.querySelector('h3')?.focus({ preventScroll: true });
}

let cerradoEn = 0;
let ultimoCerrado = null;

export function cerrar() {
  if (!pop) return;
  if (conPopover) { if (pop.matches(':popover-open')) pop.hidePopover(); } else pop.hidden = true;
}

/** Engancha la delegación global. `elemento` es el contenedor del popover (#glosario-pop). */
export function iniciarGlosario(elemento) {
  pop = elemento;
  if (!pop) return;
  // con popover nativo, el UA lo oculta mientras está cerrado: hay que quitar [hidden]
  // (el reset lo fuerza con !important y ganaría incluso abierto)
  if (conPopover) { pop.setAttribute('popover', 'auto'); pop.hidden = false; } else pop.hidden = true;
  pop.setAttribute('role', 'dialog');

  pop.addEventListener('toggle', (e) => {
    if (e.newState === 'closed' && disparadorActual) {
      disparadorActual.setAttribute('aria-expanded', 'false');
      cerradoEn = performance.now();
      ultimoCerrado = disparadorActual;
      // devolver el foco solo si estaba dentro del popover
      if (pop.contains(document.activeElement) || document.activeElement === document.body) disparadorActual.focus({ preventScroll: true });
      disparadorActual = null;
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-term]') : null;
    if (t) {
      e.preventDefault();
      // el cierre ligero del popover ocurre en pointerdown: un clic en el mismo disparador
      // justo después debe CERRAR (alternar), no reabrir
      if (ultimoCerrado === t && performance.now() - cerradoEn < 350) { ultimoCerrado = null; return; }
      const abierto = conPopover ? pop.matches(':popover-open') : !pop.hidden;
      if (abierto && disparadorActual === t) cerrar();
      else abrir(t.dataset.term, t, { enfocar: e.detail === 0 });
      return;
    }
    if (!conPopover && !pop.hidden && !pop.contains(e.target)) cerrar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !conPopover && !pop.hidden) { cerrar(); disparadorActual?.focus(); }
  });
  window.addEventListener('resize', () => cerrar());
}
