# HANDOVER

## Iteration: 2026-04-09

### Scope
- Slice A: stabilize `InternalTransfer` form direction/sign semantics end-to-end for create/edit
- Slice B (minimal): verify dashboard exclusion semantics for `InternalTransfer`

### Files changed in this iteration
- `src/components/transactions/transaction-form-sheet.tsx`
- `IMPLEMENTATION_PLAN.md`
- `DECISION_LOG.md`
- `HANDOVER.md`

### What was changed
- Added explicit `internalDirection` initialization when transaction `type` becomes `InternalTransfer`
- Moved transfer direction UI to render immediately after the Type field for reliable visibility
- Normalized submit sign contract in form:
  - `Expense` => negative
  - `Income` => positive
  - `InternalTransfer + Out` => negative
  - `InternalTransfer + In` => positive
- Preserved edit hydration rule:
  - negative transfer preselects `Out`
  - positive transfer preselects `In`
- Prevented form-only fields from being saved into transaction records:
  - `createRule`
  - `internalDirection`

### Verification notes
- Dashboard KPIs/charts already rely on semantic type filters (`Income` and `Expense`) and therefore exclude `InternalTransfer`
- No dashboard code change was needed in this iteration

### Open gaps
- Account balances are still not transaction-derived in UI
- `src/components/accounts/account-card.tsx` still uses mock/randomized balance values

### Suggested next slice
- Implement transaction-derived account balance helper and wire account cards to:
  - `openingBalance + sum(signed transactions for account)`
  - include signed `InternalTransfer`
