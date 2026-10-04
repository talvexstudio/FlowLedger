"""Machine-readable entry point for the FlowLedger server extraction boundary."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pdf_engine import inspect_pdf, load_template


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract a PDF statement as JSON.")
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()

    template = load_template(args.template)
    report = inspect_pdf(args.input, template)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
