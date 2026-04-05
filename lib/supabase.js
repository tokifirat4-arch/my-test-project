// lib/supabase.js
// Supabase istemcisi ve tip güvenli yardımcılar
// .env.local dosyasına ekle:
//   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...

import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  console.warn('Supabase ortam değişkenleri eksik! .env.local dosyasını kontrol edin. Uygulama kısıtlı modda çalışacaktır.')
}

// Mock client for build time or missing env
const mockSupabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ data: {}, error: new Error('Supabase yapılandırılmamış') }),
    signUp: async () => ({ data: {}, error: new Error('Supabase yapılandırılmamış') }),
    signOut: async () => ({ error: null }),
  },
  from: () => ({
    select: () => ({
      order: () => Promise.resolve({ data: [], error: null }),
      eq: () => ({
        single: () => Promise.resolve({ data: null, error: null }),
        order: () => Promise.resolve({ data: [], error: null }),
      }),
      then: (cb) => cb({ data: [], error: null }),
    }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }),
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: new Error('Supabase yapılandırılmamış') }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      remove: async () => ({ error: null }),
    }),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  rpc: async () => ({ data: null, error: null }),
}

export const supabase = (supabaseUrl && supabaseAnon) 
  ? createClient(supabaseUrl, supabaseAnon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : mockSupabase

// ─────────────────────────────────────────────
// AUTH YARDIMCILARI
// ─────────────────────────────────────────────
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signUpWithEmail(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export function getUser() {
  return supabase.auth.getUser()
}

// ─────────────────────────────────────────────
// DOSYA YÜKLEMESİ (Soru görselleri)
// ─────────────────────────────────────────────

/**
 * Soru görselini Supabase Storage'a yükler.
 * @param {File} file          - Görsel dosyası
 * @param {string} testId      - Testin UUID'si
 * @returns {Promise<string>}  - Public URL
 */
export async function uploadQuestionImage(file, testId) {
  const ext      = file.name.split('.').pop()
  const path     = `${testId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('questions')
    .upload(path, file, { cacheControl: '3600', upsert: false })

  if (uploadError) throw uploadError

  const { data } = supabase.storage.from('questions').getPublicUrl(path)
  return data.publicUrl
}

/**
 * Soru görselini Storage'dan siler.
 * @param {string} imageUrl - uploadQuestionImage'dan dönen URL
 */
export async function deleteQuestionImage(imageUrl) {
  const url  = new URL(imageUrl)
  const path = url.pathname.split('/questions/')[1]
  if (!path) return

  const { error } = await supabase.storage.from('questions').remove([path])
  if (error) throw error
}

// ─────────────────────────────────────────────
// TEST CRUD
// ─────────────────────────────────────────────
export async function createTest(title, settings = {}) {
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user

  if (!user) throw new Error('Oturum açılmamış veya Supabase yapılandırılmamış')

  const { data, error } = await supabase
    .from('tests')
    .insert({ teacher_id: user.id, title, settings })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getTests() {
  const { data, error } = await supabase
    .from('tests')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function updateTest(id, updates) {
  const { data, error } = await supabase
    .from('tests')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// ─────────────────────────────────────────────
// SORU CRUD
// ─────────────────────────────────────────────
export async function getQuestions(testId) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('test_id', testId)
    .order('order_index', { ascending: true })

  if (error) throw error
  return data
}

export async function upsertQuestion(question) {
  const { data, error } = await supabase
    .from('questions')
    .upsert(question)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteQuestion(id) {
  const { error } = await supabase.from('questions').delete().eq('id', id)
  if (error) throw error
}

/**
 * Sürükle-bırak sıra güncellemesi — toplu update.
 * @param {{ id: string, order_index: number }[]} questions
 */
export async function reorderQuestions(questions) {
  const updates = questions.map(q => ({
    id: q.id,
    order_index: q.order_index,
    test_id: q.test_id,
    correct_answer: q.correct_answer,
  }))

  const { error } = await supabase.from('questions').upsert(updates)
  if (error) throw error
}

// ─────────────────────────────────────────────
// SINAV (EXAM) CRUD
// ─────────────────────────────────────────────
export async function createExam({ testId, startTime, endTime }) {
  const { data, error } = await supabase
    .from('exams')
    .insert({ test_id: testId, start_time: startTime, end_time: endTime, is_active: true })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getExamWithSubmissions(examId) {
  const { data, error } = await supabase
    .from('exams')
    .select(`
      *,
      test:tests(*),
      submissions(
        *,
        student:students(student_name, student_number)
      )
    `)
    .eq('id', examId)
    .single()

  if (error) throw error
  return data
}

// ─────────────────────────────────────────────
// ÖĞRENCİ GİRİŞİ (access_code ile)
// ─────────────────────────────────────────────
export async function findStudentByCode(accessCode) {
  const { data, error } = await supabase
    .from('students')
    .select('*, class:classes(class_name)')
    .eq('access_code', accessCode)
    .single()

  if (error) throw error
  return data
}

// ─────────────────────────────────────────────
// CEVAP KAYDETME
// ─────────────────────────────────────────────
export async function saveSubmission({ examId, studentId, answers }) {
  const { data, error } = await supabase
    .from('submissions')
    .upsert({ exam_id: examId, student_id: studentId, answers }, { onConflict: 'exam_id,student_id' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function finalizeSubmission(submissionId) {
  const { error } = await supabase
    .from('submissions')
    .update({ finished_at: new Date().toISOString() })
    .eq('id', submissionId)

  if (error) throw error

  // Skoru sunucu tarafında hesapla
  const { data, error: rpcError } = await supabase.rpc('calculate_score', {
    p_submission_id: submissionId,
    p_penalty: 0.25,
  })

  if (rpcError) throw rpcError
  return data
}

// ─────────────────────────────────────────────
// REALTIME — Canlı katılım takibi
// ─────────────────────────────────────────────
export function subscribeToExamSubmissions(examId, callback) {
  return supabase
    .channel(`exam-${examId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'submissions', filter: `exam_id=eq.${examId}` },
      callback
    )
    .subscribe()
}
