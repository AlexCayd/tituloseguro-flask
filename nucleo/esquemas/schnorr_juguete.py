"""Esquema 5 · La firma de Schnorr con números pequeños (documento «schnorr_juguete.pdf»).

Dos grupos de juguete en los que TODAS las cuentas caben en una calculadora:

  · «zp»:    potencias de g = 2 módulo p = 23; el subgrupo tiene orden q = 11.
  · «curva»: puntos de y² = x³ + 2x + 2 sobre F17 con G = (5, 1); el grupo tiene orden q = 19.

    Claves:  privada x;  pública y = g^(−x)   (en la curva: Y = −x·G)
    Firma:   r = g^k;  e = H(r ‖ M);  s = k + x·e (mod q);  firma = (s, e)
    Verif.:  r_v = g^s·y^e  (curva: R_v = s·G + e·Y);  válida si H(r_v ‖ M) = e

El hash de juguete escribe seguidos los dígitos y reduce módulo q:  H(13 ‖ 14) = 1314 mod 11 = 5.
También: qué pasa si se altera el mensaje, por qué NUNCA se repite k (se despeja x), la multifirma
MuSig de dos participantes (una sola firma ordinaria con una clave conjunta) y el ataque de clave
maliciosa que los coeficientes a_i impiden.

Advertencia del documento: con grupos de 11 y 19 elementos no hay seguridad alguna; sirven para
entender la mecánica. En Título Seguro: la UAN firma el título número M; en la doble titulación,
UAN y UNAM firman juntas UN título con una sola firma.
"""
import hashlib

GRUPOS = ("zp", "curva")
M_MAX = 999


def hash_juguete(q, *partes) -> int:
    """H(a ‖ b ‖ …) = número formado por los dígitos de a, b, … reducido módulo q."""
    return int("".join(str(a) for a in partes)) % q


def _concatenado(*partes) -> str:
    return "".join(str(a) for a in partes)


class GrupoZp:
    nombre = "zp"
    titulo = "Potencias de 2 módulo 23"
    p, q, g = 23, 11, 2

    def publica(self, x):
        return pow(self.g, -x % self.q, self.p)

    def gen(self, k):
        return pow(self.g, k % self.q, self.p)

    def exp(self, y, e):
        return pow(y, e % self.q, self.p)

    def op(self, a, b):
        return a * b % self.p

    def partes(self, r):                      # lo que entra al hash
        return (r,)

    def es_elemento(self, y):
        return isinstance(y, int) and 1 <= y < self.p and pow(y, self.q, self.p) == 1

    def ver(self, r):
        return str(r)

    def tabla(self):
        return {"potencias": [{"a": a, "valor": pow(self.g, a, self.p)} for a in range(self.q)],
                "inversos_q": [{"a": a, "inverso": pow(a, -1, self.q)} for a in range(1, self.q)]}

    def parametros(self):
        return {"grupo": "zp", "titulo": self.titulo, "p": self.p, "q": self.q, "g": self.g}


class GrupoCurva:
    nombre = "curva"
    titulo = "Curva y² = x³ + 2x + 2 sobre F17"
    P, A, B, q = 17, 2, 2, 19
    G = (5, 1)

    def suma(self, U, V):
        if U is None:
            return V
        if V is None:
            return U
        (x1, y1), (x2, y2) = U, V
        if x1 == x2 and (y1 + y2) % self.P == 0:
            return None                                   # punto al infinito
        if U == V:
            lam = (3 * x1 * x1 + self.A) * pow(2 * y1, -1, self.P) % self.P
        else:
            lam = (y2 - y1) * pow(x2 - x1, -1, self.P) % self.P
        x3 = (lam * lam - x1 - x2) % self.P
        return (x3, (lam * (x1 - x3) - y1) % self.P)

    def mult(self, n, U):                                 # doblado y suma
        R = None
        for b in bin(n % self.q)[2:]:
            R = self.suma(R, R)
            if b == "1":
                R = self.suma(R, U)
        return R

    def neg(self, U):
        return None if U is None else (U[0], -U[1] % self.P)

    def publica(self, x):
        return self.neg(self.mult(x, self.G))

    def gen(self, k):
        return self.mult(k, self.G)

    def exp(self, Y, e):
        return self.mult(e, Y)

    def op(self, a, b):
        return self.suma(a, b)

    def partes(self, R):
        return (R[0], R[1])

    def es_elemento(self, Y):
        if not (isinstance(Y, tuple) and len(Y) == 2 and all(isinstance(v, int) for v in Y)):
            return False
        x, y = Y
        return 0 <= x < self.P and 0 <= y < self.P and (y * y - x**3 - self.A * x - self.B) % self.P == 0

    def ver(self, R):
        return "𝒪" if R is None else f"({R[0]}, {R[1]})"

    def puntos(self):
        return [(x, y) for x in range(self.P) for y in range(self.P)
                if (y * y - x**3 - self.A * x - self.B) % self.P == 0]

    def tabla(self):
        return {"multiplos": [{"k": k, "punto": list(self.mult(k, self.G)) if self.mult(k, self.G) else None}
                              for k in range(1, self.q + 1)],
                "puntos": [list(p) for p in self.puntos()],
                "inversos_p": [{"a": a, "inverso": pow(a, -1, self.P)} for a in range(1, self.P)],
                "inversos_q": [{"a": a, "inverso": pow(a, -1, self.q)} for a in range(1, self.q)]}

    def parametros(self):
        return {"grupo": "curva", "titulo": self.titulo, "p": self.P, "a": self.A, "b": self.B, "q": self.q,
                "G": list(self.G)}


