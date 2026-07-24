'use strict';
// ═══════════════════════════════════════════════════════════════
// Deal chain — carga y recorrido de cadenas de cruces.
// Compartido entre vehicleService (métricas de vitrina del pipeline)
// y saleService/commissionService (cierre del negocio con cruce).
// Todas las funciones aceptan prisma o un tx de $transaction.
// ═══════════════════════════════════════════════════════════════

const MAX_CHAIN_DEPTH = 10;

// Selección mínima para calcular ganancia directa de un eslabón + resolver
// el socio de la cadena al cierre (partnerId/participation/partnerContribution).
const DEAL_CHAIN_SELECT = {
  id: true, plate: true, stage: true, salePrice: true, purchasePrice: true,
  negotiatedValue: true, fromTradeIn: true, saleDate: true, sourceVehicleId: true,
  partnerId: true, participation: true, partnerContribution: true,
  expenses: { select: { amount: true, deletedAt: true } },
  tradeInsReceived: { select: { id: true } },
};

function toChainNode(v) {
  return {
    id: v.id, plate: v.plate, stage: v.stage,
    salePrice: v.salePrice, purchasePrice: v.purchasePrice,
    negotiatedValue: v.negotiatedValue ?? null, fromTradeIn: v.fromTradeIn ?? false,
    saleDate: v.saleDate, sourceVehicleId: v.sourceVehicleId,
    partnerId: v.partnerId ?? null,
    participation: v.participation ?? null,
    partnerContribution: v.partnerContribution ?? null,
    expenses: (v.expenses || []).map((e) => ({ amount: e.amount, deletedAt: e.deletedAt })),
    tradeInIds: (v.tradeInsReceived || []).map((t) => t.id),
  };
}

// Cierra transitivamente el grafo de cruces: sube por sourceVehicleId y baja
// por tradeInsReceived, trayendo de la DB los eslabones que no vinieron en la
// lista original. Cap defensivo de profundidad MAX_CHAIN_DEPTH.
async function loadDealChainNodes(prismaOrTx, vehicles) {
  const known = new Map(vehicles.map((v) => [v.id, toChainNode(v)]));
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const missing = new Set();
    for (const node of known.values()) {
      if (node.sourceVehicleId && !known.has(node.sourceVehicleId)) missing.add(node.sourceVehicleId);
      for (const tid of node.tradeInIds) if (!known.has(tid)) missing.add(tid);
    }
    if (missing.size === 0) break;
    const rows = await prismaOrTx.vehicle.findMany({
      where: { id: { in: [...missing] } },
      select: DEAL_CHAIN_SELECT,
    });
    if (rows.length === 0) break; // referencias rotas (SetNull/borrados)
    for (const r of rows) known.set(r.id, toChainNode(r));
  }
  return known;
}

// Miembros de la cadena en orden de linaje: raíz primero, DFS por cruces.
function chainMembersFor(rootId, known) {
  const out = [];
  const walk = (id) => {
    const node = known.get(id);
    if (!node || out.includes(node)) return;
    out.push(node);
    for (const tid of node.tradeInIds) walk(tid);
  };
  walk(rootId);
  return out;
}

// Sube por sourceVehicleId hasta la raíz conocida de la cadena.
function rootIdFor(id, known) {
  let cur = known.get(id);
  let guard = 0;
  while (cur && cur.sourceVehicleId && known.has(cur.sourceVehicleId) && guard++ < MAX_CHAIN_DEPTH) {
    cur = known.get(cur.sourceVehicleId);
  }
  return cur ? cur.id : id;
}

// Cadena completa (orden de linaje) a partir de cualquier eslabón.
async function loadChainMembers(prismaOrTx, vehicleId) {
  const rows = await prismaOrTx.vehicle.findMany({
    where: { id: vehicleId },
    select: DEAL_CHAIN_SELECT,
  });
  if (rows.length === 0) return [];
  const known = await loadDealChainNodes(prismaOrTx, rows);
  return chainMembersFor(rootIdFor(vehicleId, known), known);
}

module.exports = {
  DEAL_CHAIN_SELECT, toChainNode, loadDealChainNodes,
  chainMembersFor, rootIdFor, loadChainMembers,
};
