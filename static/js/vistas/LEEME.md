# Contrato de vistas — Título Seguro

> **Dominio**: registro compartido de credenciales académicas. Cada nodo es una **institución**
> (N01 = UAN, N02 = UNAM…; los ids técnicos NO cambian en rutas ni datos), la unidad es el
> **crédito de certificación** y una transacción es un **registro de credencial**. Para la copia
> visible usa `static/js/dominio.js`: `sigla(id)`, `nombre(id)`, `tipo(id)`, `rotulo(id)`
> («UNAM · Universidad Nacional…»), `etiqueta(id)` («N02 · UNAM»), `creditos(n)`,
> `conInstituciones(texto)` / `conSiglas(texto)`, `TARIFAS`, `tarifaPorMonto(m)`, `UNIDAD`.

Cada sección de la app es una **vista**: un módulo ES en `static/js/vistas/<id>.js`.
El shell (`static/js/main.js`) la monta, le pasa el estado del servidor y le da herramientas.
**No edites** `main.js`, `store.js`, `api.js`, `ui.js`, `narrador.js`, `red_viva.js`,
`ficha_nodo.js`, `glosario.js`, `util/*` ni los CSS compartidos: son de todos.

## 1. Registrar una vista (una línea)

En `static/js/vistas/registro.js`:

```js
export { default as pow_arena } from './pow_arena.js';
```

El orden en la navegación lo decide `orden` dentro de la vista (no el orden de las líneas).
Los stubs `pow_arena.js`, `pos_escenario.js`, `cadena.js` y `laboratorio.js` ya están
registrados: **reemplaza el archivo** y listo (sin tocar el registro).

## 2. Forma del módulo

```js
export default {
  id: 'pow_arena',                 // = nombre del archivo y de su CSS
  titulo: 'Arena de minería',      // título (h1) de la vista y de la pestaña
  etiqueta: 'Minería',             // opcional: texto corto en la navegación
  icono: 'calor',                  // id del sprite (templates/_iconos.html), sin «i-»
  modos: ['pow'],                  // ['pow'], ['pos'] o ['pow','pos']
  orden: 30,                       // posición en la navegación (10 red, 20 tx, 30 arena/escenario, 40 cadena, 50 laboratorio, 60 bitácora)
  descripcion: 'Una frase bajo el título.',      // opcional
  css: true,                       // por defecto true: carga static/css/vistas/<id>.css antes de montar. false = sin CSS
  requiereRed: true,               // por defecto true: sin red, el shell muestra un estado vacío y NO llama a actualizar()
  insignia: (estado) => null,      // opcional: texto/número junto a la pestaña (null/0 = nada)

  montar(host, ctx) { /* una vez por modo: construye el DOM dentro de host */ },
  actualizar(estado, ctx, cambios) { /* en cada estado nuevo mientras la vista está visible */ },
  mostrar(ctx) { /* opcional: cada vez que la vista pasa a ser visible */ },
  ocultar(ctx) { /* opcional: cada vez que deja de ser visible (otra sección u otro modo) */ },
};
```

### `ocultar(ctx)` (nuevo)
El shell llama a `vista.ocultar?.(ctx)` cuando la vista visible va a dejar de estarlo: al cambiar
de sección **o** de modo (también cuando el cambio de modo lleva a la «misma» vista del otro modo).
Se llama **justo antes** del cambio, así que la fachada `ctx.red` de esa instancia todavía actúa
sobre el anillo. Úsalo para **retirar lo que la vista dejó en el anillo**
(`ctx.red.marcar(id, clase, false)`, superposiciones en `ctx.red.capa()`), parar temporizadores
propios, etc. Si vuelve a mostrarse, llegan `actualizar(…, {primera:true})` y `mostrar(ctx)` como
siempre. Si lanza, el shell lo registra en consola y sigue.

### Ciclo de vida
- La vista se monta **una vez por modo** (instancia PoW e instancia PoS separadas, cada una con
  su `host` y su `ctx`). Cambiar de modo **no destruye nada**: al volver, todo sigue igual.
