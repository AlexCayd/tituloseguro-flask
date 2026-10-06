"""Entradas inválidas por la API: cada una produce un mensaje claro y deja el sistema intacto."""
import pytest

from .conftest import err


# ------------------------------------------------------------------ número de nodos
@pytest.mark.parametrize("n", [0, 1, 9, 21, 100, -10, 10**12])
def test_n_fuera_de_rango_rechazado(api, n):
    j = err(api.post("/api/pow/simulacion", {"n": n}), 422, "n_fuera_de_rango")
    assert "10" in j["error"] and "20" in j["error"] and j["campo"] == "n"
    assert api.estado("pow")["existe"] is False


def test_n_10_y_20_aceptados(api):
    assert api.crear("pow", 10)["estado"]["config"]["n"] == 10
    assert len(api.crear("pos", 20)["estado"]["nodos"]) == 20


@pytest.mark.parametrize("n", ["15", 15.5, True, None, [], {}, "abc", float("1e3"), "", [15]])
def test_n_no_entero_rechazado(api, n):
    r = api.post("/api/pow/simulacion", {"n": n})
    assert r.status_code == 422 and r.get_json()["codigo"] in ("tipo_invalido", "n_fuera_de_rango")
    assert api.estado("pow")["existe"] is False


def test_n_ausente_y_campos_desconocidos(api):
    err(api.post("/api/pow/simulacion", {}), 422, "campo_requerido")
    err(api.post("/api/pow/simulacion", {"n": 12, "color": "rojo"}), 422, "campo_desconocido")
    err(api.post("/api/pos/simulacion", {"n": 12, "dificultad": 3}), 422, "campo_desconocido")


# ----------------------------------------------------------------------- dificultad
@pytest.mark.parametrize("d", [0, 1, 2, 6, 7, 100, -3])
def test_dificultad_fuera_de_rango_rechazada(app, d):
    from .conftest import Api
    from app import create_app
    a = create_app({"TESTING": True})              # límites oficiales 3..5 (no los de las pruebas rápidas)
    try:
        j = err(Api(a).post("/api/pow/simulacion", {"n": 10, "dificultad": d}), 422, "dificultad_fuera_de_rango")
        assert "3" in j["error"] and "5" in j["error"]
    finally:
        a.extensions["lab"].cerrar_todo()


def test_dificultad_3_y_5_aceptadas():
    from app import create_app
    from .conftest import Api
    a = create_app({"TESTING": True})
    try:
        c = Api(a)
        for d in (3, 4, 5):
            assert c.post("/api/pow/simulacion", {"n": 10, "dificultad": d}).status_code == 201
    finally:
        a.extensions["lab"].cerrar_todo()


@pytest.mark.parametrize("d", ["4", 4.0, 3.5, None, True, [], "abc"])
def test_dificultad_no_entera_rechazada(api, d):
    err(api.post("/api/pow/simulacion", {"n": 10, "dificultad": d}), 422, "tipo_invalido")


def test_otros_parametros_de_configuracion(api):
    err(api.post("/api/pow/simulacion", {"n": 10, "k": 0}), 422, "k_fuera_de_rango")
    err(api.post("/api/pow/simulacion", {"n": 10, "max_rondas": 0}), 422, "fuera_de_rango")
    err(api.post("/api/pow/simulacion", {"n": 10, "pausa_ms": 99999}), 422, "fuera_de_rango")
    err(api.post("/api/pow/simulacion", {"n": 10, "semilla": "con espacios"}), 422, "semilla_invalida")
    err(api.post("/api/pow/simulacion", {"n": 10, "saldo_inicial": -1}), 422, "saldo_invalido")
    err(api.post("/api/pow/simulacion", {"n": 10, "saldos": {"N77": 5}}), 422, "nodo_inexistente")
    err(api.post("/api/pos/simulacion", {"n": 10, "regla_castigo": "C"}), 422, "regla_invalida")
    err(api.post("/api/pos/simulacion", {"n": 10, "regla_castigo": "B", "alfa": 7}), 422, "alfa_invalido")
    err(api.post("/api/pos/simulacion", {"n": 10, "n_validadores": 11}), 422, "n_validadores_invalido")


def test_semilla_se_genera_si_falta_y_se_devuelve(api):
    s1 = api.crear("pos", 10)["estado"]["config"]["semilla"]
    s2 = api.crear("pos", 10)["estado"]["config"]["semilla"]
    assert s1 and s2 and s1 != s2


# ---------------------------------------------------------------------------- montos
@pytest.fixture
def red(api):
    api.crear("pow", 10, dificultad=2)
    return api


