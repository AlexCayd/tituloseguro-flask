"""Aplicación: reinicio, recarga a mitad de ronda, dos pestañas, peticiones mal formadas y rollback."""
import mimetypes
import threading

import pytest

from nucleo.red import Reloj

from .conftest import err


def tx(api, e="N01", r="N02", m=5, modo="pow", **kw):
    return api.post(f"/api/{modo}/tx", {"emisor": e, "receptor": r, "monto": m, **kw})


# ---------------------------------------------------------------------- arranque
def test_arranque_y_estaticos(api):
    r = api.get("/")
    assert r.status_code == 200 and b"<html" in r.data
    assert api.get("/static/css/base.css").content_type.startswith("text/css")
    assert mimetypes.guess_type("main.js")[0] == "text/javascript"
    j = api.get("/api/salud").get_json()
    assert j["ok"] and set(j["modos"]) == {"pow", "pos"}
    lim = api.get("/api/limites").get_json()
    assert lim["n_min"] == 10 and lim["n_max"] == 20 and lim["umbral"] == [2, 3] and len(lim["ataques"]) == 13


def test_cabeceras_de_seguridad(api):
    r = api.get("/api/salud")
    assert "default-src 'self'" in r.headers["Content-Security-Policy"] and "'unsafe-inline'" not in r.headers[
        "Content-Security-Policy"]
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["Cache-Control"] == "no-store"
    assert api.get("/").headers["Content-Security-Policy"]


