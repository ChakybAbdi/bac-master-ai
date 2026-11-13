import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Outlet, createBrowserRouter, useLocation, useRouteError } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Shell, Wordmark } from '@/components/Shell.tsx';
import { Button, ButtonLink, ErrorNotice, Skeleton } from '@/components/ui.tsx';
import { ApiFailure } from '@/lib/api.ts';
import { I18nProvider, useI18n } from '@/lib/i18n.tsx';
import { useMe } from '@/lib/session.tsx';
import { ArchivePage } from '@/pages/Archive.tsx';
import { LoginPage, OnboardingPage, RegisterPage, ResetPasswordPage } from '@/pages/auth.tsx';
import { DashboardPage } from '@/pages/Dashboard.tsx';
import { LearnIndexPage, LearnSubjectPage, LessonPage } from '@/pages/Learn.tsx';
import { OfficialPage } from '@/pages/Official.tsx';
import { PlannerPage } from '@/pages/Planner.tsx';
import { MorePage, SettingsPage } from '@/pages/Settings.tsx';
import { AttemptPage, SimulatorPage } from '@/pages/Simulator.tsx';
import { SubjectsPage } from '@/pages/Subjects.tsx';
import { TutorPage } from '@/pages/Tutor.tsx';

const NO_RETRY = new Set([400, 401, 403, 404, 409, 422, 429]);

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // An expired session anywhere sends the reader back to the sign-in page.
    onError: (error) => {
      if (error instanceof ApiFailure && error.status === 401) queryClient.setQueryData(['me'], null);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiFailure && NO_RETRY.has(error.status)) && count < 2,
    },
  },
});

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6">
      <Wordmark />
      {children}
    </div>
  );
}

/** Signed-in area. Students who have not chosen a stream yet are sent to the onboarding step. */
function Protected() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return (
      <FullPage>
        <Skeleton lines={4} />
      </FullPage>
    );
  }
  if (me.isError) {
    return (
      <FullPage>
        <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
      </FullPage>
    );
  }
  if (!me.data) return <Navigate to="/login" replace />;
  const needsOnboarding = me.data.role === 'student' && !me.data.stream_id;
  if (needsOnboarding && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

function Guest() {
  const me = useMe();
  if (me.isPending) {
    return (
      <FullPage>
        <Skeleton lines={4} />
      </FullPage>
    );
  }
  if (me.data) return <Navigate to="/" replace />;
  return <Outlet />;
}

function Staff() {
  const me = useMe();
  if (me.data && me.data.role === 'student') return <Navigate to="/" replace />;
  return <Outlet />;
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="max-w-prose py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{t.errors.notFoundTitle}</h1>
      <p className="mt-2 text-sm text-muted">{t.errors.notFoundText}</p>
      <ButtonLink to="/" className="mt-5">
        {t.errors.backHome}
      </ButtonLink>
    </div>
  );
}

function RouteError() {
  const { t } = useI18n();
  const error = useRouteError();
  console.error(error);
  return (
    <FullPage>
      <p className="text-sm text-fg">{t.errors.generic}</p>
      <div>
        <Button onClick={() => window.location.reload()}>{t.common.retry}</Button>
      </div>
    </FullPage>
  );
}

// The admin console is loaded on demand: students never download it.
const adminIndex = () => import('@/pages/admin/index.tsx');
const adminData = () => import('@/pages/admin/data.tsx');
const adminPublish = () => import('@/pages/admin/publish.tsx');

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      // Reachable signed in or not: a reset link may be opened on a shared device.
      { path: '/reset', element: <ResetPasswordPage /> },
      {
        element: <Guest />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
      {
        element: <Protected />,
        children: [
          { path: '/onboarding', element: <OnboardingPage /> },
          {
            element: <Shell />,
            children: [
              { path: '/', element: <DashboardPage /> },
              { path: '/official', element: <OfficialPage /> },
              { path: '/subjects', element: <SubjectsPage /> },
              { path: '/learn', element: <LearnIndexPage /> },
              { path: '/learn/lesson/:lessonId', element: <LessonPage /> },
              { path: '/learn/:subjectId', element: <LearnSubjectPage /> },
              { path: '/simulator', element: <SimulatorPage /> },
              { path: '/simulator/attempt/:attemptId', element: <AttemptPage /> },
              { path: '/planner', element: <PlannerPage /> },
              { path: '/tutor', element: <TutorPage /> },
              { path: '/archive', element: <ArchivePage /> },
              { path: '/settings', element: <SettingsPage /> },
              { path: '/more', element: <MorePage /> },
              {
                element: <Staff />,
                children: [
                  {
                    path: '/admin',
                    lazy: async () => ({ Component: (await adminIndex()).AdminLayout }),
                    children: [
                      { index: true, lazy: async () => ({ Component: (await adminIndex()).OverviewPage }) },
                      { path: 'review', lazy: async () => ({ Component: (await adminIndex()).ReviewPage }) },
                      { path: 'monitoring', lazy: async () => ({ Component: (await adminData()).MonitoringPage }) },
                      { path: 'records', lazy: async () => ({ Component: (await adminData()).RecordsPage }) },
                      { path: 'academic', lazy: async () => ({ Component: (await adminData()).AcademicPage }) },
                      { path: 'content', lazy: async () => ({ Component: (await adminPublish()).ContentPage }) },
                      { path: 'announcements', lazy: async () => ({ Component: (await adminPublish()).AnnouncementsPage }) },
                      { path: 'calendar', lazy: async () => ({ Component: (await adminPublish()).CalendarAdminPage }) },
                      { path: 'archive', lazy: async () => ({ Component: (await adminPublish()).ArchiveAdminPage }) },
                      { path: 'users', lazy: async () => ({ Component: (await adminPublish()).UsersPage }) },
                      { path: 'audit', lazy: async () => ({ Component: (await adminPublish()).AuditPage }) },
                    ],
                  },
                ],
              },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  );
}
