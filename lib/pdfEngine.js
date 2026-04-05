// lib/pdfEngine.js
// Akıllı PDF Mizanpaj Motoru
// Kurulum: npm install jspdf

import { jsPDF } from 'jspdf'

// ─── SABITLER ────────────────────────────────────────────────
const PAGE_W_MM  = 210   // A4 genişlik
const PAGE_H_MM  = 297   // A4 yükseklik
const PT_TO_MM   = 0.352778

// ─── YARDIMCI: Canvas üzerinden görsel boyutunu MM'ye çevir ──
async function imageToMMDimensions(imageUrl, targetWidthMM) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const ratio      = img.naturalHeight / img.naturalWidth
      const heightMM   = targetWidthMM * ratio
      resolve({ widthMM: targetWidthMM, heightMM, img })
    }
    img.onerror = () => resolve({ widthMM: targetWidthMM, heightMM: 40, img: null })
    img.src = imageUrl
  })
}

// ─── YARDIMCI: Sütun genişliğini hesapla ─────────────────────
function columnWidth(pageW, columns, margins, colGap = 5) {
  const usable = pageW - margins.left - margins.right
  return (usable - colGap * (columns - 1)) / columns
}

// ─── AKILLI YERLEŞİM ALGORİTMASI ─────────────────────────────
/**
 * Soruları sütunlara doldurur. Grup bütünlüğünü korur.
 * Genişletilmiş sorular iki sütuna yayılır.
 *
 * @param {Object[]} questions   - Soru nesneleri (image_url, metadata, heightMM eklendi)
 * @param {Object}   settings    - { columns, margins, colGap }
 * @returns {Object[][]}         - Her eleman bir sayfa; sayfalar sütun dizisi içerir
 */
function layoutQuestions(questions, settings) {
  const { columns, margins, colGap = 5 } = settings
  const colW   = columnWidth(PAGE_W_MM, columns, margins, colGap)
  const colH   = PAGE_H_MM - margins.top - margins.bottom
  const pages  = []

  let currentPage = Array.from({ length: columns }, () => ({ items: [], usedH: 0 }))
  pages.push(currentPage)

  const newPage = () => {
    currentPage = Array.from({ length: columns }, () => ({ items: [], usedH: 0 }))
    pages.push(currentPage)
    return currentPage
  }

  // En az dolu sütunu bul
  const leastFullCol = () => {
    let minH = Infinity, idx = 0
    currentPage.forEach((col, i) => {
      if (col.usedH < minH) { minH = col.usedH; idx = i }
    })
    return idx
  }

  // Grup bütünlüğü: grup sorularının toplam yüksekliği
  const groupMap = {}
  questions.forEach(q => {
    if (q.group_id) {
      groupMap[q.group_id] = (groupMap[q.group_id] ?? 0) + (q.heightMM ?? 40) + 4
    }
  })

  let i = 0
  while (i < questions.length) {
    const q = questions[i]

    // Genişletilmiş soru (iki sütuna yayılır)
    if (q.metadata?.is_expanded && columns > 1) {
      const h = (q.heightMM ?? 40) + 4
      const maxUsed = Math.max(...currentPage.map(c => c.usedH))
      if (maxUsed + h > colH) newPage()

      // Tüm sütunlara aynı yüksekliği ekle, ilk sütuna soruyu koy
      currentPage[0].items.push({ ...q, spanAll: true })
      currentPage.forEach(col => { col.usedH += h })
      i++; continue
    }

    // Paragraf grubu (aynı sütunda kalsın)
    if (q.group_id && q.metadata?.is_description) {
      const totalH = groupMap[q.group_id] ?? 0
      const colIdx = leastFullCol()
      const col    = currentPage[colIdx]

      if (col.usedH + totalH > colH) newPage()

      // Gruptaki tüm soruları bu sütuna yerleştir
      const groupItems = questions.slice(i).filter(gq => gq.group_id === q.group_id)
      const targetCol  = currentPage[leastFullCol()]
      groupItems.forEach(gq => {
        targetCol.items.push(gq)
        targetCol.usedH += (gq.heightMM ?? 40) + 4
      })
      i += groupItems.length; continue
    }

    // Normal soru
    const h      = (q.heightMM ?? 40) + 4
    const colIdx = leastFullCol()
    const col    = currentPage[colIdx]

    if (col.usedH + h > colH) {
      // Bu sütun doldu, başka sütun var mı?
      const hasSpace = currentPage.some(c => c.usedH + h <= colH)
      if (!hasSpace) newPage()
    }

    const targetIdx = leastFullCol()
    currentPage[targetIdx].items.push(q)
    currentPage[targetIdx].usedH += h
    i++
  }

  return pages
}

