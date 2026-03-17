import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const { login, pinLogin } = useAuth();
  const [mode, setMode] = useState('pin'); // 'pin' | 'email'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      if (mode === 'pin') {
        await pinLogin({ pin, email: email || undefined });
      } else {
        await login({ email, password });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Error de autenticación');
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center p-5 font-sans">
      <div className={`bg-surface border border-border rounded-2xl p-10 w-full max-w-sm flex flex-col items-center ${shake ? 'animate-[shake_0.5s_ease]' : 'animate-scale-in'}`}>
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-[#BC8CFF] flex items-center justify-center text-2xl font-extrabold text-[#0D1117] mb-4">AC</div>
        <h1 className="text-2xl font-extrabold tracking-tight">AutoControl</h1>
        <p className="text-xs text-[#6E7681] mt-1">Motor de Inteligencia Financiera</p>

        {/* Mode tabs */}
        <div className="flex gap-1 mt-8 bg-[#0F1419] rounded-lg p-1 w-full">
          <button onClick={() => setMode('pin')} className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${mode === 'pin' ? 'bg-accent text-[#0D1117]' : 'text-[#8B949E]'}`}>PIN Rápido</button>
          <button onClick={() => setMode('email')} className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors ${mode === 'email' ? 'bg-accent text-[#0D1117]' : 'text-[#8B949E]'}`}>Email</button>
        </div>

        <div className="w-full mt-6 space-y-4">
          {mode === 'email' && (
            <div>
              <label className="label-sm">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder="admin@autocontrol.co" className="input-field" />
            </div>
          )}

          {mode === 'pin' ? (
            <div>
              <label className="label-sm">PIN de Acceso</label>
              <input type="password" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder="••••" className="input-field text-center text-2xl tracking-[12px] font-mono" />
            </div>
          ) : (
            <div>
              <label className="label-sm">Contraseña</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder="••••••••" className="input-field" />
            </div>
          )}

          {error && <p className="text-[#F85149] text-xs text-center">{error}</p>}

          <button onClick={handleSubmit} disabled={loading} className="btn-primary w-full py-3">
            {loading ? 'Ingresando...' : 'Ingresar como Admin'}
          </button>
        </div>

        <p className="text-[10px] text-[#6E7681] mt-6">PIN por defecto: 1234 · Email: admin@autocontrol.co</p>
      </div>
    </div>
  );
}
