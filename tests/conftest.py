import pytest

from nucleo.bloque import nuevo_bloque, sellar
from nucleo.cripto import firmar_tx
from nucleo.entradas import parse_config
from nucleo.errores import ErrorSim
from nucleo.simulacion import Simulacion


def crear_sim(modo="pow", n=10, semilla="t", **extra):
    """Simulación del núcleo (sin Flask). El núcleo admite dificultad 1..8 para ir rápido."""
    datos = {"n": n, "semilla": semilla, **extra}
    if modo == "pow":
        datos.setdefault("dificultad", 2)
    cfg = parse_config(modo, datos, n_min=2, dif_min=1)
    return Simulacion(cfg, 1)


def minar_bloque(sim, e="N01", r="N02", monto=1):
    """Crea una transacción y mina un bloque completo (manual, determinista)."""
    sim.crear_tx(e, r, monto)
    sim.minar("manual")
    while sim.trabajo.activo:
        sim.avanzar_pow(50)
    assert sim.trabajo.estado == "ganado", sim.trabajo.mensaje
    return sim.ref().cadena[-1]


def ronda_pos(sim, modo="auto", **kw):
    return sim.iniciar_ronda(modo, **kw)


def codigo_de(fn, *a, **k):
    """Ejecuta fn y devuelve el código del ErrorSim lanzado (o None si no lanzó)."""
    try:
        fn(*a, **k)
    except ErrorSim as e:
        return e.codigo
    return None


def fabricar(sim, numero, proponente, txs, hash_anterior, *, recompensa=None, **kw):
    """Bloque sellado con transacciones firmadas por sus emisores (sin trabajo ni votos)."""
    firmas = [firmar_tx(sim.privs[t["emisor"]], t) for t in txs]
    b = nuevo_bloque(numero, f"2026-01-01T00:00:{numero:02d}Z", txs, firmas, hash_anterior,
                     proponente, sim.params["recompensa"], **kw)
    if recompensa is not None:
        b["recompensa"]["monto"] = recompensa
    return sellar(b)


@pytest.fixture
def sim_pow():
    s = crear_sim("pow")
    yield s
    s.cerrar()


@pytest.fixture
def sim_pos():
    s = crear_sim("pos")
    yield s
    s.cerrar()


# ------------------------------------------------------------------ API (Flask)
import time

from app import create_app


@pytest.fixture
def app():
    a = create_app({"TESTING": True, "DIF_MIN": 1})
    yield a
    a.extensions["lab"].cerrar_todo()


class Api:
    """Cliente de pruebas con atajos JSON."""

    def __init__(self, app):
        self.app = app
        self.c = app.test_client()

    def get(self, ruta, **kw):
        return self.c.get(ruta, **kw)

    def post(self, ruta, datos=None, **kw):
        return self.c.post(ruta, json={} if datos is None else datos, **kw)

    def delete(self, ruta, **kw):
        return self.c.delete(ruta, **kw)

    def crear(self, modo="pow", n=10, **extra):
        if modo == "pow":
            extra.setdefault("dificultad", 2)
        r = self.post(f"/api/{modo}/simulacion", {"n": n, **extra})
        assert r.status_code == 201, r.get_json()
        return r.get_json()

    def estado(self, modo="pow"):
        return self.get(f"/api/{modo}/estado").get_json()

    def esperar(self, modo, cond, tope=15):
        t = time.time()
        while time.time() - t < tope:
            e = self.estado(modo)
            if cond(e):
                return e
            time.sleep(0.02)
        raise AssertionError("tiempo agotado esperando el estado")


@pytest.fixture
def api(app):
    return Api(app)


def err(resp, status, codigo):
    """Comprueba el contrato de error: estado HTTP, JSON {ok:false, error, codigo} y sin traceback."""
    assert resp.status_code == status, (resp.status_code, resp.get_data(as_text=True)[:300])
    j = resp.get_json()
    assert j["ok"] is False and j["codigo"] == codigo and j["error"], j
    assert "Traceback" not in resp.get_data(as_text=True)
    return j
