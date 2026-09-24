"use client";

export function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type: string;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="mt-1.5 w-full border-b border-ink bg-transparent pb-2 text-lg outline-none placeholder:text-rule focus:border-accent"
      />
    </label>
  );
}

export function Submit({
  pending,
  disabled,
  children,
}: {
  pending: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="eyebrow w-full bg-accent py-3.5 text-paper transition hover:bg-ink disabled:opacity-40"
    >
      {pending ? "Working" : children}
    </button>
  );
}
