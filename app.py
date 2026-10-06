"""Título Seguro · certificados y credenciales académicas en blockchain (PoW y PoS) · rutas Flask.

Las rutas sólo reciben, validan la entrada con rigor (aunque la interfaz ya valide) y llaman al
núcleo (`nucleo/`), que puede ejecutarse y probarse sin Flask.

Ejecutar:  flask run --no-reload      (o)      python app.py
"""
import json
import logging
import mimetypes
import secrets

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from nucleo import constantes as C
from nucleo.ataques import TIPOS, TIPOS_CORRUPCION
from nucleo.bloque import RE_TS
from nucleo.entradas import (analizar_entero, exigir_campos, parse_bool, parse_config, parse_entero,
                             parse_id, parse_monto)
from nucleo.errores import ErrorSim
from nucleo.instituciones import INSTITUCIONES, TARIFAS, UNIDAD
from nucleo.pos import FASES
from nucleo.simulacion import Laboratorio

# En Windows el registro puede servir .js como text/plain y los módulos ES dejarían de cargar.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

log = logging.getLogger("simulador")
NIVELES = ("info", "ok", "aviso", "error")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")


def _rechazar_constante(nombre):
    raise ValueError(f"constante no permitida: {nombre}")


def leer_json():
    """Cuerpo JSON estricto: objeto, sin NaN/Infinity, sin números gigantes ni anidación absurda."""
    datos = request.get_data(cache=True)
    if not datos.strip():
        return {}
    # tolerante con curl sin cabecera: si el cuerpo PARECE JSON se intenta leer; si no, 415
    if request.mimetype != "application/json" and not datos.lstrip()[:1] in (b"{", b"["):
        raise ErrorSim("tipo_no_soportado",
                       "Envía el cuerpo como JSON con la cabecera «Content-Type: application/json».", 415)
    try:
        obj = json.loads(datos.decode("utf-8"), parse_constant=_rechazar_constante)
    except (ValueError, RecursionError, UnicodeDecodeError):
        raise ErrorSim("json_invalido", "El cuerpo no es un JSON válido (revisa comas, comillas, "
                                        "números y que no use NaN ni Infinity).", 400) from None
    if not isinstance(obj, dict):
        raise ErrorSim("cuerpo_no_objeto", "El cuerpo debe ser un objeto JSON, por ejemplo {\"n\": 12}.", 400)
    return obj


def qentero(nombre, minimo, maximo, defecto=None):
    """Parámetro entero de la query string (acepta dígitos)."""
    crudo = request.args.get(nombre)
    if crudo is None or crudo == "":
        return defecto
    v, razon = analizar_entero(crudo, minimo, maximo, permitir_str=True)
    if razon:
        raise ErrorSim("fuera_de_rango" if razon in ("negativo", "cero", "demasiado_pequeno", "demasiado_grande")
                       else "tipo_invalido",
                       f"El parámetro «{nombre}» debe ser un entero entre {minimo} y {maximo}.", 422, nombre,
                       {"razon": razon})
    return v


