"""Flujos de Proof of Work a través de la API."""
import pytest

from nucleo.ataques import TIPOS

from .conftest import err


def tx(api, e="N01", r="N02", m=5, modo="pow", **kw):
    return api.post(f"/api/{modo}/tx", {"emisor": e, "receptor": r, "monto": m, **kw})


def minar_manual(api):
    """Una carrera completa avanzando a mano (determinista, sin hilo)."""
    r = api.post("/api/pow/minar", {"ejecucion": "manual"})
    assert r.status_code == 200, r.get_json()
    for _ in range(400):
        j = api.post("/api/pow/avanzar", {"rondas": 100}).get_json()
        if j["trabajo"]["estado"] != "minando":
            return j["trabajo"]
    raise AssertionError("la carrera no terminó")


def test_flujo_basico_minado_automatico(api):
    api.crear("pow", 10, dificultad=2, pausa_ms=0)
    r = tx(api)
    assert r.status_code == 201 and r.get_json()["pendientes_total"] == 1
    assert api.post("/api/pow/minar", {}).status_code == 202
    e = api.esperar("pow", lambda e: e["trabajo"]["estado"] != "minando")
    assert e["trabajo"]["estado"] == "ganado" and e["altura"] == 1 and e["pendientes_total"] == 0
    assert e["sincronia"]["en_sincronia"] and e["sincronia"]["sincronizados"] == 10
    assert e["salud"]["consistente"] and all(n["altura"] == 1 for n in e["nodos"])
    assert len({n["hash_cabeza"] for n in e["nodos"]}) == 1
    t = e["trabajo"]
    assert len(t["mineros"]) == 10 and t["ganador"]["id"] in {m["id"] for m in t["mineros"]}
    assert all(m["carril"]["modulo"] == 10 and m["carril"]["residuo"] == m["indice"] for m in t["mineros"])


def test_competencia_visible_nonce_intentos_y_ultimo_hash(api):
    api.crear("pow", 10, dificultad=5, k=5)
    tx(api)
    api.post("/api/pow/minar", {"ejecucion": "manual"})
    t = api.post("/api/pow/avanzar", {"rondas": 3}).get_json()["trabajo"]
    assert t["ronda"] == 3 and t["intentos_total"] == 10 * 5 * 3
    for m in t["mineros"]:
        assert m["intentos"] == 15 and len(m["ultimo_hash"]) == 64 and m["nonce_actual"] % 10 == m["indice"]


def test_saldo_insuficiente_incluye_desglose(api):
    api.crear("pow", 10)
    j = err(tx(api, m=101), 422, "saldo_insuficiente")
    assert j["detalle"]["gastable"] == 100 and "puede gastar 100" in j["error"]
    assert api.estado()["pendientes_total"] == 0


def test_doble_gasto_entre_pendientes_rechazado(api):
    api.crear("pow", 10)
    assert tx(api, m=60).status_code == 201
    j = err(tx(api, "N01", "N03", 60), 422, "saldo_insuficiente")
    assert "comprometidos" in j["error"] and j["detalle"]["gastable"] == 40
    assert api.estado()["pendientes_total"] == 1


def test_reenviar_tx_ya_minada_422_tx_duplicada(api):
    api.crear("pow", 10)
    item = tx(api).get_json()["tx"]
    assert minar_manual(api)["estado"] == "ganado"
    r = tx(api, timestamp=item["tx"]["timestamp"], firma=item["firma"])
    err(r, 422, "tx_duplicada")


def test_tx_firmada_externamente_se_acepta_si_es_valida(api):
    api.crear("pow", 10)
    item = tx(api).get_json()["tx"]
    api.post("/api/pow/minar", {"ejecucion": "manual"})
    api.post("/api/pow/cancelar")
    # otra tx firmada por el servidor pero reenviada con firma+timestamp propios (mismo contenido): duplicada en pool
    err(tx(api, timestamp=item["tx"]["timestamp"], firma=item["firma"]), 422, "tx_duplicada")


