import express from 'express';
import request from 'supertest';
import {
  FORBIDDEN_BODY,
  SIGN_IN_REQUIRED_BODY,
  UNAVAILABLE_BODY,
} from '@cribstop/property-contracts';
import { createApp } from '../app';
import type { IntrospectionClient, IntrospectionOutcome } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';
import { hasAnyRole, requireRole, ROLE, staffCallerOf } from './roles';

const ACCOUNT = '0190a000-0000-7000-8000-00000000000a';

const outcomeClient = (outcome: IntrospectionOutcome): IntrospectionClient & { calls: number } => {
  const client = {
    calls: 0,
    resolveAccountId: () => Promise.resolve(null),
    introspect: () => {
      client.calls += 1;
      return Promise.resolve(outcome);
    },
  };
  return client;
};

const account = (...roles: string[]): IntrospectionOutcome => ({
  kind: 'account',
  accountId: ACCOUNT,
  roles,
});

function guardedApp(introspection: IntrospectionClient) {
  const app = express();
  app.get('/probe', requireRole(introspection, ROLE.Agent, ROLE.Admin), (_req, res) => {
    res.status(200).json({ accountId: staffCallerOf(res).accountId });
  });
  return app;
}

describe('requireRole', () => {
  it('answers 401 for a signed-out caller', async () => {
    const res = await request(guardedApp(outcomeClient({ kind: 'signed-out' }))).get('/probe');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(SIGN_IN_REQUIRED_BODY);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('answers 403 for a buyer-only account', async () => {
    const res = await request(guardedApp(outcomeClient(account(ROLE.User)))).get('/probe');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN_BODY);
  });

  it('answers 200 for an Agent', async () => {
    const res = await request(guardedApp(outcomeClient(account(ROLE.User, ROLE.Agent)))).get(
      '/probe',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accountId: ACCOUNT });
  });

  it('is any-of: a multi-role Agent and Moderator passes a check that allows only Agent', async () => {
    const client = outcomeClient(account(ROLE.User, ROLE.Moderator, ROLE.Agent));
    const app = express();
    app.get('/agent-only', requireRole(client, ROLE.Agent), (_req, res) => {
      res.sendStatus(200);
    });
    expect((await request(app).get('/agent-only')).status).toBe(200);
  });

  it('lets SuperAdmin through where Admin is allowed', async () => {
    const res = await request(guardedApp(outcomeClient(account(ROLE.SuperAdmin)))).get('/probe');
    expect(res.status).toBe(200);
  });

  it('does not let Admin through where only SuperAdmin is allowed', () => {
    expect(hasAnyRole([ROLE.Admin], [ROLE.SuperAdmin])).toBe(false);
  });

  it('answers 503, not 401, when account-service did not answer', async () => {
    const res = await request(guardedApp(outcomeClient({ kind: 'unavailable' }))).get('/probe');
    expect(res.status).toBe(503);
    expect(res.body).toEqual(UNAVAILABLE_BODY);
  });

  it('answers 403 for an account whose introspection carried no roles', async () => {
    const res = await request(guardedApp(outcomeClient(account()))).get('/probe');
    expect(res.status).toBe(403);
  });

  it('introspects once per request', async () => {
    const client = outcomeClient(account(ROLE.Agent));
    await request(guardedApp(client)).get('/probe');
    expect(client.calls).toBe(1);
  });
});

describe('GET /staff/me', () => {
  const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as ReadPool;
  const appWith = (outcome: IntrospectionOutcome) =>
    createApp({ pool, introspection: outcomeClient(outcome) });

  it('returns only the roles of a multi-role account', async () => {
    const res = await request(appWith(account(ROLE.User, ROLE.Agent, ROLE.Moderator))).get(
      '/staff/me',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: [ROLE.User, ROLE.Agent, ROLE.Moderator] });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('returns the User role alone for a buyer-only account', async () => {
    const res = await request(appWith(account(ROLE.User))).get('/staff/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: [ROLE.User] });
  });

  it('answers 401 without a valid credential', async () => {
    const res = await request(appWith({ kind: 'signed-out' })).get('/staff/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(SIGN_IN_REQUIRED_BODY);
  });

  it('answers 503 when account-service did not answer', async () => {
    const res = await request(appWith({ kind: 'unavailable' })).get('/staff/me');
    expect(res.status).toBe(503);
  });
});
