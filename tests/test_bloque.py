import copy

import pytest

from nucleo.bloque import (forma_bloque, hash_bloque, hash_bloque_seguro, hash_candidato,
                           nuevo_bloque, preparar_hash_rapido, sellar)

from .conftest import crear_sim, minar_bloque


def base():
    return nuevo_bloque(1, "2026-01-01T00:00:05Z",
                        [{"emisor": "N01", "receptor": "N02", "monto": 3, "timestamp": "2026-01-01T00:00:04Z"}],
                        ["ab" * 64], "0" * 64, "N03", 50, nonce=7)


def test_hash_excluye_campo_hash():
    b = base()
    h = hash_bloque(b)
    b["hash"] = "cualquier cosa"
    assert hash_bloque(b) == h
    assert sellar(b)["hash"] == h


def test_hash_cambia_con_cualquier_campo():
    b = base()
    h = hash_bloque(b)
    for campo, valor in [("nonce", 8), ("proponente", "N04"), ("timestamp", "2026-01-01T00:00:06Z"),
                         ("hash_anterior", "1" * 64), ("ronda_pos", 1)]:
        c = copy.deepcopy(b)
        c[campo] = valor
        assert hash_bloque(c) != h, campo


def test_hash_candidato_no_depende_de_votos():
    b = base()
    hc = hash_candidato(b)
    b["votos"] = [{"votante": "N01", "peso": 5, "firma": "cd" * 64}]
    assert hash_candidato(b) == hc
    assert hash_bloque(b) != hash_bloque(base())     # el hash final SÍ cubre los votos


def test_hash_rapido_igual_a_hash_bloque():
    b = base()
    f = preparar_hash_rapido(b)
    for nonce in list(range(0, 1000)) + [10**9, 10**15, 12345678901234567]:
        assert f(nonce) == hash_bloque({**b, "nonce": nonce})


def test_hash_bloque_seguro_con_basura():
    assert hash_bloque_seguro(None) is None
    assert hash_bloque_seguro({"a": object()}) is None


def test_forma_bloque_valida():
    b = sellar(base())
    assert forma_bloque(b) == []


@pytest.mark.parametrize("cambio", [
    {"numero": "1"}, {"numero": True}, {"numero": -1}, {"timestamp": "ayer"}, {"transacciones": {}},
    {"firma": []}, {"nonce": 1.5}, {"proponente": 3}, {"recompensa": {"monto": 1}},
    {"votos": [{"votante": "N01"}]}, {"apuestas": {"N01": "5"}}, {"castigos": [1]}, {"ronda_pos": None},
    {"hash": 5},
])
def test_forma_bloque_detecta_tipos_incorrectos(cambio):
    b = sellar(base())
    b.update(cambio)
    assert forma_bloque(b) != []


def test_forma_bloque_claves_incorrectas():
    b = sellar(base())
    del b["votos"]
    assert "faltan" in forma_bloque(b)[0]
    b = sellar(base())
    b["extra"] = 1
    assert "sobran" in forma_bloque(b)[0]
    assert forma_bloque(None) and forma_bloque([]) and forma_bloque("x")


def test_bloque_real_tiene_todos_los_campos_de_la_guia():
    s = crear_sim("pow")
    try:
        b = minar_bloque(s)
        for campo in ("numero", "timestamp", "transacciones", "firma", "hash_anterior", "nonce", "hash",
                      "proponente", "votos"):
            assert campo in b
        assert len(b["transacciones"]) >= 1 and len(b["firma"]) == len(b["transacciones"])
        assert b["hash"] == hash_bloque(b)
    finally:
        s.cerrar()
