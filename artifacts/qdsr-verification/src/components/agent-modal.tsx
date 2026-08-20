import { useState } from 'react';
import { Check, Copy, Database, ExternalLink, RefreshCcw, X, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import {
  useAnchorRun,
  useGetAgent,
  useReplicateRun,
  type ReplicationReport,
} from '@workspace/api-client-react';

import {
  duration,
  initials,
  integer,
  probability,
  ratio,
  relativeTime,
  shortHash,
} from '../lib/format';
import { MintPanel } from './mint-panel';
import { GhostButton, ModalShell, PrimaryButton, StatusBadge } from './primitives';

export function AgentModal({
  agentId,
  onClose,
  onRun,
}: {
  agentId: string;
  onClose: () => void;
  onRun: (agentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: agent, isLoading } = useGetAgent(agentId);
  const [copied, setCopied] = useState(false);
  const [replication, setReplication] = useState<ReplicationReport>();

  const latestRun = agent?.runs?.find((run) => run.id === agent.latestRunId) ?? agent?.runs?.[0];
  const result = latestRun?.result;
  const anchor = latestRun?.anchor;

  const anchorRun = useAnchorRun({
    mutation: { onSettled: () => void queryClient.invalidateQueries() },
  });
  const replicateRun = useReplicateRun({
    mutation: { onSuccess: (report) => setReplication(report) },
  });

  const copyId = async () => {
    if (!agent) return;
    try {
      await navigator.clipboard.writeText(agent.agentId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; saying nothing is better than claiming
      // a copy that did not happen.
      setCopied(false);
    }
  };

  if (isLoading || !agent) {
    return (
      <ModalShell onClose={onClose} testId="dialog-agent-loading" width="max-w-[760px]">
        <div className="p-10 text-center font-mono text-[11px] text-[#7d8b80]">loading agent…</div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} testId={`dialog-agent-${agent.id}`} width="max-w-[760px]">
      <div className="flex items-start justify-between border-b border-[#263031] p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl border text-sm font-extrabold"
            style={{
              color: agent.accent,
              borderColor: `${agent.accent}66`,
              backgroundColor: `${agent.accent}12`,
            }}
          >
            {initials(agent.name)}
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-extrabold tracking-[-.03em] text-[#e8f0e5]">
                {agent.name}
              </h2>
              <StatusBadge status={agent.status} />
            </div>
            <div className="font-mono text-[10px] text-[#758278]">
              {agent.family} · owner {agent.owner}
            </div>
            <div className="mt-1 font-mono text-[9px] text-[#5f6d64]">
              agentId {shortHash(agent.agentId, 14, 8)}
            </div>
          </div>
        </div>
        <button
          data-testid="button-close-agent"
          onClick={onClose}
          className="rounded-lg p-2 text-[#79867c] hover:bg-[#1a2426] hover:text-[#dce7d6]"
        >
          <X size={18} />
        </button>
      </div>

      {!result ? (
        <div className="p-8 text-center">
          <p className="mx-auto max-w-sm text-[12px] leading-6 text-[#7e897e]">
            This agent has an identity but no verdict. Until an evidence bundle survives PBO and
            DSR testing, there is nothing here worth trusting.
          </p>
          <div className="mt-5 flex justify-center">
            <PrimaryButton testId="button-run-from-agent" onClick={() => onRun(agent.id)}>
              <Zap size={14} />
              Submit evidence
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-[#263031] bg-[#263031] sm:grid-cols-4">
            {[
              { label: 'DSR', value: probability(result.dsr), accent: 'text-[#c8f169]', note: 'need ≥ 0.95' },
              { label: 'PBO', value: probability(result.pbo), accent: 'text-[#f3b761]', note: 'need ≤ 0.10' },
              {
                label: 'Sharpe (ann.)',
                value: ratio(result.sharpeAnnualised),
                accent: 'text-[#81e6e0]',
                note: 'observed',
              },
              {
                label: 'Search space',
                value: `${integer(result.trials)} × ${integer(result.observations)}`,
                accent: 'text-[#e6ebd9]',
                note: 'trials × observations',
              },
            ].map((cell) => (
              <div key={cell.label} className="bg-[#10181a] p-4">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[.12em] text-[#6f7d73]">
                  {cell.label}
                </div>
                <div className={`font-mono text-[20px] tracking-[-.04em] ${cell.accent}`}>
                  {cell.value}
                </div>
                <div className="mt-1 font-mono text-[9px] text-[#5f6d64]">{cell.note}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
            <div>
              <h3 className="mb-3 text-[12px] font-bold text-[#dce7d6]">Certification gates</h3>
              <div className="space-y-2">
                {result.gates.map((gate) => (
                  <div
                    key={gate.gate}
                    data-testid={`gate-${gate.gate}`}
                    className="flex items-center gap-3 rounded-lg border border-[#263231] bg-[#121b1d] px-3 py-2.5"
                  >
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        gate.passed ? 'bg-[#25351f] text-[#c8f169]' : 'bg-[#34201f] text-[#ed7770]'
                      }`}
                    >
                      {gate.passed ? <Check size={11} /> : <X size={11} />}
                    </div>
                    <span className="flex-1 text-[11px] text-[#aebbae]">
                      {gate.gate.replaceAll('_', ' ')}
                    </span>
                    <span
                      className={`font-mono text-[10px] ${gate.passed ? 'text-[#c8d8c3]' : 'text-[#f0a49f]'}`}
                    >
                      {ratio(gate.observed, 4)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-[12px] font-bold text-[#dce7d6]">Statistical detail</h3>
              <dl className="space-y-2 rounded-lg border border-[#263231] bg-[#0d1416] p-3 font-mono text-[10px]">
                {[
                  ['Sharpe (per period)', ratio(result.sharpe, 6)],
                  ['Expected max under null (SR₀)', ratio(result.expectedMaxSharpe, 6)],
                  ['Skewness γ₃', ratio(result.skewness, 4)],
                  ['Kurtosis γ₄', ratio(result.kurtosis, 4)],
                  [
                    'Bootstrap 95% CI',
                    `[${ratio(result.bootstrap.ci95Low, 4)}, ${ratio(result.bootstrap.ci95High, 4)}]`,
                  ],
                  ['P(Sharpe > 0)', probability(result.bootstrap.probabilityPositive)],
                  ['CSCV splits', integer(result.cscv.combinations)],
                  ['Engine time', duration(result.elapsedMs)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-[#77857a]">{label}</dt>
                    <dd className="text-[#dce7d6]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="border-t border-[#263031] p-5 sm:p-6">
            <h3 className="mb-3 flex items-center gap-2 text-[12px] font-bold text-[#dce7d6]">
              <Database size={14} />
              Evidence anchor
            </h3>

            <div className="rounded-lg border border-[#263231] bg-[#0d1416] p-4 font-mono text-[10px] leading-6">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-[#77857a]">status</span>
                <span
                  data-testid="text-anchor-status"
                  className={
                    anchor?.status === 'anchored'
                      ? 'text-[#c8f169]'
                      : anchor?.status === 'failed'
                        ? 'text-[#ed7770]'
                        : 'text-[#f3b761]'
                  }
                >
                  {anchor?.status ?? 'none'}
                  {anchor?.storageMode ? ` · storage ${anchor.storageMode}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-[#77857a]">0G evidence root</span>
                <span className="text-[#dce7d6]">{shortHash(anchor?.evidenceRoot, 14, 8)}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-[#77857a]">result digest</span>
                <span className="text-[#dce7d6]">{shortHash(result.digest, 14, 8)}</span>
              </div>
              {anchor?.explorerUrl && (
                <a
                  href={anchor.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="link-explorer"
                  className="mt-2 flex items-center gap-1.5 text-[#a4c85e] hover:text-[#d5f27b]"
                >
                  view on 0G explorer <ExternalLink size={11} />
                </a>
              )}
              {anchor?.error && <div className="mt-2 text-[#ed7770]">{anchor.error}</div>}
            </div>

            {replication && (
              <div
                data-testid="text-replication"
                className={`mt-3 rounded-lg border px-3 py-3 font-mono text-[10px] leading-6 ${
                  replication.reproduced
                    ? 'border-[#64883b]/50 bg-[#17241a] text-[#c8d8c3]'
                    : 'border-[#8e4844]/50 bg-[#34201f] text-[#f0a49f]'
                }`}
              >
                <div className="font-bold">
                  {replication.reproduced
                    ? 'Replication succeeded — the digest matches byte for byte'
                    : 'Replication MISMATCH — the anchored verdict does not reproduce'}
                </div>
                <div className="mt-1">
                  recomputed {shortHash(replication.recomputedDigest, 14, 8)} in{' '}
                  {duration(replication.elapsedMs)} with {replication.engineVersion}
                </div>
                {replication.note && <div className="text-[#a2ae9c]">{replication.note}</div>}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <GhostButton
                testId="button-anchor"
                onClick={() => latestRun && anchorRun.mutate({ runId: latestRun.id })}
                disabled={!latestRun || anchorRun.isPending}
              >
                <Database size={13} />
                {anchorRun.isPending ? 'Anchoring…' : 'Anchor evidence'}
              </GhostButton>
              <GhostButton
                testId="button-replicate"
                onClick={() => latestRun && replicateRun.mutate({ runId: latestRun.id })}
                disabled={!latestRun || replicateRun.isPending}
              >
                <RefreshCcw size={13} />
                {replicateRun.isPending ? 'Replicating…' : 'Replicate independently'}
              </GhostButton>
            </div>
          </div>
        </>
      )}

      <MintPanel agentId={agent.id} />

      <div className="flex flex-col-reverse justify-between gap-3 border-t border-[#263031] bg-[#0e1517] p-5 sm:flex-row sm:items-center">
        <span className="font-mono text-[9px] text-[#657269]">
          {latestRun ? `last verified ${relativeTime(latestRun.finishedAt ?? latestRun.createdAt)}` : 'never verified'}
        </span>
        <div className="flex gap-2">
          <GhostButton testId="button-copy-agent-id" onClick={() => void copyId()}>
            <Copy size={13} />
            {copied ? 'Copied' : 'Copy agentId'}
          </GhostButton>
          <PrimaryButton testId={`button-modal-run-${agent.id}`} onClick={() => onRun(agent.id)}>
            <Zap size={13} />
            Run verification
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}
