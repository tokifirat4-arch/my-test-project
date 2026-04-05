'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadOpenCV, readOpticalForm, buildFormConfig } from '@/lib/opticalReader'
import { generateOpticalFormPDF, generateOpticalFormSVG } from '@/lib/opticalFormDesigner'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

const OPTS = ['A','B','C','D','E']

// ─── Güven rozeti ─────────────────────────────────────────────
function ConfBadge({ conf }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
      ${conf === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
      {conf === 'high' ? '✓' : '?'}
    </span>
  )
}

// ─── Tek tarama sonucu kartı ──────────────────────────────────
function ScanResultCard({ result, questions, onAccept, onDiscard, idx }) {
  const [editing, setEditing]   = useState(false)
  const [answers, setAnswers]   = useState({ ...result.answers })
  const [warnings] = useState(result.warnings ?? [])

  const lowConf = Object.entries(result.confidence)
    .filter(([, c]) => c !== 'high').map(([q]) => q)

  const handleSave = () => { onAccept({ ...result, answers }); setEditing(false) }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Başlık */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-bold text-gray-400 w-5">#{idx + 1}</span>
        <div className="flex-1">
          <p className="font-semibold text-gray-700 text-sm">
            No: <span className="font-mono text-blue-600">{result.studentNumber || '—'}</span>
          </p>
          {lowConf.length > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">
              {lowConf.length} belirsiz cevap: {lowConf.join(', ')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(e => !e)}
            className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">
            {editing ? 'Kapat' : 'Düzenle'}
          </button>
          <button onClick={() => onAccept({ ...result, answers })}
            className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">
            Kabul
          </button>
          <button onClick={onDiscard}
            className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100">
            Sil
          </button>
        </div>
      </div>

      {/* Uyarılar */}
      {warnings.map((w, i) => (
        <div key={i} className="mx-4 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          ⚠ {w}
        </div>
      ))}

      {/* Cevap grid */}
      <div className="p-4">
        <div className="grid grid-cols-10 gap-1.5">
          {(questions?.length ? questions : Array.from({ length: Object.keys(answers).length }, (_, i) => ({ order_index: i, correct_answer: null }))).map((q, i) => {
            const num = i + 1
            const ans = answers[num]
            const correct = q.correct_answer
            const isRight = correct && ans === correct
            const isWrong = correct && ans && ans !== correct

            return (
              <div key={num} className={`rounded-lg p-1 text-center transition-all
                ${isRight ? 'bg-green-50 border border-green-200' :
                  isWrong ? 'bg-red-50 border border-red-200' :
                  !ans ? 'bg-gray-50 border border-gray-100' :
                  'bg-blue-50 border border-blue-200'}`}>
                <div className="text-gray-300 text-xs leading-none">{num}</div>
                {editing ? (
                  <select
                    value={ans ?? ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [num]: e.target.value || null }))}
                    className="w-full text-xs border-none bg-transparent text-center font-bold text-gray-700 focus:outline-none"
                  >
                    <option value="">—</option>
                    {OPTS.slice(0, q.choiceCount ?? 5).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <div className={`text-xs font-bold leading-none mt-0.5
                    ${isRight ? 'text-green-600' : isWrong ? 'text-red-600' : ans ? 'text-blue-600' : 'text-gray-300'}`}>
                    {ans || '○'}
                  </div>
                )}
                {result.confidence[num] === 'low' && ans && (
                  <div className="w-1.5 h-1.5 bg-amber-400 rounded-full mx-auto mt-0.5"/>
                )}
              </div>
            )
          })}
        </div>

        {editing && (
          <button onClick={handleSave}
            className="mt-3 w-full py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
            Değişiklikleri Kaydet
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Kamera Örtüsü (4 köşe kılavuzu) ─────────────────────────
function CameraOverlay() {
  const size = 20
  const corners = [
    { top: 8, left: 8, borderTop: true, borderLeft: true },
    { top: 8, right: 8, borderTop: true, borderRight: true },
    { bottom: 8, left: 8, borderBottom: true, borderLeft: true },
    { bottom: 8, right: 8, borderBottom: true, borderRight: true },
  ]

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Karartma maskeleri */}
      <div className="absolute inset-0 bg-black/40"/>
      {/* Merkez temiz alan */}
      <div className="absolute inset-10 bg-transparent"
        style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }}/>

      {/* Köşe kılavuzları */}
      {corners.map((c, i) => (
        <div key={i} className="absolute" style={{
          top: c.top, bottom: c.bottom, left: c.left, right: c.right,
          width: size, height: size,
          borderTopWidth:    c.borderTop    ? 3 : 0,
          borderLeftWidth:   c.borderLeft   ? 3 : 0,
          borderBottomWidth: c.borderBottom ? 3 : 0,
          borderRightWidth:  c.borderRight  ? 3 : 0,
          borderColor: '#22d3ee',
          borderStyle: 'solid',
        }}/>
      ))}

      {/* Yatay kılavuz çizgisi */}
      <div className="absolute left-10 right-10 top-1/2 -translate-y-px h-px bg-cyan-400/40"/>
      <div className="absolute top-10 bottom-10 left-1/2 -translate-x-px w-px bg-cyan-400/40"/>

      <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-cyan-300 font-medium">
        Formu çerçeve içine yerleştirin
      </p>
    </div>
  )
}

