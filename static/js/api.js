// Cliente JSON del simulador.
//  · ErrorApi  = el servidor respondió { ok:false, error, codigo, campo?, detalle? } (4xx/5xx).
//                Es parte del flujo didáctico (saldo insuficiente, firma alterada…): se muestra tal cual.
//  · ErrorRed  = no hubo respuesta utilizable (servidor caído, sin red, respuesta no JSON).
// Nunca se confunden: un 4xx JAMÁS es un fallo de red.

export class ErrorApi extends Error {
  constructor(datos = {}, status = 0) {
    super(datos.error || 'El servidor rechazó la petición.');
    this.name = 'ErrorApi';
    this.status = status;
    this.codigo = datos.codigo || 'desconocido';
    this.campo = datos.campo || null;
    this.detalle = datos.detalle || null;
    this.datos = datos;
  }
}

export class ErrorRed extends Error {
  constructor(mensaje, causa) {
    super(mensaje);
    this.name = 'ErrorRed';
    this.causa = causa;
  }
}

function conParametros(ruta, params) {
  if (!params) return ruta;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `${ruta}?${s}` : ruta;
}

async function pedir(metodo, ruta, cuerpo, { signal } = {}) {
  const opciones = {
    method: metodo,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  let resp;
  try {
    resp = await fetch(ruta, opciones);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ErrorRed('No hay conexión con el servidor del simulador. Comprueba que sigue en marcha.', e);
  }
  let datos;
  try {
    datos = await resp.json();
  } catch (e) {
    throw new ErrorRed(`El servidor respondió ${resp.status} sin datos legibles.`, e);
  }
  if (!resp.ok || !datos || datos.ok === false) throw new ErrorApi(datos || {}, resp.status);
  return datos;
}

export const api = {
  get: (ruta, params, op) => pedir('GET', conParametros(ruta, params), undefined, op),
  post: (ruta, cuerpo = {}, op) => pedir('POST', ruta, cuerpo, op),
  del: (ruta, op) => pedir('DELETE', ruta, undefined, op),
  limites: () => pedir('GET', '/api/limites'),
};

/**
 * API ligada a un modo ('pow' | 'pos'). Es lo que reciben las vistas en ctx.api.
 *   ctx.api.get('nodos/N01/cadena', { desde: 0, limite: 6 })
 *   ctx.api.accion('tx', { emisor, receptor, monto })      ← añade `epoca` y refresca el estado
 *   ctx.api.crear({ n: 12, … })                              ← crea/reinicia la red del modo
 */
export function apiDeModo(modo, store) {
  const base = `/api/${modo}`;
  return {
    modo,
    get: (sub, params) => api.get(`${base}/${sub}`, params),

    async accion(sub, cuerpo = {}, { conEpoca = true } = {}) {
      const ep = store.epoca(modo);
      const datos = conEpoca && ep !== null && ep !== undefined ? { ...cuerpo, epoca: ep } : { ...cuerpo };
      try {
        const r = await api.post(`${base}/${sub}`, datos);
        store.refrescar(modo);
        return r;
      } catch (e) {
        if (e instanceof ErrorApi) {
          // un rechazo de dominio puede dejar huella (bitácora, rev): siempre reconciliamos
          store.refrescar(modo, { completo: e.codigo === 'epoca_obsoleta' });
          if (e.codigo === 'epoca_obsoleta') store.emitir('epoca_obsoleta', modo);
        }
        throw e;
      }
    },

    async crear(config) {
      const r = await api.post(`${base}/simulacion`, config);
      store.establecer(modo, r.estado, { creada: true });
      return r;
    },
  };
}
