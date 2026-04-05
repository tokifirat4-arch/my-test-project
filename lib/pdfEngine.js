'use client'
import { jsPDF } from 'jspdf'

// ═══════════════════════════════════════════════════════════════
//  PDF ENGINE  v2.0
//  • Garantili tam genişlik  (isExtended — her formattan tanır)
//  • Önce sol sütun dolumu   (dikey öncelik)
//  • Mükemmel hizalama       (extended öncesi sütunlar eşitlenir)
//  • Yüksek çözünürlük       (extended max 150 mm, JPEG %95)
// ═══════════════════════════════════════════════════════════════

const PAGE_W         = 210
const PAGE_H         = 297
const COL_GAP        = 5
const Q_PAD          = 5
const IMG_QUAL       = 0.95
const MAX_H_NORMAL   = 80
const MAX_H_EXTENDED = 150


// ─── Türkçe karakter düzeltici ───────────────────────────────
function fixTr(text) {
  if (!text) return ''
  return text
    .replace(/İ/g, 'I').replace(/ı/g, 'i')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o')
    .replace(/Ç/g, 'C').replace(/ç/g, 'c')
}


// ─── isExtended esnek kontrolü ───────────────────────────────
// boolean true / string "true" / number 1 / string "1" — hepsi kabul
//
// Desteklenen alan adları (veritabanı / arayüz tutarsızlıklarına karşı):
//   QuestionUploader → metadata.is_expanded   ← ASIL KULLANILAN
//   Alternatif kök  → is_expanded, isExpanded
//   Legacy / API    → is_extended, isExtended
//   metadata altı   → metadata.is_extended, metadata.isExtended
function isExtended(q) {
  const ok = (v) => v === true || v === 'true' || v === 1 || v === '1'
  return (
    ok(q.metadata?.is_expanded)    ||   // ← QuestionUploader'ın yazdığı alan
    ok(q.metadata?.isExpanded)     ||
    ok(q.is_expanded)              ||
    ok(q.isExpanded)               ||
    ok(q.metadata?.is_extended)    ||
    ok(q.metadata?.isExtended)     ||
    ok(q.is_extended)              ||
    ok(q.isExtended)
  )
}

// Açıklama/paragraf da tam genişlikte çizilir
function isDescription(q) {
  const ok = (v) => v === true || v === 'true' || v === 1 || v === '1'
  return ok(q.is_description) || ok(q.metadata?.is_description)
}

const isFullWidth = (q) => isExtended(q) || isDescription(q)


// ─── Görsel → Base64 (2× DPI) ────────────────────────────────
function imageToBase64(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = 2
      const c = document.createElement('canvas')
      c.width  = img.naturalWidth  * scale
      c.height = img.naturalHeight * scale
      const ctx = c.getContext('2d')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      resolve(c.toDataURL('image/jpeg', IMG_QUAL))
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}


// ─── Görsel yüksekliği MM hesapla ────────────────────────────
function imageHeightMM(url, targetWidthMM) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      resolve(targetWidthMM * (img.naturalHeight / img.naturalWidth))
    }
    img.onerror = () => resolve(40)
    img.src = url
  })
}


// ─── Sütun genişliği ─────────────────────────────────────────
function colWidth(columns, margins) {
  return (PAGE_W - margins.left - margins.right - COL_GAP * (columns - 1)) / columns
}


// ─── Başlık analitik yüksekliği ──────────────────────────────
function headerHeight(settings) {
  const { schoolName, date, examTime, margins } = settings
  let h = margins.top
  if (schoolName) h += 6
  h += 7
  if (date || examTime) h += 5
  h += 12
  return h
}


