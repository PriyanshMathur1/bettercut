"""Settings, all from environment variables (see deploy/.env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("BETTERCUT_DATA", Path.home() / "bettercut-cloud")).expanduser())
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))
    public_url: str = field(default_factory=lambda: os.environ.get("PUBLIC_URL", "http://localhost:4790").rstrip("/"))

    # auth: "dev" (one local user, no login) or "supabase"
    auth_mode: str = field(default_factory=lambda: os.environ.get("AUTH_MODE", "dev"))
    supabase_url: str = field(default_factory=lambda: os.environ.get("SUPABASE_URL", "").rstrip("/"))
    supabase_anon_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_ANON_KEY", ""))
    supabase_jwt_secret: str = field(default_factory=lambda: os.environ.get("SUPABASE_JWT_SECRET", ""))
    # sign-in providers accepted from Supabase ("google" = Sign in with Google only)
    auth_providers: list[str] = field(default_factory=lambda: [p.strip().lower() for p in os.environ.get("AUTH_PROVIDERS", "google").split(",") if p.strip()])
    allowed_emails: list[str] = field(default_factory=lambda: [e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()])

    # storage: "local" or "s3" (Cloudflare R2, Backblaze B2, MinIO, AWS S3)
    storage: str = field(default_factory=lambda: os.environ.get("STORAGE", "local"))
    s3_endpoint: str = field(default_factory=lambda: os.environ.get("S3_ENDPOINT", ""))
    s3_bucket: str = field(default_factory=lambda: os.environ.get("S3_BUCKET", ""))
    s3_key_id: str = field(default_factory=lambda: os.environ.get("S3_ACCESS_KEY_ID", ""))
    s3_secret: str = field(default_factory=lambda: os.environ.get("S3_SECRET_ACCESS_KEY", ""))
    s3_region: str = field(default_factory=lambda: os.environ.get("S3_REGION", "auto"))

    # secrets: 32-byte key (base64) for encrypting model keys and signing media links
    secret: str = field(default_factory=lambda: os.environ.get("BETTERCUT_SECRET", ""))

    # free-tier guard rails
    workers: int = field(default_factory=lambda: _int("WORKERS", 1))
    whisper_model: str = field(default_factory=lambda: os.environ.get("WHISPER_MODEL", "small"))
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 500))
    max_clip_seconds: int = field(default_factory=lambda: _int("MAX_CLIP_SECONDS", 180))
    max_projects: int = field(default_factory=lambda: _int("MAX_PROJECTS", 25))
    renders_per_day: int = field(default_factory=lambda: _int("RENDERS_PER_DAY", 20))
    allow_cutout: bool = field(default_factory=lambda: os.environ.get("ALLOW_CUTOUT", "0") == "1")
    agent_max_steps: int = field(default_factory=lambda: _int("AGENT_MAX_STEPS", 12))

    def __post_init__(self) -> None:
        if not self.database_url:
            self.database_url = f"sqlite:///{self.data_dir / 'bettercut.db'}"

    @property
    def work_dir(self) -> Path:
        return self.data_dir / "work"


_settings: Settings | None = None


def settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset(new: Settings | None = None) -> Settings:
    """Tests: swap settings."""
    global _settings
    _settings = new or Settings()
    return _settings
