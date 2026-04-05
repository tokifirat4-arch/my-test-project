'use client'
import { Suspense, useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import useQuestionStore from '@/store/questionStore'
import { createTest, getTests } from '@/lib/supabase'
import { generatePDF } from '@/lib/pdfEngine'

const QuestionUploader = dynamic(() => import('@/components/QuestionUploader'), { ssr: false })
const TeacherPanel     = dynamic(() => import('@/components/TeacherPanel'),     { ssr: false })
const BookletManager   = dynamic(() => import('@/components/BookletManager'),   { ssr: false })
const CropEditor       = dynamic(() => import('@/components/CropEditor'),       { ssr: false })
const OpticalScanner   = dynamic(() => import('@/components/OpticalScanner'),   { ssr: false })
const AnalyticsPanel   = dynamic(() => import('@/components/AnalyticsPanel'),   { ssr: false })

const LAYOUTS = [
  { key: 'yazili', label: 'Yazılı', icon: '📄' },
  { key: 'yaprak', label: 'Yaprak', icon: '📋' },
  { key: 'deneme', label: 'Deneme', icon: '📝' },
]

function LivePreview({ questions, settings }) {
  const { columns, margins = { left: 15, right: 15, top: 20, bottom: 20 } } = settings
  const scale = 220 / 297
  const cols  = Array.from({ length: columns }, () => [])
  questions.forEach((q, i) => cols[i % columns].push(q))
  return (
    <div className="relative bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mx-auto"
      style={{ width: 210 * scale, height: 297 * scale }}>
      <div className="absolute top-0 left-0 right-0 text-center py-1 border-b border-gray-100">
        <div className="font-bold text-gray-700 truncate px-2" style={{ fontSize: 7 }}>{settings.title || 'Test Başlığı'}</div>
      </div>
      <div className="absolute flex gap-0.5"
        style={{ top: 18, left: margins.left * scale * 0.4, right: margins.right * scale * 0.4, bottom: margins.bottom * scale * 0.4 }}>
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-0.5 flex-1 overflow-hidden">
            {col.slice(0, 10).map((q, qi) => (
              <div key={qi} className="bg-gray-50 rounded border border-gray-100" style={{ height: Math.max(10, Math.min(24, (q.heightMM ?? 20) * scale * 0.35)) }}>
                <div className="text-gray-400 px-0.5" style={{ fontSize: 4.5 }}>{q.order_index + 1}</div>
              </div>
            ))}
            {col.length > 10 && <div className="text-center text-gray-300" style={{ fontSize: 4.5 }}>+{col.length - 10}</div>}
          </div>
        ))}
      </div>
      {settings.watermark?.text && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-gray-200 font-bold rotate-45 select-none" style={{ fontSize: 14, opacity: 0.12 }}>{settings.watermark.text}</span>
        </div>
      )}
    </div>
  )
}

