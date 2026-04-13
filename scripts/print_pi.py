#!/usr/bin/env python3
"""Utility to print the mathematical constant pi."""

from __future__ import annotations
import argparse
import math
from typing import NoReturn


def print_pi(precision: int = 15) -> None:
    """Print pi to stdout with the given decimal precision.
    
    Args:
        precision: Number of digits after the decimal point (1-100).
    """
    if not isinstance(precision, int):
        raise TypeError("precision must be an int")
    if precision < 1 or precision > 100:
        raise ValueError("precision must be between 1 and 100")
    print(f"{math.pi:.{precision}f}")


def _main() -> NoReturn:
    parser = argparse.ArgumentParser(description="Print pi to stdout.")
    parser.add_argument('-p', '--precision', type=int, default=15,
                        help="Digits after the decimal point (1-100). Default: 15")
    args = parser.parse_args()
    print_pi(args.precision)
    raise SystemExit(0)


if __name__ == "__main__":
    _main()
