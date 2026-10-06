"""Proof of Stake: apuestas, sorteo ponderado, votación 2/3, castigos y rondas abortadas."""
import copy

import pytest

from nucleo.bloque import hash_candidato, sellar
from nucleo.consenso import castigo, sortear, umbral_cumplido
from nucleo.cripto import firmar_voto
from nucleo.errores import ErrorSim
from nucleo.validacion import validar_cadena

from .conftest import codigo_de, crear_sim


def sim_pos(n=10, tx=True, **extra):
    s = crear_sim("pos", n=n, **extra)
    if tx:
        s.crear_tx("N01", "N02", 20)
    return s


def llegar_a(s, fase):
    while s.ronda.fase != fase:
        s.avanzar_ronda()
    return s.ronda


def sim_con_proponente(prop, validadores, trampa="firma", n=10, max_seeds=300, **extra):
    """Busca (de forma determinista) una semilla en la que `prop` gana el primer sorteo."""
    for i in range(max_seeds):
        s = crear_sim("pos", n=n, semilla=f"p{i}", **extra)
        s.crear_tx("N01", "N02", 20)
        s.marcar_deshonesto(prop, True, trampa)
        r = s.iniciar_ronda("paso", validadores=validadores)
        s.avanzar_ronda()
        if r.proponente == prop:
            return s, r
        s.cerrar()
    raise AssertionError("no se encontró semilla")


# ------------------------------------------------------------------- primitivas
def test_sortear_es_reproducible():
    v = {"N01": 10, "N02": 20, "N03": 30}
    assert sortear(v, "h", 3, 0) == sortear(dict(reversed(list(v.items()))), "h", 3, 0)
    assert len({sortear(v, "h", 3, i)[0] for i in range(40)}) == 3          # el intento cambia el sorteo
    assert sortear(v, "h", 3, 0)[0] != "" and sortear(v, "h2", 3, 0)[1]["semilla"] == "h2|3|0"


def test_sortear_respeta_intervalos_acumulados():
    g, t = sortear({"N01": 10, "N02": 20, "N03": 30}, "h", 3, 0)
    assert t["intervalos"] == [{"id": "N01", "desde": 0, "hasta": 10}, {"id": "N02", "desde": 10, "hasta": 30},
                               {"id": "N03", "desde": 30, "hasta": 60}]
    iv = next(i for i in t["intervalos"] if i["id"] == g)
    assert iv["desde"] <= t["r"] < iv["hasta"] and t["A"] == 60


def test_sortear_distribucion_proporcional_a_apuestas():
    v = {"N01": 10, "N02": 20, "N03": 70}
    cuenta = {k: 0 for k in v}
    for i in range(6000):
        cuenta[sortear(v, "hash", 1, i)[0]] += 1
    for k, a in v.items():
        assert abs(cuenta[k] / 6000 - a / 100) < 0.03, cuenta


def test_sortear_ignora_apuestas_nulas_y_exige_alguna():
    assert sortear({"N01": 0, "N02": 5, "N03": -4}, "h", 1, 0)[0] == "N02"
    assert codigo_de(sortear, {"N01": 0}, "h", 1, 0) == "sin_validadores"
    assert codigo_de(sortear, {}, "h", 1, 0) == "sin_validadores"


def test_umbral_usa_aritmetica_entera_y_es_exacto():
    assert umbral_cumplido(20, 30)                      # exactamente 2/3 → se acepta
    assert not umbral_cumplido(19, 30)                  # un peso menos → se rechaza
    assert umbral_cumplido(2, 3) and not umbral_cumplido(1, 3)
    assert umbral_cumplido(2 * 10**18, 3 * 10**18) and not umbral_cumplido(2 * 10**18 - 1, 3 * 10**18)
    assert not umbral_cumplido(0, 5) and umbral_cumplido(0, 0)


