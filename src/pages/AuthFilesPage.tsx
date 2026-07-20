import {
  useCallback,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { animate } from 'motion/mini';
import type { AnimationPlaybackControlsWithThen } from 'motion-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { IconFilterAll, IconSearch, IconTrash2 } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { AuthFilesStatusFilterCard } from '@/features/authFiles/components/AuthFilesStatusFilterCard';
import { AuthFilesRecycleBin } from '@/features/authFiles/components/AuthFilesRecycleBin';
import { DeleteFailedUsageCredentialsModal } from '@/features/authFiles/components/DeleteFailedUsageCredentialsModal';
import { copyToClipboard } from '@/utils/clipboard';
import {
  MAX_CARD_PAGE_SIZE,
  MIN_CARD_PAGE_SIZE,
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  getAuthFileIcon,
  getTypeColor,
  getTypeLabel,
  hasAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { matchFailedUsageAuthFiles } from '@/utils/failedUsageCredentials';
import { resolveUsageTimeRangeQuery } from '@/utils/usage';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { convertGptSessionTextToCpaDocument } from '@/features/authFiles/gptSessionToCpa';
import {
  normalizePastedAuthDocuments,
  parsePastedAuthText,
} from '@/features/authFiles/pasteImport';
import {
  isAuthFilesStatusFilterMode,
  isAuthFilesSortMode,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesStatusFilterMode,
  type AuthFilesSortMode,
} from '@/features/authFiles/uiState';
import {
  USAGE_STATS_STALE_TIME_MS,
  useAuthFilesPreferencesStore,
  useAuthStore,
  useNotificationStore,
  useThemeStore,
  useUsageStatsStore,
} from '@/stores';
import { authFilesApi, type AuthFileRecycleItem } from '@/services/api';
import styles from './AuthFilesPage.module.scss';

const easePower3Out = (progress: number) => 1 - (1 - progress) ** 4;
const easePower2In = (progress: number) => progress ** 3;
const BATCH_BAR_BASE_TRANSFORM = 'translateX(-50%)';
const BATCH_BAR_HIDDEN_TRANSFORM = 'translateX(-50%) translateY(56px)';
const DEFAULT_REGULAR_PAGE_SIZE = 9;
const DEFAULT_COMPACT_PAGE_SIZE = 12;
const MAX_AUTH_ARCHIVE_SIZE = 100 * 1024 * 1024;
const RECYCLE_BIN_FILTER = 'recycle-bin';

type PasteJsonFormat = 'cpa' | 'gptSession';

const padDatePart = (value: number) => String(value).padStart(2, '0');

const formatAuthFileTimestamp = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;

const buildPastedJsonUploads = (documents: Record<string, unknown>[], date = new Date()) => {
  const baseName = formatAuthFileTimestamp(date);
  return documents.map((document, index) => ({
    text: JSON.stringify(document, null, 2),
    fileName:
      documents.length === 1
        ? `${baseName}.json`
        : `${baseName}-${String(index + 1).padStart(3, '0')}.json`,
  }));
};

const isEditablePasteTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable]'));
};

const escapeWildcardSearchSegment = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

const resolveStatusFilterMode = (
  problemOnly: boolean,
  disabledOnly: boolean
): AuthFilesStatusFilterMode => {
  if (problemOnly) return 'problem';
  if (disabledOnly) return 'disabled';
  return 'all';
};

