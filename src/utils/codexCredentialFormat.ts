export const DEFAULT_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export type CodexCredentialConversionDirection = 'cpa-to-sub2api' | 'sub2api-to-cpa';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const setString = (target: JsonRecord, key: string, value: unknown) => {
  if (typeof value === 'string' && value.trim()) target[key] = value.trim();
};

const decodeJwtPayload = (token: unknown): JsonRecord => {
  if (typeof token !== 'string') return {};
  const segments = token.split('.');
  if (segments.length < 2) return {};

  try {
    const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const getAuthClaims = (claims: JsonRecord): JsonRecord => {
  const auth = claims['https://api.openai.com/auth'];
  return isRecord(auth) ? auth : {};
};

const getDefaultOrganizationID = (authClaims: JsonRecord): string | undefined => {
  const organizations = authClaims.organizations;
  if (!Array.isArray(organizations)) return undefined;
  const records = organizations.filter(isRecord);
  const selected = records.find((item) => item.is_default === true) ?? records[0];
  return selected ? firstString(selected.id) : undefined;
};

const toEpochSeconds = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value > 1e11 ? value / 1000 : value);
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.trunc(timestamp / 1000) : undefined;
};

const toISOString = (value: unknown): string | undefined => {
  const epochSeconds = toEpochSeconds(value);
  if (epochSeconds === undefined) return undefined;
  const date = new Date(epochSeconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const credentialClaims = (source: JsonRecord, credentials?: JsonRecord) => {
  const idToken = credentials?.id_token ?? source.id_token;
  const accessToken = credentials?.access_token ?? source.access_token;
  const idClaims = decodeJwtPayload(idToken);
  return Object.keys(idClaims).length > 0 ? idClaims : decodeJwtPayload(accessToken);
};

const convertCpaEntryToSub2API = (source: JsonRecord): JsonRecord => {
  const claims = credentialClaims(source);
  const authClaims = getAuthClaims(claims);
  const accessToken = firstString(source.access_token, source.accessToken);
  const refreshToken = firstString(source.refresh_token, source.refreshToken);
  if (!accessToken && !refreshToken) {
    throw new Error('CPA credential is missing access_token and refresh_token');
  }

  const email = firstString(source.email, claims.email);
  const accountID = firstString(
    source.chatgpt_account_id,
    source.account_id,
    authClaims.chatgpt_account_id,
    authClaims.account_id
  );
  const userID = firstString(
    source.chatgpt_user_id,
    source.user_id,
    authClaims.chatgpt_user_id,
    authClaims.user_id
  );
  const planType = firstString(
    source.plan_type,
    source.chatgpt_plan_type,
    authClaims.chatgpt_plan_type,
    authClaims.plan_type
  );
  const expiresAt =
    toEpochSeconds(source.expires_at ?? source.expired ?? source.expire) ??
    toEpochSeconds(claims.exp);
  const credentials: JsonRecord = {};
  setString(credentials, 'access_token', accessToken);
  setString(credentials, 'refresh_token', refreshToken);
  setString(credentials, 'id_token', source.id_token);
  if (expiresAt !== undefined) credentials.expires_at = expiresAt;
  credentials.client_id =
    firstString(source.client_id, source.clientId) ?? DEFAULT_CODEX_CLIENT_ID;
  setString(credentials, 'email', email);
  setString(credentials, 'chatgpt_account_id', accountID);
  setString(credentials, 'chatgpt_user_id', userID);
  setString(
    credentials,
    'organization_id',
    firstString(source.organization_id, getDefaultOrganizationID(authClaims))
  );
  setString(credentials, 'plan_type', planType);
  setString(credentials, 'subscription_expires_at', source.subscription_expires_at);

  const result: JsonRecord = {
    name: firstString(source.name, email, accountID) ?? 'OpenAI OAuth Account',
    platform: 'openai',
    type: 'oauth',
    credentials,
  };
  if (isRecord(source.extra) && Object.keys(source.extra).length > 0) {
    result.extra = { ...source.extra };
  }
  return result;
};

const convertSub2APIEntryToCpa = (source: JsonRecord): JsonRecord => {
  const credentials = isRecord(source.credentials) ? source.credentials : source;
  const accessToken = firstString(credentials.access_token, credentials.accessToken);
  const refreshToken = firstString(credentials.refresh_token, credentials.refreshToken);
  if (!accessToken && !refreshToken) {
    throw new Error('Sub2API credential is missing credentials.access_token and refresh_token');
  }

  const claims = credentialClaims(source, credentials);
  const authClaims = getAuthClaims(claims);
  const email = firstString(credentials.email, source.email, claims.email);
  const accountID = firstString(
    credentials.chatgpt_account_id,
    credentials.account_id,
    source.chatgpt_account_id,
    source.account_id,
    authClaims.chatgpt_account_id,
    authClaims.account_id
  );
  const userID = firstString(
    credentials.chatgpt_user_id,
    credentials.user_id,
    source.chatgpt_user_id,
    source.user_id,
    authClaims.chatgpt_user_id,
    authClaims.user_id
  );
  const planType = firstString(
    credentials.plan_type,
    credentials.chatgpt_plan_type,
    source.plan_type,
    authClaims.chatgpt_plan_type,
    authClaims.plan_type
  );
  const expired =
    toISOString(credentials.expires_at ?? source.expires_at ?? source.expired) ??
    toISOString(claims.exp);
  const result: JsonRecord = {
    type: 'codex',
    name: firstString(source.name, email, accountID) ?? 'OpenAI OAuth Account',
    last_refresh: firstString(source.last_refresh) ?? new Date().toISOString(),
    client_id:
      firstString(credentials.client_id, source.client_id) ?? DEFAULT_CODEX_CLIENT_ID,
  };
  setString(result, 'access_token', accessToken);
  setString(result, 'refresh_token', refreshToken);
  setString(result, 'id_token', credentials.id_token);
  setString(result, 'account_id', accountID);
  setString(result, 'chatgpt_account_id', accountID);
  setString(result, 'chatgpt_user_id', userID);
  setString(result, 'email', email);
  setString(result, 'plan_type', planType);
  setString(result, 'chatgpt_plan_type', planType);
  setString(result, 'organization_id', credentials.organization_id);
  setString(result, 'subscription_expires_at', credentials.subscription_expires_at);
  setString(result, 'expired', expired);
  return result;
};

const collectCpaEntries = (input: unknown): { entries: JsonRecord[]; collection: boolean } => {
  if (Array.isArray(input)) return { entries: input.filter(isRecord), collection: true };
  if (!isRecord(input)) throw new Error('JSON root must be an object or array');
  if (Array.isArray(input.files)) {
    return {
      entries: input.files
        .map((item) => (isRecord(item) && isRecord(item.content) ? item.content : item))
        .filter(isRecord),
      collection: true,
    };
  }
  return { entries: [input], collection: false };
};

const collectSub2APIEntries = (input: unknown): { entries: JsonRecord[]; collection: boolean } => {
  if (Array.isArray(input)) return { entries: input.filter(isRecord), collection: true };
  if (!isRecord(input)) throw new Error('JSON root must be an object or array');
  if (Array.isArray(input.accounts)) {
    return { entries: input.accounts.filter(isRecord), collection: true };
  }
  return { entries: [input], collection: false };
};

export const convertCodexCredentialDocument = (
  input: unknown,
  direction: CodexCredentialConversionDirection
): JsonRecord | JsonRecord[] => {
  const collected =
    direction === 'cpa-to-sub2api' ? collectCpaEntries(input) : collectSub2APIEntries(input);
  if (collected.entries.length === 0) throw new Error('No credential objects found');
  const converted = collected.entries.map((entry) =>
    direction === 'cpa-to-sub2api'
      ? convertCpaEntryToSub2API(entry)
      : convertSub2APIEntryToCpa(entry)
  );
  return collected.collection ? converted : converted[0];
};

export const convertCodexCredentialText = (
  text: string,
  direction: CodexCredentialConversionDirection
) => convertCodexCredentialDocument(JSON.parse(text) as unknown, direction);