def test_castigo_reglas():
    assert castigo("A", 40, 10, None) == 40
    assert castigo("B", 40, 10, 500) == 5 and castigo("B", 40, 1000, 500) == 40      # tope: la apuesta
    assert castigo("B", 40, 3, 100) == 1                                              # mínimo 1
    assert castigo("B", 7, 7, 1000) == 7
    assert castigo("X", 10, 10, 500) == -1 and castigo("A", 0, 10, None) == -1


# --------------------------------------------------------------- máquina de estados
def test_maquina_de_estados_recorre_fases_en_orden():
    s = sim_pos()
    try:
        r = s.iniciar_ronda("paso")
        fases = [r.fase]
        while r.activa:
            s.avanzar_ronda()
            fases.append(r.fase)
        assert fases == ["APUESTAS", "SORTEO", "CANDIDATO", "VOTACION", "ACEPTADO"]
        assert s.ref().altura == 1 and s.red.estado_sincronia()["en_sincronia"]
        assert codigo_de(s.avanzar_ronda) == "sin_ronda"
    finally:
        s.cerrar()


def test_ronda_auto_acepta_con_validadores_honestos():
    s = sim_pos()
    try:
        r = s.iniciar_ronda("auto")
        assert r.fase == "ACEPTADO" and r.votacion["V_si"] == r.votacion["A"]
        blq = s.ref().cadena[1]
        assert blq["proponente"] == r.proponente and blq["apuestas"] and blq["votos"] and blq["nonce"] == 0
        assert sum(v["peso"] for v in blq["votos"]) == r.votacion["A"]
        assert s.nodos[r.proponente].libro.disponible[r.proponente] > 100       # cobró la recompensa al instante
        assert s.invariantes()["consistente"]
    finally:
        s.cerrar()


def test_avanzar_con_fase_esperada_obsoleta_da_conflicto():
    s = sim_pos()
    try:
        s.iniciar_ronda("paso")
        s.avanzar_ronda("APUESTAS")
        assert codigo_de(s.avanzar_ronda, "APUESTAS") == "fase_cambio"
        assert s.ronda.fase == "SORTEO"
    finally:
        s.cerrar()


# ------------------------------------------------------------------- apuestas
def test_ronda_sin_pendientes_409_sin_bloquear_apuestas():
    s = sim_pos(tx=False)
    try:
        assert codigo_de(s.iniciar_ronda, "auto") == "sin_pendientes"
        assert s.ronda is None and s._bloqueado() == {} and s.contador_rondas == 0
    finally:
        s.cerrar()


def test_sin_validadores_con_saldo_409():
    s = crear_sim("pos", saldo_inicial=0)
    try:
        assert codigo_de(s.iniciar_ronda, "auto") == "sin_validadores" and s.ronda is None
    finally:
        s.cerrar()


def test_pedir_mas_validadores_que_elegibles_usa_los_elegibles():
    s = crear_sim("pos", saldos={"N01": 100, "N02": 100}, saldo_inicial=0, n=10)
    try:
        s.crear_tx("N01", "N03", 10)
        r = s.iniciar_ronda("paso", n_validadores=8)
        assert r.validadores == ["N01", "N02"]
    finally:
        s.cerrar()


@pytest.mark.parametrize("apuesta,codigo", [(10**6, "apuesta_excede_saldo"), (101, "apuesta_excede_saldo"),
                                            (0, "apuesta_invalida"), (-5, "apuesta_invalida"),
                                            ("5", "apuesta_invalida"), (2.5, "apuesta_invalida"),
                                            (True, "apuesta_invalida"), (None, "apuesta_invalida")])
def test_apuestas_invalidas_rechazadas(apuesta, codigo):
    s = sim_pos()
    try:
        assert codigo_de(s.iniciar_ronda, "paso", apuestas={"N03": apuesta}) == codigo
        assert s.ronda is None and s.contador_rondas == 0
    finally:
        s.cerrar()


def test_apuesta_de_no_validador_rechazada():
    s = sim_pos()
    try:
        assert codigo_de(s.iniciar_ronda, "paso", validadores=["N01", "N02"],
                         apuestas={"N05": 5}) == "apuesta_no_validador"
        assert codigo_de(s.iniciar_ronda, "paso", validadores=["N01", "N99"]) == "nodo_inexistente"
        assert codigo_de(s.iniciar_ronda, "paso", validadores=[]) == "sin_validadores"
    finally:
        s.cerrar()


