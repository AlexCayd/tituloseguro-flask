import pytest

from nucleo.entradas import (analizar_entero, parse_alfa, parse_config, parse_entero, parse_id,
                             parse_monto, parse_semilla, exigir_campos)
from nucleo.errores import ErrorSim


def cod(fn, *a, **k):
    with pytest.raises(ErrorSim) as e:
        fn(*a, **k)
    return e.value


@pytest.mark.parametrize("valor,razon", [
    (None, "vacio"), ("", "vacio"), ("   ", "vacio"), (True, "booleano"), (False, "booleano"),
    (float("nan"), "no_finito"), (float("inf"), "no_finito"), ("NaN", "no_finito"), ("-Infinity", "no_finito"),
    (10.0, "no_entero"), (10.5, "no_entero"), ("10.5", "no_entero"), ("1e3", "no_entero"),
    ("abc", "no_numerico"), ("12abc", "no_numerico"), ([], "no_numerico"), ({}, "no_numerico"),
    ([5], "no_numerico"), (-5, "negativo"), ("-5", "negativo"), (0, "cero"), ("0", "cero"),
    (10**10, "demasiado_grande"), ("9" * 40, "demasiado_grande"), (10**400, "demasiado_grande"),
])
def test_parse_monto_razones(valor, razon):
    e = cod(parse_monto, valor)
    assert e.codigo == "monto_invalido" and e.detalle["razon"] == razon
    assert e.mensaje and e.campo == "monto"


@pytest.mark.parametrize("valor,esperado", [(1, 1), (25, 25), ("25", 25), (" 7 ", 7), (10**9, 10**9)])
def test_parse_monto_valido(valor, esperado):
    assert parse_monto(valor) == esperado


def test_parse_entero_rangos_y_tipos():
    assert parse_entero(15, "n", 10, 20) == 15
    e = cod(parse_entero, 9, "n", 10, 20, codigo_rango="n_fuera_de_rango")
    assert e.codigo == "n_fuera_de_rango"
    assert cod(parse_entero, 21, "n", 10, 20, codigo_rango="n_fuera_de_rango").codigo == "n_fuera_de_rango"
    for malo in ("15", 15.5, True, None, [], float("nan")):
        assert cod(parse_entero, malo, "n", 10, 20).codigo == "tipo_invalido", malo


def test_exigir_campos():
    exigir_campos({"a": 1}, {"a", "b"}, ("a",))
    assert cod(exigir_campos, {"a": 1, "zzz": 2}, {"a"}).codigo == "campo_desconocido"
    assert cod(exigir_campos, {}, {"a"}, ("a",)).codigo == "campo_requerido"
    assert cod(exigir_campos, [1], {"a"}).codigo == "cuerpo_no_objeto"


def test_parse_id():
    ids = ["N01", "N02"]
    assert parse_id("N01", "x", ids) == "N01"
    for malo in ("N03", "n01", "N1", "", "N01 ", "'; DROP", "N" * 500):
        assert cod(parse_id, malo, "x", ids).codigo == "nodo_inexistente"
    assert cod(parse_id, 5, "x", ids).codigo == "tipo_invalido"


def test_parse_semilla():
    assert parse_semilla("abc-1") == "abc-1" and parse_semilla(42) == "42"
    for malo in ("", "con espacio", "a" * 41, "ñandú", None, True, [], 1.5):
        assert cod(parse_semilla, malo).codigo == "semilla_invalida"


@pytest.mark.parametrize("valor,pm", [(0.5, 500), (1, 1000), ("0.25", 250), (0.001, 1), (1.0, 1000), ("1", 1000)])
def test_parse_alfa_valido(valor, pm):
    assert parse_alfa(valor) == pm


@pytest.mark.parametrize("valor", [0, -0.1, 1.5, 0.0001, 0.1234, "x", None, True, float("nan"), float("inf"), [], "1e9"])
def test_parse_alfa_invalido(valor):
    assert cod(parse_alfa, valor).codigo == "alfa_invalido"


def test_config_n_fuera_de_rango():
    for n in (9, 21, 0, -3, 1000):
        e = cod(parse_config, "pow", {"n": n})
        assert e.codigo == "n_fuera_de_rango" and "10" in e.mensaje and "20" in e.mensaje
    for n in (10, 15, 20):
        assert parse_config("pos", {"n": n})["n"] == n


def test_config_pow_valida_dificultad_y_k():
    assert cod(parse_config, "pow", {"n": 10, "dificultad": 2}).codigo == "dificultad_fuera_de_rango"
    assert cod(parse_config, "pow", {"n": 10, "dificultad": 6}).codigo == "dificultad_fuera_de_rango"
    assert cod(parse_config, "pow", {"n": 10, "dificultad": "4"}).codigo == "tipo_invalido"
    assert cod(parse_config, "pow", {"n": 10, "k": 0}).codigo == "k_fuera_de_rango"
    assert cod(parse_config, "pow", {"n": 10, "k": 5000}).codigo == "k_fuera_de_rango"
    c = parse_config("pow", {"n": 10, "dificultad": 3})
    assert c["dificultad"] == 3 and 5 <= c["k"] <= 2000


def test_config_pos_regla_alfa_y_validadores():
    c = parse_config("pos", {"n": 10, "regla_castigo": "B", "alfa": 0.25, "n_validadores": 4})
    assert c["alfa_pm"] == 250 and c["n_validadores"] == 4 and c["regla_castigo"] == "B"
    assert parse_config("pos", {"n": 10})["regla_castigo"] == "A"
    assert cod(parse_config, "pos", {"n": 10, "regla_castigo": "Z"}).codigo == "regla_invalida"
    assert cod(parse_config, "pos", {"n": 10, "n_validadores": 11}).codigo == "n_validadores_invalido"
    assert cod(parse_config, "pos", {"n": 10, "dificultad": 3}).codigo == "campo_desconocido"
    assert cod(parse_config, "pow", {"n": 10, "alfa": 0.5}).codigo == "campo_desconocido"


def test_config_saldos_y_campos():
    c = parse_config("pow", {"n": 10, "saldos": {"N01": 5}, "saldo_inicial": 20})
    assert c["saldos"]["N01"] == 5 and c["saldos"]["N02"] == 20
    assert cod(parse_config, "pow", {"n": 10, "saldos": {"N99": 5}}).codigo == "nodo_inexistente"
    assert cod(parse_config, "pow", {"n": 10, "saldo_inicial": -1}).codigo == "saldo_invalido"
    assert cod(parse_config, "pow", {"n": 10, "saldos": [1]}).codigo == "tipo_invalido"
    assert cod(parse_config, "pow", {}).codigo == "campo_requerido"
    assert cod(parse_config, "pow", {"n": 10, "foo": 1}).codigo == "campo_desconocido"
    assert cod(parse_config, "xx", {"n": 10}).codigo == "modo_invalido"


def test_analizar_entero_nunca_lanza():
    for v in (object(), b"1", (1,), 1j, {1}, "\x00", "٣", "１２", "+", "-", ".", "e5"):
        entero, razon = analizar_entero(v, 1, 10, permitir_str=True)
        assert entero is None and razon
