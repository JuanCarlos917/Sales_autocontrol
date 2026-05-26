-- Campo para guardar los datos extraídos por IA al subir un documento
-- (p. ej. placa, marca, modelo desde una tarjeta de propiedad).
ALTER TABLE "documents" ADD COLUMN "extractedData" JSONB;
