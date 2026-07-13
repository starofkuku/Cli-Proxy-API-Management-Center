type JsonRecord = Record<string, unknown>;

type SessionLikeObject = {
  value: JsonRecord;
  sourceName: string;
  path: string;
};

type ConvertedSession = {
  cpa: JsonRecord;
};

const isPlainObject = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstNonEmpty = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
};

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const encodeBase64UrlJson = (value: unknown) =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

const parseJwtPayload = (token: unknown): JsonRecord | undefined => {
  if (typeof token !== 'string' || token.trim() === '') {
    return undefined;
  }

  const segments = token.split('.');
  if (segments.length < 2) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(segments[1])) as unknown;
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const getOpenAIAuthSection = (payload: unknown): JsonRecord => {
  if (!isPlainObject(payload)) {
    return {};
  }

  const auth = payload['https://api.openai.com/auth'];
  return isPlainObject(auth) ? auth : {};
};

const getOpenAIProfileSection = (payload: unknown): JsonRecord => {
  if (!isPlainObject(payload)) {
    return {};
  }

  const profile = payload['https://api.openai.com/profile'];
  return isPlainObject(profile) ? profile : {};
};

const normalizeTimestamp = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const timestampFromUnixSeconds = (value: unknown): string | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const date = new Date(numeric * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const epochSecondsFromValue = (value: unknown): number => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
};

const buildSyntheticCodexIdToken = (
  email: string | undefined,
  accountId: string | undefined,
  planType: string | undefined,
  userId: string | undefined,
  expiresAt: string | undefined
) => {
  if (!accountId) {
    return undefined;
  }

  const now = Math.trunc(Date.now() / 1000);
  const authInfo: JsonRecord = { chatgpt_account_id: accountId };
  const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;

  if (planType) {
    authInfo.chatgpt_plan_type = planType;
  }

  if (userId) {
    authInfo.chatgpt_user_id = userId;
    authInfo.user_id = userId;
  }

  const payload: JsonRecord = {
    iat: now,
    exp: expires,
    'https://api.openai.com/auth': authInfo,
  };

  if (email) {
    payload.email = email;
  }

  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT', cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.synthetic`;
};

const collectSessionLikeObjects = (
  value: unknown,
  sourceName = 'pasted-json'
): SessionLikeObject[] => {
  const found: SessionLikeObject[] = [];
  const visited = new WeakSet<object>();

  function visit(item: unknown, path: string) {
    if (!isPlainObject(item) && !Array.isArray(item)) {
      return;
    }

    if (isPlainObject(item)) {
      if (visited.has(item)) {
        return;
      }
      visited.add(item);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        (item.tokens as JsonRecord | undefined)?.accessToken,
        (item.tokens as JsonRecord | undefined)?.access_token,
        (item.token as JsonRecord | undefined)?.accessToken,
        (item.token as JsonRecord | undefined)?.access_token,
        (item.credentials as JsonRecord | undefined)?.accessToken,
        (item.credentials as JsonRecord | undefined)?.access_token
      );
      const hasIdentity =
        isPlainObject(item.user) ||
        firstNonEmpty(
          item.email,
          item.name,
          item.label,
          (item.meta as JsonRecord | undefined)?.label,
          (item.tokens as JsonRecord | undefined)?.accountId,
          (item.tokens as JsonRecord | undefined)?.account_id,
          (item.tokens as JsonRecord | undefined)?.chatgptAccountId,
          (item.tokens as JsonRecord | undefined)?.chatgpt_account_id,
          (item.providerSpecificData as JsonRecord | undefined)?.chatgptAccountId,
          (item.providerSpecificData as JsonRecord | undefined)?.chatgpt_account_id,
          item.id
        );
      if (token && hasIdentity) {
        found.push({ value: item, sourceName, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === 'accessToken' || key === 'access_token' || key === 'sessionToken') {
          continue;
        }
        visit(child, `${path}.${key}`);
      }
      return;
    }

    item.forEach((child, index) => visit(child, `${path}[${index}]`));
  }

  visit(value, '$');
  return found;
};

