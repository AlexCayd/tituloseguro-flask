# Sección «Criptografía» — contrato de cada esquema

La vista `static/js/vistas/esquemas.js` (pestaña **Criptografía**) muestra cinco tarjetas. Al abrir una
(`#/<modo>/esquemas/<id>`) importa **dinámicamente** `./esquemas/<id>.js` y carga
`static/css/vistas/esquemas/<id>.css`. Si un esquema falla, solo ese muestra un aviso.

| id | archivo | prefijo CSS | documento |
|---|---|---|---|
| `shamir` | `shamir.js` (**referencia**: cópiale el estilo) | `sh-` | `esquemas/esquema_shamir.pdf` |
| `qr` | `qr.js` | `qr-` | `esquemas/qr_shamir.pdf` |
| `zk` | `zk.js` | `zk-` | `esquemas/pipeline_conocimiento_cero.pdf` |
| `anillo` | `anillo.js` | `an-` | `esquemas/firmas_anillo_pipeline.pdf` |
| `schnorr` | `schnorr.js` | `sch-` | `esquemas/schnorr_juguete.pdf` |

## 1. Forma del módulo

```js
import * as K from './_kit.js';
export default {
  montar(host, ctx, meta) { /* una vez: construye TODO dentro de host */ },
  mostrar(ctx) { /* opcional: cada vez que se vuelve visible */ },
  ocultar(ctx) { /* opcional: al dejar de verse (parar temporizadores) */ },
};
```
- `meta` = `{ id, numero, icono, titulo, metafora, caso, tecnico }` (lo de la tarjeta).
- `ctx` es el de la vista (ver `../LEEME.md`) con su propio `ctx.local` (estado de ESTE esquema;
  nada de variables de módulo: hay una instancia por modo PoW/PoS). Útiles: `ctx.ui` (toasts,
  `mostrarError`, `ocupado`, `termino`), `ctx.modo` (para ids únicos), `ctx.narrar`.
- El contenedor es `.esq-contenedor[data-esquema="<id>"]` (grid con gap): `host.append(...)` en orden.

## 2. El kit (`_kit.js`)

| Pieza | Uso |
|---|---|
| `K.post(ruta, cuerpo)` / `K.get(ruta, params)` | `/api/esquemas/<ruta>` → datos (lanza `ErrorApi` con el mensaje del servidor) |
| `K.accion(ctx, boton, promesa)` | botón ocupado + error mostrado; devuelve `null` si falló |
| `K.token()`, `K.retoAlAzar()`, `K.semilla(ctx)` | ids de ronda, reto de 64 hex < N, semilla de sesión |
| `K.cabecera({numero, icono, titulo, metafora, historia, tecnico, id})` | encabezado del esquema |
| `h('div.esq-pasos', K.paso({n, titulo, ayuda, estado, id}, ...hijos), …)` · `K.marcarPaso(el, 'activo'|'hecho'|'espera')` | pasos numerados |
| `K.veredicto({vacio})` · `K.pintarVeredicto(el, {estado:'ok'|'mal'|'aviso'|'info', titulo, texto, extra})` | resultado grande (región viva) |
| `K.explicacion()` · `K.explicar(el, ...parrafos)` | «¿Qué acaba de pasar?» |
| `K.trampas([{etiqueta, texto, fn(boton)}])` | «Prueba a hacer trampa» |
| `K.cuentas(titulo, ...hijos)` · `K.renglones([[etiqueta, valor]])` · `h('p.esq-cuenta', …)` | lo técnico, plegado |
| `K.saberMas(...hijos)` | usos reales y límites, plegado |
| `K.segmentado({nombre, etiqueta, opciones:[{valor, texto}], valor, alCambiar})` | selector (radios) |
| `K.qrSvg(filas, {margen, titulo})` · `K.combinar(matrices, 'xor'|'or')` | dibujar/combinar QR (`'0101…'` por fila) |
| `K.ruido(hex)`, `K.corto(hex, n)`, `K.IDS`, `K.inst.sigla(id)`, `K.inst.nombre(id)` | adornos y datos del consorcio |
| `K.narrar(ctx, titulo, texto, nivel)` | panel «¿Qué está pasando?» |
| `K.h`, `K.s`, `K.icono`, `K.texto`, `K.attr`, `K.reemplazar`, `K.anim` | DOM (CSP estricta) |

