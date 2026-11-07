import 'server-only';

/**
 * Hourly buy-and-burn is not available on Elysium.
 * This returns without writing a burn row. /burns stays empty until a real
 * Elysium burn route exists.
 */
export async function runHourlyBurn(log: (line: string) => void = console.log): Promise<void> {
  log('burn: not available on Elysium — no buy-and-burn route is configured, so no burn row was written');
}
