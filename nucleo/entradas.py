"""Validación estricta de las entradas (sin Flask): enteros, ids, semilla, alfa y configuración."""
import math
import re
from decimal import Decimal, InvalidOperation

from . import constantes as C
from .errores import ErrorSim

RE_ID = re.compile(r"^N\d{2}$")
RE_SEMILLA = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")
_RE_ENTERO = re.compile(r"^[+-]?[0-9]+$")
_RE_NUMERO = re.compile(r"^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$")
_NO_FINITOS = {"nan", "inf", "infinity"}


def ids_nodos(n):
    return [f"N{i:02d}" for i in range(1, n + 1)]


def _mostrar(valor):
    t = repr(valor)
    return t if len(t) <= 30 else t[:27] + "…"


def analizar_entero(valor, minimo, maximo, *, permitir_str=False):
    """Devuelve (entero, None) o (None, razón). Nunca lanza.

    Razones: vacio, booleano, no_finito, no_entero, no_numerico, negativo, cero,
    demasiado_pequeno, demasiado_grande.
    """
    if valor is None:
        return None, "vacio"
    if isinstance(valor, bool):
        return None, "booleano"
    if isinstance(valor, int):
        v = valor
    elif isinstance(valor, float):
        return None, ("no_finito" if not math.isfinite(valor) else "no_entero")
    elif isinstance(valor, str):
        if not permitir_str:
            return None, "no_numerico"
        s = valor.strip()
        if s == "":
            return None, "vacio"
        if s.lstrip("+-").lower() in _NO_FINITOS:
            return None, "no_finito"
        if _RE_ENTERO.match(s):
            if len(s.lstrip("+-").lstrip("0")) > 15:
                return None, ("negativo" if s.startswith("-") else "demasiado_grande")
            v = int(s)
        elif _RE_NUMERO.match(s):
            return None, "no_entero"
        else:
            return None, "no_numerico"
    else:
        return None, "no_numerico"
    if v < 0:
        return None, "negativo"
    if v == 0 and minimo > 0:
        return None, "cero"
    if v < minimo:
        return None, "demasiado_pequeno"
    if v > maximo:
        return None, "demasiado_grande"
    return v, None


_MSG_MONTO = {
    "vacio": "El monto está vacío: escribe un número entero positivo.",
    "booleano": "El monto no puede ser verdadero/falso: escribe un número entero positivo.",
    "no_finito": "El monto debe ser un número finito.",
    "no_numerico": "El monto {v} no es un número: escribe solo dígitos.",
    "no_entero": "El monto debe ser un número entero (sin decimales ni notación científica).",
    "negativo": "El monto no puede ser negativo.",
    "cero": "El monto debe ser mayor que cero.",
    "demasiado_pequeno": "El monto debe ser mayor que cero.",
    "demasiado_grande": "El monto es demasiado grande (máximo {max}).",
}


def parse_monto(valor, campo="monto", maximo=C.MONTO_MAX):
    v, razon = analizar_entero(valor, 1, maximo, permitir_str=True)
    if razon:
        raise ErrorSim("monto_invalido",
                       _MSG_MONTO[razon].format(v=_mostrar(valor), max=maximo), 422, campo,
                       {"razon": razon})
    return v


def parse_entero(valor, campo, minimo, maximo, *, codigo_rango="fuera_de_rango", etiqueta=None):
    """Entero JSON estricto (no acepta texto). Rango incumplido -> `codigo_rango`."""
    etiqueta = etiqueta or f"«{campo}»"
    v, razon = analizar_entero(valor, minimo, maximo)
    if razon is None:
        return v
    if razon in ("negativo", "cero", "demasiado_pequeno", "demasiado_grande"):
        raise ErrorSim(codigo_rango,
                       f"{etiqueta} debe estar entre {minimo} y {maximo} (recibido: {_mostrar(valor)}).",
                       422, campo, {"razon": razon, "minimo": minimo, "maximo": maximo})
    raise ErrorSim("tipo_invalido",
                   f"{etiqueta} debe ser un número entero entre {minimo} y {maximo} "
                   f"(recibido: {_mostrar(valor)}).", 422, campo, {"razon": razon})


def parse_bool(valor, campo):
    if not isinstance(valor, bool):
        raise ErrorSim("tipo_invalido", f"«{campo}» debe ser verdadero o falso.", 422, campo)
    return valor


def exigir_campos(datos, permitidos, requeridos=()):
    """422 si hay campos desconocidos o faltan los requeridos."""
    if not isinstance(datos, dict):
        raise ErrorSim("cuerpo_no_objeto", "El cuerpo debe ser un objeto JSON.", 400)
    sobran = sorted(str(k) for k in datos if k not in permitidos)
    if sobran:
        raise ErrorSim("campo_desconocido",
                       f"Campo(s) no permitido(s): {', '.join(sobran)}. "
                       f"Campos válidos: {', '.join(sorted(permitidos))}.",
                       422, sobran[0], {"permitidos": sorted(permitidos)})
    for r in requeridos:
        if r not in datos:
            raise ErrorSim("campo_requerido", f"Falta el campo «{r}».", 422, r)


def parse_id(valor, campo, ids, *, http=422):
    if not isinstance(valor, str):
        raise ErrorSim("tipo_invalido", f"«{campo}» debe ser el identificador de un nodo (N01…).",
                       422, campo)
    if not RE_ID.match(valor) or valor not in ids:
        raise ErrorSim("nodo_inexistente",
                       f"El nodo «{valor[:20]}» no existe en esta red.", http, campo)
    return valor


