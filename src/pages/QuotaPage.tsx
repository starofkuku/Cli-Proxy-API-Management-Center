/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useQuotaPreferencesStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const providerVisibility = useQuotaPreferencesStore((state) => state.providerVisibility);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';
  const hasClaudeFiles = files.some(CLAUDE_CONFIG.filterFn);
  const hasAntigravityFiles = files.some(ANTIGRAVITY_CONFIG.filterFn);
  const hasCodexFiles = files.some(CODEX_CONFIG.filterFn);
  const hasXaiFiles = files.some(XAI_CONFIG.filterFn);
  const hasKimiFiles = files.some(KIMI_CONFIG.filterFn);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {hasCodexFiles && (
        <QuotaSection
          config={CODEX_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {providerVisibility.claude && hasClaudeFiles && (
        <QuotaSection
          config={CLAUDE_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {providerVisibility.antigravity && hasAntigravityFiles && (
        <QuotaSection
          config={ANTIGRAVITY_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {providerVisibility.xai && hasXaiFiles && (
        <QuotaSection
          config={XAI_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {providerVisibility.kimi && hasKimiFiles && (
        <QuotaSection
          config={KIMI_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
    </div>
  );
}
