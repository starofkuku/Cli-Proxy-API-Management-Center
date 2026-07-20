/**
 * Browser-local preferences for auth-files page UI features.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthFilesPreferencesState {
  /** Show the "delete failed usage credentials" action. Default off. */
  showDeleteFailedUsageButton: boolean;
  setShowDeleteFailedUsageButton: (visible: boolean) => void;
}

export const useAuthFilesPreferencesStore = create<AuthFilesPreferencesState>()(
  persist(
    (set) => ({
      showDeleteFailedUsageButton: false,
      setShowDeleteFailedUsageButton: (visible) =>
        set({ showDeleteFailedUsageButton: visible === true }),
    }),
    {
      name: 'auth-files:ui-preferences',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AuthFilesPreferencesState> | undefined;
        return {
          ...currentState,
          showDeleteFailedUsageButton: persisted?.showDeleteFailedUsageButton === true,
        };
      },
    }
  )
);
