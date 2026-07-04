# Trade Show Labs Kiosk Lead Engine (MVP demo)

A working proof of the one requirement you said matters most: an attendee lead is written durably to disk before the claw machine ever unlocks, so a Wi-Fi or power drop never loses a lead and no credit pulse ever fires without a saved lead.

**Live demo:** https://trade-show-kiosk-lead-engine.vercel.app  (open it, then hit "Simulate power loss" and "Run 20-person rush")

---

## Why I built this for Trade Show Labs

Your whole promise to Nike, 3M, Capital One and the rest is more leads off the floor. So the expensive failure here is not an ugly screen, it is a dropped lead. That is exactly why your post makes offline-first data integrity the number one requirement, ahead of UI.

So instead of writing "I can do that," our team built it on your locked stack. The live demo lets you watch a lead survive a power cut and a flaky venue network, and shows the credit pulse staying blocked until the lead is committed to disk. The same persist-then-fire logic runs as real TypeScript in this repo, not just in the browser.

The split is simple: you own the spec and the PRD, our dedicated engineer turns it into clean, tested, deployable software on the stack you already chose.

---

## What the live demo shows

- The kiosk capture flow (form plus quiz), then one play unlocked.
- The durability pipeline: write to local SQLite (WAL, synchronous = FULL), fsync, COMMIT, and only then fire the pulse. A visible gate blocks the pulse until commit.
- Simulate power loss at any step: a crash before the gate leaves no lead and no phantom pulse; a crash after the gate recovers the lead from disk. The leads-lost counter stays at 0.
- Offline outbox: toggle the network off, keep capturing, toggle back on and watch the queue drain to the cloud with idempotency keys (no duplicates).
- Cloud console with a live lead table and a real leads.csv export.
- A 20-person rush with random power cuts and network drops. Leads lost: 0. Phantom pulses: 0. Every time.

## Locked stack (yours)

- Kiosk: TypeScript, Electron on Linux / balenaOS
- Local store: better-sqlite3 (WAL, synchronous = FULL)
- Hardware: serialport / node-hid, with a mock controller for about 90 percent of the build
- Cloud API: NestJS + Prisma + PostgreSQL
- Console: React + Vite

## Real code in this repo

- **src/kiosk/leadStore.ts** durable store. WAL, synchronous = FULL, directory fsync. The commit is the gate.
- **src/kiosk/playFlow.ts** the persist-then-fire orchestration. The pulse line is physically after the awaited commit.
- **src/hardware/relayController.ts** RelayController interface, MockRelayController for dev and CI, SerialRelayController sketch, and a safety guard that refuses to pulse an unattended machine.
- **src/__tests__/durability.test.ts** proves the ordering. A pulse only fires when a committed lead exists, a lead survives a crash after commit, and a crash before commit yields no lead and no pulse.

Run it:

    npm install
    npm test        (durability tests)
    npm run typecheck

## Answers to your four questions

1. Electron kiosk that runs offline and syncs later? Yes. Content is pulled from the cloud before the show, all capture is written to a local SQLite store, and an outbox drains to the cloud when the network returns. The live demo runs fully client-side to show the offline behaviour end to end.

2. Software interfaced with hardware over serial/USB/GPIO? Yes. Relay boards, Arduino, and Raspberry Pi over serialport and node-hid, firing discrete pulses and reading input lines for state. That is the same shape as your credit-pulse-out and prize-detection-in.

3. How do you guarantee captured data is never lost before a downstream action fires? The lead is written to local SQLite in WAL mode with synchronous = FULL and the directory is fsync'd, then the credit pulse is gated on that committed write; cloud delivery runs from a separate idempotent outbox with retries, so nothing is lost or duplicated on replay. This is enforced in code and proven by the tests.

4. One example where AI sped you up and how you verified it? We used Claude Code and Cursor to scaffold the modules and generate the hardware mock and test harness quickly, then verified correctness by writing the integration tests in durability.test.ts that assert the persist-then-fire ordering and crash-safety. AI is a tool, not an excuse, so the guarantee is proven by tests rather than trust.

---

Built by the CrewNexa team. You bring the spec, we ship the software.
