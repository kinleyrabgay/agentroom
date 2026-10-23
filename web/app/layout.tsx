import type { Metadata } from "next"
import { Geist_Mono, Outfit } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"
import { BOOT_SCRIPT } from "@/features/appearance/lib/appearance"

const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "AgentRoom",
  description: "Visual control room for your coding agents",
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧭</text></svg>" },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", outfit.variable)}
    >
      <head>
        {/* Paint the saved accent and wallpaper before React runs, so the page doesn't flash the default. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider defaultTheme="dark">
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster position="top-right" offset={{ top: 64, right: 16 }} />
        </ThemeProvider>
      </body>
    </html>
  )
}