def test_apuestas_invalidas_no_aplican_ninguna_atomicidad():
    s = sim_pos()
    try:
        s.iniciar_ronda("paso")
        antes = dict(s.ronda.apuestas)
        assert codigo_de(s.fijar_apuestas, {"N01": 5, "N02": 10**6}) == "apuesta_excede_saldo"
        assert s.ronda.apuestas == antes                       # (tras el rollback s.ronda es la copia restaurada)
        s.fijar_apuestas({"N01": 5, "N02": 7})
        assert s.ronda.apuestas["N01"] == 5 and s.ronda.apuestas["N02"] == 7
        s.avanzar_ronda()
        assert codigo_de(s.fijar_apuestas, {"N01": 6}) == "fase_incorrecta"      # ya están bloqueadas
    finally:
        s.cerrar()


def test_apuestas_bloqueadas_no_son_gastables_y_se_liberan():
    s = sim_pos()
    try:
        s.iniciar_ronda("paso", validadores=["N03", "N04", "N05"], apuestas={"N03": 90})
        assert s.gastable("N03") == 100                                      # aún sin bloquear
        s.avanzar_ronda()
        assert s.gastable("N03") == 10 and s.nodos["N03"].libro.disponible["N03"] == 100
        e = pytest.raises(ErrorSim, s.crear_tx, "N03", "N06", 50).value
        assert e.codigo == "saldo_insuficiente" and "bloqueados en su apuesta" in e.mensaje
        s.cancelar_ronda()
        assert s.gastable("N03") == 100 and s.crear_tx("N03", "N06", 50)
    finally:
        s.cerrar()


# --------------------------------------------------------------------- votación
def _hasta_votacion(s, apuestas, validadores):
    r = s.iniciar_ronda("paso", validadores=validadores, apuestas=apuestas)
    return llegar_a(s, "VOTACION")


def test_votacion_manual_exacta_dos_tercios_acepta():
    s = sim_pos(n=3)
    try:
        r = _hasta_votacion(s, {"N01": 10, "N02": 10, "N03": 10}, ["N01", "N02", "N03"])
        otros = [v for v in ("N01", "N02", "N03") if v != r.proponente]
        s.votar(otros[0], True)
        s.votar(otros[1], False)
        s.avanzar_ronda()
        assert r.fase == "ACEPTADO" and (r.votacion["V_si"], r.votacion["A"]) == (20, 30)
    finally:
        s.cerrar()


def test_votacion_un_peso_menos_rechaza():
    s = sim_pos(n=3)
    try:
        r = _hasta_votacion(s, {"N01": 10, "N02": 10, "N03": 10}, ["N01", "N02", "N03"])
        for v in ("N01", "N02", "N03"):
            if v != r.proponente:
                s.votar(v, False)
        s.avanzar_ronda()
        assert r.fase == "RECHAZADO" and r.votacion["V_si"] == 10 and not r.votacion["cumple"]
    finally:
        s.cerrar()


def test_el_voto_pesa_por_apuesta_no_por_cabeza():
    s = sim_pos(n=3)
    try:
        r = _hasta_votacion(s, {"N01": 20, "N02": 5, "N03": 5}, ["N01", "N02", "N03"])
        if r.proponente == "N01":                  # 20 de 30 = exactamente 2/3 con su sola firma
            s.votar("N02", False)
            s.votar("N03", False)
            s.avanzar_ronda()
            assert r.fase == "ACEPTADO"
        else:                                      # dos validadores a favor (5+5=10) NO bastan sin N01
            s.votar("N01", False)
            s.votar(next(v for v in ("N02", "N03") if v != r.proponente), True)
            s.avanzar_ronda()
            assert r.fase == "RECHAZADO" and r.votacion["V_si"] == 10
    finally:
        s.cerrar()


