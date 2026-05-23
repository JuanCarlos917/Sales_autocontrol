import { useState, useRef } from 'react';
import { useApp } from '@/contexts/AppContext';
import { DOC_TYPES } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import { Select, Input } from '@/components/shared/FormFields';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function DocumentFormModal({ vehicleId, onClose }) {
  const { uploadDocument } = useApp();
  const [docType, setDocType] = useState('TARJETA_PROPIEDAD');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState(null);
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
      await uploadDocument(vehicleId, formData);
      onClose();
    } catch {} finally { setLoading(false); }
  };

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
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        <button onClick={handleSave} disabled={loading || !file} className="btn-primary" data-testid="document-save">
          {loading ? 'Subiendo...' : 'Guardar Documento'}
        </button>
      </div>
    </Modal>
  );
}
