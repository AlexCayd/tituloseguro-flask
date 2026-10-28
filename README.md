# Título Seguro

**Certificados y credenciales académicas en blockchain.**

Simulador web (**Python + Flask**) de una red de **10 a 20 instituciones educativas** que mantienen un registro compartido e inalterable de credenciales (títulos, diplomas, certificados y constancias). La red se simula con dos mecanismos de consenso, **Proof of Work** y **Proof of Stake**.

## El dominio

- **Cada nodo es una institución educativa** (N01 = UAN Universidad Anáhuac México, N02 = UNAM, N03 = IPN, N04 = TEC… hasta N20). Los identificadores técnicos `N01…N20` se conservan; la interfaz muestra la institución. Las instituciones son ilustrativas: la simulación no representa a las reales.
- **La unidad es el crédito de certificación (CC):** lo que una institución gasta para que la red avale el registro de sus credenciales. El saldo es lo que le queda por registrar.
- **Una transacción es un registro de credencial:** la institución emisora paga N créditos a la institución que lo avala. Se firma `emisor, receptor, monto, timestamp` con Ed25519. En la interfaz hay tarifas orientativas (título profesional 10, diploma 6, certificado de estudios 4, constancia 1) que sólo rellenan el monto.
- **Ganar el derecho a sellar un bloque** (PoW) o **ser sorteado y aprobado por votación** (PoS) paga créditos de certificación.
- **Falsificar una credencial** equivale a alterar un registro ya sellado, firmar con la clave de otra institución, o registrar dos veces los mismos créditos (doble gasto): el laboratorio lo prueba con 13 ataques.
- *Alcance:* el simulador modela el consorcio, las firmas, el consenso y la economía de créditos; los datos de cada credencial (alumno, programa, folio) no se guardan en la cadena.

## Mecanismos de consenso

La red funciona en dos versiones:

| | V1 · Proof of Work | V2 · Proof of Stake |
|---|---|---|
| Las instituciones son… | mineras que compiten por un nonce | validadoras que apuestan créditos |
| Quién propone el bloque | el primero en hallar una huella con *d* ceros (desempate: hash menor) | el sorteado con probabilidad proporcional a su apuesta |
| Cómo se acepta | la huella cumple el objetivo | votos a favor ≥ 2/3 de lo apostado (`3V ≥ 2A`) |
| Recompensa | pendiente hasta la altura *h*+6 (6 confirmaciones) | se paga al aceptarse el bloque |
| Castigo | — | el proponente rechazado pierde su apuesta (regla A) o `min(apuesta, α·valor)` (regla B) |

Ambas comparten estructura de bloque, transacciones firmadas con **Ed25519** y la misma regla de difusión: **cada nodo conserva su propia copia de la cadena y la valida entera antes de aceptar lo que recibe**.

La interfaz es interactiva y didáctica: red de instituciones en vivo, competencia de mineros, ruleta ponderada, votación, laboratorio de ataques, bitácora y un panel «¿Qué está pasando?» que explica cada paso en lenguaje sencillo.

## Ejecutar en una máquina limpia

Requisitos: Python 3.10 o superior (probado en 3.14).

```bash
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1      Linux/macOS:  source .venv/bin/activate
pip install -r requirements.txt
flask run --no-reload
```

Abre <http://127.0.0.1:5000>. (`python app.py` equivale a lo anterior.)
Se recomienda `--no-reload`: la simulación vive en memoria y el recargador la reiniciaría con cada cambio de código.

Pruebas automáticas (núcleo sin Flask, API, fuzz, determinismo, rendimiento):

```bash
pytest            # ~570 pruebas, ~40 s
python -m nucleo.demo --modo pos --n 20 --bloques 30 --semilla x     # demo sin web
```

## Los cinco esquemas criptográficos (pestaña «Criptografía»)

