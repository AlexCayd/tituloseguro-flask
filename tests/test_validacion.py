"""Validación de bloques y cadenas: reglas (a), (b) y (c)."""
import copy

import pytest

from nucleo.ataques import alterar_copia
from nucleo.bloque import hash_bloque, sellar
from nucleo.libro import libro_inicial
from nucleo.validacion import validar_bloque, validar_cadena

from .conftest import crear_sim, fabricar, minar_bloque


@pytest.fixture(scope="module")
def mundo():
    s = crear_sim("pow", semilla="val")
    for i in range(5):
        minar_bloque(s, "N0%d" % (i + 1), "N0%d" % (i + 2), 3)
    yield s, copy.deepcopy(s.ref().cadena)
    s.cerrar()


def fallas(inf, n):
    return set(inf.bloques[n]["fallas"])


def tx(e="N01", r="N02", m=10, ts="2026-01-01T00:00:01Z"):
    return {"emisor": e, "receptor": r, "monto": m, "timestamp": ts}


def test_cadena_real_es_valida(mundo):
    s, cad = mundo
    inf = validar_cadena(cad, genesis_esperado=s.genesis)
    assert inf.valida and inf.altura == 5 and inf.hash_cabeza == cad[-1]["hash"]
    assert all(b["valido"] for b in inf.bloques)


def test_hash_alterado_detectado_en_ese_bloque(mundo):
    _, cad = mundo
    mala, _ = alterar_copia(cad, 3, "hash")
    inf = validar_cadena(mala)
    assert not inf.valida
    assert "hash" in fallas(inf, 3) and fallas(inf, 2) == set()
    assert "enlace" in fallas(inf, 4)       # el siguiente bloque ya no enlaza con la huella guardada...


def test_hash_anterior_alterado_detectado(mundo):
    _, cad = mundo
    mala = copy.deepcopy(cad)
    mala[3]["hash_anterior"] = "f" * 64
    inf = validar_cadena(mala)
    assert not inf.valida and {"enlace", "hash"} <= fallas(inf, 3)


def test_intermedio_manipulado_invalida_cadena_completa(mundo):
    s, cad = mundo
    mala, desc = alterar_copia(cad, 2, "contenido")
    inf = validar_cadena(mala)
    assert not inf.valida and not inf.bloques[2]["valido"]
    nodo = s.nodos["N05"]
    antes = nodo.hash_cabeza
    r = nodo.recibir_cadena(mala, s.genesis)
    assert not r.aceptada and r.codigo == "cadena_invalida" and nodo.hash_cabeza == antes


def test_validador_no_se_detiene_en_el_primer_error(mundo):
    _, cad = mundo
    mala, _ = alterar_copia(cad, 1, "contenido")
    mala, _ = alterar_copia(mala, 4, "firma")
    inf = validar_cadena(mala)
    assert not inf.bloques[1]["valido"] and not inf.bloques[4]["valido"]
    assert {p.bloque for p in inf.problemas} >= {1, 4}


def test_intermedio_con_hash_recalculado_falla_por_consenso_y_firma(mundo):
    _, cad = mundo
    mala, _ = alterar_copia(cad, 2, "contenido_recalculado")
    inf = validar_cadena(mala)
    assert {"tx_firma", "pow_objetivo"} <= fallas(inf, 2) or "tx_firma" in fallas(inf, 2)
    assert "tx_firma" in fallas(inf, 2)
    assert "enlace" in fallas(inf, 3)       # recalcular la huella rompe el enlace del siguiente


@pytest.mark.parametrize("basura", [
    None, [], {}, "x", 5, [None], [{}], [[]], [{"numero": "a"}], [1, 2, 3], {"a": 1},
    [{"numero": 0, "genesis": "x"}], [True],
])
def test_validador_es_total_con_basura(basura):
    inf = validar_cadena(basura)
    assert inf.valida is False and inf.problemas


def test_validador_total_con_bloques_mutilados(mundo):
    s, cad = mundo
    for i in (1, 3):
        for campo in list(cad[i].keys()):
            mala = copy.deepcopy(cad)
            del mala[i][campo]
            assert validar_cadena(mala).valida is False
            mala = copy.deepcopy(cad)
            mala[i][campo] = object() if campo != "hash" else None
            assert validar_cadena(mala).valida is False


def test_genesis_alterado_o_distinto(mundo):
    s, cad = mundo
    mala = copy.deepcopy(cad)
    mala[0]["genesis"]["saldos"]["N01"] += 1                    # sin recalcular la huella
    inf = validar_cadena(mala, genesis_esperado=s.genesis)
    assert not inf.valida and inf.problemas[0].codigo == "genesis_invalido"
    otra = crear_sim("pow", semilla="otra")
    try:
        inf = validar_cadena(copy.deepcopy(otra.ref().cadena), genesis_esperado=s.genesis)
        assert not inf.valida and inf.problemas[0].codigo == "genesis_distinto"
    finally:
        otra.cerrar()


