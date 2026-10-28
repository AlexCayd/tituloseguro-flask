"""Los cinco esquemas criptográficos de la carpeta `esquemas/` (PDF del Dr. José de Jesús Ángel Ángel).

Cada módulo sigue los algoritmos de su documento y se ejecuta y prueba sin Flask:

    shamir.py               1 · Esquema de Shamir: partir un secreto en n partes, k lo reconstruyen
    anillo.py               2 · Firmas de anillo AOS y LSAG: firmar «en nombre del grupo» sin decir quién
    conocimiento_cero.py    3 · Conocimiento cero: protocolo Σ de Schnorr y 3-coloración de GMW
    qr_shamir.py            4 · Shamir sobre GF(2^8) con las partes en códigos QR + criptografía visual
    schnorr_juguete.py      5 · Firma de Schnorr con números pequeños (Z*23 y curva sobre F17) y MuSig

Piezas compartidas: `secp256k1.py` (curva elíptica en Python puro para los esquemas 2 y 3),
`aritmetica.py` (inverso modular, Lagrange) y `azar.py` (azar reproducible a partir de una semilla).

Son implementaciones DIDÁCTICAS: no son de tiempo constante ni están auditadas. Sirven para ver
cómo funciona cada esquema, no para proteger secretos reales.
"""
