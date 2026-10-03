# FlowLedger - Decision Log

## Implementation Decisions (Locked)

### State Management Architecture
**Decision:** Use React Context API only, no Redux/Zustand
**Locked:** YES
**Rationale:** Simpler for MVP, sufficient for current scope. User explicitly requested this.
**Constraints:** 
- All global state flows through FlowLedgerProvider
- Context value must be memoized to prevent unnecessary re-renders
- Callback functions MUST NOT be included in useMemo dependencies (causes infinite loops)

### Modal Implementation for Forms
**Decision:** Use custom HTML modal (fixed div + overlay) instead of Radix UI Sheet
**Locked:** YES (CRITICAL)
**Rationale:** Radix UI Sheet modal animations were blocking main thread on close, causing UI freeze. Custom modal has zero animations, appears/disappears instantly, and is responsive.
**Constraints:**
- No animation library for modals
- Modal must appear with instant transition (no CSS animation)
- Never revert to Radix UI Sheet for main user forms

### Form Management
**Decision:** Use react-hook-form + Zod validation
**Locked:** YES
**Rationale:** Lightweight, type-safe, good developer experience
**Constraints:**
- All forms must have Zod schemas in `lib/schemas.ts`
- Form must reset with `form.reset()` when opening for creation/editing
- Form pre-fill must use useEffect with form.reset() on dependency changes

### Toast/Notification System
**Decision:** Custom implementation using global listener pattern, not external library
**Locked:** YES
**Rationale:** Lightweight, avoids dependency bloat, fits with custom modal approach
**Constraints:**
- Toast function must be stable (use useRef to maintain reference)
- Do NOT add external toast library
- Toast system is in `src/hooks/use-toast.ts`

### Account Balance Calculation
**Decision:** Calculate on client: `openingBalance + sum(confirmedTransactions)`
**Status:** RE-ENABLED (Session 2026-04-29)
**Rationale:** Efficient O(a+t) calculation via useMemo. Balances now show actual account total.
**Implementation:** 
- Accounts page uses `balanceByAccountId[account.id]` memoized calculation
- Filters only transactions where needsReview=false (confirmed)
- Falls back to opening balance if no transactions exist
**Constraints:**
- Balance calculation must happen in useMemo to prevent recalculation on every render
- Only includes confirmed transactions (needsReview=false)
- Consider moving to server if performance becomes bottleneck with large datasets

### Context Memoization Strategy
**Decision:** Memoize context value, but exclude callback functions from dependencies
**Locked:** YES (CRITICAL FIX)
**Rationale:** Callback dependencies caused infinite re-render loops. Only data should trigger context updates.
**Implementation Note:** See MASTER_BRIEF.md for exact pattern

### Error Handling
**Decision:** Errors propagate to form's catch block, form stays open on error
**Locked:** YES
**Rationale:** User can see error message and correct their input

### Account Filtering
**Decision:** Filter archived accounts on display time: `accounts.filter(a => !a.archived)`
**Locked:** YES
**Rationale:** Simple, allows recovery if needed

## Rejected Alternatives

### Modal Implementations
**Rejected:** Radix UI Sheet - Animations blocked main thread on close
**Rejected:** Radix UI Dialog - Doesn't support sliding panel UX
**Rejected:** Next.js Intercepting Routes - Adds complexity, doesn't solve animation issue

### State Management
**Rejected:** Redux - Overkill for MVP, adds complexity
**Rejected:** Zustand - User chose Context API
**Rejected:** SWR/TanStack Query - Adds complexity for current phase

### Form Library
**Rejected:** Formik - react-hook-form is lighter and more modern

### Data Calculation
**Rejected:** Server-side balance calculation - Would require API change
**Rejected:** Real-time WebSocket updates - Overkill for MVP

## UX Constraints (Must Preserve)

1. **Modal appears instantly** - No animation delay
2. **Form pre-fills when editing** - useEffect + form.reset() pattern
3. **Cancel closes form without saving** - User expects this
4. **Clicking outside doesn't close** - Prevents accidental closes
5. **Validation errors inline** - Show under each field
6. **Success/error toasts** - User feedback on action completion
7. **Archive vs Delete** - Two separate actions, archive doesn't lose data

## Data Constraints (Must Preserve)

### Required Fields
- Account name (string, required)
- Account type (enum)
- Currency (EUR/USD/GBP only)
- Institution (string, required)
- Opening balance (number, can be negative)

### Workspace Segregation
- All data is workspace-scoped
- workspaceId required on all API calls
- Default workspace: 'ws1'

### Balance Calculation
`openingBalance + sum(tx.amountBase where tx.needsReview === false)`

## Critical No-Touch Zones

1. Context memoization pattern (prevents re-render loops)
2. Custom modal implementation (no animations, prevents freeze)
3. Form pre-fill useEffect pattern (working solution)
4. Toast system architecture (custom, lightweight)
5. API call pattern (lib/api.ts)
6. Zod schema location (lib/schemas.ts)

## Questions for Next Session

1. Re-enable balance calculation? (Currently disabled)
2. What's actual transaction volume? (Affects feasibility of client-side calc)
3. Soft-delete or permanent deletion for accounts?
4. How should category localization work? (Phase 2)
5. Internal transfers: one transaction or two? (Phase 2)