function SettingsSidebar({ settings, onChange, onGenerate, isGenerating, progress, onOpenCrop }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Test Başlığı</label>
        <input type="text" value={settings.title ?? ''} onChange={e => onChange({ title: e.target.value })}
          placeholder="Matematik 1. Dönem…"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Okul Adı</label>
        <input type="text" value={settings.schoolName ?? ''} onChange={e => onChange({ schoolName: e.target.value })}
          placeholder="Atatürk Anadolu Lisesi"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-2 block">Test Türü</label>
        <div className="grid grid-cols-3 gap-1.5">
          {LAYOUTS.map(l => (
            <button key={l.key} onClick={() => onChange({ layout: l.key })}
              className={`py-2.5 rounded-xl text-xs font-medium flex flex-col items-center gap-1 border transition-all
                ${settings.layout === l.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
              <span className="text-base">{l.icon}</span>{l.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">Sütun Sayısı</label>
        <div className="flex gap-1.5">
          {[1,2,3].map(n => (
            <button key={n} onClick={() => onChange({ columns: n })}
              className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all
                ${settings.columns === n ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Süre: <strong>{settings.examTime ?? 40} dk</strong></label>
        <input type="range" min={10} max={180} step={5} value={settings.examTime ?? 40}
          onChange={e => onChange({ examTime: +e.target.value })} className="w-full accent-blue-600"/>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Net Hesabı</label>
        <select value={settings.scoring?.wrong_penalty ?? 0.25}
          onChange={e => onChange({ scoring: { wrong_penalty: +e.target.value } })}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value={0}>Götürmez</option>
          <option value={0.25}>¼ Yanlış</option>
          <option value={0.33}>⅓ Yanlış</option>
          <option value={0.5}>½ Yanlış</option>
          <option value={1}>1 Tam</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Filigran</label>
        <input type="text" value={settings.watermark?.text ?? ''} onChange={e => onChange({ watermark: { ...settings.watermark, text: e.target.value } })}
          placeholder="Gizli, Taslak…"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={settings.designColor ?? '#1e40af'} onChange={e => onChange({ designColor: e.target.value })}
          className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer"/>
        <span className="text-xs text-gray-500 font-mono">{settings.designColor ?? '#1e40af'}</span>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input type="checkbox" checked={settings.showAnswerKey ?? true} onChange={e => onChange({ showAnswerKey: e.target.checked })} className="accent-blue-600"/>
        Cevap anahtarı ekle
      </label>
      <button onClick={onOpenCrop}
        className="w-full py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 flex items-center justify-center gap-2">
        ✂ Kırpma Editörü
      </button>
      <button onClick={onGenerate} disabled={isGenerating}
        className={`w-full py-3 rounded-2xl font-semibold text-sm transition-all ${isGenerating ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'}`}>
        {isGenerating ? `PDF Oluşturuluyor… ${progress}%` : '📄 PDF Oluştur'}
      </button>
      {isGenerating && (
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }}/>
        </div>
      )}
    </div>
  )
}

export default function DashboardPage({ preloadTestId }) {
  const { questions, loadQuestions } = useQuestionStore()
  const [settings, setSettings] = useState({
    layout: 'yaprak', columns: 2, title: '', schoolName: '',
    examTime: 40, scoring: { wrong_penalty: 0.25 },
    watermark: { text: '', opacity: 0.12 },
    designColor: '#1e40af', showAnswerKey: true,
    margins: { top: 20, bottom: 20, left: 15, right: 15 },
  })
  const [activeTab, setActiveTab]         = useState('questions')
  const [isGenerating, setIsGenerating]   = useState(false)
  const [progress, setProgress]           = useState(0)
  const [tests, setTests]                 = useState([])
  const [currentTestId, setCurrentTestId] = useState(preloadTestId ?? null)
  const [showCropEditor, setShowCropEditor] = useState(false)
  const [activeExamId, setActiveExamId]   = useState(null)

  const updateSettings = p => setSettings(s => ({ ...s, ...p }))

  useEffect(() => { getTests().then(setTests).catch(console.error) }, [])
  useEffect(() => { if (preloadTestId) loadQuestions(preloadTestId) }, [preloadTestId])

  const handleGenerate = async () => {
    if (!questions.length) return alert('Önce soru ekleyin')
    setIsGenerating(true); setProgress(0)
    try { await generatePDF(questions, { ...settings, testId: currentTestId }, setProgress) }
    catch (err) { alert('Hata: ' + err.message) }
    finally { setIsGenerating(false); setProgress(0) }
  }

  const TABS = [
    { key: 'questions', label: `Sorular (${questions.length})` },
    { key: 'booklets',  label: 'Kitapçıklar' },
    { key: 'exam',      label: 'Online Sınav' },
    { key: 'analytics', label: '📊 Analiz' },
    { key: 'optical',   label: '🔬 Optik' },
    { key: 'preview',   label: 'Önizleme' },
  ]

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-72 bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">
        <div className="px-4 py-3 border-b border-gray-100">
          <label className="text-xs text-gray-500 mb-1 block">Aktif Test</label>
          <div className="flex gap-2">
            <select className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={currentTestId ?? ''} onChange={e => { if(e.target.value) { setCurrentTestId(e.target.value); loadQuestions(e.target.value) } }}>
              <option value="">— Seç —</option>
              {tests.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button onClick={async () => {
              const title = prompt('Test başlığı:')
              if (!title) return
              const test = await createTest(title, settings)
              setTests(p => [test, ...p]); setCurrentTestId(test.id); await loadQuestions(test.id)
            }} className="px-3 py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl text-sm hover:bg-blue-100">+ Yeni</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <SettingsSidebar settings={settings} onChange={updateSettings}
            onGenerate={handleGenerate} isGenerating={isGenerating}
            progress={progress} onOpenCrop={() => setShowCropEditor(true)}/>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-1 overflow-x-auto shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all
                ${activeTab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'questions' && (
            <div className="h-full p-4 overflow-y-auto">
              <Suspense fallback={<div className="text-center py-10 text-gray-400">Yükleniyor…</div>}>
                <QuestionUploader testId={currentTestId}/>
              </Suspense>
            </div>
          )}
          {activeTab === 'booklets' && (
            <div className="h-full overflow-y-auto p-4">
              <Suspense fallback={<div className="text-center py-10 text-gray-400">Yükleniyor…</div>}>
                <BookletManager questions={questions} pdfSettings={settings}/>
              </Suspense>
            </div>
          )}
          {activeTab === 'exam' && (
            <div className="h-full overflow-y-auto">
              <Suspense fallback={<div className="text-center py-10 text-gray-400">Yükleniyor…</div>}>
                <TeacherPanel testId={currentTestId} onExamCreated={setActiveExamId}/>
              </Suspense>
            </div>
          )}
          {activeTab === 'analytics' && (
            <div className="h-full overflow-hidden">
              <Suspense fallback={<div className="text-center py-10 text-gray-400">Yükleniyor…</div>}>
                <AnalyticsPanel examId={activeExamId} questions={questions} meta={{ title: settings.title, examTime: settings.examTime }}/>
              </Suspense>
            </div>
          )}
          {activeTab === 'optical' && (
            <div className="h-full overflow-hidden">
              <Suspense fallback={<div className="text-center py-10 text-gray-400">Yükleniyor…</div>}>
                <OpticalScanner questions={questions} examId={activeExamId}/>
              </Suspense>
            </div>
          )}
          {activeTab === 'preview' && (
            <div className="h-full flex items-center justify-center bg-gray-100">
              <div className="text-center">
                <LivePreview questions={questions} settings={settings}/>
                <p className="text-xs text-gray-400 mt-3">{questions.length} soru · {settings.columns} sütun</p>
                <button onClick={handleGenerate} disabled={isGenerating || !questions.length}
                  className="mt-3 px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {isGenerating ? `${progress}%…` : '📄 PDF İndir'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {showCropEditor && (
        <Suspense fallback={null}>
          <CropEditor onClose={() => setShowCropEditor(false)}/>
        </Suspense>
      )}
    </div>
  )
}
