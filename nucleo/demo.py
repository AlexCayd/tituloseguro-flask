"""Demo sin web: `python -m nucleo.demo --modo pos --n 20 --bloques 30 --semilla x`.

Útil para comprobar el determinismo: la misma semilla imprime siempre la misma huella de cabeza.
"""
import argparse
import time

from .entradas import parse_config
from .simulacion import Simulacion


def ejecutar(modo, n, bloques, semilla, dificultad=3, **extra):
    datos = {"n": n, "semilla": semilla, **extra}
    if modo == "pow":
        datos["dificultad"] = dificultad
    cfg = parse_config(modo, datos, dif_min=1)
    sim = Simulacion(cfg, 1)
    try:
        res = sim.autopiloto_sync(bloques)
        ref = sim.ref()
        return sim, ref, res
    finally:
        sim.cerrar()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--modo", choices=("pow", "pos"), default="pow")
    p.add_argument("--n", type=int, default=10)
    p.add_argument("--bloques", type=int, default=12)
    p.add_argument("--semilla", default="demo")
    p.add_argument("--dif", type=int, default=3, help="dificultad PoW (ceros hex)")
    a = p.parse_args()
    t = time.perf_counter()
    sim, ref, res = ejecutar(a.modo, a.n, a.bloques, a.semilla, a.dif)
    dt = time.perf_counter() - t
    print(f"modo={a.modo} n={a.n} semilla={a.semilla} bloques={res.get('producidos')} "
          f"altura={ref.altura} tiempo={dt:.2f}s")
    print(f"cabeza={ref.hash_cabeza}")
    sinc = sim.red.estado_sincronia()
    print(f"sincronizados={sinc['sincronizados']}/{sinc['total']} "
          f"consistente={sim.invariantes()['consistente']}")


if __name__ == "__main__":
    main()
