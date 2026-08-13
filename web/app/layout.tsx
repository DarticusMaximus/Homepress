import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@newsletter/shared/client";
import { PwaInstallProvider } from "@/components/pwa-install-provider";
import { PwaRegister } from "@/components/pwa-register";
import { PwaThemeColor } from "@/components/pwa-theme-color";
import { PwaUpdateBar } from "@/components/pwa-update-bar";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast-provider";
import { readWebBuildId } from "@/lib/build-id";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const bootId = readWebBuildId();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PwaUpdateBar bootId={bootId} />
          <PwaInstallProvider>
            {children}
          </PwaInstallProvider>
          <ToastProvider />
          <PwaRegister />
          <PwaThemeColor />
        </ThemeProvider>
      </body>
    </html>
  );
}