// ─── Başlık çizimi ───────────────────────────────────────────
function drawHeader(pdf, settings) {
  const { title, schoolName, date, examTime, margins, designColor = '#1e40af' } = settings
  let y = margins.top

  if (schoolName) {
    pdf.setFontSize(10).setFont(undefined, 'normal').setTextColor(80)
    pdf.text(fixTr(schoolName), PAGE_W / 2, y, { align: 'center' })
    y += 6
  }

  pdf.setFontSize(14).setFont(undefined, 'bold').setTextColor(0)
  pdf.text(fixTr(title || 'Test'), PAGE_W / 2, y, { align: 'center' })
  y += 7

  if (date || examTime) {
    pdf.setFontSize(9).setFont(undefined, 'normal').setTextColor(100)
    const meta = [date, examTime ? `Sure: ${examTime} dk` : null].filter(Boolean).join('   ')
    pdf.text(meta, PAGE_W / 2, y, { align: 'center' })
    y += 5
  }

  pdf.setFontSize(8).setTextColor(0)
  pdf.text('Ad Soyad: ......................................', margins.left + 2, y + 4)
  pdf.text('No: ............', PAGE_W - margins.right - 42, y + 4)
  pdf.setDrawColor(150).setLineWidth(0.3)
  pdf.rect(margins.left, y, PAGE_W - margins.left - margins.right, 8)
  y += 12

  pdf.setDrawColor(designColor).setLineWidth(0.5)
  pdf.line(margins.left, y - 2, PAGE_W - margins.right, y - 2)

  return y
}


// ═══════════════════════════════════════════════════════════════
//  YERLEŞIM MOTORU
//
//  Kural 1 — Normal sorular önce sol sütunu doldurur, taşınca sağa geçer.
//  Kural 2 — Tam genişlik soru gelmeden önce sol + sağ imlecler
//             max(leftY, rightY)'a eşitlenir.
//  Kural 3 — Tam genişlik soru yerleştikten sonra her iki imleç
//             soru altına konumlanır; sonraki normal sorular tekrar
//             sol sütundan başlar.
//
//  Döndürür: Array<{ q, page, col, x, y, w, h }>
// ═══════════════════════════════════════════════════════════════
function computePlacements(questions, settings) {
  const { columns = 2, margins } = settings
  const cw     = colWidth(columns, margins)
  const fullW  = PAGE_W - margins.left - margins.right
  const bottom = PAGE_H - margins.bottom
  const leftX  = margins.left
  const rightX = margins.left + cw + COL_GAP
  const p0Y    = headerHeight(settings)

  const placements = []
  let page   = 0
  let leftY  = p0Y
  let rightY = p0Y

  const pageStart = (p) => (p === 0 ? p0Y : margins.top)

  const newPage = () => {
    page++
    leftY  = pageStart(page)
    rightY = pageStart(page)
  }

  for (const q of questions) {
    const h = (q.heightMM ?? 40) + Q_PAD

    if (isFullWidth(q)) {
      // ── TAM GENİŞLİK ──────────────────────────────────────
      const equalY = Math.max(leftY, rightY)
      if (equalY + h > bottom) newPage()

      const y = Math.max(leftY, rightY)
      placements.push({ q, page, col: 'full', x: leftX, y, w: fullW, h })
      leftY  = y + h
      rightY = y + h

    } else {
      // ── NORMAL — Önce Sol ─────────────────────────────────
      if (leftY + h <= bottom) {
        placements.push({ q, page, col: 'left', x: leftX, y: leftY, w: cw, h })
        leftY += h
      } else if (rightY + h <= bottom) {
        placements.push({ q, page, col: 'right', x: rightX, y: rightY, w: cw, h })
        rightY += h
      } else {
        newPage()
        placements.push({ q, page, col: 'left', x: leftX, y: leftY, w: cw, h })
        leftY += h
      }
    }
  }

  return { placements, totalPages: page + 1 }
}


