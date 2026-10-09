import { NextRequest } from 'next/server';
import { relaySaved } from '@/app/api/_lib/saved-gateway';

type Ctx = { params: Promise<{ id: string }> };

/** Saves the home of a listing (#23). The service resolves the home, so the client sends the listing id. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return relaySaved(req, `/property/listings/${encodeURIComponent(id)}/saved`, 'PUT');
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return relaySaved(req, `/property/listings/${encodeURIComponent(id)}/saved`, 'DELETE');
}
