"""Primer arranque: universidades con llaves Ed25519, cuentas y la cola de credenciales de demostración."""
import json
import os
from datetime import date, timedelta

from sqlalchemy import func, select

import reglas
from blockchain import Billetera
from models import IssuerKey, Pending, User
from seguridad import hash_password

DEMO_PASSWORD = "titulo-demo-2026"
UNIVERSIDADES = [
    ("ADM", "Título Seguro · Administración"),
    ("UAN", "Universidad Anáhuac México"),
    ("UDM", "Universidad Demo (ficticia)"),
]
# username, nombre, rol, código de universidad, matrícula
USUARIOS_DEMO = [
    ("admin", "Administración Título Seguro", "ADMIN", "ADM", None),
    ("uan", "Universidad Anáhuac México", "UNIVERSITY", "UAN", None),
    ("udm", "Universidad Demo", "UNIVERSITY", "UDM", None),
    ("minero", "Operador de minería", "MINER", None, None),
    ("alumno", "Alumno de demostración", "STUDENT", None, "A00123456"),
]
PROGRAMAS = [
    "Ingeniería en Sistemas", "Ingeniería Industrial", "Medicina", "Derecho", "Arquitectura",
    "Psicología", "Administración de Empresas", "Contaduría", "Diseño Gráfico", "Comunicación",
    "Nutrición", "Economía",
]
# las primeras de la cola son del alumno demo: así sus primeros bloques minados son suyos
CREDENCIALES_ALUMNO_DEMO = [
    ("Ingeniería en Sistemas", "título"),
    ("Ingeniería en Sistemas", "diploma"),
    ("Ingeniería en Sistemas", "certificado"),
]


def demo_activo():
    return os.environ.get("SEED_DEMO", "0" if os.environ.get("TS_ENV") == "production" else "1") == "1"


def sembrar(Session, secretos, demo=None, n_pendientes=None):
    demo = demo_activo() if demo is None else demo
    with Session() as s:
        if s.scalar(select(func.count()).select_from(User)):
            return None  # ya sembrado

        llaves = {}
        for codigo, nombre in UNIVERSIDADES:
            w = Billetera()
            s.add(IssuerKey(universidad_codigo=codigo, universidad_nombre=nombre, pub=w.pub,
                            priv_cifrada=secretos.cifrar(w.priv_hex)))
            llaves[codigo] = w

        if demo:
            for username, nombre, rol, codigo, matricula in USUARIOS_DEMO:
                s.add(User(username=username, nombre=nombre, rol=rol, universidad_codigo=codigo,
                           password_hash=hash_password(DEMO_PASSWORD),
                           matricula_hmac=secretos.alumno_id(matricula) if matricula else None))
        else:
            pw = os.environ.get("ADMIN_PASSWORD")
            if not pw:
                raise RuntimeError("Sin SEED_DEMO, define ADMIN_PASSWORD para crear la cuenta 'admin'.")
            s.add(User(username="admin", nombre="Administración", rol="ADMIN", universidad_codigo="ADM",
                       password_hash=hash_password(pw)))

        n = (1000 if demo else 0) if n_pendientes is None else n_pendientes
        w = llaves["UAN"]
        base = date(2026, 1, 1)
        for i in range(n):
            if i < len(CREDENCIALES_ALUMNO_DEMO):
                programa, tipo = CREDENCIALES_ALUMNO_DEMO[i]
                matricula = "A00123456"
            else:
                programa = PROGRAMAS[i % len(PROGRAMAS)]
                tipo = reglas.TIPOS[(i // len(PROGRAMAS)) % 2 if i % 7 else 2 + i % 2]
                matricula = f"DEMO-{i:04d}"
            fecha = (base + timedelta(days=i % 270)).isoformat()
            tx = reglas.construir_registro("UAN", w.pub, secretos.alumno_id(matricula), programa, tipo, fecha)
            c = tx["contenido"]
            s.add(Pending(tipo_tx="registro", folio=c["folio"], huella=c["huella_documento"],
                          clave_dup=reglas.clave_dup(c), alumno_id=c["alumno_id"],
                          tx_json=json.dumps(tx, sort_keys=True), firma=w.firmar(tx)))
        s.commit()
    return {"demo": demo, "pendientes": n}
