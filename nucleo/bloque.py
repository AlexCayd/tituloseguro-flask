"""Estructura del bloque, hash canónico, génesis y comprobación de forma (total)."""
import hashlib
import json
import re

GENESIS_PREV = "0" * 64
CLAVES_BLOQUE = ("numero", "timestamp", "transacciones", "firma", "hash_anterior", "nonce",
                 "proponente", "recompensa", "votos", "apuestas", "castigos", "ronda_pos", "hash")
CLAVES_TX = ("emisor", "receptor", "monto", "timestamp")
RE_TS = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
RE_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_CENTINELA = 123456789012345678901234567890   # 30 dígitos: marca dónde va el nonce


def es_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def hash_bloque(b):
    """SHA-256 de todos los campos menos 'hash' (nunca entra en su propio cálculo)."""
    datos = {k: v for k, v in b.items() if k != "hash"}
    return hashlib.sha256(json.dumps(datos, sort_keys=True).encode()).hexdigest()


def hash_bloque_seguro(b):
    try:
        return hash_bloque(b)
    except (TypeError, ValueError, RecursionError, AttributeError):
        return None


def hash_candidato(b):
    """Huella del bloque SIN votos: es lo que firman los votantes (evita la circularidad,
    porque el hash final sí cubre los votos)."""
    return hash_bloque({**b, "votos": []})


def preparar_hash_rapido(b):
    """Devuelve f(nonce) -> hash equivalente a hash_bloque({**b, 'nonce': nonce}).

    Serializa una sola vez con un nonce centinela y reutiliza el prefijo ya hasheado:
    cada intento sólo procesa el nonce y el sufijo.
    """
    s = json.dumps({k: v for k, v in b.items() if k != "hash"} | {"nonce": _CENTINELA},
                   sort_keys=True)
    marca = str(_CENTINELA)
    if s.count(marca) != 1:
        raise ValueError("el centinela del nonce no es único en el bloque")
    i = s.index(marca)
    base = hashlib.sha256(s[:i].encode())
    sufijo = s[i + len(marca):]

    def hash_con_nonce(nonce):
        h = base.copy()
        h.update(f"{nonce}{sufijo}".encode())
        return h.hexdigest()

    return hash_con_nonce


def nuevo_genesis(params, ts):
    g = {
        "numero": 0,
        "timestamp": ts,
        "transacciones": [],
        "firma": [],
        "hash_anterior": GENESIS_PREV,
        "nonce": 0,
        "proponente": "genesis",
        "recompensa": {"beneficiario": None, "monto": 0},
        "votos": [],
        "apuestas": {},
        "castigos": [],
        "ronda_pos": 0,
        "genesis": params,
    }
    return sellar(g)


def nuevo_bloque(numero, timestamp, txs, firmas, hash_anterior, proponente, recompensa, *,
                 nonce=0, votos=(), apuestas=None, castigos=(), ronda_pos=0):
    """Bloque SIN 'hash' (se agrega con sellar)."""
    return {
        "numero": numero,
        "timestamp": timestamp,
        "transacciones": [dict(t) for t in txs],
        "firma": list(firmas),
        "hash_anterior": hash_anterior,
        "nonce": nonce,
        "proponente": proponente,
        "recompensa": {"beneficiario": proponente, "monto": recompensa},
        "votos": [dict(v) for v in votos],
        "apuestas": dict(apuestas or {}),
        "castigos": [dict(c) for c in castigos],
        "ronda_pos": ronda_pos,
    }


def sellar(b):
    b["hash"] = hash_bloque(b)
    return b


def forma_bloque(b, *, con_hash=True, es_genesis=False):
    """Comprobación de forma, TOTAL: devuelve la lista de motivos (vacía si está bien)."""
    if not isinstance(b, dict):
        return ["el bloque no es un objeto"]
    esperadas = set(CLAVES_BLOQUE)
    if not con_hash:
        esperadas.discard("hash")
    if es_genesis:
        esperadas.add("genesis")
    claves = set(b.keys())
    if claves != esperadas:
        falta, sobra = sorted(esperadas - claves), sorted(map(str, claves - esperadas))
        return [f"claves incorrectas (faltan: {falta or '-'}; sobran: {sobra or '-'})"]
    m = []
    if not (es_int(b["numero"]) and b["numero"] >= 0):
        m.append("«numero» debe ser un entero no negativo")
    if not (isinstance(b["timestamp"], str) and RE_TS.match(b["timestamp"])):
        m.append("«timestamp» tiene un formato inválido")
    txs, firmas = b["transacciones"], b["firma"]
    if not isinstance(txs, list):
        m.append("«transacciones» debe ser una lista")
    else:
        for i, t in enumerate(txs, start=1):
            if not (isinstance(t, dict) and set(t.keys()) == set(CLAVES_TX)):
                m.append(f"la transacción {i} no tiene los campos emisor/receptor/monto/timestamp")
            elif not (isinstance(t["emisor"], str) and isinstance(t["receptor"], str)
                      and es_int(t["monto"])
                      and isinstance(t["timestamp"], str) and RE_TS.match(t["timestamp"])):
                m.append(f"la transacción {i} tiene tipos incorrectos")
    if not (isinstance(firmas, list) and all(isinstance(f, str) for f in firmas)):
        m.append("«firma» debe ser una lista de textos")
    elif isinstance(txs, list) and len(firmas) != len(txs):
        m.append("«firma» debe traer una firma por cada transacción")
    if not isinstance(b["hash_anterior"], str):
        m.append("«hash_anterior» debe ser texto")
    if not (es_int(b["nonce"]) and b["nonce"] >= 0):
        m.append("«nonce» debe ser un entero no negativo")
    if not isinstance(b["proponente"], str):
        m.append("«proponente» debe ser texto")
    r = b["recompensa"]
    if not (isinstance(r, dict) and set(r.keys()) == {"beneficiario", "monto"}
            and (r["beneficiario"] is None or isinstance(r["beneficiario"], str))
            and es_int(r["monto"])):
        m.append("«recompensa» debe ser {beneficiario, monto}")
    v = b["votos"]
    if not (isinstance(v, list) and all(
            isinstance(x, dict) and set(x.keys()) == {"votante", "peso", "firma"}
            and isinstance(x["votante"], str) and es_int(x["peso"]) and isinstance(x["firma"], str)
            for x in v)):
        m.append("«votos» debe ser una lista de {votante, peso, firma}")
    a = b["apuestas"]
    if not (isinstance(a, dict) and all(isinstance(k, str) and es_int(x) for k, x in a.items())):
        m.append("«apuestas» debe ser {nodo: monto entero}")
    c = b["castigos"]
    if not (isinstance(c, list) and all(isinstance(x, dict) for x in c)):
        m.append("«castigos» debe ser una lista de objetos")
    if not (es_int(b["ronda_pos"]) and b["ronda_pos"] >= 0):
        m.append("«ronda_pos» debe ser un entero no negativo")
    if con_hash and not isinstance(b["hash"], str):
        m.append("«hash» debe ser texto")
    if es_genesis and not isinstance(b["genesis"], dict):
        m.append("«genesis» debe ser un objeto")
    return m
