// ═══════════════════════════════════════════════════════════════
// Controller — Dashboard
// ═══════════════════════════════════════════════════════════════

const dashboardService = require('../services/dashboardService');

const getOverview = async (req, res, next) => {
  try {
    const data = await dashboardService.getOverview(req.user.id);
    res.json(data);
  } catch (err) { next(err); }
};

const getProjection = async (req, res, next) => {
  try {
    const { purchasePrice, estimatedExpenses, salePrice, estimatedDays, participation } = req.body;
    const result = await dashboardService.getProjection({
      purchasePrice: parseFloat(purchasePrice) || 0,
      estimatedExpenses: parseFloat(estimatedExpenses) || 0,
      salePrice: parseFloat(salePrice) || 0,
      estimatedDays: parseInt(estimatedDays) || 20,
      participation: parseFloat(participation) || 1,
    });
    res.json(result);
  } catch (err) { next(err); }
};

module.exports = { getOverview, getProjection };
