"""
Unit tests for utility functions.

This module contains test cases for all utility functions
in the utils module.
"""

import pytest
from utils import (
    capitalize_words,
    is_valid_email,
    calculate_average,
    merge_dicts,
)


class TestCapitalizeWords:
    """Test cases for capitalize_words function."""
    
    def test_basic_capitalization(self):
        """Test basic word capitalization."""
        assert capitalize_words("hello world") == "Hello World"
        
    def test_already_capitalized(self):
        """Test string that's already capitalized."""
        assert capitalize_words("Hello World") == "Hello World"
        
    def test_mixed_case(self):
        """Test mixed case input."""
        assert capitalize_words("hELLo WoRLd") == "Hello World"
        
    def test_single_word(self):
        """Test single word input."""
        assert capitalize_words("python") == "Python"
        
    def test_empty_string(self):
        """Test empty string input."""
        assert capitalize_words("") == ""


class TestIsValidEmail:
    """Test cases for is_valid_email function."""
    
    def test_valid_email(self):
        """Test valid email addresses."""
        assert is_valid_email("user@example.com") is True
        assert is_valid_email("test.user@domain.co.uk") is True
        assert is_valid_email("name+tag@company.org") is True
        
    def test_invalid_email_no_at(self):
        """Test email without @ symbol."""
        assert is_valid_email("invalid.email.com") is False
        
    def test_invalid_email_no_domain(self):
        """Test email without domain."""
        assert is_valid_email("user@") is False
        
    def test_invalid_email_no_tld(self):
        """Test email without top-level domain."""
        assert is_valid_email("user@domain") is False
        
    def test_invalid_email_spaces(self):
        """Test email with spaces."""
        assert is_valid_email("user name@example.com") is False


class TestCalculateAverage:
    """Test cases for calculate_average function."""
    
    def test_positive_numbers(self):
        """Test average of positive numbers."""
        assert calculate_average([1, 2, 3, 4, 5]) == 3.0
        
    def test_negative_numbers(self):
        """Test average of negative numbers."""
        assert calculate_average([-1, -2, -3]) == -2.0
        
    def test_mixed_numbers(self):
        """Test average of mixed positive and negative numbers."""
        assert calculate_average([-10, 0, 10]) == 0.0
        
    def test_single_number(self):
        """Test average of single number."""
        assert calculate_average([42]) == 42.0
        
    def test_empty_list(self):
        """Test average of empty list."""
        assert calculate_average([]) is None
        
    def test_floats(self):
        """Test average of floating point numbers."""
        result = calculate_average([1.5, 2.5, 3.5])
        assert abs(result - 2.5) < 0.0001


class TestMergeDicts:
    """Test cases for merge_dicts function."""
    
    def test_basic_merge(self):
        """Test basic dictionary merge."""
        result = merge_dicts({"a": 1, "b": 2}, {"c": 3})
        assert result == {"a": 1, "b": 2, "c": 3}
        
    def test_override_values(self):
        """Test that dict2 values override dict1."""
        result = merge_dicts({"a": 1, "b": 2}, {"b": 3, "c": 4})
        assert result == {"a": 1, "b": 3, "c": 4}
        
    def test_empty_dicts(self):
        """Test merging empty dictionaries."""
        assert merge_dicts({}, {}) == {}
        assert merge_dicts({"a": 1}, {}) == {"a": 1}
        assert merge_dicts({}, {"b": 2}) == {"b": 2}
        
    def test_original_unchanged(self):
        """Test that original dictionaries are not modified."""
        dict1 = {"a": 1}
        dict2 = {"b": 2}
        result = merge_dicts(dict1, dict2)
        assert dict1 == {"a": 1}
        assert dict2 == {"b": 2}
        assert result == {"a": 1, "b": 2}
