// ═══════════════════════════════════════════════════════════════
// Constants — Stages, categories, portals, formatting helpers
// ═══════════════════════════════════════════════════════════════

import {
  Handshake, ShoppingCart, Wrench, Megaphone, CircleCheck, BadgeCheck,
  Sparkles, Landmark, FileText, SquareParking, Fuel, Tag,
} from 'lucide-react';

// `icon` es un componente de lucide-react (no un string). Renderizar como
// `const Icon = stage.icon; <Icon className="w-4 h-4" />`.
export const STAGES = [
  { id: 'NEGOCIANDO', label: 'Negociando', icon: Handshake, color: '#E9A23B', bg: 'bg-[#E9A23B15]', text: 'text-[#E9A23B]', desc: 'Acuerdo pendiente' },
  { id: 'COMPRADO', label: 'Comprado', icon: ShoppingCart, color: '#5B8DEF', bg: 'bg-[#5B8DEF15]', text: 'text-[#5B8DEF]', desc: 'Capital inmovilizado' },
  { id: 'ALISTAMIENTO', label: 'Alistamiento', icon: Wrench, color: '#A78BFA', bg: 'bg-[#A78BFA15]', text: 'text-[#A78BFA]', desc: 'En taller / trámites' },
  { id: 'PUBLICADO', label: 'Publicado', icon: Megaphone, color: '#F472B6', bg: 'bg-[#F472B615]', text: 'text-[#F472B6]', desc: 'En plataformas' },
  { id: 'DISPONIBLE', label: 'Disponible', icon: CircleCheck, color: '#34D399', bg: 'bg-[#34D39915]', text: 'text-[#34D399]', desc: 'Listo para entregar' },
  { id: 'VENDIDO', label: 'Vendido', icon: BadgeCheck, color: '#10B981', bg: 'bg-[#10B98115]', text: 'text-[#10B981]', desc: 'Negocio cerrado' },
];

// Nota: la categoría COMISION fue eliminada — las comisiones se modelan vía
// Payable type=COMMISSION (uno por participante) en el flujo de venta, no como
// gasto del vehículo. Ver pestaña Financiero del vehículo y /treasury/payables.
export const EXPENSE_CATEGORIES = [
  { id: 'MECANICA', label: 'Mecánica', icon: Wrench, color: '#EF4444' },
  { id: 'ESTETICA', label: 'Estética / Lavado', icon: Sparkles, color: '#A78BFA' },
  { id: 'IMPUESTOS', label: 'Impuestos', icon: Landmark, color: '#E9A23B' },
  { id: 'TRAMITE', label: 'Trámite / Notaría', icon: FileText, color: '#5B8DEF' },
  { id: 'PARQUEADERO', label: 'Parqueadero', icon: SquareParking, color: '#6B7280' },
  { id: 'PUBLICIDAD', label: 'Publicidad', icon: Megaphone, color: '#14B8A6' },
  { id: 'COMBUSTIBLE', label: 'Combustible', icon: Fuel, color: '#F97316' },
  { id: 'OTRO', label: 'Otro', icon: Tag, color: '#94A3B8' },
];

export const PORTALS = [
  { id: 'tucarro', label: 'TuCarro.com', color: '#FF6B00' },
  { id: 'marketplace', label: 'Marketplace', color: '#1877F2' },
  { id: 'olx', label: 'OLX', color: '#6E0AD6' },
  { id: 'mercadolibre', label: 'MercadoLibre', color: '#FFE600' },
  { id: 'instagram', label: 'Instagram', color: '#E1306C' },
  { id: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
  { id: 'comisionista', label: 'Comisionistas', color: '#94A3B8' },
  { id: 'otro', label: 'Otro', color: '#64748B' },
];

export const DOC_TYPES = [
  { id: 'TARJETA_PROPIEDAD', label: 'Tarjeta de Propiedad' },
  { id: 'SOAT', label: 'SOAT' },
  { id: 'TECNOMECANICA', label: 'Técnico-mecánica' },
  { id: 'PERITAJE', label: 'Peritaje' },
  { id: 'CERTIFICADO_TRADICION', label: 'Cert. Tradición' },
  { id: 'CONTRATO', label: 'Contrato' },
  { id: 'FOTO_VEHICULO', label: 'Foto Vehículo' },
  { id: 'OTRO', label: 'Otro' },
];

// ── Formatters ──

export const formatCurrency = (n) => {
  if (n == null || isNaN(n)) return '$0';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
};

export const formatPercent = (n) => {
  if (n == null || isNaN(n)) return '0%';
  return (n * 100).toFixed(1) + '%';
};

export const formatDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Fecha + hora en zona horaria de Colombia. Para movimientos de tesorería se usa la
// hora real de registro (createdAt), así se ve "20 may 2026, 3:45 p. m." sin corrimiento.
export const formatDateTime = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

// Obtiene la fecha local en formato YYYY-MM-DD (para inputs type="date")
// Usa la zona horaria de Colombia (America/Bogota)
export const getLocalDateString = (date = new Date()) => {
  const d = new Date(date);
  // Ajustar a zona horaria de Colombia
  const colombiaDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const year = colombiaDate.getFullYear();
  const month = String(colombiaDate.getMonth() + 1).padStart(2, '0');
  const day = String(colombiaDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getStage = (id) => STAGES.find(s => s.id === id) || STAGES[0];

export const getCategory = (id) => EXPENSE_CATEGORIES.find(c => c.id === id);

export const getPortal = (id) => PORTALS.find(p => p.id === id);
