/**
 * Database abstraction layer.
 *
 * When SUPABASE_URL + SUPABASE_SERVICE_KEY are set (production / Railway),
 * all reads and writes go to Supabase PostgreSQL.
 *
 * Without those vars (local development), falls back to the original
 * JSON file approach so nothing breaks when running locally.
 */

import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

// ── Supabase client (null when env vars are missing) ─────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

if (supabase) {
  console.log('DB: connected to Supabase');
} else {
  console.log('DB: Supabase not configured — using local JSON files');
}

// ── Local JSON file helpers (dev fallback) ───────────────────────────────────

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile(filename, fallback) {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, filename), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filename, data) {
  await ensureDataDir();
  await writeFile(join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
// All state is stored in a single `bot_state` table:
//   key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ

async function sbRead(key, fallback) {
  const { data, error } = await supabase
    .from('bot_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) { console.error('sbRead error:', error.message); return fallback; }
  return data?.value ?? fallback;
}

async function sbWrite(key, value) {
  const { error } = await supabase
    .from('bot_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.error('sbWrite error:', error.message);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function readState(key, fallback) {
  if (supabase) return sbRead(key, fallback);
  return readJsonFile(`${key}.json`, fallback);
}

export async function writeState(key, value) {
  if (supabase) return sbWrite(key, value);
  return writeJsonFile(`${key}.json`, value);
}

// Convenience wrappers matching the original file-based interface
export const db = {
  async getJournal()         { return readState('journal',      { signals: [], trades: [] }); },
  async setJournal(j)        { return writeState('journal',     j); },
  async getAlertConfig()     { return readState('alertConfig',  null); },
  async setAlertConfig(c)    { return writeState('alertConfig', c); },
  async getCandles(key)      { return readState(`candles_${key}`, []); },
  async setCandles(key, arr) { return writeState(`candles_${key}`, arr); },
  async getEvents()          { return readState('events',       []); },
  async appendEvent(event) {
    const events = await db.getEvents();
    events.push({ ...event, serverTs: Date.now() });
    return writeState('events', events.slice(-5000));
  },
};