@pytest.mark.parametrize("monto", [-1, -100, -10**9])
def test_monto_negativo_rechazado(red, monto):
    j = err(red.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": monto}), 422, "monto_invalido")
    assert j["detalle"]["razon"] == "negativo" and "negativo" in j["error"]
    assert red.estado()["pendientes_total"] == 0


def test_monto_cero_rechazado(red):
    for m in (0, "0"):
        j = err(red.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": m}), 422, "monto_invalido")
        assert j["detalle"]["razon"] == "cero"


@pytest.mark.parametrize("monto,razon", [("abc", "no_numerico"), ("1e3", "no_entero"), ("10.5", "no_entero"),
                                         (10.5, "no_entero"), (1e3, "no_entero"), ("NaN", "no_finito"),
                                         ("Infinity", "no_finito"), ({}, "no_numerico"), ([], "no_numerico"),
                                         ([5], "no_numerico"), (True, "booleano"), ("12abc", "no_numerico")])
def test_monto_no_numerico_rechazado(red, monto, razon):
    j = err(red.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": monto}), 422, "monto_invalido")
    assert j["detalle"]["razon"] == razon


@pytest.mark.parametrize("cuerpo", [{"emisor": "N01", "receptor": "N02"},
                                    {"emisor": "N01", "receptor": "N02", "monto": None},
                                    {"emisor": "N01", "receptor": "N02", "monto": ""},
                                    {"emisor": "N01", "receptor": "N02", "monto": "   "}])
def test_monto_vacio_o_ausente_rechazado(red, cuerpo):
    r = red.post("/api/pow/tx", cuerpo)
    assert r.status_code == 422 and r.get_json()["codigo"] in ("campo_requerido", "monto_invalido")
    assert red.estado()["pendientes_total"] == 0


def test_monto_enorme_rechazado(red):
    for m in (10**10, 10**30, "9" * 400):
        err(red.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": m}), 422, "monto_invalido")
    r = red.c.post("/api/pow/tx", data='{"emisor":"N01","receptor":"N02","monto":' + "9" * 5000 + "}",
                   content_type="application/json")
    assert r.status_code == 400 and r.get_json()["codigo"] == "json_invalido"


def test_monto_como_texto_de_digitos_se_acepta(red):
    assert red.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": "25"}).status_code == 201


# ---------------------------------------------------------------- emisor y receptor
def test_emisor_igual_receptor_rechazado(red):
    j = err(red.post("/api/pow/tx", {"emisor": "N03", "receptor": "N03", "monto": 5}), 422, "mismo_nodo")
    assert "distintos" in j["error"] and red.estado()["pendientes_total"] == 0


@pytest.mark.parametrize("malo", ["N99", "N00", "n01", "N1", "", "N01 ", "' OR 1=1", "N" * 400, "../../etc"])
def test_emisor_inexistente_422(red, malo):
    err(red.post("/api/pow/tx", {"emisor": malo, "receptor": "N02", "monto": 5}), 422, "nodo_inexistente")


@pytest.mark.parametrize("malo", ["N99", "N21", "", "xx"])
def test_receptor_inexistente_422(red, malo):
    err(red.post("/api/pow/tx", {"emisor": "N01", "receptor": malo, "monto": 5}), 422, "nodo_inexistente")


@pytest.mark.parametrize("malo", [None, 5, [], {}, True])
def test_emisor_con_tipo_incorrecto(red, malo):
    err(red.post("/api/pow/tx", {"emisor": malo, "receptor": "N02", "monto": 5}), 422, "tipo_invalido")


def test_ruta_nodo_inexistente_404(red):
    for ruta in ("/api/pow/nodos/N99", "/api/pow/nodos/N99/cadena", "/api/pow/nodos/N99/saldo"):
        err(red.get(ruta), 404, "nodo_inexistente")
    err(red.post("/api/pow/nodos/N99/conexion", {"conectado": False}), 404, "nodo_inexistente")
    err(red.post("/api/pow/nodos/N99/sincronizar", {}), 404, "nodo_inexistente")


def test_id_de_nodo_con_formato_invalido_404(red):
    for malo in ("abc", "N1", "n01", "N001", "%27%20OR", "N01;x"):
        err(red.get(f"/api/pow/nodos/{malo}"), 404, "nodo_inexistente")
    r = red.get("/api/pow/nodos/..%2f")                      # el «/» decodificado ya no coincide con la ruta
    assert r.status_code == 404 and r.get_json()["ok"] is False


def test_firma_y_timestamp_propios_se_validan(red):
    base = {"emisor": "N01", "receptor": "N02", "monto": 5}
    err(red.post("/api/pow/tx", {**base, "firma": "00" * 64}), 422, "campo_requerido")
    err(red.post("/api/pow/tx", {**base, "timestamp": "2026-01-01T00:00:09Z"}), 422, "campo_requerido")
    err(red.post("/api/pow/tx", {**base, "timestamp": "ayer", "firma": "00" * 64}), 422, "tipo_invalido")
    err(red.post("/api/pow/tx", {**base, "timestamp": "2026-01-01T00:00:09Z", "firma": "00" * 64}), 422,
        "tx_firma_invalida")
    err(red.post("/api/pow/tx", {**base, "trampa": "robar"}), 422, "trampa_invalida")
    assert red.estado()["pendientes_total"] == 0
