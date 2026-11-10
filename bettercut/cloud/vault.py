"""Secrets: model API keys are encrypted at rest (AES-256-GCM) and media links are signed (HMAC-SHA256).

The master key comes from BETTERCUT_SECRET (base64, 32 bytes). In dev, one is generated once into the data
folder so restarts keep working; in production set it explicitly and keep a copy somewhere safe: losing it
means every stored model key has to be re-entered.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

_KEY: bytes | None = None


def master_key() -> bytes:
    global _KEY
    if _KEY is None:
        s = settings()
        raw = s.secret
        if not raw:
            f = s.data_dir / ".secret"
            if not f.exists():
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(base64.b64encode(secrets.token_bytes(32)).decode())
                os.chmod(f, 0o600)
            raw = f.read_text().strip()
        key = base64.b64decode(raw)
        if len(key) != 32:
            raise RuntimeError("BETTERCUT_SECRET must be 32 bytes, base64-encoded (openssl rand -base64 32)")
        _KEY = key
    return _KEY


def reset() -> None:
    global _KEY
    _KEY = None


def encrypt(plain: str, context: str) -> str:
    """`context` (e.g. the user id) is bound in as associated data, so a ciphertext can't be moved to another user."""
    nonce = secrets.token_bytes(12)
    ct = AESGCM(master_key()).encrypt(nonce, plain.encode(), context.encode())
    return "v1:" + base64.b64encode(nonce + ct).decode()


def decrypt(token: str, context: str) -> str:
    if not token.startswith("v1:"):
        raise ValueError("unknown key format")
    blob = base64.b64decode(token[3:])
    return AESGCM(master_key()).decrypt(blob[:12], blob[12:], context.encode()).decode()


def _sig(msg: str) -> str:
    return base64.urlsafe_b64encode(hmac.new(master_key(), msg.encode(), hashlib.sha256).digest()[:18]).decode().rstrip("=")


def sign(path: str, ttl: int = 6 * 3600) -> str:
    """Query string granting read access to `path` until expiry (for <video>/<img>, which can't send headers)."""
    exp = int(time.time()) + ttl
    return f"exp={exp}&sig={_sig(f'{path}|{exp}')}"


def verify(path: str, exp: str, sig: str) -> bool:
    try:
        if int(exp) < time.time():
            return False
    except ValueError:
        return False
    return hmac.compare_digest(_sig(f"{path}|{exp}"), sig)
