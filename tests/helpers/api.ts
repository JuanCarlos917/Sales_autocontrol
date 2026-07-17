const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function apiRequestRaw(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: { error?: string } | null }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: { error?: string } | null = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface Account {
  id: string;
  name: string;
  currentBalance: string | number;
  isActive: boolean;
}

export async function apiGetAccount(token: string, id: string): Promise<Account> {
  return getJson(`/treasury/accounts/${id}`, token);
}

export async function apiCreateAccount(
  token: string,
  data: { name: string; type: 'CASH' | 'BANK'; initialBalance?: number },
): Promise<Account> {
  return postJson('/treasury/accounts', data, token);
}

export async function apiReverseAccountRaw(
  token: string,
  id: string,
  reason: string,
): Promise<{ status: number; body: { error?: string; isActive?: boolean } }> {
  return apiRequestRaw('POST', `/treasury/accounts/${id}/reverse`, token, { reason });
}

export async function apiPinLogin(): Promise<string> {
  const data = await postJson<{ accessToken: string }>('/auth/pin-login', { pin: ADMIN_PIN });
  return data.accessToken;
}

export interface VehicleInput {
  plate: string;
  stage?: 'NEGOCIANDO' | 'COMPRADO' | 'ALISTAMIENTO' | 'PUBLICADO' | 'DISPONIBLE' | 'VENDIDO';
  brand?: string;
  model?: string;
  year?: number;
  negotiatedValue?: number;
  purchasePrice?: number;
  listedPrice?: number;
  supplierId?: string;
  partnerId?: string;
  participation?: number;
}

export async function apiCreateVehicle(token: string, data: VehicleInput): Promise<{ id: string; plate: string }> {
  return postJson('/vehicles', data, token);
}

export interface VehicleDetail {
  id: string;
  plate: string;
  stage: string;
  negotiatedValue: string | number | null;
  purchasePrice: string | number | null;
  fromTradeIn: boolean;
  supplierId: string | null;
  sourceVehicleId: string | null;
}

export async function apiGetVehicle(token: string, id: string): Promise<VehicleDetail> {
  return getJson(`/vehicles/${id}`, token);
}

export async function apiMoveStage(token: string, id: string, stage: string): Promise<VehicleDetail> {
  const res = await fetch(`${API_BASE}/vehicles/${id}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ stage }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH /vehicles/${id}/stage failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<VehicleDetail>;
}

export interface VehicleUpdateInput {
  plate?: string;
  brand?: string;
  model?: string;
  year?: number;
  color?: string;
  km?: number;
  notes?: string;
  listedPrice?: number;
}

/** PUT que lanza si la respuesta no es ok. Para el camino feliz. */
export async function apiUpdateVehicle(token: string, id: string, data: VehicleUpdateInput): Promise<{ id: string; plate: string; brand: string | null }> {
  const res = await fetch(`${API_BASE}/vehicles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /vehicles/${id} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ id: string; plate: string; brand: string | null }>;
}