// ─── FİLİGRAN ────────────────────────────────────────────────
function applyWatermark(pdf, settings, pageNum, totalPages) {
  if (!settings.watermark?.text && !settings.watermark?.imageUrl) return

  pdf.setGState(pdf.GState({ opacity: settings.watermark.opacity ?? 0.12 }))

  if (settings.watermark.text) {
    pdf.setFontSize(48)
    pdf.setTextColor(150)
    pdf.text(
      settings.watermark.text,
      PAGE_W_MM / 2, PAGE_H_MM / 2,
      { align: 'center', angle: 45 }
    )
  }

  pdf.setGState(pdf.GState({ opacity: 1 }))

  // Sayfa numarası
  pdf.setFontSize(9)
  pdf.setTextColor(100)
  pdf.text(`${pageNum} / ${totalPages}`, PAGE_W_MM / 2, PAGE_H_MM - 8, { align: 'center' })
}

// ─── BAŞLIK BLOĞU ────────────────────────────────────────────
function drawHeader(pdf, settings) {
  const { title, schoolName, date, examTime, margins } = settings
  const x = margins.left
  let y    = margins.top

  if (schoolName) {
    pdf.setFontSize(11).setFont(undefined, 'bold')
    pdf.text(schoolName, PAGE_W_MM / 2, y, { align: 'center' })
    y += 6
  }

  pdf.setFontSize(14).setFont(undefined, 'bold')
  pdf.text(title ?? 'Test', PAGE_W_MM / 2, y, { align: 'center' })
  y += 7

  pdf.setFontSize(9).setFont(undefined, 'normal')
  const meta = [date, examTime ? `Süre: ${examTime} dk` : null].filter(Boolean).join('   ')
  if (meta) { pdf.text(meta, PAGE_W_MM / 2, y, { align: 'center' }); y += 5 }

  // AD SOYAD — NO kutusu
  const boxY = y
  pdf.setFontSize(8)
  pdf.text('Ad Soyad: ……………………………………………', x, boxY + 4)
  pdf.text('No: …………', PAGE_W_MM - margins.right - 40, boxY + 4)
  pdf.rect(x, boxY, PAGE_W_MM - margins.left - margins.right, 8)

  return boxY + 12  // başlık sonrası başlangıç Y
}

// ─── CEVAP ANAHTARI BLOĞU ────────────────────────────────────
function drawAnswerKey(pdf, questions, startY, margins) {
  const cols   = 5
  const cellW  = 9
  const cellH  = 6
  let x        = margins.left
  let y        = startY

  pdf.setFontSize(8).setFont(undefined, 'bold')
  pdf.text('CEVAP ANAHTARI', x, y); y += 4

  pdf.setFont(undefined, 'normal')
  questions.forEach((q, idx) => {
    if (idx > 0 && idx % cols === 0) { x = margins.left; y += cellH }
    pdf.rect(x, y, cellW, cellH)
    pdf.setFontSize(7)
    pdf.text(`${idx + 1}`, x + 1.5, y + 4)
    pdf.setFontSize(8).setFont(undefined, 'bold')
    pdf.text(q.correct_answer, x + cellW / 2, y + 4, { align: 'center' })
    pdf.setFont(undefined, 'normal')
    x += cellW
  })
}

// ─── ANA FONKSİYON ───────────────────────────────────────────
/**
 * PDF oluşturur ve otomatik olarak indirmeye sunar.
 *
 * @param {Object[]} questions  - Soru nesneleri
 * @param {Object}   settings   - Layout ayarları
 * @param {Function} onProgress - (0-100) ilerleme geri çağrısı
 */
