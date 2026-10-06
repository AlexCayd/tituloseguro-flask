"""Nodos con copia propia: reglas (a)-(d), difusión, sincronización y laboratorio de ataques."""
import copy

import pytest

from nucleo import red as red_mod
from nucleo.ataques import TIPOS
from nucleo.errores import ErrorSim

from .conftest import codigo_de, crear_sim, minar_bloque


@pytest.fixture
def s():
    sim = crear_sim("pow", semilla="red")
    for i in range(4):
        minar_bloque(sim, "N0%d" % (i + 1), "N0%d" % (i + 2), 2)
    yield sim
    sim.cerrar()


def cabezas(sim):
    return {n.hash_cabeza for n in sim.nodos.values()}


def test_difusion_sincroniza_a_todos(s):
    assert len(cabezas(s)) == 1 and all(n.altura == 4 for n in s.nodos.values())
    assert s.red.estado_sincronia()["en_sincronia"]


def test_cada_nodo_tiene_su_propia_copia(s):
    a, b = s.nodos["N01"], s.nodos["N02"]
    assert a.cadena is not b.cadena and a.cadena[1] is not b.cadena[1]
    assert a.cadena == b.cadena


def test_difusion_valida_la_cadena_completa_en_cada_nodo(s, monkeypatch):
    llamadas = []
    real = red_mod.validar_cadena
    monkeypatch.setattr(red_mod, "validar_cadena",
                        lambda c, **k: (llamadas.append(len(c)), real(c, **k))[1])
    minar_bloque(s)
    # el proponente valida su cadena + los otros 9 nodos la suya, todas con 6 bloques (completas)
    assert len(llamadas) == 10 and set(llamadas) == {6}


def test_cadena_mas_corta_rechazada_conserva_la_propia(s):
    r = s.atacar("N03", "cadena_corta")
    assert not r["resultado"]["aceptada"] and r["resultado"]["codigo"] == "no_mas_larga"
    assert s.nodos["N03"].altura == 4


def test_cadena_igual_longitud_rechazada(s):
    r = s.atacar("N03", "igual_longitud")
    assert r["resultado"]["codigo"] == "no_mas_larga" and r["resultado"]["identica"]


def test_cadena_invalida_mas_larga_rechazada(s):
    r = s.atacar("N03", "saldo_insuficiente")
    res = r["resultado"]
    assert res["altura_recibida"] == 5 > res["altura_propia"]
    assert not res["aceptada"] and res["codigo"] == "cadena_invalida" and r["detectado"]


def test_genesis_distinto_rechazado(s):
    r = s.atacar("N03", "genesis_distinto")
    assert r["resultado"]["codigo"] == "genesis_distinto" and r["detectado"]


@pytest.mark.parametrize("tipo", sorted(TIPOS))
def test_ataque_rechazado_conserva_cadena_y_detecta_lo_esperado(s, tipo):
    antes = {i: n.hash_cabeza for i, n in s.nodos.items()}
    r = s.atacar("N07", tipo)
    assert r["resultado"]["aceptada"] is False, tipo
    assert r["detectado"], (tipo, r["esperado"], r["codigos"])
    assert {i: n.hash_cabeza for i, n in s.nodos.items()} == antes
    assert s.invariantes()["consistente"]


def test_ataques_con_bloque_elegido(s):
    for tipo in ("hash_alterado", "bloque_intermedio", "bloque_intermedio_recalculado", "hash_anterior_alterado"):
        for b in (1, 2, 3, 4):
            r = s.atacar("N02", tipo, b)
            assert not r["resultado"]["aceptada"] and r["detectado"], (tipo, b)
    assert codigo_de(s.atacar, "N02", "hash_alterado", 99) == "bloque_invalido"
    assert codigo_de(s.atacar, "N02", "hash_alterado", True) == "bloque_invalido"
    assert codigo_de(s.atacar, "N02", "inventado") == "tipo_invalido"
    assert codigo_de(s.atacar, "N99", "cadena_corta") == "nodo_inexistente"


