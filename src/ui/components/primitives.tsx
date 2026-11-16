import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background,color,box-shadow,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent text-accent-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-accent-hover',
        variant === 'secondary' && 'border-[0.5px] border-line bg-surface text-text shadow-card hover:bg-hover',
        variant === 'ghost' && 'text-text hover:bg-hover',
        variant === 'danger' && 'border-[0.5px] border-line bg-surface text-danger shadow-card hover:bg-hover',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-35',
        active && 'text-accent',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border-[0.5px] border-line bg-surface shadow-card', className)}>{children}</div>;
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[13px] font-medium text-text">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-[22px] w-[38px] flex-none rounded-full transition-colors disabled:opacity-40',
          checked ? 'bg-accent' : 'bg-[rgba(120,120,128,0.32)]',
        )}
      >
        <span className={cx('absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform', checked && 'translate-x-4')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-hover p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            'h-7 rounded-md px-2.5 text-[12px] font-medium transition-all',
            option.value === value ? 'bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text">{label}</div>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-muted">{description}</p>}
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}

export function Select({ value, onChange, label, children, className }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode; className?: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cx('h-8 cursor-pointer rounded-lg border-[0.5px] border-line bg-surface px-2.5 text-[13px] text-text shadow-card', className)}
    >
      {children}
    </select>
  );
}

export function Progress({ value, max = 1, label }: { value: number; max?: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1e-9)) * 100));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 overflow-hidden rounded-full bg-hover">
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</div>
      <div className="text-[13px] font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-[260px] text-[12px] text-muted">{children}</div>}
    </div>
  );
}