/** PUT que NO lanza: devuelve status + body para aserciones de 403/400. */
export async function apiUpdateVehicleRaw(token: string, id: string, data: VehicleUpdateInput): Promise<{ status: number; body: { error?: string } }> {
  const res = await fetch(`${API_BASE}/vehicles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  let body: { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

export interface VehicleAuditEntry {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'STAGE_CHANGE' | 'DELETE';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
}

export interface VehicleTimelineEvent {
  type: 'VEHICLE_AUDIT' | 'EXPENSE_AUDIT' | 'TRANSACTION';
  id: string;
  createdAt: string;
  actor: { id: string; name: string | null; email: string } | null;
  action: string | null;
  category: string | null;
  amount: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
}

export async function apiGetVehicleTimeline(token: string, id: string): Promise<{ events: VehicleTimelineEvent[] }> {
  return getJson(`/vehicles/${id}/timeline`, token);
}

export async function apiGetVehicleAudit(token: string, id: string): Promise<VehicleAuditEntry[]> {
  return getJson(`/vehicles/${id}/audit`, token);
}

export interface PurchasePaymentLine {
  accountId: string;
  amount: number;
  method?: 'CASH' | 'TRANSFER';
}

export interface ConfirmPurchasePayload {
  vehicle: {
    purchasePrice: number;
    supplierId?: string | null;
    listedPrice?: number | null;
  };
  payment: {
    accountId?: string | null;
    amount?: number | null;
    payments?: PurchasePaymentLine[];
    thirdPartyId?: string | null;
    dueDate?: string | null;
  };
}

export async function apiConfirmPurchase(
  token: string,
  vehicleId: string,
  payload: ConfirmPurchasePayload,
): Promise<unknown> {
  return postJson(`/vehicles/${vehicleId}/confirm-purchase`, payload, token);
}

export interface RegisterSalePayload {
  salePrice: number;
  paymentType: 'CASH' | 'TRANSFER' | 'TRADE_IN' | 'FINANCED' | 'MIXED';
  buyerId: string;
  saleDate?: string | null;
  cashPayment?: { accountId: string; amount: number } | null;
  cashPayments?: PurchasePaymentLine[];
  tradeIn?: {
    plate: string;
    value: number;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    color?: string | null;
    km?: number | null;
  } | null;
  financing?: { dueDate?: string | null; notes?: string | null } | null;
  participants?: Array<{
    thirdPartyId: string;
    role: 'CAPTADOR' | 'CERRADOR' | 'OTHER';
    sharePct: number;
  }>;
}

export interface RegisterSaleResult {
  vehicle: { id: string; plate: string };
  newVehicle: { id: string; plate: string } | null;
  receivable: unknown;
  summary: {
    salePrice: number;
    totalReceived: number;
    pendingAmount: number;
    tradeInValue: number;
    // Cascada nueva (calculateSaleDistribution, Task 4): comisión sobre el gross
    // (vendedores) → reservas (reinversión/impuestos) sobre el neto → ganancia
    // repartida por capital (inversionistas). Ausentes si la venta no tuvo utilidad.
    grossProfit?: number;
    commissionPool?: number;
    reinvestAmount?: number;
    taxAmount?: number;
    profitToDistribute?: number;
    cashRatioApplied?: number;
    // Socio del vehículo (partnerId/participation, Task 3): su ganancia bruta
    // (partnerProfit → CxP PARTNER_SHARE), su % de la comisión adeudada al
    // fondo (partnerCommissionOwed → CxC "Comisión socio") y su share (1 −
    // participation). Ausentes/0 si el vehículo no tiene socio.
    partnerProfit?: number;
    partnerCommissionOwed?: number;
    socioShare?: number;
    sellers?: Array<{
      id: string;
      thirdPartyId: string;
      role: string;
      sharePct: number;
      amount: number;
      payableId: string;
    }>;
    investors?: Array<{
      id: string;
      thirdPartyId: string;
      role: string;
      sharePct: number;
      amount: number;
      payableId: string;
    }>;
    transfers?: Array<{
      id: string;
      fromAccountId: string;
      toAccountId: string;
      amount: number;
      description: string;
    }>;
  };
}

export async function apiRegisterSale(token: string, vehicleId: string, payload: RegisterSalePayload): Promise<RegisterSaleResult> {
  return postJson(`/vehicles/${vehicleId}/sell`, payload, token);
}

export interface VehiclePaymentStatus {
  purchase: { totalAmount: string | number; paidAmount: string | number; pendingAmount: number; status: string } | null;
  sale: { totalAmount: string | number; paidAmount: string | number; pendingAmount: number; status: string } | null;
}

export async function apiGetVehiclePaymentStatus(token: string, id: string): Promise<VehiclePaymentStatus> {
  return getJson(`/vehicles/${id}/payment-status`, token);
}

export interface Payable {
  id: string;
  vehicleId: string | null;
  thirdPartyId: string | null;
  description: string | null;
  type: 'PAYABLE' | 'RECEIVABLE' | 'COMMISSION' | 'PROFIT_SHARE' | 'PARTNER_SHARE';
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  totalAmount: string | number;
  paidAmount: string | number;
}

export interface PayableFilters {
  type?: string;
  status?: string;
  vehicleId?: string;
  thirdPartyId?: string;
}

export async function apiListPayables(token: string, filters: PayableFilters = {}): Promise<Payable[]> {
  const entries = Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][];
  const qs = new URLSearchParams(entries).toString();
  return getJson(`/payables${qs ? `?${qs}` : ''}`, token);
}

export interface LoanInstallmentInput {
  sequence: number;
  dueDate: string;
  plannedAmount: number;
}

export interface LoanCreateInput {
  borrowerId: string;
  originAccountId: string;
  principalAmount: number;
  interestRate?: number;
  description?: string | null;
  installments: LoanInstallmentInput[];
}

export interface Loan {
  id: string;
  borrowerId: string;
  principalAmount: string | number;
  paidAmount: string | number;
  extraReceived: string | number;
  interestAmount: string | number;
  interestReceived: string | number;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  installments: Array<{
    id: string;
    sequence: number;
    plannedAmount: string | number;
    paidAmount: string | number;
    status: 'PENDING' | 'PARTIAL' | 'PAID';
    dueDate: string;
  }>;
  payments: Array<{
    id: string;
    principalAmount: string | number;
    extraAmount: string | number;
    reversedAt: string | null;
  }>;
  isOverdue: boolean;
}

export async function apiCreateLoan(token: string, data: LoanCreateInput): Promise<Loan> {
  return postJson('/loans', data, token);
}

export async function apiListLoans(token: string): Promise<Loan[]> {
  return getJson('/loans', token);
}

export async function apiGetLoan(token: string, id: string): Promise<Loan> {
  return getJson(`/loans/${id}`, token);
}

export interface LoanPaymentInput {
  accountId: string;
  principalAmount: number;
  extraAmount?: number;
  date?: string | null;
  notes?: string | null;
}

export async function apiAddLoanPayment(token: string, loanId: string, data: LoanPaymentInput): Promise<Loan> {
  return postJson(`/loans/${loanId}/payments`, data, token);
}

export async function apiReverseLoanPaymentRaw(
  token: string,
  paymentId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/loan-payments/${paymentId}/reverse`, token, { reason });
}

