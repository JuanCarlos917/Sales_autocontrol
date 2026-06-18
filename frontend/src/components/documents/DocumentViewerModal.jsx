import Modal from '@/components/shared/Modal';
import { DOC_TYPES } from '@/lib/constants';
import { Download } from 'lucide-react';

// Visor de documentos: imagen a tamaño completo o PDF embebido, con descarga.
export default function DocumentViewerModal({ doc, onClose }) {
  if (!doc) return null;

  const isImage = doc.mimetype?.startsWith('image/');
  const isPdf = doc.mimetype === 'application/pdf' || doc.filename?.toLowerCase().endsWith('.pdf');
  const typeLabel = DOC_TYPES.find((t) => t.id === doc.type)?.label || doc.type;

  return (
    <Modal onClose={onClose} title={typeLabel} width="max-w-3xl">
      <div className="space-y-4">
        <div className="bg-[#0F1419] rounded-xl overflow-hidden flex items-center justify-center" style={{ minHeight: '55vh' }}>
          {isImage ? (
            <img src={doc.url} alt={typeLabel} className="max-w-full max-h-[72vh] object-contain" />
          ) : isPdf ? (
            <iframe src={doc.url} title={typeLabel} className="w-full" style={{ height: '72vh' }} />
          ) : (
            <div className="text-[#6E7681] text-sm p-10 text-center">
              No hay vista previa para este tipo de archivo. Usa Descargar para abrirlo.
            </div>
          )}
        </div>

        {doc.notes && <p className="text-[12px] text-[#8B949E]">{doc.notes}</p>}

        <div className="flex justify-end">
          <a
            href={doc.url}
            download={doc.filename}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            data-testid="document-download"
          >
            <span className="inline-flex items-center gap-1.5"><Download className="w-4 h-4" /> Descargar</span>
          </a>
        </div>
      </div>
    </Modal>
  );
}
