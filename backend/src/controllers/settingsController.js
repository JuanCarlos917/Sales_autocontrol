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

module.exports = { getAll, update };
