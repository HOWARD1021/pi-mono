#!/usr/bin/env python3
"""hello_copilot: Simple script added for the task.
"""

def greet(name: str = "Copilot") -> str:
    """Return a greeting for the given name."""
    return f"Hello, {name}!"


def main() -> None:
    """Entry point for the script."""
    print(greet())


if __name__ == "__main__":
    main()