def grupo(nombre):
    if nombre == "zp":
        return GrupoZp()
    if nombre == "curva":
        return GrupoCurva()
    raise ValueError("el grupo debe ser «zp» o «curva»")


def _json(v):
    return list(v) if isinstance(v, tuple) else v


# ------------------------------------------------------------- firma básica
def _pasos_firma(Gr, x, k, M):
    q = Gr.q
    y = Gr.publica(x)
    r = Gr.gen(k)
    partes = Gr.partes(r)
    e = hash_juguete(q, *partes, M)
    s = (k + x * e) % q
    if Gr.nombre == "zp":
        exp_pub = -x % q
        cuentas = {
            "clave": f"y = g^(−x) = 2^(−{x}) = 2^{exp_pub} (mod 23) = {y}",
            "compromiso": f"r = g^k = 2^{k} = {2**k} ≡ {r} (mod 23)",
        }
    else:
        cuentas = {
            "clave": f"Y = −x·G = −({x}·G) = −{Gr.ver(Gr.mult(x, Gr.G))} = {Gr.ver(y)}",
            "compromiso": f"R = k·G = {k}·G = {Gr.ver(r)}",
        }
    cuentas["reto"] = f"e = H({' ‖ '.join(map(str, (*partes, M)))}) = {_concatenado(*partes, M)} mod {q} = {e}"
    cuentas["respuesta"] = f"s = k + x·e = {k} + {x}·{e} = {k + x * e} ≡ {s} (mod {q})"
    return y, r, e, s, cuentas


def firmar(nombre, x, k, M) -> dict:
    Gr = grupo(nombre)
    _validar(Gr, x=x, k=k, M=M)
    y, r, e, s, cuentas = _pasos_firma(Gr, x, k, M)
    return {"esquema": "schnorr", **Gr.parametros(), "x": x, "k": k, "M": M, "y": _json(y), "r": _json(r),
            "e": e, "s": s, "firma": {"s": s, "e": e}, "cuentas": cuentas}


def verificar(nombre, y, M, s, e) -> dict:
    """r_v = g^s·y^e (o s·G + e·Y) y e_v = H(r_v ‖ M); válida si e_v = e."""
    Gr = grupo(nombre)
    q = Gr.q
    if not (0 <= s < q and 0 <= e < q and 0 <= M <= M_MAX):
        raise ValueError(f"s y e deben estar entre 0 y {q - 1}; M entre 0 y {M_MAX}")
    y = tuple(y) if isinstance(y, list) else y
    if not Gr.es_elemento(y):
        raise ValueError("la clave pública no es un elemento del grupo")
    gs, ye = Gr.gen(s), Gr.exp(y, e)
    rv = Gr.op(gs, ye)
    if rv is None:
        ev = None
        cuenta_ev = "R_v es el punto al infinito: no hay nada que hashear, la firma no vale"
    else:
        ev = hash_juguete(q, *Gr.partes(rv), M)
        cuenta_ev = f"e_v = H({' ‖ '.join(map(str, (*Gr.partes(rv), M)))}) = {_concatenado(*Gr.partes(rv), M)} mod {q} = {ev}"
    if Gr.nombre == "zp":
        cuentas = {"gs": f"g^s = 2^{s} = {gs} (mod 23)", "ye": f"y^e = {y}^{e} = {ye} (mod 23)",
                   "rv": f"r_v = g^s·y^e = {gs}·{ye} = {gs * ye} ≡ {rv} (mod 23)"}
    else:
        cuentas = {"gs": f"s·G = {s}·G = {Gr.ver(gs)}", "ye": f"e·Y = {e}·{Gr.ver(y)} = {Gr.ver(ye)}",
                   "rv": f"R_v = s·G + e·Y = {Gr.ver(gs)} + {Gr.ver(ye)} = {Gr.ver(rv)}"}
    cuentas["ev"] = cuenta_ev
    return {"esquema": "schnorr", **Gr.parametros(), "y": _json(y), "M": M, "s": s, "e": e,
            "gs": _json(gs), "ye": _json(ye), "rv": _json(rv), "ev": ev, "valida": ev == e, "cuentas": cuentas}


