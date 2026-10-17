/** Notification consent (#694). The server holds the wording. The client sends only its id. */

export interface ConsentWording {
  id: string;
  version: number;
  text: string;
}

export interface NotificationPreferences {
  consentWording: ConsentWording;
  preferences: { channel: string; category: string; enabled: boolean }[];
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await fetch('/api/account/notification-preferences');
  if (!res.ok) throw new Error('Could not load the email consent wording');
  return res.json();
}

/** Opts in to non-transactional email. Needs the id of the wording the user saw. */
export async function optInToEmail(consentWordingId: string): Promise<void> {
  const res = await fetch('/api/account/notification-preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ channel: 'email', category: 'non_transactional', enabled: true, consentWordingId }],
    }),
  });
  if (!res.ok) throw new Error('Could not turn on email notifications');
}
