"""Flujos de Proof of Stake a través de la API."""
import pytest

from .conftest import err


def tx(api, e="N01", r="N02", m=20, **kw):
    return api.post("/api/pos/tx", {"emisor": e, "receptor": r, "monto": m, **kw})


def ronda(api, **datos):
    return api.post("/api/pos/ronda", datos)


def avanzar(api, **datos):
    return api.post("/api/pos/ronda/avanzar", datos)


@pytest.fixture
def red(api):
    api.crear("pos", 10)
    tx(api)
    return api


def test_ronda_automatica_acepta_y_difunde(red):
    j = ronda(red, modo="auto").get_json()
    r = j["ronda"]
    assert r["fase"] == "ACEPTADO" and r["votacion"]["cumple"] and r["resultado"]["estado"] == "ACEPTADO"
    e = red.estado("pos")
    assert e["altura"] == 1 and e["sincronia"]["en_sincronia"] and e["pendientes_total"] == 0
    assert e["cabeza"]["proponente"] == r["proponente"] and e["salud"]["consistente"]
    assert [h["fase"] for h in r["historial"]][0] == "SORTEO" or r["historial"]
    prop = next(n for n in e["nodos"] if n["id"] == r["proponente"])
    assert prop["saldo"]["disponible"] > 100                       # cobró la recompensa al aceptarse (0 confirmaciones)


def test_ronda_sin_pendientes_409_sin_bloquear_apuestas(api):
    api.crear("pos", 10)
    err(ronda(api), 409, "sin_pendientes")
    e = api.estado("pos")
    assert e["ronda"] is None and e["totales"]["bloqueado"] == 0


def test_ronda_sin_validadores_mensaje_claro(api):
    api.crear("pos", 10, saldo_inicial=0)
    j = err(ronda(api), 409, "sin_validadores")
    assert "saldo" in j["error"]


@pytest.mark.parametrize("apuesta,codigo", [(10**6, "apuesta_excede_saldo"), (101, "apuesta_excede_saldo"),
                                            (0, "apuesta_invalida"), (-1, "apuesta_invalida"),
                                            ("7", "apuesta_invalida"), (7.5, "apuesta_invalida"),
                                            (None, "apuesta_invalida"), (True, "apuesta_invalida")])
def test_apuesta_invalida_por_api(red, apuesta, codigo):
    j = err(ronda(red, modo="paso", apuestas={"N03": apuesta}), 422, codigo)
    assert j["campo"] == "apuestas" and red.estado("pos")["ronda"] is None


def test_apuestas_con_formato_incorrecto(red):
    err(ronda(red, apuestas={"N99": 5}), 422, "nodo_inexistente")
    err(ronda(red, apuestas=[5]), 422, "tipo_invalido")
    err(ronda(red, apuestas="N01=5"), 422, "tipo_invalido")
    err(ronda(red, validadores="N01"), 422, "tipo_invalido")
    err(ronda(red, validadores=["N01", "N99"]), 422, "nodo_inexistente")
    err(ronda(red, validadores=["N01", "N02"], apuestas={"N05": 5}), 422, "apuesta_no_validador")
    err(ronda(red, modo="rapido"), 422, "tipo_invalido")
    err(ronda(red, n_validadores=11), 422, "n_validadores_invalido")
    err(ronda(red, n_validadores="3"), 422, "tipo_invalido")


def test_flujo_paso_a_paso_con_fase_esperada(red):
    r = ronda(red, modo="paso", validadores=["N01", "N02", "N03", "N04"]).get_json()["ronda"]
    assert r["fase"] == "APUESTAS" and len(r["validadores"]) == 4 and r["A"] == sum(v["apuesta"] for v in r["validadores"])
    err(avanzar(red, fase_esperada="VOTACION"), 409, "fase_cambio")
    ap = red.post("/api/pos/ronda/apuestas", {"apuestas": {"N01": 10, "N02": 10, "N03": 10, "N04": 10}})
    assert ap.get_json()["ronda"]["A"] == 40
    err(red.post("/api/pos/ronda/apuestas", {"apuestas": {"N01": 10 ** 6}}), 422, "apuesta_excede_saldo")
    fases = []
    while True:
        j = avanzar(red).get_json()["ronda"]
        fases.append(j["fase"])
        if not j["activa"]:
            break
    assert fases == ["SORTEO", "CANDIDATO", "VOTACION", "ACEPTADO"]
    err(avanzar(red), 409, "sin_ronda")
    assert j["sorteo"]["intervalos"] and j["votacion"]["umbral"] == "3V ≥ 2A"


