// ═══════════════════════════════════════════════════════════════
// AlertsPanel — Panel de alertas del sistema
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { alertsApi } from '@/lib/alertsApi';
import Alert, { AlertBadge } from './Alert';
import { Bell } from 'lucide-react';

export default function AlertsPanel({ className = '', compact = false }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const { data } = await alertsApi.getAll();
      setAlerts(data || []);
    } catch (err) {
      console.error('Error loading alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`card p-4 animate-pulse ${className}`}>
        <div className="h-4 bg-surface-hover rounded w-24 mb-3" />
        <div className="h-16 bg-surface-hover rounded" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return null;
  }

  const errorCount = alerts.filter(a => a.type === 'error').length;
  const warningCount = alerts.filter(a => a.type === 'warning').length;

  const displayAlerts = expanded ? alerts : alerts.slice(0, compact ? 2 : 3);

  return (
    <div className={`card p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-[#E6EDF3]" />
          <h3 className="text-sm font-semibold text-[#E6EDF3]">
            Alertas del Sistema
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {errorCount > 0 && <AlertBadge count={errorCount} type="error" />}
          {warningCount > 0 && <AlertBadge count={warningCount} type="warning" />}
        </div>
      </div>

      <div className="space-y-3">
        {displayAlerts.map((alert) => (
          <Alert
            key={alert.id}
            type={alert.type}
            title={alert.title}
            message={alert.message}
            details={compact ? [] : alert.details}
            dismissible={false}
          />
        ))}
      </div>

      {alerts.length > displayAlerts.length && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full mt-3 text-center text-xs text-accent hover:text-accent/80 transition-colors"
        >
          Ver {alerts.length - displayAlerts.length} alertas mas →
        </button>
      )}

      {expanded && alerts.length > 3 && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full mt-3 text-center text-xs text-[#6E7681] hover:text-[#8B949E] transition-colors"
        >
          Mostrar menos
        </button>
      )}
    </div>
  );
}

export function AlertsIndicator({ className = '' }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    loadSummary();
    const interval = setInterval(loadSummary, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadSummary = async () => {
    try {
      const { data } = await alertsApi.getSummary();
      setSummary(data);
    } catch (err) {
      console.error('Error loading alerts summary:', err);
    }
  };

  if (!summary || summary.total === 0) return null;

  const hasErrors = summary.byType.error > 0;
  const hasWarnings = summary.byType.warning > 0;

  return (
    <Link
      to="/alerts"
      className={`relative inline-flex items-center justify-center ${className}`}
      title={`${summary.total} alerta${summary.total > 1 ? 's' : ''}`}
    >
      <Bell className="w-5 h-5" />
      {summary.total > 0 && (
        <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full text-white ${
          hasErrors ? 'bg-red-500' : hasWarnings ? 'bg-amber-500' : 'bg-blue-500'
        }`}>
          {summary.total > 9 ? '9+' : summary.total}
        </span>
      )}
    </Link>
  );
}
