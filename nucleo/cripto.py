"""Claves Ed25519, serialización canónica, firmas de transacciones y de votos."""
import hashlib
import json
import re
from functools import lru_cache

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization as ser
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

TX_CAMPOS = ("emisor", "receptor", "monto", "timestamp")
_RE_PUB = re.compile(r"^[0-9a-f]{64}$")
_RE_FIRMA = re.compile(r"^[0-9a-f]{128}$")


def canon(obj):
    """Serialización canónica: llaves ordenadas y sin espacios (misma firma en todos lados)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_hex(dato):
    if isinstance(dato, str):
        dato = dato.encode("utf-8")
    return hashlib.sha256(dato).hexdigest()


def clave_desde_semilla(semilla, nodo_id):
    """Clave privada determinista: la misma semilla produce siempre las mismas claves.

    Es un simulador: la semilla aparece en el génesis, así que estas claves NO protegen nada.
    """
    return Ed25519PrivateKey.from_private_bytes(
        hashlib.sha256(f"{semilla}|{nodo_id}".encode("utf-8")).digest())


def pub_hex(priv):
    return priv.public_key().public_bytes(ser.Encoding.Raw, ser.PublicFormat.Raw).hex()


def firmar(priv, mensaje):
    return priv.sign(mensaje).hex()


@lru_cache(maxsize=100_000)
def _verificar_cache(pub, mensaje, firma):
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub)).verify(bytes.fromhex(firma), mensaje)
        return True
    except (InvalidSignature, ValueError):
        return False


# Las 8 codificaciones de puntos de orden pequeño: con ellas Ed25519 «verifica» firmas triviales
# (p. ej. todo ceros) para cualquier mensaje. Ninguna clave legítima del simulador es así.
_PUB_DEBILES = frozenset({
    "00" * 32, "00" * 31 + "80", "01" + "00" * 31, "ec" + "ff" * 30 + "7f",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
})


def verificar(pub, mensaje, firma):
    """Nunca lanza. Función pura (la caché no afecta el determinismo)."""
    if not (isinstance(pub, str) and isinstance(firma, str) and isinstance(mensaje, bytes)):
        return False
    if not (_RE_PUB.match(pub) and _RE_FIRMA.match(firma)) or pub in _PUB_DEBILES:
        return False
    return _verificar_cache(pub, mensaje, firma)


def limpiar_cache():
    _verificar_cache.cache_clear()


# ------------------------------------------------------------- transacciones
def serializar_tx(tx):
    """Lo que se firma: sólo emisor, receptor, monto y timestamp, con orden fijo."""
    return canon({k: tx[k] for k in TX_CAMPOS})


def firmar_tx(priv, tx):
    return firmar(priv, serializar_tx(tx))


def verificar_tx(pub, tx, firma):
    try:
        return verificar(pub, serializar_tx(tx), firma)
    except (KeyError, TypeError):
        return False


def tx_id(tx):
    return sha256_hex(serializar_tx(tx))


# --------------------------------------------------------------------- votos
def mensaje_voto(hash_candidato, votante, voto=True):
    # la etiqueta "tipo" evita confundir un voto con la firma de una transacción
    return canon({"hash_candidato": hash_candidato, "tipo": "voto", "votante": votante,
                  "voto": bool(voto)})


def firmar_voto(priv, hash_candidato, votante, voto=True):
    return firmar(priv, mensaje_voto(hash_candidato, votante, voto))


def verificar_voto(pub, hash_candidato, votante, firma, voto=True):
    if not isinstance(hash_candidato, str) or not isinstance(votante, str):
        return False
    return verificar(pub, mensaje_voto(hash_candidato, votante, voto), firma)
