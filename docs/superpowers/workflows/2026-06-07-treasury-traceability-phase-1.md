# Workflow — Tesorería Trazabilidad Fase 1

**Spec:** `docs/superpowers/audits/2026-06-07-treasury-traceability-audit.md`
**Scope:** 4 gaps críticos + 1 importante de la auditoría (C1, C2, C3, C4, I8).
**Estrategia:** una sola tabla `TreasuryAuditLog` (polimórfica) para cubrir Transaction, Transfer, Account, Payable. Audit logs existentes (ExpenseAuditLog, VehicleAuditLog) se mantienen sin cambios.

## Pasos (TDD por cada uno; commit por paso)

| # | Tarea | Files | Test primero | Esfuerzo |
|---|---|---|---|---|
| 1 | Migración Prisma: `TreasuryAuditLog` + `Transaction.reversesTransactionId` | `backend/prisma/schema.prisma` + nueva migration | n/a | S |
| 2 | Helper compartido `writeTreasuryAudit(tx, {...})` | `backend/src/utils/treasuryAudit.js` (nuevo) | unit | S |
| 3 | `transactionService.delete`: pedir `reason`, escribir audit, hard delete después | `transactionService.js`, `validation.js`, `treasury.js` (route) | e2e | M |
| 4 | `transferService.delete`: pedir `reason`, escribir audit | `transferService.js`, `validation.js`, `treasury.js` | e2e | M |
| 5 | `accountService.update`: escribir audit con before/after | `accountService.js` | e2e | S |
| 6 | `expenseService` ADJUSTMENT/REVERSAL: poblar `reversesTransactionId` | `expenseService.js` | e2e | S |
| 7 | `expenseService.update`: `reason` obligatorio si cambia amount/accountId/category | `expenseService.js`, `validation.js` | e2e | S |
| 8 | `payableService.cancel`: pedir `reason`, audit | `payableService.js`, `validation.js`, `payables.js` | e2e | S |
| 9 | `payableService.addPayment`: audit (sin reason; el evento es "se hizo pago") | `payableService.js` | e2e | S |
| 10 | Regresión completa + PR | full suite | n/a | n/a |

## Convenciones del audit log

```
TreasuryAuditLog
  id           cuid
  entityType   "TRANSACTION" | "TRANSFER" | "ACCOUNT" | "PAYABLE" | "PAYABLE_PAYMENT"
  entityId     cuid de la entidad afectada
  userId       FK User
  action       "CREATE" | "UPDATE" | "DELETE" | "CANCEL" | "PAYMENT"
  before       Json? (snapshot pre-mutación; null en CREATE)
  after        Json? (snapshot post-mutación; null en DELETE/CANCEL)
  reason       String? (required en DELETE / CANCEL; opcional en UPDATE)
  createdAt    DateTime default(now())
```

## Out of scope (queda para fases siguientes)

- Soft delete de Transaction y Transfer (Fase 2)
- `humanId` legible (C5) — Fase 2
- UI de auditoría para Transactions/Transfers (I6) — Fase 2
- Loan / LoanPayment audit (I4) — Fase 2
- Conciliación bancaria, period close, cash count adjust — Fase 3+

## Verificación final

- [ ] `npx playwright test` — full e2e green
- [ ] `node --test src/utils/__tests__` — unit green
- [ ] Manual smoke: borrar una transaction manual → ver audit log en DB
- [ ] Manual smoke: editar `Account.initialBalance` → ver audit log
- [ ] PR contra `main` con squash
