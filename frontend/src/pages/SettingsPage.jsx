import { useEffect, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/shared/FormFields';
import api from '@/lib/api';

export default function SettingsPage() {
  const { fetchSettings, updateSettings } = useApp();
  const { changePassword } = useAuth();
  const [settings, setSettings] = useState({ fixedMonthly: '800000', alertDays: '15' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [commCfg, setCommCfg] = useState(null);
  const [commError, setCommError] = useState('');
  const [commSuccess, setCommSuccess] = useState(false);

  useEffect(() => {
    fetchSettings().then(s => { if (s) setSettings({ fixedMonthly: s.fixedMonthly || '800000', alertDays: s.alertDays || '15' }); });
  }, [fetchSettings]);

  useEffect(() => {
    api.get('/settings/commission-config').then(r => setCommCfg(r.data)).catch(() => {});
  }, []);

  const handleSaveSettings = () => {
    updateSettings(settings);
  };

  const handleSaveCommissions = async () => {
    setCommError(''); setCommSuccess(false);
    const bucketSum = Number(commCfg.commission_share_pct) + Number(commCfg.reinvest_share_pct) + Number(commCfg.tax_share_pct);
    if (Math.abs(bucketSum - 100) > 0.001) { setCommError('Los tres bolsillos deben sumar 100'); return; }
    const splitSum = Number(commCfg.default_captador_pct) + Number(commCfg.default_cerrador_pct);
    if (Math.abs(splitSum - 100) > 0.001) { setCommError('Captador + cerrador deben sumar 100'); return; }
    try {
      await api.put('/settings/commission-config', commCfg);
      setCommSuccess(true);
    } catch (err) {
      setCommError(err.response?.data?.error || 'Error al guardar');
    }
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

      {commCfg && (
        <div className="card" data-testid="settings-commissions-card">
          <div className="card-title">Comisiones y bolsillos</div>
          <p className="text-xs text-[#6E7681] mb-3">
            Cómo se reparte la ganancia bruta de cada venta. Los tres porcentajes deben sumar 100.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Input label="Comisiones %" type="number" value={commCfg.commission_share_pct}
                onChange={e => setCommCfg({ ...commCfg, commission_share_pct: e.target.value })}
                data-testid="settings-commission-pct" />
              <Input label="Reinversión %" type="number" value={commCfg.reinvest_share_pct}
                onChange={e => setCommCfg({ ...commCfg, reinvest_share_pct: e.target.value })}
                data-testid="settings-reinvest-pct" />
              <Input label="Impuestos %" type="number" value={commCfg.tax_share_pct}
                onChange={e => setCommCfg({ ...commCfg, tax_share_pct: e.target.value })}
                data-testid="settings-tax-pct" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Captador % (default)" type="number" value={commCfg.default_captador_pct}
                onChange={e => setCommCfg({ ...commCfg, default_captador_pct: e.target.value })}
                data-testid="settings-captador-pct" />
              <Input label="Cerrador % (default)" type="number" value={commCfg.default_cerrador_pct}
                onChange={e => setCommCfg({ ...commCfg, default_cerrador_pct: e.target.value })}
                data-testid="settings-cerrador-pct" />
            </div>
            <div className="text-xs text-[#8B949E]">
              Fondo Reinversión: <span className="text-[#E6EDF3] font-mono">{commCfg.reinvest_account?.name || commCfg.reinvest_account_id}</span>
              {' · '}
              Reserva Impuestos: <span className="text-[#E6EDF3] font-mono">{commCfg.tax_reserve_account?.name || commCfg.tax_reserve_account_id}</span>
            </div>
            {commError && <div className="text-[12px] text-red-400">{commError}</div>}
            {commSuccess && <div className="text-[12px] text-green-400">Guardado.</div>}
            <button onClick={handleSaveCommissions} className="btn-primary" data-testid="settings-save-commissions">
              Guardar configuración de comisiones
            </button>
          </div>
        </div>
      )}

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
