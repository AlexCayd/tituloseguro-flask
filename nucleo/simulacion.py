"""Simulación: une nodos, pool de pendientes, PoW/PoS, bitácora y la regla de oro de la robustez:
toda acción corre dentro de `transaccion()` (rollback ante cualquier excepción)."""
import copy
import hashlib
import threading
import time
from contextlib import contextmanager

from . import constantes as C
from . import pos as POS
from .ataques import TIPOS, TIPOS_CORRUPCION, alterar_copia, construir_ataque
from .bloque import nuevo_genesis
from .cripto import canon, clave_desde_semilla, firmar_tx, pub_hex, tx_id, verificar_tx
from .entradas import ids_nodos
from .errores import ErrorSim
from .instituciones import UNIDAD, etiqueta, institucion
from .libro import aplicar_castigos_pendientes, aplicar_tx, provisional, recompensas_info
from .pow import TrabajoPoW, construir_plantillas
from .red import Bitacora, Nodo, Red, Reloj

_MAPA_TX = {"tx_firma": "tx_firma_invalida", "tx_otra_clave": "tx_otra_clave",
            "tx_saldo": "saldo_insuficiente", "tx_duplicada": "tx_duplicada",
            "tx_mismo_nodo": "mismo_nodo", "tx_nodo_inexistente": "nodo_inexistente",
            "tx_monto": "monto_invalido", "tx_estructura": "tipo_invalido"}


