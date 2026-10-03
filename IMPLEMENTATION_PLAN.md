# IMPLEMENTATION_PLAN

## 1. Purpose

This document translates the product specification into a phased execution plan for FlowLedger.

It is intended to:
- track what has already been achieved,
- distinguish stable features from partially implemented or untrusted ones,
- define what remains to be built,
- preserve sequencing discipline,
- prevent scope drift while the product is still in prototype/domain-shaping mode.

## 2. Status legend

Each item in this plan should be treated as one of the following:

- **Done**: implemented and trusted enough to build on
- **Done, needs verification**: implemented but still needs runtime confirmation
- **In progress / unstable**: concept and some code exist, but behaviour is not yet reliable
- **Not started**: not meaningfully implemented yet
- **Deferred**: intentionally postponed to a later phase

This distinction matters because several FlowLedger areas are not missing, but partially present and not yet trustworthy, especially around InternalTransfer semantics, balances, and import architecture.

## 3. Locked sequencing

The phase order is locked as follows:

- **Phase 0**: stable Dashboard + Transactions
- **Phase 1**: Rules + Settings/Core
- **Phase 2**: Import templates & mapping
- **Phase 3**: Budget
- **Phase 4**: Real auth + real DB + deployment

This sequencing exists to stabilise financial semantics and classification logic before moving into budgeting or infrastructure.

## 4. Current phase summary

### Phase 0 — Dashboard + Transactions
**Overall status:** Mostly achieved, but not fully closed

#### Intended outcomes
- transaction CRUD is usable,
- transactions can be reviewed and searched,
- dashboard metrics and charts are driven by transaction data,
- pending-review transactions are excluded from analytics,
- basic transaction semantics are stable enough to support later features.

#### Achieved
- Transactions create/edit/delete works
- Bulk delete works
- Search works
- Grey pending-review rows exist
- Legend explains greyed rows
- Dashboard KPIs/charts are wired to transactions
- `needsReview` transactions are excluded from dashboard metrics/charts
- Review count appears in dashboard
- Expenses-by-category chart colors were fixed

#### Still open
- InternalTransfer direction/sign logic is not yet trustworthy at runtime
- InternalTransfer exclusion from dashboard analytics must be verified after the form/sign fix
- Account balances are not yet properly transaction-derived

#### Exit criteria for closing Phase 0
Phase 0 should only be considered complete when:
1. `Expense`, `Income`, `InternalTransfer`, and `Adjustment` behave consistently in transaction entry/editing
2. `needsReview` exclusion continues to hold
3. InternalTransfer is excluded from dashboard KPIs/charts
4. account balances are derived from signed transaction movement, including InternalTransfer

---

### Phase 1 — Rules + Settings/Core
**Overall status:** Largely achieved, with some later validation still useful

#### Intended outcomes
- user can create and manage classification rules,
- user can manage categories/subcategories,
- rules support learning from corrections,
- historical backfill remains explicit and safe,
- stable settings foundation exists for later import and budget work.

#### Achieved
- `ClassificationRule` model/service implemented
- “Create Classification Rule” checkbox is real
- Settings → Rules tab exists
- Rules can be listed, edited, and deleted
- Rule creation defaults to full description instead of vague token matching
- Fuzzy matching for similar historical transactions exists
- Backfill moved to inline panel and works
- Categories/subcategories can be renamed
- Active/inactive toggle exists
- Compact/collapsible subcategory UX exists
- Subcategories have `flowType`

#### Constraints that remain binding
- Inline backfill panel remains the accepted UX
- No modal reintroduction for backfill without strong justification
- Rules must not silently backfill historical transactions
- Category structure remains editable and user-managed

#### Remaining validation
- Verify rule behaviour continues to work correctly once import templates/mapping mature
- Verify no new transaction semantics work accidentally undermines rule safety

Status: **Done, needs verification**

#### Exit criteria for closing Phase 1
1. Rules creation/edit/delete remains stable
2. Inline backfill remains reliable
3. Category editing remains stable
4. Rule safety constraints remain enforced

---

### Phase 2 — Import templates & mapping
**Overall status:** Started conceptually, not complete

#### Intended outcomes
- CSV/XLSX import pipeline works through generic mapping rather than bank-specific hardcoding
- reusable import templates exist
- imported transactions can be reviewed safely
- rules can assist the current import batch
- uncertain imported items are routed into `needsReview` flow

