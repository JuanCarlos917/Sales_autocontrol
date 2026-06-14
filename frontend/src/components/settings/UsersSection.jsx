import { useEffect, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { Input } from '@/components/shared/FormFields';
import { usersApi } from '@/lib/usersApi';

const ROLES = ['ADMIN', 'SUPERVISOR', 'VIEWER'];

export default function UsersSection() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [resetting, setResetting] = useState(null);

  const reload = () => usersApi.getAll().then((r) => setUsers(r.data)).catch(() => {});
  useEffect(() => { reload(); }, []);

  const act = async (fn) => {
    setError('');
    try { await fn(); await reload(); }
    catch (e) { setError(e.response?.data?.error || 'Error en la operación'); }
  };

  return (
    <div className="card" data-testid="settings-users-card">
      <div className="flex items-center justify-between">
        <div className="card-title">Usuarios</div>
        <button className="btn-primary" onClick={() => setShowNew(true)} data-testid="users-new-button">+ Nuevo usuario</button>
      </div>

      {error && <p className="text-xs text-[#F85149] mt-2" data-testid="users-error">{error}</p>}

      <table className="w-full text-sm mt-4">
        <thead className="text-[#8B949E] text-xs">
          <tr><th className="text-left py-1">Email</th><th className="text-left">Nombre</th><th className="text-left">Rol</th><th className="text-left">Estado</th><th className="text-right">Acciones</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-border" data-testid={`users-row-${u.id}`}>
              <td className="py-2">{u.email}</td>
              <td>{u.name || '—'}</td>
              <td>
                <select
                  className="input text-sm"
                  value={u.role}
                  onChange={(e) => act(() => usersApi.updateRole(u.id, e.target.value))}
                  data-testid={`users-role-${u.id}`}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>{u.isActive ? <span className="text-green-400">Activo</span> : <span className="text-[#6E7681]">Inactivo</span>}</td>
              <td className="text-right space-x-2">
                <button className="btn-ghost text-xs" onClick={() => act(() => usersApi.setStatus(u.id, !u.isActive))} data-testid={`users-status-${u.id}`}>
                  {u.isActive ? 'Desactivar' : 'Activar'}
                </button>
                <button className="btn-ghost text-xs" onClick={() => setResetting(u)} data-testid={`users-reset-${u.id}`}>Resetear</button>
                <button
                  className="btn-ghost text-xs text-[#F85149]"
                  onClick={() => { if (window.confirm(`¿Eliminar a ${u.email}?`)) act(() => usersApi.remove(u.id)); }}
                  data-testid={`users-delete-${u.id}`}
                >Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showNew && <NewUserModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); reload(); }} onError={setError} />}
      {resetting && <ResetModal user={resetting} onClose={() => setResetting(null)} onError={setError} />}
    </div>
  );
}

function NewUserModal({ onClose, onDone, onError }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', pin: '', role: 'VIEWER' });
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      await usersApi.create({
        email: form.email, name: form.name || null, password: form.password,
        role: form.role, pin: form.pin || null,
      });
      onDone();
    } catch (e) { onError(e.response?.data?.error || 'Error al crear usuario'); onClose(); }
    finally { setLoading(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Nuevo usuario">
      <div className="space-y-4">
        <Input label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <Input label="Nombre" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input label="Contraseña" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <Input label="PIN (4-6 dígitos, opcional)" value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))} />
        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Rol</label>
          <select className="input w-full" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} data-testid="users-new-role">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading} data-testid="users-new-submit">{loading ? 'Creando...' : 'Crear'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose, onError }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      const data = {};
      if (password) data.password = password;
      if (pin) data.pin = pin;
      await usersApi.resetCredentials(user.id, data);
      onClose();
    } catch (e) { onError(e.response?.data?.error || 'Error al resetear'); onClose(); }
    finally { setLoading(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Resetear credenciales: ${user.email}`}>
      <div className="space-y-4">
        <Input label="Nueva contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label="Nuevo PIN (4-6 dígitos)" value={pin} onChange={(e) => setPin(e.target.value)} />
        <p className="text-xs text-[#6E7681]">Completá al menos uno.</p>
        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading || (!password && !pin)} data-testid="users-reset-submit">{loading ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}
