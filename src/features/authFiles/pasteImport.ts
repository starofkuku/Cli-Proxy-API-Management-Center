import { convertCodexCredentialDocument } from '@/utils/codexCredentialFormat';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSub2APIAccount = (value: JsonRecord): boolean =>
  String(value.platform ?? '').toLowerCase() === 'openai' &&
  String(value.type ?? '').toLowerCase() === 'oauth' &&
  isRecord(value.credentials);

const isSub2APIDocument = (value: JsonRecord): boolean =>
  String(value.type ?? '').toLowerCase() === 'sub2api-data' || Array.isArray(value.accounts);

const asRecordList = (value: unknown): JsonRecord[] => {
  if (Array.isArray(value) && value.every(isRecord)) return value;
  if (isRecord(value)) return [value];
  throw new Error('Converted credential data must contain JSON objects');
};

const normalizeEntry = (value: JsonRecord): JsonRecord[] => {
  if (isSub2APIDocument(value) || isSub2APIAccount(value)) {
    return asRecordList(convertCodexCredentialDocument(value, 'sub2api-to-cpa'));
  }
  return [value];
};

export const normalizePastedAuthDocuments = (value: unknown): JsonRecord[] => {
  if (Array.isArray(value)) {
    if (!value.every(isRecord)) throw new Error('Credential arrays must contain JSON objects');
    const documents = value.flatMap(normalizeEntry);
    if (documents.length === 0) throw new Error('Credential array is empty');
    return documents;
  }
  if (!isRecord(value)) throw new Error('JSON root must be an object or array');
  return normalizeEntry(value);
};

export const parsePastedAuthText = (text: string): JsonRecord[] =>
  normalizePastedAuthDocuments(JSON.parse(text) as unknown);
