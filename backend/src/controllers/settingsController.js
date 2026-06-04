// ═══════════════════════════════════════════════════════════════
// Controller — Settings
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');

const getAll = async (req, res, next) => {
  try {
    const settings = await prisma.setting.findMany();
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    res.json(obj);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    res.json({ message: 'Configuración actualizada' });
  } catch (err) { next(err); }
};

const COMMISSION_CONFIG_KEYS = [
  'commission_share_pct',
  'reinvest_share_pct',
  'tax_share_pct',
  'default_captador_pct',
  'default_cerrador_pct',
  'reinvest_account_id',
  'tax_reserve_account_id',
];

const getCommissionConfig = async (req, res, next) => {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: COMMISSION_CONFIG_KEYS } },
    });
    const result = {};
    rows.forEach(r => { result[r.key] = r.value; });

    // Hidratar las cuentas BUDGET para mostrar nombre/tipo en la UI
    const accountIds = [result.reinvest_account_id, result.tax_reserve_account_id].filter(Boolean);
    if (accountIds.length > 0) {
      const accounts = await prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, name: true, type: true },
      });
      const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
      result.reinvest_account = byId[result.reinvest_account_id] || null;
      result.tax_reserve_account = byId[result.tax_reserve_account_id] || null;
    }

    res.json(result);
  } catch (err) { next(err); }
};

module.exports = { getAll, update, getCommissionConfig };
