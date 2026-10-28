"""Esquema 4 · Compartición de secretos con códigos QR (documento «qr_shamir.pdf»).

Dos maneras de juntar Shamir y QR:

  A. El QR como CONTENEDOR de la parte (secciones 3 a 5).
     · Shamir byte a byte sobre GF(2^8) con el polinomio de AES x^8 + x^4 + x^3 + x + 1 (0x11B): las
       partes miden lo mismo que el secreto; la suma es XOR (algoritmos 1 a 3).
     · Formato textual SSQR1 : ID : k : n : x : DATOS(Base32) : CRC32, todo en el alfabeto
       alfanumérico del QR (algoritmos 4 y 5).
     · Dos niveles de integridad: el CRC detecta errores de lectura o copia de UN QR; 4 bytes de
       SHA-256 del secreto viajan DENTRO del secreto repartido y delatan a un custodio que altera su
       parte y recalcula el CRC.
     · Modo híbrido (sección 5): para documentos largos se cifra con AES-GCM y sólo se reparte la clave;
       el criptograma va en un QR «de bóveda» que puede copiarse sin riesgo.
  B. El QR como SECRETO: criptografía visual (sección 6).
     · (n, n) por XOR: n − 1 sombras de ruido y la última = M ⊕ S1 ⊕ … ; el XOR de todas devuelve M.
     · (2, 2) de Naor y Shamir: cada módulo se expande a 2×2 subpíxeles; al encimar dos acetatos
       (OR, tinta sobre tinta) los módulos negros quedan 4/4 negros y los blancos 2/4: el ojo ve el QR.

En Título Seguro: el respaldo en papel de la clave de la bóveda de títulos (A) y un QR de verificación
de un título que sólo aparece al encimar dos hojas de ruido (B).
"""
import base64
import hashlib
import re
import zlib

import segno
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .azar import SISTEMA

# ============================================================ GF(2^8) (listing 1)
EXP, LOG = [0] * 510, [0] * 256
_x = 1
for _i in range(255):                    # 3 es generador del grupo multiplicativo
    EXP[_i] = EXP[_i + 255] = _x
    LOG[_x] = _i
    _x ^= (_x << 1) ^ (0x11B if _x & 0x80 else 0)     # x ← 3·x
    _x &= 0xFF
del _x, _i


def mul(a, b):
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


def inv(a):
    if a == 0:
        raise ZeroDivisionError("0 no es invertible")
    return EXP[255 - LOG[a]]


def repartir_bytes(secreto: bytes, k: int, n: int, azar=SISTEMA):
    """Algoritmo 2: n partes (x, bytes); cualesquiera k reconstruyen. Un polinomio independiente por byte."""
    if not (2 <= k <= n <= 255):
        raise ValueError("se requiere 2 <= k <= n <= 255")
    partes = {x: bytearray() for x in range(1, n + 1)}
    for b in secreto:
        coefs = [b] + [azar.randbelow(256) for _ in range(k - 1)]
        for x in partes:
            y = 0
            for a in reversed(coefs):                    # Horner; la suma en GF(2^8) es XOR
                y = mul(y, x) ^ a
            partes[x].append(y)
    return [(x, bytes(v)) for x, v in partes.items()]


def reconstruir_bytes(partes):
    """Algoritmo 3: Lagrange en 0 sobre GF(2^8) (ahí −x = x y la resta es XOR)."""
    xs = [x for x, _ in partes]
    if 0 in xs or len(set(xs)) != len(xs):
        raise ValueError("abscisas nulas o repetidas")
    lam = []
    for xj in xs:
        num = den = 1
        for xm in xs:
            if xm != xj:
                num = mul(num, xm)
                den = mul(den, xm ^ xj)
        lam.append(mul(num, inv(den)))
    largo = len(partes[0][1])
    salida = bytearray(largo)
    for (_, y), l in zip(partes, lam):
        for t in range(largo):
            salida[t] ^= mul(y[t], l)
    return bytes(salida)


# ============================================================== formato SSQR1
PREFIJO = "SSQR1"
PREFIJO_BOVEDA = "SSQRV"
MAX_SECRETO = 120            # bytes de un secreto repartido directamente
MAX_DOCUMENTO = 800          # bytes de un documento en modo bóveda
_RE_PARTE = re.compile(r"^SSQR1:([0-9A-F]{8}):([0-9]{1,3}):([0-9]{1,3}):([0-9]{1,3}):([A-Z2-7]{1,400}):([0-9A-F]{8})$")


