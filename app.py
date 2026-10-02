"""Título Seguro · simulador de Proof of Work para registro académico (Flask).

Ejecutar:  python app.py   (usa use_reloader=False: el recargador duplicaría el estado global)
"""
import hmac
import io
import os
import re
import secrets
import time
from datetime import date
from functools import wraps
from types import SimpleNamespace
from urllib.parse import urlparse

import segno
from dotenv import load_dotenv
from flask import (
    Flask, abort, flash, g, jsonify, redirect, render_template, request, session, url_for,
)
from sqlalchemy import select

import reglas
import seed
from bench import RONDAS_POR_DEFECTO, Cronometro
from blockchain import DIFICULTADES_PERMITIDAS, NODOS, RECOMPENSA, Billetera, alterar_copia, validar_bloques
from models import ROLES, IssuerKey, User, crear_motor, crear_sesiones
from red import ErrorRed, Red
from seguridad import Secretos, hash_password, verificar_password

load_dotenv()

DEV_SECRET = "dev-only-no-usar-en-produccion"
RE_USUARIO = re.compile(r"^[a-z0-9_.-]{3,30}$")
LAB_TIPOS = ("contenido", "hash", "firma", "contenido_recalculado")


def create_app(config=None):
    config = config or {}
    app = Flask(__name__)
    produccion = os.environ.get("TS_ENV") == "production"
    secret = config.get("SECRET_KEY") or os.environ.get("SECRET_KEY")
    if not secret:
        if produccion:
            raise RuntimeError("Define SECRET_KEY en producción.")
        secret = DEV_SECRET
        print("AVISO: usando SECRET_KEY de desarrollo. Define SECRET_KEY en .env para uso real.")
    app.config.update(
        SECRET_KEY=secret,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=produccion,
        MAX_CONTENT_LENGTH=64 * 1024,
        TESTING=bool(config.get("TESTING")),
    )

    motor = crear_motor(config.get("DATABASE_URL"))
    Session = crear_sesiones(motor)
    secretos = Secretos(secret)
    demo = seed.demo_activo() if config.get("SEED_DEMO") is None else config["SEED_DEMO"]
    seed.sembrar(Session, secretos, demo=demo, n_pendientes=config.get("N_PENDIENTES"))
    with Session() as s:
        k = s.scalars(select(IssuerKey)).first()
    if k:
        try:
            secretos.descifrar(k.priv_cifrada)
        except Exception:
            raise RuntimeError(
                "SECRET_KEY no coincide con la que se usó al crear esta base de datos, así que no se "
                "pueden descifrar las llaves de las universidades. Restaura la SECRET_KEY original "
                "(o borra la base para empezar de cero).") from None
    red = Red(Session, secretos)
    red.cronometro = Cronometro()
    ts = SimpleNamespace(red=red, Session=Session, secretos=secretos, demo=demo, intentos={})
    app.extensions["ts"] = ts
    hash_falso = hash_password("contraseña-que-nadie-usa")

    # ------------------------------------------------------------------ utilidades
    def quiere_json():
        return (request.is_json or request.headers.get("X-Requested-With") == "fetch"
                or request.path.startswith("/api/") or request.path == "/estado")

    def datos():
        return request.get_json(silent=True) or request.form

    def error(mensaje, codigo=400, destino=None):
        if quiere_json():
            return jsonify(ok=False, error=mensaje), codigo
        flash(mensaje, "error")
        return redirect(destino or request.referrer or url_for("index")), 303

    def ok(destino, **extra):
        if quiere_json():
            return jsonify(ok=True, **extra)
        if extra.get("mensaje"):
            flash(extra["mensaje"], "ok")
        return redirect(destino), 303

    def requiere(*roles):
        def deco(f):
            @wraps(f)
            def envuelto(*a, **k):
                if not g.user:
                    if quiere_json():
                        return jsonify(ok=False, error="Inicia sesión para continuar."), 401
                    return redirect(url_for("login", siguiente=request.full_path.rstrip("?")))
                if roles and g.user.rol not in roles:
                    if quiere_json():
                        return jsonify(ok=False, error="Tu rol no tiene permiso para esto."), 403
                    return render_template("error.html", codigo=403,
                                           mensaje="Tu rol no tiene permiso para entrar aquí."), 403
                return f(*a, **k)
            return envuelto
        return deco

    def ruta_segura(destino, por_defecto=None):
        """Solo rutas internas: evita que ?siguiente= sirva de redirección abierta."""
        p = urlparse(destino or "")
        return destino if destino and not p.netloc and not p.scheme and destino.startswith("/") \
            and not destino.startswith("//") else (por_defecto or url_for("index"))

    # ------------------------------------------------------------------ ciclo de la petición
    @app.before_request
    def antes():
        g.nonce = secrets.token_urlsafe(16)
        g.user = None
        uid = session.get("uid")
        if uid:
            with Session() as s:
                g.user = s.get(User, uid)
            if not g.user:
                session.pop("uid", None)
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(24)
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            enviado = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token") or ""
            if not hmac.compare_digest(enviado, session["csrf"]):
                return error("La sesión expiró o el formulario no es válido. Recarga la página.", 400)

    @app.after_request
    def despues(resp):
        n = getattr(g, "nonce", "")
        resp.headers["Content-Security-Policy"] = (
            f"default-src 'self'; script-src 'self' 'nonce-{n}' https://cdnjs.cloudflare.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        if request.path in ("/estado",) or request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.context_processor
    def contexto():
        return dict(
            usuario=g.get("user"), csrf_token=session.get("csrf", ""), csp_nonce=g.get("nonce", ""),
            demo_login=ts.demo, NODOS=NODOS, RECOMPENSA=RECOMPENSA, TIPOS=reglas.TIPOS,
            DIFICULTADES=DIFICULTADES_PERMITIDAS, dificultad_actual=red.dificultad,
        )

    @app.template_filter("hexcorto")
    def hexcorto(s, n=8):
        s = str(s or "")
        return s if len(s) <= 2 * n + 1 else f"{s[:n]}…{s[-n:]}"

    @app.template_filter("miles")
    def miles(n):
        try:
            return f"{int(n):,}"
        except (TypeError, ValueError):
            return n

    @app.errorhandler(ErrorRed)
    def _error_red(e):
        return error(str(e), e.codigo)

    @app.errorhandler(404)
    def _404(_):
        if quiere_json():
            return jsonify(ok=False, error="No encontrado."), 404
        return render_template("error.html", codigo=404, mensaje="No encontramos esa página."), 404

    @app.errorhandler(413)
    def _413(_):
        return error("La petición es demasiado grande.", 413)

    # ------------------------------------------------------------------ vistas de datos
    def resumen(b):
        tx, c = b["transaccion"], b["transaccion"]["contenido"]
        r = {k: b[k] for k in ("numero", "hash", "hash_anterior", "nonce", "minero", "recompensa",
                               "dificultad", "timestamp", "firma")}
        r.update(proposito=tx["proposito"], remitente=tx["remitente"])
        if tx["proposito"] == reglas.PROPOSITO_REGISTRO:
            r.update(folio=c["folio"], tipo=c["tipo"], universidad=c["universidad"],
                     programa=c["programa"], fecha_emision=c["fecha_emision"])
        elif tx["proposito"] == reglas.PROPOSITO_REVOCACION:
            r.update(folio=c["folio_revocado"], motivo=c["motivo"])
        else:
            r.update(folio=None, mensaje=c.get("mensaje"))
        return r

    app.jinja_env.globals["resumen"] = resumen

    def pagina_bloques(desde=None, limite=20):
        bs = red.cadena.bloques
        fin = len(bs) if desde is None else min(desde + 1, len(bs))
        ini = max(0, fin - limite)
        return [b for b in reversed(bs[ini:fin])]

    # ------------------------------------------------------------------ páginas
    @app.get("/")
    def index():
        return render_template("index.html", estado=red.estado(), bloques=pagina_bloques(limite=6),
                               validacion=red.validacion(), ranking=red.ranking(),
                               universidades=red.universidades(), cola=red.cola(5))

    @app.get("/emitir")
    @requiere("UNIVERSITY", "ADMIN")
    def emitir():
        uni = next((u for u in red.universidades() if u["codigo"] == g.user.universidad_codigo), None)
        return render_template("emitir.html", programas=seed.PROGRAMAS, cola=red.cola(15),
                               rechazadas=red.rechazadas(), hoy=date.today().isoformat(), universidad=uni,
                               pendientes=red.contar_cola(), estado=red.estado())

    @app.get("/mineria")
    @requiere("MINER", "ADMIN")
    def mineria():
        return render_template("mineria.html", estado=red.estado(), cola=red.cola(6),
                               ranking=red.ranking(), validacion=red.validacion())

    @app.get("/explorador")
    def explorador():
        desde = request.args.get("hasta", type=int)
        bloques = pagina_bloques(desde, 20)
        sig = bloques[-1]["numero"] - 1 if bloques and bloques[-1]["numero"] > 0 else None
        return render_template("explorador.html", bloques=bloques, siguiente=sig,
                               validacion=red.validacion(), ranking=red.ranking(), estado=red.estado())

    @app.get("/laboratorio")
    def laboratorio():
        return render_template("laboratorio.html", bloques=list(reversed(red.cadena.bloques)),
                               validacion=red.validacion(), tipos=LAB_TIPOS)

    @app.get("/verificar")
    def verificar():
        folio = reglas.normalizar_folio(request.args.get("folio"))
        if folio:
            return redirect(url_for("verificar_folio", folio=folio))
        return render_template("verificar.html", resultado=None, folio="")

    @app.get("/verificar/<folio>")
    def verificar_folio(folio):
        folio = reglas.normalizar_folio(folio)
        if not reglas.RE_FOLIO.match(folio):
            return render_template("verificar.html", resultado=None, folio=folio,
                                   mensaje="Ese folio no tiene el formato correcto (TS-UNI-0123456789AB)."), 400
        return render_template("verificar.html", resultado=red.verificar(folio), folio=folio)

    @app.get("/qr/<folio>.svg")
    def qr(folio):
        folio = reglas.normalizar_folio(folio)
        if not reglas.RE_FOLIO.match(folio):
            abort(404)
        buf = io.BytesIO()
        segno.make(url_for("verificar_folio", folio=folio, _external=True), error="m").save(
            buf, kind="svg", scale=8, border=2, dark="#1f3d33", light=None, xmldecl=False, nl=False)
        return buf.getvalue(), 200, {"Content-Type": "image/svg+xml; charset=utf-8",
                                     "Cache-Control": "public, max-age=3600"}

    @app.get("/mi-cuenta")
    @requiere("STUDENT")
    def mi_cuenta():
        creds = red.credenciales_de(g.user.matricula_hmac) if g.user.matricula_hmac else []
        return render_template("mi_cuenta.html", credenciales=creds, estado=red.estado())

    @app.get("/cronometro")
    @requiere("ADMIN")
    def cronometro():
        return render_template("cronometro.html", plan=RONDAS_POR_DEFECTO, estado=red.cronometro.estado)

    @app.get("/admin")
    @requiere("ADMIN")
    def admin():
        with Session() as s:
            usuarios = s.scalars(select(User).order_by(User.id)).all()
        return render_template("admin.html", usuarios=usuarios, roles=ROLES,
                               universidades=red.universidades(), estado=red.estado())

    # ------------------------------------------------------------------ acceso
    def fallos_recientes(clave):
        ahora = time.monotonic()
        ts.intentos[clave] = [t for t in ts.intentos.get(clave, []) if ahora - t < 300]
        return len(ts.intentos[clave])

    @app.route("/login", methods=["GET", "POST"])
    def login():
        siguiente = ruta_segura(request.values.get("siguiente"))
        if request.method == "GET":
            cuentas = [dict(username=u, nombre=n, rol=r) for u, n, r, _, _ in seed.USUARIOS_DEMO] if ts.demo else []
            return render_template("login.html", siguiente=siguiente, cuentas=cuentas)
        d = datos()
        username = str(d.get("username", "")).strip().lower()
        clave = (request.remote_addr, username)
        if fallos_recientes(clave) >= 5:
            return error("Demasiados intentos. Espera unos minutos.", 429, url_for("login"))
        with Session() as s:
            u = s.scalars(select(User).where(User.username == username)).first()
        # se verifica siempre un hash real, exista o no el usuario, para no revelar cuentas por tiempo
        correcta = verificar_password(str(d.get("password", "")), u.password_hash if u else hash_falso)
        if not (correcta and u):
            ts.intentos.setdefault(clave, []).append(time.monotonic())
            return error("Usuario o contraseña incorrectos.", 401, url_for("login"))
        session.clear()
        session["uid"], session["csrf"] = u.id, secrets.token_urlsafe(24)
        return ok(siguiente, mensaje=f"Hola, {u.nombre}.", rol=u.rol)

    @app.post("/login/demo/<username>")
    def login_demo(username):
        if not ts.demo:
            abort(404)
        with Session() as s:
            u = s.scalars(select(User).where(User.username == username)).first()
        if not u:
            abort(404)
        session.clear()
        session["uid"], session["csrf"] = u.id, secrets.token_urlsafe(24)
        return ok(ruta_segura(request.values.get("siguiente")), mensaje=f"Entraste como {u.nombre}.", rol=u.rol)

    @app.post("/logout")
    def logout():
        session.clear()
        return ok(url_for("index"), mensaje="Cerraste sesión.")

    # ------------------------------------------------------------------ rutas de la guía
    @app.post("/transaccion")
    @requiere("UNIVERSITY", "ADMIN")
    def transaccion():
        d = datos()
        r = red.emitir_registro(g.user, d.get("matricula"), d.get("programa"), d.get("tipo"),
                                d.get("fecha_emision") or date.today().isoformat())
        return ok(url_for("emitir"), mensaje=f"Credencial {r['folio']} firmada y en cola de minería.",
                  folio=r["folio"], firma=r["firma"], remitente=r["tx"]["remitente"])

    @app.post("/revocar")
    @requiere("UNIVERSITY", "ADMIN")
    def revocar():
        d = datos()
        r = red.emitir_revocacion(g.user, d.get("folio"), d.get("motivo"))
        return ok(url_for("emitir"), mensaje=f"La revocación de {r['folio']} quedó firmada y en cola.",
                  folio=r["folio"])

    @app.post("/minar")
    @requiere("MINER", "ADMIN")
    def minar():
        info = red.iniciar_ronda()
        destino = ruta_segura(request.values.get("siguiente"), url_for("mineria"))
        return ok(destino, mensaje=f"Comenzó la carrera por el bloque #{info['numero']}.", **info)

    @app.get("/estado")
    def estado():
        return jsonify(red.estado())

    # ------------------------------------------------------------------ API pública (solo lectura)
    @app.get("/api/cadena")
    def api_cadena():
        desde = request.args.get("hasta", type=int)
        limite = min(request.args.get("limite", 20, type=int), 100)
        v = red.validacion()
        return jsonify(longitud=len(red.cadena.bloques), valida=v["valida"], problemas=v["problemas"],
                       bloques=pagina_bloques(desde, limite))

    @app.get("/api/bloque/<int:n>")
    def api_bloque(n):
        if not 0 <= n < len(red.cadena.bloques):
            return jsonify(ok=False, error="Ese bloque no existe."), 404
        return jsonify(red.cadena.bloques[n])

    @app.get("/api/ranking")
    def api_ranking():
        return jsonify(red.ranking())

    @app.get("/api/verificar/<folio>")
    def api_verificar(folio):
        folio = reglas.normalizar_folio(folio)
        if not reglas.RE_FOLIO.match(folio):
            return jsonify(ok=False, error="Formato de folio inválido."), 400
        return jsonify(red.verificar(folio))

    @app.post("/api/laboratorio")
    def api_laboratorio():
        d = datos()
        try:
            numero = int(d.get("bloque"))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="Elige un bloque."), 400
        tipo = d.get("tipo")
        if tipo not in LAB_TIPOS:
            return jsonify(ok=False, error="Tipo de alteración desconocido."), 400
        if not 1 <= numero < len(red.cadena.bloques):
            return jsonify(ok=False, error="Elige un bloque minado (el génesis no se altera)."), 400
        copia, desc = alterar_copia(red.cadena.bloques, numero, tipo)
        v = validar_bloques(copia, reglas.validar_estructura)
        return jsonify(ok=True, alteracion=desc, bloque=numero, tipo=tipo, copia_valida=v["valida"],
                       problemas=v["problemas"], bloques=v["bloques"], original_valida=red.validacion()["valida"])

    # ------------------------------------------------------------------ cronómetro (ADMIN)
    @app.post("/api/cronometro/iniciar")
    @requiere("ADMIN")
    def cronometro_iniciar():
        if red.ronda and red.ronda.activa:
            return jsonify(ok=False, error="Hay una carrera real en curso; espera a que termine."), 409
        d = datos() if request.is_json else {}
        try:
            iniciado = red.cronometro.iniciar(d.get("rondas") if d else None)
        except (ValueError, TypeError, AttributeError) as e:
            return jsonify(ok=False, error=str(e)), 400
        if not iniciado:
            return jsonify(ok=False, error="Ya hay una medición en curso."), 409
        return jsonify(ok=True)

    @app.post("/api/cronometro/cancelar")
    @requiere("ADMIN")
    def cronometro_cancelar():
        red.cronometro.cancelar()
        return jsonify(ok=True)

    @app.get("/api/cronometro/estado")
    @requiere("ADMIN")
    def cronometro_estado():
        return jsonify(red.cronometro.estado)

    # ------------------------------------------------------------------ administración
    @app.post("/admin/dificultad")
    @requiere("ADMIN")
    def admin_dificultad():
        try:
            red.fijar_dificultad(int(datos().get("dificultad")))
        except (TypeError, ValueError):
            return error("Elige una dificultad válida.")
        return ok(url_for("admin"), mensaje="Dificultad actualizada. Los bloques ya minados conservan la suya.")

    @app.post("/admin/usuarios")
    @requiere("ADMIN")
    def admin_usuarios():
        d = datos()
        username = str(d.get("username", "")).strip().lower()
        rol, nombre = d.get("rol"), str(d.get("nombre", "")).strip()
        password = str(d.get("password", ""))
        if not RE_USUARIO.match(username):
            return error("El usuario debe tener 3–30 caracteres: minúsculas, números, punto, guion.", 422, url_for("admin"))
        if rol not in ROLES or not 2 <= len(nombre) <= 80:
            return error("Elige un rol y escribe un nombre de 2 a 80 caracteres.", 422, url_for("admin"))
        if len(password) < 8:
            return error("La contraseña debe tener al menos 8 caracteres.", 422, url_for("admin"))
        codigo = (str(d.get("universidad_codigo") or "").strip().upper() or None)
        matricula = str(d.get("matricula") or "").strip() or None
        if rol == "UNIVERSITY" and codigo not in {u["codigo"] for u in red.universidades()}:
            return error("Elige una universidad registrada para este usuario.", 422, url_for("admin"))
        if rol == "ADMIN":
            codigo = "ADM"
        if rol not in ("UNIVERSITY", "ADMIN"):
            codigo = None
        if rol == "STUDENT" and not matricula:
            return error("Un alumno necesita su matrícula.", 422, url_for("admin"))
        try:
            ph = hash_password(password)
        except ValueError as e:
            return error(str(e), 422, url_for("admin"))
        with Session() as s:
            if s.scalars(select(User).where(User.username == username)).first():
                return error("Ese usuario ya existe.", 409, url_for("admin"))
            s.add(User(username=username, nombre=nombre, rol=rol, universidad_codigo=codigo,
                       password_hash=ph,
                       matricula_hmac=secretos.alumno_id(matricula) if rol == "STUDENT" else None))
            s.commit()
        return ok(url_for("admin"), mensaje=f"Cuenta '{username}' creada.")

    @app.post("/admin/universidades")
    @requiere("ADMIN")
    def admin_universidades():
        d = datos()
        codigo = str(d.get("codigo", "")).strip().upper()
        nombre = str(d.get("nombre", "")).strip()
        if not re.fullmatch(r"[A-Z]{3}", codigo) or not 3 <= len(nombre) <= 120:
            return error("El código son 3 letras (A–Z) y el nombre de 3 a 120 caracteres.", 422, url_for("admin"))
        with Session() as s:
            if s.scalars(select(IssuerKey).where(IssuerKey.universidad_codigo == codigo)).first():
                return error("Ese código ya está registrado.", 409, url_for("admin"))
            w = Billetera()
            s.add(IssuerKey(universidad_codigo=codigo, universidad_nombre=nombre, pub=w.pub,
                            priv_cifrada=secretos.cifrar(w.priv_hex)))
            s.commit()
        return ok(url_for("admin"), mensaje=f"{nombre} ({codigo}) ahora pertenece al consorcio.")

    return app


if __name__ == "__main__":
    create_app().run(debug=True, use_reloader=False)
