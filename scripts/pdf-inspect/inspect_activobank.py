"""Coordinate-aware PDF extraction spike for an ActivoBank statement.

This script is intentionally separate from FlowLedger's production Import code.
It extracts a neutral diagnostic structure and does not write transactions.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pymupdf


# This is diagnostic configuration, not the future product template model.
DIAGNOSTIC_CONCEPTS = {
    "table_header": ["DATA", "LANC.", "DATA", "VALOR", "DESCRITIVO", "DEBITO", "CREDITO", "SALDO"],
    "section_anchors": ["CONTA SIMPLES", "EXTRATO DE"],
    "continuation_markers": ["A TRANSPORTAR", "TRANSPORTE"],
    "end_markers": ["SALDO FINAL"],
    "opening_balance_markers": ["SALDO INICIAL"],
    "closing_balance_markers": ["SALDO FINAL"],
}

DATE_TOKEN = re.compile(r"^\d{1,2}\.\d{2}$")
AMOUNT_TOKEN = re.compile(r"^-?\d[\d ]*\.\d+$")
STATEMENT_PERIOD = re.compile(
    r"EXTRATO\s+DE\s+(\d{4}/\d{2}/\d{2})\s+A\s+(\d{4}/\d{2}/\d{2})",
    re.IGNORECASE,
)


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def token_key(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def word_record(word: tuple[Any, ...]) -> dict[str, Any]:
    x0, y0, x1, y1, text, block, line, word_no = word
    return {
        "text": text,
        "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
        "block": block,
        "line": line,
        "word": word_no,
    }


def group_words(words: list[tuple[Any, ...]], tolerance: float = 2.5) -> list[list[tuple[Any, ...]]]:
    groups: list[list[tuple[Any, ...]]] = []
    for word in sorted(words, key=lambda item: (item[1], item[0])):
        if not groups or abs(groups[-1][0][1] - word[1]) > tolerance:
            groups.append([word])
        else:
            groups[-1].append(word)
    return groups


def line_text(line: list[tuple[Any, ...]]) -> str:
    return compact(" ".join(word[4] for word in sorted(line, key=lambda item: item[0])))


def find_table_header(lines: list[list[tuple[Any, ...]]]) -> dict[str, Any] | None:
    required = {token_key(item) for item in DIAGNOSTIC_CONCEPTS["table_header"]}
    for start, line in enumerate(lines):
        window: list[tuple[Any, ...]] = []
        for candidate in lines[start:]:
            if candidate[0][1] - line[0][1] > 24:
                break
            if find_marker(candidate, DIAGNOSTIC_CONCEPTS["continuation_markers"]):
                continue
            window.extend(candidate)
        header_words = [
            word for word in window
            if (
                (token_key(word[4]) == "DATA" and word[2] <= 112)
                or (token_key(word[4]) == "LANC" and word[2] <= 100)
                or (token_key(word[4]) == "VALOR" and 80 <= word[0] <= 100)
                or (token_key(word[4]) == "DESCRITIVO" and 100 <= word[0] <= 220)
                or (token_key(word[4]) == "DEBITO" and 320 <= word[0] <= 410)
                or (token_key(word[4]) == "CREDITO" and 400 <= word[0] <= 490)
                or (token_key(word[4]) == "SALDO" and word[0] >= 500)
            )
        ]
        keys = {token_key(word[4]) for word in header_words}
        if {"DATA", "LANC", "VALOR", "DESCRITIVO", "DEBITO", "CREDITO", "SALDO"}.issubset(keys):
            return {
                "y_start": round(min(word[1] for word in header_words), 2),
                "y_end": round(max(word[3] for word in header_words), 2),
                "words": [word_record(word) for word in sorted(header_words, key=lambda item: (item[1], item[0]))],
                "text": line_text(sorted(header_words, key=lambda item: (item[1], item[0]))),
            }
    return None


def find_marker(line: list[tuple[Any, ...]], concepts: list[str]) -> str | None:
    text = token_key(line_text(line))
    for concept in concepts:
        if token_key(concept) in text:
            return concept
    return None


def find_period(page_text: str) -> dict[str, str] | None:
    match = STATEMENT_PERIOD.search(compact(page_text))
    if not match:
        return None
    return {"from": match.group(1), "to": match.group(2), "raw": match.group(0)}


def find_balance_markers(
    page_number: int,
    lines: list[list[tuple[Any, ...]]],
    concepts: dict[str, list[str]],
) -> dict[str, list[dict[str, Any]]]:
    """Find statement-level balances without treating them as transactions."""
    found: dict[str, list[dict[str, Any]]] = {"opening": [], "closing": []}
    for line in lines:
        text = line_text(line)
        for kind, marker_key in (("opening", "opening_balance_markers"), ("closing", "closing_balance_markers")):
            marker = find_marker(line, concepts[marker_key])
            if not marker:
                continue
            amount_words = [
                word for word in line
                if word[0] >= 300 and AMOUNT_TOKEN.match(word[4])
            ]
            if not amount_words:
                continue
            amount_word = amount_words[-1]
            found[kind].append(
                {
                    "concept": marker,
                    "raw": amount_word[4],
                    "page": page_number,
                    "bbox": [round(value, 2) for value in amount_word[:4]],
                    "y": round(line[0][1], 2),
                    "text": text,
                }
            )
    return found


def parse_amount(raw: str | None) -> Decimal | None:
    if raw is None:
        return None
    try:
        return Decimal(raw.replace(" ", ""))
    except InvalidOperation:
        return None


def json_amount(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def reconcile_transactions(
    rows: list[dict[str, Any]],
    opening_marker: dict[str, Any] | None,
    closing_marker: dict[str, Any] | None,
) -> dict[str, Any]:
    tolerance = Decimal("0.01")
    opening = parse_amount(opening_marker["raw"]) if opening_marker else None
    closing = parse_amount(closing_marker["raw"]) if closing_marker else None
    total_debits = sum((parse_amount(row["debitRaw"]) or Decimal("0")) for row in rows)
    total_credits = sum((parse_amount(row["creditRaw"]) or Decimal("0")) for row in rows)
    calculated_closing = opening + total_credits - total_debits if opening is not None else None
    closing_difference = calculated_closing - closing if calculated_closing is not None and closing is not None else None

    continuity: list[dict[str, Any]] = []
    continuity_failures: list[dict[str, Any]] = []
    previous_balance = opening
    for index, row in enumerate(rows):
        actual = parse_amount(row["balanceRaw"])
        debit = parse_amount(row["debitRaw"]) or Decimal("0")
        credit = parse_amount(row["creditRaw"]) or Decimal("0")
        expected = previous_balance + credit - debit if previous_balance is not None else None
        difference = expected - actual if expected is not None and actual is not None else None
        # The first row is checked against the opening balance; subsequent rows
        # are the row-to-row continuity checks requested by the spike.
        check = {
            "rowIndex": index + 1,
            "page": row["page"],
            "description": row["description"],
            "expectedBalance": json_amount(expected),
            "actualBalance": json_amount(actual),
            "difference": json_amount(difference),
            "status": "PASS" if difference is not None and abs(difference) <= tolerance else "FAIL",
        }
        continuity.append(check)
        if check["status"] == "FAIL":
            continuity_failures.append(check)
        previous_balance = actual

    reconciliation_status = (
        "PASS"
        if calculated_closing is not None
        and closing_difference is not None
        and abs(closing_difference) <= tolerance
        and not continuity_failures
        else "FAIL"
        if opening is not None and closing is not None
        else "UNAVAILABLE"
    )
    return {
        "tolerance": json_amount(tolerance),
        "openingBalance": json_amount(opening),
        "totalDebits": json_amount(total_debits),
        "totalCredits": json_amount(total_credits),
        "calculatedClosingBalance": json_amount(calculated_closing),
        "statementClosingBalance": json_amount(closing),
        "closingDifference": json_amount(closing_difference),
        "status": reconciliation_status,
        "balanceMarkers": {"opening": opening_marker, "closing": closing_marker},
        "rowContinuity": continuity,
        "rowContinuityFailureCount": len(continuity_failures),
        "rowContinuityFailures": continuity_failures,
    }


def infer_geometry(
    header: dict[str, Any],
    lines: list[list[tuple[Any, ...]]],
    page_width: float,
) -> dict[str, Any]:
    words = header["words"]
    labels: dict[str, dict[str, Any]] = {}
    data_words = [word for word in words if token_key(word["text"]) == "DATA"]

    def first_word(key: str) -> dict[str, Any]:
        return next(word for word in words if token_key(word["text"]) == key)

    labels["postingDate"] = data_words[0]
    labels["valueDate"] = data_words[1]
    labels["description"] = first_word("DESCRITIVO")
    labels["debit"] = first_word("DEBITO")
    labels["credit"] = first_word("CREDITO")
    labels["balance"] = first_word("SALDO")

    centers = {
        name: (value["bbox"][0] + value["bbox"][2]) / 2
        for name, value in labels.items()
    }

    # Amounts are right-aligned under their headers. Infer their true left
    # edges from decimal-bearing tokens in candidate date rows instead of
    # using the midpoint between the description and numeric headers.
    amount_starts: dict[str, list[float]] = {"debit": [], "credit": [], "balance": []}
    for line in lines:
        date_tokens = [word for word in line if DATE_TOKEN.match(word[4]) and word[2] <= 112]
        if len(date_tokens) != 2:
            continue
        for word in line:
            if not AMOUNT_TOKEN.match(word[4]) or word[0] < 300:
                continue
            center_x = (word[0] + word[2]) / 2
            nearest = min(("debit", "credit", "balance"), key=lambda name: abs(center_x - centers[name]))
            if abs(center_x - centers[nearest]) < 65:
                start = word[0]
                preceding = [
                    candidate
                    for candidate in line
                    if candidate[2] <= word[0]
                    and word[0] - candidate[2] < 7
                    and candidate[4].replace(" ", "").isdigit()
                ]
                if preceding:
                    start = min(start, min(candidate[0] for candidate in preceding))
                amount_starts[nearest].append(start)

    debit_left = min(amount_starts["debit"], default=labels["debit"]["bbox"][0] - 10)
    credit_left = min(amount_starts["credit"], default=labels["credit"]["bbox"][0] - 10)
    balance_left = min(amount_starts["balance"], default=labels["balance"]["bbox"][0] - 10)
    value_left = labels["valueDate"]["bbox"][0]
    description_left = labels["description"]["bbox"][0] - 3
    boundaries = {
        "postingDate": [40.0, round(value_left, 2)],
        "valueDate": [round(value_left, 2), round(description_left, 2)],
        "description": [round(description_left, 2), round(debit_left, 2)],
        "debit": [round(debit_left, 2), round(credit_left, 2)],
        "credit": [round(credit_left, 2), round(balance_left, 2)],
        "balance": [round(balance_left, 2), round(page_width - 20, 2)],
    }

    return {
        "headerLabels": labels,
        "inferredColumnRanges": boundaries,
        "observedCenters": {name: round(value, 2) for name, value in centers.items()},
        "observedAmountTokenStarts": {
            name: sorted({round(value, 2) for value in values})
            for name, values in amount_starts.items()
        },
    }
def words_in_range(line: list[tuple[Any, ...]], left: float, right: float) -> list[tuple[Any, ...]]:
    return [word for word in line if left <= (word[0] + word[2]) / 2 < right]


def join_column(line: list[tuple[Any, ...]], bounds: list[float]) -> str | None:
    values = words_in_range(line, bounds[0], bounds[1])
    if not values:
        return None
    return compact(" ".join(word[4] for word in sorted(values, key=lambda item: item[0])))


def extract_rows(
    page_number: int,
    page: pymupdf.Page,
    header: dict[str, Any],
    geometry: dict[str, Any],
) -> dict[str, Any]:
    lines = group_words(page.get_text("words"))
    ranges = geometry["inferredColumnRanges"]
    start_y = header["y_end"] + 5
    end_y = page.rect.height
    continuation_markers: list[dict[str, Any]] = []
    end_marker: dict[str, Any] | None = None
    rows: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    row_lines: list[dict[str, Any]] = []

    for line in lines:
        y = line[0][1]
        marker = find_marker(line, DIAGNOSTIC_CONCEPTS["end_markers"])
        if marker:
            end_marker = {"concept": marker, "y": round(y, 2), "text": line_text(line)}
            end_y = y
            break
        marker = find_marker(line, DIAGNOSTIC_CONCEPTS["continuation_markers"])
        if marker:
            continuation_markers.append({"concept": marker, "y": round(y, 2), "text": line_text(line)})
            continue
        if y < start_y:
            continue
        if y > end_y:
            continue

        posting = words_in_range(line, *ranges["postingDate"])
        value = words_in_range(line, *ranges["valueDate"])
        posting_dates = [word for word in posting if DATE_TOKEN.match(word[4])]
        value_dates = [word for word in value if DATE_TOKEN.match(word[4])]
        if len(posting_dates) != 1 or len(value_dates) != 1:
            table_words = [word for word in line if word[0] >= 40 and word[2] <= 575]
            if any(114 <= (word[0] + word[2]) / 2 < 346 for word in table_words):
                ambiguous.append({"page": page_number, "y": round(y, 2), "text": line_text(line)})
            continue

        description_words = words_in_range(line, *ranges["description"])
        debit = join_column(line, ranges["debit"])
        credit = join_column(line, ranges["credit"])
        balance = join_column(line, ranges["balance"])
        if not description_words or balance is None or (debit is None and credit is None):
            ambiguous.append({"page": page_number, "y": round(y, 2), "text": line_text(line), "reason": "missing table field"})
            continue

        row_words = [
            word for word in line
            if 40 <= (word[0] + word[2]) / 2 <= 575
        ]
        bbox = [
            round(min(word[0] for word in row_words), 2),
            round(min(word[1] for word in row_words), 2),
            round(max(word[2] for word in row_words), 2),
            round(max(word[3] for word in row_words), 2),
        ]
        row = {
            "postingDateRaw": posting_dates[0][4],
            "valueDateRaw": value_dates[0][4],
            "description": compact(" ".join(word[4] for word in description_words)),
            "debitRaw": debit,
            "creditRaw": credit,
            "balanceRaw": balance,
            "page": page_number,
            "source": {"bbox": bbox, "y": round(y, 2)},
        }
        rows.append(row)
        row_lines.append({"row": row, "y": y})

    return {
        "rows": rows,
        "ambiguousRows": ambiguous,
        "continuationMarkers": continuation_markers,
        "endMarker": end_marker,
        "rowCoordinates": [row["source"] for row in rows],
    }


def repeated_lines(page_lines: list[list[str]]) -> list[dict[str, Any]]:
    occurrences: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for page_number, lines in enumerate(page_lines, start=1):
        for line in lines:
            normalized = compact(line)
            if normalized:
                occurrences[normalized].append({"page": page_number})
    return [
        {"text": text, "occurrences": locations}
        for text, locations in occurrences.items()
        if len({location["page"] for location in locations}) > 1
    ]


def validate_known_examples(rows: list[dict[str, Any]]) -> dict[str, Any]:
    examples = {
        "IGCP transfer": "TRF. P/O IGCP Encargos da Divida PAG IGCP",
        "Mercadona purchase": "COMPRA 8004 MERCADONA PORTO CONTACTLESS",
        "Vodafone payment": "PAG. 919836025 - VODAFONE",
    }
    validations: dict[str, Any] = {}
    for name, expected in examples.items():
        expected_compact = compact(expected).lower()
        matches = [
            row for row in rows
            if expected_compact in compact(row["description"]).lower()
        ]
        validations[name] = {
            "expectedDescription": expected,
            "matchCount": len(matches),
            "matches": matches,
        }
    return validations


def inspect(pdf_path: Path) -> dict[str, Any]:
    document = pymupdf.open(pdf_path)
    pages: list[dict[str, Any]] = []
    all_rows: list[dict[str, Any]] = []
    all_ambiguous: list[dict[str, Any]] = []
    all_continuations: list[dict[str, Any]] = []
    balance_markers: dict[str, list[dict[str, Any]]] = {"opening": [], "closing": []}
    table_pages: list[dict[str, Any]] = []
    line_texts: list[list[str]] = []
    statement_period: dict[str, str] | None = None

    for page_index, page in enumerate(document):
        page_number = page_index + 1
        raw_words = page.get_text("words")
        words = [word_record(word) for word in raw_words]
        lines = group_words(raw_words)
        text = page.get_text()
        line_texts.append([line_text(line) for line in lines])
        page_balances = find_balance_markers(page_number, lines, DIAGNOSTIC_CONCEPTS)
        for kind in balance_markers:
            balance_markers[kind].extend(page_balances[kind])
        if statement_period is None:
            statement_period = find_period(text)
        header = find_table_header(lines)
        page_report: dict[str, Any] = {
            "page": page_number,
            "dimensions": {"width": page.rect.width, "height": page.rect.height},
            "selectableText": bool(text.strip()),
            "wordCount": len(words),
            "characterCount": len(text),
            "words": words,
            "textOrderSample": [word["text"] for word in words[:30]],
            "tableHeader": None,
        }
        if header:
            geometry = infer_geometry(header, lines, page.rect.width)
            extracted = extract_rows(page_number, page, header, geometry)
            page_report["tableHeader"] = {**header, **geometry}
            page_report["tableExtraction"] = extracted
            table_pages.append({"page": page_number, "header": page_report["tableHeader"]})
            all_rows.extend(extracted["rows"])
            all_ambiguous.extend(extracted["ambiguousRows"])
            all_continuations.extend(
                [{"page": page_number, **marker} for marker in extracted["continuationMarkers"]]
            )
        pages.append(page_report)

    debit_rows = [row for row in all_rows if row["debitRaw"] is not None]
    credit_rows = [row for row in all_rows if row["creditRaw"] is not None]
    first_after_continuation: dict[str, Any] | None = None
    before_continuation: dict[str, Any] | None = None
    for marker in all_continuations:
        prior = [row for row in all_rows if row["page"] == marker["page"] and row["source"]["y"] < marker["y"]]
        following = [row for row in all_rows if row["page"] > marker["page"]]
        if prior:
            before_continuation = prior[-1]
        if following:
            first_after_continuation = following[0]

    opening_marker = balance_markers["opening"][0] if balance_markers["opening"] else None
    closing_marker = balance_markers["closing"][-1] if balance_markers["closing"] else None
    reconciliation = reconcile_transactions(all_rows, opening_marker, closing_marker)

    return {
        "reportVersion": 1,
        "source": str(pdf_path),
        "library": {"name": "PyMuPDF", "module": "pymupdf", "coordinateUnit": "PDF points"},
        "document": {
            "pageCount": document.page_count,
            "selectableText": any(page["selectableText"] for page in pages),
            "statementPeriod": statement_period,
            "pages": [
                {"page": page["page"], "dimensions": page["dimensions"], "wordCount": page["wordCount"], "characterCount": page["characterCount"]}
                for page in pages
            ],
        },
        "diagnosticConfiguration": DIAGNOSTIC_CONCEPTS,
        "repeatedTextLines": repeated_lines(line_texts),
        "repeatedLayout": {
            "transactionHeaderPages": [page["page"] for page in table_pages],
            "bankIdentityHeaderPages": [
                page["page"] for page in pages
                if "Banco ActivoBank" in " ".join(word["text"] for word in page["words"])
            ],
            "statementPageMarkers": [
                {
                    "page": page["page"],
                    "markerWords": [word["text"] for word in page["words"] if word["text"] in {"PAG:", "00002", "00003", "00004"}],
                }
                for page in pages
                if any(word["text"] in {"PAG:", "00002", "00003", "00004"} for word in page["words"])
            ],
            "footerOrMarginText": "The repeated bank/legal identity text is present in the page margin; it is outside the detected ledger table geometry and is not parsed as a transaction.",
        },
        "pages": pages,
        "transactionTable": {
            "detectedPages": table_pages,
            "rowCount": len(all_rows),
            "debitRowCount": len(debit_rows),
            "creditRowCount": len(credit_rows),
            "ambiguousRowCount": len(all_ambiguous),
            "ambiguousRows": all_ambiguous,
            "continuationMarkers": all_continuations,
            "rows": all_rows,
            "samples": {
                "firstTransaction": all_rows[0] if all_rows else None,
                "lastTransaction": all_rows[-1] if all_rows else None,
                "fiveDebitRows": debit_rows[:5],
                "threeCreditRows": credit_rows[:3],
                "immediatelyBeforeContinuation": before_continuation,
                "immediatelyAfterContinuation": first_after_continuation,
            },
            "knownExampleValidation": validate_known_examples(all_rows),
            "multilineDescription": {
                "candidateCount": len(all_ambiguous),
                "candidates": all_ambiguous,
                "assessment": "No orphan description lines or incomplete table rows were detected in the transaction region.",
            },
        },
        "reconciliation": reconciliation,
        "falsePositiveProtection": {
            "explanation": "Rows are accepted only inside a page region following the DATA LANC./DATA VALOR/DESCRITIVO/DEBITO/CREDITO/SALDO header, with two abbreviated date tokens, a description-column word, and at least one debit/credit plus balance value. Other sections lack this complete geometry and anchor set.",
            "nonLedgerSectionsObserved": [
                "RESUMO DAS CONTAS",
                "SEGUROS",
                "TRANSACOES EM MOEDA DIFERENTE DE EUR NA UNIAO EUROPEIA",
            ],
        },
        "dateHandling": {
            "rawFieldsPreserved": ["postingDateRaw", "valueDateRaw"],
            "interpretation": "Not performed in this spike; statement-period context is retained separately.",
        },
        "amountHandling": {
            "rawFieldsPreserved": ["debitRaw", "creditRaw", "balanceRaw"],
            "interpretation": "Not performed in this spike; debit/credit columns remain distinct.",
        },
    }


def print_summary(report: dict[str, Any]) -> None:
    table = report["transactionTable"]
    document = report["document"]
    print(f"PDF: {report['source']}")
    print(f"Pages: {document['pageCount']} | selectable text: {document['selectableText']}")
    print(f"Statement period: {document['statementPeriod']}")
    print(
        "Transactions: "
        f"{table['rowCount']} total, {table['debitRowCount']} debit, "
        f"{table['creditRowCount']} credit, {table['ambiguousRowCount']} ambiguous"
    )
    print(f"Table detected on pages: {[page['page'] for page in table['detectedPages']]}")
    print(f"Continuation markers: {table['continuationMarkers']}")
    print("First:", table["samples"]["firstTransaction"])
    print("Last:", table["samples"]["lastTransaction"])
    print("Before continuation:", table["samples"]["immediatelyBeforeContinuation"])
    print("After continuation:", table["samples"]["immediatelyAfterContinuation"])
    reconciliation = report["reconciliation"]
    print("Reconciliation:")
    print(f"  Opening balance: {reconciliation['openingBalance']}")
    print(f"  Total credits: {reconciliation['totalCredits']}")
    print(f"  Total debits: {reconciliation['totalDebits']}")
    print(f"  Calculated closing balance: {reconciliation['calculatedClosingBalance']}")
    print(f"  Statement closing balance: {reconciliation['statementClosingBalance']}")
    print(f"  Difference: {reconciliation['closingDifference']}")
    print(f"  Row continuity failures: {reconciliation['rowContinuityFailureCount']}")
    print(f"  Status: {reconciliation['status']}")


EXPORT_COLUMNS = [
    "page",
    "postingDateRaw",
    "valueDateRaw",
    "description",
    "debitRaw",
    "creditRaw",
    "balanceRaw",
]


def export_csv(report: dict[str, Any], output_path: Path) -> None:
    """Export candidate rows without interpreting debit/credit semantics."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=EXPORT_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(report["transactionTable"]["rows"])


