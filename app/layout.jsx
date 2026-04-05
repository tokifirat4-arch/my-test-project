import './globals.css'
export const metadata = { title: 'Online Test Maker', description: 'Test oluştur, sınav yap, analiz et.' }
export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body className="antialiased bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
