'use client'

import { useEffect, useMemo, useState } from 'react'
import { examAnalysis, exportFullReportExcel } from '@/lib/analyticsEngine'
import { getExamWithSubmissions } from '@/lib/supabase'

// ─── Renk yardımcısı ──────────────────────────────────────────
const diffColor = (p) =>
  p >= 0.80 ? '#16a34a' : p >= 0.60 ? '#65a30d' : p >= 0.40 ? '#ca8a04' :
  p >= 0.20 ? '#ea580c' : '#dc2626'

const discColor = (d) =>
  d >= 0.40 ? '#2563eb' : d >= 0.30 ? '#7c3aed' : d >= 0.20 ? '#ca8a04' :
  d >= 0.10 ? '#ea580c' : '#dc2626'

// ─── Mini Histogram (SVG) ─────────────────────────────────────
function Histogram({ bins, scores, avg, median }) {
  if (!bins?.length) return null
  const maxCount = Math.max(...bins.map(b => b.count), 1)
  const W = 480, H = 140, PAD = { l: 32, r: 16, t: 16, b: 32 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const binW   = innerW / bins.length

  const scaleY = (v) => PAD.t + innerH - (v / maxCount) * innerH

  // Ortalama / medyan çizgisi X konumu
  const { min, max } = { min: bins[0].from, max: bins[bins.length - 1].to }
  const range = max - min || 1
  const avgX  = PAD.l + ((avg    - min) / range) * innerW
  const medX  = PAD.l + ((median - min) / range) * innerW

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {bins.map((bin, i) => {
        const x = PAD.l + i * binW
        const y = scaleY(bin.count)
        const h = innerH - (y - PAD.t)
        return (
          <g key={i}>
            <rect x={x + 1} y={y} width={binW - 2} height={Math.max(1, h)}
              fill="#3b82f6" opacity="0.75" rx="2"/>
            {bin.count > 0 && (
              <text x={x + binW / 2} y={y - 3} textAnchor="middle"
                fontSize="9" fill="var(--color-text-secondary)">{bin.count}</text>
            )}
          </g>
        )
      })}

      {/* X ekseni */}
      <line x1={PAD.l} y1={PAD.t + innerH} x2={PAD.l + innerW} y2={PAD.t + innerH}
        stroke="var(--color-border-tertiary)" strokeWidth="0.5"/>

      {/* X etiketleri */}
      {bins.filter((_, i) => i % 2 === 0).map((bin, i) => (
        <text key={i} x={PAD.l + (i * 2) * binW} y={H - 4}
          textAnchor="middle" fontSize="8" fill="var(--color-text-tertiary)">
          {bin.from.toFixed(1)}
        </text>
      ))}

      {/* Ortalama çizgisi */}
      <line x1={avgX} y1={PAD.t} x2={avgX} y2={PAD.t + innerH}
        stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 2"/>
      <text x={avgX + 3} y={PAD.t + 10} fontSize="9" fill="#ef4444">Ort</text>

      {/* Medyan çizgisi */}
      <line x1={medX} y1={PAD.t} x2={medX} y2={PAD.t + innerH}
        stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 2"/>
      <text x={medX + 3} y={PAD.t + 20} fontSize="9" fill="#8b5cf6">Med</text>
    </svg>
  )
}

