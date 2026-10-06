"""Proof of Work: nonces disjuntos, un solo ganador por ronda, límite/cancelación y concurrencia."""
import threading
import time

import pytest

from nucleo.errores import ErrorSim
from nucleo.pow import Candidato, Minero, elegir_ganador, k_por_defecto
from nucleo.simulacion import Laboratorio

from .conftest import codigo_de, crear_sim, minar_bloque


def esperar(cond, tope=15):
    t = time.time()
    while time.time() - t < tope:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_elegir_ganador_menor_hash_numerico():
    cs = [Candidato(0, "N01", 5, "00ff" + "0" * 60), Candidato(1, "N02", 6, "000f" + "0" * 60),
          Candidato(2, "N03", 7, "0100" + "0" * 60)]
    gan, perd = elegir_ganador(cs)
    assert gan.id == "N02" and {c.id for c in perd} == {"N01", "N03"}


def test_empate_de_hash_gana_menor_indice():
    h = "000a" + "0" * 60
    gan, _ = elegir_ganador([Candidato(4, "N05", 1, h), Candidato(2, "N03", 2, h), Candidato(9, "N10", 3, h)])
    assert gan.id == "N03"
    assert codigo_de(elegir_ganador, []) == "sin_candidatos"


def test_nonces_disjuntos_por_minero():
    vistos = {}
    n, k = 10, 7

    def falso(i):
        def h(nonce):
            vistos.setdefault(i, []).append(nonce)
            return "f" * 64
        return h

    mineros = [Minero(i, f"N{i + 1:02d}", True, falso(i)) for i in range(n)]
    for ronda in range(5):
        for m in mineros:
            assert m.probar(ronda, k, n, 3) is None
    todos = [x for lst in vistos.values() for x in lst]
    assert len(todos) == len(set(todos)) == n * k * 5                       # nadie repite nonce
    for i, lst in vistos.items():
        assert all(x % n == i for x in lst)                                  # i, i+N, i+2N, ...
        assert lst == [i + j * n for j in range(len(lst))]                   # y sin saltos


def test_dos_validos_misma_ronda_gana_hash_menor():
    s = crear_sim("pow", dificultad=1, k=50)
    try:
        s.crear_tx("N01", "N02", 5)
        s.minar("manual")
        s.avanzar_pow(1)
        t = s.trabajo
        assert t.estado == "ganado" and t.ronda_empate and len(t.ronda_empate["candidatos"]) >= 2
        cands = t.ronda_empate["candidatos"]
        minimo = min(cands, key=lambda c: (int(c["hash"], 16)))
        assert t.ganador["hash"] == minimo["hash"] and t.ganador["id"] == minimo["id"]
        assert [c["gana"] for c in cands].count(True) == 1
        assert any(e["tipo"] == "empate_ronda" for e in s.bitacora.entradas)
        assert s.ref().altura == 1 and s.red.estado_sincronia()["en_sincronia"]    # un solo bloque
    finally:
        s.cerrar()


def test_perdedores_registrados_como_obsoletos():
    s = crear_sim("pow", dificultad=1, k=50)
    try:
        s.crear_tx("N01", "N02", 5)
        s.minar("manual")
        s.avanzar_pow(1)
        t = s.trabajo
        perdedores = {c["id"] for c in t.ronda_empate["candidatos"] if not c["gana"]}
        estados = {m.id: m.estado for m in t.mineros}
        assert all(estados[i] == "obsoleto" for i in perdedores)
        assert estados[t.ganador["id"]] == "ganador"
        assert all(e in ("ganador", "obsoleto", "detenido") for e in estados.values())   # todos se detienen
    finally:
        s.cerrar()


def test_un_solo_bloque_por_trabajo():
    s = crear_sim("pow")
    try:
        minar_bloque(s)
        assert s.ref().altura == 1 and not s.trabajo.activo
        with pytest.raises(ErrorSim) as e:
            s.trabajo.paso()
        assert e.value.codigo == "no_hay_trabajo"
        assert codigo_de(s.avanzar_pow) == "no_hay_trabajo"
        assert s.ref().altura == 1
    finally:
        s.cerrar()


def test_segundo_trabajo_mientras_hay_uno_activo_conflicto():
    s = crear_sim("pow", dificultad=5, k=5)
    try:
        s.crear_tx("N01", "N02", 1)
        s.minar("manual")
        assert codigo_de(s.minar, "manual") == "ya_minando"
        assert codigo_de(s.minar, "auto") == "ya_minando"
        assert codigo_de(s.autopiloto, 3) == "ya_minando"
        assert s.trabajo.id == 1
    finally:
        s.cerrar()


