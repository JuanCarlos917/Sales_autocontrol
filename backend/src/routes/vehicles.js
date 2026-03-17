const { Router } = require('express');
const ctrl = require('../controllers/vehicleController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.use(authenticate);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', validate(schemas.vehicle), ctrl.create);
router.put('/:id', validate(schemas.vehicle), ctrl.update);
router.patch('/:id/stage', validate(schemas.vehicleStage), ctrl.updateStage);
router.delete('/:id', ctrl.remove);

module.exports = router;
