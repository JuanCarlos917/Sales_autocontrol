import { useState, useEffect } from 'react';
import { useApp } from '@/contexts/AppContext';
import { EXPENSE_CATEGORIES } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import { Input, Select, Textarea, Checkbox } from '@/components/shared/FormFields';

export default function ExpenseFormModal({ vehicleId, onClose }) {
  const { createExpense, vehicles, fetchVehicles } = useApp();
  const [f, setF] = useState({
    vehicleId: vehicleId || '',
    category: 'MECANICA',
    amount: '',
    description: '',
    notes: '',
    date: new Date().toISOString().split('T')[0],
    paid: true,
  });
  const [loading, setLoading] = useState(false);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!vehicleId && vehicles.length === 0) fetchVehicles();
  }, [vehicleId, vehicles.length, fetchVehicles]);

  const handleSave = async () => {
    if (!f.amount || (!vehicleId && !f.vehicleId)) return;
    setLoading(true);
    try {
      await createExpense({
        ...f,
        amount: parseFloat(f.amount) || 0,
        date: f.date || null,
      });
      onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <Modal onClose={onClose} title="Registrar Gasto" width="max-w-md">
      <div className="space-y-3">
        {!vehicleId && (
          <Select label="Vehículo *" value={f.vehicleId} onChange={e => s('vehicleId', e.target.value)}
            options={[{ value: '', label: 'Seleccionar...' }, ...vehicles.map(v => ({ value: v.id, label: `${v.plate} — ${v.brand} ${v.model}` }))]} />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Select label="Categoría" value={f.category} onChange={e => s('category', e.target.value)}
            options={EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))} />
          <Input label="Valor *" type="number" value={f.amount} onChange={e => s('amount', e.target.value)} placeholder="150000" />
        </div>

        <Input label="Descripción" value={f.description} onChange={e => s('description', e.target.value)} placeholder="Bujías y mano de obra" />
        <Textarea label="Notas adicionales" rows={2} value={f.notes} onChange={e => s('notes', e.target.value)} placeholder="Detalles extra, observaciones..." />

        <div className="grid grid-cols-2 gap-3 items-end">
          <Input label="Fecha" type="date" value={f.date} onChange={e => s('date', e.target.value)} />
          <Checkbox label="Pagado" checked={f.paid} onChange={e => s('paid', e.target.checked)} className="pb-2" />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        <button onClick={handleSave} disabled={loading} className="btn-primary">
          {loading ? 'Guardando...' : 'Registrar Gasto'}
        </button>
      </div>
    </Modal>
  );
}