def nonce_repetido(nombre, x, k, M1, M2) -> dict:
    """Dos firmas con el MISMO k: x = (s1 − s2)/(e1 − e2) mod q. Cualquiera la despeja con una resta y una división."""
    Gr = grupo(nombre)
    _validar(Gr, x=x, k=k, M=M1)
    _validar(Gr, M=M2)
    q = Gr.q
    f1, f2 = firmar(nombre, x, k, M1), firmar(nombre, x, k, M2)
    e1, s1, e2, s2 = f1["e"], f1["s"], f2["e"], f2["s"]
    salida = {"esquema": "schnorr", **Gr.parametros(), "M1": M1, "M2": M2, "r": f1["r"],
              "firma1": {"s": s1, "e": e1}, "firma2": {"s": s2, "e": e2}}
    if (e1 - e2) % q == 0:
        return {**salida, "extraible": False,
                "cuenta": f"e1 = e2 = {e1}: con retos iguales no se puede despejar x (prueba con otro mensaje)."}
    inv = pow((e1 - e2) % q, -1, q)
    x_ext = (s1 - s2) * inv % q
    k_ext = (s1 - x_ext * e1) % q
    return {**salida, "extraible": True, "x_extraida": x_ext, "k_extraido": k_ext, "coincide": x_ext == x,
            "cuenta": (f"x = (s1 − s2)/(e1 − e2) = ({s1} − {s2})/({e1} − {e2}) ≡ {(s1 - s2) % q}·{(e1 - e2) % q}⁻¹ "
                       f"= {(s1 - s2) % q}·{inv} ≡ {x_ext} (mod {q})")}


# ---------------------------------------------------------------- MuSig (§6)
def huella_compromiso(Gr, R) -> str:
    """Ronda 1: se envía sólo la huella SHA-256(«com|r») (8 hex), para no poder elegir r después."""
    contenido = f"com|{R}" if Gr.nombre == "zp" else f"com|{R[0]},{R[1]}"
    return hashlib.sha256(contenido.encode()).hexdigest()[:8]


def multifirma(nombre, x1, x2, k1, k2, M) -> dict:
    """MuSig de dos firmantes (Alicia y Beto): una sola firma de Schnorr con una clave conjunta.

    Simplificación consciente del documento: el reto es e = H(r ‖ M), sin la clave conjunta, para que la
    verificación sea literalmente la de una firma individual.
    """
    Gr = grupo(nombre)
    for v in (x1, x2, k1, k2):
        _validar(Gr, x=v)
    _validar(Gr, M=M)
    q = Gr.q
    y1, y2 = Gr.publica(x1), Gr.publica(x2)
    if Gr.nombre == "zp":
        a1, a2 = hash_juguete(q, y1, y2, y1), hash_juguete(q, y1, y2, y2)
        base_a = (y1, y2)
    else:  # para que las cuentas sean cortas, el hash de los coeficientes usa sólo las coordenadas x
        a1, a2 = hash_juguete(q, y1[0], y2[0], y1[0]), hash_juguete(q, y1[0], y2[0], y2[0])
        base_a = (y1[0], y2[0])
    conjunta = Gr.op(Gr.exp(y1, a1), Gr.exp(y2, a2))
    if conjunta is None:
        raise ValueError(f"Con estas claves, a1·x1 + a2·x2 ≡ 0 (mod {q}): la clave conjunta sería el punto al "
                         "infinito. Elige otras claves privadas")
    r1, r2 = Gr.gen(k1), Gr.gen(k2)
    r = Gr.op(r1, r2)
    if r is None:
        raise ValueError(f"La suma k1 + k2 ≡ 0 (mod {q}): el compromiso conjunto sería el punto al infinito. "
                         "Elige otros números al azar")
    e = hash_juguete(q, *Gr.partes(r), M)
    s1, s2 = (k1 + a1 * x1 * e) % q, (k2 + a2 * x2 * e) % q
    s = (s1 + s2) % q
    ver = verificar(nombre, list(conjunta) if isinstance(conjunta, tuple) else conjunta, M, s, e)
    parcial = [Gr.op(Gr.gen(s1), Gr.exp(y1, a1 * e)) == r1, Gr.op(Gr.gen(s2), Gr.exp(y2, a2 * e)) == r2]
    x_conjunta = (a1 * x1 + a2 * x2) % q
    return {
        "esquema": "schnorr_musig", **Gr.parametros(), "M": M,
        "firmantes": [
            {"nombre": "Alicia", "x": x1, "y": _json(y1), "a": a1, "k": k1, "r": _json(r1),
             "huella": huella_compromiso(Gr, r1), "s": s1, "parcial_ok": parcial[0],
             "cuenta_a": f"a1 = H({' ‖ '.join(map(str, (*base_a, base_a[0])))}) = {_concatenado(*base_a, base_a[0])} mod {q} = {a1}",
             "cuenta_s": f"s1 = k1 + a1·x1·e = {k1} + {a1}·{x1}·{e} = {k1 + a1 * x1 * e} ≡ {s1} (mod {q})"},
            {"nombre": "Beto", "x": x2, "y": _json(y2), "a": a2, "k": k2, "r": _json(r2),
             "huella": huella_compromiso(Gr, r2), "s": s2, "parcial_ok": parcial[1],
             "cuenta_a": f"a2 = H({' ‖ '.join(map(str, (*base_a, base_a[1])))}) = {_concatenado(*base_a, base_a[1])} mod {q} = {a2}",
             "cuenta_s": f"s2 = k2 + a2·x2·e = {k2} + {a2}·{x2}·{e} = {k2 + a2 * x2 * e} ≡ {s2} (mod {q})"},
        ],
        "clave_conjunta": _json(conjunta), "x_conjunta_teorica": x_conjunta,
        "r": _json(r), "e": e, "s": s, "firma": {"s": s, "e": e},
        "cuentas": {"r": f"r = r1·r2 = {Gr.ver(r1)}·{Gr.ver(r2)} → {Gr.ver(r)}",
                    "e": f"e = H({' ‖ '.join(map(str, (*Gr.partes(r), M)))}) = {_concatenado(*Gr.partes(r), M)} mod {q} = {e}",
                    "s": f"s = s1 + s2 = {s1} + {s2} = {s1 + s2} ≡ {s} (mod {q})"},
        "verificacion": ver,
    }