export async function generatePDF(questions, settings, onProgress) {
  const {
    layout        = 'yaprak',
    columns       = 2,
    margins       = { top: 20, bottom: 20, left: 15, right: 15 },
    colGap        = 5,
    title         = 'Test',
    schoolName    = '',
    examTime      = null,
    date          = new Date().toLocaleDateString('tr-TR'),
    showAnswerKey = true,
    designColor   = '#1e40af',
  } = settings

  const colW = columnWidth(PAGE_W_MM, columns, margins, colGap)

  // 1. Görselleri yükle ve boyutlarını hesapla
  onProgress?.(5)
  const enriched = await Promise.all(
    questions.map(async (q, i) => {
      onProgress?.(5 + Math.round((i / questions.length) * 30))
      if (!q.image_url) return { ...q, heightMM: 15 }
      const { heightMM } = await imageToMMDimensions(q.image_url, colW)
      return { ...q, heightMM: Math.min(heightMM, 80) } // max 80mm
    })
  )

  // 2. Akıllı yerleşim
  onProgress?.(40)
  const pages = layoutQuestions(enriched, { columns, margins, colGap })

  // 3. PDF oluştur
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })

  for (let p = 0; p < pages.length; p++) {
    onProgress?.(40 + Math.round((p / pages.length) * 50))

    if (p > 0) pdf.addPage()

    // Başlık (sadece ilk sayfa)
    let startY = margins.top
    if (p === 0) {
      startY = drawHeader(pdf, { ...settings, title, schoolName, date, examTime, margins })
    }

    // Cevap anahtarı (son sayfa altına)
    const isLastPage = p === pages.length - 1

    // Filigran
    applyWatermark(pdf, settings, p + 1, pages.length)

    // Sütunları çiz
    const page = pages[p]
    page.forEach((col, ci) => {
      let x = margins.left + ci * (colW + colGap)
      let y = startY

      // Sütun çizgisi (opsiyonel)
      if (ci > 0) {
        pdf.setDrawColor(200)
        pdf.setLineWidth(0.2)
        pdf.line(x - colGap / 2, margins.top, x - colGap / 2, PAGE_H_MM - margins.bottom)
      }

      col.items.forEach((q) => {
        const h = (q.heightMM ?? 40) + 4
        const qW = q.spanAll ? PAGE_W_MM - margins.left - margins.right : colW

        // Soru numarası
        pdf.setFontSize(8).setFont(undefined, 'bold').setTextColor(designColor)
        pdf.text(`${q.order_index + 1}.`, x, y + 4)
        pdf.setTextColor(0)

        // Görsel
        if (q.image_url && !q.image_url.startsWith('blob:')) {
          try {
            pdf.addImage(q.image_url, 'JPEG', x + 5, y, qW - 5, q.heightMM ?? 40)
          } catch {
            pdf.setFontSize(7).setFont(undefined, 'italic')
            pdf.text('[Görsel yüklenemedi]', x + 5, y + 10)
          }
        } else if (q.question_text) {
          pdf.setFontSize(9).setFont(undefined, 'normal')
          pdf.text(q.question_text, x + 5, y + 5, { maxWidth: qW - 5 })
        }

        // Şıklar (sadece boşluk varsa, soru görselsizse)
        if (!q.image_url && !q.question_text) {
          ;['A','B','C','D','E'].forEach((opt, oi) => {
            pdf.setFontSize(8)
            pdf.text(`${opt}) ……………`, x + 5 + oi * 20, y + h - 3)
          })
        }

        pdf.setFont(undefined, 'normal')
        y += h
      })
    })

    if (isLastPage && showAnswerKey) {
      const keyY = PAGE_H_MM - margins.bottom - 25
      drawAnswerKey(pdf, enriched, keyY, margins)
    }
  }

  onProgress?.(95)

  // Farklı kitapçık grupları (A/B/C/D) — shuffle ile
  // TODO: groups ayarından otomatik kopyalar oluştur

  const filename = `${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`
  pdf.save(filename)
  onProgress?.(100)

  return { pageCount: pages.length, questionCount: enriched.length }
}

// ─── CANVAS API: Görsel kırpma yardımcısı ────────────────────
/**
 * Kullanıcının seçtiği bölgeyi canvas üzerinden kırpar.
 *
 * @param {HTMLImageElement} img
 * @param {{ x, y, w, h }} region   - Normalize (0-1) koordinatlar
 * @returns {Promise<Blob>}
 */
export function cropImageRegion(img, region) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const cx     = region.x * img.naturalWidth
    const cy     = region.y * img.naturalHeight
    const cw     = region.w * img.naturalWidth
    const ch     = region.h * img.naturalHeight

    canvas.width  = cw
    canvas.height = ch

    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch)

    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Kırpma başarısız'))
    }, 'image/jpeg', 0.92)
  })
}

/**
 * Canvas üzerinde çizgi/silme aracı için basit kalem motoru.
 * QuestionCropEditor bileşeninde kullanılır.
 */
export class CanvasEditor {
  constructor(canvas) {
    this.canvas  = canvas
    this.ctx     = canvas.getContext('2d')
    this.drawing = false
    this.mode    = 'pen'   // 'pen' | 'eraser'
    this.color   = '#e11d48'
    this.size    = 3

    canvas.addEventListener('pointerdown', this._down.bind(this))
    canvas.addEventListener('pointermove', this._move.bind(this))
    canvas.addEventListener('pointerup',   this._up.bind(this))
  }

  setMode(mode)  { this.mode  = mode }
  setColor(c)    { this.color = c }
  setSize(s)     { this.size  = s }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (this.canvas.width  / r.width),
      y: (e.clientY - r.top)  * (this.canvas.height / r.height),
    }
  }

  _down(e) {
    this.drawing = true
    const p = this._pos(e)
    this.ctx.beginPath()
    this.ctx.moveTo(p.x, p.y)
  }

  _move(e) {
    if (!this.drawing) return
    const p = this._pos(e)
    this.ctx.globalCompositeOperation = this.mode === 'eraser' ? 'destination-out' : 'source-over'
    this.ctx.strokeStyle = this.color
    this.ctx.lineWidth   = this.size
    this.ctx.lineCap     = 'round'
    this.ctx.lineTo(p.x, p.y)
    this.ctx.stroke()
  }

  _up() { this.drawing = false }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._down.bind(this))
    this.canvas.removeEventListener('pointermove', this._move.bind(this))
    this.canvas.removeEventListener('pointerup',   this._up.bind(this))
  }
}
