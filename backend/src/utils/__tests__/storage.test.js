const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const config = require('../../config');
const storage = require('../storage');

// Estos tests cubren el camino por defecto (disco local), que es el que corre sin S3_BUCKET.
test('isS3Enabled: false cuando no hay S3_BUCKET', () => {
  assert.equal(storage.isS3Enabled(), false);
});

test('persistUpload (disco): devuelve la ruta que multer ya escribió', async () => {
  const fakeFile = { path: '/tmp/uploads/abc/file-1.png', originalname: 'file.png', mimetype: 'image/png' };
  const result = await storage.persistUpload(fakeFile, 'abc');
  assert.equal(result, fakeFile.path);
});

test('getUrl (disco): construye /uploads/<relativo>', async () => {
  const filepath = path.join(config.upload.dir, 'veh-1', 'file-9.png');
  const url = await storage.getUrl(filepath);
  assert.equal(url, '/uploads/veh-1/file-9.png');
});

test('getUrl: null si no hay filepath', async () => {
  assert.equal(await storage.getUrl(null), null);
});