def test_voto_de_no_validador_rechazado():
    s = sim_pos()
    try:
        _hasta_votacion(s, {}, ["N01", "N02", "N03"])
        assert codigo_de(s.votar, "N09", True) == "voto_no_validador"
        assert codigo_de(s.votar, "N99", True) == "nodo_inexistente"
        assert "N09" not in s.ronda.votos
    finally:
        s.cerrar()


def test_voto_doble_rechazado_y_proponente_no_vota_otra_vez():
    s = sim_pos()
    try:
        r = _hasta_votacion(s, {}, ["N01", "N02", "N03"])
        assert codigo_de(s.votar, r.proponente, True) == "voto_duplicado"          # ya votó al firmar
        otro = next(v for v in ("N01", "N02", "N03") if v != r.proponente)
        s.votar(otro, False)
        assert codigo_de(s.votar, otro, True) == "voto_duplicado" and s.ronda.votos[otro]["voto"] is False
    finally:
        s.cerrar()


def test_voto_fuera_de_fase_409():
    s = sim_pos()
    try:
        assert codigo_de(s.votar, "N01", True) == "sin_ronda"
        s.iniciar_ronda("paso", validadores=["N01", "N02"])
        assert codigo_de(s.votar, "N01", True) == "fase_incorrecta"
    finally:
        s.cerrar()


# --------------------------------------------------------------- deshonestos
def test_deshonesto_firma_rechazado_y_castigado_regla_a():
    s, r = sim_con_proponente("N05", ["N01", "N02", "N03", "N04", "N05"], "firma")
    try:
        apuesta = r.apuestas["N05"]
        llegar_a(s, "RECHAZADO")
        c = r.castigos_ronda[0]
        assert not r.candidato["valido"] and r.candidato["trampa"] == "firma" and "firma" in r.candidato["motivo"]
        assert c["proponente"] == "N05" and c["monto"] == apuesta == c["apuesta"]       # regla A: toda la apuesta
        assert r.votacion["V_si"] == apuesta                                              # sólo el deshonesto a favor
        assert all(v["voto"] is False for k, v in r.votos.items() if k != "N05")   # los honestos votan en contra
        assert s.ref().altura == 0 and "N05" in r.eliminados
        assert s.gastable_base("N05") == 100 - apuesta                                   # ya se descuenta
    finally:
        s.cerrar()


def test_resorteo_excluye_al_castigado_y_castigo_queda_en_el_siguiente_bloque():
    s, r = sim_con_proponente("N05", ["N01", "N02", "N03", "N04", "N05"], "firma")
    try:
        llegar_a(s, "RECHAZADO")
        efectivo = s.gastable_base("N05")
        monto = r.castigos_ronda[0]["monto"]
        s.avanzar_ronda()                                              # RECHAZADO → nuevo sorteo
        assert r.intento == 1 and r.fase == "SORTEO" and r.proponente != "N05"
        assert "N05" not in r.sorteo["intervalos"].__repr__()
        llegar_a(s, "ACEPTADO")
        b = s.ref().cadena[1]
        assert [c["proponente"] for c in b["castigos"]] == ["N05"] and b["ronda_pos"] == r.id
        assert b["proponente"] != "N05" and "N05" in b["apuestas"] and "N05" not in {v["votante"] for v in b["votos"]}
        lb = s.ref().libro
        assert lb.quemado == monto and lb.disponible["N05"] == 100 - monto
        assert s.gastable_base("N05") == efectivo == 100 - monto         # saldo efectivo continuo (sin salto)
        assert s.castigos_pendientes == []
        assert s.invariantes()["consistente"] and s.red.estado_sincronia()["en_sincronia"]
        assert validar_cadena(copy.deepcopy(s.ref().cadena), genesis_esperado=s.genesis).valida
    finally:
        s.cerrar()