def ataque_clave_maliciosa(x1=6, x_estrella=3) -> dict:
    """Versión ingenua (clave conjunta = y1·y2): Beto anuncia y2' = y*·y1⁻¹ y firma SOLO con x*.

    Con los coeficientes a_i = H(y1 ‖ y2 ‖ y_i) el truco deja de funcionar. (Grupo «zp», §6.2.)
    """
    Gr = GrupoZp()
    _validar(Gr, x=x1)
    _validar(Gr, x=x_estrella)
    p, q = Gr.p, Gr.q
    y1 = Gr.publica(x1)
    y_estrella = Gr.publica(x_estrella)
    y2_falsa = y_estrella * pow(y1, -1, p) % p
    ingenua = y1 * y2_falsa % p
    k, M = 5, 14
    f = firmar("zp", x_estrella, k, M)                         # Beto firma solo
    ver_ingenua = verificar("zp", ingenua, M, f["s"], f["e"])
    a1, a2 = hash_juguete(q, y1, y2_falsa, y1), hash_juguete(q, y1, y2_falsa, y2_falsa)
    con_coef = pow(y1, a1, p) * pow(y2_falsa, a2, p) % p
    ver_coef = verificar("zp", con_coef, M, f["s"], f["e"])
    return {"esquema": "schnorr_ataque", "y1": y1, "x_estrella": x_estrella, "y_estrella": y_estrella,
            "y2_falsa": y2_falsa, "clave_ingenua": ingenua, "firma_beto_solo": f["firma"],
            "acepta_ingenua": ver_ingenua["valida"], "a1": a1, "a2": a2, "clave_con_coeficientes": con_coef,
            "acepta_con_coeficientes": ver_coef["valida"],
            "cuenta": f"y2' = y*·y1⁻¹ = {y_estrella}·{pow(y1, -1, p)} ≡ {y2_falsa} (mod 23); "
                      f"y1·y2' = {y1}·{y2_falsa} ≡ {ingenua} = y*"}


def tablas(nombre) -> dict:
    Gr = grupo(nombre)
    return {"esquema": "schnorr", **Gr.parametros(), **Gr.tabla()}


def _validar(Gr, x=None, k=None, M=None):
    for nombre, v in (("x", x), ("k", k)):
        if v is not None and not (isinstance(v, int) and 1 <= v < Gr.q):
            raise ValueError(f"«{nombre}» debe estar entre 1 y {Gr.q - 1}")
    if M is not None and not (isinstance(M, int) and 0 <= M <= M_MAX):
        raise ValueError(f"el mensaje M debe estar entre 0 y {M_MAX}")
