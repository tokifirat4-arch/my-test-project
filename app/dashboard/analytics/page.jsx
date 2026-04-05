'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function AnalyticsListPage() {
  const [exams, setExams] = useState([])
  useEffect(() => {
    supabase.from('exams').select('*, test:tests(title), submissions(id,finished_at,score)').order('created_at',{ascending:false}).then(({data})=>setExams(data??[]))
  }, [])
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Analiz Raporları</h1>
      {exams.length === 0 ? (
        <div className="text-center py-16 text-gray-300"><div className="text-5xl mb-4">📊</div><p>Henüz sınav yok.</p></div>
      ) : (
        <div className="grid gap-3">
          {exams.map(e => {
            const finished = e.submissions?.filter(s=>s.finished_at)??[]
            const avg = finished.length ? (finished.reduce((s,x)=>s+(x.score??0),0)/finished.length).toFixed(2) : '—'
            return (
              <div key={e.id} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-700">{e.test?.title??'—'}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{finished.length} tamamlayan · Ort. {avg} net</p>
                </div>
                <Link href={`/dashboard/analytics/${e.id}`}
                  className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700">
                  📊 Raporu Gör
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
