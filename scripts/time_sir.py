#!/usr/bin/env python3
from datetime import datetime

def main() -> None:
    now = datetime.now().astimezone()
    print(now.strftime("Sir, it's %a %b %d %H:%M:%S %Z %Y."))

if __name__ == "__main__":
    main()
