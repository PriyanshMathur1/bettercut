"""Database: SQLite locally, Postgres (e.g. Supabase) in production. Tables are created on startup."""
from __future__ import annotations

import time
import uuid
from contextlib import contextmanager

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text, create_engine, event, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import settings


def _id() -> str:
    return uuid.uuid4().hex


def _now() -> float:
    return time.time()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # Supabase auth user id (or "dev")
    email: Mapped[str] = mapped_column(String(320), default="")
    brand: Mapped[dict] = mapped_column(JSON, default=dict)
    created: Mapped[float] = mapped_column(Float, default=_now)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="reel")
    status: Mapped[str] = mapped_column(String(20), default="processing")  # processing | ready | error
    created: Mapped[float] = mapped_column(Float, default=_now)
    updated: Mapped[float] = mapped_column(Float, default=_now)


class SpecVersion(Base):
    __tablename__ = "spec_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    spec: Mapped[dict] = mapped_column(JSON)
    author: Mapped[str] = mapped_column(String(20))  # user | agent | pipeline
    summary: Mapped[str] = mapped_column(Text, default="")
    created: Mapped[float] = mapped_column(Float, default=_now)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(20))  # make | render | bake | notes | broll
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)  # queued | running | done | error
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    log: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created: Mapped[float] = mapped_column(Float, default=_now)
    started: Mapped[float | None] = mapped_column(Float, nullable=True)
    finished: Mapped[float | None] = mapped_column(Float, nullable=True)


class Render(Base):
    __tablename__ = "renders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    key: Mapped[str] = mapped_column(String(500))  # storage key
    aspect: Mapped[str] = mapped_column(String(10), default="9x16")
    quality: Mapped[str] = mapped_column(String(10), default="high")
    created: Mapped[float] = mapped_column(Float, default=_now)


class ModelConnection(Base):
    __tablename__ = "model_connections"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(30))  # anthropic | openai | gemini | openrouter | openai_compatible
    model: Mapped[str] = mapped_column(String(200))
    api_base: Mapped[str] = mapped_column(String(500), default="")
    key_enc: Mapped[str] = mapped_column(Text, default="")
    key_last4: Mapped[str] = mapped_column(String(8), default="")
    caps: Mapped[dict] = mapped_column(JSON, default=dict)  # {tools, vision, ok, error, latency}
    is_default: Mapped[bool] = mapped_column(default=False)
    created: Mapped[float] = mapped_column(Float, default=_now)


class Connector(Base):
    """A personal MCP link (/mcp/<token>): lets the user's own AI app edit their reels."""
    __tablename__ = "connectors"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_enc: Mapped[str] = mapped_column(Text, default="")
    created: Mapped[float] = mapped_column(Float, default=_now)
    last_used: Mapped[float | None] = mapped_column(Float, nullable=True)


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # spelling | preference | style
    text: Mapped[str] = mapped_column(Text)
    value: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # preference: a partial spec merged into new reels
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | proposed
    source: Mapped[str] = mapped_column(String(20), default="user")  # user | agent
    created: Mapped[float] = mapped_column(Float, default=_now)


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    at: Mapped[float | None] = mapped_column(Float, nullable=True)  # output seconds, None = whole reel
    text: Mapped[str] = mapped_column(Text)
    reply: Mapped[str] = mapped_column(Text, default="")
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created: Mapped[float] = mapped_column(Float, default=_now)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(30))
    model: Mapped[str] = mapped_column(String(200))
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    steps: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str] = mapped_column(Text, default="")
    created: Mapped[float] = mapped_column(Float, default=_now)


_engine = None
_Session: sessionmaker | None = None


def engine():
    global _engine, _Session
    if _engine is None:
        url = settings().database_url
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        kw: dict = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            settings().data_dir.mkdir(parents=True, exist_ok=True)
            kw["connect_args"] = {"check_same_thread": False, "timeout": 30}
        _engine = create_engine(url, **kw)
        if url.startswith("sqlite"):
            @event.listens_for(_engine, "connect")
            def _fk(conn, _):  # noqa: ANN001
                conn.execute("PRAGMA foreign_keys=ON")
                conn.execute("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(_engine)
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def reset() -> None:
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _Session = None


@contextmanager
def session() -> Session:
    engine()
    assert _Session is not None
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def latest_spec(s: Session, project_id: str) -> SpecVersion | None:
    return s.scalars(select(SpecVersion).where(SpecVersion.project_id == project_id).order_by(SpecVersion.id.desc()).limit(1)).first()