// ─── ANA BILEŞEN ─────────────────────────────────────────────
export default function OpticalScanner({ questions = [], examId = null, onResults }) {
  const [cvLoaded, setCvLoaded]     = useState(false)
  const [cvError, setCvError]       = useState('')
  const [mode, setMode]             = useState('idle') // idle | camera | file | processing | results
  const [formConfig, setFormConfig] = useState(() =>
    buildFormConfig(Math.max(questions.length, 10), 5, true)
  )
  const [results, setResults]       = useState([])
  const [accepted, setAccepted]     = useState([])
  const [progress, setProgress]     = useState(0)
  const [debugUrl, setDebugUrl]     = useState(null)
  const [formSvg, setFormSvg]       = useState('')
  const [activeTab, setActiveTab]   = useState('scan') // scan | design | results

  const videoRef   = useRef()
  const debugRef   = useRef()
  const streamRef  = useRef()

  // ── OpenCV yükle ─────────────────────────────────────────
  useEffect(() => {
    loadOpenCV()
      .then(() => setCvLoaded(true))
      .catch(e  => setCvError(e.message))
  }, [])

  // ── Form SVG önizlemesi ───────────────────────────────────
  useEffect(() => {
    setFormSvg(generateOpticalFormSVG({
      questionCount:    formConfig.questionCount,
      choiceCount:      formConfig.choiceCount,
      columns:          formConfig.questionCount > 40 ? 2 : 1,
      studentNumDigits: formConfig.numDigits,
    }))
  }, [formConfig.questionCount, formConfig.choiceCount, formConfig.numDigits])

  // ── Kamera aç ────────────────────────────────────────────
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      streamRef.current      = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setMode('camera')
    } catch (e) {
      alert('Kamera erişimi reddedildi: ' + e.message)
    }
  }

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    setMode('idle')
  }

  // ── Kameradan çek ve oku ──────────────────────────────────
  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !cvLoaded) return
    setMode('processing'); setProgress(0)

    const snap    = document.createElement('canvas')
    snap.width    = videoRef.current.videoWidth
    snap.height   = videoRef.current.videoHeight
    snap.getContext('2d').drawImage(videoRef.current, 0, 0)

    try {
      const result = await readOpticalForm(snap, formConfig, {
        debugCanvas: debugRef.current,
        onProgress:  setProgress,
      })
      setResults(prev => [{ ...result, id: Date.now() }, ...prev])
      if (debugRef.current)
        setDebugUrl(debugRef.current.toDataURL('image/jpeg', 0.85))
      setMode('camera')
    } catch (err) {
      alert('Okuma hatası: ' + err.message)
      setMode('camera')
    }
  }, [cvLoaded, formConfig])

  // ── Dosyadan oku ──────────────────────────────────────────
  const handleFileUpload = useCallback(async (files) => {
    if (!cvLoaded) return
    setMode('processing')
    const newResults = []

    for (let i = 0; i < files.length; i++) {
      setProgress(Math.round((i / files.length) * 90))
      const url = URL.createObjectURL(files[i])
      const img = await new Promise((res, rej) => {
        const el  = new Image()
        el.onload = () => res(el)
        el.onerror = rej
        el.src = url
      })

      try {
        const result = await readOpticalForm(img, formConfig, {
          debugCanvas: debugRef.current,
          onProgress:  p => setProgress(Math.round((i / files.length) * 90 + p * 0.1)),
        })
        newResults.push({ ...result, id: Date.now() + i, filename: files[i].name })
        if (i === 0 && debugRef.current)
          setDebugUrl(debugRef.current.toDataURL('image/jpeg', 0.85))
      } catch (err) {
        console.error(`${files[i].name} okuma hatası:`, err.message)
      }
      URL.revokeObjectURL(url)
    }

    setResults(prev => [...newResults, ...prev])
    setProgress(100)
    setMode('results')
    setActiveTab('results')
  }, [cvLoaded, formConfig])

  // ── Kabul edilen sonuçları Supabase'e kaydet ──────────────
  const handleSaveAll = async () => {
    if (!examId || !accepted.length) return
    let saved = 0
    for (const r of accepted) {
      try {
        // Öğrenciyi numara ile bul
        const { data: student } = await supabase
          .from('students')
          .select('id')
          .eq('student_number', r.studentNumber)
          .single()

        if (!student) { console.warn('Öğrenci bulunamadı:', r.studentNumber); continue }

        await supabase.from('submissions').upsert({
          exam_id:    examId,
          student_id: student.id,
          answers:    r.answers,
          finished_at: new Date().toISOString(),
        }, { onConflict: 'exam_id,student_id' })

        // Skoru hesapla
        const { data: sub } = await supabase
          .from('submissions')
          .select('id')
          .eq('exam_id', examId)
          .eq('student_id', student.id)
          .single()

        if (sub) await supabase.rpc('calculate_score', { p_submission_id: sub.id })
        saved++
      } catch (err) {
        console.error('Kayıt hatası:', err)
      }
    }
    alert(`${saved} / ${accepted.length} sonuç kaydedildi.`)
    onResults?.(accepted)
  }

  // ── Excel çıktısı ─────────────────────────────────────────
  const handleExcel = () => {
    const rows = accepted.map((r, i) => {
      const row = { Sıra: i + 1, 'Öğrenci No': r.studentNumber }
      Object.entries(r.answers).forEach(([q, a]) => { row[`S${q}`] = a ?? '' })
      return row
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Optik Okuma')
    XLSX.writeFile(wb, `optik_sonuclar_${Date.now()}.xlsx`)
  }

  // ── Form PDF indir ────────────────────────────────────────
  const handleFormPDF = () => {
    const pdf = generateOpticalFormPDF({
      questionCount:    formConfig.questionCount,
      choiceCount:      formConfig.choiceCount,
      studentNumDigits: formConfig.numDigits,
      title:            'Cevap Kağıdı',
    })
    pdf.save(`optik_form_${formConfig.questionCount}soru.pdf`)
  }

  // ─── RENDER ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto p-4">
      {/* OpenCV durumu */}
      {!cvLoaded && !cvError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
          <span className="animate-spin">⏳</span> OpenCV.js yükleniyor…
        </div>
      )}
      {cvError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠ OpenCV yüklenemedi: {cvError}
        </div>
      )}

      {/* Sekme çubuğu */}
      <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
        {[
          { key: 'scan',    label: 'Tarama' },
          { key: 'design',  label: 'Form Tasarımı' },
          { key: 'results', label: `Sonuçlar (${accepted.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${activeTab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TARAMA SEKMESİ ── */}
      {activeTab === 'scan' && (
        <div className="flex flex-col gap-4">
          {/* Form yapılandırması */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-700 text-sm mb-3">Form Yapılandırması</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Soru Sayısı</label>
                <input type="number" min={5} max={120} value={formConfig.questionCount}
                  onChange={e => setFormConfig(buildFormConfig(+e.target.value, formConfig.choiceCount))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Şık Sayısı</label>
                <select value={formConfig.choiceCount}
                  onChange={e => setFormConfig(buildFormConfig(formConfig.questionCount, +e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value={3}>3 (A-B-C)</option>
                  <option value={4}>4 (A-D)</option>
                  <option value={5}>5 (A-E)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Öğrenci No</label>
                <input type="number" min={4} max={12} value={formConfig.numDigits}
                  onChange={e => setFormConfig(c => ({ ...c, numDigits: +e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
            </div>
          </div>

          {/* Tarama butonları */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={mode === 'camera' ? closeCamera : openCamera}
              disabled={!cvLoaded}
              className={`py-4 rounded-2xl font-semibold text-sm transition-all flex flex-col items-center gap-2
                ${mode === 'camera'
                  ? 'bg-red-100 text-red-700 border-2 border-red-300'
                  : cvLoaded
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-100'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
              <span className="text-2xl">{mode === 'camera' ? '⏹' : '📷'}</span>
              {mode === 'camera' ? 'Kamerayı Kapat' : 'Kamera ile Tara'}
            </button>

            <label className={`py-4 rounded-2xl font-semibold text-sm flex flex-col items-center gap-2 border-2 border-dashed transition-all cursor-pointer
              ${cvLoaded ? 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'}`}>
              <span className="text-2xl">📁</span>
              Dosyadan Yükle
              <input type="file" accept="image/*" multiple className="hidden"
                disabled={!cvLoaded}
                onChange={e => e.target.files?.length && handleFileUpload(Array.from(e.target.files))}/>
            </label>
          </div>

          {/* Kamera görünümü */}
          {mode === 'camera' && (
            <div className="relative bg-black rounded-2xl overflow-hidden">
              <video ref={videoRef} className="w-full max-h-96 object-contain" playsInline muted/>
              <CameraOverlay />
              <button onClick={captureAndScan}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 w-16 h-16 bg-white rounded-full shadow-2xl flex items-center justify-center hover:scale-105 transition-transform active:scale-95">
                <span className="text-2xl">📸</span>
              </button>
            </div>
          )}

          {/* İşleme ilerleme */}
          {mode === 'processing' && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center">
              <div className="text-3xl mb-3 animate-spin">⚙️</div>
              <p className="font-semibold text-blue-700 mb-3">Form işleniyor…</p>
              <div className="w-full h-3 bg-blue-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}/>
              </div>
              <p className="text-xs text-blue-500 mt-1">{progress}%</p>
            </div>
          )}

          {/* Debug canvas */}
          <canvas ref={debugRef} className="hidden"/>
          {debugUrl && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">Son Tarama (Debug)</span>
                <button onClick={() => setDebugUrl(null)} className="text-gray-400 hover:text-gray-600 text-xs">Kapat</button>
              </div>
              <img src={debugUrl} alt="debug" className="w-full max-h-64 object-contain p-2"/>
            </div>
          )}

          {/* Son sonuçlar */}
          {results.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-700 text-sm">Taranan Formlar ({results.length})</h3>
                <button onClick={() => setResults([])} className="text-xs text-red-400 hover:text-red-600">Temizle</button>
              </div>
              {results.map((r, i) => (
                <ScanResultCard
                  key={r.id}
                  result={r}
                  questions={questions}
                  idx={i}
                  onAccept={r => setAccepted(prev => {
                    const idx = prev.findIndex(a => a.id === r.id)
                    if (idx >= 0) { const n = [...prev]; n[idx] = r; return n }
                    return [...prev, r]
                  })}
                  onDiscard={() => setResults(prev => prev.filter(x => x.id !== r.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── FORM TASARIMI SEKMESİ ── */}
      {activeTab === 'design' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-700">Form Önizleme</h3>
              <button onClick={handleFormPDF}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
                📥 PDF İndir
              </button>
            </div>
            <div className="border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm"
              dangerouslySetInnerHTML={{ __html: formSvg }}/>
            <p className="text-xs text-gray-400 mt-3 text-center">
              {formConfig.questionCount} soru · {formConfig.choiceCount} şık · {formConfig.numDigits} basamaklı no
            </p>
          </div>
        </div>
      )}

      {/* ── SONUÇLAR SEKMESİ ── */}
      {activeTab === 'results' && (
        <div className="flex flex-col gap-4">
          {accepted.length === 0 ? (
            <div className="text-center py-12 text-gray-300">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm">Henüz kabul edilmiş sonuç yok</p>
              <p className="text-xs mt-1">Tarama sekmesinden formları kabul edin</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-gray-700">{accepted.length} form kabul edildi</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={handleExcel}
                    className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700">
                    📊 Excel'e Aktar
                  </button>
                  {examId && (
                    <button onClick={handleSaveAll}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
                      💾 Sınava Kaydet
                    </button>
                  )}
                </div>
              </div>

              {/* Özet tablo */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Sıra</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Öğrenci No</th>
                      <th className="text-center px-4 py-2 text-gray-500 font-medium">Belirsiz</th>
                      <th className="text-center px-4 py-2 text-gray-500 font-medium">Cevaplanan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accepted.map((r, i) => {
                      const lowConf = Object.values(r.confidence).filter(c => c !== 'high').length
                      const answered = Object.values(r.answers).filter(Boolean).length
                      return (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-500 text-xs">{i + 1}</td>
                          <td className="px-4 py-2 font-mono font-semibold text-blue-600">{r.studentNumber || '—'}</td>
                          <td className="text-center px-4 py-2">
                            {lowConf > 0 && <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{lowConf}</span>}
                          </td>
                          <td className="text-center px-4 py-2 text-gray-700 font-medium">{answered}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
