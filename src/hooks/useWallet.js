import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CHAINS } from '../services/dexAggregator';

// ─── INITIAL STATE ─────────────────────────────────────────────────────────────

const INITIAL_WALLET = {
  connected:    false,
  address:      null,
  shortAddress: null,
  chainId:      null,
  chainName:    null,
  provider:     null,
  signer:       null,
  balances:     {},
  error:        null,
};

function toShortAddress(address) {
  return address.slice(0, 6) + '...' + address.slice(-4);
}

// ─── HOOK ──────────────────────────────────────────────────────────────────────

export function useWallet() {
  const [wallet,     setWallet]     = useState(INITIAL_WALLET);
  const [connecting, setConnecting] = useState(false);

  // ── detectChain ─────────────────────────────────────────────────────────────

  const detectChain = useCallback((chainId) => {
    const id = Number(chainId);
    return Object.entries(CHAINS).find(([, c]) => c.id === id)?.[0] ?? null;
  }, []);

  // ── updateBalances ───────────────────────────────────────────────────────────

  const updateBalances = useCallback(async (provider, address) => {
    try {
      const raw = await provider.getBalance(address);
      const eth = parseFloat(ethers.formatEther(raw)).toFixed(4);
      setWallet((prev) => ({ ...prev, balances: { ETH: eth } }));
    } catch {
      // silent
    }
  }, []);

  // ── connect ──────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setWallet((prev) => ({ ...prev, error: 'MetaMask não encontrado.' }));
      return false;
    }

    setConnecting(true);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);

      if (!accounts || accounts.length === 0) {
        throw new Error('Nenhuma conta autorizada.');
      }

      const address     = accounts[0];
      const network     = await provider.getNetwork();
      const chainId     = Number(network.chainId);
      const chainName   = detectChain(chainId);
      const signer      = await provider.getSigner();

      setWallet({
        connected:    true,
        address,
        shortAddress: toShortAddress(address),
        chainId,
        chainName,
        provider,
        signer,
        balances:     {},
        error:        null,
      });

      await updateBalances(provider, address);
      return true;
    } catch (e) {
      setWallet((prev) => ({ ...prev, error: e.message }));
      return false;
    } finally {
      setConnecting(false);
    }
  }, [detectChain, updateBalances]);

  // ── disconnect ───────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    setWallet(INITIAL_WALLET);
  }, []);

  // ── switchChain ──────────────────────────────────────────────────────────────

  const switchChain = useCallback(async (chainKey) => {
    if (!window.ethereum) return;

    const chain = CHAINS[chainKey];
    if (!chain || chain.id === 'solana') return;

    const chainIdHex = '0x' + chain.id.toString(16);

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
    } catch (error) {
      if (error.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId:           chainIdHex,
                chainName:         chain.name,
                nativeCurrency:    chain.nativeCurrency,
                rpcUrls:           [chain.rpcUrl],
                blockExplorerUrls: [chain.explorer],
              },
            ],
          });
        } catch {
          // silent — user rejected add-chain request
        }
      }
    }
  }, []);

  // ── MetaMask event listeners + auto-reconnect ────────────────────────────────

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnect();
      } else {
        const address = accounts[0];
        setWallet((prev) => ({
          ...prev,
          address,
          shortAddress: toShortAddress(address),
        }));
      }
    };

    const handleChainChanged = (rawChainId) => {
      const chainId   = parseInt(rawChainId, 16);
      const chainName = detectChain(chainId);
      setWallet((prev) => ({ ...prev, chainId, chainName }));
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged',    handleChainChanged);

    // Auto-reconnect if the user was previously connected
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (accounts && accounts.length > 0) connect();
      })
      .catch(() => {});

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged',    handleChainChanged);
    };
  }, [connect, disconnect, detectChain]);

  // ── public API ───────────────────────────────────────────────────────────────

  return { wallet, connecting, connect, disconnect, switchChain };
}
