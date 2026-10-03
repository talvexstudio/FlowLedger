# FlowLedger - Next Session Prompt

## Context
This is a personal finance app (FlowLedger) built with Next.js 15, React 19, and Firebase.

**Current Status (2026-04-30):** Phase 2 substantially complete. Balance calculation re-enabled, transaction modal freeze fixed, budget management implemented with 3 critical bug fixes applied. Pending: full QA checklist on budget feature.

## What Was Just Completed in This Session

### 1. Balance Calculation Re-enabled
- Wired up memoized calculation to account cards
- Calculation: `openingBalance + sum(confirmedTransactions where needsReview=false)`
- File: src/app/(app)/accounts/page.tsx line 299
- Status: Working

### 2. Transaction Modal Freeze Fixed
- Replaced Radix UI Sheet with custom modal (fixed div + overlay)
- Instant appear/disappear, no animations blocking main thread
- File: src/components/transactions/transaction-form-sheet.tsx (complete refactor)
- Status: Working

### 3. Budget Management Implemented (7-layer feature)
1. Firestore Service: src/lib/services/budgets.ts
2. API Route: src/app/api/budgets/route.ts
3. API Client: src/lib/api.ts (3 new functions)
4. Context: src/hooks/use-flow-ledger.tsx (budgetLines, budgetYear, reloadBudget)
5. UI Components: src/components/budget/budget-lines.tsx (real calculations)
6. Page: src/app/(app)/budget/page.tsx (month/year nav, edit modal)
7. Sidebar: src/components/layout/sidebar.tsx (enabled Budget link)

### 4. Critical Bug Fixes Applied
- **Bug 1:** Year dropdown not showing navigated years - Fixed with dynamic year computation
- **Bug 2:** Budget save returning error - Added missing subcategoryId field
- **Bug 3:** Double rendering and sidebar lag - Removed function refs from useEffect dependencies

## Current Implementation State

### Fully Working
- ✅ Account CRUD (create, edit, delete, archive)
- ✅ Account balances (calculated from transactions)
- ✅ Transaction CRUD with categorization
- ✅ Budget management (set monthly budgets, track spending)
- ✅ Month/year navigation with wrapping
- ✅ Form validation (react-hook-form + Zod)
- ✅ Toast notifications
- ✅ Custom modal (no animations)
- ✅ Context-based state management

### Pending
- 🔄 Budget QA Checklist (3 fixes applied, needs full verification)

### Not Started (Phase 2+)
- ⏳ Categories Module - Full management
- ⏳ Workspace Features - Create/switch
- ⏳ Internal Transfers - Move money between accounts
- ⏳ Profile/Settings - User preferences
- ⏳ Import/Export - CSV/PDF

## Critical Constraints (Do Not Change)
1. **React Context only** - No Redux/Zustand
2. **Custom modal, never Radix Sheet** - Sheet animations cause freeze
3. **Context memoization** - Callbacks excluded from useMemo dependencies
4. **No external toast library** - Custom in src/hooks/use-toast.ts
5. **react-hook-form + Zod** - All forms, schemas in lib/schemas.ts
6. **Next.js 15 + Turbopack** - Don't change build/framework
7. **No modal animations** - Instant appear/disappear only
8. **Balance calc logic** - Only includes confirmed (needsReview=false) transactions

## IMMEDIATE TASK: Budget QA Checklist

Run the full QA checklist below to verify all 3 bug fixes work correctly:

### QA Checklist for Budget Feature

#### 1. Month Navigation
- [ ] Navigate backward from January 2026 to November 2025 (year should wrap to 2025)
- [ ] Navigate forward from December 2025 to January 2026 (year should wrap to 2026)
- [ ] Year dropdown shows all navigated years (including 2024, 2025, 2026, 2027)

#### 2. Budget Save and Persistence
- [ ] Click Edit on a budget category row
- [ ] Enter amount like 500.00
- [ ] Click Save (shows "Saving..." then success toast)
- [ ] Modal closes, row updates with new budget
- [ ] Refresh page, budget value persists

