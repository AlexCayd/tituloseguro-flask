// PIEZAS COMPARTIDAS · arena, escenario, explorador de cadena y laboratorio de falsificación.
// (Los archivos que empiezan con «_» no son vistas: no se registran en registro.js.)
//
//  · Dominio «Título Seguro»: cada nodo es una INSTITUCIÓN educativa y lo que se mueve son
//    créditos de certificación (CC). `marcaInst` pinta sigla + id con el nombre completo a mano.
//  · Catálogo de códigos de problema → explicación sencilla (en clave de credenciales) y regla
//    de la guía (a/b/c/d). Los CÓDIGOS no cambian: solo su explicación.
//  · Catálogo de los 13 ataques (falsificaciones): nombre, historia, grupo, código esperado.
//  · Serialización canónica idéntica a `json.dumps(datos, sort_keys=True)` de Python
//    (separadores «, » y «: », ensure_ascii) y SHA-256 en el navegador (WebCrypto).
//  · Piezas visuales: eslabón (enlace hash_anterior → hash), huella con diferencias marcadas,
//    chip de regla y lista de problemas.
//  · Registro (una sola vez, al importar) de términos del glosario y frases del narrador.

import { registrarFrase } from '../narrador.js';
import { registrarTermino, TERMINOS } from '../glosario.js';
import { h, s, icono } from '../util/dom.js';
import { sha256, hashCorto, cerosIniciales, num } from '../util/fmt.js';
import {
  institucion, sigla, nombre, etiqueta as etiquetaDom, creditos, creditosBreve,
  conInstituciones as conInstitucionesDom, UNIDAD,
} from '../dominio.js';

export { institucion, sigla, nombre, creditos, creditosBreve, UNIDAD };

// ============================================================== instituciones
const NB = ' ';
/** «N03 · IPN» con espacios de no separación: en texto corrido nunca se parte entre dos líneas. */
export const etiqueta = (id) => etiquetaDom(id).replace(/ · /g, `${NB}·${NB}`);
/** Texto del servidor con «N03» → «N03 · IPN» (también sin cortes de línea dentro de la etiqueta). */
export const conInstituciones = (texto) => conInstitucionesDom(String(texto ?? '').replace(/ · /g, ' · '))
  .replace(/\b(N\d{2}) · /g, `$1${NB}·${NB}`);   // idempotente: se puede aplicar dos veces sin duplicar

/** «N03 · IPN (Instituto Politécnico Nacional)»: para aria-label, title y textos largos. */
export function etiquetaLarga(id) {
  const i = institucion(id);
  return i.nombre && i.nombre !== id ? `${etiqueta(id)} (${i.nombre})` : String(id);
}

/** «IPN» si existe la institución; si no, el id tal cual (p. ej. «genesis»). */
export const siglaDe = (id) => sigla(id) || String(id);

/**
 * Marca visual de una institución: la SIGLA es la voz principal y el id técnico la acompaña en
 * pequeño. El nombre completo va en `title` (puntero) y, para lectores, en el texto accesible.
 * `tag` permite usarla como botón; en ese caso pásale `props.on` y un `aria-label` propio si quieres.
 */
export function marcaInst(id, { tag = 'span', clase = '', props = {}, conNombre = false } = {}) {
  const i = institucion(id);
  const tiene = i.sigla && i.sigla !== id;
  const sel = `${tag}.blq-inst${clase ? `.${clase.split(' ').join('.')}` : ''}`;
  return h(sel, { title: tiene ? `${id} · ${i.nombre}` : null, dataset: { id }, ...props },
    h('span.blq-inst__sigla', tiene ? i.sigla : String(id)),
    tiene ? h('span.blq-inst__id', id) : null,
    conNombre && tiene ? h('span.blq-inst__nombre', i.nombre) : null);
}

/** Créditos en espacio corto: «50 CC». */
export const cc = (n) => `${num(n)} ${UNIDAD.sigla || 'CC'}`;

