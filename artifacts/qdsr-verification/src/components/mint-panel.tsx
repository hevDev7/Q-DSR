import { useCallback, useEffect, useState } from 'react';
import { Contract, JsonRpcProvider } from 'ethers';
import {
  BadgeCheck,
  CircleAlert,
  ExternalLink,
  Gavel,
  Loader2,
  ShieldAlert,
  Wallet as WalletIcon,
} from 'lucide-react';

import { AGENTIC_ID_ABI } from '@workspace/og-chain';
import { useGetMintIntent, type MintIntent } from '@workspace/api-client-react';

import { describeWalletError, useWallet } from '../lib/wallet';
import { shortHash } from '../lib/format';
import { GhostButton, PrimaryButton } from './primitives';

/** Non-zero placeholders, so a gate probe is never refused for the wrong reason.
 *  The contract checks a zero recipient and empty metadata before it checks
 *  certification, and hitting those guards would hide the answer we came for. */
const PROBE_RECIPIENT = '0x000000000000000000000000000000000000dEaD';
const PROBE_URI = '0g://storage/probe';
const PROBE_HASH = `0x${'11'.repeat(32)}`;

interface MintedToken {
  tokenId: string;
  owner?: string;
}

interface GateAnswer {
  allowed: boolean;
  detail: string;
}

/** Turns an ethers revert into the contract's own vocabulary. */
function describeRevert(error: unknown): string {
  const revert = (error as { revert?: { name?: string; args?: unknown[] } }).revert;
  if (revert?.name === 'AgentNotCertified') {
    return 'AgentNotCertified — the registry holds no passing verdict for this agent.';
  }
  if (revert?.name === 'AgentAlreadyMinted') {
    return `AgentAlreadyMinted — token #${String(revert.args?.[1] ?? '?')} already exists.`;
  }
  if (revert?.name) return `${revert.name} — the contract refused the call.`;
  return describeWalletError(error);
}

