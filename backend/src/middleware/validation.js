// ═══════════════════════════════════════════════════════════════
// Middleware — Validation (Joi schemas)
// ═══════════════════════════════════════════════════════════════

const Joi = require('joi');

/**
 * Genera middleware de validación a partir de un schema Joi
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return res.status(400).json({ error: 'Datos inválidos', details: errors });
    }

    req[property] = value;
    next();
  };
};

// ── Auth Schemas ──
const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({ 'any.required': 'Email es requerido' }),
  password: Joi.string().min(4).required(),
});

const pinLoginSchema = Joi.object({
  pin: Joi.string().min(4).max(6).required(),
  email: Joi.string().email().optional(),
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().max(100).optional(),
  pin: Joi.string().min(4).max(6).optional(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

// ── Vehicle Schemas ──
const vehicleSchema = Joi.object({
  plate: Joi.string().max(10).required().messages({ 'any.required': 'Placa es requerida' }),
  brand: Joi.string().max(50).allow('', null),
  model: Joi.string().max(50).allow('', null),
  year: Joi.number().integer().min(1980).max(2030).allow(null),
  color: Joi.string().max(30).allow('', null),
  km: Joi.number().integer().min(0).allow(null),
  stage: Joi.string().valid('NEGOCIANDO', 'COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO').default('NEGOCIANDO'),
  negotiatedValue: Joi.number().min(0).allow(null),
  purchasePrice: Joi.number().min(0).allow(null),
  listedPrice: Joi.number().min(0).allow(null),
  salePrice: Joi.number().min(0).allow(null),
  participation: Joi.number().min(0).max(1).default(1),
  purchaseDate: Joi.date().allow(null),
  saleDate: Joi.date().allow(null),
  receivedVehicle: Joi.boolean().default(false),
  receivedVehiclePlate: Joi.string().max(10).allow('', null),
  receivedVehicleValue: Joi.number().min(0).allow(null),
  publishedPortals: Joi.array().items(Joi.string()).default([]),
  notes: Joi.string().max(2000).allow('', null),
  // Terceros asociados
  supplierId: Joi.string().allow(null),
  partnerId: Joi.string().allow(null),
  buyerId: Joi.string().allow(null),
  // Socio
  partnerContribution: Joi.number().min(0).allow(null),
  partnerAssumesExpenses: Joi.boolean().default(true),
});

const vehicleStageSchema = Joi.object({
  stage: Joi.string().valid('NEGOCIANDO', 'COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO').required(),
});

// Schema para actualizaciones parciales (no requiere plate)
const vehicleUpdateSchema = Joi.object({
  plate: Joi.string().max(10),
  brand: Joi.string().max(50).allow('', null),
  model: Joi.string().max(50).allow('', null),
  year: Joi.number().integer().min(1980).max(2030).allow(null),
  color: Joi.string().max(30).allow('', null),
  km: Joi.number().integer().min(0).allow(null),
  stage: Joi.string().valid('NEGOCIANDO', 'COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'),
  negotiatedValue: Joi.number().min(0).allow(null),
  purchasePrice: Joi.number().min(0).allow(null),
  listedPrice: Joi.number().min(0).allow(null),
  salePrice: Joi.number().min(0).allow(null),
  participation: Joi.number().min(0).max(1),
  purchaseDate: Joi.date().allow(null),
  saleDate: Joi.date().allow(null),
  // Los campos receivedVehicle* solo pueden grabarse vía POST /vehicles/:id/sell
  // (saleService.registerSale con tradeIn). El PUT los ignora para evitar que
  // queden datos del cruce sin el vehículo en NEGOCIANDO y sin la CxC asociada.
  publishedPortals: Joi.array().items(Joi.string()),
  notes: Joi.string().max(2000).allow('', null),
  // Terceros asociados
  supplierId: Joi.string().allow(null),
  partnerId: Joi.string().allow(null),
  buyerId: Joi.string().allow(null),
  // Socio
  partnerContribution: Joi.number().min(0).allow(null),
  partnerAssumesExpenses: Joi.boolean(),
}).min(1); // Requiere al menos un campo

// ── Vehicle Purchase Schema (compra con pago) ──
const vehiclePurchaseSchema = Joi.object({
  vehicle: Joi.object({
    plate: Joi.string().max(10).required().messages({ 'any.required': 'Placa es requerida' }),
    brand: Joi.string().max(50).allow('', null),
    model: Joi.string().max(50).allow('', null),
    year: Joi.number().integer().min(1980).max(2030).allow(null),
    color: Joi.string().max(30).allow('', null),
    km: Joi.number().integer().min(0).allow(null),
    stage: Joi.string().valid('NEGOCIANDO', 'COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO').default('COMPRADO'),
    negotiatedValue: Joi.number().min(0).allow(null),
    purchasePrice: Joi.number().min(0).allow(null),
    listedPrice: Joi.number().min(0).allow(null),
    participation: Joi.number().min(0).max(1).default(1),
    purchaseDate: Joi.date().allow(null),
    notes: Joi.string().max(2000).allow('', null),
    supplierId: Joi.string().required().messages({ 'any.required': 'Proveedor es requerido' }),
    partnerId: Joi.string().allow(null),
    partnerContribution: Joi.number().min(0).allow(null),
    partnerAssumesExpenses: Joi.boolean().default(true),
  }).required(),
  payment: Joi.object({
    // Pago único (legacy)
    accountId: Joi.string().allow(null),
    amount: Joi.number().min(0).allow(null),
    // Pago dividido: efectivo + transferencia (una o varias líneas)
    payments: Joi.array().items(Joi.object({
      accountId: Joi.string().required(),
      amount: Joi.number().positive().required(),
      method: Joi.string().valid('CASH', 'TRANSFER').optional(),
    })).optional(),
    thirdPartyId: Joi.string().allow(null),
    date: Joi.date().allow(null),
    dueDate: Joi.date().allow(null),
  }).allow(null),
});

// ── Vehicle Confirm Purchase Schema (pasar de NEGOCIANDO a COMPRADO) ──
const vehicleConfirmPurchaseSchema = Joi.object({
  vehicle: Joi.object({
    purchasePrice: Joi.number().positive().required().messages({ 'any.required': 'Precio de compra es requerido' }),
    purchaseDate: Joi.date().allow(null),
    listedPrice: Joi.number().min(0).allow(null),
    supplierId: Joi.string().allow(null),
    partnerId: Joi.string().allow(null),
    partnerContribution: Joi.number().min(0).allow(null),
    participation: Joi.number().min(0).max(1).allow(null),
    partnerAssumesExpenses: Joi.boolean().allow(null),
    notes: Joi.string().max(2000).allow('', null),
  }).required(),
  payment: Joi.object({
    accountId: Joi.string().allow(null),
    amount: Joi.number().min(0).allow(null),
    // Pago dividido: efectivo + transferencia (una o varias líneas)
    payments: Joi.array().items(Joi.object({
      accountId: Joi.string().required(),
      amount: Joi.number().positive().required(),
      method: Joi.string().valid('CASH', 'TRANSFER').optional(),
    })).optional(),
    thirdPartyId: Joi.string().allow(null),
    date: Joi.date().allow(null),
    dueDate: Joi.date().allow(null),
  }).allow(null),
});

// ── Vehicle Payment Schema (pago adicional) ──
const vehiclePaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  amount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
  date: Joi.date().allow(null),
  description: Joi.string().max(500).allow('', null),
});

// ── Vehicle Sale Schema (venta con cobro) ──
const vehicleSaleSchema = Joi.object({
  salePrice: Joi.number().positive().required().messages({ 'any.required': 'Precio de venta es requerido' }),
  paymentType: Joi.string().valid('CASH', 'TRANSFER', 'TRADE_IN', 'FINANCED', 'MIXED').required(),
  saleDate: Joi.date().allow(null),
  buyerId: Joi.string().required().messages({ 'any.required': 'Cliente (comprador) es requerido' }),
  thirdPartyId: Joi.string().allow(null), // Deprecated, usar buyerId
  // Pago en efectivo/transferencia (línea única, legacy CASH/TRANSFER)
  cashPayment: Joi.object({
    accountId: Joi.string().required(),
    amount: Joi.number().positive().required(),
  }).allow(null),
  // Pago dividido: efectivo + transferencia (usado por "Mixto")
  cashPayments: Joi.array().items(Joi.object({
    accountId: Joi.string().required(),
    amount: Joi.number().positive().required(),
    method: Joi.string().valid('CASH', 'TRANSFER').optional(),
  })).optional(),
  // Cruce de vehículo
  tradeIn: Joi.object({
    plate: Joi.string().max(10).required(),
    value: Joi.number().positive().required(),
    brand: Joi.string().max(50).allow('', null),
    model: Joi.string().max(50).allow('', null),
    year: Joi.number().integer().min(1980).max(2030).allow(null),
    color: Joi.string().max(30).allow('', null),
    km: Joi.number().integer().min(0).allow(null),
  }).allow(null),
  // Financiamiento / CxC
  financing: Joi.object({
    dueDate: Joi.date().allow(null),
    notes: Joi.string().max(500).allow('', null),
  }).allow(null),
  // Participantes de comisión (opcional). Si no viene, se usa el default (owner-self).
  participants: Joi.array().items(Joi.object({
    thirdPartyId: Joi.string().required(),
    role: Joi.string().valid('CAPTADOR', 'CERRADOR', 'OTHER').required(),
    sharePct: Joi.number().min(0).max(100).required(),
  })).optional(),
});

// ── Vehicle Collection Schema (cobro de venta) ──
const vehicleCollectionSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  amount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
  date: Joi.date().allow(null),
  description: Joi.string().max(500).allow('', null),
});

// ── Expense Schemas ──
const expenseSchema = Joi.object({
  vehicleId: Joi.string().required(),
  category: Joi.string().valid('MECANICA', 'ESTETICA', 'IMPUESTOS', 'TRAMITE', 'PARQUEADERO', 'PUBLICIDAD', 'COMBUSTIBLE', 'OTRO').required(),
  amount: Joi.number().min(0).required(),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(1000).allow('', null),
  date: Joi.date().allow(null),
  paid: Joi.boolean().default(true),
});

// ── Expense with Treasury Schema ──
// accountId SIEMPRE obligatorio: todo gasto debe estar asociado a una cuenta
const expenseWithTreasurySchema = Joi.object({
  vehicleId: Joi.string().required(),
  category: Joi.string().valid('MECANICA', 'ESTETICA', 'IMPUESTOS', 'TRAMITE', 'PARQUEADERO', 'PUBLICIDAD', 'COMBUSTIBLE', 'OTRO').required(),
  amount: Joi.number().positive().required(),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(1000).allow('', null),
  date: Joi.date().allow(null),
  isPaid: Joi.boolean().default(true),
  accountId: Joi.string().required().messages({ 'any.required': 'Debe seleccionar una cuenta de tesorería' }),
  thirdPartyId: Joi.string().allow(null),
  dueDate: Joi.date().allow(null),
});

// ── Expense Payment Schema ──
const expensePaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  amount: Joi.number().positive().allow(null),
  date: Joi.date().allow(null),
});

// ── Expense Update Schema (campos editables + reason opcional) ──
const expenseUpdateSchema = Joi.object({
  accountId: Joi.string(),
  category: Joi.string().valid('MECANICA', 'ESTETICA', 'IMPUESTOS', 'TRAMITE', 'PARQUEADERO', 'PUBLICIDAD', 'COMBUSTIBLE', 'OTRO'),
  amount: Joi.number().positive(),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(1000).allow('', null),
  date: Joi.date().allow(null),
  reason: Joi.string().max(500).allow('', null),
}).min(1);

// ── Expense Delete Schema (motivo obligatorio, mín 10 chars) ──
const expenseDeleteSchema = Joi.object({
  reason: Joi.string().min(10).max(500).required().messages({
    'any.required': 'Debe indicar un motivo para eliminar el gasto',
    'string.min': 'El motivo debe tener al menos 10 caracteres',
  }),
});

// ── Schema reutilizable para acciones destructivas en tesorería ──
// (delete de Transaction manual, delete de Transfer, cancel de Payable)
const treasuryDestructiveSchema = Joi.object({
  reason: Joi.string().min(10).max(500).required().messages({
    'any.required': 'Debe indicar un motivo (mín 10 caracteres) para esta acción',
    'string.min': 'El motivo debe tener al menos 10 caracteres',
  }),
});

// ── Settings Schema ──
const settingsSchema = Joi.object({
  fixedMonthly: Joi.number().min(0).optional(),
  alertDays: Joi.number().integer().min(1).optional(),
});

// ══════════════════════════════════════════════════════════════
// TESORERÍA SCHEMAS
// ══════════════════════════════════════════════════════════════

// ── Account Schemas ──
const accountSchema = Joi.object({
  name: Joi.string().max(100).required().messages({ 'any.required': 'Nombre es requerido' }),
  type: Joi.string().valid('CASH', 'BANK').required(),
  bank: Joi.string().max(100).allow('', null),
  accountNumber: Joi.string().max(50).allow('', null),
  initialBalance: Joi.number().min(0).default(0),
  isActive: Joi.boolean().default(true),
});

const accountUpdateSchema = Joi.object({
  name: Joi.string().max(100),
  bank: Joi.string().max(100).allow('', null),
  accountNumber: Joi.string().max(50).allow('', null),
  isActive: Joi.boolean(),
  reason: Joi.string().min(10).max(500).optional(),
});

// ── ThirdParty Schemas ──
const thirdPartySchema = Joi.object({
  name: Joi.string().max(200).required().messages({ 'any.required': 'Nombre es requerido' }),
  type: Joi.string().valid('SUPPLIER', 'CLIENT', 'PARTNER', 'BOTH').required(),
  document: Joi.string().max(20).allow('', null),
  phone: Joi.string().max(20).allow('', null),
  email: Joi.string().email().allow('', null),
  notes: Joi.string().max(1000).allow('', null),
  isActive: Joi.boolean().default(true),
});

// ── Transaction Schemas ──
const incomeSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  category: Joi.string().valid('VEHICLE_SALE', 'VEHICLE_SALE_PARTIAL', 'COMMISSION', 'CAPITAL_CONTRIBUTION', 'OTHER_INCOME').required(),
  amount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
  description: Joi.string().max(500).allow('', null),
  reference: Joi.string().max(100).allow('', null),
  date: Joi.date().allow(null),
  vehicleId: Joi.string().allow(null),
  thirdPartyId: Joi.string().allow(null),
});

const expenseTreasurySchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  category: Joi.string().valid('VEHICLE_PURCHASE', 'VEHICLE_EXPENSE', 'FIXED_EXPENSE', 'OPERATING_EXPENSE', 'OTHER_EXPENSE').required(),
  amount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
  description: Joi.string().max(500).allow('', null),
  reference: Joi.string().max(100).allow('', null),
  date: Joi.date().allow(null),
  vehicleId: Joi.string().allow(null),
  thirdPartyId: Joi.string().allow(null),
  expenseId: Joi.string().allow(null),
});

const transactionUpdateSchema = Joi.object({
  description: Joi.string().max(500).allow('', null),
  reference: Joi.string().max(100).allow('', null),
  date: Joi.date(),
  thirdPartyId: Joi.string().allow(null),
});

// ── Transfer Schema ──
const transferSchema = Joi.object({
  fromAccountId: Joi.string().required().messages({ 'any.required': 'Cuenta origen es requerida' }),
  toAccountId: Joi.string().required().messages({ 'any.required': 'Cuenta destino es requerida' }),
  amount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
  description: Joi.string().max(500).allow('', null),
  date: Joi.date().allow(null),
});

// ── CashCount Schema ──
const cashCountSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  countedBalance: Joi.number().min(0).required().messages({ 'any.required': 'Saldo contado es requerido' }),
  notes: Joi.string().max(1000).allow('', null),
  date: Joi.date().allow(null),
});

// ══════════════════════════════════════════════════════════════
// CxC / CxP SCHEMAS
// ══════════════════════════════════════════════════════════════

// ── Payable Schema (CxC/CxP) ──
const payableSchema = Joi.object({
  type: Joi.string().valid('RECEIVABLE', 'PAYABLE').required().messages({ 'any.required': 'Tipo es requerido' }),
  totalAmount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
  dueDate: Joi.date().allow(null),
  description: Joi.string().max(500).allow('', null),
  vehicleId: Joi.string().allow(null),
  expenseId: Joi.string().allow(null),
  thirdPartyId: Joi.string().allow(null),
});

// ── PayablePayment Schema ──
const payablePaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  amount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
  date: Joi.date().allow(null),
  description: Joi.string().max(500).allow('', null),
});

// ── Loan Schemas ──
const loanInstallmentSchema = Joi.object({
  sequence: Joi.number().integer().positive().required(),
  dueDate: Joi.date().required(),
  plannedAmount: Joi.number().integer().positive().required(),
});

const loanCreateSchema = Joi.object({
  borrowerId: Joi.string().required().messages({ 'any.required': 'Deudor es requerido' }),
  originAccountId: Joi.string().required().messages({ 'any.required': 'Cuenta origen es requerida' }),
  principalAmount: Joi.number().integer().positive().required().messages({ 'any.required': 'Monto del préstamo es requerido' }),
  interestRate: Joi.number().min(0).max(100).default(0),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(2000).allow('', null),
  disbursementDate: Joi.date().allow(null),
  installments: Joi.array().items(loanInstallmentSchema).min(1).required(),
});

// ══════════════════════════════════════════════════════════════
// COMMISSIONS SCHEMAS
// ══════════════════════════════════════════════════════════════

// ── Commission config Schema ──
// Solo valida tipos y rangos por campo. Las validaciones cruzadas
// (sumas de bolsillos y default captador/cerrador, tipo BUDGET de las
// cuentas) viven en el controlador para poder retornar el mensaje
// específico en `body.error` (el middleware de validación coloca los
// detalles de Joi en `details`, no en `error`).
const commissionConfigSchema = Joi.object({
  commission_share_pct:   Joi.number().min(0).max(100).required(),
  reinvest_share_pct:     Joi.number().min(0).max(100).required(),
  tax_share_pct:          Joi.number().min(0).max(100).required(),
  default_captador_pct:   Joi.number().min(0).max(100).required(),
  default_cerrador_pct:   Joi.number().min(0).max(100).required(),
  reinvest_account_id:    Joi.string().required(),
  tax_reserve_account_id: Joi.string().required(),
});

const loanPaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta destino es requerida' }),
  principalAmount: Joi.number().integer().min(0).required(),
  extraAmount: Joi.number().integer().min(0).default(0),
  date: Joi.date().allow(null),
  notes: Joi.string().max(500).allow('', null),
}).custom((value, helpers) => {
  if ((value.principalAmount || 0) + (value.extraAmount || 0) <= 0) {
    return helpers.error('any.invalid', { message: 'El pago debe tener monto > 0 (principal o extra)' });
  }
  return value;
}, 'principal+extra > 0');

// ── Debt Schemas (créditos/financiaciones del negocio) ──
const debtInstallmentSchema = Joi.object({
  sequence: Joi.number().integer().positive().required(),
  dueDate: Joi.date().required(),
  plannedAmount: Joi.number().integer().positive().required(),
});

const debtCreateSchema = Joi.object({
  name: Joi.string().max(120).required().messages({ 'any.required': 'Nombre del crédito es requerido' }),
  lender: Joi.string().max(120).allow('', null),
  assetDescription: Joi.string().max(200).allow('', null),
  startDate: Joi.date().allow(null),
  notes: Joi.string().max(2000).allow('', null),
  installments: Joi.array().items(debtInstallmentSchema).min(1).required(),
});

const debtPaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta origen es requerida' }),
  amount: Joi.number().integer().positive().required(),
  date: Joi.date().allow(null),
  notes: Joi.string().max(500).allow('', null),
});

const debtReconcileSchema = Joi.object({
  transactionIds: Joi.array().items(Joi.string()).min(1).required(),
});

module.exports = {
  validate,
  schemas: {
    login: loginSchema,
    pinLogin: pinLoginSchema,
    register: registerSchema,
    changePassword: changePasswordSchema,
    vehicle: vehicleSchema,
    vehicleUpdate: vehicleUpdateSchema,
    vehicleStage: vehicleStageSchema,
    vehiclePurchase: vehiclePurchaseSchema,
    vehicleConfirmPurchase: vehicleConfirmPurchaseSchema,
    vehiclePayment: vehiclePaymentSchema,
    vehicleSale: vehicleSaleSchema,
    vehicleCollection: vehicleCollectionSchema,
    expense: expenseSchema,
    expenseWithTreasury: expenseWithTreasurySchema,
    expensePayment: expensePaymentSchema,
    expenseUpdate: expenseUpdateSchema,
    expenseDelete: expenseDeleteSchema,
    treasuryDestructive: treasuryDestructiveSchema,
    settings: settingsSchema,
    // Tesorería
    account: accountSchema,
    accountUpdate: accountUpdateSchema,
    thirdParty: thirdPartySchema,
    income: incomeSchema,
    expenseTreasury: expenseTreasurySchema,
    transactionUpdate: transactionUpdateSchema,
    transfer: transferSchema,
    cashCount: cashCountSchema,
    // CxC / CxP
    payable: payableSchema,
    payablePayment: payablePaymentSchema,
    // Loans
    loanCreate: loanCreateSchema,
    loanPayment: loanPaymentSchema,
    // Debts
    debtCreate: debtCreateSchema,
    debtPayment: debtPaymentSchema,
    debtReconcile: debtReconcileSchema,
    // Commissions
    commissionConfig: commissionConfigSchema,
  },
};
