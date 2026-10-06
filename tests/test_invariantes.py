"""Secuencias aleatorias (con semilla) de acciones: el libro siempre conserva el suministro."""
import random

import pytest

from nucleo.ataques import TIPOS, TIPOS_CORRUPCION
from nucleo.errores import ErrorSim

from .conftest import crear_sim

CRITICAS = {"conservacion", "sin_saldos_negativos", "apuestas_cubiertas", "pendientes_validas"}


def verificar(sim, paso):
    malas = [c for c in sim.invariantes()["comprobaciones"] if c["nombre"] in CRITICAS and not c["ok"]]
    assert not malas, (paso, malas)


def accion_pow(sim, rng):
    ids = sim.ids
    a = rng.randrange(8)
    if a == 0:
        sim.crear_tx_aleatorias(rng.randint(1, 3))
    elif a == 1:
        sim.crear_tx(rng.choice(ids), rng.choice(ids), rng.randint(1, 150))
    elif a in (2, 3):
        sim.minar("manual")
        while sim.trabajo.activo:
            sim.avanzar_pow(40)
    elif a == 4:
        sim.conectar(rng.choice(ids), rng.random() < 0.6)
    elif a == 5:
        sim.sincronizar(rng.choice(ids))
    elif a == 6:
        sim.atacar(rng.choice(ids), rng.choice(sorted(TIPOS)), rng.choice([None, 0, 1, 2, 3]))
    else:
        sim.corromper_local(rng.choice(ids), rng.randint(0, 3), rng.choice(TIPOS_CORRUPCION))


def accion_pos(sim, rng):
    ids = sim.ids
    a = rng.randrange(10)
    if a == 0:
        sim.crear_tx_aleatorias(rng.randint(1, 3))
    elif a == 1:
        sim.crear_tx(rng.choice(ids), rng.choice(ids), rng.randint(1, 150))
    elif a in (2, 3):
        sim.iniciar_ronda("auto")
    elif a == 4:
        sim.iniciar_ronda("paso")
        for _ in range(rng.randint(0, 6)):
            sim.avanzar_ronda()
    elif a == 5:
        sim.votar(rng.choice(ids), rng.random() < 0.5)
    elif a == 6:
        sim.marcar_deshonesto(rng.choice(ids), rng.random() < 0.5, rng.choice([None, "firma", "gasto"]))
    elif a == 7:
        sim.conectar(rng.choice(ids), rng.random() < 0.6)
    elif a == 8:
        sim.cancelar_ronda() if rng.random() < 0.4 else sim.sincronizar(rng.choice(ids))
    else:
        sim.atacar(rng.choice(ids), rng.choice(sorted(TIPOS)), rng.choice([None, 0, 1, 2]))


@pytest.mark.parametrize("modo", ["pow", "pos"])
@pytest.mark.parametrize("semilla", range(15))
def test_conservacion_de_suministro_en_secuencias_aleatorias(modo, semilla):
    rng = random.Random(f"{modo}{semilla}")
    sim = crear_sim(modo, n=rng.choice([3, 5, 10]), semilla=f"inv{semilla}",
                    saldo_inicial=rng.choice([20, 100]), **({"k": 30} if modo == "pow" else {}))
    try:
        for paso in range(30):
            try:
                (accion_pow if modo == "pow" else accion_pos)(sim, rng)
            except ErrorSim:
                pass          # rechazos esperados: lo que importa es que no dejan nada a medias
            verificar(sim, (modo, semilla, paso))
    finally:
        sim.cerrar()
