"""Detect bundled FlowLedger statement definitions without exposing PDF text."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pdf_engine import detect_pdf, load_template


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect known FlowLedger PDF statement formats.")
    parser.add_argument("--template", type=Path, action="append", required=True)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()

    try:
        templates = [load_template(path) for path in args.template]
        print(json.dumps(detect_pdf(args.input, templates), ensure_ascii=False))
    except Exception:
        print(json.dumps({"code": "EXTRACTION_FAILED"}), file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