Implementan los documentos de la carpeta [`esquemas/`](esquemas/). Cada uno se explica con una metáfora
cotidiana, se prueba en 3–4 pasos guiados, tiene botones de «Prueba a hacer trampa» y deja las cuentas
reales plegadas en «Ver las cuentas». No dependen del consenso: funcionan igual en PoW y PoS y no
necesitan un consorcio creado.

| # | En la interfaz | Esquema (documento) | Núcleo | Qué se puede probar |
|---|---|---|---|---|
| 1 | Partir un secreto en pedazos | Shamir sobre 𝔽ₚ ([esquema_shamir.pdf](esquemas/esquema_shamir.pdf)) | `nucleo/esquemas/shamir.py` | la llave maestra repartida «k de n» entre rectores; con menos de k sale basura; un pedazo falso se delata con la huella pública; el ejemplo (3, 5) sobre 𝔽₃₁ paso a paso |
| 2 | Respaldo en códigos QR | Shamir sobre GF(2⁸) + QR + criptografía visual ([qr_shamir.pdf](esquemas/qr_shamir.pdf)) | `nucleo/esquemas/qr_shamir.py` | hojas QR en formato SSQR1; CRC (error de copia) vs. suma interna (custodio tramposo); modo bóveda con AES-GCM; acetatos de Naor–Shamir y sombras XOR |
| 3 | Demostrar sin revelar | Conocimiento cero: protocolo Σ de Schnorr y 3-coloración GMW ([pipeline_conocimiento_cero.pdf](esquemas/pipeline_conocimiento_cero.pdf)) | `nucleo/esquemas/conocimiento_cero.py` | el horario de exámenes sin choques (187 rondas, tramposa atrapada); entrar sin decir la contraseña; impostor; número al azar repetido ⇒ llave expuesta; simulador |
| 4 | Firmar sin decir quién | Firmas de anillo AOS y LSAG ([firmas_anillo_pipeline.pdf](esquemas/firmas_anillo_pipeline.pdf)) | `nucleo/esquemas/anillo.py` | denuncia anónima (1 de n); la «vuelta» del anillo; urna en la que nadie vota dos veces (imagen de clave) |
| 5 | Una firma digital con números pequeños | Schnorr en ℤ*₂₃ y en y² = x³ + 2x + 2 sobre 𝔽₁₇, MuSig ([schnorr_juguete.pdf](esquemas/schnorr_juguete.pdf)) | `nucleo/esquemas/schnorr_juguete.py` | firmar y verificar con todas las cuentas; mensaje alterado; k repetido ⇒ x despejada; doble titulación (multifirma) y ataque de clave maliciosa |

Piezas compartidas: `secp256k1.py` (curva en Python puro, coordenadas jacobianas; esquemas 3 y 4),
`aritmetica.py` (inverso por Euclides extendido, Lagrange) y `azar.py` (azar derivado por HMAC). Una
sola dependencia nueva: `segno` (genera los QR, Python puro); AES-GCM sale de `cryptography`.

- **Sin estado en el servidor.** Las claves privadas de cada institución y el azar de los protocolos
  interactivos se derivan de un secreto que nunca sale del servidor (`SECRETO_ESQUEMAS`) y de una
  semilla de sesión; la interfaz solo ve una clave privada cuando el propio ejercicio la expone
  (responder dos retos con el mismo número al azar).
- **Vectores fijos.** `tests/test_esquemas.py` comprueba todos los números de los documentos (la tabla
  24, 12, 8, 12, 24 de Shamir; 0x53 → 0x99/0xDC/0x16 en GF(2⁸); 187 rondas; las firmas (4, 5) y (8, 16);
  las huellas de MuSig `51174631`, `21d0a206`, `3095fa0f`, `2881cf99`…). `tests/test_api_esquemas.py`
  cubre la API con dos fuzz (aleatorio y por mutación de cuerpos válidos): nunca un 5xx.
- **Didáctico.** Nada de esto es de tiempo constante ni está auditado; los grupos de juguete del
  esquema 5 no tienen seguridad alguna (lo dicen los propios documentos).