def _validar(s, bloque, previo=None, libro=None):
    g = s.genesis
    return validar_bloque(bloque, previo or g, libro or libro_inicial(g), s.params, s.claves)


def test_doble_gasto_mismo_bloque_invalida_bloque(mundo):
    s, _ = mundo
    b = fabricar(s, 1, "N01", [tx(m=100, r="N02", ts="2026-01-01T00:00:02Z"),
                               tx(m=100, r="N03", ts="2026-01-01T00:00:03Z")], s.genesis["hash"])
    probs = _validar(s, b)
    assert [(p.codigo, p.detalle["i"]) for p in probs if p.codigo.startswith("tx_")] == [("tx_saldo", 2)]


def test_replay_de_tx_en_bloque_posterior_invalida(mundo):
    s, _ = mundo
    g = s.genesis
    lb = libro_inicial(g)
    t = tx(m=5, ts="2026-01-01T00:00:02Z")
    b1 = fabricar(s, 1, "N01", [t], g["hash"])
    b2 = fabricar(s, 2, "N01", [t], b1["hash"])
    assert not [p for p in validar_bloque(b1, g, lb, s.params, s.claves) if p.codigo.startswith("tx_")]
    p2 = validar_bloque(b2, b1, lb, s.params, s.claves)
    assert "tx_duplicada" in {p.codigo for p in p2}


def test_gasto_posterior_excede_saldo_tras_bloque_previo(mundo):
    s, _ = mundo
    g = s.genesis
    lb = libro_inicial(g)
    b1 = fabricar(s, 1, "N01", [tx(m=100, ts="2026-01-01T00:00:02Z")], g["hash"])
    b2 = fabricar(s, 2, "N01", [tx(r="N03", m=50, ts="2026-01-01T00:00:03Z")], b1["hash"])
    validar_bloque(b1, g, lb, s.params, s.claves)
    assert "tx_saldo" in {p.codigo for p in validar_bloque(b2, b1, lb, s.params, s.claves)}


def test_recompensa_monto_distinto_rechazada(mundo):
    s, _ = mundo
    b = fabricar(s, 1, "N03", [tx()], s.genesis["hash"], recompensa=500)
    assert "recompensa_falsa" in {p.codigo for p in _validar(s, b)}


def test_recompensa_beneficiario_distinto_del_proponente_rechazada(mundo):
    s, _ = mundo
    b = fabricar(s, 1, "N03", [tx()], s.genesis["hash"])
    b["recompensa"]["beneficiario"] = "N09"
    sellar(b)
    assert "recompensa_falsa" in {p.codigo for p in _validar(s, b)}


def test_bloque_sin_transacciones_y_con_exceso(mundo):
    s, _ = mundo
    g = s.genesis
    assert "sin_tx" in {p.codigo for p in _validar(s, fabricar(s, 1, "N03", [], g["hash"]))}
    nueve = [tx(r="N0%d" % (2 + i % 8), m=1, ts=f"2026-01-01T00:00:{10 + i:02d}Z") for i in range(9)]
    assert "exceso_tx" in {p.codigo for p in _validar(s, fabricar(s, 1, "N03", nueve, g["hash"]))}


def test_numero_incorrecto(mundo):
    s, _ = mundo
    b = fabricar(s, 7, "N03", [tx()], s.genesis["hash"])
    assert "numero" in {p.codigo for p in _validar(s, b)}


def test_nonce_fuera_de_particion_rechazado(mundo):
    s, _ = mundo
    g = s.genesis
    # busca un nonce que SÍ cumpla el objetivo (2 ceros) pero que no sea ≡ índice del minero (mod 10)
    for nonce in range(1, 100000):
        b = fabricar(s, 1, "N03", [tx()], g["hash"], nonce=nonce)
        if b["hash"].startswith("00") and nonce % 10 != 2:
            break
    codigos = {p.codigo for p in _validar(s, b)}
    assert "pow_particion" in codigos and "pow_objetivo" not in codigos


def test_pow_objetivo_no_cumplido(mundo):
    s, _ = mundo
    b = fabricar(s, 1, "N03", [tx()], s.genesis["hash"], nonce=2)
    while b["hash"].startswith("00"):
        b = fabricar(s, 1, "N03", [tx()], s.genesis["hash"], nonce=b["nonce"] + 10)
    assert "pow_objetivo" in {p.codigo for p in _validar(s, b)}


def test_bloque_pow_con_campos_pos_rechazado(mundo):
    s, _ = mundo
    b = fabricar(s, 1, "N03", [tx()], s.genesis["hash"], apuestas={"N01": 5})
    assert "pow_campos_pos" in {p.codigo for p in _validar(s, b)}
