import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImageUp, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { useCreateAgent, useUploadAgentImage, type Agent } from '@workspace/api-client-react';

import { Field, ModalShell, PrimaryButton, GhostButton, inputClass } from './primitives';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

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
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();

  const fileInput = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<{ file: File; preview: string }>();

  const uploadImage = useUploadAgentImage();

  const pickImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);

    if (!ALLOWED.includes(file.type)) {
      setError(`${file.type || 'that file'} is not an image type this contract can reference.`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Image is ${(file.size / 1024 / 1024).toFixed(2)} MB; the limit is 2 MB.`);
      return;
    }
    setImage({ file, preview: URL.createObjectURL(file) });
  };

  const createAgent = useCreateAgent({
    mutation: {
      onSuccess: async (agent) => {
        // The image is published after the agent exists, because it is stored
        // against that agent. A failed upload must not lose the registration, so
        // it degrades to a warning and the contract falls back to a generated SVG.
        if (image) {
          try {
            const buffer = await image.file.arrayBuffer();
            let binary = '';
            const view = new Uint8Array(buffer);
            for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!);

            await uploadImage.mutateAsync({
              agentId: agent.id,
              data: {
                contentType: image.file.type,
                dataBase64: btoa(binary),
                filename: image.file.name,
              },
            });
          } catch {
            setError('The agent was registered, but its artwork could not be published to 0G Storage.');
          }
        }
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
    createAgent.mutate({
      data: {
        name: name.trim(),
        family: family.trim(),
        owner: owner.trim(),
        description: description.trim() || undefined,
      },
    });
  };

  const busy = createAgent.isPending || uploadImage.isPending;
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

          <Field
            label="Description"
            hint="Optional. Written into the Agentic ID's on-chain metadata, so a wallet shows this rather than a blank field."
          >
            <textarea
              data-testid="input-agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="Market-neutral basis strategy on ETH perpetuals."
              className={`${inputClass} h-auto py-2 leading-5`}
            />
          </Field>

          <Field
            label="Artwork"
            hint="Optional, up to 2 MB. Published to 0G Storage and referenced by the token. Leave it empty and the contract draws a card from the agent's own DSR and PBO."
          >
            <div className="flex items-center gap-3">
              {image ? (
                <img
                  src={image.preview}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-lg border border-[#2c3b30] object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-[#334040] text-[#5f6d63]">
                  <ImageUp size={16} />
                </div>
              )}
              <button
                type="button"
                data-testid="button-pick-image"
                onClick={() => fileInput.current?.click()}
                className="min-w-0 flex-1 truncate rounded-lg border border-dashed border-[#334040] bg-[#101a1b] px-3 py-2.5 text-left text-[11px] text-[#9aa99b] hover:border-[#607145] hover:text-[#c8f169]"
              >
                {image ? image.file.name : 'Choose an image…'}
              </button>
              {image && (
                <button
                  type="button"
                  data-testid="button-clear-image"
                  onClick={() => setImage(undefined)}
                  className="rounded-lg p-2 text-[#79867c] hover:text-[#ed7770]"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={ALLOWED.join(',')}
              className="hidden"
              onChange={pickImage}
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
          <PrimaryButton type="submit" testId="button-submit-register" disabled={!ready || busy}>
            {uploadImage.isPending
              ? 'Publishing artwork…'
              : createAgent.isPending
                ? 'Registering…'
                : 'Register agent'}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}
