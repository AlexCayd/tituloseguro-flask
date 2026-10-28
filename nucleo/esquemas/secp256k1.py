"""Curva secp256k1 en Python puro (la curva de Bitcoin), para los esquemas 2 y 3.

Sigue la implementación de referencia del documento de conocimiento cero (sección 6): puntos afines,
suma, doblado y multiplicación por doblado y suma. El grupo tiene orden primo N (cofactor 1), así
que todo punto válido distinto del infinito pertenece al subgrupo correcto.

Además trae lo que piden las firmas de anillo (etapa 3 del documento de firmas de anillo):
  · codificación INYECTIVA (cada pieza va precedida de su longitud),
  · SEPARACIÓN DE DOMINIO (cada uso lleva su etiqueta),
  · reducción AMPLIA a escalar (64 bytes de SHA-512 módulo N, no 32: sin sesgo),
  · hash a punto (probar e incrementar) para la imagen de clave de LSAG.

Didáctico: la aritmética NO es de tiempo constante (filtra información por canales laterales).
"""
import hashlib
import re

P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
INFINITO = None          # el neutro del grupo (punto al infinito)

_RE_PUNTO = re.compile(r"^0[23][0-9a-f]{64}$")
_RE_ESCALAR = re.compile(r"^[0-9a-f]{64}$")


# ------------------------------------------------------------------ grupo
def en_curva(Q):
    if Q is None:
        return False
    x, y = Q
    return 0 <= x < P and 0 <= y < P and (y * y - x * x * x - 7) % P == 0


def neg(Q):
    return None if Q is None else (Q[0], (-Q[1]) % P)


