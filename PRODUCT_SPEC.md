# PRODUCT_SPEC

## 1. Product overview

FlowLedger is a multi-account personal finance web application for importing, classifying, reviewing, and analysing personal financial transactions. The product is intended to help users consolidate transactions from multiple accounts, organise them into meaningful financial categories, review ambiguous items before they affect reporting, and progressively automate classification through reusable rules. The current version is a local prototype, but the long-term target is a multi-user online application with real authentication, database persistence, and deployment.

## 2. Product goals

FlowLedger should enable a user to:

- manage more than one financial account within a workspace,
- import transaction data from external files,
- classify transactions into categories and subcategories,
- review uncertain or incomplete classifications before they affect analytics,
- view dashboards showing meaningful financial patterns,
- create reusable classification rules based on corrections,
- eventually manage budgets and operate in a real authenticated multi-user environment.

## 3. Core product principles

### 3.1 Review before trust

Transactions that are not sufficiently reliable must remain visible to the user but must not affect reporting until reviewed and confirmed. This is represented by the `needsReview` state.

### 3.2 Engine semantics are distinct from reporting semantics

The product intentionally separates transaction meaning from reporting labels:

- `type` expresses engine semantics,
- `category` and `subcategory` express reporting and budget labelling.

This distinction is fundamental and must be preserved throughout the system.

### 3.3 User corrections should improve the system

When a user corrects a classification, the system should support turning that correction into a reusable rule. Rules should help future imports and transaction entry, but must not silently rewrite historical data without explicit user confirmation.

### 3.4 The product must remain scalable in data design

Import architecture must be based on reusable mapping/templates rather than hardcoded bank-specific parsers as the primary model. This is a product-level direction, not just an implementation detail.

## 4. Core domain model

### 4.1 Workspace

A workspace is the top-level scope within which the user manages accounts, transactions, rules, categories, and settings. The architecture should preserve workspace scoping so that real auth and multi-user behaviour can be added later.

### 4.2 Account

An account represents a financial source or container, such as a bank account, card account, or similar ledger source. Transactions belong to accounts. Account balances are expected to eventually reflect transaction-derived movement, not just static display values.

### 4.3 Transaction

A transaction is a financial ledger item associated with an account. A transaction may be created manually or imported. A transaction participates in review, classification, dashboard reporting, rule learning, and later budgeting.

#### Transaction semantic fields

The following conceptual fields are core to the product:

- `type`
- `category`
- `subcategory`
- `needsReview`
- amount/value fields
- description/raw description
- account association
- date/time metadata

The exact code-level schema may evolve, but these concepts are product-critical.

### 4.4 Transaction type

Transaction `type` defines engine meaning. Current intended semantic values are:

- `Expense`
- `Income`
- `InternalTransfer`
- `Adjustment`

#### Type meaning

- `Expense` means outflow for reporting purposes.
- `Income` means inflow for reporting purposes.
- `InternalTransfer` means movement between user-controlled accounts and must not be treated as income or expense in dashboard analytics.
- `Adjustment` is reserved for non-standard ledger corrections or manual balancing situations.

### 4.5 Category and subcategory

Categories and subcategories are user-managed reporting labels used for analysis and later budgeting. They are not the primary source of engine meaning when `type` is available. Subcategories also carry `flowType` metadata to indicate whether they belong to an expense or income branch.

### 4.6 Classification rule

A classification rule is a reusable instruction that helps assign categories and related metadata to transactions based on transaction content, especially descriptions. Rules should be editable by the user and should default to using meaningful full descriptions rather than vague tokens.

## 5. Review model

### 5.1 Pending review

A transaction marked `needsReview = true` is visible in the ledger and review flows but is excluded from dashboard metrics and charts until confirmed. This is a core product rule.

### 5.2 Review queue

The product should provide a clear review flow for unresolved transactions, including transactions created through import. Users must be able to identify pending-review items easily in both dashboard and transaction contexts.

## 6. Transaction behavior rules

### 6.1 Expense and income sign semantics

The intended ledger convention is:

- `Expense` stores as a negative movement,
- `Income` stores as a positive movement.

### 6.2 Internal transfer semantics

Internal transfers represent movement between the user’s own accounts.

Product rules:
- they must remain visible in the ledger,
- they must affect account balances,
- they must not count as dashboard income,
- they must not count as dashboard expense.

The preferred semantic model is a single `InternalTransfer` type with a direction expressed through sign and UI direction handling, rather than splitting this into separate transfer-in and transfer-out types.

### 6.3 Adjustment semantics

Adjustments exist for special ledger corrections and should remain semantically distinct from normal income, expense, and transfer flows. Adjustment behaviour may remain more permissive than standard income/expense sign handling.

## 7. Dashboard and analytics rules

Dashboard reporting is intended to show meaningful financial behaviour rather than raw ledger movement.

Current product rules:
- transactions marked `needsReview` are excluded from dashboard KPIs and charts,
- internal transfers are excluded from income/expense analytics,
- dashboard metrics should be driven by transaction semantics, not by superficial category naming.

This means reporting logic should rely primarily on transaction `type` and review state rather than on amount sign alone. That is an architectural implication of the product model, even where implementation is still being stabilised.

## 8. Rule behavior rules

- Users may create classification rules from transaction corrections.
- Rules must be editable and removable in Settings.
- A newly created rule may propose similar historical transactions.
- Historical backfill must require explicit confirmation.
- Rules may apply automatically to the current import batch or to future matching items, but should not silently reclassify existing stored transactions in the background.

## 9. Import model

The import system is intended to support CSV/XLSX transaction ingestion through a generic parsing and mapping workflow.

Target model:
- ingest CSV/XLSX files,
- allow user-defined or saved column mappings,
- support reusable import templates,
- send uncertain items into review,
- allow rules to assist with classification during import.

The product direction explicitly rejects a bank-by-bank hardcoded parser architecture as the main approach.

## 10. Categories management

The category system must remain user-manageable. The user should be able to:
- rename categories and subcategories,
- toggle active/inactive states,
- manage subcategory structures in a compact usable interface,
- preserve category structures that later support budgeting and rules.

## 11. Budgeting

Budgeting is part of the intended product, but not yet a stabilised implemented feature. When introduced, budgeting should build on the category/subcategory model rather than bypass it.

## 12. Persistence and platform direction

The current prototype uses a local/mock/in-memory style data layer. The product is not yet on real auth or a production database. This is temporary and should not distort the long-term architecture. The codebase should preserve service-layer boundaries and scoping assumptions so that migration to real authentication and persistence remains feasible later.

## 13. Explicit non-goals for the current stage

The following are not current-stage goals:
- production-ready auth,
- production-ready database persistence,
- final deployment infrastructure,
- broad multi-user collaboration features,
- bank-specific import hardcoding as the primary import model.

## 14. UX constraints that are part of the product contract

Certain UX decisions are currently treated as binding constraints because they protect stability and data trust:

- rule backfill uses an inline panel rather than a modal,
- modal/overlay-based backfill should not be reintroduced casually,
- reload-based fixes are not acceptable as standard UX,
- pending-review items must remain visually distinguishable from trusted items.

## 15. Product maturity statement

FlowLedger is currently in prototype and domain-shaping mode. The primary objective at this stage is to stabilise core financial semantics, review logic, rule behaviour, and import architecture before moving into budgets, real persistence, and deployment.
