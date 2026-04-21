// ═══════════════════════════════════════════════════════════════
// ThirdPartySelector — Selector de terceros con búsqueda y creación
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';
import { thirdPartiesApi } from '@/lib/treasuryApi';

const TYPE_LABELS = {
  SUPPLIER: 'Proveedor',
  CLIENT: 'Cliente',
  PARTNER: 'Socio',
  BOTH: 'Cliente/Proveedor',
};

const TYPE_COLORS = {
  SUPPLIER: 'text-blue-400',
  CLIENT: 'text-green-400',
  PARTNER: 'text-purple-400',
  BOTH: 'text-amber-400',
};

export default function ThirdPartySelector({
  value,
  onChange,
  filterType = null, // 'SUPPLIER' | 'CLIENT' | 'PARTNER' | null (todos)
  label = 'Tercero',
  required = false,
  placeholder = 'Buscar o crear tercero...',
  className = '',
  error = null, // Mensaje de error para mostrar
  disabled = false,
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [allThirdParties, setAllThirdParties] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [createForm, setCreateForm] = useState({
    name: '',
    type: filterType || 'SUPPLIER',
    document: '',
    phone: '',
  });
  const [creating, setCreating] = useState(false);
  const wrapperRef = useRef(null);

  // Cargar todos los terceros al montar
  useEffect(() => {
    loadThirdParties();
  }, []);

  // Cargar tercero seleccionado si viene con value
  useEffect(() => {
    if (value && allThirdParties.length > 0) {
      const found = allThirdParties.find(t => t.id === value);
      if (found) setSelected(found);
    } else if (!value) {
      setSelected(null);
    }
  }, [value, allThirdParties]);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
        setShowCreateForm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadThirdParties = async () => {
    setLoading(true);
    try {
      const { data } = await thirdPartiesApi.getAll();
      let filtered = data || [];
      // Filtrar por tipo si es necesario
      if (filterType) {
        filtered = filtered.filter(t => t.type === filterType || t.type === 'BOTH');
      }
      setAllThirdParties(filtered);
      setResults(filtered.slice(0, 10));
    } catch (err) {
      console.error('Error loading third parties:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (term) => {
    setSearch(term);
    if (!term.trim()) {
      setResults(allThirdParties.slice(0, 10));
      return;
    }
    const lower = term.toLowerCase();
    const filtered = allThirdParties.filter(t =>
      t.name.toLowerCase().includes(lower) ||
      (t.document && t.document.toLowerCase().includes(lower))
    );
    setResults(filtered.slice(0, 10));
  };

  const handleSelect = (thirdParty) => {
    setSelected(thirdParty);
    onChange(thirdParty.id);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = () => {
    setSelected(null);
    onChange(null);
    setSearch('');
  };

  const handleCreateNew = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const { data } = await thirdPartiesApi.create(createForm);
      setAllThirdParties(prev => [data, ...prev]);
      handleSelect(data);
      setShowCreateForm(false);
      setCreateForm({ name: '', type: filterType || 'SUPPLIER', document: '', phone: '' });
    } catch (err) {
      console.error('Error creating third party:', err);
      alert(err.response?.data?.error || 'Error al crear tercero');
    } finally {
      setCreating(false);
    }
  };

  const openCreateWithSearch = () => {
    setCreateForm(prev => ({ ...prev, name: search }));
    setShowCreateForm(true);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm text-[#8B949E] mb-1">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}

      {/* Selected display or input */}
      {selected ? (
        <div className={`flex items-center justify-between p-2.5 bg-surface border rounded-lg ${error ? 'border-red-500' : 'border-border'} ${disabled ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#E6EDF3] truncate">{selected.name}</div>
              <div className="text-xs text-[#6E7681] flex items-center gap-2">
                <span className={TYPE_COLORS[selected.type]}>{TYPE_LABELS[selected.type]}</span>
                {selected.document && <span>· {selected.document}</span>}
              </div>
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[#6E7681] hover:text-red-400 transition-colors p-1"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => !disabled && setIsOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            className={`input w-full pl-9 ${error ? 'border-red-500 focus:border-red-500' : ''} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E7681]">🔍</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      {/* Dropdown */}
      {isOpen && !selected && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-[#6E7681] text-sm">Cargando...</div>
          ) : showCreateForm ? (
            /* Create form */
            <div className="p-3 space-y-3">
              <div className="text-sm font-semibold text-[#E6EDF3] border-b border-border pb-2">
                Crear nuevo tercero
              </div>
              <div>
                <label className="block text-xs text-[#6E7681] mb-1">Nombre *</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  className="input w-full text-sm"
                  placeholder="Nombre completo"
                  autoFocus
                />
              </div>
              {!filterType && (
                <div>
                  <label className="block text-xs text-[#6E7681] mb-1">Tipo *</label>
                  <select
                    value={createForm.type}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, type: e.target.value }))}
                    className="input w-full text-sm"
                  >
                    <option value="SUPPLIER">Proveedor</option>
                    <option value="CLIENT">Cliente</option>
                    <option value="PARTNER">Socio</option>
                    <option value="BOTH">Cliente/Proveedor</option>
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[#6E7681] mb-1">Documento/NIT</label>
                  <input
                    type="text"
                    value={createForm.document}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, document: e.target.value }))}
                    className="input w-full text-sm"
                    placeholder="123456789"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#6E7681] mb-1">Telefono</label>
                  <input
                    type="text"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="input w-full text-sm"
                    placeholder="300 123 4567"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="btn-ghost flex-1 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreateNew}
                  disabled={!createForm.name.trim() || creating}
                  className="btn-primary flex-1 text-sm"
                >
                  {creating ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </div>
          ) : (
            /* Results list */
            <>
              {results.length === 0 ? (
                <div className="p-4 text-center">
                  <div className="text-[#6E7681] text-sm mb-2">
                    {search ? `No se encontró "${search}"` : 'No hay terceros registrados'}
                  </div>
                  <button
                    type="button"
                    onClick={openCreateWithSearch}
                    className="text-accent text-sm hover:underline"
                  >
                    + Crear nuevo tercero
                  </button>
                </div>
              ) : (
                <>
                  {results.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelect(t)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-surface-hover transition-colors text-left border-b border-border last:border-0"
                    >
                      <span className="text-lg">👤</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[#E6EDF3] truncate">{t.name}</div>
                        <div className="text-xs text-[#6E7681] flex items-center gap-2">
                          <span className={TYPE_COLORS[t.type]}>{TYPE_LABELS[t.type]}</span>
                          {t.document && <span>· {t.document}</span>}
                          {t.phone && <span>· {t.phone}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={openCreateWithSearch}
                    className="w-full p-3 text-center text-accent text-sm hover:bg-surface-hover transition-colors border-t border-border"
                  >
                    + Crear nuevo tercero
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
