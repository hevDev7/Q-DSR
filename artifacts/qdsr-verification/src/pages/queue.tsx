import { useMemo, useState } from 'react';
import { Clock3, Database, Gauge, Plus } from 'lucide-react';

import { useGetStats, useListAgents, useListRuns } from '@workspace/api-client-react';

import { AgentFilters, AgentTable } from '../components/agent-table';
import { PageIntro, Panel, PrimaryButton } from '../components/primitives';
import { duration, integer, probability } from '../lib/format';

export function QueuePage({
  onOpenAgent,
  onSubmit,
}: {
  onOpenAgent: (id: string) => void;
  onSubmit: () => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');

  const { data: agents = [] } = useListAgents();
  const { data: runs = [] } = useListRuns();
  const { data: stats } = useGetStats();

  const filtered = useMemo(
    () =>
      agents
        .filter((agent) => (status === 'All' ? true : agent.status === status))
        .filter((agent) =>
          `${agent.name} ${agent.family} ${agent.owner}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    [agents, search, status],
  );

  const completed = runs.filter((run) => run.status === 'completed' && run.result);
  const medianEngineTime = useMemo(() => {
    const values = completed.map((run) => run.result!.elapsedMs).sort((a, b) => a - b);
    if (values.length === 0) return undefined;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1]! + values[mid]!) / 2;
  }, [completed]);

  const totalSplits = completed.reduce((sum, run) => sum + run.result!.cscv.combinations, 0);

  return (
    <div className="animate-rise">
      <PageIntro
        eyebrow={`Decision pipeline · ${integer((stats?.unverified ?? 0) + (stats?.verifying ?? 0))} pending`}
        title="Verification queue"
        description="Every submission is held to the same statistical bar before it can become an Agentic ID."
        action={
          <PrimaryButton testId="button-queue-run" onClick={onSubmit}>
            <Plus size={15} />
            New verification
          </PrimaryButton>
        }
      />

      <Panel testId="panel-queue">
        <AgentFilters search={search} setSearch={setSearch} status={status} setStatus={setStatus} />
        <div className="flex items-center justify-between border-b border-[#222b2c] bg-[#0e1517] px-5 py-3">
          <div className="font-mono text-[10px] text-[#748177]">
            <span className="text-[#dce7d6]">{filtered.length}</span> of {agents.length} agents
          </div>
          <div className="font-mono text-[10px] text-[#748177]">
            {integer(runs.length)} runs recorded
          </div>
        </div>
        <AgentTable
          agents={filtered}
          onOpen={onOpenAgent}
          emptyAction={
            <PrimaryButton testId="button-queue-empty-run" onClick={onSubmit}>
              <Plus size={14} />
              Submit evidence
            </PrimaryButton>
          }
        />
      </Panel>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[#29322c] bg-[#111a17] p-4">
          <div className="mb-2 flex items-center gap-2 text-[#f3b761]">
            <Clock3 size={15} />
            <span className="font-mono text-[10px] uppercase">Median engine time</span>
          </div>
          <div className="font-mono text-[20px] text-[#dce7d6]">{duration(medianEngineTime)}</div>
          <p className="mt-1 text-[10px] text-[#69786e]">Upload to verdict, measured</p>
        </div>
        <div className="rounded-lg border border-[#29322c] bg-[#111a17] p-4">
          <div className="mb-2 flex items-center gap-2 text-[#81e6e0]">
            <Database size={15} />
            <span className="font-mono text-[10px] uppercase">CSCV splits evaluated</span>
          </div>
          <div className="font-mono text-[20px] text-[#dce7d6]">{integer(totalSplits)}</div>
          <p className="mt-1 text-[10px] text-[#69786e]">Across every completed run</p>
        </div>
        <div className="rounded-lg border border-[#29322c] bg-[#111a17] p-4">
          <div className="mb-2 flex items-center gap-2 text-[#c8f169]">
            <Gauge size={15} />
            <span className="font-mono text-[10px] uppercase">Median PBO</span>
          </div>
          <div className="font-mono text-[20px] text-[#dce7d6]">{probability(stats?.medianPbo)}</div>
          <p className="mt-1 text-[10px] text-[#69786e]">0.5 would mean pure overfitting</p>
        </div>
      </div>
    </div>
  );
}
