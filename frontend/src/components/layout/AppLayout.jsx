// ═══════════════════════════════════════════════════════════════
// Layout — Shell con sidebar, topbar, responsive
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import IdleWarningModal from '@/components/auth/IdleWarningModal';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import Toast from '@/components/shared/Toast';
import { AlertsIndicator } from '@/components/shared/AlertsPanel';
import { LayoutGrid, BarChart3, Car, Wallet, Receipt, Settings, Menu, Eye, Download } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Pipeline', icon: LayoutGrid, end: true },
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { to: '/vehicles', label: 'Vehículos', icon: Car },
  { to: '/treasury', label: 'Tesorería', icon: Wallet },
  { to: '/expenses', label: 'Gastos', icon: Receipt },
  { to: '/settings', label: 'Config', icon: Settings },
];

export default function AppLayout() {
  const { logout, role } = useAuth();
  const navigate = useNavigate();
  const handleIdleLogout = useCallback(async () => { await logout(); navigate('/login'); }, [logout, navigate]);
  const { warning: idleWarning, stayActive } = useIdleTimeout({ enabled: true, onIdle: handleIdleLogout });
  const isViewer = role === 'VIEWER';
  const { toast, exportCSV, dismissToast } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const location = useLocation();

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Close sidebar on navigate (mobile)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left ${
      isActive ? 'bg-accent/10 text-accent font-semibold' : 'text-[#8B949E] hover:bg-surface-hover'
    }`;

  const SidebarContent = () => (
    <>
      <div className="p-4 border-b border-border flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-[#BC8CFF] flex items-center justify-center text-sm font-extrabold text-[#0D1117] shrink-0">AC</div>
        <div>
          <div className="text-sm font-bold text-[#E6EDF3] tracking-tight">AutoControl</div>
          <div className="text-[10px] text-[#6E7681]">Admin Panel</div>
        </div>
      </div>
      <nav className="flex-1 p-2 flex flex-col gap-0.5">
        {NAV_ITEMS.map(n => {
          const Icon = n.icon;
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={navLinkClass}>
              <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
              {n.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <button onClick={exportCSV} className="btn-ghost w-full mb-2 text-xs inline-flex items-center justify-center gap-1.5"><Download className="w-3.5 h-3.5" /> Exportar CSV</button>
        <button onClick={logout} className="btn-ghost w-full text-xs">Cerrar sesión</button>
      </div>
    </>
  );

  const pageTitle = NAV_ITEMS.find(n =>
    n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)
  )?.label || 'AutoControl';

  return (
    <div className="flex min-h-screen bg-[#0D1117] font-sans text-[#E6EDF3]">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <aside className="w-56 bg-surface border-r border-border flex flex-col sticky top-0 h-screen shrink-0">
          <SidebarContent />
        </aside>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setSidebarOpen(false)}>
          <div className="w-64 h-full bg-surface border-r border-border flex flex-col animate-fade-in" onClick={e => e.stopPropagation()}>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-40 bg-surface border-b border-border px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)} className="text-[#E6EDF3]" aria-label="Abrir menú"><Menu className="w-6 h-6" /></button>
            )}
            <h1 className="text-lg font-bold text-[#E6EDF3] tracking-tight">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
            {isViewer && (
              <span
                className="text-[11px] font-semibold px-2 py-1 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30"
                title="Tu rol es de consulta: no puedes hacer cambios"
                data-testid="viewer-readonly-badge"
              >
                <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Solo lectura</span>
              </span>
            )}
            <AlertsIndicator />
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 pb-24 md:pb-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] z-40">
          {NAV_ITEMS.slice(0, 4).map(n => {
            const Icon = n.icon;
            return (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-3 py-1 ${isActive ? 'text-accent' : 'text-[#6E7681]'}`
              }>
                <Icon className="w-5 h-5" />
                <span className="text-[10px]">{n.label}</span>
              </NavLink>
            );
          })}
        </nav>
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.msg}
          type={toast.type}
          action={toast.action}
          onDismiss={toast.action ? dismissToast : undefined}
        />
      )}
      <IdleWarningModal isOpen={idleWarning} onStay={stayActive} onLogout={handleIdleLogout} />
    </div>
  );
}
