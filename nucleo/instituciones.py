"""Dominio del proyecto: Certificados y Credenciales Académicas.

Cada nodo de la red es una INSTITUCIÓN EDUCATIVA que participa en un registro compartido de
credenciales. Los identificadores técnicos (N01…N20) no cambian: esto es sólo la capa de significado
que la interfaz muestra. Las instituciones son ilustrativas; la simulación no las representa.

La unidad que se transfiere es el «crédito de certificación»: lo que una institución gasta para que
la red avale el registro de sus credenciales (títulos, diplomas, certificados, constancias).
"""

UNIDAD = {
    "nombre": "crédito de certificación",
    "plural": "créditos de certificación",
    "sigla": "CC",
    "explicacion": ("Unidad de la red: la institución emisora paga créditos de certificación para que "
                    "otra institución avale el registro de una credencial. Su saldo es lo que le queda "
                    "por registrar."),
}

# Tarifas orientativas (sólo ayudan a elegir un monto en la interfaz; la cadena guarda únicamente
# emisor, receptor, monto y timestamp).
TARIFAS = [
    {"id": "titulo", "nombre": "Título profesional", "monto": 10},
    {"id": "diploma", "nombre": "Diploma", "monto": 6},
    {"id": "certificado", "nombre": "Certificado de estudios", "monto": 4},
    {"id": "constancia", "nombre": "Constancia", "monto": 1},
]

_INSTITUCIONES = [
    ("UAN", "Universidad Anáhuac México", "privada"),
    ("UNAM", "Universidad Nacional Autónoma de México", "pública"),
    ("IPN", "Instituto Politécnico Nacional", "pública"),
    ("TEC", "Tecnológico de Monterrey", "privada"),
    ("UAM", "Universidad Autónoma Metropolitana", "pública"),
    ("IBERO", "Universidad Iberoamericana", "privada"),
    ("ITAM", "Instituto Tecnológico Autónomo de México", "privada"),
    ("UDG", "Universidad de Guadalajara", "pública"),
    ("BUAP", "Benemérita Universidad Autónoma de Puebla", "pública"),
    ("UANL", "Universidad Autónoma de Nuevo León", "pública"),
    ("UP", "Universidad Panamericana", "privada"),
    ("UDLAP", "Universidad de las Américas Puebla", "privada"),
    ("COLMEX", "El Colegio de México", "pública"),
    ("UAQ", "Universidad Autónoma de Querétaro", "pública"),
    ("UV", "Universidad Veracruzana", "pública"),
    ("UADY", "Universidad Autónoma de Yucatán", "pública"),
    ("UASLP", "Universidad Autónoma de San Luis Potosí", "pública"),
    ("UABC", "Universidad Autónoma de Baja California", "pública"),
    ("UNISON", "Universidad de Sonora", "pública"),
    ("UACH", "Universidad Autónoma de Chihuahua", "pública"),
]

INSTITUCIONES = {
    f"N{i + 1:02d}": {"sigla": s, "nombre": n, "tipo": t}
    for i, (s, n, t) in enumerate(_INSTITUCIONES)
}


def institucion(nodo_id):
    """Datos de la institución que representa un nodo (siempre devuelve algo)."""
    return INSTITUCIONES.get(nodo_id, {"sigla": nodo_id, "nombre": nodo_id, "tipo": ""})


def etiqueta(nodo_id):
    """«N03 · IPN»: identificador técnico y siglas, para los textos de la bitácora."""
    return f"{nodo_id} · {institucion(nodo_id)['sigla']}"