def test_votacion_manual_exacta_dos_tercios_acepta(red):
    r = ronda(red, modo="paso", validadores=["N01", "N02", "N03"],
              apuestas={"N01": 10, "N02": 10, "N03": 10}).get_json()["ronda"]
    for _ in range(3):
        r = avanzar(red).get_json()["ronda"]
    assert r["fase"] == "VOTACION"
    otros = [v["id"] for v in r["validadores"] if v["id"] != r["proponente"]]
    assert red.post("/api/pos/ronda/voto", {"votante": otros[0], "voto": True}).status_code == 200
    assert red.post("/api/pos/ronda/voto", {"votante": otros[1], "voto": False}).status_code == 200
    r = avanzar(red).get_json()["ronda"]
    assert r["fase"] == "ACEPTADO" and (r["votacion"]["V_si"], r["votacion"]["A"]) == (20, 30)


def test_voto_de_no_validador_o_repetido(red):
    ronda(red, modo="paso", validadores=["N01", "N02", "N03"])
    for _ in range(3):
        r = avanzar(red).get_json()["ronda"]
    err(red.post("/api/pos/ronda/voto", {"votante": "N09", "voto": True}), 422, "voto_no_validador")
    err(red.post("/api/pos/ronda/voto", {"votante": "N99", "voto": True}), 422, "nodo_inexistente")
    err(red.post("/api/pos/ronda/voto", {"votante": r["proponente"], "voto": True}), 409, "voto_duplicado")
    otro = next(v["id"] for v in r["validadores"] if v["id"] != r["proponente"])
    assert red.post("/api/pos/ronda/voto", {"votante": otro, "voto": False}).status_code == 200
    err(red.post("/api/pos/ronda/voto", {"votante": otro, "voto": True}), 409, "voto_duplicado")
    err(red.post("/api/pos/ronda/voto", {"votante": otro, "voto": "si"}), 422, "tipo_invalido")
    err(red.post("/api/pos/ronda/voto", {"votante": otro}), 422, "campo_requerido")


def test_voto_fuera_de_fase(red):
    err(red.post("/api/pos/ronda/voto", {"votante": "N01", "voto": True}), 409, "sin_ronda")
    ronda(red, modo="paso")
    err(red.post("/api/pos/ronda/voto", {"votante": "N01", "voto": True}), 409, "fase_incorrecta")


def test_proponente_deshonesto_es_rechazado_y_castigado(red):
    for v in ("N03", "N04", "N05"):
        assert red.post(f"/api/pos/nodos/{v}/deshonesto", {"activo": True, "trampa": "firma"}).status_code == 200
    j = ronda(red, modo="auto", validadores=[f"N{i:02d}" for i in range(1, 11)]).get_json()
    r = j["ronda"]
    assert r["fase"] == "ACEPTADO"                              # los honestos acaban imponiéndose
    e = red.estado("pos")
    assert e["altura"] == 1 and e["salud"]["consistente"] and e["sincronia"]["en_sincronia"]
    castigados = [c["proponente"] for c in r["castigos_ronda"]]
    assert all(c in ("N03", "N04", "N05") for c in castigados)
    assert [h for h in r["historial"] if "RECHAZADO" in h["texto"]] or not castigados
    if castigados:
        assert e["totales"]["quemado"] > 0 and any(x["tipo"] == "castigo" for x in e["bitacora"] + red.get("/api/pos/bitacora").get_json()["entradas"])


def test_todos_deshonestos_ronda_abortada_y_estado_consistente(red):
    for i in range(1, 11):
        red.post(f"/api/pos/nodos/N{i:02d}/deshonesto", {"activo": True, "trampa": "gasto"})
    r = ronda(red, modo="auto").get_json()["ronda"]
    assert r["fase"] == "ABORTADA" and "castigados" in r["resultado"]["motivo"] and len(r["castigos_ronda"]) == 10
    e = red.estado("pos")
    assert e["altura"] == 0 and e["pendientes_total"] == 1 and e["salud"]["consistente"]
    assert e["totales"]["castigos_pendientes"] > 0 and e["totales"]["bloqueado"] == 0
    # los castigos se arrastran: una vez honestos, el siguiente bloque aceptado los registra
    for i in range(1, 11):
        red.post(f"/api/pos/nodos/N{i:02d}/deshonesto", {"activo": False})
    r2 = ronda(red, modo="auto").get_json()["ronda"]
    assert r2["fase"] == "ACEPTADO"
    e = red.estado("pos")
    assert e["totales"]["castigos_pendientes"] == 0 and e["totales"]["quemado"] > 0 and e["salud"]["consistente"]


