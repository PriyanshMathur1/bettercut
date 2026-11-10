"""Who is calling. Supabase issues the login (email link or Google); the API only verifies its JWT.

- AUTH_MODE=dev: everyone is the single local user "dev" (for running on your own machine).
- AUTH_MODE=supabase: `Authorization: Bearer <access token>` from supabase-js. Verified with the project's
  JWT secret (HS256, SUPABASE_JWT_SECRET) when set, otherwise with the project's public signing keys (JWKS).
  AUTH_PROVIDERS (default "google") limits which sign-in methods are accepted: Google only by default.
  ALLOWED_EMAILS, when set, limits sign-in to an invite list (private beta).
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import HTTPException, Request

from . import db
from .config import settings


@dataclass
class Caller:
    id: str
    email: str


@lru_cache(maxsize=1)
def _jwks(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def verify_token(token: str) -> dict:
    s = settings()
    try:
        if s.supabase_jwt_secret:
            return jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        if not s.supabase_url:
            raise HTTPException(500, "server misconfigured: set SUPABASE_URL")
        key = _jwks(f"{s.supabase_url}/auth/v1/.well-known/jwks.json").get_signing_key_from_jwt(token)
        return jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience="authenticated")
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "session expired: sign in again")
    except jwt.PyJWTError:
        raise HTTPException(401, "not signed in")


def caller(request: Request) -> Caller:
    s = settings()
    if s.auth_mode == "dev":
        c = Caller("dev", "dev@localhost")
    else:
        h = request.headers.get("authorization", "")
        if not h.lower().startswith("bearer "):
            raise HTTPException(401, "not signed in")
        claims = verify_token(h[7:].strip())
        c = Caller(str(claims["sub"]), str(claims.get("email", "")).lower())
        meta = claims.get("app_metadata") or {}
        used = {str(meta.get("provider", "")).lower(), *[str(p).lower() for p in meta.get("providers") or []]}
        if s.auth_providers and not used & set(s.auth_providers):
            raise HTTPException(403, "sign in with Google to use BetterCut")
        if s.allowed_emails and c.email not in s.allowed_emails:
            raise HTTPException(403, "this beta is invite-only: ask for an invite")
    with db.session() as ses:
        if ses.get(db.User, c.id) is None:
            ses.add(db.User(id=c.id, email=c.email))
    return c
