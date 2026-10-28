"""Validación estricta de las entradas de la API de esquemas (sin Flask).

Misma filosofía que nucleo/entradas.py: tipos exactos, rangos explícitos y mensajes en español que la
interfaz muestra tal cual. Todo lo que llega aquí puede venir de un cliente hostil.
"""
import re
import unicodedata

from ..entradas import RE_ID, analizar_entero
from ..errores import ErrorSim
from ..instituciones import INSTITUCIONES

RE_TOKEN = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
RE_HEX64 = re.compile(r"^[0-9a-f]{64}$")
RE_PUNTO = re.compile(r"^0[23][0-9a-f]{64}$")


def entero(valor, campo, minimo, maximo, etiqueta=None):
    etiqueta = etiqueta or f"«{campo}»"
    v, razon = analizar_entero(valor, minimo, maximo)
    if razon:
        raise ErrorSim("fuera_de_rango" if razon in ("negativo", "cero", "demasiado_pequeno", "demasiado_grande")
                       else "tipo_invalido",
                       f"{etiqueta} debe ser un número entero entre {minimo} y {maximo}.", 422, campo,
                       {"razon": razon, "minimo": minimo, "maximo": maximo})
    return v


def booleano(valor, campo, defecto=None):
    if valor is None and defecto is not None:
        return defecto
    if not isinstance(valor, bool):
        raise ErrorSim("tipo_invalido", f"«{campo}» debe ser verdadero o falso.", 422, campo)
    return valor


def opcion(valor, campo, opciones, etiqueta=None):
    if not isinstance(valor, str) or valor not in opciones:
        raise ErrorSim("opcion_invalida", f"{etiqueta or f'«{campo}»'} debe ser una de: {', '.join(opciones)}.",
                       422, campo)
    return valor


def texto(valor, campo, max_bytes, *, min_bytes=1, multilinea=False, etiqueta=None):
    """Texto UTF-8 sin caracteres de control (salvo saltos de línea si `multilinea`)."""
    etiqueta = etiqueta or f"«{campo}»"
    if not isinstance(valor, str):
        raise ErrorSim("tipo_invalido", f"{etiqueta} debe ser texto.", 422, campo)
    permitidos = "\n\t" if multilinea else ""
    if any(unicodedata.category(c) in ("Cc", "Cs") and c not in permitidos for c in valor):
        raise ErrorSim("texto_invalido", f"{etiqueta} contiene caracteres de control: escribe texto normal.", 422, campo)
    n = len(valor.encode("utf-8", errors="surrogatepass"))
    if n < min_bytes or not valor.strip():
        raise ErrorSim("texto_vacio", f"{etiqueta} no puede estar vacío.", 422, campo)
    if n > max_bytes:
        raise ErrorSim("texto_largo", f"{etiqueta} es demasiado largo: máximo {max_bytes} bytes "
                                      f"(las letras con acento o ñ ocupan 2).", 422, campo,
                       {"maximo": max_bytes, "recibido": n})
    return valor


def token(valor, campo, etiqueta=None):
    """Identificador libre (semilla de sesión, id de ronda): 1–64 caracteres seguros."""
    if not (isinstance(valor, str) and RE_TOKEN.match(valor)):
        raise ErrorSim("token_invalido", f"{etiqueta or f'«{campo}»'} debe tener de 1 a 64 caracteres: letras, "
                                         "números, «_», «.», «:» o «-».", 422, campo)
    return valor


def institucion(valor, campo):
    if not (isinstance(valor, str) and RE_ID.match(valor) and valor in INSTITUCIONES):
        raise ErrorSim("institucion_inexistente", f"«{campo}» debe ser una institución del catálogo (N01 … N20).",
                       422, campo)
    return valor


def instituciones(valor, campo, minimo, maximo):
    if not isinstance(valor, list):
        raise ErrorSim("tipo_invalido", f"«{campo}» debe ser una lista de instituciones (N01 … N20).", 422, campo)
    if not minimo <= len(valor) <= maximo:
        raise ErrorSim("fuera_de_rango", f"«{campo}» debe tener entre {minimo} y {maximo} instituciones.", 422, campo,
                       {"minimo": minimo, "maximo": maximo})
    ids = [institucion(v, campo) for v in valor]
    if len(set(ids)) != len(ids):
        raise ErrorSim("repetido", f"«{campo}» repite una institución.", 422, campo)
    return ids


def hex64(valor, campo, etiqueta=None):
    if not (isinstance(valor, str) and RE_HEX64.match(valor)):
        raise ErrorSim("hex_invalido", f"{etiqueta or f'«{campo}»'} debe tener 64 caracteres hexadecimales "
                                       "en minúsculas.", 422, campo)
    return valor


def punto(valor, campo):
    if not (isinstance(valor, str) and RE_PUNTO.match(valor)):
        raise ErrorSim("hex_invalido", f"«{campo}» debe ser un punto comprimido: 66 caracteres hexadecimales "
                                       "que empiezan con 02 o 03.", 422, campo)
    return valor


def lista(valor, campo, minimo, maximo):
    if not isinstance(valor, list) or not minimo <= len(valor) <= maximo:
        raise ErrorSim("tipo_invalido", f"«{campo}» debe ser una lista de {minimo} a {maximo} elementos.", 422, campo)
    return valor


def objeto(valor, campo, permitidos, requeridos=()):
    if not isinstance(valor, dict):
        raise ErrorSim("tipo_invalido", f"«{campo}» debe ser un objeto.", 422, campo)
    sobran = sorted(str(k) for k in valor if k not in permitidos)
    if sobran:
        raise ErrorSim("campo_desconocido", f"«{campo}» trae campos no permitidos: {', '.join(sobran)}.", 422, campo)
    for r in requeridos:
        if r not in valor:
            raise ErrorSim("campo_requerido", f"A «{campo}» le falta «{r}».", 422, campo)
    return valor
