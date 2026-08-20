import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import { useListAgents } from '@workspace/api-client-react';

import { AgentFilters, AgentTable } from '../components/agent-table';
import { PageIntro, Panel, PrimaryButton } from '../components/primitives';
import { integer } from '../lib/format';

export function AgentsPage({
  onOpenAgent,
  onRegister,
}: {
  onOpenAgent: (id: string) => void;
  onRegister: () => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const { data: agents = [] } = useListAgents();

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

  return (
    <div className="animate-rise">
      <PageIntro
        eyebrow={`Agent registry · ${integer(agents.length)} tracked`}
        title="Agent registry"
        description="A canonical index of strategies, their provenance, and the evidence attached to each identity."
        action={
          <PrimaryButton testId="button-register-agent" onClick={onRegister}>
            <Plus size={15} />
            Register agent
          </PrimaryButton>
        }
      />
      <Panel testId="panel-agents">
        <AgentFilters search={search} setSearch={setSearch} status={status} setStatus={setStatus} />
        <div className="flex items-center justify-between border-b border-[#222b2c] px-5 py-3 font-mono text-[10px] text-[#748177]">
          <span>
            <span className="text-[#dce7d6]">{filtered.length}</span> of {agents.length} visible
          </span>
          <span className="hidden items-center gap-2 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#c8f169]" />
            Live registry
          </span>
        </div>
        <AgentTable
          agents={filtered}
          onOpen={onOpenAgent}
          emptyAction={
            <PrimaryButton testId="button-agents-empty-register" onClick={onRegister}>
              <Plus size={14} />
              Register your first agent
            </PrimaryButton>
          }
        />
      </Panel>
    </div>
  );
}