def test_deshonesto_gasto_rechazado_y_castigado():
    s, r = sim_con_proponente("N05", ["N01", "N02", "N03", "N04", "N05"], "gasto")
    try:
        llegar_a(s, "RECHAZADO")
        assert r.candidato["trampa"] == "gasto" and not r.candidato["valido"]
        assert any(p["codigo"] == "tx_saldo" for p in r.candidato["problemas"])
        assert r.castigos_ronda[0]["monto"] == r.apuestas["N05"] and s.ref().altura == 0
    finally:
        s.cerrar()


def test_deshonesto_gasto_siempre_es_mayor_que_su_saldo_aunque_reciba_creditos_en_el_folio():
    """Regresión: N02 recibe 20 créditos en el mismo folio; su «gasto falso» debe superar ese saldo."""
    s, r = sim_con_proponente("N02", ["N01", "N02", "N03", "N04", "N05"], "gasto")
    try:
        llegar_a(s, "RECHAZADO")
        assert r.candidato["trampa"] == "gasto" and not r.candidato["valido"]
        assert any(p["codigo"] == "tx_saldo" for p in r.candidato["problemas"])
        assert s.ref().altura == 0
    finally:
        s.cerrar()


def test_todos_deshonestos_nunca_logran_un_bloque_con_ninguna_semilla():
    for i in range(40):
        s = crear_sim("pos", n=10, semilla=f"x{i}")
        try:
            s.crear_tx("N01", "N02", 20)
            for n in s.ids:
                s.marcar_deshonesto(n, True, "gasto" if i % 2 else "firma")
            r = s.iniciar_ronda("auto")
            assert r.fase == "ABORTADA" and s.ref().altura == 0 and len(r.castigos_ronda) == 10, (i, r.fase)
        finally:
            s.cerrar()


def test_regla_b_castigo_proporcional_con_tope():
    s, r = sim_con_proponente("N05", ["N01", "N02", "N03", "N04", "N05"], "firma",
                              regla_castigo="B", alfa=0.1)
    try:
        llegar_a(s, "RECHAZADO")
        c = r.castigos_ronda[0]
        assert c["valor_tx"] == 20 and c["monto"] == min(c["apuesta"], 2) == 2    # ceil(0.1·20) = 2 < apuesta
        s.avanzar_ronda()
        llegar_a(s, "ACEPTADO")
        assert s.ref().libro.quemado == 2 and s.invariantes()["consistente"]
    finally:
        s.cerrar()


def test_regla_b_tope_es_la_apuesta():
    s, r = sim_con_proponente("N05", ["N01", "N02", "N03", "N04", "N05"], "gasto",
                              regla_castigo="B", alfa=1)
    try:
        llegar_a(s, "RECHAZADO")
        c = r.castigos_ronda[0]
        assert c["monto"] == c["apuesta"]                  # alfa·valor (enorme por el gasto falso) > apuesta
    finally:
        s.cerrar()


def test_deshonesto_con_mas_de_dos_tercios_no_logra_colar_bloque():
    s = sim_pos()
    try:
        for v in ("N01", "N02", "N03"):
            s.marcar_deshonesto(v, True, "firma")
        r = s.iniciar_ronda("paso", validadores=["N01", "N02", "N03"])
        llegar_a(s, "VOTACION")
        s.avanzar_ronda()
        assert r.fase == "RECHAZADO" and r.votacion["cumple"] and r.votacion["V_si"] == r.votacion["A"]
        assert "pero el bloque es inválido" in r.castigos_ronda[0]["motivo"]
        assert s.ref().altura == 0                            # el cuórum no basta: el bloque es inválido
    finally:
        s.cerrar()