def test_tx_trampa_firma_alterada_rechazada_en_pool(api):
    api.crear("pow", 10)
    j = err(tx(api, trampa="firma_alterada"), 422, "tx_firma_invalida")
    assert "firma" in j["error"]
    assert any(e["tipo"] == "tx_rechazada" for e in api.estado()["bitacora"])
    assert api.estado()["pendientes_total"] == 0


def test_tx_trampa_otra_clave_rechazada(api):
    api.crear("pow", 10)
    j = err(tx(api, trampa="otra_clave"), 422, "tx_otra_clave")
    assert j["detalle"]["emisor"] == "N01" and j["detalle"]["firmante"] != "N01"


def test_minar_sin_pendientes_409(api):
    api.crear("pow", 10)
    err(api.post("/api/pow/minar", {}), 409, "sin_pendientes")
    assert api.estado()["trabajo"] is None


def test_minar_dos_veces_409_ya_minando(api):
    api.crear("pow", 10, dificultad=5, k=5)
    tx(api)
    assert api.post("/api/pow/minar", {"ejecucion": "manual"}).status_code == 200
    err(api.post("/api/pow/minar", {"ejecucion": "manual"}), 409, "ya_minando")
    err(api.post("/api/pow/minar", {}), 409, "ya_minando")
    assert api.estado()["trabajo"]["id"] == 1


def test_cancelar_sin_trabajo_409_y_con_trabajo_ok(api):
    api.crear("pow", 10, dificultad=5, k=5)
    err(api.post("/api/pow/cancelar"), 409, "no_hay_trabajo")
    tx(api)
    api.post("/api/pow/minar", {"ejecucion": "manual"})
    j = api.post("/api/pow/cancelar").get_json()
    assert j["trabajo"]["estado"] == "cancelado"
    e = api.estado()
    assert e["altura"] == 0 and e["pendientes_total"] == 1 and e["salud"]["consistente"]
    err(api.post("/api/pow/avanzar", {"rondas": 1}), 409, "no_hay_trabajo")


def test_estado_muestra_limite_alcanzado(api):
    api.crear("pow", 10, dificultad=5, k=5, max_rondas=4)
    tx(api)
    api.post("/api/pow/minar", {"ejecucion": "manual"})
    t = api.post("/api/pow/avanzar", {"rondas": 100}).get_json()["trabajo"]
    assert t["estado"] == "limite" and "límite" in t["mensaje"] and t["ronda"] == 4
    e = api.estado()
    assert e["altura"] == 0 and e["pendientes_total"] == 1


def test_avanzar_valida_rondas_y_modo(api):
    api.crear("pow", 10, dificultad=5, k=5, pausa_ms=10)
    tx(api)
    api.post("/api/pow/minar", {"ejecucion": "manual"})
    for malo in (0, -1, 1001, "3", 2.5, None, True):
        r = api.post("/api/pow/avanzar", {"rondas": malo})
        assert r.status_code == 422, malo
    api.post("/api/pow/cancelar")
    api.post("/api/pow/minar", {"ejecucion": "auto"})
    err(api.post("/api/pow/avanzar", {"rondas": 1}), 409, "trabajo_automatico")
    api.post("/api/pow/cancelar")
    err(api.post("/api/pow/minar", {"ejecucion": "raro"}), 422, "tipo_invalido")


