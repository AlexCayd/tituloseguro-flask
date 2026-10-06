"""Libro mayor: saldos derivados, validez de transacciones y madurez de recompensas."""
import pytest

from nucleo.cripto import firmar_tx
from nucleo.libro import aplicar_bloque, aplicar_tx, libro_inicial, recompensas_info

from .conftest import crear_sim, fabricar


@pytest.fixture
def s():
    sim = crear_sim("pow")
    yield sim
    sim.cerrar()


def tx(e="N01", r="N02", m=10, ts="2026-01-01T00:00:01Z"):
    return {"emisor": e, "receptor": r, "monto": m, "timestamp": ts}


def aplicar(s, libro, t, firma=None, firmante=None):
    f = firma or firmar_tx(s.privs[firmante or t["emisor"]], t)
    return aplicar_tx(libro, t, f, s.params, s.claves)


def test_tx_valida_mueve_fondos_y_registra_id(s):
    lb = libro_inicial(s.genesis)
    assert aplicar(s, lb, tx(m=30)) is None
    assert lb.disponible["N01"] == 70 and lb.disponible["N02"] == 130 and len(lb.tx_ids) == 1


def test_aplicar_tx_saldo_insuficiente_no_muta(s):
    lb = libro_inicial(s.genesis)
    antes = lb.copia()
    cod, det = aplicar(s, lb, tx(m=101))
    assert cod == "tx_saldo" and det["gastable"] == 100
    assert lb.disponible == antes.disponible and lb.tx_ids == antes.tx_ids


def test_aplicar_tx_mismo_nodo(s):
    assert aplicar(s, libro_inicial(s.genesis), tx(r="N01"))[0] == "tx_mismo_nodo"


def test_aplicar_tx_nodo_inexistente(s):
    assert aplicar(s, libro_inicial(s.genesis), tx(r="N99"), firma="0" * 128)[0] == "tx_nodo_inexistente"


def test_aplicar_tx_firma_alterada(s):
    t = tx()
    f = firmar_tx(s.privs["N01"], t)
    mala = ("1" if f[0] == "0" else "0") + f[1:]
    assert aplicar(s, libro_inicial(s.genesis), t, firma=mala)[0] == "tx_firma"


def test_aplicar_tx_firma_de_otra_clave(s):
    cod, det = aplicar(s, libro_inicial(s.genesis), tx(), firmante="N05")
    assert cod == "tx_otra_clave" and det["firmante"] == "N05" and det["emisor"] == "N01"


def test_aplicar_tx_duplicada(s):
    lb = libro_inicial(s.genesis)
    assert aplicar(s, lb, tx()) is None
    assert aplicar(s, lb, tx())[0] == "tx_duplicada"


@pytest.mark.parametrize("monto", [0, -5, 10**9 + 1])
def test_aplicar_tx_monto_fuera_de_rango(s, monto):
    assert aplicar(s, libro_inicial(s.genesis), tx(m=monto), firma="0" * 128)[0] == "tx_monto"


@pytest.mark.parametrize("malo", [None, [], {}, {"emisor": "N01"}, "x", {**tx(), "monto": "5"},
                                   {**tx(), "monto": True}, {**tx(), "extra": 1}, {**tx(), "timestamp": "hoy"}])
def test_aplicar_tx_estructura(s, malo):
    cod, _ = aplicar_tx(libro_inicial(s.genesis), malo, "0" * 128, s.params, s.claves)
    assert cod == "tx_estructura"


def test_segunda_tx_del_bloque_sin_saldo_falla(s):
    g = s.genesis
    b = fabricar(s, 1, "N03", [tx(m=100, ts="2026-01-01T00:00:02Z"), tx(r="N03", m=1, ts="2026-01-01T00:00:03Z")],
                 g["hash"])
    lb = libro_inicial(g)
    probs = aplicar_bloque(lb, b, s.params, s.claves)
    assert [(p.codigo, p.detalle["i"]) for p in probs] == [("tx_saldo", 2)]
    assert lb.disponible["N01"] == 0 and lb.disponible["N03"] == 100      # la 2.ª no se aplicó