export function MintPanel({ agentId }: { agentId: string }) {
  const wallet = useWallet();
  const { data: intent } = useGetMintIntent(agentId);

  const [minted, setMinted] = useState<MintedToken>();
  const [gate, setGate] = useState<GateAnswer>();
  const [probing, setProbing] = useState(false);
  const [minting, setMinting] = useState(false);
  const [txHash, setTxHash] = useState<string>();
  const [error, setError] = useState<string>();

  const explorer = intent?.explorerBaseUrl;
  const onRightNetwork = intent?.chainId !== undefined && wallet.chainId === intent.chainId;

  /** Read-only view of the chain, so the panel is useful before a wallet exists. */
  const readContract = useCallback((): Contract | undefined => {
    if (!intent?.agenticIdAddress || !intent.rpcUrl) return undefined;
    return new Contract(
      intent.agenticIdAddress,
      AGENTIC_ID_ABI,
      new JsonRpcProvider(intent.rpcUrl, intent.chainId, { staticNetwork: true }),
    );
  }, [intent?.agenticIdAddress, intent?.rpcUrl, intent?.chainId]);

  // Whether a token already exists is a fact about the chain, not about us, so
  // it is read from the chain rather than tracked in our database.
  useEffect(() => {
    const contract = readContract();
    if (!contract || !intent?.agentIdHash) return;
    let cancelled = false;

    void (async () => {
      try {
        const tokenId = (await contract.tokenIdOfAgent!(intent.agentIdHash)) as bigint;
        if (cancelled || tokenId === 0n) return;
        let owner: string | undefined;
        try {
          owner = (await contract.ownerOf!(tokenId)) as string;
        } catch {
          owner = undefined;
        }
        if (!cancelled) setMinted({ tokenId: tokenId.toString(), owner });
      } catch {
        // An unreachable RPC simply means we cannot say; the panel stays quiet.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [readContract, intent?.agentIdHash, txHash]);

  /**
   * Asks the contract what it would do, without spending anything.
   *
   * This is the honest way to show a blocked mint: the refusal comes back in the
   * contract's own words rather than from a disabled button in our UI.
   */
  const probeGate = async (current: MintIntent): Promise<void> => {
    const contract = readContract();
    if (!contract) return;
    setProbing(true);
    setGate(undefined);
    try {
      await contract.mint!.staticCall(
        wallet.address ?? PROBE_RECIPIENT,
        current.agentIdHash,
        current.metadataURI ?? PROBE_URI,
        current.metadataHash ?? PROBE_HASH,
      );
      setGate({ allowed: true, detail: 'The contract would accept this mint.' });
    } catch (cause) {
      setGate({ allowed: false, detail: describeRevert(cause) });
    } finally {
      setProbing(false);
    }
  };

  const mint = async (current: MintIntent): Promise<void> => {
    if (!current.agenticIdAddress || !current.metadataURI || !current.metadataHash) return;
    setError(undefined);
    setMinting(true);
    try {
      const signer = await wallet.getSigner();
      const contract = new Contract(current.agenticIdAddress, AGENTIC_ID_ABI, signer);
      const tx = await contract.mint!(
        await signer.getAddress(),
        current.agentIdHash,
        current.metadataURI,
        current.metadataHash,
      );
      setTxHash(tx.hash);
      await tx.wait();
    } catch (cause) {
      setError(describeRevert(cause));
    } finally {
      setMinting(false);
    }
  };

  if (!intent) return null;

  return (
    <div className="border-t border-[#263031] p-5 sm:p-6" data-testid="panel-mint">
      <h3 className="mb-3 flex items-center gap-2 text-[12px] font-bold text-[#dce7d6]">
        <BadgeCheck size={14} />
        Agentic ID (ERC-7857)
      </h3>

      {/* ---------------------------------------------------------- minted */}
      {minted ? (
        <div
          data-testid="text-minted"
          className="rounded-lg border border-[#64883b]/50 bg-[#17241a] p-4 font-mono text-[10px] leading-6 text-[#c8d8c3]"
        >
          <div className="mb-1 text-[11px] font-bold text-[#dcebd5]">
            Minted — token #{minted.tokenId}
          </div>
          {minted.owner && (
            <div className="flex justify-between gap-3">
              <span className="text-[#8fa38d]">owner</span>
              <span>{shortHash(minted.owner, 10, 6)}</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span className="text-[#8fa38d]">contract</span>
            <span>{shortHash(intent.agenticIdAddress, 10, 6)}</span>
          </div>
          {explorer && intent.agenticIdAddress && (
            <a
              href={`${explorer}/address/${intent.agenticIdAddress}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex items-center gap-1.5 text-[#a4c85e] hover:text-[#d5f27b]"
            >
              view the contract on 0G explorer <ExternalLink size={11} />
            </a>
          )}
        </div>
      ) : (
        <>
          {/* ------------------------------------------------------ blocked */}
          {!intent.ready && (
            <div
              data-testid="text-mint-blocked"
              className="flex gap-2 rounded-lg border border-[#946b37]/40 bg-[#241d13] px-3 py-3 text-[11px] leading-6 text-[#e0b478]"
            >
              <ShieldAlert size={15} className="mt-1 shrink-0" />
              <span>{intent.blockedReason}</span>
            </div>
          )}

          {/* -------------------------------------------------------- ready */}
          {intent.ready && (
            <div className="rounded-lg border border-[#263231] bg-[#0d1416] p-4 font-mono text-[10px] leading-6">
              {[
                ['network', intent.networkName],
                ['contract', shortHash(intent.agenticIdAddress, 10, 6)],
                ['metadata', intent.metadataURI ?? '—'],
                ['metadataHash', shortHash(intent.metadataHash, 12, 8)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-[#77857a]">{label}</span>
                  <span className="truncate text-[#dce7d6]">{value}</span>
                </div>
              ))}
              <p className="mt-3 border-t border-[#1e2726] pt-2 text-[#69786e]">
                You sign and pay for this transaction yourself. The token is minted to your
                wallet — this server never holds your key.
              </p>
            </div>
          )}

          {/* --------------------------------------------------- gate probe */}
          {gate && (
            <div
              data-testid="text-gate-answer"
              className={`mt-3 flex gap-2 rounded-lg border px-3 py-3 font-mono text-[10px] leading-6 ${
                gate.allowed
                  ? 'border-[#64883b]/50 bg-[#17241a] text-[#c8d8c3]'
                  : 'border-[#8e4844]/50 bg-[#34201f] text-[#f0a49f]'
              }`}
            >
              <Gavel size={14} className="mt-1 shrink-0" />
              <span>
                <span className="font-bold">the contract says:</span> {gate.detail}
              </span>
            </div>
          )}

          {txHash && (
            <div className="mt-3 rounded-lg border border-[#367e7d]/50 bg-[#193130] px-3 py-3 font-mono text-[10px] leading-6 text-[#a7d8d4]">
              {minting ? 'waiting for confirmation…' : 'transaction sent'} · {shortHash(txHash, 12, 8)}
              {explorer && (
                <a
                  href={`${explorer}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-[#a4c85e] hover:text-[#d5f27b]"
                >
                  explorer <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}

          {(error || wallet.error) && (
            <div
              data-testid="text-mint-error"
              className="mt-3 flex gap-2 rounded-lg border border-[#8e4844]/50 bg-[#34201f] px-3 py-2.5 text-[11px] leading-5 text-[#f0a49f]"
            >
              <CircleAlert size={15} className="mt-0.5 shrink-0" />
              <span>{error ?? wallet.error}</span>
            </div>
          )}

          {/* ------------------------------------------------------ actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {intent.rpcUrl && intent.agenticIdAddress && (
              <GhostButton
                testId="button-probe-gate"
                onClick={() => void probeGate(intent)}
                disabled={probing}
              >
                <Gavel size={13} />
                {probing ? 'Asking…' : 'Ask the contract'}
              </GhostButton>
            )}

            {intent.ready && wallet.status === 'unsupported' && (
              <span className="font-mono text-[10px] text-[#7d8b80]">
                No browser wallet detected — install MetaMask to mint.
              </span>
            )}

            {intent.ready && wallet.status !== 'unsupported' && !wallet.address && (
              <PrimaryButton
                testId="button-connect-wallet"
                onClick={() => void wallet.connect()}
                disabled={wallet.status === 'connecting'}
              >
                <WalletIcon size={14} />
                {wallet.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
              </PrimaryButton>
            )}

            {intent.ready && wallet.address && !onRightNetwork && (
              <PrimaryButton
                testId="button-switch-network"
                onClick={() =>
                  void wallet.switchTo({
                    chainId: intent.chainId!,
                    name: intent.networkName,
                    rpcUrl: intent.rpcUrl,
                    explorerBaseUrl: intent.explorerBaseUrl,
                  })
                }
              >
                Switch to {intent.networkName}
              </PrimaryButton>
            )}

            {intent.ready && wallet.address && onRightNetwork && (
              <PrimaryButton
                testId="button-mint"
                onClick={() => void mint(intent)}
                disabled={minting}
              >
                {minting ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
                {minting ? 'Minting…' : 'Mint Agentic ID'}
              </PrimaryButton>
            )}

            {wallet.address && (
              <span className="font-mono text-[9px] text-[#657269]">
                {shortHash(wallet.address, 8, 4)}
                {wallet.chainId ? ` · chain ${wallet.chainId}` : ''}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