export async function apiReverseLoanRaw(
  token: string,
  loanId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/loans/${loanId}/reverse`, token, { reason });
}

// ── Debts ─────────────────────────────────────────────────

export interface DebtInstallmentInput {
  sequence: number;
  dueDate: string;
  plannedAmount: number;
}

export interface DebtCreateInput {
  name: string;
  lender?: string | null;
  assetDescription?: string | null;
  notes?: string | null;
  installments: DebtInstallmentInput[];
}

export interface Debt {
  id: string;
  name: string;
  totalAmount: string | number;
  paidAmount: string | number;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  installments: Array<{ id: string; sequence: number; plannedAmount: string | number; paidAmount: string | number; status: string; dueDate: string }>;
  payments: Array<{ id: string; amount: string | number; reversedAt: string | null }>;
  isOverdue: boolean;
}

export async function apiCreateDebt(token: string, data: DebtCreateInput): Promise<Debt> {
  return postJson('/debts', data, token);
}

export async function apiGetDebt(token: string, id: string): Promise<Debt> {
  return getJson(`/debts/${id}`, token);
}

export async function apiAddDebtPayment(
  token: string,
  debtId: string,
  data: { accountId: string; amount: number; date?: string | null; notes?: string | null },
): Promise<Debt> {
  return postJson(`/debts/${debtId}/payments`, data, token);
}

export async function apiReconcileDebt(token: string, debtId: string, transactionIds: string[]): Promise<Debt> {
  return postJson(`/debts/${debtId}/reconcile`, { transactionIds }, token);
}

export async function apiReverseDebtPaymentRaw(
  token: string,
  paymentId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/debt-payments/${paymentId}/reverse`, token, { reason });
}

export async function apiReverseDebtRaw(
  token: string,
  debtId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/debts/${debtId}/reverse`, token, { reason });
}

// ── Expenses ─────────────────────────────────────────────

export interface ExpenseCreateInput {
  vehicleId: string;
  accountId: string;
  category: 'MECANICA' | 'ESTETICA' | 'IMPUESTOS' | 'TRAMITE' | 'COMISION' | 'PARQUEADERO' | 'PUBLICIDAD' | 'COMBUSTIBLE' | 'OTRO';
  amount: number;
  description?: string | null;
  notes?: string | null;
  date?: string | null;
  isPaid?: boolean;
  thirdPartyId?: string | null;
  dueDate?: string | null;
}

export interface Expense {
  id: string;
  vehicleId: string;
  accountId: string;
  category: string;
  amount: string | number;
  description: string | null;
  paid: boolean;
  date: string | null;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ExpenseUpdateInput {
  category?: string;
  amount?: number;
  description?: string | null;
  notes?: string | null;
  date?: string | null;
  accountId?: string;
  reason?: string;
}

export async function apiCreateExpense(token: string, data: ExpenseCreateInput): Promise<{ expense: Expense }> {
  return postJson('/expenses', data, token);
}

export async function apiListExpenses(token: string): Promise<Array<Expense & { vehicle?: { plate: string; stage?: string } }>> {
  return getJson('/expenses', token);
}

export async function apiUpdateExpense(token: string, id: string, data: ExpenseUpdateInput): Promise<Expense> {
  const res = await fetch(`${API_BASE}/expenses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /expenses/${id} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<Expense>;
}

