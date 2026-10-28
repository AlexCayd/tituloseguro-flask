"""Los cinco esquemas criptográficos del núcleo (sin Flask), con los ejemplos de cada documento como vectores fijos."""
import itertools
import secrets

import pytest

from nucleo.esquemas import anillo as A
from nucleo.esquemas import conocimiento_cero as Z
from nucleo.esquemas import qr_shamir as Q
from nucleo.esquemas import schnorr_juguete as S
from nucleo.esquemas import secp256k1 as C
from nucleo.esquemas import shamir as SH
from nucleo.esquemas.aritmetica import inverso_mod, lagrange_en_cero
from nucleo.esquemas.azar import Flujo

CLAVE = b"pruebas-esquemas"


def flujo(*etiquetas):
    return Flujo(CLAVE, *etiquetas)


# ===================================================================== aritmética
def test_inverso_mod_coincide_con_pow():
    for p in (31, 257, SH.M127, C.N):
        for _ in range(20):
            a = secrets.randbelow(p - 1) + 1
            assert inverso_mod(a, p) == pow(a, -1, p)


def test_inverso_mod_de_cero_lanza():
    with pytest.raises(ValueError):
        inverso_mod(0, 31)


def test_flujo_es_reproducible_y_sin_sesgo_aparente():
    a, b = flujo("x"), flujo("x")
    assert [a.randbelow(1000) for _ in range(50)] == [b.randbelow(1000) for _ in range(50)]
    cuentas = [0, 0, 0]
    f = flujo("y")
    for _ in range(3000):
        cuentas[f.randbelow(3)] += 1
    assert all(900 < c < 1100 for c in cuentas)
    assert sorted(flujo("z").barajar(range(7))) == list(range(7))


def test_secp256k1_jacobianas_igual_que_afines():
    for _ in range(40):
        k = secrets.randbelow(C.N)
        Qp = C.mult_afin(secrets.randbelow(C.N - 1) + 1, C.G)
        assert C.mult(k, Qp) == C.mult_afin(k, Qp)
        assert C.mult_base(k) == C.mult_afin(k, C.G)
    assert C.mult(C.N, C.G) is None and C.mult_base(0) is None
    assert C.mult(C.N - 1, C.G) == C.neg(C.G)


def test_secp256k1_compresion_ida_y_vuelta_y_rechazos():
    Qp = C.mult_base(123456789)
    assert C.descomprimir(C.punto_hex(Qp)) == Qp
    with pytest.raises(ValueError):
        C.descomprimir("02" + "00" * 32)              # x = 0: no hay punto
    with pytest.raises(ValueError):
        C.descomprimir("04" + "11" * 32)
    with pytest.raises(ValueError):
        C.escalar_de_hex(f"{C.N:064x}")              # no canónico


def test_codificacion_inyectiva():
    assert C.codifica("ab", "c") != C.codifica("a", "bc")
    assert C.h_escalar(b"d1", "x") != C.h_escalar(b"d2", "x")
    assert C.en_curva(C.h_punto(b"d", "algo"))


# =================================================================== 1 · Shamir
def test_shamir_ejemplo_del_documento_3_de_5_sobre_f31():
    e = SH.ejemplo_juguete()
    assert [f["sin_reducir"] for f in e["tabla"]] == [24, 43, 70, 105, 148]
    assert [f["y"] for f in e["tabla"]] == [24, 12, 8, 12, 24]
    assert [(l["num"], l["den"]) for l in e["lambdas"]] == [(3, 1), (-3, 1), (1, 1)]
    assert e["total"] == 44 and e["reconstruido"] == 13


@pytest.mark.parametrize("elegidas", list(itertools.combinations(range(1, 6), 3)))
def test_shamir_juguete_cualesquiera_tres_reconstruyen(elegidas):
    assert SH.ejemplo_juguete(elegidas=elegidas)["reconstruido"] == 13


