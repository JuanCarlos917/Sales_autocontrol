const { Router } = require('express');
const ctrl = require('../controllers/documentController');
const upload = require('../middleware/upload');

const router = Router();


router.get('/vehicle/:vehicleId', ctrl.getByVehicle);
router.post('/vehicle/:vehicleId', upload.single('file'), ctrl.create);
router.delete('/:id', ctrl.remove);

module.exports = router;
