'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { removeToast } from '@/lib/store/slices/toastSlice';
import type { Toast as ToastItem, ToastType } from '@/lib/store/slices/toastSlice';
import DismissButton from '@/components/DismissButton';

/** Card background + border per type */
const cardStyle: Record<ToastType, string> = {
  success: 'bg-green-50 border border-green-200',
  warning: 'bg-amber-50 border border-amber-200',
  error: 'bg-red-50 border border-red-200',
  info: 'bg-gray-50 border border-gray-200',
};

/** Icon colour per type */
const iconColor: Record<ToastType, string> = {
  success: 'text-green-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  info: 'text-gray-400',
};

/** Message text colour per type */
const textColor: Record<ToastType, string> = {
  success: 'text-green-800',
  warning: 'text-amber-800',
  error: 'text-red-800',
  info: 'text-gray-600',
};

/** Progress bar colour per type */
const barColor: Record<ToastType, string> = {
  success: 'bg-green-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
  info: 'bg-gray-400',
};

const iconEl: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-5 w-5" />,
  warning: <AlertCircle className="h-5 w-5" />,
  error: <XCircle className="h-5 w-5" />,
  info: <Info className="h-5 w-5" />,
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
      className={`pointer-events-auto relative flex w-full max-w-[360px] items-center gap-3 overflow-hidden rounded-2xl px-4 py-3 shadow-pop animate-fade-up ${cardStyle[toast.type]}`}
    >
      <span className={`shrink-0 ${iconColor[toast.type]}`}>{iconEl[toast.type]}</span>

      <p className={`flex-1 text-sm font-medium leading-snug ${textColor[toast.type]}`}>
        {toast.message}
      </p>

      <DismissButton onClick={dismiss} label="Dismiss notification" />

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
