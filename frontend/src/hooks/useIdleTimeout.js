import { useEffect, useRef, useState, useCallback } from 'react';

const DEV = import.meta.env.DEV;
const toNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const IDLE_LIMIT_MS = toNum(import.meta.env.VITE_IDLE_LIMIT_MS, 60 * 60 * 1000); // 1 hora
export const WARN_BEFORE_MS = toNum(import.meta.env.VITE_IDLE_WARN_MS, 60 * 1000);       // 1 minuto

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

// Devuelve { warning, stayActive }. Llama onIdle() al cumplirse el límite sin actividad.
export function useIdleTimeout({ enabled, onIdle }) {
  const [warning, setWarning] = useState(false);
  const warnTimer = useRef(null);
  const idleTimer = useRef(null);
  const lastReset = useRef(0);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  // Override solo en dev/test (Vite dev): permite umbrales chicos sin afectar producción.
  const limit = (DEV && typeof window !== 'undefined' && window.__IDLE_LIMIT_MS__) || IDLE_LIMIT_MS;
  const warnBefore = (DEV && typeof window !== 'undefined' && window.__IDLE_WARN_MS__) || WARN_BEFORE_MS;

  const clearTimers = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setWarning(false);
    if (!enabled) return;
    warnTimer.current = setTimeout(() => setWarning(true), Math.max(0, limit - warnBefore));
    idleTimer.current = setTimeout(() => { setWarning(false); onIdleRef.current(); }, limit);
  }, [enabled, limit, warnBefore, clearTimers]);

  useEffect(() => {
    if (!enabled) { clearTimers(); setWarning(false); return undefined; }
    reset();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset.current > 1000) { lastReset.current = now; reset(); }
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearTimers();
    };
  }, [enabled, reset, clearTimers]);

  return { warning, stayActive: reset };
}