def test_shamir_dos_partes_no_bastan_31_secretos_igual_de_posibles():
    e = SH.ejemplo_juguete(elegidas=(1, 2))
    assert not e["suficientes"]
    assert sorted(c["secreto"] for c in e["candidatos"]) == list(range(31))
    for c in e["candidatos"]:       # cada candidato es una parábola que SÍ pasa por las dos partes
        coefs = (c["secreto"], c["a1"], c["a2"])
        assert SH.horner(coefs, 1, 31) == 24 and SH.horner(coefs, 2, 31) == 12
    assert {"secreto": 13, "a1": 7, "a2": 4} in e["candidatos"]


def test_shamir_referencia_m127_cualesquiera_k_partes():
    s = 20261021
    partes = SH.repartir(s, k=3, n=5)
    for sub in itertools.combinations(partes, 3):
        assert SH.reconstruir(list(sub), 3) == s
    assert SH.reconstruir(partes, 3) == s                     # t > k también funciona
    with pytest.raises(ValueError):
        SH.reconstruir(partes[:2], 3)                         # el algoritmo 2 rechaza t < k
    assert SH.interpolar_en_cero(partes[:2]) != s             # Lagrange «no falla»: da basura


def test_shamir_parametros_y_abscisas_invalidas():
    with pytest.raises(ValueError):
        SH.repartir(5, k=1, n=3)
    with pytest.raises(ValueError):
        SH.repartir(SH.M127, k=2, n=3)
    with pytest.raises(ValueError):
        SH.interpolar_en_cero([(0, 5), (1, 7)])
    with pytest.raises(ValueError):
        SH.interpolar_en_cero([(2, 5), (2, 7)])


def test_shamir_lagrange_depende_solo_de_las_abscisas():
    assert lagrange_en_cero([1, 2, 3], 31) == [3, 28, 1]


def test_shamir_texto_ida_y_vuelta_con_acentos():
    d = SH.demo_repartir("Llave maestra · Anáhuac 2026", 3, 5, flujo("s1"))
    partes = [(p["x"], int(p["y"], 16)) for p in d["partes"]]
    r = SH.demo_reconstruir([partes[4], partes[0], partes[2]], 3, d["huella"])
    assert r["veredicto"] == "abierto" and r["resultado"]["texto"] == "Llave maestra · Anáhuac 2026"
    assert r["coincide_huella"] is True


def test_shamir_texto_con_partes_de_menos_da_basura():
    d = SH.demo_repartir("secreto", 3, 5, flujo("s2"))
    partes = [(p["x"], int(p["y"], 16)) for p in d["partes"]]
    r = SH.demo_reconstruir(partes[:2], 3, d["huella"])
    assert r["veredicto"] == "insuficiente" and r["faltan"] == 1 and r["resultado"]["texto"] != "secreto"


def test_shamir_parte_alterada_se_detecta_con_la_huella_publica():
    d = SH.demo_repartir("secreto", 3, 5, flujo("s3"))
    partes = [(p["x"], int(p["y"], 16)) for p in d["partes"]][:3]
    partes[1] = (partes[1][0], (partes[1][1] + 1) % SH.P_TEXTO)
    assert SH.demo_reconstruir(partes, 3, d["huella"])["veredicto"] == "alterado"


def test_shamir_limites_del_texto():
    with pytest.raises(ValueError):
        SH.texto_a_entero("")
    with pytest.raises(ValueError):
        SH.texto_a_entero("x" * (SH.MAX_BYTES_TEXTO + 1))
    assert SH.texto_a_entero("x" * SH.MAX_BYTES_TEXTO) < SH.P_TEXTO


# ================================================================== 2 · Anillo
def _claves(n, etiqueta="k"):
    return [A.generar_claves(flujo(etiqueta, i)) for i in range(n)]


@pytest.mark.parametrize("n", [2, 3])
def test_anillo_ida_y_vuelta_en_todas_las_posiciones(n):
    cl = _claves(n)
    anillo = [Y for _, Y in cl]
    m = b"Informe confidencial del comite"
    for s in range(n):
        assert A.verificar_aos(m, anillo, A.firmar_aos(m, anillo, s, cl[s][0]))
        assert A.verificar_lsag(m, anillo, A.firmar_lsag(m, anillo, s, cl[s][0]))


