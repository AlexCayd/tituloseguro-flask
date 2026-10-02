"""La red: une cadena en memoria, base de datos, cola de pendientes y carrera de mineros."""
import json
import threading
import time

from sqlalchemy import func, select

import reglas
from blockchain import (
    DIFICULTAD, NODOS, RECOMPENSA, Billetera, Cadena, Ronda, crear_nodos, validar_bloques,
)
from models import BlockRow, Config, IssuerKey, Pending


class ErrorRed(Exception):
    """Error esperable (mensaje apto para mostrar). `codigo` es el HTTP sugerido."""

    def __init__(self, mensaje, codigo=400):
        super().__init__(mensaje)
        self.codigo = codigo


class Red:
    def __init__(self, Session, secretos):
        self.Session, self.secretos = Session, secretos
        self.nodos = crear_nodos()
        self.ronda = None
        self.ronda_folio = None
        self.ultimo_error = None
        self.cronometro = None  # lo asigna la app (bench.Cronometro)
        self._arranque = threading.Lock()
        self._pend_id = None
        self._cache_cola = (-1e9, (0, None))
        self._cache_valida = (-1, None)
        self.cadena = Cadena(validar_contenido=reglas.validar_estructura)
        self._cargar()

    # ----------------------------------------------------------------- arranque
    def _cargar(self):
        with self.Session() as s, s.begin():
            filas = s.scalars(select(BlockRow).order_by(BlockRow.numero)).all()
            if filas:
                self.cadena.bloques = [json.loads(f.json) for f in filas]
            else:
                g = self.cadena.bloques[0]
                s.add(BlockRow(numero=0, hash=g["hash"], json=json.dumps(g, sort_keys=True)))
            # si el servidor murió a media carrera, esas credenciales vuelven a la cola
            for p in s.scalars(select(Pending).where(Pending.estado == "minando")):
                p.estado = "pendiente"
        self.cadena.al_agregar = self._persistir
        if not self.cadena.es_valida():
            print("ADVERTENCIA: la cadena guardada en la base de datos NO es válida.")

    def _persistir(self, bloque):
        """Se ejecuta dentro del candado, antes de agregar el bloque en memoria."""
        with self.Session() as s, s.begin():
            s.add(BlockRow(numero=bloque["numero"], hash=bloque["hash"],
                           json=json.dumps(bloque, sort_keys=True)))
            if self._pend_id:
                p = s.get(Pending, self._pend_id)
                if p:
                    p.estado = "minada"

    # ----------------------------------------------------------------- configuración
    @property
    def dificultad(self):
        with self.Session() as s:
            c = s.get(Config, "dificultad")
        return int(c.valor) if c else DIFICULTAD

    def fijar_dificultad(self, d):
        from blockchain import DIFICULTADES_PERMITIDAS
        if d not in DIFICULTADES_PERMITIDAS:
            raise ErrorRed(f"La dificultad debe ser una de {DIFICULTADES_PERMITIDAS}.")
        if self.ronda and self.ronda.activa:
            raise ErrorRed("No se puede cambiar la dificultad en mitad de una carrera.", 409)
        with self.Session() as s, s.begin():
            c = s.get(Config, "dificultad")
            if c:
                c.valor = str(d)
            else:
                s.add(Config(clave="dificultad", valor=str(d)))

    # ----------------------------------------------------------------- llaves y emisión
    def codigos_por_pub(self):
        with self.Session() as s:
            return {k.pub: k.universidad_codigo for k in s.scalars(select(IssuerKey))}

    def universidades(self):
        with self.Session() as s:
            return [{"codigo": k.universidad_codigo, "nombre": k.universidad_nombre, "pub": k.pub}
                    for k in s.scalars(select(IssuerKey).order_by(IssuerKey.universidad_codigo))]

    def _billetera(self, s, codigo):
        k = s.scalars(select(IssuerKey).where(IssuerKey.universidad_codigo == codigo)).first()
        if not k:
            raise ErrorRed("Tu cuenta no tiene una llave de emisor registrada.", 403)
        return Billetera.desde_hex(self.secretos.descifrar(k.priv_cifrada))

    def _indice_pendientes(self, s):
        ix = reglas.IndicePendientes()
        for p in s.scalars(select(Pending).where(Pending.estado.in_(("pendiente", "minando")))):
            if p.tipo_tx == "registro":
                ix.folios.add(p.folio)
                ix.huellas.add(p.huella)
                ix.claves.add(p.clave_dup)
            else:
                ix.revocaciones.add(p.folio)
        return ix

    def _encolar(self, s, user, tx, tipo_tx):
        codigo = user.universidad_codigo
        firma = self._billetera(s, codigo).firmar(tx)
        msg = reglas.validar_reglas(tx, firma, self.codigos_por_pub(),
                                    reglas.indexar_cadena(self.cadena.bloques),
                                    self._indice_pendientes(s))
        if msg:
            raise ErrorRed(msg, 422)
        c = tx["contenido"]
        p = Pending(
            tipo_tx=tipo_tx,
            folio=c["folio"] if tipo_tx == "registro" else c["folio_revocado"],
            huella=c.get("huella_documento"),
            clave_dup=reglas.clave_dup(c) if tipo_tx == "registro" else None,
            alumno_id=c.get("alumno_id"),
            tx_json=json.dumps(tx, sort_keys=True),
            firma=firma,
            emisor_id=user.id,
        )
        s.add(p)
        s.commit()
        self._cache_cola = (-1e9, (0, None))
        return {"id": p.id, "folio": p.folio, "tipo_tx": tipo_tx, "firma": firma, "tx": tx}

    def emitir_registro(self, user, matricula, programa, tipo, fecha_emision):
        if user.rol not in ("UNIVERSITY", "ADMIN") or not user.universidad_codigo:
            raise ErrorRed("Solo una universidad o el administrador pueden emitir credenciales.", 403)
        if not str(matricula or "").strip():
            raise ErrorRed("Escribe la matrícula del alumno.")
        try:
            programa, tipo, fecha = reglas.validar_formulario(programa, tipo, fecha_emision)
        except ValueError as e:
            raise ErrorRed(str(e))
        with self.Session() as s:
            w = self._billetera(s, user.universidad_codigo)
            tx = reglas.construir_registro(user.universidad_codigo, w.pub,
                                           self.secretos.alumno_id(matricula), programa, tipo, fecha)
            return self._encolar(s, user, tx, "registro")

    def emitir_revocacion(self, user, folio, motivo):
        if user.rol not in ("UNIVERSITY", "ADMIN") or not user.universidad_codigo:
            raise ErrorRed("Solo una universidad o el administrador pueden revocar credenciales.", 403)
        motivo = (motivo or "").strip()
        if not 3 <= len(motivo) <= 200:
            raise ErrorRed("Escribe un motivo de entre 3 y 200 caracteres.")
        with self.Session() as s:
            w = self._billetera(s, user.universidad_codigo)
            tx = reglas.construir_revocacion(w.pub, folio, motivo)
            return self._encolar(s, user, tx, "revocacion")

    # ----------------------------------------------------------------- cola
    def _info_cola(self):
        """(cuántas esperan, folio de la siguiente), con caché de 1 s porque /estado se sondea mucho."""
        t, info = self._cache_cola
        if time.monotonic() - t > 1.0:
            with self.Session() as s:
                n = s.scalar(select(func.count()).select_from(Pending).where(Pending.estado == "pendiente"))
                sig = s.scalars(select(Pending.folio).where(Pending.estado == "pendiente")
                                .order_by(Pending.id).limit(1)).first()
            info = (n, sig)
            self._cache_cola = (time.monotonic(), info)
        return info

    def contar_cola(self):
        return self._info_cola()[0]

    def cola(self, limite=12):
        with self.Session() as s:
            filas = s.scalars(select(Pending).where(Pending.estado.in_(("pendiente", "minando")))
                              .order_by(Pending.id).limit(limite)).all()
            return [self._resumen_pendiente(p) for p in filas]

    def rechazadas(self, limite=10):
        with self.Session() as s:
            filas = s.scalars(select(Pending).where(Pending.estado == "rechazada")
                              .order_by(Pending.id.desc()).limit(limite)).all()
            return [{**self._resumen_pendiente(p), "motivo": p.motivo} for p in filas]

    @staticmethod
    def _resumen_pendiente(p):
        tx = json.loads(p.tx_json)
        c = tx["contenido"]
        r = {"id": p.id, "folio": p.folio, "estado": p.estado, "tipo_tx": p.tipo_tx}
        if p.tipo_tx == "registro":
            r.update(tipo=c["tipo"], programa=c["programa"], universidad=c["universidad"],
                     fecha_emision=c["fecha_emision"])
        else:
            r.update(motivo_revocacion=c["motivo"])
        return r

    # ----------------------------------------------------------------- la carrera
    def iniciar_ronda(self):
        with self._arranque:
            if self.cronometro and self.cronometro.activo:
                raise ErrorRed("El cronómetro está midiendo tiempos; espera a que termine.", 409)
            if self.ronda:
                if self.ronda.activa:
                    raise ErrorRed("Ya hay una carrera en curso.", 409)
                # los hilos perdedores salen en microsegundos; si no esperamos, uno viejo podría
                # pisar el estado de los nodos de la carrera nueva
                self.ronda.esperar(5)
            ix = reglas.indexar_cadena(self.cadena.bloques)
            codigos = self.codigos_por_pub()
            dificultad = self.dificultad
            rechazadas = 0
            with self.Session() as s:
                while True:
                    p = s.scalars(select(Pending).where(Pending.estado == "pendiente")
                                  .order_by(Pending.id).limit(1)).first()
                    if not p:
                        raise ErrorRed("No hay credenciales pendientes por minar.", 409)
                    tx = json.loads(p.tx_json)
                    msg = reglas.validar_reglas(tx, p.firma, codigos, ix)  # vuelve a verificar la firma
                    if msg:
                        p.estado, p.motivo = "rechazada", msg
                        s.commit()
                        rechazadas += 1
                        continue
                    p.estado = "minando"
                    s.commit()
                    break
            saldos = self.cadena.saldos()
            for n in self.nodos:
                n.saldo = saldos.get(n.nombre, 0)
            self._pend_id, self.ultimo_error = p.id, None
            self._cache_cola = (-1e9, (0, None))
            ronda = Ronda(self.cadena, tx, p.firma, dificultad, self.nodos)
            self.ronda = ronda
            self.ronda_folio = p.folio
            ronda.iniciar()
            threading.Thread(target=self._vigilar, args=(ronda, p.id), daemon=True).start()
            return {"numero": ronda.numero, "folio": p.folio, "dificultad": dificultad,
                    "rechazadas": rechazadas}

    def _vigilar(self, ronda, pend_id):
        ronda.esperar()
        if ronda.estado["ganador"] is None:  # se cayó la carrera: la credencial vuelve a la cola
            self.ultimo_error = ronda.estado["error"] or "La carrera terminó sin ganador."
            with self.Session() as s, s.begin():
                p = s.get(Pending, pend_id)
                if p and p.estado == "minando":
                    p.estado = "pendiente"
        self._cache_cola = (-1e9, (0, None))

    # ----------------------------------------------------------------- lecturas públicas
    def estado(self):
        r = self.ronda
        if r:
            e = r.estado_publico()
        else:
            e = {"minando": False, "ganador": None, "error": None, "numero": len(self.cadena.bloques),
                 "dificultad": self.dificultad, "transcurrido": 0, "bitacora": [],
                 "nodos": [{"i": n.i, "nombre": n.nombre, "intentos": 0, "ultimo": "", "nonce": None,
                            "hashrate": 0, "resultado": "en espera", "ganador": False}
                           for n in self.nodos]}
        saldos = self.cadena.saldos()
        for n in e["nodos"]:
            n["saldo"] = saldos.get(n["nombre"], 0)
        ultimo = self.cadena.ultimo
        cola, proximo = self._info_cola()
        hashrate_ultima = 0
        if r and r.t1 and r.t1 > r.t0:  # velocidad real de la última carrera: sirve para estimar la siguiente
            hashrate_ultima = round(sum(n.intentos for n in r.nodos) / (r.t1 - r.t0))
        e.update(
            folio=self.ronda_folio if r else None,
            cola=cola,
            proximo_folio=proximo,
            hashrate_ultima=hashrate_ultima,
            longitud=len(self.cadena.bloques),
            dificultad_config=self.dificultad,
            recompensa=RECOMPENSA,
            cronometro_activo=bool(self.cronometro and self.cronometro.activo),
            error_ultimo=self.ultimo_error,
            ultimo_bloque={"numero": ultimo["numero"], "hash": ultimo["hash"], "minero": ultimo["minero"]},
        )
        return e

    def validacion(self):
        n = len(self.cadena.bloques)
        if self._cache_valida[0] != n:
            self._cache_valida = (n, validar_bloques(list(self.cadena.bloques), reglas.validar_estructura))
        return self._cache_valida[1]

    def ranking(self):
        filas = {n: {"nombre": n, "bloques": 0, "saldo": 0} for n in NODOS}
        for b in self.cadena.bloques[1:]:
            f = filas[b["minero"]]
            f["bloques"] += 1
            f["saldo"] += b["recompensa"]
        return sorted(filas.values(), key=lambda f: (-f["bloques"], f["nombre"]))

    def verificar(self, folio):
        folio = reglas.normalizar_folio(folio)
        ix = reglas.indexar_cadena(self.cadena.bloques)
        with self.Session() as s:
            pend = self._indice_pendientes(s)
        estado, b, rev = reglas.estado_credencial(folio, ix, pend.folios)
        out = {"folio": folio, "estado": estado}
        if b:
            v = self.validacion()
            fallas = set(v["bloques"][b["numero"]]["fallas"])
            out.update(
                bloque=b, revocacion=rev, cadena_valida=v["valida"],
                pasos=[
                    {"id": "existe", "ok": True},
                    {"id": "firma", "ok": "firma" not in fallas},
                    {"id": "hash", "ok": "hash" not in fallas},
                    {"id": "trabajo", "ok": "dificultad" not in fallas},
                    {"id": "enlace", "ok": "enlace" not in fallas},
                    {"id": "cadena", "ok": v["valida"]},
                ],
                universidad=next((u["nombre"] for u in self.universidades()
                                  if u["codigo"] == b["transaccion"]["contenido"]["universidad"]), None),
            )
        return out

    def credenciales_de(self, alumno_id):
        out = []
        ix = reglas.indexar_cadena(self.cadena.bloques)
        for folio, b in ix.registros.items():
            c = b["transaccion"]["contenido"]
            if c["alumno_id"] == alumno_id:
                out.append({**{k: c[k] for k in ("folio", "tipo", "universidad", "programa", "fecha_emision")},
                            "estado": "revocada" if folio in ix.revocados else "vigente",
                            "numero": b["numero"], "hash": b["hash"], "minero": b["minero"]})
        with self.Session() as s:
            for p in s.scalars(select(Pending).where(Pending.alumno_id == alumno_id,
                                                      Pending.estado.in_(("pendiente", "minando")))):
                c = json.loads(p.tx_json)["contenido"]
                out.append({**{k: c[k] for k in ("folio", "tipo", "universidad", "programa", "fecha_emision")},
                            "estado": "pendiente", "numero": None, "hash": None, "minero": None})
        return sorted(out, key=lambda x: (x["numero"] is None, x["numero"] or 0))