class ParteInvalida(ValueError):
    """Una lectura o reconstrucción falló por una razón didáctica (código estable para la interfaz)."""

    def __init__(self, codigo, mensaje):
        super().__init__(mensaje)
        self.codigo = codigo


def b32(b: bytes) -> str:
    """Base32 sin relleno: sólo A–Z y 2–7, cabe en el modo alfanumérico del QR."""
    return base64.b32encode(b).decode().rstrip("=")


def de_b32(s: str) -> bytes:
    return base64.b32decode(s + "=" * (-len(s) % 8))


def crc(texto: str) -> str:
    return f"{zlib.crc32(texto.encode()):08X}"


def codificar_parte(ident: str, k: int, n: int, x: int, datos: bytes) -> str:
    cuerpo = f"{PREFIJO}:{ident}:{k}:{n}:{x}:{b32(datos)}"
    return f"{cuerpo}:{crc(cuerpo)}"


def decodificar_parte(texto: str):
    """Texto SSQR1 → (ident, k, n, x, datos). Lanza ParteInvalida('formato' | 'danada')."""
    if not isinstance(texto, str):
        raise ParteInvalida("formato", "Una parte debe ser texto.")
    texto = texto.strip()
    m = _RE_PARTE.match(texto)
    if not m:
        raise ParteInvalida("formato", "Esto no es una parte SSQR1 (formato SSQR1:ID:k:n:x:DATOS:CRC).")
    ident, k, n, x, datos, recibido = m.groups()
    if crc(texto[: -len(recibido) - 1]) != recibido:
        raise ParteInvalida("danada", f"La parte {x} está dañada: su CRC no cuadra (error al leerla o copiarla).")
    k, n, x = int(k), int(n), int(x)
    if not (2 <= k <= n <= 255 and 1 <= x <= n):
        raise ParteInvalida("formato", f"La parte {x} trae un umbral o un índice imposible.")
    try:
        bytes_ = de_b32(datos)
    except ValueError:
        raise ParteInvalida("formato", f"Los datos de la parte {x} no son Base32 válido.") from None
    return ident, k, n, x, bytes_


def repartir_en_textos(secreto: bytes, k: int, n: int, azar=SISTEMA):
    """Algoritmo 4 (sin la imagen): ID aleatorio + suma de verificación interna + reparto + SSQR1."""
    ident = azar.bytes(4).hex().upper()                  # aleatorio: NO se deriva del secreto
    protegido = secreto + hashlib.sha256(secreto).digest()[:4]
    return ident, [codificar_parte(ident, k, n, x, y) for x, y in repartir_bytes(protegido, k, n, azar)]


def reconstruir_de_textos(textos):
    """Algoritmo 5: lee, comprueba CRC, ID, umbral y la suma interna. Devuelve el secreto (bytes)."""
    partes = [decodificar_parte(t) for t in textos]
    if not partes:
        raise ParteInvalida("insuficientes", "No hay ninguna parte.")
    if len({p[0] for p in partes}) != 1:
        raise ParteInvalida("mezcladas", "Las partes pertenecen a secretos distintos (sus ID no coinciden).")
    if len({(p[1], p[2]) for p in partes}) != 1 or len({len(p[4]) for p in partes}) != 1:
        raise ParteInvalida("mezcladas", "Las partes no son del mismo reparto (umbral o tamaño distintos).")
    if len({p[3] for p in partes}) != len(partes):
        raise ParteInvalida("repetidas", "Hay una parte repetida: cada custodio cuenta una sola vez.")
    k = partes[0][1]
    if len(partes) < k:
        raise ParteInvalida("insuficientes", f"Se necesitan {k} partes y hay {len(partes)}.")
    protegido = reconstruir_bytes([(p[3], p[4]) for p in partes])
    secreto, chk = protegido[:-4], protegido[-4:]
    if len(protegido) < 5 or hashlib.sha256(secreto).digest()[:4] != chk:
        raise ParteInvalida("incorrecta", "La reconstrucción no verifica: alguna parte es incorrecta (un custodio la alteró).")
    return secreto


# ============================================================== imagen del QR
NIVELES = ("L", "M", "Q", "H")


def matriz_qr(texto: str, nivel: str = "H", borde: int = 0):
    """Matriz binaria (1 = módulo negro) y versión. `borde` agrega zona de silencio."""
    qr = segno.make(texto, error=nivel.lower(), micro=False, boost_error=False)
    m = [list(fila) for fila in qr.matrix]
    if borde:
        ancho = len(m[0]) + 2 * borde
        m = ([[0] * ancho for _ in range(borde)] + [[0] * borde + f + [0] * borde for f in m]
             + [[0] * ancho for _ in range(borde)])
    return m, qr.version