def test_anillo_de_ocho_extremos():
    cl = _claves(8, "ocho")
    anillo = [Y for _, Y in cl]
    for s in (0, 7):
        assert A.verificar_aos(b"m", anillo, A.firmar_aos(b"m", anillo, s, cl[s][0]))


def test_anillo_manipulaciones_invalidan():
    cl = _claves(5, "manip")
    anillo = [Y for _, Y in cl]
    m = b"denuncia"
    c0, r = A.firmar_aos(m, anillo, 3, cl[3][0])
    assert not A.verificar_aos(b"otra", anillo, (c0, r))
    assert not A.verificar_aos(m, anillo, ((c0 + 1) % C.N, r))
    r2 = list(r)
    r2[1] = (r2[1] + 1) % C.N
    assert not A.verificar_aos(m, anillo, (c0, r2))
    otro = _claves(1, "intruso")[0][1]
    assert not A.verificar_aos(m, anillo[:4] + [otro], (c0, r))
    assert not A.verificar_aos(m, anillo[::-1], (c0, r))      # sin orden canónico cambia L
    c0, r, I = A.firmar_lsag(m, anillo, 2, cl[2][0])
    assert not A.verificar_lsag(m, anillo, (c0, r, C.mult_base(7)))


def test_anillo_clave_que_no_es_del_firmante_lanza():
    cl = _claves(3, "ajena")
    with pytest.raises(ValueError):
        A.firmar_aos(b"m", [Y for _, Y in cl], 0, cl[1][0])


def test_lsag_enlaza_mismo_firmante_aunque_cambie_mensaje_y_anillo():
    cl = _claves(5, "enlace")
    anillo = [Y for _, Y in cl]
    f1 = A.firmar_lsag(b"voto 1", anillo, 3, cl[3][0])
    f2 = A.firmar_lsag(b"voto 2", anillo, 3, cl[3][0])
    f3 = A.firmar_lsag(b"voto 3", anillo, 1, cl[1][0])
    otro_anillo = anillo[:2] + [anillo[3]]
    f4 = A.firmar_lsag(b"voto 4", otro_anillo, 2, cl[3][0])
    assert A.enlazadas(f1, f2) and A.enlazadas(f1, f4) and not A.enlazadas(f1, f3)
    assert f1[2] == A.imagen_clave(cl[3][0])


def test_anillo_reutilizar_el_aleatorio_expone_la_clave():
    """Error 1 de «Errores que rompen el esquema»: mismo a con desafíos distintos ⇒ x = (r' − r)(c − c')⁻¹."""
    cl = _claves(3, "reuso")
    anillo = [Y for _, Y in cl]
    s, x = 1, cl[1][0]
    f1 = A.firmar_aos(b"mensaje uno", anillo, s, x, flujo("mismo-a"))
    f2 = A.firmar_aos(b"mensaje dos", anillo, s, x, flujo("mismo-a"))
    c1 = A.recorrer_aos(b"mensaje uno", anillo, *f1)[1][s]["c"]
    c2 = A.recorrer_aos(b"mensaje dos", anillo, *f2)[1][s]["c"]
    assert c1 != c2
    assert (f2[1][s] - f1[1][s]) * pow(c1 - c2, -1, C.N) % C.N == x


def test_anillo_firma_de_dict_rechaza_lo_mal_formado():
    malas = [None, [], {"variante": "x"}, {"variante": "aos", "c0": "zz", "r": []},
             {"variante": "aos", "c0": "0" * 64, "r": ["0" * 64]},
             {"variante": "aos", "c0": f"{C.N:064x}", "r": ["0" * 64] * 3},
             {"variante": "lsag", "c0": "0" * 64, "r": ["0" * 64] * 3},
             {"variante": "lsag", "c0": "0" * 64, "r": ["0" * 64] * 3, "I": "02" + "00" * 32},
             {"variante": "aos", "c0": "0" * 64, "r": ["0" * 64] * 3, "extra": 1}]
    for d in malas:
        with pytest.raises(A.FirmaInvalida):
            A.firma_de_dict(d)


