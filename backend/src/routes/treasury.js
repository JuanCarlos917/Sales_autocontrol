// ═══════════════════════════════════════════════════════════════
// Routes — Treasury (Tesorería)
// ═══════════════════════════════════════════════════════════════

const { Router } = require('express');
const { validate, schemas } = require('../middleware/validation');
const { authorize } = require('../middleware/auth');

// Controllers
const accountCtrl = require('../controllers/accountController');
const thirdPartyCtrl = require('../controllers/thirdPartyController');
const transactionCtrl = require('../controllers/transactionController');
const transferCtrl = require('../controllers/transferController');
const cashCountCtrl = require('../controllers/cashCountController');
const reportCtrl = require('../controllers/treasuryReportController');
const auditCtrl = require('../controllers/treasuryAuditController');

const router = Router();

// Todas las rutas requieren autenticación

// ══════════════════════════════════════════════════════════════
// REPORTES Y DASHBOARD
// ══════════════════════════════════════════════════════════════
router.get('/dashboard', reportCtrl.getDashboard);
router.get('/audit', auditCtrl.list);
router.get('/reports/cash-flow', reportCtrl.getCashFlow);
router.get('/reports/projection', reportCtrl.getProjection);
router.get('/reports/vehicle/:vehicleId', reportCtrl.getVehicleTransactions);

// ══════════════════════════════════════════════════════════════
// CUENTAS
// ══════════════════════════════════════════════════════════════
router.get('/accounts', accountCtrl.getAll);
router.get('/accounts/total', accountCtrl.getTotalBalance);
router.get('/accounts/:id', accountCtrl.getOne);
router.post('/accounts', validate(schemas.account), accountCtrl.create);
router.put('/accounts/:id', validate(schemas.accountUpdate), accountCtrl.update);
router.delete('/accounts/:id', accountCtrl.remove);
router.post('/accounts/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), accountCtrl.reverse);

// ══════════════════════════════════════════════════════════════
// TERCEROS
// ══════════════════════════════════════════════════════════════
router.get('/third-parties', thirdPartyCtrl.getAll);
router.get('/third-parties/:id', thirdPartyCtrl.getOne);
router.get('/third-parties/:id/statement', thirdPartyCtrl.getStatement);
router.post('/third-parties', validate(schemas.thirdParty), thirdPartyCtrl.create);
router.put('/third-parties/:id', validate(schemas.thirdParty), thirdPartyCtrl.update);
router.delete('/third-parties/:id', thirdPartyCtrl.remove);

// ══════════════════════════════════════════════════════════════
// MOVIMIENTOS
// ══════════════════════════════════════════════════════════════
router.get('/transactions', transactionCtrl.getAll);
router.get('/transactions/summary', transactionCtrl.getSummary);
router.get('/transactions/vehicle/:vehicleId', transactionCtrl.getByVehicle);
router.get('/transactions/:id', transactionCtrl.getOne);
router.post('/transactions/income', validate(schemas.income), transactionCtrl.createIncome);
router.post('/transactions/expense', validate(schemas.expenseTreasury), transactionCtrl.createExpense);
router.put('/transactions/:id', validate(schemas.transactionUpdate), transactionCtrl.update);
router.post('/transactions/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), transactionCtrl.reverse);
// Movimientos inmutables: ya no hay DELETE. Las correcciones se hacen
// editando el gasto origen o creando un movimiento de ajuste.

// ══════════════════════════════════════════════════════════════
// TRANSFERENCIAS
// ══════════════════════════════════════════════════════════════
router.get('/transfers', transferCtrl.getAll);
router.get('/transfers/:id', transferCtrl.getOne);
router.post('/transfers', validate(schemas.transfer), transferCtrl.create);
// Transferencias inmutables: ya no hay DELETE. Una transferencia errada
// se compensa con otra transferencia en sentido opuesto.

// ══════════════════════════════════════════════════════════════
// ARQUEOS
// ══════════════════════════════════════════════════════════════
router.get('/cash-counts', cashCountCtrl.getAll);
router.get('/cash-counts/account/:accountId/last', cashCountCtrl.getLastByAccount);
router.get('/cash-counts/:id', cashCountCtrl.getOne);
router.post('/cash-counts', validate(schemas.cashCount), cashCountCtrl.create);
router.post('/cash-counts/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), cashCountCtrl.reverse);

module.exports = router;
