import { X } from 'lucide-react';

export default function Modal({ children, onClose, title, width = 'max-w-lg', isOpen = true }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fade-in" onClick={onClose}>
      <div className={`${width} w-full max-h-[92vh] overflow-y-auto bg-surface rounded-2xl border border-border animate-scale-in`} onClick={e => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-base font-bold">{title}</h2>
            <button onClick={onClose} className="btn-ghost px-2 py-1" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
