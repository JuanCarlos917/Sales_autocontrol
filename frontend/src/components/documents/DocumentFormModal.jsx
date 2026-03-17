import { useState, useRef } from 'react';
import { useApp } from '@/contexts/AppContext';
import { DOC_TYPES } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import { Select, Input } from '@/components/shared/FormFields';

export default function DocumentFormModal({ vehicleId, onClose }) {
  const { uploadDocument } = useApp();
  const [docType, setDocType] = useState('TARJETA_PROPIEDAD');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target.result);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
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
          <div onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer bg-[#0F1419] hover:bg-surface-hover transition-colors">
            {preview ? (
              <img src={preview} alt="" className="max-w-full max-h-48 rounded-lg mx-auto" />
            ) : file ? (
              <div className="text-sm text-[#8B949E]">📄 {file.name}</div>
            ) : (
              <div className="text-[#6E7681] text-sm">
                📷 Click para seleccionar archivo<br />
                <span className="text-xs">JPG, PNG, WebP, PDF — Máx 10MB</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*,.pdf" onChange={handleFile} className="hidden" />
        </div>

        <Input label="Notas" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Vence en diciembre 2026..." />
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        <button onClick={handleSave} disabled={loading || !file} className="btn-primary">
          {loading ? 'Subiendo...' : 'Guardar Documento'}
        </button>
      </div>
    </Modal>
  );
}
