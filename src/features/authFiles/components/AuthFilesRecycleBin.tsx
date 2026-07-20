import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import type { AuthFileRecycleItem } from '@/services/api/authFiles';
import { formatFileSize } from '@/utils/format';
import styles from './AuthFilesRecycleBin.module.scss';

type AuthFilesRecycleBinProps = {
  files: AuthFileRecycleItem[];
  selectedNames: Set<string>;
  loading: boolean;
  mutatingName: string | null;
  batchMutating?: boolean;
  disabled: boolean;
  onToggleSelect: (name: string) => void;
  onRestore: (file: AuthFileRecycleItem) => void;
  onPermanentDelete: (file: AuthFileRecycleItem) => void;
};

const formatDeletedAt = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || '-' : date.toLocaleString();
};

export function AuthFilesRecycleBin({
  files,
  selectedNames,
  loading,
  mutatingName,
  batchMutating = false,
  disabled,
  onToggleSelect,
  onRestore,
  onPermanentDelete,
}: AuthFilesRecycleBinProps) {
  const { t } = useTranslation();
  const displayReason = (reason: string) =>
    !reason || reason === 'manual_delete' || reason === 'manual_delete_all'
      ? t('auth_files.recycle_reason_manual')
      : reason;

  if (loading) {
    return <div className={styles.hint}>{t('common.loading')}</div>;
  }
  if (files.length === 0) {
    return (
      <EmptyState
        title={t('auth_files.recycle_empty_title')}
        description={t('auth_files.recycle_empty_desc')}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.notice}>{t('auth_files.recycle_notice')}</div>
      <div className={styles.grid}>
        {files.map((file) => {
          const loadingFile = mutatingName === file.name;
          const selected = selectedNames.has(file.name);
          const actionsDisabled = disabled || batchMutating || Boolean(mutatingName);

          return (
            <article
              key={file.name}
              className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
            >
              <div className={styles.header}>
                <SelectionCheckbox
                  checked={selected}
                  onChange={() => onToggleSelect(file.name)}
                  disabled={actionsDisabled && !selected}
                  className={styles.cardSelection}
                  ariaLabel={
                    selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                  }
                  title={
                    selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                  }
                />
                <div className={styles.name} title={file.originalName}>
                  {file.originalName}
                </div>
                {file.provider && <span className={styles.provider}>{file.provider}</span>}
              </div>
              {file.email && <div className={styles.email}>{file.email}</div>}
              <dl className={styles.meta}>
                <div>
                  <dt>{t('auth_files.recycle_deleted_at')}</dt>
                  <dd>{formatDeletedAt(file.deletedAt)}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.file_size')}</dt>
                  <dd>{formatFileSize(file.size)}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.recycle_reason')}</dt>
                  <dd>{displayReason(file.reason)}</dd>
                </div>
              </dl>
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={actionsDisabled}
                  loading={loadingFile}
                  onClick={() => onRestore(file)}
                >
                  {!loadingFile && <IconRefreshCw size={14} />}
                  {t('auth_files.recycle_restore_button')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={actionsDisabled}
                  onClick={() => onPermanentDelete(file)}
                >
                  <IconTrash2 size={14} />
                  {t('auth_files.recycle_permanent_delete_button')}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
