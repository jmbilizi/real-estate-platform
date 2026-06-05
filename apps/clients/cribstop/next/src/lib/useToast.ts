import { useCallback } from 'react';
import { useAppDispatch } from '@/lib/store/hooks';
import { addToast, ToastType } from '@/lib/store/slices/toastSlice';

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  info: 4000,
};

export function useToast() {
  const dispatch = useAppDispatch();

  const toast = useCallback(
    (message: string, type: ToastType = 'success', duration?: number) => {
      dispatch(
        addToast({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          message,
          type,
          duration: duration ?? DEFAULT_DURATION[type],
        }),
      );
    },
    [dispatch],
  );

  return { toast };
}