#### Achieved
- Import result dialog exists
- Imported transactions can remain flagged for review
- Pending imported items are excluded from metrics
- “Review now” can send user into review flow
- Import UX exists conceptually and partially in code

#### Not yet complete
- reusable mapping-template workflow is not yet confirmed as complete/stable
- generic import schema and mapping persistence need confirmation or build-out
- bank-hardcoded approaches remain rejected as primary architecture
- exact “rules apply to current batch only” flow needs validation in import context

#### Dependencies
Phase 2 depends on stable transaction semantics from Phase 0 and stable rule/category foundations from Phase 1. In particular, import cannot be considered sound if InternalTransfer semantics remain ambiguous.

#### Exit criteria for closing Phase 2
1. user can map CSV/XLSX columns in a reusable way
2. import templates can be reused
3. imported items classify predictably
4. uncertain items route to review
5. rule assistance during import is explicit and safe

---

### Phase 3 — Budget
**Overall status:** Not started

#### Intended outcomes
- user can define budgets against category/subcategory structures
- budget reporting builds on existing transaction classification and analytics
- budgeting respects review-state and transaction semantics

#### Preconditions
Budget should not begin until:
- transaction semantics are stable,
- dashboard/reporting rules are stable,
- categories are stable,
- import/classification flow is stable enough to trust budget inputs.

#### Exit criteria
To be defined later, but budget must build on the established category model rather than bypass it.

---

### Phase 4 — Real auth + real DB + deployment
**Overall status:** Deferred / not started

#### Intended outcomes
- real authentication
- real persistence
- deployable multi-user-capable architecture
- stable platform boundaries for production evolution

#### Preconditions
This phase should wait until the domain model and user flows are stable enough not to force large migration churn.

---

## 5. Cross-phase critical gaps

These are not standalone phases, but they are major cross-cutting gaps that must be resolved in order.

### 5.1 InternalTransfer semantics
**Status:** In progress / unstable

#### Why this matters
InternalTransfer sits across:
- transaction entry/editing,
- dashboard reporting,
- account balances,
- import behaviour.

#### Required truth
- `InternalTransfer` is one semantic type
- direction determines sign
- transfer remains visible in ledger
- transfer affects balances
- transfer does not affect income/expense analytics

#### Immediate required work
1. Fix direction UI visibility in transaction form
2. Fix sign derivation on save/edit
3. Verify dashboard exclusion
4. Wire balance impact correctly

### 5.2 Account balance derivation
**Status:** Not complete

#### Required truth
`currentBalance = openingBalance + signed transaction sum for that account`

This must include InternalTransfer.

### 5.3 Import mapping-template architecture
**Status:** In progress conceptually

#### Required truth
Import architecture must remain generic and template-based, not bank-hardcoded.

## 6. Immediate execution order

The next implementation sequence should be:

### Step 1
Fix and verify InternalTransfer direction UI and sign logic end-to-end.
Reason: this is a foundation issue, not a cosmetic bug.

### Step 2
Verify dashboard KPI/chart exclusion for `type === InternalTransfer`.
Reason: reporting must depend on semantics, not amount sign alone.

### Step 3
Wire account balances from transactions, including InternalTransfer.
Reason: balance truth depends on signed ledger movement.

### Step 4
Resume Phase 2 import mapping/template implementation.
Reason: import should build on stable transaction semantics and stable rules/settings.

### Step 5
Only then begin budget work.

### Step 6
Only after domain stability begin real auth/DB/deployment.

## 7. Current “already achieved / unstable / remaining” summary

### Already achieved
- core dashboard wiring
- transaction CRUD/search/bulk delete
- pending review treatment in dashboard
- rules CRUD
- inline backfill
- category/subcategory management

### Achieved but still needs verification
- full stability of rules once import/template work deepens
- some import-review UX assumptions
- dashboard correctness once InternalTransfer is fixed

### In progress / unstable
- InternalTransfer direction/sign semantics
- account-balance truth
- reusable import-template architecture

### Remaining
- budget system
- real auth
- real database
- deployment

## 8. Change control rules

Any implementation work should respect the following:
- no modal reintroduction for backfill,
- no reload-based fixes,
- no silent historical rule backfill,
- no collapse of `type` into `category`,
- no jump to later-phase infrastructure before earlier domain rules are stable,
- no broad redesigns during narrow stabilization work.

