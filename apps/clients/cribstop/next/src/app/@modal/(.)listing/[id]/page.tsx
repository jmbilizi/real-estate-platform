import ListingDetailModal from '@/components/ListingDetailModal';

export default async function ListingModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingDetailModal id={id} />;
}
