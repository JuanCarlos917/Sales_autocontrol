import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/contexts/AppContext';
import { STAGES, PORTALS, formatCurrency, getStage } from '@/lib/constants';
import VehicleFormModal from '@/components/vehicles/VehicleFormModal';
import { SalePaymentModal } from '@/components/treasury';
import { vehicleTreasuryApi } from '@/lib/payablesApi';
import Modal from '@/components/shared/Modal';

// Etapas que requieren valor negociado/precio de compra
const STAGES_REQUIRING_VALUE = ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];
// Etapas que requieren proveedor (después de COMPRADO)
const STAGES_REQUIRING_SUPPLIER = ['ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];

// Etapas destino que soportan el flujo "completar campos y mover" al soltar la card.
// (COMPRADO y VENDIDO conservan sus flujos dedicados de compra/venta.)
const COMPLETE_FLOW_STAGES = ['ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE'];
// Tipos de faltante que se pueden diligenciar en el formulario del vehículo.
const FIELD_ISSUE_TYPES = ['negotiatedValue', 'purchasePrice', 'supplier', 'partner', 'listedPrice', 'salePrice', 'saleDate'];
// Reconoce el bloqueo de backend por CxP no pagada (requisito que no es un campo del formulario).
const CXP_BLOCK_RE = /pagad|CxP|PAID/i;

export default function KanbanPage() {
  const { vehicles, fetchVehicles, moveVehicle, loading, showToast } = useApp();
  const [dragOver, setDragOver] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();

  // Estado para el modal de venta
  const [saleModal, setSaleModal] = useState({ open: false, vehicle: null });
  const [processingAction, setProcessingAction] = useState(false);

  // Estado para alerta de validación
  const [validationAlert, setValidationAlert] = useState({ open: false, vehicle: null, targetStage: null, issues: [] });

  // Estado para el flujo "completar campos y mover" (modal de edición en el Kanban)
  const [completeModal, setCompleteModal] = useState({ open: false, vehicle: null, targetStage: null, highlightFields: [] });
  // Estado para el aviso de requisito no-campo (CxP no pagada → ir a tesorería)
  const [treasuryAlert, setTreasuryAlert] = useState({ open: false, vehicle: null, message: '' });

  // Estado para grab-to-scroll
  const scrollRef = useRef(null);
  const [isGrabbing, setIsGrabbing] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  // Handlers para grab-to-scroll
  const handleMouseDown = (e) => {
    // No activar si es un drag de tarjeta o click en tarjeta
    if (e.target.closest('[draggable="true"]')) return;

    setIsGrabbing(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeft(scrollRef.current.scrollLeft);
  };

  const handleMouseMove = (e) => {
    if (!isGrabbing) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5; // Velocidad de scroll
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleMouseUp = () => {
    setIsGrabbing(false);
  };

  const handleMouseLeave = () => {
    setIsGrabbing(false);
  };

  // Scroll con botones de flecha
  const scrollByAmount = (direction) => {
    if (!scrollRef.current) return;
    const amount = 300;
    scrollRef.current.scrollBy({ left: direction * amount, behavior: 'smooth' });
  };

  // Validar requisitos antes de mover
  const validateStageChange = (vehicle, targetStage) => {
    const issues = [];

    // Desde NEGOCIANDO solo se permite pasar a COMPRADO
    if (vehicle.stage === 'NEGOCIANDO' && targetStage !== 'NEGOCIANDO' && targetStage !== 'COMPRADO') {
      issues.push({
        type: 'invalidTransition',
        icon: '🚫',
        title: 'Transición no permitida',
        description: 'Desde Negociando solo puedes pasar a Comprado. Avanza primero a Comprado para continuar el flujo.'
      });
      return issues;
    }

    // Validar valor negociado / precio de compra obligatorio
    const hasNegotiated = vehicle.negotiatedValue && parseFloat(vehicle.negotiatedValue) > 0;
    const hasPurchase = vehicle.purchasePrice && parseFloat(vehicle.purchasePrice) > 0;
    if (STAGES_REQUIRING_VALUE.includes(targetStage) && !hasNegotiated && !hasPurchase) {
      issues.push({
        type: 'negotiatedValue',
        icon: '💵',
        title: 'Valor Negociado requerido',
        description: 'Mientras no definas el Valor Negociado, el vehículo no puede salir de Negociando.'
      });
    }

    // Desde COMPRADO hacia etapas posteriores: exigir precio de compra
    if (vehicle.stage === 'COMPRADO' && STAGES_REQUIRING_SUPPLIER.includes(targetStage)) {
      const hasPurchase = vehicle.purchasePrice && parseFloat(vehicle.purchasePrice) > 0;
      if (!hasPurchase) {
        issues.push({
          type: 'purchasePrice',
          icon: '💵',
          title: 'Precio de Compra requerido',
          description: 'Debes definir el Precio de Compra y tener la CxP pagada antes de avanzar de etapa.'
        });
      }
    }

    // Validar proveedor obligatorio
    if (STAGES_REQUIRING_SUPPLIER.includes(targetStage) && !vehicle.supplierId) {
      issues.push({
        type: 'supplier',
        icon: '👤',
        title: 'Proveedor requerido',
        description: 'Debes asignar quién te vendió este vehículo'
      });
    }

    // Validar socio si participación < 100%
    const participation = parseFloat(vehicle.participation) || 1;
    if (STAGES_REQUIRING_SUPPLIER.includes(targetStage) && participation < 1 && !vehicle.partnerId) {
      issues.push({
        type: 'partner',
        icon: '🤝',
        title: 'Socio requerido',
        description: `La participación es ${(participation * 100).toFixed(0)}%, debes asignar un socio`
      });
    }

    // Validar precio publicado para PUBLICADO
    if (targetStage === 'PUBLICADO' && !(vehicle.listedPrice && parseFloat(vehicle.listedPrice) > 0)) {
      issues.push({
        type: 'listedPrice',
        icon: '📣',
        title: 'Precio Publicado requerido',
        description: 'Debes definir el Precio Publicado para pasar a esta etapa.'
      });
    }

    // Validar precio y fecha de venta para DISPONIBLE
    if (targetStage === 'DISPONIBLE') {
      if (!(vehicle.salePrice && parseFloat(vehicle.salePrice) > 0)) {
        issues.push({
          type: 'salePrice',
          icon: '💰',
          title: 'Precio de Venta requerido',
          description: 'Debes definir el Precio de Venta para pasar a esta etapa.'
        });
      }
      if (!vehicle.saleDate) {
        issues.push({
          type: 'saleDate',
          icon: '📅',
          title: 'Fecha de Venta requerida',
          description: 'Debes definir la Fecha de Venta para pasar a esta etapa.'
        });
      }
    }

    // Validar precio de venta para VENDIDO
    if (targetStage === 'VENDIDO' && !vehicle.salePrice) {
      issues.push({
        type: 'salePrice',
        icon: '💰',
        title: 'Precio de venta requerido',
        description: 'Debes definir el precio de venta antes de marcar como vendido'
      });
    }

    // Validar comprador para VENDIDO
    if (targetStage === 'VENDIDO' && !vehicle.buyerId) {
      issues.push({
        type: 'buyer',
        icon: '🛒',
        title: 'Comprador requerido',
        description: 'Debes asignar quién compró este vehículo'
      });
    }

    return issues;
  };

  // Manejar drop con validación
  const handleDrop = async (e, targetStage) => {
    e.preventDefault();
    const vid = e.dataTransfer.getData('vid');
    setDragOver(null);
    if (!vid) return;

    const vehicle = vehicles.find(v => v.id === vid);
    if (!vehicle) return;

    if (vehicle.stage === targetStage) return;

    // VENDIDO es estado final: bloquear cualquier salida
    if (vehicle.stage === 'VENDIDO' && targetStage !== 'VENDIDO') {
      showToast('VENDIDO es un estado final: no se puede mover a otra etapa', 'danger');
      return;
    }

    // Si va a VENDIDO, abrir modal de venta completo (maneja sus propias validaciones)
    if (targetStage === 'VENDIDO' && vehicle.stage !== 'VENDIDO') {
      // Validar requisitos previos (excepto buyer/salePrice que se manejan en el modal de venta)
      const preIssues = validateStageChange(vehicle, targetStage).filter(i => !['buyer', 'salePrice'].includes(i.type));
      if (preIssues.length > 0) {
        setValidationAlert({ open: true, vehicle, targetStage, issues: preIssues });
        return;
      }
      setSaleModal({ open: true, vehicle });
      return;
    }

    // Validar requisitos para otras etapas
    const issues = validateStageChange(vehicle, targetStage);
    if (issues.length === 0) {
      await tryMove(vehicle, targetStage);
      return;
    }

    // Nueva UX: si lo único que falta son campos del formulario y la etapa destino lo
    // soporta, abrir el formulario para completarlos y mover automáticamente al guardar.
    const hasInvalidTransition = issues.some(i => i.type === 'invalidTransition');
    const allFieldIssues = issues.every(i => FIELD_ISSUE_TYPES.includes(i.type));
    if (!hasInvalidTransition && allFieldIssues && COMPLETE_FLOW_STAGES.includes(targetStage)) {
      setCompleteModal({ open: true, vehicle, targetStage, highlightFields: issues.map(i => i.type) });
      return;
    }

    // Fallback: alerta clásica (transición inválida u otros casos no resolubles por formulario)
    setValidationAlert({ open: true, vehicle, targetStage, issues });
  };

  // Mueve la card; si el backend bloquea por CxP no pagada, ofrece ir a tesorería.
  const tryMove = async (vehicle, targetStage) => {
    try {
      await moveVehicle(vehicle.id, targetStage);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'No se pudo cambiar la etapa';
      if (CXP_BLOCK_RE.test(msg)) {
        setTreasuryAlert({ open: true, vehicle, message: msg });
      } else {
        showToast(msg, 'danger');
      }
    }
  };

  // Tras guardar los campos en el modal, intenta el cambio de etapa real (PATCH).
  // Éxito → el modal se cierra solo. CxP → cierra y ofrece tesorería. Otro faltante → relanza
  // para que el modal muestre el error y permanezca abierto.
  const handleCompleteSaved = async () => {
    const { vehicle, targetStage } = completeModal;
    if (!vehicle || !targetStage) return;
    try {
      await moveVehicle(vehicle.id, targetStage);
      showToast(`Movido a ${getStage(targetStage)?.label || targetStage}`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || '';
      if (CXP_BLOCK_RE.test(msg)) {
        setTreasuryAlert({ open: true, vehicle, message: msg });
        return; // se traga el error → el modal cierra normalmente
      }
      throw err; // otros faltantes → el modal muestra el error y sigue abierto
    }
  };

  // Ir a editar vehículo desde la alerta
  const handleEditFromAlert = () => {
    if (validationAlert.vehicle) {
      const highlight = validationAlert.issues
        .map(i => i.type)
        .filter(Boolean)
        .join(',');
      const query = highlight
        ? `?edit=true&highlight=${encodeURIComponent(highlight)}`
        : '?edit=true';
      navigate(`/vehicles/${validationAlert.vehicle.id}${query}`);
    }
    setValidationAlert({ open: false, vehicle: null, targetStage: null, issues: [] });
  };

  // Registrar venta con tesorería
  const handleSaleSubmit = async (saleData) => {
    if (!saleModal.vehicle) return;

    setProcessingAction(true);
    try {
      await vehicleTreasuryApi.registerSale(saleModal.vehicle.id, saleData);
      setSaleModal({ open: false, vehicle: null });
      await fetchVehicles();
    } catch (err) {
      console.error('Error registering sale:', err);
      alert(err.response?.data?.error || 'Error al registrar la venta');
    } finally {
      setProcessingAction(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#8B949E]">{vehicles.length} vehículo{vehicles.length !== 1 ? 's' : ''} en el pipeline</p>
        <button onClick={() => setShowForm(true)} className="btn-primary" data-testid="kanban-create-vehicle">+ Vehículo</button>
      </div>

      {/* Contenedor con botones de navegación */}
      <div className="relative group">
        {/* Botón izquierda */}
        <button
          onClick={() => scrollByAmount(-1)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-20 bg-surface/90 backdrop-blur border border-border rounded-r-xl flex items-center justify-center text-[#8B949E] hover:text-accent hover:border-accent/50 transition-all opacity-0 group-hover:opacity-100 hover:opacity-100 shadow-lg"
          title="Scroll izquierda"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Botón derecha */}
        <button
          onClick={() => scrollByAmount(1)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-20 bg-surface/90 backdrop-blur border border-border rounded-l-xl flex items-center justify-center text-[#8B949E] hover:text-accent hover:border-accent/50 transition-all opacity-0 group-hover:opacity-100 hover:opacity-100 shadow-lg"
          title="Scroll derecha"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div
          ref={scrollRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          className={`flex gap-3 overflow-x-auto pb-6 px-1 min-h-[calc(100vh-220px)] md:min-h-[calc(100vh-160px)] select-none scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent ${isGrabbing ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ scrollBehavior: isGrabbing ? 'auto' : 'smooth' }}>
        {STAGES.map(stage => {
          const stageVehicles = vehicles.filter(v => v.stage === stage.id);
          const isOver = dragOver === stage.id;

          return (
            <div key={stage.id}
              data-testid={`kanban-column-${stage.id}`}
              onDragOver={e => { e.preventDefault(); setDragOver(stage.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(e, stage.id)}
              className={`min-w-[260px] max-w-[320px] flex-1 bg-surface rounded-xl border transition-colors flex flex-col ${isOver ? 'border-accent/30' : 'border-border'}`}
              style={isOver ? { background: stage.color + '08' } : {}}>

              {/* Column Header */}
              <div className="px-4 pt-4 pb-3 border-b border-border-light">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                    <span className="text-[13px] font-semibold">{stage.label}</span>
                  </div>
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: stage.color + '18', color: stage.color }}>
                    {stageVehicles.length}
                  </span>
                </div>
                <span className="text-[11px] text-[#6E7681]">{stage.desc}</span>
              </div>

              {/* Cards */}
              <div className="p-2 flex-1 flex flex-col gap-2 overflow-y-auto">
                {stageVehicles.length === 0 && (
                  <div className="p-5 text-center text-[#6E7681] text-xs border border-dashed border-border rounded-lg">
                    Arrastra un vehículo aquí
                  </div>
                )}
                {stageVehicles.map(v => {
                  const m = v.metrics || {};
                  const isAlert = m.daysInInventory > 15 && v.stage !== 'VENDIDO';
                  const portals = v.publishedPortals || [];

                  // Verificar datos faltantes para siguiente etapa
                  const missingPrice = v.stage === 'NEGOCIANDO'
                    && (!v.negotiatedValue || parseFloat(v.negotiatedValue) <= 0)
                    && (!v.purchasePrice || parseFloat(v.purchasePrice) <= 0);
                  const hasMissingData = missingPrice;

                  return (
                    <div key={v.id} draggable
                      data-testid={`vehicle-card-${v.plate}`}
                      onDragStart={e => e.dataTransfer.setData('vid', v.id)}
                      onClick={() => navigate(`/vehicles/${v.id}`)}
                      className="bg-[#161B22] border border-border rounded-lg p-3.5 cursor-pointer transition-all hover:border-accent/30 hover:-translate-y-0.5 !cursor-pointer"
                      style={{ borderLeft: `3px solid ${isAlert ? (m.daysInInventory > 30 ? '#F85149' : '#D29922') : stage.color}` }}>

                      <div className="flex justify-between items-start">
                        <div>
                          <div className="plate-text">{v.plate || 'SIN PLACA'}</div>
                          <div className="text-xs text-[#8B949E]">{v.brand} {v.model} {v.year}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {hasMissingData && (
                            <div className="group relative">
                              <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 text-xs cursor-help">
                                !
                              </div>
                              <div className="absolute right-0 top-6 z-20 hidden group-hover:block w-40 p-2 bg-[#1C2128] border border-border rounded-lg shadow-xl text-xs">
                                <div className="text-amber-400 font-semibold mb-1">Datos faltantes:</div>
                                {missingPrice && <div className="text-[#8B949E]">• Valor negociado</div>}
                              </div>
                            </div>
                          )}
                          {isAlert && <div className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: m.daysInInventory > 30 ? '#F85149' : '#D29922' }} />}
                        </div>
                      </div>

                      {portals.length > 0 && v.stage === 'PUBLICADO' && (
                        <div className="flex gap-1 flex-wrap mt-2">
                          {portals.map(pid => {
                            const p = PORTALS.find(x => x.id === pid);
                            return p ? <span key={pid} className="portal-badge" style={{ background: p.color + '20', color: p.color }}>{p.label}</span> : null;
                          })}
                        </div>
                      )}

                      <div className="flex justify-between mt-3 text-xs">
                        <div>
                          <div className="text-[#6E7681]">
                            {v.stage === 'NEGOCIANDO' ? 'Valor negociado' : 'Inversión'}
                          </div>
                          <div className="font-mono font-semibold">
                            {v.stage === 'NEGOCIANDO'
                              ? (v.negotiatedValue ? formatCurrency(v.negotiatedValue) : '—')
                              : formatCurrency(m.realCost)}
                          </div>
                        </div>
                        {v.stage === 'VENDIDO' ? (
                          <div className="text-right">
                            <div className="text-[#6E7681]">Ganancia</div>
                            <div className={`font-mono font-bold ${m.netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
                              {formatCurrency(m.netProfit)}
                            </div>
                          </div>
                        ) : m.daysInInventory > 0 ? (
                          <div className="text-right">
                            <div className="text-[#6E7681]">Días</div>
                            <div className={`font-mono font-bold ${m.daysInInventory > 30 ? 'text-[#F85149]' : m.daysInInventory > 15 ? 'text-[#D29922]' : ''}`}>
                              {m.daysInInventory}d
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* PUBLICADO: Precio Publicado (listedPrice) */}
                      {v.stage === 'PUBLICADO' && (
                        <div className="mt-2 pt-2 border-t border-border-light">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-[#6E7681]">Precio Publicado</span>
                            {v.listedPrice ? (
                              <span className="font-mono font-semibold text-[#58A6FF]">
                                {formatCurrency(v.listedPrice)}
                              </span>
                            ) : (
                              <span className="text-[#D29922] text-[11px]">Sin definir</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* DISPONIBLE: Precio Venta (salePrice) */}
                      {v.stage === 'DISPONIBLE' && (
                        <div className="mt-2 pt-2 border-t border-border-light">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-[#6E7681]">Precio Venta</span>
                            {v.salePrice ? (
                              <span className="font-mono font-semibold text-[#58A6FF]">
                                {formatCurrency(v.salePrice)}
                              </span>
                            ) : (
                              <span className="text-[#D29922] text-[11px]">Sin definir</span>
                            )}
                          </div>
                        </div>
                      )}

                      {v.receivedVehicle && (
                        <div className="text-[11px] text-[#BC8CFF] mt-1.5">⟳ Cruce: {v.receivedVehiclePlate || 'Vehículo'}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {showForm && <VehicleFormModal onClose={() => setShowForm(false)} />}

      {/* Modal "completar campos y mover" al soltar la card */}
      {completeModal.open && (
        <VehicleFormModal
          vehicle={completeModal.vehicle}
          completeForStage={completeModal.targetStage}
          highlightFields={completeModal.highlightFields}
          onSaved={handleCompleteSaved}
          onClose={() => setCompleteModal({ open: false, vehicle: null, targetStage: null, highlightFields: [] })}
        />
      )}

      {/* Aviso de requisito no-campo (CxP no pagada) → ir a tesorería */}
      {treasuryAlert.open && (
        <Modal
          onClose={() => setTreasuryAlert({ open: false, vehicle: null, message: '' })}
          title=""
          width="max-w-md"
        >
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
              <span className="text-3xl">💳</span>
            </div>
            <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Falta un requisito de tesorería</h3>
            <p className="text-sm text-[#8B949E] mb-6">{treasuryAlert.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setTreasuryAlert({ open: false, vehicle: null, message: '' })}
                className="btn-ghost flex-1"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  const vid = treasuryAlert.vehicle?.id;
                  setTreasuryAlert({ open: false, vehicle: null, message: '' });
                  if (vid) navigate(`/vehicles/${vid}?tab=tesoreria`);
                }}
                className="btn-primary flex-1"
              >
                Ir a tesorería
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de Venta completo */}
      <SalePaymentModal
        isOpen={saleModal.open}
        onClose={() => setSaleModal({ open: false, vehicle: null })}
        onSubmit={handleSaleSubmit}
        vehicle={saleModal.vehicle}
        loading={processingAction}
      />

      {/* Modal de Alerta de Validación */}
      {validationAlert.open && (
        <Modal
          onClose={() => setValidationAlert({ open: false, vehicle: null, targetStage: null, issues: [] })}
          title=""
          width="max-w-md"
        >
          <div className="text-center">
            {/* Icono de alerta */}
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            {/* Título */}
            <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">
              No se puede pasar a {getStage(validationAlert.targetStage)?.label}
            </h3>

            {/* Vehículo y etapa destino */}
            <p className="text-sm text-[#8B949E] mb-4">
              <span className="font-mono font-semibold text-[#E6EDF3]">{validationAlert.vehicle?.plate}</span> sigue en{' '}
              <span className="font-semibold" style={{ color: getStage(validationAlert.vehicle?.stage)?.color }}>
                {getStage(validationAlert.vehicle?.stage)?.label}
              </span>{' '}
              hasta que diligencies los siguientes campos:
            </p>

            {/* Lista de problemas */}
            <div className="space-y-2 mb-6">
              {validationAlert.issues.map((issue, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-[#161B22] rounded-lg border border-border text-left">
                  <span className="text-xl">{issue.icon}</span>
                  <div>
                    <div className="text-sm font-semibold text-amber-400">{issue.title}</div>
                    <div className="text-xs text-[#8B949E]">{issue.description}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Botones */}
            <div className="flex gap-3">
              <button
                onClick={() => setValidationAlert({ open: false, vehicle: null, targetStage: null, issues: [] })}
                className="btn-ghost flex-1"
              >
                Cancelar
              </button>
              <button
                onClick={handleEditFromAlert}
                className="btn-primary flex-1"
              >
                Editar Vehículo
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
