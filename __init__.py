"""
A Python package with utility functions.

This package provides common utility functions for string manipulation,
data validation, and mathematical operations.
"""

from .utils import (
    capitalize_words,
    is_valid_email,
    calculate_average,
    merge_dicts,
)

__version__ = "0.1.0"
__all__ = [
    "capitalize_words",
    "is_valid_email",
    "calculate_average",
    "merge_dicts",
]
