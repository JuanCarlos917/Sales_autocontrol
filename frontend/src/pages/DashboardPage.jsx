import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { STAGES, EXPENSE_CATEGORIES, formatCurrency, formatPercent } from '@/lib/constants';
import api from '@/lib/api';
import { commissionsApi, investorsApi } from '@/lib/payablesApi';
import AlertsPanel from '@/components/shared/AlertsPanel';
import { TrendingUp } from 'lucide-react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { fetchDashboard, dashboard } = useApp();
  const [projection, setProjection] = useState(null);
  const [commSummary, setCommSummary] = useState(null);
  const [investorSummary, setInvestorSummary] = useState(null);
  const [projForm, setProjForm] = useState({ purchasePrice: '', estimatedExpenses: '', salePrice: '', estimatedDays: '20', participation: '1' });

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  useEffect(() => {
    commissionsApi.getSummary().then(r => setCommSummary(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    investorsApi.getSummary().then(r => setInvestorSummary(r.data)).catch(() => {});
  }, []);

  const runProjection = async () => {
    try {
      const { data } = await api.post('/dashboard/projection', projForm);
      setProjection(data);
    } catch {}
  };

  if (!dashboard) return <div className="text-center text-[#6E7681] py-20">Cargando dashboard...</div>;

  const { kpis, pipeline, expensesByCategory, alerts } = dashboard;

  const kpiCards = [
    { label: 'Capital Inmovilizado', value: formatCurrency(kpis.totalInvested), color: 'text-[#D29922]' },
    { label: 'Ingresos Totales', value: formatCurrency(kpis.totalRevenue), color: 'text-accent' },
    { label: 'Ganancia Neta', sub: 'después de fijos y comisiones', value: formatCurrency(kpis.totalProfit), color: kpis.totalProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]' },
    { label: 'Mi Ganancia Total', sub: 'según participación', value: formatCurrency(kpis.totalMyProfit), color: 'text-[#BC8CFF]' },
    { label: 'Saldo en Caja', value: formatCurrency(kpis.treasuryBalance), color: 'text-[#58A6FF]' },
    { label: 'Vendidos', value: kpis.soldCount, color: 'text-[#3FB950]' },
    { label: 'ROI Promedio', value: formatPercent(kpis.avgROI), color: kpis.avgROI >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]' },
  ];

  const sortedExpCats = Object.entries(expensesByCategory).sort(([, a], [, b]) => b - a);
  const maxExp = sortedExpCats[0]?.[1] || 1;

  return (
    <div className="space-y-4">
      {/* System Alerts Panel */}
      <AlertsPanel compact />

      {/* Vehicle Age Alerts (Quick View) */}
      {alerts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {alerts.map(a => (
            <div key={a.vehicleId} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs shrink-0 ${a.level === 'critical' ? 'border-[#F8514940] bg-[#F8514915]' : 'border-[#D2992240] bg-[#D2992215]'}`}>
              <span className="font-mono font-semibold">{a.plate}</span>
              <span className={`font-bold ${a.level === 'critical' ? 'text-[#F85149]' : 'text-[#D29922]'}`}>{a.days}d</span>
            </div>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpiCards.map((k, i) => (
          <div key={i} className="kpi-card">
            <div className="text-[11px] text-[#6E7681] uppercase tracking-wider">{k.label}</div>
            <div className={`text-xl font-bold font-mono mt-1.5 ${k.color}`}>{k.value}</div>
            {k.sub && <div className="text-[10px] text-[#6E7681] mt-0.5">{k.sub}</div>}
          </div>
        ))}
      </div>

      {(commSummary || investorSummary) && (
        <div className={`grid grid-cols-1 gap-3 ${commSummary && investorSummary ? 'md:grid-cols-2' : ''}`}>
          {commSummary && (
            <button
              type="button"
              onClick={() => navigate('/treasury/commissions')}
              className="kpi-card w-full text-left hover:border-accent/40 transition-colors cursor-pointer"
              data-testid="dashboard-commissions-card"
            >
              <div className="text-[11px] text-[#6E7681] uppercase tracking-wider">Comisiones</div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="text-xl font-bold font-mono text-amber-400">{formatCurrency(commSummary.pendingTotal)}</span>
                <span className="text-[11px] text-[#6E7681]">pendientes</span>
              </div>
              <div className="text-[11px] text-[#8B949E] mt-0.5">
                Pagado este mes: <span className="font-mono text-green-400">{formatCurrency(commSummary.paidThisMonth)}</span> →
              </div>
            </button>
          )}

          {investorSummary && (
            <button
              type="button"
              onClick={() => navigate('/treasury/investors')}
              className="kpi-card w-full text-left hover:border-accent/40 transition-colors cursor-pointer"
              data-testid="dashboard-investors-card"
            >
              <div className="text-[11px] text-[#6E7681] uppercase tracking-wider">Ganancia pendiente a inversionistas</div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="text-xl font-bold font-mono text-amber-400">{formatCurrency(investorSummary.pendingTotal)}</span>
                <span className="text-[11px] text-[#6E7681]">pendientes</span>
              </div>
              <div className="text-[11px] text-[#8B949E] mt-0.5">
                Pagado este mes: <span className="font-mono text-green-400">{formatCurrency(investorSummary.paidThisMonth)}</span> →
              </div>
              {investorSummary.byPerson?.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
                  {investorSummary.byPerson.slice(0, 3).map((p) => (
                    <div key={p.thirdParty.id} className="flex items-center justify-between text-[11px]">
                      <span className="text-[#8B949E] truncate">{p.thirdParty.name}</span>
                      <span className={`font-mono ${p.totalPending > 0 ? 'text-amber-400' : 'text-[#6E7681]'}`}>{formatCurrency(p.totalPending)}</span>
                    </div>
                  ))}
                  {investorSummary.byPerson.length > 3 && (
                    <div className="text-[10px] text-[#6E7681]">+{investorSummary.byPerson.length - 3} más</div>
                  )}
                </div>
              )}
            </button>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Pipeline Distribution */}
        <div className="card">
          <div className="card-title">Distribución del Pipeline</div>
          <div className="space-y-3">
            {pipeline.map(p => {
              const stage = STAGES.find(s => s.id === p.stage);
              return (
                <div key={p.stage} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage?.color }} />
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#8B949E]">{stage?.label}</span>
                      <span className="font-mono font-semibold">{p.count}</span>
                    </div>
                    <div className="h-1 bg-[#0F1419] rounded-full">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${kpis.totalVehicles ? (p.count / kpis.totalVehicles) * 100 : 0}%`, background: stage?.color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="card">
          <div className="card-title">Desglose de Gastos</div>
          {sortedExpCats.length === 0 ? (
            <p className="text-center text-[#6E7681] text-sm py-6">Sin gastos registrados</p>
          ) : (
            <div className="space-y-3">
              {sortedExpCats.map(([catId, total]) => {
                const cat = EXPENSE_CATEGORIES.find(c => c.id === catId);
                return (
                  <div key={catId}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#8B949E] inline-flex items-center gap-1.5">{cat?.icon && <cat.icon className="w-3.5 h-3.5" style={{ color: cat.color }} />} {cat?.label || catId}</span>
                      <span className="font-mono font-semibold">{formatCurrency(total)}</span>
                    </div>
                    <div className="h-1 bg-[#0F1419] rounded-full">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(total / maxExp) * 100}%`, background: cat?.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Projection Calculator */}
        <div className="card md:col-span-2">
          <div className="card-title inline-flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Proyección de Ganancia</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { key: 'purchasePrice', label: 'Precio Compra', ph: '25000000' },
              { key: 'estimatedExpenses', label: 'Gastos Est.', ph: '2000000' },
              { key: 'salePrice', label: 'Precio Venta', ph: '32000000' },
              { key: 'estimatedDays', label: 'Días Est.', ph: '20' },
              { key: 'participation', label: 'Participación', ph: '1' },
            ].map(f => (
              <div key={f.key}>
                <label className="label-sm">{f.label}</label>
                <input type="number" value={projForm[f.key]} onChange={e => setProjForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph} className="input-field" />
              </div>
            ))}
          </div>
          <button onClick={runProjection} className="btn-primary mt-3">Calcular</button>

          {projection && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 p-4 bg-[#0F1419] rounded-xl">
              <div>
                <div className="text-[10px] text-[#6E7681] uppercase">Costo Total</div>
                <div className="font-mono font-bold text-lg">{formatCurrency(projection.totalCost)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#6E7681] uppercase">Fijos Prorrateados</div>
                <div className="font-mono font-bold text-lg text-[#D29922]">{formatCurrency(projection.fixedProrated)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#6E7681] uppercase">Ganancia Neta</div>
                <div className={`font-mono font-bold text-lg ${projection.netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>{formatCurrency(projection.netProfit)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#6E7681] uppercase">Mi Ganancia</div>
                <div className={`font-mono font-bold text-xl ${projection.myProfit >= 0 ? 'text-accent' : 'text-[#F85149]'}`}>{formatCurrency(projection.myProfit)}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
