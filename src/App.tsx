import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/Header';
import { StudentPortal } from './components/student/StudentPortal';
import { LecturerAuth } from './components/lecturer/LecturerAuth';
import { LecturerDashboard } from './components/lecturer/LecturerDashboard';

function MainApp() {
  const { user, loading, isAuthorized } = useAuth();
  const [tab, setTab] = useState<'student' | 'lecturer'>('student');
  const [examIdFromUrl, setExamIdFromUrl] = useState<string | null>(null);
  const [isExamActive, setIsExamActive] = useState<boolean>(false);

  const isLecturerAuthorized = Boolean(
    user && isAuthorized && (user.email || '').toLowerCase().trim() === 'sunsmartcbt@gmail.com'
  );

  useEffect(() => {
    // Check URL query parameters for ?examId=...
    const params = new URLSearchParams(window.location.search);
    const id = params.get('examId');
    if (id) {
      setExamIdFromUrl(id);
      setTab('student');
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#030515] flex flex-col font-sans text-[#F0F9F3] selection:bg-[#0E623B] selection:text-[#D6BF62]">
      {/* Header with University Logo and Theme */}
      <Header
        currentTab={tab}
        onTabChange={(newTab) => {
          if (!isExamActive) {
            setTab(newTab);
          }
        }}
        isExamMode={isExamActive}
      />

      {/* Main Content Area */}
      <main className="flex-1">
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
          <LecturerAuth />
        ) : (
          <LecturerDashboard />
        )}
      </main>

      {/* University Official Footer (hidden during active exam to minimize candidate distraction) */}
      {!isExamActive && (
        <footer className="bg-[#061C13] text-[#F0F9F3] border-t border-[#D6BF62]/30 py-8 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div className="flex items-center space-x-3">
              <img
                src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
                alt="SUN Logo"
                className="w-10 h-12 object-contain"
              />
              <div>
                <p className="font-extrabold text-sm text-[#F0F9F3] tracking-wide">
                  SPORTS UNIVERSITY OF NIGERIA
                </p>
                <p className="text-xs text-[#D6BF62] font-semibold uppercase tracking-wider">
                  Citadel for Champions • SUN CBT Engine
                </p>
              </div>
            </div>

            <div className="text-xs text-[#ADCDBA] space-y-0.5">
              <p>Direct Faculty Examination System & Automated Grading</p>
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
