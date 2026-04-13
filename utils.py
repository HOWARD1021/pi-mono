"""
Utility functions for common operations.

This module provides utility functions for string manipulation,
data validation, and mathematical operations.
"""

import re
from typing import List, Dict, Any, Optional


def capitalize_words(text: str) -> str:
    """
    Capitalize the first letter of each word in a string.
    
    Args:
        text: The input string to capitalize.
        
    Returns:
        A new string with each word capitalized.
        
    Examples:
        >>> capitalize_words("hello world")
        'Hello World'
        >>> capitalize_words("python programming")
        'Python Programming'
    """
    return " ".join(word.capitalize() for word in text.split())


def is_valid_email(email: str) -> bool:
    """
    Validate if a string is a properly formatted email address.
    
    Args:
        email: The email string to validate.
        
    Returns:
        True if the email is valid, False otherwise.
        
    Examples:
        >>> is_valid_email("user@example.com")
        True
        >>> is_valid_email("invalid.email")
        False
    """
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def calculate_average(numbers: List[float]) -> Optional[float]:
    """
    Calculate the average of a list of numbers.
    
    Args:
        numbers: A list of numeric values.
        
    Returns:
        The average of the numbers, or None if the list is empty.
        
    Examples:
        >>> calculate_average([1, 2, 3, 4, 5])
        3.0
        >>> calculate_average([])
        None
    """
    if not numbers:
        return None
    return sum(numbers) / len(numbers)


def merge_dicts(dict1: Dict[str, Any], dict2: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge two dictionaries, with dict2 values taking precedence.
    
    Args:
        dict1: The first dictionary.
        dict2: The second dictionary (values override dict1).
        
    Returns:
        A new dictionary containing merged key-value pairs.
        
    Examples:
        >>> merge_dicts({"a": 1, "b": 2}, {"b": 3, "c": 4})
        {'a': 1, 'b': 3, 'c': 4}
    """
    result = dict1.copy()
    result.update(dict2)
    return result