Clases del kit ya estilizadas (en `css/vistas/esquemas.css`): `.esq-pasos`, `.esq-acciones`
(botón primario grande), `.esq-frase`, `.esq-campos` + `.campo` / `.campo--ancho`, `.esq-valor` (valor
en mono), `.esq-cuenta` (cuenta en mono), `.esq-qr`, `.esq-ruido`. Componentes globales: `.boton`
(`--primario/--secundario/--fantasma/--chico`), `.campo`, `.entrada`, `.selector`, `.deslizador`,
`.interruptor`, `.chip[data-estado]`, `.tabla-marco` + `.tabla`, `.aviso[data-nivel]`.
Iconos disponibles (sin «i-»): ver `templates/_iconos.html` (`candado piezas qr velo anillo calculadora
llave firma sello mascara dado ok x alerta info flecha mas menos reiniciar play pausa voto escudo
institucion diploma hash ruleta buscar libro`…). **No edites** `_kit.js`, `esquemas.js`,
`esquemas.css`, `_iconos.html` ni archivos de otro esquema: si te falta algo, hazlo local en tu módulo.

## 3. Tono y UX: «para alguien que no sabe NADA del tema»

1. **Metáfora primero.** Cabecera con una frase cotidiana grande y una historia del consorcio
   (instituciones: UAN, UNAM, IPN…; títulos, rectores, egresadas).
2. **Pasos numerados (3 o 4), un botón principal por paso.** Valores iniciales listos: con hacer
   clic en los botones principales, en orden, la demo funciona sin escribir nada.
3. **Cero jerga en el flujo principal.** Nada de «nonce», «escalar», «punto», «hash», «polinomio»,
   «Lagrange» en los textos visibles del flujo: usa «número al azar», «sobre cerrado», «huella»,
   «curva». Los nombres técnicos van en la cabecera (pequeño), en «Ver las cuentas» o con
   `ctx.ui.termino(...)` si hace falta.
4. **Cada resultado**: `K.pintarVeredicto` (grande, verde/rojo/ámbar, frase corta y clara) +
   `K.explicar` (1–2 frases: por qué pasó). Narra lo importante con `K.narrar`.
5. **«Prueba a hacer trampa»** con 2–3 botones de un clic que muestran cómo el esquema se defiende.
6. **Lo técnico, plegado**: «Ver las cuentas» (valores reales, fórmulas del documento) y
   «Para saber más» (dónde se usa de verdad y sus límites, según el PDF).
7. Español de México, de «tú». Frases cortas. Números en mono solo cuando son el dato.
8. Accesible: botones reales (`aria-pressed` en los que se activan), etiquetas, regiones vivas,
   foco visible, objetivos ≥ 40 px, responsivo con `@container vista (max-width: …)`,
   `prefers-reduced-motion` para animaciones en bucle; `K.anim` ya respeta el movimiento reducido.
9. CSP estricta: nada de `style="…"`, `innerHTML` ni `on*=`; estilos dinámicos por CSSOM
   (`el.style.setProperty('--x', v)` o `h(…, { style: { '--x': v } })`).
10. CSS: `@layer vistas { .esq-contenedor[data-esquema="<id>"] .<prefijo>-… { … } }`, solo tokens
    (`--sup-1…`, `--texto…`, `--acento…`, `--valido/--rechazado/--advertencia/--pendiente`, `--e-*`,
    `--r-*`, `--t-*`, `--f-mono`…), nunca colores sueltos.

## 4. API de cada esquema (todas sin estado; resultados didácticos llegan con `ok: true`)

Errores de validación: `ErrorApi` 422 con `e.message` en español y `e.campo` → `ctx.ui.mostrarError(e, { form })`.
Las claves privadas viven en el servidor: el cliente manda `semilla` (`K.semilla(ctx)`) e `institucion`.

### qr
- `POST qr/repartir {secreto (≤120 bytes), k, n (2..9), nivel?: 'L'|'M'|'Q'|'H' (H)}` →
  `{id, k, n, nivel, bytes_secreto, partes:[{x, texto:'SSQR1:ID:k:n:x:DATOS:CRC', qr:{version, modulos, filas:['0101…']}}]}`
- `POST qr/leer {textos:[1..9]}` → `{abierto, codigo:'abierto'|'danada'|'mezcladas'|'repetidas'|'insuficientes'|'incorrecta'|'formato', mensaje, partes_leidas, secreto?}`
- `POST qr/alterar {texto, modo:'mancha'|'trampa'}` → `{modo, texto}` (mancha: CRC viejo → «danada»; trampa: CRC recalculado → «incorrecta»)
- `POST qr/boveda {documento (≤800 bytes, multilínea), k, n (≤7)}` → `{k, n, boveda:{texto, qr}, partes:[{x, texto, qr}]}`
- `POST qr/boveda/abrir {boveda, textos}` → `{abierto, codigo, mensaje, documento?}`
- `POST qr/visual {texto (≤120), tipo:'xor'|'naor_shamir', sombras?: 2..4}` →
  `{tipo, version, modulos, secreto:[filas], sombras:[[filas], …]}` (Naor–Shamir: 2 acetatos del DOBLE de tamaño; se encima con OR)

