'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AnalyticsPanel = dynamic(() => import('@/components/AnalyticsPanel'), { ssr: false })

export default function AnalyticsDetailPage({ params }) {
  const [exam, setExam] = useState(null)
  useEffect(() => {
    supabase.from('exams').select('*, test:tests(*, questions(*))').eq('id', params.examId).single().then(({ data }) => setExam(data))
  }, [params.examId])
  const questions = exam?.test?.questions?.sort((a,b)=>a.order_index-b.order_index) ?? []
  return (
    <div className="h-full">
      <AnalyticsPanel examId={params.examId} questions={questions}
        meta={{ title: exam?.test?.title, examTime: exam?.test?.settings?.timing?.duration_minutes }}/>
    </div>
  )
}
