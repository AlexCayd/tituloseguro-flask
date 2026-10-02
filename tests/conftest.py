import os
import time

os.environ["BCRYPT_ROUNDS"] = "4"  # solo para pruebas: bcrypt a 12 rondas haría lentísima la suite

import pytest

from app import create_app
from models import Pending


@pytest.fixture
def app(tmp_path):
    a = create_app({
        "DATABASE_URL": f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        "SECRET_KEY": "clave-de-pruebas",
        "SEED_DEMO": True,
        "N_PENDIENTES": 12,
        "TESTING": True,
    })
    a.extensions["ts"].red.fijar_dificultad(3)  # rápido
    return a


class Cliente:
    """Cliente de pruebas que maneja la sesión y el token CSRF como lo hace el navegador."""

    def __init__(self, app):
        self.c = app.test_client()
        self.app = app
        self.c.get("/estado")  # cualquier GET crea la sesión y el token CSRF

    @property
    def token(self):
        with self.c.session_transaction() as s:
            return s["csrf"]

    def _h(self, extra=None):
        h = {"X-CSRF-Token": self.token, "X-Requested-With": "fetch"}
        h.update(extra or {})
        return h

    def entrar(self, usuario):
        r = self.c.post(f"/login/demo/{usuario}", headers=self._h())
        assert r.status_code == 200, r.data
        return self

    def post(self, url, datos=None, sin_token=False):
        h = {"X-Requested-With": "fetch"} if sin_token else self._h()
        return self.c.post(url, json=datos or {}, headers=h)

    def get(self, url):
        return self.c.get(url, headers={"X-Requested-With": "fetch"})

    def minar_y_esperar(self, tope=60):
        r = self.post("/minar")
        assert r.status_code == 200, r.data
        t = time.time()
        while time.time() - t < tope:
            e = self.get("/estado").get_json()
            if not e["minando"] and (e["ganador"] or e["error"]):
                return e
            time.sleep(0.05)
        raise AssertionError("la carrera no terminó")


@pytest.fixture
def cliente(app):
    return lambda usuario=None: Cliente(app).entrar(usuario) if usuario else Cliente(app)


@pytest.fixture
def red(app):
    return app.extensions["ts"].red


def emitir(cl, matricula="B123", programa="Derecho", tipo="título", fecha="2026-09-01"):
    return cl.post("/transaccion", {"matricula": matricula, "programa": programa,
                                    "tipo": tipo, "fecha_emision": fecha})
