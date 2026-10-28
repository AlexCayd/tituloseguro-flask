"""Azar criptográfico reproducible.

Los protocolos interactivos (conocimiento cero) necesitan que el probador recuerde su número al azar
entre un mensaje y el siguiente. Para que el servidor no tenga que guardar estado, ese azar se DERIVA
con HMAC-SHA256 de un secreto del servidor y de un identificador de ronda: el mismo par da siempre el
mismo azar, y sin el secreto del servidor nadie puede calcularlo.
"""
import hashlib
import hmac
import secrets


class Flujo:
    """Generador determinista (HMAC-SHA256 en modo contador) con muestreo por rechazo, sin sesgo."""

    def __init__(self, clave: bytes, *etiquetas):
        datos = b"|".join(e if isinstance(e, bytes) else str(e).encode("utf-8") for e in etiquetas)
        self._clave = hmac.new(clave, b"TituloSeguro/flujo/v1|" + datos, hashlib.sha256).digest()
        self._contador = 0
        self._bufer = b""

    def bytes(self, n: int) -> bytes:
        while len(self._bufer) < n:
            self._bufer += hmac.new(self._clave, self._contador.to_bytes(8, "big"), hashlib.sha256).digest()
            self._contador += 1
        salida, self._bufer = self._bufer[:n], self._bufer[n:]
        return salida

    def randbelow(self, n: int) -> int:
        """Entero uniforme en [0, n) (muestreo por rechazo, como secrets.randbelow)."""
        if n <= 0:
            raise ValueError("n debe ser positivo")
        k = n.bit_length()
        nbytes = (k + 7) // 8
        mascara = (1 << k) - 1
        while True:
            v = int.from_bytes(self.bytes(nbytes), "big") & mascara
            if v < n:
                return v

    def barajar(self, lista):
        """Fisher–Yates con el flujo: permutación uniforme."""
        lista = list(lista)
        for i in range(len(lista) - 1, 0, -1):
            j = self.randbelow(i + 1)
            lista[i], lista[j] = lista[j], lista[i]
        return lista


class AzarDelSistema:
    """Misma interfaz que Flujo pero con el generador del sistema operativo (`secrets`)."""

    @staticmethod
    def bytes(n: int) -> bytes:
        return secrets.token_bytes(n)

    @staticmethod
    def randbelow(n: int) -> int:
        return secrets.randbelow(n)

    def barajar(self, lista):
        lista = list(lista)
        for i in range(len(lista) - 1, 0, -1):
            j = secrets.randbelow(i + 1)
            lista[i], lista[j] = lista[j], lista[i]
        return lista


SISTEMA = AzarDelSistema()
