"""Checks on anything untrusted that the server will act on.

A spec names media files, and the renderer reads whatever it names. In a hosted editor a spec comes from a
browser or an AI model, so media fields may only be: a file inside the project ("@proj/..."), an https URL on
the stock-media allowlist, or a bare built-in name (a sound effect, a LUT). Anything else is refused, which
rules out reading server files ("/etc/...") or calling internal addresses.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlparse

from .storage import TOKEN

MEDIA_KEYS = {"src", "matte", "graded", "gradedMatte", "music", "media", "background", "sound", "lut"}
MEDIA_HOSTS = {"videos.pexels.com", "images.pexels.com", "player.vimeo.com"}
_NAME = re.compile(r"^[\w][\w .-]{0,80}$")
_HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def _ok_media(v: str) -> bool:
    if v == "" or _HEX.match(v):
        return True
    if v.startswith(TOKEN):
        rest = v[len(TOKEN):]
        return ".." not in rest and not rest.startswith("/") and "\\" not in rest
    if v.startswith("https://"):
        return (urlparse(v).hostname or "") in MEDIA_HOSTS
    return bool(_NAME.match(v)) and "/" not in v


def spec_issues(spec, key: str | None = None, path: str = "") -> list[str]:
    out: list[str] = []
    if isinstance(spec, dict):
        for k, v in spec.items():
            out += spec_issues(v, k, f"{path}/{k}")
    elif isinstance(spec, list):
        for i, v in enumerate(spec):
            out += spec_issues(v, key, f"{path}/{i}")
    elif isinstance(spec, str) and key in MEDIA_KEYS and not _ok_media(spec):
        out.append(f"{path}: only files uploaded to this reel can be used here")
    return out


def same_source(new: dict, old: dict) -> bool:
    a, b = new.get("source") or {}, old.get("source") or {}
    return all(a.get(k) == b.get(k) for k in ("src", "matte", "width", "height", "duration", "fps"))


def public_url_issue(url: str, allow_private: bool = False) -> str | None:
    """For user-supplied model endpoints: https to a public host only (unless running in dev)."""
    u = urlparse(url)
    if u.scheme not in ("https", "http") or not u.hostname:
        return "enter a full URL starting with https://"
    if allow_private:
        return None
    if u.scheme != "https":
        return "the URL must use https"
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return "that host name doesn't resolve"
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return "that URL points to a private network address, which a hosted server can't reach safely"
    return None
