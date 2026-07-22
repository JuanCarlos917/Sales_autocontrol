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
  'commission_default_team',
  'commission_gross_pct',
  'reinvest_pct',
  'tax_pct',
  'investor_team',
];

// Keys cuyo valor persistido es un array JSON (no un escalar) — deben
// serializarse en el upsert y parsearse en la lectura.
const JSON_KEYS = new Set(['commission_default_team', 'investor_team']);

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

    // Parsear y hidratar equipo de reparto
    let team = [];
    try { team = JSON.parse(result.commission_default_team || '[]'); } catch { team = []; }
    if (!Array.isArray(team)) team = [];
    result.commission_default_team = team;
    if (team.length > 0) {
      const people = await prisma.thirdParty.findMany({
        where: { id: { in: team.map((t) => t.thirdPartyId) } },
        select: { id: true, name: true },
      });
      const byId = Object.fromEntries(people.map((p) => [p.id, p]));
      result.commission_default_team_people = team
        .map((t) => byId[t.thirdPartyId])
        .filter(Boolean);
    } else {
      result.commission_default_team_people = [];
    }

    // Parsear y hidratar equipo de inversionistas (espejo del equipo de reparto)
    let investorTeam = [];
    try { investorTeam = JSON.parse(result.investor_team || '[]'); } catch { investorTeam = []; }
    if (!Array.isArray(investorTeam)) investorTeam = [];
    result.investor_team = investorTeam;
    if (investorTeam.length > 0) {
      const investors = await prisma.thirdParty.findMany({
        where: { id: { in: investorTeam.map((t) => t.thirdPartyId) } },
        select: { id: true, name: true },
      });
      const investorById = Object.fromEntries(investors.map((p) => [p.id, p]));
      result.investor_team_people = investorTeam
        .map((t) => investorById[t.thirdPartyId])
        .filter(Boolean);
    } else {
      result.investor_team_people = [];
    }

    res.json(result);
  } catch (err) { next(err); }
};

const updateCommissionConfig = async (req, res, next) => {
  try {
    const data = req.body;

    // 1) Validar suma de los tres bolsillos (= 100)
    const bucketSum =
      Number(data.commission_share_pct) +
      Number(data.reinvest_share_pct) +
      Number(data.tax_share_pct);
    if (Math.abs(bucketSum - 100) > 0.001) {
      return res.status(400).json({
        error: 'Los tres bolsillos (commission/reinvest/tax) deben sumar 100',
      });
    }

    // 2) Validar suma de default captador + cerrador (= 100)
    const splitSum =
      Number(data.default_captador_pct) + Number(data.default_cerrador_pct);
    if (Math.abs(splitSum - 100) > 0.001) {
      return res.status(400).json({
        error: 'default_captador_pct + default_cerrador_pct deben sumar 100',
      });
    }

    // 3) Validar que las cuentas existen, son BUDGET y están activas
    const accounts = await prisma.account.findMany({
      where: { id: { in: [data.reinvest_account_id, data.tax_reserve_account_id] } },
      select: { id: true, type: true, isActive: true },
    });
    const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
    const reinv = byId[data.reinvest_account_id];
    const tax = byId[data.tax_reserve_account_id];
    if (!reinv || reinv.type !== 'BUDGET' || !reinv.isActive) {
      return res.status(400).json({
        error: 'reinvest_account_id debe apuntar a una cuenta tipo BUDGET activa',
      });
    }
    if (!tax || tax.type !== 'BUDGET' || !tax.isActive) {
      return res.status(400).json({
        error: 'tax_reserve_account_id debe apuntar a una cuenta tipo BUDGET activa',
      });
    }

    // 3b) Equipo de reparto de VENDEDORES (opcional): sin duplicados, suma ≤ 100,
    // terceros existentes. El dueño (owner-self) SÍ puede ir como vendedor (cobra
    // comisión por vender, aparte de su ganancia como inversionista).
    const team = Array.isArray(data.commission_default_team) ? data.commission_default_team : [];
    const teamIds = team.map((p) => p.thirdPartyId);
    if (new Set(teamIds).size !== teamIds.length) {
      return res.status(400).json({ error: 'Hay personas repetidas en el equipo de reparto' });
    }
    const teamSum = team.reduce((s, p) => s + Number(p.sharePct), 0);
    if (teamSum > 100.001) {
      return res.status(400).json({ error: `Los porcentajes del equipo suman ${teamSum} (máximo 100)` });
    }
    if (teamIds.length > 0) {
      const foundTps = await prisma.thirdParty.findMany({ where: { id: { in: teamIds } }, select: { id: true } });
      if (foundTps.length !== teamIds.length) {
        return res.status(400).json({ error: 'Algún tercero del equipo no existe' });
      }
    }

    // 3c) Porcentajes editables de ganancia (comisión/reinversión/impuestos).
    // Independientes entre sí (NO deben sumar 100: comisión es % del gross
    // profit; reinversión/impuestos son % del remanente después de comisión).
    // Se validan solo si vienen en el payload.
    const distPctFields = ['commission_gross_pct', 'reinvest_pct', 'tax_pct'];
    for (const field of distPctFields) {
      if (data[field] === undefined) continue;
      const n = Number(data[field]);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: `${field} debe ser un número entre 0 y 100` });
      }
    }
    if (data.reinvest_pct !== undefined && data.tax_pct !== undefined) {
      const reinvestTaxSum = Number(data.reinvest_pct) + Number(data.tax_pct);
      if (reinvestTaxSum > 100.001) {
        return res.status(400).json({
          error: `reinvest_pct + tax_pct no pueden superar 100 (suman ${reinvestTaxSum})`,
        });
      }
    }

    // 3d) Equipo de inversionistas (opcional): a diferencia del equipo de
    // reparto de vendedores, el dueño (owner-self) SÍ puede estar — es un
    // inversionista más. Vacío = permitido (resolveInvestors cae a
    // owner-self 100%); si no está vacío, debe sumar EXACTO 100.
    if (data.investor_team !== undefined) {
      const investorTeam = Array.isArray(data.investor_team) ? data.investor_team : [];
      const investorIds = investorTeam.map((p) => p.thirdPartyId);
      if (new Set(investorIds).size !== investorIds.length) {
        return res.status(400).json({ error: 'Hay inversionistas repetidos en el equipo' });
      }
      if (investorTeam.some((p) => !(Number(p.sharePct) > 0))) {
        return res.status(400).json({ error: 'Cada inversionista debe tener un porcentaje mayor a 0' });
      }
      if (investorTeam.length > 0) {
        const investorSum = investorTeam.reduce((s, p) => s + Number(p.sharePct), 0);
        if (Math.abs(investorSum - 100) > 0.001) {
          return res.status(400).json({
            error: `Los porcentajes de inversionistas suman ${investorSum} (deben sumar 100)`,
          });
        }
        const foundInvestors = await prisma.thirdParty.findMany({
          where: { id: { in: investorIds } },
          select: { id: true },
        });
        if (foundInvestors.length !== investorIds.length) {
          return res.status(400).json({ error: 'Algún inversionista no existe' });
        }
      }
    }

    // 4) Persistir los ajustes en una transacción
    const entries = Object.entries(data);
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: JSON_KEYS.has(key) ? JSON.stringify(value) : String(value) },
          create: { key, value: JSON_KEYS.has(key) ? JSON.stringify(value) : String(value) },
        })
      )
    );
    res.json({ message: 'Configuración de comisiones actualizada' });
  } catch (err) { next(err); }
};

module.exports = { getAll, update, getCommissionConfig, updateCommissionConfig };
