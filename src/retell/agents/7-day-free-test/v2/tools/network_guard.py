"""Fail-closed network guard for deterministic Retell v2 candidate tests."""

from __future__ import annotations

import contextlib
import http.client
import importlib.util
import socket
import urllib.request
from collections.abc import Iterator
from unittest import mock


class NetworkGuard:
    """Block network entry points and count every attempted connection."""

    def __init__(self) -> None:
        self.attempt_count = 0
        self._stack = contextlib.ExitStack()

    def _blocked(self, *_args: object, **_kwargs: object) -> None:
        self.attempt_count += 1
        raise AssertionError("Network access is prohibited by the Retell v2 test boundary")

    def __enter__(self) -> "NetworkGuard":
        self._stack.enter_context(mock.patch.object(socket, "create_connection", self._blocked))
        self._stack.enter_context(mock.patch.object(socket.socket, "connect", self._blocked))
        self._stack.enter_context(mock.patch.object(urllib.request, "urlopen", self._blocked))
        self._stack.enter_context(
            mock.patch.object(http.client.HTTPConnection, "request", self._blocked)
        )
        self._stack.enter_context(
            mock.patch.object(http.client.HTTPSConnection, "request", self._blocked)
        )

        if importlib.util.find_spec("requests") is not None:
            import requests

            self._stack.enter_context(
                mock.patch.object(requests.Session, "request", self._blocked)
            )
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._stack.__exit__(*exc_info)


@contextlib.contextmanager
def network_blocked() -> Iterator[NetworkGuard]:
    guard = NetworkGuard()
    with guard:
        yield guard
