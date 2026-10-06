import time

from nucleo.demo import ejecutar


def test_n20_30_bloques_pos_validados_por_todos_los_nodos():
    t = time.time()
    sim, ref, res = ejecutar("pos", 20, 30, "rend")
    dt = time.time() - t
    assert res["producidos"] == 30 and ref.altura == 30 and dt < 15, dt
    sinc = sim.red.estado_sincronia()
    assert sinc["en_sincronia"] and sinc["sincronizados"] == 20
    assert all(n.integra and n.altura == 30 for n in sim.nodos.values())


def test_n20_pow_d3_12_bloques():
    t = time.time()
    sim, ref, res = ejecutar("pow", 20, 12, "rendpow", 3)
    assert res["producidos"] == 12 and ref.altura == 12 and time.time() - t < 15
    assert sim.red.estado_sincronia()["en_sincronia"]
