import { useState, type ReactNode } from 'react';
import {
  Activity,
  BookOpen,
  Fingerprint,
  History,
  LayoutDashboard,
  Menu,
  Network,
  FileSearch,
  RefreshCw,
  Settings2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';

import { useGetChainConfig, useGetStats } from '@workspace/api-client-react';

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/queue', label: 'Verification queue', icon: FileSearch },
  { href: '/agents', label: 'Agents', icon: Network },
  { href: '/audit', label: 'Audit trail', icon: History },
  { href: '/guide', label: 'Protocol guide', icon: BookOpen },
];

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: chain } = useGetChainConfig();
  const { data: stats } = useGetStats();

  const current = navItems.find((item) => item.href === location)?.label ?? 'Overview';
  const pending = (stats?.unverified ?? 0) + (stats?.verifying ?? 0);

  // The header states exactly what is connected. A dashboard that says
  // "0G mainnet connected" while nothing is configured is worse than one that
  // admits it is running locally.
  const chainLabel = chain?.configured ? `${chain.networkName} connected` : 'chain not connected';
  const chainTone = chain?.configured ? 'bg-[#b4dc67]' : 'bg-[#cb8e3c]';

  return (
    <div className="min-h-[100dvh] bg-transparent">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[246px] flex-col border-r border-[#1d2628] bg-[#0b1013] px-4 py-5 transition-transform duration-300 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-9 flex items-center justify-between px-2">
          <Link href="/" data-testid="link-brand" className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#c8f169] text-[#0a1111] shadow-[0_0_22px_rgba(200,241,105,.18)]">
              <Fingerprint size={20} strokeWidth={2.4} />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#f3b761]" />
            </div>
            <div>
              <div className="font-display text-[15px] font-extrabold tracking-[-.03em] text-[#edf4e4]">
                Q—DSR
              </div>
              <div className="font-mono text-[8px] uppercase tracking-[.2em] text-[#6e7a70]">
                agent verification
              </div>
            </div>
          </Link>
          <button
            data-testid="button-close-menu"
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1 text-[#768076] hover:bg-[#182022] hover:text-[#e6ebd9] lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[.2em] text-[#59645d]">
          Workspace
        </div>
        <nav className="space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? location === '/' : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
                onClick={() => setMobileOpen(false)}
                className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-[12px] font-semibold ${
                  active
                    ? 'bg-[#1b2521] text-[#c8f169]'
                    : 'text-[#849087] hover:bg-[#151d1f] hover:text-[#dce7d6]'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon size={16} strokeWidth={active ? 2.3 : 1.8} />
                  {label}
                </span>
                {label === 'Verification queue' && pending > 0 && (
                  <span className="rounded bg-[#cb8e3c]/15 px-1.5 py-0.5 font-mono text-[9px] text-[#f3b761]">
                    {String(pending).padStart(2, '0')}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto">
          <div className="mb-4 rounded-lg border border-[#24312c] bg-[#111c18] p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-[#c8f169]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#9bc956]" />
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[.15em] text-[#adc789]">
                Engine online
              </span>
            </div>
            <div className="font-mono text-[10px] text-[#68786e]">
              {chain?.engineVersion ?? 'qdsr-core'}
            </div>
            <div className="mt-2 font-mono text-[9px] text-[#5f6d64]">
              evidence storage: {chain?.storageMode ?? '—'}
            </div>
          </div>
          <Link
            href="/guide"
            data-testid="link-settings"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] font-semibold text-[#849087] hover:bg-[#151d1f] hover:text-[#dce7d6]"
          >
            <Settings2 size={16} />
            Protocol settings
          </Link>
          <div className="mt-4 flex items-center gap-3 border-t border-[#20292a] px-2 pt-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2a3940] font-mono text-[10px] text-[#9ed4cc]">
              OP
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-[#dbe4d7]">Operator</div>
              <div className="truncate font-mono text-[9px] text-[#647069]">
                {chain?.attestorAddress ? `${chain.attestorAddress.slice(0, 10)}…` : 'local session'}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <button
          aria-label="Close navigation"
          data-testid="button-overlay"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-[#05090b]/70 lg:hidden"
        />
      )}

      <main className="min-h-[100dvh] lg:pl-[246px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#1d2628] bg-[#0b1013]/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <button
              data-testid="button-open-menu"
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-1.5 text-[#89958b] hover:bg-[#192124] lg:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#68736d]">
              Q-DSR / <span className="text-[#b5c0ae]">{current}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span
              data-testid="text-chain-status"
              className="hidden items-center gap-2 font-mono text-[10px] text-[#768278] sm:flex"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${chainTone}`} />
              {chainLabel}
            </span>
            <button
              data-testid="button-refresh"
              onClick={() => void queryClient.invalidateQueries()}
              title="Refetch everything"
              className="rounded-md border border-[#273131] p-2 text-[#8d9a8f] hover:border-[#607145] hover:text-[#c8f169]"
            >
              <RefreshCw size={15} />
            </button>
            <Link
              href="/audit"
              data-testid="button-notifications"
              className="relative rounded-md border border-[#273131] p-2 text-[#8d9a8f] hover:border-[#607145] hover:text-[#c8f169]"
            >
              <Activity size={15} />
            </Link>
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}
