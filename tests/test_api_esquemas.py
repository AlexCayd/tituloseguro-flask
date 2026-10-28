"""API /api/esquemas/…: flujos completos de los cinco esquemas, rechazos explicados y fuzz propio."""
import random
import secrets

import pytest

from .conftest import err

IDS = ["N01", "N02", "N03", "N04", "N05"]


def j(resp, status=200):
    assert resp.status_code == status, (resp.status_code, resp.get_data(as_text=True)[:300])
    d = resp.get_json()
    assert d["ok"] is True
    return d


def test_catalogo_lista_los_cinco(api):
    d = j(api.get("/api/esquemas"))
    assert [e["id"] for e in d["esquemas"]] == ["shamir", "qr", "zk", "anillo", "schnorr"]
    assert all(e["documento"].startswith("esquemas/") for e in d["esquemas"])


# ------------------------------------------------------------------- 1 · Shamir
def test_shamir_flujo_completo(api):
    d = j(api.post("/api/esquemas/shamir/repartir", {"secreto": "Llave maestra 2026", "k": 3, "n": 5}))
    assert len(d["partes"]) == 5 and d["grado"] == 2
    p = d["partes"]
    abierto = j(api.post("/api/esquemas/shamir/reconstruir", {"partes": [p[0], p[3], p[4]], "k": 3, "huella": d["huella"]}))
    assert abierto["veredicto"] == "abierto" and abierto["resultado"]["texto"] == "Llave maestra 2026"
    poco = j(api.post("/api/esquemas/shamir/reconstruir", {"partes": p[:2], "k": 3, "huella": d["huella"]}))
    assert poco["veredicto"] == "insuficiente" and poco["faltan"] == 1


def test_shamir_rechazos(api):
    err(api.post("/api/esquemas/shamir/repartir", {"secreto": "x", "k": 6, "n": 5}), 422, "fuera_de_rango")
    err(api.post("/api/esquemas/shamir/repartir", {"secreto": "", "k": 2, "n": 3}), 422, "texto_vacio")
    err(api.post("/api/esquemas/shamir/repartir", {"secreto": "ñ" * 31, "k": 2, "n": 3}), 422, "texto_largo")
    err(api.post("/api/esquemas/shamir/repartir", {"secreto": "a\u0000b", "k": 2, "n": 3}), 422, "texto_invalido")
    err(api.post("/api/esquemas/shamir/repartir", {"secreto": "x", "k": 2}), 422, "campo_requerido")
    d = j(api.post("/api/esquemas/shamir/repartir", {"secreto": "abc", "k": 2, "n": 3}))
    dup = [d["partes"][0], d["partes"][0]]
    err(api.post("/api/esquemas/shamir/reconstruir", {"partes": dup, "k": 2}), 422, "partes_invalidas")
    err(api.post("/api/esquemas/shamir/reconstruir", {"partes": [{"x": 1, "y": "zz"}], "k": 2}), 422, "hex_invalido")
    err(api.post("/api/esquemas/shamir/reconstruir", {"partes": [{"x": 1, "y": "f" * 132}], "k": 2}), 422, "hex_invalido")


def test_shamir_juguete_por_defecto_es_el_del_documento(api):
    d = j(api.post("/api/esquemas/shamir/juguete", {}))
    assert d["reconstruido"] == 13 and [f["y"] for f in d["tabla"]] == [24, 12, 8, 12, 24]
    d = j(api.post("/api/esquemas/shamir/juguete", {"elegidas": [2, 5]}))
    assert len(d["candidatos"]) == 31
    err(api.post("/api/esquemas/shamir/juguete", {"elegidas": [1, 1, 2]}), 422, "parametros_invalidos")