#### 3. Spending Calculation
- [ ] Progress bar shows correct percentage: (spent / budget) × 100
- [ ] "Spent" column matches sum of transactions for category in selected month
- [ ] "Remaining" shows budget - spent (negative when overspent, shows in red)
- [ ] Progress bar turns red when remaining < 0

#### 4. Delete Functionality
- [ ] Delete icon appears only on rows with existing budget
- [ ] Click Delete, toast confirms removal
- [ ] Row reverts to "No budget set" state
- [ ] Refresh confirms deletion persists

#### 5. Performance
- [ ] Month navigation is smooth (no lag, no double renders)
- [ ] Sidebar links work immediately
- [ ] No console errors or warnings

If any checklist item fails, investigate and report the issue.
If all pass, proceed to next Phase 2 feature: Categories Module.

## Architecture Overview

### State Management Pattern
```typescript
// Context provider (src/hooks/use-flow-ledger.tsx)
const contextValue = useMemo(() => ({
  // data
  budgetLines, budgetYear, accounts, transactions, categories,
  // callbacks (NOT in dependencies)
  reloadBudget, reloadAccounts, reloadTransactions,
}), [budgetLines, budgetYear, accounts, transactions, categories]);
// Note: NO reloadBudget in dependencies!
```

### Month Navigation Pattern
```typescript
const handlePrevMonth = () => {
  setSelectedMonth(m => {
    if (m === 0) { setSelectedYear(y => y - 1); return 11; }
    return m - 1;
  });
};

useEffect(() => {
  reloadBudget(selectedYear);
}, [selectedYear]); // Only depend on selectedYear, not function!
```

### Modal Pattern
```typescript
{editModal?.open && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-6">
      {/* form content */}
    </div>
  </div>
)}
```

## Known Issues (Low Priority)
1. Hydration mismatch warnings in console (Radix UI server/client ID differences)
2. Budget performance untested with large datasets (defer until real data volume known)

## Files Modified This Session
1. src/app/(app)/accounts/page.tsx (line 299)
2. src/components/transactions/transaction-form-sheet.tsx (complete refactor)
3. src/lib/services/budgets.ts (NEW)
4. src/app/api/budgets/route.ts (NEW)
5. src/lib/api.ts (3 new functions)
6. src/hooks/use-flow-ledger.tsx (budget integration)
7. src/components/budget/budget-lines.tsx (complete rewrite)
8. src/app/(app)/budget/page.tsx (complete rewrite)
9. src/components/layout/sidebar.tsx (enabled Budget link)

## Documentation Files
- **MASTER_BRIEF.md** - Project overview, features, architecture
- **DECISION_LOG.md** - Locked decisions, constraints, rejected alternatives
- **CLAUDE.md** - User preferences (no em dashes, ask before coding, etc.)
- **HANDOVER.md** - What was completed, current state, next steps
- **IMPLEMENTATION_PLAN.md** - Remaining Phase 2 work in priority order
- **NEXT_PROMPT.md** - This file

## How to Continue

1. **First action:** Run the Budget QA Checklist above
2. **If all pass:** Proceed to Categories Module (Phase 2 next feature)
3. **If any fails:** Debug, fix, and re-run until all pass

## When Adding Features
1. Create page at src/app/(app)/[feature]/page.tsx
2. Add types to src/lib/types.ts
3. Add Zod schema to src/lib/schemas.ts (if form needed)
4. Add API functions to src/lib/api.ts (if backend call needed)
5. Add Firestore service to src/lib/services/[feature].ts
6. Add API route to src/app/api/[feature]/route.ts
7. Use custom modal pattern (NO Radix Sheet)
8. Use useFlowLedger hook for state access
9. Wire into context provider if data is global

## Testing After Implementation
- Verify no modal freezes on open/close
- Verify forms pre-fill correctly when editing
- Verify validation messages appear inline
- Verify success/error toasts appear
- Verify no console warnings about main thread blocks (> 200ms)
- Verify sidebar links responsive

## Files To Know
- **State:** src/hooks/use-flow-ledger.tsx
- **API client:** src/lib/api.ts
- **Form schemas:** src/lib/schemas.ts
- **Data types:** src/lib/types.ts
- **Firestore services:** src/lib/services/*.ts
- **Decisions:** DECISION_LOG.md