export async function apiDeleteExpense(token: string, id: string, reason: string): Promise<void> {
  const res = await fetch(`${API_BASE}/expenses/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE /expenses/${id} failed: ${res.status} ${text}`);
  }
}

export async function apiRestoreExpense(token: string, id: string): Promise<Expense> {
  return postJson(`/expenses/${id}/restore`, {}, token);
}

export interface ExpenseAuditEntry {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
}

export async function apiGetExpenseAudit(token: string, id: string): Promise<ExpenseAuditEntry[]> {
  return getJson(`/expenses/${id}/audit`, token);
}

// ── Transactions (raw) ─────────────────────────────────

export interface TransactionRaw {
  id: string;
  accountId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  category: string;
  amount: string | number;
  description: string | null;
  expenseId: string | null;
  vehicleId: string | null;
  debtId: string | null;
  reversesTransactionId: string | null;
  date: string;
}

export async function apiCreateTreasuryIncome(
  token: string,
  data: { accountId: string; amount: number; category?: string; date?: string; description?: string },
): Promise<TransactionRaw> {
  return postJson('/treasury/transactions/income', { category: 'OTHER_INCOME', ...data }, token);
}

export async function apiCreateTreasuryExpense(
  token: string,
  data: { accountId: string; amount: number; category?: string; date?: string; description?: string },
): Promise<TransactionRaw> {
  return postJson('/treasury/transactions/expense', { category: 'OTHER_EXPENSE', ...data }, token);
}

export async function apiListTransactions(token: string, params: { accountId?: string } = {}): Promise<TransactionRaw[]> {
  const qs = params.accountId ? `?accountId=${encodeURIComponent(params.accountId)}` : '';
  const res = await getJson<{ transactions: TransactionRaw[] } | TransactionRaw[]>(`/treasury/transactions${qs}`, token);
  return Array.isArray(res) ? res : res.transactions;
}

export async function apiDeleteTransactionRaw(
  token: string,
  id: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: { message?: string; error?: string } }> {
  const res = await fetch(`${API_BASE}/treasury/transactions/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return { status: res.status, body: json };
}

export interface TreasuryAuditEntry {
  id: string;
  entityType: 'TRANSACTION' | 'TRANSFER' | 'ACCOUNT' | 'PAYABLE' | 'PAYABLE_PAYMENT';
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL' | 'PAYMENT';
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
}

export async function apiGetTreasuryAudit(
  token: string,
  entityType: TreasuryAuditEntry['entityType'],
  entityId: string,
): Promise<TreasuryAuditEntry[]> {
  return getJson(
    `/treasury/audit?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`,
    token,
  );
}

export async function apiDeleteTransferRaw(
  token: string,
  id: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: { message?: string; error?: string } }> {
  const res = await fetch(`${API_BASE}/treasury/transfers/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return { status: res.status, body: json };
}

// ── Commission config ──────────────────────────────────

export interface CommissionConfig {
  commission_share_pct: string;
  reinvest_share_pct: string;
  tax_share_pct: string;
  default_captador_pct: string;
  default_cerrador_pct: string;
  reinvest_account_id: string;
  tax_reserve_account_id: string;
  reinvest_account?: { id: string; name: string; type: string };
  tax_reserve_account?: { id: string; name: string; type: string };
}

export async function apiGetCommissionConfig(token: string): Promise<CommissionConfig> {
  return getJson('/settings/commission-config', token);
}

export interface CommissionDefaultTeamMember {
  thirdPartyId: string;
  role: string;
  sharePct: number;
}

export interface CommissionConfigInput {
  commission_share_pct?: string | number;
  reinvest_share_pct?: string | number;
  tax_share_pct?: string | number;
  default_captador_pct?: string | number;
  default_cerrador_pct?: string | number;
  reinvest_account_id?: string;
  tax_reserve_account_id?: string;
  commission_default_team?: CommissionDefaultTeamMember[];
  [key: string]: string | number | CommissionDefaultTeamMember[] | undefined;
}

export async function apiUpdateCommissionConfig(
  token: string,
  body: CommissionConfigInput,
): Promise<{ status: number; body: { error?: string; data?: CommissionConfig } }> {
  return apiRequestRaw('PUT', '/settings/commission-config', token, body);
}

export interface CommissionPersonSummary {
  thirdParty: { id: string; name: string };
  totalPaid: number;
  totalPending: number;
  salesCount: number;
}

export interface CommissionsSummary {
  pendingTotal: number;
  paidThisMonth: number;
  byPerson: CommissionPersonSummary[];
}

export async function apiGetCommissionsSummary(token: string): Promise<CommissionsSummary> {
  return getJson('/commissions/summary', token);
}

// ── User Management (admin-only) ──
export interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'SUPERVISOR' | 'VIEWER';
  isActive: boolean;
}

