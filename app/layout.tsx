import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MerScribe',
  description: 'A Markdown-canonical desktop whiteboard for Mermaid diagrams',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased" suppressHydrationWarning>{children}</body>
    </html>
  )
}
