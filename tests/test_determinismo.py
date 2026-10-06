"""Misma semilla + mismas acciones ⇒ misma simulación (cadena, huellas, sorteos)."""
import os
import subprocess
import sys
import time

from nucleo.demo import ejecutar

from .conftest import codigo_de, crear_sim


def cabeza(modo, n=10, bloques=6, semilla="det", **kw):
    sim, ref, _ = ejecutar(modo, n, bloques, semilla, 2, **kw)
    return ref.hash_cabeza, [b["hash"] for b in ref.cadena]


def test_misma_semilla_misma_cadena_pow():
    assert cabeza("pow") == cabeza("pow")


def test_misma_semilla_misma_cadena_pos():
    assert cabeza("pos") == cabeza("pos")


def test_semilla_distinta_cadena_distinta():
    assert cabeza("pow", semilla="a")[0] != cabeza("pow", semilla="b")[0]
    assert cabeza("pos", semilla="a")[0] != cabeza("pos", semilla="b")[0]


def test_la_semilla_cambia_las_claves_y_el_genesis():
    a, b = crear_sim("pow", semilla="a"), crear_sim("pow", semilla="b")
    try:
        assert a.claves != b.claves and a.genesis["hash"] != b.genesis["hash"]
        assert a.genesis["genesis"]["semilla"] == "a"
    finally:
        a.cerrar(), b.cerrar()


def test_auto_y_manual_producen_la_misma_cadena_pow():
    def correr(auto):
        s = crear_sim("pow", semilla="am", pausa_ms=0)
        try:
            for i in range(4):
                s.crear_tx(f"N0{i + 1}", f"N0{i + 2}", 3)
                if auto:
                    s.minar("auto")
                    t = time.time()
                    while s.trabajo.activo and time.time() - t < 15:
                        time.sleep(0.005)
                else:
                    s.minar("manual")
                    while s.trabajo.activo:
                        s.avanzar_pow(7)
                assert s.trabajo.estado == "ganado"
            return [b["hash"] for b in s.ref().cadena]
        finally:
            s.cerrar()
    assert correr(True) == correr(False)


def test_auto_y_paso_producen_la_misma_cadena_pos():
    def correr(modo):
        s = crear_sim("pos", semilla="ap", n=10)
        try:
            for i in range(3):
                s.crear_tx("N01", "N02", 4)
                r = s.iniciar_ronda(modo)
                while r.activa:
                    s.avanzar_ronda()
                    r = s.ronda
                assert r.fase == "ACEPTADO"
            return [b["hash"] for b in s.ref().cadena]
        finally:
            s.cerrar()
    assert correr("auto") == correr("paso")


def test_determinismo_entre_procesos():
    cmd = [sys.executable, "-m", "nucleo.demo", "--modo", "pos", "--n", "12", "--bloques", "6", "--semilla", "xp"]
    salidas = []
    for h in ("1", "777"):
        env = {**os.environ, "PYTHONHASHSEED": h}
        out = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120,
                             cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))).stdout
        salidas.append([ln for ln in out.splitlines() if ln.startswith("cabeza=")])
    assert salidas[0] and salidas[0] == salidas[1]


def test_peticion_rechazada_no_consume_reloj_ni_azar_pow():
    def correr(con_ruido):
        s = crear_sim("pow", semilla="ruido")
        try:
            s.crear_tx("N01", "N02", 5)
            if con_ruido:                      # rechazos: no avanzan el reloj lógico ni cambian la cadena
                assert codigo_de(s.crear_tx, "N01", "N01", 5) == "mismo_nodo"
                assert codigo_de(s.crear_tx, "N01", "N02", 10**6) == "saldo_insuficiente"
                assert codigo_de(s.crear_tx, "N99", "N02", 5) == "nodo_inexistente"
                assert codigo_de(s.crear_tx, "N01", "N02", 5, timestamp="2026-01-01T00:00:01Z", firma="0" * 128)                     == "tx_firma_invalida"
            s.crear_tx("N03", "N04", 5)
            s.minar("manual")
            while s.trabajo.activo:
                s.avanzar_pow(9)
            return s.ref().cadena[-1]["hash"], s.reloj.n
        finally:
            s.cerrar()
    assert correr(False) == correr(True)


def test_peticion_rechazada_no_consume_reloj_ni_azar_pos():
    def correr(con_ruido):
        s = crear_sim("pos", semilla="ruido2", n=10)
        try:
            s.crear_tx("N01", "N02", 5)
            if con_ruido:
                assert codigo_de(s.iniciar_ronda, "auto", apuestas={"N03": 10**6}) == "apuesta_excede_saldo"
                assert codigo_de(s.iniciar_ronda, "auto", validadores=["N77"]) == "nodo_inexistente"
            r = s.iniciar_ronda("auto")
            return r.proponente, s.ref().cadena[-1]["hash"], s.reloj.n, s.contador_rondas
        finally:
            s.cerrar()
    assert correr(False) == correr(True)
