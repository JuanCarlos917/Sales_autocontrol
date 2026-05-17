// ═══════════════════════════════════════════════════════════════
// BalanceCard — Card de saldo con alertas visuales
// ═══════════════════════════════════════════════════════════════

import { formatCurrency } from '@/lib/constants';

export default function BalanceCard({ accounts = [], totalBalance = 0, loading = false }) {
  const hasNegativeBalance = totalBalance < 0;
  const hasNegativeAccount = accounts.some(acc => parseFloat(acc.currentBalance) < 0);

  if (loading) {
    return (
      <div className="card p-6 animate-pulse">
        <div className="h-4 bg-surface-hover rounded w-24 mb-3" />
        <div className="h-10 bg-surface-hover rounded w-48 mb-4" />
        <div className="h-3 bg-surface-hover rounded w-32" />
      </div>
    );
  }

  return (
    <div className={`card p-6 relative overflow-hidden ${
      hasNegativeBalance ? 'border-red-500/50 bg-red-500/5' : ''
    }`}>
      {/* Alerta visual si hay saldo negativo */}
      {hasNegativeBalance && (
        <div className="absolute top-0 right-0 px-3 py-1 bg-red-500/20 text-red-400 text-xs font-semibold rounded-bl-lg">
          ⚠ Saldo Negativo
        </div>
      )}

      <div className="text-sm text-[#8B949E] mb-1">Saldo Disponible</div>
      <div className={`text-3xl font-bold mb-4 ${
        hasNegativeBalance ? 'text-red-400' : 'text-[#E6EDF3]'
      }`}>
        {formatCurrency(totalBalance)}
      </div>

      {/* Desglose por cuenta */}
      {accounts.length > 0 && (
        <div className="space-y-2 pt-4 border-t border-border">
          <div className="text-xs text-[#6E7681] uppercase tracking-wider mb-2">
            Cuentas ({accounts.length})
          </div>
          {accounts.map((account) => {
            const balance = parseFloat(account.currentBalance);
            const isNegative = balance < 0;
            return (
              <div key={account.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    account.type === 'CASH' ? 'bg-green-400' : 'bg-blue-400'
                  }`} />
                  <span className="text-sm text-[#8B949E]">{account.name}</span>
                </div>
                <span className={`text-sm font-mono font-semibold ${
                  isNegative ? 'text-red-400' : 'text-[#E6EDF3]'
                }`}>
                  {formatCurrency(balance)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Advertencia de cuenta negativa */}
      {hasNegativeAccount && !hasNegativeBalance && (
        <div className="mt-4 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="text-xs text-amber-400">
            ⚠ Una o mas cuentas tienen saldo negativo
          </div>
        </div>
      )}
    </div>
  );
}
