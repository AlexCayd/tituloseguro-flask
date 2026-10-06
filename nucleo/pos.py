"""Proof of Stake: apuestas, sorteo ponderado, candidato firmado, votación 2/3 y castigo.

La ronda es una máquina de estados:
    APUESTAS → SORTEO → CANDIDATO → VOTACION → ACEPTADO
                  ↑                     └────→ RECHAZADO ─┐ (castigo; nuevo sorteo sin el castigado)
                  └───────────────────────────────────────┘          ABORTADA (sin validadores)
Todo el estado vive en la ronda y la `Simulacion` (el «ctx»); aquí no hay hilos.
"""
import hashlib

from .bloque import hash_candidato, nuevo_bloque, sellar
from .consenso import castigo, sortear, umbral_cumplido
from .cripto import firmar_tx, firmar_voto, tx_id
from .errores import ErrorSim
from .instituciones import etiqueta
from .libro import aplicar_castigos_pendientes, aplicar_tx
from .validacion import validar_bloque, validar_candidato

FASES = ("APUESTAS", "SORTEO", "CANDIDATO", "VOTACION", "ACEPTADO", "RECHAZADO", "ABORTADA")
TERMINALES = ("ACEPTADO", "ABORTADA")
TRAMPAS = ("firma", "gasto")


def elegir_validadores(candidatos, cantidad, semilla, numero, ronda_id):
    """Subconjunto reproducible de tamaño `cantidad` (o todos si no se pide): ordena por una
    huella derivada de la semilla, sin depender de ningún generador pseudoaleatorio."""
    ids = sorted(candidatos)
    if not cantidad or cantidad >= len(ids):
        return ids
    clave = lambda v: hashlib.sha256(f"{semilla}|validadores|{numero}|{ronda_id}|{v}".encode()).hexdigest()
    return sorted(sorted(ids, key=clave)[:cantidad])


