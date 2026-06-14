import { useEffect, useRef, useState, useCallback } from 'react';

const DEV = import.meta.env.DEV;
const toNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const IDLE_LIMIT_MS = toNum(import.meta.env.VITE_IDLE_LIMIT_MS, 60 * 60 * 1000); // 1 hora
export const WARN_BEFORE_MS = toNum(import.meta.env.VITE_IDLE_WARN_MS, 60 * 1000);       // 1 minuto

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

// Devuelve { warning, stayActive }. Llama onIdle() al cumplirse el límite sin actividad.
// Usa un deadline ABSOLUTO (timestamp) además de timers, para que el cierre por
// inactividad se respete aunque la pestaña haya estado en segundo plano o el equipo
// suspendido (los setTimeout se pausan ahí; al volver el foco se re-evalúa contra el reloj).
export function useIdleTimeout({ enabled, onIdle }) {
  const [warning, setWarning] = useState(false);
  const warnTimer = useRef(null);
  const idleTimer = useRef(null);
  const lastReset = useRef(0);
  const deadline = useRef(0);
  const fired = useRef(false);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  // Override solo en dev/test (Vite dev): permite umbrales chicos sin afectar producción.
  const limit = (DEV && typeof window !== 'undefined' && window.__IDLE_LIMIT_MS__) || IDLE_LIMIT_MS;
  const warnBefore = (DEV && typeof window !== 'undefined' && window.__IDLE_WARN_MS__) || WARN_BEFORE_MS;

  const clearTimers = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const fireIdle = useCallback(() => {
    if (fired.current) return; // evita doble logout (timer + clic del usuario)
    fired.current = true;
    clearTimers();
    setWarning(false);
    onIdleRef.current();
  }, [clearTimers]);

  // Programa warn/idle según el tiempo restante hasta el deadline absoluto.
  const schedule = useCallback(() => {
    clearTimers();
    const remaining = deadline.current - Date.now();
    if (remaining <= 0) { fireIdle(); return; }
    setWarning(remaining <= warnBefore);
    warnTimer.current = setTimeout(() => setWarning(true), Math.max(0, remaining - warnBefore));
    idleTimer.current = setTimeout(fireIdle, remaining);
  }, [clearTimers, fireIdle, warnBefore]);

  const reset = useCallback(() => {
    if (!enabled) { clearTimers(); setWarning(false); return; }
    fired.current = false;
    deadline.current = Date.now() + limit;
    schedule();
  }, [enabled, limit, schedule, clearTimers]);

  useEffect(() => {
    if (!enabled) { clearTimers(); setWarning(false); return undefined; }
    reset();

    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset.current > 1000) { lastReset.current = now; reset(); }
    };
    // Al recuperar foco/visibilidad, re-evaluar contra el reloj real (cubre sleep/bg tab).
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearTimers();
    };
  }, [enabled, reset, schedule, clearTimers]);

  return { warning, stayActive: reset };
}
