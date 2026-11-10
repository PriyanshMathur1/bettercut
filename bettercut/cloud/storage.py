"""Durable media storage plus a per-project working folder on the server's disk.

The pipeline and renderer work on a normal project folder. Specs in the database never hold absolute paths:
files inside the project are written as "@proj/assets/source.mp4". `absolutise` turns those into paths in the
working folder before a job, `relativise` turns them back after it, and `media_urls` gives the browser a
signed URL for each one.

Backends:
- local: the working folder *is* the store (nothing copied). Good for one server with a big disk.
- s3:    any S3-compatible bucket (Cloudflare R2: 10 GB free, no download fees). The working folder is a
         cache; files missing from it are fetched before a job, new outputs are uploaded after it.
"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable, Iterable

from . import vault
from .config import settings

TOKEN = "@proj/"
SYNC_DIRS = ("assets", "renders")


def project_dir(user_id: str, project_id: str) -> Path:
    return settings().work_dir / user_id / project_id


def key_for(user_id: str, project_id: str, rel: str) -> str:
    return f"{user_id}/{project_id}/{rel}"


# ---- spec path tokens ------------------------------------------------------------

def _walk(value, fn: Callable[[str], str]):
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [_walk(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _walk(v, fn) for k, v in value.items()}
    return value


def relativise(spec: dict, proj: Path) -> dict:
    root = str(proj.resolve()) + "/"
    alt = str(proj) + "/"
    return _walk(spec, lambda s: TOKEN + s[len(root):] if s.startswith(root) else (TOKEN + s[len(alt):] if s.startswith(alt) else s))


def absolutise(spec: dict, proj: Path) -> dict:
    return _walk(spec, lambda s: str(proj / s[len(TOKEN):]) if s.startswith(TOKEN) else s)


def referenced(spec: dict) -> list[str]:
    found: list[str] = []
    _walk(spec, lambda s: (found.append(s[len(TOKEN):]) if s.startswith(TOKEN) and ".." not in s else None) or s)
    return sorted(set(found))


# ---- backends ----------------------------------------------------------------------

class LocalStorage:
    kind = "local"

    def __init__(self, root: Path):
        self.root = root

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root.resolve()) + "/"):
            raise ValueError("bad key")
        return p

    def put(self, key: str, local: Path) -> None:
        dst = self.path(key)
        if dst == local.resolve():
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local, dst)

    def get(self, key: str, local: Path) -> bool:
        src = self.path(key)
        if not src.exists():
            return False
        if src != local.resolve():
            local.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, local)
        return True

    def exists(self, key: str) -> bool:
        return self.path(key).exists()

    def url(self, key: str, ttl: int = 6 * 3600) -> str:
        return f"/api/media/{key}?{vault.sign(key, ttl)}"

    def delete_prefix(self, prefix: str) -> None:
        shutil.rmtree(self.path(prefix.rstrip("/")), ignore_errors=True)

    def size(self, prefix: str) -> int:
        p = self.path(prefix.rstrip("/"))
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


class S3Storage:
    kind = "s3"

    def __init__(self, bucket: str, endpoint: str | None, key_id: str, secret: str, region: str = "auto", client=None):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.s3 = client or boto3.client(
            "s3", endpoint_url=endpoint or None, aws_access_key_id=key_id, aws_secret_access_key=secret,
            region_name=region, config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def put(self, key: str, local: Path) -> None:
        import mimetypes

        ctype = mimetypes.guess_type(local.name)[0] or "application/octet-stream"
        self.s3.upload_file(str(local), self.bucket, key, ExtraArgs={"ContentType": ctype})

    def get(self, key: str, local: Path) -> bool:
        if not self.exists(key):
            return False
        local.parent.mkdir(parents=True, exist_ok=True)
        self.s3.download_file(self.bucket, key, str(local))
        return True

    def exists(self, key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def url(self, key: str, ttl: int = 6 * 3600) -> str:
        return self.s3.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=ttl)

    def _keys(self, prefix: str) -> Iterable[dict]:
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            yield from page.get("Contents", [])

    def delete_prefix(self, prefix: str) -> None:
        keys = [{"Key": o["Key"]} for o in self._keys(prefix)]
        for i in range(0, len(keys), 1000):
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": keys[i:i + 1000]})

    def size(self, prefix: str) -> int:
        return sum(o["Size"] for o in self._keys(prefix))


_store = None


def store():
    global _store
    if _store is None:
        s = settings()
        if s.storage == "s3":
            if not (s.s3_bucket and s.s3_key_id and s.s3_secret):
                raise RuntimeError("STORAGE=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY")
            _store = S3Storage(s.s3_bucket, s.s3_endpoint, s.s3_key_id, s.s3_secret, s.s3_region)
        else:
            _store = LocalStorage(s.work_dir)
    return _store


def reset(new=None) -> None:
    global _store
    _store = new


# ---- syncing a working folder ------------------------------------------------------

def sync_down(user_id: str, project_id: str, rels: Iterable[str]) -> list[str]:
    """Fetch files the spec needs that aren't in the working folder. Returns the ones that are missing everywhere."""
    st, proj = store(), project_dir(user_id, project_id)
    missing = []
    for rel in rels:
        local = proj / rel
        if not local.exists() and not st.get(key_for(user_id, project_id, rel), local):
            missing.append(rel)
    return missing


def sync_up(user_id: str, project_id: str, since: float = 0.0) -> int:
    """Upload outputs (assets/, renders/) changed since `since`. No-op for the local backend."""
    st, proj = store(), project_dir(user_id, project_id)
    if st.kind == "local":
        return 0
    n = 0
    for d in SYNC_DIRS:
        for f in (proj / d).rglob("*") if (proj / d).exists() else []:
            if f.is_file() and f.stat().st_mtime >= since:
                st.put(key_for(user_id, project_id, str(f.relative_to(proj))), f)
                n += 1
    return n


def media_urls(user_id: str, project_id: str, spec: dict) -> dict[str, str]:
    st = store()
    return {TOKEN + rel: st.url(key_for(user_id, project_id, rel)) for rel in referenced(spec)}