- ⚠️ **No guardes estado en variables del módulo** (lo compartirían las dos instancias).
  Usa `ctx.local` (objeto libre por instancia) o el propio DOM.
- `montar` puede ser `async`. Si lanza, el shell aísla el fallo y muestra un aviso en la vista.
- `actualizar(estado, ctx, cambios)` solo se llama con la vista **visible**. Al volver a
  mostrarla recibe el estado actual con `cambios.primera = true` (pinta sin animar «historia»).
  Durante una carrera PoW llega **cada 250 ms**: actualiza el DOM existente (no lo reconstruyas
  entero, o perderás el foco del teclado). Ayudas: `ctx.dom.texto`, `ctx.dom.attr`,
  `ctx.dom.reconciliar` (listas por clave) y claves de cambio en `dataset`.
- Si necesitas enterarte de algo con la vista oculta: `ctx.alEvento(fn)` / `ctx.alEstado(fn)`.

## 3. `ctx`

| Campo | Qué es |
|---|---|
| `ctx.modo` | `'pow'` o `'pos'` (fijo para esta instancia) |
| `ctx.estado()` | último estado del servidor para este modo (`GET /api/<modo>/estado`) |
| `ctx.api.get(sub, params)` | `GET /api/<modo>/<sub>?…` → datos (lanza `ErrorApi` / `ErrorRed`) |
| `ctx.api.accion(sub, cuerpo)` | `POST /api/<modo>/<sub>` **añadiendo `epoca`** y refrescando el estado al terminar (también si falla) |
| `ctx.api.crear(config)` | crea/reinicia la red del modo |
| `ctx.store` | el store (`estado(m)`, `nodo(m,id)`, `on(evento, fn)`, `refrescar(m)`) |
| `ctx.ui` | toasts, errores, confirmación, hash-chip, términos, vacío, chip, medidor… (ver §5) |
| `ctx.narrar(x)` | escribe en el panel «¿Qué está pasando?» (ver §6) |
| `ctx.red` | la red viva (anillo): `resaltar(id)`, `destello(id,'rechazo'|'defensa'|'acento')`, `difundir(origen|null, destinos)`, `marcar(id, clase, on)`, `posicion(id)`, `capa()`, `previsualizar(n)` |
| `ctx.abrirNodo(id)` | abre la ficha lateral del nodo |
| `ctx.navegar(vistaId, {modo?, ...parámetros})` | cambia de sección (y de modo si se indica); cualquier otra clave viaja como **parámetro de navegación** (ver abajo) |
| `ctx.parametros` | parámetros de la navegación que trajo a esta vista: objeto congelado, `{}` si no hubo. Alias: `ctx.params` |
| `ctx.limites` | `GET /api/limites` (n_min/max, dificultad, monto_max, `ataques` con explicaciones, `corrupciones`, `fases_pos`…) |
| `ctx.h`, `ctx.s`, `ctx.icono` | hiperscript HTML/SVG e icono del sprite |
| `ctx.dom`, `ctx.fmt`, `ctx.anim` | `util/dom.js`, `util/fmt.js`, `util/anim.js` |
| `ctx.local` | objeto libre para el estado de la instancia |
| `ctx.host`, `ctx.seccion` | contenedor de la vista y su `<section>` |
| `ctx.activa` | ¿es la vista visible del modo visible? |
| `ctx.alEvento(fn)` | `fn(entradasNuevasDeBitacora, estado)` aunque esté oculta |
| `ctx.alEstado(fn)` | `fn(estado, cambios)` aunque esté oculta (úsalo poco) |

### Parámetros de navegación
`ctx.navegar('cadena', { nodo: 'N03' })` (o `{ modo: 'pos', nodo: 'N03' }`) lleva a la vista y le
deja los parámetros en **`ctx.parametros`** (`{ nodo: 'N03' }`). Reglas:
- Valen solo para ESA navegación: si luego se entra a la vista por la pestaña, `ctx.parametros` es `{}`.
- Se fijan **antes** de `montar` (primera vez), de `actualizar(…, cambios)` (que además recibe
  `cambios.parametros`) y de `mostrar(ctx)`. Si la vista ya estaba visible también se repiten
  `actualizar` (con `cambios.primera = true`) y `mostrar`. Lugar recomendado para consumirlos:
  `mostrar(ctx)` → `const id = ctx.parametros.nodo; if (id && id !== ctx.local.nodo) elegir(id)`.
