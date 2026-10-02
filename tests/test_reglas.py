import pytest

import reglas
from blockchain import Billetera
from reglas import IndicePendientes, construir_registro, construir_revocacion, indexar_cadena, validar_reglas
from seguridad import Secretos

S = Secretos("secreto-de-pruebas")
UAN, UDM = Billetera(), Billetera()
CODIGOS = {UAN.pub: "UAN", UDM.pub: "UDM"}


def registro(w=UAN, codigo="UAN", matricula="A1", programa="Derecho", tipo="título", fecha="2026-09-01"):
    tx = construir_registro(codigo, w.pub, S.alumno_id(matricula), programa, tipo, fecha)
    return tx, w.firmar(tx)


def test_credencial_normal_pasa():
    tx, f = registro()
    assert validar_reglas(tx, f, CODIGOS, indexar_cadena([{}])) is None


def test_una_universidad_no_puede_emitir_con_el_codigo_de_otra():
    tx, f = registro(w=UDM, codigo="UAN")  # la llave de UDM firma un folio TS-UAN-...
    assert "propio código" in validar_reglas(tx, f, CODIGOS, indexar_cadena([{}]))


def test_llave_desconocida_se_rechaza():
    intruso = Billetera()
    tx, f = registro(w=intruso)
    assert "autorizada" in validar_reglas(tx, f, CODIGOS, indexar_cadena([{}]))


def test_firma_invalida_se_rechaza():
    tx, f = registro()
    assert "firma" in validar_reglas(tx, UDM.firmar(tx), CODIGOS, indexar_cadena([{}]))


def test_contenido_manipulado_rompe_la_huella_del_documento():
    tx, f = registro()
    tx["contenido"]["programa"] = "Medicina"
    assert "huella" in reglas.validar_estructura(tx)


def test_duplicados_en_cola_se_detectan():
    tx, f = registro()
    c = tx["contenido"]
    pend = IndicePendientes(folios={c["folio"]}, huellas={c["huella_documento"]}, claves={reglas.clave_dup(c)})
    assert validar_reglas(tx, f, CODIGOS, indexar_cadena([{}]), pend)


def test_estructura_exige_exactamente_los_campos_esperados():
    tx, f = registro()
    tx["contenido"]["nombre"] = "Juan Pérez"   # un nombre en claro no cabe en la cadena
    assert "campos" in reglas.validar_estructura(tx)


def test_la_matricula_no_se_adivina_por_fuerza_bruta_sin_el_secreto():
    otro = Secretos("otro-secreto")
    assert S.alumno_id("A1") != otro.alumno_id("A1")
    assert S.alumno_id(" a1 ") == S.alumno_id("A1")


def test_formulario():
    assert reglas.validar_formulario("  Derecho ", "título", "2026-01-01") == ("Derecho", "título", "2026-01-01")
    for args in [("x", "título", "2026-01-01"), ("Derecho", "otro", "2026-01-01"), ("Derecho", "título", "2026-13-40")]:
        with pytest.raises(ValueError):
            reglas.validar_formulario(*args)


def test_folio_con_formato():
    tx, _ = registro()
    assert reglas.RE_FOLIO.match(tx["contenido"]["folio"])
    assert construir_revocacion(UAN.pub, " ts-uan-0123456789ab ", "error")["contenido"]["folio_revocado"] == "TS-UAN-0123456789AB"
