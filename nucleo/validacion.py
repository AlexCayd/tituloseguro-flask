"""Validación de bloques y cadenas completas: reglas (a), (b) y (c) de la guía.

(d) —la cadena recibida debe ser más larga que la propia— depende de cada nodo y vive en
`red.Nodo.recibir_cadena`. `validar_cadena` es TOTAL (nunca lanza) y no se detiene en el
primer error, para que se vea en qué bloques se propaga el daño.
"""
from dataclasses import dataclass, field

from .bloque import (GENESIS_PREV, RE_HEX64, es_int, forma_bloque, hash_bloque,
                     hash_bloque_seguro, hash_candidato)
from .consenso import castigo, cumple_objetivo, indice_de, sortear, umbral_cumplido
from .cripto import verificar_voto
from .entradas import ids_nodos
from .errores import ErrorSim, Problema, problema
from .libro import aplicar_bloque, libro_inicial


@dataclass
class Informe:
    valida: bool
    problemas: list = field(default_factory=list)
    bloques: list = field(default_factory=list)     # [{numero, valido, fallas}]
    libro: object = None
    altura: int = -1
    hash_cabeza: str = None

    def a_dict(self, max_problemas=40):
        return {"valida": self.valida, "total_problemas": len(self.problemas),
                "problemas": [p.a_dict() for p in self.problemas[:max_problemas]],
                "bloques": self.bloques}


# --------------------------------------------------------------------- génesis
def _motivo_parametros(gp, n_max=20):
    """None si los parámetros del génesis son coherentes; si no, el motivo."""
    claves_esperadas = {"version", "modo", "n", "semilla", "claves", "saldos", "recompensa",
                        "confirmaciones", "dificultad", "umbral", "castigo", "monto_max",
                        "max_tx_bloque"}
    if set(gp.keys()) != claves_esperadas:
        return "campos de parámetros incorrectos"
    if gp["version"] != 1 or gp["modo"] not in ("pow", "pos"):
        return "versión o modo desconocidos"
    n = gp["n"]
    if not (es_int(n) and 2 <= n <= n_max):
        return "número de nodos fuera de rango"
    ids = ids_nodos(n)
    if not (isinstance(gp["claves"], dict) and sorted(gp["claves"]) == ids
            and all(isinstance(v, str) and RE_HEX64.match(v) for v in gp["claves"].values())):
        return "registro de claves públicas inválido"
    if not (isinstance(gp["saldos"], dict) and sorted(gp["saldos"]) == ids
            and all(es_int(v) and v >= 0 for v in gp["saldos"].values())):
        return "saldos iniciales inválidos"
    if not isinstance(gp["semilla"], str):
        return "semilla inválida"
    if not (es_int(gp["recompensa"]) and gp["recompensa"] >= 0):
        return "recompensa inválida"
    if not (es_int(gp["confirmaciones"]) and 0 <= gp["confirmaciones"] <= 100):
        return "confirmaciones inválidas"
    if not (es_int(gp["monto_max"]) and gp["monto_max"] >= 1
            and es_int(gp["max_tx_bloque"]) and gp["max_tx_bloque"] >= 1):
        return "límites inválidos"
    if gp["modo"] == "pow":
        if not (es_int(gp["dificultad"]) and 1 <= gp["dificultad"] <= 8):
            return "dificultad inválida"
        if gp["umbral"] is not None or gp["castigo"] is not None:
            return "un génesis PoW no define umbral ni castigo"
    else:
        if gp["dificultad"] is not None:
            return "un génesis PoS no define dificultad"
        if gp["umbral"] != {"num": 2, "den": 3}:
            return "el umbral debe ser 2/3"
        c = gp["castigo"]
        if not (isinstance(c, dict) and set(c.keys()) == {"regla", "alfa_pm"}):
            return "castigo inválido"
        if c["regla"] == "A":
            if c["alfa_pm"] is not None:
                return "la regla A no usa alfa"
        elif c["regla"] == "B":
            if not (es_int(c["alfa_pm"]) and 1 <= c["alfa_pm"] <= 1000):
                return "alfa inválido"
        else:
            return "regla de castigo desconocida"
    return None


def validar_genesis(g):
    motivos = forma_bloque(g, es_genesis=True)
    if motivos:
        return [problema(0, "genesis_invalido", motivo=m) for m in motivos[:3]]
    probs = []

    def falla(m):
        probs.append(problema(0, "genesis_invalido", motivo=m))

    if g["numero"] != 0 or g["hash_anterior"] != GENESIS_PREV:
        falla("no es el bloque 0 o su hash_anterior no son ceros")
    if (g["transacciones"] or g["firma"] or g["votos"] or g["apuestas"] or g["castigos"]
            or g["nonce"] != 0 or g["ronda_pos"] != 0 or g["proponente"] != "genesis"
            or g["recompensa"] != {"beneficiario": None, "monto": 0}):
        falla("trae contenido que el génesis no puede tener")
    if g["hash"] != hash_bloque_seguro(g):
        falla("la huella no coincide con su contenido")
    motivo = _motivo_parametros(g["genesis"])
    if motivo:
        falla(motivo)
    return probs


