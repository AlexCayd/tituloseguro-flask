"""Rutas JSON de los cinco esquemas criptográficos (/api/esquemas/…).

Igual que app.py: las rutas sólo reciben, validan con rigor y llaman al núcleo (nucleo/esquemas), que
se ejecuta y prueba sin Flask. Todas son SIN ESTADO: lo que la interfaz necesita entre un paso y otro
viaja en la propia petición, y el azar de los protocolos interactivos se deriva de un secreto del
servidor (app.config["SECRETO_ESQUEMAS"]) para que las claves privadas nunca salgan de aquí.

Los resultados «didácticos» (una firma que no verifica, un QR alterado, partes insuficientes) NO son
errores HTTP: llegan con ok=true y un veredicto, porque son justamente lo que la interfaz enseña.
"""
from flask import current_app, jsonify, request

from nucleo.entradas import exigir_campos, parse_semilla
from nucleo.errores import ErrorSim
from nucleo.esquemas import anillo, conocimiento_cero as zk, qr_shamir as qr, schnorr_juguete as sch, shamir
from nucleo.esquemas import secp256k1 as curva
from nucleo.esquemas import validar as V

CATALOGO = [
    {"id": "shamir", "titulo": "Partir un secreto en pedazos", "tecnico": "Esquema de Shamir (1979)",
     "documento": "esquemas/esquema_shamir.pdf",
     "rutas": ["POST /api/esquemas/shamir/repartir", "POST /api/esquemas/shamir/reconstruir",
               "POST /api/esquemas/shamir/juguete"]},
    {"id": "qr", "titulo": "Respaldo en códigos QR", "tecnico": "Shamir sobre GF(2^8) + QR · criptografía visual",
     "documento": "esquemas/qr_shamir.pdf",
     "rutas": ["POST /api/esquemas/qr/repartir", "POST /api/esquemas/qr/leer", "POST /api/esquemas/qr/alterar",
               "POST /api/esquemas/qr/boveda", "POST /api/esquemas/qr/boveda/abrir", "POST /api/esquemas/qr/visual"]},
    {"id": "zk", "titulo": "Demostrar sin revelar", "tecnico": "Conocimiento cero: protocolo Σ de Schnorr y GMW",
     "documento": "esquemas/pipeline_conocimiento_cero.pdf",
     "rutas": ["GET /api/esquemas/zk/coloreo", "POST /api/esquemas/zk/coloreo/compromiso",
               "POST /api/esquemas/zk/coloreo/abrir", "POST /api/esquemas/zk/coloreo/rondas",
               "POST /api/esquemas/zk/clave", "POST /api/esquemas/zk/compromiso", "POST /api/esquemas/zk/responder",
               "POST /api/esquemas/zk/extraer", "POST /api/esquemas/zk/simular", "POST /api/esquemas/zk/probar",
               "POST /api/esquemas/zk/verificar"]},
    {"id": "anillo", "titulo": "Firmar sin decir quién", "tecnico": "Firmas de anillo AOS y LSAG",
     "documento": "esquemas/firmas_anillo_pipeline.pdf",
     "rutas": ["POST /api/esquemas/anillo/firmar", "POST /api/esquemas/anillo/verificar",
               "POST /api/esquemas/anillo/urna"]},
    {"id": "schnorr", "titulo": "Una firma digital con números pequeños",
     "tecnico": "Schnorr en Z*23 y en una curva sobre F17 · MuSig", "documento": "esquemas/schnorr_juguete.pdf",
     "rutas": ["GET /api/esquemas/schnorr/tablas", "POST /api/esquemas/schnorr/firmar",
               "POST /api/esquemas/schnorr/verificar", "POST /api/esquemas/schnorr/nonce",
               "POST /api/esquemas/schnorr/multifirma", "POST /api/esquemas/schnorr/ataque"]},
]