def apuestas_por_defecto(gastables, semilla, ronda_id):
    """Entre el 10 % y el 50 % del saldo gastable de cada validador (mínimo 1)."""
    out = {}
    for vid in sorted(gastables):
        g = gastables[vid]
        h = int(hashlib.sha256(f"{semilla}|apuestas|{ronda_id}|{vid}".encode()).hexdigest(), 16)
        out[vid] = min(g, max(1, g * (10 + h % 41) // 100))
    return out


def _flip(hex_):
    return ("1" if hex_[:1] == "0" else "0") + hex_[1:]


class RondaPoS:
    def __init__(self, ident, modo, numero_bloque, validadores, apuestas):
        self.id = ident                      # también es el campo `ronda_pos` del bloque
        self.modo = modo                     # "auto" | "paso"
        self.numero_bloque = numero_bloque
        self.validadores = sorted(validadores)
        self.apuestas = dict(apuestas)       # apuestas iniciales de TODOS (incluye eliminados)
        self.eliminados = []
        self.fase = "APUESTAS"
        self.intento = 0
        self.proponente = None
        self.sorteo = None
        self.candidato = None
        self.votos = {}                      # id -> {voto, peso, firma, motivo}
        self.votacion = None
        self.castigos_ronda = []
        self.historial = []
        self.resultado = None

    # ----------------------------------------------------------------- consultas
    @property
    def activa(self):
        return self.fase not in TERMINALES

    def restantes(self):
        return {v: self.apuestas[v] for v in self.validadores if v not in self.eliminados}

    def bloqueado(self):
        """Apuestas bloqueadas: desde que se cierra la fase de apuestas hasta el final."""
        return self.restantes() if self.fase in ("SORTEO", "CANDIDATO", "VOTACION", "RECHAZADO") else {}

    def _hist(self, ctx, texto):
        self.historial.append({"fase": self.fase, "intento": self.intento, "t": ctx.reloj.ahora(),
                               "texto": texto})

    # ------------------------------------------------------------------- apuestas
    def validar_apuestas(self, apuestas, ctx):
        """Devuelve las apuestas validadas (atómico: si una falla no se aplica ninguna)."""
        nuevas = {}
        for vid, a in apuestas.items():
            if vid not in self.validadores:
                raise ErrorSim("apuesta_no_validador",
                               f"{vid} no es validador en esta ronda: no puede apostar.", 422, "apuestas")
            if isinstance(a, bool) or not isinstance(a, int):
                raise ErrorSim("apuesta_invalida", f"La apuesta de {vid} debe ser un entero positivo.",
                               422, "apuestas")
            if a <= 0:
                raise ErrorSim("apuesta_invalida",
                               f"La apuesta de {vid} debe ser mayor que cero (recibido: {a}).", 422, "apuestas")
            g = ctx.gastable_base(vid)
            if a > g:
                raise ErrorSim("apuesta_excede_saldo",
                               f"{vid} intenta apostar {a} pero solo puede apostar {g}.", 422, "apuestas",
                               {"nodo": vid, "gastable": g})
            nuevas[vid] = a
        return nuevas

    def fijar_apuestas(self, apuestas, ctx):
        if self.fase != "APUESTAS":
            raise ErrorSim("fase_incorrecta",
                           f"Las apuestas solo se pueden cambiar en la fase APUESTAS (ahora: {self.fase}).",
                           409)
        self.apuestas.update(self.validar_apuestas(apuestas, ctx))
        ctx.log("info", "apuestas_fijadas", "Apuestas actualizadas: " + ", ".join(
            f"{v}={self.apuestas[v]}" for v in self.validadores))

    # --------------------------------------------------------------------- avance
    def avanzar(self, ctx, fase_esperada=None):
        if fase_esperada is not None and fase_esperada != self.fase:
            raise ErrorSim("fase_cambio",
                           f"La ronda ya no está en {fase_esperada}: ahora está en {self.fase}. "
                           f"Otra pestaña avanzó antes.", 409, detalle={"fase": self.fase})
        f = self.fase
        if f == "APUESTAS":
            self._bloquear_y_sortear(ctx)
        elif f == "SORTEO":
            self._armar_candidato(ctx)
        elif f == "CANDIDATO":
            self._abrir_votacion(ctx)
        elif f == "VOTACION":
            self._escrutar(ctx)
        elif f == "RECHAZADO":
            self._siguiente_intento(ctx)
        else:
            raise ErrorSim("fase_incorrecta", f"La ronda ya terminó ({f}). Inicia otra ronda.", 409)

    def _bloquear_y_sortear(self, ctx):
        for vid in self.validadores:                 # el saldo pudo cambiar desde la fase APUESTAS
            g = ctx.gastable_base(vid)
            if self.apuestas[vid] > g:
                raise ErrorSim("apuesta_excede_saldo",
                               f"{vid} apostó {self.apuestas[vid]} pero ahora solo puede apostar {g}. "
                               f"Corrige su apuesta.", 422, "apuestas", {"nodo": vid, "gastable": g})
        self.fase = "SORTEO"
        ctx.log("info", "apuestas_fijadas",
                f"Apuestas cerradas y bloqueadas: total apostado A = {sum(self.apuestas.values())}.")
        self._sortear(ctx)

    def _sortear(self, ctx):
        rest = self.restantes()
        if not rest:
            self._abortar(ctx, "Ya no quedan validadores con apuesta: todos fueron castigados.")
            return
        ref = ctx.ref()
        gan, traza = sortear(rest, ref.hash_cabeza, self.numero_bloque, self.intento)
        self.proponente, self.sorteo = gan, traza
        self.fase = "SORTEO"
        txt = (f"Sorteo (intento {self.intento}): número reproducible r = {traza['r']} de A = {traza['A']} "
               f"→ cae en el intervalo de {gan}.")
        self._hist(ctx, txt)
        ctx.log("info", "sorteo", txt, nodo=gan, datos={"r": traza["r"], "A": traza["A"]})

    def _armar_candidato(self, ctx):
        prop = self.proponente
        ref = ctx.ref()
        previo = ref.cadena[-1]
        castigos_bloque = list(ctx.castigos_pendientes) + list(self.castigos_ronda)
        bloqueado = self.restantes()
        libro = ref.libro.copia()
        aplicar_castigos_pendientes(libro, castigos_bloque)
        txs, firmas, descartadas = [], [], []
        for item in list(ctx.pool):
            if len(txs) >= ctx.params["max_tx_bloque"]:
                break
            res = aplicar_tx(libro, item["tx"], item["firma"], ctx.params, ctx.claves, bloqueado=bloqueado)
            if res:
                descartadas.append((item, res))
            else:
                txs.append(dict(item["tx"]))
                firmas.append(item["firma"])
        for item, (codigo, det) in descartadas:
            ctx.quitar_del_pool([item["id"]])
            ctx.log("aviso", "tx_descartada",
                    f"Registro {item['id'][:8]}… descartado: ya no es válido ({codigo}).",
                    datos={"codigo": codigo})
        if not txs:
            self._abortar(ctx, "Ningún registro en espera sigue siendo válido: no hay nada que proponer.")
            return
        trampa = None
        if ctx.nodos[prop].deshonesto:
            trampa = ctx.nodos[prop].trampa or "firma"
            if trampa == "firma":
                firmas[0] = _flip(firmas[0])
            else:                                   # gasto mayor al saldo, correctamente firmado
                recep = next(i for i in sorted(ctx.nodos) if i != prop)
                # sobre el saldo YA con los registros del folio aplicados (podría recibir créditos en él):
                # así el gasto es siempre mayor de lo que realmente puede gastar
                monto = min(ctx.params["monto_max"], libro.disponible[prop] + 1)
                tx = {"emisor": prop, "receptor": recep, "monto": monto, "timestamp": ctx.reloj.ahora()}
                if len(txs) >= ctx.params["max_tx_bloque"]:
                    txs.pop(), firmas.pop()
                txs.append(tx)
                firmas.append(firmar_tx(ctx.privs[prop], tx))
        ts = ctx.reloj.tick()
        b = nuevo_bloque(self.numero_bloque, ts, txs, firmas, previo["hash"], prop,
                         ctx.params["recompensa"], nonce=0, votos=(), apuestas=self.apuestas,
                         castigos=castigos_bloque, ronda_pos=self.id)
        hc = hash_candidato(b)
        firma_prop = firmar_voto(ctx.privs[prop], hc, prop, True)
        problemas = validar_candidato(b, previo, ref.libro.copia(), ctx.params, ctx.claves)
        self.candidato = {
            "bloque": b, "hash_candidato": hc, "proponente": prop, "firma": firma_prop,
            "tx_ids": [tx_id(t) for t in txs], "valido": not problemas,
            "motivo": problemas[0].mensaje if problemas else None, "trampa": trampa,
            "problemas": [p.a_dict() for p in problemas[:10]],
        }
        self.fase = "CANDIDATO"
        txt = f"{prop} arma el folio candidato #{self.numero_bloque} con {len(txs)} registro(s) y lo firma."
        if trampa:
            txt += f" (Institución deshonesta: trampa «{trampa}».)"
        self._hist(ctx, txt)
        ctx.log("info", "candidato", txt, nodo=prop, datos={"trampa": trampa, "hash_candidato": hc})

    def _abrir_votacion(self, ctx):
        prop = self.proponente
        self.votos = {prop: {"voto": True, "peso": self.apuestas[prop], "firma": self.candidato["firma"],
                             "motivo": "firmó su propio bloque"}}
        self.fase = "VOTACION"
        self._hist(ctx, f"Abre la votación: cada validador revisa el bloque y vota con peso igual a su "
                        f"apuesta. {prop} ya votó a favor al firmarlo.")

    def votar(self, ctx, votante, voto):
        if self.fase != "VOTACION":
            raise ErrorSim("fase_incorrecta",
                           f"Solo se puede votar durante la VOTACION (ahora: {self.fase}).", 409)
        if votante not in ctx.nodos:
            raise ErrorSim("nodo_inexistente", f"El nodo «{str(votante)[:20]}» no existe.", 422, "votante")
        if votante not in self.restantes():
            motivo = ("fue castigado y eliminado de esta ronda" if votante in self.eliminados
                      else "no es validador de esta ronda")
            raise ErrorSim("voto_no_validador", f"{votante} no puede votar: {motivo}.", 422, "votante")
        if votante in self.votos:
            raise ErrorSim("voto_duplicado", f"{votante} ya votó en esta ronda: un voto por validador.",
                           409, "votante")
        self._emitir_voto(ctx, votante, bool(voto), "voto manual")

    def _emitir_voto(self, ctx, votante, voto, motivo):
        hc = self.candidato["hash_candidato"]
        self.votos[votante] = {"voto": voto, "peso": self.apuestas[votante],
                               "firma": firmar_voto(ctx.privs[votante], hc, votante, voto),
                               "motivo": motivo}
        ctx.reloj.tick()
        ctx.log("info", "voto", f"{votante} vota {'A FAVOR' if voto else 'EN CONTRA'} "
                                f"(peso {self.apuestas[votante]}): {motivo}.", nodo=votante,
                datos={"voto": voto, "peso": self.apuestas[votante]})

    def _escrutar(self, ctx):
        cand = self.candidato
        for vid in sorted(self.restantes()):
            if vid in self.votos:
                continue
            if ctx.nodos[vid].deshonesto:
                self._emitir_voto(ctx, vid, True, "nodo deshonesto: aprueba sin revisar")
            elif cand["valido"]:
                self._emitir_voto(ctx, vid, True, "el bloque es válido")
            else:
                self._emitir_voto(ctx, vid, False, f"el bloque es inválido: {cand['motivo']}")
        rest = self.restantes()
        A = sum(rest.values())
        V = sum(v["peso"] for vid, v in self.votos.items() if v["voto"] and vid in rest)
        cumple = umbral_cumplido(V, A)
        self.votacion = {"V_si": V, "V_no": A - V, "A": A, "umbral": "3V ≥ 2A", "cumple": cumple}
        ref = ctx.ref()
        if not cumple:
            self._rechazar(ctx, f"votos a favor insuficientes: {V} de {A} (se necesita 3V ≥ 2A)")
            return
        final = dict(cand["bloque"])
        final["votos"] = [{"votante": vid, "peso": self.votos[vid]["peso"], "firma": self.votos[vid]["firma"]}
                          for vid in sorted(rest) if self.votos.get(vid, {}).get("voto")]
        sellar(final)
        problemas = validar_bloque(final, ref.cadena[-1], ref.libro.copia(), ctx.params, ctx.claves)
        if problemas:
            self._rechazar(ctx, f"votos suficientes ({V} de {A}) pero el bloque es inválido: "
                                f"{problemas[0].mensaje}")
            return
        self._aceptar(ctx, final, V, A)

    def _aceptar(self, ctx, final, V, A):
        ctx.agregar_bloque_pos(final, self.proponente)
        ctx.quitar_del_pool(self.candidato["tx_ids"])
        ctx.castigos_pendientes.clear()     # todos quedaron registrados en este bloque
        self.fase = "ACEPTADO"
        self.resultado = {"estado": "ACEPTADO", "bloque": final["numero"], "proponente": self.proponente,
                          "hash": final["hash"]}
        txt = (f"Bloque #{final['numero']} ACEPTADO con {V} de {A} votos a favor (≥ 2/3). "
               f"{etiqueta(self.proponente)} cobra {ctx.params['recompensa']} créditos de certificación y se liberan las apuestas.")
        self._hist(ctx, txt)
        ctx.log("ok", "ronda_aceptada", txt, nodo=self.proponente, datos={"bloque": final["numero"]})

    def _rechazar(self, ctx, motivo):
        prop, cand = self.proponente, self.candidato
        valor = sum(t["monto"] for t in cand["bloque"]["transacciones"])
        regla, alfa = ctx.params["castigo"]["regla"], ctx.params["castigo"]["alfa_pm"]
        monto = castigo(regla, self.apuestas[prop], valor, alfa)
        self.castigos_ronda.append({
            "proponente": prop, "apuesta": self.apuestas[prop], "valor_tx": valor, "monto": monto,
            "intento": self.intento, "ronda_pos": self.id, "hash_candidato": cand["hash_candidato"],
            "firma": cand["firma"], "motivo": motivo})
        self.eliminados.append(prop)
        self.fase = "RECHAZADO"
        txt = (f"Bloque RECHAZADO: {motivo}. {etiqueta(prop)} pierde {monto} créditos de su apuesta de {self.apuestas[prop]} "
               f"(regla {regla}) y queda fuera de esta ronda.")
        self._hist(ctx, txt)
        ctx.log("aviso", "ronda_rechazada", txt, nodo=prop, datos={"monto": monto, "regla": regla})
        ctx.log("aviso", "castigo", f"{etiqueta(prop)} castigado con {monto} créditos (quemados).", nodo=prop,
                datos={"monto": monto})

    def _siguiente_intento(self, ctx):
        self.intento += 1
        self.votos, self.candidato, self.votacion = {}, None, None
        self.fase = "SORTEO"
        self._sortear(ctx)

    def _abortar(self, ctx, motivo):
        ctx.castigos_pendientes.extend(self.castigos_ronda)   # el castigo se mantiene
        self.fase = "ABORTADA"
        self.resultado = {"estado": "ABORTADA", "motivo": motivo}
        self._hist(ctx, f"Ronda ABORTADA: {motivo}")
        ctx.log("aviso", "ronda_abortada", f"Ronda abortada: {motivo}", datos={"motivo": motivo})

    def cancelar(self, ctx):
        if not self.activa:
            raise ErrorSim("fase_incorrecta", f"La ronda ya terminó ({self.fase}).", 409)
        self._abortar(ctx, "Cancelada por el usuario: se liberan las apuestas, sin castigo adicional.")

    # -------------------------------------------------------------------- vista
    def publica(self, ctx):
        rest = self.restantes()
        vals = []
        for vid in self.validadores:
            elim = vid in self.eliminados
            cast = next((c["monto"] for c in self.castigos_ronda if c["proponente"] == vid), 0)
            if elim:
                estado = "eliminado"
            elif vid == self.proponente and self.fase in ("SORTEO", "CANDIDATO", "VOTACION"):
                estado = "proponente"
            else:
                estado = "activo"
            v = self.votos.get(vid)
            vals.append({"id": vid, "apuesta": self.apuestas[vid], "estado": estado,
                         "voto": None if v is None else v["voto"], "castigo": cast,
                         "motivo_voto": None if v is None else v["motivo"]})
        cand = None
        if self.candidato:
            c = self.candidato
            cand = {"hash_candidato": c["hash_candidato"], "proponente": c["proponente"],
                    "tx_ids": c["tx_ids"], "valido": c["valido"], "motivo": c["motivo"],
                    "trampa": c["trampa"], "problemas": c["problemas"],
                    "transacciones": c["bloque"]["transacciones"]}
        return {"id": self.id, "fase": self.fase, "modo": self.modo, "numero_bloque": self.numero_bloque,
                "intento": self.intento, "proponente": self.proponente, "validadores": vals,
                "A": sum(self.apuestas.values()), "A_activo": sum(rest.values()),
                "sorteo": self.sorteo, "candidato": cand, "votacion": self.votacion,
                "castigos_ronda": self.castigos_ronda, "historial": self.historial,
                "resultado": self.resultado, "activa": self.activa}
