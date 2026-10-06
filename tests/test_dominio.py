"""Dominio del proyecto: instituciones educativas y créditos de certificación."""
from nucleo.instituciones import INSTITUCIONES, TARIFAS, UNIDAD, etiqueta, institucion

from .conftest import crear_sim, err


def test_catalogo_cubre_los_20_nodos_con_siglas_unicas():
    assert sorted(INSTITUCIONES) == [f"N{i:02d}" for i in range(1, 21)]
    siglas = [v["sigla"] for v in INSTITUCIONES.values()]
    assert len(set(siglas)) == 20 and INSTITUCIONES["N01"]["sigla"] == "UAN"
    assert all(v["nombre"] and v["tipo"] in ("pública", "privada") for v in INSTITUCIONES.values())
    assert institucion("N77")["sigla"] == "N77" and etiqueta("N03") == "N03 · IPN"


def test_unidad_y_tarifas():
    assert UNIDAD["sigla"] == "CC" and "crédito" in UNIDAD["nombre"]
    assert [t["monto"] for t in TARIFAS] == [10, 6, 4, 1] and TARIFAS[0]["id"] == "titulo"


def test_api_expone_instituciones_y_unidad(api):
    lim = api.get("/api/limites").get_json()
    assert lim["unidad"]["sigla"] == "CC" and len(lim["instituciones"]) == 20 and len(lim["tarifas"]) == 4
    est = api.crear("pow", 12)["estado"]
    assert est["unidad"]["plural"] == "créditos de certificación"
    assert all(n["institucion"]["sigla"] and n["institucion"]["nombre"] for n in est["nodos"])
    assert est["nodos"][1]["institucion"]["sigla"] == "UNAM"
    html = api.get("/").get_data(as_text=True)
    assert "datos-limites" in html and "créditos de certificación" in html     # incrustado para el primer pintado


def test_textos_del_servidor_hablan_de_instituciones_y_creditos(api):
    api.crear("pow", 10)
    api.post("/api/pow/tx", {"emisor": "N03", "receptor": "N02", "monto": 10})
    j = err(api.post("/api/pow/tx", {"emisor": "N03", "receptor": "N02", "monto": 500}), 422, "saldo_insuficiente")
    assert "N03 · IPN" in j["error"] and "créditos" in j["error"] and "puede gastar" in j["error"]
    log = [e["texto"] for e in api.estado("pow")["bitacora"] if e["tipo"] == "tx_aceptada"][0]
    assert "N03 · IPN" in log and "N02 · UNAM" in log and "créditos de certificación" in log


def test_el_nucleo_sigue_usando_ids_tecnicos():
    s = crear_sim("pow")
    try:
        item = s.crear_tx("N03", "N02", 4)
        assert item["tx"]["emisor"] == "N03" and set(item["tx"]) == {"emisor", "receptor", "monto", "timestamp"}
        assert list(s.estado()["nodos"][2]["institucion"].values())[0] == "IPN"
    finally:
        s.cerrar()
