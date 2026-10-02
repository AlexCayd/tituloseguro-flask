"""Núcleo de Título Seguro: bloque, firma, nodos mineros, cadena y validación.

No depende de Flask ni de la base de datos: la app solo lo orquesta.
"""
import copy
import hashlib
import json
import threading
import time
from datetime import datetime, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization as ser
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

DIFICULTAD = 5                      # ceros hexadecimales iniciales por defecto
DIFICULTADES_PERMITIDAS = (3, 4, 5)  # lo que el ADMIN puede elegir; ningún bloque puede traer menos
RECOMPENSA = 50                     # TS por bloque
NODOS = ("Derek", "Carlos", "Alicia", "Bruno")
HASH_GENESIS_ANTERIOR = "0" * 64
TS_GENESIS = "2026-08-01T00:00:00Z"


def ahora():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- Etapa 1: hash
def sha256(d):
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


def hash_bloque(b):  # el campo "hash" no entra en el cálculo
    return sha256({k: v for k, v in b.items() if k != "hash"})


# ---------------------------------------------------------------- Etapa 2: firma
class Billetera:
    """Par de llaves Ed25519. `pub` es la llave pública en hex (el 'remitente')."""

    def __init__(self, priv=None):
        self.priv = priv or Ed25519PrivateKey.generate()
        self.pub = self.priv.public_key().public_bytes(
            ser.Encoding.Raw, ser.PublicFormat.Raw
        ).hex()

    @classmethod
    def desde_hex(cls, priv_hex):
        return cls(Ed25519PrivateKey.from_private_bytes(bytes.fromhex(priv_hex)))

    @property
    def priv_hex(self):
        return self.priv.private_bytes(
            ser.Encoding.Raw, ser.PrivateFormat.Raw, ser.NoEncryption()
        ).hex()

    def firmar(self, tx):
        return self.priv.sign(json.dumps(tx, sort_keys=True).encode()).hex()


def verificar_firma(tx, firma):
    try:
        pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(tx["remitente"]))
        pub.verify(bytes.fromhex(firma), json.dumps(tx, sort_keys=True).encode())
        return True
    except (InvalidSignature, ValueError, KeyError, TypeError):
        return False


# ---------------------------------------------------------------- Etapa 4: cadena
def bloque_genesis():
    b = {
        "numero": 0,
        "timestamp": TS_GENESIS,
        "transaccion": {
            "proposito": "genesis",
            "remitente": "TITULO SEGURO",
            "contenido": {"mensaje": "Bloque génesis de la red Título Seguro"},
            "hora": TS_GENESIS,
        },
        "firma": "",
        "hash_anterior": HASH_GENESIS_ANTERIOR,
        "nonce": 0,
        "minero": "génesis",
        "recompensa": 0,
        "dificultad": 0,
    }
    b["hash"] = hash_bloque(b)
    return b


class Cadena:
    """Lista de bloques + el candado que protege su escritura."""

    def __init__(self, bloques=None, validar_contenido=None):
        self.bloques = list(bloques) if bloques else [bloque_genesis()]
        self.pendiente = None
        self.candado = threading.Lock()
        self.al_agregar = None                  # callback(bloque): persistencia
        self.validar_contenido = validar_contenido  # callback(tx) -> mensaje de error | None

    @property
    def ultimo(self):
        return self.bloques[-1]

    def saldos(self):
        s = {n: 0 for n in NODOS}
        for b in self.bloques[1:]:
            s[b["minero"]] = s.get(b["minero"], 0) + b["recompensa"]
        return s

    def nuevo_bloque(self, tx, firma, minero, dificultad, timestamp=None):
        """Bloque sin minar: mismo contenido para todos, solo cambia `minero`."""
        return {
            "numero": len(self.bloques),
            "timestamp": timestamp or ahora(),
            "transaccion": copy.deepcopy(tx),
            "firma": firma,
            "hash_anterior": self.ultimo["hash"],
            "nonce": 0,
            "minero": minero,
            "recompensa": RECOMPENSA,
            "dificultad": dificultad,
        }

    def agregar(self, bloque):
        """Último filtro antes de sellar: se llama dentro del candado."""
        if bloque["numero"] != len(self.bloques):
            raise ValueError("el bloque ya no ocupa el siguiente lugar de la cadena")
        if bloque["hash_anterior"] != self.ultimo["hash"]:
            raise ValueError("el bloque no enlaza con el último de la cadena")
        problemas = _revisar_bloque(bloque, self.ultimo, self.validar_contenido)
        if problemas:
            raise ValueError(problemas[0]["mensaje"])
        if self.al_agregar:  # primero a disco: la memoria nunca va por delante de la base
            self.al_agregar(bloque)
        self.bloques.append(bloque)

    def validar(self):
        return validar_bloques(self.bloques, self.validar_contenido)

    def es_valida(self):
        return self.validar()["valida"]


