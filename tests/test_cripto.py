import pytest

from nucleo import cripto as C

TX = {"emisor": "N01", "receptor": "N02", "monto": 5, "timestamp": "2026-01-01T00:00:01Z"}


def test_serializacion_canonica_literal():
    esperado = b'{"emisor":"N01","monto":5,"receptor":"N02","timestamp":"2026-01-01T00:00:01Z"}'
    assert C.serializar_tx(TX) == esperado
    # el orden de las llaves o campos extra no cambian lo firmado
    assert C.serializar_tx({**TX, "firma": "x"}) == esperado
    assert C.serializar_tx(dict(reversed(list(TX.items())))) == esperado


def test_claves_deterministas():
    a = C.pub_hex(C.clave_desde_semilla("s", "N01"))
    assert a == C.pub_hex(C.clave_desde_semilla("s", "N01"))
    assert a != C.pub_hex(C.clave_desde_semilla("s", "N02"))
    assert a != C.pub_hex(C.clave_desde_semilla("otra", "N01"))
    assert len(a) == 64


def test_firma_valida_y_determinista():
    priv = C.clave_desde_semilla("s", "N01")
    pub = C.pub_hex(priv)
    f = C.firmar_tx(priv, TX)
    assert C.verificar_tx(pub, TX, f)
    assert f == C.firmar_tx(priv, TX)          # Ed25519 es determinista
    assert len(f) == 128


def test_firma_alterada_no_verifica():
    priv = C.clave_desde_semilla("s", "N01")
    pub = C.pub_hex(priv)
    f = C.firmar_tx(priv, TX)
    mala = ("1" if f[0] == "0" else "0") + f[1:]
    assert not C.verificar_tx(pub, TX, mala)
    assert not C.verificar_tx(pub, {**TX, "monto": 6}, f)     # contenido alterado


def test_firma_de_otra_clave_no_verifica():
    p1, p2 = C.clave_desde_semilla("s", "N01"), C.clave_desde_semilla("s", "N02")
    f2 = C.firmar_tx(p2, TX)
    assert not C.verificar_tx(C.pub_hex(p1), TX, f2)


@pytest.mark.parametrize("pub,firma", [(None, None), (1, 2), ("zz", "yy"), ("", ""), ("0" * 64, "0" * 128),
                                       ("A" * 64, "B" * 128), ([], {}), ("0" * 64, "0" * 127)])
def test_verificar_nunca_lanza(pub, firma):
    assert C.verificar_tx(pub, TX, firma) is False
    assert C.verificar_tx(pub, {"emisor": "x"}, firma) is False     # tx incompleta


def test_tx_id_estable_y_sensible():
    assert C.tx_id(TX) == C.tx_id(dict(TX))
    assert C.tx_id(TX) != C.tx_id({**TX, "monto": 6})


def test_votos_firmados_y_etiquetados():
    priv = C.clave_desde_semilla("s", "N03")
    pub = C.pub_hex(priv)
    hc = "ab" * 32
    f = C.firmar_voto(priv, hc, "N03", True)
    assert C.verificar_voto(pub, hc, "N03", f, True)
    assert not C.verificar_voto(pub, hc, "N03", f, False)      # un «sí» no vale como «no»
    assert not C.verificar_voto(pub, "cd" * 32, "N03", f, True)
    assert not C.verificar_voto(pub, hc, "N04", f, True)
    assert not C.verificar_voto(pub, None, "N03", f, True)
    # un voto no puede reutilizarse como firma de una transacción
    assert not C.verificar_tx(pub, TX, f)
