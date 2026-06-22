import { NextRequest, NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { AUTH_COOKIES } from '@/app/api/_lib/cookies';
import { tryRefreshToken } from '@/app/api/_lib/refresh';

async function fetchProfile(token: string): Promise<Response | null> {
  return fetchGateway('/account/profile', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  }).catch(() => null);
}

export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get(AUTH_COOKIES.accessToken)?.value;
  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let upstream = await fetchProfile(accessToken);

  // If token expired, try refreshing and retry once
  if (upstream?.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      upstream = await fetchProfile(newToken);
    }
  }

  if (!upstream) {
    return NextResponse.json({ error: 'Profile service unavailable' }, { status: 503 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: upstream.status });
  }

  const profile = await upstream.json();
  return NextResponse.json(profile);
}

export async function PUT(req: NextRequest) {
  const accessToken = req.cookies.get(AUTH_COOKIES.accessToken)?.value;
  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  let upstream = await fetchGateway('/account/profile', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(() => null);

  // If token expired, try refreshing and retry once
  if (upstream?.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      upstream = await fetchGateway('/account/profile', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${newToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      }).catch(() => null);
    }
  }

  if (!upstream) {
    return NextResponse.json({ error: 'Profile service unavailable' }, { status: 503 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: 'Failed to update profile' }, { status: upstream.status });
  }

  const updated = await upstream.json().catch(() => ({}));
  return NextResponse.json(updated);
}
