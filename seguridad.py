"""Secretos derivados de SECRET_KEY: cifrado de llaves de emisor y ID de alumno seudónimo."""
import base64
import hashlib
import hmac
import os

import bcrypt
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def hash_password(pw):
    b = pw.encode()
    if len(b) > 72:  # bcrypt solo lee 72 bytes; mejor avisar que truncar en silencio
        raise ValueError("La contraseña no puede pasar de 72 bytes.")
    return bcrypt.hashpw(b, bcrypt.gensalt(int(os.environ.get("BCRYPT_ROUNDS", 12)))).decode()


def verificar_password(pw, hash_):
    try:
        return bcrypt.checkpw(pw.encode(), hash_.encode())
    except ValueError:
        return False


def normalizar_matricula(m):
    return "".join(str(m).split()).upper()


class Secretos:
    def __init__(self, secret):
        base = secret.encode()

        def derivar(info):
            return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(base)

        self._fernet = Fernet(base64.urlsafe_b64encode(derivar(b"titulo-seguro/llaves-de-emisor")))
        self._pepper = derivar(b"titulo-seguro/id-de-alumno")

    def cifrar(self, texto):
        return self._fernet.encrypt(texto.encode()).decode()

    def descifrar(self, token):
        return self._fernet.decrypt(token.encode()).decode()

    def alumno_id(self, matricula):
        """HMAC de la matrícula. Un hash simple de una matrícula numérica se adivinaría por
        fuerza bruta; con un secreto del servidor, no."""
        return hmac.new(self._pepper, normalizar_matricula(matricula).encode(), hashlib.sha256).hexdigest()
