"""Reloj lógico, bitácora, nodos (cada uno con SU copia de la cadena) y difusión."""
import copy
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import constantes as C
from .errores import ErrorSim
from .validacion import validar_cadena


class Reloj:
    """Reloj lógico determinista: T0 + 1 s por evento aceptado (nunca el reloj de pared)."""

    def __init__(self, t0=C.T0):
        self._t0 = datetime.strptime(t0, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        self.n = 0

    def _fmt(self, n):
        return (self._t0 + timedelta(seconds=n)).strftime("%Y-%m-%dT%H:%M:%SZ")

    def ahora(self):
        return self._fmt(self.n)

    def tick(self):
        self.n += 1
        return self._fmt(self.n)


class Bitacora:
    def __init__(self, reloj, maximo=C.BITACORA_MAX):
        self.reloj = reloj
        self.entradas = deque(maxlen=maximo)
        self.seq = 0

    def registrar(self, nivel, tipo, texto, nodo=None, datos=None):
        self.seq += 1
        e = {"seq": self.seq, "t": self.reloj.ahora(), "nivel": nivel, "tipo": tipo,
             "nodo": nodo, "texto": texto, "datos": datos or {}}
        self.entradas.append(e)
        return e

    def desde(self, seq=0, nivel=None, tipo=None, limite=200):
        out = [e for e in self.entradas
               if e["seq"] > seq and (nivel is None or e["nivel"] == nivel)
               and (tipo is None or e["tipo"] == tipo)]
        return out[-limite:]

    def instantanea(self):
        return self.seq, list(self.entradas)

    def restaurar(self, snap):
        self.seq = snap[0]
        self.entradas = deque(snap[1], maxlen=self.entradas.maxlen)


@dataclass
class Resultado:
    aceptada: bool
    codigo: str          # aceptada | no_mas_larga | cadena_invalida | genesis_distinto | desconectado | sin_pares
    motivo: str
    altura_recibida: int = -1
    altura_propia: int = -1
    problemas: list = field(default_factory=list)
    total_problemas: int = 0
    bloques: list = field(default_factory=list)
    identica: bool = False

    def a_dict(self):
        return {"aceptada": self.aceptada, "codigo": self.codigo, "motivo": self.motivo,
                "altura_recibida": self.altura_recibida, "altura_propia": self.altura_propia,
                "total_problemas": self.total_problemas, "problemas": self.problemas,
                "bloques": self.bloques, "identica": self.identica}


class Nodo:
    """Un nodo: identificador, par de claves, su propia cadena y el libro derivado de ella."""

    def __init__(self, nid, indice, priv, pub, genesis):
        self.id, self.indice, self.priv, self.pub = nid, indice, priv, pub
        self.genesis = genesis                      # el génesis de la red: toda cadena se valida contra él
        self.cadena = [copy.deepcopy(genesis)]      # los bloques ya agregados no se mutan jamás
        self.informe = validar_cadena(self.cadena, genesis_esperado=genesis)
        self.conectado = True
        self.deshonesto = False
        self.trampa = None
        self.bloques_propuestos = 0

    @property
    def altura(self):
        return len(self.cadena) - 1

    @property
    def hash_cabeza(self):
        return self.cadena[-1]["hash"]

    @property
    def libro(self):
        return self.informe.libro

    @property
    def integra(self):
        return self.informe.valida

    def revalidar(self):
        self.informe = validar_cadena(self.cadena, genesis_esperado=self.genesis)

    def recibir_cadena(self, cadena, genesis_esperado):
        """Reglas de la guía: acepta sólo si (a)(b)(c) la cadena es válida y (d) es más larga
        que la propia; si no, la rechaza y conserva la suya."""
        informe = validar_cadena(cadena, genesis_esperado=genesis_esperado)
        rec = informe.altura
        base = dict(altura_recibida=rec, altura_propia=self.altura,
                    problemas=[p.a_dict() for p in informe.problemas[:20]],
                    total_problemas=len(informe.problemas), bloques=informe.bloques)
        if not informe.valida:
            gd = any(p.codigo == "genesis_distinto" for p in informe.problemas)
            if gd:
                return Resultado(False, "genesis_distinto",
                                 "Rechazada: pertenece a otra red (génesis distinto).", **base)
            return Resultado(False, "cadena_invalida",
                             f"Rechazado: el libro de registros es inválido ({len(informe.problemas)} problema(s)). "
                             f"Conservo la mía.", **base)
        identica = cadena[-1]["hash"] == self.hash_cabeza
        if self.integra and rec <= self.altura:
            motivo = ("Ya tengo exactamente ese libro de registros." if identica else
                      f"Rechazado: trae {rec + 1} folios y el mío {self.altura + 1}; solo adopto "
                      f"libros válidos más completos.")
            return Resultado(False, "no_mas_larga", motivo, identica=identica, **base)
        self._adoptar(cadena, informe)
        return Resultado(True, "aceptada",
                         f"Aceptado: el libro es válido y más completo; mi altura pasa de "
                         f"{base['altura_propia']} a {rec}.", **base)

    def _adoptar(self, cadena, informe):
        # los bloques son inmutables una vez agregados: si el prefijo coincide (misma huella en
        # la última posición común, y la cadena ya fue validada entera) se reutiliza
        k = len(self.cadena)
        if self.integra and k <= len(cadena) and cadena[k - 1]["hash"] == self.cadena[-1]["hash"]:
            nueva = self.cadena + [copy.deepcopy(b) for b in cadena[k:]]
        else:
            nueva = [copy.deepcopy(b) for b in cadena]
        self.cadena = nueva
        self.informe = informe


class Red:
    def __init__(self, nodos, bitacora, genesis):
        self.nodos = nodos                 # dict id -> Nodo (orden por id)
        self.bitacora = bitacora
        self.genesis = genesis

    def ordenados(self):
        return [self.nodos[i] for i in sorted(self.nodos)]

    def referencia(self):
        """La cadena de referencia: la más alta y válida entre los conectados (desempate: menor id)."""
        cand = [n for n in self.ordenados() if n.conectado and n.integra]
        if not cand:
            return None
        return max(cand, key=lambda n: (n.altura, -n.indice))

    def elegibles(self):
        """Nodos conectados, con cadena íntegra y la misma cabeza que la referencia."""
        ref = self.referencia()
        if ref is None:
            return []
        return [n for n in self.ordenados()
                if n.conectado and n.integra and n.hash_cabeza == ref.hash_cabeza]

    def difundir(self, origen_id, cadena):
        """El origen envía su cadena a todos los demás; cada receptor la valida ENTERA."""
        res = {}
        for n in self.ordenados():
            if n.id == origen_id:
                continue
            if not n.conectado:
                res[n.id] = Resultado(False, "desconectado", "La institución está desconectada: no recibe.",
                                      altura_propia=n.altura)
                continue
            r = n.recibir_cadena(cadena, self.genesis)
            res[n.id] = r
            if r.aceptada:
                self.bitacora.registrar("ok", "cadena_aceptada",
                                        f"{n.id} validó el libro completo y lo aceptó (altura {r.altura_recibida}).",
                                        nodo=n.id, datos={"altura": r.altura_recibida})
            elif not r.identica:
                self.bitacora.registrar("aviso", "cadena_rechazada", f"{n.id}: {r.motivo}",
                                        nodo=n.id, datos={"codigo": r.codigo})
        return res

    def agregar_y_difundir(self, origen_id, bloque):
        """El proponente agrega el bloque a SU cadena (validándola) y lo difunde."""
        origen = self.nodos[origen_id]
        nueva = origen.cadena + [copy.deepcopy(bloque)]
        r = origen.recibir_cadena(nueva, self.genesis)
        if not r.aceptada:
            primero = r.problemas[0]["mensaje"] if r.problemas else r.motivo
            raise ErrorSim("bloque_rechazado",
                           f"{origen_id} no pudo agregar su propio bloque: {primero}", 409,
                           detalle={"problemas": r.problemas})
        origen.bloques_propuestos += 1
        self.bitacora.registrar("ok", "bloque_difundido",
                                f"{origen_id} agregó el folio #{bloque['numero']} y lo difunde a la red.",
                                nodo=origen_id, datos={"bloque": bloque["numero"]})
        return self.difundir(origen_id, origen.cadena)

    def sincronizar(self, nodo_id):
        """Pull: el nodo pide la mejor cadena válida de sus pares y la adopta si corresponde."""
        n = self.nodos[nodo_id]
        pares = [p for p in self.ordenados() if p.id != nodo_id and p.conectado and p.integra]
        if not pares:
            return Resultado(False, "sin_pares", "No hay instituciones conectadas con un libro válido.",
                             altura_propia=n.altura)
        mejor = max(pares, key=lambda p: (p.altura, -p.indice))
        r = n.recibir_cadena(mejor.cadena, self.genesis)
        nivel = "ok" if r.aceptada else "info"
        self.bitacora.registrar(nivel, "nodo_sincronizado", f"{nodo_id} se sincroniza con {mejor.id}: {r.motivo}",
                                nodo=nodo_id, datos={"codigo": r.codigo})
        return r

    def estado_sincronia(self):
        ref = self.referencia()
        conectados = [n for n in self.ordenados() if n.conectado]
        if ref is None:
            return {"sincronizados": 0, "conectados": len(conectados), "total": len(self.nodos),
                    "en_sincronia": False, "altura_referencia": None, "hash_referencia": None}
        sinc = [n for n in conectados if n.integra and n.hash_cabeza == ref.hash_cabeza]
        return {"sincronizados": len(sinc), "conectados": len(conectados), "total": len(self.nodos),
                "en_sincronia": len(sinc) == len(self.nodos), "altura_referencia": ref.altura,
                "hash_referencia": ref.hash_cabeza}
