"""Esquema 3 · Pruebas de conocimiento cero (documento «pipeline_conocimiento_cero.pdf»).

Un probador (Peggy) convence a un verificador (Víctor) de que una afirmación es verdadera, o de que
conoce un secreto, SIN revelar nada más. Dos construcciones del documento:

  A. Protocolo Σ de Schnorr (sección 2): Peggy conoce x con Y = x·G.
       compromiso T = r·G  →  reto c (lo elige Víctor)  →  respuesta s = r + c·x (mod N)
       Víctor acepta si s·G = T + c·Y.  Nunca ve x.
     · Solidez especial (prop. 1): dos respuestas al MISMO compromiso con retos distintos revelan
       x = (s1 − s2)/(c1 − c2). Por eso r jamás se reutiliza (el error de la PlayStation 3).
     · Simulador (alg. 2): sin x, eligiendo c y s primero, se fabrica T = s·G − c·Y que también
       verifica: la conversación no le sirve a Víctor para convencer a nadie más.
     · Versión no interactiva (Fiat–Shamir, alg. 3): c = H(dominio ‖ G ‖ Y ‖ T ‖ m).
  B. 3-coloración de Goldreich–Micali–Wigderson (sección 3): Peggy conoce una coloración válida de
     un grafo (vecinos de distinto color). En cada ronda baraja los 3 colores, se compromete con el
     color de cada vértice en «sobres» (hash con nonce de 256 bits) y abre SÓLO los dos extremos de la
     arista que pide Víctor. Una tramposa es descubierta con probabilidad ≥ 1/|E| por ronda:
     k = ⌈|E|·ln(1/ε)⌉ rondas (187 para |E| = 14 y ε = 10⁻⁶).

En Título Seguro: una institución demuestra que posee su llave privada sin enseñarla (A) y la
coordinadora de exámenes demuestra que tiene un horario sin choques sin revelarlo (B).

Los protocolos son interactivos: el azar del probador se DERIVA de un secreto del servidor y de un
identificador de ronda (ver azar.Flujo), así el servidor no guarda estado entre mensajes.
"""
import hashlib
import math

from . import secp256k1 as C
from .azar import SISTEMA, Flujo

DOM_FS = b"TituloSeguro/zk-schnorr/v1"
DOM_CLAVE = b"TituloSeguro/zk/clave/v1"
DOM_NONCE = b"TituloSeguro/zk/nonce/v1"
DOM_IMPOSTOR = b"TituloSeguro/zk/impostor/v1"


# =================================================================== A · Schnorr
def clave_derivada(secreto: bytes, semilla: str, ident: str):
    x = C.h_escalar(DOM_CLAVE, secreto, semilla, ident) or 1
    return x, C.mult_base(x)


def nonce_de_ronda(secreto: bytes, semilla: str, ident: str, ronda: str) -> int:
    """El número al azar r de Peggy para ESTA ronda (nuevo en cada ronda; el mismo si se repite la ronda)."""
    return C.h_escalar(DOM_NONCE, secreto, semilla, ident, ronda) or 1


def compromiso(r):
    """Paso 1: T = r·G."""
    return C.mult_base(r)


def responder(r: int, c: int, x: int) -> int:
    """Paso 3: s = r + c·x (mod N)."""
    return (r + c * x) % C.N


def verificar_transcripcion(Y, T, c: int, s: int) -> bool:
    """Paso 4: ¿s·G = T + c·Y?  Rechaza puntos fuera de la curva y escalares no canónicos."""
    if not (C.en_curva(Y) and C.en_curva(T) and 0 <= s < C.N and 0 <= c < C.N):
        return False
    return C.mult_base(s) == C.suma(T, C.mult(c, Y))


def reto_fiat_shamir(Y, T, mensaje: bytes) -> int:
    """c = H(dominio ‖ G ‖ Y ‖ T ‖ m) mod N: TODO lo público entra al hash (si no, «Fiat–Shamir débil»)."""
    return C.h_escalar(DOM_FS, C.G, Y, T, mensaje)


