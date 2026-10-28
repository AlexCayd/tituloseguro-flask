"""Esquema 1 · Compartir un secreto con el esquema de Shamir (documento «esquema_shamir.pdf»).

Un secreto S se divide en n partes de modo que CUALESQUIERA k de ellas lo reconstruyen y k − 1 no
revelan NADA. La idea es geométrica: un polinomio de grado k − 1 queda determinado por k puntos.

    Reparto (algoritmo 1):        f(x) = S + a1·x + … + a_{k−1}·x^{k−1}  (mod p),  parte i = (i, f(i))
    Reconstrucción (algoritmo 2): S = f(0) = Σ y_j·λ_j  con  λ_j = ∏_{m≠j} x_m / (x_m − x_j)  (mod p)

En el dominio de Título Seguro: la llave maestra con la que el consorcio firma sus títulos se reparte
entre n rectores; k de ellos, reunidos, la recuperan; menos de k no saben nada.
"""
import hashlib
from math import gcd

from .aritmetica import inverso_mod, lagrange_en_cero, validar_abscisas
from .azar import SISTEMA

M127 = 2**127 - 1          # primo de Mersenne de la implementación de referencia (sección 6)
M521 = 2**521 - 1          # primo de Mersenne mayor que 2^512: lo usamos para secretos de texto
P_TEXTO = M521
MAX_BYTES_TEXTO = 60       # 1 byte de marca + 60 bytes < 2^521
N_MAX = 9                  # partes como máximo en la interfaz
HEX_PARTE = 132            # ancho fijo (hex) de una parte módulo M521


# ------------------------------------------------------------ algoritmos 1 y 2
def horner(coefs, x, p):
    """Evalúa el polinomio (a0, a1, …) en x por el método de Horner."""
    y = 0
    for a in reversed(coefs):
        y = (y * x + a) % p
    return y


def repartir(s, k, n, p=M127, azar=SISTEMA):
    """Algoritmo 1: divide el secreto s en n partes (x, y) con umbral k. Coeficientes con azar criptográfico."""
    if not (0 <= s < p and 1 < k <= n < p):
        raise ValueError("parámetros inválidos: se requiere 0 ≤ s < p y 2 ≤ k ≤ n < p")
    coefs = [s] + [azar.randbelow(p) for _ in range(k - 1)]
    partes = [(i, horner(coefs, i, p)) for i in range(1, n + 1)]
    del coefs                                  # paso 15: borrar el polinomio
    return partes


def interpolar_en_cero(partes, p=M127):
    """La fórmula de Lagrange en x = 0, SIN conocer k.

    Con menos de k partes no falla: devuelve el valor en 0 de OTRO polinomio, sin relación con S.
    Por eso `reconstruir` exige conocer k (ver el recuadro «Sobre el umbral en la reconstrucción»).
    """
    xs = [x for x, _ in partes]
    validar_abscisas(xs, p)
    lam = lagrange_en_cero(xs, p)
    return sum(y * l for (_, y), l in zip(partes, lam)) % p


def reconstruir(partes, k, p=M127):
    """Algoritmo 2: reconstrucción con umbral conocido (rechaza conjuntos pequeños)."""
    if len(partes) < k:
        raise ValueError(f"partes insuficientes: se necesitan {k} y hay {len(partes)}")
    return interpolar_en_cero(partes, p)


# ------------------------------------------------------- secretos de texto
def texto_a_entero(texto: str) -> int:
    """Texto → entero menor que M521. Se antepone el byte 0x01 para conservar la longitud exacta."""
    datos = texto.encode("utf-8")
    if not 1 <= len(datos) <= MAX_BYTES_TEXTO:
        raise ValueError(f"el secreto debe tener entre 1 y {MAX_BYTES_TEXTO} bytes")
    return int.from_bytes(b"\x01" + datos, "big")


