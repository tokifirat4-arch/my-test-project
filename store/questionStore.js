// store/questionStore.js
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  getQuestions,
  upsertQuestion,
  deleteQuestion,
  reorderQuestions,
  uploadQuestionImage,
  deleteQuestionImage,
} from '@/lib/supabase'

function detectAnswerFromFilename(filename) {
  const match = filename.match(/[_\-\s]?([A-Ea-e])[_\-\s.]/)
  if (!match) return null
  return match[1].toUpperCase()
}

// ─── Açıklamaları bağlı sorularının hemen önüne yerleştirir ──
// Sürükle-bırak sonrası her zaman çağrılır.
function stabilizeDescriptions(questions) {
  const result = [...questions]

  const descIds = result
    .filter(q => q.metadata?.is_description)
    .map(q => q.id)

  for (const descId of descIds) {
    const descIdx = result.findIndex(q => q.id === descId)
    if (descIdx === -1) continue

    const linkedIdxs = result
      .map((q, i) => (q.metadata?.linked_description_id === descId ? i : -1))
      .filter(i => i !== -1)

    if (linkedIdxs.length === 0) continue

    const firstLinkedIdx = Math.min(...linkedIdxs)

    // Açıklama zaten hemen önündeyse dokunma
    if (descIdx === firstLinkedIdx - 1) continue

    // Açıklamayı çıkar
    const [desc] = result.splice(descIdx, 1)

    // Çıkarma sonrası indeksleri güncelle
    const adjusted = linkedIdxs.map(i => (i > descIdx ? i - 1 : i))
    const target = Math.min(...adjusted)

    // Hemen önüne ekle
    result.splice(target, 0, desc)
  }

  return result
}

