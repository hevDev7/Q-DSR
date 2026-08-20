import { ArrowRight, Plus, Zap } from 'lucide-react';
import { Link } from 'wouter';

import {
  useGetChainConfig,
  useGetStats,
  useListAgents,
  useListAuditEvents,
} from '@workspace/api-client-react';

import { clockTime, initials, integer, probability, ratio } from '../lib/format';
import { Metric, PageIntro, Panel, PrimaryButton, StatusBadge } from '../components/primitives';

const TONE_DOT: Record<string, string> = {
  good: 'bg-[#c8f169]',
  warn: 'bg-[#f3b761]',
  bad: 'bg-[#ed7770]',
  cyan: 'bg-[#6fe0dc]',
  neutral: 'bg-[#7f8c85]',
};

export function OverviewPage({
  onOpenAgent,
  onRegister,
  onSubmit,
}: {
  onOpenAgent: (id: string) => void;
  onRegister: () => void;
  onSubmit: () => void;
}) {
  const { data: stats } = useGetStats();
  const { data: agents = [] } = useListAgents();
  const { data: events = [] } = useListAuditEvents({ limit: 6 });
  const { data: chain } = useGetChainConfig();

  const attention = agents.filter((agent) => agent.status !== 'certified').slice(0, 5);
  const certified = stats?.certified ?? 0;
  const total = stats?.total ?? 0;

  const slice = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const certifiedPct = slice(certified);
  const verifyingPct = certifiedPct + slice(stats?.verifying ?? 0);
  const unverifiedPct = verifyingPct + slice(stats?.unverified ?? 0);

  return (
    <div className="animate-rise">
      <PageIntro
        eyebrow="Control room"
        title="Verification overview"
        description="A live read on the evidence standing between an autonomous trading strategy and an on-chain identity."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              data-testid="button-register-agent"
              onClick={onRegister}
              className="flex items-center justify-center gap-2 rounded-lg border border-[#607145] bg-[#162018] px-4 py-2.5 text-[12px] font-bold text-[#c8f169] hover:bg-[#1d2b1e]"
            >
              <Plus size={15} />
              Register agent
            </button>
            <PrimaryButton testId="button-run-verification" onClick={onSubmit}>
              <Zap size={15} fill="currentColor" />
              Run verification
              <ArrowRight size={14} />
            </PrimaryButton>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Panel className="animate-rise stagger-1 p-4 sm:p-5">
          <Metric
            label="Agents certified"
            value={integer(certified)}
            suffix={`/ ${integer(total)}`}
          />
        </Panel>
        <Panel className="animate-rise stagger-2 p-4 sm:p-5">
          <Metric
            label="Median DSR"
            value={probability(stats?.medianDsr)}
            accent="text-[#81e6e0]"
            trend="need ≥ 0.95"
          />
        </Panel>
        <Panel className="animate-rise stagger-3 p-4 sm:p-5">
          <Metric
            label="Median PBO"
            value={probability(stats?.medianPbo)}
            accent="text-[#f3b761]"
            trend="need ≤ 0.10"
          />
        </Panel>
        <Panel className="animate-rise stagger-4 p-4 sm:p-5">
          <Metric
            label="Verdicts anchored"
            value={integer(stats?.anchored)}
            suffix={`/ ${integer(stats?.totalRuns)}`}
            accent="text-[#c8f169]"
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel className="animate-rise stagger-2">
          <div className="flex items-center justify-between border-b border-[#222b2c] px-5 py-4">
            <div>
              <h2 className="text-[13px] font-bold text-[#dce7d6]">Review attention</h2>
              <p className="mt-1 font-mono text-[10px] text-[#67736b]">
                Agents without a passing verdict
              </p>
            </div>
            <Link
              href="/queue"
              data-testid="link-view-queue"
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#a4c85e] hover:text-[#d5f27b]"
            >
              View queue <ArrowRight size={13} />
            </Link>
          </div>

          {attention.length === 0 ? (
            <div className="px-5 py-10 text-center text-[11px] leading-6 text-[#6e7d72]">
              Nothing is waiting. Every registered agent holds a passing verdict.
            </div>
          ) : (
            <div className="divide-y divide-[#202a2b]">
              {attention.map((agent) => (
                <button
                  key={agent.id}
                  data-testid={`button-open-attention-${agent.id}`}
                  onClick={() => onOpenAgent(agent.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-[#151f20]"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11px] font-extrabold"
                    style={{
                      borderColor: `${agent.accent}55`,
                      color: agent.accent,
                      backgroundColor: `${agent.accent}0d`,
                    }}
                  >
                    {initials(agent.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-[#dce7d6]">
                      {agent.name}
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-[#6f7d73]">
                      {agent.family}
                      {agent.metrics && (
                        <>
                          <span className="px-1 text-[#3d4b43]">·</span>
                          {integer(agent.metrics.trials)} configurations tested
                        </>
                      )}
                    </div>
                  </div>
                  {agent.metrics && (
                    <div className="hidden text-right sm:block">
                      <div className="font-mono text-[12px] text-[#dce7d6]">
                        DSR {probability(agent.metrics.dsr)}
                      </div>
                      <div className="mt-1 font-mono text-[9px] text-[#6e7a70]">
                        PBO {probability(agent.metrics.pbo)}
                      </div>
                    </div>
                  )}
                  <StatusBadge status={agent.status} />
                  <ArrowRight size={15} className="text-[#627068]" />
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel className="animate-rise stagger-3">
            <div className="border-b border-[#222b2c] px-5 py-4">
              <h2 className="text-[13px] font-bold text-[#dce7d6]">Fleet composition</h2>
              <p className="mt-1 font-mono text-[10px] text-[#67736b]">
                Where every registered agent stands
              </p>
            </div>
            <div className="space-y-5 p-5">
              <div className="flex items-center gap-5">
                <div
                  className="relative flex h-[112px] w-[112px] shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(#c8f169 0 ${certifiedPct}%, #6fe0dc ${certifiedPct}% ${verifyingPct}%, #f3b761 ${verifyingPct}% ${unverifiedPct}%, #ed7770 ${unverifiedPct}% 100%)`,
                  }}
                >
                  <div className="flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full bg-[#10171a]">
                    <span className="font-mono text-[24px] text-[#e6ebd9]">{integer(total)}</span>
                    <span className="font-mono text-[9px] uppercase text-[#718078]">agents</span>
                  </div>
                </div>
                <div className="w-full space-y-3 font-mono text-[10px]">
                  {[
                    { color: '#c8f169', label: 'Certified', value: stats?.certified ?? 0 },
                    { color: '#6fe0dc', label: 'Verifying', value: stats?.verifying ?? 0 },
                    { color: '#f3b761', label: 'Unverified', value: stats?.unverified ?? 0 },
                    {
                      color: '#ed7770',
                      label: 'Not significant',
                      value: stats?.insignificant ?? 0,
                    },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between">
                      <span className="flex items-center gap-2 text-[#9baa9e]">
                        <i
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: row.color }}
                        />
                        {row.label}
                      </span>
                      <b className="font-medium text-[#dce7d6]">{integer(row.value)}</b>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-[#252f2d] bg-[#121b18] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#869386]">
                <span className="text-[#c8f169]">engine:</span>{' '}
                {chain?.engineVersion ?? 'qdsr-core'} · evidence storage {chain?.storageMode ?? '—'}
              </div>
            </div>
          </Panel>

          <Panel className="animate-rise stagger-4">
            <div className="flex items-center justify-between border-b border-[#222b2c] px-5 py-4">
              <div>
                <h2 className="text-[13px] font-bold text-[#dce7d6]">Latest audit events</h2>
                <p className="mt-1 font-mono text-[10px] text-[#67736b]">Verification ledger</p>
              </div>
              <Link href="/audit" data-testid="link-audit" className="text-[#a4c85e] hover:text-[#d5f27b]">
                <ArrowRight size={15} />
              </Link>
            </div>
            <div className="space-y-4 p-5">
              {events.length === 0 && (
                <p className="text-[11px] leading-6 text-[#6e7d72]">
                  Nothing has happened yet. Register an agent to start the ledger.
                </p>
              )}
              {events.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <div
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[event.tone] ?? TONE_DOT.neutral}`}
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#cbd7cb]">{event.action}</div>
                    <div className="mt-0.5 truncate text-[10px] leading-5 text-[#6e7a70]">
                      {event.detail}
                    </div>
                    <div className="mt-1 font-mono text-[9px] text-[#4f5d55]">
                      {clockTime(event.createdAt)} · {event.actor}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
