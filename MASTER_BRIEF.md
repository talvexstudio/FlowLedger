# FlowLedger - Master Project Brief

## Project Overview
FlowLedger is a personal finance application built with Next.js 15 and React 19. It allows users to manage multiple financial accounts, track transactions, set budgets, and view their financial overview.

## Current Implementation State
**Status:** Phase 2 in progress. Balance calculation re-enabled, transactions modal freeze fixed, budget management fully implemented (in final testing).

**Session Summary (2026-04-29/30):**
1. Re-enabled balance calculation for accounts (opening balance + confirmed transactions)
2. Fixed transaction modal freeze by replacing Radix UI Sheet with custom modal
3. Implemented full budget management feature (7 layers: Firestore service, API route, API client, context integration, UI components)
4. Applied 3 critical bug fixes to budget feature (dynamic year options, subcategoryId fix, reduce unnecessary renders)

## Architecture & Stack

### Frontend Stack
- **Framework:** Next.js 15 (Turbopack)
- **Runtime:** React 19
- **Language:** TypeScript
- **State Management:** React Context API (FlowLedgerProvider)
- **Forms:** react-hook-form + Zod validation
- **UI Components:** shadcn/ui-based custom components
- **Styling:** Tailwind CSS
- **Icons:** lucide-react
- **Dev Server:** Turbopack (port 3001 by default)

### Backend
- Firebase (implicit from API calls)
- REST endpoints: `/api/accounts`, `/api/transactions`, `/api/categories`, `/api/workspaces`

### Project Structure
```
src/
├── app/(app)/
│   ├── accounts/page.tsx          (Account management - RECENTLY REFACTORED)
│   ├── dashboard/page.tsx         (Stub)
│   ├── transactions/page.tsx      (Stub)
│   ├── budget/page.tsx            (Stub)
│   └── import/page.tsx            (Stub)
├── components/
│   ├── accounts/
│   │   ├── account-card.tsx
│   │   └── account-form-sheet.tsx (Deprecated - replaced with inline modal)
│   ├── ui/
│   │   └── [shadcn components]
│   └── layout/
│       └── [header, sidebar, etc.]
├── hooks/
│   ├── use-flow-ledger.tsx        (Context hook & provider - RECENTLY MODIFIED)
│   └── use-toast.ts              (Toast system)
├── lib/
│   ├── api.ts                     (API client functions)
│   ├── types.ts                   (TypeScript types)
│   └── schemas.ts                 (Zod validation schemas)
└── config/
    └── [config files]
```

## Completed Features

### Accounts Module (Complete)
- ✅ Create new accounts
- ✅ Edit existing accounts (with pre-filled values)
- ✅ Delete accounts
- ✅ Archive accounts
- ✅ Display account balances (opening balance + confirmed transactions, re-enabled)
- ✅ Form validation (name, type, currency, institution, opening balance)
- ✅ Custom modal form for account creation/editing (no animations, prevents freeze)
- ✅ Toast notifications for success/error states
- ✅ Account cards displaying account info in grid layout

### Transactions Module (Complete)
- ✅ View transactions in data table with pagination
- ✅ Create transactions with form validation
- ✅ Edit/delete transactions
- ✅ Transaction categorization and subcategories
- ✅ Transaction filtering (account, category, date range, search)
- ✅ Batch operations (multi-select, bulk delete)
- ✅ Custom modal form (replaced Radix UI Sheet, no animation freeze)
- ✅ Classification rules with backfill suggestions
- ✅ Pending review status indicators

### Budget Management Module (Complete, in final testing)
- ✅ Set monthly budgets per category
- ✅ View spending vs budget with progress bars
- ✅ Month navigation (left/right arrows with year boundary handling)
- ✅ Year selection (dynamic options for navigated years)
- ✅ Real-time spending calculation from transactions
- ✅ Custom modal for budget amount editing
- ✅ Delete budget lines
- ✅ Firestore persistence (Budget and BudgetLine documents)
- ✅ Context integration (budgetLines, budgetYear, reloadBudget)
- ✅ Sidebar menu link enabled

### State Management
- ✅ FlowLedgerProvider manages: workspaces, accounts, transactions, categories, budgetLines, budgetYear
- ✅ useFlowLedger hook for consuming context
- ✅ Proper dependency management to prevent infinite re-render loops
- ✅ Toast notification system with custom implementation

## Incomplete Features (Phase 2+)

### Categories Module (Partial)
- ⏳ Category management
- ⏳ Category localization (multi-language)
- ⏳ Subcategories

### Workspace Features
- ⏳ Create workspaces
- ⏳ Switch between workspaces
- ⏳ Workspace settings

### Account Features
- ⏳ Internal transfers between accounts
- ⏳ Account reconciliation

### Other
- ⏳ Profile/settings page
- ⏳ Import functionality
- ⏳ Export to CSV/PDF

## Known Issues & Uncertainties

### RESOLVED (Session 2026-04-29/30)
1. ✅ **Balance calculation disabled** - Re-enabled balance calculation (opening balance + confirmed transactions). Efficient O(a+t) calculation via useMemo.
2. ✅ **Transaction modal freeze** - Replaced Radix UI Sheet with custom modal in transaction-form-sheet.tsx (no animations, prevents UI freeze).
3. ✅ **Budget year navigation** - Fixed dynamic year options so navigated years appear in dropdown (was showing only 2025-2027).
4. ✅ **Budget save failure** - Added missing subcategoryId field to BudgetLine save payload.
5. ✅ **Budget rendering lag** - Removed unnecessary useEffect dependencies to prevent cascading updates.