def test_todos_los_validadores_castigados_ronda_abortada():
    s = sim_pos()
    try:
        s.conectar("N01", False)                 # el remitente de la tx queda fuera: su tx sigue vigente
        validadores = [i for i in s.ids if i != "N01"]
        for i in validadores:
            s.marcar_deshonesto(i, True, "firma")
        r = s.iniciar_ronda("auto", validadores=validadores, apuestas={i: 100 for i in validadores})
        assert r.fase == "ABORTADA" and "castigados" in r.resultado["motivo"]
        assert len(r.castigos_ronda) == 9 and len(s.castigos_pendientes) == 9
        assert s.ref().altura == 0 and len(s.pool) == 1 and s._bloqueado() == {}
        assert all(s.gastable_base(i) == 0 for i in validadores)       # se quedaron sin saldo
        assert codigo_de(s.iniciar_ronda, "auto") == "sin_validadores"
        assert s.invariantes()["consistente"]
        est = s.estado()
        assert est["totales"]["castigos_pendientes"] == 900 and est["ronda"]["fase"] == "ABORTADA"
    finally:
        s.cerrar()


def test_apostar_todo_deja_sin_fondos_la_propia_tx_pendiente():
    s = sim_pos()
    try:
        r = s.iniciar_ronda("auto", apuestas={"N01": 100})            # N01 es el remitente de la tx pendiente
        assert r.fase == "ABORTADA" and "Ningún registro en espera" in r.resultado["motivo"]
        assert s.pool == [] and any(e["tipo"] == "tx_descartada" for e in s.bitacora.entradas)
        assert s.castigos_pendientes == [] and s.invariantes()["consistente"]
    finally:
        s.cerrar()


def test_ronda_abortada_estado_consistente_y_pool_intacto():
    s = sim_pos(n=10)
    try:
        for i in ("N01", "N02", "N03"):
            s.marcar_deshonesto(i, True, "gasto")
        r = s.iniciar_ronda("auto", validadores=["N01", "N02", "N03"])
        assert r.fase == "ABORTADA" and s.ref().altura == 0 and len(s.pool) == 1
        # los castigos se conservan y entran en el siguiente bloque aceptado
        for i in ("N01", "N02", "N03"):
            s.marcar_deshonesto(i, False)
        s.iniciar_ronda("auto", validadores=["N04", "N05", "N06"])
        assert s.ronda.fase == "ACEPTADO"
        assert len(s.ref().cadena[1]["castigos"]) == 3 and s.castigos_pendientes == []
        assert s.invariantes()["consistente"]
        assert validar_cadena(copy.deepcopy(s.ref().cadena), genesis_esperado=s.genesis).valida
    finally:
        s.cerrar()


def test_cancelar_ronda_libera_apuestas_sin_castigo():
    s = sim_pos()
    try:
        s.iniciar_ronda("paso")
        llegar_a(s, "CANDIDATO")
        s.cancelar_ronda()
        assert s.ronda.fase == "ABORTADA" and s._bloqueado() == {} and s.castigos_pendientes == []
        assert codigo_de(s.cancelar_ronda) == "sin_ronda"
    finally:
        s.cerrar()


def test_ronda_en_curso_impide_otra_y_cambios():
    s = sim_pos()
    try:
        s.iniciar_ronda("paso")
        assert codigo_de(s.iniciar_ronda, "paso") == "ronda_en_curso"
        s.avanzar_ronda()
        assert codigo_de(s.marcar_deshonesto, "N03", True) == "ronda_en_curso"
        assert codigo_de(s.conectar, "N03", False) == "ronda_en_curso"
        assert codigo_de(s.sincronizar, "N03") == "ronda_en_curso"
        assert codigo_de(s.marcar_deshonesto, "N03", True, "mala") in ("ronda_en_curso", "trampa_invalida")
    finally:
        s.cerrar()


def test_trampa_invalida_y_modo_incorrecto():
    s = sim_pos()
    pw = crear_sim("pow")
    try:
        assert codigo_de(s.marcar_deshonesto, "N03", True, "robo") == "trampa_invalida"
        assert codigo_de(pw.marcar_deshonesto, "N03", True) == "modo_invalido"
        assert codigo_de(pw.iniciar_ronda, "auto") == "modo_invalido"
        assert codigo_de(s.minar, "manual") == "modo_invalido"
    finally:
        s.cerrar()
        pw.cerrar()


