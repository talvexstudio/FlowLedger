"""CLI for Generic PDF Engine V1 diagnostic extraction."""

from __future__ import annotations

import argparse
import csv
import html
import json
from pathlib import Path
from typing import Any

from pdf_engine import inspect_pdf, load_template


EXPORT_COLUMNS = [
    "page",
    "postingDateRaw",
    "valueDateRaw",
    "postingDate",
    "valueDate",
    "description",
    "signedAmountRaw",
    "debitRaw",
    "creditRaw",
    "balanceRaw",
]


def cell(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def require_private_output(path: Path, private_root: Path) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(private_root.resolve())
    except ValueError as error:
        raise ValueError(f"Diagnostic financial outputs must remain under {private_root.resolve()}: {resolved}") from error
    return resolved


def export_csv(report: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=EXPORT_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(report["transactionTable"]["rows"])


def export_html(report: dict[str, Any], output_path: Path) -> None:
    table = report["transactionTable"]
    reconciliation = report["reconciliation"]
    context = report["context"]
    period = context.get("statementPeriod") or {}
    period_text = " to ".join(value for value in [period.get("from"), period.get("to")] if value) or "Not detected"
    table_pages = ", ".join(str(page["page"]) for page in table["detectedPages"])
    rows_html = "".join(
        "<tr>" + "".join(f"<td>{cell(row.get(column))}</td>" for column in EXPORT_COLUMNS) + "</tr>"
        for row in table["rows"]
    )
    headers_html = "".join(f"<th>{cell(column)}</th>" for column in EXPORT_COLUMNS)
    anomalies = reconciliation.get("rowContinuityFailures", [])
    anomaly_columns = ["rowIndex", "page", "description", "expectedBalance", "actualBalance", "difference", "status"]
    anomaly_html = (
        "<p>No row-level balance continuity anomalies detected.</p>"
        if not anomalies
        else "<div class='table-wrap'><table><thead><tr>"
        + "".join(f"<th>{cell(column)}</th>" for column in anomaly_columns)
        + "</tr></thead><tbody>"
        + "".join("<tr>" + "".join(f"<td>{cell(item.get(column))}</td>" for column in anomaly_columns) + "</tr>" for item in anomalies)
        + "</tbody></table></div>"
    )
    evidence_rows = []
    for evidence in report["scopeDiagnostics"]["excludedSectionEvidence"]:
        for occurrence in evidence["occurrences"]:
            evidence_rows.append(
                "<tr>"
                f"<td>{cell(evidence['anchor'])}</td>"
                f"<td>{cell(occurrence['page'])}</td>"
                f"<td>{cell(occurrence['y'])}</td>"
                f"<td>{cell(occurrence['insideTransactionRegion'])}</td>"
                f"<td>{cell(occurrence['text'])}</td>"
                "</tr>"
            )
    evidence_html = (
        "<p>No configured non-ledger evidence anchors were found.</p>"
        if not evidence_rows
        else "<div class='table-wrap'><table><thead><tr><th>Anchor</th><th>Page</th><th>Y</th><th>Inside transaction region</th><th>Text</th></tr></thead>"
        f"<tbody>{''.join(evidence_rows)}</tbody></table></div>"
    )
    signed_count_label = "Signed rows" if table["amountModel"] == "SIGNED_AMOUNT" else "Debit / credit rows"
    signed_count_value = table["signedAmountRowCount"] if table["amountModel"] == "SIGNED_AMOUNT" else f"{table['debitRowCount']} / {table['creditRowCount']}"
    content = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF extraction report - {cell(report['source']['filename'])}</title>
<style>
body {{ font-family: system-ui, sans-serif; color: #202124; margin: 2rem; }}
h1 {{ margin-bottom: .25rem; }}
.meta {{ color: #5f6368; margin-top: .25rem; }}
.stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: .75rem; margin: 1.25rem 0; }}
.stat {{ border: 1px solid #dadce0; border-radius: 6px; padding: .8rem; }}
.stat strong {{ display: block; font-size: 1.25rem; overflow-wrap: anywhere; }}
.stat span {{ color: #5f6368; font-size: .9rem; }}
.table-wrap {{ overflow-x: auto; }}
table {{ border-collapse: collapse; width: 100%; font-size: .86rem; }}
th, td {{ border: 1px solid #dadce0; padding: .42rem .5rem; text-align: left; vertical-align: top; }}
th {{ background: #f1f3f4; position: sticky; top: 0; }}
td:nth-child(6) {{ min-width: 22rem; }}
td:not(:nth-child(6)) {{ white-space: nowrap; }}
.pass {{ color: #137333; }}
.fail {{ color: #b3261e; }}
</style>
</head>
<body>
<h1>Generic PDF extraction report</h1>
<p class="meta">Source: {cell(report['source']['filename'])}</p>
<p class="meta">Template: {cell(report['template']['name'])} ({cell(report['template']['id'])})</p>
<div class="stats">
  <div class="stat"><strong>{report['document']['pageCount']}</strong><span>Pages</span></div>
  <div class="stat"><strong>{cell(period_text)}</strong><span>Statement period</span></div>
  <div class="stat"><strong>{cell(table_pages or 'None')}</strong><span>Transaction pages</span></div>
  <div class="stat"><strong>{table['rowCount']}</strong><span>Transactions</span></div>
  <div class="stat"><strong>{cell(signed_count_value)}</strong><span>{signed_count_label}</span></div>
  <div class="stat"><strong>{table['ambiguousRowCount']}</strong><span>Ambiguous/rejected</span></div>
</div>
<h2>Accounting reconciliation</h2>
<div class="stats">
  <div class="stat"><strong>{cell(reconciliation.get('openingBalance'))}</strong><span>Opening balance</span></div>
  <div class="stat"><strong>{cell(reconciliation.get('totalCredits'))}</strong><span>Total credits</span></div>
  <div class="stat"><strong>{cell(reconciliation.get('totalDebits'))}</strong><span>Total debits</span></div>
  <div class="stat"><strong>{cell(reconciliation.get('totalSignedMovement'))}</strong><span>Net movement</span></div>
  <div class="stat"><strong>{cell(reconciliation.get('calculatedClosingBalance'))}</strong><span>Calculated closing</span></div>
  <div class="stat"><strong>{cell(reconciliation.get('statementClosingBalance'))}</strong><span>Statement closing</span></div>
  <div class="stat"><strong>{cell(reconciliation.get('difference'))}</strong><span>Difference</span></div>
  <div class="stat"><strong class="{str(reconciliation.get('status', '')).lower()}">{cell(reconciliation.get('status'))}</strong><span>Status</span></div>
</div>
<h3>Row-level balance anomalies</h3>
{anomaly_html}
<h2>Section-scope evidence</h2>
{evidence_html}
<h2>Extracted transactions</h2>
<div class="table-wrap"><table><thead><tr>{headers_html}</tr></thead><tbody>{rows_html}</tbody></table></div>
</body>
</html>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")


def print_summary(report: dict[str, Any], outputs: dict[str, Path]) -> None:
    table = report["transactionTable"]
    reconciliation = report["reconciliation"]
    print(f"Template: {report['template']['name']} ({report['template']['id']})")
    print(f"PDF: {report['source']['path']}")
    print(f"Pages: {report['document']['pageCount']} | transaction pages: {[page['page'] for page in table['detectedPages']]}")
    print(
        f"Transactions: {table['rowCount']} | signed: {table['signedAmountRowCount']} | "
        f"debit: {table['debitRowCount']} | credit: {table['creditRowCount']} | ambiguous: {table['ambiguousRowCount']}"
    )
    print(
        "Reconciliation: "
        f"opening={reconciliation.get('openingBalance')} credits={reconciliation.get('totalCredits')} "
        f"debits={reconciliation.get('totalDebits')} calculated={reconciliation.get('calculatedClosingBalance')} "
        f"statement={reconciliation.get('statementClosingBalance')} difference={reconciliation.get('difference')} "
        f"continuityFailures={reconciliation.get('rowContinuityFailureCount')} status={reconciliation.get('status')}"
    )
    for name, path in outputs.items():
        print(f"{name.upper()} report: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Generic PDF Engine V1 with a configuration template.")
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--html", type=Path)
    parser.add_argument("--csv", type=Path)
    args = parser.parse_args()

    repository_root = Path(__file__).resolve().parents[2]
    private_root = repository_root / ".local" / "pdf-import"
    stem = args.input.stem
    outputs = {
        "json": require_private_output(args.json or private_root / f"{stem}.report.json", private_root),
        "html": require_private_output(args.html or private_root / f"{stem}.report.html", private_root),
        "csv": require_private_output(args.csv or private_root / f"{stem}.rows.csv", private_root),
    }
    template = load_template(args.template)
    report = inspect_pdf(args.input, template)
    outputs["json"].parent.mkdir(parents=True, exist_ok=True)
    outputs["json"].write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    export_html(report, outputs["html"])
    export_csv(report, outputs["csv"])
    print_summary(report, outputs)


if __name__ == "__main__":
    main()