def create_app(config=None):
    app = Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=64 * 1024, N_MIN=C.N_MIN, N_MAX=C.N_MAX, DIF_MIN=C.DIF_MIN,
                      DIF_MAX=C.DIF_MAX)
    app.config.update(config or {})
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    lab = Laboratorio()
    app.extensions["lab"] = lab

    # ----------------------------------------------------------------- utilidades
    def modo_valido(modo):
        if modo not in C.MODOS:
            raise ErrorSim("modo_invalido", "El modo debe ser «pow» (Proof of Work) o «pos» (Proof of Stake).", 404)
        return modo

    def sim_de(modo):
        modo_valido(modo)
        s = lab.obtener(modo)
        if s is None:
            raise ErrorSim("sin_simulacion", "Todavía no hay una red creada en este modo: créala primero.", 409)
        return s

    def exito(sim, status=200, **extra):
        resp = jsonify(ok=True, rev=sim.rev, epoca=sim.epoca, **extra)
        resp.status_code = status
        return resp

    def cuerpo(sim, permitidos, requeridos=()):
        """Lee el JSON, rechaza campos desconocidos y comprueba la época (otra pestaña reinició)."""
        datos = leer_json()
        exigir_campos(datos, set(permitidos) | {"epoca"}, requeridos)
        if "epoca" in datos:
            ep = parse_entero(datos["epoca"], "epoca", 0, 10**9)
            if ep != sim.epoca:
                raise ErrorSim("epoca_obsoleta", "La simulación fue reiniciada desde otra pestaña: "
                                                 "recarga el estado.", 409, "epoca", {"epoca": sim.epoca})
        return datos

    def id_ruta(sim, nid):
        return parse_id(nid, "id", sim.ids, http=404)

    # -------------------------------------------------------------- seguridad HTTP
    @app.after_request
    def cabeceras(resp):
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["X-Frame-Options"] = "DENY"
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    # ---------------------------------------------------------------------- errores
    def es_api():
        return request.path.startswith("/api/")

    @app.errorhandler(ErrorSim)
    def _error_sim(e):
        return jsonify(e.a_dict()), e.http

    @app.errorhandler(HTTPException)
    def _error_http(e):
        codigos = {400: "peticion_invalida", 404: "ruta_no_encontrada", 405: "metodo_no_permitido",
                   413: "cuerpo_grande", 415: "tipo_no_soportado", 431: "cabeceras_grandes"}
        mensajes = {404: "Esa ruta no existe.", 405: "Ese método no está permitido en esta ruta.",
                    413: "El cuerpo de la petición es demasiado grande (máximo 64 KB).",
                    415: "Tipo de contenido no soportado: usa application/json."}
        if es_api():
            resp = jsonify(ok=False, error=mensajes.get(e.code, e.description or "Petición inválida."),
                           codigo=codigos.get(e.code, "error_http"))
            resp.status_code = e.code or 400
            if e.code == 405 and getattr(e, "valid_methods", None):
                resp.headers["Allow"] = ", ".join(sorted(e.valid_methods))
            return resp
        return render_template("error.html", codigo=e.code, mensaje=mensajes.get(e.code, "No se pudo atender la petición.")), e.code

    @app.errorhandler(Exception)
    def _error_interno(e):
        log.exception("error interno no controlado")
        if es_api():
            return jsonify(ok=False, error="Error interno controlado: la acción se deshizo y la red "
                                           "quedó como estaba. Inténtalo de nuevo.",
                           codigo="error_interno"), 500
        return render_template("error.html", codigo=500, mensaje="Error interno controlado."), 500

    # ---------------------------------------------------------------------- páginas
    @app.get("/")
    def index():
        return render_template("index.html", limites=_limites())

    def _limites():
        return {"n_min": app.config["N_MIN"], "n_max": app.config["N_MAX"],
                "dificultad_min": app.config["DIF_MIN"], "dificultad_max": app.config["DIF_MAX"],
                "dificultad_defecto": C.DIF_DEFECTO, "k_max": C.K_MAX,
                "max_rondas_max": C.MAX_RONDAS_MAX, "pausa_ms_max": C.PAUSA_MS_MAX,
                "monto_max": C.MONTO_MAX, "saldo_max": C.SALDO_MAX, "saldo_defecto": C.SALDO_DEFECTO,
                "recompensa_defecto": C.RECOMPENSA_DEFECTO, "confirmaciones_pow": C.CONF_POW,
                "max_pendientes": C.MAX_PENDIENTES, "max_tx_bloque": C.MAX_TX_BLOQUE,
                "max_altura": C.MAX_ALTURA, "umbral": [C.UMBRAL_NUM, C.UMBRAL_DEN],
                "alfa_defecto": C.ALFA_PM_DEFECTO / 1000, "ataques": TIPOS,
                "corrupciones": list(TIPOS_CORRUPCION), "fases_pos": list(FASES),
                "unidad": UNIDAD, "tarifas": TARIFAS, "instituciones": INSTITUCIONES}

    @app.get("/api/salud")
    def salud():
        modos = {}
        for m in C.MODOS:
            s = lab.obtener(m)
            modos[m] = {"existe": s is not None, "epoca": s.epoca if s else None, "rev": s.rev if s else None}
        return jsonify(ok=True, version=C.VERSION, modos=modos)

    @app.get("/api/limites")
    def limites():
        return jsonify(ok=True, **_limites())

    # --------------------------------------------------------------- simulación
    @app.post("/api/<modo>/simulacion")
    def crear_simulacion(modo):
        modo_valido(modo)
        datos = leer_json()
        cfg = parse_config(modo, datos, semilla_defecto=secrets.token_hex(4), n_min=app.config["N_MIN"],
                           n_max=app.config["N_MAX"], dif_min=app.config["DIF_MIN"],
                           dif_max=app.config["DIF_MAX"])
        sim = lab.crear(modo, cfg)
        return exito(sim, 201, estado=sim.estado())

    @app.delete("/api/<modo>/simulacion")
    def eliminar_simulacion(modo):
        modo_valido(modo)
        leer_json()
        if not lab.eliminar(modo):
            raise ErrorSim("sin_simulacion", "No hay ninguna red creada en este modo.", 409)
        return jsonify(ok=True)

    @app.get("/api/<modo>/estado")
    def estado(modo):
        modo_valido(modo)
        sim = lab.obtener(modo)
        desde, ep = qentero("desde", 0, 10**12), qentero("epoca", 0, 10**9)
        if sim is None:
            return jsonify(ok=True, existe=False, modo=modo)
        return jsonify(sim.estado(desde, ep))

    # -------------------------------------------------------------------- nodos
    @app.get("/api/<modo>/nodos/<nid>")
    def nodo(modo, nid):
        sim = sim_de(modo)
        return jsonify(ok=True, **sim.nodo_vista(id_ruta(sim, nid)))

    @app.get("/api/<modo>/nodos/<nid>/cadena")
    def cadena(modo, nid):
        sim = sim_de(modo)
        nid = id_ruta(sim, nid)
        desde, limite = qentero("desde", 0, 10**6, 0), qentero("limite", 1, 100, 50)
        return jsonify(ok=True, **sim.cadena_de(nid, desde, limite))

    @app.get("/api/<modo>/nodos/<nid>/saldo")
    def saldo(modo, nid):
        sim = sim_de(modo)
        return jsonify(ok=True, **sim.saldo_de(id_ruta(sim, nid)))

    @app.post("/api/<modo>/nodos/<nid>/conexion")
    def conexion(modo, nid):
        sim = sim_de(modo)
        nid = id_ruta(sim, nid)
        d = cuerpo(sim, {"conectado"}, ("conectado",))
        sim.conectar(nid, parse_bool(d["conectado"], "conectado"))
        return exito(sim, **sim.nodo_vista(nid))

    @app.post("/api/<modo>/nodos/<nid>/sincronizar")
    def sincronizar(modo, nid):
        sim = sim_de(modo)
        nid = id_ruta(sim, nid)
        cuerpo(sim, set())
        res = sim.sincronizar(nid)
        return exito(sim, resultado=res.a_dict(), **sim.nodo_vista(nid))

    @app.post("/api/pos/nodos/<nid>/deshonesto")
    def deshonesto(nid):
        sim = sim_de("pos")
        nid = id_ruta(sim, nid)
        d = cuerpo(sim, {"activo", "trampa"}, ("activo",))
        trampa = d.get("trampa")
        if trampa is not None and trampa not in ("firma", "gasto"):
            raise ErrorSim("trampa_invalida", "La trampa debe ser «firma» (firma alterada) o «gasto» "
                                              "(gasta más de lo que tiene).", 422, "trampa")
        sim.marcar_deshonesto(nid, parse_bool(d["activo"], "activo"), trampa)
        return exito(sim, **sim.nodo_vista(nid))

    # ------------------------------------------------------------- transacciones
    @app.post("/api/<modo>/tx")
    def tx(modo):
        sim = sim_de(modo)
        d = cuerpo(sim, {"emisor", "receptor", "monto", "timestamp", "firma", "trampa"},
                   ("emisor", "receptor", "monto"))
        emisor = parse_id(d["emisor"], "emisor", sim.ids)
        receptor = parse_id(d["receptor"], "receptor", sim.ids)
        monto = parse_monto(d["monto"])
        ts, firma, trampa = d.get("timestamp"), d.get("firma"), d.get("trampa")
        if (ts is None) != (firma is None):
            raise ErrorSim("campo_requerido", "Envía «timestamp» y «firma» juntos, o ninguno de los dos "
                                              "(sin ellos el servidor firma por el emisor).", 422, "firma")
        if ts is not None:
            if not (isinstance(ts, str) and RE_TS.match(ts)):
                raise ErrorSim("tipo_invalido", "«timestamp» debe tener el formato 2026-01-01T00:00:00Z.", 422,
                               "timestamp")
            if not isinstance(firma, str):
                raise ErrorSim("tipo_invalido", "«firma» debe ser texto hexadecimal.", 422, "firma")
            if trampa is not None:
                raise ErrorSim("tipo_invalido", "«trampa» no se puede combinar con «firma» propia.", 422, "trampa")
        if trampa is not None and trampa not in ("firma_alterada", "otra_clave"):
            raise ErrorSim("trampa_invalida", "La trampa debe ser «firma_alterada» u «otra_clave».", 422, "trampa")
        item = sim.crear_tx(emisor, receptor, monto, timestamp=ts, firma=firma, trampa=trampa)
        return exito(sim, 201, tx=item, pendientes_total=len(sim.pool))

    @app.post("/api/<modo>/tx/aleatorias")
    def tx_aleatorias(modo):
        sim = sim_de(modo)
        d = cuerpo(sim, {"cantidad"}, ("cantidad",))
        n = parse_entero(d["cantidad"], "cantidad", 1, 20, etiqueta="La cantidad")
        txs = sim.crear_tx_aleatorias(n)
        return exito(sim, 201, txs=txs, pendientes_total=len(sim.pool))

    @app.get("/api/<modo>/pendientes")
    def pendientes(modo):
        sim = sim_de(modo)
        return jsonify(ok=True, pendientes=list(sim.pool), total=len(sim.pool))

    # ---------------------------------------------------------------------- PoW
    @app.post("/api/pow/minar")
    def minar():
        sim = sim_de("pow")
        d = cuerpo(sim, {"ejecucion"})
        ej = d.get("ejecucion", "auto")
        if ej not in ("auto", "manual"):
            raise ErrorSim("tipo_invalido", "«ejecucion» debe ser «auto» o «manual».", 422, "ejecucion")
        t = sim.minar(ej)
        return exito(sim, 202 if ej == "auto" else 200, trabajo=t.resumen())

    @app.post("/api/pow/avanzar")
    def avanzar_pow():
        sim = sim_de("pow")
        d = cuerpo(sim, {"rondas"})
        n = parse_entero(d.get("rondas", 1), "rondas", 1, 1000, etiqueta="El número de rondas")
        return exito(sim, trabajo=sim.avanzar_pow(n).resumen())

    @app.post("/api/pow/cancelar")
    def cancelar_pow():
        sim = sim_de("pow")
        cuerpo(sim, set())
        return exito(sim, trabajo=sim.cancelar_trabajo().resumen())

    # ---------------------------------------------------------------------- PoS
    def lista_ids(sim, valor, campo):
        if not isinstance(valor, list) or len(valor) > len(sim.ids):
            raise ErrorSim("tipo_invalido", f"«{campo}» debe ser una lista de identificadores de nodo.", 422, campo)
        return [parse_id(v, campo, sim.ids) for v in valor]

    def dict_apuestas(sim, valor):
        if not isinstance(valor, dict):
            raise ErrorSim("tipo_invalido", "«apuestas» debe ser un objeto {nodo: monto}.", 422, "apuestas")
        return {parse_id(k, "apuestas", sim.ids): v for k, v in valor.items()}

    @app.post("/api/pos/ronda")
    def iniciar_ronda():
        sim = sim_de("pos")
        d = cuerpo(sim, {"modo", "validadores", "n_validadores", "apuestas"})
        modo_r = d.get("modo", "auto")
        if modo_r not in ("auto", "paso"):
            raise ErrorSim("tipo_invalido", "«modo» debe ser «auto» o «paso».", 422, "modo")
        vals = lista_ids(sim, d["validadores"], "validadores") if d.get("validadores") is not None else None
        nv = parse_entero(d["n_validadores"], "n_validadores", 1, len(sim.ids),
                          codigo_rango="n_validadores_invalido") if d.get("n_validadores") is not None else None
        ap = dict_apuestas(sim, d["apuestas"]) if d.get("apuestas") is not None else None
        r = sim.iniciar_ronda(modo_r, vals, nv, ap)
        return exito(sim, 201, ronda=r.publica(sim))

    @app.post("/api/pos/ronda/apuestas")
    def fijar_apuestas():
        sim = sim_de("pos")
        d = cuerpo(sim, {"apuestas"}, ("apuestas",))
        r = sim.fijar_apuestas(dict_apuestas(sim, d["apuestas"]))
        return exito(sim, ronda=r.publica(sim))

    @app.post("/api/pos/ronda/avanzar")
    def avanzar_ronda():
        sim = sim_de("pos")
        d = cuerpo(sim, {"fase_esperada"})
        fe = d.get("fase_esperada")
        if fe is not None and fe not in FASES:
            raise ErrorSim("tipo_invalido", f"«fase_esperada» debe ser una de: {', '.join(FASES)}.", 422,
                           "fase_esperada")
        r = sim.avanzar_ronda(fe)
        return exito(sim, ronda=r.publica(sim))

    @app.post("/api/pos/ronda/voto")
    def votar():
        sim = sim_de("pos")
        d = cuerpo(sim, {"votante", "voto"}, ("votante", "voto"))
        votante = parse_id(d["votante"], "votante", sim.ids)
        r = sim.votar(votante, parse_bool(d["voto"], "voto"))
        return exito(sim, ronda=r.publica(sim))

    @app.post("/api/pos/ronda/cancelar")
    def cancelar_ronda():
        sim = sim_de("pos")
        cuerpo(sim, set())
        r = sim.cancelar_ronda()
        return exito(sim, ronda=r.publica(sim))

    # -------------------------------------------------------------- laboratorio
    @app.post("/api/<modo>/laboratorio/ataque")
    def ataque(modo):
        sim = sim_de(modo)
        d = cuerpo(sim, {"destino", "tipo", "bloque"}, ("destino", "tipo"))
        destino = parse_id(d["destino"], "destino", sim.ids)
        if not isinstance(d["tipo"], str) or d["tipo"] not in TIPOS:
            raise ErrorSim("tipo_invalido", f"Tipo de ataque desconocido. Usa: {', '.join(TIPOS)}.", 422, "tipo")
        bloque = d.get("bloque")
        if bloque is not None and (isinstance(bloque, bool) or not isinstance(bloque, int)):
            raise ErrorSim("bloque_invalido", "«bloque» debe ser un número entero.", 422, "bloque")
        return exito(sim, ataque=sim.atacar(destino, d["tipo"], bloque))

    @app.post("/api/<modo>/laboratorio/corromper")
    def corromper(modo):
        sim = sim_de(modo)
        d = cuerpo(sim, {"nodo", "bloque", "tipo"}, ("nodo", "bloque", "tipo"))
        nid = parse_id(d["nodo"], "nodo", sim.ids)
        if not isinstance(d["tipo"], str) or d["tipo"] not in TIPOS_CORRUPCION:
            raise ErrorSim("tipo_invalido", f"Tipo desconocido. Usa: {', '.join(TIPOS_CORRUPCION)}.", 422, "tipo")
        b = d["bloque"]
        if isinstance(b, bool) or not isinstance(b, int):
            raise ErrorSim("bloque_invalido", "«bloque» debe ser un número entero.", 422, "bloque")
        res = sim.corromper_local(nid, b, d["tipo"])
        return exito(sim, **res)

    # --------------------------------------------------------------- bitácora etc.
    @app.get("/api/<modo>/bitacora")
    def bitacora(modo):
        sim = sim_de(modo)
        desde = qentero("desde_seq", 0, 10**12, 0)
        limite = qentero("limite", 1, 500, 200)
        nivel, tipo = request.args.get("nivel") or None, request.args.get("tipo") or None
        if nivel is not None and nivel not in NIVELES:
            raise ErrorSim("tipo_invalido", f"«nivel» debe ser uno de: {', '.join(NIVELES)}.", 422, "nivel")
        if tipo is not None and len(tipo) > 40:
            raise ErrorSim("tipo_invalido", "«tipo» es demasiado largo.", 422, "tipo")
        return jsonify(ok=True, entradas=sim.bitacora.desde(desde, nivel, tipo, limite), seq=sim.bitacora.seq)

    @app.get("/api/<modo>/invariantes")
    def invariantes(modo):
        return jsonify(ok=True, **sim_de(modo).invariantes())

    @app.post("/api/<modo>/autopiloto")
    def autopiloto(modo):
        sim = sim_de(modo)
        d = cuerpo(sim, {"bloques"}, ("bloques",))
        n = parse_entero(d["bloques"], "bloques", 1, 20, etiqueta="El número de bloques")
        return exito(sim, 202 if sim.modo == "pow" else 200, **sim.autopiloto(n))

    return app


if __name__ == "__main__":
    create_app().run(debug=False, use_reloader=False, threaded=True)