def test_anillo_demo_no_revela_quien_firmo_y_orden_canonico():
    ids = ["N01", "N02", "N03", "N04", "N05"]
    d = A.demo_firmar(CLAVE, "demo", ids, "N03", "título falso", "aos", flujo("demo"))
    assert "firmante" not in d and "N03" not in str(d["firma"])
    assert sorted(a["id"] for a in d["anillo"]) == ids
    v = A.demo_verificar(CLAVE, "demo", ids[::-1], "título falso", d["firma"])
    assert v["valida"] and v["probabilidad"] == {"num": 1, "den": 5} and len(v["traza"]) == 5
    assert v["c_final"] == v["c0"]
    assert d["tamano_bytes"] == 32 * 6


def test_anillo_urna_rechaza_el_doble_voto():
    ids = ["N01", "N02", "N03"]
    f1 = A.demo_firmar(CLAVE, "e", ids, "N02", "sí", "lsag")["firma"]
    u1 = A.demo_urna(CLAVE, "e", ids, "sí", f1, [])
    assert u1["aceptada"]
    f2 = A.demo_firmar(CLAVE, "e", ids, "N02", "no", "lsag")["firma"]
    u2 = A.demo_urna(CLAVE, "e", ids, "no", f2, [u1["imagen"]])
    assert u2["valida"] and u2["repetida"] and not u2["aceptada"]
    f3 = A.demo_firmar(CLAVE, "e", ids, "N01", "no", "lsag")["firma"]
    assert A.demo_urna(CLAVE, "e", ids, "no", f3, [u1["imagen"]])["aceptada"]


# ========================================================= 3 · Conocimiento cero
def test_zk_schnorr_interactivo_completo_y_solido():
    x, Y = Z.clave_derivada(CLAVE, "s", "N01")
    r = Z.nonce_de_ronda(CLAVE, "s", "N01", "ronda-1")
    T = Z.compromiso(r)
    c = secrets.randbelow(C.N)
    s = Z.responder(r, c, x)
    assert Z.verificar_transcripcion(Y, T, c, s)
    assert not Z.verificar_transcripcion(Y, T, c, (s + 1) % C.N)
    assert not Z.verificar_transcripcion(Y, T, (c + 1) % C.N, s)


def test_zk_nonce_distinto_por_ronda_y_reutilizarlo_expone_x():
    x, _ = Z.clave_derivada(CLAVE, "s", "N02")
    r1, r2 = (Z.nonce_de_ronda(CLAVE, "s", "N02", f"r{i}") for i in (1, 2))
    assert r1 != r2
    c1, c2 = 11, 29
    assert Z.extraer(c1, Z.responder(r1, c1, x), c2, Z.responder(r1, c2, x)) == x
    with pytest.raises(ValueError):
        Z.extraer(5, 1, 5, 2)


def test_zk_simulador_verifica_sin_conocer_x():
    _, Y = Z.clave_derivada(CLAVE, "s", "N03")
    T, c, s = Z.simular(Y, flujo("sim"))
    assert Z.verificar_transcripcion(Y, T, c, s)


def test_zk_impostor_no_pasa_y_peggy_si():
    ok = Z.demo_responder(CLAVE, "s", "N04", "r", 12345)
    mal = Z.demo_responder(CLAVE, "s", "N04", "r", 12345, impostor=True)
    assert ok["verificacion"]["ok"] and not mal["verificacion"]["ok"] and ok["T"] == mal["T"]


def test_zk_fiat_shamir_no_interactivo():
    x, Y = Z.clave_derivada(CLAVE, "s", "N05")
    T, s = Z.probar_ni(x, Y, b"login: jose@lab-ia")
    assert Z.verificar_ni(Y, b"login: jose@lab-ia", T, s)
    assert not Z.verificar_ni(Y, b"otro", T, s)
    assert not Z.verificar_ni(Y, b"login: jose@lab-ia", T, (s + 1) % C.N)
    _, Y2 = Z.clave_derivada(CLAVE, "s", "N06")
    assert Z.reto_fiat_shamir(Y, T, b"m") != Z.reto_fiat_shamir(Y2, T, b"m")    # Y entra al hash


def test_gmw_rondas_recomendadas_y_coloreos():
    assert Z.rondas_para_error(14) == 187
    assert Z.coloreo_es_valido(Z.COLOREO_VALIDO) and not Z.coloreo_es_valido(Z.COLOREO_FALSO)
    assert len(Z.ARISTAS) == 14 and len(set(Z.ARISTAS)) == 14