const normalizePersistedStatusFilterMode = (value: unknown): AuthFilesStatusFilterMode | null => {
  if (value === 'disabledProblem') return 'problem';
  return isAuthFilesStatusFilterMode(value) ? value : null;
};

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();

  const [filter, setFilter] = useState<'all' | string>('all');
  const [statusFilterMode, setStatusFilterMode] = useState<AuthFilesStatusFilterMode>('all');
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeByMode, setPageSizeByMode] = useState({
    regular: DEFAULT_REGULAR_PAGE_SIZE,
    compact: DEFAULT_COMPACT_PAGE_SIZE,
  });
  const [pageSizeInput, setPageSizeInput] = useState('9');
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [pasteJsonModalOpen, setPasteJsonModalOpen] = useState(false);
  const [pasteJsonText, setPasteJsonText] = useState('');
  const [pasteJsonFormat, setPasteJsonFormat] = useState<PasteJsonFormat>('cpa');
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [archiveUploading, setArchiveUploading] = useState(false);
  const [recycleFiles, setRecycleFiles] = useState<AuthFileRecycleItem[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(true);
  const [recycleMutatingName, setRecycleMutatingName] = useState<string | null>(null);
  const [trashInvalidLoading, setTrashInvalidLoading] = useState(false);
  const [failedUsageModalOpen, setFailedUsageModalOpen] = useState(false);
  const [failedUsageLoading, setFailedUsageLoading] = useState(false);
  const [failedUsageDeleting, setFailedUsageDeleting] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const batchActionAnimationRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  const previousSelectionCountRef = useRef(0);
  const selectionCountRef = useRef(0);

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    statusUpdating,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    uploadJsonDocuments,
    handleDelete,
    handleDownload,
    handleDownloadSub2API,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData();

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  } = useAuthFilesModels();

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles,
  });

  const failedSources = useUsageStatsStore((state) => state.failedSources);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);
  const showDeleteFailedUsageButton = useAuthFilesPreferencesStore(
    (state) => state.showDeleteFailedUsageButton
  );

  const disableControls = connectionStatus !== 'connected';
  const normalizedFilter = normalizeProviderKey(String(filter));
  const recycleSelected = filter === RECYCLE_BIN_FILTER;
  const failedUsageTypeFilter = recycleSelected ? 'all' : normalizedFilter;
  const failedUsageGroups = useMemo(
    () =>
      matchFailedUsageAuthFiles(failedSources, files, {
        typeFilter: failedUsageTypeFilter,
      }),
    [failedSources, failedUsageTypeFilter, files]
  );
  const failedUsageCandidateCount = useMemo(
    () => failedUsageGroups.reduce((sum, group) => sum + group.items.length, 0),
    [failedUsageGroups]
  );
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;
  const pageSize = compactMode ? pageSizeByMode.compact : pageSizeByMode.regular;
  const problemOnly = statusFilterMode === 'problem';
  const disabledOnly = statusFilterMode === 'disabled';
  const enabledOnly = statusFilterMode === 'enabled';

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(normalizeProviderKey(persisted.filter));
      }
      const persistedStatusFilterMode = normalizePersistedStatusFilterMode(
        persisted.statusFilterMode
      );
      if (persistedStatusFilterMode) {
        setStatusFilterMode(persistedStatusFilterMode);
      } else if (
        typeof persisted.problemOnly === 'boolean' ||
        typeof persisted.disabledOnly === 'boolean'
      ) {
        setStatusFilterMode(
          resolveStatusFilterMode(persisted.problemOnly === true, persisted.disabledOnly === true)
        );
      }
      if (typeof persistedCompactMode !== 'boolean' && typeof persisted.compactMode === 'boolean') {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      const legacyPageSize =
        typeof persisted.pageSize === 'number' && Number.isFinite(persisted.pageSize)
          ? clampCardPageSize(persisted.pageSize)
          : null;
      const regularPageSize =
        typeof persisted.regularPageSize === 'number' && Number.isFinite(persisted.regularPageSize)
          ? clampCardPageSize(persisted.regularPageSize)
          : (legacyPageSize ?? DEFAULT_REGULAR_PAGE_SIZE);
      const compactPageSize =
        typeof persisted.compactPageSize === 'number' && Number.isFinite(persisted.compactPageSize)
          ? clampCardPageSize(persisted.compactPageSize)
          : (legacyPageSize ?? DEFAULT_COMPACT_PAGE_SIZE);
      setPageSizeByMode({
        regular: regularPageSize,
        compact: compactPageSize,
      });
      if (isAuthFilesSortMode(persisted.sortMode)) {
        setSortMode(persisted.sortMode);
      }
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      statusFilterMode,
      problemOnly,
      disabledOnly,
      compactMode,
      search,
      page,
      pageSize,
      regularPageSize: pageSizeByMode.regular,
      compactPageSize: pageSizeByMode.compact,
      sortMode,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    disabledOnly,
    filter,
    page,
    pageSize,
    pageSizeByMode,
    problemOnly,
    search,
    sortMode,
    statusFilterMode,
    uiStateHydrated,
  ]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const setCurrentModePageSize = useCallback(
    (next: number) => {
      setPageSizeByMode((current) =>
        compactMode ? { ...current, compact: next } : { ...current, regular: next }
      );
    },
    [compactMode]
  );

  const commitPageSizeInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const next = clampCardPageSize(value);
    setCurrentModePageSize(next);
    setPageSizeInput(String(next));
    setPage(1);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setPageSizeInput(rawValue);

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const rounded = Math.round(parsed);
    if (rounded < MIN_CARD_PAGE_SIZE || rounded > MAX_CARD_PAGE_SIZE) return;

    setCurrentModePageSize(rounded);
    setPage(1);
  };

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setPage(1);
    },
    [sortMode]
  );

  const handleStatusFilterModeChange = useCallback((nextMode: AuthFilesStatusFilterMode) => {
    setStatusFilterMode(nextMode);
    setPage(1);
  }, []);

  const loadRecycleBin = useCallback(async () => {
    setRecycleLoading(true);
    try {
      setRecycleFiles(await authFilesApi.listRecycleBin());
    } catch {
      setRecycleFiles([]);
    } finally {
      setRecycleLoading(false);
    }
  }, []);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles(), loadExcluded(), loadModelAlias(), loadRecycleBin()]);
  }, [loadFiles, loadExcluded, loadModelAlias, loadRecycleBin]);

  const handleForceRefresh = useCallback(async () => {
    setForceRefreshing(true);
    try {
      await authFilesApi.refresh();
      await handleHeaderRefresh();
      showNotification(t('auth_files.force_refresh_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('auth_files.force_refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setForceRefreshing(false);
    }
  }, [handleHeaderRefresh, showNotification, t]);

  const handleArchiveUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_AUTH_ARCHIVE_SIZE) {
        showNotification(t('auth_files.archive_upload_too_large'), 'error');
        input.value = '';
        return;
      }

      setArchiveUploading(true);
      try {
        const result = await authFilesApi.uploadArchive(file);
        showNotification(
          t('auth_files.archive_upload_result', {
            found: result.jsonFound,
            uploaded: result.uploaded,
            failed: result.failedCount,
          }),
          result.failedCount > 0 ? 'warning' : 'success'
        );
        if (result.failed.length > 0) {
          const details = result.failed
            .slice(0, 5)
            .map((item) => `${item.name}: ${item.error}`)
            .join('; ');
          showNotification(`${t('auth_files.archive_upload_failed')}: ${details}`, 'error');
        }
        if (result.uploaded > 0) {
          await loadFiles();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        showNotification(`${t('auth_files.archive_upload_failed')}: ${message}`, 'error');
      } finally {
        setArchiveUploading(false);
        input.value = '';
      }
    },
    [loadFiles, showNotification, t]
  );

  const openFailedUsageModal = useCallback(async () => {
    setFailedUsageModalOpen(true);
    setFailedUsageLoading(true);
    try {
      await loadUsageStats({
        force: true,
        staleTimeMs: USAGE_STATS_STALE_TIME_MS,
        params: resolveUsageTimeRangeQuery('today'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      showNotification(`${t('auth_files.delete_failed_usage_load_failed')}: ${message}`, 'error');
    } finally {
      setFailedUsageLoading(false);
    }
  }, [loadUsageStats, showNotification, t]);

  const handleConfirmDeleteFailedUsage = useCallback(
    (names: string[]) => {
      const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
      if (uniqueNames.length === 0) return;

      const scopeLabel =
        failedUsageTypeFilter && failedUsageTypeFilter !== 'all'
          ? getTypeLabel(t, failedUsageTypeFilter)
          : t('auth_files.filter_all');

      showConfirmation({
        title: t('auth_files.delete_failed_usage_confirm_title'),
        message: t('auth_files.delete_failed_usage_confirm_message', {
          count: uniqueNames.length,
          scope: scopeLabel,
        }),
        confirmText: t('auth_files.delete_failed_usage_confirm_button', {
          count: uniqueNames.length,
        }),
        variant: 'danger',
        onConfirm: async () => {
          setFailedUsageDeleting(true);
          try {
            // Real permanent delete: soft-delete is only an intermediate backend step.
            const result = await authFilesApi.permanentlyDeleteAuthFiles(uniqueNames);
            await Promise.all([loadFiles(), loadRecycleBin()]);
            deselectAll();

            if (result.failed.length === 0) {
              showNotification(
                t('auth_files.delete_failed_usage_success', { count: result.deleted }),
                'success'
              );
              setFailedUsageModalOpen(false);
            } else {
              showNotification(
                t('auth_files.delete_failed_usage_partial', {
                  success: result.deleted,
                  failed: result.failed.length,
                }),
                'warning'
              );
            }

            // Refresh recorded failed sources after deletion.
            try {
              await loadUsageStats({
                force: true,
                staleTimeMs: USAGE_STATS_STALE_TIME_MS,
                params: resolveUsageTimeRangeQuery('today'),
              });
            } catch {
              // Keep modal open with previous usage snapshot if refresh fails.
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            showNotification(
              `${t('auth_files.delete_failed_usage_failed')}: ${message}`,
              'error'
            );
          } finally {
            setFailedUsageDeleting(false);
          }
        },
      });
    },
    [
      deselectAll,
      failedUsageTypeFilter,
      loadFiles,
      loadRecycleBin,
      loadUsageStats,
      showConfirmation,
      showNotification,
      t,
    ]
  );

  const handleTrashInvalid = useCallback(() => {
    showConfirmation({
      title: t('auth_files.trash_invalid_title'),
      message: t('auth_files.trash_invalid_confirm'),
      confirmText: t('auth_files.trash_invalid_button'),
      variant: 'danger',
      onConfirm: async () => {
        setTrashInvalidLoading(true);
        try {
          const result = await authFilesApi.trashInvalid();
          showNotification(
            t('auth_files.trash_invalid_result', {
              matched: result.matched,
              deleted: result.deleted,
              failed: result.failed.length,
            }),
            result.failed.length > 0 ? 'warning' : 'success'
          );
          await Promise.all([loadFiles(), loadRecycleBin()]);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          showNotification(`${t('auth_files.trash_invalid_failed')}: ${message}`, 'error');
        } finally {
          setTrashInvalidLoading(false);
        }
      },
    });
  }, [loadFiles, loadRecycleBin, showConfirmation, showNotification, t]);

  const handleRestoreRecycleFile = useCallback(
    async (file: AuthFileRecycleItem) => {
      setRecycleMutatingName(file.name);
      try {
        await authFilesApi.restoreRecycleFiles([file.name]);
        showNotification(
          t('auth_files.recycle_restore_success', { name: file.originalName }),
          'success'
        );
        await Promise.all([loadFiles(), loadRecycleBin()]);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        showNotification(`${t('auth_files.recycle_restore_failed')}: ${message}`, 'error');
      } finally {
        setRecycleMutatingName(null);
      }
    },
    [loadFiles, loadRecycleBin, showNotification, t]
  );

  const handlePermanentDeleteRecycleFile = useCallback(
    (file: AuthFileRecycleItem) => {
      showConfirmation({
        title: t('auth_files.recycle_permanent_delete_title'),
        message: t('auth_files.recycle_permanent_delete_confirm', { name: file.originalName }),
        confirmText: t('auth_files.recycle_permanent_delete_button'),
        variant: 'danger',
        onConfirm: async () => {
          setRecycleMutatingName(file.name);
          try {
            await authFilesApi.permanentlyDeleteRecycleFiles([file.name]);
            showNotification(
              t('auth_files.recycle_permanent_delete_success', { name: file.originalName }),
              'success'
            );
            await loadRecycleBin();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            showNotification(
              `${t('auth_files.recycle_permanent_delete_failed')}: ${message}`,
              'error'
            );
          } finally {
            setRecycleMutatingName(null);
          }
        },
      });
    },
    [loadRecycleBin, showConfirmation, showNotification, t]
  );

  const closePasteJsonModal = useCallback(() => {
    if (uploading) return;
    setPasteJsonModalOpen(false);
    setPasteJsonText('');
    setPasteJsonFormat('cpa');
  }, [uploading]);

  const handlePasteJsonSubmit = useCallback(async () => {
    const trimmed = pasteJsonText.trim();
    if (!trimmed) {
      showNotification(t('auth_files.paste_json_invalid'), 'error');
      return;
    }

    let documents: Record<string, unknown>[];
    try {
      documents =
        pasteJsonFormat === 'gptSession'
          ? normalizePastedAuthDocuments(convertGptSessionTextToCpaDocument(trimmed))
          : parsePastedAuthText(trimmed);
    } catch (err: unknown) {
      const errorMessage =
        pasteJsonFormat === 'gptSession' && err instanceof Error
          ? err.message
          : t('auth_files.paste_json_invalid');
      showNotification(
        pasteJsonFormat === 'gptSession'
          ? `${t('auth_files.paste_json_convert_failed')}: ${errorMessage}`
          : errorMessage,
        'error'
      );
      return;
    }

    const saved = await uploadJsonDocuments(buildPastedJsonUploads(documents));
    if (!saved) return;

    setPasteJsonModalOpen(false);
    setPasteJsonText('');
    setPasteJsonFormat('cpa');
  }, [pasteJsonFormat, pasteJsonText, showNotification, t, uploadJsonDocuments]);

  const uploadCpaText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        showNotification(t('auth_files.clipboard_empty'), 'error');
        return false;
      }

      let documents: Record<string, unknown>[];
      try {
        documents = parsePastedAuthText(trimmed);
      } catch {
        showNotification(t('auth_files.paste_json_invalid'), 'error');
        return false;
      }

      return uploadJsonDocuments(buildPastedJsonUploads(documents));
    },
    [showNotification, t, uploadJsonDocuments]
  );

  const handleClipboardCpaUpload = useCallback(async () => {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      showNotification(t('auth_files.clipboard_read_failed'), 'error');
      return;
    }

    try {
      await uploadCpaText(await navigator.clipboard.readText());
    } catch {
      showNotification(t('auth_files.clipboard_read_failed'), 'error');
    }
  }, [showNotification, t, uploadCpaText]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer || disableControls || uploading) return;

    const handlePagePaste = (event: ClipboardEvent) => {
      if (isEditablePasteTarget(event.target) || isEditablePasteTarget(document.activeElement)) {
        return;
      }

      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;

      event.preventDefault();
      void uploadCpaText(text);
    };

    document.addEventListener('paste', handlePagePaste);
    return () => document.removeEventListener('paste', handlePagePaste);
  }, [disableControls, isCurrentLayer, uploadCpaText, uploading]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    loadFiles();
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadRecycleBin();
  }, [files.length, isCurrentLayer, loadRecycleBin]);

  useInterval(
    () => {
      void loadFiles().catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (type) types.add(type);
    });
    return Array.from(types);
  }, [files]);

  const filesMatchingStatusFilters = useMemo(
    () =>
      files.filter((file) => {
        if (enabledOnly && file.disabled === true) return false;
        if (disabledOnly && file.disabled !== true) return false;
        if (problemOnly && !hasAuthFileStatusMessage(file)) return false;
        return true;
      }),
    [disabledOnly, enabledOnly, files, problemOnly]
  );

  const statusFilterOptions = useMemo(
    () =>
      [
        { value: 'all', label: t('auth_files.problem_filter_all') },
        { value: 'enabled', label: t('auth_files.problem_filter_enabled') },
        { value: 'disabled', label: t('auth_files.problem_filter_disabled') },
        { value: 'problem', label: t('auth_files.problem_filter_problem') },
      ] satisfies Array<{ value: AuthFilesStatusFilterMode; label: string }>,
    [t]
  );

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'priority', label: t('auth_files.sort_priority') },
    ],
    [t]
  );

  const pasteJsonFormatOptions = useMemo(
    () => [
      { value: 'cpa', label: 'CPA / Sub2API' },
      { value: 'gptSession', label: 'GptSession' },
    ],
    []
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingStatusFilters.length };
    filesMatchingStatusFilters.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (!type) return;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingStatusFilters]);

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  const filtered = useMemo(() => {
    const normalizedTerm = normalizedSearch.toLowerCase();

    return filesMatchingStatusFilters.filter((item) => {
      const type = normalizeProviderKey(String(item.type ?? item.provider ?? ''));
      const matchType = normalizedFilter === 'all' || type === normalizedFilter;
      const matchSearch =
        !normalizedSearch ||
        [item.name, item.type, item.provider].some((value) => {
          const content = (value || '').toString();
          return wildcardSearch
            ? wildcardSearch.test(content)
            : content.toLowerCase().includes(normalizedTerm);
        });
      return matchType && matchSearch;
    });
  }, [filesMatchingStatusFilters, normalizedFilter, normalizedSearch, wildcardSearch]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortMode === 'default') {
      copy.sort((a, b) => {
        const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
        const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
        const providerCompare = providerA.localeCompare(providerB);
        if (providerCompare !== 0) return providerCompare;
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'az') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'priority') {
      copy.sort((a, b) => {
        const pa = parsePriorityValue(a.priority) ?? 0;
        const pb = parsePriorityValue(b.priority) ?? 0;
        return pb - pa; // 高优先级排前面
      });
    }
    return copy;
  }, [filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = useMemo(() => sorted.slice(start, start + pageSize), [pageSize, sorted, start]);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  useActionBarHeightVar(
    floatingBatchActionsRef,
    '--auth-files-action-bar-height',
    batchActionBarVisible
  );

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setBatchActionBarVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!batchActionBarVisible) return;
    const currentCount = selectionCount;
    const previousCount = previousSelectionCountRef.current;
    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) return;

    batchActionAnimationRef.current?.stop();
    batchActionAnimationRef.current = null;

    if (currentCount > 0 && previousCount === 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_HIDDEN_TRANSFORM, BATCH_BAR_BASE_TRANSFORM],
          opacity: [0, 1],
        },
        {
          duration: 0.28,
          ease: easePower3Out,
          onComplete: () => {
            actionsEl.style.transform = BATCH_BAR_BASE_TRANSFORM;
            actionsEl.style.opacity = '1';
          },
        }
      );
    } else if (currentCount === 0 && previousCount > 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_BASE_TRANSFORM, BATCH_BAR_HIDDEN_TRANSFORM],
          opacity: [1, 0],
        },
        {
          duration: 0.22,
          ease: easePower2In,
          onComplete: () => {
            if (selectionCountRef.current === 0) {
              setBatchActionBarVisible(false);
            }
          },
        }
      );
    }

    previousSelectionCountRef.current = currentCount;
  }, [batchActionBarVisible, selectionCount]);

  useEffect(
    () => () => {
      batchActionAnimationRef.current?.stop();
      batchActionAnimationRef.current = null;
    },
    []
  );

  const renderFilterTags = () => (
    <div className={styles.filterRail}>
      <div className={styles.filterTags}>
        {existingTypes.map((type) => {
          const isActive = normalizedFilter === type;
          const iconSrc = getAuthFileIcon(type, resolvedTheme);
          const color =
            type === 'all'
              ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
              : getTypeColor(type, resolvedTheme);
          const buttonStyle = {
            '--filter-color': color.text,
            '--filter-surface': color.bg,
            '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
          } as CSSProperties;

          return (
            <button
              key={type}
              className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
              style={buttonStyle}
              onClick={() => {
                setFilter(type);
                setPage(1);
              }}
            >
              <span className={styles.filterTagLabel}>
                {type === 'all' ? (
                  <span className={`${styles.filterTagIconWrap} ${styles.filterAllIconWrap}`}>
                    <IconFilterAll className={styles.filterAllIcon} size={16} />
                  </span>
                ) : (
                  <span className={styles.filterTagIconWrap}>
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className={styles.filterTagIcon} />
                    ) : (
                      <span className={styles.filterTagIconFallback}>
                        {getTypeLabel(t, type).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                )}
                <span className={styles.filterTagText}>{getTypeLabel(t, type)}</span>
              </span>
              <span className={styles.filterTagCount}>{typeCounts[type] ?? 0}</span>
            </button>
          );
        })}
        <button
          className={`${styles.filterTag} ${recycleSelected ? styles.filterTagActive : ''}`}
          style={
            {
              '--filter-color': '#dc2626',
              '--filter-surface': 'color-mix(in srgb, #dc2626 10%, var(--bg-secondary))',
              '--filter-active-text': '#ffffff',
            } as CSSProperties
          }
          onClick={() => {
            setFilter(RECYCLE_BIN_FILTER);
            setPage(1);
            deselectAll();
          }}
        >
          <span className={styles.filterTagLabel}>
            <span className={styles.filterTagIconWrap}>
              <IconTrash2 size={16} />
            </span>
            <span className={styles.filterTagText}>{t('auth_files.recycle_tab')}</span>
          </span>
          <span className={styles.filterTagCount}>{recycleFiles.length}</span>
        </button>
      </div>

    </div>
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('auth_files.title_section')}</span>
      {files.length > 0 && <span className={styles.countBadge}>{files.length}</span>}
    </div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
        <p className={styles.description}>{t('auth_files.description')}</p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            <Button variant="secondary" size="sm" onClick={handleHeaderRefresh} disabled={loading}>
              {t('common.refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleForceRefresh()}
              disabled={disableControls || loading || forceRefreshing}
              loading={forceRefreshing}
              title={t('auth_files.force_refresh_hint')}
            >
              {t('auth_files.force_refresh_button')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleTrashInvalid}
              disabled={disableControls || loading || trashInvalidLoading}
              loading={trashInvalidLoading}
            >
              {t('auth_files.trash_invalid_button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPasteJsonModalOpen(true)}
              disabled={disableControls || uploading}
            >
              {t('auth_files.paste_json_button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleClipboardCpaUpload()}
              disabled={disableControls || uploading}
            >
              {t('auth_files.paste_clipboard_cpa_button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => archiveInputRef.current?.click()}
              disabled={disableControls || uploading || archiveUploading}
              loading={archiveUploading}
              title={t('auth_files.archive_upload_hint')}
            >
              {t('auth_files.archive_upload_button')}
            </Button>
            <Button
              size="sm"
              onClick={handleUploadClick}
              disabled={disableControls || uploading || archiveUploading}
              loading={uploading}
            >
              {t('auth_files.upload_button')}
            </Button>
            <input
              ref={archiveInputRef}
              type="file"
              accept=".zip,.tar,.tar.gz,.tgz,.gz,application/zip,application/gzip,application/x-tar"
              style={{ display: 'none' }}
              onChange={(event) => void handleArchiveUpload(event)}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.filterSection}>
          {renderFilterTags()}

          <div className={styles.filterContent}>
            {recycleSelected ? (
              <AuthFilesRecycleBin
                files={recycleFiles}
                loading={recycleLoading}
                mutatingName={recycleMutatingName}
                disabled={disableControls}
                onRestore={(file) => void handleRestoreRecycleFile(file)}
                onPermanentDelete={handlePermanentDeleteRecycleFile}
              />
            ) : (
              <>
                <div className={styles.filterControlsPanel}>
                  <div className={styles.filterControls}>
                    <div className={`${styles.filterItem} ${styles.filterSearchItem}`}>
                      <label>{t('auth_files.search_label')}</label>
                      <Input
                        className={styles.searchInput}
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                        placeholder={t('auth_files.search_placeholder')}
                        rightElement={<IconSearch className={styles.searchIcon} size={18} />}
                      />
                    </div>
                    <div className={styles.filterOptionsCard}>
                      <div className={styles.filterOptionsControl}>
                        <label>{t('auth_files.page_size_label')}</label>
                        <input
                          className={styles.pageSizeSelect}
                          type="number"
                          min={MIN_CARD_PAGE_SIZE}
                          max={MAX_CARD_PAGE_SIZE}
                          step={1}
                          value={pageSizeInput}
                          onChange={handlePageSizeChange}
                          onBlur={(e) => commitPageSizeInput(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            }
                          }}
                        />
                      </div>
                      <div className={styles.filterOptionsControl}>
                        <label>{t('auth_files.sort_label')}</label>
                        <Select
                          className={styles.sortSelect}
                          value={sortMode}
                          options={sortOptions}
                          onChange={handleSortModeChange}
                          ariaLabel={t('auth_files.sort_label')}
                          fullWidth
                        />
                      </div>
                      <div className={styles.filterOptionsToggle}>
                        <ToggleSwitch
                          checked={compactMode}
                          onChange={(value) => setCompactMode(value)}
                          ariaLabel={t('auth_files.compact_mode_label')}
                          label={
                            <span className={styles.filterToggleLabel}>
                              {t('auth_files.compact_mode_label')}
                            </span>
                          }
                        />
                      </div>
                      {showDeleteFailedUsageButton && !recycleSelected ? (
                        <div className={styles.failedUsageInlineAction}>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => void openFailedUsageModal()}
                            disabled={
                              disableControls || loading || failedUsageLoading || failedUsageDeleting
                            }
                            loading={failedUsageLoading}
                            title={t('auth_files.delete_failed_usage_hint_button')}
                          >
                            {t('auth_files.delete_failed_usage_button')}
                            {failedUsageCandidateCount > 0
                              ? ` (${failedUsageCandidateCount})`
                              : ''}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
                      <label>{t('auth_files.display_options_label')}</label>
                      <AuthFilesStatusFilterCard
                        label={t('auth_files.problem_filter_label')}
                        minLabel={statusFilterOptions[0]?.label}
                        maxLabel={statusFilterOptions[statusFilterOptions.length - 1]?.label}
                        value={statusFilterMode}
                        options={statusFilterOptions}
                        onChange={(next) =>
                          handleStatusFilterModeChange(next as AuthFilesStatusFilterMode)
                        }
                      />
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className={styles.hint}>{t('common.loading')}</div>
                ) : pageItems.length === 0 ? (
                  <EmptyState
                    title={t('auth_files.search_empty_title')}
                    description={t('auth_files.search_empty_desc')}
                  />
                ) : (
                  <div
                    className={`${styles.fileGrid} ${quotaFilterType ? styles.fileGridQuotaManaged : ''} ${compactMode ? styles.fileGridCompact : ''}`}
                  >
                    {pageItems.map((file) => (
                      <AuthFileCard
                        key={file.name}
                        file={file}
                        compact={compactMode}
                        selected={selectedFiles.has(file.name)}
                        resolvedTheme={resolvedTheme}
                        disableControls={disableControls}
                        deleting={deleting}
                        statusUpdating={statusUpdating}
                        quotaFilterType={quotaFilterType}
                        statusBarCache={statusBarCache}
                        onShowModels={showModels}
                        onDownload={handleDownload}
                        onDownloadSub2API={handleDownloadSub2API}
                        onOpenPrefixProxyEditor={openPrefixProxyEditor}
                        onDelete={handleDelete}
                        onToggleStatus={handleStatusToggle}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </div>
                )}

                {!loading && sorted.length > pageSize && (
                  <div className={styles.pagination}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage <= 1}
                    >
                      {t('auth_files.pagination_prev')}
                    </Button>
                    <div className={styles.pageInfo}>
                      {t('auth_files.pagination_info', {
                        current: currentPage,
                        total: totalPages,
                        count: sorted.length,
                      })}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage >= totalPages}
                    >
                      {t('auth_files.pagination_next')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </Card>

      <OAuthExcludedCard
        disableControls={disableControls}
        excludedError={excludedError}
        excluded={excluded}
        onAdd={() => openExcludedEditor()}
        onEdit={openExcludedEditor}
        onDelete={deleteExcluded}
      />

      <OAuthModelAliasCard
        disableControls={disableControls}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAdd={() => openModelAliasEditor()}
        onEditProvider={openModelAliasEditor}
        onDeleteProvider={deleteModelAlias}
        modelAliasError={modelAliasError}
        modelAlias={modelAlias}
        allProviderModels={allProviderModels}
        onUpdate={handleMappingUpdate}
        onDeleteLink={handleDeleteLink}
        onToggleFork={handleToggleFork}
        onRenameAlias={handleRenameAlias}
        onDeleteAlias={handleDeleteAlias}
      />

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      <DeleteFailedUsageCredentialsModal
        open={failedUsageModalOpen}
        loading={failedUsageLoading}
        deleting={failedUsageDeleting}
        typeFilter={failedUsageTypeFilter}
        groups={failedUsageGroups}
        onClose={() => {
          if (!failedUsageDeleting) {
            setFailedUsageModalOpen(false);
          }
        }}
        onConfirm={handleConfirmDeleteFailedUsage}
      />

      <Modal
        open={pasteJsonModalOpen}
        title={t('auth_files.paste_json_title')}
        onClose={closePasteJsonModal}
        width={720}
        closeDisabled={uploading}
        footer={
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={closePasteJsonModal} disabled={uploading}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handlePasteJsonSubmit()} loading={uploading}>
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <div className={styles.formGroup}>
          <label>{t('auth_files.paste_json_format_label')}</label>
          <Select
            value={pasteJsonFormat}
            options={pasteJsonFormatOptions}
            onChange={(value) => setPasteJsonFormat(value as PasteJsonFormat)}
            ariaLabel={t('auth_files.paste_json_format_label')}
            fullWidth
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="auth-file-paste-json">{t('auth_files.paste_json_label')}</label>
          <textarea
            id="auth-file-paste-json"
            className={`${styles.textarea} ${styles.jsonPasteTextarea}`}
            value={pasteJsonText}
            onChange={(event) => setPasteJsonText(event.currentTarget.value)}
            placeholder={t('auth_files.paste_json_placeholder')}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
          <p className={styles.jsonPasteHint}>{t('auth_files.paste_json_hint')}</p>
        </div>
      </Modal>

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_page')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(sorted)}
                    disabled={selectableFilteredItems.length === 0}
                  >
                    {t('auth_files.batch_select_filtered')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => invertVisibleSelection(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_invert_page')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void batchDownload(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('auth_files.batch_download')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
