import React from 'react';
import { GraduationCap, ShieldCheck, UserCheck, BookOpen, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  currentTab: 'student' | 'lecturer';
  onTabChange: (tab: 'student' | 'lecturer') => void;
  examTitle?: string;
  isExamMode?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  examTitle,
  isExamMode = false
}) => {
  const { user, logout } = useAuth();

  return (
    <header className="bg-[#061C13] text-[#F0F9F3] border-b border-[#D6BF62]/30 shadow-lg sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo and University Title */}
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="relative group cursor-pointer" onClick={() => !isExamMode && onTabChange('student')}>
              <img
                src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
                alt="Sports University of Nigeria Logo"
                className="w-13 h-15 sm:w-14 sm:h-16 object-contain rounded drop-shadow-md bg-white/5 p-0.5"
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg sm:text-2xl tracking-wider text-[#F0F9F3]">
                  SUN <span className="text-[#D6BF62]">CBT</span>
                </span>
                <span className="hidden md:inline-block px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest bg-[#D6BF62]/15 text-[#D6BF62] border border-[#D6BF62]/40 rounded-full">
                  Citadel for Champions
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#ADCDBA] font-medium tracking-tight line-clamp-1">
                Sports University of Nigeria Examination System
              </p>
              {examTitle && (
                <p className="text-xs text-[#D6BF62] font-semibold mt-0.5 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5" />
                  {examTitle}
                </p>
              )}
            </div>
          </div>

          {/* Navigation Controls (Hidden in active exam mode to prevent distraction) */}
          {!isExamMode ? (
            <div className="flex items-center space-x-2 sm:space-x-3">
              <button
                onClick={() => onTabChange('student')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  currentTab === 'student'
                    ? 'bg-[#0E623B] text-[#F0F9F3] border border-[#D6BF62] shadow-sm'
                    : 'text-[#ADCDBA] hover:bg-[#0A2419] hover:text-[#F0F9F3] border border-transparent'
                }`}
              >
                <GraduationCap className="w-4 h-4 text-[#D6BF62]" />
                <span>Student Portal</span>
              </button>

              <button
                onClick={() => onTabChange('lecturer')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  currentTab === 'lecturer'
                    ? 'bg-[#D6BF62] text-[#061C13] border border-[#D6BF62] shadow-sm'
                    : 'text-[#ADCDBA] hover:bg-[#0A2419] hover:text-[#F0F9F3] border border-transparent'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Lecturer Portal</span>
              </button>

              {user && currentTab === 'lecturer' && (
                <div className="flex items-center pl-2 border-l border-[#789981]/30">
                  <button
                    onClick={logout}
                    title="Sign Out"
                    className="p-2 text-[#ADCDBA] hover:text-[#F0F9F3] hover:bg-[#0A2419] rounded-xl transition cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-[#0A2419] px-3.5 py-1.5 rounded-xl border border-[#D6BF62]/30">
              <UserCheck className="w-4 h-4 text-[#D6BF62]" />
              <span className="text-xs font-semibold text-[#ADCDBA]">Live Examination Session</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
