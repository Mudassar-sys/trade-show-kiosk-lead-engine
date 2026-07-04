/**
 * relayController.ts
 * ------------------------------------------------------------------
 * Hardware layer for the coin-mechanism interface.
 *
 *   CREDIT_PULSE_OUT  -> one opto-isolated pulse to the machine's coin
 *                        input, which grants exactly one play. The
 *                        machine's native play-till-you-win and prize
 *                        detection are untouched.
 *   PRIZE_DETECT_IN   -> we read this line to log win vs abandoned.
 *
 * A RelayController interface lets ~90% of the app be built and tested
 * against MockRelayController with no physical machine. The real
 * SerialRelayController (serialport / node-hid) is swapped in only for
 * the short coin-pulse characterization step, always with a person
 * physically present per the safety rule.
 */

export interface RelayController {
  /** Fire a single credit pulse. Resolves once the pulse completes. */
  fireCreditPulse(): Promise<void>;
  /** Resolve to true if a prize was detected within the timeout. */
  readPrizeDetect(timeoutMs: number): Promise<boolean>;
  open(): Promise<void>;
  close(): Promise<void>;
}

/** Safety guard shared by every implementation. */
export function assertOperatorPresent(operatorPresent: boolean): void {
  // Never fire pulses into an unattended machine.
  if (!operatorPresent) {
    throw new Error('SAFETY: refusing to fire pulse with no operator present');
  }
}

/**
 * Mock controller used for development and CI. Deterministic timing,
 * no hardware. Same shape as the real driver so calling code never
 * changes between mock and metal.
 */
export class MockRelayController implements RelayController {
  private pulseMs: number;
  constructor(opts: { pulseMs?: number } = {}) {
    this.pulseMs = opts.pulseMs ?? 120;
  }
  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async fireCreditPulse(): Promise<void> {
    // Emulate a single clean HIGH->LOW pulse on CREDIT_PULSE_OUT.
    await delay(this.pulseMs);
  }

  async readPrizeDetect(timeoutMs: number): Promise<boolean> {
    // Emulate the attendee playing; ~42% win rate for the demo.
    await delay(Math.min(timeoutMs, 900));
    return Math.random() < 0.42;
  }
}

/**
 * Real driver sketch. serialport is used for a USB relay board that
 * exposes a serial command set; node-hid is the alternative for HID
 * relay boards. The tuning (pulse width, debounce) is the
 * characterization step we coordinate on the physical unit.
 */
export class SerialRelayController implements RelayController {
  constructor(
    private path: string,
    private opts: { baudRate?: number; pulseMs?: number; operatorPresent: boolean },
  ) {}

  async open(): Promise<void> {
    assertOperatorPresent(this.opts.operatorPresent);
    // const { SerialPort } = await import('serialport');
    // this.port = new SerialPort({ path: this.path, baudRate: this.opts.baudRate ?? 9600 });
  }

  async fireCreditPulse(): Promise<void> {
    assertOperatorPresent(this.opts.operatorPresent);
    // this.port.write(RELAY_ON); await delay(this.opts.pulseMs ?? 120); this.port.write(RELAY_OFF);
  }

  async readPrizeDetect(_timeoutMs: number): Promise<boolean> {
    // Poll / interrupt on PRIZE_DETECT_IN, debounce, resolve on edge.
    return false;
  }

  async close(): Promise<void> {}
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
