import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { useCreateAgent, type Agent } from '@workspace/api-client-react';

import { Field, ModalShell, PrimaryButton, GhostButton, inputClass } from './primitives';

export function RegisterAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [family, setFamily] = useState('');
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string>();

  const createAgent = useCreateAgent({
    mutation: {
      onSuccess: (agent) => {
        void queryClient.invalidateQueries();
        onCreated(agent);
      },
      onError: (mutationError) => {
        const data = (mutationError as { data?: { error?: string } }).data;
        setError(data?.error ?? 'Could not register the agent.');
      },
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    createAgent.mutate({ data: { name: name.trim(), family: family.trim(), owner: owner.trim() } });
  };

  const ready = name.trim() && family.trim() && owner.trim();

  return (
    <ModalShell onClose={onClose} testId="dialog-register-agent" width="max-w-[520px]">
      <form onSubmit={submit}>
        <div className="flex items-start justify-between border-b border-[#263031] p-5 sm:p-6">
          <div>
            <h2 className="text-[18px] font-extrabold tracking-[-.03em] text-[#e8f0e5]">
              Register agent
            </h2>
            <p className="mt-1 font-mono text-[10px] text-[#758278]">
              An identity is created now; certification is earned separately.
            </p>
          </div>
          <button
            type="button"
            data-testid="button-close-register"
            onClick={onClose}
            className="rounded-lg p-2 text-[#79867c] hover:bg-[#1a2426] hover:text-[#dce7d6]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <Field label="Agent name">
            <input
              data-testid="input-agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Cinder Delta"
              className={inputClass}
            />
          </Field>
          <Field label="Strategy family">
            <input
              data-testid="input-agent-family"
              value={family}
              onChange={(event) => setFamily(event.target.value)}
              placeholder="Market-neutral / ETH"
              className={inputClass}
            />
          </Field>
          <Field
            label="Owner"
            hint="An 0x address becomes the on-chain identity directly. Any other handle is hashed into a stable key so the agent still has one."
          >
            <input
              data-testid="input-agent-owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="0x… or quants@cinder"
              className={inputClass}
            />
          </Field>

          {error && (
            <div
              data-testid="text-register-error"
              className="rounded-lg border border-[#8e4844]/50 bg-[#34201f] px-3 py-2.5 text-[11px] leading-5 text-[#f0a49f]"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#263031] bg-[#0e1517] p-5">
          <GhostButton onClick={onClose} testId="button-cancel-register">
            Cancel
          </GhostButton>
          <PrimaryButton
            type="submit"
            testId="button-submit-register"
            disabled={!ready || createAgent.isPending}
          >
            {createAgent.isPending ? 'Registering…' : 'Register agent'}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}
