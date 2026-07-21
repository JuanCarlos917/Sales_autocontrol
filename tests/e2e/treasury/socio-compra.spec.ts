import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin,
  apiCreateVehicle,
  apiConfirmPurchase,
  apiMoveStage,
  apiGetVehiclePaymentStatus,
  apiListPayables,
  apiListTransactions,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Aporte del socio en la COMPRA. La CxP de compra se crea por el PRECIO TOTAL
// del vehículo (no solo "tu parte"). Contrato vigente (FASE A, superó la
// Opción B de este mismo spec — ver git log): el aporte del socio ($X) sale
// como UN SOLO EXPENSE (VEHICLE_PURCHASE) de su cuenta `SOCIO` dedicada
// (resuelta por `vehicle.partnerId`, auto-creada al marcar el tercero como
// PARTNER — ver cuentas-socio.spec.ts). Ya no hay INCOME ni `partnerAccountId`:
// si el socio no tiene una cuenta SOCIO activa, la API responde 400. Tu parte
// son EXPENSE(s) como antes. La CxP queda PAID cuando aporte + tus pagos ==
// purchasePrice, lo que además arregla el bug de "compra totalmente pagada"
// que atascaba el avance de etapa cuando el socio ponía el 100% (CxP
// $0/PENDING).
//
// Este spec cubre el flujo end-to-end vía los endpoints reales de compra
// (POST /vehicles + POST /vehicles/:id/confirm-purchase, igual que
// purchase-split-payment.spec.ts) para el socio externo parcial y el caso sin
// socio (regresión). El caso "socio inversionista al 100%" que vivía aquí se
// quitó: bajo el contrato nuevo, aportar dinero exige que el socio sea de
// tipo PARTNER (para tener cuenta SOCIO) — pero ser reconocido como
// inversionista al vender exige además pertenecer al `investor_team` (o ser
// 'owner-self', que es EMPLOYEE y nunca tiene cuenta SOCIO). Combinar ambas
// cosas queda fuera del alcance de esta FASE. La cascada de venta al 100%
// inversionista (sin aporte en dinero) ya está cubierta en socio.spec.ts;
// el aporte del 100% desde la cuenta del socio (sin venta) está cubierto en
// cuentas-socio.spec.ts.

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

test.describe('Compra con socio (partnerContribution → egreso desde su cuenta SOCIO) → CxP PAID + avance de etapa', () => {
  test('socio externo 40%: EXPENSE único desde su cuenta SOCIO (sin INCOME), tu parte por EXPENSE, CxP PAID, avanza de etapa', async () => {
    const token = await apiPinLogin();
    const p = plate('SCE');
    const PURCHASE_PRICE = 20_000_000;
    const PARTNER_CONTRIBUTION = 8_000_000;
    const MY_PART = 12_000_000;

    const v = await apiCreateVehicle(token, {
      plate: p,
      stage: 'NEGOCIANDO',
      negotiatedValue: PURCHASE_PRICE,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await apiConfirmPurchase(token, v.id, {
      vehicle: {
        purchasePrice: PURCHASE_PRICE,
        supplierId: TEST_SEED_IDS.supplier,
        partnerId: TEST_SEED_IDS.partner,
        partnerContribution: PARTNER_CONTRIBUTION,
      },
      payment: {
        payments: [{ accountId: TEST_SEED_IDS.accountCash, amount: MY_PART, method: 'CASH' }],
      },
    });

    // CxP por el precio TOTAL, no solo tu parte, y PAID (aporte + tu parte == precio).
    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(status.purchase).not.toBeNull();
    expect(parseFloat(String(status.purchase!.totalAmount))).toBe(PURCHASE_PRICE);
    expect(parseFloat(String(status.purchase!.paidAmount))).toBe(PURCHASE_PRICE);
    expect(status.purchase!.pendingAmount).toBe(0);
    expect(status.purchase!.status).toBe('PAID');

    const payables = await apiListPayables(token, { vehicleId: v.id, type: 'PAYABLE' });
    expect(payables).toHaveLength(1);
    expect(payables[0].status).toBe('PAID');
    expect(Number(payables[0].totalAmount)).toBe(PURCHASE_PRICE);

    // Transacciones: sin INCOME (ya no hay par INCOME+EXPENSE) — un único
    // EXPENSE por el aporte, desde la cuenta SOCIO de `partner` (sembrada en
    // tests/helpers/db.ts, `TEST_SEED_IDS.partnerAccount`) + EXPENSE por tu parte.
    const txs = await apiListTransactions(token, { vehicleId: v.id });
    const incomes = txs.filter((t) => t.type === 'INCOME');
    const expenses = txs.filter((t) => t.type === 'EXPENSE');
    expect(incomes).toHaveLength(0);

    expect(expenses).toHaveLength(2);
    const aporteExpense = expenses.find((e) => e.accountId === TEST_SEED_IDS.partnerAccount);
    const myExpense = expenses.find((e) => e.accountId === TEST_SEED_IDS.accountCash);
    expect(aporteExpense).toBeTruthy();
    expect(aporteExpense!.category).toBe('VEHICLE_PURCHASE');
    expect(Number(aporteExpense!.amount)).toBe(PARTNER_CONTRIBUTION);
    expect(myExpense).toBeTruthy();
    expect(myExpense!.category).toBe('VEHICLE_PURCHASE');
    expect(Number(myExpense!.amount)).toBe(MY_PART);

    // Avanzar de etapa: antes de este fix, con el socio aportando parte del
    // precio la CxP podía quedar mal saldada y esto respondía 400 ("compra
    // totalmente pagada"). Ahora responde 200 OK.
    const advanced = await apiMoveStage(token, v.id, 'ALISTAMIENTO');
    expect(advanced.stage).toBe('ALISTAMIENTO');
  });

  test('sin socio (regresión): compra pagada por completo por ti, CxP PAID como hoy, avanza de etapa', async () => {
    const token = await apiPinLogin();
    const p = plate('SCN');
    const PURCHASE_PRICE = 15_000_000;

    const v = await apiCreateVehicle(token, {
      plate: p,
      stage: 'NEGOCIANDO',
      negotiatedValue: PURCHASE_PRICE,
      supplierId: TEST_SEED_IDS.supplier,
    });

    await apiConfirmPurchase(token, v.id, {
      vehicle: { purchasePrice: PURCHASE_PRICE, supplierId: TEST_SEED_IDS.supplier },
      payment: { accountId: TEST_SEED_IDS.accountCash, amount: PURCHASE_PRICE },
    });

    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(parseFloat(String(status.purchase!.totalAmount))).toBe(PURCHASE_PRICE);
    expect(parseFloat(String(status.purchase!.paidAmount))).toBe(PURCHASE_PRICE);
    expect(status.purchase!.pendingAmount).toBe(0);
    expect(status.purchase!.status).toBe('PAID');

    // Sin aporte de socio: ninguna transacción INCOME para este vehículo.
    const txs = await apiListTransactions(token, { vehicleId: v.id });
    expect(txs.filter((t) => t.type === 'INCOME')).toHaveLength(0);
    expect(txs.filter((t) => t.type === 'EXPENSE')).toHaveLength(1);

    const advanced = await apiMoveStage(token, v.id, 'ALISTAMIENTO');
    expect(advanced.stage).toBe('ALISTAMIENTO');
  });
});
