import { Fingerprint } from 'lucide-react';

/**
 * Marks an agent that holds a minted Agentic ID.
 *
 * Deliberately cyan rather than the lime used for certification, because the two
 * say different things. Certification is a statistical verdict this protocol
 * issued; an Agentic ID is an on-chain identity the agent's owner then chose to
 * mint with their own wallet. An agent can be certified without ever minting, and
 * one colour for both would lose that.
 *
 * The fingerprint is the protocol's own mark, which is what the identity is.
 */
export function AgenticIdBadge({
  tokenId,
  size = 'sm',
}: {
  tokenId: string;
  size?: 'sm' | 'md';
}) {
  const scale =
    size === 'md' ? 'px-2.5 py-1 text-[10px] gap-1.5' : 'px-1.5 py-0.5 text-[9px] gap-1';

  return (
    <span
      data-testid={`badge-agentic-id-${tokenId}`}
      title={`Agentic ID token #${tokenId} — minted on chain`}
      className={`inline-flex shrink-0 items-center rounded-full border border-[#367e7d]/60 bg-[#16302f] font-mono uppercase tracking-[.08em] text-[#81e6e0] ${scale}`}
    >
      <Fingerprint size={size === 'md' ? 12 : 10} strokeWidth={2.4} />
      ID #{tokenId}
    </span>
  );
}

/** The same signal on an avatar, for scanning a list without reading it. */
export function AgenticIdRing({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative shrink-0">
      {children}
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-[#0f1719] bg-[#6fe0dc]"
      >
        <Fingerprint size={7} strokeWidth={3} className="text-[#0c1a1a]" />
      </span>
    </span>
  );
}
