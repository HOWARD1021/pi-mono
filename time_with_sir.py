from datetime import datetime


def tell_time_with_respect() -> None:
    """Print the current local time with a polite suffix."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"The time is {now}, sir.")


if __name__ == "__main__":
    tell_time_with_respect()