// =================================================================== reglas
/** Las cuatro reglas con las que una institución decide si adopta una copia del libro recibida. */
export const REGLAS = {
  a: { titulo: 'Huellas y enlaces', corto: 'integridad',
    texto: 'Cada huella guardada coincide con el SHA-256 de su contenido y cada «hash anterior» con la huella del folio previo, desde el mismo génesis. La huella es el sello de autenticidad: si alguien retoca un registro ya sellado, deja de coincidir.' },
  b: { titulo: 'Firmas y créditos', corto: 'cuentas',
    texto: 'Cada registro de credencial está firmado por la institución emisora, no se repite y nadie paga con más créditos de certificación de los que tiene según su propio libro.' },
  c: { titulo: 'Consenso', corto: 'mecanismo',
    texto: 'PoW: la huella queda bajo el objetivo (empieza con d ceros). PoS: la institución proponente sale del sorteo y los votos suman ≥ 2/3 de los créditos apostados. Y los créditos ganados por sellar son los que fija el protocolo.' },
  d: { titulo: 'Prevalece el libro más completo', corto: 'longitud',
    texto: 'Aunque sea válida, una institución solo cambia su copia por la recibida si esta es estrictamente más larga: prevalece el libro más completo y verificable.' },
};

const REGLA_CODIGO = {
  genesis_invalido: 'a', genesis_distinto: 'a', numero: 'a', estructura: 'a', hash: 'a', enlace: 'a', estructura_ilegible: 'a',
  sin_tx: 'b', exceso_tx: 'b', tx_estructura: 'b', tx_monto: 'b', tx_mismo_nodo: 'b', tx_nodo_inexistente: 'b',
  tx_firma: 'b', tx_otra_clave: 'b', tx_duplicada: 'b', tx_saldo: 'b',
  recompensa_falsa: 'c', pow_objetivo: 'c', pow_particion: 'c', pow_campos_pos: 'c', pos_nonce: 'c', pos_apuestas: 'c',
  pos_sorteo: 'c', pos_voto_no_validador: 'c', pos_voto_duplicado: 'c', pos_voto_peso: 'c', pos_voto_firma: 'c',
  pos_proponente_sin_voto: 'c', pos_quorum: 'c', pos_castigo: 'c', pos_campos_pow: 'c',
  no_mas_larga: 'd',
};

export function reglaDe(codigo) {
  if (!codigo) return null;
  if (REGLA_CODIGO[codigo]) return REGLA_CODIGO[codigo];
  if (codigo.startsWith('tx_')) return 'b';
  if (codigo.startsWith('pow_') || codigo.startsWith('pos_')) return 'c';
  return null;
}

