// store/questionStore.js
// Zustand ile soru yönetimi + taslak (draft) sistemi
// Kurulum: npm install zustand

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

// ─── Dosya adından otomatik cevap algıla ─────────────────────
// "1A.png", "03-B.jpg", "soru_12_C.png" gibi formatları destekler
function detectAnswerFromFilename(filename) {
  const match = filename.match(/[_\-\s]?([A-Ea-e])[_\-\s.]/)
  if (!match) return null
  return match[1].toUpperCase()
}

const useQuestionStore = create(
  persist(
    (set, get) => ({
      // ─── STATE ───────────────────────────────────────────────
      questions: [],          // { id, test_id, image_url, correct_answer, order_index, group_id, metadata, _localFile? }
      activeTestId: null,
      isLoading: false,
      uploadProgress: {},     // { [tempId]: 0-100 }
      selectedIds: new Set(),
      isDirty: false,         // kaydedilmemiş değişiklik var mı?

      // ─── FETCH ───────────────────────────────────────────────
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

      // ─── DOSYA(LAR) EKLE ─────────────────────────────────────
      /**
       * Birden fazla dosyayı kuyruğa alır, önizleme için local URL üretir.
       * Gerçek yükleme saveAll() ile tetiklenir.
       */
      addFiles: (files) => {
        const existing = get().questions
        const newOnes  = Array.from(files).map((file, i) => {
          const tempId        = `temp_${Date.now()}_${i}`
          const autoAnswer    = detectAnswerFromFilename(file.name) ?? 'A'
          const localUrl      = URL.createObjectURL(file)

          return {
            id:             tempId,
            test_id:        get().activeTestId,
            image_url:      localUrl,
            correct_answer: autoAnswer,
            order_index:    existing.length + i,
            group_id:       null,
            metadata:       {
              is_description: false,
              is_expanded:    false,
              points:         1,
              source_filename: file.name,
            },
            _localFile:     file,   // yükleme bekliyor
            _isNew:         true,
          }
        })

        set({ questions: [...existing, ...newOnes], isDirty: true })
      },

      // ─── SORU GÜNCELLE ───────────────────────────────────────
      updateQuestion: (id, updates) => {
        set(state => ({
          questions: state.questions.map(q => q.id === id ? { ...q, ...updates } : q),
          isDirty: true,
        }))
      },

      // ─── SORU SİL ────────────────────────────────────────────
      removeQuestion: async (id) => {
        const q = get().questions.find(q => q.id === id)
        if (!q) return

        // Local önizleme URL'ini temizle
        if (q._isNew && q.image_url?.startsWith('blob:')) {
          URL.revokeObjectURL(q.image_url)
        }

        // DB'den sil (yeni soruysa atla)
        if (!q._isNew) {
          try {
            await deleteQuestion(id)
            if (q.image_url) await deleteQuestionImage(q.image_url)
          } catch (err) {
            console.error('Silme hatası:', err)
          }
        }

        set(state => ({
          questions: state.questions
            .filter(q => q.id !== id)
            .map((q, i) => ({ ...q, order_index: i })),
          isDirty: true,
        }))
      },

      // ─── SÜRÜKLE-BIRAK SIRALAMA ──────────────────────────────
      reorder: (fromIndex, toIndex) => {
        const qs = [...get().questions]
        const [moved] = qs.splice(fromIndex, 1)
        qs.splice(toIndex, 0, moved)

        const reindexed = qs.map((q, i) => ({ ...q, order_index: i }))
        set({ questions: reindexed, isDirty: true })
      },

      // ─── GRUP OLUŞTUR / KALDIR ───────────────────────────────
      groupSelected: () => {
        const groupId = `grp_${Date.now()}`
        const ids     = get().selectedIds

        set(state => ({
          questions: state.questions.map(q =>
            ids.has(q.id) ? { ...q, group_id: groupId } : q
          ),
          selectedIds: new Set(),
          isDirty: true,
        }))
      },

      ungroupSelected: () => {
        const ids = get().selectedIds
        set(state => ({
          questions: state.questions.map(q =>
            ids.has(q.id) ? { ...q, group_id: null } : q
          ),
          selectedIds: new Set(),
          isDirty: true,
        }))
      },

      // ─── SEÇİM ───────────────────────────────────────────────
      toggleSelect: (id) => {
        set(state => {
          const next = new Set(state.selectedIds)
          next.has(id) ? next.delete(id) : next.add(id)
          return { selectedIds: next }
        })
      },

      clearSelection: () => set({ selectedIds: new Set() }),

      // ─── TOPLU KAYDET (DB + Storage) ─────────────────────────
      saveAll: async () => {
        const testId = get().activeTestId
        if (!testId) throw new Error('Aktif test yok')

        const qs = get().questions
        set({ isLoading: true })

        for (const q of qs) {
          // 1. Yeni dosyaysa önce Storage'a yükle
          if (q._isNew && q._localFile) {
            set(state => ({
              uploadProgress: { ...state.uploadProgress, [q.id]: 10 }
            }))

            const imageUrl = await uploadQuestionImage(q._localFile, testId)

            set(state => ({
              uploadProgress: { ...state.uploadProgress, [q.id]: 80 }
            }))

            // Blob URL'i temizle
            URL.revokeObjectURL(q.image_url)

            const dbRow = {
              test_id:        testId,
              image_url:      imageUrl,
              correct_answer: q.correct_answer,
              order_index:    q.order_index,
              group_id:       q.group_id,
              metadata:       q.metadata,
            }

            const saved = await upsertQuestion(dbRow)

            set(state => ({
              questions: state.questions.map(item =>
                item.id === q.id
                  ? { ...saved, _isNew: false, _localFile: null }
                  : item
              ),
              uploadProgress: { ...state.uploadProgress, [q.id]: 100 },
            }))
          } else if (!q._isNew) {
            // Mevcut soru — sadece metadata/cevap değişikliği
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

        // Sıra güncellemesini tek seferde yap
        await reorderQuestions(
          get().questions
            .filter(q => !q._isNew)
            .map(q => ({ id: q.id, order_index: q.order_index, test_id: testId, correct_answer: q.correct_answer }))
        )

        set({ isLoading: false, isDirty: false, uploadProgress: {} })
      },

      // ─── TASLAK (JSON olarak kaydet / yükle) ─────────────────
      exportDraft: () => {
        const qs = get().questions.map(({ _localFile, ...q }) => q) // File nesnesini at
        const blob = new Blob([JSON.stringify({ questions: qs }, null, 2)], { type: 'application/json' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `taslak_${Date.now()}.json`
        a.click()
        URL.revokeObjectURL(url)
      },

      importDraft: (jsonString) => {
        try {
          const { questions } = JSON.parse(jsonString)
          set({ questions, isDirty: true })
        } catch {
          throw new Error('Geçersiz taslak dosyası')
        }
      },

      // ─── SIFIRLA ─────────────────────────────────────────────
      reset: () => {
        get().questions.forEach(q => {
          if (q._isNew && q.image_url?.startsWith('blob:')) {
            URL.revokeObjectURL(q.image_url)
          }
        })
        set({ questions: [], uploadProgress: {}, selectedIds: new Set(), isDirty: false })
      },
    }),

    {
      name: 'question-store',              // localStorage anahtarı
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({            // sadece bu alanları persist et
        questions: state.questions.map(({ _localFile, ...q }) => q),
        activeTestId: state.activeTestId,
      }),
    }
  )
)

export default useQuestionStore
