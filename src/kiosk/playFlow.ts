/**
 * playFlow.ts
 * ------------------------------------------------------------------
 * Orchestrates a single attendee interaction and enforces the
 * persist-then-fire ordering. This is the function that turns the
 * durability guarantee into behaviour:
 *
 *   capture  ->  DURABLE COMMIT (await)  ->  fire pulse  ->  play  ->  log outcome
 *
 * The pulse line is physically after the awaited commit. There is no
 * code path that fires a pulse before captureDurable() has returned,
 * which is what makes "no lead lost, no phantom pulse" true by
 * construction rather than by luck.
 */
import { LeadStore, LeadInput, Lead } from './leadStore';
import { RelayController } from '../hardware/relayController';

export interface PlayResult {
  lead: Lead;
  outcome: 'win' | 'abandon';
}

export async function runPlay(
  store: LeadStore,
  relay: RelayController,
  input: LeadInput,
): Promise<PlayResult> {
  // 1-3: durable commit. Blocks until the lead is fsync'd to disk.
  const lead = store.captureDurable(input);

  // ---- DURABILITY GATE ----
  // Everything below only runs because the line above returned, which
  // means the lead is already safe. If power dropped above, we never
  // reach here: no pulse, nothing charged, attendee simply retries.

  // 4-5: fire exactly one credit pulse, then the machine runs its
  // native play-till-you-win cycle.
  await relay.fireCreditPulse();

  // 6: read the prize-detection line and reconcile the outcome.
  const win = await relay.readPrizeDetect(15000);
  const outcome: 'win' | 'abandon' = win ? 'win' : 'abandon';
  store.recordOutcome(lead.id, outcome);

  return { lead: { ...lead, outcome }, outcome };
}
