// ═══════════════════════════════════════════════════════════════
// Tests para aiExtractor — cubren feature opt-in y degradación graceful.
// ═══════════════════════════════════════════════════════════════

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractTarjetaPropiedad, isExtractionEnabled, TARJETA_TOOL, MODEL } = require('../aiExtractor');

// Cliente mock: registra la llamada y devuelve una respuesta configurable.
function mockClient(response, { throws = null } = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        if (throws) throw throws;
        return response;
      },
    },
  };
}

function imageFile() {
  return { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimetype: 'image/png', originalname: 't.png' };
}

const TOOL_USE_OK = {
  content: [
    {
      type: 'tool_use',
      name: 'report_tarjeta_propiedad',
      input: {
        plate: 'ABC123', brand: 'Renault', model: 'Sandero', year: 2021,
        color: 'Gris', engine: 'M123', chassis: 'C456', owner: 'Juan',
      },
    },
  ],
};

describe('aiExtractor', () => {
  test('isExtractionEnabled refleja ANTHROPIC_API_KEY en el entorno', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(isExtractionEnabled(), false);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    assert.equal(isExtractionEnabled(), true);
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  test('devuelve null sin cliente (feature off)', async () => {
    const result = await extractTarjetaPropiedad(imageFile(), { client: null });
    assert.equal(result, null);
  });

  test('devuelve null si el archivo no es imagen ni PDF', async () => {
    const client = mockClient(TOOL_USE_OK);
    const result = await extractTarjetaPropiedad(
      { buffer: Buffer.from('x'), mimetype: 'text/plain' },
      { client }
    );
    assert.equal(result, null);
    assert.equal(client.calls.length, 0, 'no debe llamar al SDK');
  });

  test('devuelve null si no hay archivo', async () => {
    const client = mockClient(TOOL_USE_OK);
    assert.equal(await extractTarjetaPropiedad(null, { client }), null);
    assert.equal(client.calls.length, 0);
  });

  test('devuelve los campos cuando la respuesta trae un tool_use válido', async () => {
    const client = mockClient(TOOL_USE_OK);
    const result = await extractTarjetaPropiedad(imageFile(), { client });
    assert.deepEqual(result, TOOL_USE_OK.content[0].input);
  });

  test('llama al SDK con modelo, tool forzado y bloque image para imágenes', async () => {
    const client = mockClient(TOOL_USE_OK);
    await extractTarjetaPropiedad(imageFile(), { client });
    const call = client.calls[0];
    assert.equal(call.model, MODEL);
    assert.deepEqual(call.tool_choice, { type: 'tool', name: TARJETA_TOOL.name });
    assert.equal(call.tools[0].name, TARJETA_TOOL.name);
    const block = call.messages[0].content[0];
    assert.equal(block.type, 'image');
    assert.equal(block.source.media_type, 'image/png');
    assert.ok(typeof block.source.data === 'string' && block.source.data.length > 0);
  });

  test('usa bloque document con media_type application/pdf para PDFs', async () => {
    const client = mockClient(TOOL_USE_OK);
    const pdf = { buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]), mimetype: 'application/pdf', originalname: 't.pdf' };
    await extractTarjetaPropiedad(pdf, { client });
    const block = client.calls[0].messages[0].content[0];
    assert.equal(block.type, 'document');
    assert.equal(block.source.media_type, 'application/pdf');
  });

  test('devuelve null si la respuesta no trae el tool_use esperado', async () => {
    const client = mockClient({ content: [{ type: 'text', text: 'no tool' }] });
    const result = await extractTarjetaPropiedad(imageFile(), { client });
    assert.equal(result, null);
  });

  test('propaga el error del SDK (el caller decide si lo silencia)', async () => {
    const client = mockClient(null, { throws: new Error('429 overloaded') });
    await assert.rejects(
      () => extractTarjetaPropiedad(imageFile(), { client }),
      /429 overloaded/
    );
  });
});
