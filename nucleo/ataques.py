"""Laboratorio de ataques: cadenas manipuladas que un nodo debe rechazar, y corrupción local."""
import copy

from .bloque import nuevo_bloque, sellar
from .cripto import firmar_tx
from .errores import ErrorSim

TIPOS = {
    "cadena_corta": "Enviar una cadena válida pero más corta: la regla de la cadena más larga la descarta.",
    "igual_longitud": "Enviar una cadena válida de la misma longitud: no es «más larga», así que se conserva la propia.",
    "hash_alterado": "Cambiar la huella guardada de un bloque: ya no coincide con el recálculo.",
    "hash_anterior_alterado": "Cambiar el «hash anterior» de un bloque (y recalcular su huella): el enlace con el bloque previo se rompe.",
    "bloque_intermedio": "Manipular el contenido de un bloque intermedio sin recalcular nada: su huella y su firma delatan el cambio.",
    "bloque_intermedio_recalculado": "Manipular un bloque intermedio y recalcular su huella para disimular: rompe el enlace del siguiente, la firma y el consenso.",
    "firma_alterada": "Agregar un bloque con una transacción cuya firma fue alterada.",
    "firma_otra_clave": "Agregar un bloque con una transacción firmada con la clave de OTRO nodo.",
    "saldo_insuficiente": "Agregar un bloque con una transacción que gasta más de lo que tiene el emisor.",
    "doble_gasto_mismo_bloque": "Agregar un bloque donde el mismo saldo se gasta dos veces dentro del bloque.",
    "doble_gasto_bloques": "Agregar dos bloques donde la misma transacción firmada se repite (doble gasto entre bloques).",
    "recompensa_falsa": "Agregar un bloque que se paga una recompensa distinta de la establecida.",
    "genesis_distinto": "Enviar una cadena con otro bloque génesis (otra red, con saldos inventados).",
}
TIPOS_CORRUPCION = ("contenido", "hash", "firma", "contenido_recalculado")


def _flip_hex(s):
    return ("1" if s[:1] == "0" else "0") + s[1:]


def _flip_ultimo(s):
    return s[:-1] + ("1" if s[-1:] == "0" else "0")


def alterar_copia(bloques, numero, tipo):
    """Altera una COPIA de la cadena. Devuelve (copia, descripcion). La original no se toca."""
    if tipo not in TIPOS_CORRUPCION:
        raise ErrorSim("tipo_invalido", f"Tipo de alteración desconocido. Usa: {', '.join(TIPOS_CORRUPCION)}.",
                       422, "tipo")
    if not (isinstance(numero, int) and not isinstance(numero, bool) and 0 <= numero < len(bloques)):
        raise ErrorSim("bloque_invalido", f"El bloque {numero!r} no existe (hay {len(bloques)} bloques: 0 a "
                                          f"{len(bloques) - 1}).", 422, "bloque")
    copia = copy.deepcopy(bloques)
    b = copia[numero]
    if tipo in ("contenido", "contenido_recalculado"):
        if b["transacciones"]:
            t = b["transacciones"][0]
            antes = t["monto"]
            t["monto"] = antes + 1
            desc = {"campo": "transacciones[0].monto", "antes": antes, "despues": antes + 1}
        else:                                    # el génesis: se inventa saldo
            s = b["genesis"]["saldos"]
            k = sorted(s)[0]
            antes = s[k]
            s[k] = antes + 1
            desc = {"campo": f"genesis.saldos.{k}", "antes": antes, "despues": antes + 1}
        if tipo == "contenido_recalculado":
            sellar(b)                            # el atacante «astuto» recalcula la huella
            desc["huella_recalculada"] = True
    elif tipo == "hash":
        antes = b["hash"]
        b["hash"] = _flip_ultimo(antes)
        desc = {"campo": "hash", "antes": antes, "despues": b["hash"]}
    else:
        if not b["firma"]:
            raise ErrorSim("bloque_invalido", f"El bloque {numero} no tiene firmas que alterar.", 422, "bloque")
        antes = b["firma"][0]
        b["firma"][0] = _flip_hex(antes)
        desc = {"campo": "firma[0]", "antes": antes[:16] + "…", "despues": b["firma"][0][:16] + "…"}
    desc["bloque"] = numero
    return copia, desc


def _elegir_bloque(cadena, bloque, defecto):
    altura = len(cadena) - 1
    if bloque is None:
        return defecto
    if not (isinstance(bloque, int) and not isinstance(bloque, bool) and 0 <= bloque <= altura):
        raise ErrorSim("bloque_invalido", f"El bloque {bloque!r} no existe (0 a {altura}).", 422, "bloque")
    return bloque


def _forjar(sim, cadena, txs, firmas, *, recompensa=None):
    """Bloque forjado y SELLADO (huella coherente) sobre la cadena dada: así sólo falla lo que
    el ataque busca, más lo que ningún atacante puede falsificar (trabajo/votos reales)."""
    ids = sorted(sim.nodos)
    prop = ids[0]
    b = nuevo_bloque(len(cadena), sim.reloj.ahora(), txs, firmas, cadena[-1]["hash"], prop,
                     sim.params["recompensa"], nonce=0)
    if recompensa is not None:
        b["recompensa"]["monto"] = recompensa
    return sellar(b)


