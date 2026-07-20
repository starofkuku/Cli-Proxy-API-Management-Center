import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { providersApi } from '@/services/api';
import { useThemeStore, useConfigStore } from '@/stores';
import type { OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import {
  StatCards,
  UsageChart,
  ChartLineSelector,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  TokenBreakdownChart,
  CostTrendChart,
  ServiceHealthCard,
  SourceTreeFilter,
  type SourceTreeGroup,
  type SourceTreeOption,
  type SourceTreeTypeGroup,
  useUsageData,
  useSparklines,
  useChartData,
} from '@/components/usage';
import {
  collectUsageDetails,
  extractTotalTokens,
  getModelNamesFromUsage,
  getApiStats,
  getModelStats,
  normalizeAuthIndex,
  normalizeUsageSourceId,
  resolveUsageTimeRangeQuery,
  type UsageTimeRange,
} from '@/utils/usage';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import type { UsagePayload } from '@/components/usage';
import styles from './UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v2';
const DEFAULT_CHART_LINES = ['all'];
const DEFAULT_TIME_RANGE: UsageTimeRange = 'today';
const MAX_CHART_LINES = 9;
const SOURCE_GROUP_ORDER = ['provider', 'authFile', 'other'] as const;
const PROVIDER_SOURCE_TYPES = new Set(['gemini', 'claude', 'codex', 'vertex', 'openai']);
const SOURCE_TYPE_ORDER = [
  'codex',
  'claude',
  'gemini',
  'antigravity',
  'kimi',
  'xai',
  'grok',
  'vertex',
  'openai',
] as const;
const SOURCE_TYPE_LABELS: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  kimi: 'Kimi',
  xai: 'xAI',
  grok: 'Grok',
  vertex: 'Vertex',
  openai: 'OpenAI',
};
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: '7h', labelKey: 'usage_stats.range_7h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: 'today', labelKey: 'usage_stats.range_today' },
  { value: 'yesterday', labelKey: 'usage_stats.range_yesterday' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: 'all', labelKey: 'usage_stats.range_all' },
];
const HOUR_WINDOW_BY_TIME_RANGE: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  today: 24,
  yesterday: 24,
  '7h': 7,
  '24h': 24,
  '7d': 7 * 24,
};

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === 'today' ||
  value === 'yesterday' ||
  value === '7h' ||
  value === '24h' ||
  value === '7d' ||
  value === 'all';

const normalizeChartLines = (value: unknown, maxLines = MAX_CHART_LINES): string[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }

  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }
    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }
    return normalizeChartLines(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeDetailSource = (detail: Record<string, unknown>) =>
  normalizeUsageSourceId(detail.source);

const readDetailAuthIndex = (detail: Record<string, unknown>) =>
  detail.auth_index ?? detail.authIndex ?? detail.AuthIndex ?? null;

const resolveSourceGroupId = (identityKey: string, type: string): SourceTreeGroup['id'] => {
  if (identityKey.startsWith('auth:')) return 'authFile';
  if (PROVIDER_SOURCE_TYPES.has(type.toLowerCase())) return 'provider';
  return 'other';
};

const normalizeSourceTypeKey = (type: string): string => {
  const normalized = type.trim().toLowerCase();
  return normalized || 'unknown';
};

const formatSourceTypeLabel = (
  typeKey: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  if (typeKey === 'unknown') {
    return t('usage_stats.source_type_unknown');
  }
  return SOURCE_TYPE_LABELS[typeKey] ?? typeKey;
};

const compareSourceTypeKeys = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a === 'unknown') return 1;
  if (b === 'unknown') return -1;
  const aIndex = SOURCE_TYPE_ORDER.indexOf(a as (typeof SOURCE_TYPE_ORDER)[number]);
  const bIndex = SOURCE_TYPE_ORDER.indexOf(b as (typeof SOURCE_TYPE_ORDER)[number]);
  if (aIndex !== -1 || bIndex !== -1) {
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  }
  return a.localeCompare(b);
};

