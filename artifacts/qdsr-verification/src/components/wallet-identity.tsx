import { AlertTriangle, Wallet as WalletIcon } from 'lucide-react';

import { useGetChainConfig } from '@workspace/api-client-react';

import { shortHash } from '../lib/format';
import { useWallet } from '../lib/wallet';

/**
 * The identity slot at the foot of the sidebar.
 *
 * This corner answers "who am I", so it shows the visitor's wallet. The attestor
 * — the server key that records verdicts — lives on the audit trail and in the
 * protocol guide, where it reads as deployment configuration rather than as an
 * account the visitor controls.
 */
export function WalletIdentity() {
  const wallet = useWallet();
  const { data: chain } = useGetChainConfig();

  const expectedChainId = chain?.chainId;
  const onWrongNetwork =
    wallet.address !== undefined &&
    expectedChainId !== undefined &&
    wallet.chainId !== expectedChainId;

  const shell =
    'mt-4 flex w-full items-center gap-3 border-t border-[#20292a] px-2 pt-4 text-left';

  if (wallet.status === 'unsupported') {
    return (
      <div data-testid="identity-no-wallet" className={shell}>
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[#333f36] text-[#5f6d63]">
          <WalletIcon size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold text-[#8b968c]">No wallet</div>
          <div className="truncate font-mono text-[9px] text-[#647069]">
            install MetaMask or Rabby
          </div>
        </div>
      </div>
    );
  }

  if (!wallet.address) {
    return (
      <button
        type="button"
        data-testid="identity-connect"
        onClick={() => void wallet.connect()}
        disabled={wallet.status === 'connecting'}
        className={`${shell} rounded-lg transition hover:bg-[#141d1f] disabled:opacity-60`}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[#4a5a4c] text-[#8fa46f]">
          <WalletIcon size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold text-[#c8d8c3]">
            {wallet.status === 'connecting' ? 'Connecting…' : 'Not connected'}
          </div>
          <div className="truncate font-mono text-[9px] text-[#647069]">
            connect a wallet to mint
          </div>
        </div>
      </button>
    );
  }

  if (onWrongNetwork) {
    return (
      <button
        type="button"
        data-testid="identity-wrong-network"
        onClick={() =>
          void wallet.switchTo({
            chainId: expectedChainId,
            name: chain?.networkName ?? `chain ${expectedChainId}`,
            rpcUrl: chain?.rpcUrl,
            explorerBaseUrl: chain?.explorerBaseUrl,
          })
        }
        className={`${shell} rounded-lg transition hover:bg-[#1d1710]`}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#372b1c] text-[#f3b761]">
          <AlertTriangle size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10px] text-[#dbe4d7]">
            {shortHash(wallet.address, 6, 4)}
          </div>
          <div className="truncate font-mono text-[9px] text-[#e0b478]">
            wrong network · switch
          </div>
        </div>
      </button>
    );
  }

  return (
    <div data-testid="identity-connected" className={shell}>
      <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-[#20301f] font-mono text-[9px] uppercase text-[#c8f169]">
        {wallet.address.slice(2, 4)}
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-[#0b1013] bg-[#c8f169]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[10px] text-[#dbe4d7]">
          {shortHash(wallet.address, 6, 4)}
        </div>
        <div className="truncate font-mono text-[9px] text-[#647069]">
          {chain?.configured ? chain.networkName : `chain ${wallet.chainId ?? '—'}`}
        </div>
      </div>
    </div>
  );
}
