'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle, Info, X, XCircle } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { removeToast } from '@/lib/store/slices/toastSlice';
import type { Toast as ToastItem, ToastType } from '@/lib/store/slices/toastSlice';

const barColor: Record<ToastType, string> = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
};

const iconBg: Record<ToastType, string> = {
  success: 'bg-emerald-500/20 text-emerald-400',
  error: 'bg-red-500/20 text-red-400',
  info: 'bg-blue-500/20 text-blue-400',
};

const iconEl: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-[18px] w-[18px]" />,
  error: <XCircle className="h-[18px] w-[18px]" />,
  info: <Info className="h-[18px] w-[18px]" />,
};

function ToastCard({ toast }: { toast: ToastItem }) {
  const dispatch = useAppDispatch();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => dispatch(removeToast(toast.id));

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, toast.duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto relative flex w-full max-w-[360px] items-center gap-3 overflow-hidden rounded-2xl bg-ink py-3 pr-3 pl-4 shadow-pop animate-fade-up"
    >
      {/* tinted icon pill */}
      <span
        className={`flex shrink-0 items-center justify-center rounded-xl p-2 ${iconBg[toast.type]}`}
      >
        {iconEl[toast.type]}
      </span>

      <p className="flex-1 text-sm font-medium leading-snug text-white">{toast.message}</p>

      <button
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <X className="h-[14px] w-[14px]" />
      </button>

      {/* progress bar */}
      <span
        className={`absolute bottom-0 left-0 right-0 h-[3px] origin-left ${barColor[toast.type]} animate-toast-progress`}
        style={{ animationDuration: `${toast.duration}ms` }}
      />
    </div>
  );
}

/** Mount once inside <AppProvider> in layout.tsx. */
export default function Toast() {
  const toasts = useAppSelector((s) => s.toast.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 top-5 z-[9999] flex flex-col items-center gap-2.5 px-4"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
