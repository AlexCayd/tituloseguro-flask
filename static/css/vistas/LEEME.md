# CSS de las vistas — convenciones

Cada vista trae su hoja en `static/css/vistas/<id>.css`. El shell la carga sola antes de
montar la vista (si el módulo no declara `css: false`). **No toques** `tokens.css`, `base.css`,
`componentes.css` ni `shell.css`: son compartidos.

## Capas
`tokens.css` declara el orden para toda la app:

```
reset → tokens → base → disposicion → componentes → vistas → utilidades
```

Todo tu CSS va **dentro de `@layer vistas`** y **acotado a tu vista**:

```css
@layer vistas {
  .vista[data-vista="pow_arena"] .carril { … }      /* o un prefijo propio: .arena-… */
}
```
Usa un prefijo de clase propio (`arena-`, `esc-`, `cad-`, `lab-`) para no chocar con nadie.
Gana a `componentes` sin pelear especificidad; `utilidades` (p. ej. `.solo-lectores`) te gana a ti.

## Contenedor
`.vista__cuerpo` es un contenedor de consultas llamado `vista`: diseña con
`@container vista (max-width: 720px) { … }` en vez de media queries (el ancho real depende de
la columna del observatorio).

## Tokens (usa siempre estos, nunca hex/oklch sueltos)
- Superficies: `--fondo`, `--sup-1` … `--sup-4`; líneas `--linea-suave`, `--linea`, `--linea-fuerte`.
- Texto: `--texto` (principal), `--texto-2` (secundario), `--texto-3` (mínimo AA para texto pequeño),
  `--tinta-oscura` (texto SOBRE acentos claros: los acentos no admiten texto blanco).
- Acento del modo: `--acento` (ámbar en PoW, cian en PoS; cambia solo con `body[data-modo]`),
  `--acento-texto`, `--acento-tenue` (fondo), `--acento-borde`, `--acento-brillo` (sombra).
  `--pow` y `--pos` existen por si necesitas el color del otro modo.
- Estados (iguales en ambos modos): `--valido`, `--rechazado`, `--pendiente`, `--obsoleto`,
  `--advertencia`. Derívalos con `color-mix(in oklab, var(--valido) 14%, transparent)`.
- Tipografía: `--f-titular` (Bricolage Grotesque), `--f-texto` (Instrument Sans),
  `--f-mono` (JetBrains Mono: hashes, nonces, cifras). Escala `--t-2xs … --t-3xl`.
- Espacio `--e-1 … --e-8` (4 → 64 px), radios `--r-1/2/3`, `--r-pildora`, sombras `--sombra-1/2/3`.
- Movimiento: `--dur-micro/entrada/escena`, `--curva-firma` (expresiva), `--curva-func`, `--curva-salida`.
- `--objetivo` = 40 px de alto mínimo para controles táctiles.
- Color por huella: `oklch(0.8 0.12 var(--tono))` con `--tono` = `fmt.tonoHash(hash)` (mismo
  color que el halo del nodo en el anillo: «mismo color, misma cadena»).

## Componentes listos (componentes.css / shell.css)
`.boton` (`--primario --secundario --fantasma --peligro --peligro-lleno --chico --icono --bloque`,
`[aria-busy]`), `.campo` + `.campo__etiqueta/__ayuda/__error` (`[data-invalido]`, `[data-advertencia]`),
`.entrada` (`--mono`), `.selector`, `.deslizador` (`--relleno`), `.segmentado` (radios),
`.interruptor` (`role=switch aria-checked`), `.chip[data-estado]`, `.insignia`, `.hash`,
`.hex-completo`, `.termino`, `.panel` (`--instrumento`, `__cabecera`, `__cuerpo`), `.lectura`
(`__etiqueta`, `__valor`, `--grande`), `.cuadro-lecturas`, `.medidor[data-estado]` (`--valor` 0..1),
`.tabla-marco` + `.tabla`, `.vacio`, `.aviso[data-nivel]`, `.detalles`, `.renglones`, `.desglose`
(`__barra > span[data-parte]` con `--peso`), `.esqueleto`, `.pila` (`--pila`), `.grupo`,
`.rejilla-auto` (`--min`), `.etiqueta-instrumento`, `.mono`, `.cifra`, `.solo-lectores`.

## Clases de estado en el anillo (para `ctx.red.marcar(id, clase)`)
Ya existen `.es-seleccionado` y `.es-resaltado`. Las tuyas, decláralas en tu hoja:
```css
@layer vistas { .nodo.arena-rezagado .nodo__cuerpo { stroke: var(--advertencia); } }
```
Atributos que pinta el shell en cada `.nodo`: `data-conectado`, `data-sinc`, `data-integra`,
`data-deshonesto`, `data-rol` (`minando|ganador|obsoleto|validador|proponente|eliminado`).

## Reglas
- Todo componente con `display` propio respeta `[hidden]` (el reset lo fuerza con `!important`).
- Solo `transform`/`opacity` en animaciones; nada que empuje layout.
- Siempre `@media (prefers-reduced-motion: no-preference)` alrededor de animaciones CSS en bucle.
- Nada de `style="…"` en HTML (CSP): variables por CSSOM desde JS.
