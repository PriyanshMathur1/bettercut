"""Tests never touch the network: a model call or download in a test would cost money or flake.

Loopback stays open (the tests start small local servers). Anything else raises.
"""
import socket

import pytest

LOCAL = {"localhost", "127.0.0.1", "::1", "0.0.0.0", ""}
_connect = socket.socket.connect


def _guarded(self, address, *args, **kwargs):
    host = address[0] if isinstance(address, tuple) else ""
    if isinstance(address, tuple) and host not in LOCAL:
        raise RuntimeError(f"test tried to reach the network: {host}")
    return _connect(self, address, *args, **kwargs)


@pytest.fixture(autouse=True, scope="session")
def no_network():
    socket.socket.connect = _guarded
    yield
    socket.socket.connect = _connect
