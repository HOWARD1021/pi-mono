#!/usr/bin/env python3
"""
Lightweight joke generator CLI.

Usage examples:
  - One programmer joke:  python3 jokegen.py --style programmer
  - Five dad jokes:       python3 jokegen.py -n 5 --style dad
  - List styles:          python3 jokegen.py --list-styles
  - Deterministic output: python3 jokegen.py --seed 42 -n 3

No external dependencies. Python 3.8+.
"""

from __future__ import annotations

import argparse
import random
import sys
from typing import Callable, Dict, List


def _choose(seq: List[str]) -> str:
    return random.choice(seq)


def _maybe_topic_words(topic: str | None) -> List[str]:
    if not topic:
        return []
    # Split topic on non-alphanumerics and add a few variants
    base = [w for w in topic.replace("_", " ").replace("-", " ").split() if w]
    variants = set(base)
    for w in base:
        variants.add(w.lower())
        variants.add(w.capitalize())
    return list(variants)


def joke_programmer(topic: str | None = None) -> str:
    subjects = [
        "developer",
        "AI",
        "database",
        "regex",
        "frontend",
        "backend",
        "DevOps",
        "QA",
        "manager",
        "Docker container",
        "microservice",
        "TypeScript",
        "Python",
        "compiler",
    ] + _maybe_topic_words(topic)

    templates = [
        "Why did the {s} go broke? It used up all its cache.",
        "The {s} walked into a bar... and immediately threw a TypeError.",
        "I asked the {s} for a joke, but it said: 'works on my machine.'",
        "Our {s} is like a promise — it either resolves or rejects, never calls back.",
        "A {s} tried crossing the road to refactor the other side.",
        "That {s} relationship status? It's complicated — circular dependency.",
        "I refactored a {s}. Now it's half the lines and twice the bugs.",
        "My {s} diet is bytes-only. Low latency, high fiber.",
        "The {s} had a great pickup line: 'Are you a bug? Because you make me breakpoint.'",
    ]

    return random.choice(templates).format(s=_choose(subjects))


def joke_dad(topic: str | None = None) -> str:
    things = [
        "pizza",
        "ladder",
        "calendar",
        "scarecrow",
        "clock",
        "broom",
        "sandal",
        "lightbulb",
        "battery",
    ] + _maybe_topic_words(topic)

    setups = [
        ("I used to be addicted to {t},", "but then I stepped away."),
        ("I was going to tell a joke about {t},", "but it's a little cheesy."),
        ("I bought a broken {t} yesterday,", "but it was a huge letdown."),
        ("I only know 25 letters of the alphabet,", "I don't know y."),
        ("I told my suitcases we aren't going on vacation this year,", "now I'm dealing with emotional baggage."),
        ("I don't trust stairs,", "they're always up to something."),
    ]

    t = _choose(things) if things else "pizza"
    s, p = _choose(setups)
    return f"{s.format(t=t)} {p}"


def joke_knock_knock(topic: str | None = None) -> str:
    names = [
        "Lettuce",
        "Tank",
        "Cargo",
        "Dishes",
        "Annie",
        "Control",
        "Woo",
        "Olive",
        "Howard",
    ] + _maybe_topic_words(topic)

    name = _choose(names) if names else "Lettuce"
    responses = {
        "Lettuce": "Lettuce in, it's cold out here!",
        "Tank": "You're welcome!",
        "Cargo": "Car go beep beep!",
        "Dishes": "Dishes the police — open up!",
        "Annie": "Annie thing you can do, I can do better!",
        "Control": "Control yourself, it's just a joke!",
        "Woo": "Calm down, it's just a knock-knock joke!",
        "Olive": "Olive you and I miss you!",
        "Howard": "Howard you like another joke?",
    }
    line = responses.get(name, f"{name} who? {name} you glad you knocked?")
    return "\n".join(["Knock, knock.", "Who’s there?", f"{name}.", f"{name} who?", line])


def joke_one_liner(topic: str | None = None) -> str:
    bits = [
        "I told my computer I needed a break — it said 'No problem, I'll go to sleep.'",
        "Parallel lines have so much in common. It’s a shame they’ll never meet.",
        "I have a joke about chemistry, but I don’t think it will get a reaction.",
        "I would tell you a UDP joke, but you might not get it.",
        "I told a joke about {t}. It didn't land, but the exception was handled.",
        "Debugging: being the detective in a crime movie where you are also the murderer.",
    ]
    t = _choose(_maybe_topic_words(topic) or ["syntax"])
    return _choose(bits).format(t=t)


StyleFn = Callable[[str | None], str]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate a random joke.")
    parser.add_argument(
        "-n",
        "--count",
        type=int,
        default=1,
        help="number of jokes to generate (default: 1)",
    )
    parser.add_argument(
        "--style",
        choices=["programmer", "dad", "knock-knock", "one-liner"],
        default="programmer",
        help="joke style",
    )
    parser.add_argument(
        "--topic",
        type=str,
        default=None,
        help="optional topic/word to weave into the joke",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="random seed for reproducible jokes",
    )
    parser.add_argument(
        "--list-styles",
        action="store_true",
        help="list available styles and exit",
    )
    return parser


def main(argv: List[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.list_styles:
        print("programmer, dad, knock-knock, one-liner")
        return 0

    if args.seed is not None:
        random.seed(args.seed)

    styles: Dict[str, StyleFn] = {
        "programmer": joke_programmer,
        "dad": joke_dad,
        "knock-knock": joke_knock_knock,
        "one-liner": joke_one_liner,
    }

    fn = styles[args.style]
    for i in range(max(1, int(args.count))):
        print(fn(args.topic))
        if i < args.count - 1 and args.style == "knock-knock":
            print()  # spacing for multi-line knock-knock jokes

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

