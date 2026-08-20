import { ArrowRight, ChevronDown, FileSearch, Search, SlidersHorizontal } from 'lucide-react';

import type { Agent, AgentStatus } from '@workspace/api-client-react';

import { initials, integer, probability, ratio } from '../lib/format';
import { AgenticIdBadge, AgenticIdRing } from './agentic-id-badge';
import { EmptyState, SearchBar, StatusBadge } from './primitives';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'All', label: 'All statuses' },
  { value: 'certified', label: 'Certified' },
  { value: 'verifying', label: 'Verifying' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'insignificant', label: 'Not significant' },
  { value: 'failed', label: 'Run failed' },
];

export function AgentFilters({
  search,
  setSearch,
  status,
  setStatus,
}: {
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-[#222b2c] p-4 sm:flex-row">
      <SearchBar value={search} onChange={setSearch} icon={<Search size={15} />} />
      <div className="flex gap-2">
        <div className="relative">
          <SlidersHorizontal
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#738078]"
          />
          <select
            data-testid="select-status-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 appearance-none rounded-lg border border-[#293536] bg-[#11191c] pl-8 pr-9 font-mono text-[10px] uppercase tracking-wider text-[#9baa9e] outline-none hover:border-[#607145]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#738078]"
          />
        </div>
        <button
          data-testid="button-filter-reset"
          onClick={() => {
            setSearch('');
            setStatus('All');
          }}
          className="h-10 rounded-lg border border-[#293536] px-3 font-mono text-[10px] uppercase tracking-wider text-[#7e8a80] hover:text-[#c8f169]"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

const GRID =
  'grid-cols-[minmax(170px,1.5fr)_minmax(110px,1fr)_82px_82px_92px_128px_18px] max-md:grid-cols-[minmax(150px,1.5fr)_82px_82px_18px]';

function AgentRow({ agent, onOpen }: { agent: Agent; onOpen: (id: string) => void }) {
  const metrics = agent.metrics;
  return (
    <button
      data-testid={`button-agent-${agent.id}`}
      onClick={() => onOpen(agent.id)}
      className={`grid w-full ${GRID} items-center gap-3 border-b border-[#202a2b] px-5 py-4 text-left last:border-0 hover:bg-[#151f20]`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {(() => {
          const avatar = (
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[10px] font-extrabold"
              style={{
                color: agent.accent,
                borderColor: `${agent.accent}55`,
                backgroundColor: `${agent.accent}0d`,
              }}
            >
              {initials(agent.name)}
            </div>
          );
          return agent.tokenId ? <AgenticIdRing>{avatar}</AgenticIdRing> : avatar;
        })()}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-bold text-[#dce7d6]">{agent.name}</span>
            {agent.tokenId && <AgenticIdBadge tokenId={agent.tokenId} />}
          </div>
          <div className="mt-1 truncate font-mono text-[9px] text-[#69776d]">{agent.family}</div>
        </div>
      </div>

      <div className="hidden min-w-0 md:block">
        <div className="font-mono text-[11px] text-[#c2cfc1]">
          {metrics ? `${integer(metrics.trials)} × ${integer(metrics.observations)}` : '—'}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase text-[#637066]">search space</div>
      </div>

      <div>
        <div
          className={`font-mono text-[12px] ${
            metrics ? (metrics.pbo <= 0.1 ? 'text-[#c8f169]' : 'text-[#ed7770]') : 'text-[#637066]'
          }`}
        >
          {probability(metrics?.pbo)}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase text-[#637066]">PBO</div>
      </div>

      <div>
        <div
          className={`font-mono text-[12px] ${
            metrics ? (metrics.dsr >= 0.95 ? 'text-[#c8f169]' : 'text-[#ed7770]') : 'text-[#637066]'
          }`}
        >
          {probability(metrics?.dsr)}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase text-[#637066]">DSR</div>
      </div>

      <div className="hidden sm:block">
        <div className="font-mono text-[12px] text-[#c2cfc1]">
          {ratio(metrics?.sharpeAnnualised)}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase text-[#637066]">Sharpe</div>
      </div>

      <div className="hidden md:block">
        <StatusBadge status={agent.status as AgentStatus} />
      </div>
      <ArrowRight size={15} className="text-[#58675e]" />
    </button>
  );
}

export function AgentTable({
  agents,
  onOpen,
  emptyAction,
}: {
  agents: Agent[];
  onOpen: (id: string) => void;
  emptyAction?: React.ReactNode;
}) {
  if (agents.length === 0) {
    return (
      <EmptyState
        testId="empty-agents"
        icon={<FileSearch size={20} />}
        title="No agents here yet"
        body="Register an agent and submit an evidence bundle. Nothing appears on this ledger until a verdict exists."
        action={emptyAction}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div
          className={`grid ${GRID} gap-3 border-b border-[#202a2b] px-5 py-3 font-mono text-[9px] uppercase tracking-[.14em] text-[#647168]`}
        >
          <span>Agent / family</span>
          <span className="hidden md:block">Search space</span>
          <span>PBO</span>
          <span>DSR</span>
          <span className="hidden sm:block">Sharpe</span>
          <span className="hidden md:block">Certification</span>
          <span />
        </div>
        {agents.map((agent) => (
          <AgentRow key={agent.id} agent={agent} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
