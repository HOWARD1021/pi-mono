"""Simple hello script.

This module exposes a main entry point which prints a greeting.
"""


def greet(name: str = "World") -> None:
    """Print a greeting message.
    
    Args:
        name: The name to greet. Defaults to "World".
    """
    print(f"Hello, {name}!")


def main() -> None:
    """Main entry point for the script."""
    greet()


if __name__ == "__main__":
    main()