// ─── İstatistik Kartı ─────────────────────────────────────────
function StatCard({ label, value, sub, accent = false }) {
  return (
    <div className={`rounded-2xl p-4 border ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? 'text-blue-700' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Madde Analizi Satırı ─────────────────────────────────────
function ItemRow({ item, expanded, onToggle }) {
  const OPTS = ['A','B','C','D','E']
  return (
    <>
      <tr
        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-semibold text-gray-600 text-sm">{item.questionNum}</td>
        <td className="px-3 py-2 text-center">
          <span className="font-bold text-blue-600">{item.correct}</span>
        </td>
        {OPTS.map(o => (
          <td key={o} className="px-2 py-2 text-center">
            <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium
              ${o === item.correct
                ? 'bg-green-100 text-green-700 font-bold'
                : (item.distPct[o] ?? 0) > 20
                  ? 'bg-red-50 text-red-600'
                  : 'text-gray-400'}`}>
              {item.distPct[o] ?? 0}%
            </span>
          </td>
        ))}
        <td className="px-2 py-2 text-center text-xs text-gray-400">{item.emptyPct}%</td>
        <td className="px-2 py-2 text-center">
          <span className="text-xs font-mono font-bold" style={{ color: diffColor(item.difficulty) }}>
            {item.difficulty.toFixed(2)}
          </span>
          <div className="text-xs text-gray-400">{item.diffLabel}</div>
        </td>
        <td className="px-2 py-2 text-center">
          <span className="text-xs font-mono font-bold" style={{ color: discColor(item.discrimination) }}>
            {item.discrimination.toFixed(2)}
          </span>
          <div className="text-xs text-gray-400">{item.discLabel}</div>
        </td>
        <td className="px-2 py-2 text-center text-xs font-mono text-gray-600">
          {item.rpbis.toFixed(2)}
        </td>
        <td className="px-2 py-2 text-center text-gray-400 text-xs">{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={10} className="px-4 py-3">
            <div className="flex gap-6 items-end">
              {OPTS.map(o => {
                const pct = item.distPct[o] ?? 0
                return (
                  <div key={o} className="flex flex-col items-center gap-1">
                    <span className="text-xs font-bold text-gray-600">{pct}%</span>
                    <div className="w-10 rounded-t-md" style={{
                      height: Math.max(4, pct * 1.2),
                      background: o === item.correct ? '#16a34a' : pct > 20 ? '#ef4444' : '#94a3b8',
                    }}/>
                    <span className={`text-sm font-bold ${o === item.correct ? 'text-green-600' : 'text-gray-500'}`}>{o}</span>
                  </div>
                )
              })}
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-bold text-gray-600">{item.emptyPct}%</span>
                <div className="w-10 rounded-t-md bg-gray-200" style={{ height: Math.max(4, item.emptyPct * 1.2) }}/>
                <span className="text-sm text-gray-400">Boş</span>
              </div>
              <div className="ml-auto text-xs text-gray-500 space-y-1">
                <p>Doğru: <strong className="text-gray-700">{item.nCorrect}</strong> / {item.n}</p>
                <p>Güçlük P: <strong style={{ color: diffColor(item.difficulty) }}>{item.difficulty.toFixed(2)}</strong></p>
                <p>Ayırt. D: <strong style={{ color: discColor(item.discrimination) }}>{item.discrimination.toFixed(2)}</strong></p>
                <p>r<sub>pbis</sub>: <strong className="text-gray-700">{item.rpbis.toFixed(2)}</strong></p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Harf Notu Pasta (SVG arc) ────────────────────────────────
function GradeChart({ gradeDist, total }) {
  const grades = Object.entries(gradeDist).filter(([, v]) => v > 0)
  const colors = {
    AA: '#16a34a', BA: '#65a30d', BB: '#84cc16',
    CB: '#ca8a04', CC: '#f59e0b', DC: '#ea580c', DD: '#dc2626', FF: '#7f1d1d'
  }

  if (!grades.length || !total) return (
    <div className="text-center py-6 text-gray-300 text-sm">Veri yok</div>
  )

  // Basit yatay bar chart
  return (
    <div className="flex flex-col gap-1.5">
      {grades.map(([grade, count]) => {
        const pct = Math.round((count / total) * 100)
        return (
          <div key={grade} className="flex items-center gap-2">
            <span className="text-xs font-bold w-6 text-gray-600">{grade}</span>
            <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full flex items-center pl-2 transition-all"
                style={{ width: `${Math.max(pct, 3)}%`, background: colors[grade] }}>
                {pct >= 8 && <span className="text-white text-xs font-bold">{count}</span>}
              </div>
            </div>
            <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── ANA PANEL ────────────────────────────────────────────────
export default function AnalyticsPanel({ examId, questions = [], meta = {} }) {
  const [examData, setExamData]     = useState(null)
  const [loading, setLoading]       = useState(false)
  const [activeTab, setActiveTab]   = useState('overview')
  const [expandedItem, setExpandedItem] = useState(null)
  const [exporting, setExporting]   = useState(false)
  const [sortBy, setSortBy]         = useState('questionNum') // madde sırala
  const [sortDir, setSortDir]       = useState('asc')
  const [filterFlag, setFilterFlag] = useState('all') // all | poor | good

  useEffect(() => {
    if (!examId) return
    setLoading(true)
    getExamWithSubmissions(examId)
      .then(data => {
        setExamData(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [examId])

  const submissions = examData?.submissions ?? []
  const qs          = questions.length ? questions : (examData?.test?.questions ?? [])
    .sort((a, b) => a.order_index - b.order_index)
  const penalty     = examData?.test?.settings?.scoring?.wrong_penalty ?? 0.25

  const analysis = useMemo(
    () => examAnalysis(submissions, qs, penalty),
    [submissions, qs, penalty]
  )

  // Madde sıralama + filtre
  const sortedItems = useMemo(() => {
    let items = [...(analysis.items ?? [])]

    if (filterFlag === 'poor')
      items = items.filter(i => i.difficulty < 0.3 || i.discrimination < 0.2 || i.rpbis < 0.2)
    else if (filterFlag === 'good')
      items = items.filter(i => i.difficulty >= 0.4 && i.difficulty <= 0.8 && i.discrimination >= 0.3)

    items.sort((a, b) => {
      const va = a[sortBy] ?? 0, vb = b[sortBy] ?? 0
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
    return items
  }, [analysis.items, sortBy, sortDir, filterFlag])

  const handleExport = async () => {
    setExporting(true)
    try {
      exportFullReportExcel(analysis, submissions, qs, {
        title:      meta.title      ?? examData?.test?.title,
        schoolName: meta.schoolName ?? '',
        date:       meta.date       ?? new Date().toLocaleDateString('tr-TR'),
        examTime:   meta.examTime   ?? examData?.test?.settings?.timing?.duration_minutes,
      })
    } finally {
      setTimeout(() => setExporting(false), 1200)
    }
  }

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }) =>
    sortBy === col
      ? <span className="ml-1 text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>
      : <span className="ml-1 text-gray-300">↕</span>

  if (!examId) return (
    <div className="flex items-center justify-center h-full text-gray-300">
      <div className="text-center">
        <div className="text-5xl mb-3">📊</div>
        <p className="text-sm">Analiz için bir sınav seçin</p>
      </div>
    </div>
  )

  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-400">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-spin">⏳</div>
        <p className="text-sm">Veriler yükleniyor…</p>
      </div>
    </div>
  )

  const TABS = [
    { key: 'overview', label: 'Genel Bakış' },
    { key: 'items',    label: `Madde Analizi (${analysis.items?.length ?? 0})` },
    { key: 'students', label: `Öğrenciler (${analysis.total})` },
    { key: 'dist',     label: 'Dağılım' },
  ]

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto p-4 pb-8">

      {/* Üst başlık + export */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-800">
            {examData?.test?.title ?? 'Sınav Analizi'}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {analysis.total} katılımcı · {qs.length} soru · Cronbach α = {analysis.cronbachA}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || !analysis.total}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all
            ${exporting || !analysis.total
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-100'}`}
        >
          {exporting ? '⏳ Hazırlanıyor…' : '📥 Excel Raporu İndir'}
        </button>
      </div>

      {/* Sekmeler */}
      <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${activeTab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── GENEL BAKIŞ ── */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-4">
          {/* Stat kartları */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Ortalama Net"      value={analysis.avg}        sub={`/ ${qs.length}`}     accent />
            <StatCard label="Standart Sapma"    value={analysis.sd}         sub="±" />
            <StatCard label="Medyan"            value={analysis.median} />
            <StatCard label="Başarı Yüzdesi"    value={`%${analysis.successPct}`} accent />
            <StatCard label="Minimum"           value={analysis.min} />
            <StatCard label="Maksimum"          value={analysis.max} />
            <StatCard label="25. Yüzdelik"      value={analysis.p25} />
            <StatCard label="75. Yüzdelik"      value={analysis.p75} />
            <StatCard label="Çarpıklık"         value={analysis.skewness}
              sub={analysis.skewness > 0.5 ? 'Sağa çarpık' : analysis.skewness < -0.5 ? 'Sola çarpık' : 'Simetrik'} />
            <StatCard label="Cronbach Alfa"     value={analysis.cronbachA}
              sub={analysis.cronbachA >= 0.8 ? 'Güvenilir' : analysis.cronbachA >= 0.6 ? 'Kabul' : 'Düşük'} />
            <StatCard label="Katılımcı"         value={analysis.total} />
            <StatCard label="Soru Sayısı"       value={qs.length} />
          </div>

          {/* Harf notu dağılımı */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">Harf Notu Dağılımı</h3>
            <GradeChart gradeDist={analysis.gradeDist} total={analysis.total} />
          </div>

          {/* Histogram */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-3">Net Puan Dağılımı</h3>
            <Histogram
              bins={analysis.histogram}
              scores={analysis.scores}
              avg={analysis.avg}
              median={analysis.median}
            />
            <div className="flex gap-4 mt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-red-400 inline-block"/>Ortalama ({analysis.avg})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-purple-400 inline-block"/>Medyan ({analysis.median})
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── MADDE ANALİZİ ── */}
      {activeTab === 'items' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* Filtre çubuğu */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <div className="flex gap-1">
              {[
                { key: 'all',  label: 'Tümü' },
                { key: 'poor', label: '⚠ Sorunlu' },
                { key: 'good', label: '✓ İyi' },
              ].map(f => (
                <button key={f.key} onClick={() => setFilterFlag(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${filterFlag === f.key ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 ml-auto">{sortedItems.length} soru gösteriliyor</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {[
                    ['questionNum', 'No'],
                    [null, 'Doğru'],
                    [null, 'A%'], [null, 'B%'], [null, 'C%'], [null, 'D%'], [null, 'E%'],
                    [null, 'Boş'],
                    ['difficulty', 'Güçlük P'],
                    ['discrimination', 'Ayırt. D'],
                    ['rpbis', 'r_pbis'],
                    [null, ''],
                  ].map(([col, label], i) => (
                    <th key={i}
                      onClick={() => col && handleSort(col)}
                      className={`px-2 py-2.5 text-xs font-semibold text-gray-500 text-center
                        ${col ? 'cursor-pointer hover:text-blue-600 hover:bg-blue-50' : ''}`}>
                      {label}{col && <SortIcon col={col}/>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(item => (
                  <ItemRow
                    key={item.questionNum}
                    item={item}
                    expanded={expandedItem === item.questionNum}
                    onToggle={() => setExpandedItem(n => n === item.questionNum ? null : item.questionNum)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ÖĞRENCİLER ── */}
      {activeTab === 'students' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Sıra','Ad Soyad','Numara','Doğru','Yanlış','Boş','Net','Süre'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-xs font-semibold text-gray-500 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...submissions]
                  .filter(s => s.finished_at)
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                  .map((s, i) => {
                    const dur = s.start_at && s.finished_at
                      ? Math.round((new Date(s.finished_at) - new Date(s.start_at)) / 60000) + ' dk'
                      : '—'
                    const pct = analysis.max > 0 ? Math.round(((s.score ?? 0) / analysis.max) * 100) : 0
                    return (
                      <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-700">{s.student?.student_name ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono">{s.student?.student_number ?? '—'}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-green-600 font-semibold">{s.correct ?? 0}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-red-500">{s.wrong ?? 0}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-400">{s.empty ?? 0}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-12">
                              <div className="h-full rounded-full bg-blue-500"
                                style={{ width: `${pct}%` }}/>
                            </div>
                            <span className="font-bold text-blue-700 text-xs w-10 text-right">
                              {s.score?.toFixed(2) ?? '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-400 text-xs">{dur}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DAĞILIM ── */}
      {activeTab === 'dist' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">Net Puan Histogramı</h3>
            <Histogram bins={analysis.histogram} scores={analysis.scores}
              avg={analysis.avg} median={analysis.median} />
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">Güçlük Dağılımı</h3>
            <div className="flex flex-col gap-1.5">
              {[
                { label: 'Çok Kolay (P≥0.8)',  items: analysis.items?.filter(i => i.difficulty >= 0.80) ?? [], color: '#16a34a' },
                { label: 'Kolay (P 0.6–0.8)',   items: analysis.items?.filter(i => i.difficulty >= 0.60 && i.difficulty < 0.80) ?? [], color: '#65a30d' },
                { label: 'Orta (P 0.4–0.6)',    items: analysis.items?.filter(i => i.difficulty >= 0.40 && i.difficulty < 0.60) ?? [], color: '#ca8a04' },
                { label: 'Zor (P 0.2–0.4)',     items: analysis.items?.filter(i => i.difficulty >= 0.20 && i.difficulty < 0.40) ?? [], color: '#ea580c' },
                { label: 'Çok Zor (P<0.2)',     items: analysis.items?.filter(i => i.difficulty <  0.20) ?? [], color: '#dc2626' },
              ].map(g => (
                <div key={g.label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-36 shrink-0">{g.label}</span>
                  <div className="flex-1 h-6 bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                    <div className="h-full rounded-lg flex items-center pl-2 transition-all"
                      style={{ width: `${Math.max((g.items.length / Math.max(qs.length, 1)) * 100, g.items.length ? 3 : 0)}%`, background: g.color }}>
                      {g.items.length > 0 && (
                        <span className="text-white text-xs font-bold">{g.items.length}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-24 text-right">
                    {g.items.length > 0 ? `S${g.items.map(i => i.questionNum).join(', S')}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Güvenilirlik özeti */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">Cronbach Alfa Güvenilirlik</h3>
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="38" fill="none" stroke="#f1f5f9" strokeWidth="10"/>
                  <circle cx="50" cy="50" r="38" fill="none"
                    stroke={analysis.cronbachA >= 0.8 ? '#16a34a' : analysis.cronbachA >= 0.6 ? '#ca8a04' : '#dc2626'}
                    strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 38}`}
                    strokeDashoffset={`${2 * Math.PI * 38 * (1 - Math.min(1, analysis.cronbachA))}`}/>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold text-gray-800">{analysis.cronbachA}</span>
                </div>
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                {[
                  ['α ≥ 0.9', 'Mükemmel'],
                  ['α ≥ 0.8', 'İyi'],
                  ['α ≥ 0.7', 'Kabul Edilebilir'],
                  ['α ≥ 0.6', 'Şüpheli'],
                  ['α < 0.6', 'Yetersiz'],
                ].map(([range, label]) => (
                  <p key={range} className="flex gap-2">
                    <span className="font-mono text-xs text-gray-400 w-16">{range}</span>
                    <span>{label}</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
