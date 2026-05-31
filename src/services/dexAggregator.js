import { ethers } from 'ethers';

// ─── CHAINS ────────────────────────────────────────────────────────────────────

export const CHAINS = {
  arbitrum: {
    id: 42161,
    name: 'Arbitrum One',
    shortName: 'ARB',
    rpcUrl: process.env.REACT_APP_ALCHEMY_KEY
      ? 'https://arb-mainnet.g.alchemy.com/v2/' + process.env.REACT_APP_ALCHEMY_KEY
      : 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    color: '#12AAFF',
    dexes: ['Uniswap V3', 'SushiSwap', 'Camelot'],
  },
  base: {
    id: 8453,
    name: 'Base',
    shortName: 'BASE',
    rpcUrl: process.env.REACT_APP_ALCHEMY_KEY
      ? 'https://base-mainnet.g.alchemy.com/v2/' + process.env.REACT_APP_ALCHEMY_KEY
      : 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    color: '#0052FF',
    dexes: ['Uniswap V3', 'Aerodrome', 'BaseSwap'],
  },
  solana: {
    id: 'solana',
    name: 'Solana',
    shortName: 'SOL',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorer: 'https://solscan.io',
    nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
    color: '#9945FF',
    dexes: ['Jupiter', 'Orca', 'Raydium'],
  },
};

// ─── TOKENS ────────────────────────────────────────────────────────────────────

export const TOKENS = {
  arbitrum: {
    ETH:  { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, coingeckoId: 'ethereum' },
    WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, coingeckoId: 'weth' },
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6,  coingeckoId: 'usd-coin' },
    USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6,  coingeckoId: 'tether' },
    WBTC: { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8,  coingeckoId: 'wrapped-bitcoin' },
    ARB:  { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18, coingeckoId: 'arbitrum' },
  },
  base: {
    ETH:   { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, coingeckoId: 'ethereum' },
    WETH:  { address: '0x4200000000000000000000000000000000000006', decimals: 18, coingeckoId: 'weth' },
    USDC:  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6,  coingeckoId: 'usd-coin' },
    cbBTC: { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8,  coingeckoId: 'coinbase-wrapped-btc' },
    AERO:  { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18, coingeckoId: 'aerodrome-finance' },
  },
  solana: {
    SOL:  { address: 'So11111111111111111111111111111111111111112',    decimals: 9, coingeckoId: 'solana' },
    USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, coingeckoId: 'usd-coin' },
    USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  decimals: 6, coingeckoId: 'tether' },
    JUP:  { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',   decimals: 6, coingeckoId: 'jupiter-exchange-solana' },
  },
};

// ─── CONTRACT ADDRESSES ────────────────────────────────────────────────────────

export const UNISWAP_QUOTER_V2 = {
  arbitrum: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  base:     '0x3d4e44Eb1374240CE5F1B136588111393d2A0B7A',
};

export const UNISWAP_UNIVERSAL_ROUTER = {
  arbitrum: '0x5E325eDA8064b456f4781070C0738d849c824258',
  base:     '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
};

export const UNISWAP_FACTORY_V3 = {
  arbitrum: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  base:     '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
};

export const POOL_FEES = [500, 3000, 10000];

// ─── ABIs ──────────────────────────────────────────────────────────────────────

export const QUOTER_V2_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn',             type: 'address' },
          { internalType: 'address', name: 'tokenOut',            type: 'address' },
          { internalType: 'uint256', name: 'amountIn',            type: 'uint256' },
          { internalType: 'uint24',  name: 'fee',                 type: 'uint24'  },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96',   type: 'uint160' },
        ],
        internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountOut',                type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceX96After',        type: 'uint160' },
      { internalType: 'uint32',  name: 'initializedTicksCrossed',  type: 'uint32'  },
      { internalType: 'uint256', name: 'gasEstimate',              type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

export const UNIVERSAL_ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'bytes',   name: 'commands', type: 'bytes'   },
      { internalType: 'bytes[]', name: 'inputs',   type: 'bytes[]' },
      { internalType: 'uint256', name: 'deadline',  type: 'uint256' },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
];

export const ERC20_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount',  type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner',   type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function getChainKey(chainId) {
  return Object.keys(CHAINS).find((k) => CHAINS[k].id === chainId) ?? null;
}

// ─── FUNCTIONS ─────────────────────────────────────────────────────────────────

/**
 * Queries Uniswap V3 QuoterV2 across all fee tiers and returns the best quote.
 *
 * @param {{ chainId: number, tokenIn: string, tokenOut: string, amountIn: ethers.BigNumberish, provider: ethers.Provider }} params
 * @returns {Promise<{ dex: string, fee: number, toAmount: string, gasEstimate: string, priceImpact: string } | null>}
 */
