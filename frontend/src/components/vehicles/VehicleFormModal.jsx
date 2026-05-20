import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { STAGES, PORTALS, formatCurrency } from '@/lib/constants';
import Modal from '@/components/shared/Modal';
import { Input, Select, Textarea, Checkbox } from '@/components/shared/FormFields';
import ThirdPartySelector from '@/components/shared/ThirdPartySelector';
import { accountsApi } from '@/lib/treasuryApi';
import { vehicleTreasuryApi } from '@/lib/payablesApi';

// Mapa de tipos de issue → campo en el formulario + mensaje rojo sobre el input
const HIGHLIGHT_MESSAGES = {
  negotiatedValue: 'Debes diligenciar el Valor Negociado para poder avanzar',
  purchasePrice: 'Debes diligenciar el Precio de Compra y pagar la CxP para avanzar',
  listedPrice: 'Define el Precio Publicado para pasar a Publicado',
  supplier: 'Selecciona un proveedor para esta etapa',
  partner: 'Selecciona un socio: tu participación es menor al 100%',
  salePrice: 'Define el Precio de Venta para pasar a esta etapa',
  saleDate: 'Define la Fecha de Venta para pasar a esta etapa',
  buyer: 'Selecciona el comprador para marcar como vendido',
};

export default function VehicleFormModal({ vehicle, onClose, highlightFields = [], completeForStage = null, onSaved = null }) {
  const { createVehicle, updateVehicle, fetchVehicles, showToast } = useApp();
  const { role } = useAuth();
  const [f, setF] = useState({
    plate: vehicle?.plate || '', brand: vehicle?.brand || '', model: vehicle?.model || '',
    year: vehicle?.year || '', color: vehicle?.color || '', km: vehicle?.km || '',
    stage: completeForStage || vehicle?.stage || 'NEGOCIANDO',
    negotiatedValue: vehicle?.negotiatedValue || '',
    purchasePrice: vehicle?.purchasePrice || '',
    purchaseDate: vehicle?.purchaseDate?.split('T')[0] || '', listedPrice: vehicle?.listedPrice || '',
    salePrice: vehicle?.salePrice || '', saleDate: vehicle?.saleDate?.split('T')[0] || '',
    participation: vehicle?.participation ? (vehicle.participation * 100) : 100,
    partnerContribution: vehicle?.partnerContribution || '',
    partnerAssumesExpenses: vehicle?.partnerAssumesExpenses ?? true,
    receivedVehicle: vehicle?.receivedVehicle || false,
    receivedVehiclePlate: vehicle?.receivedVehiclePlate || '',
    receivedVehicleValue: vehicle?.receivedVehicleValue || '',
    publishedPortals: vehicle?.publishedPortals || [],
    notes: vehicle?.notes || '',
    supplierId: vehicle?.supplierId || null,
    partnerId: vehicle?.partnerId || null,
  });
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  // Pago dividido de la compra: efectivo (cuenta tipo Caja) + transferencia (cuenta tipo Banco)
  const [cashAccountId, setCashAccountId] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [transferAccountId, setTransferAccountId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  // null = aún no consultado, true/false = resultado
  const [hasExistingPayable, setHasExistingPayable] = useState(null);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const togglePortal = (pid) => s('publishedPortals', f.publishedPortals.includes(pid) ? f.publishedPortals.filter(x => x !== pid) : [...f.publishedPortals, pid]);

  // Consultar si el vehículo ya tiene CxP de compra registrada
  useEffect(() => {
    if (!vehicle || !['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'].includes(vehicle.stage)) {
      setHasExistingPayable(false);
      return;
    }
    vehicleTreasuryApi.getPaymentStatus(vehicle.id)
      .then(res => setHasExistingPayable(!!res.data?.purchase))
      .catch(err => {
        console.error('Error loading payment status:', err);
        setHasExistingPayable(false);
      });
  }, [vehicle]);

  // Etapas donde los campos de socio/precio están totalmente bloqueados
  const ADVANCED_STAGES = ['ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];
  const isFullyLocked = !!vehicle && ADVANCED_STAGES.includes(vehicle.stage);

  // Lock de identidad por etapa/rol (paridad con el backend, ver spec edit-lock):
  //  - identityLocked: fuera de NEGOCIANDO, solo ADMIN edita placa/marca/modelo/año/color/km.
  //  - vendidoLocked: VENDIDO es solo lectura para todos (incluido ADMIN).
  const identityLocked = !!vehicle && vehicle.stage !== 'NEGOCIANDO' && role !== 'ADMIN';
  const vendidoLocked = !!vehicle && vehicle.stage === 'VENDIDO';
  // ADMIN editando identidad en una etapa avanzada (no VENDIDO): queda registrado en el audit log.
  const adminEditingIdentity = !!vehicle && vehicle.stage !== 'NEGOCIANDO' && !vendidoLocked && role === 'ADMIN';
  const identityTitle = identityLocked ? 'Solo un administrador puede modificar estos datos una vez registrada la compra' : undefined;
  const identityHelp = identityLocked ? '🔒 Datos de identidad bloqueados: requieren rol administrador' : undefined;

  // Confirmación de compra: NEGOCIANDO → COMPRADO, o COMPRADO sin CxP todavía
  const isConfirmingPurchase = !!vehicle && f.stage === 'COMPRADO' && hasExistingPayable === false && (
    vehicle.stage === 'NEGOCIANDO' || vehicle.stage === 'COMPRADO'
  );

  // Locks granulares: se desbloquean en COMPRADO mientras no haya CxP
  const priceLocked = isFullyLocked || (!!vehicle && vehicle.stage !== 'NEGOCIANDO' && hasExistingPayable !== false);
  const partnerLocked = priceLocked;
  // Proveedor y socio, una vez asignados, son inmutables permanentemente
  const supplierLocked = !!vehicle?.supplierId;
  const partnerIdLocked = !!vehicle?.partnerId;

  // Cargar cuentas al montar (creando O confirmando compra)
  useEffect(() => {
    if (vehicle && !isConfirmingPurchase) return;
    accountsApi.getAll()
      .then(res => {
        const active = res.data.filter(a => a.isActive);
        setAccounts(active);
        const firstCash = active.find(a => a.type === 'CASH');
        const firstBank = active.find(a => a.type === 'BANK');
        if (firstCash) setCashAccountId(prev => prev || firstCash.id);
        if (firstBank) setTransferAccountId(prev => prev || firstBank.id);
      })
      .catch(err => console.error('Error loading accounts:', err));
  }, [vehicle, isConfirmingPurchase]);

  // Al transicionar NEGOCIANDO → COMPRADO, o regresar a NEGOCIANDO: limpiar Precio de Compra
  // para que el usuario lo diligencie explícitamente y active la sección de pago.
  useEffect(() => {
    if (!vehicle) return;
    if (f.stage === 'NEGOCIANDO' || (vehicle.stage === 'NEGOCIANDO' && f.stage === 'COMPRADO')) {
      setF(p => (p.purchasePrice ? { ...p, purchasePrice: '' } : p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.stage]);

  // Cálculos derivados para la sección de socio
  const { myCapital, suggestedPercent } = useMemo(() => {
    const price = parseFloat(f.purchasePrice) || 0;
    const partnerAmt = parseFloat(f.partnerContribution) || 0;
    const myCap = Math.max(0, price - partnerAmt);
    const suggested = price > 0 ? Math.round((myCap / price) * 10000) / 100 : 100;
    return { myCapital: myCap, suggestedPercent: suggested };
  }, [f.purchasePrice, f.partnerContribution]);

  // Cuando cambia el aporte del socio, auto-ajustar participación sugerida
  const onPartnerContributionChange = (value) => {
    setF(prev => {
      const price = parseFloat(prev.purchasePrice) || 0;
      const partnerAmt = parseFloat(value) || 0;
      const next = { ...prev, partnerContribution: value };
      if (price > 0) {
        const pct = Math.max(0, Math.min(100, (Math.max(0, price - partnerAmt) / price) * 100));
        next.participation = Math.round(pct * 100) / 100;
      }
      return next;
    });
  };

  const [saveError, setSaveError] = useState(null);

  // Resalta un campo en rojo si vino solicitado por la alerta Y aún no está diligenciado
  const highlight = (field) => {
    if (!highlightFields.includes(field)) return null;
    const isSatisfied = (
      (field === 'negotiatedValue' && parseFloat(f.negotiatedValue) > 0) ||
      (field === 'purchasePrice' && parseFloat(f.purchasePrice) > 0) ||
      (field === 'listedPrice' && parseFloat(f.listedPrice) > 0) ||
      (field === 'supplier' && !!f.supplierId) ||
      (field === 'partner' && !!f.partnerId) ||
      (field === 'salePrice' && parseFloat(f.salePrice) > 0) ||
      (field === 'saleDate' && !!f.saleDate)
    );
    if (isSatisfied) return null;
    return HIGHLIGHT_MESSAGES[field] || true;
  };
  const pendingHighlights = highlightFields.filter(field => !!highlight(field));

  // Sección de pago: aplica al crear vehículo O al confirmar compra desde NEGOCIANDO
  const price = parseFloat(f.purchasePrice) || 0;
  const partnerAmt = f.partnerId ? parseFloat(f.partnerContribution) || 0 : 0;
  const myOwedAmount = Math.max(0, price - partnerAmt);
  const showPaymentSection = price > 0 && (!vehicle || isConfirmingPurchase);
  const willPromoteStage = showPaymentSection && !isConfirmingPurchase && f.stage === 'NEGOCIANDO';

  // Pago dividido: cuentas disponibles por método y montos
  const cashAccounts = accounts.filter(a => a.type === 'CASH');
  const bankAccounts = accounts.filter(a => a.type === 'BANK');
  const cashPay = parseFloat(cashAmount) || 0;
  const transferPay = parseFloat(transferAmount) || 0;
  const totalPaidNow = cashPay + transferPay;
  const pendingAfterPayment = Math.max(0, myOwedAmount - totalPaidNow);
  const overpay = totalPaidNow > myOwedAmount;
  const cashAccount = accounts.find(a => a.id === cashAccountId);
  const transferAccount = accounts.find(a => a.id === transferAccountId);
  const cashWarning = cashPay > 0 && cashAccount && cashPay > parseFloat(cashAccount.currentBalance);
  const transferWarning = transferPay > 0 && transferAccount && transferPay > parseFloat(transferAccount.currentBalance);

  const handleSave = async () => {
    if (!f.plate && !f.brand) {
      setSaveError('Debes ingresar al menos una placa o una marca');
      return;
    }
    // Al pasar de NEGOCIANDO → COMPRADO: Precio de Compra obligatorio
    if (vehicle && vehicle.stage === 'NEGOCIANDO' && f.stage === 'COMPRADO' && !price) {
      setSaveError('Debes definir el Precio de Compra para confirmar la compra');
      return;
    }
    // Validación: para salir de NEGOCIANDO se requiere Precio de Compra (o Valor Negociado)
    const hasNegotiated = parseFloat(f.negotiatedValue) > 0;
    if (f.stage !== 'NEGOCIANDO' && !price && !hasNegotiated) {
      setSaveError('Debes definir el Valor Negociado o Precio de Compra para pasar a esta etapa');
      return;
    }
    // Proveedor solo obligatorio después de COMPRADO
    if (!['NEGOCIANDO', 'COMPRADO'].includes(f.stage) && !f.supplierId) {
      setSaveError('Debes seleccionar un proveedor para esta etapa');
      return;
    }
    if (showPaymentSection) {
      if (cashPay > 0 && !cashAccountId) { setSaveError('Selecciona la cuenta de efectivo'); return; }
      if (transferPay > 0 && !transferAccountId) { setSaveError('Selecciona la cuenta de transferencia'); return; }
      if (overpay) {
        setSaveError(`Los pagos (${formatCurrency(totalPaidNow)}) no pueden superar tu parte a pagar (${formatCurrency(myOwedAmount)})`);
        return;
      }
    }
    setLoading(true);
    setSaveError(null);
    try {
      const participationDecimal = (parseFloat(f.participation) || 100) / 100;
      const partnerContribValue = f.partnerId && parseFloat(f.partnerContribution) > 0
        ? parseFloat(f.partnerContribution)
        : null;

      // Pago dividido: una línea por método con monto > 0 (lo no cubierto queda como CxP)
      const purchasePayments = [];
      if (cashPay > 0 && cashAccountId) purchasePayments.push({ accountId: cashAccountId, amount: cashPay, method: 'CASH' });
      if (transferPay > 0 && transferAccountId) purchasePayments.push({ accountId: transferAccountId, amount: transferPay, method: 'TRANSFER' });

      // Flujo con tesorería: confirmar compra de un vehículo en NEGOCIANDO
      if (isConfirmingPurchase && showPaymentSection) {
        const vehiclePayload = {
          purchasePrice: price,
          purchaseDate: f.purchaseDate || null,
          listedPrice: parseFloat(f.listedPrice) || null,
          supplierId: f.supplierId || null,
          partnerId: f.partnerId || null,
          partnerContribution: partnerContribValue,
          participation: participationDecimal,
          partnerAssumesExpenses: !!f.partnerAssumesExpenses,
          notes: f.notes || null,
        };

        const paymentPayload = {
          payments: purchasePayments,
          thirdPartyId: f.supplierId || null,
          dueDate: dueDate || null,
        };

        await vehicleTreasuryApi.confirmPurchase(vehicle.id, {
          vehicle: vehiclePayload,
          payment: paymentPayload,
        });
        await fetchVehicles();
        showToast('Compra confirmada');
        onClose();
        return;
      }

      // Flujo con tesorería: compra real al crear (crea CxP + transacción opcional)
      if (showPaymentSection) {
        const effectiveStage = willPromoteStage ? 'COMPRADO' : f.stage;
        const vehiclePayload = {
          plate: f.plate.toUpperCase(),
          brand: f.brand || null,
          model: f.model || null,
          year: f.year ? parseInt(f.year) : null,
          color: f.color || null,
          km: f.km ? parseInt(f.km) : null,
          stage: effectiveStage,
          purchasePrice: price,
          listedPrice: parseFloat(f.listedPrice) || null,
          purchaseDate: f.purchaseDate || null,
          notes: f.notes || null,
          supplierId: f.supplierId,
          partnerId: f.partnerId || null,
          partnerContribution: partnerContribValue,
          participation: participationDecimal,
          partnerAssumesExpenses: !!f.partnerAssumesExpenses,
        };

        const paymentPayload = {
          payments: purchasePayments,
          thirdPartyId: f.supplierId,
          dueDate: dueDate || null,
        };

        await vehicleTreasuryApi.createWithPurchase({
          vehicle: vehiclePayload,
          payment: paymentPayload,
        });
        await fetchVehicles();
        showToast('Vehículo registrado con compra');
        onClose();
        return;
      }

      // Flujo clásico: vehículo sin compra (draft en NEGOCIANDO o edición)
      const payload = {
        ...f,
        negotiatedValue: parseFloat(f.negotiatedValue) || null,
        purchasePrice: price || null,
        salePrice: parseFloat(f.salePrice) || null,
        listedPrice: parseFloat(f.listedPrice) || null,
        participation: participationDecimal,
        partnerContribution: partnerContribValue,
        partnerAssumesExpenses: !!f.partnerAssumesExpenses,
        receivedVehicleValue: parseFloat(f.receivedVehicleValue) || null,
        year: f.year ? parseInt(f.year) : null,
        km: f.km ? parseInt(f.km) : null,
        purchaseDate: f.purchaseDate || null,
        saleDate: f.saleDate || null,
        supplierId: f.supplierId || null,
        partnerId: f.partnerId || null,
      };
      if (vehicle) {
        // En modo "completar para avanzar" no transicionamos vía PUT: preservamos la etapa
        // y dejamos que el padre haga el cambio de etapa real (PATCH) tras guardar los campos.
        const finalPayload = completeForStage ? { ...payload, stage: vehicle.stage } : payload;
        await updateVehicle(vehicle.id, finalPayload);
        if (onSaved) await onSaved();
      } else {
        await createVehicle(payload);
      }
      onClose();
    } catch (err) {
      console.error('Error al guardar vehículo:', err);
      const details = err.response?.data?.details;
      const msg = details?.length
        ? details.map(d => `${d.field}: ${d.message}`).join(' · ')
        : err.response?.data?.error || err.message || 'Error al guardar el vehículo';
      setSaveError(msg);
    } finally {
      setLoading(false);
    }
  };

  const hasPartner = !!f.partnerId || parseFloat(f.participation) < 100;

  return (
    <Modal onClose={onClose} title={completeForStage ? `Completar para pasar a ${STAGES.find(st => st.id === completeForStage)?.label || completeForStage}` : (vehicle ? 'Editar Vehículo' : 'Nuevo Vehículo')} width="max-w-2xl">
      {vendidoLocked && (
        <div className="mb-4 p-3 rounded-lg border border-border bg-[#0F1419] flex items-center gap-2" data-testid="vehicle-form-vendido-banner">
          <span className="text-lg leading-none">🔒</span>
          <span className="text-sm font-semibold text-[#E6EDF3]">Vehículo VENDIDO. Solo lectura.</span>
        </div>
      )}
      {adminEditingIdentity && (
        <div className="mb-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-300" data-testid="vehicle-form-admin-warning">
          ⚠️ Estás editando datos de un vehículo en {STAGES.find(st => st.id === vehicle.stage)?.label}. Los cambios de identidad quedarán registrados en el audit log.
        </div>
      )}
      <fieldset disabled={vendidoLocked} className="contents">
      {pendingHighlights.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border-2 border-red-500/60 bg-red-500/10 animate-shake">
          <div className="flex items-start gap-2">
            <span className="text-red-400 text-lg leading-none">⚠</span>
            <div>
              <div className="text-sm font-semibold text-red-400">Campos obligatorios por diligenciar</div>
              <div className="text-xs text-[#E6EDF3]/80 mt-0.5">
                Completa los campos resaltados en rojo para poder avanzar de etapa.
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Placa *" value={f.plate} onChange={e => s('plate', e.target.value.toUpperCase())} placeholder="ABC123" disabled={identityLocked} title={identityTitle} help={identityHelp} data-testid="vehicle-form-plate" />
        <Select
          label="Estado"
          value={f.stage}
          onChange={e => s('stage', e.target.value)}
          options={vehicle ? STAGES.map(st => ({ value: st.id, label: st.label })) : [{ value: 'NEGOCIANDO', label: 'Negociando' }]}
          disabled={!vehicle || !!completeForStage}
          title={!vehicle ? 'Los vehículos nuevos siempre arrancan en Negociando' : (completeForStage ? 'Completa los campos para avanzar a esta etapa' : '')}
          data-testid="vehicle-form-stage"
        />
        <Input label="Marca" value={f.brand} onChange={e => s('brand', e.target.value)} placeholder="Chevrolet" disabled={identityLocked} title={identityTitle} />
        <Input label="Modelo" value={f.model} onChange={e => s('model', e.target.value)} placeholder="Spark GT" disabled={identityLocked} title={identityTitle} />
        <Input label="Año" type="number" value={f.year} onChange={e => s('year', e.target.value)} placeholder="2020" disabled={identityLocked} title={identityTitle} />
        <Input label="Color" value={f.color} onChange={e => s('color', e.target.value)} placeholder="Blanco" disabled={identityLocked} title={identityTitle} />
        <Input label="Kilometraje" type="number" value={f.km} onChange={e => s('km', e.target.value)} placeholder="45000" disabled={identityLocked} title={identityTitle} />
        {['ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'].includes(f.stage) && (
          <Input
            label="Precio Publicado"
            type="number"
            value={f.listedPrice}
            onChange={e => s('listedPrice', e.target.value)}
            placeholder="32000000"
            error={highlight('listedPrice')}
            autoFocus={!!highlight('listedPrice')}
            data-testid="vehicle-form-listed-price"
          />
        )}

        {/* NEGOCIANDO: Valor Negociado (en lugar de Precio de Compra) */}
        {f.stage === 'NEGOCIANDO' && (
          <Input
            label="Valor Negociado"
            type="number"
            value={f.negotiatedValue}
            onChange={e => s('negotiatedValue', e.target.value)}
            placeholder="25000000"
            error={highlight('negotiatedValue')}
            autoFocus={!!highlight('negotiatedValue')}
            data-testid="vehicle-form-negotiated-value"
          />
        )}

        {/* No NEGOCIANDO: Valor Negociado (histórico, read-only) + Precio de Compra + Fecha */}
        {f.stage !== 'NEGOCIANDO' && (
          <>
            {f.negotiatedValue && (
              <Input
                label="Valor Negociado (histórico)"
                type="number"
                value={f.negotiatedValue}
                disabled
                help="Valor registrado en Negociando — solo referencia"
              />
            )}
            <Input
              label="Precio de Compra *"
              type="number"
              value={f.purchasePrice}
              onChange={e => s('purchasePrice', e.target.value)}
              placeholder="25000000"
              disabled={priceLocked}
              autoFocus={(isConfirmingPurchase && !f.purchasePrice) || !!highlight('purchasePrice')}
              error={highlight('purchasePrice')}
              data-testid="vehicle-form-purchase-price"
            />
            <Input
              label="Fecha de Compra"
              type="date"
              value={f.purchaseDate}
              onChange={e => s('purchaseDate', e.target.value)}
            />
          </>
        )}

        {/* Venta: solo en PUBLICADO, DISPONIBLE y VENDIDO */}
        {['PUBLICADO', 'DISPONIBLE', 'VENDIDO'].includes(f.stage) && (
          <>
            <Input
              label="Precio de Venta"
              type="number"
              value={f.salePrice}
              onChange={e => s('salePrice', e.target.value)}
              error={highlight('salePrice')}
              autoFocus={!!highlight('salePrice')}
              data-testid="vehicle-form-sale-price"
            />
            <Input
              label="Fecha de Venta"
              type="date"
              value={f.saleDate}
              onChange={e => s('saleDate', e.target.value)}
              error={highlight('saleDate')}
              autoFocus={!!highlight('saleDate')}
              data-testid="vehicle-form-sale-date"
            />
          </>
        )}
      </div>

      {/* Terceros asociados */}
      {f.stage !== 'NEGOCIANDO' && (
      <div className="mt-4 p-3.5 bg-[#0F1419] rounded-xl border border-border">
        <div className="text-sm font-semibold text-[#E6EDF3] mb-3">👥 Terceros asociados</div>
        <div className="grid grid-cols-2 gap-3">
          <ThirdPartySelector
            value={f.supplierId}
            onChange={(id) => s('supplierId', id)}
            filterType="SUPPLIER"
            label="Proveedor (vendedor)"
            placeholder="Seleccionar proveedor..."
            required={f.stage !== 'NEGOCIANDO'}
            disabled={supplierLocked}
          />
          <ThirdPartySelector
            value={f.partnerId}
            onChange={(id) => s('partnerId', id)}
            filterType="PARTNER"
            label="Socio (opcional)"
            placeholder="Sin socio..."
            disabled={partnerLocked || partnerIdLocked}
          />
        </div>
        {f.stage !== 'NEGOCIANDO' && !f.supplierId && (
          <div className="text-xs text-amber-400 mt-2">
            ⚠️ El proveedor es obligatorio para vehículos en estado {STAGES.find(st => st.id === f.stage)?.label}
          </div>
        )}
      </div>
      )}

      {/* Sección de socio — solo cuando hay socio seleccionado */}
      {f.stage !== 'NEGOCIANDO' && f.partnerId && (
        <div className="mt-4 p-3.5 bg-[#0F1419] rounded-xl border border-accent/30">
          <div className="text-sm font-semibold text-[#E6EDF3] mb-1">🤝 Aporte del socio</div>
          <p className="text-[11px] text-[#6E7681] mb-3">
            El aporte del socio NO descuenta de tu tesorería — solo se registra como dato.
            Tu participación se calcula automáticamente a partir del aporte.
          </p>
          <Input
            label="Aporte del socio (COP)"
            type="number"
            value={f.partnerContribution}
            onChange={e => onPartnerContributionChange(e.target.value)}
            placeholder="20000000"
            disabled={partnerLocked}
          />
          {price > 0 && (
            <div className="mt-2 text-xs text-[#8B949E]">
              Tu participación: <span className="text-[#E6EDF3] font-semibold">{suggestedPercent}%</span>
              <span className="opacity-75"> (calculada automáticamente)</span>
            </div>
          )}
          {price > 0 && (
            <div className="mt-3 text-xs text-[#8B949E] grid grid-cols-2 gap-2">
              <div>Tu aporte efectivo: <span className="text-[#E6EDF3] font-semibold">{formatCurrency(myCapital)}</span></div>
              <div>Solo tu parte se descuenta de tesorería al comprar.</div>
            </div>
          )}
          <div className="mt-3">
            <Checkbox
              label="Los gastos se prorratean con el socio (pro-rata)"
              checked={f.partnerAssumesExpenses}
              onChange={e => s('partnerAssumesExpenses', e.target.checked)}
              disabled={partnerLocked}
            />
            <p className="text-[10px] text-[#6E7681] mt-1 pl-6">
              {f.partnerAssumesExpenses
                ? 'El socio asume su parte de los gastos en la liquidación.'
                : 'Tú asumes el 100% de los gastos; el socio sólo recibe su % sobre la utilidad bruta (venta − compra).'}
            </p>
          </div>
          {partnerLocked && (
            <div className="text-[11px] text-amber-400 mt-3">
              🔒 Los datos del socio quedaron bloqueados: la compra ya fue registrada.
            </div>
          )}
        </div>
      )}

      {/* Portals */}
      {['ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'].includes(f.stage) && (
      <div className="mt-4">
        <label className="label-sm">Publicado en</label>
        <div className="flex gap-1.5 flex-wrap mt-1.5">
          {PORTALS.map(p => (
            <button key={p.id} onClick={() => togglePortal(p.id)} type="button"
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${f.publishedPortals.includes(p.id) ? '' : 'border-border text-[#6E7681]'}`}
              style={f.publishedPortals.includes(p.id) ? { background: p.color + '20', borderColor: p.color + '50', color: p.color } : {}}>
              {f.publishedPortals.includes(p.id) ? '✓ ' : ''}{p.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Trade-in */}
      {f.stage !== 'NEGOCIANDO' && (
      <div className="mt-4 p-3.5 bg-[#0F1419] rounded-xl border border-border">
        <Checkbox label="⟳ Incluye vehículo recibido como parte de pago" checked={f.receivedVehicle} onChange={e => s('receivedVehicle', e.target.checked)} className="font-semibold" />
        {f.receivedVehicle && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Input label="Placa del cruce" value={f.receivedVehiclePlate} onChange={e => s('receivedVehiclePlate', e.target.value)} />
            <Input label="Valor del cruce" type="number" value={f.receivedVehicleValue} onChange={e => s('receivedVehicleValue', e.target.value)} />
          </div>
        )}
      </div>
      )}

      {f.stage !== 'NEGOCIANDO' && (
        <Textarea label="Notas" className="mt-3" rows={3} value={f.notes} onChange={e => s('notes', e.target.value)} placeholder="Observaciones del vehículo..." />
      )}

      {/* Sección de pago — solo al crear con compra real */}
      {showPaymentSection && (
        <div className="mt-4 p-3.5 bg-[#0F1419] rounded-xl border border-accent/30">
          <div className="text-sm font-semibold text-[#E6EDF3] mb-1">💳 Pago de la compra</div>
          <p className="text-[11px] text-[#6E7681] mb-3">
            Registra cuánto pagas en efectivo y/o por transferencia. Lo que no cubras queda como cuenta por pagar (CxP).
          </p>
          {willPromoteStage && (
            <div className="mb-3 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1.5">
              ⚠️ Al registrar la compra, el vehículo pasará automáticamente de NEGOCIANDO a COMPRADO.
            </div>
          )}
          {isConfirmingPurchase && (
            <div className="mb-3 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-2 py-1.5">
              ✓ Estás confirmando la compra: se creará la CxP y, por cada pago, su egreso en tesorería.
            </div>
          )}

          {/* Efectivo (cuentas tipo Caja) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">💵 Efectivo — Cuenta</label>
              <select
                value={cashAccountId}
                onChange={e => setCashAccountId(e.target.value)}
                className="input w-full"
                data-testid="vehicle-form-cash-account"
              >
                <option value="">Sin efectivo</option>
                {cashAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Monto en efectivo</label>
              <input
                type="number"
                value={cashAmount}
                onChange={e => setCashAmount(e.target.value)}
                className="input w-full"
                min="0"
                placeholder="0"
                data-testid="vehicle-form-cash-amount"
              />
            </div>
          </div>
          {cashWarning && (
            <div className="mt-1 text-xs text-amber-400">⚠️ La cuenta de efectivo quedará con saldo negativo.</div>
          )}

          {/* Transferencia (cuentas tipo Banco) */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">🏦 Transferencia — Cuenta</label>
              <select
                value={transferAccountId}
                onChange={e => setTransferAccountId(e.target.value)}
                className="input w-full"
                data-testid="vehicle-form-transfer-account"
              >
                <option value="">Sin transferencia</option>
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Monto en transferencia</label>
              <input
                type="number"
                value={transferAmount}
                onChange={e => setTransferAmount(e.target.value)}
                className="input w-full"
                min="0"
                placeholder="0"
                data-testid="vehicle-form-transfer-amount"
              />
            </div>
          </div>
          {transferWarning && (
            <div className="mt-1 text-xs text-amber-400">⚠️ La cuenta de transferencia quedará con saldo negativo.</div>
          )}

          {myOwedAmount > 0 && (
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => { setCashAmount(String(myOwedAmount)); setTransferAmount(''); }}
                className="text-xs text-accent hover:underline"
              >
                Todo en efectivo ({formatCurrency(myOwedAmount)})
              </button>
              <button
                type="button"
                onClick={() => { setTransferAmount(String(myOwedAmount)); setCashAmount(''); }}
                className="text-xs text-accent hover:underline"
              >
                Todo en transferencia
              </button>
            </div>
          )}

          {pendingAfterPayment > 0 && (
            <div className="mt-3">
              <label className="block text-sm text-[#8B949E] mb-1">Fecha de vencimiento del saldo (opcional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="input w-full"
              />
            </div>
          )}

          {/* Resumen */}
          <div className="mt-3 bg-[#161B22] rounded-lg p-2 space-y-1 text-sm border border-border">
            <div className="flex justify-between">
              <span className="text-[#8B949E]">Precio de compra:</span>
              <span className="text-[#E6EDF3]">{formatCurrency(price)}</span>
            </div>
            {partnerAmt > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-[#8B949E]">Aporte socio:</span>
                  <span className="text-sky-400">-{formatCurrency(partnerAmt)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 mt-1">
                  <span className="text-[#8B949E]">Tu aporte:</span>
                  <span className="text-[#E6EDF3]">{formatCurrency(myOwedAmount)}</span>
                </div>
              </>
            )}
            {cashPay > 0 && (
              <div className="flex justify-between">
                <span className="text-[#8B949E]">Efectivo:</span>
                <span className="text-green-400">-{formatCurrency(cashPay)}</span>
              </div>
            )}
            {transferPay > 0 && (
              <div className="flex justify-between">
                <span className="text-[#8B949E]">Transferencia:</span>
                <span className="text-green-400">-{formatCurrency(transferPay)}</span>
              </div>
            )}
            {pendingAfterPayment > 0 && (
              <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                <span className="text-[#8B949E]">CxP pendiente:</span>
                <span className="text-amber-400">{formatCurrency(pendingAfterPayment)}</span>
              </div>
            )}
          </div>

          {overpay && (
            <div className="mt-2 text-xs text-red-400">
              ⚠️ La suma de los pagos supera tu parte a pagar ({formatCurrency(myOwedAmount)}).
            </div>
          )}
        </div>
      )}

      {saveError && (
        <div className="mt-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-400">
          ⚠️ {saveError}
        </div>
      )}

      </fieldset>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="btn-ghost">{vendidoLocked ? 'Cerrar' : 'Cancelar'}</button>
        {!vendidoLocked && (
          <button onClick={handleSave} disabled={loading} className="btn-primary" data-testid="vehicle-form-submit">{loading ? 'Guardando...' : vehicle ? 'Guardar Cambios' : 'Registrar Vehículo'}</button>
        )}
      </div>
    </Modal>
  );
}
