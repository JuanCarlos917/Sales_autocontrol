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

// ── Settings Schema ──
const settingsSchema = Joi.object({
  fixedMonthly: Joi.number().min(0).optional(),
  alertDays: Joi.number().integer().min(1).optional(),
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
    expense: expenseSchema,
    settings: settingsSchema,
  },
};
