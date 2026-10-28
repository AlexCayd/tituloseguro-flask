// VISTA · Criptografía, explicada fácil — los cinco esquemas de la carpeta `esquemas/`.
//  · Sin esquema elegido: cinco tarjetas grandes (qué problema resuelve cada uno, con una metáfora).
//  · Con esquema: #/<modo>/esquemas/<id> → barra con los cinco (anterior / siguiente) y su demo.
//  · Cada esquema vive en ./esquemas/<id>.js y se importa AL ABRIRLO (import dinámico): si uno
//    fallara, la vista muestra un aviso en su lugar y el resto de Título Seguro sigue funcionando.
//  · No dependen del consenso: la sección es igual en PoW y PoS (no requiere red).
// Contrato de cada esquema: ./esquemas/LEEME.md

import { h, icono, reemplazar } from '../util/dom.js';
import * as anim from '../util/anim.js';
import { registrarTermino } from '../glosario.js';

// ---- glosario de la sección (cualquier esquema puede usar ctx.ui.termino('<clave>')) ----
registrarTermino('secreto_compartido', {
  titulo: 'Secreto compartido', alias: 'esquema de Shamir',
  texto: 'Un secreto partido en n pedazos de modo que cualesquiera k lo recuperan y k − 1 no dicen nada de él. Cada pedazo es un punto de una curva escondida; el secreto es donde la curva corta el eje.',
  ejemplo: 'La llave de los respaldos de la raíz del DNS está repartida entre 7 personas: hacen falta 5.',
  ver: ['umbral'],
});
registrarTermino('umbral', {
  titulo: 'Umbral (k de n)',
  texto: 'Cuántos pedazos, personas o firmas hacen falta de un total. «3 de 5»: cualesquiera tres bastan; dos no alcanzan.',
  ver: ['secreto_compartido', 'multifirma'],
});
registrarTermino('conocimiento_cero', {
  titulo: 'Prueba de conocimiento cero',
  texto: 'Una forma de convencer a alguien de que algo es cierto —o de que sabes un secreto— sin revelarle nada más. Quien verifica queda convencido, pero no aprende el secreto ni puede presumir la prueba ante otros.',
  ejemplo: 'Demostrar que eres mayor de edad sin enseñar tu fecha de nacimiento.',
  ver: ['firma'],
});
registrarTermino('firma_anillo', {
  titulo: 'Firma de anillo',
  texto: 'Una firma hecha «en nombre de un grupo»: cualquiera comprueba que la hizo alguien del grupo, pero nadie puede saber quién. No hace falta administrador ni permiso de los demás miembros.',
  ejemplo: 'Monero esconde a quien paga entre 16 posibles remitentes.',
  ver: ['imagen_clave', 'firma'],
});
registrarTermino('imagen_clave', {
  titulo: 'Folio anónimo', alias: 'imagen de clave (LSAG)',
  texto: 'Un número que acompaña a una firma de anillo enlazable: es siempre el mismo para la misma persona, pero no dice cuál de las del grupo es. Si aparece dos veces, alguien firmó dos veces.',
  ejemplo: 'Una urna que rechaza el segundo voto de una institución sin saber qué institución es.',
  ver: ['firma_anillo'],
});
registrarTermino('criptografia_visual', {
  titulo: 'Criptografía visual',
  texto: 'Partir una imagen en hojas de puro ruido: cada hoja sola no muestra nada, pero al encimarlas aparece la imagen, sin hacer cuentas.',
  ver: ['secreto_compartido'],
});
registrarTermino('multifirma', {
  titulo: 'Multifirma',
  texto: 'Varias personas firman juntas y el resultado es UNA sola firma, que se comprueba con una sola clave conjunta. Quien verifica no puede saber cuántas firmaron.',
  ejemplo: 'Una doble titulación firmada a la vez por dos universidades.',
  ver: ['firma', 'umbral'],
});
registrarTermino('numero_al_azar', {
  titulo: 'Número al azar de una firma', alias: 'nonce',
  texto: 'Cada firma necesita un número al azar nuevo que nadie conozca. Si se repite en dos firmas, cualquiera puede despejar la clave privada con una resta y una división.',
  ejemplo: 'Así se extrajo en 2010 la clave con la que Sony firmaba los juegos de la PlayStation 3.',
  ver: ['firma'],
});