const parseInputDocuments = (text: string): SessionLikeObject[] => {
  if (typeof text !== 'string' || text.trim() === '') {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const ErrorWithCause = Error as new (
      message?: string,
      options?: { cause?: unknown }
    ) => Error;
    throw new ErrorWithCause(
      `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  return collectSessionLikeObjects(parsed);
};

const convertSession = (record: JsonRecord, options: { now?: Date; sourceName?: string } = {}) => {
  if (!isPlainObject(record)) {
    throw new Error('session 不是 JSON 对象');
  }

  const recordUser = record.user as JsonRecord | undefined;
  const recordAccount = record.account as JsonRecord | undefined;
  const recordTokens = record.tokens as JsonRecord | undefined;
  const recordToken = record.token as JsonRecord | undefined;
  const recordCredentials = record.credentials as JsonRecord | undefined;
  const recordMeta = record.meta as JsonRecord | undefined;
  const recordProviderSpecificData = record.providerSpecificData as JsonRecord | undefined;

  const accessToken = firstNonEmpty(
    record.accessToken,
    record.access_token,
    recordTokens?.accessToken,
    recordTokens?.access_token,
    recordToken?.accessToken,
    recordToken?.access_token,
    recordCredentials?.accessToken,
    recordCredentials?.access_token
  );
  if (!accessToken) {
    throw new Error('缺少 accessToken');
  }
  const sessionToken = firstNonEmpty(
    record.sessionToken,
    record.session_token,
    recordTokens?.sessionToken,
    recordTokens?.session_token,
    recordToken?.sessionToken,
    recordToken?.session_token,
    recordCredentials?.session_token
  );
  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    recordTokens?.refreshToken,
    recordTokens?.refresh_token,
    recordToken?.refreshToken,
    recordToken?.refresh_token,
    recordCredentials?.refresh_token
  );
  const inputIdToken = firstNonEmpty(
    record.idToken,
    record.id_token,
    recordTokens?.idToken,
    recordTokens?.id_token,
    recordToken?.idToken,
    recordToken?.id_token,
    recordCredentials?.id_token
  );

  const payload = parseJwtPayload(accessToken);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = getOpenAIAuthSection(payload);
  const idAuth = getOpenAIAuthSection(idPayload);
  const profile = getOpenAIProfileSection(payload);
  const hasRefreshToken = Boolean(refreshToken);
  const expiresAt = hasRefreshToken
    ? undefined
    : firstNonEmpty(
        payload ? timestampFromUnixSeconds(payload.exp) : undefined,
        normalizeTimestamp(record.expires),
        normalizeTimestamp(record.expiresAt),
        normalizeTimestamp(record.expired),
        normalizeTimestamp(record.expires_at)
      );
  const email = firstNonEmpty(
    recordUser?.email,
    record.email,
    recordMeta?.label,
    record.label,
    recordCredentials?.email,
    recordProviderSpecificData?.email,
    profile.email,
    idPayload?.email,
    payload?.email
  );
  const accountId = firstNonEmpty(
    recordAccount?.id,
    record.account_id,
    recordTokens?.accountId,
    recordTokens?.account_id,
    record.chatgptAccountId,
    record.chatgpt_account_id,
    recordMeta?.chatgptAccountId,
    recordMeta?.chatgpt_account_id,
    recordTokens?.chatgptAccountId,
    recordTokens?.chatgpt_account_id,
    recordProviderSpecificData?.chatgptAccountId,
    recordProviderSpecificData?.chatgpt_account_id,
    recordCredentials?.chatgpt_account_id,
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
    record.provider === 'codex' ? record.id : undefined
  );
  const userId = firstNonEmpty(
    recordUser?.id,
    record.user_id,
    record.chatgptUserId,
    recordProviderSpecificData?.chatgptUserId,
    recordProviderSpecificData?.chatgpt_user_id,
    auth.chatgpt_user_id,
    auth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id
  );
  const planType = firstNonEmpty(
    recordAccount?.planType,
    recordAccount?.plan_type,
    record.planType,
    record.plan_type,
    recordProviderSpecificData?.chatgptPlanType,
    recordProviderSpecificData?.chatgpt_plan_type,
    recordCredentials?.plan_type,
    auth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type
  );
  const exportedAt = normalizeTimestamp(options.now || new Date());
  const sourceName = firstNonEmpty(options.sourceName, 'pasted-json');
  const name = firstNonEmpty(email, sourceName, 'ChatGPT Account');
  const syntheticIdToken = !inputIdToken
    ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt)
    : undefined;
  const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);

  const cpa = Object.fromEntries(
    Object.entries({
      type: 'codex',
      account_id: accountId,
      chatgpt_account_id: accountId,
      email,
      name,
      plan_type: planType,
      chatgpt_plan_type: planType,
      id_token: idToken,
      id_token_synthetic: Boolean(syntheticIdToken) || undefined,
      access_token: accessToken,
      refresh_token: refreshToken || '',
      session_token: sessionToken,
      last_refresh: exportedAt,
      expired: expiresAt,
      disabled: Boolean(record.disabled) || undefined,
    }).filter(([, value]) => value !== undefined && value !== null)
  );

  return {
    cpa,
  };
};

export const convertGptSessionTextToCpaDocument = (text: string): JsonRecord | JsonRecord[] => {
  const sources = parseInputDocuments(text);
  const converted: ConvertedSession[] = [];
  const skipped: Array<{ sourceName: string; path: string; reason: string }> = [];
  const now = new Date();

  sources.forEach((item, index) => {
    try {
      converted.push(
        convertSession(item.value, {
          now,
          sourceName: item.sourceName,
        })
      );
    } catch (error) {
      skipped.push({
        sourceName: item.sourceName,
        path: item.path || `$[${index}]`,
        reason: error instanceof Error ? error.message : '无法转换',
      });
    }
  });

  if (!sources.length) {
    skipped.push({
      sourceName: 'pasted-json',
      path: '$',
      reason: '未找到包含 accessToken 和 user/email 的 session 对象',
    });
  }

  if (!converted.length) {
    const reason = skipped
      .map((item) => `${item.sourceName} ${item.path}: ${item.reason}`)
      .join('; ');
    throw new Error(reason || '无法转换');
  }

  return converted.length === 1 ? converted[0].cpa : converted.map((item) => item.cpa);
};
