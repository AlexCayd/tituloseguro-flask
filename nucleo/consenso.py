"""Primitivas puras de consenso, compartidas por la validación y por los motores PoW/PoS."""
import hashlib

from .errores import ErrorSim


def cumple_objetivo(hash_hex, dificultad):
    """PoW: la huella debe empezar con `dificultad` ceros hexadecimales."""
    return isinstance(hash_hex, str) and hash_hex.startswith("0" * dificultad)


def indice_de(nodo_id):
    """N07 -> 6 (índice global del minero; los nonces son i, i+N, i+2N, ...)."""
    return int(nodo_id[1:]) - 1


def sortear(validadores, hash_anterior, numero, intento):
    """Sorteo ponderado y reproducible (intervalos acumulados, orden fijo por id).

    validadores: {id: apuesta}. Devuelve (ganador, traza). La semilla es pública:
    cualquiera puede recalcular el sorteo con los mismos datos.
    """
    ids = sorted(v for v, a in validadores.items() if isinstance(a, int) and a > 0)
    A = sum(validadores[v] for v in ids)
    if A <= 0:
        raise ErrorSim("sin_validadores", "No hay apuestas con las que sortear.", 409)
    semilla = f"{hash_anterior}|{numero}|{intento}"
    r = int(hashlib.sha256(semilla.encode()).hexdigest(), 16) % A
    acum, intervalos, ganador = 0, [], None
    for v in ids:
        desde = acum
        acum += validadores[v]
        intervalos.append({"id": v, "desde": desde, "hasta": acum})
        if ganador is None and r < acum:
            ganador = v
    return ganador, {"semilla": semilla, "r": r, "A": A, "intervalos": intervalos,
                     "ganador": ganador}


def umbral_cumplido(v, a):
    """Votos a favor suman al menos 2/3 de lo apostado: 3V >= 2A (aritmética entera)."""
    return 3 * v >= 2 * a


def castigo(regla, apuesta, valor_tx, alfa_pm):
    """Monto que pierde el proponente rechazado.

    A: pierde toda su apuesta.  B: min(apuesta, ceil(alfa * valor de las tx)), con alfa en
    milésimas (alfa_pm) para no usar flotantes en el consenso. Siempre entre 1 y la apuesta.
    """
    if not (isinstance(apuesta, int) and not isinstance(apuesta, bool) and apuesta > 0):
        return -1
    if regla == "A":
        return apuesta
    if regla == "B" and isinstance(valor_tx, int) and not isinstance(valor_tx, bool) \
            and isinstance(alfa_pm, int) and not isinstance(alfa_pm, bool) and alfa_pm > 0:
        return max(1, min(apuesta, (alfa_pm * max(valor_tx, 0) + 999) // 1000))
    return -1