/** Catálogo (orden sugerido para alguien que empieza de cero). Lo que muestra la tarjeta vive aquí. */
export const ESQUEMAS = Object.freeze([
  {
    id: 'shamir', icono: 'piezas',
    titulo: 'Partir un secreto en pedazos',
    metafora: 'Como una caja fuerte con cinco llaveros: abre con tres cualesquiera; con dos no se abre ni se adivina nada.',
    caso: 'La llave maestra del consorcio, repartida entre cinco rectores.',
    tecnico: 'Esquema de Shamir',
  },
  {
    id: 'qr', icono: 'qr',
    titulo: 'Respaldo en códigos QR',
    metafora: 'Imprime el secreto en cinco QR y repártelos: tres cualesquiera lo recuperan. Y un QR que solo aparece al encimar dos hojas de ruido.',
    caso: 'El respaldo en papel de la clave de la bóveda de títulos.',
    tecnico: 'Shamir sobre GF(2⁸) + QR · criptografía visual',
  },
  {
    id: 'zk', icono: 'velo',
    titulo: 'Demostrar sin revelar',
    metafora: 'Convencer a alguien de que sabes un secreto sin decirle nada del secreto.',
    caso: 'Probar que existe un horario de exámenes sin choques, sin enseñarlo.',
    tecnico: 'Conocimiento cero (Schnorr y 3-coloración)',
  },
  {
    id: 'anillo', icono: 'anillo',
    titulo: 'Firmar sin decir quién',
    metafora: 'Una carta firmada por «alguien de este grupo»: se comprueba que es auténtica, pero no quién la escribió.',
    caso: 'Una denuncia anónima y una votación en la que nadie vota dos veces.',
    tecnico: 'Firmas de anillo (AOS y LSAG)',
  },
  {
    id: 'schnorr', icono: 'calculadora',
    titulo: 'Una firma digital con números pequeños',
    metafora: 'La misma firma que protege Bitcoin, pero con números que caben en una calculadora: puedes revisar cada cuenta.',
    caso: 'La UAN firma un título; en la doble titulación, UAN y UNAM firman juntas.',
    tecnico: 'Firma de Schnorr y multifirma MuSig',
  },
]);
const POR_ID = new Map(ESQUEMAS.map((e, i) => [e.id, { ...e, numero: i + 1 }]));

const VISTA = {
  id: 'esquemas',
  etiqueta: 'Criptografía',
  titulo: 'Criptografía, explicada fácil',
  ceja: 'Cinco herramientas · funcionan igual en los dos modos',
  icono: 'candado',
  modos: ['pow', 'pos'],
  orden: 70,
  requiereRed: false,
  descripcion: 'Cinco herramientas que protegen títulos y secretos. Cada una se prueba con unos pocos clics; las cuentas quedan a la vista solo si quieres verlas.',

  montar(host, ctx) {
    Object.assign(ctx.local, { abierto: null, contenedores: new Map(), cargas: new Map(), css: new Map() });
    ctx.local.portada = portada(ctx);
    ctx.local.barra = h('nav.esq-barra', { 'aria-label': 'Las cinco herramientas', hidden: true });
    ctx.local.escena = h('div.esq-escena');
    host.append(h('div.esq', ctx.local.portada, ctx.local.barra, ctx.local.escena));
  },

  mostrar(ctx) { abrir(ctx, subruta(ctx)); },

  ocultar(ctx) {
    const actual = ctx.local.abierto && ctx.local.cargas.get(ctx.local.abierto);
    actual?.modulo?.ocultar?.(actual.ctx);
  },
};
export default VISTA;

