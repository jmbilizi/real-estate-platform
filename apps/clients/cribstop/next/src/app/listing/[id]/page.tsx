import { redirect } from 'next/navigation';

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?listing=${id}`);
}