export async function apiCreateUser(
  token: string,
  data: { email: string; password: string; name?: string | null; role: string; pin?: string | null },
): Promise<ManagedUser> {
  return postJson('/users', data, token);
}

export async function apiMe(token: string): Promise<{ user: { id: string; email: string; role: string } }> {
  return getJson('/auth/me', token);
}

export interface CashCount {
  id: string;
  voidedAt: string | null;
  difference: string | number;
  countedBalance: string | number;
  expectedBalance: string | number;
}

export async function apiCreateCashCount(
  token: string,
  data: { accountId: string; countedBalance: number; notes?: string },
): Promise<CashCount> {
  return postJson('/treasury/cash-counts', data, token);
}

export async function apiReverseCashCountRaw(
  token: string,
  id: string,
  reason: string,
): Promise<{ status: number; body: { error?: string; voidedAt?: string | null } }> {
  return apiRequestRaw('POST', `/treasury/cash-counts/${id}/reverse`, token, { reason });
}

export async function apiReverseTransactionRaw(
  token: string,
  id: string,
  body: { reason?: string },
): Promise<{ status: number; body: { error?: string; id?: string; type?: string; category?: string; reversesTransactionId?: string; amount?: string } | null }> {
  return apiRequestRaw('POST', `/treasury/transactions/${id}/reverse`, token, body);
}

// ── Commissions ───────────────────────────────────────────

// Espejo del shape de /investors: ambos endpoints reutilizan
// commissionService.buildCommissionVehicleItem — cascada de comisión
// (calculateCommissionBase: aplica `participation`, excluye gastos COMISION).
interface VehicleItemRole {
  role: string; sharePct: number; total: number; paid: number; pending: number;
  status: string; payableId: string; thirdParty: { id: string; name: string };
  payments: Array<{ date: string | null; amount: number; accountName: string }>;
}

export interface CommissionVehicleItem {
  vehicle: { id: string; plate: string; brand: string | null; model: string | null; saleDate: string | null; salePrice: number };
  cascade: {
    salePrice: number; purchaseCost: number; directExpenses: number;
    grossProfit: number; participation: number; commissionBase: number; commissionPool: number;
  };
  roles: VehicleItemRole[];
  buckets: { reinvest: number; tax: number } | null;
  hasPending: boolean;
}

export async function apiListCommissions(token: string): Promise<CommissionVehicleItem[]> {
  return getJson('/commissions', token);
}

// ── Investors (ganancia por inversionista) ──
// commissionService.buildInvestorVehicleItem — cascada de GANANCIA real
// (espejo de calculateSaleDistribution): NO usa participation/commissionBase,
// resta la CxP COMMISSION + reservas reinvest/tax, y profitToDistribute es el
// pool que se reparte entre inversionistas.
export interface InvestorVehicleItem {
  vehicle: { id: string; plate: string; brand: string | null; model: string | null; saleDate: string | null; salePrice: number };
  cascade: {
    salePrice: number; purchaseCost: number; directExpenses: number; grossProfit: number;
    commissionPool: number; reinvest: number; tax: number; profitToDistribute: number;
  };
  roles: VehicleItemRole[];
  buckets: { reinvest: number; tax: number } | null;
  hasPending: boolean;
}

export async function apiListInvestors(token: string): Promise<InvestorVehicleItem[]> {
  return getJson('/investors', token);
}

export async function apiGetInvestorsSummary(token: string): Promise<CommissionsSummary> {
  return getJson('/investors/summary', token);
}

// ── Payables summary (CxC/CxP consolidado) ──
export interface PayablesSummary {
  receivables: { total: number; count: number; overdueCount: number };
  payables: { total: number; count: number; overdueCount: number };
}

export async function apiGetPayablesSummary(token: string): Promise<PayablesSummary> {
  return getJson('/payables/summary', token);
}