export async function getUniswapQuote({ chainId, tokenIn, tokenOut, amountIn, provider }) {
  try {
    const chainKey = getChainKey(chainId);
    if (!chainKey || !UNISWAP_QUOTER_V2[chainKey]) return null;

    const quoterAddress = UNISWAP_QUOTER_V2[chainKey];
    const quoter = new ethers.Contract(quoterAddress, QUOTER_V2_ABI, provider);
    const amountInBN = ethers.toBigInt(amountIn);

    const feeAttempts = POOL_FEES.map((fee) =>
      quoter.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn: amountInBN,
        fee,
        sqrtPriceLimitX96: 0n,
      })
        .then((result) => ({ fee, result }))
        .catch(() => null)
    );

    const settled = await Promise.allSettled(feeAttempts);

    const successful = settled
      .filter((s) => s.status === 'fulfilled' && s.value !== null)
      .map((s) => s.value);

    if (successful.length === 0) return null;

    // Pick the fee tier that gives the most output tokens
    successful.sort((a, b) =>
      b.result.amountOut > a.result.amountOut ? 1 : -1
    );

    const best = successful[0];
    const { fee, result } = best;
    const { amountOut, gasEstimate } = result;

    // Approximate market price from amountIn/amountOut ratio
    const amountInNum  = Number(amountInBN);
    const amountOutNum = Number(amountOut);
    const rawRatio     = amountInNum / amountOutNum;
    // priceImpact relative to 1:1 parity — meaningful only for same-denomination pairs;
    // callers should supply a real market price when available
    const priceImpact  = (((rawRatio - 1) / 1) * 100).toFixed(2) + '%';

    return {
      dex: 'Uniswap V3',
      fee,
      toAmount:    amountOut.toString(),
      gasEstimate: gasEstimate.toString(),
      priceImpact,
    };
  } catch {
    return null;
  }
}

/**
 * Queries Jupiter aggregator for Solana swap quotes.
 *
 * @param {{ inputMint: string, outputMint: string, amount: number | string, slippageBps?: number }} params
 * @returns {Promise<{ dex: string, toAmount: string, priceImpact: string, slippage: number } | null>}
 */
export async function getJupiterQuote({ inputMint, outputMint, amount, slippageBps = 50 }) {
  try {
    const url = new URL('https://quote-api.jup.ag/v6/quote');
    url.searchParams.set('inputMint',   inputMint);
    url.searchParams.set('outputMint',  outputMint);
    url.searchParams.set('amount',      String(amount));
    url.searchParams.set('slippageBps', String(slippageBps));

    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json();
    if (!data || !data.outAmount) return null;

    const bestRoute = data.routePlan?.[0];
    const dexLabel  = bestRoute?.swapInfo?.label ?? 'Jupiter';

    const priceImpactPct = data.priceImpactPct != null
      ? (parseFloat(data.priceImpactPct) * 100).toFixed(2) + '%'
      : 'N/A';

    return {
      dex:         dexLabel,
      toAmount:    data.outAmount.toString(),
      priceImpact: priceImpactPct,
      slippage:    slippageBps,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches USD prices and 24h stats from CoinGecko for a list of coin IDs.
 *
 * @param {string[]} coinIds
 * @returns {Promise<Record<string, { usd: number, usd_24h_change: number, usd_24h_vol: number }> | null>}
 */
export async function fetchPrices(coinIds) {
  try {
    if (!coinIds || coinIds.length === 0) return null;

    const url = new URL('https://api.coingecko.com/api/v3/simple/price');
    url.searchParams.set('ids',                  coinIds.join(','));
    url.searchParams.set('vs_currencies',         'usd');
    url.searchParams.set('include_24hr_change',   'true');
    url.searchParams.set('include_24hr_vol',      'true');

    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Finds the best DEX quote for a swap across all available aggregators for the given chain.
 *
 * @param {{
 *   chain: string,
 *   fromTokenAddress: string,
 *   toTokenAddress: string,
 *   amountIn: string | number,
 *   provider?: ethers.Provider,
 *   walletAddress?: string
 * }} params
 * @returns {Promise<{ best: object, all: object[] } | null>}
 */
export async function findBestDex({
  chain,
  fromTokenAddress,
  toTokenAddress,
  amountIn,
  provider,
  walletAddress,
}) {
  try {
    const quotes = [];

    if (chain === 'solana') {
      const jupiterQuote = await getJupiterQuote({
        inputMint:   fromTokenAddress,
        outputMint:  toTokenAddress,
        amount:      amountIn,
      });
      if (jupiterQuote) quotes.push(jupiterQuote);
    } else {
      const chainConfig = CHAINS[chain];
      if (!chainConfig || !provider) return null;

      const uniswapQuote = await getUniswapQuote({
        chainId:  chainConfig.id,
        tokenIn:  fromTokenAddress,
        tokenOut: toTokenAddress,
        amountIn,
        provider,
      });
      if (uniswapQuote) quotes.push(uniswapQuote);
    }

    if (quotes.length === 0) return null;

    // Sort descending by toAmount — largest output is the best deal
    quotes.sort((a, b) => {
      const aBig = BigInt(a.toAmount);
      const bBig = BigInt(b.toAmount);
      return bBig > aBig ? 1 : bBig < aBig ? -1 : 0;
    });

    return {
      best: quotes[0],
      all:  quotes,
    };
  } catch {
    return null;
  }
}