def test_gmw_honesta_aceptada_en_187_rondas_tramposa_atrapada():
    k = Z.rondas_para_error(14)
    honesta = Z.demo_rondas_coloreo(CLAVE, "h", False, k, flujo("ver-h"))
    tramposa = Z.demo_rondas_coloreo(CLAVE, "t", True, k, flujo("ver-t"))
    assert honesta["aceptada"] and all(r["ok"] for r in honesta["rondas"])
    assert not tramposa["aceptada"] and tramposa["primera_falla"] >= 1
    assert abs(tramposa["prob_engano"] - (13 / 14) ** 187) < 1e-15


def test_gmw_apertura_cuadra_con_los_compromisos_y_baraja_colores():
    a = Z.demo_abrir_coloreo(CLAVE, "x", False, (2, 6))
    assert a["compromisos"] == Z.demo_compromiso_coloreo(CLAVE, "x", False)["compromisos"]
    assert a["verificacion"]["ok"]
    colores = {tuple(Z.demo_abrir_coloreo(CLAVE, f"x{i}", False, (0, 1))["u"]["color"] for _ in [0])
               for i in range(30)}
    assert len(colores) == 3                                   # el mismo vértice sale de los 3 colores
    with pytest.raises(ValueError):
        Z.demo_abrir_coloreo(CLAVE, "x", False, (0, 3))       # (0, 3) no es arista


def test_gmw_tramposa_se_delata_justo_en_la_arista_mala():
    a = Z.demo_abrir_coloreo(CLAVE, "z", True, (6, 0))
    assert a["verificacion"]["abre_u"] and not a["verificacion"]["distintos"] and not a["verificacion"]["ok"]


def test_gmw_simulador_sin_testigo():
    coms, e, (cu, nu), (cv, nv) = Z.simulador(7, Z.ARISTAS, flujo("simg"))
    u, v = e
    assert Z.abre(coms[u], cu, nu) and Z.abre(coms[v], cv, nv) and cu != cv


# ===================================================================== 4 · QR
def test_gf256_ejemplos_del_documento():
    assert Q.mul(0x57, 0x83) == 0xC1                            # FIPS-197
    assert all(Q.mul(a, Q.inv(a)) == 1 for a in range(1, 256))
    assert [Q.mul(0xCA, x) ^ 0x53 for x in (1, 2, 3)] == [0x99, 0xDC, 0x16]
    assert Q.reconstruir_bytes([(1, bytes([0x99])), (2, bytes([0xDC]))]) == bytes([0x53])


def test_gf256_cualesquiera_tres_de_cinco():
    s = b"semilla de 32 bytes para prueba!"
    p = Q.repartir_bytes(s, 3, 5)
    for sub in itertools.combinations(p, 3):
        assert Q.reconstruir_bytes(list(sub)) == s
    assert all(len(y) == len(s) for _, y in p)                 # las partes miden lo mismo que el secreto


def test_ssqr1_ida_y_vuelta_y_dos_niveles_de_integridad():
    ident, textos = Q.repartir_en_textos("clave maestra: Tlaxcala-2026!".encode(), 3, 5, flujo("qr"))
    assert all(t.startswith(f"SSQR1:{ident}:3:5:") for t in textos)
    assert Q.reconstruir_de_textos([textos[0], textos[2], textos[4]]) == "clave maestra: Tlaxcala-2026!".encode()
    mancha = Q.alterar_parte(textos[2], "mancha")
    trampa = Q.alterar_parte(textos[2], "trampa")
    with pytest.raises(Q.ParteInvalida) as e1:
        Q.reconstruir_de_textos([textos[0], mancha, textos[4]])
    assert e1.value.codigo == "danada"                         # el CRC lo delata
    Q.decodificar_parte(trampa)                                 # el CRC recalculado SÍ pasa…
    with pytest.raises(Q.ParteInvalida) as e2:
        Q.reconstruir_de_textos([textos[0], trampa, textos[4]])
    assert e2.value.codigo == "incorrecta"                     # …pero la suma interna no