// ─── Tek soru çizimi ─────────────────────────────────────────
function drawQuestion(pdf, pl, settings) {
  const { q, x, y, w } = pl
  const { designColor = '#1e40af' } = settings
  const numW = 7
  const imgW = w - numW - 1
  const imgH = q.heightMM ?? 40

  pdf.setFontSize(8).setFont(undefined, 'bold').setTextColor(designColor)
  pdf.text(`${q.order_index + 1}.`, x, y + 4.5)
  pdf.setTextColor(0).setFont(undefined, 'normal')

  if (q.base64) {
    try {
      pdf.addImage(q.base64, 'JPEG', x + numW, y, imgW, imgH)
    } catch {
      pdf.setFontSize(7).setFont(undefined, 'italic').setTextColor(150)
      pdf.text('[Gorsel yuklenemedi]', x + numW, y + 8)
      pdf.setTextColor(0)
    }
  } else if (q.question_text) {
    pdf.setFontSize(9)
    const lines = pdf.splitTextToSize(fixTr(q.question_text), imgW)
    pdf.text(lines, x + numW, y + 5)
  }
}


// ─── Sütun ayraç çizgileri ───────────────────────────────────
// Full-width bloklarının dışındaki dikey şeritlere çizgi çeker
function drawColumnDividers(pdf, placements, pageIdx, settings, startY) {
  const { columns = 2, margins } = settings
  if (columns < 2) return

  const cw     = colWidth(columns, margins)
  const lineX  = margins.left + cw + COL_GAP / 2
  const bottom = PAGE_H - margins.bottom

  const fullBlocks = placements
    .filter(p => p.page === pageIdx && p.col === 'full')
    .map(p => ({ from: p.y, to: p.y + p.h }))
    .sort((a, b) => a.from - b.from)

  pdf.setDrawColor(210).setLineWidth(0.2)

  let cursor = startY
  for (const block of fullBlocks) {
    if (cursor < block.from) pdf.line(lineX, cursor, lineX, block.from)
    cursor = block.to
  }
  if (cursor < bottom) pdf.line(lineX, cursor, lineX, bottom)
}


// ─── Filigran + Sayfa numarası ───────────────────────────────
function applyWatermark(pdf, settings, pageNum, totalPages) {
  if (settings.watermark?.text) {
    pdf.setGState(pdf.GState({ opacity: settings.watermark.opacity ?? 0.08 }))
    pdf.setFontSize(50).setTextColor(180)
    pdf.text(fixTr(settings.watermark.text), PAGE_W / 2, PAGE_H / 2, {
      align: 'center', angle: 45,
    })
    pdf.setGState(pdf.GState({ opacity: 1 }))
  }
  pdf.setFontSize(8).setTextColor(150).setFont(undefined, 'normal')
  pdf.text(`${pageNum} / ${totalPages}`, PAGE_W / 2, PAGE_H - 4, { align: 'center' })
}


// ─── Cevap anahtarı ──────────────────────────────────────────
function drawAnswerKey(pdf, questions, startY, margins) {
  const cellW = 9
  const cellH = 6
  const cols  = Math.floor((PAGE_W - margins.left - margins.right) / cellW)
  let x = margins.left
  let y = startY

  pdf.setFontSize(7).setFont(undefined, 'bold').setTextColor(0)
  pdf.text('CEVAP ANAHTARI', x, y)
  y += 5
  pdf.setFont(undefined, 'normal')

  questions.forEach((q, idx) => {
    const col = idx % cols
    const cx  = margins.left + col * cellW
    if (col === 0 && idx > 0) y += cellH

    pdf.setDrawColor(180).setLineWidth(0.2)
    pdf.rect(cx, y, cellW, cellH)
    pdf.setFontSize(6).setTextColor(120)
    pdf.text(`${idx + 1}`, cx + 1, y + 4)
    pdf.setFontSize(7).setFont(undefined, 'bold').setTextColor(0, 60, 180)
    pdf.text(q.correct_answer || '-', cx + cellW / 2, y + 4, { align: 'center' })
    pdf.setFont(undefined, 'normal').setTextColor(0)
  })
}


