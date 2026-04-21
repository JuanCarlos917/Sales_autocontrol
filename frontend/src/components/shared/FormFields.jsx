export function Field({ label, help, error, children, className = '' }) {
  const errorText = typeof error === 'string' ? error : null;
  return (
    <div className={className}>
      {label && (
        <label className={`label-sm ${error ? 'text-red-400' : ''}`}>
          {label}{error ? ' *' : ''}
        </label>
      )}
      {children}
      {errorText && <p className="text-[11px] text-red-400 mt-1 font-medium">⚠ {errorText}</p>}
      {help && !errorText && <p className="text-[11px] text-[#6E7681] mt-1">{help}</p>}
    </div>
  );
}

const errorInputClass = '!border-red-500 ring-2 ring-red-500/60 bg-red-500/5 focus:ring-red-500/80 animate-ring-pulse';

export function Input({ label, help, error, className = '', ...props }) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      <input className={`input-field ${error ? errorInputClass : ''}`} {...props} />
    </Field>
  );
}

export function Select({ label, help, error, options = [], className = '', ...props }) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      <select className={`input-field ${error ? errorInputClass : ''}`} {...props}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function Textarea({ label, help, error, className = '', ...props }) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      <textarea className={`input-field resize-y ${error ? errorInputClass : ''}`} {...props} />
    </Field>
  );
}

export function Checkbox({ label, className = '', ...props }) {
  return (
    <label className={`flex items-center gap-2 cursor-pointer text-sm ${className}`}>
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}

// ─── MoneyInput ───────────────────────────────────────────────
// Formatea valores monetarios COP como "$ 100.000.000" mientras
// se escribe. El onChange devuelve un event-like con target.value
// conteniendo solo los dígitos (string numérico), para que los
// formularios sigan tratando el valor como número.
const formatMoney = (raw) => {
  if (raw === '' || raw === null || raw === undefined) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  return `$ ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
};

export function MoneyInput({ label, help, error, className = '', value, onChange, placeholder, ...props }) {
  const display = formatMoney(value);
  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (onChange) {
      onChange({ ...e, target: { ...e.target, value: digits } });
    }
  };
  return (
    <Field label={label} help={help} error={error} className={className}>
      <input
        type="text"
        inputMode="numeric"
        className={`input-field ${error ? errorInputClass : ''}`}
        value={display}
        onChange={handleChange}
        placeholder={placeholder ?? '$ 0'}
        {...props}
      />
    </Field>
  );
}
