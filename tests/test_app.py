import json

import pytest
from sqlalchemy import select

from app import create_app
from models import Pending
from tests.conftest import emitir


# ------------------------------------------------------------------ acceso y CSRF
def test_post_sin_token_csrf_se_rechaza(cliente):
    cl = cliente()
    assert cl.post("/login/demo/uan", sin_token=True).status_code == 400


def test_minar_exige_sesion_y_rol(cliente):
    assert cliente().post("/minar").status_code == 401
    assert cliente("alumno").post("/minar").status_code == 403
    assert cliente("uan").post("/minar").status_code == 403


def test_emitir_solo_universidad_o_admin(cliente):
    assert emitir(cliente()).status_code == 401
    assert emitir(cliente("minero")).status_code == 403
    assert emitir(cliente("alumno")).status_code == 403


def test_solo_admin_toca_la_configuracion(cliente):
    assert cliente("uan").post("/admin/dificultad", {"dificultad": 4}).status_code == 403
    assert cliente("admin").post("/admin/dificultad", {"dificultad": 4}).status_code == 200
    assert cliente("admin").post("/admin/dificultad", {"dificultad": 2}).status_code == 400


def test_login_real_con_bcrypt_y_intentos_limitados(cliente):
    cl = cliente()
    assert cl.post("/login", {"username": "uan", "password": "mal"}).status_code == 401
    assert cl.post("/login", {"username": "uan", "password": "titulo-demo-2026"}).status_code == 200
    for _ in range(5):
        cl.post("/login", {"username": "fantasma", "password": "x"})
    assert cl.post("/login", {"username": "fantasma", "password": "x"}).status_code == 429


# ------------------------------------------------------------------ emisión
def test_la_credencial_firmada_queda_en_la_cola_sin_nombre_en_claro(cliente, red):
    r = emitir(cliente("uan"), matricula="A777")
    assert r.status_code == 200
    j = r.get_json()
    assert j["folio"].startswith("TS-UAN-") and len(j["firma"]) == 128
    with red.Session() as s:
        p = s.scalars(select(Pending).where(Pending.folio == j["folio"])).one()
    assert "A777" not in p.tx_json                       # la matrícula no va en claro
    assert red.secretos.alumno_id("a777") in p.tx_json    # sino su HMAC (normalizado)


def test_no_se_puede_emitir_dos_veces_lo_mismo(cliente):
    cl = cliente("uan")
    assert emitir(cl).status_code == 200
    r = emitir(cl, fecha="2026-09-02")  # mismo alumno+programa+tipo
    assert r.status_code == 422 and "vigente" in r.get_json()["error"]


def test_validaciones_de_formulario(cliente):
    cl = cliente("uan")
    assert emitir(cl, programa="x").status_code == 400
    assert emitir(cl, tipo="pergamino").status_code == 400
    assert emitir(cl, fecha="2099-01-01").status_code == 400
    assert emitir(cl, matricula=" ").status_code == 400


# ------------------------------------------------------------------ la carrera completa
def test_una_carrera_agrega_un_bloque_paga_y_se_puede_verificar(cliente, red):
    uni, minero = cliente("uan"), cliente("minero")
    folio = emitir(uni, matricula="Z1").get_json()["folio"]
    # el primero de la cola es del alumno demo, no el nuestro: minamos hasta llegar al nuestro
    for _ in range(40):
        e = minero.minar_y_esperar()
        assert e["ganador"] in ("Derek", "Carlos", "Alicia", "Bruno")
        if red.verificar(folio)["estado"] == "vigente":
            break
    v = minero.get(f"/api/verificar/{folio}").get_json()
    assert v["estado"] == "vigente" and v["cadena_valida"]
    assert all(p["ok"] for p in v["pasos"])
    assert red.validacion()["valida"]
    assert sum(n["saldo"] for n in minero.get("/estado").get_json()["nodos"]) == 50 * (len(red.cadena.bloques) - 1)


def test_estado_anuncia_el_proximo_folio_y_la_velocidad_de_la_ultima_carrera(cliente, red):
    m = cliente("minero")
    antes = m.get("/estado").get_json()
    assert antes["proximo_folio"].startswith("TS-UAN-") and antes["hashrate_ultima"] == 0
    e = m.minar_y_esperar()
    assert e["proximo_folio"] != antes["proximo_folio"]
    assert m.get("/estado").get_json()["hashrate_ultima"] > 0


