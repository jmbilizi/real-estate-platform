import AgentsList from '@/components/staff/AgentsList';
import { loadStaffGate } from '@/lib/api/staff-server';
import { canManageAgents } from '@/lib/staff-leads';

/**
 * The agent directory. The layout already closed the area to anyone without a lead desk role.
 * Create, edit and deactivate show for Admin and SuperAdmin only. The service enforces it too.
 */
export default async function AdminAgentsPage() {
  const { roles } = await loadStaffGate();
  return <AgentsList canWrite={canManageAgents(roles)} />;
}
