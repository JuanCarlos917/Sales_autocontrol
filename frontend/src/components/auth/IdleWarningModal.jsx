import Modal from '@/components/shared/Modal';

export default function IdleWarningModal({ isOpen, onStay, onLogout }) {
  return (
    <Modal isOpen={isOpen} onClose={onStay} title="Sesión por expirar">
      <div className="space-y-4" data-testid="idle-warning-modal">
        <p className="text-sm text-[#8B949E]">Tu sesión se cerrará por inactividad en 1 minuto. ¿Querés seguir conectado?</p>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onLogout} data-testid="idle-logout">Cerrar sesión</button>
          <button className="btn-primary flex-1" onClick={onStay} data-testid="idle-stay">Seguir conectado</button>
        </div>
      </div>
    </Modal>
  );
}