/** Código de problema (o del veredicto de la institución) → explicación sencilla, en clave de credenciales. */
export const CODIGOS = {
  genesis_invalido: 'El folio 0 (génesis) no tiene la forma o el contenido que exige el protocolo: todos los registros que cuelgan de él quedan sin base.',
  genesis_distinto: 'Empieza con OTRO folio génesis: es el libro de otra red (otras instituciones, otras claves, otros créditos). Se descarta sin mirar más allá.',
  numero: 'Los folios no van numerados en orden: falta o sobra alguno en el libro de registros.',
  estructura: 'Al folio le faltan campos o tienen un tipo incorrecto: ni siquiera se puede revisar.',
  hash: 'Se recalculó la huella (el sello de autenticidad, SHA-256 del contenido) y no coincide con la guardada: alguien retocó el folio después de sellarlo, como quien altera un título ya registrado.',
  enlace: 'Su «hash anterior» no es la huella del folio previo: el libro de registros está cortado justo aquí.',
  sin_tx: 'Un folio debe llevar al menos un registro de credencial.',
  exceso_tx: 'Trae más registros de credencial de los que caben en un folio.',
  tx_estructura: 'Un registro de credencial está mal formado (faltan campos o tienen tipos incorrectos).',
  tx_monto: 'Un registro paga una cantidad imposible de créditos de certificación (cero, negativa o desmesurada).',
  tx_mismo_nodo: 'Una institución se paga créditos a sí misma: nadie puede avalar sus propias credenciales.',
  tx_nodo_inexistente: 'Un registro menciona una institución que no figura en el génesis: no pertenece a la red.',
  tx_firma: 'La firma del registro no corresponde a sus datos: se alteró el registro después de firmarlo o se retocó la firma.',
  tx_otra_clave: 'La firma es auténtica, pero de OTRA institución: nadie puede registrar credenciales en nombre de otra sin su clave privada.',
  tx_duplicada: 'Ese mismo registro firmado ya estaba en el libro: repetirlo sería registrar dos veces los mismos créditos (el llamado doble gasto).',
  tx_saldo: 'La institución emisora paga más créditos de certificación de los que tiene según su propio libro (contando los demás registros del folio).',
  recompensa_falsa: 'Quien sella el folio se asigna créditos ganados por sellar distintos de los que fija el protocolo: serían créditos de certificación creados de la nada.',
  pow_objetivo: 'Su huella no empieza con los ceros exigidos: no hay trabajo demostrado detrás de este folio.',
  pow_particion: 'El nonce no pertenece al carril de la institución que dice haberlo encontrado.',
  pow_campos_pos: 'Un folio de Proof of Work trae votos, apuestas o castigos, que no le corresponden.',
  pos_nonce: 'En Proof of Stake no se sella: el nonce debe ser 0.',
  pos_apuestas: 'Las apuestas registradas son imposibles (instituciones que no existen o más créditos de los que tenían).',
  pos_sorteo: 'La institución proponente no es la que arroja el sorteo reproducible: alguien se coló.',
  pos_voto_no_validador: 'Votó una institución que no era avaladora en esa ronda.',
  pos_voto_duplicado: 'Una misma institución avaladora aparece votando dos veces.',
  pos_voto_peso: 'Un voto dice pesar distinto de los créditos que apostó su institución.',
  pos_voto_firma: 'La firma de un voto no corresponde a este folio: las instituciones avaladoras avalaron otro contenido.',
  pos_proponente_sin_voto: 'La institución proponente no firmó su propio folio.',
  pos_quorum: 'Los votos a favor no llegan a 2/3 de los créditos apostados: el folio no fue avalado.',
  pos_castigo: 'El registro de castigos no se puede verificar.',
  pos_campos_pow: 'Un folio de Proof of Stake trae campos de sellado.',
  estructura_ilegible: 'Lo recibido ni siquiera es una lista de folios legible.',
  // veredictos de la institución que recibe la copia
  no_mas_larga: 'La copia es válida, pero no es más larga que la propia: la institución conserva la suya (prevalece el libro más completo y verificable).',
  cadena_invalida: 'La copia no pasó la validación: basta un solo registro falso para rechazarla entera.',
  aceptada: 'Válida y más larga que la propia: la institución la adopta.',
  desconectado: 'La institución está desconectada: no recibe nada.',
  sin_pares: 'No hay instituciones conectadas con una copia válida a quien pedírsela.',
};

export function explicar(codigo) {
  if (CODIGOS[codigo]) return CODIGOS[codigo];
  if (codigo?.startsWith('pos_voto')) return 'Uno de los votos de las instituciones avaladoras no es válido.';
  return 'Problema de validación.';
}

// =================================================================== ataques
/** Nombre corto de cada falsificación (tablas, botones, narrador). Los ids de tipo no cambian. */
export const NOMBRE_ATAQUE = {
  cadena_corta: 'Copia más corta',
  igual_longitud: 'Copia de igual longitud',
  genesis_distinto: 'Génesis de otra red',
  hash_alterado: 'Huella alterada',
  hash_anterior_alterado: 'Eslabón alterado',
  bloque_intermedio: 'Registro sellado alterado',
  bloque_intermedio_recalculado: 'Alterado y vuelto a sellar',
  firma_alterada: 'Firma alterada',
  firma_otra_clave: 'Firma de otra institución',
  saldo_insuficiente: 'Créditos insuficientes',
  doble_gasto_mismo_bloque: 'Mismos créditos dos veces (un folio)',
  doble_gasto_bloques: 'Mismos créditos dos veces (dos folios)',
  recompensa_falsa: 'Créditos de sellado inflados',
};

