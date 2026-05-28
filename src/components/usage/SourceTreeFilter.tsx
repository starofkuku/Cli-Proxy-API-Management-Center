import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconFilterAll } from '@/components/ui/icons';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { formatCompactNumber } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface SourceTreeOption {
  key: string;
  label: string;
  type: string;
  count: number;
}

export interface SourceTreeGroup {
  id: 'provider' | 'authFile' | 'other';
  label: string;
  options: SourceTreeOption[];
}

export interface SourceTreeFilterProps {
  groups: SourceTreeGroup[];
  selectedKeys: Set<string>;
  onChange: (keys: Set<string>) => void;
  disabled?: boolean;
}

export function SourceTreeFilter({
  groups,
  selectedKeys,
  onChange,
  disabled = false,
}: SourceTreeFilterProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const allKeys = useMemo(
    () => groups.flatMap((group) => group.options.map((option) => option.key)),
    [groups]
  );
  const selectedCount = allKeys.filter((key) => selectedKeys.has(key)).length;
  const isAllSelected = allKeys.length > 0 && selectedCount === allKeys.length;
  const isDisabled = disabled || allKeys.length === 0;
  const isOpen = open && !isDisabled;

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleAll = (checked: boolean) => {
    onChange(checked ? new Set(allKeys) : new Set());
  };

  const toggleGroup = (group: SourceTreeGroup, checked: boolean) => {
    const next = new Set(selectedKeys);
    group.options.forEach((option) => {
      if (checked) {
        next.add(option.key);
      } else {
        next.delete(option.key);
      }
    });
    onChange(next);
  };

  const toggleOption = (option: SourceTreeOption, checked: boolean) => {
    const next = new Set(selectedKeys);
    if (checked) {
      next.add(option.key);
    } else {
      next.delete(option.key);
    }
    onChange(next);
  };

  const buttonText =
    allKeys.length === 0
      ? t('usage_stats.source_filter_empty')
      : isAllSelected
        ? t('usage_stats.source_filter_all')
        : selectedCount === 0
          ? t('usage_stats.source_filter_none')
          : t('usage_stats.source_filter_selected', { count: selectedCount });

  return (
    <div className={styles.sourceFilterGroup} ref={rootRef}>
      <span className={styles.timeRangeLabel}>{t('usage_stats.source_filter')}</span>
      <div className={styles.sourceTreeSelect}>
        <button
          type="button"
          className={styles.sourceTreeButton}
          onClick={() => setOpen((prev) => !prev)}
          disabled={isDisabled}
          aria-haspopup="tree"
          aria-expanded={isOpen}
          aria-label={t('usage_stats.source_filter')}
        >
          <IconFilterAll size={15} />
          <span>{buttonText}</span>
          <IconChevronDown size={15} className={isOpen ? styles.sourceTreeButtonIconOpen : ''} />
        </button>

        {isOpen && (
          <div className={styles.sourceTreeDropdown} role="tree">
            <div className={styles.sourceTreeHeader}>
              <SelectionCheckbox
                checked={isAllSelected}
                onChange={toggleAll}
                label={t('usage_stats.source_filter_all')}
                className={styles.sourceTreeCheck}
                labelClassName={styles.sourceTreeCheckLabel}
              />
              <span className={styles.sourceTreeScope}>{t('usage_stats.source_filter_scope')}</span>
            </div>

            <div className={styles.sourceTreeGroups}>
              {groups.map((group) => {
                const groupKeys = group.options.map((option) => option.key);
                const groupSelectedCount = groupKeys.filter((key) => selectedKeys.has(key)).length;
                const groupChecked = groupSelectedCount === groupKeys.length;

                return (
                  <div className={styles.sourceTreeGroup} key={group.id}>
                    <div className={styles.sourceTreeGroupHeader}>
                      <SelectionCheckbox
                        checked={groupChecked}
                        onChange={(checked) => toggleGroup(group, checked)}
                        label={group.label}
                        className={styles.sourceTreeCheck}
                        labelClassName={styles.sourceTreeGroupLabel}
                      />
                      <span className={styles.sourceTreeCount}>
                        {groupSelectedCount}/{groupKeys.length}
                      </span>
                    </div>

                    <div className={styles.sourceTreeItems}>
                      {group.options.map((option) => (
                        <SelectionCheckbox
                          key={option.key}
                          checked={selectedKeys.has(option.key)}
                          onChange={(checked) => toggleOption(option, checked)}
                          className={styles.sourceTreeItem}
                          labelClassName={styles.sourceTreeItemLabel}
                          label={
                            <>
                              <span className={styles.sourceTreeItemName}>{option.label}</span>
                              <span className={styles.sourceTreeItemMeta}>
                                {option.type || t('usage_stats.source_type_unknown')} ·{' '}
                                {formatCompactNumber(option.count)}
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
          </div>
        )}
      </div>
    </div>
  );
}
