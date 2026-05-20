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
}

export async function apiGetAccount(token: string, id: string): Promise<Account> {
  return getJson(`/treasury/accounts/${id}`, token);
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
  participation?: number;
}

export async function apiCreateVehicle(token: string, data: VehicleInput): Promise<{ id: string; plate: string }> {
  return postJson('/vehicles', data, token);
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
  financing?: { dueDate?: string | null; notes?: string | null } | null;
}

export async function apiRegisterSale(token: string, vehicleId: string, payload: RegisterSalePayload): Promise<unknown> {
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
  type: 'PAYABLE' | 'RECEIVABLE';
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  totalAmount: string | number;
  paidAmount: string | number;
}

export async function apiListPayables(token: string): Promise<Payable[]> {
  return getJson('/payables', token);
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
  description?: string | null;
  installments: LoanInstallmentInput[];
}

export interface Loan {
  id: string;
  borrowerId: string;
  principalAmount: string | number;
  paidAmount: string | number;
  extraReceived: string | number;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  installments: Array<{
    id: string;
    sequence: number;
    plannedAmount: string | number;
    paidAmount: string | number;
    status: 'PENDING' | 'PARTIAL' | 'PAID';
    dueDate: string;
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
  date: string;
}

export async function apiListTransactions(token: string, params: { accountId?: string } = {}): Promise<TransactionRaw[]> {
  const qs = params.accountId ? `?accountId=${encodeURIComponent(params.accountId)}` : '';
  const res = await getJson<{ transactions: TransactionRaw[] } | TransactionRaw[]>(`/treasury/transactions${qs}`, token);
  return Array.isArray(res) ? res : res.transactions;
}
