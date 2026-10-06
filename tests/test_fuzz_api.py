"""Fuzz determinista: ninguna ruta, con ningún cuerpo ni parámetro, puede devolver 5xx ni traceback."""
import json
import random
import re

import pytest

from .conftest import Api

VALORES = [None, True, False, 0, -1, 1, 3, 5, 10, 15, 21, 100, 10**12, 10**30, 1.5, -0.0, "", " ", "x", "N01",
           "N02", "N99", "n01", "auto", "paso", "manual", "firma", "gasto", "hash", "contenido", "A", "B",
           "firma_alterada", "otra_clave", "cadena_corta", "bloque_intermedio", "doble_gasto_mismo_bloque",
           "APUESTAS", "VOTACION", "2026-01-01T00:00:09Z", "0" * 128, [], ["N01"], ["N01", "N02", "N03"],
           [None], [[]], {}, {"N01": 5}, {"N01": -5, "N02": "x"}, {"a": {"b": [1]}}, "'; DROP TABLE x;--",
           "<script>alert(1)</script>", "ñ" * 50, "\u0000", "9" * 50]
CAMPOS = ["n", "semilla", "saldo_inicial", "saldos", "recompensa", "dificultad", "k", "max_rondas", "pausa_ms",
          "n_validadores", "regla_castigo", "alfa", "emisor", "receptor", "monto", "timestamp", "firma", "trampa",
          "cantidad", "ejecucion", "rondas", "modo", "validadores", "apuestas", "fase_esperada", "votante", "voto",
          "activo", "conectado", "destino", "tipo", "bloque", "nodo", "bloques", "epoca", "extra"]
CLAVES_QUERY = ["desde", "limite", "epoca", "desde_seq", "nivel", "tipo"]
BASICOS = [{}, {"n": 12}, {"n": 15, "dificultad": 3}, {"emisor": "N01", "receptor": "N02", "monto": 5},
           {"cantidad": 3}, {"bloques": 2}, {"conectado": False}, {"activo": True, "trampa": "firma"},
           {"destino": "N03", "tipo": "cadena_corta"}, {"nodo": "N02", "bloque": 1, "tipo": "hash"},
           {"modo": "paso"}, {"votante": "N01", "voto": True}, {"apuestas": {"N01": 5}}, {"rondas": 5},
           {"ejecucion": "manual"}, {"fase_esperada": "SORTEO"}]
CRUDOS = [b"", b"{", b"[]", b"null", b"\xff\xfe", b'{"n": NaN}', b"[" * 3000, b'{"a":' * 500, b"x" * 2000,
          '{"n": 1e999}'.encode()]


def cuerpos(rng):
    out = list(BASICOS)
    for _ in range(12):
        out.append({rng.choice(CAMPOS): rng.choice(VALORES) for _ in range(rng.randint(1, 5))})
    return out


def rutas(app):
    for r in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
        if r.endpoint == "static":
            continue
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            yield r.rule, m


def instanciar(rule, rng):
    def sub(m):
        nombre = m.group(1)
        return rng.choice(["pow", "pos", "pow", "pos", "xyz"] if nombre == "modo" else
                          ["N01", "N02", "N05", "N99", "abc", "N1"])
    return re.sub(r"<(\w+)>", sub, rule)


def barrido(api, rng, rondas):
    app = api.app
    for rule, metodo in rutas(app):
        for i in range(rondas):
            url = instanciar(rule, rng)
            if metodo == "GET":
                q = "&".join(f"{rng.choice(CLAVES_QUERY)}={rng.choice(['', '0', '1', '5', '-1', 'x', '999999', 'aviso', 'ok', '1e3'])}"
                             for _ in range(rng.randint(0, 3)))
                r = api.c.get(url + ("?" + q if q else ""))
            else:
                if i % 6 == 5:
                    r = api.c.open(url, method=metodo, data=rng.choice(CRUDOS), content_type="application/json")
                else:
                    cuerpo = rng.choice(cuerpos(rng))
                    r = api.c.open(url, method=metodo, json=cuerpo)
            texto = r.get_data(as_text=True)
            assert r.status_code < 500, (metodo, url, r.status_code, texto[:300])
            assert "Traceback" not in texto, (metodo, url)
            if url.startswith("/api/"):
                assert r.get_json() is not None, (metodo, url, texto[:200])


def crear_mundo(api):
    api.crear("pow", 10, dificultad=2, pausa_ms=0)
    api.crear("pos", 10)
    for modo in ("pow", "pos"):
        for e, r in (("N01", "N02"), ("N03", "N04"), ("N05", "N06")):
            api.post(f"/api/{modo}/tx", {"emisor": e, "receptor": r, "monto": 7})


def comprobar_invariantes(api):
    for modo in ("pow", "pos"):
        if not api.estado(modo)["existe"]:
            continue
        inv = api.get(f"/api/{modo}/invariantes").get_json()
        malas = [c for c in inv["comprobaciones"]
                 if c["nombre"] in ("conservacion", "sin_saldos_negativos", "apuestas_cubiertas",
                                    "pendientes_validas") and not c["ok"]]
        assert not malas, (modo, malas)


def test_fuzz_todas_las_rutas_nunca_500_sin_simulacion(api):
    barrido(api, random.Random(0), 18)


def test_fuzz_todas_las_rutas_nunca_500_con_simulaciones(api):
    crear_mundo(api)
    barrido(api, random.Random(1), 18)
    comprobar_invariantes(api)


def test_estado_consistente_tras_el_fuzz(api):
    for semilla in (2, 3):
        crear_mundo(api)
        barrido(api, random.Random(semilla), 10)
        comprobar_invariantes(api)
        for modo in ("pow", "pos"):
            e = api.estado(modo)
            if e["existe"]:
                for n in e["nodos"]:
                    c = api.get(f"/api/{modo}/nodos/{n['id']}/cadena?limite=100").get_json()
                    assert c["ok"] and c["total"] >= 1
