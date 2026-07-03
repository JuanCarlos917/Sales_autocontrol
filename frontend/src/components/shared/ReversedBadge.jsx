// Badge de estado para entidades reversadas/anuladas/inactivas.
const VARIANTS = {
  zinc: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export default function ReversedBadge({ label = 'Reversado', variant = 'zinc', testid }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${VARIANTS[variant] || VARIANTS.zinc}`}
      data-testid={testid}
    >
      {label}
    </span>
  );
}