# ----------------------------------- validación de bloques PoS (votos firmados)
@pytest.fixture(scope="module")
def cadena_pos():
    s = crear_sim("pos", n=8, semilla="vp", n_validadores=5)
    s.crear_tx("N01", "N02", 10)
    s.iniciar_ronda("auto")
    yield s, copy.deepcopy(s.ref().cadena)
    s.cerrar()


def _tocar(cad, fn, resellar=True):
    c = copy.deepcopy(cad)
    fn(c[1])
    if resellar:
        sellar(c[1])
    return validar_cadena(c)


def _codigos(inf):
    return set(inf.bloques[1]["fallas"])


def test_cadena_pos_real_valida(cadena_pos):
    s, cad = cadena_pos
    assert validar_cadena(cad, genesis_esperado=s.genesis).valida


def test_bloque_con_voto_duplicado_invalido(cadena_pos):
    _, cad = cadena_pos
    assert "pos_voto_duplicado" in _codigos(_tocar(cad, lambda b: b["votos"].append(dict(b["votos"][0]))))


def test_bloque_con_voto_de_no_validador_invalido(cadena_pos):
    s, cad = cadena_pos
    ajeno = next(i for i in s.ids if i not in cad[1]["apuestas"])

    def f(b):
        hc = hash_candidato(b)
        b["votos"].append({"votante": ajeno, "peso": 5, "firma": firmar_voto(s.privs[ajeno], hc, ajeno)})
    assert "pos_voto_no_validador" in _codigos(_tocar(cad, f))


def test_bloque_con_peso_distinto_de_apuesta_invalido(cadena_pos):
    _, cad = cadena_pos
    assert "pos_voto_peso" in _codigos(_tocar(cad, lambda b: b["votos"][0].__setitem__("peso", b["votos"][0]["peso"] + 1)))


def test_bloque_con_firma_de_voto_invalida(cadena_pos):
    _, cad = cadena_pos

    def f(b):
        v = b["votos"][0]
        v["firma"] = ("1" if v["firma"][0] == "0" else "0") + v["firma"][1:]
    assert "pos_voto_firma" in _codigos(_tocar(cad, f))


def test_bloque_sin_voto_del_proponente_y_sin_cuorum(cadena_pos):
    _, cad = cadena_pos
    prop = cad[1]["proponente"]
    inf = _tocar(cad, lambda b: b.__setitem__("votos", [v for v in b["votos"] if v["votante"] != prop]))
    assert "pos_proponente_sin_voto" in _codigos(inf)
    solo = _tocar(cad, lambda b: b.__setitem__("votos", [v for v in b["votos"] if v["votante"] == prop]))
    assert "pos_quorum" in _codigos(solo)               # un solo voto de 5 validadores no llega a 2/3
    assert "pos_quorum" in _codigos(_tocar(cad, lambda b: b.__setitem__("votos", [])))


def test_bloque_con_apuesta_mayor_al_saldo_o_proponente_falso(cadena_pos):
    _, cad = cadena_pos
    v = next(iter(cad[1]["apuestas"]))
    assert "pos_apuestas" in _codigos(_tocar(cad, lambda b: b["apuestas"].__setitem__(v, 10**6)))
    otro = next(i for i in cad[1]["apuestas"] if i != cad[1]["proponente"])
    assert "pos_sorteo" in _codigos(_tocar(cad, lambda b: b.__setitem__("proponente", otro)))
    assert "pos_nonce" in _codigos(_tocar(cad, lambda b: b.__setitem__("nonce", 5)))
    assert "pos_apuestas" in _codigos(_tocar(cad, lambda b: b.__setitem__("ronda_pos", 0)))
    assert "pos_castigo" in _codigos(_tocar(cad, lambda b: b["castigos"].append(
        {"proponente": "N01", "monto": 5, "ronda_pos": 99})))


def test_intermedio_con_hash_recalculado_falla_por_consenso_pos(cadena_pos):
    _, cad = cadena_pos
    inf = _tocar(cad, lambda b: b["transacciones"][0].__setitem__("monto", 11))
    assert {"tx_firma", "pos_voto_firma"} <= _codigos(inf) and not inf.valida
