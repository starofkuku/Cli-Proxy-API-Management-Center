import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CODEX_CLIENT_ID,
  convertCodexCredentialDocument,
} from '../src/utils/codexCredentialFormat';

describe('Codex credential format conversion', () => {
  test('converts CPA to Sub2API without losing refresh fields', () => {
    const result = convertCodexCredentialDocument(
      {
        type: 'codex',
        name: 'user@example.com',
        access_token: 'access',
        refresh_token: 'refresh',
        id_token: 'id-token',
        account_id: 'account-1',
        email: 'user@example.com',
        expired: '2026-07-17T12:00:00Z',
      },
      'cpa-to-sub2api'
    ) as Record<string, unknown>;

    expect(result.platform).toBe('openai');
    expect(result.type).toBe('oauth');
    expect(result.credentials).toEqual({
      access_token: 'access',
      refresh_token: 'refresh',
      id_token: 'id-token',
      expires_at: 1784289600,
      client_id: DEFAULT_CODEX_CLIENT_ID,
      email: 'user@example.com',
      chatgpt_account_id: 'account-1',
    });
  });

  test('converts a Sub2API export to a CPA array', () => {
    const result = convertCodexCredentialDocument(
      {
        accounts: [
          {
            name: 'OpenAI OAuth - user@example.com',
            platform: 'openai',
            type: 'oauth',
            credentials: {
              access_token: 'access',
              refresh_token: 'refresh',
              client_id: 'custom-client',
              email: 'user@example.com',
              chatgpt_account_id: 'account-1',
              chatgpt_user_id: 'user-1',
              plan_type: 'plus',
              expires_at: 1784289600,
            },
          },
        ],
      },
      'sub2api-to-cpa'
    ) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'codex',
      access_token: 'access',
      refresh_token: 'refresh',
      client_id: 'custom-client',
      account_id: 'account-1',
      chatgpt_account_id: 'account-1',
      chatgpt_user_id: 'user-1',
      plan_type: 'plus',
      expired: '2026-07-17T12:00:00.000Z',
    });
  });
});