# ------------------------------------------------------------------- 2 · Anillo
def test_anillo_firmar_verificar_y_manipular(api):
    base = {"semilla": "s1", "anillo": IDS, "mensaje": "El título 4471 es falso"}
    f = j(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": "N03", "variante": "aos"}))
    assert "firmante" not in f
    v = j(api.post("/api/esquemas/anillo/verificar", {**base, "firma": f["firma"]}))
    assert v["valida"] and v["probabilidad"]["den"] == 5
    assert not j(api.post("/api/esquemas/anillo/verificar", {**base, "mensaje": "otro", "firma": f["firma"]}))["valida"]
    otro = {**base, "anillo": IDS[:4] + ["N09"]}
    assert not j(api.post("/api/esquemas/anillo/verificar", {**otro, "firma": f["firma"]}))["valida"]
    corto = {**base, "anillo": IDS[:4]}
    assert not j(api.post("/api/esquemas/anillo/verificar", {**corto, "firma": f["firma"]}))["valida"]
    otra_semilla = {**base, "semilla": "s2"}       # otras claves: la firma no es de este grupo
    assert not j(api.post("/api/esquemas/anillo/verificar", {**otra_semilla, "firma": f["firma"]}))["valida"]


def test_anillo_urna_lsag(api):
    base = {"semilla": "urna", "anillo": IDS}
    previas = []
    for votante, voto, esperado in (("N01", "sí", True), ("N02", "no", True), ("N01", "no", False)):
        f = j(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": votante, "mensaje": voto, "variante": "lsag"}))
        u = j(api.post("/api/esquemas/anillo/urna", {**base, "mensaje": voto, "firma": f["firma"],
                                                     "imagenes_previas": previas}))
        assert u["aceptada"] is esperado
        if u["aceptada"]:
            previas.append(u["imagen"])
    assert len(previas) == 2


def test_anillo_rechazos(api):
    base = {"semilla": "s", "anillo": IDS, "mensaje": "m", "variante": "aos"}
    err(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": "N09"}), 422, "firmante_fuera")
    err(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": "N01", "anillo": ["N01"]}), 422, "fuera_de_rango")
    err(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": "N01", "anillo": ["N01", "N01"]}), 422, "repetido")
    err(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": "N01", "anillo": ["N01", "N99"]}), 422,
        "institucion_inexistente")
    err(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": "N01", "variante": "rst"}), 422, "opcion_invalida")
    v = {"semilla": "s", "anillo": IDS, "mensaje": "m"}
    err(api.post("/api/esquemas/anillo/verificar", {**v, "firma": "hola"}), 422, "firma_mal_formada")
    f = j(api.post("/api/esquemas/anillo/firmar", {**base, "firmante": "N01"}))["firma"]
    err(api.post("/api/esquemas/anillo/urna", {**v, "firma": f}), 422, "firma_mal_formada")    # urna exige LSAG


# --------------------------------------------------------- 3 · Conocimiento cero
def test_zk_schnorr_interactivo_por_la_api(api):
    b = {"semilla": "s", "institucion": "N02"}
    Y = j(api.post("/api/esquemas/zk/clave", b))["Y"]
    T = j(api.post("/api/esquemas/zk/compromiso", {**b, "ronda": "r1"}))["T"]
    c1, c2 = secrets.token_hex(32), secrets.token_hex(32)
    a = j(api.post("/api/esquemas/zk/responder", {**b, "ronda": "r1", "reto": c1}))
    assert a["T"] == T and a["Y"] == Y and a["verificacion"]["ok"]
    imp = j(api.post("/api/esquemas/zk/responder", {**b, "ronda": "r9", "reto": c1, "impostor": True}))
    assert not imp["verificacion"]["ok"]
    bb = j(api.post("/api/esquemas/zk/responder", {**b, "ronda": "r1", "reto": c2}))
    x = j(api.post("/api/esquemas/zk/extraer", {**b, "transcripciones": [{"c": a["c"], "s": a["s"]},
                                                                          {"c": bb["c"], "s": bb["s"]}]}))
    assert x["coincide"] and x["x_extraida"] == x["x_real"]
    assert j(api.post("/api/esquemas/zk/simular", b))["verifica"]


def test_zk_no_interactivo_por_la_api(api):
    b = {"semilla": "s", "institucion": "N07"}
    p = j(api.post("/api/esquemas/zk/probar", {**b, "mensaje": "inicio de sesión"}))
    ok = {"Y": p["Y"], "mensaje": "inicio de sesión", "T": p["T"], "s": p["s"]}
    assert j(api.post("/api/esquemas/zk/verificar", ok))["valida"]
    assert not j(api.post("/api/esquemas/zk/verificar", {**ok, "mensaje": "otro"}))["valida"]
    err(api.post("/api/esquemas/zk/verificar", {**ok, "T": "02" + "00" * 32}), 422, "punto_invalido")


def test_zk_coloreo_por_la_api(api):
    g = j(api.get("/api/esquemas/zk/coloreo"))
    assert len(g["vertices"]) == 7 and len(g["aristas"]) == 14 and g["rondas_recomendadas"] == 187
    c = j(api.post("/api/esquemas/zk/coloreo/compromiso", {"ronda": "a"}))
    a = j(api.post("/api/esquemas/zk/coloreo/abrir", {"ronda": "a", "arista": [0, 1]}))
    assert a["compromisos"] == c["compromisos"] and a["verificacion"]["ok"]
    t = j(api.post("/api/esquemas/zk/coloreo/abrir", {"ronda": "a", "arista": [6, 0], "tramposa": True}))
    assert not t["verificacion"]["ok"]
    r = j(api.post("/api/esquemas/zk/coloreo/rondas", {"ronda": "b", "k": 187}))
    assert r["aceptada"] and len(r["rondas"]) == 187
    err(api.post("/api/esquemas/zk/coloreo/abrir", {"ronda": "a", "arista": [0, 3]}), 422, "arista_invalida")
    err(api.post("/api/esquemas/zk/coloreo/abrir", {"ronda": "a", "arista": [0, 9]}), 422, "fuera_de_rango")
    err(api.post("/api/esquemas/zk/coloreo/rondas", {"ronda": "a", "k": 501}), 422, "fuera_de_rango")


def test_zk_rechazos(api):
    b = {"semilla": "s", "institucion": "N02", "ronda": "r"}
    err(api.post("/api/esquemas/zk/responder", {**b, "reto": "XYZ"}), 422, "hex_invalido")
    err(api.post("/api/esquemas/zk/responder", {**b, "reto": "f" * 64}), 422, "hex_invalido")   # ≥ N
    err(api.post("/api/esquemas/zk/compromiso", {**b, "ronda": "con espacio"}), 422, "token_invalido")
    err(api.post("/api/esquemas/zk/clave", {"semilla": "s", "institucion": "N21"}), 422, "institucion_inexistente")
    t = {"c": "0" * 63 + "1", "s": "0" * 63 + "2"}
    err(api.post("/api/esquemas/zk/extraer", {"semilla": "s", "institucion": "N02", "transcripciones": [t, t]}),
        422, "retos_iguales")


# ---------------------------------------------------------------------- 4 · QR
def test_qr_flujo_completo(api):
    d = j(api.post("/api/esquemas/qr/repartir", {"secreto": "clave maestra: Tlaxcala-2026!", "k": 3, "n": 5}))
    textos = [p["texto"] for p in d["partes"]]
    q = d["partes"][0]["qr"]
    assert q["modulos"] == 17 + 4 * q["version"] and len(q["filas"]) == q["modulos"]
    assert set("".join(q["filas"])) <= {"0", "1"}
    ok = j(api.post("/api/esquemas/qr/leer", {"textos": [textos[0], textos[2], textos[4]]}))
    assert ok["abierto"] and ok["secreto"] == "clave maestra: Tlaxcala-2026!"
    assert j(api.post("/api/esquemas/qr/leer", {"textos": textos[:2]}))["codigo"] == "insuficientes"
    mancha = j(api.post("/api/esquemas/qr/alterar", {"texto": textos[2], "modo": "mancha"}))["texto"]
    trampa = j(api.post("/api/esquemas/qr/alterar", {"texto": textos[2], "modo": "trampa"}))["texto"]
    assert j(api.post("/api/esquemas/qr/leer", {"textos": [textos[0], mancha, textos[4]]}))["codigo"] == "danada"
    assert j(api.post("/api/esquemas/qr/leer", {"textos": [textos[0], trampa, textos[4]]}))["codigo"] == "incorrecta"
    assert j(api.post("/api/esquemas/qr/leer", {"textos": ["no soy un QR"]}))["codigo"] == "formato"


def test_qr_boveda_y_visual(api):
    b = j(api.post("/api/esquemas/qr/boveda", {"documento": "Procedimiento de recuperación:\n1. …\n2. …", "k": 2, "n": 3}))
    t = [p["texto"] for p in b["partes"]]
    abierto = j(api.post("/api/esquemas/qr/boveda/abrir", {"boveda": b["boveda"]["texto"], "textos": [t[1], t[2]]}))
    assert abierto["abierto"] and abierto["documento"].startswith("Procedimiento")
    assert not j(api.post("/api/esquemas/qr/boveda/abrir", {"boveda": b["boveda"]["texto"], "textos": [t[1]]}))["abierto"]
    v = j(api.post("/api/esquemas/qr/visual", {"texto": "https://titulo-seguro.mx/verificar?folio=7F3A", "tipo": "naor_shamir"}))
    assert len(v["sombras"]) == 2 and len(v["sombras"][0]) == 2 * v["modulos"]
    x = j(api.post("/api/esquemas/qr/visual", {"texto": "hola", "tipo": "xor", "sombras": 4}))
    assert len(x["sombras"]) == 4 and len(x["sombras"][0]) == x["modulos"]


def test_qr_rechazos(api):
    err(api.post("/api/esquemas/qr/repartir", {"secreto": "x" * 121, "k": 2, "n": 3}), 422, "texto_largo")
    err(api.post("/api/esquemas/qr/repartir", {"secreto": "x", "k": 2, "n": 3, "nivel": "Z"}), 422, "opcion_invalida")
    err(api.post("/api/esquemas/qr/alterar", {"texto": "basura", "modo": "trampa"}), 422, "parte_invalida")
    err(api.post("/api/esquemas/qr/visual", {"texto": "x", "tipo": "xor", "sombras": 9}), 422, "fuera_de_rango")
    err(api.post("/api/esquemas/qr/leer", {"textos": []}), 422, "tipo_invalido")


# ----------------------------------------------------------------- 5 · Schnorr
def test_schnorr_por_la_api(api):
    t = j(api.get("/api/esquemas/schnorr/tablas?grupo=zp"))
    assert len(t["potencias"]) == 11
    assert len(j(api.get("/api/esquemas/schnorr/tablas?grupo=curva"))["puntos"]) == 18
    f = j(api.post("/api/esquemas/schnorr/firmar", {"grupo": "zp", "x": 6, "k": 7, "M": 14}))
    assert f["firma"] == {"s": 4, "e": 5}
    v = j(api.post("/api/esquemas/schnorr/verificar", {"grupo": "curva", "y": [0, 11], "M": 14, "s": 8, "e": 16}))
    assert v["valida"]
    assert j(api.post("/api/esquemas/schnorr/nonce", {"grupo": "curva", "x": 7, "k": 10, "M1": 14, "M2": 16}))["x_extraida"] == 7
    m = j(api.post("/api/esquemas/schnorr/multifirma", {"grupo": "zp", "x1": 6, "x2": 4, "k1": 2, "k2": 8, "M": 14}))
    assert m["firma"] == {"s": 5, "e": 4} and m["verificacion"]["valida"]
    a = j(api.post("/api/esquemas/schnorr/ataque", {}))
    assert a["acepta_ingenua"] and not a["acepta_con_coeficientes"]


def test_schnorr_rechazos(api):
    err(api.post("/api/esquemas/schnorr/firmar", {"grupo": "zp", "x": 11, "k": 7, "M": 14}), 422, "fuera_de_rango")
    err(api.post("/api/esquemas/schnorr/firmar", {"grupo": "rsa", "x": 1, "k": 1, "M": 1}), 422, "opcion_invalida")
    err(api.post("/api/esquemas/schnorr/verificar", {"grupo": "zp", "y": 5, "M": 14, "s": 4, "e": 5}), 422, "clave_invalida")
    err(api.post("/api/esquemas/schnorr/verificar", {"grupo": "curva", "y": [1, 1], "M": 14, "s": 4, "e": 5}), 422,
        "clave_invalida")
    err(api.post("/api/esquemas/schnorr/multifirma", {"grupo": "curva", "x1": 7, "x2": 8, "k1": 2, "k2": 17, "M": 14}),
        422, "caso_degenerado")
    err(api.get("/api/esquemas/schnorr/tablas?grupo=x"), 422, "opcion_invalida")


# --------------------------------------------------------------------- fuzz
VALORES = [None, True, False, 0, -1, 1, 2, 3, 5, 9, 10, 18, 19, 22, 500, 10**30, 1.5, "", " ", "x", "N01", "N99",
           "aos", "lsag", "zp", "curva", "xor", "naor_shamir", "mancha", "trampa", "H", "a" * 64, "f" * 64,
           "02" + "00" * 32, "0" * 132, "SSQR1:84FF785B:3:5:1:AAAA:388DFCF0", [], [None], ["N01", "N02"],
           ["N01", "N01"], [0, 1], [6, 0], [[1]], {}, {"x": 1, "y": "0" * 132}, {"variante": "aos", "c0": "0" * 64, "r": []},
           [{"c": "0" * 64, "s": "0" * 64}] * 2, [{"x": 1, "y": "0" * 132}, {"x": 2, "y": "0" * 132}], "\u0000", "ñ" * 200]
CAMPOS = ["secreto", "k", "n", "partes", "huella", "a1", "a2", "elegidas", "semilla", "anillo", "firmante", "mensaje",
          "variante", "firma", "imagenes_previas", "institucion", "ronda", "reto", "impostor", "transcripciones", "Y",
          "T", "s", "tramposa", "arista", "textos", "texto", "modo", "documento", "boveda", "tipo", "sombras",
          "grupo", "x", "y", "M", "e", "M1", "M2", "x1", "x2", "k1", "k2", "x_estrella", "extra"]


@pytest.mark.parametrize("semilla", [0, 1])
def test_fuzz_rutas_de_esquemas_nunca_500(api, semilla):
    rng = random.Random(semilla)
    rutas = sorted((r.rule, m) for r in api.app.url_map.iter_rules() if r.rule.startswith("/api/esquemas")
                   for m in r.methods - {"HEAD", "OPTIONS"})
    assert len(rutas) >= 25
    for ruta, metodo in rutas:
        for _ in range(25):
            if metodo == "GET":
                r = api.get(ruta + rng.choice(["", "?grupo=zp", "?grupo=curva", "?grupo=", "?grupo=x"]))
            else:
                cuerpo = {rng.choice(CAMPOS): rng.choice(VALORES) for _ in range(rng.randint(0, 7))}
                r = api.post(ruta, cuerpo)
            texto = r.get_data(as_text=True)
            assert r.status_code < 500, (ruta, r.status_code, texto[:300])
            assert "Traceback" not in texto and r.get_json() is not None


def _bases(api):
    """Un cuerpo VÁLIDO por ruta POST; el fuzz por mutación estropea un campo cada vez."""
    reparto = j(api.post("/api/esquemas/shamir/repartir", {"secreto": "abc", "k": 2, "n": 3}))
    firma = j(api.post("/api/esquemas/anillo/firmar", {"semilla": "f", "anillo": IDS[:3], "firmante": "N01",
                                                       "mensaje": "m", "variante": "lsag"}))["firma"]
    textos = [p["texto"] for p in j(api.post("/api/esquemas/qr/repartir", {"secreto": "s", "k": 2, "n": 3}))["partes"]]
    p = j(api.post("/api/esquemas/zk/probar", {"semilla": "f", "institucion": "N01", "mensaje": "m"}))
    zk = {"semilla": "f", "institucion": "N01"}
    t = {"c": "0" * 63 + "1", "s": "0" * 63 + "2"}
    t2 = {"c": "0" * 63 + "3", "s": "0" * 63 + "4"}
    return {
        "/api/esquemas/shamir/repartir": {"secreto": "abc", "k": 2, "n": 3},
        "/api/esquemas/shamir/reconstruir": {"partes": reparto["partes"][:2], "k": 2, "huella": reparto["huella"]},
        "/api/esquemas/shamir/juguete": {"secreto": 13, "a1": 7, "a2": 4, "elegidas": [1, 2, 3]},
        "/api/esquemas/anillo/firmar": {"semilla": "f", "anillo": IDS[:3], "firmante": "N01", "mensaje": "m", "variante": "aos"},
        "/api/esquemas/anillo/verificar": {"semilla": "f", "anillo": IDS[:3], "mensaje": "m", "firma": firma},
        "/api/esquemas/anillo/urna": {"semilla": "f", "anillo": IDS[:3], "mensaje": "m", "firma": firma, "imagenes_previas": []},
        "/api/esquemas/zk/clave": zk,
        "/api/esquemas/zk/compromiso": {**zk, "ronda": "r"},
        "/api/esquemas/zk/responder": {**zk, "ronda": "r", "reto": "0" * 63 + "5", "impostor": False},
        "/api/esquemas/zk/extraer": {**zk, "transcripciones": [t, t2]},
        "/api/esquemas/zk/simular": zk,
        "/api/esquemas/zk/probar": {**zk, "mensaje": "m"},
        "/api/esquemas/zk/verificar": {"Y": p["Y"], "mensaje": "m", "T": p["T"], "s": p["s"]},
        "/api/esquemas/zk/coloreo/compromiso": {"ronda": "r", "tramposa": False},
        "/api/esquemas/zk/coloreo/abrir": {"ronda": "r", "tramposa": False, "arista": [0, 1]},
        "/api/esquemas/zk/coloreo/rondas": {"ronda": "r", "tramposa": True, "k": 3},
        "/api/esquemas/qr/repartir": {"secreto": "s", "k": 2, "n": 3, "nivel": "H"},
        "/api/esquemas/qr/leer": {"textos": textos[:2]},
        "/api/esquemas/qr/alterar": {"texto": textos[0], "modo": "trampa"},
        "/api/esquemas/qr/boveda": {"documento": "doc", "k": 2, "n": 3},
        "/api/esquemas/qr/boveda/abrir": {"boveda": "SSQRV:" + "A" * 60, "textos": textos[:2]},
        "/api/esquemas/qr/visual": {"texto": "hola", "tipo": "xor", "sombras": 2},
        "/api/esquemas/schnorr/firmar": {"grupo": "curva", "x": 7, "k": 10, "M": 14},
        "/api/esquemas/schnorr/verificar": {"grupo": "curva", "y": [0, 11], "M": 14, "s": 8, "e": 16},
        "/api/esquemas/schnorr/nonce": {"grupo": "zp", "x": 6, "k": 7, "M1": 14, "M2": 16},
        "/api/esquemas/schnorr/multifirma": {"grupo": "curva", "x1": 7, "x2": 8, "k1": 2, "k2": 4, "M": 14},
        "/api/esquemas/schnorr/ataque": {"x1": 6, "x_estrella": 3},
    }


def test_fuzz_por_mutacion_de_cuerpos_validos(api):
    rng = random.Random(7)
    bases = _bases(api)
    posts = {r.rule for r in api.app.url_map.iter_rules() if r.rule.startswith("/api/esquemas") and "POST" in r.methods}
    assert posts == set(bases), posts ^ set(bases)
    for ruta, base in bases.items():
        assert api.post(ruta, base).status_code == 200, ruta
        for campo in base:
            for valor in rng.sample(VALORES, 10):
                r = api.post(ruta, {**base, campo: valor})
                texto = r.get_data(as_text=True)
                assert r.status_code < 500, (ruta, campo, valor, texto[:300])
                assert "Traceback" not in texto and r.get_json() is not None
            r = api.post(ruta, {k: v for k, v in base.items() if k != campo})     # sin ese campo
            assert r.status_code < 500, (ruta, campo)
