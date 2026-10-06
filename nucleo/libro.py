"""Libro mayor: los saldos NUNCA se guardan, se derivan repitiendo la cadena (replay).

Orden fijo dentro de cada bloque: castigos → transacciones (en orden) → recompensa → madurez.
Una recompensa del bloque h se acredita al terminar de procesar el bloque h+CONF (CONF=6 en PoW,
0 en PoS) y es gastable desde el bloque h+CONF+1.
"""
from dataclasses import dataclass, field

from .bloque import CLAVES_TX, RE_TS, es_int
from .cripto import tx_id, verificar_tx
from .errores import problema


@dataclass
class Libro:
    disponible: dict
    pendiente: dict
    en_espera: list = field(default_factory=list)   # [(numero, beneficiario, monto)]
    tx_ids: set = field(default_factory=set)
    quemado: int = 0
    altura: int = 0

    def copia(self):
        return Libro(dict(self.disponible), dict(self.pendiente), list(self.en_espera),
                     set(self.tx_ids), self.quemado, self.altura)


def libro_inicial(genesis):
    g = genesis["genesis"]
    return Libro(disponible=dict(g["saldos"]), pendiente={i: 0 for i in g["saldos"]})


def aplicar_tx(libro, tx, firma, params, claves, *, bloqueado=None):
    """Aplica una transacción al libro. Devuelve None si fue válida (y la aplicó) o
    (codigo, detalle) si no (sin modificar nada)."""
    bloqueado = bloqueado or {}
    if not (isinstance(tx, dict) and set(tx.keys()) == set(CLAVES_TX)
            and isinstance(tx["emisor"], str) and isinstance(tx["receptor"], str)
            and es_int(tx["monto"]) and isinstance(tx["timestamp"], str)
            and RE_TS.match(tx["timestamp"]) and isinstance(firma, str)):
        return "tx_estructura", {"motivo": "faltan campos o tienen tipos incorrectos"}
    e, r, m = tx["emisor"], tx["receptor"], tx["monto"]
    if not (1 <= m <= params["monto_max"]):
        return "tx_monto", {"max": params["monto_max"], "monto": m}
    if e == r:
        return "tx_mismo_nodo", {"emisor": e}
    if e not in claves or r not in claves:
        return "tx_nodo_inexistente", {"emisor": e, "receptor": r}
    if not verificar_tx(claves[e], tx, firma):
        for otro in sorted(claves):
            if otro != e and verificar_tx(claves[otro], tx, firma):
                return "tx_otra_clave", {"emisor": e, "firmante": otro}
        return "tx_firma", {"emisor": e}
    ident = tx_id(tx)
    if ident in libro.tx_ids:
        return "tx_duplicada", {"id": ident}
    disp = libro.disponible[e]
    bloq = bloqueado.get(e, 0)
    gastable = max(0, disp - bloq)
    if m > gastable:
        return "tx_saldo", {"emisor": e, "monto": m, "gastable": gastable, "disponible": disp,
                            "bloqueado": bloq, "pendiente_recompensa": libro.pendiente[e]}
    libro.disponible[e] -= m
    libro.disponible[r] += m
    libro.tx_ids.add(ident)
    return None


def aplicar_bloque(libro, b, params, claves):
    """Avanza el libro con un bloque (de forma ya comprobada). Mejor esfuerzo: sólo aplica los
    efectos válidos y devuelve la lista de Problemas; nunca lanza."""
    n = libro.altura + 1
    probs = []

    def falla(codigo, **d):
        probs.append(problema(n, codigo, **d))

    # 1) castigos (PoS): se queman y reducen el saldo disponible del castigado
    eliminados = set()
    for j, c in enumerate(b["castigos"]):
        prop, monto = c.get("proponente"), c.get("monto")
        if not (isinstance(prop, str) and prop in claves and es_int(monto) and monto > 0):
            falla("pos_castigo", motivo=f"el castigo {j + 1} está mal formado")
            continue
        aplicado = min(monto, libro.disponible[prop])
        if aplicado < monto:
            falla("pos_castigo", motivo=f"el castigo de {prop} excede su saldo")
        libro.disponible[prop] -= aplicado
        libro.quemado += aplicado
        if c.get("ronda_pos") == b["ronda_pos"]:
            eliminados.add(prop)
    # las apuestas de los validadores que siguen en la ronda están bloqueadas
    bloqueado = {}
    if params["modo"] == "pos":
        bloqueado = {k: v for k, v in b["apuestas"].items() if k not in eliminados and v > 0}
    # 2) transacciones en orden (lo recibido en el mismo bloque es gastable dentro de él)
    for i, tx in enumerate(b["transacciones"], start=1):
        res = aplicar_tx(libro, tx, b["firma"][i - 1], params, claves, bloqueado=bloqueado)
        if res:
            codigo, det = res
            falla(codigo, i=i, **det)
    # 3) recompensa: siempre la establecida, para el proponente
    prop, R = b["proponente"], params["recompensa"]
    if b["recompensa"] != {"beneficiario": prop, "monto": R}:
        falla("recompensa_falsa", esperado=R, recibido=b["recompensa"])
    if prop in claves and R > 0:
        libro.pendiente[prop] += R
        libro.en_espera.append((n, prop, R))
    # 4) madurez
    conf = params["confirmaciones"]
    quedan = []
    for h, benef, monto in libro.en_espera:
        if h + conf <= n:
            libro.disponible[benef] += monto
            libro.pendiente[benef] -= monto
        else:
            quedan.append((h, benef, monto))
    libro.en_espera = quedan
    libro.altura = n
    return probs


def aplicar_castigos_pendientes(libro, castigos):
    """Vista efectiva (simulación): descuenta castigos que aún no están en la cadena."""
    for c in castigos:
        prop = c["proponente"]
        quitar = min(c["monto"], libro.disponible[prop])
        libro.disponible[prop] -= quitar
        libro.quemado += quitar


def provisional(libro_ref, castigos_pendientes, pool, params, claves, bloqueado=None):
    """Libro sobre el que se prevalida una transacción nueva: cadena + castigos pendientes +
    transacciones ya aceptadas en el pool (misma lógica que la validación de bloques)."""
    lp = libro_ref.copia()
    aplicar_castigos_pendientes(lp, castigos_pendientes)
    for item in pool:
        aplicar_tx(lp, item["tx"], item["firma"], params, claves, bloqueado=bloqueado)
    return lp


def recompensas_info(bloques, params, limite=12):
    """Línea de tiempo de recompensas: pendientes y las últimas maduradas."""
    if not bloques:
        return []
    altura = bloques[-1]["numero"]
    conf = params["confirmaciones"]
    items = []
    for b in bloques[1:]:
        h = b["numero"]
        conf_actual = max(0, altura - h)
        madura = altura >= h + conf
        items.append({
            "bloque": h, "beneficiario": b["proponente"], "monto": params["recompensa"],
            "madura_en": h + conf, "confirmaciones": min(conf_actual, conf) if conf else 0,
            "faltan": max(0, conf - conf_actual), "estado": "madura" if madura else "pendiente",
        })
    pendientes = [i for i in items if i["estado"] == "pendiente"]
    maduras = [i for i in items if i["estado"] == "madura"][-limite:]
    return maduras + pendientes
