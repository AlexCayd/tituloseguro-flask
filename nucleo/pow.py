"""Proof of Work por rondas (ticks): cada minero prueba k nonces por ronda, sin hilos por minero.

Nonces disjuntos: el minero i (0..N-1) sólo prueba i, i+N, i+2N, ... Si varios mineros hallan
un nonce válido en la MISMA ronda gana el de menor hash numérico (desempate final: menor
índice); los demás quedan como «obsoletos».
"""
import math
from dataclasses import dataclass

from . import constantes as C
from .bloque import hash_bloque, nuevo_bloque, preparar_hash_rapido, sellar
from .consenso import cumple_objetivo
from .errores import ErrorSim

REGLA_EMPATE = ("Si dos o más instituciones hallan un nonce válido en la misma ronda gana la de "
                "hash numéricamente menor; si el hash empatara, la de menor índice.")


@dataclass(frozen=True)
class Candidato:
    indice: int
    id: str
    nonce: int
    hash: str


def k_por_defecto(d, n):
    """k tal que un bloque tarde unas 60 rondas en promedio: 16^d / (60 · n)."""
    return max(5, min(C.K_MAX, math.ceil(16 ** d / (60 * n))))


def elegir_ganador(candidatos):
    """Devuelve (ganador, perdedores): gana el menor int(hash,16); empate: menor índice."""
    if not candidatos:
        raise ErrorSim("sin_candidatos", "No hay candidatos.", 409)
    orden = sorted(candidatos, key=lambda c: (int(c.hash, 16), c.indice))
    return orden[0], orden[1:]


class Minero:
    def __init__(self, indice, nid, activo, hash_rapido):
        self.indice, self.id, self.activo = indice, nid, activo
        self.hash_rapido = hash_rapido
        self.intentos = 0
        self.nonce_actual = None
        self.ultimo_hash = ""
        self.estado = "probando" if activo else "inactivo"

    def probar(self, ronda, k, n, dificultad):
        """Prueba los k nonces de su carril correspondientes a la ronda; se detiene en el
        primero válido. Nonce j-ésimo global: i + j·N."""
        base = ronda * k
        for j in range(k):
            nonce = self.indice + (base + j) * n
            h = self.hash_rapido(nonce)
            self.intentos += 1
            self.nonce_actual, self.ultimo_hash = nonce, h
            if cumple_objetivo(h, dificultad):
                return Candidato(self.indice, self.id, nonce, h)
        return None


def construir_plantillas(numero, timestamp, txs, firmas, hash_anterior, ids, recompensa):
    """Un bloque candidato (sin nonce ni hash) por minero: mismo contenido, distinto proponente."""
    return {mid: nuevo_bloque(numero, timestamp, txs, firmas, hash_anterior, mid, recompensa,
                              nonce=0) for mid in ids}


class TrabajoPoW:
    """Una carrera por el siguiente bloque. Avanza con `paso()` (una ronda completa)."""

    def __init__(self, ident, plantillas, ids, activos, dificultad, k, max_rondas, tx_ids,
                 automatico):
        self.id = ident
        self.n = len(ids)
        self.dificultad, self.k, self.max_rondas = dificultad, k, max_rondas
        self.tx_ids = list(tx_ids)
        self.automatico = automatico
        self.plantillas = plantillas
        self.numero_bloque = plantillas[ids[0]]["numero"]
        self.mineros = [Minero(i, mid, mid in activos, preparar_hash_rapido(plantillas[mid]))
                        for i, mid in enumerate(ids)]
        self.ronda = 0
        self.estado = "minando"          # minando | ganado | cancelado | limite | error
        self.ganador = None
        self.ronda_empate = None
        self.bloque_final = None
        self.mensaje = None

    @property
    def activo(self):
        return self.estado == "minando"

    def intentos_total(self):
        return sum(m.intentos for m in self.mineros)

    def paso(self):
        if self.estado != "minando":
            raise ErrorSim("no_hay_trabajo", "La carrera ya terminó.", 409)
        r = self.ronda
        candidatos = []
        for m in self.mineros:
            if m.activo:
                c = m.probar(r, self.k, self.n, self.dificultad)
                if c:
                    candidatos.append(c)
        self.ronda += 1
        if candidatos:
            self._resolver(r, candidatos)
        elif self.ronda >= self.max_rondas:
            self.estado = "limite"
            for m in self.mineros:
                if m.activo:
                    m.estado = "detenido"
            self.mensaje = (f"Se alcanzó el límite de {self.max_rondas} rondas sin encontrar un "
                            f"nonce válido: la dificultad es demasiado alta para este límite.")

    def _resolver(self, ronda, candidatos):
        gan, perdedores = elegir_ganador(candidatos)
        ids_perd = {c.id for c in perdedores}
        for m in self.mineros:
            if m.id == gan.id:
                m.estado = "ganador"
            elif m.id in ids_perd:
                m.estado = "obsoleto"
            elif m.activo:
                m.estado = "detenido"
        if perdedores:
            self.ronda_empate = {
                "ronda": ronda, "regla": REGLA_EMPATE,
                "candidatos": [{"id": c.id, "nonce": c.nonce, "hash": c.hash, "gana": c is gan,
                                **({} if c is gan else {"motivo": "obsoleta: su hash es mayor"})}
                               for c in sorted(candidatos, key=lambda c: c.indice)]}
        bloque = dict(self.plantillas[gan.id])
        bloque["nonce"] = gan.nonce
        sellar(bloque)
        if bloque["hash"] != gan.hash or hash_bloque(bloque) != gan.hash:
            self.estado, self.mensaje = "error", "El hash rápido no coincide con el hash canónico."
            return
        self.bloque_final = bloque
        self.ganador = {"id": gan.id, "nonce": gan.nonce, "hash": gan.hash, "ronda": ronda}
        self.estado = "ganado"

    def cancelar(self):
        if self.estado == "minando":
            self.estado = "cancelado"
            for m in self.mineros:
                if m.activo:
                    m.estado = "detenido"
            self.mensaje = "Carrera cancelada: ningún nodo agregó un bloque."

    def resumen(self):
        n = self.n
        mineros = []
        for m in self.mineros:
            sig = (m.nonce_actual if m.nonce_actual is not None else m.indice - n)
            ceros = len(m.ultimo_hash) - len(m.ultimo_hash.lstrip("0")) if m.ultimo_hash else 0
            mineros.append({
                "id": m.id, "indice": m.indice, "activo": m.activo, "estado": m.estado,
                "nonce_actual": m.nonce_actual, "intentos": m.intentos,
                "ultimo_hash": m.ultimo_hash, "ceros": ceros,
                "carril": {"residuo": m.indice, "modulo": n,
                           "proximos": [sig + n * j for j in (1, 2, 3)]},
            })
        return {"id": self.id, "estado": self.estado, "numero_bloque": self.numero_bloque,
                "dificultad": self.dificultad, "ronda": self.ronda, "max_rondas": self.max_rondas,
                "k": self.k, "n": n, "intentos_total": self.intentos_total(),
                "tx_ids": self.tx_ids, "automatico": self.automatico, "mineros": mineros,
                "ganador": self.ganador, "ronda_empate": self.ronda_empate,
                "mensaje": self.mensaje}
