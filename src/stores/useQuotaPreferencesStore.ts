/**
 * Browser-local preferences for optional quota provider sections.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OptionalQuotaProvider = 'claude' | 'antigravity' | 'xai' | 'kimi';

type QuotaProviderVisibility = Record<OptionalQuotaProvider, boolean>;

interface QuotaPreferencesState {
  providerVisibility: QuotaProviderVisibility;
  setProviderVisible: (provider: OptionalQuotaProvider, visible: boolean) => void;
}

const DEFAULT_PROVIDER_VISIBILITY: QuotaProviderVisibility = {
  claude: false,
  antigravity: false,
  xai: false,
  kimi: false,
};

export const useQuotaPreferencesStore = create<QuotaPreferencesState>()(
  persist(
    (set) => ({
      providerVisibility: DEFAULT_PROVIDER_VISIBILITY,
      setProviderVisible: (provider, visible) =>
        set((state) => ({
          providerVisibility: {
            ...state.providerVisibility,
            [provider]: visible,
          },
        })),
    }),
    {
      name: 'quota-management:provider-visibility',
      merge: (persistedState, currentState) => {
        const persistedVisibility = (persistedState as Partial<QuotaPreferencesState> | undefined)
          ?.providerVisibility;

        return {
          ...currentState,
          providerVisibility: {
            claude: persistedVisibility?.claude === true,
            antigravity: persistedVisibility?.antigravity === true,
            xai: persistedVisibility?.xai === true,
            kimi: persistedVisibility?.kimi === true,
          },
        };
      },
    }
  )
);
