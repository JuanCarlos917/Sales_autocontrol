import { useEffect, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/shared/FormFields';

export default function SettingsPage() {
  const { fetchSettings, updateSettings } = useApp();
  const { changePassword } = useAuth();
  const [settings, setSettings] = useState({ fixedMonthly: '800000', alertDays: '15' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    fetchSettings().then(s => { if (s) setSettings({ fixedMonthly: s.fixedMonthly || '800000', alertDays: s.alertDays || '15' }); });
  }, [fetchSettings]);

  const handleSaveSettings = () => {
    updateSettings(settings);
  };

  const handleChangePassword = async () => {
    setPwError(''); setPwSuccess(false);
    if (pwForm.newPassword !== pwForm.confirm) { setPwError('Las contraseñas no coinciden'); return; }
    if (pwForm.newPassword.length < 6) { setPwError('Mínimo 6 caracteres'); return; }
    try {
      await changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwSuccess(true);
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { setPwError(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div className="card">
        <div className="card-title">Configuración del Negocio</div>
        <div className="space-y-4">
          <Input label="Gasto Fijo Mensual (COP)" type="number" value={settings.fixedMonthly} onChange={e => setSettings(p => ({ ...p, fixedMonthly: e.target.value }))} help="Parqueadero, publicidad fija, etc. Se proratea por vehículo." />
          <Input label="Alerta de Días en Inventario" type="number" value={settings.alertDays} onChange={e => setSettings(p => ({ ...p, alertDays: e.target.value }))} help="Después de estos días, el carro muestra alerta amarilla." />
          <button onClick={handleSaveSettings} className="btn-primary">Guardar Configuración</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Cambiar Contraseña</div>
        <div className="space-y-4">
          <Input label="Contraseña Actual" type="password" value={pwForm.currentPassword} onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))} />
          <Input label="Nueva Contraseña" type="password" value={pwForm.newPassword} onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))} />
          <Input label="Confirmar Nueva Contraseña" type="password" value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
          {pwError && <p className="text-xs text-[#F85149]">{pwError}</p>}
          {pwSuccess && <p className="text-xs text-[#3FB950]">Contraseña actualizada</p>}
          <button onClick={handleChangePassword} className="btn-primary">Actualizar Contraseña</button>
        </div>
      </div>
    </div>
  );
}