def test_minar_respeta_el_destino_seguro_y_rechaza_redirecciones_externas(cliente):
    m = cliente("minero")
    r = m.c.post("/minar", data={"csrf_token": m.token, "siguiente": "https://malo.example/"})
    assert r.status_code == 303 and r.headers["Location"].endswith("/mineria")
    import time
    t = time.time()
    while time.time() - t < 30 and not m.get("/estado").get_json()["ganador"]:
        time.sleep(0.05)  # que la carrera termine antes de cerrar la prueba


def test_no_arrancan_dos_carreras_a_la_vez(cliente):
    m = cliente("minero")
    assert m.post("/minar").status_code == 200
    r = m.post("/minar")
    # la primera pudo haber terminado ya (dificultad 3): ambas respuestas son coherentes
    assert r.status_code in (200, 409)
    if r.status_code == 409:
        assert "en curso" in r.get_json()["error"]


def test_firma_alterada_en_la_cola_se_rechaza_al_minar(cliente, red):
    with red.Session() as s, s.begin():
        p = s.scalars(select(Pending).order_by(Pending.id)).first()
        primero = p.id
        p.firma = ("0" if p.firma[0] != "0" else "1") + p.firma[1:]
    m = cliente("minero")
    e = m.minar_y_esperar()  # salta la rechazada y mina la siguiente
    assert e["ganador"]
    with red.Session() as s:
        malo = s.get(Pending, primero)
    assert malo.estado == "rechazada" and "firma" in malo.motivo


def test_sin_pendientes_no_hay_carrera(cliente, red):
    with red.Session() as s, s.begin():
        for p in s.scalars(select(Pending)):
            p.estado = "minada"
    r = cliente("minero").post("/minar")
    assert r.status_code == 409 and "pendientes" in r.get_json()["error"]


# ------------------------------------------------------------------ revocación
def test_revocar_agrega_un_bloque_y_la_credencial_queda_revocada(cliente, red):
    uni, minero = cliente("uan"), cliente("minero")
    folio = emitir(uni, matricula="R9").get_json()["folio"]
    while red.verificar(folio)["estado"] != "vigente":
        minero.minar_y_esperar()
    assert uni.post("/revocar", {"folio": folio, "motivo": "Error administrativo"}).status_code == 200
    # la revocación entra al final de la cola: minar hasta que aparezca
    for _ in range(40):
        minero.minar_y_esperar()
        if red.verificar(folio)["estado"] == "revocada":
            break
    v = red.verificar(folio)
    assert v["estado"] == "revocada" and v["revocacion"]["transaccion"]["contenido"]["motivo"]
    assert red.validacion()["valida"]
    # ya revocada: no se puede revocar de nuevo
    assert uni.post("/revocar", {"folio": folio, "motivo": "otra vez"}).status_code == 422


def test_otra_universidad_no_puede_revocar(cliente, red):
    uni, minero = cliente("uan"), cliente("minero")
    folio = emitir(uni, matricula="R10").get_json()["folio"]
    while red.verificar(folio)["estado"] != "vigente":
        minero.minar_y_esperar()
    r = cliente("udm").post("/revocar", {"folio": folio, "motivo": "no es mía"})
    assert r.status_code == 422 and "emitió" in r.get_json()["error"]


def test_no_se_revoca_lo_que_no_esta_minado(cliente):
    r = cliente("uan").post("/revocar", {"folio": "TS-UAN-AAAAAAAAAAAA", "motivo": "fantasma"})
    assert r.status_code == 422


# ------------------------------------------------------------------ laboratorio, QR, cronómetro, persistencia
@pytest.mark.parametrize("tipo", ["contenido", "hash", "firma", "contenido_recalculado"])
def test_laboratorio_detecta_cada_alteracion_y_no_toca_la_real(cliente, red, tipo):
    m = cliente("minero")
    for _ in range(2):
        m.minar_y_esperar()
    j = cliente().post("/api/laboratorio", {"bloque": 1, "tipo": tipo}).get_json()
    assert j["ok"] and not j["copia_valida"] and j["original_valida"]
    assert red.validacion()["valida"]


