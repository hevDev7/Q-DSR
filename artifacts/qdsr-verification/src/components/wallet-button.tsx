import { AlertTriangle, LogOut, Wallet as WalletIcon } from 'lucide-react';

import { useGetChainConfig } from '@workspace/api-client-react';

import { shortHash } from '../lib/format';
import { useWallet } from '../lib/wallet';

/**
 * The wallet control in the header.
 *
 * Always present, because connecting a wallet is something a visitor decides to
 * do — not something the app should only offer once they have navigated to an
 * agent that happens to be mintable.
 *
 * It also states the network mismatch here rather than deep inside a mint dialog,
 * since being on the wrong chain invalidates every on-chain reading on the page,
 * not just the mint button.
 */
export function WalletButton() {
  const wallet = useWallet();
  const { data: chain } = useGetChainConfig();

  const expectedChainId = chain?.chainId;
  const onWrongNetwork =
    wallet.address !== undefined &&
    expectedChainId !== undefined &&
    wallet.chainId !== expectedChainId;

  if (wallet.status === 'unsupported') {
    return (
      <span
        data-testid="text-wallet-unsupported"
        title="Install MetaMask, Rabby or another EIP-1193 wallet to mint an Agentic ID"
        className="hidden items-center gap-2 rounded-md border border-[#273131] px-2.5 py-2 font-mono text-[10px] text-[#6d786f] sm:flex"
      >
        <WalletIcon size={13} />
        no wallet
      </span>
    );
  }

  if (!wallet.address) {
    return (
      <button
        data-testid="button-header-connect"
        onClick={() => void wallet.connect()}
        disabled={wallet.status === 'connecting'}
        className="flex items-center gap-2 rounded-md border border-[#607145] bg-[#162018] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#c8f169] transition hover:bg-[#1d2b1e] disabled:opacity-50"
      >
        <WalletIcon size={13} />
        {wallet.status === 'connecting' ? 'connecting…' : 'connect wallet'}
      </button>
    );
  }

  if (onWrongNetwork) {
    return (
      <button
        data-testid="button-header-switch"
        onClick={() =>
          void wallet.switchTo({
            chainId: expectedChainId,
            name: chain?.networkName ?? `chain ${expectedChainId}`,
            rpcUrl: chain?.rpcUrl,
            explorerBaseUrl: chain?.explorerBaseUrl,
          })
        }
        title={`Connected to chain ${wallet.chainId}, this deployment uses ${expectedChainId}`}
        className="flex items-center gap-2 rounded-md border border-[#946b37] bg-[#241d13] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#f3b761] transition hover:bg-[#2e2517]"
      >
        <AlertTriangle size={13} />
        switch to {chain?.networkName ?? expectedChainId}
      </button>
    );
  }

  return (
    <span
      data-testid="text-wallet-connected"
      className="flex items-center gap-2 rounded-md border border-[#2c3b30] bg-[#141e18] px-2.5 py-2 font-mono text-[10px] text-[#a8bda2]"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#c8f169]" />
      {shortHash(wallet.address, 6, 4)}
      {wallet.chainId && (
        <span className="hidden text-[#6b7a6e] md:inline">· chain {wallet.chainId}</span>
      )}
    </span>
  );
}
