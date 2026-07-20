import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { FailedUsageAuthFileTypeGroup } from '@/utils/failedUsageCredentials';
import { formatCompactNumber } from '@/utils/usage';
import styles from '@/pages/AuthFilesPage.module.scss';

export interface DeleteFailedUsageCredentialsModalProps {
  open: boolean;
  loading: boolean;
  deleting: boolean;
  typeFilter: string | null;
  groups: FailedUsageAuthFileTypeGroup[];
  onClose: () => void;
  onConfirm: (names: string[]) => void;
}

export function DeleteFailedUsageCredentialsModal({
  open,
  loading,
  deleting,
  typeFilter,
  groups,
  onClose,
  onConfirm,
}: DeleteFailedUsageCredentialsModalProps) {
  const { t } = useTranslation();
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());

  const allNames = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => item.name)),
    [groups]
  );

  useEffect(() => {
    if (!open) {
      setSelectedNames(new Set());
      return;
    }
    // Default-select all candidates in the current type scope.
    setSelectedNames(new Set(allNames));
  }, [allNames, open]);

  const selectedCount = allNames.filter((name) => selectedNames.has(name)).length;
  const isAllSelected = allNames.length > 0 && selectedCount === allNames.length;

  const toggleAll = (checked: boolean) => {
    setSelectedNames(checked ? new Set(allNames) : new Set());
  };

  const toggleType = (group: FailedUsageAuthFileTypeGroup, checked: boolean) => {
    const next = new Set(selectedNames);
    group.items.forEach((item) => {
      if (checked) {
        next.add(item.name);
      } else {
        next.delete(item.name);
      }
    });
    setSelectedNames(next);
  };

  const toggleItem = (name: string, checked: boolean) => {
    const next = new Set(selectedNames);
    if (checked) {
      next.add(name);
    } else {
      next.delete(name);
    }
    setSelectedNames(next);
  };

  const scopeLabel =
    typeFilter && typeFilter !== 'all'
      ? getTypeLabel(t, typeFilter)
      : t('auth_files.filter_all');

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={deleting}
      width={640}
      title={t('auth_files.delete_failed_usage_title')}
      footer={
        <div className={styles.failedUsageModalFooter}>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={deleting}
            disabled={deleting || loading || selectedCount === 0}
            onClick={() => onConfirm(allNames.filter((name) => selectedNames.has(name)))}
          >
            {t('auth_files.delete_failed_usage_confirm_button', { count: selectedCount })}
          </Button>
        </div>
      }
    >
      <div className={styles.failedUsageModalBody}>
        <p className={styles.failedUsageModalHint}>
          {t('auth_files.delete_failed_usage_hint', { scope: scopeLabel })}
        </p>

        {loading ? (
          <div className={styles.failedUsageModalEmpty}>{t('common.loading')}</div>
        ) : groups.length === 0 ? (
          <div className={styles.failedUsageModalEmpty}>
            {t('auth_files.delete_failed_usage_empty')}
          </div>
        ) : (
          <>
            <div className={styles.failedUsageModalToolbar}>
              <SelectionCheckbox
                checked={isAllSelected}
                onChange={toggleAll}
                label={t('auth_files.delete_failed_usage_select_all')}
                disabled={deleting}
              />
              <span className={styles.failedUsageModalCount}>
                {t('auth_files.delete_failed_usage_selected', {
                  selected: selectedCount,
                  total: allNames.length,
                })}
              </span>
            </div>

            <div className={styles.failedUsageModalGroups}>
              {groups.map((group) => {
                const typeNames = group.items.map((item) => item.name);
                const typeSelected = typeNames.filter((name) => selectedNames.has(name)).length;
                const typeChecked = typeSelected === typeNames.length;

                return (
                  <div key={group.type} className={styles.failedUsageTypeGroup}>
                    <div className={styles.failedUsageTypeHeader}>
                      <SelectionCheckbox
                        checked={typeChecked}
                        onChange={(checked) => toggleType(group, checked)}
                        label={getTypeLabel(t, group.type || 'unknown')}
                        disabled={deleting}
                        labelClassName={styles.failedUsageTypeLabel}
                      />
                      <span className={styles.failedUsageTypeMeta}>
                        {typeSelected}/{typeNames.length} ·{' '}
                        {t('auth_files.delete_failed_usage_failures', {
                          count: formatCompactNumber(group.totalFailures),
                        })}
                      </span>
                    </div>

                    <div className={styles.failedUsageItemList}>
                      {group.items.map((item) => (
                        <SelectionCheckbox
                          key={item.name}
                          checked={selectedNames.has(item.name)}
                          onChange={(checked) => toggleItem(item.name, checked)}
                          disabled={deleting}
                          className={styles.failedUsageItem}
                          labelClassName={styles.failedUsageItemLabel}
                          label={
                            <>
                              <span className={styles.failedUsageItemName}>{item.name}</span>
                              <span className={styles.failedUsageItemMeta}>
                                {t('auth_files.delete_failed_usage_item_meta', {
                                  failures: item.failureCount,
                                  successes: item.successCount,
                                })}
                              </span>
                            </>
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
