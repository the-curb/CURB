import { serviceById } from '../credits/prices.ts';

/** Planning arithmetic only. A budget does not establish that money exists or authorize spending. */
const units = (value: unknown, label: string): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) throw new Error(`${label} must be a non-negative integer string (at most 40 digits)`);
  return BigInt(value);
};
const min = (a: bigint, b: bigint) => a < b ? a : b;
export function allocateProceeds(netAvailableCents: unknown) {
  const net = units(netAvailableCents, 'netAvailableCents');
  const priorityReview = min(net, 4_000_000n);
  const priorityLegal = min(net - priorityReview, 1_500_000n);
  const residual = net - priorityReview - priorityLegal;
  const review = priorityReview + residual * 40n / 100n;
  const legal = priorityLegal + residual * 20n / 100n;
  const infrastructure = residual * 20n / 100n;
  const reserve = net - review - legal - infrastructure;
  return {
    netAvailableCents: net.toString(),
    bucketsCents: { review: review.toString(), legal: legal.toString(), infrastructure: infrastructure.toString(), reserve: reserve.toString() },
    totalCents: (review + legal + infrastructure + reserve).toString(),
    limitation: 'Only separately identified, freely available treasury proceeds belong here. Bonding-curve reserves, locked liquidity, market capitalization, gross trading volume and customer credit funding are excluded. No funds or spending approval are established.',
  };
}

export interface EconomicsInput {
  /** USD micros: 1 USD = 1,000,000. Null means unmeasured, never zero. */
  fixedCostUsdMicros: string | null;
  costPerCallUsdMicros: string | null;
  costPerDeliveryAttemptUsdMicros: string | null;
  callAttempts: string;
  chargedCalls: string;
  deliveryAttempts: string;
  successfulDeliveries: string;
  chargedDeliveries: string;
}
export function serviceEconomics(input: EconomicsInput) {
  if (!input || typeof input !== 'object') throw new Error('serviceEconomics must be an object');
  const callAttempts = units(input.callAttempts, 'callAttempts');
  const calls = units(input.chargedCalls, 'chargedCalls');
  const attempts = units(input.deliveryAttempts, 'deliveryAttempts');
  const delivered = units(input.successfulDeliveries, 'successfulDeliveries');
  const chargedDeliveries = units(input.chargedDeliveries, 'chargedDeliveries');
  if (calls > callAttempts) throw new Error('chargedCalls cannot exceed callAttempts');
  if (delivered > attempts) throw new Error('successfulDeliveries cannot exceed deliveryAttempts');
  if (chargedDeliveries > delivered) throw new Error('chargedDeliveries cannot exceed successfulDeliveries');
  const callPrice = BigInt(serviceById('journal-day')!.cents) * 10_000n;
  const deliveryPrice = BigInt(serviceById('alert-delivery')!.cents) * 10_000n;
  const revenue = calls * callPrice + chargedDeliveries * deliveryPrice;
  const fields = ['fixedCostUsdMicros', 'costPerCallUsdMicros', 'costPerDeliveryAttemptUsdMicros'] as const;
  const costs = fields.map(field => input[field] === null ? null : units(input[field], field));
  const missing = fields.filter((_, i) => costs[i] === null);
  const observed = { callAttempts: callAttempts.toString(), chargedCalls: calls.toString(), deliveryAttempts: attempts.toString(), successfulDeliveries: delivered.toString(), chargedDeliveries: chargedDeliveries.toString(), serviceUsageRevenueUsdMicros: revenue.toString() };
  if (missing.length) return { state: 'UNMEASURED' as const, ...observed, missing, costUsdMicros: null, surplusUsdMicros: null, breakEvenCallsOnly: null };
  const [fixed, perCall, perAttempt] = costs as [bigint, bigint, bigint];
  const cost = fixed + callAttempts * perCall + attempts * perAttempt;
  const marginPerCall = callPrice - perCall;
  return {
    state: 'CALCULATED_FROM_INPUTS' as const, ...observed, missing,
    costUsdMicros: cost.toString(), surplusUsdMicros: (revenue - cost).toString(),
    breakEvenCallsOnly: marginPerCall > 0n ? ((fixed + marginPerCall - 1n) / marginPerCall).toString() : null,
    limitation: 'Input scenario, not observed demand or accounting profit. Include hosting, RPC, store, narration, monitoring, backup and failed attempts in the measured cost scope. No customer top-up or unconfirmed/failed debit is counted as earned service usage. Calls-only break-even assumes every attempted call is billed.',
  };
}
