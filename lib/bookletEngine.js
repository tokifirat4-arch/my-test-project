// lib/bookletEngine.js
// Kitapçık Gruplama Motoru — A/B/C/D (veya özel) kitapçıkları
// Her kitapçıkta sorular karıştırılır, şıklar ayrıca karıştırılabilir.
// Otomatik cevap anahtarı üretilir.
// generatePDF ile entegre çalışır.

import { jsPDF } from 'jspdf'

// ─── Fisher-Yates karıştırma ─────────────────────────────────
function shuffle(arr, seed) {
  // Deterministik karıştırma: aynı seed → aynı sonuç (tekrar üretilebilir)
  const a   = [...arr]
  let   rng = seed
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff
    return (rng >>> 0) / 0xffffffff
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ─── Şık haritası oluştur ────────────────────────────────────
// Örnek: ['A','B','C','D','E'] → ['C','A','E','B','D']
// Doğru cevap hangi yeni pozisyona geldi?
function buildChoiceMap(originalOrder, shuffledOrder) {
  // shuffledOrder[i] = orijinal şık harfi
  // Yeni A = shuffledOrder[0], Yeni B = shuffledOrder[1]…
  const map = {}
  shuffledOrder.forEach((orig, newIdx) => {
    map[orig] = String.fromCharCode(65 + newIdx) // 'A'=65
  })
  return map
}

const ANSWER_OPTS = ['A', 'B', 'C', 'D', 'E']

// ─── Tek kitapçık oluştur ────────────────────────────────────
/**
 * @param {Object[]} questions        - Orijinal soru dizisi
 * @param {Object}   bookletConfig
 *   @param {string}   bookletConfig.label           - 'A' | 'B' | 'C' | 'D'
 *   @param {number}   bookletConfig.questionSeed     - Soru sırası tohumu
 *   @param {boolean}  bookletConfig.shuffleChoices   - Şıkları da karıştır?
 *   @param {number}   bookletConfig.choiceSeed       - Şık sırası tohumu
 * @returns {{ label, questions, answerKey }}
 *   answerKey: [{ num, correctAnswer }]  (bu kitapçıktaki doğru cevaplar)
 */
export function buildBooklet(questions, bookletConfig) {
  const { label, questionSeed, shuffleChoices = false, choiceSeed = 42 } = bookletConfig

  // 1. Grupları koru: grup içi sıra sabit kalır, gruplar arası karışır
  const groups     = []
  const standalone = []
  const seen       = new Set()

  questions.forEach(q => {
    if (!q.group_id) { standalone.push([q]); return }
    if (seen.has(q.group_id)) return
    seen.add(q.group_id)
    groups.push(questions.filter(x => x.group_id === q.group_id))
  })

  // Tüm birimler (grup = bir birim, tekil = bir birim)
  const units = [...groups, ...standalone]

  // 2. Birimleri karıştır
  const shuffledUnits = shuffle(units, questionSeed)

  // 3. Düzleştir ve yeni order_index ata
  const shuffledQuestions = shuffledUnits.flat().map((q, i) => {
    const newQ = { ...q, order_index: i }

    // 4. Şık karıştırma (görsel sorularda metadata üzerinden)
    if (shuffleChoices && q.choices) {
      const origOpts    = ANSWER_OPTS.slice(0, q.choices.length)
      const shuffled    = shuffle(origOpts, choiceSeed + i)
      const choiceMap   = buildChoiceMap(origOpts, shuffled)
      newQ.choices      = shuffled.map(k => q.choices[ANSWER_OPTS.indexOf(k)])
      newQ.correct_answer = choiceMap[q.correct_answer]
      newQ._choiceMap   = choiceMap
    }

    return newQ
  })

  // 5. Cevap anahtarı
  const answerKey = shuffledQuestions.map((q, i) => ({
    num:           i + 1,
    correctAnswer: q.correct_answer,
    originalId:    q.id,
  }))

  return { label, questions: shuffledQuestions, answerKey }
}

// ─── Tüm kitapçıkları oluştur ────────────────────────────────
/**
 * @param {Object[]} questions
 * @param {string[]} labels     - ['A','B','C','D']
 * @param {Object}   opts
 * @returns {Array<{ label, questions, answerKey }>}
 */
export function buildAllBooklets(questions, labels = ['A','B','C','D'], opts = {}) {
  return labels.map((label, i) => buildBooklet(questions, {
    label,
    questionSeed:   opts.baseQuestionSeed ? opts.baseQuestionSeed + i * 997 : Date.now() + i * 997,
    shuffleChoices: opts.shuffleChoices ?? false,
    choiceSeed:     opts.baseChoiceSeed  ? opts.baseChoiceSeed  + i * 31  : 12345 + i * 31,
  }))
}

// ─── Cevap anahtarı PDF'i üret ───────────────────────────────
/**
 * Tüm kitapçıkların cevap anahtarını tek PDF olarak çıkarır.
 * @param {Array<{ label, answerKey }>} booklets
 * @param {Object} pdfSettings
 */
export function generateAnswerKeyPDF(booklets, pdfSettings = {}) {
  const { title = 'Test', schoolName = '', margins = { top: 20, bottom: 20, left: 15, right: 15 } } = pdfSettings

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const PAGE_W = 210
  const PAGE_H = 297

  booklets.forEach((booklet, bi) => {
    if (bi > 0) pdf.addPage()

    let y = margins.top

    // Başlık
    if (schoolName) {
      pdf.setFontSize(10).setFont(undefined, 'normal')
      pdf.text(schoolName, PAGE_W / 2, y, { align: 'center' })
      y += 6
    }
    pdf.setFontSize(13).setFont(undefined, 'bold')
    pdf.text(`${title} — Kitapçık ${booklet.label}`, PAGE_W / 2, y, { align: 'center' })
    y += 5
    pdf.setFontSize(9).setFont(undefined, 'normal')
    pdf.text('CEVAP ANAHTARI', PAGE_W / 2, y, { align: 'center' })
    y += 8

    pdf.setDrawColor(200)
    pdf.setLineWidth(0.3)
    pdf.line(margins.left, y, PAGE_W - margins.right, y)
    y += 6

    // Anahtar tablosu: 5 sütun
    const cols     = 5
    const cellW    = 10
    const cellH    = 7
    const tableW   = cols * cellW
    const startX   = (PAGE_W - tableW) / 2

    // Başlık satırı
    pdf.setFontSize(8).setFont(undefined, 'bold')
    pdf.text('No', startX + 2, y + 4)
    pdf.text('Cevap', startX + 5, y + 4, { align: 'center' })
    y += cellH

    // Cevaplar
    booklet.answerKey.forEach((item, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const x   = startX + col * cellW
      const iy  = y + row * cellH

      // Satır arkaplanı (çift/tek)
      if (idx % 2 === 0) {
        pdf.setFillColor(248, 248, 248)
        pdf.rect(x, iy, cellW * cols, cellH, 'F')
      }

      pdf.setDrawColor(220)
      pdf.setLineWidth(0.2)
      pdf.rect(x, iy, cellW, cellH)

      pdf.setFontSize(7).setFont(undefined, 'normal').setTextColor(100)
      pdf.text(`${item.num}`, x + 2, iy + 4)

      pdf.setFontSize(9).setFont(undefined, 'bold').setTextColor(0, 60, 180)
      pdf.text(item.correctAnswer, x + cellW - 2, iy + 4, { align: 'right' })
    })

    // Toplam soru sayısı
    const totalRows = Math.ceil(booklet.answerKey.length / cols)
    y += totalRows * cellH + 6
    pdf.setFontSize(8).setFont(undefined, 'normal').setTextColor(120)
    pdf.text(`Toplam: ${booklet.answerKey.length} soru`, PAGE_W / 2, y, { align: 'center' })
  })

  pdf.save(`cevap_anahtari_${Date.now()}.pdf`)
}

// ─── Karşılaştırma tablosu (öğretmen için) ───────────────────
/**
 * Kitapçık A'daki soru N → diğer kitapçıklarda kaçıncı soru?
 * @param {Array<{ label, questions }>} booklets
 * @returns {Object} crossRef[questionId][bookletLabel] = orderIndex
 */
export function buildCrossReference(booklets) {
  const ref = {}
  booklets.forEach(b => {
    b.questions.forEach(q => {
      if (!ref[q.id]) ref[q.id] = {}
      ref[q.id][b.label] = q.order_index + 1
    })
  })
  return ref
}