def test_estado_sin_simulacion(api):
    assert api.estado("pow") == {"ok": True, "existe": False, "modo": "pow"}
    err(api.get("/api/pow/pendientes"), 409, "sin_simulacion")
    err(api.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": 1}), 409, "sin_simulacion")
    err(api.delete("/api/pow/simulacion"), 409, "sin_simulacion")


# --------------------------------------------------------------------- reiniciar
def test_reiniciar_reemplaza_instancia_y_cambia_epoca(api):
    a = api.crear("pow", 10)
    tx(api)
    assert api.estado()["pendientes_total"] == 1
    b = api.crear("pow", 12, semilla="otra")
    assert b["epoca"] == a["epoca"] + 1 and len(b["estado"]["nodos"]) == 12
    e = api.estado()
    assert e["pendientes_total"] == 0 and e["altura"] == 0 and e["epoca"] == b["epoca"]


def test_epoca_obsoleta_409(api):
    a = api.crear("pow", 10)
    api.crear("pow", 10)
    err(tx(api, epoca=a["epoca"]), 409, "epoca_obsoleta")
    assert tx(api, epoca=a["epoca"] + 1).status_code == 201
    err(tx(api, epoca="x"), 422, "tipo_invalido")


def test_modos_independientes_y_eliminar(api):
    api.crear("pow", 10)
    api.crear("pos", 15)
    assert len(api.estado("pow")["nodos"]) == 10 and len(api.estado("pos")["nodos"]) == 15
    assert api.delete("/api/pow/simulacion").get_json()["ok"]
    assert api.estado("pow")["existe"] is False and api.estado("pos")["existe"] is True


def test_reiniciar_con_minado_en_curso_cancela_el_hilo(api):
    api.crear("pow", 10, dificultad=5, k=5, pausa_ms=5)
    tx(api)
    api.post("/api/pow/minar", {})
    assert api.estado()["trabajo"]["estado"] == "minando"
    sim_vieja = api.app.extensions["lab"].obtener("pow")
    api.crear("pow", 10, dificultad=2)
    assert sim_vieja.cerrada
    e = api.estado()
    assert e["trabajo"] is None and e["altura"] == 0 and e["pendientes_total"] == 0


def test_reiniciar_pos_con_ronda_a_medias(api):
    api.crear("pos", 10)
    tx(api, modo="pos", m=20)
    api.post("/api/pos/ronda", {"modo": "paso"})
    api.post("/api/pos/ronda/avanzar")
    api.crear("pos", 10)
    e = api.estado("pos")
    assert e["ronda"] is None and e["totales"]["bloqueado"] == 0


# ------------------------------------------------------------------ recargar página
def test_estado_a_mitad_de_trabajo_pow_es_reconstruible(api):
    api.crear("pow", 10, dificultad=5, k=5)
    tx(api)
    api.post("/api/pow/minar", {"ejecucion": "manual"})
    api.post("/api/pow/avanzar", {"rondas": 4})
    e1, e2 = api.estado(), api.estado()              # «recargar» = volver a pedir el estado completo
    assert e1["trabajo"] == e2["trabajo"] and e1["trabajo"]["estado"] == "minando" and e1["trabajo"]["ronda"] == 4
    assert len(e1["trabajo"]["mineros"]) == 10 and e1["sondeo_ms"] >= 250
    api.post("/api/pow/cancelar")


def test_estado_a_mitad_de_ronda_pos_conserva_la_fase(api):
    api.crear("pos", 10)
    tx(api, modo="pos", m=20)
    api.post("/api/pos/ronda", {"modo": "paso"})
    api.post("/api/pos/ronda/avanzar")
    api.post("/api/pos/ronda/avanzar")
    e = api.estado("pos")
    assert e["ronda"]["fase"] == "CANDIDATO" and e["ronda"]["candidato"]["valido"] and e["ronda"]["sorteo"]["ganador"]
    assert api.estado("pos")["ronda"] == e["ronda"]


def test_estado_con_desde_igual_a_rev_devuelve_sin_cambios(api):
    api.crear("pow", 10)
    e = api.estado()
    j = api.get(f"/api/pow/estado?desde={e['rev']}&epoca={e['epoca']}").get_json()
    assert j == {"ok": True, "existe": True, "sin_cambios": True, "rev": e["rev"], "epoca": e["epoca"]}
    tx(api)
    j = api.get(f"/api/pow/estado?desde={e['rev']}&epoca={e['epoca']}").get_json()
    assert "sin_cambios" not in j and j["rev"] > e["rev"]


def test_estado_con_epoca_distinta_devuelve_completo(api):
    api.crear("pow", 10)
    e = api.estado()
    j = api.get(f"/api/pow/estado?desde={e['rev']}&epoca={e['epoca'] + 5}").get_json()
    assert "sin_cambios" not in j and j["nodos"]
    err(api.get("/api/pow/estado?desde=abc"), 422, "tipo_invalido")
    err(api.get("/api/pow/estado?desde=-1"), 422, "fuera_de_rango")


def test_rev_sube_en_cada_cambio_y_no_en_rechazos_de_forma(api):
    api.crear("pow", 10)
    r0 = api.estado()["rev"]
    api.estado(), api.get("/api/pow/pendientes"), api.get("/api/pow/invariantes")
    assert api.estado()["rev"] == r0                                   # leer no cambia nada
    err(tx(api, m=-5), 422, "monto_invalido")
    err(tx(api, e="N99"), 422, "nodo_inexistente")
    err(api.post("/api/pow/tx", {"emisor": "N01"}), 422, "campo_requerido")
    assert api.estado()["rev"] == r0 and api.estado()["reloj"] == "2026-01-01T00:00:00Z"   # ni reloj ni bitácora
    tx(api)
    assert api.estado()["rev"] == r0 + 1


# -------------------------------------------------------------------- dos pestañas
def test_dos_avanzar_simultaneos_solo_uno_procede(api):
    api.crear("pos", 10)
    tx(api, modo="pos", m=20)
    api.post("/api/pos/ronda", {"modo": "paso"})
    resultados, barrera = [], threading.Barrier(2)

    def pestana():
        c = api.app.test_client()
        barrera.wait()
        resultados.append(c.post("/api/pos/ronda/avanzar", json={"fase_esperada": "APUESTAS"}))

    hilos = [threading.Thread(target=pestana) for _ in range(2)]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    estados = sorted(r.status_code for r in resultados)
    assert estados == [200, 409]
    assert next(r for r in resultados if r.status_code == 409).get_json()["codigo"] == "fase_cambio"
    assert api.estado("pos")["ronda"]["fase"] == "SORTEO"


def test_dos_tx_simultaneas_que_exceden_saldo_solo_una_se_acepta(api):
    api.crear("pow", 10)
    resultados, barrera = [], threading.Barrier(6)

    def pestana(i):
        c = api.app.test_client()
        barrera.wait()
        resultados.append(c.post("/api/pow/tx", json={"emisor": "N01", "receptor": f"N0{2 + i % 5}", "monto": 60}))

    hilos = [threading.Thread(target=pestana, args=(i,)) for i in range(6)]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    estados = sorted(r.status_code for r in resultados)
    assert estados == [201] + [422] * 5
    e = api.estado()
    assert e["pendientes_total"] == 1 and e["salud"]["consistente"]


def test_voto_simultaneo_del_mismo_validador_solo_cuenta_una_vez(api):
    api.crear("pos", 10)
    tx(api, modo="pos", m=20)
    api.post("/api/pos/ronda", {"modo": "paso", "validadores": ["N01", "N02", "N03", "N04"]})
    for _ in range(3):
        r = api.post("/api/pos/ronda/avanzar").get_json()["ronda"]
    votante = next(v["id"] for v in r["validadores"] if v["id"] != r["proponente"])
    resultados, barrera = [], threading.Barrier(4)

    def pestana():
        c = api.app.test_client()
        barrera.wait()
        resultados.append(c.post("/api/pos/ronda/voto", json={"votante": votante, "voto": False}).status_code)

    hilos = [threading.Thread(target=pestana) for _ in range(4)]
    [h.start() for h in hilos]
    [h.join() for h in hilos]
    assert sorted(resultados) == [200, 409, 409, 409]


# ------------------------------------------------------- peticiones directas mal formadas
def test_json_invalido_400(api):
    api.crear("pow", 10)
    for cuerpo in ("{", "{'n': 12}", "not json", '{"n": 12,}', "{\"n\": 12", "\x00\x01"):
        r = api.c.post("/api/pow/simulacion", data=cuerpo, content_type="application/json")
        err(r, 400, "json_invalido")


def test_cuerpo_no_objeto_400(api):
    for cuerpo in ("[1,2,3]", "5", '"hola"', "null", "true"):
        err(api.c.post("/api/pow/simulacion", data=cuerpo, content_type="application/json"), 400, "cuerpo_no_objeto")


def test_content_type_incorrecto_415(api):
    err(api.c.post("/api/pow/simulacion", data="n=12", content_type="text/plain"), 415, "tipo_no_soportado")
    err(api.c.post("/api/pow/simulacion", data="n=12", content_type="application/x-www-form-urlencoded"), 415,
        "tipo_no_soportado")
    assert api.c.post("/api/pow/simulacion", data="").status_code == 422     # sin cuerpo: falta «n» (no es un fallo)


def test_cuerpo_demasiado_grande_413(api):
    r = api.c.post("/api/pow/simulacion", data='{"n": 12, "semilla": "' + "a" * 70000 + '"}',
                   content_type="application/json")
    err(r, 413, "cuerpo_grande")


def test_metodo_no_permitido_405_json(api):
    r = api.c.put("/api/pow/simulacion", json={})
    j = err(r, 405, "metodo_no_permitido")
    assert "POST" in r.headers["Allow"]
    assert api.c.get("/api/pow/minar").status_code == 405
    assert api.c.delete("/api/pow/tx").status_code == 405
    assert api.c.post("/api/pow/estado", json={}).status_code == 405


def test_ruta_inexistente_404_json_y_modo_invalido(api):
    err(api.get("/api/no-existe"), 404, "ruta_no_encontrada")
    err(api.get("/api/xyz/estado"), 404, "modo_invalido")
    err(api.post("/api/xyz/simulacion", {"n": 10}), 404, "modo_invalido")
    r = api.get("/nada")
    assert r.status_code == 404 and b"<html" in r.data                         # fuera de /api: página de error


def test_campo_desconocido_422(api):
    api.crear("pow", 10)
    err(api.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": 1, "extra": 1}), 422, "campo_desconocido")
    err(api.post("/api/pow/minar", {"modo": "x"}), 422, "campo_desconocido")


def test_json_anidado_profundo_y_numero_gigante_y_nan(api):
    api.crear("pow", 10)
    r = api.c.post("/api/pow/tx", data="[" * 20000 + "]" * 20000, content_type="application/json")
    assert r.status_code in (400, 413) and r.get_json()["ok"] is False
    r = api.c.post("/api/pow/tx", data='{"a":' * 5000 + "1" + "}" * 5000, content_type="application/json")
    assert r.status_code in (400, 422) and r.get_json()["ok"] is False        # se parsea, pero «a» no es un campo
    r = api.c.post("/api/pow/simulacion", data='{"n": ' + "9" * 6000 + "}", content_type="application/json")
    assert r.status_code == 400 and r.get_json()["codigo"] == "json_invalido"
    for crudo in ('{"n": NaN}', '{"n": Infinity}', '{"n": -Infinity}'):
        err(api.c.post("/api/pow/simulacion", data=crudo, content_type="application/json"), 400, "json_invalido")
    err(api.c.post("/api/pow/simulacion", data=b'{"n": "\xff\xfe"}', content_type="application/json"), 400, "json_invalido")


def test_respuestas_nunca_contienen_traceback(api):
    api.crear("pos", 10)
    ataques = [("/api/pos/ronda/voto", {"votante": {"x": 1}, "voto": [1]}),
               ("/api/pos/ronda", {"validadores": [None, 5, {}], "apuestas": {"N01": [1]}}),
               ("/api/pos/tx", {"emisor": ["N01"], "receptor": {"a": 1}, "monto": object.__name__}),
               ("/api/pos/laboratorio/ataque", {"destino": 5, "tipo": [], "bloque": {}}),
               ("/api/pos/laboratorio/corromper", {"nodo": None, "bloque": "x", "tipo": 3})]
    for ruta, cuerpo in ataques:
        r = api.post(ruta, cuerpo)
        assert r.status_code < 500 and "Traceback" not in r.get_data(as_text=True), (ruta, r.get_data(as_text=True))


# ------------------------------------------------------------------------- rollback
def test_excepcion_interna_devuelve_500_json_y_hace_rollback(api, monkeypatch):
    api.crear("pow", 10)
    sim = api.app.extensions["lab"].obtener("pow")
    antes, rev = sim.huella_estado(), sim.rev

    def bomba(self):
        raise RuntimeError("fallo inesperado")
    monkeypatch.setattr(Reloj, "tick", bomba)           # revienta DESPUÉS de agregar la tx al pool
    r = tx(api)
    j = err(r, 500, "error_interno")
    assert "se deshizo" in j["error"] and "fallo inesperado" not in r.get_data(as_text=True)
    assert sim.huella_estado() == antes and sim.rev == rev and len(sim.pool) == 0
    monkeypatch.undo()
    assert tx(api).status_code == 201 and api.estado()["pendientes_total"] == 1


def test_curl_sin_cabecera_con_cuerpo_json_se_acepta(api):
    """`curl -d '{...}'` envía form-urlencoded: si el cuerpo parece JSON se lee igual."""
    r = api.c.post("/api/pow/simulacion", data='{"n": 12, "dificultad": 2}',
                   content_type="application/x-www-form-urlencoded")
    assert r.status_code == 201 and len(r.get_json()["estado"]["nodos"]) == 12
    err(api.c.post("/api/pow/simulacion", data='{"n": 12', content_type="text/plain"), 400, "json_invalido")
