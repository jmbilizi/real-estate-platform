/** "What I'm looking for" preferences (#768). Facts about the home only. No free text. */

export type LookingForIntent = 'buy' | 'rent';

export interface LookingForPlace {
  kind: 'city' | 'zip' | 'neighborhood' | 'street' | 'county';
  state: string;
  city?: string;
  zip?: string;
  name?: string;
  county?: string;
}

export interface LookingForInput {
  intent: LookingForIntent;
  places: LookingForPlace[];
  priceMin?: number | null;
  priceMax?: number | null;
  bedsMin?: number | null;
  bathsMin?: number | null;
  homeTypes: string[];
  /** yyyy-MM-dd. A move-in date, or the first day of a buying window. */
  whenStart?: string | null;
  /** yyyy-MM-dd. The last day of a buying window. */
  whenEnd?: string | null;
}

export interface LookingFor extends LookingForInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface LookingForList {
  items: LookingFor[];
  max: number;
}

export class LookingForError extends Error {
  constructor(
    public status: number,
    public code: 'limit_reached' | 'invalid' | 'failed',
    public fields: string[] = [],
  ) {
    super(code);
    this.name = 'LookingForError';
  }
}

export async function getLookingFor(): Promise<LookingForList> {
  const res = await fetch('/api/account/looking-for');
  if (!res.ok) throw new LookingForError(res.status, 'failed');
  return res.json();
}

export async function saveLookingFor(id: string, input: LookingForInput): Promise<LookingFor> {
  const res = await fetch(`/api/account/looking-for/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  if (res.status === 409) throw new LookingForError(409, 'limit_reached');
  if (res.status === 400) {
    throw new LookingForError(400, 'invalid', Object.keys(body?.errors ?? {}));
  }
  throw new LookingForError(res.status, 'failed');
}

export async function deleteLookingFor(id: string): Promise<void> {
  const res = await fetch(`/api/account/looking-for/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new LookingForError(res.status, 'failed');
}
