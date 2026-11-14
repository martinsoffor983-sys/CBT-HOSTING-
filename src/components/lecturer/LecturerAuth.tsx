import React, { useState } from 'react';
import {
  Mail,
  Lock,
  LogIn,
  AlertCircle,
  KeyRound,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowLeft
} from 'lucide-react';
import { useAuth, isAuthorizedExaminerEmail } from '../../context/AuthContext';

interface LecturerAuthProps {
  onBackHome?: () => void;
}

export const LecturerAuth: React.FC<LecturerAuthProps> = ({ onBackHome }) => {
  const { signInWithEmail, sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    if (!isAuthorizedExaminerEmail(trimmedEmail)) {
      setError('Access Denied: Only authorized Sports University lecturer accounts are permitted.');
      return;
    }

    setLoading(true);
    try {
      await signInWithEmail(trimmedEmail, password);
    } catch (err: any) {
      console.error('Authentication error:', err);
      if (err?.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
        setError('Incorrect email or password. Please verify your credentials or use "Forgot Password?" below.');
      } else if (err?.code === 'auth/user-not-found') {
        setError('No lecturer account record found for this email address.');
      } else if (err?.code === 'auth/too-many-requests') {
        setError('Access temporarily blocked due to multiple failed attempts. Please try again later or reset your password.');
      } else if (err?.code === 'auth/network-request-failed') {
        setError('Network error connecting to authentication service. Please check your internet connection.');
      } else {
        setError(err?.message || 'Authentication failed. Please verify your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    setSuccessMsg(null);
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      setError('Enter your authorized lecturer email address above before requesting a password reset.');
      return;
    }

    if (!isAuthorizedExaminerEmail(trimmedEmail)) {
      setError('Password reset is restricted to authorized Sports University lecturer accounts.');
      return;
    }

    try {
      setLoading(true);
      await sendPasswordReset(trimmedEmail);
      setSuccessMsg(`Password reset instructions have been sent to ${trimmedEmail}. Please check your inbox.`);
    } catch (err: any) {
      console.error('Password reset error:', err);
      setError(err?.message || 'Failed to send password reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 sm:my-12 px-4 animate-sun-fade-up">
      <div className="bg-[#061C13] rounded-2xl sm:rounded-3xl shadow-2xl border border-[#D6BF62]/30 overflow-hidden">
        {/* Top University Identity & Branding */}
        <div className="bg-gradient-to-b from-[#0A2419] to-[#061C13] px-6 py-7 text-center border-b border-[#D6BF62]/25">
          <div className="w-16 h-18 mx-auto mb-3 bg-[#030515]/70 rounded-2xl p-2 flex items-center justify-center border border-[#D6BF62]/30 shadow-inner">
            <img
              src="/assets/aistudio/IMG-20261104-WA0018_41e50466.jpg"
              alt="Sports University of Nigeria Logo"
              className="w-full h-full object-contain"
            />
          </div>

          <p className="text-xs font-extrabold tracking-widest uppercase text-[#D6BF62]">
            SUN CBT
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#F0F9F3] mt-1">
            Lecturer Login
          </h1>
          <p className="text-xs sm:text-sm text-[#ADCDBA] mt-1">
            Sign in to access your lecturer dashboard.
          </p>
        </div>

        <div className="p-6 sm:p-7 space-y-5">
          {error && (
            <div
              role="alert"
              className="p-3.5 bg-[#2A0808] border border-red-500/40 rounded-xl flex items-start gap-2.5 text-red-200 text-xs leading-relaxed"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="p-3.5 bg-[#0A2E1E] border border-emerald-500/40 rounded-xl flex items-start gap-2.5 text-emerald-200 text-xs leading-relaxed"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="lecturer-email"
                className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA] mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#789981] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="lecturer-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full pl-10 pr-4 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-medium text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62] transition"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="lecturer-password"
                  className="block text-xs font-bold uppercase tracking-wider text-[#ADCDBA]"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs text-[#D6BF62] hover:text-[#ebd888] hover:underline cursor-pointer flex items-center gap-1 font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D6BF62] rounded"
                >
                  <KeyRound className="w-3 h-3" />
                  <span>Forgot Password?</span>
                </button>
              </div>

              <div className="relative">
                <Lock className="w-4 h-4 text-[#789981] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="lecturer-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-11 py-3 bg-[#0A2419] border border-[#789981]/40 rounded-xl text-sm font-medium text-[#F0F9F3] placeholder-[#789981]/70 focus:outline-none focus:border-[#D6BF62] focus:ring-1 focus:ring-[#D6BF62] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#789981] hover:text-[#D6BF62] rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D6BF62]"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#0E623B] hover:bg-[#127949] border border-[#D6BF62] text-[#F0F9F3] font-bold rounded-xl text-sm transition-all duration-150 shadow-lg hover:shadow-[#0E623B]/30 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] mt-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-[#F0F9F3] border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4 text-[#D6BF62]" />
                  <span>Login</span>
                </>
              )}
            </button>
          </form>

          {onBackHome && (
            <div className="pt-3 border-t border-[#789981]/20 flex justify-center">
              <button
                type="button"
                onClick={onBackHome}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#ADCDBA] hover:text-[#D6BF62] transition-colors cursor-pointer py-1 px-2 rounded-lg"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Examination Access</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
