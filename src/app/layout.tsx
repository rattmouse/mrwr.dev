import "./globals.css";
import StyledComponentsRegistry from "@/lib/styled-components-registry";
import React95Providers from "@/lib/react95-providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <StyledComponentsRegistry>
          <React95Providers>{children}</React95Providers>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
