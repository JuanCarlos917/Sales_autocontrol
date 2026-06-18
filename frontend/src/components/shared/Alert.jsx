// ═══════════════════════════════════════════════════════════════
// Alert — Componente de alerta reutilizable
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2, X } from 'lucide-react';

const ALERT_TYPES = {
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    text: 'text-red-400',
    icon: AlertCircle,
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    text: 'text-amber-400',
    icon: AlertTriangle,
  },
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/40',
    text: 'text-blue-400',
    icon: Info,
  },
  success: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/40',
    text: 'text-green-400',
    icon: CheckCircle2,
  },
};

export default function Alert({
  type = 'info',
  title,
  message,
  details = [],
  action,
  actionLabel,
  dismissible = false,
  onDismiss,
  className = '',
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const style = ALERT_TYPES[type] || ALERT_TYPES.info;

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  return (
    <div className={`p-4 rounded-lg border ${style.bg} ${style.border} ${className}`}>
      <div className="flex items-start gap-3">
        <style.icon className={`w-5 h-5 shrink-0 ${style.text}`} />
        <div className="flex-1 min-w-0">
          {title && (
            <div className={`text-sm font-semibold ${style.text} mb-1`}>
              {title}
            </div>
          )}
          {message && (
            <div className="text-sm text-[#8B949E]">
              {message}
            </div>
          )}
          {details.length > 0 && (
            <ul className="mt-2 space-y-1">
              {details.map((detail, idx) => (
                <li key={idx} className="text-xs text-[#6E7681] flex items-start gap-2">
                  <span className="text-[#6E7681]">•</span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          )}
          {action && actionLabel && (
            <button
              onClick={action}
              className={`mt-3 text-xs font-semibold ${style.text} hover:underline`}
            >
              {actionLabel} →
            </button>
          )}
        </div>
        {dismissible && (
          <button
            onClick={handleDismiss}
            className="text-[#6E7681] hover:text-[#8B949E] transition-colors p-1"
            aria-label="Cerrar alerta"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function AlertList({ alerts = [], className = '' }) {
  if (alerts.length === 0) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {alerts.map((alert, idx) => (
        <Alert key={alert.id || idx} {...alert} />
      ))}
    </div>
  );
}

export function AlertBadge({ count, type = 'warning', className = '' }) {
  if (!count || count <= 0) return null;

  const style = ALERT_TYPES[type] || ALERT_TYPES.warning;

  return (
    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold rounded-full ${style.bg} ${style.text} ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
