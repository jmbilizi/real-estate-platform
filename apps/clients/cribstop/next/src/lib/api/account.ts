interface LoginRequest {
  email: string;
  password: string;
}

interface SignupRequest {
  username: string;
  email: string;
  password: string;
}

async function postAuth(endpoint: 'login' | 'signup', payload: LoginRequest | SignupRequest) {
  const response = await fetch(`/api/account/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = `Authentication request failed (${response.status})`;
    const body = await response.json().catch(() => null);
    if (typeof body?.error === 'string' && body.error.length > 0) {
      message = body.error;
    }

    throw new Error(message);
  }
}

export async function loginAccount(payload: LoginRequest) {
  await postAuth('login', payload);
}

export async function signupAccount(payload: SignupRequest) {
  await postAuth('signup', payload);
}
