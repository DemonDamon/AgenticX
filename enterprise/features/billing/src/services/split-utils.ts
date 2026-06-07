import type { SplitParticipant } from "../types";

export const MICRO_USD_FACTOR = 1_000_000;

export function costUsdToMicro(costUsd: number): bigint {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0n;
  return BigInt(Math.round(costUsd * MICRO_USD_FACTOR));
}

export function microToUsd(micro: bigint): number {
  return Number(micro) / MICRO_USD_FACTOR;
}

export function microToUsdString(micro: bigint): string {
  return micro.toString();
}

export type SplitShare = {
  participant_id: string;
  label?: string;
  amount_micro: bigint;
};

export function splitAmountMicro(totalMicro: bigint, participants: SplitParticipant[]): SplitShare[] {
  if (totalMicro <= 0n || participants.length === 0) return [];

  const active = participants.filter((item) => item.ratio_bps > 0);
  if (active.length === 0) return [];

  const totalBps = active.reduce((sum, item) => sum + item.ratio_bps, 0);
  if (totalBps <= 0) return [];

  const shares: SplitShare[] = [];
  let allocated = 0n;
  for (let index = 0; index < active.length; index += 1) {
    const participant = active[index]!;
    if (index === active.length - 1) {
      shares.push({
        participant_id: participant.participant_id,
        label: participant.label,
        amount_micro: totalMicro - allocated,
      });
      continue;
    }
    const share = (totalMicro * BigInt(participant.ratio_bps)) / BigInt(totalBps);
    allocated += share;
    shares.push({
      participant_id: participant.participant_id,
      label: participant.label,
      amount_micro: share,
    });
  }
  return shares;
}

export function reconcileRowsToCsv(
  rows: Array<{ participant_id: string; participant_label: string | null; amount_micro_usd: string; entry_count: number }>
): string {
  const header = "participant_id,participant_label,amount_usd,entry_count";
  const body = rows.map((row) => {
    const amountUsd = microToUsd(BigInt(row.amount_micro_usd)).toFixed(8);
    const label = row.participant_label ?? "";
    return [row.participant_id, `"${label.replace(/"/g, '""')}"`, amountUsd, String(row.entry_count)].join(",");
  });
  return [header, ...body].join("\n");
}
