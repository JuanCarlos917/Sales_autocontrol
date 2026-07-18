import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin,
  apiCreateVehicle,
  apiConfirmPurchase,
  apiMoveStage,
  apiRegisterSale,
  apiGetVehiclePaymentStatus,
  apiGetAccount,
  apiListPayables,
  apiListTransactions,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// Aporte del socio en la COMPRA (Task 1/2, previo a este spec): la CxP de
// compra ahora se crea por el PRECIO TOTAL del vehículo (no solo "tu parte").
// El aporte del socio ($X) se contabiliza como un par neto $0 por su cuenta:
//   INCOME (CAPITAL_CONTRIBUTION, socio → cuenta) + EXPENSE (VEHICLE_PURCHASE,
//   cuenta → proveedor) — ambos abonan la CxP. Tu parte son EXPENSE(s) como
//   antes. La CxP queda PAID cuando aporte + tus pagos == purchasePrice, lo
//   que además arregla el bug de "compra totalmente pagada" que atascaba el
//   avance de etapa cuando el socio ponía el 100% (CxP $0/PENDING).
//
// Este spec cubre el flujo end-to-end vía los endpoints reales de compra
// (POST /vehicles + POST /vehicles/:id/confirm-purchase, igual que
// purchase-split-payment.spec.ts) para los tres casos del contrato: socio
// externo parcial, socio inversionista al 100% (+ venta, valida que
// `participation` llega correcta a la cascada), y sin socio (regresión).

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

test.describe('Compra con socio (partnerContribution + partnerAccountId) → CxP PAID + avance de etapa', () => {
  test('socio externo 40%: par INCOME+EXPENSE por el aporte (neto 0 en su cuenta), tu parte por EXPENSE, CxP PAID, avanza de etapa', async () => {
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
        partnerAccountId: TEST_SEED_IDS.accountBank,
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

    // Transacciones: INCOME CAPITAL_CONTRIBUTION (aporte, a nombre del socio) +
    // EXPENSE (ese mismo aporte saliendo hacia el proveedor) + EXPENSE (tu parte).
    const txs = await apiListTransactions(token, { vehicleId: v.id });
    const incomes = txs.filter((t) => t.type === 'INCOME');
    const expenses = txs.filter((t) => t.type === 'EXPENSE');
    expect(incomes).toHaveLength(1);
    expect(incomes[0].category).toBe('CAPITAL_CONTRIBUTION');
    expect(Number(incomes[0].amount)).toBe(PARTNER_CONTRIBUTION);
    expect(incomes[0].accountId).toBe(TEST_SEED_IDS.accountBank);
    expect(incomes[0].thirdPartyId).toBe(TEST_SEED_IDS.partner);

    expect(expenses).toHaveLength(2);
    const aporteExpense = expenses.find((e) => e.accountId === TEST_SEED_IDS.accountBank);
    const myExpense = expenses.find((e) => e.accountId === TEST_SEED_IDS.accountCash);
    expect(aporteExpense).toBeTruthy();
    expect(aporteExpense!.category).toBe('VEHICLE_PURCHASE');
    expect(Number(aporteExpense!.amount)).toBe(PARTNER_CONTRIBUTION);
    expect(myExpense).toBeTruthy();
    expect(myExpense!.category).toBe('VEHICLE_PURCHASE');
    expect(Number(myExpense!.amount)).toBe(MY_PART);

    // Neto $0 en la cuenta del aporte: entra y sale el mismo monto.
    const bankAfter = await apiGetAccount(token, TEST_SEED_IDS.accountBank);
    expect(parseFloat(bankAfter.currentBalance as string)).toBe(0);

    // Avanzar de etapa: antes de este fix, con el socio aportando parte del
    // precio la CxP podía quedar mal saldada y esto respondía 400 ("compra
    // totalmente pagada"). Ahora responde 200 OK.
    const advanced = await apiMoveStage(token, v.id, 'ALISTAMIENTO');
    expect(advanced.stage).toBe('ALISTAMIENTO');
  });

  test('socio inversionista al 100%: sin pago propio, CxP PAID, avanza de etapa, y la venta reconoce al socio (participation=0 → socioShare=1)', async () => {
    const token = await apiPinLogin();
    const p = plate('SCI');
    const PURCHASE_PRICE = 20_000_000;
    const SALE_PRICE = 30_000_000;

    const v = await apiCreateVehicle(token, {
      plate: p,
      stage: 'NEGOCIANDO',
      negotiatedValue: PURCHASE_PRICE,
      supplierId: TEST_SEED_IDS.supplier,
    });

    // Inversionista al 100%: owner-self aporta el precio completo, tu parte es $0.
    await apiConfirmPurchase(token, v.id, {
      vehicle: {
        purchasePrice: PURCHASE_PRICE,
        supplierId: TEST_SEED_IDS.supplier,
        partnerId: 'owner-self',
        partnerContribution: PURCHASE_PRICE,
      },
      payment: {
        partnerAccountId: TEST_SEED_IDS.accountBank,
      },
    });

    const status = await apiGetVehiclePaymentStatus(token, v.id);
    expect(parseFloat(String(status.purchase!.totalAmount))).toBe(PURCHASE_PRICE);
    expect(parseFloat(String(status.purchase!.paidAmount))).toBe(PURCHASE_PRICE);
    expect(status.purchase!.status).toBe('PAID');

    // Sin pago propio: solo el par INCOME+EXPENSE del aporte, nada más.
    const txs = await apiListTransactions(token, { vehicleId: v.id });
    expect(txs).toHaveLength(2);
    const income = txs.find((t) => t.type === 'INCOME')!;
    const expense = txs.find((t) => t.type === 'EXPENSE')!;
    expect(Number(income.amount)).toBe(PURCHASE_PRICE);
    expect(income.thirdPartyId).toBe('owner-self');
    expect(Number(expense.amount)).toBe(PURCHASE_PRICE);

    const advanced = await apiMoveStage(token, v.id, 'ALISTAMIENTO');
    expect(advanced.stage).toBe('ALISTAMIENTO');

    // Vender: el fix de `participation` (calculada en fresco a partir de
    // precio/aporte, ya no legacy/stale) debe llegar a la cascada como 0 →
    // socioShare 1 (inversionista 100%) → se crea la CxP PARTNER_SHARE.
    const sale = await apiRegisterSale(token, v.id, {
      salePrice: SALE_PRICE,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: SALE_PRICE },
      participants: [{ thirdPartyId: TEST_SEED_IDS.employee, role: 'CERRADOR', sharePct: 100 }],
    });

    expect(sale.summary.socioShare).toBe(1);
    expect(sale.summary.partnerProfit).toBe(6_400_000);
    expect(sale.summary.partnerCommissionOwed).toBe(1_000_000);
    expect(sale.summary.profitToDistribute).toBe(0);

    const partnerShares = await apiListPayables(token, { vehicleId: v.id, type: 'PARTNER_SHARE' });
    expect(partnerShares).toHaveLength(1);
    expect(Number(partnerShares[0].totalAmount)).toBe(6_400_000);
    expect(partnerShares[0].thirdPartyId).toBe('owner-self');
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
