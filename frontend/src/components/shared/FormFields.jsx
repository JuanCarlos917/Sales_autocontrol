export function Field({ label, help, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label-sm">{label}</label>}
      {children}
      {help && <p className="text-[11px] text-[#6E7681] mt-1">{help}</p>}
    </div>
  );
}

export function Input({ label, help, className = '', ...props }) {
  return (
    <Field label={label} help={help} className={className}>
      <input className="input-field" {...props} />
    </Field>
  );
}

export function Select({ label, help, options = [], className = '', ...props }) {
  return (
    <Field label={label} help={help} className={className}>
      <select className="input-field" {...props}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function Textarea({ label, help, className = '', ...props }) {
  return (
    <Field label={label} help={help} className={className}>
      <textarea className="input-field resize-y" {...props} />
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
