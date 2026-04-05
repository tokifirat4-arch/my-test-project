'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard',           icon: '🏠', label: 'Ana Sayfa'   },
  { href: '/dashboard/tests',     icon: '📋', label: 'Testler'     },
  { href: '/dashboard/exams',     icon: '📝', label: 'Sınavlar'    },
  { href: '/dashboard/analytics', icon: '📊', label: 'Analizler'   },
  { href: '/dashboard/optical',   icon: '🔬', label: 'Optik Okuma' },
]

export default function DashboardLayout({ children }) {
  const pathname = usePathname()
  const router   = useRouter()
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <nav className="w-16 bg-slate-900 flex flex-col items-center py-4 gap-1 shrink-0">
        <div className="text-2xl mb-4">📝</div>
        {NAV.map(n => {
          const active = pathname === n.href || pathname.startsWith(n.href + '/')
          return (
            <Link key={n.href} href={n.href} title={n.label}
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all ${active ? 'bg-blue-600 shadow-lg' : 'hover:bg-slate-700 text-slate-400'}`}>
              {n.icon}
            </Link>
          )
        })}
        <div className="flex-1"/>
        <button onClick={async () => { await signOut(); router.push('/login') }} title="Çıkış"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl text-slate-500 hover:bg-slate-700 hover:text-red-400 transition-all">
          ⏻
        </button>
      </nav>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