def construir_ataque(sim, tipo, bloque=None):
    """Devuelve (cadena_atacante, info). `info.esperado` es el código de problema que debe saltar."""
    if tipo not in TIPOS:
        raise ErrorSim("tipo_invalido", f"Tipo de ataque desconocido. Usa: {', '.join(TIPOS)}.", 422, "tipo")
    ref = sim.ref()
    cadena = copy.deepcopy(ref.cadena)
    altura = len(cadena) - 1
    libro = ref.libro
    ids = sorted(sim.nodos)
    # emisor con más fondos (empate: menor id) y dos receptores distintos
    emisor = max(ids, key=lambda i: (libro.disponible[i], [-ord(c) for c in i]))
    otros = [i for i in ids if i != emisor]
    rec1, rec2 = otros[0], otros[1]
    disp = libro.disponible[emisor]
    ts = sim.reloj.ahora()

    def tx(r, monto, firmante=None):
        t = {"emisor": emisor, "receptor": r, "monto": monto, "timestamp": ts}
        return t, firmar_tx(sim.privs[firmante or emisor], t)

    info = {"tipo": tipo, "explicacion": TIPOS[tipo], "esperado": None, "bloque": None}

    def requiere_bloques():
        if altura < 1:
            raise ErrorSim("sin_bloques", "Este ataque manipula un bloque ya minado: primero agrega al "
                                          "menos un bloque a la cadena.", 409)

    if tipo == "cadena_corta":
        cadena = cadena[:max(1, len(cadena) // 2)]
        info.update(esperado="no_mas_larga", descripcion={"campo": "cadena", "antes": altura + 1,
                                                         "despues": len(cadena)})
    elif tipo == "igual_longitud":
        info.update(esperado="no_mas_larga", descripcion={"campo": "cadena", "antes": altura + 1,
                                                         "despues": altura + 1})
    elif tipo in ("hash_alterado",):
        b = _elegir_bloque(cadena, bloque, altura)
        cadena, desc = alterar_copia(cadena, b, "hash")
        info.update(esperado="genesis_distinto" if b == 0 else "hash", bloque=b, descripcion=desc)
    elif tipo == "hash_anterior_alterado":
        requiere_bloques()
        b = _elegir_bloque(cadena, bloque, altura)
        if b == 0:
            raise ErrorSim("bloque_invalido", "El génesis no tiene bloque anterior.", 422, "bloque")
        antes = cadena[b]["hash_anterior"]
        cadena[b]["hash_anterior"] = _flip_ultimo(antes)
        sellar(cadena[b])
        info.update(esperado="enlace", bloque=b,
                    descripcion={"campo": "hash_anterior", "antes": antes, "despues": cadena[b]["hash_anterior"],
                                 "bloque": b, "huella_recalculada": True})
    elif tipo in ("bloque_intermedio", "bloque_intermedio_recalculado"):
        requiere_bloques()
        b = _elegir_bloque(cadena, bloque, max(1, altura // 2))
        recalc = tipo == "bloque_intermedio_recalculado"
        cadena, desc = alterar_copia(cadena, b, "contenido_recalculado" if recalc else "contenido")
        esperado = "hash" if not recalc else ("enlace" if b < altura else "tx_firma")
        if b == 0:
            esperado = "genesis_distinto"
        info.update(esperado=esperado, bloque=b, descripcion=desc)
    elif tipo == "firma_alterada":
        t, f = tx(rec1, max(1, min(disp, 1)))
        cadena.append(_forjar(sim, cadena, [t], [_flip_hex(f)]))
        info.update(esperado="tx_firma", bloque=len(cadena) - 1,
                    descripcion={"campo": "firma", "antes": f[:16] + "…", "despues": _flip_hex(f)[:16] + "…"})
    elif tipo == "firma_otra_clave":
        t, f = tx(rec1, max(1, min(disp, 1)), firmante=rec2)
        cadena.append(_forjar(sim, cadena, [t], [f]))
        info.update(esperado="tx_otra_clave", bloque=len(cadena) - 1,
                    descripcion={"campo": "firma", "antes": f"firmaría {emisor}", "despues": f"firmó {rec2}"})
    elif tipo == "saldo_insuficiente":
        t, f = tx(rec1, disp + 1)
        cadena.append(_forjar(sim, cadena, [t], [f]))
        info.update(esperado="tx_saldo", bloque=len(cadena) - 1,
                    descripcion={"campo": "monto", "antes": f"saldo {disp}", "despues": f"gasta {disp + 1}"})
    elif tipo == "doble_gasto_mismo_bloque":
        m = max(1, disp)
        t1, f1 = tx(rec1, m)
        t2, f2 = tx(rec2, m)
        cadena.append(_forjar(sim, cadena, [t1, t2], [f1, f2]))
        info.update(esperado="tx_saldo", bloque=len(cadena) - 1,
                    descripcion={"campo": "transacciones", "antes": f"saldo {disp}",
                                 "despues": f"gasta {m} dos veces"})
    elif tipo == "doble_gasto_bloques":
        t, f = tx(rec1, max(1, min(disp, 1)))
        cadena.append(_forjar(sim, cadena, [t], [f]))
        cadena.append(_forjar(sim, cadena, [t], [f]))
        info.update(esperado="tx_duplicada", bloque=len(cadena) - 1,
                    descripcion={"campo": "transacciones", "antes": "1 vez", "despues": "repetida en el bloque siguiente"})
    elif tipo == "recompensa_falsa":
        t, f = tx(rec1, max(1, min(disp, 1)))
        falsa = sim.params["recompensa"] * 10 + 1
        cadena.append(_forjar(sim, cadena, [t], [f], recompensa=falsa))
        info.update(esperado="recompensa_falsa", bloque=len(cadena) - 1,
                    descripcion={"campo": "recompensa", "antes": sim.params["recompensa"], "despues": falsa})
    else:  # genesis_distinto
        g = cadena[0]
        s = g["genesis"]["saldos"]
        antes = s[emisor]
        s[emisor] = antes + 1000
        sellar(g)
        info.update(esperado="genesis_distinto", bloque=0,
                    descripcion={"campo": f"genesis.saldos.{emisor}", "antes": antes, "despues": antes + 1000})
    return cadena, info