def test_ataques_que_necesitan_bloques_en_cadena_vacia():
    sim = crear_sim("pow")
    try:
        assert codigo_de(sim.atacar, "N02", "bloque_intermedio") == "sin_bloques"
        for tipo in ("firma_alterada", "saldo_insuficiente", "doble_gasto_bloques", "recompensa_falsa"):
            assert sim.atacar("N02", tipo)["detectado"], tipo
    finally:
        sim.cerrar()


def test_nodo_desconectado_no_recibe_ni_mina(s):
    s.conectar("N03", False)
    minar_bloque(s)
    assert s.nodos["N03"].altura == 4 and s.nodos["N01"].altura == 5
    assert "N03" not in {n.id for n in s.red.elegibles()}
    s.crear_tx("N01", "N02", 1)
    s.minar("manual")
    assert not s.trabajo.mineros[2].activo and s.trabajo.mineros[2].estado == "inactivo"
    s.cancelar_trabajo()


def test_sincronizar_adopta_cadena_mas_larga_valida(s):
    s.conectar("N03", False)
    minar_bloque(s)
    minar_bloque(s)
    s.conectar("N03", True)
    assert s.nodos["N03"].altura == 4
    r = s.sincronizar("N03")
    assert r.aceptada and s.nodos["N03"].altura == 6
    assert s.red.estado_sincronia()["en_sincronia"]


def test_corromper_local_y_resincronizar(s):
    info = s.corromper_local("N04", 2, "contenido")
    assert not s.nodos["N04"].integra and info["validacion"]["valida"] is False
    assert "N04" not in {n.id for n in s.red.elegibles()}       # no mina ni vota con cadena corrupta
    r = s.sincronizar("N04")
    assert r.aceptada and s.nodos["N04"].integra and s.nodos["N04"].altura == 4
    assert s.red.estado_sincronia()["en_sincronia"]


def test_la_siguiente_difusion_cura_a_un_nodo_corrupto(s):
    s.corromper_local("N04", 2, "firma")
    minar_bloque(s)                       # la cadena nueva es válida y más larga: N04 la adopta
    assert s.nodos["N04"].integra and s.nodos["N04"].altura == 5


def test_propia_corrupta_se_reemplaza_por_valida_de_igual_longitud(s):
    s.corromper_local("N04", 2, "hash")
    ref = s.ref()
    assert s.nodos["N04"].altura == ref.altura
    r = s.sincronizar("N04")
    assert r.aceptada and s.nodos["N04"].hash_cabeza == ref.hash_cabeza


def test_no_se_puede_dejar_la_red_sin_referencia_ni_sin_conectados(s):
    for i in range(2, 11):
        s.conectar(f"N{i:02d}", False)
    assert codigo_de(s.conectar, "N01", False) == "ultimo_nodo_conectado"


def test_ataque_a_nodo_desconectado_o_inexistente(s):
    s.conectar("N05", False)
    assert codigo_de(s.atacar, "N05", "cadena_corta") == "nodo_desconectado"


def test_resultado_incluye_motivos_y_veredicto_por_bloque(s):
    r = s.atacar("N02", "bloque_intermedio", 2)["resultado"]
    assert r["problemas"] and all("mensaje" in p for p in r["problemas"])
    assert len(r["bloques"]) == 5 and r["bloques"][2]["valido"] is False


def test_genesis_manipulado_con_huella_recalculada_no_es_referencia(s):
    """Una cadena consistente consigo misma pero con OTRO génesis no pertenece a esta red."""
    info = s.corromper_local("N01", 0, "contenido_recalculado")
    assert s.nodos["N01"].integra is False and info["validacion"]["problemas"][0]["codigo"] == "genesis_distinto"
    assert s.red.referencia().id != "N01" and "N01" not in {n.id for n in s.red.elegibles()}
    assert s.invariantes()["comprobaciones"][0]["ok"]
