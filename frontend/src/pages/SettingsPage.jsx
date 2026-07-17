import { useEffect, useState, useMemo } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/shared/FormFields';
import api from '@/lib/api';
import UsersSection from '@/components/settings/UsersSection';
import CommissionSplitEditor from '@/components/treasury/CommissionSplitEditor';

export default function SettingsPage() {
  const { fetchSettings, updateSettings } = useApp();
  const { changePassword, role } = useAuth();
  const [settings, setSettings] = useState({ fixedMonthly: '800000', alertDays: '15' });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [commCfg, setCommCfg] = useState(null);
  const [commError, setCommError] = useState('');
  const [commSuccess, setCommSuccess] = useState(false);
  const [tab, setTab] = useState('negocio');

  useEffect(() => {
    fetchSettings().then(s => { if (s) setSettings({ fixedMonthly: s.fixedMonthly || '800000', alertDays: s.alertDays || '15' }); });
  }, [fetchSettings]);

  useEffect(() => {
    api.get('/settings/commission-config').then(r => {
      const data = r.data;
      // _id estable para las keys del editor (se descarta antes del PUT).
      data.commission_default_team = (data.commission_default_team || [])
        .map(row => ({ _id: crypto.randomUUID(), ...row }));
      data.investor_team = (data.investor_team || [])
        .map(row => ({ _id: crypto.randomUUID(), ...row }));
      setCommCfg(data);
    }).catch(() => {});
  }, []);

  const tabs = useMemo(() => {
    const base = [
      { id: 'negocio', label: 'Negocio' },
      { id: 'comisiones', label: 'Comisiones' },
      { id: 'cuenta', label: 'Cuenta' },
    ];
    if (role === 'ADMIN') base.push({ id: 'usuarios', label: 'Usuarios' });
    return base;
  }, [role]);

  const handleSaveSettings = () => { updateSettings(settings); };

  const handleSaveCommissions = async () => {
    setCommError(''); setCommSuccess(false);
    const bucketSum = Number(commCfg.commission_share_pct) + Number(commCfg.reinvest_share_pct) + Number(commCfg.tax_share_pct);
    if (Math.abs(bucketSum - 100) > 0.001) { setCommError('Los tres bolsillos deben sumar 100'); return; }
    const splitSum = Number(commCfg.default_captador_pct) + Number(commCfg.default_cerrador_pct);
    if (Math.abs(splitSum - 100) > 0.001) { setCommError('Captador + cerrador deben sumar 100'); return; }
    const investorTeamClean = (commCfg.investor_team || [])
      .filter((r) => r.thirdPartyId && parseFloat(r.sharePct) > 0)
      .map((r) => ({ thirdPartyId: r.thirdPartyId, role: 'INVESTOR', sharePct: Number(r.sharePct) }));
    if (investorTeamClean.length > 0) {
      const investorSum = investorTeamClean.reduce((s, r) => s + r.sharePct, 0);
      if (Math.abs(investorSum - 100) > 0.001) { setCommError('Los porcentajes de inversionistas deben sumar 100'); return; }
    }
    if (commCfg.reinvest_pct !== undefined && commCfg.tax_pct !== undefined) {
      const reinvestTaxSum = Number(commCfg.reinvest_pct) + Number(commCfg.tax_pct);
      if (reinvestTaxSum > 100.001) { setCommError('Reinversión % + Impuestos % (ganancia) no pueden superar 100'); return; }
    }
    try {
      const teamClean = (commCfg.commission_default_team || [])
        .filter((r) => r.thirdPartyId && parseFloat(r.sharePct) > 0)
        .map((r) => ({ thirdPartyId: r.thirdPartyId, role: r.role, sharePct: Number(r.sharePct) }));
      await api.put('/settings/commission-config', {
        ...commCfg,
        commission_default_team: teamClean,
        commission_default_team_people: undefined,
        investor_team: investorTeamClean,
        investor_team_people: undefined,
        reinvest_account: undefined,
        tax_reserve_account: undefined,
      });
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
      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto" data-testid="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-accent/20 text-accent' : 'text-[#6E7681] hover:bg-surface-hover'
            }`}
            data-testid={`settings-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'negocio' && (
        <div className="card">
          <div className="card-title">Configuración del Negocio</div>
          <div className="space-y-4">
            <Input label="Gasto Fijo Mensual (COP)" type="number" value={settings.fixedMonthly} onChange={e => setSettings(p => ({ ...p, fixedMonthly: e.target.value }))} help="Parqueadero, publicidad fija, etc. Se proratea por vehículo." />
            <Input label="Alerta de Días en Inventario" type="number" value={settings.alertDays} onChange={e => setSettings(p => ({ ...p, alertDays: e.target.value }))} help="Después de estos días, el carro muestra alerta amarilla." />
            <button onClick={handleSaveSettings} className="btn-primary">Guardar Configuración</button>
          </div>
        </div>
      )}

      {tab === 'comisiones' && (
        commCfg ? (
          <>
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
              <div className="border-t border-border pt-3">
                <div className="text-sm font-semibold text-[#E6EDF3] mb-1">Equipo de reparto</div>
                <p className="text-xs text-[#6E7681] mb-2">
                  Personas que reciben parte del bolsillo de comisión en cada venta (máx 5).
                  Tu parte es el resto, automática. Puedes ajustarlo por venta al vender.
                </p>
                <CommissionSplitEditor
                  value={commCfg.commission_default_team || []}
                  onChange={(team) => setCommCfg({ ...commCfg, commission_default_team: team })}
                  testidPrefix="settings-team"
                />
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

          <div className="card" data-testid="settings-investors-card">
            <div className="card-title">Ganancia · Equipo de inversionistas</div>
            <p className="text-xs text-[#6E7681] mb-3">
              Cómo se reparte la ganancia neta de cada venta entre los inversionistas (capital).
              Independiente del equipo de reparto de comisiones.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Input label="Comisión (bruta) %" type="number" value={commCfg.commission_gross_pct ?? ''}
                  onChange={e => setCommCfg({ ...commCfg, commission_gross_pct: e.target.value })}
                  data-testid="settings-commission-gross-pct" />
                <Input label="Reinversión %" type="number" value={commCfg.reinvest_pct ?? ''}
                  onChange={e => setCommCfg({ ...commCfg, reinvest_pct: e.target.value })}
                  data-testid="settings-investor-reinvest-pct" />
                <Input label="Impuestos %" type="number" value={commCfg.tax_pct ?? ''}
                  onChange={e => setCommCfg({ ...commCfg, tax_pct: e.target.value })}
                  data-testid="settings-investor-tax-pct" />
              </div>
              <p className="text-[11px] text-[#6E7681] -mt-1">
                Comisión: % de la ganancia bruta. Reinversión + Impuestos: % del remanente después de comisión (no deben superar 100 entre sí).
              </p>
              <div className="border-t border-border pt-3">
                <div className="text-sm font-semibold text-[#E6EDF3] mb-1">Equipo de inversionistas</div>
                <p className="text-xs text-[#6E7681] mb-2">
                  Personas que reciben ganancia como inversionistas de capital. A diferencia del equipo de reparto,
                  el dueño puede ser una fila más. Vacío = 100% al dueño; si agregas filas, deben sumar exactamente 100.
                </p>
                <CommissionSplitEditor
                  value={commCfg.investor_team || []}
                  onChange={(team) => setCommCfg({ ...commCfg, investor_team: team })}
                  testidPrefix="settings-investors"
                  roles={[{ id: 'INVESTOR', label: 'Inversionista' }]}
                  requireExactSum
                  maxPeople={10}
                />
              </div>
              {commError && <div className="text-[12px] text-red-400">{commError}</div>}
              {commSuccess && <div className="text-[12px] text-green-400">Guardado.</div>}
              <button onClick={handleSaveCommissions} className="btn-primary" data-testid="settings-save-investors">
                Guardar configuración de comisiones e inversionistas
              </button>
            </div>
          </div>
          </>
        ) : (
          <div className="card text-sm text-[#6E7681]">Configuración de comisiones no disponible.</div>
        )
      )}

      {tab === 'cuenta' && (
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
      )}

      {tab === 'usuarios' && role === 'ADMIN' && <UsersSection />}
    </div>
  );
}
