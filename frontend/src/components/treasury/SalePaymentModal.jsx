// ═══════════════════════════════════════════════════════════════
// SalePaymentModal — Modal para registrar venta de vehículo
// Soporta: efectivo, transferencia, cruce, financiado, mixto
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';
import ThirdPartySelector from '@/components/shared/ThirdPartySelector';

const PAYMENT_TYPES = [
  { id: 'CASH', label: 'Efectivo', icon: '💵' },
  { id: 'TRANSFER', label: 'Transferencia', icon: '🏦' },
  { id: 'TRADE_IN', label: 'Cruce de Vehiculo', icon: '🔄' },
  { id: 'FINANCED', label: 'Financiado', icon: '📋' },
  { id: 'MIXED', label: 'Mixto', icon: '➕' },
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
    // Pago efectivo/transferencia
    cashAccountId: '',
    cashAmount: '',
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

  useEffect(() => {
    if (isOpen) {
      loadData();
      resetForm();
    }
  }, [isOpen, vehicle]);

  const loadData = async () => {
    try {
      const accountsRes = await accountsApi.getAll();
      setAccounts(accountsRes.data.filter(a => a.isActive));
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
  };

  const handleTypeSelect = (type) => {
    setPaymentType(type);
    // No pre-llenar monto para que el usuario ingrese lo que realmente recibe
    setStep(2);
  };

  const calculateSummary = () => {
    const salePrice = parseFloat(form.salePrice) || 0;
    const cashAmount = parseFloat(form.cashAmount) || 0;
    const tradeInValue = parseFloat(form.tradeInValue) || 0;

    let totalReceived = 0;
    if (['CASH', 'TRANSFER', 'MIXED'].includes(paymentType)) {
      totalReceived += cashAmount;
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

    // Agregar pago en efectivo/transferencia
    if (['CASH', 'TRANSFER', 'MIXED'].includes(paymentType) && form.cashAccountId && form.cashAmount) {
      saleData.cashPayment = {
        accountId: form.cashAccountId,
        amount: parseFloat(form.cashAmount),
      };
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

    await onSubmit(saleData);
  };

  const summary = calculateSummary();

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
                  <span className="text-xl mr-2">{type.icon}</span>
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

          {/* Pago efectivo/transferencia */}
          {['CASH', 'TRANSFER', 'MIXED'].includes(paymentType) && (
            <div className="border border-border rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">
                {paymentType === 'MIXED' ? 'Pago en Efectivo/Transferencia' : 'Datos del Pago'}
              </h4>
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

          {/* Cruce de vehiculo */}
          {['TRADE_IN', 'MIXED'].includes(paymentType) && (
            <div className="border border-border rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-[#E6EDF3]">Vehiculo Recibido en Cruce</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Placa *</label>
                  <input
                    type="text"
                    value={form.tradeInPlate}
                    onChange={(e) => setForm({ ...form, tradeInPlate: e.target.value.toUpperCase() })}
                    className="input w-full font-mono"
                    maxLength="10"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#8B949E] mb-1">Valor del Cruce *</label>
                  <input
                    type="number"
                    value={form.tradeInValue}
                    onChange={(e) => setForm({ ...form, tradeInValue: e.target.value })}
                    className="input w-full"
                    min="1"
                    required
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
