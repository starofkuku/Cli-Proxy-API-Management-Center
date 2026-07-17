import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { IconDownload, IconFileText } from '@/components/ui/icons';
import { authFilesApi } from '@/services/api';
import { downloadBlob } from '@/utils/download';
import {
  DEFAULT_CODEX_CLIENT_ID,
  convertCodexCredentialText,
  type CodexCredentialConversionDirection,
} from '@/utils/codexCredentialFormat';
import styles from './CodexFormatConverter.module.scss';

type ConverterMode = 'json' | 'refresh-token';

export function CodexFormatConverter({ backendDisabled = false }: { backendDisabled?: boolean }) {
  const { t } = useTranslation();
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<ConverterMode>('json');
  const [direction, setDirection] =
    useState<CodexCredentialConversionDirection>('cpa-to-sub2api');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [clientID, setClientID] = useState(DEFAULT_CODEX_CLIENT_ID);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [converting, setConverting] = useState(false);

  const directionOptions = useMemo(
    () => [
      {
        value: 'cpa-to-sub2api',
        label: t('config_management.visual.sections.converter.direction_cpa_to_sub2api'),
      },
      {
        value: 'sub2api-to-cpa',
        label: t('config_management.visual.sections.converter.direction_sub2api_to_cpa'),
      },
    ],
    [t]
  );

  const switchMode = (nextMode: ConverterMode) => {
    setMode(nextMode);
    setInput('');
    setOutput('');
    setError('');
    setSummary('');
  };

  const convertJSON = () => {
    setError('');
    setSummary('');
    try {
      const converted = convertCodexCredentialText(input, direction);
      setOutput(JSON.stringify(converted, null, 2));
    } catch (conversionError) {
      setOutput('');
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : t('config_management.visual.sections.converter.invalid_json')
      );
    }
  };

  const convertRefreshTokens = async () => {
    setError('');
    setSummary('');
    if (!input.trim()) {
      setError(t('config_management.visual.sections.converter.rt_required'));
      return;
    }

    setConverting(true);
    try {
      const result = await authFilesApi.convertCodexRefreshTokens(input, clientID.trim());
      setSummary(
        t('config_management.visual.sections.converter.rt_summary', {
          total: result.total,
          saved: result.saved,
          failed: result.failedCount,
        })
      );
      setInput('');
    } catch (conversionError) {
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : t('config_management.visual.sections.converter.import_failed')
      );
    } finally {
      setConverting(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setInput(await file.text());
      setOutput('');
      setError('');
      setSummary('');
    } catch {
      setError(t('config_management.visual.sections.converter.file_read_failed'));
    }
  };

  const handleDownload = () => {
    if (!output) return;
    const target = direction === 'cpa-to-sub2api' ? 'sub2api' : 'cpa';
    downloadBlob({
      filename: `codex-${target}-${new Date().toISOString().slice(0, 10)}.json`,
      blob: new Blob([output], { type: 'application/json;charset=utf-8' }),
    });
  };

  return (
    <div className={styles.converter}>
      <div className={styles.modeSwitch}>
        <button
          type="button"
          className={`${styles.modeButton} ${mode === 'json' ? styles.modeButtonActive : ''}`}
          onClick={() => switchMode('json')}
        >
          {t('config_management.visual.sections.converter.mode_json')}
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${mode === 'refresh-token' ? styles.modeButtonActive : ''}`}
          onClick={() => switchMode('refresh-token')}
        >
          {t('config_management.visual.sections.converter.mode_rt')}
        </button>
      </div>

      <div className={`${styles.workspace} ${mode === 'refresh-token' ? styles.workspaceSingle : ''}`}>
        <div className={styles.pane}>
          <div className={styles.paneHeader}>
            <div>
              <h3>{t('config_management.visual.sections.converter.input_title')}</h3>
              <p>
                {t(
                  mode === 'json'
                    ? 'config_management.visual.sections.converter.input_json_hint'
                    : 'config_management.visual.sections.converter.input_rt_hint'
                )}
              </p>
            </div>
            {mode === 'json' ? (
              <>
                <input
                  ref={uploadRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={handleFileChange}
                />
                <Button variant="secondary" size="sm" onClick={() => uploadRef.current?.click()}>
                  <IconFileText size={15} />
                  {t('config_management.visual.sections.converter.upload_json')}
                </Button>
              </>
            ) : null}
          </div>

          {mode === 'json' ? (
            <Select
              value={direction}
              options={directionOptions}
              onChange={(value) => setDirection(value as CodexCredentialConversionDirection)}
              ariaLabel={t('config_management.visual.sections.converter.direction_label')}
            />
          ) : (
            <Input
              label={t('config_management.visual.sections.converter.client_id')}
              value={clientID}
              onChange={(event) => setClientID(event.target.value)}
              disabled={backendDisabled || converting}
            />
          )}

          <textarea
            className={styles.textarea}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t(
              mode === 'json'
                ? 'config_management.visual.sections.converter.json_placeholder'
                : 'config_management.visual.sections.converter.rt_placeholder'
            )}
            spellCheck={false}
            aria-label={t('config_management.visual.sections.converter.input_title')}
          />

          <div className={styles.actionRow}>
            <Button
              onClick={mode === 'json' ? convertJSON : convertRefreshTokens}
              loading={converting}
              disabled={!input.trim() || (mode === 'refresh-token' && backendDisabled)}
            >
              {t(
                mode === 'json'
                  ? 'config_management.visual.sections.converter.convert_button'
                  : 'config_management.visual.sections.converter.import_button'
              )}
            </Button>
          </div>
          {mode === 'refresh-token' && summary ? (
            <div className={styles.summary}>{summary}</div>
          ) : null}
          {mode === 'refresh-token' && error ? <pre className={styles.error}>{error}</pre> : null}
        </div>

        {mode === 'json' ? (
          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <div>
                <h3>{t('config_management.visual.sections.converter.output_title')}</h3>
                <p>{t('config_management.visual.sections.converter.output_hint')}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleDownload} disabled={!output}>
                <IconDownload size={15} />
                {t('config_management.visual.sections.converter.download_json')}
              </Button>
            </div>
            <textarea
              className={`${styles.textarea} ${styles.output}`}
              value={output}
              readOnly
              placeholder={t('config_management.visual.sections.converter.output_placeholder')}
              spellCheck={false}
              aria-label={t('config_management.visual.sections.converter.output_title')}
            />
            {error ? <pre className={styles.error}>{error}</pre> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