/** La historia de cada falsificación, contada con credenciales (el detalle técnico lo da el servidor). */
export const HISTORIA_ATAQUE = {
  cadena_corta: 'Una institución ofrece su copia del libro de registros: es auténtica, pero le faltan los folios más recientes.',
  igual_longitud: 'Llega una copia válida del mismo largo, con otros registros al final. No aporta nada: la víctima no tiene motivo para cambiar la suya.',
  genesis_distinto: 'Un libro que arranca con otro génesis: otra red, otras instituciones y créditos de certificación inventados desde el principio.',
  hash_alterado: 'Alguien sobrescribe la huella guardada de un folio de registros, como quien cambia el folio de un título ya expedido.',
  hash_anterior_alterado: 'Se descuelga un folio de su predecesor: se cambia su eslabón («hash anterior») para colgarlo de otro sitio.',
  bloque_intermedio: 'Se retocan los créditos de un registro de credencial que ya estaba sellado, sin recalcular nada.',
  bloque_intermedio_recalculado: 'El falsificador «astuto»: altera un registro sellado y vuelve a calcular la huella para que cuadre.',
  firma_alterada: 'Un registro de credencial llega con la firma de la institución emisora retocada.',
  firma_otra_clave: 'Una institución registra credenciales en nombre de otra, firmando con su propia clave.',
  saldo_insuficiente: 'Una institución registra una credencial pagando más créditos de certificación de los que tiene.',
  doble_gasto_mismo_bloque: 'La misma institución usa dos veces sus créditos dentro del mismo folio: dos registros con un solo pago.',
  doble_gasto_bloques: 'El mismo registro firmado se vuelve a presentar en el folio siguiente, para cobrar dos veces el mismo aval.',
  recompensa_falsa: 'La institución que sella el folio se paga más créditos de los que fija el protocolo: créditos sacados de la nada.',
};

/**
 * Lo que se envía de verdad, con precisión técnica y el vocabulario del dominio (el servidor
 * describe lo mismo en `limites.ataques`; si apareciera un tipo nuevo, se usa su texto).
 */
export const TECNICA_ATAQUE = {
  cadena_corta: 'Se envía una copia válida del libro pero más corta: prevalece el libro más completo, así que se descarta.',
  igual_longitud: 'Se envía una copia válida del libro de la misma longitud: no es «más larga», así que se conserva la propia.',
  genesis_distinto: 'Se envía un libro con otro folio génesis (otra red, con créditos iniciales inventados).',
  hash_alterado: 'Se cambia el campo «hash» de un folio: ya no coincide con el SHA-256 recalculado.',
  hash_anterior_alterado: 'Se cambia el «hash_anterior» de un folio (y se recalcula su huella): el enlace con el folio previo se rompe.',
  bloque_intermedio: 'Se cambian los créditos de un registro en un folio intermedio sin recalcular nada: su huella y su firma lo delatan.',
  bloque_intermedio_recalculado: 'Lo mismo, recalculando la huella: se rompe el enlace del folio siguiente, la firma y el consenso.',
  firma_alterada: 'Se agrega un folio con un registro de credencial cuya firma fue alterada.',
  firma_otra_clave: 'Se agrega un folio con un registro firmado con la clave de OTRA institución.',
  saldo_insuficiente: 'Se agrega un folio con un registro que paga más créditos de los que tiene la institución emisora.',
  doble_gasto_mismo_bloque: 'Se agrega un folio donde los mismos créditos se gastan dos veces dentro del folio.',
  doble_gasto_bloques: 'Se agregan dos folios donde el mismo registro firmado se repite (los mismos créditos registrados dos veces).',
  recompensa_falsa: 'Se agrega un folio cuya institución selladora se asigna más créditos de los que fija el protocolo.',
};

/** Grupos del catálogo, con la regla que cada grupo pone a prueba. */
export const GRUPOS_ATAQUE = [
  { id: 'cadenas', titulo: 'Copias enteras del libro', regla: 'd', bajada: 'Copias que no ganan por longitud o que vienen de otra red.',
    tipos: ['cadena_corta', 'igual_longitud', 'genesis_distinto'] },
  { id: 'integridad', titulo: 'Registros ya sellados', regla: 'a', bajada: 'Alterar una credencial ya registrada: la huella y los eslabones lo delatan.',
    tipos: ['hash_alterado', 'hash_anterior_alterado', 'bloque_intermedio', 'bloque_intermedio_recalculado'] },
  { id: 'transacciones', titulo: 'Registros de credencial', regla: 'b', bajada: 'Firmas falsas, pagar con créditos que no se tienen o usar dos veces los mismos.',
    tipos: ['firma_alterada', 'firma_otra_clave', 'saldo_insuficiente', 'doble_gasto_mismo_bloque', 'doble_gasto_bloques'] },
  { id: 'consenso', titulo: 'Consenso', regla: 'c', bajada: 'Saltarse lo que fija el protocolo: los créditos ganados por sellar, el trabajo o los votos.',
    tipos: ['recompensa_falsa'] },
];

