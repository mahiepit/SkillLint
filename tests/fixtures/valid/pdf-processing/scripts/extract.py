#!/usr/bin/env python3
"""Print the text of every page of a PDF file."""
import sys

import pdfplumber


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: extract.py FILE.pdf", file=sys.stderr)
        return 2
    with pdfplumber.open(sys.argv[1]) as pdf:
        for page in pdf.pages:
            print(page.extract_text() or "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
