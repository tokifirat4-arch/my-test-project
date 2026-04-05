'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function ExamsPage() {
  const [exams, setExams] = useState([])
  useEffect(() => {
    supabase.from('exams').select('*, test:tests(title)').order('created_at',{ascending:false}).then(({data})=>setExams(data??[]))
  }, [])
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Sınavlarım</h1>
      <div className="grid gap-3">
        {exams.map(e => {
          const now=new Date(),start=new Date(e.start_time),end=new Date(e.end_time)
          const status=!e.is_active?'passive':now<start?'scheduled':now>end?'ended':'live'
          const lbl={passive:'Pasif',scheduled:'Planlandı',ended:'Bitti',live:'Canlı'}[status]
          const cls={passive:'bg-gray-100 text-gray-500',scheduled:'bg-blue-100 text-blue-600',ended:'bg-gray-100 text-gray-500',live:'bg-green-100 text-green-700'}[status]
          return (
            <div key={e.id} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-700">{e.test?.title??'—'}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{status==='live'&&<span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mr-1"/>}{lbl}</span>
                </div>
                <p className="text-xs text-gray-400">{start.toLocaleString('tr-TR')} → {end.toLocaleString('tr-TR')}</p>
                <p className="text-xs text-gray-300 font-mono mt-0.5">Kod: {e.id.slice(0,8).toUpperCase()}</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/dashboard/analytics/${e.id}`} className="px-3 py-1.5 bg-purple-50 text-purple-600 border border-purple-200 rounded-lg text-sm hover:bg-purple-100">📊 Analiz</Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