### Current Low-Priority Issues
1. ⚠️ **Hydration mismatch warnings** - Radix UI components generate different IDs on server vs client. Not blocking functionality, but visible in console.
2. ⚠️ **Budget feature in QA** - Final testing phase with 3 critical bug fixes applied. Need to verify all QA checklist items pass.

### Uncertainties
- Total transaction count in database unknown (need to measure performance with real data)
- Budget feature performance with many categories/transactions
- Optimal budget reload strategy for year navigation

## Critical Constraints to Preserve

### Must Keep
1. **No Redux/Zustand** - Use React Context API only
2. **Next.js 15 with Turbopack** - Don't downgrade or change build tool
3. **React 19** - Maintain compatibility
4. **Custom modal** - Never revert to Radix UI Sheet for main forms (causes freeze)
5. **Context memoization strategy** - Callbacks CANNOT be in useMemo dependencies
6. **Form pre-fill pattern** - Use useEffect with form.reset() when editing
7. **Toast system** - Custom implementation, don't integrate external library

### Architecture Constraints
1. API calls must use the functions in `lib/api.ts`
2. State updates from API responses must go through context setters
3. Form validation must use Zod schemas from `lib/schemas.ts`
4. All reusable components should go in `components/ui/`
5. Page components should be "use client" for hooks usage

## Files Recently Modified (Session 2026-04-29/30)

1. **src/app/(app)/accounts/page.tsx**
   - Re-enabled balance calculation (line 299: use balanceByAccountId instead of hardcoded opening balance)

2. **src/components/transactions/transaction-form-sheet.tsx**
   - Replaced Radix UI Sheet component with custom modal (fixed animation freeze)
   - Removed Sheet imports (lines 8-16)
   - Added custom fixed position modal with dark overlay (no animations)
   - Updated footer buttons styling to match custom modal pattern

3. **src/lib/services/budgets.ts** (NEW)
   - Firestore service for budget CRUD operations
   - getBudget, ensureBudget, saveBudgetLine, deleteBudgetLine functions

4. **src/app/api/budgets/route.ts** (NEW)
   - API route for budget operations (GET, POST, DELETE)
   - Handles budget line save/delete with workspace scoping

5. **src/lib/api.ts**
   - Added Budget, BudgetLine type imports
   - Added 3 new API client functions: apiGetBudget, apiSaveBudgetLine, apiDeleteBudgetLine

6. **src/hooks/use-flow-ledger.tsx**
   - Added budgetLines and budgetYear state
   - Added reloadBudget callback
   - Added fetchBudget to initial data load
   - Updated context type and value to expose budget data

7. **src/components/budget/budget-lines.tsx** (COMPLETE REWRITE)
   - Replaced mock data with real transaction spending calculation
   - Shows progress bars for spent vs budget
   - Added edit/delete action buttons per row
   - Filters by month/year, calculates spending real-time

8. **src/app/(app)/budget/page.tsx** (COMPLETE REWRITE)
   - Added 'use client' directive
   - Implemented month/year navigation with wrapping at year boundaries
   - Dynamic year dropdown (shows navigated years, not just current +/- 1)
   - Custom modal for editing budget amounts
   - Integrated with context for real data
   - Applied 3 bug fixes: dynamic yearOptions, subcategoryId field, reduced useEffect deps

9. **src/components/layout/sidebar.tsx**
   - Removed disabled flag from Budget menu item (now clickable)

## Performance Characteristics

- Account grid renders 8-9 account cards per page
- Balance calculation loops through all accounts and transactions (currently disabled)
- Context provider memoization prevents unnecessary re-renders of consumer components
- No animations on modal open/close (instant, prevents main thread blocking)

## Next Steps (Priority Order)

### Immediate (Finish Phase 2)
1. **Complete budget feature QA** - Verify all checklist items pass with applied bug fixes
2. **Category system** - Add/edit/delete categories, subcategories, localization
3. **Workspace features** - Create workspaces, switch between workspaces
4. **Internal transfers** - Move money between accounts

### Phase 2 Polish
1. **Performance testing** - Test with real data volume
2. **Fix hydration mismatch warnings** - Make Radix UI components server-safe (low priority)
3. **Mobile responsiveness** - Ensure budget/transaction pages work on mobile

### Phase 3 (Future)
1. **Profile/settings page** - User preferences
2. **Import/export** - CSV/PDF exports
3. **Advanced filtering and reporting**
4. **Offline support** - Service worker caching

### Phase 3+ (Future)
- Import/export
- Advanced filtering and reporting
- Mobile optimization
- Offline support
- Data export (CSV, PDF)

## Key Files to Know

- **API client:** `src/lib/api.ts` - All backend calls
- **Types:** `src/lib/types.ts` - TypeScript interfaces
- **Validation:** `src/lib/schemas.ts` - Zod schemas for all forms
- **Context:** `src/hooks/use-flow-ledger.tsx` - Global state
- **Toast:** `src/hooks/use-toast.ts` - Notifications