def probar_ni(x: int, Y, mensaje: bytes, azar=SISTEMA):
    """Algoritmo 3 (Prove-NI): prueba (T, s) que cualquiera verifica sin conversar con Peggy."""
    r = azar.randbelow(C.N - 1) + 1
    T = C.mult_base(r)
    return T, responder(r, reto_fiat_shamir(Y, T, mensaje), x)


def verificar_ni(Y, mensaje: bytes, T, s: int) -> bool:
    if not (C.en_curva(Y) and C.en_curva(T)):
        return False
    return verificar_transcripcion(Y, T, reto_fiat_shamir(Y, T, mensaje), s)


def simular(Y, azar=SISTEMA):
    """Algoritmo 2: transcripción (T, c, s) que verifica SIN conocer x (eligiendo c y s primero)."""
    c, s = azar.randbelow(C.N), azar.randbelow(C.N)
    T = C.suma(C.mult_base(s), C.neg(C.mult(c, Y)))
    return T, c, s


def extraer(c1: int, s1: int, c2: int, s2: int) -> int:
    """Solidez especial: con el mismo compromiso y retos distintos, x = (s1 − s2)·(c1 − c2)⁻¹ mod N."""
    if (c1 - c2) % C.N == 0:
        raise ValueError("los dos retos son iguales: así no se puede despejar x")
    return (s1 - s2) * pow(c1 - c2, -1, C.N) % C.N


# ------------------------------------------------------------ demos Schnorr (API)
def demo_clave(secreto, semilla, ident) -> dict:
    _, Y = clave_derivada(secreto, semilla, ident)
    return {"esquema": "zk_schnorr", "institucion": ident, "Y": C.punto_hex(Y)}


def demo_compromiso(secreto, semilla, ident, ronda) -> dict:
    r = nonce_de_ronda(secreto, semilla, ident, ronda)
    _, Y = clave_derivada(secreto, semilla, ident)
    return {"esquema": "zk_schnorr", "institucion": ident, "ronda": ronda, "Y": C.punto_hex(Y),
            "T": C.punto_hex(compromiso(r))}


def demo_responder(secreto, semilla, ident, ronda, c: int, impostor=False) -> dict:
    """Peggy (o un impostor que NO conoce x) responde el reto c de Víctor; Víctor comprueba."""
    x, Y = clave_derivada(secreto, semilla, ident)
    r = nonce_de_ronda(secreto, semilla, ident, ronda)
    T = compromiso(r)
    if impostor:      # no conoce x: responde con una clave inventada (lo mejor que puede hacer)
        x = C.h_escalar(DOM_IMPOSTOR, secreto, semilla, ident, ronda) or 1
    s = responder(r, c, x)
    izquierda = C.mult_base(s)
    derecha = C.suma(T, C.mult(c, Y))
    return {"esquema": "zk_schnorr", "institucion": ident, "ronda": ronda, "impostor": impostor,
            "Y": C.punto_hex(Y), "T": C.punto_hex(T), "c": C.escalar_hex(c), "s": C.escalar_hex(s),
            "verificacion": {"sG": C.punto_hex(izquierda),
                             "T_mas_cY": C.punto_hex(derecha) if derecha else None,
                             "ok": izquierda == derecha}}


def demo_extraer(secreto, semilla, ident, t1: dict, t2: dict) -> dict:
    """Lo que hace cualquiera que vea dos respuestas al MISMO compromiso: despejar la llave privada."""
    x_real, Y = clave_derivada(secreto, semilla, ident)
    x = extraer(t1["c"], t1["s"], t2["c"], t2["s"])
    return {"esquema": "zk_schnorr", "institucion": ident, "x_extraida": C.escalar_hex(x),
            "coincide": C.mult_base(x) == Y, "x_real": C.escalar_hex(x_real)}


def demo_simular(secreto, semilla, ident, azar=SISTEMA) -> dict:
    _, Y = clave_derivada(secreto, semilla, ident)
    T, c, s = simular(Y, azar)
    return {"esquema": "zk_schnorr", "institucion": ident, "Y": C.punto_hex(Y), "T": C.punto_hex(T),
            "c": C.escalar_hex(c), "s": C.escalar_hex(s), "verifica": verificar_transcripcion(Y, T, c, s)}