const buildTypeGroups = (
  options: SourceTreeOption[],
  t: (key: string, options?: Record<string, unknown>) => string
): SourceTreeTypeGroup[] => {
  const byType = new Map<string, SourceTreeOption[]>();

  options.forEach((option) => {
    const typeKey = normalizeSourceTypeKey(option.type);
    const list = byType.get(typeKey) ?? [];
    list.push(option);
    byType.set(typeKey, list);
  });

  return Array.from(byType.entries())
    .sort(([a], [b]) => compareSourceTypeKeys(a, b))
    .map(([typeKey, typeOptions]) => ({
      id: typeKey,
      label: formatSourceTypeLabel(typeKey, t),
      options: typeOptions.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }));
};

const buildSourceTreeGroups = (
  usage: UsagePayload | null,
  sourceInfoMap: ReturnType<typeof buildSourceInfoMap>,
  authFileMap: Map<string, CredentialInfo>,
  t: (key: string, options?: Record<string, unknown>) => string
): SourceTreeGroup[] => {
  const optionMap = new Map<
    string,
    {
      key: string;
      label: string;
      type: string;
      count: number;
      groupId: SourceTreeGroup['id'];
    }
  >();

  collectUsageDetails(usage).forEach((detail) => {
    const sourceInfo = resolveSourceDisplay(
      detail.source ?? '',
      detail.auth_index,
      sourceInfoMap,
      authFileMap
    );
    const key = sourceInfo.identityKey ?? `source:${detail.source || sourceInfo.displayName}`;
    const existing = optionMap.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }

    optionMap.set(key, {
      key,
      label: sourceInfo.displayName,
      type: sourceInfo.type,
      count: 1,
      groupId: resolveSourceGroupId(key, sourceInfo.type),
    });
  });

  const grouped = new Map<SourceTreeGroup['id'], SourceTreeOption[]>();
  optionMap.forEach((option) => {
    const options = grouped.get(option.groupId) ?? [];
    options.push({
      key: option.key,
      label: option.label,
      type: option.type,
      count: option.count,
    });
    grouped.set(option.groupId, options);
  });

  return SOURCE_GROUP_ORDER.map((id) => {
    const options = grouped.get(id) ?? [];
    return {
      id,
      label:
        id === 'provider'
          ? t('usage_stats.source_group_provider')
          : id === 'authFile'
            ? t('usage_stats.source_group_auth_file')
            : t('usage_stats.source_group_other'),
      typeGroups: buildTypeGroups(options, t),
    };
  }).filter((group) => group.typeGroups.length > 0);
};

const createEmptyFilteredUsage = (usage: UsagePayload): UsagePayload => ({
  ...usage,
  total_requests: 0,
  success_count: 0,
  failure_count: 0,
  total_tokens: 0,
  apis: {},
});