def test_recompensas_pendientes_hasta_6_confirmaciones(api):
    api.crear("pow", 10, dificultad=2)
    for h in range(1, 9):
        tx(api, m=1)
        assert minar_manual(api)["estado"] == "ganado"
        e = api.estado()
        pend = [i for i in e["recompensas"]["items"] if i["estado"] == "pendiente"]
        assert len(pend) == min(h, 6) and e["totales"]["pendiente_recompensas"] == 50 * min(h, 6), h
        assert all(i["faltan"] == max(0, 6 - (h - i["bloque"])) for i in pend)
        assert e["totales"]["disponible"] == 1000 + 50 * max(0, h - 6)             # sólo maduran las del bloque ≤ h-6
    e = api.estado()
    assert any(i["estado"] == "madura" and i["bloque"] == 2 for i in e["recompensas"]["items"])
    # el endpoint de saldo distingue disponible y pendiente por nodo
    ganador = e["cabeza"]["proponente"]
    s = api.get(f"/api/pow/nodos/{ganador}/saldo").get_json()
    assert s["pendiente"] >= 50 and s["disponible"] + s["pendiente"] >= 150 or s["pendiente"] >= 50
    assert {"disponible", "pendiente", "bloqueado", "gastable", "recompensas"} <= set(s)


def test_gastar_recompensa_pendiente_422(api):
    api.crear("pow", 10, dificultad=2, saldo_inicial=0, saldos={"N01": 1000})
    for _ in range(12):                                   # busca un bloque propuesto por alguien sin fondos propios
        tx(api, "N01", "N02", 1)
        minar_manual(api)
        ganador = api.estado()["cabeza"]["proponente"]
        if ganador not in ("N01", "N02"):
            break
    assert ganador not in ("N01", "N02")
    s = api.get(f"/api/pow/nodos/{ganador}/saldo").get_json()
    assert s["pendiente"] == 50 and s["disponible"] == 0 and s["gastable"] == 0
    destino = "N10" if ganador != "N10" else "N09"
    j = err(tx(api, ganador, destino, 1), 422, "saldo_insuficiente")
    assert "aún no maduran" in j["error"] and j["detalle"]["pendiente_recompensa"] == 50


def test_autopiloto_12_bloques_cadena_valida_en_todos_los_nodos(api):
    api.crear("pow", 12, dificultad=2, pausa_ms=0)
    assert api.post("/api/pow/autopiloto", {"bloques": 12}).status_code == 202
    e = api.esperar("pow", lambda e: e["altura"] == 12 and e["trabajo"]["estado"] != "minando")
    assert e["sincronia"]["en_sincronia"] and all(n["cadena_integra"] for n in e["nodos"])
    assert e["salud"]["consistente"]
    for nid in ("N01", "N12"):
        c = api.get(f"/api/pow/nodos/{nid}/cadena?limite=100").get_json()
        assert c["total"] == 13 and c["validacion"]["valida"] and len(c["bloques"]) == 13


def test_cadena_paginada_y_validada(api):
    api.crear("pow", 10, dificultad=2)
    for _ in range(3):
        tx(api)
        minar_manual(api)
    c = api.get("/api/pow/nodos/N03/cadena?desde=1&limite=2").get_json()
    assert [b["numero"] for b in c["bloques"]] == [1, 2] and c["total"] == 4
    err(api.get("/api/pow/nodos/N03/cadena?limite=0"), 422, "fuera_de_rango")
    err(api.get("/api/pow/nodos/N03/cadena?limite=1000"), 422, "fuera_de_rango")
    err(api.get("/api/pow/nodos/N03/cadena?desde=-1"), 422, "fuera_de_rango")
    err(api.get("/api/pow/nodos/N03/cadena?desde=abc"), 422, "tipo_invalido")


def test_conexion_y_sincronizacion_por_api(api):
    api.crear("pow", 10, dificultad=2)
    assert api.post("/api/pow/nodos/N03/conexion", {"conectado": False}).get_json()["nodo"]["conectado"] is False
    tx(api)
    minar_manual(api)
    e = api.estado()
    assert e["sincronia"]["sincronizados"] == 9 and not e["sincronia"]["en_sincronia"]
    err(api.post("/api/pow/nodos/N03/sincronizar"), 409, "nodo_desconectado")
    api.post("/api/pow/nodos/N03/conexion", {"conectado": True})
    r = api.post("/api/pow/nodos/N03/sincronizar").get_json()
    assert r["resultado"]["aceptada"] and api.estado()["sincronia"]["en_sincronia"]
    err(api.post("/api/pow/nodos/N03/conexion", {"conectado": "si"}), 422, "tipo_invalido")
    err(api.post("/api/pow/nodos/N03/conexion", {}), 422, "campo_requerido")


