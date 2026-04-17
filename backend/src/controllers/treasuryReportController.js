// ═══════════════════════════════════════════════════════════════
// Controller — Treasury Reports
// ═══════════════════════════════════════════════════════════════

const treasuryReportService = require('../services/treasuryReportService');

const getDashboard = async (req, res, next) => {
  try {
    const dashboard = await treasuryReportService.getDashboard();
    res.json(dashboard);
  } catch (err) { next(err); }
};

const getCashFlow = async (req, res, next) => {
  try {
    const { startDate, endDate, period, groupBy } = req.query;
    const cashFlow = await treasuryReportService.getCashFlow({ startDate, endDate, period, groupBy });
    res.json(cashFlow);
  } catch (err) { next(err); }
};

const getProjection = async (req, res, next) => {
  try {
    const projection = await treasuryReportService.getCashFlowProjection();
    res.json(projection);
  } catch (err) { next(err); }
};

const getVehicleTransactions = async (req, res, next) => {
  try {
    const result = await treasuryReportService.getVehicleTransactions(req.params.vehicleId);
    if (!result) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }
    res.json(result);
  } catch (err) { next(err); }
};

module.exports = { getDashboard, getCashFlow, getProjection, getVehicleTransactions };