def _revisar_bloque(b, previo, validar_contenido=None):
    """Las comprobaciones de un bloque contra el que lo antecede."""
    n = b.get("numero", "?")
    p = []

    def falla(codigo, mensaje):
        p.append({"bloque": n, "codigo": codigo, "mensaje": mensaje})

    if b.get("hash_anterior") != previo.get("hash"):
        falla("enlace", "El enlace con el bloque anterior está roto: su 'hash anterior' "
                        "ya no coincide con la huella guardada del bloque previo.")
    try:
        recalculado = hash_bloque(b)
    except (TypeError, ValueError):
        recalculado = None
    if b.get("hash") != recalculado:
        falla("hash", "La huella guardada no coincide con la que sale de recalcular el "
                      "bloque: alguien cambió su contenido.")
    dif = b.get("dificultad")
    if dif not in DIFICULTADES_PERMITIDAS:
        falla("dificultad", "La dificultad declarada no es una de las permitidas por la red.")
    elif not str(b.get("hash", "")).startswith("0" * dif):
        falla("dificultad", f"La huella no empieza con {dif} ceros: no hay trabajo "
                            "demostrado para este bloque.")
    tx = b.get("transaccion", {})
    if not verificar_firma(tx, b.get("firma", "")):
        falla("firma", "La firma digital no corresponde a la transacción: no la emitió "
                       "quien dice haberla emitido, o fue modificada.")
    if b.get("recompensa") != RECOMPENSA or b.get("minero") not in NODOS:
        falla("recompensa", "La recompensa o el minero del bloque no son válidos.")
    elif not isinstance(b.get("nonce"), int) or b["nonce"] % len(NODOS) != NODOS.index(b["minero"]):
        falla("particion", "El nonce no pertenece a la partición de nonces de su minero.")
    if validar_contenido:
        msg = validar_contenido(tx)
        if msg:
            falla("credencial", msg)
    return p


def validar_bloques(bloques, validar_contenido=None):
    """Recorre la cadena completa y no se detiene en el primer error:
    así se ve en qué bloques se propaga el daño."""
    problemas, estado = [], []
    g = bloques[0] if bloques else {}
    gp = []
    if g.get("numero") != 0 or g.get("hash_anterior") != HASH_GENESIS_ANTERIOR:
        gp.append({"bloque": 0, "codigo": "genesis", "mensaje": "El bloque génesis no es el esperado."})
    if g.get("hash") != hash_bloque(g):
        gp.append({"bloque": 0, "codigo": "hash", "mensaje": "La huella del génesis no coincide."})
    problemas += gp
    estado.append({"bloque": 0, "valido": not gp, "fallas": [x["codigo"] for x in gp]})
    for i in range(1, len(bloques)):
        b = bloques[i]
        p = _revisar_bloque(b, bloques[i - 1], validar_contenido)
        if b.get("numero") != i:
            p.append({"bloque": i, "codigo": "numero", "mensaje": "El número del bloque no corresponde a su posición."})
        problemas += p
        estado.append({"bloque": i, "valido": not p, "fallas": [x["codigo"] for x in p]})
    return {"valida": not problemas, "problemas": problemas, "bloques": estado}


# ------------------------------------------------- Laboratorio de alteraciones
def alterar_copia(bloques, numero, tipo, preferidos=("programa", "tipo", "fecha_emision")):
    """Altera una COPIA de la cadena. Devuelve (copia, descripcion). La original no se toca.

    tipo: contenido | hash | firma | contenido_recalculado
    """
    copia = copy.deepcopy(bloques)
    b = copia[numero]
    if tipo in ("contenido", "contenido_recalculado"):
        c = b["transaccion"]["contenido"]
        campo = next((k for k in preferidos if k in c), next(iter(c)))
        antes = c[campo]
        c[campo] = "Medicina" if campo == "programa" and antes != "Medicina" else f"{antes}*"
        desc = {"campo": campo, "antes": antes, "despues": c[campo]}
        if tipo == "contenido_recalculado":
            b["hash"] = hash_bloque(b)  # el atacante 'astuto' recalcula la huella
    elif tipo == "hash":
        antes = b["hash"]
        b["hash"] = antes[:-1] + ("0" if antes[-1] != "0" else "1")
        desc = {"campo": "hash", "antes": antes, "despues": b["hash"]}
    elif tipo == "firma":
        antes = b["firma"]
        b["firma"] = ("0" if antes[0] != "0" else "1") + antes[1:]
        desc = {"campo": "firma", "antes": antes, "despues": b["firma"]}
    else:
        raise ValueError("tipo de alteración desconocido")
    return copia, desc