def entero_a_texto(v: int) -> dict:
    """Entero → texto, si es legible. Si no (p. ej. con partes de menos), muestra la «basura» que salió."""
    datos = v.to_bytes(max(1, (v.bit_length() + 7) // 8), "big")
    if len(datos) > 1 and datos[0] == 1:
        try:
            t = datos[1:].decode("utf-8")
            if t.isprintable():
                return {"legible": True, "texto": t, "hex": datos[1:].hex()}
        except UnicodeDecodeError:
            pass
    basura = "".join(c if c.isprintable() else "·" for c in datos.decode("latin-1"))[:48]
    return {"legible": False, "texto": basura, "hex": datos.hex()[:96]}


def huella_texto(texto: str) -> str:
    """Huella pública del secreto (SHA-256, 16 hex): permite detectar una parte falsa al reconstruir."""
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:16]


def _hex_parte(y):
    return f"{y:0{HEX_PARTE}x}"


# ---------------------------------------------------------------- demos (API)
def demo_repartir(secreto: str, k: int, n: int, azar=SISTEMA) -> dict:
    """Reparte un secreto de texto en n partes con umbral k sobre el primo M521."""
    if not 2 <= k <= n <= N_MAX:
        raise ValueError(f"se requiere 2 ≤ k ≤ n ≤ {N_MAX}")
    s = texto_a_entero(secreto)
    partes = repartir(s, k, n, P_TEXTO, azar)
    return {
        "esquema": "shamir", "k": k, "n": n,
        "primo": "2^521 − 1", "primo_bits": 521, "grado": k - 1,
        "huella": huella_texto(secreto),
        "partes": [{"x": x, "y": _hex_parte(y)} for x, y in partes],
    }


def demo_reconstruir(partes, k: int, huella=None) -> dict:
    """Junta t partes. Con t < k muestra la «basura» de Lagrange; con t ≥ k comprueba la huella pública."""
    pares = [(x, y) for x, y in partes]
    v = interpolar_en_cero(pares, P_TEXTO)
    lectura = entero_a_texto(v)
    suficientes = len(pares) >= k
    coincide = None
    if huella is not None:
        coincide = lectura["legible"] and huella_texto(lectura["texto"]) == huella
    if not suficientes:
        veredicto = "insuficiente"
    elif coincide is False or (coincide is None and not lectura["legible"]):
        veredicto = "alterado"
    else:
        veredicto = "abierto"
    lam = lagrange_en_cero([x for x, _ in pares], P_TEXTO)
    return {
        "esquema": "shamir", "k": k, "partes_usadas": len(pares), "faltan": max(0, k - len(pares)),
        "suficientes": suficientes, "veredicto": veredicto, "resultado": lectura,
        "coincide_huella": coincide,
        "lambdas": [{"x": x, "lambda": _hex_parte(l)} for (x, _), l in zip(pares, lam)],
    }


# ------------------------------------------- ejemplo numérico del documento (§4)
P_JUGUETE = 31


def _fraccion(num, den):
    g = gcd(num, den) or 1
    num, den = num // g, den // g
    if den < 0:
        num, den = -num, -den
    return num, den


def ejemplo_juguete(secreto=13, coefs=(7, 4), elegidas=(1, 2, 3), n=5) -> dict:
    """El ejemplo (3, 5) sobre F31 del documento: f(x) = 13 + 7x + 4x² (mod 31), paso a paso.

    Con 3 partes elegidas reconstruye con los coeficientes de Lagrange (como fracciones y módulo 31).
    Con 2 partes muestra que, para CADA secreto candidato 0..30, existe exactamente una parábola que
    pasa por ellas: los 31 secretos son igual de posibles.
    """
    p = P_JUGUETE
    k = len(coefs) + 1
    if not (0 <= secreto < p and all(0 <= a < p for a in coefs)):
        raise ValueError("el secreto y los coeficientes deben estar entre 0 y 30")
    elegidas = list(elegidas)
    if not elegidas or len(set(elegidas)) != len(elegidas) or not all(1 <= x <= n for x in elegidas):
        raise ValueError(f"elige entre 1 y {n} partes distintas, numeradas del 1 al {n}")
    todos = (secreto, *coefs)
    tabla = [{"x": x, "sin_reducir": sum(a * x**j for j, a in enumerate(todos)),
              "y": horner(todos, x, p)} for x in range(1, n + 1)]
    ys = {f["x"]: f["y"] for f in tabla}
    salida = {"p": p, "k": k, "n": n, "secreto": secreto, "coeficientes": list(todos),
              "tabla": tabla, "elegidas": elegidas}
    if len(elegidas) >= k:
        lambdas, terminos = [], []
        for xj in elegidas:
            num, den = 1, 1
            for xm in elegidas:
                if xm != xj:
                    num *= xm
                    den *= xm - xj
            num, den = _fraccion(num, den)
            mod = num * inverso_mod(den, p) % p
            lambdas.append({"x": xj, "num": num, "den": den, "mod": mod})
            terminos.append((ys[xj], num if den == 1 else mod))
        total = sum(y * l for y, l in terminos)
        salida.update(suficientes=True, lambdas=lambdas,
                      terminos=[{"y": y, "lambda": l} for y, l in terminos],
                      total=total, reconstruido=total % p)
    else:
        salida["suficientes"] = False
        if len(elegidas) == k - 1 == 2:
            (x1, x2) = elegidas
            y1, y2 = ys[x1], ys[x2]
            det_inv = inverso_mod(x1 * x2 * x2 - x2 * x1 * x1, p)
            candidatos = []
            for s2 in range(p):
                a1 = ((y1 - s2) * x2 * x2 - (y2 - s2) * x1 * x1) * det_inv % p
                a2 = (x1 * (y2 - s2) - x2 * (y1 - s2)) * det_inv % p
                candidatos.append({"secreto": s2, "a1": a1, "a2": a2})
            salida["candidatos"] = candidatos
    return salida