/** Código que debería saltar (el servidor lo confirma en `esperado`; depende del bloque elegido). */
export const ESPERADO_TIPO = {
  cadena_corta: 'no_mas_larga', igual_longitud: 'no_mas_larga', genesis_distinto: 'genesis_distinto',
  hash_alterado: 'hash', hash_anterior_alterado: 'enlace', bloque_intermedio: 'hash', bloque_intermedio_recalculado: 'enlace',
  firma_alterada: 'tx_firma', firma_otra_clave: 'tx_otra_clave', saldo_insuficiente: 'tx_saldo',
  doble_gasto_mismo_bloque: 'tx_saldo', doble_gasto_bloques: 'tx_duplicada', recompensa_falsa: 'recompensa_falsa',
};

/** Tipos que aceptan elegir el bloque objetivo. */
export const TIPOS_CON_BLOQUE = new Set(['hash_alterado', 'hash_anterior_alterado', 'bloque_intermedio', 'bloque_intermedio_recalculado']);
/** Tipos que necesitan al menos un bloque minado (409 «sin_bloques» si la cadena está vacía). */
export const TIPOS_REQUIEREN_BLOQUES = new Set(['hash_anterior_alterado', 'bloque_intermedio', 'bloque_intermedio_recalculado']);

// ============================================== serialización canónica + huella
const pyTexto = (t) => JSON.stringify(t).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * Igual que `json.dumps(v, sort_keys=True)` de Python: separadores «, » y «: », llaves en orden,
 * todo lo que no es ASCII imprimible como \uXXXX. (Enteros hasta 2^53: los del simulador caben.)
 */