def test_laboratorio_no_deja_alterar_el_genesis(cliente):
    assert cliente().post("/api/laboratorio", {"bloque": 0, "tipo": "hash"}).status_code == 400


def test_qr_solo_para_folios_con_formato_valido(cliente):
    cl = cliente()
    r = cl.get("/qr/TS-UAN-0123456789AB.svg")
    assert r.status_code == 200 and b"<svg" in r.data
    assert cl.get("/qr/nada.svg").status_code == 404


def test_cronometro_mide_sin_tocar_la_cadena_real(cliente, red):
    import time
    admin = cliente("admin")
    largo = len(red.cadena.bloques)
    assert admin.post("/api/cronometro/iniciar", {"rondas": {"3": 2}}).status_code == 200
    t = time.time()
    while time.time() - t < 30:
        e = admin.get("/api/cronometro/estado").get_json()
        if e["terminado"]:
            break
        time.sleep(0.05)
    r = e["resultados"]["3"]
    assert r["rondas"] == 2 and r["tiempo_medio"] > 0 and r["intentos_teoricos"] == 4096
    assert len(red.cadena.bloques) == largo
    assert cliente("uan").get("/api/cronometro/estado").status_code == 403


def test_la_cadena_y_la_cola_sobreviven_a_un_reinicio(cliente, app, tmp_path):
    m = cliente("minero")
    m.minar_y_esperar()
    m.minar_y_esperar()
    antes = [b["hash"] for b in app.extensions["ts"].red.cadena.bloques]
    cola = app.extensions["ts"].red.contar_cola()
    otra = create_app({"DATABASE_URL": f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
                       "SECRET_KEY": "clave-de-pruebas", "SEED_DEMO": True, "N_PENDIENTES": 12})
    assert [b["hash"] for b in otra.extensions["ts"].red.cadena.bloques] == antes
    assert otra.extensions["ts"].red.contar_cola() == cola   # no se vuelve a sembrar
    assert otra.extensions["ts"].red.cadena.es_valida()


def test_un_secret_key_distinto_se_detecta_al_arrancar_con_un_mensaje_claro(app, tmp_path):
    with pytest.raises(RuntimeError, match="SECRET_KEY no coincide"):
        create_app({"DATABASE_URL": f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
                    "SECRET_KEY": "otra-clave-distinta", "SEED_DEMO": True, "N_PENDIENTES": 12})


def test_el_alumno_ve_sus_credenciales_pero_no_las_ajenas(cliente, red):
    m = cliente("minero")
    m.minar_y_esperar()
    alumno = red.credenciales_de(red.secretos.alumno_id("a00123456"))
    assert [c["estado"] for c in alumno].count("vigente") == 1
    assert len(alumno) == 3                       # 1 minada + 2 en cola
    assert red.credenciales_de(red.secretos.alumno_id("DEMO-0003")) != alumno


def test_el_admin_crea_alumnos_y_universidades(cliente, red):
    a = cliente("admin")
    assert a.post("/admin/universidades", {"codigo": "ITM", "nombre": "Instituto de Prueba"}).status_code == 200
    assert a.post("/admin/universidades", {"codigo": "ITM", "nombre": "Repetida"}).status_code == 409
    assert a.post("/admin/usuarios", {"username": "ana", "nombre": "Ana", "password": "unaclavelarga",
                                       "rol": "UNIVERSITY", "universidad_codigo": "ITM"}).status_code == 200
    assert a.post("/admin/usuarios", {"username": "beto", "nombre": "Beto", "password": "unaclavelarga",
                                       "rol": "STUDENT"}).status_code == 422           # falta matrícula
    assert a.post("/admin/usuarios", {"username": "ana", "nombre": "Ana2", "password": "unaclavelarga",
                                       "rol": "MINER"}).status_code == 409
    ana = cliente()
    assert ana.post("/login", {"username": "ana", "password": "unaclavelarga"}).status_code == 200
    assert emitir(ana, matricula="Q1").get_json()["folio"].startswith("TS-ITM-")
