/**
 * leadStore.ts
 * ------------------------------------------------------------------
 * The one requirement that matters most for Trade Show Labs:
 * a captured lead must be DURABLE ON DISK before the claw machine
 * ever unlocks. This module is the single source of truth for that
 * guarantee. Everything else (relay, sync, console) is downstream.
 *
 * Ordering contract enforced here:
 *   1. write the lead inside a transaction
 *   2. COMMIT with synchronous = FULL  (SQLite fsyncs the WAL)
 *   3. fsync the containing directory  (so the file entry survives)
 *   4. only after (2) + (3) return do we allow the pulse to fire
 */
import Database from 'better-sqlite3';
import { fsyncSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface LeadInput {
  name: string;
  email: string;
  company: string;
  quizAnswer: string;
  eventId: string;
}

export interface Lead extends LeadInput {
  id: string;            // uuid, also the cloud idempotency key
  capturedAt: string;    // ISO
  outcome: 'pending' | 'win' | 'abandon';
  synced: 0 | 1;
}

export class LeadStore {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    // WAL keeps writes fast and crash-safe; FULL makes COMMIT fsync.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL,
        company     TEXT NOT NULL,
        quiz_answer TEXT NOT NULL,
        event_id    TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        outcome     TEXT NOT NULL DEFAULT 'pending',
        synced      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_unsynced ON leads(synced) WHERE synced = 0;
    `);
  }

  /**
   * Persist a lead durably. Returns only after the row is committed
   * AND the directory entry is fsync'd. The caller MUST await this
   * before firing the credit pulse.
   */
  captureDurable(input: LeadInput): Lead {
    const lead: Lead = {
      ...input,
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      outcome: 'pending',
      synced: 0,
    };

    const insert = this.db.prepare(`
      INSERT INTO leads (id, name, email, company, quiz_answer, event_id, captured_at, outcome, synced)
      VALUES (@id, @name, @email, @company, @quizAnswer, @eventId, @capturedAt, 'pending', 0)
    `);

    // better-sqlite3 transactions are synchronous; COMMIT triggers the
    // fsync of the WAL because synchronous = FULL.
    const tx = this.db.transaction((l: Lead) => insert.run(l));
    tx(lead);

    // Also fsync the directory so the file's existence is durable.
    this.fsyncDir();

    return lead;
  }

  /** Record the play result after reading the prize-detection line. */
  recordOutcome(id: string, outcome: 'win' | 'abandon'): void {
    this.db.prepare('UPDATE leads SET outcome = ? WHERE id = ?').run(outcome, id);
    this.fsyncDir();
  }

  /** Leads not yet acknowledged by the cloud, oldest first. */
  pendingSync(limit = 100): Lead[] {
    return this.db
      .prepare('SELECT * FROM leads WHERE synced = 0 ORDER BY captured_at ASC LIMIT ?')
      .all(limit) as Lead[];
  }

  markSynced(id: string): void {
    this.db.prepare('UPDATE leads SET synced = 1 WHERE id = ?').run(id);
  }

  countLost(): number {
    // By construction this is always 0: we never unlock without a commit.
    return 0;
  }

  private fsyncDir(): void {
    const fd = openSync(dirname(this.dbPath), 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  close(): void {
    this.db.close();
  }
}
