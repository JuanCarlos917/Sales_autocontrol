import { useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { STAGES, PORTALS } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import { Input, Select, Textarea, Checkbox } from '@/components/shared/FormFields';

export default function VehicleFormModal({ vehicle, onClose }) {
  const { createVehicle, updateVehicle } = useApp();
  const [f, setF] = useState({
    plate: vehicle?.plate || '', brand: vehicle?.brand || '', model: vehicle?.model || '',
    year: vehicle?.year || '', color: vehicle?.color || '', km: vehicle?.km || '',
    stage: vehicle?.stage || 'NEGOCIANDO', purchasePrice: vehicle?.purchasePrice || '',
    purchaseDate: vehicle?.purchaseDate?.split('T')[0] || '', listedPrice: vehicle?.listedPrice || '',
    salePrice: vehicle?.salePrice || '', saleDate: vehicle?.saleDate?.split('T')[0] || '',
    participation: vehicle?.participation ? (vehicle.participation * 100) : 100,
    receivedVehicle: vehicle?.receivedVehicle || false,
    receivedVehiclePlate: vehicle?.receivedVehiclePlate || '',
    receivedVehicleValue: vehicle?.receivedVehicleValue || '',
    publishedPortals: vehicle?.publishedPortals || [],
    notes: vehicle?.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const togglePortal = (pid) => s('publishedPortals', f.publishedPortals.includes(pid) ? f.publishedPortals.filter(x => x !== pid) : [...f.publishedPortals, pid]);

  const handleSave = async () => {
    if (!f.plate && !f.brand) return;
    setLoading(true);
    try {
      const payload = {
        ...f, purchasePrice: parseFloat(f.purchasePrice) || null,
        salePrice: parseFloat(f.salePrice) || null, listedPrice: parseFloat(f.listedPrice) || null,
        participation: (parseFloat(f.participation) || 100) / 100,
        receivedVehicleValue: parseFloat(f.receivedVehicleValue) || null,
        year: f.year ? parseInt(f.year) : null, km: f.km ? parseInt(f.km) : null,
        purchaseDate: f.purchaseDate || null, saleDate: f.saleDate || null,
      };
      vehicle ? await updateVehicle(vehicle.id, payload) : await createVehicle(payload);
      onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <Modal onClose={onClose} title={vehicle ? 'Editar Vehículo' : 'Nuevo Vehículo'} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Placa *" value={f.plate} onChange={e => s('plate', e.target.value.toUpperCase())} placeholder="ABC123" />
        <Select label="Estado" value={f.stage} onChange={e => s('stage', e.target.value)} options={STAGES.map(st => ({ value: st.id, label: st.label }))} />
        <Input label="Marca" value={f.brand} onChange={e => s('brand', e.target.value)} placeholder="Chevrolet" />
        <Input label="Modelo" value={f.model} onChange={e => s('model', e.target.value)} placeholder="Spark GT" />
        <Input label="Año" type="number" value={f.year} onChange={e => s('year', e.target.value)} placeholder="2020" />
        <Input label="Color" value={f.color} onChange={e => s('color', e.target.value)} placeholder="Blanco" />
        <Input label="Kilometraje" type="number" value={f.km} onChange={e => s('km', e.target.value)} placeholder="45000" />
        <Input label="Participación %" type="number" value={f.participation} onChange={e => s('participation', e.target.value)} />
        <Input label="Precio de Compra" type="number" value={f.purchasePrice} onChange={e => s('purchasePrice', e.target.value)} placeholder="25000000" />
        <Input label="Fecha de Compra" type="date" value={f.purchaseDate} onChange={e => s('purchaseDate', e.target.value)} />
        <Input label="Precio Publicado" type="number" value={f.listedPrice} onChange={e => s('listedPrice', e.target.value)} placeholder="32000000" />
        <Input label="Precio de Venta" type="number" value={f.salePrice} onChange={e => s('salePrice', e.target.value)} />
        <Input label="Fecha de Venta" type="date" value={f.saleDate} onChange={e => s('saleDate', e.target.value)} />
      </div>

      {/* Portals */}
      <div className="mt-4">
        <label className="label-sm">Publicado en</label>
        <div className="flex gap-1.5 flex-wrap mt-1.5">
          {PORTALS.map(p => (
            <button key={p.id} onClick={() => togglePortal(p.id)} type="button"
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${f.publishedPortals.includes(p.id) ? '' : 'border-border text-[#6E7681]'}`}
              style={f.publishedPortals.includes(p.id) ? { background: p.color + '20', borderColor: p.color + '50', color: p.color } : {}}>
              {f.publishedPortals.includes(p.id) ? '✓ ' : ''}{p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trade-in */}
      <div className="mt-4 p-3.5 bg-[#0F1419] rounded-xl border border-border">
        <Checkbox label="⟳ Incluye vehículo recibido como parte de pago" checked={f.receivedVehicle} onChange={e => s('receivedVehicle', e.target.checked)} className="font-semibold" />
        {f.receivedVehicle && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Input label="Placa del cruce" value={f.receivedVehiclePlate} onChange={e => s('receivedVehiclePlate', e.target.value)} />
            <Input label="Valor del cruce" type="number" value={f.receivedVehicleValue} onChange={e => s('receivedVehicleValue', e.target.value)} />
          </div>
        )}
      </div>

      <Textarea label="Notas" className="mt-3" rows={3} value={f.notes} onChange={e => s('notes', e.target.value)} placeholder="Observaciones del vehículo..." />

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        <button onClick={handleSave} disabled={loading} className="btn-primary">{loading ? 'Guardando...' : vehicle ? 'Guardar Cambios' : 'Registrar Vehículo'}</button>
      </div>
    </Modal>
  );
}
