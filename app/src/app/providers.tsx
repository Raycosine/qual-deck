import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/i18n';

type Theme = 'light' | 'dark' | 'system';

interface AppContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  language: string;
  setLanguage: (lang: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
}

// Sidebar progress widget context — ProblemsPage writes, Layout reads
export interface SidebarStats {
  total: number;
  label: string;
  distribution: number[]; // index = mastery level 0-4, value = count
}

interface SidebarStatsCtx {
  stats: SidebarStats | null;
  setStats: (s: SidebarStats | null) => void;
}

const SidebarStatsContext = createContext<SidebarStatsCtx>({ stats: null, setStats: () => {} });

export function useSidebarStats() {
  return useContext(SidebarStatsContext);
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as Theme) || 'system';
  });

  const [language, setLanguageState] = useState(() => {
    const saved = localStorage.getItem('language');
    return saved || 'en';
  });

  const [sidebarStats, setSidebarStats] = useState<SidebarStats | null>(null);
  const setStats = useCallback((s: SidebarStats | null) => setSidebarStats(s), []);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }

    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    i18n.changeLanguage(language);
    localStorage.setItem('language', language);
  }, [language]);

  const setTheme = (t: Theme) => setThemeState(t);
  const setLanguage = (l: string) => setLanguageState(l);

  return (
    <SidebarStatsContext.Provider value={{ stats: sidebarStats, setStats }}>
      <AppContext.Provider value={{ theme, setTheme, language, setLanguage }}>
        <I18nextProvider i18n={i18n}>
          {children}
        </I18nextProvider>
      </AppContext.Provider>
    </SidebarStatsContext.Provider>
  );
};