# ---------------------------------------------------------------- Etapa 3: nodos
class Nodo:
    """Un minero. Prueba los nonces i, i+n, i+2n, ... (clase residual módulo n)."""

    def __init__(self, i, nombre, n=len(NODOS)):
        self.i, self.nombre, self.n = i, nombre, n
        self.saldo = 0
        self.intentos = 0
        self.ultimo = ""
        self.bloque = None
        self.resultado = "en espera"  # en espera | probando | ganó | detenido
        self.t0 = None
        self.t1 = None

    def reiniciar(self, bloque):
        self.bloque = bloque
        self.intentos = 0
        self.ultimo = ""
        self.resultado = "probando"
        self.t0 = time.perf_counter()
        self.t1 = None

    def hashrate(self):
        if self.t0 is None:
            return 0
        t = (self.t1 or time.perf_counter()) - self.t0
        return self.intentos / t if t > 0 else 0

    def minar(self, bloque, cadena, fin, estado):
        bloque["nonce"] = self.i  # k = 0: nonce = i
        prefijo = "0" * bloque["dificultad"]
        try:
            while not fin.is_set():
                h = hash_bloque(bloque)
                self.intentos += 1
                self.ultimo = h
                if h.startswith(prefijo):
                    with cadena.candado:
                        if fin.is_set():  # alguien ganó antes
                            estado["bitacora"].append(
                                {"t": ahora(), "tipo": "obsoleta",
                                 "texto": f"{self.nombre} también encontró un nonce válido "
                                          f"({bloque['nonce']}), pero llegó tarde: solución obsoleta."})
                            return
                        if bloque["nonce"] % self.n != self.i:
                            raise ValueError("nonce fuera de la partición del nodo")
                        bloque["hash"] = h
                        cadena.agregar(bloque)
                        self.saldo += bloque["recompensa"]
                        cadena.pendiente, estado["ganador"] = None, self.nombre
                        self.resultado = "ganó"
                        fin.set()  # ¡todos se detienen!
                        return
                bloque["nonce"] += self.n  # i + k*n -> i + (k+1)*n
        except Exception as e:  # persistencia o regla que falló: detener la carrera con motivo
            estado["error"] = str(e)
            fin.set()
        finally:
            self.t1 = time.perf_counter()
            if self.resultado == "probando":
                self.resultado = "detenido"


class Ronda:
    """Una carrera: un hilo por nodo, un Event `fin` compartido y el candado de la cadena."""

    def __init__(self, cadena, tx, firma, dificultad, nodos, timestamp=None):
        self.cadena, self.nodos = cadena, nodos
        self.dificultad = dificultad
        self.fin = threading.Event()
        self.t0 = None
        self.t1 = None
        self.estado = {"ganador": None, "error": None, "bitacora": []}
        ts = timestamp or ahora()
        # cada nodo mina SU versión del bloque: mismo contenido, distinto minero
        self.bloques = [cadena.nuevo_bloque(tx, firma, n.nombre, dificultad, ts) for n in nodos]
        self.numero = self.bloques[0]["numero"]
        cadena.pendiente = tx
        self.hilos = []

    def _log(self, tipo, texto):
        self.estado["bitacora"].append({"t": ahora(), "tipo": tipo, "texto": texto})

    def iniciar(self):
        self.t0 = time.perf_counter()
        self._log("inicio", f"Comienza la carrera por el bloque #{self.numero} "
                            f"(dificultad {self.dificultad}: la huella debe empezar con "
                            f"{self.dificultad} ceros).")
        for n, b in zip(self.nodos, self.bloques):
            n.reiniciar(b)
        for n, b in zip(self.nodos, self.bloques):
            h = threading.Thread(target=self._correr, args=(n, b), daemon=True)
            self.hilos.append(h)
            h.start()
        return self

    def _correr(self, nodo, bloque):
        nodo.minar(bloque, self.cadena, self.fin, self.estado)
        if self.fin.is_set() and self.t1 is None:
            with self.cadena.candado:
                if self.t1 is None:
                    self.t1 = time.perf_counter()
                    g = self.estado["ganador"]
                    if g:
                        self._log("ganador", f"¡{g} encontró el nonce! El bloque #{self.numero} "
                                             f"se agrega a la cadena y {g} cobra {RECOMPENSA} TS.")
                    elif self.estado["error"]:
                        self._log("error", f"La carrera se detuvo: {self.estado['error']}")

    @property
    def activa(self):
        """Hay carrera mientras nadie haya activado `fin` (los hilos perdedores tardan µs en salir)."""
        return not self.fin.is_set()

    @property
    def minando(self):
        return self.t0 is not None and not self.fin.is_set()

    @property
    def terminada(self):
        return self.fin.is_set() and not any(h.is_alive() for h in self.hilos)

    def esperar(self, timeout=None):
        for h in self.hilos:
            h.join(timeout)

    def estado_publico(self):
        t = (self.t1 or time.perf_counter()) - self.t0 if self.t0 else 0
        g = self.estado["ganador"]
        return {
            "minando": self.minando,
            "ganador": g,
            "error": self.estado["error"],
            "numero": self.numero,
            "dificultad": self.dificultad,
            "transcurrido": round(t, 2),
            "nodos": [
                {
                    "i": n.i,
                    "nombre": n.nombre,
                    "intentos": n.intentos,
                    "ultimo": n.ultimo,
                    "nonce": n.bloque["nonce"] if n.bloque else None,
                    "hashrate": round(n.hashrate()),
                    "resultado": n.resultado,
                    "ganador": n.nombre == g,
                }
                for n in self.nodos
            ],
            "bitacora": self.estado["bitacora"][-30:],
        }


def crear_nodos():
    return [Nodo(i, nombre) for i, nombre in enumerate(NODOS)]
