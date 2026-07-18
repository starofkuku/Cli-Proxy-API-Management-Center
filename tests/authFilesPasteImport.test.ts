import { describe, expect, test } from 'bun:test';
import { normalizePastedAuthDocuments } from '../src/features/authFiles/pasteImport';

describe('auth-file paste import', () => {
  test('keeps CPA objects and arrays as separate credentials', () => {
    const first = { type: 'codex', access_token: 'access-1' };
    const second = { type: 'codex', access_token: 'access-2' };

    expect(normalizePastedAuthDocuments(first)).toEqual([first]);
    expect(normalizePastedAuthDocuments([first, second])).toEqual([first, second]);
  });

  test('converts a Sub2API export into CPA credentials', () => {
    const result = normalizePastedAuthDocuments({
      type: 'sub2api-data',
      version: 1,
      exported_at: '2026-07-18T00:00:00Z',
      proxies: [],
      accounts: [
        {
          name: 'user@example.com',
          platform: 'openai',
          type: 'oauth',
          credentials: {
            access_token: 'access',
            refresh_token: 'refresh',
            chatgpt_account_id: 'account-1',
          },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'codex',
      access_token: 'access',
      refresh_token: 'refresh',
      account_id: 'account-1',
    });
  });

  test('converts arrays of Sub2API account objects', () => {
    const result = normalizePastedAuthDocuments([
      {
        platform: 'openai',
        type: 'oauth',
        credentials: { access_token: 'access', refresh_token: 'refresh' },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'codex', access_token: 'access' });
  });

  test('rejects arrays containing non-object entries', () => {
    expect(() => normalizePastedAuthDocuments([{ type: 'codex' }, 'invalid'])).toThrow();
  });
});
