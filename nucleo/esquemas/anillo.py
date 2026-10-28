"""Esquema 2 · Firmas de anillo AOS y LSAG (documento «firmas_anillo_pipeline.pdf»).

Un miembro de un conjunto de claves públicas L = (Y_0, …, Y_{n−1}) firma un mensaje de modo que
CUALQUIERA puede comprobar que lo firmó alguien de L, pero NADIE puede saber quién.

  AOS  (Abe–Ohkubo–Suzuki, algoritmos 2 y 3): una cadena de retos c_0 → c_1 → … que da la vuelta al
       anillo. El firmante «simula» a los demás con respuestas al azar y cierra el círculo con su clave:
       r_s = a − c_s·x_s.  Verificar = recorrer el anillo y comprobar que la vuelta regresa a c_0.
  LSAG (Liu–Wei–Wong, algoritmos 4 y 5): además publica una IMAGEN DE CLAVE I = x_s·H_p(Y_s). Es
       siempre la misma para el mismo firmante (un «folio anónimo»): dos firmas con la misma I vienen de
       la misma persona, sin revelar cuál. Sirve para votar una sola vez o impedir el doble gasto.

En Título Seguro: una institución del consorcio denuncia un título falso sin revelar cuál es (AOS), o
las instituciones votan de forma anónima y nadie puede votar dos veces (LSAG).

Grupo: secp256k1 (orden primo, cofactor 1). Hashes con separación de dominio, codificación inyectiva y
reducción de 64 bytes; el anillo L completo y el mensaje entran en cada hash; el anillo se ordena de
forma canónica (por su codificación) para que firmante y verificador usen la misma lista.
"""
from . import secp256k1 as C
from .azar import SISTEMA

DOM_AOS = b"TituloSeguro/anillo/AOS/v1"
DOM_LSAG = b"TituloSeguro/anillo/LSAG/v1"
DOM_HP = b"TituloSeguro/anillo/H_punto/v1"
DOM_CLAVE = b"TituloSeguro/anillo/clave/v1"
N_MIN, N_MAX = 2, 12
VARIANTES = ("aos", "lsag")


class FirmaInvalida(ValueError):
    """La firma recibida está mal formada (no es lo mismo que «no verifica»)."""


# ------------------------------------------------------------------ claves
def generar_claves(azar=SISTEMA):
    """Algoritmo 1: x al azar en Z_N \\ {0}; Y = x·G."""
    x = azar.randbelow(C.N - 1) + 1
    return x, C.mult_base(x)


def clave_derivada(secreto: bytes, semilla: str, ident: str):
    """Par de claves reproducible de una institución (el servidor guarda el secreto; nadie más puede derivarlo)."""
    x = C.h_escalar(DOM_CLAVE, secreto, semilla, ident) or 1
    return x, C.mult_base(x)


def ordenar(anillo):
    """Orden canónico del anillo: por la codificación de cada clave pública."""
    return sorted(anillo, key=C.comprimir)


def _bytes_anillo(anillo) -> bytes:
    return b"".join(C.comprimir(Y) for Y in anillo)


def _validar_anillo(anillo):
    if not N_MIN <= len(anillo) <= N_MAX:
        raise FirmaInvalida(f"el anillo debe tener entre {N_MIN} y {N_MAX} claves")
    if not all(C.en_curva(Y) for Y in anillo):
        raise FirmaInvalida("una de las claves del anillo no es un punto de la curva")
    if len({C.comprimir(Y) for Y in anillo}) != len(anillo):
        raise FirmaInvalida("el anillo repite una clave")


def h_punto(Y):
    return C.h_punto(DOM_HP, Y)


def imagen_clave(x):
    """I = x·H_p(Y): determinista para cada firmante, sin revelar cuál de las Y es la suya."""
    return C.mult(x, h_punto(C.mult_base(x)))


# ------------------------------------------------------------------ AOS
def firmar_aos(m: bytes, anillo, s: int, x_s: int, azar=SISTEMA):
    """Algoritmo 2. Devuelve (c0, [r_0, …, r_{n−1}])."""
    n = len(anillo)
    _validar_anillo(anillo)
    if anillo[s] != C.mult_base(x_s):
        raise ValueError("la clave secreta no corresponde a la posición s")
    Lb = _bytes_anillo(anillo)
    c, r = [None] * n, [None] * n
    a = azar.randbelow(C.N - 1) + 1                         # aleatorio secreto, nuevo en cada firma
    c[(s + 1) % n] = C.h_escalar(DOM_AOS, Lb, m, C.mult_base(a))
    i = (s + 1) % n
    while i != s:                                           # simular a los demás miembros
        r[i] = azar.randbelow(C.N)
        R_i = C.suma(C.mult_base(r[i]), C.mult(c[i], anillo[i]))
        c[(i + 1) % n] = C.h_escalar(DOM_AOS, Lb, m, R_i)
        i = (i + 1) % n
    r[s] = (a - c[s] * x_s) % C.N                           # cerrar el anillo con la clave
    return c[0], r


