import { useEffect, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { EXPENSE_CATEGORIES, formatCurrency, formatDate, getCategory } from '@/lib/constants';
import ExpenseFormModal from '@/components/expenses/ExpenseFormModal';

export default function ExpensesPage() {
  const { expenses, fetchExpenses, deleteExpense } = useApp();
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const filtered = filter === 'all' ? expenses : expenses.filter(e => e.category === filter);

  return (
    <div>
      <div className="flex justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${filter === 'all' ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-[#6E7681]'}`}>Todos ({expenses.length})</button>
          {EXPENSE_CATEGORIES.filter(c => expenses.some(e => e.category === c.id)).map(c => (
            <button key={c.id} onClick={() => setFilter(c.id)} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${filter === c.id ? '' : 'border-border text-[#6E7681]'}`} style={filter === c.id ? { background: c.color + '18', borderColor: c.color + '50', color: c.color } : {}}>
              {c.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ Gasto</button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-[#6E7681] py-16">Sin gastos registrados</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const cat = getCategory(e.category);
            return (
              <div key={e.id} className="flex items-start gap-3 p-3.5 bg-surface border border-border rounded-lg">
                <div className="w-1 min-h-[40px] rounded-full shrink-0" style={{ background: cat?.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate">{e.description || cat?.label}</div>
                      <div className="text-[11px] text-[#6E7681] flex gap-2 flex-wrap mt-0.5">
                        <span style={{ color: cat?.color }}>{cat?.icon} {cat?.label}</span>
                        {e.vehicle && <span className="font-mono">{e.vehicle.plate}</span>}
                        {e.date && <span>{formatDate(e.date)}</span>}
                        {!e.paid && <span className="text-[#D29922] font-semibold">⏳ Pendiente</span>}
                      </div>
                      {e.notes && <div className="text-[11px] text-[#6E7681] italic mt-1">📝 {e.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-sm">{formatCurrency(e.amount)}</span>
                      <button onClick={() => deleteExpense(e.id)} className="btn-danger">✕</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && <ExpenseFormModal onClose={() => { setShowForm(false); fetchExpenses(); }} />}
    </div>
  );
}