class Simulacion:
    def __init__(self, config, epoca=1):
        self.config, self.epoca, self.modo = config, epoca, config["modo"]
        self.lock = threading.RLock()
        self.cerrada = False
        self.rev = 0
        self._profundidad = 0
        self._hilo = None
        self.reloj = Reloj()
        self.bitacora = Bitacora(self.reloj)
        n, semilla = config["n"], config["semilla"]
        ids = ids_nodos(n)
        self.privs = {i: clave_desde_semilla(semilla, i) for i in ids}
        self.claves = {i: pub_hex(self.privs[i]) for i in ids}
        pos = self.modo == "pos"
        self.params = {
            "version": 1, "modo": self.modo, "n": n, "semilla": semilla, "claves": self.claves,
            "saldos": dict(config["saldos"]), "recompensa": config["recompensa"],
            "confirmaciones": C.CONF_POS if pos else C.CONF_POW,
            "dificultad": None if pos else config["dificultad"],
            "umbral": {"num": C.UMBRAL_NUM, "den": C.UMBRAL_DEN} if pos else None,
            "castigo": {"regla": config["regla_castigo"], "alfa_pm": config["alfa_pm"]} if pos else None,
            "monto_max": C.MONTO_MAX, "max_tx_bloque": C.MAX_TX_BLOQUE,
        }
        self.genesis = nuevo_genesis(self.params, self.reloj.ahora())
        self.nodos = {i: Nodo(i, k, self.privs[i], self.claves[i], self.genesis)
                      for k, i in enumerate(ids)}
        self.red = Red(self.nodos, self.bitacora, self.genesis)
        self.pool = []                  # [{id, tx, firma}]
        self.castigos_pendientes = []   # castigos aún no registrados en la cadena
        self.trabajo = None
        self.ronda = None
        self.ultimo_resultado = None
        self.contador_trabajos = 0
        self.contador_rondas = 0
        self.contador_tx = 0
        self.auto_restante = 0
        self.bitacora.registrar("info", "simulacion_creada",
                                f"Red {'Proof of Work' if not pos else 'Proof of Stake'} creada con {n} instituciones "
                                f"(semilla «{semilla}»). Todos parten del mismo bloque génesis.",
                                datos={"n": n, "semilla": semilla})

    # ================================================================ infraestructura
    @property
    def ids(self):
        return sorted(self.nodos)

    def log(self, nivel, tipo, texto, nodo=None, datos=None):
        self.bitacora.registrar(nivel, tipo, texto, nodo=nodo, datos=datos)

    def _snapshot(self):
        return {
            "reloj": self.reloj.n, "bitacora": self.bitacora.instantanea(),
            "pool": list(self.pool), "castigos": [dict(c) for c in self.castigos_pendientes],
            "ronda": copy.deepcopy(self.ronda), "ultimo": self.ultimo_resultado, "trabajo": self.trabajo,
            "contadores": (self.contador_trabajos, self.contador_rondas, self.contador_tx,
                           self.auto_restante),
            "nodos": {i: (list(n.cadena), n.informe, n.conectado, n.deshonesto, n.trampa,
                          n.bloques_propuestos) for i, n in self.nodos.items()},
        }

    def _restaurar(self, s):
        self.reloj.n = s["reloj"]
        self.bitacora.restaurar(s["bitacora"])
        self.pool = s["pool"]
        self.castigos_pendientes = s["castigos"]
        self.ronda = s["ronda"]
        self.ultimo_resultado = s["ultimo"]
        self.trabajo = s["trabajo"]
        (self.contador_trabajos, self.contador_rondas, self.contador_tx, self.auto_restante) = s["contadores"]
        for i, (cad, inf, con, des, tra, bp) in s["nodos"].items():
            n = self.nodos[i]
            n.cadena, n.informe, n.conectado, n.deshonesto, n.trampa, n.bloques_propuestos = \
                cad, inf, con, des, tra, bp

    @contextmanager
    def transaccion(self):
        """Bloqueo + snapshot + rollback. Reentrante. `rev` sólo sube al terminar bien (o al
        rechazar una acción de dominio que dejó huella en la bitácora)."""
        with self.lock:
            if self.cerrada:
                raise ErrorSim("sin_simulacion", "Esta simulación fue reiniciada o eliminada.", 409)
            self._profundidad += 1
            snap = self._snapshot() if self._profundidad == 1 else None
            try:
                yield
            except ErrorSim as e:
                if snap is not None:
                    if e.conservar:
                        self.rev += 1
                    else:
                        self._restaurar(snap)
                raise
            except BaseException:
                if snap is not None:
                    self._restaurar(snap)
                raise
            else:
                if snap is not None:
                    self.rev += 1
            finally:
                self._profundidad -= 1

    def huella_estado(self):
        """Huella del estado observable (para comprobar rollbacks)."""
        with self.lock:
            return hashlib.sha256(canon({
                "reloj": self.reloj.n, "seq": self.bitacora.seq,
                "pool": [p["id"] for p in self.pool], "castigos": self.castigos_pendientes,
                "nodos": {i: [n.hash_cabeza, n.altura, n.conectado, n.deshonesto, n.trampa]
                          for i, n in sorted(self.nodos.items())},
                "ronda": None if self.ronda is None else [self.ronda.fase, self.ronda.intento,
                                                           sorted(self.ronda.votos)],
            })).hexdigest()

    # ================================================================ consultas internas
    def ref(self):
        r = self.red.referencia()
        if r is None:
            raise ErrorSim("sin_referencia",
                           "Ninguna institución conectada tiene un libro de registros válido: sincroniza una institución o reinicia.", 409)
        return r

    def _nodo(self, nid):
        if nid not in self.nodos:
            raise ErrorSim("nodo_inexistente", f"El nodo «{str(nid)[:20]}» no existe en esta red.", 404)
        return self.nodos[nid]

    def _castigos_activos(self):
        c = list(self.castigos_pendientes)
        if self.ronda is not None and self.ronda.activa:
            c += self.ronda.castigos_ronda
        return c

    def _bloqueado(self):
        return self.ronda.bloqueado() if self.ronda is not None and self.ronda.activa else {}

    def gastable_base(self, nid):
        """Saldo gastable sin contar apuestas: disponible menos castigos aún no registrados."""
        d = self.ref().libro.disponible[nid]
        pen = sum(c["monto"] for c in self._castigos_activos() if c["proponente"] == nid)
        return max(0, d - pen)

    def gastable(self, nid):
        return max(0, self.gastable_base(nid) - self._bloqueado().get(nid, 0))

    def _libro_provisional(self):
        return provisional(self.ref().libro, self._castigos_activos(), self.pool, self.params,
                           self.claves, self._bloqueado())

    def _exigir_reposo(self):
        if self.trabajo is not None and self.trabajo.activo:
            raise ErrorSim("ya_minando", "Hay una carrera de minería en curso: espera, cancélala o "
                                         "termínala antes de hacer este cambio.", 409)
        if self.ronda is not None and self.ronda.activa:
            raise ErrorSim("ronda_en_curso", "Hay una ronda de Proof of Stake en curso: termínala o "
                                             "cancélala antes de hacer este cambio.", 409)

    def quitar_del_pool(self, ids):
        s = set(ids)
        self.pool = [p for p in self.pool if p["id"] not in s]

    def _exigir_modo(self, modo):
        if self.modo != modo:
            raise ErrorSim("modo_invalido", f"Esta acción solo existe en Proof of {'Work' if modo == 'pow' else 'Stake'}.",
                           404)

    def _exigir_espacio(self):
        if self.ref().altura >= C.MAX_ALTURA:
            raise ErrorSim("cadena_llena", f"La cadena alcanzó el límite de {C.MAX_ALTURA} bloques de esta "
                                           f"simulación. Reinicia para seguir.", 409)

    # ================================================================ transacciones
    def crear_tx(self, emisor, receptor, monto, *, timestamp=None, firma=None, trampa=None):
        with self.transaccion():
            self._nodo(emisor), self._nodo(receptor)
            if len(self.pool) >= C.MAX_PENDIENTES:
                raise ErrorSim("pool_lleno", f"Hay {C.MAX_PENDIENTES} transacciones pendientes: mina o "
                                             f"propón un bloque antes de agregar más.", 409)
            ts = timestamp or self.reloj._fmt(self.reloj.n + 1)
            tx = {"emisor": emisor, "receptor": receptor, "monto": monto, "timestamp": ts}
            if firma is None:
                firma = firmar_tx(self.privs[emisor], tx)
                if trampa == "firma_alterada":
                    firma = ("1" if firma[0] == "0" else "0") + firma[1:]
                elif trampa == "otra_clave":
                    otro = next(i for i in self.ids if i != emisor)
                    firma = firmar_tx(self.privs[otro], tx)
            res = aplicar_tx(self._libro_provisional(), tx, firma, self.params, self.claves,
                             bloqueado=self._bloqueado())
            if res:
                codigo, det = res
                if codigo == "tx_saldo":    # desglose respecto del saldo real de la cadena
                    base = self.ref().libro.disponible[emisor]
                    det = dict(det, disponible=base, comprometido=max(0, base - det["disponible"]),
                               necesario=monto)
                msg = self._mensaje_tx(codigo, det)
                self.log("aviso", "tx_rechazada", f"Registro {etiqueta(emisor)}→{etiqueta(receptor)} por {monto} créditos rechazado: {msg}",
                         nodo=emisor, datos={"codigo": codigo})
                raise ErrorSim(_MAPA_TX.get(codigo, codigo), msg, 422, None, det, conservar=True)
            item = {"id": tx_id(tx), "tx": tx, "firma": firma}
            self.pool.append(item)
            if timestamp is None:
                self.reloj.tick()
            self.log("ok", "tx_aceptada",
                     f"{etiqueta(emisor)} registra con {etiqueta(receptor)}: {monto} créditos de certificación. "
                     f"La firma es válida y hay saldo: queda pendiente ({len(self.pool)} en espera).", nodo=emisor, datos={"id": item["id"], "monto": monto})
            return item

    def _mensaje_tx(self, codigo, det):
        if codigo == "tx_saldo":
            partes = []
            comprometido = det.get("comprometido", 0)
            if det["bloqueado"]:
                partes.append(f"{det['bloqueado']} créditos bloqueados en su apuesta")
            if comprometido:
                partes.append(f"{comprometido} créditos comprometidos (registros pendientes o castigos)")
            if det.get("pendiente_recompensa"):
                partes.append(f"{det['pendiente_recompensa']} créditos en recompensas que aún no maduran")
            extra = f" ({'; '.join(partes)})" if partes else ""
            return (f"{etiqueta(det['emisor'])} quiere enviar {det['monto']} créditos pero solo puede gastar "
                    f"{det['gastable']} créditos{extra}.")
        textos = {
            "tx_firma": "la firma no corresponde al registro: se alteró el registro o la firma es inválida.",
            "tx_otra_clave": f"la firmó {det.get('firmante')} y no el emisor {det.get('emisor')}.",
            "tx_duplicada": "ese registro ya existe (en el libro o en la lista de registros en espera).",
            "tx_mismo_nodo": "el emisor y el receptor deben ser nodos distintos.",
            "tx_nodo_inexistente": "el emisor o el receptor no existen.",
            "tx_monto": "el monto no es válido.",
            "tx_estructura": "el registro está mal formado.",
        }
        return textos.get(codigo, codigo)

    def crear_tx_aleatorias(self, cantidad):
        with self.transaccion():
            hechas = []
            for _ in range(cantidad):
                if len(self.pool) >= C.MAX_PENDIENTES:
                    break
                self.contador_tx += 1
                h = int(hashlib.sha256(f"{self.config['semilla']}|txalea|{self.contador_tx}".encode()).hexdigest(), 16)
                lp = self._libro_provisional()
                bloq = self._bloqueado()
                con_fondos = [i for i in self.ids if lp.disponible[i] - bloq.get(i, 0) >= 1]
                if not con_fondos:
                    if not hechas:
                        raise ErrorSim("saldo_insuficiente", "Ningún nodo tiene saldo gastable para "
                                                              "generar transacciones.", 422)
                    break
                e = con_fondos[h % len(con_fondos)]
                otros = [i for i in self.ids if i != e]
                r = otros[(h >> 16) % len(otros)]
                tope = min(20, lp.disponible[e] - bloq.get(e, 0))
                m = 1 + (h >> 32) % tope
                hechas.append(self.crear_tx(e, r, m))
            return hechas

    # ================================================================ red
    def conectar(self, nid, conectado):
        with self.transaccion():
            n = self._nodo(nid)
            self._exigir_reposo()
            if not conectado and n.conectado and sum(1 for x in self.nodos.values() if x.conectado) <= 1:
                raise ErrorSim("ultimo_nodo_conectado", "No se puede desconectar el último nodo conectado.", 409)
            n.conectado = conectado
            self.log("info", "nodo_conexion",
                     f"{etiqueta(nid)} {'se reconecta a la red' if conectado else 'se desconecta: dejará de recibir bloques'}.",
                     nodo=nid)
            return n

    def sincronizar(self, nid):
        with self.transaccion():
            n = self._nodo(nid)
            if not n.conectado:
                raise ErrorSim("nodo_desconectado", f"{nid} está desconectado: reconéctalo para sincronizar.", 409)
            self._exigir_reposo()
            return self.red.sincronizar(nid)

    def marcar_deshonesto(self, nid, activo, trampa=None):
        self._exigir_modo("pos")
        with self.transaccion():
            n = self._nodo(nid)
            if self.ronda is not None and self.ronda.activa and self.ronda.fase != "APUESTAS":
                raise ErrorSim("ronda_en_curso", "No se puede cambiar la honestidad de un nodo mientras la "
                                                 "ronda está en marcha (solo antes de cerrar las apuestas).", 409)
            if trampa is not None and trampa not in POS.TRAMPAS:
                raise ErrorSim("trampa_invalida", "La trampa debe ser «firma» o «gasto».", 422, "trampa")
            n.deshonesto = bool(activo)
            n.trampa = (trampa or "firma") if activo else None
            self.log("aviso" if activo else "info", "nodo_deshonesto",
                     f"{nid} {'ahora es DESHONESTO (trampa: ' + n.trampa + ')' if activo else 'vuelve a ser honesto'}.",
                     nodo=nid)
            return n

    def atacar(self, destino, tipo, bloque=None):
        with self.transaccion():
            nodo = self._nodo(destino)
            if not nodo.conectado:
                raise ErrorSim("nodo_desconectado", f"{destino} está desconectado.", 409)
            cadena, info = construir_ataque(self, tipo, bloque)
            res = nodo.recibir_cadena(cadena, self.genesis)
            codigos = {c for b in res.bloques for c in b["fallas"]} | {res.codigo}
            info.update(destino=destino, detectado=info["esperado"] in codigos,
                        resultado=res.a_dict(), codigos=sorted(codigos))
            self.log("ok" if not res.aceptada else "error", "ataque",
                     f"Ataque «{tipo}» contra {destino}: {res.motivo}", nodo=destino,
                     datos={"tipo": tipo, "aceptada": res.aceptada})
            return info

    def corromper_local(self, nid, bloque, tipo):
        with self.transaccion():
            n = self._nodo(nid)
            self._exigir_reposo()
            otros = [x for x in self.nodos.values() if x.id != nid and x.conectado and x.integra]
            if not otros and n.conectado:
                raise ErrorSim("sin_referencia", "Sería la última institución con libro válido: no se puede alterar.", 409)
            copia, desc = alterar_copia(n.cadena, bloque, tipo)
            n.cadena = copia
            n.revalidar()
            self.log("aviso", "corrupcion_local",
                     f"La copia local de {etiqueta(nid)} fue manipulada ({desc['campo']} del bloque {bloque}). "
                     f"Su libro ya no es íntegro: no participa hasta que se sincronice.", nodo=nid,
                     datos=desc)
            return {"descripcion": desc, "validacion": n.informe.a_dict()}

    # ================================================================ PoW
    def _preparar_trabajo(self, automatico):
        self._exigir_modo("pow")
        if self.trabajo is not None and self.trabajo.activo:
            raise ErrorSim("ya_minando", "Ya hay una carrera de minería en curso.", 409)
        if not self.pool:
            raise ErrorSim("sin_pendientes", "No hay transacciones pendientes: crea al menos una antes de minar.", 409)
        self._exigir_espacio()
        ref = self.ref()
        activos = {n.id for n in self.red.elegibles()}
        if not activos:
            raise ErrorSim("sin_mineros", "Ninguna institución está en condiciones de sellar registros.", 409)
        libro = ref.libro.copia()
        txs, firmas, ids_tx, caidas = [], [], [], []
        for item in list(self.pool):
            if len(txs) >= C.MAX_TX_BLOQUE:
                break
            res = aplicar_tx(libro, item["tx"], item["firma"], self.params, self.claves)
            if res:
                caidas.append((item, res[0]))
            else:
                txs.append(dict(item["tx"]))
                firmas.append(item["firma"])
                ids_tx.append(item["id"])
        for item, codigo in caidas:
            self.quitar_del_pool([item["id"]])
            self.log("aviso", "tx_descartada",
                     f"Registro {item['id'][:8]}… descartado: ya no es válido ({codigo}).")
        if not txs:
            raise ErrorSim("sin_pendientes", "Ningún registro en espera sigue siendo válido.", 409, conservar=True)
        ts = self.reloj.tick()
        plantillas = construir_plantillas(ref.altura + 1, ts, txs, firmas, ref.hash_cabeza, self.ids,
                                          self.params["recompensa"])
        self.contador_trabajos += 1
        self.trabajo = TrabajoPoW(self.contador_trabajos, plantillas, self.ids, activos,
                                  self.config["dificultad"], self.config["k"], self.config["max_rondas"],
                                  ids_tx, automatico)
        d = self.config["dificultad"]
        self.log("info", "trabajo_inicio",
                 f"Comienza el sellado del folio #{ref.altura + 1}: {len(activos)} instituciones buscan un nonce "
                 f"cuya huella empiece con {d} ceros. La institución i prueba i, i+{self.params['n']}, "
                 f"i+{2 * self.params['n']}… (nunca repiten nonce).", datos={"bloque": ref.altura + 1})

    def minar(self, ejecucion="auto"):
        with self.transaccion():
            self._preparar_trabajo(automatico=ejecucion == "auto")
            if ejecucion == "auto":
                self._lanzar_hilo()
            return self.trabajo

    def _lanzar_hilo(self):
        h = threading.Thread(target=_bucle_pow, args=(self, self.trabajo), daemon=True,
                             name=f"pow-{self.epoca}-{self.trabajo.id}")
        self._hilo = h
        h.start()

    def _paso_trabajo(self, job):
        """Una ronda de la carrera (bajo el candado). Si hay ganador, agrega y difunde."""
        job.paso()
        self.rev += 1
        if job.estado == "ganado":
            with self.transaccion():
                self._cerrar_bloque_pow(job)
        elif job.estado == "limite":
            self.log("aviso", "trabajo_limite", job.mensaje)
            self.auto_restante = 0
            self.rev += 1

    def _cerrar_bloque_pow(self, job):
        b, g = job.bloque_final, job.ganador
        prev_altura = self.ref().altura
        self.log("ok", "ganador",
                 f"¡{g['id']} encontró el nonce {g['nonce']}! Huella {g['hash'][:16]}… en la ronda {g['ronda'] + 1}. "
                 f"Las demás instituciones dejan de probar.", nodo=g["id"], datos=g)
        if job.ronda_empate:
            otros = [c["id"] for c in job.ronda_empate["candidatos"] if not c["gana"]]
            self.log("aviso", "empate_ronda",
                     f"Empate en la ronda: también acertaron {', '.join(otros)}. Gana {g['id']} porque su huella es "
                     f"numéricamente menor; las demás quedan obsoletas.", datos=job.ronda_empate)
        try:
            self.red.agregar_y_difundir(g["id"], b)
        except ErrorSim as e:
            job.estado, job.mensaje = "error", e.mensaje
            self.log("error", "trabajo_error", e.mensaje)
            self.auto_restante = 0
            return
        self.quitar_del_pool(job.tx_ids)
        self.log("info", "recompensa_pendiente",
                 f"{etiqueta(g['id'])} gana {self.params['recompensa']} créditos de certificación: quedan PENDIENTES hasta que la cadena llegue a la "
                 f"altura {b['numero'] + self.params['confirmaciones']} (6 confirmaciones).", nodo=g["id"])
        maduro = b["numero"] - self.params["confirmaciones"]
        if maduro >= 1:
            ref_blq = self.ref().cadena[maduro]
            self.log("ok", "recompensa_madura",
                     f"Los créditos ganados en el folio #{maduro} maduran: {ref_blq['proponente']} los recibe como créditos disponibles "
                     f"disponible.", nodo=ref_blq["proponente"], datos={"bloque": maduro})
        self.ultimo_resultado = {"tipo": "pow", "estado": "ganado", "bloque": b["numero"],
                                 "proponente": g["id"], "hash": b["hash"], "altura_anterior": prev_altura}

    def avanzar_pow(self, rondas=1):
        self._exigir_modo("pow")
        with self.transaccion():
            if self.trabajo is None or not self.trabajo.activo:
                raise ErrorSim("no_hay_trabajo", "No hay una carrera en curso: usa «minar» primero.", 409)
            if self.trabajo.automatico:
                raise ErrorSim("trabajo_automatico", "Esta carrera avanza sola; cancélala para avanzar a mano.", 409)
            for _ in range(rondas):
                if not self.trabajo.activo:
                    break
                self._paso_trabajo(self.trabajo)
            return self.trabajo

    def cancelar_trabajo(self):
        self._exigir_modo("pow")
        with self.transaccion():
            self.auto_restante = 0
            if self.trabajo is None or not self.trabajo.activo:
                raise ErrorSim("no_hay_trabajo", "No hay ninguna carrera en curso que cancelar.", 409)
            self.trabajo.cancelar()
            self.log("aviso", "trabajo_cancelado",
                     "Carrera cancelada: ningún bloque se agregó; las transacciones siguen pendientes.")
            return self.trabajo

    # ================================================================ PoS
    def agregar_bloque_pos(self, bloque, origen):
        self.red.agregar_y_difundir(origen, bloque)
        self.ultimo_resultado = {"tipo": "pos", "estado": "ACEPTADO", "bloque": bloque["numero"],
                                 "proponente": origen, "hash": bloque["hash"]}

    def iniciar_ronda(self, modo="auto", validadores=None, n_validadores=None, apuestas=None):
        self._exigir_modo("pos")
        with self.transaccion():
            if self.ronda is not None and self.ronda.activa:
                raise ErrorSim("ronda_en_curso", "Ya hay una ronda en curso: termínala o cancélala.", 409)
            self._exigir_espacio()
            ref = self.ref()
            elegibles = [n.id for n in self.red.elegibles()]
            con_saldo = [i for i in elegibles if self.gastable_base(i) >= 1]
            if not con_saldo:
                raise ErrorSim("sin_validadores", "Ningún nodo tiene saldo para apostar: no hay validadores "
                                                  "posibles. (Reinicia o reparte saldo inicial.)", 409)
            if not self.pool:
                raise ErrorSim("sin_pendientes", "No hay transacciones pendientes: crea al menos una antes "
                                                 "de proponer un bloque (las apuestas aún no se bloquearon).", 409)
            rid = self.contador_rondas + 1
            if validadores is not None:
                vals = sorted(set(validadores))
                for v in vals:
                    if v not in self.nodos:
                        raise ErrorSim("nodo_inexistente", f"El nodo «{str(v)[:20]}» no existe.", 422, "validadores")
                    if v not in con_saldo:
                        raise ErrorSim("apuesta_no_validador", f"{v} no puede ser validador: está desconectado, "
                                                               f"desincronizado o sin saldo.", 422, "validadores")
                if not vals:
                    raise ErrorSim("sin_validadores", "La lista de validadores está vacía.", 409)
            else:
                n_val = n_validadores if n_validadores is not None else self.config["n_validadores"]
                vals = POS.elegir_validadores(con_saldo, n_val, self.config["semilla"], ref.altura + 1, rid)
            stakes = POS.apuestas_por_defecto({v: self.gastable_base(v) for v in vals},
                                              self.config["semilla"], rid)
            r = POS.RondaPoS(rid, modo, ref.altura + 1, vals, stakes)
            if apuestas:
                stakes.update(r.validar_apuestas(apuestas, self))   # valida contra `r.validadores`
                r.apuestas.update(stakes)
            self.contador_rondas = rid
            self.ronda = r
            self.log("info", "ronda_inicio",
                     f"Ronda de aval #{rid} para el folio #{r.numero_bloque}: {len(vals)} instituciones avaladoras "
                     f"({', '.join(vals)}) con apuestas totales A = {sum(r.apuestas.values())}.",
                     datos={"ronda": rid, "validadores": vals})
            if modo == "auto":
                self._correr_ronda(r)
            return r

    def _correr_ronda(self, r):
        guardia = 0
        while r.activa and guardia < 4 * (len(r.validadores) + 3):
            r.avanzar(self)
            guardia += 1

    def _ronda(self):
        self._exigir_modo("pos")
        if self.ronda is None or not self.ronda.activa:
            raise ErrorSim("sin_ronda", "No hay una ronda en curso: inicia una primero.", 409)
        return self.ronda

    def fijar_apuestas(self, apuestas):
        with self.transaccion():
            r = self._ronda()
            r.fijar_apuestas(apuestas, self)
            return r

    def avanzar_ronda(self, fase_esperada=None):
        with self.transaccion():
            r = self._ronda()
            r.avanzar(self, fase_esperada)
            return r

    def votar(self, votante, voto):
        with self.transaccion():
            r = self._ronda()
            r.votar(self, votante, voto)
            return r

    def cancelar_ronda(self):
        with self.transaccion():
            r = self._ronda()
            r.cancelar(self)
            return r

    # ================================================================ autopiloto
    def autopiloto(self, bloques):
        """PoS: produce `bloques` bloques de forma síncrona. PoW: encola `bloques` carreras que el
        hilo encadena sin retener el candado. Devuelve un resumen."""
        with self.transaccion():
            if self.modo == "pow":
                if self.trabajo is not None and self.trabajo.activo:
                    raise ErrorSim("ya_minando", "Ya hay una carrera en curso.", 409)
                self.auto_restante = bloques - 1
                if not self.pool:
                    self.crear_tx_aleatorias(2)
                self._preparar_trabajo(automatico=True)
                self._lanzar_hilo()
                return {"asincrono": True, "producidos": 0, "pendientes": bloques}
            producidos, motivo = 0, None
            for _ in range(bloques):
                try:
                    if not self.pool:
                        self.crear_tx_aleatorias(2)
                    self.iniciar_ronda("auto")
                except ErrorSim as e:
                    motivo = e.mensaje
                    break
                if self.ronda.resultado and self.ronda.resultado["estado"] == "ACEPTADO":
                    producidos += 1
                else:
                    motivo = (self.ronda.resultado or {}).get("motivo", "la ronda no produjo bloque")
                    break
            out = {"asincrono": False, "producidos": producidos}
            if motivo:
                out["detenido_por"] = motivo
            return out

    def autopiloto_sync(self, bloques):
        """Igual que `autopiloto` pero síncrono también en PoW (pruebas y demo.py)."""
        if self.modo == "pos":
            return self.autopiloto(bloques)
        producidos = 0
        for _ in range(bloques):
            if not self.pool:
                self.crear_tx_aleatorias(2)
            self.minar("manual")
            while self.trabajo.activo:
                self.avanzar_pow(50)
            if self.trabajo.estado != "ganado":
                return {"producidos": producidos, "detenido_por": self.trabajo.mensaje}
            producidos += 1
        return {"producidos": producidos}

    # ================================================================ vistas
    def invariantes(self):
        with self.lock:
            comp = []
            ref = self.red.referencia()
            if ref is None:
                comp.append({"nombre": "referencia", "ok": False, "detalle": "no hay cadena de referencia válida"})
            else:
                lb = ref.libro
                R = self.params["recompensa"]
                esperado = sum(self.params["saldos"].values()) + R * ref.altura
                real = sum(lb.disponible.values()) + sum(lb.pendiente.values()) + lb.quemado
                comp.append({"nombre": "conservacion", "ok": real == esperado,
                             "detalle": f"Σ disponible + pendiente + quemado = {real}; esperado {esperado}"})
                neg = [i for i, v in lb.disponible.items() if v < 0] + [i for i, v in lb.pendiente.items() if v < 0]
                comp.append({"nombre": "sin_saldos_negativos", "ok": not neg, "detalle": str(neg or "ok")})
                bq = self._bloqueado()
                mal = [i for i, v in bq.items() if v > lb.disponible[i]]
                comp.append({"nombre": "apuestas_cubiertas", "ok": not mal, "detalle": str(mal or "ok")})
                # un pendiente puede quedar sin fondos (castigos, apuestas): se descarta al armar el bloque.
                # Lo que NUNCA debe pasar es que sea inválido por firma, repetido o ya minado.
                vistos, malas = set(), []
                for p in self.pool:
                    ok = verificar_tx(self.claves.get(p["tx"]["emisor"]), p["tx"], p["firma"])                         and p["id"] == tx_id(p["tx"]) and p["id"] not in vistos and p["id"] not in lb.tx_ids
                    vistos.add(p["id"])
                    if not ok:
                        malas.append(p["id"][:8])
                comp.append({"nombre": "pendientes_validas", "ok": not malas,
                             "detalle": f"{len(self.pool)} pendientes; con firma inválida, repetidas o ya minadas: "
                                        f"{malas or 'ninguna'}"})
            rotas = [n.id for n in self.nodos.values() if n.conectado and not n.integra]
            comp.append({"nombre": "cadenas_integras", "ok": not rotas,
                         "detalle": f"nodos conectados con cadena corrupta: {rotas or 'ninguno'}"})
            return {"consistente": all(c["ok"] for c in comp), "comprobaciones": comp}

    def _vista_nodo(self, n, ref):
        lb = n.libro
        bloq = self._bloqueado().get(n.id, 0)
        pen_c = sum(c["monto"] for c in self._castigos_activos() if c["proponente"] == n.id)
        disp = lb.disponible[n.id] if lb else 0
        return {
            "id": n.id, "indice": n.indice, "institucion": institucion(n.id), "pub": n.pub,
            "conectado": n.conectado,
            "deshonesto": n.deshonesto, "trampa": n.trampa, "altura": n.altura,
            "hash_cabeza": n.hash_cabeza, "cadena_integra": n.integra,
            "sincronizado": bool(ref and n.conectado and n.integra and n.hash_cabeza == ref.hash_cabeza),
            "bloques_propuestos": n.bloques_propuestos,
            "saldo": {"disponible": disp, "pendiente": lb.pendiente[n.id] if lb else 0, "bloqueado": bloq,
                      "castigos_pendientes": pen_c, "gastable": max(0, disp - pen_c - bloq)},
        }

    def estado(self, desde_rev=None, epoca=None):
        with self.lock:
            if desde_rev is not None and desde_rev == self.rev and epoca == self.epoca:
                return {"ok": True, "existe": True, "sin_cambios": True, "rev": self.rev, "epoca": self.epoca}
            ref = self.red.referencia()
            nodos = [self._vista_nodo(n, ref) for n in self.red.ordenados()]
            cab = ref.cadena[-1] if ref else None
            tot_disp = sum(v["saldo"]["disponible"] for v in nodos)
            lb = ref.libro if ref else None
            activo = self.trabajo is not None and self.trabajo.activo
            ronda_activa = self.ronda is not None and self.ronda.activa
            return {
                "ok": True, "existe": True, "modo": self.modo, "epoca": self.epoca, "rev": self.rev, "unidad": UNIDAD,
                "sondeo_ms": 250 if activo else (1000 if ronda_activa else 2000),
                "config": dict(self.config), "parametros": {
                    "recompensa": self.params["recompensa"], "confirmaciones": self.params["confirmaciones"],
                    "dificultad": self.params["dificultad"], "umbral": self.params["umbral"],
                    "castigo": self.params["castigo"], "max_tx_bloque": C.MAX_TX_BLOQUE,
                    "max_pendientes": C.MAX_PENDIENTES, "max_altura": C.MAX_ALTURA},
                "reloj": self.reloj.ahora(), "altura": ref.altura if ref else None,
                "cabeza": None if cab is None else {"numero": cab["numero"], "hash": cab["hash"],
                                                    "proponente": cab["proponente"]},
                "sincronia": self.red.estado_sincronia(), "nodos": nodos,
                "pendientes": list(self.pool), "pendientes_total": len(self.pool),
                "recompensas": {"confirmaciones": self.params["confirmaciones"],
                                "items": recompensas_info(ref.cadena, self.params) if ref else []},
                "totales": {
                    "emitido": sum(self.params["saldos"].values()) + (self.params["recompensa"] * ref.altura if ref else 0),
                    "disponible": sum(lb.disponible.values()) if lb else 0,
                    "pendiente_recompensas": sum(lb.pendiente.values()) if lb else 0,
                    "quemado": lb.quemado if lb else 0,
                    "bloqueado": sum(self._bloqueado().values()),
                    "castigos_pendientes": sum(c["monto"] for c in self._castigos_activos()),
                },
                "trabajo": self.trabajo.resumen() if self.trabajo else None,
                "ronda": self.ronda.publica(self) if self.ronda else None,
                "ultimo_resultado": self.ultimo_resultado,
                "salud": {"consistente": self.invariantes()["consistente"]},
                "bitacora_seq": self.bitacora.seq,
                "bitacora": self.bitacora.desde(0, limite=30),
                "ids": self.ids,
            }

    def cadena_de(self, nid, desde=0, limite=50):
        with self.lock:
            n = self._nodo(nid)
            bl = n.cadena[desde:desde + limite]
            return {"nodo": nid, "total": len(n.cadena), "desde": desde, "bloques": copy.deepcopy(bl),
                    "validacion": n.informe.a_dict()}

    def saldo_de(self, nid):
        with self.lock:
            n = self._nodo(nid)
            v = self._vista_nodo(n, self.red.referencia())
            items = [i for i in recompensas_info(n.cadena, self.params) if i["beneficiario"] == nid]
            return {"nodo": nid, **v["saldo"], "recompensas": items}

    def nodo_vista(self, nid):
        with self.lock:
            n = self._nodo(nid)
            return {"nodo": self._vista_nodo(n, self.red.referencia()),
                    "recompensas": [i for i in recompensas_info(n.cadena, self.params) if i["beneficiario"] == nid]}

    def cerrar(self):
        with self.lock:
            self.cerrada = True
            if self.trabajo is not None and self.trabajo.activo:
                self.trabajo.cancelar()
            self.auto_restante = 0
            hilo = self._hilo
        if hilo is not None and hilo is not threading.current_thread():
            hilo.join(timeout=2)


