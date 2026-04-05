import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req) {
  const { accessCode, examCode } = await req.json()
  const supabase = createRouteHandlerClient({ cookies })
  const { data: student } = await supabase.from('students').select('id,student_name,student_number,class_id').eq('access_code', accessCode).single()
  if (!student) return NextResponse.json({ error: 'Geçersiz öğrenci kodu' }, { status: 401 })
  const { data: exam } = await supabase.from('exams').select('id,start_time,end_time,is_active,test:tests(title,questions(*))').eq('is_active',true).ilike('id',`${examCode.toLowerCase()}%`).single()
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 })
  const now = new Date()
  if (now < new Date(exam.start_time)) return NextResponse.json({ error: 'Sınav başlamadı' }, { status: 403 })
  if (now > new Date(exam.end_time))   return NextResponse.json({ error: 'Sınav süresi doldu' }, { status: 403 })
  return NextResponse.json({ student, exam })
}