export function pyJson(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return pyTexto(v);
  if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`;
  const claves = Object.keys(v).sort();
  return `{${claves.map((k) => `${pyTexto(k)}: ${pyJson(v[k])}`).join(', ')}}`;
}

/** Todos los campos menos «hash», en el orden en que entran al cálculo. */
export function camposDelHash(b) { return Object.keys(b).filter((k) => k !== 'hash').sort(); }

/** Texto exacto que el servidor pasa a SHA-256 (hash_bloque). */
export function serializarBloque(b) {
  const datos = {};
  for (const k of Object.keys(b)) if (k !== 'hash') datos[k] = b[k];
  return pyJson(datos);
}

/** SHA-256 del bloque calculado en el navegador (null si no hay WebCrypto: contexto no seguro). */
export async function huellaBloque(b) { return sha256(serializarBloque(b)); }

export const bytesDe = (texto) => new TextEncoder().encode(texto).length;

// =================================================================== piezas
/** Huella corta con los ceros iniciales resaltados (sin botón: para dentro de tarjetas). */
export function hashCompacto(hex, { n = 6, ceros = false } = {}) {
  const corto = hashCorto(hex, n);
  const z = ceros ? Math.min(cerosIniciales(hex), n) : 0;
  const i = corto.indexOf('…');
  return h('span.blq-hash',
    z ? h('span.blq-hash__ceros', corto.slice(0, z)) : null,
    i >= 0 ? [corto.slice(z, i), h('span.blq-hash__elipsis', '…'), corto.slice(i + 1)] : corto.slice(z));
}

/**
 * Huella completa en grupos de 8; si se pasa `contra`, marca los caracteres que difieren.
 * Devuelve { el, distintos }.
 */
export function hexConDiff(hex, { contra = null, ceros = false, etiqueta = null } = {}) {
  let distintos = 0;
  const z = ceros ? cerosIniciales(hex) : 0;
  const grupos = [];
  for (let g = 0; g < String(hex || '').length; g += 8) {
    const trozo = [];
    for (let i = g; i < Math.min(g + 8, hex.length); i += 1) {
      const c = hex[i];
      const dif = contra && contra[i] !== c;
      if (dif) distintos += 1;
      trozo.push(dif ? h('span.blq-dif', c) : i < z ? h('span.blq-hash__ceros', c) : c);
    }
    grupos.push(h('span.blq-hex__grupo', trozo));
  }
  const el = h('span.blq-hex', { 'aria-label': etiqueta ? `${etiqueta}: ${hex}` : null, role: etiqueta ? 'img' : null }, grupos);
  return { el, distintos };
}

/**
 * Eslabón entre dos bloques: dos anillas entrelazadas. `roto` las separa (transición CSS, así
 * romperse y repararse se animan solos al cambiar el atributo).
 */
export function eslabon({ roto = false, cola = '' } = {}) {
  const svg = s('svg.blq-eslabon__svg', { viewBox: '0 0 48 24', 'aria-hidden': 'true' },
    s('rect.blq-eslabon__a', { x: 3, y: 7, width: 24, height: 10, rx: 5 }),
    s('rect.blq-eslabon__b', { x: 21, y: 7, width: 24, height: 10, rx: 5 }),
    s('path.blq-eslabon__chispa', { d: 'M24 3 l1.5 4 M28 4 l-0.5 3.5 M20 4.5 l1.8 2.6' }),
  );
  return h('span.blq-eslabon', { dataset: { roto: roto ? 'si' : 'no' } }, svg, cola ? h('span.blq-eslabon__cola.mono', cola) : null);
}

/** Chip de regla (a/b/c/d). estado: cumple | viola | sin-evaluar | esperada | neutro */
export function chipRegla(letra, estado = 'neutro', { conTitulo = false } = {}) {
  const r = REGLAS[letra];
  const marca = estado === 'cumple' ? 'ok' : estado === 'viola' ? 'x' : null;
  const txt = estado === 'cumple' ? 'cumple' : estado === 'viola' ? 'no cumple' : estado === 'sin-evaluar' ? 'sin evaluar' : '';
  return h('span.blq-regla', { dataset: { estado }, title: r ? `Regla (${letra}) · ${r.titulo}: ${r.texto}` : null },
    h('span.blq-regla__letra', { 'aria-hidden': 'true' }, letra),
    h('span.solo-lectores', `Regla ${letra}${r ? `, ${r.titulo}` : ''}${txt ? `: ${txt}` : ''}.`),
    conTitulo && r ? h('span.blq-regla__titulo', { 'aria-hidden': 'true' }, r.titulo) : null,
    marca ? icono(marca, { clase: 'blq-regla__marca' }) : null,
  );
}

/**
 * Estado de cada regla a partir de los códigos detectados.
 * La validación (a, b, c) va primero: si falla, la (d) ni se evalúa. Si el génesis falla,
 * la validación se detiene ahí y (b) y (c) quedan sin evaluar.
 */
export function estadoReglas(codigos = [], { codigoNodo = null } = {}) {
  const vistos = new Set(codigos);
  const violadas = new Set([...vistos].map(reglaDe).filter(Boolean));
  const genesis = vistos.has('genesis_distinto') || vistos.has('genesis_invalido') || vistos.has('estructura_ilegible');
  const invalida = codigoNodo ? codigoNodo === 'cadena_invalida' || codigoNodo === 'genesis_distinto' : violadas.has('a') || violadas.has('b') || violadas.has('c');
  const r = {};
  for (const l of ['a', 'b', 'c']) r[l] = violadas.has(l) ? 'viola' : genesis && l !== 'a' ? 'sin-evaluar' : 'cumple';
  r.d = invalida ? 'sin-evaluar' : vistos.has('no_mas_larga') || codigoNodo === 'no_mas_larga' ? 'viola' : 'cumple';
  return r;
}

/**
 * Lista de problemas de validación con su explicación sencilla. `alElegir(numero)` convierte
 * cada problema en un botón que lleva al bloque.
 */
export function listaProblemas(problemas, { alElegir = null, max = 40 } = {}) {
  return h('ol.blq-problemas', { role: 'list' }, problemas.slice(0, max).map((p) => {
    const letra = reglaDe(p.codigo);
    const cuerpo = [
      h('span.blq-problemas__bloque.mono', p.bloque >= 0 ? `#${p.bloque}` : '—'),
      h('span.blq-problemas__texto',
        h('span.blq-problemas__codigo', letra ? chipRegla(letra, 'viola') : null, h('code', p.codigo)),
        h('span.blq-problemas__sencillo', explicar(p.codigo)),
        h('span.blq-problemas__servidor.mensaje-servidor', conInstituciones(p.mensaje))),
    ];
    if (alElegir && p.bloque >= 0) {
      return h('li', h('button.blq-problemas__item', { type: 'button', dataset: { bloque: p.bloque }, on: { click: () => alElegir(p.bloque) },
        'aria-label': `Ir al folio ${p.bloque}: ${explicar(p.codigo)}` }, cuerpo, icono('flecha', { clase: 'blq-problemas__ir' })));
    }
    return h('li', h('div.blq-problemas__item', cuerpo));
  }));
}

