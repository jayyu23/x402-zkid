export const metadata = {
  title: 'x402 ZKID',
  description: 'ZKID Authentication System for x402 Negotiations',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
