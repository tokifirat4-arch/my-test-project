'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  supabase,
  createExam,
  getExamWithSubmissions,
  subscribeToExamSubmissions,
} from '@/lib/supabase'

// ─── İstatistik Hesaplama ─────────────────────────────────────
function calcStats(submissions, questions) {
  if (!submissions?.length || !questions?.length) {
    return { avg: 0, stdDev: 0, items: [] }
  }

  const scores = submissions
    .filter(s => s.finished_at)
    .map(s => s.score ?? 0)

  const avg    = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
  const stdDev = Math.sqrt(
    scores.reduce((acc, s) => acc + Math.pow(s - avg, 2), 0) / (scores.length || 1)
  )

  // Madde analizi: her soru için hangi şık kaç kez işaretlendi
  const items = questions.map((q, idx) => {
    const dist = { A: 0, B: 0, C: 0, D: 0, E: 0, empty: 0 }
    submissions.forEach(s => {
      const ans = s.answers?.[idx + 1]
      if (!ans) dist.empty++
      else if (dist[ans] !== undefined) dist[ans]++
    })
    const total = submissions.length || 1
    return {
      num:     idx + 1,
      correct: q.correct_answer,
      dist,
      pct:     Math.round((dist[q.correct_answer] / total) * 100),
    }
  })

  return { avg, stdDev, items }
}

// ─── Canlı Durum Rozeti ───────────────────────────────────────
function StatusBadge({ isActive }) {
  return (
    <span className={`
      inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
      ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}
    `}>
      <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}/>
      {isActive ? 'Canlı' : 'Bitti'}
    </span>
  )
}

// ─── Madde Analizi Tablosu ────────────────────────────────────
function ItemAnalysis({ items }) {
  if (!items.length) return null
  const opts = ['A','B','C','D','E','empty']

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium border-b border-gray-200">Soru</th>
            {opts.map(o => (
              <th key={o} className="text-center px-3 py-2 text-gray-500 font-medium border-b border-gray-200">
                {o === 'empty' ? 'Boş' : o}
              </th>
            ))}
            <th className="text-center px-3 py-2 text-gray-500 font-medium border-b border-gray-200">
              Güçlük %
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.num} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <td className="px-3 py-2 font-semibold text-gray-700">
                {item.num}
                <span className="ml-1 text-xs text-blue-600 font-normal">(D:{item.correct})</span>
              </td>
              {opts.map(opt => {
                const count = opt === 'empty' ? item.dist.empty : (item.dist[opt] ?? 0)
                const isCorrect = opt === item.correct
                return (
                  <td key={opt} className={`text-center px-3 py-2 ${isCorrect ? 'font-bold' : ''}`}>
                    <span className={`
                      px-2 py-0.5 rounded-lg text-xs
                      ${isCorrect ? 'bg-green-100 text-green-700' :
                        count > 0  ? 'bg-red-50 text-red-600'    : 'text-gray-300'}
                    `}>
                      {count}
                    </span>
                  </td>
                )
              })}
              <td className="text-center px-3 py-2">
                <div className="flex items-center gap-2 justify-center">
                  <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${item.pct >= 60 ? 'bg-green-400' : item.pct >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 w-8">{item.pct}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Excel Çıktısı ────────────────────────────────────────────
function exportToExcel(examData, questions) {
  const { submissions } = examData

  // 1. Sonuçlar sayfası
  const results = submissions.map((s, i) => ({
    'Sıra':          i + 1,
    'Ad Soyad':      s.student?.student_name ?? '—',
    'No':            s.student?.student_number ?? '—',
    'Doğru':         s.correct ?? 0,
    'Yanlış':        s.wrong ?? 0,
    'Boş':           s.empty ?? 0,
    'Net':           s.score?.toFixed(2) ?? '—',
    'Başlangıç':     s.start_at ? new Date(s.start_at).toLocaleString('tr-TR') : '—',
    'Bitiş':         s.finished_at ? new Date(s.finished_at).toLocaleString('tr-TR') : 'Devam ediyor',
    'Süre (dk)':     s.start_at && s.finished_at
      ? Math.round((new Date(s.finished_at) - new Date(s.start_at)) / 60000)
      : '—',
  }))

  // 2. Cevap detayı sayfası
  const details = submissions.map(s => {
    const row = {
      'Ad Soyad': s.student?.student_name ?? '—',
      'No':       s.student?.student_number ?? '—',
    }
    questions.forEach((q, i) => {
      const ans  = s.answers?.[i + 1] ?? ''
      const mark = ans === q.correct_answer ? '✓' : ans ? '✗' : '—'
      row[`S${i + 1}`] = ans ? `${ans}${mark}` : '—'
    })
    row['Net'] = s.score?.toFixed(2) ?? '—'
    return row
  })

  // 3. Madde analizi
  const { items } = calcStats(submissions, questions)
  const analysis = items.map(item => ({
    'Soru No':   item.num,
    'Doğru Şık': item.correct,
    'A':         item.dist.A,
    'B':         item.dist.B,
    'C':         item.dist.C,
    'D':         item.dist.D,
    'E':         item.dist.E,
    'Boş':       item.dist.empty,
    'Güçlük %':  item.pct,
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results),  'Sonuçlar')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(details),  'Cevap Detayı')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(analysis), 'Madde Analizi')

  XLSX.writeFile(wb, `sinav_sonuclari_${Date.now()}.xlsx`)
}

