import 'server-only';

/** The block of the proof anchor of the measurement that collapsed the coin, or null if it was not recorded. */
export function proofAnchorSlot(row: { measurements: { outcomeKind: string; proofSlot: number | null; index: number }[] }): number | null {
  const collapsing = [...row.measurements].sort((a, b) => b.index - a.index).find((m) => m.outcomeKind === 'collapse');
  return collapsing?.proofSlot ?? null;
}

/**
 * Daughter launch, curve buys and airdrops are not available on Elysium.
 * Elysium has no published pool to buy against, so a collapse does not invent a daughter coin.
 */
export async function runCollapse(ca: string, log: (line: string) => void = console.log): Promise<void> {
  const message = `collapse ${ca}: daughter coin creation is coming soon — no daughter coin was created`;
  log(message);
  throw new Error(message);
}
