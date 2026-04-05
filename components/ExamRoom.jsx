'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, saveSubmission, finalizeSubmission, findStudentByCode } from '@/lib/supabase'

const ANSWERS = ['A', 'B', 'C', 'D', 'E']
const SAVE_DEBOUNCE_MS = 1500

// ─── Geri Sayım Hook ─────────────────────────────────────────
function useCountdown(endTime) {
  const [remaining, setRemaining] = useState(0)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!endTime) return

    const tick = () => {
      const diff = Math.max(0, new Date(endTime) - Date.now())
      setRemaining(diff)
      if (diff === 0) setExpired(true)
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [endTime])

  const h = Math.floor(remaining / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)
  const s = Math.floor((remaining % 60000) / 1000)
  const pct = endTime
    ? Math.max(0, (remaining / (new Date(endTime) - Date.now() + remaining)) * 100)
    : 100

  return {
    display: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`,
    remaining,
    expired,
    isUrgent: remaining < 300000, // son 5 dakika
    pct,
  }
}

// ─── Dijital Cevap Kağıdı ────────────────────────────────────
function AnswerSheet({ questions, answers, onAnswer, visible, onToggle }) {
  return (
    <div
      className={`
        fixed right-0 top-0 h-full z-30 transition-transform duration-300 flex
        ${visible ? 'translate-x-0' : 'translate-x-full'}
      `}
    >
      {/* Toggle butonu */}
      <button
        onClick={onToggle}
        className="absolute -left-10 top-1/2 -translate-y-1/2 w-10 h-20 bg-blue-600 text-white rounded-l-xl flex items-center justify-center shadow-lg hover:bg-blue-700 transition-colors"
      >
        <span className="text-lg">{visible ? '›' : '‹'}</span>
      </button>

      {/* Cevap paneli */}
      <div className="w-72 bg-white border-l border-gray-200 shadow-2xl flex flex-col h-full">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-semibold text-gray-700 text-sm">Cevap Kağıdı</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {Object.keys(answers).length} / {questions.length} işaretlendi
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-1 gap-1.5">
            {questions.map((q, idx) => (
              <div
                key={q.id}
                className={`
                  flex items-center gap-2 p-2 rounded-lg transition-colors
                  ${answers[idx + 1] ? 'bg-blue-50' : 'bg-gray-50'}
                `}
              >
                <span className="text-xs font-bold text-gray-500 w-6 text-right">{idx + 1}</span>
                <div className="flex gap-1">
                  {ANSWERS.map(ans => (
                    <button
                      key={ans}
                      onClick={() => onAnswer(idx + 1, ans)}
                      className={`
                        w-8 h-8 rounded-full text-xs font-bold transition-all
                        ${answers[idx + 1] === ans
                          ? 'bg-blue-600 text-white shadow-sm scale-105'
                          : 'bg-white border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}
                      `}
                    >
                      {ans}
                    </button>
                  ))}
                </div>
                {!answers[idx + 1] && (
                  <span className="text-gray-200 text-lg ml-auto">○</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sonuç Ekranı ────────────────────────────────────────────
function ResultScreen({ result, questions, answers, onReview }) {
  const { score, correct, wrong, empty } = result

  const pct = questions.length > 0
    ? Math.round((correct / questions.length) * 100)
    : 0

  const grade = pct >= 85 ? 'Pekiyi' : pct >= 70 ? 'İyi' : pct >= 55 ? 'Orta' : 'Geçmez'
  const gradeColor = pct >= 85 ? 'text-green-600' : pct >= 70 ? 'text-blue-600' : pct >= 55 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 text-center">
        {/* Skor halkası */}
        <div className="relative w-36 h-36 mx-auto mb-6">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="8"/>
            <circle
              cx="50" cy="50" r="42" fill="none"
              stroke={pct >= 55 ? '#3b82f6' : '#ef4444'} strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 42}`}
              strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
              style={{ transition: 'stroke-dashoffset 1.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gray-800">{score?.toFixed(2) ?? '—'}</span>
            <span className="text-xs text-gray-400">net</span>
          </div>
        </div>

        <h2 className={`text-2xl font-bold mb-1 ${gradeColor}`}>{grade}</h2>
        <p className="text-gray-500 text-sm mb-6">Sınav tamamlandı</p>

        {/* İstatistikler */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Doğru', value: correct, color: 'bg-green-50 text-green-700' },
            { label: 'Yanlış', value: wrong,   color: 'bg-red-50 text-red-700' },
            { label: 'Boş',   value: empty,    color: 'bg-gray-50 text-gray-600' },
          ].map(s => (
            <div key={s.label} className={`rounded-2xl p-3 ${s.color}`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        <button
          onClick={onReview}
          className="w-full py-3 bg-blue-600 text-white rounded-2xl font-medium hover:bg-blue-700 transition-colors"
        >
          Kağıdı İncele
        </button>
      </div>
    </div>
  )
}

// ─── Kağıt İnceleme Ekranı ───────────────────────────────────
function ReviewScreen({ questions, answers, onClose }) {
  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
          <h2 className="text-xl font-bold text-gray-800">Kağıt İnceleme</h2>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {questions.map((q, idx) => {
            const studentAns = answers[idx + 1]
            const correct    = q.correct_answer
            const isCorrect  = studentAns === correct
            const isWrong    = studentAns && studentAns !== correct
            const isEmpty    = !studentAns

            return (
              <div
                key={q.id}
                className={`
                  bg-white rounded-2xl border-2 overflow-hidden
                  ${isCorrect ? 'border-green-200' : isWrong ? 'border-red-200' : 'border-gray-100'}
                `}
              >
                <div className={`px-4 py-2 flex items-center justify-between text-sm
                  ${isCorrect ? 'bg-green-50' : isWrong ? 'bg-red-50' : 'bg-gray-50'}`}>
                  <span className="font-semibold text-gray-700">Soru {idx + 1}</span>
                  <div className="flex items-center gap-3">
                    {studentAns && (
                      <span className={`font-bold ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                        Cevabın: {studentAns}
                      </span>
                    )}
                    <span className="text-green-700 font-bold">Doğru: {correct}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                      ${isCorrect ? 'bg-green-100 text-green-700' : isWrong ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                      {isCorrect ? '✓ Doğru' : isWrong ? '✗ Yanlış' : '— Boş'}
                    </span>
                  </div>
                </div>
                {q.image_url && (
                  <div className="p-3">
                    <img src={q.image_url} alt={`Soru ${idx + 1}`} className="max-h-48 mx-auto rounded-xl" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── GİRİŞ EKRANI ────────────────────────────────────────────
function LoginScreen({ onLogin, error }) {
  const [code, setCode] = useState('')
  const [examCode, setExamCode] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!code.trim() || !examCode.trim()) return
    setLoading(true)
    await onLogin(code.trim().toUpperCase(), examCode.trim())
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-2xl">
            📝
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Sınava Giriş</h1>
          <p className="text-gray-400 text-sm mt-1">Öğrenci kodunuzu ve sınav kodunu girin</p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Sınav Kodu"
            value={examCode}
            onChange={e => setExamCode(e.target.value.toUpperCase())}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-lg tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={12}
          />
          <input
            type="text"
            placeholder="Öğrenci Erişim Kodu"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-lg tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={8}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />

          {error && (
            <p className="text-red-500 text-sm text-center bg-red-50 rounded-xl p-2">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !code || !examCode}
            className={`
              w-full py-3 rounded-xl font-semibold transition-all
              ${loading || !code || !examCode
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'}
            `}
          >
            {loading ? 'Kontrol ediliyor…' : 'Sınava Gir'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ANA SINAV ODASI ─────────────────────────────────────────
export default function ExamRoom() {
  const [phase, setPhase] = useState('login')  // login | exam | result | review
  const [student, setStudent] = useState(null)
  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})   // { "1": "A", "2": "C", ... }
  const [submissionId, setSubmissionId] = useState(null)
  const [result, setResult] = useState(null)
  const [sheetVisible, setSheetVisible] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [currentQIdx, setCurrentQIdx] = useState(0)

  const saveTimer = useRef(null)
  const { display, expired, isUrgent } = useCountdown(exam?.end_time)

  // ─── Sınav süresi doldu → otomatik gönder ────────────────
  useEffect(() => {
    if (expired && phase === 'exam') handleFinish()
  }, [expired, phase])

  // ─── Giriş ───────────────────────────────────────────────
  const handleLogin = async (accessCode, examCode) => {
    setLoginError('')
    try {
      // Öğrenciyi bul
      const studentData = await findStudentByCode(accessCode)
      if (!studentData) throw new Error('Geçersiz öğrenci kodu')

      // Sınavı bul (exam kodu = exam UUID'nin ilk 8 karakteri, büyük harf)
      const { data: examData, error: examErr } = await supabase
        .from('exams')
        .select('*, test:tests(*, questions(*))')
        .eq('is_active', true)
        .ilike('id', `${examCode.toLowerCase()}%`)
        .single()

      if (examErr || !examData) throw new Error('Sınav bulunamadı veya aktif değil')

      const now = new Date()
      if (now < new Date(examData.start_time)) throw new Error('Sınav henüz başlamadı')
      if (now > new Date(examData.end_time))   throw new Error('Sınav süresi dolmuş')

      // Mevcut submission'ı kontrol et
      const { data: existingSub } = await supabase
        .from('submissions')
        .select('*')
        .eq('exam_id', examData.id)
        .eq('student_id', studentData.id)
        .single()

      if (existingSub?.finished_at) {
        throw new Error('Bu sınava zaten katıldınız')
      }

      const qs = (examData.test?.questions ?? []).sort((a, b) => a.order_index - b.order_index)

      setStudent(studentData)
      setExam(examData)
      setQuestions(qs)
      setSubmissionId(existingSub?.id ?? null)
      setAnswers(existingSub?.answers ?? {})
      setPhase('exam')
    } catch (err) {
      setLoginError(err.message)
    }
  }

  // ─── Cevap işaretleme + otomatik kayıt ───────────────────
  const handleAnswer = useCallback((questionNum, answer) => {
    setAnswers(prev => {
      const next = { ...prev }
      // Aynı şıka tekrar basınca temizle
      if (next[questionNum] === answer) {
        delete next[questionNum]
      } else {
        next[questionNum] = answer
      }

      // Debounce ile Supabase'e kaydet
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try {
          const sub = await saveSubmission({
            examId:    exam.id,
            studentId: student.id,
            answers:   next,
          })
          if (!submissionId) setSubmissionId(sub.id)
        } catch (err) {
          console.error('Otomatik kayıt hatası:', err)
        }
      }, SAVE_DEBOUNCE_MS)

      return next
    })
  }, [exam, student, submissionId])

  // ─── Sınavı bitir ────────────────────────────────────────
  const handleFinish = useCallback(async () => {
    if (!submissionId) {
      // Son cevapları kaydet
      const sub = await saveSubmission({
        examId:    exam.id,
        studentId: student.id,
        answers,
      })
      setSubmissionId(sub.id)

      const score = await finalizeSubmission(sub.id)
      setResult(score)
    } else {
      const score = await finalizeSubmission(submissionId)
      setResult(score)
    }

    // Güncel sonuçları çek
    const { data } = await supabase
      .from('submissions')
      .select('score, correct, wrong, empty')
      .eq('id', submissionId)
      .single()

    setResult(data)
    setPhase('result')
  }, [exam, student, answers, submissionId])

  // ─── RENDER ──────────────────────────────────────────────
  if (phase === 'login') {
    return <LoginScreen onLogin={handleLogin} error={loginError} />
  }

  if (phase === 'result') {
    return (
      <ResultScreen
        result={result}
        questions={questions}
        answers={answers}
        onReview={() => setPhase('review')}
      />
    )
  }

  if (phase === 'review') {
    return (
      <ReviewScreen
        questions={questions}
        answers={answers}
        onClose={() => setPhase('result')}
      />
    )
  }

  // ─── SINAV MODU ──────────────────────────────────────────
  const currentQ = questions[currentQIdx]
  const answered = Object.keys(answers).length

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Üst Çubuk */}
      <header className={`
        sticky top-0 z-20 px-4 py-3 border-b flex items-center gap-4 transition-colors
        ${isUrgent ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}
      `}>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-700">{exam?.test?.title}</span>
          <span className="text-xs text-gray-400">{student?.student_name} · {student?.student_number}</span>
        </div>

        {/* İlerleme */}
        <div className="flex-1 mx-4">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>{answered}/{questions.length} cevaplandı</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${(answered / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Sayaç */}
        <div className={`
          flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-lg font-bold
          ${isUrgent ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-blue-50 text-blue-700'}
        `}>
          ⏱ {display}
        </div>

        {/* Bitir butonu */}
        <button
          onClick={() => {
            if (confirm('Sınavı bitirmek istediğinize emin misiniz?')) handleFinish()
          }}
          className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
        >
          Bitir
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sol: Soru Gezgin */}
        <aside className="w-20 bg-white border-r border-gray-100 overflow-y-auto p-2 flex flex-col gap-1.5 shrink-0">
          {questions.map((q, i) => (
            <button
              key={q.id}
              onClick={() => setCurrentQIdx(i)}
              className={`
                w-full aspect-square rounded-xl text-xs font-bold transition-all
                ${i === currentQIdx ? 'bg-blue-600 text-white shadow-md scale-105' :
                  answers[i + 1] ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-50 text-gray-500 hover:bg-gray-100'}
              `}
            >
              {i + 1}
            </button>
          ))}
        </aside>

        {/* Orta: Soru Görüntüleyici */}
        <main className="flex-1 overflow-y-auto p-6" style={{ marginRight: sheetVisible ? '288px' : '40px' }}>
          {currentQ && (
            <div className="max-w-3xl mx-auto">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <span className="font-bold text-gray-700">Soru {currentQIdx + 1}</span>
                  {answers[currentQIdx + 1] && (
                    <span className="text-blue-600 font-bold text-sm bg-blue-50 px-3 py-1 rounded-full">
                      İşaretlenen: {answers[currentQIdx + 1]}
                    </span>
                  )}
                </div>

                {currentQ.image_url ? (
                  <div className="p-4">
                    <img
                      src={currentQ.image_url}
                      alt={`Soru ${currentQIdx + 1}`}
                      className="w-full rounded-xl"
                    />
                  </div>
                ) : currentQ.question_text ? (
                  <div className="p-6 text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {currentQ.question_text}
                  </div>
                ) : null}
              </div>

              {/* Şık butonları (büyük, dokunmatik dostu) */}
              <div className="grid grid-cols-5 gap-2">
                {ANSWERS.map(ans => (
                  <button
                    key={ans}
                    onClick={() => handleAnswer(currentQIdx + 1, ans)}
                    className={`
                      py-4 rounded-2xl text-xl font-bold transition-all shadow-sm
                      ${answers[currentQIdx + 1] === ans
                        ? 'bg-blue-600 text-white shadow-blue-200 shadow-lg scale-105'
                        : 'bg-white border-2 border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600'}
                    `}
                  >
                    {ans}
                  </button>
                ))}
              </div>

              {/* İleri / Geri */}
              <div className="flex justify-between mt-4">
                <button
                  onClick={() => setCurrentQIdx(i => Math.max(0, i - 1))}
                  disabled={currentQIdx === 0}
                  className="px-6 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                >
                  ← Önceki
                </button>
                <button
                  onClick={() => setCurrentQIdx(i => Math.min(questions.length - 1, i + 1))}
                  disabled={currentQIdx === questions.length - 1}
                  className="px-6 py-2 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-600 hover:bg-blue-100 disabled:opacity-30"
                >
                  Sonraki →
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Dijital Cevap Kağıdı */}
      <AnswerSheet
        questions={questions}
        answers={answers}
        onAnswer={handleAnswer}
        visible={sheetVisible}
        onToggle={() => setSheetVisible(v => !v)}
      />
    </div>
  )
}
