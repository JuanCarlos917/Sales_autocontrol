-- Restaura el tercero centinela "owner-self" (Dueño / Yo), destino del resto
-- del reparto de comisiones. Se sembró en 20260604120000_commissions_phase_1,
-- pero puede haber sido borrado desde la UI de Terceros (antes del guard que
-- lo impide), dejando toda venta con comisión rota por FK en la CxP COMMISSION.
-- Idempotente: no pisa la fila si ya existe.
INSERT INTO "third_parties" ("id", "name", "type", "isActive", "createdAt", "updatedAt")
VALUES ('owner-self', 'Dueño / Yo', 'EMPLOYEE', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