// ─── Sınav Oluşturma Formu ────────────────────────────────────
function CreateExamForm({ testId, onCreated }) {
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [duration, setDuration]   = useState(40)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const handleCreate = async () => {
    if (!startDate || !startTime) return setError('Başlangıç tarihi ve saatini girin')
    setLoading(true); setError('')

    try {
      const startDT = new Date(`${startDate}T${startTime}`)
      const endDT   = new Date(startDT.getTime() + duration * 60000)

      const exam = await createExam({
        testId,
        startTime: startDT.toISOString(),
        endTime:   endDT.toISOString(),
      })
      onCreated(exam)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-700 mb-4">Yeni Sınav Oluştur</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Tarih</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Saat</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Süre (dakika)</label>
          <input type="number" value={duration} min={5} max={300} onChange={e => setDuration(+e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div className="flex items-end">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Oluşturuluyor…' : 'Sınavı Başlat'}
          </button>
        </div>
      </div>
      {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
    </div>
  )
}

// ─── ANA PANEL ────────────────────────────────────────────────
export default function TeacherPanel({ testId, examId: initialExamId, onExamCreated }) {
  const [exam, setExam]         = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [questions, setQuestions]     = useState([])
  const [tab, setTab]           = useState('live')  // live | stats | items
  const [showCreate, setShowCreate]   = useState(false)
  const channelRef              = useRef(null)

  // initialExamId prop gelirse otomatik yükle
  useEffect(() => {
    if (initialExamId) loadExam(initialExamId)
  }, [initialExamId])

  // Sınav verilerini yükle
  const loadExam = useCallback(async (examId) => {
    const data = await getExamWithSubmissions(examId)
    setExam(data)
    setSubmissions(data.submissions ?? [])
    setQuestions(data.test?.questions?.sort((a, b) => a.order_index - b.order_index) ?? [])
  }, [])

  // Sınav seçilince Realtime abone ol
  useEffect(() => {
    if (!exam?.id) return

    channelRef.current = subscribeToExamSubmissions(exam.id, (payload) => {
      setSubmissions(prev => {
        const idx = prev.findIndex(s => s.id === payload.new.id)
        if (idx === -1) return [...prev, payload.new]
        const next = [...prev]
        next[idx]  = payload.new
        return next
      })
    })

    return () => {
      channelRef.current?.unsubscribe()
    }
  }, [exam?.id])

  const stats      = calcStats(submissions, questions)
  const finished   = submissions.filter(s => s.finished_at).length
  const inProgress = submissions.filter(s => !s.finished_at).length
  const total      = submissions.length

  // Sınav kodu (UUID'nin ilk 8 karakteri, büyük harf)
  const examCode = exam?.id?.slice(0, 8).toUpperCase()

  return (
    <div className="h-full flex flex-col gap-4 p-4 bg-gray-50 overflow-y-auto">
      {/* Sınav Oluştur */}
      {!exam && (
        <CreateExamForm
          testId={testId}
          onCreated={async (newExam) => {
              onExamCreated?.(newExam.id)
            setShowCreate(false)
            await loadExam(newExam.id)
          }}
        />
      )}

      {/* Sınav Başlığı */}
      {exam && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-lg font-bold text-gray-800">{exam.test?.title}</h2>
                <StatusBadge isActive={exam.is_active} />
              </div>
              <p className="text-sm text-gray-500">
                {new Date(exam.start_time).toLocaleString('tr-TR')} →{' '}
                {new Date(exam.end_time).toLocaleString('tr-TR')}
              </p>
            </div>

            <div className="text-right">
              <p className="text-xs text-gray-400 mb-1">Sınav Kodu</p>
              <span className="text-2xl font-mono font-bold text-blue-600 tracking-widest">{examCode}</span>
            </div>
          </div>

          {/* Özet sayaçlar */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: 'Toplam',       value: total,      color: 'bg-gray-50 text-gray-700' },
              { label: 'Devam Ediyor', value: inProgress, color: 'bg-green-50 text-green-700' },
              { label: 'Tamamladı',   value: finished,    color: 'bg-blue-50 text-blue-700' },
              { label: 'Ort. Net',    value: stats.avg.toFixed(2), color: 'bg-purple-50 text-purple-700' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-3 ${s.color}`}>
                <div className="text-xl font-bold">{s.value}</div>
                <div className="text-xs mt-0.5 opacity-70">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sekmeler */}
      {exam && (
        <>
          <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
            {[
              { key: 'live',  label: 'Canlı Takip' },
              { key: 'stats', label: 'İstatistik' },
              { key: 'items', label: 'Madde Analizi' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition-all
                  ${tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}
                `}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Canlı Takip */}
          {tab === 'live' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-700 text-sm">Katılımcılar</h3>
                <button
                  onClick={() => exportToExcel(exam ? { ...exam, submissions } : { submissions }, questions)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
                >
                  📥 Excel'e Aktar
                </button>
              </div>

              {submissions.length === 0 ? (
                <div className="text-center py-12 text-gray-300 text-sm">
                  Henüz katılımcı yok…
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {submissions.map((sub, i) => {
                    const duration = sub.start_at && sub.finished_at
                      ? Math.round((new Date(sub.finished_at) - new Date(sub.start_at)) / 60000)
                      : null

                    return (
                      <div key={sub.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
                        <span className="text-xs text-gray-400 w-5">{i + 1}</span>

                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700">
                            {sub.student?.student_name ?? 'Bilinmiyor'}
                          </p>
                          <p className="text-xs text-gray-400">{sub.student?.student_number}</p>
                        </div>

                        {/* Cevap ilerleme çubuğu */}
                        <div className="w-32">
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-400 rounded-full"
                              style={{
                                width: `${(Object.keys(sub.answers ?? {}).length / questions.length) * 100}%`
                              }}
                            />
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5 text-right">
                            {Object.keys(sub.answers ?? {}).length}/{questions.length}
                          </p>
                        </div>

                        {/* Durum */}
                        {sub.finished_at ? (
                          <div className="text-right">
                            <span className="text-sm font-bold text-blue-700">
                              {sub.score?.toFixed(2)} net
                            </span>
                            {duration != null && (
                              <p className="text-xs text-gray-400">{duration} dk</p>
                            )}
                          </div>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"/>
                            Devam ediyor
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* İstatistik */}
          {tab === 'stats' && (
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Ortalama Net',    value: stats.avg.toFixed(2),    sub: `/ ${questions.length}` },
                { label: 'Standart Sapma',  value: stats.stdDev.toFixed(2), sub: '' },
                { label: 'Tamamlayan',      value: finished,                sub: `/ ${total} kişi` },
                { label: 'Soru Sayısı',     value: questions.length,        sub: 'soru' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-400 mb-1">{s.label}</p>
                  <p className="text-3xl font-bold text-gray-800">
                    {s.value}
                    {s.sub && <span className="text-base font-normal text-gray-400 ml-1">{s.sub}</span>}
                  </p>
                </div>
              ))}

              {/* Net dağılım çubuğu (basit) */}
              {submissions.filter(s => s.finished_at).length > 0 && (
                <div className="col-span-2 bg-white rounded-2xl border border-gray-200 p-5">
                  <p className="text-sm font-medium text-gray-700 mb-4">Net Dağılımı</p>
                  <div className="flex items-end gap-1 h-20">
                    {Array.from({ length: 10 }, (_, i) => {
                      const min   = (questions.length / 10) * i
                      const max   = (questions.length / 10) * (i + 1)
                      const count = submissions.filter(s =>
                        s.finished_at && (s.score ?? 0) >= min && (s.score ?? 0) < max
                      ).length
                      const maxCount = Math.max(...Array.from({ length: 10 }, (_, j) => {
                        const jMin = (questions.length / 10) * j
                        const jMax = (questions.length / 10) * (j + 1)
                        return submissions.filter(s =>
                          s.finished_at && (s.score ?? 0) >= jMin && (s.score ?? 0) < jMax
                        ).length
                      }), 1)
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs text-gray-400">{count || ''}</span>
                          <div
                            className="w-full bg-blue-200 rounded-t-md transition-all"
                            style={{ height: `${(count / maxCount) * 60}px`, minHeight: count ? 4 : 0 }}
                          />
                          <span className="text-xs text-gray-300">{Math.round(min)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Madde Analizi */}
          {tab === 'items' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-700 text-sm">Madde Analizi</h3>
                <p className="text-xs text-gray-400 mt-0.5">Her soru için şık dağılımı ve güçlük yüzdesi</p>
              </div>
              <div className="p-2">
                <ItemAnalysis items={stats.items} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