def registrar(app, leer_json):
    """Añade las rutas /api/esquemas/… a la aplicación (recibe el lector de JSON estricto de app.py)."""

    def cuerpo(permitidos, requeridos=()):
        datos = leer_json()
        exigir_campos(datos, set(permitidos), requeridos)
        return datos

    def secreto():
        return current_app.config["SECRETO_ESQUEMAS"]

    def ok(resultado, status=200):
        resp = jsonify(ok=True, **resultado)
        resp.status_code = status
        return resp

    def dominio(fn, *args, codigo="parametros_invalidos", campo=None, **kw):
        """Llama al núcleo; un ValueError del núcleo es un rechazo explicado (422), nunca un 500."""
        try:
            return fn(*args, **kw)
        except ValueError as e:
            msg = str(e)
            raise ErrorSim(codigo, msg[:1].upper() + msg[1:] + ("" if msg.endswith(".") else "."), 422, campo) from None

    # ------------------------------------------------------------------ catálogo
    @app.get("/api/esquemas")
    def esquemas_catalogo():
        return jsonify(ok=True, esquemas=CATALOGO)

    # ================================================================ 1 · Shamir
    @app.post("/api/esquemas/shamir/repartir")
    def shamir_repartir():
        d = cuerpo({"secreto", "k", "n"}, ("secreto", "k", "n"))
        s = V.texto(d["secreto"], "secreto", shamir.MAX_BYTES_TEXTO, etiqueta="El secreto")
        n = V.entero(d["n"], "n", 2, shamir.N_MAX, "El número de partes")
        k = V.entero(d["k"], "k", 2, n, "El umbral (partes necesarias)")
        return ok(dominio(shamir.demo_repartir, s, k, n))

    @app.post("/api/esquemas/shamir/reconstruir")
    def shamir_reconstruir():
        d = cuerpo({"partes", "k", "huella"}, ("partes", "k"))
        k = V.entero(d["k"], "k", 2, shamir.N_MAX, "El umbral")
        partes = []
        for p in V.lista(d["partes"], "partes", 1, shamir.N_MAX):
            V.objeto(p, "partes", {"x", "y"}, ("x", "y"))
            x = V.entero(p["x"], "partes", 1, shamir.N_MAX, "El número de cada parte")
            y = p["y"]
            if not (isinstance(y, str) and len(y) == shamir.HEX_PARTE
                    and all(c in "0123456789abcdef" for c in y)) or int(y, 16) >= shamir.P_TEXTO:
                raise ErrorSim("hex_invalido", f"El valor de la parte {x} no es un número válido módulo 2^521 − 1 "
                                               f"({shamir.HEX_PARTE} caracteres hexadecimales).", 422, "partes")
            partes.append((x, int(y, 16)))
        huella = d.get("huella")
        if huella is not None and not (isinstance(huella, str) and len(huella) == 16
                                       and all(c in "0123456789abcdef" for c in huella)):
            raise ErrorSim("hex_invalido", "«huella» debe tener 16 caracteres hexadecimales.", 422, "huella")
        return ok(dominio(shamir.demo_reconstruir, partes, k, huella, codigo="partes_invalidas", campo="partes"))

    @app.post("/api/esquemas/shamir/juguete")
    def shamir_juguete():
        d = cuerpo({"secreto", "a1", "a2", "elegidas"})
        s = V.entero(d.get("secreto", 13), "secreto", 0, 30, "El secreto")
        a1 = V.entero(d.get("a1", 7), "a1", 0, 30, "El coeficiente a1")
        a2 = V.entero(d.get("a2", 4), "a2", 0, 30, "El coeficiente a2")
        elegidas = [V.entero(x, "elegidas", 1, 5, "Cada parte elegida")
                    for x in V.lista(d.get("elegidas", [1, 2, 3]), "elegidas", 1, 5)]
        return ok(dominio(shamir.ejemplo_juguete, s, (a1, a2), tuple(elegidas), campo="elegidas"))

    # =============================================================== 2 · Anillo
    def _anillo_comun(d):
        semilla = parse_semilla(d["semilla"])
        ids = V.instituciones(d["anillo"], "anillo", anillo.N_MIN, anillo.N_MAX)
        mensaje = V.texto(d["mensaje"], "mensaje", 280, etiqueta="El mensaje")
        return semilla, ids, mensaje

    @app.post("/api/esquemas/anillo/firmar")
    def anillo_firmar():
        d = cuerpo({"semilla", "anillo", "firmante", "mensaje", "variante"},
                   ("semilla", "anillo", "firmante", "mensaje", "variante"))
        semilla, ids, mensaje = _anillo_comun(d)
        firmante = V.institucion(d["firmante"], "firmante")
        if firmante not in ids:
            raise ErrorSim("firmante_fuera", "Quien firma tiene que estar dentro del grupo (anillo).", 422, "firmante")
        variante = V.opcion(d["variante"], "variante", anillo.VARIANTES, "La variante")
        return ok(anillo.demo_firmar(secreto(), semilla, ids, firmante, mensaje, variante))

    @app.post("/api/esquemas/anillo/verificar")
    def anillo_verificar():
        d = cuerpo({"semilla", "anillo", "mensaje", "firma"}, ("semilla", "anillo", "mensaje", "firma"))
        semilla, ids, mensaje = _anillo_comun(d)
        return ok(dominio(anillo.demo_verificar, secreto(), semilla, ids, mensaje, d["firma"],
                          codigo="firma_mal_formada", campo="firma"))

    @app.post("/api/esquemas/anillo/urna")
    def anillo_urna():
        d = cuerpo({"semilla", "anillo", "mensaje", "firma", "imagenes_previas"},
                   ("semilla", "anillo", "mensaje", "firma"))
        semilla, ids, mensaje = _anillo_comun(d)
        previas = [V.punto(i, "imagenes_previas") for i in V.lista(d.get("imagenes_previas", []), "imagenes_previas", 0, 50)]
        return ok(dominio(anillo.demo_urna, secreto(), semilla, ids, mensaje, d["firma"], previas,
                          codigo="firma_mal_formada", campo="firma"))

    # ======================================================= 3 · Conocimiento cero
    def _zk_comun(d):
        return parse_semilla(d["semilla"]), V.institucion(d["institucion"], "institucion")

    @app.post("/api/esquemas/zk/clave")
    def zk_clave():
        d = cuerpo({"semilla", "institucion"}, ("semilla", "institucion"))
        return ok(zk.demo_clave(secreto(), *_zk_comun(d)))

    @app.post("/api/esquemas/zk/compromiso")
    def zk_compromiso():
        d = cuerpo({"semilla", "institucion", "ronda"}, ("semilla", "institucion", "ronda"))
        return ok(zk.demo_compromiso(secreto(), *_zk_comun(d), V.token(d["ronda"], "ronda")))

    @app.post("/api/esquemas/zk/responder")
    def zk_responder():
        d = cuerpo({"semilla", "institucion", "ronda", "reto", "impostor"}, ("semilla", "institucion", "ronda", "reto"))
        semilla, ident = _zk_comun(d)
        ronda = V.token(d["ronda"], "ronda")
        c = dominio(curva.escalar_de_hex, V.hex64(d["reto"], "reto", "El reto"), codigo="hex_invalido", campo="reto")
        impostor = V.booleano(d.get("impostor", False), "impostor")
        return ok(zk.demo_responder(secreto(), semilla, ident, ronda, c, impostor))

    @app.post("/api/esquemas/zk/extraer")
    def zk_extraer():
        d = cuerpo({"semilla", "institucion", "transcripciones"}, ("semilla", "institucion", "transcripciones"))
        semilla, ident = _zk_comun(d)
        ts = []
        for t in V.lista(d["transcripciones"], "transcripciones", 2, 2):
            V.objeto(t, "transcripciones", {"c", "s"}, ("c", "s"))
            ts.append({k: dominio(curva.escalar_de_hex, V.hex64(t[k], "transcripciones"), codigo="hex_invalido",
                                  campo="transcripciones") for k in ("c", "s")})
        return ok(dominio(zk.demo_extraer, secreto(), semilla, ident, ts[0], ts[1], codigo="retos_iguales",
                          campo="transcripciones"))

    @app.post("/api/esquemas/zk/simular")
    def zk_simular():
        d = cuerpo({"semilla", "institucion"}, ("semilla", "institucion"))
        return ok(zk.demo_simular(secreto(), *_zk_comun(d)))

    @app.post("/api/esquemas/zk/probar")
    def zk_probar():
        d = cuerpo({"semilla", "institucion", "mensaje"}, ("semilla", "institucion", "mensaje"))
        semilla, ident = _zk_comun(d)
        return ok(zk.demo_probar_ni(secreto(), semilla, ident, V.texto(d["mensaje"], "mensaje", 280, etiqueta="El mensaje")))

    @app.post("/api/esquemas/zk/verificar")
    def zk_verificar():
        d = cuerpo({"Y", "mensaje", "T", "s"}, ("Y", "mensaje", "T", "s"))
        mensaje = V.texto(d["mensaje"], "mensaje", 280, etiqueta="El mensaje")
        Y = dominio(curva.descomprimir, V.punto(d["Y"], "Y"), codigo="punto_invalido", campo="Y")
        T = dominio(curva.descomprimir, V.punto(d["T"], "T"), codigo="punto_invalido", campo="T")
        s = dominio(curva.escalar_de_hex, V.hex64(d["s"], "s"), codigo="hex_invalido", campo="s")
        return ok(zk.demo_verificar_ni(Y, mensaje, T, s))

    @app.get("/api/esquemas/zk/coloreo")
    def zk_grafo():
        return ok(zk.demo_grafo())

    def _coloreo_comun(d):
        return V.token(d["ronda"], "ronda"), V.booleano(d.get("tramposa", False), "tramposa")

    @app.post("/api/esquemas/zk/coloreo/compromiso")
    def zk_coloreo_compromiso():
        d = cuerpo({"ronda", "tramposa"}, ("ronda",))
        return ok(zk.demo_compromiso_coloreo(secreto(), *_coloreo_comun(d)))

    @app.post("/api/esquemas/zk/coloreo/abrir")
    def zk_coloreo_abrir():
        d = cuerpo({"ronda", "tramposa", "arista"}, ("ronda", "arista"))
        ronda, tramposa = _coloreo_comun(d)
        a = V.lista(d["arista"], "arista", 2, 2)
        u, v = (V.entero(x, "arista", 0, len(zk.VERTICES) - 1, "Cada extremo de la arista") for x in a)
        return ok(dominio(zk.demo_abrir_coloreo, secreto(), ronda, tramposa, (u, v), codigo="arista_invalida",
                          campo="arista"))

    @app.post("/api/esquemas/zk/coloreo/rondas")
    def zk_coloreo_rondas():
        d = cuerpo({"ronda", "tramposa", "k"}, ("ronda", "k"))
        ronda, tramposa = _coloreo_comun(d)
        k = V.entero(d["k"], "k", 1, 500, "El número de rondas")
        return ok(zk.demo_rondas_coloreo(secreto(), ronda, tramposa, k))

    # ===================================================================== 4 · QR
    def _k_n(d, n_max=9):
        n = V.entero(d["n"], "n", 2, n_max, "El número de partes")
        k = V.entero(d["k"], "k", 2, n, "El umbral (partes necesarias)")
        return k, n

    @app.post("/api/esquemas/qr/repartir")
    def qr_repartir():
        d = cuerpo({"secreto", "k", "n", "nivel"}, ("secreto", "k", "n"))
        s = V.texto(d["secreto"], "secreto", qr.MAX_SECRETO, etiqueta="El secreto")
        k, n = _k_n(d)
        nivel = V.opcion(d.get("nivel", "H"), "nivel", qr.NIVELES, "El nivel de corrección")
        return ok(dominio(qr.demo_repartir, s, k, n, nivel))

    def _textos(valor, campo="textos"):
        return [V.texto(t, campo, 600, etiqueta="Cada parte") for t in V.lista(valor, campo, 1, 9)]

    @app.post("/api/esquemas/qr/leer")
    def qr_leer():
        d = cuerpo({"textos"}, ("textos",))
        return ok(qr.demo_leer(_textos(d["textos"])))

    @app.post("/api/esquemas/qr/alterar")
    def qr_alterar():
        d = cuerpo({"texto", "modo"}, ("texto", "modo"))
        t = V.texto(d["texto"], "texto", 600, etiqueta="La parte")
        modo = V.opcion(d["modo"], "modo", ("mancha", "trampa"), "El modo")
        nuevo = dominio(qr.alterar_parte, t, modo, codigo="parte_invalida", campo="texto")
        return ok({"esquema": "qr", "modo": modo, "texto": nuevo})

    @app.post("/api/esquemas/qr/boveda")
    def qr_boveda():
        d = cuerpo({"documento", "k", "n"}, ("documento", "k", "n"))
        doc = V.texto(d["documento"], "documento", qr.MAX_DOCUMENTO, multilinea=True, etiqueta="El documento")
        k, n = _k_n(d, 7)
        return ok(dominio(qr.demo_boveda, doc, k, n))

    @app.post("/api/esquemas/qr/boveda/abrir")
    def qr_boveda_abrir():
        d = cuerpo({"boveda", "textos"}, ("boveda", "textos"))
        boveda = V.texto(d["boveda"], "boveda", 2100, etiqueta="El QR de bóveda")
        return ok(qr.demo_abrir_boveda(boveda, _textos(d["textos"])))

    @app.post("/api/esquemas/qr/visual")
    def qr_visual():
        d = cuerpo({"texto", "tipo", "sombras"}, ("texto", "tipo"))
        t = V.texto(d["texto"], "texto", 120, etiqueta="El texto del QR secreto")
        tipo = V.opcion(d["tipo"], "tipo", ("xor", "naor_shamir"), "El tipo")
        n = V.entero(d.get("sombras", 3), "sombras", 2, 4, "El número de sombras")
        return ok(dominio(qr.demo_visual, t, tipo, n))

    # ============================================================== 5 · Schnorr
    def _grupo(valor):
        return V.opcion(valor, "grupo", sch.GRUPOS, "El grupo")

    def _q(grupo):
        return sch.grupo(grupo).q

    @app.get("/api/esquemas/schnorr/tablas")
    def schnorr_tablas():
        return ok(sch.tablas(_grupo(request.args.get("grupo", "zp"))))

    @app.post("/api/esquemas/schnorr/firmar")
    def schnorr_firmar():
        d = cuerpo({"grupo", "x", "k", "M"}, ("grupo", "x", "k", "M"))
        g = _grupo(d["grupo"])
        q = _q(g)
        return ok(sch.firmar(g, V.entero(d["x"], "x", 1, q - 1, "La clave privada x"),
                             V.entero(d["k"], "k", 1, q - 1, "El número al azar k"),
                             V.entero(d["M"], "M", 0, sch.M_MAX, "El mensaje M")))

    @app.post("/api/esquemas/schnorr/verificar")
    def schnorr_verificar():
        d = cuerpo({"grupo", "y", "M", "s", "e"}, ("grupo", "y", "M", "s", "e"))
        g = _grupo(d["grupo"])
        q = _q(g)
        y = d["y"]
        if g == "zp":
            y = V.entero(y, "y", 1, 22, "La clave pública y")
        else:
            y = [V.entero(v, "y", 0, 16, "Cada coordenada de la clave pública") for v in V.lista(y, "y", 2, 2)]
        return ok(dominio(sch.verificar, g, y, V.entero(d["M"], "M", 0, sch.M_MAX, "El mensaje M"),
                          V.entero(d["s"], "s", 0, q - 1, "s"), V.entero(d["e"], "e", 0, q - 1, "e"),
                          codigo="clave_invalida", campo="y"))

    @app.post("/api/esquemas/schnorr/nonce")
    def schnorr_nonce():
        d = cuerpo({"grupo", "x", "k", "M1", "M2"}, ("grupo", "x", "k", "M1", "M2"))
        g = _grupo(d["grupo"])
        q = _q(g)
        return ok(sch.nonce_repetido(g, V.entero(d["x"], "x", 1, q - 1, "La clave privada x"),
                                     V.entero(d["k"], "k", 1, q - 1, "El número al azar k"),
                                     V.entero(d["M1"], "M1", 0, sch.M_MAX, "El primer mensaje"),
                                     V.entero(d["M2"], "M2", 0, sch.M_MAX, "El segundo mensaje")))

    @app.post("/api/esquemas/schnorr/multifirma")
    def schnorr_multifirma():
        d = cuerpo({"grupo", "x1", "x2", "k1", "k2", "M"}, ("grupo", "x1", "x2", "k1", "k2", "M"))
        g = _grupo(d["grupo"])
        q = _q(g)
        v = {c: V.entero(d[c], c, 1, q - 1, f"«{c}»") for c in ("x1", "x2", "k1", "k2")}
        return ok(dominio(sch.multifirma, g, v["x1"], v["x2"], v["k1"], v["k2"],
                          V.entero(d["M"], "M", 0, sch.M_MAX, "El mensaje M"), codigo="caso_degenerado"))

    @app.post("/api/esquemas/schnorr/ataque")
    def schnorr_ataque():
        d = cuerpo({"x1", "x_estrella"})
        return ok(sch.ataque_clave_maliciosa(V.entero(d.get("x1", 6), "x1", 1, 10, "«x1»"),
                                             V.entero(d.get("x_estrella", 3), "x_estrella", 1, 10, "«x_estrella»")))