def _bucle_pow(sim, job):
    """Hilo de la carrera: una ronda por vuelta bajo el candado; duerme FUERA del candado."""
    while True:
        with sim.lock:
            if sim.cerrada or sim.trabajo is not job or not job.activo:
                return
            try:
                sim._paso_trabajo(job)
            except Exception as e:  # noqa: BLE001 - nunca dejar la carrera colgada
                job.estado, job.mensaje = "error", f"Error interno: {type(e).__name__}"
                sim.auto_restante = 0
                return
            if job.estado == "ganado" and sim.auto_restante > 0 and not sim.cerrada:
                sim.auto_restante -= 1
                try:
                    with sim.transaccion():
                        if not sim.pool:
                            sim.crear_tx_aleatorias(2)
                        sim._preparar_trabajo(automatico=True)
                    job = sim.trabajo
                except ErrorSim as e:
                    sim.auto_restante = 0
                    sim.log("aviso", "autopiloto_detenido", f"Autopiloto detenido: {e.mensaje}")
                    return
                continue
            if not job.activo:
                return
            pausa = sim.config["pausa_ms"] / 1000
        time.sleep(pausa)


class Laboratorio:
    """Registro de las dos simulaciones (pow, pos), cada una independiente y persistente."""

    def __init__(self):
        self.lock = threading.RLock()
        self.sims = {}
        self.epocas = {"pow": 0, "pos": 0}

    def obtener(self, modo):
        with self.lock:
            return self.sims.get(modo)

    def crear(self, modo, config):
        with self.lock:
            self.epocas[modo] += 1
            nueva = Simulacion(config, self.epocas[modo])
            vieja = self.sims.get(modo)
            self.sims[modo] = nueva
        if vieja is not None:
            vieja.cerrar()
        return nueva

    def eliminar(self, modo):
        with self.lock:
            vieja = self.sims.pop(modo, None)
        if vieja is not None:
            vieja.cerrar()
        return vieja is not None

    def cerrar_todo(self):
        with self.lock:
            sims, self.sims = list(self.sims.values()), {}
        for s in sims:
            s.cerrar()
