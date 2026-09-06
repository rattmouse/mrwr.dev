import "./globals.css";
import StyledComponentsRegistry from "@/lib/styled-components-registry";
import React95Providers from "@/lib/react95-providers";
import { PowerProvider } from "@/components/power/PowerProvider";
import PowerGate from "@/components/power/PowerGate";
import { getLatestVersion } from "@/lib/versions";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <PowerProvider>
          <PowerGate version={getLatestVersion()} />
          <StyledComponentsRegistry>
            <React95Providers>{children}</React95Providers>
          </StyledComponentsRegistry>
        </PowerProvider>
      </body>
    </html>
  );
}