- Parámetros en uso:
  | Origen | Llamada | Quién lo consume |
  |---|---|---|
  | Ficha de institución → «Abrir la copia de X en el explorador de cadena» | `navegar('cadena', { nodo })` | `cadena.js`: preseleccionar esa institución |

### `cambios` (diferencias entre el estado previo y el nuevo)
`{ primera, creada, epocaCambio, existeCambio, altura:{antes,despues}|null, cabezas:[ids],
recibieron:[ids], origen:id|null, conexion:[ids], sincronia:[ids], deshonesto:[ids],
integridad:[ids], eventos:[entradas], huecoBitacora, trabajo:{antes,despues}|null,
fase:{antes,despues}|null, pendientes:{antes,despues}|null }`.
Úsalo para animar **solo lo que cambió** (p. ej. `cambios.fase` → animar el paso de fase).

## 4. Errores: dominio ≠ red

```js
try {
  const r = await ctx.ui.ocupado(boton, ctx.api.accion('minar', { ejecucion: 'auto' }));
} catch (e) {
  ctx.ui.mostrarError(e, { form });   // marca el campo si viene `campo`; si no, toast
}
```
- `ErrorApi` (4xx/5xx JSON): `e.message` es el **texto exacto del servidor** (muéstralo tal cual;
  `ctx.fmt.capital()` solo pone la mayúscula inicial), `e.codigo`, `e.campo`, `e.detalle`, `e.status`.
  Es parte de la lección: preséntalo como «rechazado por la red», no como fallo técnico.
- `ErrorRed`: sin conexión. El shell ya muestra el estado de conexión; no lo repitas en bucle.
- `epoca_obsoleta` (otra pestaña reinició): el shell avisa y recarga solo; `mostrarError` lo ignora.
- Acciones de ronda PoS: manda `fase_esperada` para detectar que otra pestaña avanzó (`fase_cambio`).
- Para pintar el error dentro de un formulario: nombra los controles con `name` igual al `campo`
  del servidor (`emisor`, `monto`, `apuestas`, `votante`…) y envuélvelos en `.campo` con un
  `p.campo__error`. `ui.marcarCampo(form, campo, msg)` abre `<details>` cerrados si hace falta.

## 5. `ctx.ui`

```js
ui.toast(texto, { nivel: 'info|ok|aviso|error|red', titulo, duracion, accion: { etiqueta, fn } });
ui.mostrarError(err, { form, titulo });     ui.marcarCampo(form, campo, msg);  ui.limpiarCampos(form);
await ui.confirmar({ titulo, texto, lista: [], confirmar: 'Reiniciar', peligro: true });  // → boolean
ui.hash(hex, { n: 4, ceros: true, etiqueta: 'Huella', plano: false });  // «ab12…ef90», copia al clic
ui.actualizarHash(elemento, nuevoHex);      // sin recrearlo
ui.termino('nonce')  /  ui.termino('nonce', 'los nonces');   // disparador del glosario
ui.vacio({ icono, titulo, texto, accion: { etiqueta, fn }, extra });
ui.chip('Sincronizado', 'valido');           // valido|rechazado|pendiente|obsoleto|advertencia|acento|neutro
ui.medidor(v, max, { etiqueta });  ui.fijarMedidor(el, v, max, estado?);
await ui.ocupado(boton, promesa);            // aria-busy + giro mientras dura
ui.anunciar('Texto para lectores de pantalla', { urgente: false });
ui.copiar(texto);
```

### Glosario
Cualquier `[data-term="clave"]` abre su definición (popover nativo, Esc y clic fuera cierran).
Claves: `hash nonce dificultad firma clave_publica transaccion pendiente bloque cadena genesis
confirmacion recompensa saldo stake validador proponente quorum castigo doble_gasto sincronizacion
cadena_mas_larga proof_of_work proof_of_stake reloj_logico semilla` y del dominio académico
`nodo consorcio credencial institucion_emisora credito_certificacion registro_inmutable falsificacion`.
(`transaccion` se titula «Registro de credencial»; `pendiente`, «Registro en espera de sello»;
`recompensa`, «Créditos ganados por sellar».)
Añadir términos: `import { registrarTermino } from '../glosario.js'` →
`registrarTermino('ruleta', { titulo, texto, ejemplo?, ver?: ['stake'] })`.

