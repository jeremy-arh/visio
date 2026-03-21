"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration: number;
  visible: boolean;
}

interface ToastContextValue {
  success: (title: string, opts?: { description?: string; duration?: number }) => void;
  error:   (title: string, opts?: { description?: string; duration?: number }) => void;
  info:    (title: string, opts?: { description?: string; duration?: number }) => void;
  warning: (title: string, opts?: { description?: string; duration?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error:   "✕",
  info:    "ℹ",
  warning: "⚠",
};

const COLORS: Record<ToastType, string> = {
  success: "border-green-500 bg-green-50 text-green-900",
  error:   "border-red-500   bg-red-50   text-red-900",
  info:    "border-blue-500  bg-blue-50  text-blue-900",
  warning: "border-amber-500 bg-amber-50 text-amber-900",
};

const DOT_COLORS: Record<ToastType, string> = {
  success: "bg-green-500",
  error:   "bg-red-500",
  info:    "bg-blue-500",
  warning: "bg-amber-500",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: false } : t))
    );
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 350);
  }, []);

  const add = useCallback(
    (type: ToastType, title: string, opts?: { description?: string; duration?: number }) => {
      const id = `toast-${++counter.current}`;
      const duration = opts?.duration ?? 5000;
      setToasts((prev) => [
        ...prev,
        { id, type, title, description: opts?.description, duration, visible: false },
      ]);
      setTimeout(() => setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t))), 10);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const ctx: ToastContextValue = {
    success: (t, o) => add("success", t, o),
    error:   (t, o) => add("error",   t, o),
    info:    (t, o) => add("info",    t, o),
    warning: (t, o) => add("warning", t, o),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        style={{ maxWidth: "380px", width: "calc(100vw - 2rem)" }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border-l-4 shadow-lg px-4 py-3 transition-all duration-300 ${COLORS[t.type]} ${
              t.visible ? "opacity-100" : "opacity-0"
            }`}
            style={{ transform: t.visible ? "translateX(0)" : "translateX(2rem)", transition: "opacity 0.3s, transform 0.3s" }}
          >
            <span className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-white text-xs font-bold ${DOT_COLORS[t.type]}`}>
              {ICONS[t.type]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug">{t.title}</p>
              {t.description && (
                <p className="text-xs mt-0.5 opacity-80">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="flex-shrink-0 ml-1 opacity-50 hover:opacity-100 text-lg leading-none"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
