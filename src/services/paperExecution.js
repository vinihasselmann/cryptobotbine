const DEFAULT_PAPER_CONFIG = {
  feePct: 0.10,
  slippagePct: 0.03,
  latencyMs: 450,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executePaperOrder({
  side,
  price,
  amountUsd = null,
  qty = null,
  config = {},
}) {
  const paper = { ...DEFAULT_PAPER_CONFIG, ...config };
  const slip = paper.slippagePct / 100;
  const feeRate = paper.feePct / 100;
  const fillPrice = side === 'buy'
    ? price * (1 + slip)
    : price * (1 - slip);

  await wait(paper.latencyMs);

  if (side === 'buy') {
    const grossUsd = amountUsd ?? qty * fillPrice;
    const feeUsd = grossUsd * feeRate;
    const netUsd = grossUsd - feeUsd;
    return {
      side,
      requestedPrice: price,
      fillPrice,
      feeUsd,
      grossUsd,
      netUsd,
      qty: netUsd / fillPrice,
      latencyMs: paper.latencyMs,
      slippagePct: paper.slippagePct,
      feePct: paper.feePct,
    };
  }

  const grossUsd = (qty ?? amountUsd / fillPrice) * fillPrice;
  const feeUsd = grossUsd * feeRate;
  return {
    side,
    requestedPrice: price,
    fillPrice,
    feeUsd,
    grossUsd,
    netUsd: grossUsd - feeUsd,
    qty: qty ?? amountUsd / fillPrice,
    latencyMs: paper.latencyMs,
    slippagePct: paper.slippagePct,
    feePct: paper.feePct,
  };
}

export { DEFAULT_PAPER_CONFIG };
