import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { Locale, Meta, User } from '@shared/types.ts';
import { ApiFailure, api } from './api.ts';
import { useI18n } from './i18n.tsx';

/** The signed-in user, or null. Loaded once and kept fresh by the mutations below. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api<{ user: User | null }>('/auth/me')).user,
    staleTime: 5 * 60_000,
  });
}

/** Reference data: sessions, streams, subjects, tutor status. */
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta'), staleTime: 10 * 60_000 });
}

export function useSignIn(mode: 'login' | 'register') {
  const client = useQueryClient();
  const { setLocale } = useI18n();
  return useMutation({
    mutationFn: (body: { name?: string; email: string; password: string; locale?: Locale }) =>
      api<{ user: User }>(`/auth/${mode}`, { body }),
    onSuccess: ({ user }) => {
      client.clear();
      client.setQueryData(['me'], user);
      if (mode === 'login') setLocale(user.locale);
    },
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      client.clear();
      client.setQueryData(['me'], null);
    },
  });
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; locale?: Locale; edition_id?: number; stream_id?: number | null }) =>
      api<{ user: User }>('/me', { method: 'PATCH', body }),
    onSuccess: ({ user }) => {
      client.setQueryData(['me'], user);
      // Everything shown depends on the session and stream: refetch it all.
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'meta' });
    },
  });
}

/** Turns any thrown value into a sentence in the interface language. */
export function useErrorMessage(): (err: unknown) => string {
  const { t } = useI18n();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiFailure) {
        if (err.code === 'network') return t.errors.network;
        return t.errors.codes[err.code] ?? t.errors.generic;
      }
      return t.errors.generic;
    },
    [t],
  );
}

export type ThemeChoice = 'system' | 'light' | 'dark';

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): { choice: ThemeChoice; resolved: 'light' | 'dark'; setChoice: (c: ThemeChoice) => void } {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => {
    try {
      const saved = localStorage.getItem('bm.theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(choice));

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(choice);
      document.documentElement.dataset.theme = next;
      setResolved(next);
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      if (next === 'system') localStorage.removeItem('bm.theme');
      else localStorage.setItem('bm.theme', next);
    } catch {
      // Storage is optional.
    }
    setChoiceState(next);
  }, []);

  return { choice, resolved, setChoice };
}