# ----------------------------------------------------------------------- bloque
def _validar_pow(b, params, claves):
    num, probs = b["numero"], []
    if b["votos"] or b["apuestas"] or b["castigos"] or b["ronda_pos"] != 0:
        probs.append(problema(num, "pow_campos_pos"))
    d = params["dificultad"]
    if not cumple_objetivo(b["hash"], d):
        probs.append(problema(num, "pow_objetivo", d=d))
    prop = b["proponente"]
    if prop not in claves:
        probs.append(problema(num, "pow_particion", motivo="el proponente no es un nodo de la red"))
    elif b["nonce"] % params["n"] != indice_de(prop):
        probs.append(problema(num, "pow_particion",
                              motivo=f"el nonce {b['nonce']} no es ≡ {indice_de(prop)} (mod {params['n']})"))
    return probs


def _validar_pos(b, libro_pre, params, claves, completo):
    num, probs = b["numero"], []

    def falla(c, **d):
        probs.append(problema(num, c, **d))

    if b["nonce"] != 0:
        falla("pos_nonce")
    rp = b["ronda_pos"]
    if rp < 1:
        falla("pos_apuestas", motivo="el bloque no indica la ronda de Proof of Stake")
        return probs
    regla, alfa_pm = params["castigo"]["regla"], params["castigo"]["alfa_pm"]
    apuestas, castigos = b["apuestas"], b["castigos"]

    mismos, arrastrados = [], []
    for c in castigos:
        (mismos if c.get("ronda_pos") == rp else arrastrados).append(c)
    arrastrado_por_nodo = {}
    for c in arrastrados:
        if isinstance(c.get("proponente"), str) and es_int(c.get("monto")):
            arrastrado_por_nodo[c["proponente"]] = arrastrado_por_nodo.get(c["proponente"], 0) + c["monto"]

    # 1) apuestas: nodos reales, 0 < apuesta <= saldo disponible (menos castigos arrastrados)
    if not apuestas:
        falla("pos_apuestas", motivo="el bloque no registra apuestas")
        return probs
    restantes = {}
    for vid, a in sorted(apuestas.items()):
        if vid not in claves:
            falla("pos_apuestas", motivo=f"«{vid[:12]}» no es un nodo de la red")
            continue
        tope = libro_pre.disponible[vid] - arrastrado_por_nodo.get(vid, 0)
        if not (0 < a <= tope):
            falla("pos_apuestas", motivo=f"{vid} apuesta {a} pero solo puede apostar {max(tope, 0)}")
            continue
        restantes[vid] = a

    # 2) castigos de ESTA ronda: cada intento debe coincidir con el sorteo reproducible
    mismos.sort(key=lambda c: c["intento"] if es_int(c.get("intento")) else -1)
    for j, c in enumerate(mismos):
        prop = c.get("proponente")
        if c.get("intento") != j or prop not in claves:
            falla("pos_castigo", motivo=f"el intento {j} del registro de castigos es inconsistente")
            break
        try:
            gan, _ = sortear(restantes, b["hash_anterior"], num, j)
        except ErrorSim:
            falla("pos_sorteo", motivo=f"no había validadores para el intento {j}")
            break
        if gan != prop:
            falla("pos_sorteo", motivo=f"el intento {j} debió sortear a {gan}, no a {prop}")
        if c.get("apuesta") != apuestas.get(prop):
            falla("pos_castigo", motivo=f"la apuesta registrada de {prop} no coincide")
        if c.get("monto") != castigo(regla, c.get("apuesta"), c.get("valor_tx"), alfa_pm):
            falla("pos_castigo", motivo=f"el monto del castigo de {prop} no sigue la regla {regla}")
        if not verificar_voto(claves[prop], c.get("hash_candidato"), prop, c.get("firma"), True):
            falla("pos_castigo", motivo=f"{prop} no firmó el candidato que se le atribuye")
        restantes.pop(prop, None)
    # castigos arrastrados de rondas previas: forma, fórmula y firma del castigado
    for c in arrastrados:
        prop = c.get("proponente")
        if prop not in claves:
            falla("pos_castigo", motivo="castigo arrastrado de un nodo inexistente")
        elif c.get("monto") != castigo(regla, c.get("apuesta"), c.get("valor_tx"), alfa_pm) \
                or not verificar_voto(claves[prop], c.get("hash_candidato"), prop, c.get("firma"), True):
            falla("pos_castigo", motivo=f"el castigo arrastrado de {prop} no es verificable")

    # 3) el proponente es el que arroja el sorteo con los validadores que quedan
    if not restantes:
        falla("pos_sorteo", motivo="no quedan validadores")
        return probs
    k = len(mismos)
    esperado, _ = sortear(restantes, b["hash_anterior"], num, k)
    if b["proponente"] != esperado:
        falla("pos_sorteo", motivo=f"el intento {k} sortea a {esperado}, no a {b['proponente']}")

    # 4) votos (sólo en el bloque final): ponderados por apuesta, firmados, sin duplicados, ≥ 2/3
    if completo:
        hc = hash_candidato(b)
        A = sum(restantes.values())
        vistos, V = set(), 0
        for v in b["votos"]:
            vid = v["votante"]
            if vid in vistos:
                falla("pos_voto_duplicado", votante=vid)
                continue
            vistos.add(vid)
            if vid not in restantes:
                falla("pos_voto_no_validador", votante=vid)
            elif v["peso"] != restantes[vid]:
                falla("pos_voto_peso", votante=vid)
            elif not verificar_voto(claves[vid], hc, vid, v["firma"], True):
                falla("pos_voto_firma", votante=vid)
            else:
                V += v["peso"]
        if b["proponente"] not in vistos:
            falla("pos_proponente_sin_voto")
        if not umbral_cumplido(V, A):
            falla("pos_quorum", V=V, A=A)
    return probs