API: `GET /api/esquemas` lista los cinco con sus rutas (`/api/esquemas/shamir/…`, `/qr/…`, `/zk/…`,
`/anillo/…`, `/schnorr/…`). Contrato completo en
[`static/js/vistas/esquemas/LEEME.md`](static/js/vistas/esquemas/LEEME.md).

## Cómo usarla (2 minutos)

1. Elige **Proof of Work** o **Proof of Stake** y crea la red (N de 10 a 20, semilla, dificultad…). Cada modo conserva su propia red.
2. Crea transacciones (emisor → receptor → monto): se firman y quedan *pendientes*. Prueba las «trampas» (firma alterada, firmada por otra clave, saldo insuficiente).
3. **PoW:** pulsa *Minar* y mira competir a los mineros (nonce actual, intentos y último hash en vivo; todos se detienen al haber ganador). Mina ≥ 10 bloques y observa cómo la recompensa pasa de *pendiente* a *disponible* a las 6 confirmaciones.
4. **PoS:** inicia una ronda paso a paso (apuestas → sorteo → candidato → votación → aceptado/rechazado) o en automático. Marca un nodo como **deshonesto** para ver el rechazo, el castigo y el nuevo sorteo.
5. En **Laboratorio** manipula bloques o envía cadenas falsas a un nodo y comprueba que las rechaza (y por qué).
6. En **Criptografía** elige una de las cinco herramientas y sigue sus pasos (con los valores por defecto basta con pulsar los botones en orden).

## Estructura

```
app.py                  rutas Flask: sólo reciben, validan la entrada y responden JSON
nucleo/                 TODO el consenso; se ejecuta y prueba sin Flask
  cripto.py             claves Ed25519, serialización canónica, firmas de tx y de votos
  bloque.py             hash canónico, génesis, forma del bloque, hash_rapido
  libro.py              saldos derivados de la cadena (replay), madurez de recompensas
  validacion.py         reglas (a) hash/enlace, (b) firmas y saldos, (c) consenso PoW/PoS
  red.py                Reloj lógico, Bitácora, Nodo (copia propia + regla d), difusión
  pow.py                mineros por rondas, nonces disjuntos, desempate
  pos.py                sorteo ponderado, máquina de estados, votos firmados, castigo
  ataques.py            13 ataques del laboratorio + corrupción local
  simulacion.py         Simulacion (candado, rollback, pool) y Laboratorio (pow + pos)
  entradas.py           validación estricta de entradas
  esquemas/             los cinco esquemas criptográficos (Shamir, QR, conocimiento cero, anillo, Schnorr)
rutas_esquemas.py       rutas /api/esquemas/… (mismo estilo que app.py: validan y llaman al núcleo)
esquemas/               los cinco documentos (PDF) que implementa la pestaña «Criptografía»
templates/ static/      interfaz (JS vanilla en módulos ES + SVG, sin build ni CDN)
                        static/js/vistas/esquemas.js + esquemas/<id>.js: la pestaña «Criptografía»
tests/                  pytest: un test por caso de la sección 5 + fuzz + determinismo + esquemas
REPORTE.md              reporte breve de diseño y decisiones
```

## Decisiones clave (detalle en [REPORTE.md](REPORTE.md))

- **Saldos nunca se guardan:** se derivan repitiendo la cadena. El génesis (con claves públicas, saldos iniciales y parámetros) va dentro del hash, así que cualquier cadena es autovalidable y un nodo rechaza cadenas con otro génesis.
- **Desempate PoW:** si dos o más mineros hallan un nonce válido en la misma ronda gana el de **hash numéricamente menor** (y si empatara, el de menor índice); el resto queda como *obsoleto*.
- **Recompensa PoW:** la del bloque *h* se acredita al terminar de procesar el bloque *h*+6 y se puede gastar desde el bloque *h*+7.
- **Castigo PoS:** regla **A** por defecto (pierde toda la apuesta), regla **B** configurable (`α` con hasta 3 decimales). Lo castigado se **quema** y se registra en el siguiente bloque aceptado.
- **Reproducible:** claves, timestamps (reloj lógico) y azar derivan de la **semilla**; misma semilla + mismas acciones ⇒ misma cadena (se prueba también entre procesos con `PYTHONHASHSEED` distinto).
- **Robusto:** toda acción corre bajo candado y con *rollback*; cualquier error devuelve JSON con mensaje claro, nunca un traceback; un test de *fuzz* golpea todas las rutas con basura y exige cero errores 500.

