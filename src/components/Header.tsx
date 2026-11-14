import React, { useState, useRef, useEffect } from 'react';
import { BookOpen, UserCheck, MoreVertical, LogIn } from 'lucide-react';

interface HeaderProps {
  onGoHome: () => void;
  onLoginClick: () => void;
  examTitle?: string;
  isExamMode?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onGoHome,
  onLoginClick,
  examTitle,
  isExamMode = false
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const handleSelectLogin = () => {
    setMenuOpen(false);
    onLoginClick();
  };

  return (
    <header className="bg-[#061C13]/95 backdrop-blur-md text-[#F0F9F3] border-b border-[#D6BF62]/25 shadow-lg sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between gap-4 h-16 sm:h-[70px]">
          {/* University Logo, Branding & Subtitle */}
          <button
            type="button"
            onClick={() => {
              if (!isExamMode) {
                setMenuOpen(false);
                onGoHome();
              }
            }}
            disabled={isExamMode}
            className={`flex items-center gap-3 sm:gap-3.5 text-left min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6BF62]/70 rounded-xl py-1 pr-2 ${
              isExamMode ? 'cursor-default' : 'cursor-pointer group'
            }`}
          >
            <img
              src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
              alt="Sports University of Nigeria Logo"
              className="w-10 h-11 sm:w-11 sm:h-12 object-contain rounded-lg bg-white/5 p-0.5 border border-[#D6BF62]/20 shrink-0 transition-transform duration-200 group-hover:scale-[1.03]"
            />

            <div className="min-w-0">
              <span className="block font-extrabold text-base sm:text-xl tracking-tight text-[#F0F9F3] leading-tight whitespace-nowrap">
                SUN <span className="text-[#D6BF62]">CBT</span>
              </span>
              <span className="block text-[11px] sm:text-xs text-[#ADCDBA] font-medium tracking-tight truncate">
                Sports University of Nigeria
              </span>
              {examTitle && (
                <span className="flex items-center gap-1 text-[11px] text-[#D6BF62] font-semibold mt-0.5 truncate">
                  <BookOpen className="w-3 h-3 shrink-0" />
                  <span className="truncate">{examTitle}</span>
                </span>
              )}
            </div>
          </button>

          {/* Top-Right Control: Minimalist Three-Dot Vertical Menu (or Live Exam indicator during active test) */}
          {!isExamMode ? (
            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label="Open menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6BF62] ${
                  menuOpen
                    ? 'bg-[#0E623B] text-[#D6BF62] border border-[#D6BF62]/50'
                    : 'text-[#ADCDBA] hover:text-[#F0F9F3] hover:bg-[#0A2419] border border-transparent hover:border-[#789981]/30'
                }`}
              >
                <MoreVertical className="w-4.5 h-4.5" />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Account menu"
                  className="animate-sun-dropdown absolute right-0 mt-2 w-40 rounded-xl bg-[#061C13] border border-[#D6BF62]/35 shadow-2xl py-1.5 z-50 origin-top-right"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleSelectLogin}
                    className="w-full px-3.5 py-2.5 text-left text-sm font-semibold text-[#F0F9F3] hover:bg-[#0E623B]/60 hover:text-[#D6BF62] transition-colors flex items-center gap-2.5 cursor-pointer focus-visible:outline-none focus-visible:bg-[#0E623B]/60"
                  >
                    <LogIn className="w-4 h-4 text-[#D6BF62] shrink-0" />
                    <span>Login</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-[#0A2419] px-3 py-1.5 rounded-xl border border-[#D6BF62]/30 shrink-0">
              <UserCheck className="w-4 h-4 text-[#D6BF62]" />
              <span className="text-xs font-semibold text-[#ADCDBA] whitespace-nowrap">
                Live Examination
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
