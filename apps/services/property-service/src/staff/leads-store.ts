import {
  DUPLICATE_WINDOW_DAYS,
  type StaffLeadAssignment,
  type StaffLeadDetail,
  type StaffLeadListItem,
  type StaffLeadNote,
  type StaffLeadsRequest,
} from '@cribstop/property-contracts';
import type { Queryable } from '../inquiries/write';

/**
 * Reads and appends for the staff lead desk (#632). Status changes are NOT here: they go through
 * `changeLeadStatus`, which owns the transitions table.
 */

/** A lead is open until it reaches a final status or a bad-lead status. */
const CLOSED_STATUSES_SQL = "('closed', 'lost', 'spam', 'rejected')";

/** Normalized email: trimmed and lower-cased. */
const EMAIL_KEY = (alias: string) => `lower(btrim(${alias}.email))`;
/** Normalized phone: the last ten digits. NULL when the phone holds no digits. */
const PHONE_KEY = (alias: string) =>
  `NULLIF(right(regexp_replace(${alias}.phone, '\\D', '', 'g'), 10), '')`;

/**
 * Another open request on the same listing, within the window, from the same normalized email or
 * phone. `alias` names the lead under test and `o` the other one. The index expressions in
 * migration 048 match these.
 */
const duplicateCondition = (alias: string) => `
  o.id <> ${alias}.id
  AND o.listing_id = ${alias}.listing_id
  AND o.status NOT IN ${CLOSED_STATUSES_SQL}
  AND o.created_at BETWEEN ${alias}.created_at - interval '${DUPLICATE_WINDOW_DAYS} days'
                       AND ${alias}.created_at + interval '${DUPLICATE_WINDOW_DAYS} days'
  AND (${EMAIL_KEY('o')} = ${EMAIL_KEY(alias)}
       OR (${PHONE_KEY(alias)} IS NOT NULL AND ${PHONE_KEY('o')} = ${PHONE_KEY(alias)}))`;

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export function maskPhone(phone: string | null): string | null {
  if (phone === null) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length < 4 ? '***' : `***-***-${digits.slice(-4)}`;
}

const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Cursor {
  createdAt: string;
  id: string;
}

/** The cursor holds the row time at microsecond precision, which a JS `Date` would round. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

/** `null` for a cursor this service did not issue. */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed as unknown[];
    if (typeof createdAt !== 'string' || !CURSOR_TIME.test(createdAt)) return null;
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

interface ListRow {
  id: string;
  created_at: Date;
  created_at_cursor: string;
  kind: StaffLeadListItem['kind'];
  status: StaffLeadListItem['status'];
  name: string;
  email: string;
  phone: string | null;
  verified_account: boolean;
  listing_id: string;
  possible_duplicate: boolean;
}

export interface ListLeadsInput {
  filters: Omit<StaffLeadsRequest, 'limit' | 'cursor'>;
  limit: number;
  cursor: Cursor | null;
}

