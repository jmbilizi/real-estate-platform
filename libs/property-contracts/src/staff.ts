import { z } from 'zod';

/**
 * `GET /staff/me` (#628). The roles of the calling account, as a list: accounts are multi-role
 * (PRD §11.2), so there is no persona field. A buyer-only account gets `["User"]`.
 */
export const staffMeSchema = z.object({
  roles: z.array(z.string()),
});

export type StaffMe = z.infer<typeof staffMeSchema>;