### zk
- `GET zk/coloreo` → `{vertices:[7 materias], aristas:[[u,v]×14], turnos:['Mañana','Tarde','Noche'], rondas_recomendadas:187, epsilon, secreto_de_peggy:[7], coloreo_tramposo:[7]}`
- `POST zk/coloreo/compromiso {ronda, tramposa?}` → `{ronda, compromisos:[7 hex]}`
- `POST zk/coloreo/abrir {ronda, tramposa?, arista:[u,v]}` → `{ronda, arista, compromisos, u:{vertice, color, nonce}, v:{…}, verificacion:{abre_u, abre_v, distintos, en_rango, ok}}` (422 `arista_invalida` si no es arista)
- `POST zk/coloreo/rondas {ronda, tramposa?, k (1..500)}` → `{tramposa, k, rondas:[{arista, colores, ok}], aceptada, primera_falla, prob_engano, rondas_recomendadas}`
- `POST zk/clave {semilla, institucion}` → `{institucion, Y}`
- `POST zk/compromiso {semilla, institucion, ronda}` → `{institucion, ronda, Y, T}`
- `POST zk/responder {semilla, institucion, ronda, reto (K.retoAlAzar()), impostor?}` → `{Y, T, c, s, impostor, verificacion:{sG, T_mas_cY, ok}}` (misma ronda ⇒ mismo T: así se demuestra reutilizar el número al azar)
- `POST zk/extraer {semilla, institucion, transcripciones:[{c,s},{c,s}]}` → `{x_extraida, coincide, x_real}` (422 `retos_iguales`)
- `POST zk/simular {semilla, institucion}` → `{Y, T, c, s, verifica}`
- `POST zk/probar {semilla, institucion, mensaje}` → `{Y, T, s, c}` · `POST zk/verificar {Y, mensaje, T, s}` → `{valida}`

### anillo
- `POST anillo/firmar {semilla, anillo:[2..12 ids N01…N20], firmante, mensaje (≤280), variante:'aos'|'lsag'}` →
  `{variante, mensaje, anillo:[{id, clave_publica}] (orden canónico), firma:{variante, c0, r:[…], I?}, tamano_bytes}` (no dice quién firmó)
- `POST anillo/verificar {semilla, anillo, mensaje, firma}` →
  `{variante, valida, anillo, traza:[{id, c, R}], c0, c_final, imagen, probabilidad:{num, den}|null, motivo}`
- `POST anillo/urna {semilla, anillo, mensaje, firma (LSAG), imagenes_previas:[hex]}` → lo de verificar + `{repetida, aceptada}`
- 422: `firmante_fuera`, `repetido`, `fuera_de_rango`, `firma_mal_formada`…

### schnorr
- `GET schnorr/tablas?grupo=zp|curva` → zp: `{p:23, q:11, g:2, potencias:[{a, valor}], inversos_q}`; curva: `{p:17, a:2, b:2, q:19, G:[5,1], multiplos:[{k, punto|null}], puntos:[[x,y]×18], inversos_p, inversos_q}`
- `POST schnorr/firmar {grupo, x, k (1..q−1), M (0..999)}` → `{x, k, M, y, r, e, s, firma:{s,e}, cuentas:{clave, compromiso, reto, respuesta}}`
- `POST schnorr/verificar {grupo, y (zp: entero; curva: [x,y]), M, s, e}` → `{gs, ye, rv, ev, valida, cuentas:{gs, ye, rv, ev}}`
- `POST schnorr/nonce {grupo, x, k, M1, M2}` → `{r, firma1, firma2, extraible, x_extraida?, k_extraido?, coincide?, cuenta}`
- `POST schnorr/multifirma {grupo, x1, x2, k1, k2, M}` → `{firmantes:[{nombre, x, y, a, k, r, huella, s, parcial_ok, cuenta_a, cuenta_s}×2], clave_conjunta, x_conjunta_teorica, r, e, s, firma, cuentas:{r, e, s}, verificacion}` (422 `caso_degenerado`)
- `POST schnorr/ataque {x1?, x_estrella?}` → `{y1, y_estrella, y2_falsa, clave_ingenua, firma_beto_solo, acepta_ingenua, a1, a2, clave_con_coeficientes, acepta_con_coeficientes, cuenta}`
