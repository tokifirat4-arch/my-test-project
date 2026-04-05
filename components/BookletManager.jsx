'use client'

import { useState, useMemo } from 'react'
import { buildAllBooklets, generateAnswerKeyPDF, buildCrossReference } from '@/lib/bookletEngine'
import { generatePDF } from '@/lib/pdfEngine'

const PRESET_GROUPS = [
  { key: 'AB',   labels: ['A','B'],         color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'ABCD', labels: ['A','B','C','D'], color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'ABC',  labels: ['A','B','C'],     color: 'bg-teal-50 text-teal-700 border-teal-200' },
]

// ─── Mini kitapçık kart önizlemesi ───────────────────────────
function BookletCard({ booklet, totalQuestions, crossRef, referenceLabel }) {
  const [expanded, setExpanded] = useState(false)

  // Bu kitapçıkta referans kitapçıktan farklı kaç yer değişti?
  const changes = booklet.questions.filter((q, i) => {
    const refPos = crossRef?.[q.id]?.[referenceLabel]
    return refPos !== undefined && refPos !== i + 1
  }).length

  const labelColor = {
    A: 'bg-blue-600', B: 'bg-purple-600', C: 'bg-teal-600', D: 'bg-amber-600',
  }[booklet.label] ?? 'bg-gray-600'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Başlık */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div className={`w-9 h-9 rounded-xl ${labelColor} text-white font-bold flex items-center justify-center text-lg`}>
          {booklet.label}
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-700 text-sm">Kitapçık {booklet.label}</p>
          <p className="text-xs text-gray-400">{booklet.answerKey.length} soru</p>
        </div>
        {referenceLabel && referenceLabel !== booklet.label && (
          <span className="text-xs bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full">
            {changes} soru kaydı
          </span>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Cevap anahtarı — kompakt grid */}
      <div className="px-4 py-3">
        <div className="grid grid-cols-10 gap-1">
          {booklet.answerKey.map(item => (
            <div key={item.num} className="flex flex-col items-center">
              <span className="text-gray-300 text-xs leading-none">{item.num}</span>
              <span className={`
                text-xs font-bold leading-none mt-0.5
                ${{ A:'text-blue-600', B:'text-purple-600', C:'text-teal-600', D:'text-amber-600', E:'text-red-600' }[item.correctAnswer] ?? 'text-gray-600'}
              `}>{item.correctAnswer}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Genişletilmiş: tam soru sırası */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-50">
          <p className="text-xs text-gray-400 mt-3 mb-2">Soru Sırası (Orijinal No → Bu Kitapçıkta)</p>
          <div className="grid grid-cols-2 gap-1">
            {booklet.questions.map((q, i) => {
              const origPos = crossRef?.[q.id]?.['A'] ?? '?'
              return (
                <div key={q.id} className="flex items-center gap-1 text-xs">
                  <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
                  <span className="text-gray-600">← A kitapçığı {origPos}</span>
                  <span className="ml-auto font-bold text-blue-600">{q.correct_answer}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Ana Bileşen ─────────────────────────────────────────────
export default function BookletManager({ questions, pdfSettings }) {
  const [selectedPreset, setSelectedPreset]   = useState('ABCD')
  const [customLabels, setCustomLabels]        = useState('')
  const [shuffleChoices, setShuffleChoices]    = useState(false)
  const [baseSeed, setBaseSeed]               = useState(1234)
  const [booklets, setBooklets]               = useState([])
  const [crossRef, setCrossRef]               = useState({})
  const [generating, setGenerating]           = useState(false)
  const [generatingKey, setGeneratingKey]     = useState(false)
  const [progress, setProgress]              = useState({})
  const [activeBookletIdx, setActiveBookletIdx] = useState(null)

  const labels = useMemo(() => {
    if (selectedPreset === 'custom') {
      return customLabels.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 8)
    }
    return PRESET_GROUPS.find(p => p.key === selectedPreset)?.labels ?? ['A','B','C','D']
  }, [selectedPreset, customLabels])

  // ─── Kitapçıkları Oluştur ─────────────────────────────────
  const handleGenerate = () => {
    if (!questions.length) return
    const built = buildAllBooklets(questions, labels, {
      shuffleChoices,
      baseQuestionSeed: baseSeed,
      baseChoiceSeed:   baseSeed * 7,
    })
    setBooklets(built)
    setCrossRef(buildCrossReference(built))
    setActiveBookletIdx(0)
  }

  // ─── Tüm PDF'leri Üret ────────────────────────────────────
  const handleExportAll = async () => {
    setGenerating(true)
    for (let i = 0; i < booklets.length; i++) {
      const b = booklets[i]
      setProgress(p => ({ ...p, [b.label]: 5 }))
      await generatePDF(b.questions, {
        ...pdfSettings,
        title: `${pdfSettings?.title ?? 'Test'} — Kitapçık ${b.label}`,
        showAnswerKey: false, // Ayrı PDF'te
      }, (pct) => setProgress(p => ({ ...p, [b.label]: pct })))
      setProgress(p => ({ ...p, [b.label]: 100 }))
    }
    setGenerating(false)
  }

  // ─── Tek Kitapçık PDF'i ───────────────────────────────────
  const handleExportOne = async (booklet) => {
    setProgress(p => ({ ...p, [booklet.label]: 5 }))
    await generatePDF(booklet.questions, {
      ...pdfSettings,
      title: `${pdfSettings?.title ?? 'Test'} — Kitapçık ${booklet.label}`,
      showAnswerKey: false,
    }, (pct) => setProgress(p => ({ ...p, [booklet.label]: pct })))
    setProgress(p => ({ ...p, [booklet.label]: 100 }))
  }

  // ─── Cevap Anahtarı PDF'i ─────────────────────────────────
  const handleAnswerKey = () => {
    setGeneratingKey(true)
    generateAnswerKeyPDF(booklets, pdfSettings)
    setTimeout(() => setGeneratingKey(false), 1000)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Yapılandırma Paneli */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <span className="text-lg">📚</span> Kitapçık Yapılandırması
        </h3>

        {/* Preset seçimi */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-2 block">Kitapçık Grubu</label>
          <div className="flex gap-2 flex-wrap">
            {PRESET_GROUPS.map(p => (
              <button
                key={p.key}
                onClick={() => setSelectedPreset(p.key)}
                className={`
                  px-4 py-2 rounded-xl border text-sm font-medium transition-all
                  ${selectedPreset === p.key
                    ? p.color + ' shadow-sm'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}
                `}
              >
                {p.labels.join(' / ')}
              </button>
            ))}
            <button
              onClick={() => setSelectedPreset('custom')}
              className={`
                px-4 py-2 rounded-xl border text-sm font-medium transition-all
                ${selectedPreset === 'custom'
                  ? 'bg-gray-100 text-gray-700 border-gray-300'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}
              `}
            >
              Özel…
            </button>
          </div>

          {selectedPreset === 'custom' && (
            <input
              type="text"
              value={customLabels}
              onChange={e => setCustomLabels(e.target.value)}
              placeholder="A, B, C, X, Y (virgülle ayır)"
              className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Rastgelelik tohumu */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Karıştırma Tohumu
              <span className="ml-1 text-gray-300">(aynı seed = aynı kitapçık)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={baseSeed}
                onChange={e => setBaseSeed(+e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => setBaseSeed(Math.floor(Math.random() * 99999))}
                className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-100"
                title="Rastgele seed üret"
              >
                🎲
              </button>
            </div>
          </div>

          {/* Şık karıştırma */}
          <div className="flex flex-col justify-end">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shuffleChoices}
                onChange={e => setShuffleChoices(e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <div>
                <p className="text-sm text-gray-700 font-medium">Şıkları da karıştır</p>
                <p className="text-xs text-gray-400">Her kitapçıkta A/B/C/D sırası değişir</p>
              </div>
            </label>
          </div>
        </div>

        {/* Oluştur */}
        <button
          onClick={handleGenerate}
          disabled={!questions.length || !labels.length}
          className={`
            mt-5 w-full py-3 rounded-2xl font-semibold text-sm transition-all
            ${questions.length && labels.length
              ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-100'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'}
          `}
        >
          {labels.length
            ? `${labels.join(' / ')} Kitapçıklarını Oluştur (${questions.length} soru)`
            : 'Kitapçık etiketi seçin'}
        </button>
      </div>

      {/* Kitapçıklar */}
      {booklets.length > 0 && (
        <>
          {/* Aksiyon çubuğu */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportAll}
              disabled={generating}
              className={`
                flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all
                ${generating
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-100'}
              `}
            >
              📄 {generating ? 'PDF\'ler Oluşturuluyor…' : `Tüm ${booklets.length} Kitapçığı İndir`}
            </button>

            <button
              onClick={handleAnswerKey}
              disabled={generatingKey}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl font-medium text-sm hover:bg-green-700 disabled:opacity-50"
            >
              🗝 Cevap Anahtarı PDF
            </button>
          </div>

          {/* Her kitapçık için ilerleme + kart */}
          <div className="grid grid-cols-1 gap-3">
            {booklets.map((booklet, i) => (
              <div key={booklet.label}>
                {/* İlerleme çubuğu */}
                {progress[booklet.label] !== undefined && progress[booklet.label] < 100 && (
                  <div className="mb-1.5">
                    <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                      <span>Kitapçık {booklet.label} PDF oluşturuluyor…</span>
                      <span>{progress[booklet.label]}%</span>
                    </div>
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${progress[booklet.label]}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="relative">
                  <BookletCard
                    booklet={booklet}
                    totalQuestions={questions.length}
                    crossRef={crossRef}
                    referenceLabel={booklets[0]?.label}
                  />
                  {/* Tek kitapçık indirme */}
                  <button
                    onClick={() => handleExportOne(booklet)}
                    disabled={generating}
                    className="absolute top-3 right-12 text-xs px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-30"
                  >
                    PDF ↓
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Çapraz referans tablosu */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h4 className="font-semibold text-gray-700 text-sm">Çapraz Referans Tablosu</h4>
              <p className="text-xs text-gray-400 mt-0.5">
                Aynı soru farklı kitapçıklarda kaçıncı sırada?
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 text-gray-500 font-medium border-b border-gray-200 w-8">A</th>
                    {booklets.slice(1).map(b => (
                      <th key={b.label} className="text-center px-3 py-2 text-gray-500 font-medium border-b border-gray-200">
                        {b.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {booklets[0].questions.map((q, i) => (
                    <tr key={q.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-semibold text-gray-600">{i + 1}</td>
                      {booklets.slice(1).map(b => {
                        const pos = crossRef?.[q.id]?.[b.label] ?? '?'
                        const moved = pos !== i + 1
                        return (
                          <td key={b.label} className="text-center px-3 py-1.5">
                            <span className={moved ? 'font-bold text-blue-600' : 'text-gray-400'}>
                              {pos}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Boş durum */}
      {!questions.length && (
        <div className="text-center py-10 text-gray-300 text-sm">
          Kitapçık oluşturmak için önce soru ekleyin
        </div>
      )}
    </div>
  )
}