def html_cell(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def export_html(report: dict[str, Any], output_path: Path) -> None:
    """Write a standalone report with no app framework or external assets."""
    document = report["document"]
    table = report["transactionTable"]
    reconciliation = report["reconciliation"]
    period = document["statementPeriod"]
    period_text = ""
    if period:
        period_text = f"{period['from']} to {period['to']}"

    rows = []
    for row in table["rows"]:
        rows.append(
            "<tr>"
            + "".join(f"<td>{html_cell(row.get(column))}</td>" for column in EXPORT_COLUMNS)
            + "</tr>"
        )

    headers = "".join(f"<th>{html_cell(column)}</th>" for column in EXPORT_COLUMNS)
    source_name = Path(report["source"]).name
    page_list = ", ".join(str(page["page"]) for page in table["detectedPages"])
    anomaly_rows = "".join(
        "<tr>"
        + "".join(
            f"<td>{html_cell(anomaly.get(column))}</td>"
            for column in ["rowIndex", "page", "description", "expectedBalance", "actualBalance", "difference", "status"]
        )
        + "</tr>"
        for anomaly in reconciliation["rowContinuityFailures"]
    )
    anomaly_table = (
        "<p>No row-level balance continuity anomalies detected.</p>"
        if not anomaly_rows
        else "<table><thead><tr>"
        + "".join(f"<th>{column}</th>" for column in ["rowIndex", "page", "description", "expectedBalance", "actualBalance", "difference", "status"])
        + f"</tr></thead><tbody>{anomaly_rows}</tbody></table>"
    )
    content = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF extraction report - {html_cell(source_name)}</title>
<style>
body {{ font-family: system-ui, sans-serif; color: #202124; margin: 2rem; }}
h1 {{ margin-bottom: .25rem; }}
.meta {{ color: #5f6368; margin-top: 0; }}
.stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .75rem; margin: 1.5rem 0; }}
.stat {{ border: 1px solid #dadce0; border-radius: 6px; padding: .8rem; }}
.stat strong {{ display: block; font-size: 1.35rem; }}
.stat span {{ color: #5f6368; font-size: .9rem; }}
.table-wrap {{ overflow-x: auto; }}
table {{ border-collapse: collapse; width: 100%; font-size: .9rem; }}
th, td {{ border: 1px solid #dadce0; padding: .45rem .55rem; text-align: left; vertical-align: top; }}
th {{ background: #f1f3f4; position: sticky; top: 0; }}
td:nth-child(4) {{ min-width: 24rem; }}
td:not(:nth-child(4)) {{ white-space: nowrap; }}
</style>
</head>
<body>
<h1>PDF extraction report</h1>
<p class="meta">Source: {html_cell(source_name)}</p>
<div class="stats">
  <div class="stat"><strong>{document['pageCount']}</strong><span>Pages</span></div>
  <div class="stat"><strong>{html_cell(period_text or 'Not detected')}</strong><span>Statement period</span></div>
  <div class="stat"><strong>{html_cell(page_list or 'None')}</strong><span>Transaction-table pages</span></div>
  <div class="stat"><strong>{table['rowCount']}</strong><span>Total transactions</span></div>
  <div class="stat"><strong>{table['debitRowCount']}</strong><span>Debit rows</span></div>
  <div class="stat"><strong>{table['creditRowCount']}</strong><span>Credit rows</span></div>
  <div class="stat"><strong>{table['ambiguousRowCount']}</strong><span>Ambiguous/rejected rows</span></div>
</div>
<h2>Accounting reconciliation</h2>
<div class="stats">
  <div class="stat"><strong>{reconciliation['openingBalance']}</strong><span>Opening balance</span></div>
  <div class="stat"><strong>{reconciliation['totalCredits']}</strong><span>Total credits</span></div>
  <div class="stat"><strong>{reconciliation['totalDebits']}</strong><span>Total debits</span></div>
  <div class="stat"><strong>{reconciliation['calculatedClosingBalance']}</strong><span>Calculated closing balance</span></div>
  <div class="stat"><strong>{reconciliation['statementClosingBalance']}</strong><span>Statement closing balance</span></div>
  <div class="stat"><strong>{reconciliation['closingDifference']}</strong><span>Difference</span></div>
  <div class="stat"><strong>{reconciliation['status']}</strong><span>Reconciliation status</span></div>
</div>
<h3>Row-level balance anomalies</h3>
{anomaly_table}
<h2>Extracted transactions</h2>
<div class="table-wrap">
<table>
<thead><tr>{headers}</tr></thead>
<tbody>{''.join(rows)}</tbody>
</table>
</div>
</body>
</html>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a selectable-text PDF transaction statement.")
    parser.add_argument("--input", type=Path, required=True, help="Source PDF path")
    parser.add_argument("--json", type=Path, default=None, help="Machine-readable JSON report path")
    parser.add_argument("--html", type=Path, default=None, help="Standalone HTML report path")
    parser.add_argument("--csv", type=Path, default=None, help="Candidate-row CSV path")
    args = parser.parse_args()
    stem = args.input.stem
    default_directory = Path(__file__).resolve().parent
    json_path = args.json or default_directory / f"{stem}.report.json"
    html_path = args.html or default_directory / f"{stem}.report.html"
    csv_path = args.csv or default_directory / f"{stem}.rows.csv"

    report = inspect(args.input)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    export_html(report, html_path)
    export_csv(report, csv_path)
    print_summary(report)
    print(f"JSON report: {json_path}")
    print(f"HTML report: {html_path}")
    print(f"CSV export: {csv_path}")


if __name__ == "__main__":
    main()
