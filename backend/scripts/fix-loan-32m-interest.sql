-- ═══════════════════════════════════════════════════════════════
-- Corrección puntual: préstamo de 32.000.000 sin interés registrado
-- ═══════════════════════════════════════════════════════════════
--
-- Contexto: el préstamo cmq5zk1xt003cnr1rszkalhyu se creó el 2026-06-09,
-- ANTES de la feature de tasa de interés (migración 20260612172757_loan_interest),
-- por lo que quedó con interestRate=0 e interestAmount=0 (valores por defecto).
-- El acuerdo real era 32.000.000 al 10% => interés 3.200.000, total a devolver
-- 35.200.000.
--
-- Esta corrección:
--   1. Setea interestRate=10 e interestAmount=3.200.000 en el préstamo.
--   2. Suma el interés a la cuota 4 (8.000.000 -> 11.200.000), de modo que las
--      cuotas vuelvan a sumar el total a devolver (35.200.000). Las cuotas 1-3
--      ya pagadas (8M c/u) no se tocan; la 4 sigue PARTIAL (pagado 4.300.000).
--
-- NO modifica loan_payments, paidAmount ni interestReceived: los pagos son
-- correctos y se mantienen. El saldo pendiente pasa a 35.200.000 - 28.300.000
-- = 6.900.000.
--
-- Idempotente: los guards (interestAmount=0 / plannedAmount=8000000) evitan
-- que una segunda ejecución vuelva a aplicar los cambios.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

UPDATE loans
SET "interestRate" = 10,
    "interestAmount" = 3200000
WHERE id = 'cmq5zk1xt003cnr1rszkalhyu'
  AND "interestAmount" = 0;

UPDATE loan_installments
SET "plannedAmount" = 11200000
WHERE "loanId" = 'cmq5zk1xt003cnr1rszkalhyu'
  AND sequence = 4
  AND "plannedAmount" = 8000000;

-- Verificación: debe mostrar tasa 10, interés 3.200.000, total 35.200.000,
-- saldo 6.900.000 y suma de cuotas 35.200.000.
SELECT l."interestRate",
       l."interestAmount",
       l."principalAmount" + l."interestAmount"                     AS total_a_devolver,
       l."principalAmount" + l."interestAmount" - l."paidAmount"    AS saldo_pendiente,
       (SELECT SUM("plannedAmount") FROM loan_installments
         WHERE "loanId" = l.id)                                     AS suma_cuotas
FROM loans l
WHERE l.id = 'cmq5zk1xt003cnr1rszkalhyu';

COMMIT;