def parse_semilla(valor):
    if isinstance(valor, int) and not isinstance(valor, bool) and 0 <= valor < 10**12:
        valor = str(valor)
    if not (isinstance(valor, str) and RE_SEMILLA.match(valor)):
        raise ErrorSim("semilla_invalida",
                       "La semilla debe ser texto de 1 a 40 caracteres: letras, números, «_», «.», «:» o «-».",
                       422, "semilla")
    return valor


def parse_alfa(valor):
    """alfa (0 < alfa <= 1, hasta 3 decimales) -> milésimas enteras."""
    def malo():
        return ErrorSim("alfa_invalido",
                        "alfa debe ser un número mayor que 0 y como máximo 1, con hasta 3 decimales.",
                        422, "alfa")
    if isinstance(valor, bool) or valor is None:
        raise malo()
    if isinstance(valor, (int, float)):
        if isinstance(valor, float) and not math.isfinite(valor):
            raise malo()
        texto = repr(valor)
    elif isinstance(valor, str) and len(valor) <= 12:
        texto = valor.strip()
    else:
        raise malo()
    try:
        d = Decimal(texto)
    except InvalidOperation:
        raise malo() from None
    if not d.is_finite() or not (0 < d <= 1):
        raise malo()
    pm = d * 1000
    if pm != pm.to_integral_value():
        raise malo()
    return int(pm)


CAMPOS_COMUNES = {"n", "semilla", "saldo_inicial", "saldos", "recompensa", "epoca"}
CAMPOS_POW = {"dificultad", "k", "max_rondas", "pausa_ms"}
CAMPOS_POS = {"n_validadores", "regla_castigo", "alfa"}


def parse_config(modo, datos, *, semilla_defecto="demo", n_min=C.N_MIN, n_max=C.N_MAX,
                 dif_min=C.DIF_MIN, dif_max=C.DIF_MAX):
    """Valida y normaliza la configuración para crear una simulación."""
    from .pow import k_por_defecto  # import tardío: pow depende de módulos que dependen de éste
    if modo not in C.MODOS:
        raise ErrorSim("modo_invalido", "El modo debe ser «pow» o «pos».", 404)
    permitidos = CAMPOS_COMUNES | (CAMPOS_POW if modo == "pow" else CAMPOS_POS)
    exigir_campos(datos, permitidos, ("n",))
    n = parse_entero(datos["n"], "n", n_min, n_max, codigo_rango="n_fuera_de_rango",
                     etiqueta="El número de nodos")
    ids = ids_nodos(n)
    semilla = parse_semilla(datos["semilla"]) if datos.get("semilla") is not None \
        else semilla_defecto
    saldo = parse_entero(datos.get("saldo_inicial", C.SALDO_DEFECTO), "saldo_inicial", 0,
                         C.SALDO_MAX, codigo_rango="saldo_invalido", etiqueta="El saldo inicial")
    saldos = {i: saldo for i in ids}
    extra = datos.get("saldos")
    if extra is not None:
        if not isinstance(extra, dict):
            raise ErrorSim("tipo_invalido", "«saldos» debe ser un objeto {nodo: saldo}.", 422, "saldos")
        for k, v in extra.items():
            parse_id(k, "saldos", ids)
            saldos[k] = parse_entero(v, "saldos", 0, C.SALDO_MAX, codigo_rango="saldo_invalido",
                                     etiqueta=f"El saldo de {k}")
    recompensa = parse_entero(datos.get("recompensa", C.RECOMPENSA_DEFECTO), "recompensa", 0,
                              C.RECOMPENSA_MAX, etiqueta="La recompensa")
    cfg = {"modo": modo, "n": n, "semilla": semilla, "saldo_inicial": saldo, "saldos": saldos,
           "recompensa": recompensa, "dificultad": None, "k": None, "max_rondas": None,
           "pausa_ms": None, "n_validadores": None, "regla_castigo": None, "alfa_pm": None}
    if modo == "pow":
        d = parse_entero(datos.get("dificultad", C.DIF_DEFECTO), "dificultad", dif_min, dif_max,
                         codigo_rango="dificultad_fuera_de_rango", etiqueta="La dificultad")
        k = datos.get("k")
        k = k_por_defecto(d, n) if k is None else parse_entero(
            k, "k", 1, C.K_MAX, codigo_rango="k_fuera_de_rango", etiqueta="«k» (nonces por ronda)")
        cfg.update(
            dificultad=d, k=k,
            max_rondas=parse_entero(datos.get("max_rondas", C.MAX_RONDAS_DEFECTO), "max_rondas", 1,
                                    C.MAX_RONDAS_MAX, etiqueta="El límite de rondas"),
            pausa_ms=parse_entero(datos.get("pausa_ms", C.PAUSA_MS_DEFECTO), "pausa_ms", 0,
                                  C.PAUSA_MS_MAX, etiqueta="La pausa entre rondas"))
    else:
        nv = datos.get("n_validadores")
        regla = datos.get("regla_castigo", "A")
        if regla not in ("A", "B"):
            raise ErrorSim("regla_invalida", "La regla de castigo debe ser «A» o «B».", 422,
                           "regla_castigo")
        alfa_pm = None
        if regla == "B":
            alfa_pm = parse_alfa(datos["alfa"]) if datos.get("alfa") is not None \
                else C.ALFA_PM_DEFECTO
        elif datos.get("alfa") is not None:
            parse_alfa(datos["alfa"])  # aunque no se use con A, si viene debe ser válido
        cfg.update(
            n_validadores=None if nv is None else parse_entero(
                nv, "n_validadores", 1, n, codigo_rango="n_validadores_invalido",
                etiqueta="El número de validadores"),
            regla_castigo=regla, alfa_pm=alfa_pm)
    return cfg