def recorrer_aos(m: bytes, anillo, c0: int, r):
    """Algoritmo 3 con traza: (válida, [{c, R} por eslabón], c_final)."""
    _validar_anillo(anillo)
    if len(r) != len(anillo):
        raise FirmaInvalida("la firma trae un número de respuestas distinto del tamaño del anillo")
    Lb = _bytes_anillo(anillo)
    c, traza = c0, []
    for i, Y in enumerate(anillo):
        R_i = C.suma(C.mult_base(r[i]), C.mult(c, Y))
        traza.append({"c": c, "R": R_i})
        c = C.h_escalar(DOM_AOS, Lb, m, R_i)
    return c == c0, traza, c


def verificar_aos(m, anillo, firma):
    try:
        return recorrer_aos(m, anillo, *firma)[0]
    except FirmaInvalida:
        return False


# ------------------------------------------------------------------ LSAG
def firmar_lsag(m: bytes, anillo, s: int, x_s: int, azar=SISTEMA):
    """Algoritmo 4. Devuelve (c0, [r_i], I)."""
    n = len(anillo)
    _validar_anillo(anillo)
    if anillo[s] != C.mult_base(x_s):
        raise ValueError("la clave secreta no corresponde a la posición s")
    Lb = _bytes_anillo(anillo)
    Hs = h_punto(anillo[s])
    I = C.mult(x_s, Hs)                                     # imagen de clave
    c, r = [None] * n, [None] * n
    a = azar.randbelow(C.N - 1) + 1
    c[(s + 1) % n] = C.h_escalar(DOM_LSAG, Lb, I, m, C.mult_base(a), C.mult(a, Hs))
    i = (s + 1) % n
    while i != s:
        r[i] = azar.randbelow(C.N)
        U = C.suma(C.mult_base(r[i]), C.mult(c[i], anillo[i]))
        V = C.suma(C.mult(r[i], h_punto(anillo[i])), C.mult(c[i], I))
        c[(i + 1) % n] = C.h_escalar(DOM_LSAG, Lb, I, m, U, V)
        i = (i + 1) % n
    r[s] = (a - c[s] * x_s) % C.N
    return c[0], r, I


def recorrer_lsag(m: bytes, anillo, c0: int, r, I):
    """Algoritmo 5 con traza."""
    _validar_anillo(anillo)
    if len(r) != len(anillo):
        raise FirmaInvalida("la firma trae un número de respuestas distinto del tamaño del anillo")
    if not C.en_curva(I):
        raise FirmaInvalida("la imagen de clave no es un punto de la curva")
    Lb = _bytes_anillo(anillo)
    c, traza = c0, []
    for i, Y in enumerate(anillo):
        U = C.suma(C.mult_base(r[i]), C.mult(c, Y))
        V = C.suma(C.mult(r[i], h_punto(Y)), C.mult(c, I))
        traza.append({"c": c, "R": U})
        c = C.h_escalar(DOM_LSAG, Lb, I, m, U, V)
    return c == c0, traza, c


def verificar_lsag(m, anillo, firma):
    try:
        return recorrer_lsag(m, anillo, *firma)[0]
    except FirmaInvalida:
        return False


def enlazadas(f1, f2) -> bool:
    """Dos firmas LSAG válidas con la misma imagen de clave vienen del mismo firmante."""
    return f1[2] == f2[2]


# ------------------------------------------------------------ serialización
def firma_a_dict(variante, firma) -> dict:
    d = {"variante": variante, "c0": C.escalar_hex(firma[0]), "r": [C.escalar_hex(x) for x in firma[1]]}
    if variante == "lsag":
        d["I"] = C.punto_hex(firma[2])
    return d


def firma_de_dict(d: dict):
    """dict → tupla de firma. Lanza FirmaInvalida si algo está mal formado (escalares NO canónicos incluidos)."""
    if not isinstance(d, dict):
        raise FirmaInvalida("la firma debe ser un objeto {variante, c0, r[, I]}")
    variante = d.get("variante")
    if variante not in VARIANTES:
        raise FirmaInvalida("la variante de la firma debe ser «aos» o «lsag»")
    permitidos = {"variante", "c0", "r"} | ({"I"} if variante == "lsag" else set())
    if set(d) - permitidos or not {"c0", "r"} <= set(d):
        raise FirmaInvalida(f"la firma {variante.upper()} lleva exactamente: {', '.join(sorted(permitidos))}")
    r = d["r"]
    if not isinstance(r, list) or not N_MIN <= len(r) <= N_MAX:
        raise FirmaInvalida(f"«r» debe ser una lista de {N_MIN} a {N_MAX} escalares")
    try:
        c0 = C.escalar_de_hex(d["c0"])
        rs = [C.escalar_de_hex(x) for x in r]
        if variante == "aos":
            return variante, (c0, rs)
        if "I" not in d:
            raise FirmaInvalida("a la firma LSAG le falta la imagen de clave «I»")
        return variante, (c0, rs, C.descomprimir(d["I"]))
    except ValueError as e:
        raise FirmaInvalida(str(e)) from None


