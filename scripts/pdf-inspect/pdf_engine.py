"""Template-driven, coordinate-aware PDF statement extraction diagnostics.

This module is intentionally isolated from FlowLedger production import code.
It contains no institution-specific branches; document knowledge is supplied by
PdfImportTemplate V1 JSON files.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pymupdf


SUPPORTED_ROLES = {
    "postingDate",
    "valueDate",
    "description",
    "signedAmount",
    "debit",
    "credit",
    "balance",
}
SUPPORTED_AMOUNT_MODELS = {"SIGNED_AMOUNT", "DEBIT_CREDIT"}
SUPPORTED_DATE_MODELS = {"FULL_DATE", "ABBREVIATED_WITH_STATEMENT_PERIOD"}
SUPPORTED_RECONCILIATION_MODES = {"FULL_RECONCILIATION", "OPEN_CLOSE_RECONCILIATION", "NONE"}


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalized(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(character for character in decomposed if not unicodedata.combining(character))
    return re.sub(r"[^A-Z0-9]", "", ascii_text.upper())


def contains_anchor(text: str, anchor: str) -> bool:
    return normalized(anchor) in normalized(text)


def group_words(words: list[tuple[Any, ...]], tolerance: float) -> list[list[tuple[Any, ...]]]:
    groups: list[list[tuple[Any, ...]]] = []
    for word in sorted(words, key=lambda item: (item[1], item[0])):
        if not groups or abs(groups[-1][0][1] - word[1]) > tolerance:
            groups.append([word])
        else:
            groups[-1].append(word)
    return groups


def line_text(line: list[tuple[Any, ...]]) -> str:
    return compact(" ".join(word[4] for word in sorted(line, key=lambda item: item[0])))


def word_record(word: tuple[Any, ...]) -> dict[str, Any]:
    x0, y0, x1, y1, text, block, line, word_number = word
    return {
        "text": text,
        "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
        "block": block,
        "line": line,
        "word": word_number,
    }


def load_template(path: Path) -> dict[str, Any]:
    template = json.loads(path.read_text(encoding="utf-8"))
    validate_template(template)
    template["_templatePath"] = str(path.resolve())
    return template


def validate_template(template: dict[str, Any]) -> None:
    required = {"schemaVersion", "id", "name", "identification", "section", "columns", "row", "amounts", "dates", "context", "reconciliation"}
    missing = sorted(required - template.keys())
    if missing:
        raise ValueError(f"Template is missing required fields: {', '.join(missing)}")
    if template["schemaVersion"] != 1:
        raise ValueError("Only PdfImportTemplate schemaVersion 1 is supported")
    if template["amounts"]["model"] not in SUPPORTED_AMOUNT_MODELS:
        raise ValueError(f"Unsupported amount model: {template['amounts']['model']}")
    if template["dates"]["model"] not in SUPPORTED_DATE_MODELS:
        raise ValueError(f"Unsupported date model: {template['dates']['model']}")
    if template["reconciliation"]["mode"] not in SUPPORTED_RECONCILIATION_MODES:
        raise ValueError(f"Unsupported reconciliation mode: {template['reconciliation']['mode']}")
    if template["columns"].get("mode") != "FIXED_RANGES":
        raise ValueError("PdfImportTemplate V1 currently supports FIXED_RANGES column geometry")
    unknown_roles = set(template["columns"]["ranges"]) - SUPPORTED_ROLES
    if unknown_roles:
        raise ValueError(f"Unsupported column roles: {', '.join(sorted(unknown_roles))}")


def match_anchors(text: str, anchors: list[str], mode: str = "ALL") -> bool:
    if not anchors:
        return True
    matches = [contains_anchor(text, anchor) for anchor in anchors]
    return all(matches) if mode == "ALL" else any(matches)


def identify_document(document_text: str, template: dict[str, Any]) -> dict[str, Any]:
    identification = template["identification"]
    required = identification.get("requiredAnchors", [])
    optional_any = identification.get("anyAnchors", [])
    excluded = identification.get("excludedAnchors", [])
    required_matches = {anchor: contains_anchor(document_text, anchor) for anchor in required}
    any_matches = {anchor: contains_anchor(document_text, anchor) for anchor in optional_any}
    excluded_matches = {anchor: contains_anchor(document_text, anchor) for anchor in excluded}
    passed = all(required_matches.values()) and (not optional_any or any(any_matches.values())) and not any(excluded_matches.values())
    return {
        "status": "PASS" if passed else "FAIL",
        "requiredAnchors": required_matches,
        "anyAnchors": any_matches,
        "excludedAnchors": excluded_matches,
    }


def find_header(
    lines: list[list[tuple[Any, ...]]],
    header_spec: dict[str, Any],
) -> dict[str, Any] | None:
    required_counts = {normalized(key): value for key, value in header_spec["requiredTokenCounts"].items()}
    window_height = float(header_spec.get("windowHeight", 24))
    for start, first_line in enumerate(lines):
        window: list[tuple[Any, ...]] = []
        start_y = first_line[0][1]
        for candidate in lines[start:]:
            if candidate[0][1] - start_y > window_height:
                break
            window.extend(candidate)
        counts = Counter(normalized(word[4]) for word in window)
        if not all(counts[token] >= count for token, count in required_counts.items()):
            continue
        header_words = [word for word in window if normalized(word[4]) in required_counts]
        return {
            "yStart": round(min(word[1] for word in header_words), 2),
            "yEnd": round(max(word[3] for word in header_words), 2),
            "text": line_text(sorted(header_words, key=lambda item: (item[1], item[0]))),
            "words": [word_record(word) for word in sorted(header_words, key=lambda item: (item[1], item[0]))],
        }
    return None


def find_marker(text: str, markers: list[str]) -> str | None:
    for marker in markers:
        if contains_anchor(text, marker):
            return marker
    return None


def words_in_range(line: list[tuple[Any, ...]], bounds: list[float]) -> list[tuple[Any, ...]]:
    left, right = bounds
    return [word for word in line if left <= (word[0] + word[2]) / 2 < right]


def join_column(line: list[tuple[Any, ...]], bounds: list[float]) -> str | None:
    words = words_in_range(line, bounds)
    if not words:
        return None
    return compact(" ".join(word[4] for word in sorted(words, key=lambda item: item[0])))


def parse_decimal(raw: str | None, number_format: dict[str, Any]) -> Decimal | None:
    if raw is None:
        return None
    value = compact(raw)
    for separator in number_format.get("thousandsSeparators", []):
        value = value.replace(separator, "")
    decimal_separator = number_format.get("decimalSeparator", ".")
    if decimal_separator != ".":
        value = value.replace(decimal_separator, ".")
    try:
        return Decimal(value)
    except InvalidOperation:
        return None


def json_decimal(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def resolve_date(raw: str | None, date_spec: dict[str, Any], period: dict[str, Any] | None) -> str | None:
    if raw is None:
        return None
    if date_spec["model"] == "FULL_DATE":
        try:
            return datetime.strptime(raw, date_spec["pythonFormat"]).date().isoformat()
        except ValueError:
            return None
    match = re.fullmatch(date_spec["rowPattern"], raw)
    if not match or not period:
        return None
    period_source = period.get(date_spec.get("yearSource", "from"))
    if not period_source:
        return None
    try:
        year = datetime.strptime(period_source, date_spec["statementPeriodFormat"]).year
        components = match.groupdict()
        return datetime(year, int(components["month"]), int(components["day"])).date().isoformat()
    except (ValueError, KeyError):
        return None


def extract_regex_context(document_text: str, spec: dict[str, Any]) -> dict[str, Any] | None:
    match = re.search(spec["pattern"], compact(document_text), re.IGNORECASE)
    if not match:
        return None
    values = match.groupdict()
    if values:
        return {**values, "raw": match.group(0)}
    group = int(spec.get("group", 1))
    return {"value": match.group(group), "raw": match.group(0)}


def extract_line_amount_context(
    pages: list[dict[str, Any]],
    spec: dict[str, Any],
    number_format: dict[str, Any],
) -> dict[str, Any] | None:
    matches: list[dict[str, Any]] = []
    token_pattern = re.compile(spec["valueTokenPattern"])
    minimum_x = float(spec.get("minimumX", 0))
    for page in pages:
        for line in page["_lines"]:
            text = line_text(line)
            marker = find_marker(text, spec["anchors"])
            if not marker:
                continue
            candidates = [word for word in line if word[0] >= minimum_x and token_pattern.fullmatch(word[4])]
            if not candidates:
                continue
            word = candidates[-1] if spec.get("valueSelection", "LAST") == "LAST" else candidates[0]
            raw = word[4]
            matches.append(
                {
                    "concept": marker,
                    "raw": raw,
                    "numeric": json_decimal(parse_decimal(raw, number_format)),
                    "page": page["page"],
                    "bbox": [round(value, 2) for value in word[:4]],
                    "y": round(line[0][1], 2),
                    "text": text,
                }
            )
    if not matches:
        return None
    return matches[-1] if spec.get("occurrence", "FIRST") == "LAST" else matches[0]


def extract_context(
    document_text: str,
    pages: list[dict[str, Any]],
    template: dict[str, Any],
) -> dict[str, Any]:
    context: dict[str, Any] = {}
    for name, spec in template["context"].items():
        if spec["mode"] == "DOCUMENT_REGEX":
            context[name] = extract_regex_context(document_text, spec)
        elif spec["mode"] == "LINE_MARKER_AMOUNT":
            context[name] = extract_line_amount_context(pages, spec, template["amounts"]["numberFormat"])
        else:
            raise ValueError(f"Unsupported context extraction mode: {spec['mode']}")
    return context


def extract_page_rows(
    page: dict[str, Any],
    header: dict[str, Any],
    template: dict[str, Any],
    statement_period: dict[str, Any] | None,
) -> dict[str, Any]:
    section = template["section"]
    ranges = template["columns"]["ranges"]
    row_spec = template["row"]
    date_spec = template["dates"]
    amount_spec = template["amounts"]
    start_y = header["yEnd"] + float(section.get("rowStartOffset", 1))
    rows: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    continuations: list[dict[str, Any]] = []
    end_marker: dict[str, Any] | None = None

    for line in page["_lines"]:
        y = line[0][1]
        if y < start_y:
            continue
        text = line_text(line)
        end_concept = find_marker(text, section.get("endAnchors", []))
        if end_concept:
            end_marker = {"concept": end_concept, "page": page["page"], "y": round(y, 2), "text": text}
            break
        continuation = find_marker(text, section.get("continuationMarkers", []))
        if continuation:
            continuations.append({"concept": continuation, "page": page["page"], "y": round(y, 2), "text": text})
            continue
        if find_marker(text, section.get("excludedLineMarkers", [])) or find_marker(text, row_spec.get("ignoredMarkers", [])):
            continue

        values = {role: join_column(line, bounds) for role, bounds in ranges.items()}
        date_patterns = row_spec["datePatterns"]
        looks_like_row = any(
            values.get(role) and re.fullmatch(pattern, values[role] or "")
            for role, pattern in date_patterns.items()
        )
        if not looks_like_row:
            continue

        reasons: list[str] = []
        if row_spec.get("linePattern") and not re.search(row_spec["linePattern"], text):
            reasons.append("line does not match configured row pattern")
        for role in row_spec["requiredRoles"]:
            if not values.get(role):
                reasons.append(f"missing {role}")
        for role, pattern in date_patterns.items():
            if not values.get(role) or not re.fullmatch(pattern, values[role] or ""):
                reasons.append(f"invalid {role}")

        amount_pattern = amount_spec["rawPattern"]
        if amount_spec["model"] == "SIGNED_AMOUNT":
            if not values.get("signedAmount") or not re.fullmatch(amount_pattern, values["signedAmount"] or ""):
                reasons.append("missing or invalid signedAmount")
        else:
            amount_values = [values.get("debit"), values.get("credit")]
            if not any(amount_values):
                reasons.append("missing debit/credit")
            if any(value and not re.fullmatch(amount_pattern, value) for value in amount_values):
                reasons.append("invalid debit/credit")
        if values.get("balance") and not re.fullmatch(amount_pattern, values["balance"] or ""):
            reasons.append("invalid balance")

        if reasons:
            ambiguous.append({"page": page["page"], "y": round(y, 2), "text": text, "reasons": sorted(set(reasons))})
            continue

        row_words = [
            word for word in line
            if min(bounds[0] for bounds in ranges.values()) <= (word[0] + word[2]) / 2 < max(bounds[1] for bounds in ranges.values())
        ]
        row: dict[str, Any] = {
            "postingDateRaw": values.get("postingDate"),
            "valueDateRaw": values.get("valueDate"),
            "postingDate": resolve_date(values.get("postingDate"), date_spec, statement_period),
            "valueDate": resolve_date(values.get("valueDate"), date_spec, statement_period),
            "description": values.get("description"),
            "signedAmountRaw": values.get("signedAmount"),
            "debitRaw": values.get("debit"),
            "creditRaw": values.get("credit"),
            "balanceRaw": values.get("balance"),
            "page": page["page"],
            "source": {
                "bbox": [
                    round(min(word[0] for word in row_words), 2),
                    round(min(word[1] for word in row_words), 2),
                    round(max(word[2] for word in row_words), 2),
                    round(max(word[3] for word in row_words), 2),
                ],
                "y": round(y, 2),
            },
        }
        rows.append(row)

    return {
        "rows": rows,
        "ambiguousRows": ambiguous,
        "continuationMarkers": continuations,
        "endMarker": end_marker,
    }


def row_movement(row: dict[str, Any], template: dict[str, Any]) -> Decimal | None:
    number_format = template["amounts"]["numberFormat"]
    if template["amounts"]["model"] == "SIGNED_AMOUNT":
        return parse_decimal(row.get("signedAmountRaw"), number_format)
    debit = parse_decimal(row.get("debitRaw"), number_format) or Decimal("0")
    credit = parse_decimal(row.get("creditRaw"), number_format) or Decimal("0")
    return credit - debit


def reconcile(rows: list[dict[str, Any]], context: dict[str, Any], template: dict[str, Any]) -> dict[str, Any]:
    mode = template["reconciliation"]["mode"]
    tolerance = Decimal(template["reconciliation"].get("tolerance", "0.01"))
    if mode == "NONE":
        return {"mode": mode, "status": "SKIPPED"}
    number_format = template["amounts"]["numberFormat"]
    opening = parse_decimal(context["openingBalance"]["raw"], number_format) if context.get("openingBalance") else None
    closing = parse_decimal(context["closingBalance"]["raw"], number_format) if context.get("closingBalance") else None
    movements = [row_movement(row, template) for row in rows]
    valid_movements = [movement for movement in movements if movement is not None]
    total_credits = sum((movement for movement in valid_movements if movement > 0), Decimal("0"))
    total_debits = sum((-movement for movement in valid_movements if movement < 0), Decimal("0"))
    total_signed = sum(valid_movements, Decimal("0"))
    calculated_closing = opening + total_signed if opening is not None else None
    difference = calculated_closing - closing if calculated_closing is not None and closing is not None else None

    continuity: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    previous = opening
    if mode == "FULL_RECONCILIATION":
        for index, (row, movement) in enumerate(zip(rows, movements), start=1):
            actual = parse_decimal(row.get("balanceRaw"), template["amounts"]["numberFormat"])
            expected = previous + movement if previous is not None and movement is not None else None
            row_difference = expected - actual if expected is not None and actual is not None else None
            status = "PASS" if row_difference is not None and abs(row_difference) <= tolerance else "FAIL"
            check = {
                "rowIndex": index,
                "page": row["page"],
                "description": row["description"],
                "expectedBalance": json_decimal(expected),
                "actualBalance": json_decimal(actual),
                "difference": json_decimal(row_difference),
                "status": status,
            }
            continuity.append(check)
            if status == "FAIL":
                failures.append(check)
            previous = actual

    aggregate_pass = difference is not None and abs(difference) <= tolerance
    status = "PASS" if aggregate_pass and not failures else "FAIL" if opening is not None and closing is not None else "UNAVAILABLE"
    return {
        "mode": mode,
        "tolerance": json_decimal(tolerance),
        "openingBalance": json_decimal(opening),
        "totalDebits": json_decimal(total_debits),
        "totalCredits": json_decimal(total_credits),
        "totalSignedMovement": json_decimal(total_signed),
        "calculatedClosingBalance": json_decimal(calculated_closing),
        "statementClosingBalance": json_decimal(closing),
        "difference": json_decimal(difference),
        "status": status,
        "rowContinuity": continuity,
        "rowContinuityFailureCount": len(failures),
        "rowContinuityFailures": failures,
    }


def collect_exclusion_evidence(
    pages: list[dict[str, Any]],
    transaction_regions: list[dict[str, Any]],
    template: dict[str, Any],
) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    anchors = template.get("diagnostics", {}).get("excludedSectionAnchors", [])
    for anchor in anchors:
        occurrences: list[dict[str, Any]] = []
        for page in pages:
            regions = [region for region in transaction_regions if region["page"] == page["page"]]
            for line in page["_lines"]:
                text = line_text(line)
                if not contains_anchor(text, anchor):
                    continue
                y = line[0][1]
                occurrences.append(
                    {
                        "page": page["page"],
                        "y": round(y, 2),
                        "text": text,
                        "insideTransactionRegion": any(region["startY"] <= y < region["endY"] for region in regions),
                    }
                )
        evidence.append({"anchor": anchor, "occurrences": occurrences})
    return evidence


def extract_document_layout(
    pdf_path: Path,
    line_grouping_tolerance: float,
) -> tuple[int, list[dict[str, Any]], str]:
    pages: list[dict[str, Any]] = []
    document_text_parts: list[str] = []
    with pymupdf.open(pdf_path) as document:
        page_count = document.page_count
        for index, pdf_page in enumerate(document):
            raw_words = pdf_page.get_text("words")
            text = pdf_page.get_text()
            document_text_parts.append(text)
            pages.append(
                {
                    "page": index + 1,
                    "dimensions": {"width": round(pdf_page.rect.width, 2), "height": round(pdf_page.rect.height, 2)},
                    "selectableText": bool(text.strip()),
                    "wordCount": len(raw_words),
                    "characterCount": len(text),
                    "_lines": group_words(raw_words, line_grouping_tolerance),
                }
            )
    return page_count, pages, "\n".join(document_text_parts)


def detect_template(
    pages: list[dict[str, Any]],
    document_text: str,
    template: dict[str, Any],
) -> dict[str, Any]:
    identification = identify_document(document_text, template)
    section = template["section"]
    section_active = False
    section_detected = False
    table_header_detected = False

    for page in pages:
        page_text = " ".join(line_text(line) for line in page["_lines"])
        if not section_active and match_anchors(
            page_text,
            section.get("startAnchors", []),
            section.get("startAnchorMode", "ALL"),
        ):
            section_active = True
            section_detected = True
        if section_active and find_header(page["_lines"], section["tableHeader"]):
            table_header_detected = True
            break

    identification_passed = identification["status"] == "PASS"
    matched = identification_passed and section_detected and table_header_detected
    reasons: list[str] = []
    if not identification_passed:
        reasons.append("identification_evidence_failed")
    if not section_detected:
        reasons.append("transaction_section_not_found")
    if not table_header_detected:
        reasons.append("table_header_not_found")
    if matched:
        reasons.append("required_identification_section_and_header_matched")

    return {
        "parserId": template["id"],
        "displayName": template["name"],
        "matched": matched,
        "evidence": {
            "identification": identification_passed,
            "section": section_detected,
            "tableHeader": table_header_detected,
        },
        "reasons": reasons,
    }


def detect_pdf(pdf_path: Path, templates: list[dict[str, Any]]) -> dict[str, Any]:
    tolerances = [float(template.get("lineGroupingTolerance", 2.5)) for template in templates]
    tolerance = min(tolerances) if tolerances else 2.5
    page_count, pages, document_text = extract_document_layout(pdf_path, tolerance)
    selectable_page_count = sum(1 for page in pages if page["selectableText"])
    if selectable_page_count == 0:
        return {
            "decision": "unusable_pdf",
            "candidates": [],
            "document": {
                "pageCount": page_count,
                "selectableTextPageCount": 0,
            },
        }

    candidates = [detect_template(pages, document_text, template) for template in templates]
    match_count = sum(1 for candidate in candidates if candidate["matched"])
    decision = "single_match" if match_count == 1 else "multiple_matches" if match_count > 1 else "no_match"
    return {
        "decision": decision,
        "candidates": candidates,
        "document": {
            "pageCount": page_count,
            "selectableTextPageCount": selectable_page_count,
        },
    }


def inspect_pdf(pdf_path: Path, template: dict[str, Any]) -> dict[str, Any]:
    tolerance = float(template.get("lineGroupingTolerance", 2.5))
    page_count, pages, document_text = extract_document_layout(pdf_path, tolerance)
    identification = identify_document(document_text, template)
    if identification["status"] != "PASS":
        raise ValueError(f"PDF does not match template {template['id']}: {identification}")

    context = extract_context(document_text, pages, template)
    statement_period = context.get("statementPeriod")
    section = template["section"]
    section_active = False
    section_ended = False
    table_pages: list[dict[str, Any]] = []
    all_rows: list[dict[str, Any]] = []
    all_ambiguous: list[dict[str, Any]] = []
    all_continuations: list[dict[str, Any]] = []
    transaction_regions: list[dict[str, Any]] = []

    for page in pages:
        page_text = " ".join(line_text(line) for line in page["_lines"])
        if not section_active and match_anchors(page_text, section.get("startAnchors", []), section.get("startAnchorMode", "ALL")):
            section_active = True
        if not section_active or section_ended:
            continue
        header = find_header(page["_lines"], section["tableHeader"])
        if not header:
            continue
        extracted = extract_page_rows(page, header, template, statement_period)
        end_y = extracted["endMarker"]["y"] if extracted["endMarker"] else page["dimensions"]["height"]
        transaction_regions.append({"page": page["page"], "startY": header["yEnd"], "endY": end_y})
        table_pages.append({"page": page["page"], "header": header, "rowCount": len(extracted["rows"])})
        all_rows.extend(extracted["rows"])
        all_ambiguous.extend(extracted["ambiguousRows"])
        all_continuations.extend(extracted["continuationMarkers"])
        if extracted["endMarker"]:
            section_ended = True

    movements = [row_movement(row, template) for row in all_rows]
    debit_count = sum(1 for movement in movements if movement is not None and movement < 0)
    credit_count = sum(1 for movement in movements if movement is not None and movement > 0)
    reconciliation = reconcile(all_rows, context, template)
    exclusion_evidence = collect_exclusion_evidence(pages, transaction_regions, template)

    public_pages = [
        {key: value for key, value in page.items() if not key.startswith("_")}
        for page in pages
    ]
    return {
        "reportVersion": 2,
        "engineVersion": "1.0",
        "template": {
            "schemaVersion": template["schemaVersion"],
            "id": template["id"],
            "name": template["name"],
            "path": template["_templatePath"],
        },
        "identification": identification,
        "source": {"path": str(pdf_path.resolve()), "filename": pdf_path.name},
        "library": {"name": "PyMuPDF", "module": "pymupdf", "coordinateUnit": "PDF points"},
        "document": {
            "pageCount": page_count,
            "selectableText": any(page["selectableText"] for page in pages),
            "pages": public_pages,
        },
        "context": context,
        "transactionTable": {
            "amountModel": template["amounts"]["model"],
            "dateModel": template["dates"]["model"],
            "primaryDateRole": template["dates"]["primaryRole"],
            "detectedPages": table_pages,
            "rowCount": len(all_rows),
            "signedAmountRowCount": sum(1 for row in all_rows if row.get("signedAmountRaw") is not None),
            "debitRowCount": debit_count,
            "creditRowCount": credit_count,
            "ambiguousRowCount": len(all_ambiguous),
            "ambiguousRows": all_ambiguous,
            "continuationMarkers": all_continuations,
            "rows": all_rows,
            "samples": {
                "firstTransaction": all_rows[0] if all_rows else None,
                "lastTransaction": all_rows[-1] if all_rows else None,
            },
        },
        "reconciliation": reconciliation,
        "scopeDiagnostics": {
            "transactionRegions": transaction_regions,
            "excludedSectionEvidence": exclusion_evidence,
        },
    }
