// ═══════════════════════════════════════════════════════════════
// SalePaymentModal — Modal para registrar venta de vehículo
// Soporta: efectivo, transferencia, cruce, financiado, mixto
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';
import ThirdPartySelector from '@/components/shared/ThirdPartySelector';
import { Banknote, Landmark, RefreshCw, ClipboardList, Plus, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import api from '@/lib/api';

const PAYMENT_TYPES = [
  { id: 'CASH', label: 'Efectivo', icon: Banknote },
  { id: 'TRANSFER', label: 'Transferencia', icon: Landmark },
  { id: 'TRADE_IN', label: 'Cruce de Vehiculo', icon: RefreshCw },
  { id: 'FINANCED', label: 'Financiado', icon: ClipboardList },
  { id: 'MIXED', label: 'Mixto', icon: Plus },
];

export default function SalePaymentModal({
  isOpen,
  onClose,
  onSubmit,
  vehicle,
  loading = false,
}) {
  const [accounts, setAccounts] = useState([]);
  const [step, setStep] = useState(1); // 1: tipo pago, 2: detalles
  const [errors, setErrors] = useState({});
  const [paymentType, setPaymentType] = useState('CASH');
  const [form, setForm] = useState({
    salePrice: '',
    saleDate: getLocalDateString(),
    buyerId: '',
    // Pago efectivo/transferencia (CASH/TRANSFER simple, una cuenta)
    cashAccountId: '',
    cashAmount: '',
    // Pago mixto: dos líneas (efectivo Caja + transferencia Banco)
    mixedCashAccountId: '',
    mixedCashAmount: '',
    mixedTransferAccountId: '',
    mixedTransferAmount: '',
    // Cruce
    tradeInPlate: '',
    tradeInValue: '',
    tradeInBrand: '',
    tradeInModel: '',
    tradeInYear: '',
    tradeInColor: '',
    tradeInKm: '',
    // Financiamiento
    financingDueDate: '',
    financingNotes: '',
  });

  // Comisión: sección opcional. touched=false → el payload no manda participants.
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [commissionTouched, setCommissionTouched] = useState(false);
  const [commission, setCommission] = useState({
    captadorId: 'owner-self', captadorPct: 30,
    cerradorId: 'owner-self', cerradorPct: 70,
  });

  useEffect(() => {
    if (isOpen) {
      loadData();
      resetForm();
    }
  }, [isOpen, vehicle]);

  const loadData = async () => {
    try {
      const accountsRes = await accountsApi.getAll();
      const active = accountsRes.data.filter(a => a.isActive);
      setAccounts(active);
      const firstCash = active.find(a => a.type === 'CASH');
      const firstBank = active.find(a => a.type === 'BANK');
      setForm(prev => ({
        ...prev,
        cashAccountId: prev.cashAccountId || active[0]?.id || '',
        mixedCashAccountId: prev.mixedCashAccountId || firstCash?.id || '',
        mixedTransferAccountId: prev.mixedTransferAccountId || firstBank?.id || '',
      }));

      const cfgRes = await api.get('/settings/commission-config').catch(() => null);
      if (cfgRes?.data) {
        setCommission(c => ({
          ...c,
          captadorPct: Number(cfgRes.data.default_captador_pct) || 30,
          cerradorPct: Number(cfgRes.data.default_cerrador_pct) || 70,
        }));
      }
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  const resetForm = () => {
    setStep(1);
    setPaymentType('CASH');
    setErrors({});
    setForm({
      salePrice: vehicle?.salePrice?.toString() || vehicle?.listedPrice?.toString() || '',
      saleDate: getLocalDateString(),
      buyerId: vehicle?.buyerId || '',
      cashAccountId: accounts[0]?.id || '',
      cashAmount: '',
      mixedCashAccountId: accounts.find(a => a.type === 'CASH')?.id || '',
      mixedCashAmount: '',
      mixedTransferAccountId: accounts.find(a => a.type === 'BANK')?.id || '',
      mixedTransferAmount: '',
      tradeInPlate: '',
      tradeInValue: '',
      tradeInBrand: '',
      tradeInModel: '',
      tradeInYear: '',
      tradeInColor: '',
      tradeInKm: '',
      financingDueDate: '',
      financingNotes: '',
    });
    setCommissionOpen(false);
    setCommissionTouched(false);
  };

  const handleTypeSelect = (type) => {
    setPaymentType(type);
    // No pre-llenar monto para que el usuario ingrese lo que realmente recibe
    setStep(2);
  };

  const calculateSummary = () => {
    const salePrice = parseFloat(form.salePrice) || 0;
    const cashAmount = parseFloat(form.cashAmount) || 0;
    const mixedCash = parseFloat(form.mixedCashAmount) || 0;
    const mixedTransfer = parseFloat(form.mixedTransferAmount) || 0;
    const tradeInValue = parseFloat(form.tradeInValue) || 0;

    let totalReceived = 0;
    if (['CASH', 'TRANSFER'].includes(paymentType)) {
      totalReceived += cashAmount;
    }
    if (paymentType === 'MIXED') {
      totalReceived += mixedCash + mixedTransfer;
    }
    if (['TRADE_IN', 'MIXED'].includes(paymentType)) {
      totalReceived += tradeInValue;
    }

    const pendingAmount = Math.max(0, salePrice - totalReceived);

    return { salePrice, totalReceived, pendingAmount, tradeInValue };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const summary = calculateSummary();
    const newErrors = {};

    if (summary.salePrice <= 0) {
      newErrors.salePrice = 'El precio de venta debe ser mayor a 0';
    }

    if (!form.buyerId) {
      newErrors.buyerId = 'Debe seleccionar un cliente (comprador)';
    }

    if (paymentType === 'MIXED') {
      if (parseFloat(form.mixedCashAmount) > 0 && !form.mixedCashAccountId) {
        newErrors.mixedCash = 'Selecciona la cuenta de efectivo';
      }
      if (parseFloat(form.mixedTransferAmount) > 0 && !form.mixedTransferAccountId) {
        newErrors.mixedTransfer = 'Selecciona la cuenta de transferencia';
      }
      if (summary.totalReceived > summary.salePrice) {
        newErrors.salePrice = 'Lo recibido no puede superar el precio de venta';
      }
    }

    const pctSum = Number(commission.captadorPct) + Number(commission.cerradorPct);
    if (commissionTouched && Math.abs(pctSum - 100) > 0.001) {
      newErrors.commission = `Captador + Cerrador deben sumar 100% (va en ${pctSum}%)`;
    }
    if (commissionTouched && (!commission.captadorId || !commission.cerradorId)) {
      newErrors.commission = 'Selecciona captador y cerrador';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    const saleData = {
      salePrice: summary.salePrice,
      paymentType,
      saleDate: form.saleDate || null,
      buyerId: form.buyerId,
      thirdPartyId: form.buyerId,
    };

    // Pago simple en efectivo/transferencia (una cuenta)
    if (['CASH', 'TRANSFER'].includes(paymentType) && form.cashAccountId && parseFloat(form.cashAmount) > 0) {
      saleData.cashPayment = {
        accountId: form.cashAccountId,
        amount: parseFloat(form.cashAmount),
      };
    }

    // Pago mixto: dos líneas (efectivo + transferencia), cada una opcional
    if (paymentType === 'MIXED') {
      const lines = [];
      if (form.mixedCashAccountId && parseFloat(form.mixedCashAmount) > 0) {
        lines.push({ accountId: form.mixedCashAccountId, amount: parseFloat(form.mixedCashAmount), method: 'CASH' });
      }
      if (form.mixedTransferAccountId && parseFloat(form.mixedTransferAmount) > 0) {
        lines.push({ accountId: form.mixedTransferAccountId, amount: parseFloat(form.mixedTransferAmount), method: 'TRANSFER' });
      }
      if (lines.length > 0) saleData.cashPayments = lines;
    }

    // Agregar cruce
    if (['TRADE_IN', 'MIXED'].includes(paymentType) && form.tradeInPlate && form.tradeInValue) {
      saleData.tradeIn = {
        plate: form.tradeInPlate.toUpperCase(),
        value: parseFloat(form.tradeInValue),
        brand: form.tradeInBrand || null,
        model: form.tradeInModel || null,
        year: form.tradeInYear ? parseInt(form.tradeInYear) : null,
        color: form.tradeInColor || null,
        km: form.tradeInKm ? parseInt(form.tradeInKm) : null,
      };
    }

    // Agregar datos de financiamiento
    if (['FINANCED', 'MIXED'].includes(paymentType) || summary.pendingAmount > 0) {
      saleData.financing = {
        dueDate: form.financingDueDate || null,
        notes: form.financingNotes || null,
      };
    }

    // Participantes de comisión: solo si el usuario tocó la sección.
    if (commissionTouched) {
      saleData.participants = [
        { thirdPartyId: commission.captadorId, role: 'CAPTADOR', sharePct: Number(commission.captadorPct) },
        { thirdPartyId: commission.cerradorId, role: 'CERRADOR', sharePct: Number(commission.cerradorPct) },
      ];
    }

    await onSubmit(saleData);
  };

  const summary = calculateSummary();
  const cashAccounts = accounts.filter(a => a.type === 'CASH');
  const bankAccounts = accounts.filter(a => a.type === 'BANK');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 1 ? 'Registrar Venta' : `Venta: ${vehicle?.plate}`}
      width="max-w-xl"
    >
      {step === 1 ? (
        <div className="space-y-4">
          {/* Info del vehículo */}
          {vehicle?.metrics?.realCost > 0 && (
            <div className="bg-[#161B22] rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#6E7681]">Inversión Total</span>
                <span className="font-mono">{formatCurrency(vehicle.metrics.realCost)}</span>
              </div>
            </div>
          )}

          {/* Precio de venta */}
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Precio de Venta *</label>
            <input
              type="number"
              value={form.salePrice}
              onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
              className="input w-full text-lg font-semibold"
              min="1"
              required
              data-testid="sale-price"
            />
          </div>

          {/* Advertencia de pérdida */}
          {form.salePrice && vehicle?.metrics?.realCost > 0 && parseFloat(form.salePrice) < vehicle.metrics.realCost && (
            <div className="text-sm p-3 rounded-lg bg-[#D29922]/10 text-[#D29922] border border-[#D29922]/30">
              Venderás con pérdida de {formatCurrency(vehicle.metrics.realCost - parseFloat(form.salePrice))}
            </div>
          )}

          {/* Tipo de pago */}
          <div>
            <label className="block text-sm text-[#8B949E] mb-2">Forma de Pago</label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => handleTypeSelect(type.id)}
                  disabled={!form.salePrice}
                  data-testid={`sale-payment-type-${type.id}`}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    !form.salePrice
                      ? 'border-border bg-surface opacity-50 cursor-not-allowed'
                      : 'border-border bg-surface hover:border-accent hover:bg-surface-hover'
                  }`}
                >
                  <type.icon className="w-5 h-5 mr-2 inline" />
                  <span className="text-sm text-[#E6EDF3]">{type.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Header con resumen */}
          <div className="bg-surface-hover rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-[#8B949E]">Precio de venta:</span>
              <span className="text-[#E6EDF3] font-semibold">{formatCurrency(summary.salePrice)}</span>
            </div>
            {summary.totalReceived > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#8B949E]">Total recibido:</span>
                <span className="text-green-400">{formatCurrency(summary.totalReceived)}</span>
              </div>
            )}
            {summary.pendingAmount > 0 && (
              <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1">
                <span className="text-[#8B949E]">Saldo pendiente (CxC):</span>
                <span className="text-amber-400">{formatCurrency(summary.pendingAmount)}</span>
              </div>
            )}
          </div>

          {/* Fecha y Cliente */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Fecha</label>
              <input
                type="date"
                value={form.saleDate}
                onChange={(e) => setForm({ ...form, saleDate: e.target.value })}
                className="input w-full"
              />
            </div>
            <ThirdPartySelector
              value={form.buyerId}
              onChange={(id) => {
                setForm({ ...form, buyerId: id });
                if (errors.buyerId) setErrors({ ...errors, buyerId: null });
              }}
              filterType="CLIENT"
              label="Cliente (comprador) *"
              placeholder="Seleccionar cliente..."
              required={true}
              error={errors.buyerId}
            />
          </div>

          {/* Pago simple efectivo/transferencia (una cuenta) */}
          {['CASH', 'TRANSFER'].includes(paymentType) && (
            <div className="border border-border rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Datos del Pago</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Cuenta *</label>
                  <select
                    value={form.cashAccountId}
                    onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })}
                    className="input w-full"
                    required
                    data-testid="sale-cash-account"
                  >
                    <option value="">Seleccionar</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Monto *</label>
                  <input
                    type="number"
                    value={form.cashAmount}
                    onChange={(e) => setForm({ ...form, cashAmount: e.target.value })}
                    className="input w-full"
                    min="1"
                    required
                    data-testid="sale-cash-amount"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Pago mixto: efectivo (Caja) + transferencia (Banco), cada uno opcional */}
          {paymentType === 'MIXED' && (
            <div className="border border-border rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Pago en dos formas</h4>
              <p className="text-[11px] text-[#6E7681]">
                Ingresa cuánto recibes en efectivo y/o transferencia. Lo que falte queda como cuenta por cobrar (CxC).
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1 inline-flex items-center gap-1.5"><Banknote className="w-4 h-4" /> Efectivo — Cuenta</label>
                  <select
                    value={form.mixedCashAccountId}
                    onChange={(e) => setForm({ ...form, mixedCashAccountId: e.target.value })}
                    className="input w-full"
                    data-testid="sale-mixed-cash-account"
                  >
                    <option value="">Sin efectivo</option>
                    {cashAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Monto efectivo</label>
                  <input
                    type="number"
                    value={form.mixedCashAmount}
                    onChange={(e) => setForm({ ...form, mixedCashAmount: e.target.value })}
                    className="input w-full"
                    min="0"
                    placeholder="0"
                    data-testid="sale-mixed-cash-amount"
                  />
                </div>
              </div>
              {errors.mixedCash && <p className="text-[11px] text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.mixedCash}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1 inline-flex items-center gap-1.5"><Landmark className="w-4 h-4" /> Transferencia — Cuenta</label>
                  <select
                    value={form.mixedTransferAccountId}
                    onChange={(e) => setForm({ ...form, mixedTransferAccountId: e.target.value })}
                    className="input w-full"
                    data-testid="sale-mixed-transfer-account"
                  >
                    <option value="">Sin transferencia</option>
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Monto transferencia</label>
                  <input
                    type="number"
                    value={form.mixedTransferAmount}
                    onChange={(e) => setForm({ ...form, mixedTransferAmount: e.target.value })}
                    className="input w-full"
                    min="0"
                    placeholder="0"
                    data-testid="sale-mixed-transfer-amount"
                  />
                </div>
              </div>
              {errors.mixedTransfer && <p className="text-[11px] text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.mixedTransfer}</p>}
            </div>
          )}

          {/* Cruce de vehiculo */}
          {['TRADE_IN', 'MIXED'].includes(paymentType) && (
            <div className="border border-border rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Vehiculo Recibido en Cruce</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Placa {paymentType === 'TRADE_IN' ? '*' : '(opcional)'}</label>
                  <input
                    type="text"
                    value={form.tradeInPlate}
                    onChange={(e) => setForm({ ...form, tradeInPlate: e.target.value.toUpperCase() })}
                    className="input w-full font-mono"
                    maxLength="10"
                    required={paymentType === 'TRADE_IN'}
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Valor del Cruce {paymentType === 'TRADE_IN' ? '*' : '(opcional)'}</label>
                  <input
                    type="number"
                    value={form.tradeInValue}
                    onChange={(e) => setForm({ ...form, tradeInValue: e.target.value })}
                    className="input w-full"
                    min="1"
                    required={paymentType === 'TRADE_IN'}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Marca</label>
                  <input
                    type="text"
                    value={form.tradeInBrand}
                    onChange={(e) => setForm({ ...form, tradeInBrand: e.target.value })}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Modelo</label>
                  <input
                    type="text"
                    value={form.tradeInModel}
                    onChange={(e) => setForm({ ...form, tradeInModel: e.target.value })}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Ano</label>
                  <input
                    type="number"
                    value={form.tradeInYear}
                    onChange={(e) => setForm({ ...form, tradeInYear: e.target.value })}
                    className="input w-full"
                    min="1980"
                    max="2030"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Financiamiento / CxC */}
          {(paymentType === 'FINANCED' || summary.pendingAmount > 0) && (
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-amber-400">
                Cuenta por Cobrar: {formatCurrency(summary.pendingAmount || summary.salePrice)}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Fecha de Vencimiento</label>
                  <input
                    type="date"
                    value={form.financingDueDate}
                    onChange={(e) => setForm({ ...form, financingDueDate: e.target.value })}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
                  <input
                    type="text"
                    value={form.financingNotes}
                    onChange={(e) => setForm({ ...form, financingNotes: e.target.value })}
                    className="input w-full"
                    placeholder="Ej: 3 cuotas"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Comisión: captador/cerrador (opcional, default: tú) */}
          <div className="border border-border rounded-lg p-3">
            <button
              type="button"
              onClick={() => setCommissionOpen(o => !o)}
              className="w-full flex items-center gap-2 text-sm font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
              data-testid="sale-commission-toggle"
            >
              {commissionOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Comisión — Captador/Cerrador (default: tú)
            </button>
            {commissionOpen && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2">
                    <ThirdPartySelector
                      value={commission.captadorId}
                      onChange={(id) => { setCommission(c => ({ ...c, captadorId: id })); setCommissionTouched(true); }}
                      label="Captador"
                      placeholder="Seleccionar..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#8B949E] mb-1">%</label>
                    <input
                      type="number" min="0" max="100"
                      value={commission.captadorPct}
                      onChange={(e) => { setCommission(c => ({ ...c, captadorPct: e.target.value })); setCommissionTouched(true); }}
                      className="input w-full"
                      data-testid="sale-captador-pct"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2">
                    <ThirdPartySelector
                      value={commission.cerradorId}
                      onChange={(id) => { setCommission(c => ({ ...c, cerradorId: id })); setCommissionTouched(true); }}
                      label="Cerrador"
                      placeholder="Seleccionar..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#8B949E] mb-1">%</label>
                    <input
                      type="number" min="0" max="100"
                      value={commission.cerradorPct}
                      onChange={(e) => { setCommission(c => ({ ...c, cerradorPct: e.target.value })); setCommissionTouched(true); }}
                      className="input w-full"
                      data-testid="sale-cerrador-pct"
                    />
                  </div>
                </div>
                {errors.commission && (
                  <p className="text-[11px] text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.commission}</p>
                )}
              </div>
            )}
          </div>

          {/* Botones */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-ghost flex-1"
              disabled={loading}
            >
              Atras
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 bg-green-600 hover:bg-green-700"
              disabled={loading}
              data-testid="sale-submit"
            >
              {loading ? 'Procesando...' : 'Confirmar Venta'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