def tamano_bytes(variante, n):
    """Tamaño de la firma serializada (etapa 8): AOS 32(n+1) bytes; LSAG 32(n+1) + 33 de la imagen."""
    return 32 * (n + 1) + (33 if variante == "lsag" else 0)


# ---------------------------------------------------------------- demos (API)
def _anillo_de(secreto, semilla, ids):
    claves = {i: clave_derivada(secreto, semilla, i) for i in ids}
    orden = sorted(ids, key=lambda i: C.comprimir(claves[i][1]))
    return orden, claves


def _anillo_publico(orden, claves):
    return [{"id": i, "clave_publica": C.punto_hex(claves[i][1])} for i in orden]


def demo_firmar(secreto: bytes, semilla: str, ids, firmante: str, mensaje: str, variante: str, azar=SISTEMA) -> dict:
    """Firma `mensaje` en nombre del anillo `ids`. La respuesta NO dice quién firmó."""
    if variante not in VARIANTES:
        raise ValueError("variante desconocida")
    if firmante not in ids:
        raise ValueError("quien firma debe pertenecer al anillo")
    orden, claves = _anillo_de(secreto, semilla, ids)
    anillo = [claves[i][1] for i in orden]
    s, x_s = orden.index(firmante), claves[firmante][0]
    m = mensaje.encode("utf-8")
    firma = (firmar_aos if variante == "aos" else firmar_lsag)(m, anillo, s, x_s, azar)
    return {"esquema": "anillo", "variante": variante, "mensaje": mensaje,
            "anillo": _anillo_publico(orden, claves), "firma": firma_a_dict(variante, firma),
            "tamano_bytes": tamano_bytes(variante, len(anillo))}


def demo_verificar(secreto: bytes, semilla: str, ids, mensaje: str, firma: dict) -> dict:
    """Recorre el anillo y dice si la vuelta cierra. Nunca dice quién firmó (no puede saberlo)."""
    variante, f = firma_de_dict(firma)
    orden, claves = _anillo_de(secreto, semilla, ids)
    anillo = [claves[i][1] for i in orden]
    m = mensaje.encode("utf-8")
    if len(f[1]) != len(anillo):
        return {"esquema": "anillo", "variante": variante, "valida": False, "anillo": _anillo_publico(orden, claves),
                "traza": [], "c0": C.escalar_hex(f[0]), "c_final": None, "probabilidad": None,
                "motivo": f"La firma se hizo para un grupo de {len(f[1])} y aquí hay {len(anillo)}: "
                          "no corresponde a este anillo."}
    valida, traza, c_final = (recorrer_aos if variante == "aos" else recorrer_lsag)(m, anillo, *f)
    return {
        "esquema": "anillo", "variante": variante, "valida": valida,
        "anillo": _anillo_publico(orden, claves),
        "traza": [{"id": i, "c": C.escalar_hex(t["c"]),
                   "R": C.punto_hex(t["R"]) if t["R"] is not None else None} for i, t in zip(orden, traza)],
        "c0": C.escalar_hex(f[0]), "c_final": C.escalar_hex(c_final),
        "imagen": C.punto_hex(f[2]) if variante == "lsag" else None,
        "probabilidad": {"num": 1, "den": len(anillo)} if valida else None,
        "motivo": ("La vuelta cierra: el último reto coincide con c0. La firmó alguien del grupo." if valida
                   else "La vuelta no cierra: el último reto no coincide con c0. Cambió el mensaje, la firma o el grupo."),
    }


def demo_urna(secreto: bytes, semilla: str, ids, mensaje: str, firma: dict, imagenes_previas) -> dict:
    """Urna de votación con LSAG: acepta la papeleta si la firma es válida y su folio anónimo es nuevo."""
    v = demo_verificar(secreto, semilla, ids, mensaje, firma)
    if v["variante"] != "lsag":
        raise FirmaInvalida("la urna sólo acepta firmas enlazables (LSAG)")
    repetida = v["valida"] and v["imagen"] in set(imagenes_previas)
    v.update(repetida=repetida, aceptada=v["valida"] and not repetida)
    if repetida:
        v["motivo"] = ("Firma válida, pero su folio anónimo (imagen de clave) ya está en la urna: "
                       "quien firmó ya votó. Se rechaza el segundo voto sin saber quién es.")
    return v
