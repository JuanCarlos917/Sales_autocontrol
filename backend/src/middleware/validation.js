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
});

const vehicleStageSchema = Joi.object({
  stage: Joi.string().valid('NEGOCIANDO', 'COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO').required(),
});

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
    purchasePrice: Joi.number().min(0).allow(null),
    listedPrice: Joi.number().min(0).allow(null),
    participation: Joi.number().min(0).max(1).default(1),
    purchaseDate: Joi.date().allow(null),
    notes: Joi.string().max(2000).allow('', null),
  }).required(),
  payment: Joi.object({
    accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida para el pago' }),
    amount: Joi.number().positive().required().messages({ 'any.required': 'Monto es requerido' }),
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
  thirdPartyId: Joi.string().allow(null),
  // Pago en efectivo/transferencia
  cashPayment: Joi.object({
    accountId: Joi.string().required(),
    amount: Joi.number().positive().required(),
  }).allow(null),
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
  category: Joi.string().valid('MECANICA', 'ESTETICA', 'IMPUESTOS', 'TRAMITE', 'COMISION', 'PARQUEADERO', 'PUBLICIDAD', 'COMBUSTIBLE', 'OTRO').required(),
  amount: Joi.number().min(0).required(),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(1000).allow('', null),
  date: Joi.date().allow(null),
  paid: Joi.boolean().default(true),
});

// ── Expense with Treasury Schema ──
const expenseWithTreasurySchema = Joi.object({
  vehicleId: Joi.string().required(),
  category: Joi.string().valid('MECANICA', 'ESTETICA', 'IMPUESTOS', 'TRAMITE', 'COMISION', 'PARQUEADERO', 'PUBLICIDAD', 'COMBUSTIBLE', 'OTRO').required(),
  amount: Joi.number().positive().required(),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(1000).allow('', null),
  date: Joi.date().allow(null),
  // Campos de tesorería
  isPaid: Joi.boolean().required().messages({ 'any.required': 'Debe indicar si el gasto está pagado' }),
  accountId: Joi.string().when('isPaid', { is: true, then: Joi.required(), otherwise: Joi.allow(null) }),
  thirdPartyId: Joi.string().allow(null),
  dueDate: Joi.date().allow(null),
});

// ── Expense Payment Schema ──
const expensePaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta es requerida' }),
  amount: Joi.number().positive().allow(null),
  date: Joi.date().allow(null),
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
});

// ── ThirdParty Schemas ──
const thirdPartySchema = Joi.object({
  name: Joi.string().max(200).required().messages({ 'any.required': 'Nombre es requerido' }),
  type: Joi.string().valid('SUPPLIER', 'CLIENT', 'BOTH').required(),
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

module.exports = {
  validate,
  schemas: {
    login: loginSchema,
    pinLogin: pinLoginSchema,
    register: registerSchema,
    changePassword: changePasswordSchema,
    vehicle: vehicleSchema,
    vehicleStage: vehicleStageSchema,
    vehiclePurchase: vehiclePurchaseSchema,
    vehiclePayment: vehiclePaymentSchema,
    vehicleSale: vehicleSaleSchema,
    vehicleCollection: vehicleCollectionSchema,
    expense: expenseSchema,
    expenseWithTreasury: expenseWithTreasurySchema,
    expensePayment: expensePaymentSchema,
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
  },
};