def test_ssqr1_errores_explicados():
    _, a = Q.repartir_en_textos(b"uno", 2, 3, flujo("a"))
    _, b = Q.repartir_en_textos(b"dos", 2, 3, flujo("b"))
    casos = {"insuficientes": [a[0]], "mezcladas": [a[0], b[1]], "repetidas": [a[0], a[0]],
             "formato": ["hola", a[0]]}
    for codigo, textos in casos.items():
        with pytest.raises(Q.ParteInvalida) as e:
            Q.reconstruir_de_textos(textos)
        assert e.value.codigo == codigo


def test_ssqr1_basura_nunca_lanza_otra_cosa():
    for t in ["", ":::::::", "SSQR1:ZZZZZZZZ:3:5:1:AA:00000000", "SSQR1:84FF785B:9:5:1:AAAA:388DFCF0",
              "SSQR1:84FF785B:3:5:1:A1:388DFCF0", "x" * 600, "SSQR1:84FF785B:3:5:1:" + "A" * 400 + ":00000000"]:
        with pytest.raises(Q.ParteInvalida):
            Q.decodificar_parte(t)


def test_qr_version_de_una_parte_de_32_bytes_con_nivel_h():
    _, textos = Q.repartir_en_textos(b"x" * 32, 3, 5, flujo("v"))
    assert len(textos[0]) == 88
    assert Q.matriz_qr(textos[0], "H")[1] == 7 and Q.matriz_qr(textos[0], "L")[1] == 4


def test_qr_modo_boveda():
    doc = ("Instrucciones de acceso a la bóveda: " + "x" * 400).encode()
    boveda, partes = Q.proteger(doc, 2, 3)
    assert Q.recuperar(boveda, [partes[0], partes[2]]) == doc
    assert Q.matriz_qr(boveda, "M")[1] == 18 and Q.matriz_qr(partes[0], "M")[1] == 3
    with pytest.raises(Q.ParteInvalida) as e:
        Q.recuperar(boveda, [partes[0], Q.alterar_parte(partes[2], "trampa")])
    assert e.value.codigo == "incorrecta"


def test_criptografia_visual_xor_y_naor_shamir():
    M, _ = Q.matriz_qr("https://math.com.mx/boveda?clave=7F3A-91C2", "H", borde=4)
    sombras = Q.repartir_xor(M, 3, flujo("xor"))
    assert Q.combinar_xor(sombras) == M
    assert Q.combinar_xor(sombras[:2]) != M
    A_, B_ = Q.repartir_naor_shamir(M, flujo("ns"))
    for T in (A_, B_):            # cada bloque 2×2 tiene exactamente 2 subpíxeles negros
        assert all(T[2 * i][2 * j] + T[2 * i][2 * j + 1] + T[2 * i + 1][2 * j] + T[2 * i + 1][2 * j + 1] == 2
                   for i in range(len(M)) for j in range(len(M)))
    assert Q.recuperar_modulos(Q.superponer(A_, B_)) == M


# ============================================================ 5 · Schnorr juguete
def test_schnorr_zp_ejemplo_completo():
    f = S.firmar("zp", 6, 7, 14)
    assert (f["y"], f["r"], f["e"], f["s"]) == (9, 13, 5, 4)
    v = S.verificar("zp", 9, 14, 4, 5)
    assert v["rv"] == 13 and v["valida"]
    assert S.verificar("zp", 9, 15, 4, 5)["ev"] == 6          # mensaje alterado: rechazo


def test_schnorr_zp_nonce_repetido_expone_x():
    n = S.nonce_repetido("zp", 6, 7, 14, 16)
    assert n["firma2"] == {"s": 5, "e": 7} and n["x_extraida"] == 6 and n["coincide"]


def test_schnorr_curva_ejemplo_completo():
    f = S.firmar("curva", 7, 10, 14)
    assert (f["y"], f["r"], f["e"], f["s"]) == ([0, 11], [7, 11], 16, 8)
    v = S.verificar("curva", [0, 11], 14, 8, 16)
    assert v["rv"] == [7, 11] and v["valida"]
    assert S.verificar("curva", [0, 11], 15, 8, 16)["ev"] == 17
    n = S.nonce_repetido("curva", 7, 10, 14, 16)
    assert n["firma2"] == {"s": 3, "e": 18} and n["x_extraida"] == 7


