// ═══════════════════════════════════════════════════════════════
// Treasury Page — Dashboard Integrado de Tesorería
// Fase 8: Saldo, CxC, CxP, Flujo de Caja
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { treasuryReportsApi, transactionsApi, accountsApi } from '@/lib/treasuryApi';
import { payablesApi } from '@/lib/payablesApi';
import { formatCurrency } from '@/lib/constants';
import { BalanceCard, ReceivablesWidget, PayablesWidgetCxP, CashFlowChart, LoansSummaryCards, SocioPendingWidget } from '@/components/treasury';
import { AlertTriangle, ClipboardList, Landmark, Users, Calculator, HandCoins, Building2 } from 'lucide-react';

export default function TreasuryPage() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [totalBalance, setTotalBalance] = useState(0);
  const [payablesSummary, setPayablesSummary] = useState(null);
  const [overdueReceivables, setOverdueReceivables] = useState([]);
  const [overduePayables, setOverduePayables] = useState([]);
  const [upcomingPayables, setUpcomingPayables] = useState([]);
  const [cashFlowData, setCashFlowData] = useState([]);
  const [monthFlow, setMonthFlow] = useState({ income: 0, expense: 0, netFlow: 0 });

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadAccounts(),
        loadPayablesSummary(),
        loadOverduePayables(),
        loadUpcomingPayables(),
        loadCashFlow(),
      ]);
    } catch (err) {
      console.error('Error loading treasury data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      setAccounts(data || []);
      const total = (data || []).reduce((sum, acc) => sum + parseFloat(acc.currentBalance || 0), 0);
      setTotalBalance(total);
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  };

  const loadPayablesSummary = async () => {
    try {
      const { data } = await payablesApi.getSummary();
      setPayablesSummary(data);
    } catch (err) {
      console.error('Error loading payables summary:', err);
    }
  };

  const loadOverduePayables = async () => {
    try {
      const { data } = await payablesApi.getAll({ overdue: true });
      const receivables = (data || []).filter(p => p.type === 'RECEIVABLE');
      const payables = (data || []).filter(p => p.type === 'PAYABLE');
      setOverdueReceivables(receivables);
      setOverduePayables(payables);
    } catch (err) {
      console.error('Error loading overdue payables:', err);
    }
  };

  const loadUpcomingPayables = async () => {
    try {
      const { data } = await payablesApi.getUpcoming(7);
      setUpcomingPayables(data || []);
    } catch (err) {
      console.error('Error loading upcoming payables:', err);
    }
  };

  const loadCashFlow = async (period = 'week') => {
    try {
      const { data } = await treasuryReportsApi.getCashFlow({ period });
      setCashFlowData(data?.daily || []);
      setMonthFlow({
        income: data?.totals?.income || 0,
        expense: data?.totals?.expense || 0,
        netFlow: (data?.totals?.income || 0) - (data?.totals?.expense || 0),
      });
    } catch (err) {
      console.error('Error loading cash flow:', err);
      generateMockCashFlow();
    }
  };

  const handlePeriodChange = (period) => {
    loadCashFlow(period);
  };

  const generateMockCashFlow = () => {
    const days = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
    const today = new Date().getDay();
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const dayIdx = (today - i + 7) % 7;
      data.push({
        label: days[dayIdx === 0 ? 6 : dayIdx - 1],
        income: 0,
        expense: 0,
      });
    }
    setCashFlowData(data);
  };

  const netPosition = payablesSummary?.netPosition || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#E6EDF3]">Tesoreria</h2>
          <p className="text-sm text-[#6E7681] mt-1">
            Dashboard financiero integrado
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/treasury/transactions" className="btn-primary text-sm">
            + Movimiento
          </Link>
          <Link to="/treasury/accounts" className="btn-ghost text-sm">
            Cuentas
          </Link>
          <Link to="/treasury/third-parties" className="btn-ghost text-sm">
            Terceros
          </Link>
          <Link to="/treasury/commissions" className="btn-ghost text-sm" data-testid="treasury-commissions-link">
            Comisiones
          </Link>
          <Link to="/treasury/investors" className="btn-ghost text-sm" data-testid="treasury-investors-link">
            Inversionistas
          </Link>
        </div>
      </div>

      {/* Seccion 1: Saldo Disponible + Posicion Neta */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <BalanceCard
            accounts={accounts}
            totalBalance={totalBalance}
            loading={loading}
          />
        </div>
        <div className="card p-5">
          <div className="text-sm text-[#8B949E] mb-2">Posicion Neta</div>
          <div className={`text-2xl font-bold mb-3 ${
            netPosition >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {netPosition >= 0 ? '+' : ''}{formatCurrency(netPosition)}
          </div>
          <div className="text-xs text-[#6E7681] space-y-1">
            <div className="flex justify-between">
              <span>Por cobrar:</span>
              <span className="text-green-400">+{formatCurrency(payablesSummary?.receivables?.total || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Por pagar:</span>
              <span className="text-red-400">-{formatCurrency(payablesSummary?.payables?.total || 0)}</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-xs text-[#6E7681]">Saldo + Posicion Neta</div>
            <div className={`text-lg font-bold ${
              (totalBalance + netPosition) >= 0 ? 'text-accent' : 'text-orange-400'
            }`}>
              {formatCurrency(totalBalance + netPosition)}
            </div>
          </div>
        </div>
      </div>

      {/* Seccion 2 y 3: CxC y CxP */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReceivablesWidget
          summary={payablesSummary?.receivables}
          overdueList={overdueReceivables}
          loading={loading}
        />
        <PayablesWidgetCxP
          summary={payablesSummary?.payables}
          overdueList={overduePayables}
          upcomingList={upcomingPayables}
          loading={loading}
        />
      </div>

      {/* Pendientes de socio (se auto-oculta si no hay) */}
      <SocioPendingWidget />

      {/* Seccion Prestamos: resumen + top deudores */}
      <LoansSummaryCards />

      {/* Alertas de vencimientos */}
      {(overdueReceivables.length > 0 || overduePayables.length > 0) && (
        <div className="card p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-400 mb-1">
                Atencion: Hay cuentas vencidas
              </div>
              <div className="text-xs text-[#8B949E] space-y-1">
                {overdueReceivables.length > 0 && (
                  <div>
                    • {overdueReceivables.length} cuenta{overdueReceivables.length > 1 ? 's' : ''} por cobrar vencida{overdueReceivables.length > 1 ? 's' : ''}
                    {' '}por {formatCurrency(overdueReceivables.reduce((s, p) => s + parseFloat(p.totalAmount) - parseFloat(p.paidAmount), 0))}
                  </div>
                )}
                {overduePayables.length > 0 && (
                  <div>
                    • {overduePayables.length} cuenta{overduePayables.length > 1 ? 's' : ''} por pagar vencida{overduePayables.length > 1 ? 's' : ''}
                    {' '}por {formatCurrency(overduePayables.reduce((s, p) => s + parseFloat(p.totalAmount) - parseFloat(p.paidAmount), 0))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Seccion 4: Flujo de Caja */}
      <CashFlowChart data={cashFlowData} loading={loading} onPeriodChange={handlePeriodChange} />

      {/* Flujo del Mes (resumen rapido) */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-[#E6EDF3] mb-4">Resumen del Mes</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-green-500/10 rounded-lg">
            <div className="text-xs text-[#8B949E] mb-1">Ingresos</div>
            <div className="text-xl font-bold text-green-400">
              {formatCurrency(monthFlow.income)}
            </div>
          </div>
          <div className="text-center p-4 bg-red-500/10 rounded-lg">
            <div className="text-xs text-[#8B949E] mb-1">Egresos</div>
            <div className="text-xl font-bold text-red-400">
              {formatCurrency(monthFlow.expense)}
            </div>
          </div>
          <div className={`text-center p-4 rounded-lg ${
            monthFlow.netFlow >= 0 ? 'bg-accent/10' : 'bg-orange-500/10'
          }`}>
            <div className="text-xs text-[#8B949E] mb-1">Flujo Neto</div>
            <div className={`text-xl font-bold ${
              monthFlow.netFlow >= 0 ? 'text-accent' : 'text-orange-400'
            }`}>
              {monthFlow.netFlow >= 0 ? '+' : ''}{formatCurrency(monthFlow.netFlow)}
            </div>
          </div>
        </div>
      </div>

      {/* Accesos rapidos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link to="/treasury/transactions" className="card p-4 text-center hover:bg-surface-hover transition-colors">
          <ClipboardList className="w-7 h-7 mx-auto mb-2 text-accent" />
          <div className="text-sm text-[#E6EDF3]">Movimientos</div>
          <div className="text-xs text-[#6E7681] mt-1">Ver historial</div>
        </Link>
        <Link to="/treasury/accounts" className="card p-4 text-center hover:bg-surface-hover transition-colors">
          <Landmark className="w-7 h-7 mx-auto mb-2 text-accent" />
          <div className="text-sm text-[#E6EDF3]">Cuentas</div>
          <div className="text-xs text-[#6E7681] mt-1">{accounts.length} activas</div>
        </Link>
        <Link to="/treasury/third-parties" className="card p-4 text-center hover:bg-surface-hover transition-colors">
          <Users className="w-7 h-7 mx-auto mb-2 text-accent" />
          <div className="text-sm text-[#E6EDF3]">Terceros</div>
          <div className="text-xs text-[#6E7681] mt-1">Clientes y proveedores</div>
        </Link>
        <Link to="/treasury/cash-count" className="card p-4 text-center hover:bg-surface-hover transition-colors">
          <Calculator className="w-7 h-7 mx-auto mb-2 text-accent" />
          <div className="text-sm text-[#E6EDF3]">Arqueo</div>
          <div className="text-xs text-[#6E7681] mt-1">Verificar efectivo</div>
        </Link>
        <Link to="/treasury/loans" className="card p-4 text-center hover:bg-surface-hover transition-colors">
          <HandCoins className="w-7 h-7 mx-auto mb-2 text-accent" />
          <div className="text-sm text-[#E6EDF3]">Préstamos</div>
          <div className="text-xs text-[#6E7681] mt-1">Internos a terceros</div>
        </Link>
        <Link to="/treasury/debts" className="card p-4 text-center hover:bg-surface-hover transition-colors">
          <Building2 className="w-7 h-7 mx-auto mb-2 text-accent" />
          <div className="text-sm text-[#E6EDF3]">Créditos</div>
          <div className="text-xs text-[#6E7681] mt-1">Financiaciones del negocio</div>
        </Link>
      </div>
    </div>
  );
}
