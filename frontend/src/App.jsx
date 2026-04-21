// ═══════════════════════════════════════════════════════════════
// App — Root component con routing y layout
// ═══════════════════════════════════════════════════════════════

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';
import KanbanPage from '@/pages/KanbanPage';
import DashboardPage from '@/pages/DashboardPage';
import VehiclesPage from '@/pages/VehiclesPage';
import VehicleDetailPage from '@/pages/VehicleDetailPage';
import ExpensesPage from '@/pages/ExpensesPage';
import SettingsPage from '@/pages/SettingsPage';
// Treasury
import TreasuryPage from '@/pages/treasury/TreasuryPage';
import AccountsPage from '@/pages/treasury/AccountsPage';
import ThirdPartiesPage from '@/pages/treasury/ThirdPartiesPage';
import TransactionsPage from '@/pages/treasury/TransactionsPage';
import CashCountPage from '@/pages/treasury/CashCountPage';
import PayablesPage from '@/pages/treasury/PayablesPage';
// Alerts
import AlertsPage from '@/pages/AlertsPage';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0D1117]">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-[#BC8CFF] flex items-center justify-center text-xl font-extrabold text-[#0D1117] mx-auto mb-4">AC</div>
          <div className="text-lg font-semibold text-[#E6EDF3]">AutoControl</div>
          <div className="w-24 h-0.5 bg-border rounded mt-4 mx-auto overflow-hidden">
            <div className="w-2/5 h-full bg-accent rounded" style={{ animation: 'loadSlide 1.2s ease infinite' }} />
          </div>
        </div>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { isAuthenticated } = useAuth();

  return (
    <>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />

        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<KanbanPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="vehicles" element={<VehiclesPage />} />
          <Route path="vehicles/:id" element={<VehicleDetailPage />} />
          <Route path="treasury" element={<TreasuryPage />} />
          <Route path="treasury/accounts" element={<AccountsPage />} />
          <Route path="treasury/third-parties" element={<ThirdPartiesPage />} />
          <Route path="treasury/transactions" element={<TransactionsPage />} />
          <Route path="treasury/cash-count" element={<CashCountPage />} />
          <Route path="treasury/payables" element={<PayablesPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global toast — rendered from AppContext */}
    </>
  );
}
