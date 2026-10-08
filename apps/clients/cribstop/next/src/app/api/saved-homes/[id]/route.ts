import { NextRequest } from 'next/server';
import { relaySaved } from '@/app/api/_lib/saved-gateway';

/** Unsaves a home by its property id (#23). An off-market home has no listing to unsave through. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return relaySaved(req, `/property/saved-homes/${encodeURIComponent(id)}`, 'DELETE');
}