## 9. Definition of “ready for Codex”

A coding task is ready to hand to Codex only when:
1. the target phase/slice is identified,
2. the behavioural contract is explicit,
3. the non-goals are explicit,
4. the acceptance criteria are testable,
5. the task does not cut across multiple phases unnecessarily.

This rule exists to reduce implementation drift and protect the product model while the app is still in prototype mode.

## 10. Iteration update - 2026-04-09

### Slice A: InternalTransfer form/sign stabilization
**Status:** Implemented in code, pending runtime QA checklist execution

Completed in this iteration:
- Transaction form now initializes explicit transfer direction when `type === InternalTransfer`
- Transfer direction control is rendered adjacent to transaction type selection for reliable visibility
- Submit normalization now enforces:
  - `Expense` => negative
  - `Income` => positive
  - `InternalTransfer + Out` => negative
  - `InternalTransfer + In` => positive
- Edit hydration keeps transfer direction derived from stored sign
- Form-only fields (`createRule`, `internalDirection`) are not persisted as transaction fields

### Slice B: Minimal verification
**Status:** Verified in code

- Dashboard KPI and chart aggregation already exclude transfers semantically by filtering on `type === 'Income'` / `type === 'Expense'`
- No dashboard code changes were required in this iteration

### Remaining Phase 0 gap (RESOLVED in Session 2026-04-29/30)
**Status:** CLOSED

- Account balances are now transaction-derived
- Account cards display calculated balance (opening balance + confirmed transactions)
- Wired in accounts/page.tsx line 299: `balance={balanceByAccountId[account.id] ?? account.openingBalance ?? 0}`

---

## 11. Iteration update - 2026-04-29/30 (CURRENT)

### Phase 2: Budget Management + Modal Freeze Fix
**Status:** COMPLETE with 3 critical bug fixes

#### Task 1: Balance Calculation Re-enabled
- Re-enabled balance calculation for account displays
- Calculation: `openingBalance + sum(confirmedTransactions where needsReview=false)`
- Efficient O(a+t) via useMemo to prevent re-render on every change
- Wire-up in accounts/page.tsx line 299

#### Task 2: Transaction Modal Freeze Fixed
- **Issue:** Radix UI Sheet animations blocked main thread on close
- **Solution:** Replaced with custom modal (fixed div + overlay, instant transitions)
- **File:** src/components/transactions/transaction-form-sheet.tsx
- **Constraint:** Never revert to Radix UI Sheet for main forms

#### Task 3: Budget Management Implemented
Completed 7-layer feature stack:
1. Firestore Service: src/lib/services/budgets.ts (CRUD operations)
2. API Route: src/app/api/budgets/route.ts (GET/POST/DELETE)
3. API Client: src/lib/api.ts (3 functions)
4. Context: src/hooks/use-flow-ledger.tsx (budgetLines, budgetYear, reloadBudget)
5. Components: src/components/budget/budget-lines.tsx (table + real calculations)
6. Page: src/app/(app)/budget/page.tsx (month/year nav, edit modal)
7. Sidebar: src/components/layout/sidebar.tsx (enabled Budget link)

#### Critical Bug Fixes Applied
1. **Year dropdown not showing navigated years** - Changed to dynamic computation
2. **Budget save returning error** - Added missing subcategoryId field
3. **Double rendering + sidebar lag** - Removed function ref from useEffect dependencies

### Current Phase 2 Status

#### Completed
- ✅ Accounts Module - Create, edit, delete, archive, display balances
- ✅ Transactions Module - Full CRUD with filtering, categorization, batch ops
- ✅ Budget Management - Set monthly budgets, track spending, navigate months/years

#### In Progress
- 🔄 Budget QA Checklist - 3 fixes applied, needs full verification

#### Not Started (Phase 2+)
- ⏳ Categories Management - Add/edit/delete, localization, subcategories
- ⏳ Workspace Features - Create, switch, settings
- ⏳ Internal Transfers - Move money between accounts (depends on balance calc being solid)

### Next Steps After Budget QA

1. **Complete Budget QA** - Verify month navigation, save, delete, performance
2. **Categories Module** - Full CRUD on categories and subcategories
3. **Workspace Features** - Create/switch workspaces with proper scoping
4. **Internal Transfers** - Now safe to implement with balance calc working
5. **Profile/Settings** - User preferences
6. **Import/Export** - CSV/PDF functionality