def demo_probar_ni(secreto, semilla, ident, mensaje: str, azar=SISTEMA) -> dict:
    x, Y = clave_derivada(secreto, semilla, ident)
    T, s = probar_ni(x, Y, mensaje.encode("utf-8"), azar)
    return {"esquema": "zk_schnorr", "institucion": ident, "mensaje": mensaje, "Y": C.punto_hex(Y),
            "T": C.punto_hex(T), "s": C.escalar_hex(s),
            "c": C.escalar_hex(reto_fiat_shamir(Y, T, mensaje.encode("utf-8")))}


def demo_verificar_ni(Y, mensaje: str, T, s: int) -> dict:
    return {"esquema": "zk_schnorr", "valida": verificar_ni(Y, mensaje.encode("utf-8"), T, s)}


# ========================================================== B · 3-coloración (GMW)
# Grafo de 7 vértices y 14 aristas del documento (§3.6). En el dominio: 7 materias; una arista une dos
# materias que comparten alumnos, así que no pueden examinarse en el mismo turno (color).
VERTICES = ("Cálculo", "Física", "Química", "Programación", "Estadística", "Inglés", "Historia")
ARISTAS = ((0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 0), (0, 2), (1, 3), (2, 4), (3, 5), (4, 0),
           (5, 1), (2, 6))
TURNOS = ("Mañana", "Tarde", "Noche")
COLOREO_VALIDO = (0, 1, 2, 0, 1, 2, 1)
COLOREO_FALSO = (0, 1, 2, 0, 1, 2, 0)        # la arista (6, 0) queda del mismo color
EPSILON = 1e-6


def comprometer(valor: int, nonce: bytes) -> str:
    """Sobre cerrado por hash: C = SHA-256(valor ‖ nonce). Ocultador y vinculante (heurísticos)."""
    return hashlib.sha256(bytes([valor]) + nonce).hexdigest()


def abre(comp: str, valor: int, nonce: bytes) -> bool:
    return 0 <= valor < 256 and comprometer(valor, nonce) == comp


def coloreo_es_valido(coloreo, aristas=ARISTAS) -> bool:
    return all(coloreo[u] != coloreo[v] for u, v in aristas)


def rondas_para_error(m: int, eps: float = EPSILON) -> int:
    """k = ⌈ln ε / ln(1 − 1/m)⌉: rondas para que una tramposa pase con probabilidad ≤ ε (187 si m = 14)."""
    return math.ceil(math.log(eps) / math.log(1 - 1 / m))


class Probador:
    """Peggy. Su azar (permutación y nonces) sale de `azar`: un Flujo por ronda o el del sistema."""

    def __init__(self, coloreo, azar=SISTEMA):
        self.col = list(coloreo)
        self.azar = azar
        self.perm = self.nonces = None

    def compromisos(self):
        pi = self.azar.barajar([0, 1, 2])              # permutación nueva en cada ronda
        self.perm = [pi[c] for c in self.col]
        self.nonces = [self.azar.bytes(32) for _ in self.col]
        return [comprometer(c, n) for c, n in zip(self.perm, self.nonces)]

    def abrir(self, u: int, v: int):
        return (self.perm[u], self.nonces[u]), (self.perm[v], self.nonces[v])


def verificar_apertura(comps, u, v, apertura) -> dict:
    (cu, nu), (cv, nv) = apertura
    abre_u, abre_v = abre(comps[u], cu, nu), abre(comps[v], cv, nv)
    en_rango = cu in (0, 1, 2) and cv in (0, 1, 2)
    return {"abre_u": abre_u, "abre_v": abre_v, "distintos": cu != cv, "en_rango": en_rango,
            "ok": abre_u and abre_v and en_rango and cu != cv}


def ronda(prob: Probador, aristas, azar_verificador=SISTEMA):
    """Algoritmo 4 completo: compromiso → arista al azar → apertura → veredicto."""
    coms = prob.compromisos()
    u, v = aristas[azar_verificador.randbelow(len(aristas))]
    return (u, v), verificar_apertura(coms, u, v, prob.abrir(u, v))["ok"]


