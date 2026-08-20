import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CircleAlert, FileUp, Sparkles, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import {
  useGenerateSampleEvidence,
  useStartVerification,
  type Agent,
  type Run,
  type SampleEvidenceKind,
} from '@workspace/api-client-react';

import { Field, GhostButton, ModalShell, PrimaryButton, inputClass } from './primitives';

interface Loaded {
  returnsCsv: string;
  trialsCsv: string;
  selectedColumn?: string;
  source: string;
  observations: number;
  trials: number;
}

function describeCsv(text: string): { rows: number; columns: number } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return { rows: Math.max(0, lines.length - 1), columns: (lines[0]?.split(',').length ?? 1) };
}

export function SubmitEvidenceModal({
  agent,
  agents,
  onClose,
  onStarted,
}: {
  agent?: Agent;
  agents: Agent[];
  onClose: () => void;
  onStarted: (run: Run) => void;
}) {
  const queryClient = useQueryClient();

  // Derived, not seeded. The agents query often resolves after this modal mounts
  // — registering an agent opens it immediately — and a useState initialiser
  // would freeze an empty id while the select happily displayed the first option.
  // That mismatch is silent: the button looks enabled and does nothing.
  const [chosenId, setChosenId] = useState<string>();
  const agentId = chosenId ?? agent?.id ?? agents[0]?.id ?? '';
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();

  const returnsInput = useRef<HTMLInputElement>(null);
  const trialsInput = useRef<HTMLInputElement>(null);
  const [returnsFile, setReturnsFile] = useState<string>();
  const [trialsFile, setTrialsFile] = useState<string>();

  const sample = useGenerateSampleEvidence({
    mutation: {
      onSuccess: (evidence) => {
        setError(undefined);
        setLoaded({
          returnsCsv: evidence.returnsCsv,
          trialsCsv: evidence.trialsCsv,
          selectedColumn: evidence.selectedColumn,
          source:
            evidence.kind === 'overfit'
              ? `synthetic · ${evidence.trials} pure-noise configurations, best one selected`
              : `synthetic · ${evidence.trials} configurations, one with a persistent edge`,
          observations: evidence.observations,
          trials: evidence.trials,
        });
      },
    },
  });

  const startVerification = useStartVerification({
    mutation: {
      onSuccess: (run) => {
        void queryClient.invalidateQueries();
        onStarted(run);
      },
      onError: (mutationError) => {
        const data = (mutationError as { data?: { error?: string } }).data;
        setError(data?.error ?? 'The evidence bundle was rejected.');
      },
    },
  });

  const loadSample = (kind: SampleEvidenceKind) => {
    setReturnsFile(undefined);
    setTrialsFile(undefined);
    // Observations are left to the server, which picks a length appropriate to the
    // kind. Pinning 756 here is what made "Load genuine sample" produce an agent
    // the contract then refused.
    sample.mutate({ data: { kind, trials: 60, seed: 20260820 } });
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>, slot: 'returns' | 'trials') => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();

    setError(undefined);
    setLoaded((previous) => {
      const next: Loaded = {
        returnsCsv: slot === 'returns' ? text : (previous?.returnsCsv ?? ''),
        trialsCsv: slot === 'trials' ? text : (previous?.trialsCsv ?? ''),
        selectedColumn: undefined,
        source: 'uploaded files',
        observations: 0,
        trials: 0,
      };
      const returnsShape = describeCsv(next.returnsCsv);
      const trialsShape = describeCsv(next.trialsCsv);
      next.observations = returnsShape.rows;
      next.trials = Math.max(0, trialsShape.columns - 1);
      return next;
    });

    if (slot === 'returns') setReturnsFile(file.name);
    else setTrialsFile(file.name);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!agentId || !loaded?.returnsCsv || !loaded?.trialsCsv) return;
    setError(undefined);
    startVerification.mutate({
      agentId,
      data: {
        returnsCsv: loaded.returnsCsv,
        trialsCsv: loaded.trialsCsv,
        selectedColumn: loaded.selectedColumn,
      },
    });
  };

  const ready = Boolean(agentId && loaded?.returnsCsv && loaded?.trialsCsv);

  return (
    <ModalShell onClose={onClose} testId="dialog-submit-evidence" width="max-w-[640px]">
      <form onSubmit={submit}>
        <div className="flex items-start justify-between border-b border-[#263031] p-5 sm:p-6">
          <div>
            <h2 className="text-[18px] font-extrabold tracking-[-.03em] text-[#e8f0e5]">
              Submit evidence
            </h2>
            <p className="mt-1 font-mono text-[10px] text-[#758278]">
              returns.csv + trials.csv · the full parameter search space is mandatory
            </p>
          </div>
          <button
            type="button"
            data-testid="button-close-submit"
            onClick={onClose}
            className="rounded-lg p-2 text-[#79867c] hover:bg-[#1a2426] hover:text-[#dce7d6]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <Field label="Agent">
            <select
              data-testid="select-agent"
              value={agentId}
              onChange={(event) => setChosenId(event.target.value)}
              className={inputClass}
            >
              {agents.length === 0 && <option value="">No agents registered yet</option>}
              {agents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.family}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[.14em] text-[#7d8b80]">
              Evidence bundle
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                data-testid="button-upload-returns"
                onClick={() => returnsInput.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-dashed border-[#334040] bg-[#101a1b] px-3 py-3 text-left text-[11px] text-[#9aa99b] hover:border-[#607145] hover:text-[#c8f169]"
              >
                <FileUp size={15} />
                <span className="min-w-0 truncate">{returnsFile ?? 'returns.csv'}</span>
              </button>
              <button
                type="button"
                data-testid="button-upload-trials"
                onClick={() => trialsInput.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-dashed border-[#334040] bg-[#101a1b] px-3 py-3 text-left text-[11px] text-[#9aa99b] hover:border-[#607145] hover:text-[#c8f169]"
              >
                <FileUp size={15} />
                <span className="min-w-0 truncate">{trialsFile ?? 'trials.csv'}</span>
              </button>
            </div>
            <input
              ref={returnsInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void readFile(event, 'returns')}
            />
            <input
              ref={trialsInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void readFile(event, 'trials')}
            />
          </div>

          <div className="rounded-lg border border-[#252f2d] bg-[#111a17] p-4">
            <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-[#a7c866]">
              <Sparkles size={13} />
              No bundle to hand?
            </div>
            <p className="mb-3 text-[10px] leading-5 text-[#77857a]">
              Generate a reproducible one. The overfit sample is the case this protocol exists to
              catch: sixty configurations of pure noise with the luckiest one submitted as a
              strategy.
            </p>
            <div className="flex flex-wrap gap-2">
              <GhostButton
                testId="button-sample-overfit"
                onClick={() => loadSample('overfit')}
                disabled={sample.isPending}
              >
                Load overfit sample
              </GhostButton>
              <GhostButton
                testId="button-sample-genuine"
                onClick={() => loadSample('genuine')}
                disabled={sample.isPending}
              >
                Load genuine sample
              </GhostButton>
            </div>
          </div>

          {loaded && (
            <div
              data-testid="text-bundle-summary"
              className="rounded-lg border border-[#2b3831] bg-[#0c1311] px-3 py-3 font-mono text-[10px] leading-6 text-[#8fa38d]"
            >
              <div>
                <span className="text-[#91bd59]">bundle</span> · {loaded.source}
              </div>
              <div>
                <span className="text-[#91bd59]">shape</span> · {loaded.observations.toLocaleString()}{' '}
                observations × {loaded.trials.toLocaleString()} configurations
              </div>
              {loaded.selectedColumn && (
                <div>
                  <span className="text-[#91bd59]">selected</span> · {loaded.selectedColumn}
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              data-testid="text-submit-error"
              className="flex gap-2 rounded-lg border border-[#8e4844]/50 bg-[#34201f] px-3 py-2.5 text-[11px] leading-5 text-[#f0a49f]"
            >
              <CircleAlert size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#263031] bg-[#0e1517] p-5">
          <GhostButton onClick={onClose} testId="button-cancel-submit">
            Cancel
          </GhostButton>
          <PrimaryButton
            type="submit"
            testId="button-start-verification"
            disabled={!ready || startVerification.isPending}
          >
            {startVerification.isPending ? 'Submitting…' : 'Run verification'}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}
