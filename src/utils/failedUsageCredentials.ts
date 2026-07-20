import type { AuthFileItem } from '@/types/authFile';
import { isRuntimeOnlyAuthFile, normalizeProviderKey } from '@/features/authFiles/constants';
import {
  normalizeAuthIndex,
  type UsageDetail,
} from '@/utils/usage';

/** Raw failed-source aggregate recorded from /usage details. */
export type FailedUsageSourceRecord = {
  source: string;
  authIndex: string | null;
  failureCount: number;
  successCount: number;
};

/** Auth-file matched candidate ready for typed delete UI. */
export type FailedUsageAuthFileCandidate = {
  name: string;
  type: string;
  authIndex: string | null;
  source: string;
  failureCount: number;
  successCount: number;
};

export type FailedUsageAuthFileTypeGroup = {
  type: string;
  items: FailedUsageAuthFileCandidate[];
  totalFailures: number;
};

const normalizeSourceKey = (value: string): string => value.trim().toLowerCase();

const buildRecordKey = (source: string, authIndex: string | null): string => {
  const authKey = authIndex ? `auth:${authIndex}` : '';
  const sourceKey = source ? `source:${normalizeSourceKey(source)}` : '';
  return authKey || sourceKey || 'source:-';
};

/**
 * Aggregate failed request sources from usage details.
 * Classification by provider type happens later when matched to auth files.
 */
export function collectFailedUsageSources(
  usageDetails: readonly UsageDetail[]
): FailedUsageSourceRecord[] {
  const map = new Map<string, FailedUsageSourceRecord>();

  usageDetails.forEach((detail) => {
    const source = typeof detail.source === 'string' ? detail.source.trim() : '';
    const authIndex = normalizeAuthIndex(detail.auth_index);
    if (!source && !authIndex) return;

    const key = buildRecordKey(source, authIndex);
    const existing = map.get(key) ?? {
      source,
      authIndex,
      failureCount: 0,
      successCount: 0,
    };

    if (detail.failed === true) {
      existing.failureCount += 1;
    } else {
      existing.successCount += 1;
    }

    if (!existing.source && source) {
      existing.source = source;
    }
    if (!existing.authIndex && authIndex) {
      existing.authIndex = authIndex;
    }

    map.set(key, existing);
  });

  return Array.from(map.values())
    .filter((record) => record.failureCount > 0)
    .sort(
      (a, b) =>
        b.failureCount - a.failureCount ||
        a.source.localeCompare(b.source) ||
        String(a.authIndex ?? '').localeCompare(String(b.authIndex ?? ''))
    );
}

const resolveAuthFileType = (file: AuthFileItem): string =>
  normalizeProviderKey(String(file.type ?? file.provider ?? ''));

const findAuthFileForRecord = (
  record: FailedUsageSourceRecord,
  byAuthIndex: Map<string, AuthFileItem>,
  byName: Map<string, AuthFileItem>
): AuthFileItem | null => {
  if (record.authIndex) {
    const byIndex = byAuthIndex.get(record.authIndex);
    if (byIndex) return byIndex;
  }

  if (record.source) {
    const exact = byName.get(normalizeSourceKey(record.source));
    if (exact) return exact;

    // Usage source sometimes uses a t: prefix or nested path-like id.
    const stripped = record.source.startsWith('t:') ? record.source.slice(2) : record.source;
    const strippedMatch = byName.get(normalizeSourceKey(stripped));
    if (strippedMatch) return strippedMatch;

    // Fallback: source ends with the file name.
    for (const [nameKey, file] of byName) {
      if (normalizeSourceKey(record.source).endsWith(nameKey)) {
        return file;
      }
    }
  }

  return null;
};

/**
 * Match failed usage sources to existing auth files and group by provider type.
 * Runtime-only entries are excluded because they cannot be deleted as files.
 */
export function matchFailedUsageAuthFiles(
  failedSources: readonly FailedUsageSourceRecord[],
  files: readonly AuthFileItem[],
  options?: { typeFilter?: string | null }
): FailedUsageAuthFileTypeGroup[] {
  const typeFilter = options?.typeFilter
    ? normalizeProviderKey(options.typeFilter)
    : null;
  const effectiveTypeFilter =
    typeFilter && typeFilter !== 'all' && typeFilter !== 'recycle-bin' ? typeFilter : null;

  const byAuthIndex = new Map<string, AuthFileItem>();
  const byName = new Map<string, AuthFileItem>();

  files.forEach((file) => {
    if (isRuntimeOnlyAuthFile(file)) return;
    const name = typeof file.name === 'string' ? file.name.trim() : '';
    if (!name) return;
    byName.set(normalizeSourceKey(name), file);

    const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (authIndex) {
      byAuthIndex.set(authIndex, file);
    }
  });

  const candidateMap = new Map<string, FailedUsageAuthFileCandidate>();

  failedSources.forEach((record) => {
    const file = findAuthFileForRecord(record, byAuthIndex, byName);
    if (!file) return;

    const name = typeof file.name === 'string' ? file.name.trim() : '';
    if (!name) return;

    const type = resolveAuthFileType(file);
    if (effectiveTypeFilter && type !== effectiveTypeFilter) return;

    const existing = candidateMap.get(name);
    if (existing) {
      existing.failureCount += record.failureCount;
      existing.successCount += record.successCount;
      if (!existing.authIndex && record.authIndex) {
        existing.authIndex = record.authIndex;
      }
      if (!existing.source && record.source) {
        existing.source = record.source;
      }
      return;
    }

    candidateMap.set(name, {
      name,
      type,
      authIndex: normalizeAuthIndex(file['auth_index'] ?? file.authIndex) ?? record.authIndex,
      source: record.source || name,
      failureCount: record.failureCount,
      successCount: record.successCount,
    });
  });

  const byType = new Map<string, FailedUsageAuthFileCandidate[]>();
  candidateMap.forEach((candidate) => {
    const typeKey = candidate.type || 'unknown';
    const list = byType.get(typeKey) ?? [];
    list.push(candidate);
    byType.set(typeKey, list);
  });

  return Array.from(byType.entries())
    .map(([type, items]) => ({
      type,
      items: items.sort(
        (a, b) => b.failureCount - a.failureCount || a.name.localeCompare(b.name)
      ),
      totalFailures: items.reduce((sum, item) => sum + item.failureCount, 0),
    }))
    .sort(
      (a, b) =>
        b.totalFailures - a.totalFailures ||
        a.type.localeCompare(b.type)
    );
}