/** Describe la alteración {campo, antes, despues, huella_recalculada} en una frase. */
export function fraseAlteracion(d) {
  if (!d) return '';
  const campo = String(d.campo || '');
  const recalc = d.huella_recalculada ? ' y se volvió a calcular su huella para disimular' : '';
  if (campo === 'hash') return `se sobrescribió la huella guardada del folio #${d.bloque}`;
  if (campo.startsWith('firma')) return `se falsificó la primera firma (la de la institución emisora) del folio #${d.bloque}`;
  if (campo.startsWith('genesis.saldos')) {
    const id = campo.split('.').pop();
    return `se le inventaron créditos de certificación a ${etiqueta(id)} en el génesis (${d.antes} → ${d.despues} CC)${recalc}`;
  }
  if (campo.includes('monto')) return `se cambiaron los créditos del primer registro de credencial del folio #${d.bloque} (${d.antes} → ${d.despues} CC)${recalc}`;
  return `se cambió «${campo}» del folio #${d.bloque}${recalc}`;
}

// =========================================================== glosario y narrador
const NUEVOS_TERMINOS = {
  regla_cadena_mas_larga: {
    titulo: 'Prevalece el libro más completo (regla de la cadena más larga)',
    texto: 'Una institución solo cambia su copia del libro de registros por otra si la recibida es VÁLIDA y estrictamente más larga. Igual de larga o más corta: conserva la suya, aunque la otra sea impecable.',
    ejemplo: 'Por eso un falsificador no puede «reescribir» el historial de títulos enviando una copia del mismo tamaño: tendría que sellar más folios válidos que todas las demás instituciones juntas.',
    ver: ['cadena_mas_larga', 'sincronizacion'],
  },
  huella_recalculada: {
    titulo: 'Huella recalculada',
    texto: 'El falsificador altera un registro ya sellado y vuelve a calcular el SHA-256 del folio para que «cuadre». No basta: el folio siguiente guarda la huella VIEJA como «hash anterior», así que el eslabón se rompe; y las firmas, el trabajo (PoW) o los votos (PoS) eran del contenido original.',
    ejemplo: 'Es como reimprimir un título con otra calificación y otro folio: el folio del título siguiente sigue apuntando al original. Para disimularlo habría que rehacer todos los folios posteriores más rápido que toda la red.',
    ver: ['hash', 'enlace', 'firma'],
  },
  enlace: {
    titulo: 'Enlace (eslabón)', alias: 'hash_anterior',
    texto: 'Cada folio guarda la huella del folio anterior en su campo «hash_anterior». Ese dato es el eslabón: si alguien altera un registro del folio anterior, su huella cambia y el eslabón deja de encajar.',
    ver: ['hash', 'cadena', 'huella_recalculada'],
  },
  serializacion_canonica: {
    titulo: 'Serialización canónica',
    texto: 'Convertir el folio en un texto ÚNICO antes de calcular su huella: mismas llaves, en orden alfabético, con los mismos separadores. Así todas las instituciones obtienen exactamente los mismos bytes y la misma huella.',
    ejemplo: 'Aquí es json.dumps(bloque_sin_hash, sort_keys=True) de Python; tu navegador lo reproduce y calcula el SHA-256 por su cuenta.',
    ver: ['hash', 'bloque'],
  },
  copia_local: {
    titulo: 'Copia local del libro de registros',
    texto: 'Cada institución guarda SU PROPIA copia del libro de registros y la valida por su cuenta. Si alguien altera la copia de una institución, esa institución queda fuera del consenso; las demás copias siguen intactas y sirven para repararla.',
    ver: ['cadena', 'sincronizacion'],
  },
  ataque_cadena: {
    titulo: 'Falsificación (ataque al libro de registros)',
    texto: 'Enviar a una institución una copia del libro fabricada para que la adopte: con un registro alterado, una firma falsa, créditos usados dos veces… La institución la valida entera con las reglas (a), (b), (c) y (d) y, si falla cualquiera, la rechaza y conserva la suya.',
    ver: ['regla_cadena_mas_larga', 'huella_recalculada', 'doble_gasto'],
  },
};
for (const [clave, def] of Object.entries(NUEVOS_TERMINOS)) if (!TERMINOS[clave]) registrarTermino(clave, def);

