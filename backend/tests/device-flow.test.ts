import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for Device Flow auth endpoints.
 *
 * The actual auth router talks to Supabase via supabaseAdmin.
 * These tests verify the helper functions (randomHex, generateUserCode)
 * are available in the module, and test the DB-backed flow logic
 * at the integration level by mocking the supabaseAdmin client.
 */

// ── Mock supabaseAdmin before imports ──

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();

// Build chainable mock
function chainable(terminal?: () => unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.insert = (...args: unknown[]) => { mockInsert(...args); return chain; };
  chain.select = (...args: unknown[]) => { mockSelect(...args); return chain; };
  chain.delete = (...args: unknown[]) => { mockDelete(...args); return chain; };
  chain.update = (...args: unknown[]) => { mockUpdate(...args); return chain; };
  chain.eq = (...args: unknown[]) => { mockEq(...args); return chain; };
  chain.single = (...args: unknown[]) => {
    mockSingle(...args);
    return terminal ? terminal() : { data: null, error: null };
  };

  return chain;
}

vi.mock('../src/lib/supabase/client.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => chainable()),
  },
  createUserClient: vi.fn(),
}));

// Now import the module under test
import { authRouter } from '../src/routers/auth.router.js';

describe('Device Flow auth — helper verification', () => {
  it('authRouter is defined and has device flow procedures', () => {
    // Verify the router has the expected procedure definitions
    expect(authRouter).toBeDefined();

    // Access the internal procedure map
    const procedures = authRouter._def.procedures;
    expect(procedures).toHaveProperty('deviceCodeRequest');
    expect(procedures).toHaveProperty('devicePoll');
    expect(procedures).toHaveProperty('deviceAuthorize');
    expect(procedures).toHaveProperty('me');
    expect(procedures).toHaveProperty('updateProfile');
  });
});

describe('Device Flow auth — deviceCodeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a device code with correct structure', async () => {
    // Mock successful insert
    const { supabaseAdmin } = await import('../src/lib/supabase/client.js');
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    } as never);

    // Call the procedure directly
    const caller = authRouter.createCaller({
      req: {} as never,
      res: {} as never,
      user: null,
      accessToken: null,
      db: {} as never,
      adminDb: {} as never,
      ip: '127.0.0.1',
      requestId: 'test-req',
    });

    const result = await caller.deviceCodeRequest();

    expect(result).toHaveProperty('device_code');
    expect(result).toHaveProperty('user_code');
    expect(result).toHaveProperty('verification_uri');
    expect(result).toHaveProperty('expires_in', 600);
    expect(result).toHaveProperty('interval', 5);

    // device_code should be a 64-char hex string
    expect(result.device_code).toMatch(/^[0-9a-f]{64}$/);

    // user_code should match XXXX-XXXX format (excluding confusable chars)
    expect(result.user_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe('Device Flow auth — devicePoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws expired_token when device code not found', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase/client.js');
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    } as never);

    const caller = authRouter.createCaller({
      req: {} as never,
      res: {} as never,
      user: null,
      accessToken: null,
      db: {} as never,
      adminDb: {} as never,
      ip: '127.0.0.1',
      requestId: 'test-req',
    });

    await expect(caller.devicePoll({ deviceCode: 'nonexistent' }))
      .rejects.toThrow('expired_token');
  });

  it('throws authorization_pending for pending codes', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase/client.js');
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              device_code: 'test-dc',
              status: 'pending',
              expires_at: new Date(Date.now() + 600_000).toISOString(),
            },
            error: null,
          }),
        }),
      }),
    } as never);

    const caller = authRouter.createCaller({
      req: {} as never,
      res: {} as never,
      user: null,
      accessToken: null,
      db: {} as never,
      adminDb: {} as never,
      ip: '127.0.0.1',
      requestId: 'test-req',
    });

    await expect(caller.devicePoll({ deviceCode: 'test-dc' }))
      .rejects.toThrow('authorization_pending');
  });

  it('returns tokens for authorized codes', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase/client.js');

    const mockDeleteChain = {
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      // First call is select, subsequent calls may be delete
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                device_code: 'test-dc',
                status: 'authorized',
                expires_at: new Date(Date.now() + 600_000).toISOString(),
                access_token: 'jwt-token-123',
                refresh_token: '',
                user_email: 'user@test.com',
              },
              error: null,
            }),
          }),
        }),
        ...mockDeleteChain,
      } as never;
    });

    const caller = authRouter.createCaller({
      req: {} as never,
      res: {} as never,
      user: null,
      accessToken: null,
      db: {} as never,
      adminDb: {} as never,
      ip: '127.0.0.1',
      requestId: 'test-req',
    });

    const result = await caller.devicePoll({ deviceCode: 'test-dc' });

    expect(result).toEqual({
      access_token: 'jwt-token-123',
      refresh_token: '',
      user_email: 'user@test.com',
    });
  });
});