// ═══════════════════════════════════════════════════════════════
//  ANA EXPORT: generatePDF
// ═══════════════════════════════════════════════════════════════
export async function generatePDF(questions, settings, onProgress) {
  const {
    columns       = 2,
    margins       = { top: 20, bottom: 20, left: 15, right: 15 },
    title         = 'Test',
    schoolName    = '',
    examTime      = null,
    date          = new Date().toLocaleDateString('tr-TR'),
    showAnswerKey = true,
    designColor   = '#1e40af',
    watermark,
  } = settings

  const cw    = colWidth(columns, margins)
  const fullW = PAGE_W - margins.left - margins.right

  onProgress?.(5)

  // ── 1. GÖRSELLERİ ZENGİNLEŞTİR ─────────────────────────────
  const enriched = await Promise.all(
    questions.map(async (q, i) => {
      onProgress?.(5 + Math.round((i / questions.length) * 40))

      const fw        = isFullWidth(q)
      const targetW   = fw ? fullW - 8 : cw - 8
      const maxH      = fw ? MAX_H_EXTENDED : MAX_H_NORMAL

      if (!q.image_url) return { ...q, heightMM: 15, base64: null }

      const [base64, rawH] = await Promise.all([
        imageToBase64(q.image_url),
        imageHeightMM(q.image_url, targetW),
      ])

      return {
        ...q,
        base64,
        heightMM: Math.min(Math.max(rawH, 15), maxH),
      }
    })
  )

  onProgress?.(50)

  // ── 2. YERLEŞIM ──────────────────────────────────────────────
  const sorted = sortWithDescriptions(enriched)

  // ── 3. YERLEŞİM ───────────────────────────────────────
  const { placements, totalPages } = computePlacements(sorted, {
    columns, margins,
    schoolName, date, examTime,
  })

  onProgress?.(55)

  // ── 3. PDF OLUŞTUR ───────────────────────────────────────────
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })

  for (let p = 0; p < totalPages; p++) {
    onProgress?.(55 + Math.round((p / totalPages) * 35))
    if (p > 0) pdf.addPage()

    let pageStartY = margins.top
    if (p === 0) {
      pageStartY = drawHeader(pdf, {
        title, schoolName, date, examTime, margins, designColor,
      })
    }

    applyWatermark(pdf, { watermark }, p + 1, totalPages)
    drawColumnDividers(pdf, placements, p, { columns, margins }, pageStartY)

    for (const pl of placements.filter(pl => pl.page === p)) {
      drawQuestion(pdf, pl, { designColor })
    }

    if (p === totalPages - 1 && showAnswerKey) {
      drawAnswerKey(pdf, enriched, PAGE_H - margins.bottom - 24, margins)
    }
  }

  onProgress?.(95)

  const filename = `${fixTr(title).replace(/\s+/g, '_')}_${Date.now()}.pdf`
  pdf.save(filename)
  onProgress?.(100)

  return { pageCount: totalPages, questionCount: enriched.length }
}


// ═══════════════════════════════════════════════════════════════
//  YARDIMCI EXPORTLAR
// ═══════════════════════════════════════════════════════════════

export function cropImageRegion(img, region) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const cx = region.x * img.naturalWidth
    const cy = region.y * img.naturalHeight
    const cw = region.w * img.naturalWidth
    const ch = region.h * img.naturalHeight
    canvas.width  = cw
    canvas.height = ch
    canvas.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch)
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Kirpma basarisiz')),
      'image/jpeg', IMG_QUAL
    )
  })
}


export class CanvasEditor {
  constructor(canvas) {
    this.canvas  = canvas
    this.ctx     = canvas.getContext('2d')
    this.drawing = false
    this.mode    = 'pen'
    this.color   = '#e11d48'
    this.size    = 3
    this._down = this._down.bind(this)
    this._move = this._move.bind(this)
    this._up   = this._up.bind(this)
    canvas.addEventListener('pointerdown', this._down)
    canvas.addEventListener('pointermove', this._move)
    canvas.addEventListener('pointerup',   this._up)
  }
  setMode(m)  { this.mode  = m }
  setColor(c) { this.color = c }
  setSize(s)  { this.size  = s }
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
    this.canvas.removeEventListener('pointerdown', this._down)
    this.canvas.removeEventListener('pointermove', this._move)
    this.canvas.removeEventListener('pointerup',   this._up)
  }
}
