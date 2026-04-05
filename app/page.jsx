'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
export default function Home() {
  const router = useRouter()
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      router.replace(session ? '/dashboard' : '/login')
    })
  }, [])
  return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-400 animate-pulse">Yönlendiriliyor…</div></div>
}
