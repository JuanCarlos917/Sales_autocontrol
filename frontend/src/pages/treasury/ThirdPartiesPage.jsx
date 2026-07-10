// ═══════════════════════════════════════════════════════════════
// ThirdParties Page — CRUD de terceros
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { thirdPartiesApi } from '@/lib/treasuryApi';
import Modal from '@/components/shared/Modal';

const THIRD_PARTY_TYPES = [
  { id: 'CLIENT', label: 'Cliente', color: 'text-green-400 bg-green-500/20' },
  { id: 'SUPPLIER', label: 'Proveedor', color: 'text-blue-400 bg-blue-500/20' },
  { id: 'PARTNER', label: 'Socio', color: 'text-purple-400 bg-purple-500/20' },
  { id: 'EMPLOYEE', label: 'Empleado', color: 'text-amber-400 bg-amber-500/20' },
];

export default function ThirdPartiesPage() {
  const [thirdParties, setThirdParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({ name: '', type: 'CLIENT', document: '', phone: '', email: '', notes: '' });

  useEffect(() => {
    loadThirdParties();
  }, [typeFilter]);

  const loadThirdParties = async () => {
    try {
      const { data } = await thirdPartiesApi.getAll({ type: typeFilter || undefined });
      setThirdParties(data);
    } catch (err) {
      console.error('Error loading third parties:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = thirdParties.filter(tp =>
    tp.name.toLowerCase().includes(filter.toLowerCase()) ||
    tp.document?.toLowerCase().includes(filter.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'CLIENT', document: '', phone: '', email: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (tp) => {
    setEditing(tp);
    setForm({
      name: tp.name,
      type: tp.type,
      document: tp.document || '',
      phone: tp.phone || '',
      email: tp.email || '',
      notes: tp.notes || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await thirdPartiesApi.update(editing.id, form);
      } else {
        await thirdPartiesApi.create(form);
      }
      setShowModal(false);
      loadThirdParties();
    } catch (err) {
      console.error('Error saving third party:', err);
      alert(err.response?.data?.error || 'Error al guardar');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminar este tercero?')) return;
    try {
      await thirdPartiesApi.delete(id);
      loadThirdParties();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar');
    }
  };

  const getTypeInfo = (type) => THIRD_PARTY_TYPES.find(t => t.id === type) || THIRD_PARTY_TYPES[0];

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-[#8B949E]">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-[#E6EDF3]">Terceros</h2>
        <button onClick={openCreate} className="btn-primary text-sm">+ Nuevo Tercero</button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar por nombre o documento..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input flex-1 min-w-[200px]"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input"
        >
          <option value="">Todos los tipos</option>
          {THIRD_PARTY_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Lista */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-hover text-[#8B949E]">
            <tr>
              <th className="text-left p-3">Nombre</th>
              <th className="text-left p-3">Tipo</th>
              <th className="text-left p-3 hidden md:table-cell">Documento</th>
              <th className="text-left p-3 hidden md:table-cell">Contacto</th>
              <th className="text-right p-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tp) => {
              const typeInfo = getTypeInfo(tp.type);
              return (
                <tr key={tp.id} className="border-t border-border hover:bg-surface-hover">
                  <td className="p-3 font-medium text-[#E6EDF3]">{tp.name}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                  </td>
                  <td className="p-3 text-[#8B949E] hidden md:table-cell">{tp.document || '-'}</td>
                  <td className="p-3 text-[#8B949E] hidden md:table-cell">
                    {tp.phone || tp.email || '-'}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => openEdit(tp)} className="text-accent hover:underline mr-3">Editar</button>
                    <button onClick={() => handleDelete(tp.id)} className="text-red-400 hover:underline">Eliminar</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="5" className="p-6 text-center text-[#8B949E]">No hay terceros registrados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Tercero' : 'Nuevo Tercero'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Tipo *</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="input w-full"
            >
              {THIRD_PARTY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Documento / NIT</label>
            <input
              type="text"
              value={form.document}
              onChange={(e) => setForm({ ...form, document: e.target.value })}
              className="input w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Telefono</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="input w-full"
              rows="2"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1">Guardar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
