import "./globals.css";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast-provider";

export const metadata = {
  /** Pages under `/dashboard` set `title.absolute` so the browser tab shows only that label. */
  title: "Notary Dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
