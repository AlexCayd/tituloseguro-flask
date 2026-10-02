"""Reglas del propósito 'registro académico': qué lleva una credencial y qué se valida antes de minar."""
import re
import secrets
from dataclasses import dataclass, field
from datetime import date, datetime

from blockchain import ahora, sha256, verificar_firma

PROPOSITO_REGISTRO = "registro_academico"
PROPOSITO_REVOCACION = "revocacion"
TIPOS = ("título", "diploma", "certificado", "constancia")
CAMPOS_REGISTRO = {"folio", "universidad", "tipo", "fecha_emision", "alumno_id", "programa", "huella_documento"}
CAMPOS_REVOCACION = {"folio_revocado", "motivo", "fecha"}

RE_FOLIO = re.compile(r"^TS-([A-Z]{3})-([0-9A-F]{12})$")
RE_HEX64 = re.compile(r"^[0-9a-f]{64}$")
RE_HORA = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _fecha(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def normalizar_folio(f):
    return str(f or "").strip().upper()


def huella_documento(c):
    """SHA-256 canónico del 'documento' (los datos de la credencial). Es lo único que
    identifica al documento en la cadena: no hay PDF ni nombre en claro."""
    return sha256({k: c[k] for k in ("alumno_id", "programa", "tipo", "universidad", "fecha_emision")})


def clave_dup(c):
    return f"{c['alumno_id']}|{c['programa'].strip().casefold()}|{c['tipo']}"


# ------------------------------------------------------------------ construcción
def construir_registro(codigo, pub, alumno_id, programa, tipo, fecha_emision, hora=None):
    c = {
        "folio": f"TS-{codigo}-{secrets.token_hex(6).upper()}",
        "universidad": codigo,
        "tipo": tipo,
        "fecha_emision": fecha_emision,
        "alumno_id": alumno_id,
        "programa": programa.strip(),
    }
    c["huella_documento"] = huella_documento(c)
    return {"proposito": PROPOSITO_REGISTRO, "remitente": pub, "contenido": c, "hora": hora or ahora()}


def construir_revocacion(pub, folio, motivo, hora=None):
    hora = hora or ahora()
    return {
        "proposito": PROPOSITO_REVOCACION,
        "remitente": pub,
        "contenido": {"folio_revocado": normalizar_folio(folio), "motivo": motivo.strip(), "fecha": hora[:10]},
        "hora": hora,
    }


def validar_formulario(programa, tipo, fecha_emision):
    """Valida lo que escribe una persona (no el formato interno). Lanza ValueError con un mensaje claro."""
    programa = (programa or "").strip()
    if not 2 <= len(programa) <= 80:
        raise ValueError("El programa académico debe tener entre 2 y 80 caracteres.")
    if tipo not in TIPOS:
        raise ValueError("Elige un tipo de credencial de la lista.")
    f = _fecha(fecha_emision)
    if not f or f.year < 1950:
        raise ValueError("La fecha de emisión no es válida (usa AAAA-MM-DD).")
    if f > date.today():
        raise ValueError("La fecha de emisión no puede estar en el futuro.")
    return programa, tipo, f.isoformat()


# ------------------------------------------------------------------ estructura (la revisa la cadena)
def validar_estructura(tx):
    """Integridad de la credencial. Se ejecuta por cada bloque al validar la cadena."""
    if not isinstance(tx, dict) or not isinstance(tx.get("contenido"), dict):
        return "La transacción no tiene la estructura esperada."
    if not RE_HEX64.match(str(tx.get("remitente", ""))):
        return "El remitente no es una llave pública válida."
    if not RE_HORA.match(str(tx.get("hora", ""))):
        return "La hora de la transacción no tiene formato válido."
    c, prop = tx["contenido"], tx.get("proposito")
    if prop == PROPOSITO_REGISTRO:
        if set(c) != CAMPOS_REGISTRO:
            return "La credencial no tiene exactamente los campos esperados."
        m = RE_FOLIO.match(str(c["folio"]))
        if not m or m.group(1) != c["universidad"]:
            return "El folio no tiene el formato TS-UNI-CLAVE o no coincide con la universidad."
        if c["tipo"] not in TIPOS:
            return "El tipo de credencial no es válido."
        if not _fecha(c["fecha_emision"]):
            return "La fecha de emisión no es válida."
        if not RE_HEX64.match(str(c["alumno_id"])):
            return "El ID de alumno no es un hash válido."
        if not isinstance(c["programa"], str) or not 2 <= len(c["programa"]) <= 80:
            return "El programa académico no es válido."
        if c["huella_documento"] != huella_documento(c):
            return "La huella del documento no corresponde a los datos de la credencial."
        return None
    if prop == PROPOSITO_REVOCACION:
        if set(c) != CAMPOS_REVOCACION:
            return "La revocación no tiene exactamente los campos esperados."
        if not RE_FOLIO.match(str(c["folio_revocado"])):
            return "El folio revocado no tiene formato válido."
        if not isinstance(c["motivo"], str) or not 3 <= len(c["motivo"]) <= 200:
            return "El motivo de la revocación debe tener entre 3 y 200 caracteres."
        if not _fecha(c["fecha"]):
            return "La fecha de la revocación no es válida."
        return None
    return "El propósito de la transacción no es reconocido."


# ------------------------------------------------------------------ reglas de negocio (estado)
@dataclass
class IndiceCadena:
    registros: dict = field(default_factory=dict)   # folio -> bloque
    revocados: dict = field(default_factory=dict)   # folio -> bloque de revocación
    huellas: dict = field(default_factory=dict)     # huella -> folio (solo vigentes)
    claves: dict = field(default_factory=dict)      # alumno|programa|tipo -> folio (solo vigentes)


@dataclass
class IndicePendientes:
    folios: set = field(default_factory=set)
    huellas: set = field(default_factory=set)
    claves: set = field(default_factory=set)
    revocaciones: set = field(default_factory=set)  # folios con revocación en cola


def indexar_cadena(bloques):
    ix = IndiceCadena()
    for b in bloques[1:]:
        tx = b["transaccion"]
        if tx["proposito"] == PROPOSITO_REGISTRO:
            ix.registros[tx["contenido"]["folio"]] = b
        elif tx["proposito"] == PROPOSITO_REVOCACION:
            ix.revocados[tx["contenido"]["folio_revocado"]] = b
    for folio, b in ix.registros.items():
        if folio in ix.revocados:
            continue
        c = b["transaccion"]["contenido"]
        ix.huellas[c["huella_documento"]] = folio
        ix.claves[clave_dup(c)] = folio
    return ix


def validar_reglas(tx, firma, codigos_por_pub, ix, pend=None):
    """Lo que se exige ANTES de minar (y se vuelve a exigir al empezar la carrera).
    Devuelve un mensaje de rechazo o None si todo está bien."""
    pend = pend or IndicePendientes()
    msg = validar_estructura(tx)
    if msg:
        return msg
    if not verificar_firma(tx, firma):
        return "La firma digital no es válida: la transacción se rechaza."
    codigo = codigos_por_pub.get(tx["remitente"])
    if not codigo:
        return "La llave que firma no pertenece a ninguna institución autorizada."
    c = tx["contenido"]
    if tx["proposito"] == PROPOSITO_REGISTRO:
        if c["universidad"] != codigo:
            return (f"La llave de {codigo} no puede emitir credenciales a nombre de "
                    f"{c['universidad']}: cada universidad solo emite con su propio código.")
        if c["folio"] in ix.registros or c["folio"] in pend.folios:
            return "Ese folio ya existe."
        if c["huella_documento"] in ix.huellas or c["huella_documento"] in pend.huellas:
            return "Ese documento ya está registrado (la misma huella no puede registrarse dos veces)."
        if clave_dup(c) in ix.claves or clave_dup(c) in pend.claves:
            return "Ese alumno ya tiene una credencial vigente del mismo tipo y programa."
        return None
    folio = c["folio_revocado"]
    original = ix.registros.get(folio)
    if not original:
        return "No existe una credencial minada con ese folio: solo se puede revocar lo que ya está en la cadena."
    if original["transaccion"]["remitente"] != tx["remitente"]:
        return "Solo la institución que emitió la credencial puede revocarla."
    if folio in ix.revocados or folio in pend.revocaciones:
        return "Esa credencial ya está revocada (o tiene una revocación en espera)."
    return None


def estado_credencial(folio, ix, pend_folios=()):
    """('vigente'|'revocada'|'pendiente'|'desconocida', bloque_registro, bloque_revocacion)"""
    folio = normalizar_folio(folio)
    b = ix.registros.get(folio)
    if b:
        if folio in ix.revocados:
            return "revocada", b, ix.revocados[folio]
        return "vigente", b, None
    if folio in pend_folios:
        return "pendiente", None, None
    return "desconocida", None, None
