import { useState } from 'react';
import { DOC_TYPES, formatDate } from '@/lib/constants';

// Tarjeta de documento: vista previa (imagen) o ícono+nombre (PDF/otros),
// con acciones Ver / Descargar / Eliminar. El borrado pide confirmación en línea.
export default function DocumentCard({ doc, onView, onDelete, isViewer }) {
  const [confirming, setConfirming] = useState(false);

  const isImage = doc.mimetype?.startsWith('image/');
  const typeLabel = DOC_TYPES.find((t) => t.id === doc.type)?.label || doc.type;

  return (
    <div className="bg-surface border border-border rounded-xl p-3 flex flex-col" data-testid="document-card">
      <div className="text-[13px] font-semibold mb-2 truncate" title={typeLabel}>{typeLabel}</div>

      {/* Vista previa clicable → abre el visor */}
      <button
        type="button"
        onClick={() => onView(doc)}
        className="block w-full mb-2 rounded-lg overflow-hidden bg-[#0F1419] hover:opacity-90 transition-opacity"
        title="Ver documento"
        data-testid="document-preview"
      >
        {isImage ? (
          <img src={doc.url} alt={typeLabel} className="w-full max-h-40 object-cover" />
        ) : (
          <div className="flex flex-col items-center justify-center py-7 text-[#6E7681]">
            <span className="text-3xl">📄</span>
            <span className="text-[11px] mt-1 px-2 truncate max-w-full">{doc.filename}</span>
          </div>
        )}
      </button>

      {doc.notes && <div className="text-[11px] text-[#6E7681] mb-2 line-clamp-2">{doc.notes}</div>}

      <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-[#6E7681]">
        <span>{formatDate(doc.createdAt)}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onView(doc)} className="text-accent hover:underline" data-testid="document-view">Ver</button>
          <a href={doc.url} download={doc.filename} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Descargar</a>
          {!isViewer && (
            confirming ? (
              <span className="flex items-center gap-1">
                <span className="text-[#F85149]">¿Eliminar?</span>
                <button
                  type="button"
                  onClick={() => { setConfirming(false); onDelete(doc.id); }}
                  className="text-[#F85149] font-semibold"
                  data-testid="document-delete-confirm"
                >
                  Sí
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="text-[#8B949E]">No</button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-[#F85149] hover:opacity-80"
                title="Eliminar"
                data-testid="document-delete"
              >
                ✕
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
