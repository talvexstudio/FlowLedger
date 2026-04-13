# DECISION_LOG

## Purpose

This document records implementation decisions that are currently treated as locked for FlowLedger. It exists to reduce drift across coding sessions and to protect the product model while the app is still in prototype and domain-shaping mode.

## 1. Rule backfill uses an inline panel, not a modal

**Decision:** Locked.

### Reason
- Multiple modal / overlay / AlertDialog-style attempts caused recurring freeze bugs where scrolling still worked but clicks, buttons, or menus stopped responding.
- The inline panel removed that class of focus-trap / overlay bug and is the currently accepted UX.

### Implication
- Do not reintroduce modal-based backfill without a very strong reason and a deliberate replacement plan.

## 2. `needsReview` transactions do not count in dashboard metrics

**Decision:** Locked.

### Reason
- Review is part of the product trust model.
- Transactions that are still ambiguous must remain visible, but must not affect KPIs or charts until they are confirmed.

### Implication
- Any aggregation, dashboard, budget, or analytics logic must preserve this rule.
- Pending-review items may appear in ledger and review flows, but not in trusted reporting.

## 3. `type` and `category` are different concepts

**Decision:** Locked.

### Meaning
- `type` = engine semantics (`Expense`, `Income`, `InternalTransfer`, `Adjustment`)
- `category` / `subcategory` = reporting and budgeting label

### Reason
- Reporting labels are not reliable enough to define core ledger meaning.
- Engine semantics must remain explicit and stable even if the category model evolves.

### Implication
- Do not use category as the primary driver of ledger semantics when `type` is available.
- Dashboard inclusion/exclusion rules should be based primarily on `type` and review state, not category naming.

## 4. Rules must not silently rewrite historical transactions

**Decision:** Locked.

### Reason
- Rule learning is useful, but silent retroactive changes are unsafe and reduce trust.
- Historical backfill must remain explicit and user-confirmed.

### Implication
- A newly created rule may suggest similar existing transactions.
- Applying the rule to historical stored items requires explicit confirmation.
- Automatic application is acceptable for:
  - the current import batch,
  - future matching transactions,
  - form prefill or assistive suggestions.

## 5. Rule matching defaults to full description, not vague token fragments

**Decision:** Locked.

### Reason
- Generic tokens such as `COMPRA` overmatch and create unsafe rules.
- Full description is a safer and more meaningful default starting point.

### Implication
- Rule creation should keep defaulting to the full description/raw description.
- The user can later broaden or narrow the rule in Settings.

## 6. Categories and subcategories remain user-managed

**Decision:** Locked.

### Reason
- The category tree must be editable because it is foundational for reporting, rules, and later budgeting.
- Users should not be trapped inside a fixed static taxonomy.

### Implication
- Rename, active/inactive, and subcategory management remain part of the core settings model.
- Later budget work should build on this editable structure rather than bypass it.

## 7. Import architecture is mapping-template based, not bank-hardcoded

**Decision:** Locked.

### Reason
- A parser-per-bank architecture does not scale and is not product-worthy as the primary model.
- The intended model is generic CSV/XLSX parsing plus reusable mapping/templates.

### Implication
- Saved mappings/templates are the strategic direction.
- Bank-specific handling may exist as an exception or convenience later, but not as the core architecture.

## 8. Persistence is still mock/in-memory; avoid reload-based fixes

**Decision:** Locked practical constraint for the current stage.

### Reason
- The app is not yet on a real database/auth stack.
- Full page reloads can reset local/demo state and hide real state-management issues.

### Implication
- Do not use `window.location.reload()` or similar reload-based fixes as a normal solution path.
- Fix behaviour through component state, service-layer logic, and data flow instead.

## 9. InternalTransfer remains one semantic type

**Decision:** Locked.

### Meaning
- Keep one `InternalTransfer` type.
- Represent direction through sign semantics and transaction form direction UI.
- Do not split into `InternalTransferIn` and `InternalTransferOut` types.

### Reason
- Separate transfer-in / transfer-out types would unnecessarily inflate the type system.
- A single semantic transfer type better reflects the product model.

### Implication
- Direction UI is a form/runtime concern.
- Dashboard exclusion should be keyed off `type === 'InternalTransfer'`.
- Account balances must still include signed transfer movement.

## 10. InternalTransfer is excluded from income/expense analytics but included in balances

**Decision:** Locked.

### Reason
- Transfers move money between user-controlled accounts.
- They are real ledger movement, but not income and not expense from a reporting perspective.

### Implication
- Transfers remain visible in the ledger.
- Transfers affect account balances.
- Transfers do not count in dashboard income/expense KPIs or charts.

## 11. Phase order is fixed

**Decision:** Locked.

### Phase sequence
- **Phase 0**: stable Dashboard + Transactions
- **Phase 1**: Rules + Settings/Core
- **Phase 2**: Import templates & mapping
- **Phase 3**: Budget
- **Phase 4**: Real auth + real DB + deployment

### Reason
- The domain model and reporting rules must stabilise before budgets or infrastructure work.

### Implication
- Do not jump to budgets or production infrastructure while transaction semantics, review logic, and import architecture are still unstable.

## Rejected or de-prioritised alternatives

### A. Modal-based backfill confirmation
Rejected for now.

**Reason:** repeated overlay/focus-trap failures.

### B. Bank-hardcoded import architecture as the main strategy
Rejected.

**Reason:** too brittle, too narrow, not scalable.

### C. Category-level KPI exclusion flags at this stage
Not chosen for now.

**Reason:** possible future flexibility, but unnecessary complexity at the current stage. The simpler current rule is that `type === 'InternalTransfer'` drives exclusion.

### D. Separate transfer-in / transfer-out types
Rejected.

**Reason:** makes the engine model more complex than necessary.

## Change-control constraints that must not drift

- Pending-review items remain visible but excluded from trusted reporting.
- Inline backfill remains the accepted UX for rule backfill.
- Historical backfill remains explicit and user-confirmed.
- `type` must not be collapsed into `category`.
- InternalTransfer stays visible in the ledger, excluded from KPI analytics, and included in balances.
- Reload-based fixes are not acceptable as normal behaviour.
- Broad redesigns should be avoided during narrow stabilization work.
- Service-layer separation and workspace/account scoping should be preserved so later auth/DB migration remains feasible.

## 12. Iteration update - 2026-04-09

### InternalTransfer direction defaults are explicit in form state
**Decision:** Applied in implementation for stability.

### Reason
- Runtime behavior was inconsistent when direction UI was not explicitly initialized.
- A visual default without stored form value led to incorrect fallback sign behavior on submit.

### Implication
- When `type === InternalTransfer`, form state must carry an explicit direction (`Out` or `In`) before submit.
- Submit normalization must derive transfer sign from that direction, not from ambiguous fallback heuristics.

### Additional implementation constraint
- Form-only fields used for UI behavior (`createRule`, `internalDirection`) should not be persisted as transaction model fields.