def test_schnorr_tabla_de_multiplos_de_la_curva():
    t = S.tablas("curva")
    m = {f["k"]: f["punto"] for f in t["multiplos"]}
    assert m[2] == [6, 3] and m[3] == [10, 6] and m[8] == [13, 7] and m[18] == [5, 16] and m[19] is None
    assert len(t["puntos"]) == 18
    assert [f["valor"] for f in S.tablas("zp")["potencias"]] == [1, 2, 4, 8, 16, 9, 18, 13, 3, 6, 12]


def test_schnorr_ejercicios_con_solucion():
    f = S.firmar("zp", 6, 5, 20)
    assert (f["r"], f["e"], f["s"]) == (9, 7, 3) and S.verificar("zp", 9, 20, 3, 7)["valida"]
    f = S.firmar("curva", 7, 4, 20)
    assert (f["r"], f["e"], f["s"]) == ([3, 1], 4, 13) and S.verificar("curva", [0, 11], 20, 13, 4)["valida"]
    v = S.verificar("zp", 9, 14, 4, 6)
    assert v["rv"] == 2 and v["ev"] == 5 and not v["valida"]


def test_schnorr_multifirma_en_los_dos_grupos():
    m = S.multifirma("zp", 6, 4, 2, 8, 14)
    a, b = m["firmantes"]
    assert (a["y"], a["a"], a["r"], a["huella"], a["s"]) == (9, 9, 4, "51174631", 9)
    assert (b["y"], b["a"], b["r"], b["huella"], b["s"]) == (13, 2, 3, "21d0a206", 7)
    assert (m["clave_conjunta"], m["r"], m["e"], m["s"]) == (16, 12, 4, 5)
    assert m["verificacion"]["valida"] and a["parcial_ok"] and b["parcial_ok"]
    m = S.multifirma("curva", 7, 8, 2, 4, 14)
    a, b = m["firmantes"]
    assert (a["y"], a["a"], a["r"], a["huella"], a["s"]) == ([0, 11], 16, [6, 3], "3095fa0f", 13)
    assert (b["y"], b["a"], b["r"], b["huella"], b["s"]) == ([13, 10], 2, [3, 1], "2881cf99", 11)
    assert (m["clave_conjunta"], m["r"], m["e"], m["s"]) == ([9, 16], [16, 13], 4, 5)
    assert m["verificacion"]["valida"] and m["x_conjunta_teorica"] == 14


def test_schnorr_multifirma_casos_degenerados_se_explican():
    with pytest.raises(ValueError):
        S.multifirma("curva", 7, 8, 2, 17, 14)                 # k1 + k2 ≡ 0 (mod 19)


def test_schnorr_ataque_de_clave_maliciosa():
    a = S.ataque_clave_maliciosa()
    assert (a["y1"], a["y_estrella"], a["y2_falsa"], a["clave_ingenua"]) == (9, 3, 8, 3)
    assert a["acepta_ingenua"] and not a["acepta_con_coeficientes"]


def test_schnorr_validaciones():
    with pytest.raises(ValueError):
        S.firmar("zp", 0, 7, 14)
    with pytest.raises(ValueError):
        S.firmar("zp", 6, 11, 14)
    with pytest.raises(ValueError):
        S.verificar("zp", 5, 14, 4, 5)                         # 5 no está en el subgrupo de orden 11
    with pytest.raises(ValueError):
        S.verificar("curva", [1, 1], 14, 4, 5)                 # no está en la curva
    with pytest.raises(ValueError):
        S.grupo("otro")


@pytest.mark.parametrize("nombre", S.GRUPOS)
def test_schnorr_toda_firma_honesta_verifica(nombre):
    q = S.grupo(nombre).q
    for x in range(1, q):
        for k in (1, q // 2, q - 1):
            f = S.firmar(nombre, x, k, 37)
            assert S.verificar(nombre, f["y"], 37, f["s"], f["e"])["valida"]