const useQuestionStore = create(
  persist(
    (set, get) => ({
      questions:      [],
      activeTestId:   null,
      isLoading:      false,
      uploadProgress: {},
      selectedIds:    new Set(),
      isDirty:        false,

      // ─── FETCH ─────────────────────────────────────────────
      loadQuestions: async (testId) => {
        set({ isLoading: true, activeTestId: testId })
        try {
          const data = await getQuestions(testId)
          set({ questions: data, isLoading: false, isDirty: false })
        } catch (err) {
          console.error('Sorular yüklenemedi:', err)
          set({ isLoading: false })
        }
      },

      // ─── DOSYA EKLE ────────────────────────────────────────
      addFiles: (files) => {
        const existing = get().questions
        const newOnes  = Array.from(files).map((file, i) => {
          const tempId     = `temp_${Date.now()}_${i}`
          const autoAnswer = detectAnswerFromFilename(file.name) ?? 'A'
          const localUrl   = URL.createObjectURL(file)
          return {
            id:             tempId,
            test_id:        get().activeTestId,
            image_url:      localUrl,
            correct_answer: autoAnswer,
            order_index:    existing.length + i,
            group_id:       null,
            metadata: {
              is_description:        false,
              is_expanded:           false,
              linked_description_id: null,
              points:                1,
              source_filename:       file.name,
            },
            _localFile: file,
            _isNew:     true,
          }
        })
        set({ questions: [...existing, ...newOnes], isDirty: true })
      },

      // ─── SORU GÜNCELLE ─────────────────────────────────────
      updateQuestion: (id, updates) => {
        set(state => ({
          questions: state.questions.map(q => q.id === id ? { ...q, ...updates } : q),
          isDirty: true,
        }))
      },

      // ─── AÇIKLAMA MODU ─────────────────────────────────────
      // is_description = true → kart okuma parçası / paragraf olur
      // Açıklama yapılan kartın linked_description_id'si temizlenir
      // (Açıklama başka bir açıklamaya bağlanamaz)
      setDescriptionMode: (id, isDesc) => {
        set(state => ({
          questions: state.questions.map(q => {
            if (q.id !== id) return q
            return {
              ...q,
              correct_answer: isDesc ? '-' : (q.correct_answer === '-' ? 'A' : q.correct_answer),
              metadata: {
                ...q.metadata,
                is_description:        isDesc,
                linked_description_id: isDesc ? null : q.metadata?.linked_description_id,
              },
            }
          }),
          isDirty: true,
        }))
      },

      // ─── AÇIKLAMAYA BAĞLA ──────────────────────────────────
      // questionId → descId sorusuna bağlanır
      // descId = null ise bağlantı kaldırılır
      linkDescription: (questionId, descId) => {
        set(state => {
          const updated = state.questions.map(q =>
            q.id === questionId
              ? { ...q, metadata: { ...q.metadata, linked_description_id: descId } }
              : q
          )
          return {
            questions: stabilizeDescriptions(updated).map((q, i) => ({ ...q, order_index: i })),
            isDirty: true,
          }
        })
      },

      // ─── SORU SİL ──────────────────────────────────────────
      removeQuestion: async (id) => {
        const q = get().questions.find(q => q.id === id)
        if (!q) return
        if (q._isNew && q.image_url?.startsWith('blob:')) URL.revokeObjectURL(q.image_url)
        if (!q._isNew) {
          try {
            await deleteQuestion(id)
            if (q.image_url) await deleteQuestionImage(q.image_url)
          } catch (err) { console.error('Silme hatası:', err) }
        }
        // Eğer açıklama kartı silindiyse, bağlı soruların bağlantısını temizle
        set(state => ({
          questions: state.questions
            .filter(item => item.id !== id)
            .map((item, i) => ({
              ...item,
              order_index: i,
              metadata: {
                ...item.metadata,
                linked_description_id:
                  item.metadata?.linked_description_id === id
                    ? null
                    : item.metadata?.linked_description_id,
              },
            })),
          isDirty: true,
        }))
      },

      // ─── SIRALAMA ──────────────────────────────────────────
      // Sürükle-bırak sonrası açıklamalar bağlı sorularının hemen önüne sabitlenir
      reorder: (fromIndex, toIndex) => {
        const qs = [...get().questions]
        const [moved] = qs.splice(fromIndex, 1)
        qs.splice(toIndex, 0, moved)
        const stabilized = stabilizeDescriptions(qs)
        set({
          questions: stabilized.map((q, i) => ({ ...q, order_index: i })),
          isDirty: true,
        })
      },

      // ─── GRUP ──────────────────────────────────────────────
      groupSelected: () => {
        const groupId = `grp_${Date.now()}`
        const ids     = get().selectedIds
        set(state => ({
          questions:   state.questions.map(q => ids.has(q.id) ? { ...q, group_id: groupId } : q),
          selectedIds: new Set(),
          isDirty:     true,
        }))
      },

      ungroupSelected: () => {
        const ids = get().selectedIds
        set(state => ({
          questions:   state.questions.map(q => ids.has(q.id) ? { ...q, group_id: null } : q),
          selectedIds: new Set(),
          isDirty:     true,
        }))
      },

      // ─── SEÇİM ─────────────────────────────────────────────
      toggleSelect: (id) => {
        set(state => {
          const next = new Set(state.selectedIds)
          next.has(id) ? next.delete(id) : next.add(id)
          return { selectedIds: next }
        })
      },

      clearSelection: () => set({ selectedIds: new Set() }),

      // ─── TOPLU KAYDET ──────────────────────────────────────
      saveAll: async () => {
        const testId = get().activeTestId
        if (!testId) throw new Error('Aktif test yok')
        const qs = get().questions
        set({ isLoading: true })

        for (const q of qs) {
          if (q._isNew && q._localFile) {
            set(state => ({ uploadProgress: { ...state.uploadProgress, [q.id]: 10 } }))
            const imageUrl = await uploadQuestionImage(q._localFile, testId)
            set(state => ({ uploadProgress: { ...state.uploadProgress, [q.id]: 80 } }))
            URL.revokeObjectURL(q.image_url)
            const saved = await upsertQuestion({
              test_id:        testId,
              image_url:      imageUrl,
              correct_answer: q.correct_answer,
              order_index:    q.order_index,
              group_id:       q.group_id,
              metadata:       q.metadata,
            })
            set(state => ({
              questions: state.questions.map(item =>
                item.id === q.id ? { ...saved, _isNew: false, _localFile: null } : item
              ),
              uploadProgress: { ...state.uploadProgress, [q.id]: 100 },
            }))
          } else if (!q._isNew) {
            await upsertQuestion({
              id:             q.id,
              test_id:        testId,
              image_url:      q.image_url,
              correct_answer: q.correct_answer,
              order_index:    q.order_index,
              group_id:       q.group_id,
              metadata:       q.metadata,
            })
          }
        }

        await reorderQuestions(
          get().questions
            .filter(q => !q._isNew)
            .map(q => ({ id: q.id, order_index: q.order_index, test_id: testId, correct_answer: q.correct_answer }))
        )

        set({ isLoading: false, isDirty: false, uploadProgress: {} })
      },

      // ─── TASLAK ────────────────────────────────────────────
      exportDraft: () => {
        const qs   = get().questions.map(({ _localFile, ...q }) => q)
        const blob = new Blob([JSON.stringify({ questions: qs }, null, 2)], { type: 'application/json' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href = url; a.download = `taslak_${Date.now()}.json`; a.click()
        URL.revokeObjectURL(url)
      },

      importDraft: (jsonString) => {
        try {
          const { questions } = JSON.parse(jsonString)
          set({ questions, isDirty: true })
        } catch { throw new Error('Geçersiz taslak dosyası') }
      },

      // ─── SIFIRLA ───────────────────────────────────────────
      reset: () => {
        get().questions.forEach(q => {
          if (q._isNew && q.image_url?.startsWith('blob:')) URL.revokeObjectURL(q.image_url)
        })
        set({ questions: [], uploadProgress: {}, selectedIds: new Set(), isDirty: false })
      },
    }),

    {
      name: 'question-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        questions:   state.questions.map(({ _localFile, ...q }) => q),
        activeTestId: state.activeTestId,
      }),
    }
  )
)

export default useQuestionStore
