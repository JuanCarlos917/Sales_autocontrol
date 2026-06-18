import { useEffect, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { EXPENSE_CATEGORIES, formatCurrency, formatDate, getCategory } from '@/lib/constants';
import ExpenseFormModal from '@/components/expenses/ExpenseFormModal';
import ExpenseDeleteModal from '@/components/expenses/ExpenseDeleteModal';
import ExpenseAuditModal from '@/components/expenses/ExpenseAuditModal';
import { Lock, Clock, StickyNote, History, Trash2, MoreVertical } from 'lucide-react';

const UNDO_WINDOW_MS = 5 * 60 * 1000;

export default function ExpensesPage() {
  const { expenses, fetchExpenses, deleteExpense, restoreExpense, showToast } = useApp();
  const { isViewer } = useAuth();
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [auditing, setAuditing] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const filtered = filter === 'all' ? expenses : expenses.filter(e => e.category === filter);

  const handleConfirmDelete = async (reason) => {
    const { id } = await deleteExpense(deleting.id, { reason });
    await fetchExpenses();
    const plate = deleting.vehicle?.plate || '';
    showToast({
      msg: `Gasto eliminado${plate ? ` (${plate})` : ''}`,
      type: 'danger',
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Deshacer',
        onClick: async () => {
          try {
            await restoreExpense(id);
            showToast('Gasto restaurado', 'success');
          } catch (err) {
            showToast(err.response?.data?.error || 'No se pudo restaurar', 'danger');
          }
        },
      },
    });
  };

  const isLocked = (e) => e.vehicle?.stage === 'VENDIDO';

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
        {!isViewer && (
          <button onClick={() => setShowCreate(true)} className="btn-primary" data-testid="expenses-create-button">+ Gasto</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-[#6E7681] py-16">Sin gastos registrados</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const cat = getCategory(e.category);
            const locked = isLocked(e);
            return (
              <div
                key={e.id}
                className="flex items-start gap-3 p-3.5 bg-surface border border-border rounded-lg"
                data-testid={`expense-row-${e.id}`}
              >
                <div className="w-1 min-h-[40px] rounded-full shrink-0" style={{ background: cat?.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate flex items-center gap-2">
                        {e.description || cat?.label}
                        {locked && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#6E7681]/20 text-[#8B949E] font-medium"
                            title="Vehículo vendido: gasto bloqueado"
                            data-testid={`expense-${e.id}-locked-badge`}
                          >
                            <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Vendido</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#6E7681] flex gap-2 flex-wrap mt-0.5">
                        <span className="inline-flex items-center gap-1" style={{ color: cat?.color }}>{cat?.icon && <cat.icon className="w-3.5 h-3.5" />} {cat?.label}</span>
                        {e.vehicle && <span className="font-mono">{e.vehicle.plate}</span>}
                        {e.date && <span>{formatDate(e.date)}</span>}
                        {!e.paid && <span className="text-[#D29922] font-semibold inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Pendiente</span>}
                      </div>
                      {e.notes && <div className="text-[11px] text-[#6E7681] italic mt-1 inline-flex items-center gap-1"><StickyNote className="w-3 h-3 shrink-0" /> {e.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-sm">{formatCurrency(e.amount)}</span>
                      {!locked && !isViewer && (
                        <>
                          <button
                            onClick={() => setEditing(e)}
                            className="btn-ghost text-xs px-2.5 py-1"
                            data-testid={`expense-${e.id}-edit-button`}
                          >
                            Editar
                          </button>
                          <div className="relative">
                            <button
                              onClick={() => setMenuOpenId(menuOpenId === e.id ? null : e.id)}
                              className="btn-ghost text-base px-2 py-1 leading-none"
                              aria-label="Más acciones"
                              data-testid={`expense-${e.id}-overflow-button`}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {menuOpenId === e.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-10"
                                  onClick={() => setMenuOpenId(null)}
                                />
                                <div className="absolute right-0 top-full mt-1 w-40 bg-[#1C2128] border border-border rounded-lg shadow-xl z-20 overflow-hidden">
                                  <button
                                    onClick={() => { setMenuOpenId(null); setAuditing(e); }}
                                    className="w-full text-left px-3 py-2 text-xs text-[#8B949E] hover:bg-surface-hover transition-colors inline-flex items-center gap-1.5"
                                  >
                                    <History className="w-3.5 h-3.5" /> Historial
                                  </button>
                                  <button
                                    onClick={() => { setMenuOpenId(null); setDeleting(e); }}
                                    className="w-full text-left px-3 py-2 text-xs text-[#F85149] hover:bg-[#F85149]/10 transition-colors border-t border-border"
                                    data-testid={`expense-${e.id}-delete-action`}
                                  >
                                    <span className="inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Eliminar</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <ExpenseFormModal onClose={() => { setShowCreate(false); fetchExpenses(); }} />}
      {editing && (
        <ExpenseFormModal
          expense={editing}
          onClose={() => { setEditing(null); fetchExpenses(); }}
        />
      )}
      {deleting && (
        <ExpenseDeleteModal
          expense={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
      {auditing && (
        <ExpenseAuditModal
          expenseId={auditing.id}
          onClose={() => setAuditing(null)}
        />
      )}
    </div>
  );
}