## Casos de la sección 5 → pruebas

| Ámbito | Caso | Pruebas (`tests/…`) |
|---|---|---|
| Entradas | N fuera de 10–20 | `test_api_entradas::test_n_fuera_de_rango_rechazado`, `::test_n_10_y_20_aceptados`, `::test_n_no_entero_rechazado` |
| | Montos negativos, cero, no numéricos, vacíos | `test_api_entradas::test_monto_negativo_rechazado`, `::test_monto_cero_rechazado`, `::test_monto_no_numerico_rechazado`, `::test_monto_vacio_o_ausente_rechazado`, `::test_monto_enorme_rechazado` |
| | Emisor = receptor; nodos inexistentes | `test_api_entradas::test_emisor_igual_receptor_rechazado`, `::test_emisor_inexistente_422`, `::test_receptor_inexistente_422`, `::test_ruta_nodo_inexistente_404` |
| | Dificultad fuera de rango | `test_api_entradas::test_dificultad_fuera_de_rango_rechazada`, `::test_dificultad_3_y_5_aceptadas` |
| Transacciones | Firma alterada | `test_cripto::test_firma_alterada_no_verifica`, `test_libro::test_aplicar_tx_firma_alterada`, `test_api_pow::test_tx_trampa_firma_alterada_rechazada_en_pool` |
| | Firmada por otra clave | `test_libro::test_aplicar_tx_firma_de_otra_clave`, `test_api_pow::test_tx_trampa_otra_clave_rechazada` |
| | Saldo insuficiente | `test_libro::test_aplicar_tx_saldo_insuficiente_no_muta`, `test_api_pow::test_saldo_insuficiente_incluye_desglose` |
| | Doble gasto (mismo bloque / bloques distintos) | `test_validacion::test_doble_gasto_mismo_bloque_invalida_bloque`, `::test_replay_de_tx_en_bloque_posterior_invalida`, `::test_gasto_posterior_excede_saldo_tras_bloque_previo`, `test_api_pow::test_doble_gasto_entre_pendientes_rechazado` |
| | Pendientes vacía al minar/proponer | `test_api_pow::test_minar_sin_pendientes_409`, `test_api_pos::test_ronda_sin_pendientes_409_sin_bloquear_apuestas` |
| Cadena | Hash o `hash_anterior` alterado | `test_validacion::test_hash_alterado_detectado_en_ese_bloque`, `::test_hash_anterior_alterado_detectado` |
| | Cadena más corta o inválida | `test_red::test_cadena_mas_corta_rechazada_conserva_la_propia`, `::test_cadena_invalida_mas_larga_rechazada`, `::test_genesis_distinto_rechazado` |
| | Bloque intermedio manipulado | `test_validacion::test_intermedio_manipulado_invalida_cadena_completa`, `::test_validador_no_se_detiene_en_el_primer_error`, `test_red::test_ataque_rechazado_conserva_cadena_y_detecta_lo_esperado[…]` |
| PoW | Dos ganadores en la misma ronda | `test_pow::test_dos_validos_misma_ronda_gana_hash_menor`, `::test_empate_de_hash_gana_menor_indice` |
| | Minar mientras ya se mina | `test_pow::test_minar_concurrente_solo_una_peticion_procede`, `test_api_pow::test_minar_dos_veces_409_ya_minando` |
| | Dificultad sin resolver | `test_pow::test_limite_de_rondas_termina_sin_cambiar_cadena`, `::test_cancelacion_deja_estado_consistente` |
| | Recompensa antes de 6 confirmaciones | `test_libro::test_recompensa_pendiente_hasta_altura_h_mas_6`, `test_api_pow::test_gastar_recompensa_pendiente_422` |
| | Recompensa falsa | `test_validacion::test_recompensa_monto_distinto_rechazada` |
| | Nonces disjuntos; ≥ 10 bloques | `test_pow::test_nonces_disjuntos_por_minero`, `::test_minar_12_bloques_seguidos_d2` |
| PoS | Ningún validador con saldo | `test_pos::test_sin_validadores_con_saldo_409` |
| | Apuesta mayor al saldo, cero o negativa | `test_pos::test_apuestas_invalidas_rechazadas[…]`, `::test_apuestas_invalidas_no_aplican_ninguna_atomicidad` |
| | Votación exactamente en 2/3 | `test_pos::test_umbral_usa_aritmetica_entera_y_es_exacto`, `::test_votacion_manual_exacta_dos_tercios_acepta`, `::test_votacion_un_peso_menos_rechaza` |
| | Voto de no validador / doble voto | `test_pos::test_voto_de_no_validador_rechazado`, `::test_voto_doble_rechazado_y_proponente_no_vota_otra_vez` |
| | Proponente deshonesto | `test_pos::test_deshonesto_firma_rechazado_y_castigado_regla_a`, `::test_deshonesto_gasto_rechazado_y_castigado`, `::test_deshonesto_con_mas_de_dos_tercios_no_logra_colar_bloque` |
| | Todos castigados hasta quedar sin saldo | `test_pos::test_todos_los_validadores_castigados_ronda_abortada` |
| Aplicación | Reiniciar la simulación | `test_api_app::test_reiniciar_reemplaza_instancia_y_cambia_epoca`, `::test_reiniciar_con_minado_en_curso_cancela_el_hilo` |
| | Recargar a mitad de ronda | `test_api_app::test_estado_a_mitad_de_trabajo_pow_es_reconstruible`, `::test_estado_a_mitad_de_ronda_pos_conserva_la_fase` |
| | Dos pestañas a la vez | `test_api_app::test_dos_avanzar_simultaneos_solo_uno_procede`, `::test_dos_tx_simultaneas_que_exceden_saldo_solo_una_se_acepta` |
| | Peticiones directas mal formadas | `test_api_app::test_json_invalido_400` … `::test_excepcion_interna_devuelve_500_json_y_hace_rollback`, `test_fuzz_api` |

