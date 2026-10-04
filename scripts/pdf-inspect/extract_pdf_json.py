"""Machine-readable entry point for the FlowLedger server extraction boundary."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pymupdf

from pdf_engine import inspect_pdf, load_template


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract a PDF statement as JSON.")
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()

    try:
        with pymupdf.open(args.input) as document:
            if not any(page.get_text().strip() for page in document):
                print(json.dumps({"code": "NO_SELECTABLE_TEXT"}), file=sys.stderr)
                raise SystemExit(2)

        template = load_template(args.template)
        report = inspect_pdf(args.input, template)
        print(json.dumps(report, ensure_ascii=False))
    except SystemExit:
        raise
    except ValueError as error:
        code = "TEMPLATE_MISMATCH" if "does not match template" in str(error) else "EXTRACTION_FAILED"
        print(json.dumps({"code": code}), file=sys.stderr)
        raise SystemExit(2) from None
    except Exception:
        print(json.dumps({"code": "EXTRACTION_FAILED"}), file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
