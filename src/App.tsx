import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth, isAuthorizedExaminerEmail } from './context/AuthContext';
import { Header } from './components/Header';
import { StudentPortal } from './components/student/StudentPortal';
import { LecturerAuth } from './components/lecturer/LecturerAuth';
import { LecturerDashboard } from './components/lecturer/LecturerDashboard';

function getInitialViewFromLocation(): { tab: 'student' | 'lecturer'; examId: string | null } {
  const params = new URLSearchParams(window.location.search);
  const examId = params.get('examId');
  const path = window.location.pathname.toLowerCase();
  const portalParam = params.get('portal')?.toLowerCase();

  if (examId) {
    return { tab: 'student', examId };
  }

  if (path === '/lecturer' || path === '/login' || path === '/admin' || portalParam === 'lecturer') {
    return { tab: 'lecturer', examId: null };
  }

  return { tab: 'student', examId: null };
}

function MainApp() {
  const { user, loading, isAuthorized } = useAuth();
  const initialState = getInitialViewFromLocation();
  const [tab, setTab] = useState<'student' | 'lecturer'>(initialState.tab);
  const [examIdFromUrl] = useState<string | null>(initialState.examId);
  const [isExamActive, setIsExamActive] = useState<boolean>(false);

  const isLecturerAuthorized = Boolean(
    user && isAuthorized && isAuthorizedExaminerEmail(user.email)
  );

  useEffect(() => {
    const handlePopState = () => {
      const next = getInitialViewFromLocation();
      if (!isExamActive) {
        setTab(next.tab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isExamActive]);

  const navigateToHome = () => {
    if (isExamActive) return;
    setTab('student');
    if (window.location.pathname !== '/' && !window.location.search.includes('examId=')) {
      window.history.pushState({}, '', '/');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToLogin = () => {
    if (isExamActive) return;
    setTab('lecturer');
    if (window.location.pathname !== '/login') {
      window.history.pushState({}, '', '/login');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#030515] flex flex-col font-sans text-[#F0F9F3] selection:bg-[#0E623B] selection:text-[#D6BF62] relative overflow-x-hidden">
      {/* Subtle University Ambient Atmosphere (non-intrusive lighting backdrop) */}
      {!isExamActive && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          <div className="animate-sun-ambient absolute -top-28 -left-24 w-[460px] h-[460px] rounded-full bg-[#0E623B]/20 blur-[120px]" />
          <div className="animate-sun-ambient absolute top-1/3 -right-32 w-[400px] h-[400px] rounded-full bg-[#D6BF62]/10 blur-[130px]" style={{ animationDelay: '-7s' }} />
        </div>
      )}

      {/* Header with University Logo, Branding and Minimalist 3-dot Menu */}
      <Header
        onGoHome={navigateToHome}
        onLoginClick={navigateToLogin}
        isExamMode={isExamActive}
      />

      {/* Main Content Area */}
      <main className="flex-1 relative z-10">
        {tab === 'student' ? (
          <StudentPortal
            initialExamId={examIdFromUrl}
            onExamActiveChange={setIsExamActive}
          />
        ) : loading ? (
          <div className="min-h-[50vh] flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-[#0E623B] border-t-[#D6BF62] rounded-full animate-spin" />
          </div>
        ) : !isLecturerAuthorized ? (
          <LecturerAuth onBackHome={navigateToHome} />
        ) : (
          <LecturerDashboard />
        )}
      </main>

      {/* University Official Footer (hidden during active exam to minimize candidate distraction) */}
      {!isExamActive && (
        <footer className="relative z-10 bg-[#061C13]/95 text-[#F0F9F3] border-t border-[#D6BF62]/25 py-6 px-4 sm:px-6 mt-auto">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div className="flex items-center space-x-3">
              <img
                src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
                alt="SUN Logo"
                className="w-9 h-11 object-contain"
              />
              <div>
                <p className="font-extrabold text-sm text-[#F0F9F3] tracking-wide">
                  SPORTS UNIVERSITY OF NIGERIA
                </p>
                <p className="text-xs text-[#D6BF62] font-semibold uppercase tracking-wider">
                  Citadel for Champions · SUN CBT
                </p>
              </div>
            </div>

            <div className="text-xs text-[#ADCDBA] space-y-0.5">
              <p>Official University Computer-Based Examination System</p>
              <p className="text-[#789981]">© {new Date().getFullYear()} Sports University of Nigeria. All Rights Reserved.</p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
