// ═══════════════════════════════════════════════════════════════
// AI Extractor — extracción de campos desde documentos vía Claude (vision)
//
// Hoy: solo tarjeta de propiedad (Colombia).
// La feature es opt-in: requiere ANTHROPIC_API_KEY en el entorno. Sin la key,
// las funciones devuelven null y el upload continúa normal.
// El SDK se inyecta como dependencia opcional para poder testear sin red.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');

const MODEL = 'claude-opus-4-8';

// Tool con schema estricto: forzar tool_choice garantiza JSON validado por el schema.
const TARJETA_TOOL = {
  name: 'report_tarjeta_propiedad',
  description:
    'Reporta los datos extraídos de la tarjeta de propiedad de un vehículo colombiano. ' +
    'Usa null en cualquier campo que no sea claramente legible o no aparezca. No inventes valores.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      plate:   { type: ['string', 'null'], description: 'Placa, ej. ABC123. Sin espacios.' },
      brand:   { type: ['string', 'null'], description: 'Marca, ej. Renault, Chevrolet.' },
      model:   { type: ['string', 'null'], description: 'Línea / modelo, ej. Sandero, Spark GT.' },
      year:    { type: ['integer', 'null'], description: 'Modelo (año), ej. 2021.' },
      color:   { type: ['string', 'null'], description: 'Color.' },
      engine:  { type: ['string', 'null'], description: 'Número de motor.' },
      chassis: { type: ['string', 'null'], description: 'Número de chasis / serie.' },
      owner:   { type: ['string', 'null'], description: 'Nombre del propietario.' },
    },
    required: ['plate', 'brand', 'model', 'year', 'color', 'engine', 'chassis', 'owner'],
  },
};

const PROMPT =
  'Esta imagen o PDF es la tarjeta de propiedad de un vehículo en Colombia. ' +
  'Extrae los datos exactamente como aparecen. Si un campo no es legible o no ' +
  'aparece, devuélvelo como null. No inventes valores. Devuelve el resultado ' +
  'llamando a la herramienta `report_tarjeta_propiedad`.';

/** Devuelve un cliente Anthropic listo, o null si no hay API key. */
function buildClient(apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) return null;
  const sdk = require('@anthropic-ai/sdk');
  const Anthropic = sdk.default || sdk.Anthropic || sdk;
  return new Anthropic({ apiKey });
}

/** True si la integración está habilitada (hay API key en el entorno). */
function isExtractionEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Lee el archivo: buffer en memoria (S3) o desde disco. */
async function getFileBuffer(file) {
  if (!file) return null;
  if (file.buffer) return file.buffer;
  if (file.path) return fs.promises.readFile(file.path);
  return null;
}

function buildContentBlock(buffer, mimetype) {
  const data = buffer.toString('base64');
  if (mimetype === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mimetype, data } };
}

/**
 * Extrae los datos de una tarjeta de propiedad desde un archivo subido (multer File).
 * Devuelve el objeto extraído (con campos posiblemente null) o null si la extracción
 * no se ejecutó, no aplicó al tipo de archivo o falló.
 *
 * `client` puede inyectarse en tests para no depender de la red.
 */
async function extractTarjetaPropiedad(file, { client = buildClient() } = {}) {
  if (!client) return null;
  if (!file || !file.mimetype) return null;

  const isImage = file.mimetype.startsWith('image/');
  const isPdf = file.mimetype === 'application/pdf';
  if (!isImage && !isPdf) return null;

  const buffer = await getFileBuffer(file);
  if (!buffer) return null;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [TARJETA_TOOL],
    tool_choice: { type: 'tool', name: TARJETA_TOOL.name },
    messages: [{
      role: 'user',
      content: [
        buildContentBlock(buffer, file.mimetype),
        { type: 'text', text: PROMPT },
      ],
    }],
  });

  const toolUse = (response.content || []).find(
    (b) => b.type === 'tool_use' && b.name === TARJETA_TOOL.name
  );
  return toolUse ? toolUse.input : null;
}

module.exports = {
  extractTarjetaPropiedad,
  isExtractionEnabled,
  // Exportados para tests:
  buildClient,
  getFileBuffer,
  TARJETA_TOOL,
  MODEL,
};
