import React, { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import DashboardPage from '../pages/DashboardPage';
import CoursesPage from '../pages/CoursesPage';
import ExamsPage from '../pages/ExamsPage';
import ExamVirtualPage from '../pages/ExamVirtualPage';
import ListsPage from '../pages/ListsPage';
import ProblemsPage from '../pages/ProblemsPage';
import ProblemDetailPage from '../pages/ProblemDetailPage';
import TopicsPage from '../pages/TopicsPage';
import ReviewsPage from '../pages/ReviewsPage';
import HeatmapPage from '../pages/HeatmapPage';
import SettingsPage from '../pages/SettingsPage';
import PdfViewerPage from '../pages/PdfViewerPage';
import OnboardingPage from '../pages/OnboardingPage';
import { isAppInitialized } from '../lib/tauri';
import { useTranslation } from 'react-i18next';

const InitGuard: React.FC = () => {
  const { t } = useTranslation();
  const [initialized, setInitialized] = useState<boolean | null>(null);

  useEffect(() => {
    const checkInit = async () => {
      try {
        const isInit = await isAppInitialized();
        setInitialized(isInit);
      } catch (err) {
        console.error('Initialization error:', err);
        setInitialized(false);
      }
    };
    checkInit();
  }, []);

  if (initialized === null) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-pulse text-lg font-medium">{t('common.loading')}</div>
      </div>
    );
  }

  if (!initialized) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
};

const router = createBrowserRouter([
  {
    path: '/',
    element: <InitGuard />,
    children: [
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'courses', element: <CoursesPage /> },
          { path: 'exams', element: <ExamsPage /> },
          { path: 'lists', element: <ListsPage /> },
          { path: 'problems', element: <ProblemsPage /> },
          { path: 'problems/:courseId/:pid', element: <ProblemDetailPage /> },
          { path: 'topics', element: <TopicsPage /> },
          { path: 'reviews', element: <ReviewsPage /> },
          { path: 'heatmap', element: <HeatmapPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
      {
        path: '/pdf-viewer',
        element: <PdfViewerPage />,
      },
      {
        path: '/exam-virtual',
        element: <ExamVirtualPage />,
      },
    ],
  },
  {
    path: '/onboarding',
    element: <OnboardingPage />,
  },
]);

export const AppRouter: React.FC = () => {
  return <RouterProvider router={router} />;
};