## API en una línea (todas devuelven JSON; los errores: `{ok:false, error, codigo}`)

```bash
curl -X POST localhost:5000/api/pow/simulacion -H "Content-Type: application/json" -d '{"n":12,"dificultad":3,"semilla":"demo"}'
curl -X POST localhost:5000/api/pow/tx         -H "Content-Type: application/json" -d '{"emisor":"N01","receptor":"N02","monto":25}'
curl -X POST localhost:5000/api/pow/minar      -H "Content-Type: application/json" -d '{}'
curl localhost:5000/api/pow/estado
```

Rutas principales: `POST /api/<pow|pos>/simulacion`, `GET …/estado`, `POST …/tx`, `POST /api/pow/minar|avanzar|cancelar`, `POST /api/pos/ronda[/apuestas|/avanzar|/voto|/cancelar]`, `POST /api/pos/nodos/<id>/deshonesto`, `POST …/laboratorio/ataque|corromper`, `GET …/bitacora|invariantes`, `GET /api/limites`.

## Limitaciones conocidas

- La red es una simulación en memoria (no hay red P2P real). La simulación en conexión local queda como trabajo futuro.
- Las claves se derivan de la semilla: es un simulador didáctico, no protege secretos.
- Los castigos de rondas abortadas se arrastran al siguiente bloque aceptado; la prueba completa del rechazo (votos en contra) no viaja en la cadena.
- El estado vive en un solo proceso: no ejecutar con varios *workers*.