const filterUsageBySelectedSources = (
  usage: UsagePayload | null,
  selectedSourceKeys: Set<string>,
  allSourceKeys: string[],
  sourceInfoMap: ReturnType<typeof buildSourceInfoMap>,
  authFileMap: Map<string, CredentialInfo>
): UsagePayload | null => {
  if (!usage) return usage;
  if (allSourceKeys.length === 0 || selectedSourceKeys.size === allSourceKeys.length) return usage;
  if (selectedSourceKeys.size === 0) return createEmptyFilteredUsage(usage);

  const apisRaw = isRecord(usage.apis) ? usage.apis : null;
  if (!apisRaw) return usage;

  const nextApis: Record<string, unknown> = {};
  let totalRequests = 0;
  let successCount = 0;
  let failureCount = 0;
  let totalTokens = 0;

  Object.entries(apisRaw).forEach(([endpoint, apiData]) => {
    if (!isRecord(apiData)) return;
    const modelsRaw = isRecord(apiData.models) ? apiData.models : null;
    if (!modelsRaw) return;

    const nextModels: Record<string, unknown> = {};
    let apiRequests = 0;
    let apiSuccess = 0;
    let apiFailure = 0;
    let apiTokens = 0;

    Object.entries(modelsRaw).forEach(([modelName, modelData]) => {
      if (!isRecord(modelData)) return;
      const detailsRaw = Array.isArray(modelData.details) ? modelData.details : [];
      const nextDetails = detailsRaw.filter((detail): detail is Record<string, unknown> => {
        if (!isRecord(detail)) return false;
        const sourceInfo = resolveSourceDisplay(
          normalizeDetailSource(detail),
          readDetailAuthIndex(detail),
          sourceInfoMap,
          authFileMap
        );
        const key =
          sourceInfo.identityKey ??
          `source:${normalizeDetailSource(detail) || sourceInfo.displayName}`;
        return selectedSourceKeys.has(key);
      });

      if (nextDetails.length === 0) return;

      let modelSuccess = 0;
      let modelFailure = 0;
      let modelTokens = 0;
      nextDetails.forEach((detail) => {
        if (detail.failed === true) {
          modelFailure += 1;
        } else {
          modelSuccess += 1;
        }
        modelTokens += extractTotalTokens({ ...(detail as object), __modelName: modelName });
      });

      const modelRequests = nextDetails.length;
      nextModels[modelName] = {
        ...modelData,
        details: nextDetails,
        total_requests: modelRequests,
        success_count: modelSuccess,
        failure_count: modelFailure,
        total_tokens: modelTokens,
      };

      apiRequests += modelRequests;
      apiSuccess += modelSuccess;
      apiFailure += modelFailure;
      apiTokens += modelTokens;
    });

    if (apiRequests === 0) return;

    nextApis[endpoint] = {
      ...apiData,
      models: nextModels,
      total_requests: apiRequests,
      success_count: apiSuccess,
      failure_count: apiFailure,
      total_tokens: apiTokens,
    };

    totalRequests += apiRequests;
    successCount += apiSuccess;
    failureCount += apiFailure;
    totalTokens += apiTokens;
  });

  return {
    ...usage,
    apis: nextApis,
    total_requests: totalRequests,
    success_count: successCount,
    failure_count: failureCount,
    total_tokens: totalTokens,
  };
};

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const config = useConfigStore((state) => state.config);
  const openaiCompatibilityConfig = config?.openaiCompatibility;
  const [openaiProvidersWithAuthIndex, setOpenaiProvidersWithAuthIndex] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);
  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [customSelectedSourceKeys, setCustomSelectedSourceKeys] = useState<Set<string>>(new Set());
  const [sourceSelectionMode, setSourceSelectionMode] = useState<'all' | 'custom'>('all');
  const getUsageQueryParams = useCallback(() => resolveUsageTimeRangeQuery(timeRange), [timeRange]);

  // Data hook
  const {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  } = useUsageData(getUsageQueryParams);

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    let cancelled = false;

    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;

        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (!key) return;
          map.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString(),
          });
        });
        setAuthFileMap(map);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const source = openaiCompatibilityConfig;

    providersApi
      .getOpenAIProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex({ source, providers: providers || [] });
      })
      .catch(() => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex(null);
      });

    return () => {
      cancelled = true;
    };
  }, [openaiCompatibilityConfig]);

  const openaiProviderState = openaiProvidersWithAuthIndex;
  const openaiProvidersForUsage = useMemo(
    () =>
      openaiProviderState && openaiProviderState.source === openaiCompatibilityConfig
        ? openaiProviderState.providers
        : (openaiCompatibilityConfig ?? []),
    [openaiCompatibilityConfig, openaiProviderState]
  );

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t]
  );

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: config?.geminiApiKeys || [],
        claudeApiKeys: config?.claudeApiKeys || [],
        codexApiKeys: config?.codexApiKeys || [],
        vertexApiKeys: config?.vertexApiKeys || [],
        openaiCompatibility: openaiProvidersForUsage,
      }),
    [
      config?.claudeApiKeys,
      config?.codexApiKeys,
      config?.geminiApiKeys,
      config?.vertexApiKeys,
      openaiProvidersForUsage,
    ]
  );

  const sourceTreeGroups = useMemo(
    () => buildSourceTreeGroups(usage, sourceInfoMap, authFileMap, t),
    [authFileMap, sourceInfoMap, t, usage]
  );
  const sourceOptionKeys = useMemo(
    () =>
      sourceTreeGroups.flatMap((group) =>
        group.typeGroups.flatMap((typeGroup) => typeGroup.options.map((option) => option.key))
      ),
    [sourceTreeGroups]
  );
  const selectedSourceKeys = useMemo(
    () =>
      sourceSelectionMode === 'all'
        ? new Set(sourceOptionKeys)
        : new Set(sourceOptionKeys.filter((key) => customSelectedSourceKeys.has(key))),
    [customSelectedSourceKeys, sourceOptionKeys, sourceSelectionMode]
  );

  const handleSourceSelectionChange = useCallback(
    (nextKeys: Set<string>) => {
      setSourceSelectionMode(nextKeys.size === sourceOptionKeys.length ? 'all' : 'custom');
      setCustomSelectedSourceKeys(nextKeys);
    },
    [sourceOptionKeys.length]
  );

  const filteredUsage = useMemo(
    () =>
      filterUsageBySelectedSources(
        usage,
        selectedSourceKeys,
        sourceOptionKeys,
        sourceInfoMap,
        authFileMap
      ),
    [authFileMap, selectedSourceKeys, sourceInfoMap, sourceOptionKeys, usage]
  );
  const hourWindowHours = timeRange === 'all' ? undefined : HOUR_WINDOW_BY_TIME_RANGE[timeRange];

  const handleChartLinesChange = useCallback((lines: string[]) => {
    setChartLines(normalizeChartLines(lines));
  }, []);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CHART_LINES_STORAGE_KEY, JSON.stringify(chartLines));
    } catch {
      // Ignore storage errors.
    }
  }, [chartLines]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  const nowMs = lastRefreshedAt?.getTime() ?? 0;

  // Sparklines hook
  const { requestsSparkline, tokensSparkline, rpmSparkline, tpmSparkline, costSparkline } =
    useSparklines({ usage: filteredUsage, loading, nowMs });

  // Chart data hook
  const {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions,
  } = useChartData({ usage: filteredUsage, chartLines, isDark, isMobile, hourWindowHours });

  // Derived data
  const modelNames = useMemo(() => getModelNamesFromUsage(filteredUsage), [filteredUsage]);
  const apiStats = useMemo(
    () => getApiStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const modelStats = useMemo(
    () => getModelStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const hasPrices = Object.keys(modelPrices).length > 0;

  return (
    <div className={styles.container}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => {
                if (isUsageTimeRange(value)) {
                  setSourceSelectionMode('all');
                  setCustomSelectedSourceKeys(new Set());
                  setTimeRange(value);
                }
              }}
              className={styles.timeRangeSelectControl}
              ariaLabel={t('usage_stats.range_filter')}
              fullWidth={false}
            />
          </div>
          <SourceTreeFilter
            groups={sourceTreeGroups}
            selectedKeys={selectedSourceKeys}
            onChange={handleSourceSelectionChange}
            disabled={loading || sourceOptionKeys.length === 0}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Stats Overview Cards */}
      <StatCards
        usage={filteredUsage}
        loading={loading}
        modelPrices={modelPrices}
        nowMs={nowMs}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline,
        }}
      />

      {/* Chart Line Selection */}
      <ChartLineSelector
        chartLines={chartLines}
        modelNames={modelNames}
        maxLines={MAX_CHART_LINES}
        onChange={handleChartLinesChange}
      />

      {/* Service Health */}
      <ServiceHealthCard usage={filteredUsage} loading={loading} />

      {/* Charts Grid */}
      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={requestsPeriod}
          onPeriodChange={setRequestsPeriod}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={tokensPeriod}
          onPeriodChange={setTokensPeriod}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
      </div>

      {/* Token Breakdown Chart */}
      <TokenBreakdownChart
        usage={filteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        hourWindowHours={hourWindowHours}
      />

      {/* Cost Trend Chart */}
      <CostTrendChart
        usage={filteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        modelPrices={modelPrices}
        hourWindowHours={hourWindowHours}
      />

      {/* Details Grid */}
      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
        <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
      </div>

      <RequestEventsDetailsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      {/* Credential Stats */}
      <CredentialStatsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      {/* Price Settings */}
      <PriceSettingsCard
        modelNames={modelNames}
        modelPrices={modelPrices}
        onPricesChange={setModelPrices}
      />
    </div>
  );
}
