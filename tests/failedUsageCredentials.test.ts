import { describe, expect, test } from 'bun:test';
import {
  collectFailedUsageSources,
  matchFailedUsageAuthFiles,
} from '@/utils/failedUsageCredentials';
import type { UsageDetail } from '@/utils/usage';
import type { AuthFileItem } from '@/types/authFile';

const detail = (partial: Partial<UsageDetail> & { source: string; failed: boolean }): UsageDetail => ({
  timestamp: '2026-07-20 10:00:00',
  source: partial.source,
  auth_index: partial.auth_index ?? null,
  tokens: {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
  },
  failed: partial.failed,
});

describe('failed usage credentials', () => {
  test('collectFailedUsageSources aggregates failures', () => {
    const records = collectFailedUsageSources([
      detail({ source: 'a.json', auth_index: '1', failed: true }),
      detail({ source: 'a.json', auth_index: '1', failed: true }),
      detail({ source: 'a.json', auth_index: '1', failed: false }),
      detail({ source: 'b.json', auth_index: '2', failed: false }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].failureCount).toBe(2);
    expect(records[0].successCount).toBe(1);
  });

  test('matchFailedUsageAuthFiles groups by type and respects filter', () => {
    const files: AuthFileItem[] = [
      { name: 'codex-a.json', type: 'codex', auth_index: '1' },
      { name: 'xai-b.json', type: 'xai', auth_index: '2' },
    ];
    const sources = collectFailedUsageSources([
      detail({ source: 'codex-a.json', auth_index: '1', failed: true }),
      detail({ source: 'xai-b.json', auth_index: '2', failed: true }),
      detail({ source: 'xai-b.json', auth_index: '2', failed: true }),
    ]);
    const all = matchFailedUsageAuthFiles(sources, files);
    expect(all.map((g) => g.type).sort()).toEqual(['codex', 'xai']);
    const codexOnly = matchFailedUsageAuthFiles(sources, files, { typeFilter: 'codex' });
    expect(codexOnly).toHaveLength(1);
    expect(codexOnly[0].items[0].name).toBe('codex-a.json');
    expect(codexOnly[0].items[0].failureCount).toBe(1);
  });
});