export async function listLeads(
  pool: Queryable,
  input: ListLeadsInput,
): Promise<{ results: StaffLeadListItem[]; next: Cursor | null }> {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  const { filters } = input;
  if (filters.status !== undefined) add((n) => `i.status = ${n}`, filters.status);
  if (filters.kind !== undefined) add((n) => `i.kind = ${n}`, filters.kind);
  if (filters.listingId !== undefined) add((n) => `i.listing_id = ${n}`, filters.listingId);
  if (filters.createdFrom !== undefined) {
    add((n) => `i.created_at >= ${n}::timestamptz`, filters.createdFrom);
  }
  if (filters.createdTo !== undefined) {
    add((n) => `i.created_at < ${n}::timestamptz`, filters.createdTo);
  }
  if (input.cursor !== null) {
    params.push(input.cursor.createdAt, input.cursor.id);
    where.push(
      `(i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  params.push(input.limit + 1);

  const { rows } = await pool.query<ListRow>(
    `SELECT i.id, i.created_at,
            to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
              AS created_at_cursor,
            i.kind, i.status, i.name, i.email, i.phone, i.verified_account, i.listing_id,
            EXISTS (SELECT 1 FROM listing_inquiries o WHERE ${duplicateCondition('i')})
              AS possible_duplicate
       FROM listing_inquiries i
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT $${params.length}`,
    params,
  );

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    results: page.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      kind: row.kind,
      status: row.status,
      name: row.name,
      emailMasked: maskEmail(row.email),
      phoneMasked: maskPhone(row.phone),
      verifiedAccount: row.verified_account,
      listingId: row.listing_id,
      possibleDuplicate: row.possible_duplicate,
    })),
    next:
      rows.length > input.limit && last !== undefined
        ? { createdAt: last.created_at_cursor, id: last.id }
        : null,
  };
}

interface DetailRow {
  id: string;
  created_at: Date;
  kind: StaffLeadDetail['kind'];
  status: StaffLeadDetail['status'];
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  verified_account: boolean;
  consent_to_contact: boolean;
  consent_text_version: string | null;
  consent_disclosure_text: string | null;
  consent_channels: StaffLeadDetail['consent']['channels'] | null;
  consent_given_at: Date | null;
  listing_id: string;
  listing_title: string;
  listing_address: string;
  listing_price: string | number | null;
  listing_status: string | null;
  possible_duplicate: boolean;
}

const DUPLICATE_IDS_LIMIT = 10;

/**
 * The full lead, or `null` when no lead has this id. Writes the access-audit row BEFORE it reads
 * the history and the notes, and a failed audit insert rejects, so contact data never leaves this
 * function without an audit row.
 */
export async function readLeadDetail(
  pool: Queryable,
  leadId: string,
  actor: { accountId: string; role: string },
): Promise<StaffLeadDetail | null> {
  const lead = await pool.query<DetailRow>(
    `SELECT i.id, i.created_at, i.kind, i.status, i.name, i.email, i.phone, i.message,
            i.verified_account, i.consent_to_contact, i.consent_text_version,
            i.consent_disclosure_text, i.consent_channels, i.consent_given_at, i.listing_id,
            l.title AS listing_title, p.address_raw AS listing_address,
            l.list_price AS listing_price, l.consumer_status AS listing_status,
            EXISTS (SELECT 1 FROM listing_inquiries o WHERE ${duplicateCondition('i')})
              AS possible_duplicate
       FROM listing_inquiries i
       JOIN listings l ON l.id = i.listing_id
       JOIN properties p ON p.id = l.property_id
      WHERE i.id = $1`,
    [leadId],
  );
  const row = lead.rows[0];
  if (row === undefined) return null;

  await pool.query(
    'INSERT INTO lead_access_audit (lead_id, actor_account_id, actor_role) VALUES ($1, $2, $3)',
    [leadId, actor.accountId, actor.role],
  );

  const [history, notes, duplicates, assignments] = await Promise.all([
    pool.query<{
      id: string;
      from_status: StaffLeadDetail['status'] | null;
      to_status: StaffLeadDetail['status'];
      actor_account_id: string | null;
      actor_role: string;
      note: string | null;
      agent_profile_id: string | null;
      created_at: Date;
    }>(
      `SELECT id, from_status, to_status, actor_account_id, actor_role, note, agent_profile_id,
              created_at
         FROM lead_status_events WHERE lead_id = $1 ORDER BY created_at, id`,
      [leadId],
    ),
    pool.query<NoteRow>(
      `SELECT id, author_account_id, author_role, body, created_at
         FROM lead_notes WHERE lead_id = $1 ORDER BY created_at, id`,
      [leadId],
    ),
    row.possible_duplicate
      ? pool.query<{ id: string }>(
          `SELECT o.id
             FROM listing_inquiries i, listing_inquiries o
            WHERE i.id = $1 AND ${duplicateCondition('i')}
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT ${DUPLICATE_IDS_LIMIT}`,
          [leadId],
        )
      : Promise.resolve({ rows: [] as { id: string }[] }),
    pool.query<{
      id: string;
      agent_profile_id: string;
      agent_display_name: string;
      assigned_by_account_id: string;
      assigned_at: Date;
      ended_at: Date | null;
      end_reason: StaffLeadAssignment['endReason'];
    }>(
      `SELECT a.id, a.agent_profile_id, p.display_name AS agent_display_name,
              a.assigned_by_account_id, a.assigned_at, a.ended_at, a.end_reason
         FROM lead_assignments a
         JOIN agent_profiles p ON p.id = a.agent_profile_id
        WHERE a.lead_id = $1 ORDER BY a.assigned_at, a.id`,
      [leadId],
    ),
  ]);

  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    kind: row.kind,
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    verifiedAccount: row.verified_account,
    consent: {
      given: row.consent_to_contact,
      textVersion: row.consent_text_version,
      text: row.consent_disclosure_text,
      channels: row.consent_channels ?? [],
      givenAt: row.consent_given_at?.toISOString() ?? null,
    },
    listing: {
      id: row.listing_id,
      title: row.listing_title,
      address: row.listing_address,
      listPrice: row.listing_price === null ? null : Number(row.listing_price),
      status: row.listing_status,
    },
    possibleDuplicate: row.possible_duplicate,
    duplicateLeadIds: duplicates.rows.map((r) => r.id),
    history: history.rows.map((h) => ({
      id: h.id,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      actorAccountId: h.actor_account_id,
      actorRole: h.actor_role,
      note: h.note,
      agentProfileId: h.agent_profile_id,
      createdAt: h.created_at.toISOString(),
    })),
    notes: notes.rows.map(toNote),
    assignments: assignments.rows.map((a) => ({
      id: a.id,
      agentProfileId: a.agent_profile_id,
      agentDisplayName: a.agent_display_name,
      assignedByAccountId: a.assigned_by_account_id,
      assignedAt: a.assigned_at.toISOString(),
      endedAt: a.ended_at?.toISOString() ?? null,
      endReason: a.end_reason,
    })),
  };
}

interface NoteRow {
  id: string;
  author_account_id: string;
  author_role: string;
  body: string;
  created_at: Date;
}

const toNote = (row: NoteRow): StaffLeadNote => ({
  id: row.id,
  authorAccountId: row.author_account_id,
  authorRole: row.author_role,
  body: row.body,
  createdAt: row.created_at.toISOString(),
});

/** Appends a note. `null` when no lead has this id. */
export async function addLeadNote(
  pool: Queryable,
  input: { leadId: string; body: string; authorAccountId: string; authorRole: string },
): Promise<StaffLeadNote | null> {
  const { rows } = await pool.query<NoteRow>(
    `INSERT INTO lead_notes (lead_id, author_account_id, author_role, body)
     SELECT id, $2, $3, $4 FROM listing_inquiries WHERE id = $1
     RETURNING id, author_account_id, author_role, body, created_at`,
    [input.leadId, input.authorAccountId, input.authorRole, input.body],
  );
  const row = rows[0];
  return row === undefined ? null : toNote(row);
}
