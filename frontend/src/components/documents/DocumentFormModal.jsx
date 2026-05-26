import { useState, useRef } from 'react';
import { useApp } from '@/contexts/AppContext';
import { DOC_TYPES } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import { Select, Input } from '@/components/shared/FormFields';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Campos del vehículo que se pueden sugerir desde la tarjeta de propiedad.
const APPLY_FIELDS = [
  { key: 'plate', label: 'Placa' },
  { key: 'brand', label: 'Marca' },
  { key: 'model', label: 'Modelo' },
  { key: 'year', label: 'Año' },
  { key: 'color', label: 'Color' },
];

function pickApplicable(extracted) {
  if (!extracted) return {};
  const out = {};
  for (const { key } of APPLY_FIELDS) {
    const v = extracted[key];
    if (v !== null && v !== undefined && v !== '') out[key] = v;
  }
  return out;
}

export default function DocumentFormModal({ vehicleId, onClose }) {
  const { uploadDocument, updateVehicle } = useApp();
  const [docType, setDocType] = useState('TARJETA_PROPIEDAD');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [extracted, setExtracted] = useState(null); // panel con sugerencias de IA
  const fileRef = useRef(null);

  const isAllowed = (f) => f.type.startsWith('image/') || f.type === 'application/pdf';

  // Punto único de selección: lo usan tanto el input como el drop.
  const selectFile = (f) => {
    if (!f) return;
    if (!isAllowed(f)) {
      setFileError('Formato no permitido. Usa JPG, PNG, WebP o PDF.');
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError('El archivo supera el máximo de 10MB.');
      return;
    }
    setFileError(null);
    setFile(f);
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target.result);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  };

  const handleFile = (e) => selectFile(e.target.files?.[0]);

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    selectFile(e.dataTransfer.files?.[0]);
  };

  const handleSave = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', docType);
      formData.append('notes', notes);
      const doc = await uploadDocument(vehicleId, formData);
      const applicable = pickApplicable(doc?.extractedData);
      if (docType === 'TARJETA_PROPIEDAD' && Object.keys(applicable).length > 0) {
        // Mostrar panel de sugerencias en vez de cerrar.
        setExtracted(doc.extractedData);
      } else {
        onClose();
      }
    } catch {} finally { setLoading(false); }
  };

  const handleApply = async () => {
    setLoading(true);
    try {
      const payload = pickApplicable(extracted);
      if (Object.keys(payload).length > 0) {
        await updateVehicle(vehicleId, payload);
      }
      onClose();
    } catch {} finally { setLoading(false); }
  };

  const isTarjeta = docType === 'TARJETA_PROPIEDAD';
  const savingLabel = isTarjeta ? 'Subiendo y analizando…' : 'Subiendo…';

  // Vista 2: panel de sugerencias de IA (después de subir).
  if (extracted) {
    const applicable = pickApplicable(extracted);
    return (
      <Modal onClose={onClose} title="Datos detectados por IA" width="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-[#8B949E]">
            Encontramos estos datos en la tarjeta de propiedad. Revísalos antes de aplicarlos al vehículo.
          </p>
          <div className="rounded-xl border border-border bg-[#0F1419] p-4 space-y-2" data-testid="extracted-panel">
            {APPLY_FIELDS.map(({ key, label }) => {
              const value = applicable[key];
              return (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-[#8B949E]">{label}</span>
                  <span className={value ? 'text-[#E6EDF3] font-medium' : 'text-[#6E7681] italic'}>
                    {value ?? 'no detectado'}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-[#6E7681]">
            La IA puede equivocarse. Verifica los datos contra el documento antes de aplicar.
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost" disabled={loading} data-testid="extracted-dismiss">
            Cerrar sin aplicar
          </button>
          <button
            onClick={handleApply}
            className="btn-primary"
            disabled={loading || Object.keys(applicable).length === 0}
            data-testid="extracted-apply"
          >
            {loading ? 'Aplicando…' : 'Aplicar al vehículo'}
          </button>
        </div>
      </Modal>
    );
  }

  // Vista 1: formulario de subida.
  return (
    <Modal onClose={onClose} title="Agregar Documento / Foto" width="max-w-md">
      <div className="space-y-4">
        <Select label="Tipo de Documento" value={docType} onChange={e => setDocType(e.target.value)}
          options={DOC_TYPES.map(d => ({ value: d.id, label: d.label }))} />

        <div>
          <label className="label-sm">Archivo (Foto / PDF)</label>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-testid="document-dropzone"
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-accent bg-accent/10'
                : 'border-border bg-[#0F1419] hover:bg-surface-hover'
            }`}
          >
            {preview ? (
              <img src={preview} alt="" className="max-w-full max-h-48 rounded-lg mx-auto" />
            ) : file ? (
              <div className="text-sm text-[#8B949E]">📄 {file.name}</div>
            ) : (
              <div className="text-[#6E7681] text-sm">
                📷 {dragOver ? 'Suelta el archivo aquí' : 'Arrastra un archivo o haz click para seleccionar'}<br />
                <span className="text-xs">JPG, PNG, WebP, PDF — Máx 10MB</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*,.pdf" onChange={handleFile} className="hidden" />
          {fileError && (
            <p className="text-[12px] text-[#F85149] mt-1">{fileError}</p>
          )}
        </div>

        <Input label="Notas" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Vence en diciembre 2026..." />

        {isTarjeta && (
          <p className="text-[11px] text-[#8B949E]">
            ✨ Si la IA está habilitada en el servidor, al subir intentaremos extraer
            placa, marca, modelo, año y color para sugerirlos al vehículo.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        <button onClick={handleSave} disabled={loading || !file} className="btn-primary" data-testid="document-save">
          {loading ? savingLabel : 'Guardar Documento'}
        </button>
      </div>
    </Modal>
  );
}
