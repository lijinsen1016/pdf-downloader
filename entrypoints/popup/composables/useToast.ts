import { ref, type Ref } from 'vue';

export interface ToastState {
  message: string;
  type: 'success' | 'error';
}

export interface ToastApi {
  toast: Ref<ToastState | null>;
  showToast: (message: string, type?: ToastState['type']) => void;
  disposeToast: () => void;
}

const TOAST_DURATION_MS = 2600;

export function useToast(): ToastApi {
  const toast = ref<ToastState | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function showToast(message: string, type: ToastState['type'] = 'success'): void {
    if (timer) clearTimeout(timer);
    toast.value = { message, type };
    timer = setTimeout(() => {
      toast.value = null;
    }, TOAST_DURATION_MS);
  }

  function disposeToast(): void {
    if (timer) clearTimeout(timer);
  }

  return { toast, showToast, disposeToast };
}