def filas(m):
    """Matriz → lista de cadenas '0101…' (compacta para viajar en JSON)."""
    return ["".join("1" if v else "0" for v in f) for f in m]


# ================================================================ modo bóveda
def proteger(documento: bytes, k: int, n: int, azar=SISTEMA):
    """Documento cifrado con AES-GCM en un QR público; las partes sólo llevan la clave de 16 bytes."""
    clave = azar.bytes(16)
    nonce = azar.bytes(12)
    ct = AESGCM(clave).encrypt(nonce, documento, None)   # criptograma ‖ etiqueta
    boveda = f"{PREFIJO_BOVEDA}:{b32(nonce + ct)}"
    ident = azar.bytes(4).hex().upper()
    partes = [codificar_parte(ident, k, n, x, y) for x, y in repartir_bytes(clave, k, n, azar)]
    return boveda, partes


def recuperar(boveda: str, textos) -> bytes:
    if not (isinstance(boveda, str) and re.fullmatch(r"SSQRV:[A-Z2-7]{40,2000}", boveda.strip())):
        raise ParteInvalida("formato", "El QR de bóveda no tiene el formato SSQRV:DATOS.")
    datos = de_b32(boveda.strip().split(":", 1)[1])
    partes = [decodificar_parte(t) for t in textos]
    if len({p[0] for p in partes}) != 1:
        raise ParteInvalida("mezcladas", "Las partes pertenecen a secretos distintos.")
    k = partes[0][1]
    if len(partes) < k:
        raise ParteInvalida("insuficientes", f"Se necesitan {k} partes y hay {len(partes)}.")
    if len({p[3] for p in partes}) != len(partes) or len({len(p[4]) for p in partes}) != 1:
        raise ParteInvalida("mezcladas", "Hay partes repetidas o de tamaños distintos.")
    clave = reconstruir_bytes([(p[3], p[4]) for p in partes])
    if len(clave) != 16:
        raise ParteInvalida("incorrecta", "La clave reconstruida no mide 16 bytes.")
    try:
        return AESGCM(clave).decrypt(datos[:12], datos[12:], None)
    except InvalidTag:
        raise ParteInvalida("incorrecta", "AES-GCM no descifra: alguna parte es incorrecta (la etiqueta lo delata).") from None


# ======================================================= criptografía visual
def repartir_xor(M, n: int, azar=SISTEMA):
    """(n, n) por XOR: n − 1 sombras uniformes; la última = M ⊕ S1 ⊕ … ⊕ S_{n−1}."""
    if n < 2:
        raise ValueError("se necesitan al menos 2 sombras")
    alto, ancho = len(M), len(M[0])
    sombras = []
    for _ in range(n - 1):
        bits = azar.bytes(alto * ancho)
        sombras.append([[bits[i * ancho + j] & 1 for j in range(ancho)] for i in range(alto)])
    ultima = [fila[:] for fila in M]
    for S in sombras:
        for i in range(alto):
            for j in range(ancho):
                ultima[i][j] ^= S[i][j]
    return sombras + [ultima]


def combinar_xor(sombras):
    alto, ancho = len(sombras[0]), len(sombras[0][0])
    R = [[0] * ancho for _ in range(alto)]
    for S in sombras:
        for i in range(alto):
            for j in range(ancho):
                R[i][j] ^= S[i][j]
    return R


PATRONES = ((1, 1, 0, 0), (0, 0, 1, 1), (1, 0, 1, 0), (0, 1, 0, 1), (1, 0, 0, 1), (0, 1, 1, 0))


def repartir_naor_shamir(M, azar=SISTEMA):
    """(2, 2): módulo blanco → mismo patrón en A y B; módulo negro → patrones complementarios."""
    alto, ancho = len(M), len(M[0])
    A = [[0] * (2 * ancho) for _ in range(2 * alto)]
    B = [[0] * (2 * ancho) for _ in range(2 * alto)]
    for i in range(alto):
        for j in range(ancho):
            p = PATRONES[azar.randbelow(6)]
            q = p if M[i][j] == 0 else tuple(1 - v for v in p)
            for t, (di, dj) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1))):
                A[2 * i + di][2 * j + dj] = p[t]
                B[2 * i + di][2 * j + dj] = q[t]
    return A, B


def superponer(A, B):
    """Tinta sobre tinta: OR lógico."""
    return [[a | b for a, b in zip(fa, fb)] for fa, fb in zip(A, B)]


