"""Persistencia: SQLAlchemy sobre PostgreSQL (DATABASE_URL) o SQLite como respaldo local."""
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, Index, Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

BASE_DIR = Path(__file__).resolve().parent

ROLES = ("ADMIN", "UNIVERSITY", "MINER", "STUDENT")


def url_base_datos(url=None):
    url = url or os.environ.get("DATABASE_URL")
    if not url:
        return f"sqlite:///{(BASE_DIR / 'tituloseguro.db').as_posix()}"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _ahora():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(100))
    rol: Mapped[str] = mapped_column(String(12))
    universidad_codigo: Mapped[str | None] = mapped_column(String(3), nullable=True)
    matricula_hmac: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    creado: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora)


class IssuerKey(Base):
    """Llave Ed25519 de una institución emisora. La privada se guarda cifrada y nunca sale al cliente."""
    __tablename__ = "issuer_keys"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    universidad_codigo: Mapped[str] = mapped_column(String(3), unique=True)
    universidad_nombre: Mapped[str] = mapped_column(String(120))
    pub: Mapped[str] = mapped_column(String(64), unique=True)
    priv_cifrada: Mapped[str] = mapped_column(Text)


class Pending(Base):
    __tablename__ = "pending"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # el orden de llegada es el orden de minado
    tipo_tx: Mapped[str] = mapped_column(String(12))            # registro | revocacion
    folio: Mapped[str] = mapped_column(String(24), index=True)
    huella: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    clave_dup: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    alumno_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    tx_json: Mapped[str] = mapped_column(Text)
    firma: Mapped[str] = mapped_column(String(128))
    estado: Mapped[str] = mapped_column(String(10), default="pendiente", index=True)  # pendiente|minando|minada|rechazada
    motivo: Mapped[str | None] = mapped_column(Text, nullable=True)
    emisor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora)

    __table_args__ = (Index("ix_pending_estado_id", "estado", "id"),)


class BlockRow(Base):
    __tablename__ = "blocks"
    numero: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    hash: Mapped[str] = mapped_column(String(64), unique=True)
    json: Mapped[str] = mapped_column(Text)
    creado: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora)


class Config(Base):
    __tablename__ = "config"
    clave: Mapped[str] = mapped_column(String(40), primary_key=True)
    valor: Mapped[str] = mapped_column(String(200))


def crear_motor(url=None):
    url = url_base_datos(url)
    if url.startswith("sqlite"):
        motor = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

        @event.listens_for(motor, "connect")
        def _pragmas(conexion, _):
            cur = conexion.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()
    else:
        motor = create_engine(url, pool_pre_ping=True)
    Base.metadata.create_all(motor)
    return motor


def crear_sesiones(motor):
    return sessionmaker(motor, expire_on_commit=False)
