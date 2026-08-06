#!/usr/bin/env python3
"""Trusted Windows launch gate for the Codex behavior-eval process tree."""

from __future__ import annotations

import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 2:
        return 125

    # The parent writes this byte only after assigning this launcher to a
    # kill-on-close Job Object. Children then inherit that containment.
    if sys.stdin.buffer.read(1) != b"\x01":
        return 125

    try:
        process = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL)
    except OSError:
        return 125
    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
