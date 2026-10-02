import threading

import pytest

import blockchain as bc
from blockchain import (
    Billetera, Cadena, Nodo, Ronda, alterar_copia, crear_nodos, hash_bloque, verificar_firma,
)

DIF = 3  # rápido en pruebas


def tx_de(w, **extra):
    c = {"folio": "TS-UAN-0001", "programa": "Ingeniería", "tipo": "título", "fecha_emision": "2026-10-01"}
    c.update(extra)
    return {"proposito": "registro_academico", "remitente": w.pub, "contenido": c, "hora": "2026-10-01T12:00:00Z"}


def minar_uno(cadena, w, **extra):
    tx = tx_de(w, **extra)
    r = Ronda(cadena, tx, w.firmar(tx), DIF, crear_nodos()).iniciar()
    r.esperar(60)
    assert r.terminada
    return r


@pytest.fixture
def cadena_minada():
    c, w = Cadena(), Billetera()
    for k in range(3):
        minar_uno(c, w, folio=f"TS-UAN-{k}")
    return c


# ------------------------------------------------------------------ hash
def test_hash_determinista_sin_importar_el_orden_de_claves():
    a = {"x": 1, "y": {"b": 2, "a": 3}}
    b = {"y": {"a": 3, "b": 2}, "x": 1}
    assert hash_bloque(a) == hash_bloque(b)


def test_el_campo_hash_no_entra_en_el_calculo():
    a = {"x": 1}
    assert hash_bloque(a) == hash_bloque({**a, "hash": "lo-que-sea"})
    assert hash_bloque(a) != hash_bloque({"x": 2})


def test_genesis_es_igual_en_cada_arranque():
    assert Cadena().bloques[0] == Cadena().bloques[0]
    assert Cadena().bloques[0]["hash_anterior"] == "0" * 64


# ------------------------------------------------------------------ firma
def test_firma_valida_y_alterada():
    w = Billetera()
    tx = tx_de(w)
    f = w.firmar(tx)
    assert verificar_firma(tx, f)
    tx2 = {**tx, "contenido": {**tx["contenido"], "programa": "Medicina"}}
    assert not verificar_firma(tx2, f)
    assert not verificar_firma(tx, "zz")           # no es hex
    assert not verificar_firma({"x": 1}, f)         # sin remitente


def test_firma_de_otra_llave_se_rechaza():
    w1, w2 = Billetera(), Billetera()
    tx = tx_de(w1)
    assert not verificar_firma(tx, w2.firmar(tx))


def test_billetera_se_reconstruye_desde_su_llave_privada():
    w = Billetera()
    assert Billetera.desde_hex(w.priv_hex).pub == w.pub


# ------------------------------------------------------------------ reparto de nonces
def test_el_nodo_i_prueba_i_mas_k_por_n(monkeypatch):
    vistos, fin = [], threading.Event()

    def falso(b):
        vistos.append(b["nonce"])
        if len(vistos) >= 10:
            fin.set()
        return "f" * 64

    cadena = Cadena()  # antes del parche: el génesis también calcula un hash
    monkeypatch.setattr(bc, "hash_bloque", falso)
    nodo = Nodo(1, "Carlos", 4)
    nodo.minar({"nonce": 0, "dificultad": DIF}, cadena, fin, {"bitacora": []})
    assert vistos == [1 + 4 * k for k in range(10)]


def test_las_clases_residuales_son_disjuntas_y_cubren_todo():
    n = len(bc.NODOS)
    por_nodo = [{i + k * n for k in range(500)} for i in range(n)]
    union = set().union(*por_nodo)
    assert sum(len(s) for s in por_nodo) == len(union)       # disjuntas
    assert union == set(range(n * 500))                       # sin huecos


def test_el_ganador_siempre_trae_un_nonce_de_su_particion(cadena_minada):
    for b in cadena_minada.bloques[1:]:
        assert b["nonce"] % 4 == bc.NODOS.index(b["minero"])


# ------------------------------------------------------------------ la carrera
def test_una_ronda_agrega_un_solo_bloque_y_paga_al_ganador():
    c, w = Cadena(), Billetera()
    r = minar_uno(c, w)
    assert len(c.bloques) == 2
    g = r.estado["ganador"]
    assert g in bc.NODOS and c.ultimo["minero"] == g
    assert c.saldos()[g] == bc.RECOMPENSA
    assert sum(c.saldos().values()) == bc.RECOMPENSA
    assert c.es_valida()
    assert c.pendiente is None
    assert not r.minando