const MOTIVO_NODO = {
  no_mas_larga: 'no era más larga que la suya (regla d: solo adopta copias más largas)',
  cadena_invalida: 'no pasó la validación (reglas a, b o c)',
  genesis_distinto: 'pertenece a otra red: su génesis es distinto (regla a)',
  desconectado: 'está desconectada',
};
const tras = (texto) => { const t = String(texto || ''); const i = t.indexOf(': '); return i >= 0 ? t.slice(i + 2) : t; };
const sinPunto = (t) => String(t || '').replace(/[.\s]+$/, '');

registrarFrase('ataque', (e) => {
  const nom = NOMBRE_ATAQUE[e.datos?.tipo] || e.datos?.tipo || 'copia manipulada';
  const quien = etiqueta(e.nodo);
  if (e.datos?.aceptada) {
    return { titulo: `¡La falsificación «${nom}» pasó!`, texto: `${quien} adoptó una copia del libro manipulada: ${sinPunto(conInstituciones(tras(e.texto)))}. Esto no debería ocurrir nunca.`, nivel: 'error' };
  }
  return { titulo: `Falsificación detectada: ${nom.toLowerCase()}`,
    texto: `${quien} recibió una copia fabricada del libro de registros, la validó entera y la rechazó: «${sinPunto(conInstituciones(tras(e.texto)))}». Su copia no cambió.`, nivel: 'ok' };
});

registrarFrase('corrupcion_local', (e) => {
  const d = e.datos || {};
  const quien = etiqueta(e.nodo);
  const por = String(d.campo || '') === 'hash' || d.huella_recalculada
    ? 'el «hash anterior» del folio siguiente ya no encaja con la huella nueva'
    : 'la huella guardada ya no coincide con el contenido';
  return { titulo: `Alguien alteró la copia de ${quien}`,
    texto: `En la copia de ${quien} ${fraseAlteracion(d) || 'se alteró un folio'}. Al revalidarla, ${por}: su libro entero queda inválido y la institución sale del consenso hasta que se sincronice. Las copias de las demás instituciones siguen intactas.`,
    nivel: 'aviso' };
});

registrarFrase('nodo_sincronizado', (e) => {
  const quien = etiqueta(e.nodo);
  return e.datos?.codigo === 'aceptada'
    ? { titulo: `${quien} adoptó la copia de las demás instituciones`, texto: `${quien} pidió la mejor copia del libro a sus pares, la validó entera (huellas, firmas y consenso) y la adoptó: era más larga que la suya o la suya estaba dañada.`, nivel: 'ok' }
    : { titulo: `${quien} conserva su copia`, texto: `${quien} comparó su copia con la de sus pares: ${MOTIVO_NODO[e.datos?.codigo] || sinPunto(conInstituciones(tras(e.texto))) || 'no había nada mejor que adoptar'}.`, nivel: 'info' };
});

registrarFrase('cadena_rechazada', (e) => ({ titulo: 'Copia rechazada',
  texto: `${etiqueta(e.nodo)} rechazó la copia recibida: ${MOTIVO_NODO[e.datos?.codigo] || 'no pasó la validación'}. Conserva la suya.`, nivel: 'aviso' }));

registrarFrase('cadena_aceptada', (e) => ({ titulo: 'Copia aceptada',
  texto: `${etiqueta(e.nodo)} validó la copia completa (huellas y enlaces, firmas y créditos, consenso) y la adoptó porque es más larga que la suya${e.datos?.altura !== undefined ? `: ahora mide ${num(e.datos.altura + 1)} folios` : ''}.`, nivel: 'ok' }));