@pytest.mark.parametrize("tipo", sorted(TIPOS))
def test_laboratorio_ataques_por_api(api, tipo):
    api.crear("pow", 10, dificultad=2)
    for _ in range(3):
        tx(api)
        minar_manual(api)
    j = api.post("/api/pow/laboratorio/ataque", {"destino": "N04", "tipo": tipo}).get_json()
    a = j["ataque"]
    assert j["ok"] and a["resultado"]["aceptada"] is False and a["detectado"] and a["explicacion"]
    assert api.estado()["altura"] == 3 and api.estado()["salud"]["consistente"]


def test_laboratorio_corromper_y_resincronizar(api):
    api.crear("pow", 10, dificultad=2)
    for _ in range(3):
        tx(api)
        minar_manual(api)
    j = api.post("/api/pow/laboratorio/corromper", {"nodo": "N02", "bloque": 2, "tipo": "contenido"}).get_json()
    assert j["validacion"]["valida"] is False and j["descripcion"]["bloque"] == 2
    n2 = next(n for n in api.estado()["nodos"] if n["id"] == "N02")
    assert n2["cadena_integra"] is False
    assert api.post("/api/pow/nodos/N02/sincronizar").get_json()["resultado"]["aceptada"]
    err(api.post("/api/pow/laboratorio/corromper", {"nodo": "N02", "bloque": 99, "tipo": "hash"}), 422, "bloque_invalido")
    err(api.post("/api/pow/laboratorio/corromper", {"nodo": "N02", "bloque": 1, "tipo": "x"}), 422, "tipo_invalido")
    err(api.post("/api/pow/laboratorio/ataque", {"destino": "N02", "tipo": "x"}), 422, "tipo_invalido")
    err(api.post("/api/pow/laboratorio/ataque", {"destino": "N02", "tipo": "cadena_corta", "bloque": "1"}), 422,
        "bloque_invalido")


def test_bitacora_filtros_e_invariantes(api):
    api.crear("pow", 10, dificultad=2)
    tx(api)
    err(tx(api, m=10**6), 422, "saldo_insuficiente")
    j = api.get("/api/pow/bitacora?nivel=aviso").get_json()
    assert j["entradas"] and all(e["nivel"] == "aviso" for e in j["entradas"])
    j2 = api.get(f"/api/pow/bitacora?desde_seq={j['seq']}").get_json()
    assert j2["entradas"] == []
    err(api.get("/api/pow/bitacora?nivel=raro"), 422, "tipo_invalido")
    err(api.get("/api/pow/bitacora?limite=0"), 422, "fuera_de_rango")
    inv = api.get("/api/pow/invariantes").get_json()
    assert inv["consistente"] and {c["nombre"] for c in inv["comprobaciones"]} >= {"conservacion"}


def test_tx_aleatorias(api):
    api.crear("pow", 10)
    j = api.post("/api/pow/tx/aleatorias", {"cantidad": 5}).get_json()
    assert len(j["txs"]) == 5 and j["pendientes_total"] == 5
    for malo in (0, 21, "5", None, 2.5):
        assert api.post("/api/pow/tx/aleatorias", {"cantidad": malo}).status_code == 422


def test_pool_lleno_409(api):
    api.crear("pow", 10, saldo_inicial=1000)
    for i in range(50):
        assert tx(api, "N0%d" % (1 + i % 9), "N10", 1).status_code == 201
    err(tx(api, "N01", "N10", 1), 409, "pool_lleno")
