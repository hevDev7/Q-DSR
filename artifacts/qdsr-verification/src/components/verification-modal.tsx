import { useEffect } from 'react';
import { Check, CircleAlert, Clock3, X, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { getGetRunQueryKey, useGetRun, type Run } from '@workspace/api-client-react';

import { duration, integer, probability, ratio, shortHash } from '../lib/format';
import { GhostButton, ModalShell, PrimaryButton } from './primitives';

const PHASES = [
  { phase: 'validating', label: 'Validating evidence bundle' },
  { phase: 'fingerprinting', label: 'Fingerprinting return series' },
  { phase: 'cscv', label: 'Running CSCV overfitting suite' },
  { phase: 'bootstrap', label: 'Block bootstrap resampling' },
  { phase: 'sealing', label: 'Sealing reproducibility digest' },
] as const;

export function VerificationModal({
  runId,
  onClose,
  onOpenAgent,
}: {
  runId: string;
  onClose: () => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const queryClient = useQueryClient();

  const { data: run } = useGetRun(runId, {
    query: {
      queryKey: getGetRunQueryKey(runId),
      // Poll only while there is something to poll for. The engine finishes in
      // well under a second, so this usually resolves on the first or second tick.
      refetchInterval: (query) => {
        const status = (query.state.data as Run | undefined)?.status;
        return status === 'completed' || status === 'failed' ? false : 200;
      },
    },
  });

  const finished = run?.status === 'completed' || run?.status === 'failed';

  useEffect(() => {
    if (finished) void queryClient.invalidateQueries();
  }, [finished, queryClient]);

  const result = run?.result;
  const timings = result?.timings ?? [];
  const timingFor = (phase: string) => timings.find((timing) => timing.phase === phase);

  const certified = result?.verdict === 'certified';

  return (
    <ModalShell onClose={onClose} testId="dialog-verification" width="max-w-[560px]">
      <div className="relative h-1 overflow-hidden bg-[#26352b]">
        <div
          className="h-full bg-[#c8f169] transition-all duration-300"
          style={{ width: `${run?.progress ?? 0}%` }}
        />
        {!finished && <div className="animate-scan absolute inset-y-0 w-1/3 bg-[#e9ffad]/50" />}
      </div>

      <div className="p-6 sm:p-8">
        <div className="mb-7 flex items-start justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.18em] text-[#a6c960]">
              <span
                className={`h-1.5 w-1.5 rounded-full bg-[#c8f169] ${finished ? '' : 'animate-pulse-dot'}`}
              />
              {finished ? 'Verification complete' : 'Live verification'}
            </div>
            <h2 className="text-[20px] font-extrabold tracking-[-.035em] text-[#e9f2e5]">
              {run?.agentName ?? 'Verification'}
            </h2>
            <p className="mt-2 font-mono text-[10px] text-[#718076]">
              {result?.engineVersion ?? 'qdsr-core'} · seed {run?.seed ?? '—'} · deterministic run
            </p>
          </div>
          <button
            data-testid="button-cancel-verification"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#738078] hover:bg-[#1e2b25] hover:text-[#dce7d6]"
          >
            <X size={17} />
          </button>
        </div>

        {run?.status === 'failed' ? (
          <div
            data-testid="text-run-error"
            className="flex gap-3 rounded-lg border border-[#8e4844]/50 bg-[#34201f] px-4 py-4 text-[11px] leading-5 text-[#f0a49f]"
          >
            <CircleAlert size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="mb-1 font-bold text-[#ffc9c4]">The engine refused to answer</div>
              {run.error}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-7 flex items-end justify-between">
              <span
                data-testid="text-progress"
                className="font-mono text-[36px] tracking-[-.08em] text-[#c8f169]"
              >
                {Math.round(run?.progress ?? 0)}
                <span className="text-[17px] text-[#7b9360]">%</span>
              </span>
              {result && (
                <span className="font-mono text-[10px] text-[#798a7a]">
                  {integer(result.cscv.combinations)} CSCV splits ·{' '}
                  {integer(result.bootstrap.iterations)} resamples in{' '}
                  <span className="text-[#c8f169]">{duration(result.elapsedMs)}</span>
                </span>
              )}
            </div>

            <div className="space-y-2">
              {PHASES.map(({ phase, label }, index) => {
                const timing = timingFor(phase);
                const done = Boolean(timing);
                const active = !done && (run?.progress ?? 0) > index * 20;
                return (
                  <div
                    key={phase}
                    data-testid={`phase-${phase}`}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${
                      done
                        ? 'border-[#354b2b] bg-[#17231a]'
                        : active
                          ? 'border-[#5c7537] bg-[#1b291d]'
                          : 'border-[#28352f] bg-[#121b18]'
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-full ${
                        done
                          ? 'bg-[#c8f169] text-[#172019]'
                          : active
                            ? 'border border-[#a0bd58] text-[#c8f169]'
                            : 'border border-[#3b4a3f] text-[#5f6f62]'
                      }`}
                    >
                      {done ? (
                        <Check size={11} />
                      ) : active ? (
                        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
                      ) : (
                        <span className="font-mono text-[9px]">{index + 1}</span>
                      )}
                    </div>
                    <span
                      className={`font-mono text-[10px] ${done || active ? 'text-[#c8d8c3]' : 'text-[#637169]'}`}
                    >
                      {label}
                    </span>
                    {timing && (
                      <span className="ml-auto font-mono text-[9px] uppercase text-[#9ebd5a]">
                        {duration(timing.elapsedMs)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {result && (
              <div
                data-testid="verdict-summary"
                className={`mt-6 rounded-xl border p-5 ${
                  certified
                    ? 'border-[#64883b]/50 bg-[#17241a]'
                    : 'border-[#8e4844]/50 bg-[#241a1a]'
                }`}
              >
                <div className="mb-4 flex items-center gap-2">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full ${
                      certified ? 'bg-[#c8f169] text-[#142014]' : 'bg-[#ed7770] text-[#2a1312]'
                    }`}
                  >
                    {certified ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}
                  </div>
                  <div>
                    <div className="text-[13px] font-extrabold text-[#e6efe1]">
                      {certified ? 'Certified' : 'Statistically insignificant'}
                    </div>
                    <div className="font-mono text-[9px] text-[#8a978c]">
                      digest {shortHash(result.digest, 12, 8)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-[#26312c] sm:grid-cols-4">
                  {[
                    { label: 'DSR', value: probability(result.dsr), need: '≥ 0.95' },
                    { label: 'PBO', value: probability(result.pbo), need: '≤ 0.10' },
                    { label: 'Sharpe (ann.)', value: ratio(result.sharpeAnnualised), need: 'observed' },
                    { label: 'Trials', value: integer(result.trials), need: 'N' },
                  ].map((cell) => (
                    <div key={cell.label} className="bg-[#101a15] p-3">
                      <div className="font-mono text-[9px] uppercase tracking-[.1em] text-[#6f7d73]">
                        {cell.label}
                      </div>
                      <div className="mt-1 font-mono text-[15px] text-[#e6ebd9]">{cell.value}</div>
                      <div className="mt-0.5 font-mono text-[8px] text-[#5f6d64]">{cell.need}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 space-y-1.5">
                  {result.gates.map((gate) => (
                    <div
                      key={gate.gate}
                      className="flex items-center gap-2 font-mono text-[10px] text-[#8a978c]"
                    >
                      {gate.passed ? (
                        <Check size={12} className="text-[#c8f169]" />
                      ) : (
                        <X size={12} className="text-[#ed7770]" />
                      )}
                      <span className="flex-1">{gate.gate.replaceAll('_', ' ')}</span>
                      <span className={gate.passed ? 'text-[#c8d8c3]' : 'text-[#f0a49f]'}>
                        {ratio(gate.observed, 4)} {gate.comparison === 'gte' ? '≥' : '≤'}{' '}
                        {gate.required}
                      </span>
                    </div>
                  ))}
                </div>

                {result.warnings && result.warnings.length > 0 && (
                  <div
                    data-testid="plausibility-warnings"
                    className="mt-4 space-y-1.5 rounded-lg border border-[#946b37]/40 bg-[#241d13] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wide text-[#e0b478]">
                      <CircleAlert size={12} className="shrink-0" />
                      Accepted with cautions — the numbers are unusual, not invalid
                    </div>
                    {result.warnings.map((w) => (
                      <div key={w.code} className="font-mono text-[10px] leading-5 text-[#c9ad82]">
                        · {w.message}
                      </div>
                    ))}
                  </div>
                )}

                {!certified && result.minimumTrackRecordLength != null && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#946b37]/40 bg-[#241d13] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#e0b478]">
                    <Clock3 size={13} className="mt-0.5 shrink-0" />
                    <span>
                      This edge would need {integer(result.minimumTrackRecordLength)} observations to
                      reach significance — not more tuning.
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col-reverse justify-between gap-3 border-t border-[#28352f] bg-[#0d1511] p-5 sm:flex-row sm:items-center sm:px-8">
        <span className="font-mono text-[9px] text-[#617166]">
          {finished ? 'the verdict is recorded' : 'closing keeps the run active'}
        </span>
        <div className="flex gap-2">
          <GhostButton onClick={onClose} testId="button-close-verification">
            Close
          </GhostButton>
          {finished && run && (
            <PrimaryButton
              testId="button-open-agent-from-run"
              onClick={() => onOpenAgent(run.agentId)}
            >
              <Zap size={13} />
              Open agent
            </PrimaryButton>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