/** #/pow/esquemas/shamir → 'shamir' (o null en la portada). */
function subruta(ctx) {
  const m = (location.hash || '').match(/^#\/(pow|pos)\/esquemas\/([\w-]+)/);
  return m && m[1] === ctx.modo && POR_ID.has(m[2]) ? m[2] : null;
}
const ruta = (ctx, id) => `#/${ctx.modo}/esquemas${id ? `/${id}` : ''}`;

// ================================================================ portada
function portada(ctx) {
  const tarjetas = ESQUEMAS.map((e, i) => h('li.esq-tarjeta', { dataset: { esquema: e.id } },
    h('a.esq-tarjeta__enlace', { href: ruta(ctx, e.id) },
      h('span.esq-tarjeta__num', { 'aria-hidden': 'true' }, String(i + 1)),
      h('span.esq-tarjeta__icono', { 'aria-hidden': 'true' }, icono(e.icono)),
      h('span.esq-tarjeta__titulo', e.titulo),
      h('span.esq-tarjeta__metafora', e.metafora),
      h('span.esq-tarjeta__caso', h('span.etiqueta-instrumento', 'En el consorcio'), ' ', e.caso),
      h('span.esq-tarjeta__pie',
        h('span.esq-tarjeta__tecnico', e.tecnico),
        h('span.esq-tarjeta__ir', 'Probar', icono('flecha'))))));
  return h('section.esq-portada', { 'aria-labelledby': `esq-${ctx.modo}-portada` },
    h('div.esq-portada__intro',
      h('h2', { id: `esq-${ctx.modo}-portada` }, 'Elige una herramienta'),
      h('p', 'No necesitas saber matemáticas: cada una cuenta qué problema resuelve con un ejemplo de todos los días y se prueba en dos o tres pasos. Si te da curiosidad, «Ver las cuentas» muestra los números de verdad.'),
      h('p.esq-portada__nota', icono('info'), ' No dependen del modo (Proof of Work o Proof of Stake) ni de que exista un consorcio: funcionan igual en los dos.')),
    h('ol.esq-tarjetas', { role: 'list' }, tarjetas));
}

// ============================================================ abrir esquema
function pintarBarra(ctx, id) {
  const i = ESQUEMAS.findIndex((e) => e.id === id);
  const ant = ESQUEMAS[i - 1];
  const sig = ESQUEMAS[i + 1];
  reemplazar(ctx.local.barra,
    h('a.boton.boton--fantasma.boton--chico.esq-barra__volver', { href: ruta(ctx, null) },
      h('span.esq-barra__flecha', { 'aria-hidden': 'true' }, '←'), h('span', 'Las cinco herramientas')),
    h('ol.esq-barra__lista', { role: 'list' }, ESQUEMAS.map((e, j) => h('li',
      h('a.esq-barra__item', { href: ruta(ctx, e.id), 'aria-current': e.id === id ? 'page' : null, title: e.titulo },
        h('span.esq-barra__num', String(j + 1)), h('span.esq-barra__nombre', e.titulo))))),
    h('div.esq-barra__pasar',
      ant ? h('a.boton.boton--fantasma.boton--chico', { href: ruta(ctx, ant.id), title: ant.titulo }, '← Anterior') : null,
      sig ? h('a.boton.boton--secundario.boton--chico', { href: ruta(ctx, sig.id), title: sig.titulo }, 'Siguiente →') : null));
}

function cargarCss(ctx, id) {
  if (!ctx.local.css.has(id)) {
    ctx.local.css.set(id, new Promise((resolver) => {
      if (document.querySelector(`link[data-esquema="${id}"]`)) { resolver(true); return; }
      const link = h('link', { rel: 'stylesheet', href: new URL(`../../css/vistas/esquemas/${id}.css`, import.meta.url).href, dataset: { esquema: id } });
      link.addEventListener('load', () => resolver(true));
      link.addEventListener('error', () => { link.remove(); resolver(false); });
      document.head.appendChild(link);
    }));
  }
  return ctx.local.css.get(id);
}

async function abrir(ctx, id) {
  const L = ctx.local;
  const previo = L.abierto;
  if (previo && previo !== id) {
    const p = L.cargas.get(previo);
    try { p?.modulo?.ocultar?.(p.ctx); } catch (e) { console.error(e); }
  }
  L.abierto = id;
  L.portada.hidden = !!id;
  L.barra.hidden = !id;
  for (const [cid, el] of L.contenedores) el.hidden = cid !== id;
  if (!id) return;

  pintarBarra(ctx, id);
  let caja = L.contenedores.get(id);
  if (!caja) {
    caja = h('div.esq-contenedor', { dataset: { esquema: id } }, h('p.esq-cargando', 'Preparando la herramienta…'));
    L.contenedores.set(id, caja);
    L.escena.append(caja);
    const meta = POR_ID.get(id);
    const subctx = Object.assign(Object.create(ctx), { local: {}, esquema: meta, padre: ctx });
    const carga = { modulo: null, ctx: subctx };
    L.cargas.set(id, carga);
    try {
      const [mod] = await Promise.all([import(`./esquemas/${id}.js`), cargarCss(ctx, id)]);
      carga.modulo = mod.default;
      caja.replaceChildren();
      await carga.modulo.montar(caja, subctx, meta);
    } catch (e) {
      console.error(`[esquemas] «${id}» no pudo mostrarse`, e);
      reemplazar(caja, h('div.aviso', { dataset: { nivel: 'error' }, role: 'alert' }, icono('alerta'),
        h('div', h('strong', 'Esta herramienta no pudo mostrarse. '), String(e?.message || e),
          h('p.texto-3', 'Las demás siguen funcionando. Recarga la página para volver a intentarlo.'))));
    }
  }
  if (L.abierto !== id) return;
  const carga = L.cargas.get(id);
  try { carga?.modulo?.mostrar?.(carga.ctx); } catch (e) { console.error(e); }
  if (previo !== id) {
    anim.entrar(caja);
    // al cambiar de herramienta, su cabecera queda arriba (sin saltos si ya estaba a la vista)
    const arriba = L.barra.getBoundingClientRect().top;
    if (arriba < 0 || arriba > window.innerHeight * 0.6) L.barra.scrollIntoView({ block: 'start', behavior: anim.reducido() ? 'auto' : 'smooth' });
  }
}
