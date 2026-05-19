export default function Toast({ message, type = 'success', action, onDismiss }) {
  const bg = type === 'danger' ? 'bg-[#F85149]' : type === 'warning' ? 'bg-[#D29922]' : 'bg-[#3FB950]';
  return (
    <div
      className={`fixed bottom-6 right-6 ${bg} text-white px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl z-[200] animate-slide-up flex items-center gap-3`}
      data-testid="app-toast"
    >
      <span>{message}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="px-3 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors text-xs font-bold"
          data-testid="toast-action"
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-white/70 hover:text-white text-base leading-none ml-1"
          aria-label="Cerrar"
        >
          ×
        </button>
      )}
    </div>
  );
}
