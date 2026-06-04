// ═══════════════════════════════════════════════════════════════
// Commission Service — Cálculo de bolsillos y participantes
//
// Stateless helpers que toman una "operación de venta" y devuelven
// los objetos que saleService debe persistir (SaleParticipant, Payable
// COMMISSION, Transfer). NO toca la DB directamente; recibe lo que
// necesita y devuelve plain objects.
// ═══════════════════════════════════════════════════════════════

const { calculateCommissionBase } = require('../utils/financial');
const { AppError } = require('../middleware/errorHandler');

const COMMISSION_CONFIG_KEYS = [
  'commission_share_pct',
  'reinvest_share_pct',
  'tax_share_pct',
  'default_captador_pct',
  'default_cerrador_pct',
  'reinvest_account_id',
  'tax_reserve_account_id',
];

/**
 * Lee Settings por key y devuelve un objeto {key: numericOrString}.
 * Falla si falta alguna key esperada (señal de migración no aplicada).
 */
async function loadCommissionConfig(prismaOrTx) {
  const rows = await prismaOrTx.setting.findMany({
    where: { key: { in: COMMISSION_CONFIG_KEYS } },
  });
  const cfg = {};
  rows.forEach(r => { cfg[r.key] = r.value; });
  const missing = COMMISSION_CONFIG_KEYS.filter(k => !(k in cfg));
  if (missing.length > 0) {
    throw new AppError(`Settings de comisiones faltantes: ${missing.join(', ')}`, 500);
  }
  return {
    commissionPct:        Number(cfg.commission_share_pct),
    reinvestPct:          Number(cfg.reinvest_share_pct),
    taxPct:               Number(cfg.tax_share_pct),
    defaultCaptadorPct:   Number(cfg.default_captador_pct),
    defaultCerradorPct:   Number(cfg.default_cerrador_pct),
    reinvestAccountId:    cfg.reinvest_account_id,
    taxReserveAccountId:  cfg.tax_reserve_account_id,
  };
}

/**
 * Resuelve la lista de participantes para una venta:
 * - Si saleData.participants viene, valida que sume 100 y que cada thirdPartyId exista.
 * - Si no viene, devuelve el default: el ThirdParty "owner-self" como CERRADOR 100%.
 *
 * Devuelve [{ thirdPartyId, role, sharePct }].
 */
async function resolveParticipants(prismaOrTx, saleParticipants) {
  if (Array.isArray(saleParticipants) && saleParticipants.length > 0) {
    const sum = saleParticipants.reduce((acc, p) => acc + Number(p.sharePct || 0), 0);
    if (Math.abs(sum - 100) > 0.001) {
      throw new AppError(`participants[].sharePct debe sumar 100 (recibido: ${sum})`, 400);
    }
    const ids = saleParticipants.map(p => p.thirdPartyId);
    const found = await prismaOrTx.thirdParty.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const foundIds = new Set(found.map(f => f.id));
    const missing = ids.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      throw new AppError(`Terceros no encontrados: ${missing.join(', ')}`, 400);
    }
    return saleParticipants.map(p => ({
      thirdPartyId: p.thirdPartyId,
      role: p.role,
      sharePct: Number(p.sharePct),
    }));
  }

  // Default: owner-self como CERRADOR 100%
  const owner = await prismaOrTx.thirdParty.findUnique({
    where: { id: 'owner-self' },
    select: { id: true },
  });
  if (!owner) {
    throw new AppError(
      'Tercero default "owner-self" no encontrado. ¿Falta correr la migración de comisiones?',
      500
    );
  }
  return [{ thirdPartyId: 'owner-self', role: 'CERRADOR', sharePct: 100 }];
}

/**
 * Calcula los tres "pools" (montos absolutos) a partir de la base de comisión.
 */
function calculatePools(commissionBase, cfg) {
  return {
    commissionPool: commissionBase * (cfg.commissionPct / 100),
    reinvestPool:   commissionBase * (cfg.reinvestPct / 100),
    taxPool:        commissionBase * (cfg.taxPct / 100),
  };
}

/**
 * Calcula el ratio de efectivo recibido vs total (incluye cruce y CxC).
 */
function calculateCashRatio(totalReceived, cashReceived) {
  if (totalReceived <= 0) return 0;
  return cashReceived / totalReceived;
}

module.exports = {
  loadCommissionConfig,
  resolveParticipants,
  calculatePools,
  calculateCashRatio,
  calculateCommissionBase, // re-export for convenience
  COMMISSION_CONFIG_KEYS,
};
