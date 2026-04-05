'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import useQuestionStore from '@/store/questionStore'

const OpticalScanner = dynamic(() => import('@/components/OpticalScanner'), { ssr: false })

export default function OpticalPage() {
  const { questions } = useQuestionStore()
  const [exams, setExams] = useState([])
  const [activeExamId, setActiveExamId] = useState(null)
  useEffect(() => {
    supabase.from('exams').select('*, test:tests(title)').eq('is_active',true).order('created_at',{ascending:false}).then(({data})=>setExams(data??[]))
  }, [])
  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0">
        <h1 className="font-bold text-gray-800">🔬 Optik Okuma</h1>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-gray-400">Sınav:</span>
          <select value={activeExamId??''} onChange={e=>setActiveExamId(e.target.value||null)}
            className="px-3 py-1.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— Seç (opsiyonel) —</option>
            {exams.map(e=><option key={e.id} value={e.id}>{e.test?.title} ({e.id.slice(0,8).toUpperCase()})</option>)}
          </select>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <OpticalScanner questions={questions} examId={activeExamId}/>
      </div>
    </div>
  )
}
