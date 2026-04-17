// ═══════════════════════════════════════════════════════════════
// PurchasePaymentModal — Modal para registrar compra de vehículo
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi, thirdPartiesApi } from '@/lib/treasuryApi';
import { formatCurrency } from '@/lib/constants';

export default function PurchasePaymentModal({
  isOpen,
  onClose,
  onSubmit,
  vehicleData = null, // Si viene de edicion de vehiculo existente
  loading = false,
}) {
  const [accounts, setAccounts] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [payNow, setPayNow] = useState(true);
  const [warning, setWarning] = useState(null);
  const [form, setForm] = useState({
    // Datos del vehiculo
    plate: '',
    brand: '',
    model: '',
    year: '',
    color: '',
    km: '',
    purchasePrice: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    notes: '',
    // Datos del pago
    accountId: '',
    paymentAmount: '',
    thirdPartyId: '',
    dueDate: '',
  });

  useEffect(() => {
    if (isOpen) {
      loadData();
      if (vehicleData) {
        setForm({
          plate: vehicleData.plate || '',
          brand: vehicleData.brand || '',
          model: vehicleData.model || '',
          year: vehicleData.year?.toString() || '',
          color: vehicleData.color || '',
          km: vehicleData.km?.toString() || '',
          purchasePrice: vehicleData.purchasePrice?.toString() || '',
          purchaseDate: vehicleData.purchaseDate?.split('T')[0] || new Date().toISOString().split('T')[0],
          notes: vehicleData.notes || '',
          accountId: '',
          paymentAmount: vehicleData.purchasePrice?.toString() || '',
          thirdPartyId: '',
          dueDate: '',
        });
      } else {
        resetForm();
      }
    }
  }, [isOpen, vehicleData]);

  const loadData = async () => {
    try {
      const [accountsRes, thirdPartiesRes] = await Promise.all([
        accountsApi.getAll(),
        thirdPartiesApi.getAll(),
      ]);
      setAccounts(accountsRes.data.filter(a => a.isActive));
      setThirdParties(thirdPartiesRes.data.filter(tp => tp.type === 'SUPPLIER'));
      if (accountsRes.data.length > 0) {
        setForm(f => ({ ...f, accountId: accountsRes.data[0].id }));
      }
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  const resetForm = () => {
    setPayNow(true);
    setWarning(null);
    setForm({
      plate: '',
      brand: '',
      model: '',
      year: '',
      color: '',
      km: '',
      purchasePrice: '',
      purchaseDate: new Date().toISOString().split('T')[0],
      notes: '',
      accountId: accounts[0]?.id || '',
      paymentAmount: '',
      thirdPartyId: '',
      dueDate: '',
    });
  };

  const handlePriceChange = (value) => {
    setForm({ ...form, purchasePrice: value, paymentAmount: value });
    checkBalance(form.accountId, value);
  };

  const handlePaymentAmountChange = (value) => {
    setForm({ ...form, paymentAmount: value });
    checkBalance(form.accountId, value);
  };

  const handleAccountChange = (accountId) => {
    setForm({ ...form, accountId });
    checkBalance(accountId, form.paymentAmount);
  };

  const checkBalance = (accountId, amount) => {
    if (!payNow || !accountId || !amount) {
      setWarning(null);
      return;
    }
    const account = accounts.find(a => a.id === accountId);
    const paymentAmount = parseFloat(amount) || 0;
    if (account && paymentAmount > parseFloat(account.currentBalance)) {
      setWarning({
        type: 'NEGATIVE_BALANCE',
        message: `La cuenta "${account.name}" quedará con saldo negativo`,
        currentBalance: parseFloat(account.currentBalance),
        newBalance: parseFloat(account.currentBalance) - paymentAmount
      });
    } else {
      setWarning(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.plate || !form.purchasePrice) {
      alert('Placa y precio de compra son requeridos');
      return;
    }

    const purchasePrice = parseFloat(form.purchasePrice);
    const paymentAmount = parseFloat(form.paymentAmount) || 0;

    const data = {
      vehicle: {
        plate: form.plate.toUpperCase(),
        brand: form.brand || null,
        model: form.model || null,
        year: form.year ? parseInt(form.year) : null,
        color: form.color || null,
        km: form.km ? parseInt(form.km) : null,
        purchasePrice,
        purchaseDate: form.purchaseDate || null,
        notes: form.notes || null,
        stage: 'COMPRADO',
      },
      payment: null,
    };

    if (payNow && form.accountId && paymentAmount > 0) {
      data.payment = {
        accountId: form.accountId,
        amount: paymentAmount,
        thirdPartyId: form.thirdPartyId || null,
        dueDate: form.dueDate || null,
      };
    } else if (!payNow) {
      // Si no paga ahora, puede especificar fecha de vencimiento
      data.payment = {
        thirdPartyId: form.thirdPartyId || null,
        dueDate: form.dueDate || null,
      };
    }

    await onSubmit(data);
  };

  const purchasePrice = parseFloat(form.purchasePrice) || 0;
  const paymentAmount = parseFloat(form.paymentAmount) || 0;
  const pendingAmount = payNow ? Math.max(0, purchasePrice - paymentAmount) : purchasePrice;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={vehicleData ? 'Editar Compra' : 'Registrar Compra de Vehiculo'}
      width="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Datos del vehiculo */}
        <div className="border border-border rounded-lg p-3 space-y-3">
          <h4 className="text-sm font-semibold text-[#E6EDF3]">Datos del Vehiculo</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Placa *</label>
              <input
                type="text"
                value={form.plate}
                onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })}
                className="input w-full font-mono"
                maxLength="10"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Precio de Compra *</label>
              <input
                type="number"
                value={form.purchasePrice}
                onChange={(e) => handlePriceChange(e.target.value)}
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
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Modelo</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Ano</label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                className="input w-full"
                min="1980"
                max="2030"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Fecha de Compra</label>
              <input
                type="date"
                value={form.purchaseDate}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Vendedor</label>
              <select
                value={form.thirdPartyId}
                onChange={(e) => setForm({ ...form, thirdPartyId: e.target.value })}
                className="input w-full"
              >
                <option value="">Sin vendedor</option>
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>{tp.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Pago */}
        <div className="border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[#E6EDF3]">Pago</h4>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={payNow}
                onChange={(e) => {
                  setPayNow(e.target.checked);
                  if (!e.target.checked) setWarning(null);
                }}
                className="rounded border-border"
              />
              <span className="text-[#8B949E]">Pagar ahora</span>
            </label>
          </div>

          {payNow ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Cuenta *</label>
                <select
                  value={form.accountId}
                  onChange={(e) => handleAccountChange(e.target.value)}
                  className="input w-full"
                  required
                >
                  <option value="">Seleccionar</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatCurrency(a.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[#8B949E] mb-1">Monto a Pagar</label>
                <input
                  type="number"
                  value={form.paymentAmount}
                  onChange={(e) => handlePaymentAmountChange(e.target.value)}
                  className="input w-full"
                  min="1"
                  max={purchasePrice}
                />
                {purchasePrice > 0 && (
                  <button
                    type="button"
                    onClick={() => handlePaymentAmountChange(form.purchasePrice)}
                    className="text-xs text-accent hover:underline mt-1"
                  >
                    Pagar total
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Fecha de Vencimiento (CxP)</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="input w-full"
              />
            </div>
          )}

          {/* Resumen */}
          {purchasePrice > 0 && (
            <div className="bg-surface-hover rounded-lg p-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-[#8B949E]">Precio de compra:</span>
                <span className="text-[#E6EDF3]">{formatCurrency(purchasePrice)}</span>
              </div>
              {payNow && paymentAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-[#8B949E]">Pago inicial:</span>
                  <span className="text-green-400">-{formatCurrency(paymentAmount)}</span>
                </div>
              )}
              {pendingAmount > 0 && (
                <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                  <span className="text-[#8B949E]">CxP pendiente:</span>
                  <span className="text-amber-400">{formatCurrency(pendingAmount)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Warning */}
        {warning && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-400">
            {warning.message}
            <div className="text-xs mt-1 opacity-75">
              Saldo actual: {formatCurrency(warning.currentBalance)} →
              Nuevo saldo: {formatCurrency(warning.newBalance)}
            </div>
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost flex-1"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={loading || !form.plate || !form.purchasePrice}
          >
            {loading ? 'Procesando...' : 'Registrar Compra'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