def validar_bloque(b, previo, libro, params, claves, *, completo=True):
    """Valida un bloque contra el anterior y AVANZA `libro` con sus efectos válidos.

    completo=False valida un candidato (sin hash final ni votos/cuórum)."""
    n = libro.altura + 1
    if not isinstance(b, dict):
        return [problema(n, "estructura", motivo="el bloque no es un objeto")]
    motivos = forma_bloque(b, con_hash=completo)
    if motivos:
        num = b["numero"] if es_int(b.get("numero")) else n
        return [problema(num, "estructura", motivo=m) for m in motivos[:3]]
    probs = []
    num = b["numero"]
    if num != n:
        probs.append(problema(num, "numero", pos=n, numero=num))
    prev_hash = previo.get("hash") if isinstance(previo, dict) else None
    if b["hash_anterior"] != prev_hash:
        probs.append(problema(num, "enlace"))
    if completo and b["hash"] != hash_bloque_seguro(b):
        probs.append(problema(num, "hash"))
    if not b["transacciones"]:
        probs.append(problema(num, "sin_tx"))
    if len(b["transacciones"]) > params["max_tx_bloque"]:
        probs.append(problema(num, "exceso_tx", n=len(b["transacciones"]),
                              max=params["max_tx_bloque"]))
    libro_pre = libro.copia()
    probs += aplicar_bloque(libro, b, params, claves)
    if params["modo"] == "pow":
        if completo:  # un candidato PoW aún no tiene nonce: no hay nada que comprobar
            probs += _validar_pow(b, params, claves)
    else:
        probs += _validar_pos(b, libro_pre, params, claves, completo)
    return probs


def validar_candidato(b, previo, libro, params, claves):
    return validar_bloque(b, previo, libro, params, claves, completo=False)


# ----------------------------------------------------------------------- cadena
def validar_cadena(bloques, *, genesis_esperado=None):
    """Valida la cadena completa. TOTAL: nunca lanza y no se detiene en el primer error."""
    try:
        return _validar_cadena(bloques, genesis_esperado)
    except Exception as e:  # noqa: BLE001 - la entrada puede ser cualquier cosa
        return Informe(False, [problema(-1, "estructura_ilegible", motivo=type(e).__name__)])


def _validar_cadena(bloques, genesis_esperado):
    if not isinstance(bloques, list) or not bloques:
        return Informe(False, [problema(-1, "estructura_ilegible",
                                        motivo="se esperaba una lista de bloques no vacía")])
    g = bloques[0]
    probs = list(validar_genesis(g))
    estado = []
    cabeza = bloques[-1].get("hash") if isinstance(bloques[-1], dict) else None
    if genesis_esperado is not None and isinstance(g, dict) \
            and g.get("hash") != genesis_esperado.get("hash"):
        probs.append(problema(0, "genesis_distinto"))
    if probs:
        estado.append({"numero": 0, "valido": False, "fallas": [p.codigo for p in probs]})
        return Informe(False, probs, estado, None, len(bloques) - 1, cabeza)
    params, claves = g["genesis"], g["genesis"]["claves"]
    libro = libro_inicial(g)
    estado.append({"numero": 0, "valido": True, "fallas": []})
    for i in range(1, len(bloques)):
        b = bloques[i]
        ps = validar_bloque(b, bloques[i - 1], libro, params, claves)
        if isinstance(b, dict) and isinstance(b.get("numero"), int) and b["numero"] != i \
                and not any(p.codigo == "numero" for p in ps):
            ps.append(problema(i, "numero", pos=i, numero=b["numero"]))
        probs += ps
        estado.append({"numero": i, "valido": not ps, "fallas": sorted({p.codigo for p in ps})})
    return Informe(not probs, probs, estado, libro, len(bloques) - 1, cabeza)