def test_limite_de_rondas_termina_sin_cambiar_cadena():
    s = crear_sim("pow", dificultad=5, k=5, max_rondas=3)
    try:
        s.crear_tx("N01", "N02", 1)
        hash0 = s.ref().hash_cabeza
        s.minar("manual")
        s.avanzar_pow(10)
        t = s.trabajo
        assert t.estado == "limite" and "límite" in t.mensaje and t.ronda == 3
        assert s.ref().hash_cabeza == hash0 and len(s.pool) == 1             # cadena y pool intactos
        assert all(m.estado == "detenido" for m in t.mineros)
        s.crear_tx("N02", "N03", 1)                                           # y se puede volver a minar
        s.minar("manual")
        assert s.trabajo.id == 2 and s.trabajo.activo
    finally:
        s.cerrar()


def test_cancelacion_deja_estado_consistente():
    s = crear_sim("pow", dificultad=5, k=5)
    try:
        s.crear_tx("N01", "N02", 1)
        h = s.huella_estado()
        s.minar("manual")
        s.avanzar_pow(2)
        s.cancelar_trabajo()
        assert s.trabajo.estado == "cancelado" and len(s.pool) == 1 and s.ref().altura == 0
        assert s.invariantes()["consistente"]
        assert codigo_de(s.cancelar_trabajo) == "no_hay_trabajo"
        assert codigo_de(s.avanzar_pow) == "no_hay_trabajo"
    finally:
        s.cerrar()


def test_trabajo_sin_pendientes_lanza_errorsim():
    s = crear_sim("pow")
    try:
        assert codigo_de(s.minar, "manual") == "sin_pendientes" and s.trabajo is None
    finally:
        s.cerrar()


def test_minar_12_bloques_seguidos_d2():
    s = crear_sim("pow", n=10)
    try:
        t = time.time()
        res = s.autopiloto_sync(12)
        assert res["producidos"] == 12 and time.time() - t < 10
        assert s.ref().altura == 12 and s.red.estado_sincronia()["en_sincronia"]
        assert s.invariantes()["consistente"]
    finally:
        s.cerrar()


def test_hilo_automatico_mina_y_se_detiene():
    s = crear_sim("pow", pausa_ms=0)
    try:
        s.crear_tx("N01", "N02", 3)
        s.minar("auto")
        assert esperar(lambda: not s.trabajo.activo)
        assert s.trabajo.estado == "ganado" and s.ref().altura == 1 and not s.pool
        assert s.red.estado_sincronia()["en_sincronia"]
    finally:
        s.cerrar()


def test_minar_concurrente_solo_una_peticion_procede():
    s = crear_sim("pow", dificultad=5, k=5, pausa_ms=20)
    try:
        s.crear_tx("N01", "N02", 1)
        resultados = []
        barrera = threading.Barrier(8)

        def intento():
            barrera.wait()
            resultados.append(codigo_de(s.minar, "auto"))

        hilos = [threading.Thread(target=intento) for _ in range(8)]
        [h.start() for h in hilos]
        [h.join() for h in hilos]
        assert resultados.count(None) == 1 and resultados.count("ya_minando") == 7
        assert s.contador_trabajos == 1
    finally:
        s.cerrar()


def test_autopiloto_pow_encadena_carreras_en_hilo():
    s = crear_sim("pow", pausa_ms=0)
    try:
        r = s.autopiloto(4)
        assert r["asincrono"]
        assert esperar(lambda: s.ref().altura == 4 and not s.trabajo.activo)
        assert s.invariantes()["consistente"]
    finally:
        s.cerrar()


def test_reiniciar_con_minado_en_curso_cancela_el_hilo():
    lab = Laboratorio()
    from nucleo.entradas import parse_config
    cfg = parse_config("pow", {"n": 10, "dificultad": 5, "k": 5, "pausa_ms": 5}, dif_min=1)
    vieja = lab.crear("pow", cfg)
    vieja.crear_tx("N01", "N02", 1)
    vieja.minar("auto")
    assert vieja.trabajo.activo
    nueva = lab.crear("pow", cfg)
    assert vieja.cerrada and nueva.epoca == vieja.epoca + 1 and nueva.ref().altura == 0
    assert esperar(lambda: not vieja._hilo.is_alive(), 5)
    antes = vieja.huella_estado()
    time.sleep(0.1)
    assert vieja.huella_estado() == antes and nueva.ref().altura == 0       # el hilo viejo no muta nada
    assert codigo_de(vieja.crear_tx, "N01", "N02", 1) == "sin_simulacion"   # la instancia vieja ya no acepta
    lab.cerrar_todo()


def test_k_por_defecto_acotado():
    assert 5 <= k_por_defecto(3, 20) <= 2000 and k_por_defecto(5, 10) <= 2000 and k_por_defecto(1, 20) == 5