def suma(A, B):
    if A is None:
        return B
    if B is None:
        return A
    (x1, y1), (x2, y2) = A, B
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if A == B:
        lam = 3 * x1 * x1 * pow(2 * y1, -1, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return (x3, (lam * (x1 - x3) - y1) % P)


def mult_afin(k, Q):
    """k·Q por doblado y suma en coordenadas afines (la versión del documento; referencia de las pruebas)."""
    R = None
    k %= N
    while k:
        if k & 1:
            R = suma(R, Q)
        Q = suma(Q, Q)
        k >>= 1
    return R


# --- Mismo doblado y suma, pero en coordenadas jacobianas (X, Y, Z) ↔ (X/Z², Y/Z³): evita una
# --- inversión modular en cada paso y deja una sola al final. Mismo resultado, unas 4 veces más rápido.
def _doblar_j(X, Y, Z):
    if Y == 0:
        return None
    YY = Y * Y % P
    S = 4 * X * YY % P
    M = 3 * X * X % P                    # a = 0 en secp256k1
    X3 = (M * M - 2 * S) % P
    return X3, (M * (S - X3) - 8 * YY * YY) % P, 2 * Y * Z % P


def _sumar_mixto(J, Q):
    """Jacobiano + afín."""
    if J is None:
        return (Q[0], Q[1], 1)
    X1, Y1, Z1 = J
    ZZ = Z1 * Z1 % P
    U2 = Q[0] * ZZ % P
    S2 = Q[1] * Z1 * ZZ % P
    if U2 == X1:
        return _doblar_j(X1, Y1, Z1) if S2 == Y1 else None
    H = (U2 - X1) % P
    R = (S2 - Y1) % P
    HH = H * H % P
    HHH = H * HH % P
    V = X1 * HH % P
    X3 = (R * R - HHH - 2 * V) % P
    return X3, (R * (V - X3) - Y1 * HHH) % P, H * Z1 % P


def _a_afin(J):
    if J is None:
        return None
    X, Y, Z = J
    zi = pow(Z, -1, P)
    zi2 = zi * zi % P
    return (X * zi2 % P, Y * zi2 * zi % P)


def mult(k, Q):
    """k·Q por doblado y suma (k se reduce módulo N)."""
    k %= N
    if Q is None or k == 0:
        return None
    J = None
    for bit in bin(k)[2:]:
        if J is not None:
            J = _doblar_j(*J)
        if bit == "1":
            J = _sumar_mixto(J, Q)
    return _a_afin(J)


def _tabla_base():
    tabla, Q = [], G
    for _ in range(256):
        tabla.append(Q)
        Q = suma(Q, Q)
    return tabla


_TABLA_G = _tabla_base()     # 2^i·G precalculados: k·G sólo necesita sumas


def mult_base(k):
    """k·G usando la tabla de potencias de 2 del generador."""
    J = None
    k %= N
    i = 0
    while k:
        if k & 1:
            J = _sumar_mixto(J, _TABLA_G[i])
        k >>= 1
        i += 1
    return _a_afin(J)


# ---------------------------------------------------------- codificaciones
def comprimir(Q) -> bytes:
    """Punto → 33 bytes (02/03 según la paridad de y, seguido de x)."""
    if Q is None:
        raise ValueError("el punto al infinito no se codifica")
    return bytes([2 + (Q[1] & 1)]) + Q[0].to_bytes(32, "big")


def punto_hex(Q) -> str:
    return comprimir(Q).hex()


def descomprimir(dato):
    """33 bytes (o 66 hex) → punto validado. Lanza ValueError si no es un punto de la curva."""
    if isinstance(dato, str):
        if not _RE_PUNTO.match(dato):
            raise ValueError("un punto se escribe con 66 caracteres hexadecimales que empiezan con 02 o 03")
        dato = bytes.fromhex(dato)
    if len(dato) != 33 or dato[0] not in (2, 3):
        raise ValueError("codificación de punto inválida")
    x = int.from_bytes(dato[1:], "big")
    if x >= P:
        raise ValueError("coordenada x fuera del campo")
    rhs = (pow(x, 3, P) + 7) % P
    y = pow(rhs, (P + 1) // 4, P)          # P ≡ 3 (mod 4): raíz cuadrada directa
    if y * y % P != rhs:
        raise ValueError("ese x no corresponde a ningún punto de la curva")
    if (y & 1) != (dato[0] & 1):
        y = P - y
    return (x, y)


def escalar_hex(k: int) -> str:
    return (k % N).to_bytes(32, "big").hex()


def escalar_de_hex(texto: str) -> int:
    """64 hex → escalar CANÓNICO (< N). Rechaza codificaciones no canónicas (maleabilidad)."""
    if not isinstance(texto, str) or not _RE_ESCALAR.match(texto):
        raise ValueError("un escalar se escribe con 64 caracteres hexadecimales en minúsculas")
    v = int(texto, 16)
    if v >= N:
        raise ValueError("escalar no canónico (mayor o igual que el orden del grupo)")
    return v


# ------------------------------------------------------------------ hashes
def codifica(*partes) -> bytes:
    """Concatena con prefijo de longitud: («ab»,«c») y («a»,«bc») ya no coinciden."""
    out = []
    for p in partes:
        if p is None:                       # el punto al infinito se codifica vacío
            p = b""
        elif isinstance(p, str):
            p = p.encode("utf-8")
        elif isinstance(p, int):
            p = p.to_bytes(32, "big")
        elif isinstance(p, tuple):
            p = comprimir(p)
        out.append(len(p).to_bytes(8, "big") + p)
    return b"".join(out)


def h_escalar(dominio: bytes, *partes) -> int:
    """Hash a escalar: SHA-512 (64 bytes) reducido módulo N, con etiqueta de dominio."""
    return int.from_bytes(hashlib.sha512(codifica(dominio, *partes)).digest(), "big") % N


def h_punto(dominio: bytes, *partes):
    """Hash a punto por «probar e incrementar»: nadie conoce el logaritmo del punto resultante."""
    base = codifica(dominio, *partes)
    contador = 0
    while True:
        x = int.from_bytes(hashlib.sha256(base + contador.to_bytes(4, "big")).digest(), "big")
        if x < P:
            rhs = (pow(x, 3, P) + 7) % P
            y = pow(rhs, (P + 1) // 4, P)
            if y * y % P == rhs:
                return (x, y if y % 2 == 0 else P - y)
        contador += 1
