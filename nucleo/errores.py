"""Errores de dominio y catálogo de problemas de validación (mensajes en español)."""
from dataclasses import dataclass, field


class ErrorSim(Exception):
    """Error esperado del simulador: lleva código estable, mensaje claro y estado HTTP.

    `conservar=True` indica que, aunque la acción se rechaza, lo que quedó escrito en la
    bitácora (el rechazo mismo) debe conservarse al hacer rollback del resto.
    """

    def __init__(self, codigo, mensaje, http=422, campo=None, detalle=None, conservar=False):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje
        self.http = http
        self.campo = campo
        self.detalle = detalle
        self.conservar = conservar

    def a_dict(self):
        d = {"ok": False, "error": self.mensaje, "codigo": self.codigo}
        if self.campo:
            d["campo"] = self.campo
        if self.detalle:
            d["detalle"] = self.detalle
        return d


MENSAJES = {
    "genesis_invalido": "El folio génesis (el primero del libro) no es válido: {motivo}.",
    "genesis_distinto": "El folio génesis de ese libro no es el de esta red: pertenece a otro consorcio de instituciones.",
    "numero": "El folio que ocupa la posición {pos} dice ser el número {numero}.",
    "estructura": "La estructura del bloque no es válida: {motivo}.",
    "hash": "La huella guardada no coincide con la que sale de recalcular el bloque: "
            "alguien cambió su contenido.",
    "enlace": "El enlace con el bloque anterior está roto: su «hash anterior» ya no coincide "
              "con la huella del bloque previo.",
    "sin_tx": "El folio no contiene ningún registro de credencial.",
    "exceso_tx": "El folio trae {n} registros y el máximo permitido es {max}.",
    "tx_estructura": "El registro {i} está mal formado: {motivo}.",
    "tx_monto": "El registro {i} tiene un monto de créditos no permitido (entero entre 1 y {max}).",
    "tx_mismo_nodo": "El registro {i} envía créditos de una institución a sí misma.",
    "tx_nodo_inexistente": "El registro {i} menciona una institución que no existe en la red.",
    "tx_firma": "La firma del registro {i} no corresponde a su contenido: se alteró el registro o la firma es inválida.",
    "tx_otra_clave": "El registro {i} dice venir de {emisor} pero lo firmó {firmante}: "
                     "no es la clave del emisor.",
    "tx_duplicada": "El registro {i} ya estaba registrado: reenviarlo sería registrar dos veces los mismos créditos.",
    "tx_saldo": "{emisor} intenta gastar {monto} créditos pero solo puede gastar {gastable} créditos "
                "(registro {i}).",
    "recompensa_falsa": "La recompensa del bloque no es la establecida ({esperado} créditos para el proponente).",
    "pow_objetivo": "La huella no empieza con {d} ceros: no hay trabajo demostrado para este bloque.",
    "pow_particion": "El nonce no pertenece a la partición de nonces de su institución selladora: {motivo}.",
    "pow_campos_pos": "Un bloque de Proof of Work no debe traer votos, apuestas ni castigos.",
    "pos_nonce": "En Proof of Stake el nonce debe ser 0.",
    "pos_apuestas": "Las apuestas del bloque no son válidas: {motivo}.",
    "pos_sorteo": "El proponente no coincide con el sorteo reproducible: {motivo}.",
    "pos_voto_no_validador": "{votante} votó sin ser validador de esta ronda.",
    "pos_voto_duplicado": "{votante} aparece votando más de una vez.",
    "pos_voto_peso": "El peso del voto de {votante} no coincide con su apuesta.",
    "pos_voto_firma": "La firma del voto de {votante} no es válida.",
    "pos_proponente_sin_voto": "El proponente no firmó el bloque (falta su voto a favor).",
    "pos_quorum": "Votos a favor insuficientes: {V} de {A} (se necesita al menos 2/3, es decir 3V ≥ 2A).",
    "pos_castigo": "El registro de castigos no es válido: {motivo}.",
    "pos_campos_pow": "Un bloque de Proof of Stake no debe traer campos de minería.",
    "estructura_ilegible": "El libro de registros recibido no se pudo interpretar: {motivo}.",
}


class _Seguro(dict):
    def __missing__(self, k):
        return "?"


@dataclass
class Problema:
    bloque: int
    codigo: str
    mensaje: str
    detalle: dict = field(default_factory=dict)

    def a_dict(self):
        return {"bloque": self.bloque, "codigo": self.codigo, "mensaje": self.mensaje,
                "detalle": self.detalle}


def problema(bloque, codigo, **detalle):
    plantilla = MENSAJES.get(codigo, codigo)
    try:
        mensaje = plantilla.format_map(_Seguro(detalle))
    except (ValueError, IndexError, KeyError):
        mensaje = plantilla
    return Problema(bloque, codigo, mensaje, detalle)
