import { notFound } from 'next/navigation';
import AgentLeadDetailView from '@/components/agent/AgentLeadDetail';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AgentLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <AgentLeadDetailView key={id} id={id} />;
}