def simulador(n: int, aristas, azar=SISTEMA):
    """Algoritmo 5 (con rebobinado): sin coloración, adivina la arista y pone «basura» en lo demás."""
    while True:
        u, v = aristas[azar.randbelow(len(aristas))]
        cu, cv = azar.barajar([0, 1, 2])[:2]
        cols = [azar.randbelow(3) for _ in range(n)]
        cols[u], cols[v] = cu, cv
        nonces = [azar.bytes(32) for _ in range(n)]
        coms = [comprometer(c, x) for c, x in zip(cols, nonces)]
        e = aristas[azar.randbelow(len(aristas))]       # reto del verificador
        if e == (u, v):                                 # si acertó, la transcripción sirve
            return coms, e, (cu, nonces[u]), (cv, nonces[v])


# -------------------------------------------------------------- demos GMW (API)
def _probador_de_ronda(secreto: bytes, ronda_id: str, tramposa: bool) -> Probador:
    coloreo = COLOREO_FALSO if tramposa else COLOREO_VALIDO
    return Probador(coloreo, Flujo(secreto, "gmw", ronda_id, "tramposa" if tramposa else "honesta"))


def demo_grafo() -> dict:
    m = len(ARISTAS)
    return {"esquema": "zk_coloreo", "vertices": list(VERTICES), "aristas": [list(a) for a in ARISTAS],
            "turnos": list(TURNOS), "rondas_recomendadas": rondas_para_error(m), "epsilon": EPSILON,
            # «detrás del telón»: lo que SÓLO Peggy sabe (la interfaz lo muestra aparte para explicar)
            "secreto_de_peggy": list(COLOREO_VALIDO), "coloreo_tramposo": list(COLOREO_FALSO)}


def demo_compromiso_coloreo(secreto: bytes, ronda_id: str, tramposa: bool) -> dict:
    coms = _probador_de_ronda(secreto, ronda_id, tramposa).compromisos()
    return {"esquema": "zk_coloreo", "ronda": ronda_id, "compromisos": coms}


def demo_abrir_coloreo(secreto: bytes, ronda_id: str, tramposa: bool, arista) -> dict:
    u, v = arista
    if (u, v) not in ARISTAS and (v, u) not in ARISTAS:
        raise ValueError("Víctor sólo puede pedir una arista del grafo (dos materias que comparten alumnos)")
    prob = _probador_de_ronda(secreto, ronda_id, tramposa)
    coms = prob.compromisos()
    ap = prob.abrir(u, v)
    return {"esquema": "zk_coloreo", "ronda": ronda_id, "arista": [u, v], "compromisos": coms,
            "u": {"vertice": u, "color": ap[0][0], "nonce": ap[0][1].hex()},
            "v": {"vertice": v, "color": ap[1][0], "nonce": ap[1][1].hex()},
            "verificacion": verificar_apertura(coms, u, v, ap)}


def demo_rondas_coloreo(secreto: bytes, ronda_base: str, tramposa: bool, k: int, azar_verificador=SISTEMA) -> dict:
    """k rondas seguidas (con permutación y sobres nuevos en cada una); Víctor elige la arista al azar."""
    m = len(ARISTAS)
    resultados, primera_falla = [], None
    for j in range(k):
        prob = _probador_de_ronda(secreto, f"{ronda_base}:{j}", tramposa)
        (u, v), ok = ronda(prob, ARISTAS, azar_verificador)
        resultados.append({"arista": [u, v], "colores": [prob.perm[u], prob.perm[v]], "ok": ok})
        if not ok and primera_falla is None:
            primera_falla = j + 1
    return {"esquema": "zk_coloreo", "tramposa": tramposa, "k": k, "rondas": resultados,
            "aceptada": primera_falla is None, "primera_falla": primera_falla,
            "prob_engano": (1 - 1 / m) ** k, "rondas_recomendadas": rondas_para_error(m)}