def test_si_todos_encuentran_solucion_a_la_vez_solo_gana_uno(monkeypatch):
    # con este hash TODO nonce es válido: los 4 hilos chocan por el candado
    monkeypatch.setattr(bc, "hash_bloque", lambda b: "000" + "a" * 61)
    for _ in range(40):
        c, w = Cadena(), Billetera()
        tx = tx_de(w)
        r = Ronda(c, tx, w.firmar(tx), DIF, crear_nodos()).iniciar()
        r.esperar(10)
        assert len(c.bloques) == 2, "se agregó más (o menos) de un bloque"
        assert r.estado["ganador"] == c.ultimo["minero"]
        assert sum(c.saldos().values()) == bc.RECOMPENSA


def test_las_soluciones_tardias_quedan_en_la_bitacora(monkeypatch):
    monkeypatch.setattr(bc, "hash_bloque", lambda b: "000" + "a" * 61)
    c, w = Cadena(), Billetera()
    tx = tx_de(w)
    r = Ronda(c, tx, w.firmar(tx), DIF, crear_nodos()).iniciar()
    r.esperar(10)
    tipos = [e["tipo"] for e in r.estado["bitacora"]]
    assert tipos.count("ganador") == 1 and tipos.count("inicio") == 1
    assert tipos.count("obsoleta") <= 3


def test_si_la_persistencia_falla_nadie_gana_y_la_memoria_no_se_adelanta():
    c, w = Cadena(), Billetera()

    def cae(_):
        raise RuntimeError("base de datos caída")

    c.al_agregar = cae
    r = minar_uno(c, w)
    assert len(c.bloques) == 1
    assert r.estado["ganador"] is None and "base de datos" in r.estado["error"]


# ------------------------------------------------------------------ validación
def test_cadena_honesta_es_valida(cadena_minada):
    v = cadena_minada.validar()
    assert v["valida"] and v["problemas"] == [] and all(b["valido"] for b in v["bloques"])


@pytest.mark.parametrize("tipo,esperado", [
    ("contenido", {"hash"}),
    ("hash", {"hash"}),
    ("firma", {"firma", "hash"}),
    ("contenido_recalculado", {"firma", "dificultad"}),
])
def test_cada_alteracion_invalida_la_copia_y_la_original_queda_intacta(cadena_minada, tipo, esperado):
    copia, desc = alterar_copia(cadena_minada.bloques, 1, tipo)
    v = bc.validar_bloques(copia)
    assert not v["valida"]
    assert esperado <= set(v["bloques"][1]["fallas"])
    assert desc["antes"] != desc["despues"]
    assert cadena_minada.es_valida()  # la real no se tocó


def test_alterar_un_bloque_rompe_el_enlace_del_siguiente_si_se_recalcula_su_huella(cadena_minada):
    copia, _ = alterar_copia(cadena_minada.bloques, 1, "contenido_recalculado")
    v = bc.validar_bloques(copia)
    assert "enlace" in v["bloques"][2]["fallas"]


def test_no_se_acepta_una_dificultad_menor_a_la_permitida():
    c, w = Cadena(), Billetera()
    tx = tx_de(w)
    b = c.nuevo_bloque(tx, w.firmar(tx), "Derek", 1)
    b["hash"] = hash_bloque(b)
    while not b["hash"].startswith("0"):
        b["nonce"] += 4
        b["hash"] = hash_bloque(b)
    with pytest.raises(ValueError):
        c.agregar(b)


def test_cambiar_el_minero_para_robar_la_recompensa_se_detecta(cadena_minada):
    copia, _ = alterar_copia(cadena_minada.bloques, 1, "hash")
    b = copia[1]
    b["minero"] = "Bruno" if b["minero"] != "Bruno" else "Derek"
    b["hash"] = hash_bloque(b)
    fallas = set(bc.validar_bloques(copia)["bloques"][1]["fallas"])
    assert fallas & {"particion", "dificultad"}


def test_la_regla_de_contenido_invalida_el_bloque():
    c = Cadena(validar_contenido=lambda tx: "folio con formato incorrecto")
    w = Cadena(), Billetera()
    r = minar_uno(c, w[1])
    assert len(c.bloques) == 1 and "folio" in r.estado["error"]