## 6. Narrador

```js
ctx.narrar({ titulo: 'Ronda 3 de 60', texto: 'Ningún minero ha encontrado…', nivel: 'info', detalle: '…' });
ctx.narrar(entradaDeBitacora);    // usa la frase registrada para su `tipo`
```
El shell ya narra cada lote de eventos nuevos y sugiere el **siguiente paso**. Para afinar la frase
de un tipo: `import { registrarFrase } from '../narrador.js'` →
`registrarFrase('sorteo', (e, estado) => ({ titulo, texto, nivel }))`.
Recorrido guiado: `static/js/recorrido.js` (lo arranca el shell en la primera visita; se repite
desde «Ver el recorrido» en el narrador). Se ancla a `#anillo` (o `#franja-red` en móvil),
`.seccion[data-vista="…"]` y `#narrador`: no renombres esos `data-vista`.

## 6 bis. Anillo y móvil
- Cada nodo del anillo muestra la **sigla** en `.nodo__id` (las vistas pueden seguir tiñéndola) y,
  debajo, `.nodo__hash` = `tspan.nodo__tec` (id) + `tspan.nodo__cola` (cola de la huella).
- En ≤ 720 px el anillo vive plegado tras la franja pegajosa (`#franja-red`, «Ver red») y se
  despliega encima del contenido (`body[data-red-abierta]`). Las animaciones sobre el anillo siguen
  funcionando aunque esté plegado; no dependas de que sea visible.

## 7. Movimiento

`ctx.anim.animar(el, keyframes, opciones, { reducido })`, `entrar(el)`, `destello(el)`,
`sacudir(el)` (rechazo), `contar(el, a, b)`, `escalonar(els, kf, op, paso)`, `transicion(fn)`.
Duraciones `anim.DUR` (micro 160, entrada 280, escena 480) y curvas `anim.CURVA`
(firma, func, salida, acuse). Con `prefers-reduced-motion` todo se convierte en fundido breve.
Regla: **el estado final vive en el DOM/CSS**; la animación solo interpola. Nada de animar filas
al paginar, números que hay que leer ya, ni nada mientras el usuario arrastra.

## 8. Ejemplo mínimo

```js
export default {
  id: 'cadena', titulo: 'Explorador de cadena', etiqueta: 'Cadena', icono: 'cadena',
  modos: ['pow', 'pos'], orden: 40,
  montar(host, ctx) {
    ctx.local.lista = ctx.h('ol.cad-lista', { role: 'list' });
    host.append(ctx.local.lista);
  },
  actualizar(e, ctx, cambios) {
    if (!cambios.altura && !cambios.primera && !cambios.epocaCambio) return;
    ctx.api.get(`nodos/${e.cabeza.proponente === 'genesis' ? e.ids[0] : e.cabeza.proponente}/cadena`, { limite: 20 })
      .then((c) => ctx.dom.reconciliar(ctx.local.lista, c.bloques, (b) => b.hash,
        (b) => ctx.h('li', `#${b.numero} `, ctx.ui.hash(b.hash, { ceros: ctx.modo === 'pow' }))))
      .catch((err) => ctx.ui.mostrarError(err));
  },
};
```

## 9. CSP (estricta, la envía el servidor)
Prohibido: `<script>`/`<style>` inline, atributo `style="…"` (ni con `setAttribute('style')`),
`onclick=`, `innerHTML` con marcado, `eval`. Permitido: clases, `el.style.setProperty('--x', v)`,
`el.style.left = …`, atributos de geometría SVG, `h(…, { style: { '--x': v } })` (usa CSSOM).
⚠️ `el.replaceChildren(null)` pinta el texto «null»: usa `ctx.dom.reemplazar(el, …)`, que lo ignora.
