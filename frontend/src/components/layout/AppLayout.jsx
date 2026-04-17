// ═══════════════════════════════════════════════════════════════
// Layout — Shell con sidebar, topbar, responsive
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import Toast from '@/components/shared/Toast';
import { AlertsIndicator } from '@/components/shared/AlertsPanel';

const NAV_ITEMS = [
  { to: '/', label: 'Pipeline', icon: '▦', end: true },
  { to: '/dashboard', label: 'Dashboard', icon: '◩' },
  { to: '/vehicles', label: 'Vehículos', icon: '☰' },
  { to: '/treasury', label: 'Tesorería', icon: '◈' },
  { to: '/expenses', label: 'Gastos', icon: '⊘' },
  { to: '/settings', label: 'Config', icon: '⚙' },
];

export default function AppLayout() {
  const { logout } = useAuth();
  const { toast, exportCSV } = useApp();
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
        {NAV_ITEMS.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} className={navLinkClass}>
            <span className="w-5 text-center text-sm">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-border">
        <button onClick={exportCSV} className="btn-ghost w-full mb-2 text-xs">⬇ Exportar CSV</button>
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
              <button onClick={() => setSidebarOpen(true)} className="text-xl text-[#E6EDF3]">☰</button>
            )}
            <h1 className="text-lg font-bold text-[#E6EDF3] tracking-tight">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
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
          {NAV_ITEMS.slice(0, 4).map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 ${isActive ? 'text-accent' : 'text-[#6E7681]'}`
            }>
              <span className="text-lg">{n.icon}</span>
              <span className="text-[10px]">{n.label}</span>
            </NavLink>
          ))}
        </nav>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type} />}
    </div>
  );
}
