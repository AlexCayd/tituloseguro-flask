# Guion del video (5 a 8 minutos) · Título Seguro

Requisitos de la guía: ambas versiones, **un rechazo en PoS** y **la maduración de una recompensa en PoW**. Pon la liga en `REPORTE.md`.

Preparación: `flask run --no-reload`, pestaña nueva en <http://127.0.0.1:5000>. Usa semilla fija (p. ej. `demo`) para que se repita.

| Min | Qué mostrar | Qué decir |
|---|---|---|
| 0:00 | Portada y selector PoW / PoS | Qué es Título Seguro: una red de 10–20 instituciones educativas (UAN, UNAM, IPN…) que registran credenciales; cada una conserva su propia copia de la cadena. |
| 0:30 | Crear red PoW (N = 12, dificultad 3). Intentar N = 9 y N = 21 | Validación con mensaje claro. |
| 1:00 | Dos registros de credencial (p. ej. un título = 10 créditos de certificación); probar «falsificar la firma» y «créditos insuficientes» | Qué se firma; por qué se rechazan. |
| 1:45 | **Minar**: competencia en vivo (nonce, intentos, último hash), nonces disjuntos, ganador, todos se detienen, difusión y validación en cada nodo | Regla del desempate (hash menor) si hubo empate de ronda. |
| 3:00 | Autopiloto de 10+ bloques; mostrar **recompensas pendientes → disponibles a las 6 confirmaciones** (línea de maduración) | Altura *h* → *h*+6. |
| 4:00 | Laboratorio: manipular un bloque intermedio / enviar cadena corta; ver que se rechaza y por qué | Reglas (a)–(d). |
| 4:45 | Crear red PoS (N = 12, regla A). Ronda paso a paso: apuestas → sorteo (ruleta) → candidato → votación | Probabilidad ∝ apuesta; umbral 3V ≥ 2A. |
| 6:00 | **Marcar un nodo deshonesto** y repetir hasta que lo sorteen: votos en contra, **rechazo, castigo y nuevo sorteo** | Regla de castigo A (y B), pena quemada. |
| 7:00 | Reiniciar, recargar la página a mitad de ronda y abrir dos pestañas | Robustez: el estado vive en el servidor. |
| 7:30 | `pytest` (≈ 460 pruebas en verde) | Cierre. |
