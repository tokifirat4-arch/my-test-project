'use client'

import { useCallback, useRef, useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import useQuestionStore from '@/store/questionStore'

const ANSWERS = ['A', 'B', 'C', 'D', 'E']

// ─── Açıklama kartı renk paleti (her açıklama farklı renk alır) ──
const DESC_COLORS = [
  { bg: 'bg-orange-50',  border: 'border-orange-300', badge: 'bg-orange-100 text-orange-700',  dot: 'bg-orange-400' },
  { bg: 'bg-violet-50',  border: 'border-violet-300', badge: 'bg-violet-100 text-violet-700',  dot: 'bg-violet-400' },
  { bg: 'bg-teal-50',    border: 'border-teal-300',   badge: 'bg-teal-100 text-teal-700',      dot: 'bg-teal-400'   },
  { bg: 'bg-rose-50',    border: 'border-rose-300',   badge: 'bg-rose-100 text-rose-700',      dot: 'bg-rose-400'   },
  { bg: 'bg-amber-50',   border: 'border-amber-300',  badge: 'bg-amber-100 text-amber-700',    dot: 'bg-amber-400'  },
]

function getDescColor(descId, descriptions) {
  const idx = descriptions.findIndex(d => d.id === descId)
  return DESC_COLORS[idx % DESC_COLORS.length] ?? DESC_COLORS[0]
}

// ─── Açıklama paneli (kart altında inline açılır) ─────────────
function DescriptionPanel({ question, descriptions, onClose }) {
  const { setDescriptionMode, linkDescription, updateQuestion } = useQuestionStore()
  const isDesc     = question.metadata?.is_description
  const linkedId   = question.metadata?.linked_description_id
  const linkedDesc = descriptions.find(d => d.id === linkedId)

  return (
    <div
      className="border-t border-gray-100 bg-gray-50 rounded-b-xl px-4 py-3 flex flex-col gap-3"
      onClick={e => e.stopPropagation()}
    >
      {/* ── Açıklama metni toggle ── */}
      <label className="flex items-center gap-3 cursor-pointer select-none group">
        <div
          onClick={() => setDescriptionMode(question.id, !isDesc)}
          className={`
            w-10 h-5 rounded-full transition-colors relative flex-shrink-0
            ${isDesc ? 'bg-orange-400' : 'bg-gray-300'}
          `}
        >
          <span className={`
            absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
            ${isDesc ? 'translate-x-5' : 'translate-x-0'}
          `} />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-700">Açıklama / Okuma Parçası</p>
          <p className="text-xs text-gray-400">Bu kart bir soru değil, üstteki paragraf/metin bloğudur</p>
        </div>
      </label>

      {/* ── Açıklama değilse → başka bir açıklamaya bağla ── */}
      {!isDesc && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1.5">Bu soruyu bir açıklamaya bağla</p>
          {descriptions.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Henüz açıklama kartı yok. Bir kartı açıklama olarak işaretle.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {/* Bağlantıyı kaldır */}
              <button
                onClick={() => linkDescription(question.id, null)}
                className={`
                  px-3 py-1 rounded-full text-xs font-medium border transition-all
                  ${!linkedId
                    ? 'bg-gray-200 text-gray-600 border-gray-300'
                    : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}
                `}
              >
                Bağlantısız
              </button>

              {/* Her açıklama için bir buton */}
              {descriptions.map((desc, idx) => {
                const color  = DESC_COLORS[idx % DESC_COLORS.length]
                const active = linkedId === desc.id
                return (
                  <button
                    key={desc.id}
                    onClick={() => linkDescription(question.id, active ? null : desc.id)}
                    className={`
                      px-3 py-1 rounded-full text-xs font-semibold border transition-all
                      ${active
                        ? `${color.badge} ${color.border} ring-1 ring-offset-1`
                        : `bg-white ${color.border} text-gray-500 hover:${color.bg}`}
                    `}
                  >
                    {active ? '✓ ' : ''}Açıklama {idx + 1}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onClose}
        className="self-end text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Kapat ✕
      </button>
    </div>
  )
}

// ─── Tek soru kartı ───────────────────────────────────────────
function QuestionCard({ question, index, descriptions }) {
  const { updateQuestion, removeQuestion, toggleSelect, selectedIds } = useQuestionStore()
  const isSelected   = selectedIds.has(question.id)
  const [hovered, setHovered]   = useState(false)
  const [preview, setPreview]   = useState(false)
  const [showPanel, setShowPanel] = useState(false)

  const isDesc   = question.metadata?.is_description
  const linkedId = question.metadata?.linked_description_id
  const linkedDesc = descriptions.find(d => d.id === linkedId)
  const descIdx    = descriptions.findIndex(d => d.id === (isDesc ? question.id : linkedId))
  const color      = descIdx >= 0 ? DESC_COLORS[descIdx % DESC_COLORS.length] : null

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: question.id })

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(question.id) }}
      className={`
        relative group rounded-xl border transition-all duration-150
        ${isDesc
          ? `${color?.bg ?? 'bg-orange-50'} ${color?.border ?? 'border-orange-300'}`
          : color
            ? `bg-white ${color.border} border-l-4`
            : `bg-white ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300'}`}
        ${question._isNew ? 'border-dashed' : ''}
      `}
    >
      {/* ── Sürükleme tutacı ── */}
      <div
        {...attributes}
        {...listeners}
        className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab text-gray-300 hover:text-gray-500 z-10"
      >
        ⠿
      </div>

      {/* ── Kart içeriği ── */}
      <div className="flex items-start gap-3 p-3 pl-7">
        {/* Numara + tür rozeti */}
        <div className="flex flex-col items-center gap-1 w-7 shrink-0">
          <span className="text-xs font-bold text-gray-400 mt-1">
            {isDesc ? '📋' : index + 1}
          </span>
        </div>

        {/* Görsel */}
        <div className={`
          w-24 h-16 rounded-lg overflow-hidden shrink-0 border
          ${isDesc ? 'border-orange-200 bg-orange-50' : 'bg-gray-100 border-gray-200'}
        `}>
          {question.image_url ? (
            <img
              src={question.image_url}
              alt={`Soru ${index + 1}`}
              className="w-full h-full object-contain"
              onDoubleClick={() => setPreview(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
              {isDesc ? 'Metin' : 'Görsel'}
            </div>
          )}
        </div>

        {/* Sağ panel */}
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {/* Açıklama kartıysa label, değilse cevap seçici */}
          {isDesc ? (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full self-start ${color?.badge ?? 'bg-orange-100 text-orange-700'}`}>
              Açıklama {descIdx + 1}
            </span>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">Cevap</span>
              <div className="flex gap-1">
                {ANSWERS.map(ans => (
                  <button
                    key={ans}
                    onClick={() => updateQuestion(question.id, { correct_answer: ans })}
                    className={`
                      w-7 h-7 rounded-full text-xs font-bold transition-all
                      ${question.correct_answer === ans
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-500 hover:bg-blue-50'}
                    `}
                  >
                    {ans}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bağlantı rozeti */}
          {!isDesc && linkedDesc && (
            <span className={`text-xs px-2 py-0.5 rounded-full self-start font-medium ${color?.badge}`}>
              🔗 Açıklama {descIdx + 1}
            </span>
          )}

          {/* Geniş toggle + Düzenle butonu */}
          <div className="flex items-center gap-3 mt-0.5">
            {!isDesc && (
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={question.metadata?.is_expanded ?? false}
                  onChange={e => updateQuestion(question.id, {
                    metadata: { ...question.metadata, is_expanded: e.target.checked }
                  })}
                  className="accent-blue-600"
                />
                Geniş
              </label>
            )}
            <button
              onClick={() => setShowPanel(v => !v)}
              className={`
                text-xs px-2 py-0.5 rounded-lg border transition-all ml-auto
                ${showPanel
                  ? 'bg-blue-50 border-blue-200 text-blue-600'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}
              `}
            >
              {showPanel ? 'Kapat' : '⚙ Düzenle'}
            </button>
          </div>
        </div>

        {/* Yeni rozeti */}
        {question._isNew && (
          <span className="shrink-0 text-xs text-amber-500 font-medium">● Yeni</span>
        )}
      </div>

      {/* ── Hover aksiyonlar ── */}
      {hovered && !showPanel && (
        <div className="absolute top-2 right-2 flex gap-1 z-20">
          <button
            onClick={() => setPreview(true)}
            className="px-2 py-1 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            Önizle
          </button>
          <button
            onClick={() => removeQuestion(question.id)}
            className="px-2 py-1 text-xs bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 text-red-600"
          >
            Sil
          </button>
        </div>
      )}

      {/* ── Düzenle paneli ── */}
      {showPanel && (
        <DescriptionPanel
          question={question}
          descriptions={descriptions}
          onClose={() => setShowPanel(false)}
        />
      )}

      {/* ── Önizleme modal ── */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setPreview(false)}
        >
          <div
            className="bg-white rounded-2xl p-4 max-w-2xl w-full mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <span className="font-semibold text-gray-700">
                {isDesc ? `Açıklama ${descIdx + 1}` : `Soru ${index + 1}`} Önizleme
              </span>
              <button onClick={() => setPreview(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            {question.image_url && (
              <img src={question.image_url} alt="" className="w-full rounded-xl border border-gray-100" />
            )}
            {!isDesc && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-gray-500">Doğru cevap:</span>
                <span className="font-bold text-blue-600 text-lg">{question.correct_answer}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Yükleme ilerleme çubuğu ──────────────────────────────────
function UploadProgressBar({ progress }) {
  const entries = Object.entries(progress)
  if (!entries.length) return null
  const avg = entries.reduce((s, [, v]) => s + v, 0) / entries.length
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl p-4 w-64">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-700">Yükleniyor…</span>
        <span className="text-sm text-blue-600">{Math.round(avg)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${avg}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-1">{entries.length} dosya işleniyor</p>
    </div>
  )
}

// ─── ANA BİLEŞEN ──────────────────────────────────────────────
export default function QuestionUploader({ testId }) {
  const {
    questions, isLoading, uploadProgress, selectedIds, isDirty,
    addFiles, reorder, saveAll, exportDraft, importDraft,
    groupSelected, ungroupSelected, clearSelection,
  } = useQuestionStore()

  const [dragOver, setDragOver]   = useState(false)
  const fileInputRef  = useRef()
  const draftInputRef = useRef()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Tüm açıklama kartları (bağlantı seçenekleri için)
  const descriptions = questions.filter(q => q.metadata?.is_description)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    )
    if (files.length) addFiles(files)
  }, [addFiles])

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const oldIdx = questions.findIndex(q => q.id === active.id)
    const newIdx = questions.findIndex(q => q.id === over.id)
    reorder(oldIdx, newIdx)
  }

  const handleDraftImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => importDraft(ev.target.result)
    reader.readAsText(file)
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Araç Çubuğu */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => fileInputRef.current.click()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Soru Ekle
        </button>
        <input
          ref={fileInputRef}
          type="file" multiple accept="image/*,application/pdf"
          className="hidden"
          onChange={e => addFiles(Array.from(e.target.files))}
        />

        {selectedIds.size > 0 && (
          <>
            <button onClick={groupSelected} className="px-3 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-xl text-sm hover:bg-purple-100">
              Grupla ({selectedIds.size})
            </button>
            <button onClick={ungroupSelected} className="px-3 py-2 bg-gray-50 text-gray-600 border border-gray-200 rounded-xl text-sm hover:bg-gray-100">
              Grubu Kaldır
            </button>
            <button onClick={clearSelection} className="px-3 py-2 text-gray-400 text-sm hover:text-gray-600">
              Seçimi temizle
            </button>
          </>
        )}

        <div className="ml-auto flex gap-2">
          <button onClick={() => draftInputRef.current.click()} className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Taslak Yükle
          </button>
          <input ref={draftInputRef} type="file" accept=".json" className="hidden" onChange={handleDraftImport} />
          <button onClick={exportDraft} className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Taslak İndir
          </button>
          <button
            onClick={saveAll}
            disabled={!isDirty || isLoading}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${isDirty && !isLoading ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            {isLoading ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>

      {/* Açıklama özeti */}
      {descriptions.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {descriptions.map((d, idx) => {
            const color   = DESC_COLORS[idx % DESC_COLORS.length]
            const linked  = questions.filter(q => q.metadata?.linked_description_id === d.id)
            return (
              <div key={d.id} className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border ${color.badge} ${color.border}`}>
                <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                Açıklama {idx + 1}
                <span className="opacity-60">· {linked.length} soru</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Sürükle-bırak alanı */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !questions.length && fileInputRef.current.click()}
        className={`
          flex-shrink-0 border-2 border-dashed rounded-2xl transition-all duration-200 text-center
          ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}
          ${questions.length ? 'py-3' : 'py-12 cursor-pointer'}
        `}
      >
        {questions.length === 0 ? (
          <div className="text-gray-400">
            <div className="text-4xl mb-2">📂</div>
            <p className="text-sm font-medium">Soru görsellerini buraya sürükle</p>
            <p className="text-xs mt-1">Dosya adı "1A.png" formatındaysa cevap otomatik atanır</p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">{questions.length} kart • Dosya sürükleyerek ekleyebilirsin</p>
        )}
      </div>

      {/* Soru listesi */}
      <div className="flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2 pb-4">
              {questions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  index={i}
                  descriptions={descriptions}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {questions.length === 0 && (
          <div className="text-center py-8 text-gray-300 text-sm">Henüz soru eklenmedi</div>
        )}
      </div>

      <UploadProgressBar progress={uploadProgress} />
    </div>
  )
}
