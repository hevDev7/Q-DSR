import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

import type { AgentStatus } from '@workspace/api-client-react';

export function Panel({
  children,
  className = '',
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`rounded-xl border border-[#222b2c] bg-[#0f1719] shadow-[var(--shadow-sm)] ${className}`}
    >
      {children}
    </div>
  );
}

const STATUS_STYLES: Record<AgentStatus, string> = {
  certified: 'border-[#6e963d]/40 bg-[#6e963d]/10 text-[#c8f169]',
  verifying: 'border-[#54b9b6]/40 bg-[#54b9b6]/10 text-[#81e6e0]',
  unverified: 'border-[#cb8e3c]/40 bg-[#cb8e3c]/10 text-[#f3b761]',
  insignificant: 'border-[#b65651]/40 bg-[#b65651]/10 text-[#ed7770]',
  failed: 'border-[#7a7f86]/40 bg-[#7a7f86]/10 text-[#a9b2ba]',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  certified: 'Certified',
  verifying: 'Verifying',
  unverified: 'Unverified',
  // The verdict, spelled out. "Rejected" would suggest a reviewer's opinion;
  // this is a statistical finding.
  insignificant: 'Not significant',
  failed: 'Run failed',
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      data-testid={`status-agent-${status}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[.08em] ${STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Metric({
  label,
  value,
  suffix,
  trend,
  accent = 'text-[#e6ebd9]',
}: {
  label: string;
  value: string;
  suffix?: string;
  trend?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[.12em] text-[#6f7d73]">
        {label}
      </div>
      <div className={`font-mono text-[24px] tracking-[-.04em] ${accent}`}>
        {value}
        {suffix && <span className="ml-1 text-[13px] text-[#7c8a7f]">{suffix}</span>}
      </div>
      {trend && (
        <div className="mt-2 flex items-center gap-1 font-mono text-[10px] text-[#7d8b80]">
          <ArrowUpRight size={12} />
          {trend}
        </div>
      )}
    </div>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#899f68]">
          <span className="h-px w-5 bg-[#899f68]" />
          {eyebrow}
        </div>
        <h1 className="font-display text-[30px] font-extrabold tracking-[-.045em] text-[#e9f0e4] sm:text-[36px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[12px] leading-6 text-[#7e897e]">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search agents, owners, families…',
  icon,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#68766c]">
          {icon}
        </span>
      )}
      <input
        data-testid="input-search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`h-10 w-full rounded-lg border border-[#293536] bg-[#11191c] ${icon ? 'pl-9' : 'pl-3'} pr-3 font-mono text-[11px] text-[#dce7d6] outline-none placeholder:text-[#57645b] focus:border-[#7b963e] focus:ring-1 focus:ring-[#7b963e]/40`}
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[.14em] text-[#7d8b80]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-[10px] leading-5 text-[#69786e]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-[#293536] bg-[#11191c] px-3 text-[12px] text-[#dce7d6] outline-none placeholder:text-[#57645b] focus:border-[#7b963e] focus:ring-1 focus:ring-[#7b963e]/40';

export function PrimaryButton({
  children,
  onClick,
  disabled,
  testId,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-lg bg-[#c8f169] px-4 py-2.5 text-[12px] font-extrabold text-[#101611] transition hover:-translate-y-0.5 hover:bg-[#d8fa8c] disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  testId,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-lg border border-[#293536] px-3 py-2.5 text-[11px] font-bold text-[#9aa99b] transition hover:border-[#607145] hover:text-[#c8f169] disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  testId,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center"
    >
      <div className="mb-3 rounded-xl border border-[#2c3833] bg-[#18221d] p-3 text-[#899f68]">
        {icon}
      </div>
      <h3 className="text-[13px] font-bold text-[#cbd7cb]">{title}</h3>
      <p className="mt-1 max-w-sm text-[11px] leading-5 text-[#6e7d72]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ModalShell({
  children,
  onClose,
  testId,
  width = 'max-w-[760px]',
}: {
  children: ReactNode;
  onClose: () => void;
  testId?: string;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#05090b]/75 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
        className={`max-h-[92dvh] w-full ${width} overflow-y-auto rounded-t-2xl border border-[#303b36] bg-[#10181a] shadow-[var(--shadow-2xl)] sm:rounded-2xl`}
      >
        {children}
      </div>
    </div>
  );
}