def test_deshonesto_endpoint_validaciones(red):
    err(red.post("/api/pos/nodos/N03/deshonesto", {"activo": True, "trampa": "robo"}), 422, "trampa_invalida")
    err(red.post("/api/pos/nodos/N03/deshonesto", {"activo": "si"}), 422, "tipo_invalido")
    err(red.post("/api/pos/nodos/N03/deshonesto", {}), 422, "campo_requerido")
    err(red.post("/api/pos/nodos/N77/deshonesto", {"activo": True}), 404, "nodo_inexistente")
    err(red.post("/api/pow/nodos/N03/deshonesto", {"activo": True}), 404, "ruta_no_encontrada")
    ronda(red, modo="paso")
    avanzar(red)
    err(red.post("/api/pos/nodos/N03/deshonesto", {"activo": True}), 409, "ronda_en_curso")


def test_ronda_en_curso_y_cancelar(red):
    ronda(red, modo="paso")
    err(ronda(red), 409, "ronda_en_curso")
    err(red.post("/api/pos/nodos/N03/conexion", {"conectado": False}), 409, "ronda_en_curso")
    avanzar(red)
    e = red.estado("pos")
    assert e["totales"]["bloqueado"] > 0
    r = red.post("/api/pos/ronda/cancelar").get_json()["ronda"]
    assert r["fase"] == "ABORTADA"
    e = red.estado("pos")
    assert e["totales"]["bloqueado"] == 0 and e["totales"]["castigos_pendientes"] == 0
    err(red.post("/api/pos/ronda/cancelar"), 409, "sin_ronda")


def test_apuestas_bloqueadas_se_reflejan_en_saldos(red):
    ronda(red, modo="paso", validadores=["N03", "N04"], apuestas={"N03": 60, "N04": 30})
    avanzar(red)
    n3 = next(n for n in red.estado("pos")["nodos"] if n["id"] == "N03")
    assert n3["saldo"]["bloqueado"] == 60 and n3["saldo"]["gastable"] == 40 and n3["saldo"]["disponible"] == 100
    j = err(tx(red, "N03", "N06", 50), 422, "saldo_insuficiente")
    assert "bloqueados en su apuesta" in j["error"]


def test_sorteo_reproducible_con_misma_semilla(api):
    props = []
    for _ in range(2):
        api.crear("pos", 10, semilla="fija-1")
        tx(api)
        props.append(ronda(api, modo="auto").get_json()["ronda"]["proponente"])
    assert props[0] == props[1]


def test_regla_b_por_api(api):
    api.crear("pos", 10, regla_castigo="B", alfa=0.1)
    tx(api)
    api.post("/api/pos/nodos/N05/deshonesto", {"activo": True, "trampa": "firma"})
    assert api.estado("pos")["config"]["alfa_pm"] == 100 and api.estado("pos")["parametros"]["castigo"]["regla"] == "B"


def test_pos_no_tiene_rutas_de_pow(red):
    for ruta in ("/api/pos/minar", "/api/pos/avanzar", "/api/pos/cancelar"):
        assert red.post(ruta).status_code == 404
    assert red.post("/api/pow/ronda", {}).status_code == 404
    err(red.post("/api/pow/tx", {"emisor": "N01", "receptor": "N02", "monto": 1}), 409, "sin_simulacion")


def test_autopiloto_pos_sincrono(api):
    api.crear("pos", 10)
    j = api.post("/api/pos/autopiloto", {"bloques": 5}).get_json()
    assert j["producidos"] == 5 and not j["asincrono"]
    e = api.estado("pos")
    assert e["altura"] == 5 and e["sincronia"]["en_sincronia"] and e["salud"]["consistente"]
    err(api.post("/api/pos/autopiloto", {"bloques": 0}), 422, "fuera_de_rango")
    err(api.post("/api/pos/autopiloto", {"bloques": 21}), 422, "fuera_de_rango")


def test_ataque_pos_por_api(red):
    ronda(red, modo="auto")
    j = red.post("/api/pos/laboratorio/ataque", {"destino": "N04", "tipo": "bloque_intermedio"}).get_json()
    assert j["ataque"]["detectado"] and not j["ataque"]["resultado"]["aceptada"]
