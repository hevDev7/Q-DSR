import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from 'ethers';

/**
 * Minimal EIP-1193 wallet binding, shared across the app through context.
 *
 * Context rather than a bare hook because the connection is a property of the
 * session, not of whichever component happens to need it. Two independent hook
 * instances would each hold their own `connecting` flag and could disagree about
 * whether a prompt is already open.
 *
 * Deliberately not wagmi. This app needs one contract call from one wallet; a
 * connector framework would be more surface area than the feature it serves,
 * and ethers is already the workspace's chain library.
 */

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (event: string, handler: (...args: never[]) => void) => void;
      removeListener?: (event: string, handler: (...args: never[]) => void) => void;
    };
  }
}

export type WalletStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected';

export interface NetworkDescriptor {
  chainId: number;
  name: string;
  rpcUrl?: string;
  explorerBaseUrl?: string;
  currencySymbol?: string;
}

export interface Wallet {
  status: WalletStatus;
  address?: string;
  chainId?: number;
  error?: string;
  connect: () => Promise<void>;
  switchTo: (network: NetworkDescriptor) => Promise<void>;
  getSigner: () => Promise<JsonRpcSigner>;
  clearError: () => void;
}

function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

/** Wallets wrap the underlying reason; this digs out something a human can act on. */
export function describeWalletError(error: unknown): string {
  const err = error as { code?: number | string; shortMessage?: string; message?: string };

  // EIP-1193: 4001 is the user declining, which is not a failure worth shouting about.
  if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') return 'Signature rejected in the wallet.';
  if (err?.code === -32002) return 'A wallet request is already pending — check the extension.';

  return err?.shortMessage ?? err?.message ?? 'The wallet rejected the request.';
}

function useWalletState(): Wallet {
  const available = typeof window !== 'undefined' && Boolean(window.ethereum);

  const [status, setStatus] = useState<WalletStatus>(available ? 'disconnected' : 'unsupported');
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<number>();
  const [error, setError] = useState<string>();

  // Pick up an already-authorised account without prompting. eth_accounts is the
  // silent form; eth_requestAccounts is what opens the wallet.
  useEffect(() => {
    if (!available) return;
    let cancelled = false;

    void (async () => {
      try {
        const accounts = (await window.ethereum!.request({ method: 'eth_accounts' })) as string[];
        const chain = (await window.ethereum!.request({ method: 'eth_chainId' })) as string;
        if (cancelled) return;
        setChainId(Number.parseInt(chain, 16));
        if (accounts.length > 0) {
          setAddress(accounts[0]);
          setStatus('connected');
        }
      } catch {
        // A wallet that refuses to answer eth_accounts is simply not connected.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [available]);

  useEffect(() => {
    if (!available || !window.ethereum?.on) return;

    const onAccounts = (...args: never[]): void => {
      const accounts = args[0] as unknown as string[];
      if (!accounts || accounts.length === 0) {
        setAddress(undefined);
        setStatus('disconnected');
      } else {
        setAddress(accounts[0]);
        setStatus('connected');
      }
    };

    const onChain = (...args: never[]): void => {
      setChainId(Number.parseInt(args[0] as unknown as string, 16));
    };

    window.ethereum.on('accountsChanged', onAccounts);
    window.ethereum.on('chainChanged', onChain);
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccounts);
      window.ethereum?.removeListener?.('chainChanged', onChain);
    };
  }, [available]);

  const connect = useCallback(async () => {
    if (!available) return;
    setError(undefined);
    setStatus('connecting');
    try {
      const accounts = (await window.ethereum!.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const chain = (await window.ethereum!.request({ method: 'eth_chainId' })) as string;
      setAddress(accounts[0]);
      setChainId(Number.parseInt(chain, 16));
      setStatus(accounts.length > 0 ? 'connected' : 'disconnected');
    } catch (cause) {
      setError(describeWalletError(cause));
      setStatus('disconnected');
    }
  }, [available]);

  const switchTo = useCallback(async (network: NetworkDescriptor) => {
    if (!available) return;
    setError(undefined);
    try {
      await window.ethereum!.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: toHexChainId(network.chainId) }],
      });
    } catch (cause) {
      // 4902 means the wallet has never heard of this chain, so offer to add it.
      const code = (cause as { code?: number }).code;
      if (code !== 4902) {
        setError(describeWalletError(cause));
        return;
      }
      try {
        await window.ethereum!.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: toHexChainId(network.chainId),
              chainName: network.name,
              rpcUrls: network.rpcUrl ? [network.rpcUrl] : [],
              blockExplorerUrls: network.explorerBaseUrl ? [network.explorerBaseUrl] : [],
              nativeCurrency: {
                name: network.currencySymbol ?? '0G',
                symbol: network.currencySymbol ?? '0G',
                decimals: 18,
              },
            },
          ],
        });
      } catch (addCause) {
        setError(describeWalletError(addCause));
      }
    }
  }, [available]);

  const getSigner = useCallback(async () => {
    if (!available) throw new Error('No wallet available in this browser.');
    const provider = new BrowserProvider(window.ethereum!);
    return provider.getSigner();
  }, [available]);

  const clearError = useCallback(() => setError(undefined), []);

  return useMemo(
    () => ({ status, address, chainId, error, connect, switchTo, getSigner, clearError }),
    [status, address, chainId, error, connect, switchTo, getSigner, clearError],
  );
}

const WalletContext = createContext<Wallet | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletState();
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

/** The connected wallet. Throws outside a WalletProvider rather than silently no-op. */
export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error('useWallet must be used inside a WalletProvider');
  return wallet;
}