def test_lo_recibido_en_el_mismo_bloque_es_gastable_dentro_de_el(s):
    g = s.genesis
    b = fabricar(s, 1, "N03", [tx("N01", "N02", 100, "2026-01-01T00:00:02Z"),
                               tx("N02", "N04", 200, "2026-01-01T00:00:03Z")], g["hash"])
    lb = libro_inicial(g)
    assert aplicar_bloque(lb, b, s.params, s.claves) == []
    assert lb.disponible["N04"] == 300


def _cadena(s, n_bloques, proponentes=None, extra=None):
    """Aplica bloques consecutivos con 1 tx válida por bloque. Devuelve (libro, bloques)."""
    g = s.genesis
    lb, bloques, prev = libro_inicial(g), [g], g["hash"]
    for k in range(1, n_bloques + 1):
        prop = (proponentes or {}).get(k, "N04")
        txs = [tx("N01", "N02", 1, f"2026-01-01T00:01:{k:02d}Z")] + list((extra or {}).get(k, []))
        b = fabricar(s, k, prop, txs, prev)
        probs = aplicar_bloque(lb, b, s.params, s.claves)
        bloques.append(b)
        prev = b["hash"]
        yield lb.copia(), b, probs


def test_recompensa_pendiente_hasta_altura_h_mas_6(s):
    estados = {}
    for k, (lb, b, _) in enumerate(_cadena(s, 8, {1: "N03"}), start=1):
        estados[k] = lb
    # el bloque 1 lo propuso N03: pendiente mientras la altura < 7
    for k in range(1, 7):
        assert estados[k].pendiente["N03"] == 50, k
        assert estados[k].disponible["N03"] == 100, k
    # se acredita exactamente al terminar de procesar el bloque 7 (= 1 + 6)
    assert estados[7].pendiente["N03"] == 0 and estados[7].disponible["N03"] == 150


def test_recompensa_no_gastable_en_el_bloque_h_mas_6_si_gastable_en_h_mas_7(s):
    g = s.genesis
    lb, prev, probs_por_bloque = libro_inicial(g), g["hash"], {}
    for k in range(1, 9):
        txs = [tx("N01", "N02", 1, f"2026-01-01T00:01:{k:02d}Z")]
        if k in (7, 8):   # N03 intenta gastar 120 (100 de saldo + 50 de la recompensa del bloque 1)
            txs.append(tx("N03", "N01", 120, f"2026-01-01T00:02:{k:02d}Z"))
        b = fabricar(s, k, "N03" if k == 1 else "N04", txs, prev)
        probs_por_bloque[k] = aplicar_bloque(lb, b, s.params, s.claves)
        prev = b["hash"]
    assert [p.codigo for p in probs_por_bloque[7]] == ["tx_saldo"]    # aún no gastable en el bloque 7
    assert probs_por_bloque[8] == []                                    # sí en el bloque 8


def test_conservacion_de_suministro(s):
    ultimo = None
    for ultimo, _, _ in _cadena(s, 12, {3: "N05", 5: "N05"}):
        pass
    esperado = sum(s.params["saldos"].values()) + 50 * 12
    assert sum(ultimo.disponible.values()) + sum(ultimo.pendiente.values()) + ultimo.quemado == esperado


def test_recompensas_info_linea_de_tiempo(s):
    g, prev, bloques = s.genesis, s.genesis["hash"], [s.genesis]
    for k in range(1, 9):
        b = fabricar(s, k, "N03", [tx(m=1, ts=f"2026-01-01T00:01:{k:02d}Z")], prev)
        bloques.append(b)
        prev = b["hash"]
    items = {i["bloque"]: i for i in recompensas_info(bloques, s.params)}
    assert items[1]["estado"] == "madura" and items[2]["estado"] == "madura"     # 8 >= 1+6 y 8 >= 2+6
    assert items[3]["estado"] == "pendiente" and items[3]["faltan"] == 1 and items[3]["madura_en"] == 9
    assert items[8]["estado"] == "pendiente" and items[8]["faltan"] == 6 and items[8]["madura_en"] == 14