def recuperar_modulos(S):
    """Promedia bloques 2×2: negro → 4/4, blanco → 2/4; umbral 3/4."""
    alto, ancho = len(S) // 2, len(S[0]) // 2
    return [[1 if (S[2 * i][2 * j] + S[2 * i][2 * j + 1] + S[2 * i + 1][2 * j] + S[2 * i + 1][2 * j + 1]) > 3 else 0
             for j in range(ancho)] for i in range(alto)]


# ================================================================ demos (API)
def _qr_publico(texto, nivel):
    m, version = matriz_qr(texto, nivel)
    return {"version": version, "modulos": len(m), "filas": filas(m)}


def demo_repartir(secreto: str, k: int, n: int, nivel: str = "H", azar=SISTEMA) -> dict:
    datos = secreto.encode("utf-8")
    if not 1 <= len(datos) <= MAX_SECRETO:
        raise ValueError(f"el secreto debe tener entre 1 y {MAX_SECRETO} bytes")
    if not 2 <= k <= n <= 9:
        raise ValueError("se requiere 2 ≤ k ≤ n ≤ 9")
    ident, textos = repartir_en_textos(datos, k, n, azar)
    return {"esquema": "qr", "id": ident, "k": k, "n": n, "nivel": nivel, "bytes_secreto": len(datos),
            "partes": [{"x": i + 1, "texto": t, "qr": _qr_publico(t, nivel)} for i, t in enumerate(textos)]}


def demo_leer(textos) -> dict:
    """Simula escanear los QR elegidos. Siempre responde con un veredicto (los fallos son la lección)."""
    try:
        secreto = reconstruir_de_textos(textos)
    except ParteInvalida as e:
        return {"esquema": "qr", "abierto": False, "codigo": e.codigo, "mensaje": str(e), "partes_leidas": len(textos)}
    return {"esquema": "qr", "abierto": True, "codigo": "abierto", "partes_leidas": len(textos),
            "secreto": secreto.decode("utf-8", errors="replace"),
            "mensaje": "Las partes cuadran: CRC, identificador, umbral y suma de verificación interna."}


def alterar_parte(texto: str, modo: str) -> str:
    """'mancha': cambia un carácter de DATOS y deja el CRC viejo (error de copia → lo delata el CRC).
    'trampa': cambia un carácter y RECALCULA el CRC (custodio malicioso → lo delata la suma interna)."""
    ident, k, n, x, datos = decodificar_parte(texto)
    alterado = bytearray(datos)
    alterado[0] ^= 0x5A
    nuevo = codificar_parte(ident, k, n, x, bytes(alterado))
    if modo == "trampa":
        return nuevo
    viejo_crc = texto.strip().rsplit(":", 1)[1]
    return nuevo.rsplit(":", 1)[0] + ":" + viejo_crc


def demo_boveda(documento: str, k: int, n: int, nivel: str = "M", azar=SISTEMA) -> dict:
    datos = documento.encode("utf-8")
    if not 1 <= len(datos) <= MAX_DOCUMENTO:
        raise ValueError(f"el documento debe tener entre 1 y {MAX_DOCUMENTO} bytes")
    boveda, partes = proteger(datos, k, n, azar)
    return {"esquema": "qr_boveda", "k": k, "n": n, "boveda": {"texto": boveda, "qr": _qr_publico(boveda, nivel)},
            "partes": [{"x": i + 1, "texto": t, "qr": _qr_publico(t, nivel)} for i, t in enumerate(partes)]}


def demo_abrir_boveda(boveda: str, textos) -> dict:
    try:
        doc = recuperar(boveda, textos)
    except ParteInvalida as e:
        return {"esquema": "qr_boveda", "abierto": False, "codigo": e.codigo, "mensaje": str(e)}
    return {"esquema": "qr_boveda", "abierto": True, "codigo": "abierto", "documento": doc.decode("utf-8", errors="replace"),
            "mensaje": "AES-GCM descifró y comprobó la etiqueta: el documento está íntegro."}


def demo_visual(texto: str, esquema: str, sombras: int = 3, azar=SISTEMA) -> dict:
    """QR secreto partido en sombras de ruido. La combinación la hace la interfaz (XOR u OR)."""
    M, version = matriz_qr(texto, "H", borde=2)
    if esquema == "xor":
        partes = repartir_xor(M, sombras, azar)
    elif esquema == "naor_shamir":
        partes = list(repartir_naor_shamir(M, azar))
    else:
        raise ValueError("esquema visual desconocido")
    return {"esquema": "qr_visual", "tipo": esquema, "version": version, "modulos": len(M), "secreto": filas(M),
            "sombras": [filas(S) for S in partes]}
