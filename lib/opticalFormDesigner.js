// lib/opticalFormDesigner.js
// Optik Form Tasarımcısı
// Soru sayısı ve şık sayısına göre dinamik optik form üretir.
// Çıktı: SVG string (ekrana göster) + jsPDF (indir)

import { jsPDF } from 'jspdf'

const OPTS = ['A','B','C','D','E']

// ─── FORM BOYUTLARI (mm) ──────────────────────────────────────
const PAGE_W = 210
const PAGE_H = 297

// ─── REFERANS KARESİ ÇİZ ─────────────────────────────────────
function drawRefSquare(pdf, x, y, size = 7) {
  pdf.setFillColor(0)
  pdf.rect(x, y, size, size, 'F')
}

// ─── OPTİK FORM PDF ÜRET ──────────────────────────────────────
/**
 * @param {Object} config
 *   questionCount  : soru sayısı (5-120)
 *   choiceCount    : şık sayısı (3-5)
 *   columns        : kaç sütun (1-3), büyük soru sayısında otomatik bölünür
 *   studentNumDigits: öğrenci no basamak sayısı (6-12)
 *   title          : form başlığı
 *   schoolName     : okul adı
 * @returns {jsPDF}
 */
export function generateOpticalFormPDF(config = {}) {
  const {
    questionCount     = 20,
    choiceCount       = 5,
    columns           = questionCount > 60 ? 3 : questionCount > 30 ? 2 : 1,
    studentNumDigits  = 9,
    title             = 'Cevap Kağıdı',
    schoolName        = '',
    date              = new Date().toLocaleDateString('tr-TR'),
  } = config

  const pdf       = new jsPDF({ unit: 'mm', format: 'a4' })
  const margin    = { top: 18, bottom: 12, left: 14, right: 14 }
  const innerW    = PAGE_W - margin.left - margin.right
  const innerH    = PAGE_H - margin.top  - margin.bottom
  const OPTS_USED = OPTS.slice(0, choiceCount)

  // ── Başlık ──────────────────────────────────────────────────
  let y = margin.top

  // 4 köşe referans kare
  const sq = 6
  drawRefSquare(pdf, margin.left,              margin.top,               sq)
  drawRefSquare(pdf, PAGE_W - margin.right - sq, margin.top,             sq)
  drawRefSquare(pdf, margin.left,              PAGE_H - margin.bottom - sq, sq)
  drawRefSquare(pdf, PAGE_W - margin.right - sq, PAGE_H - margin.bottom - sq, sq)

  if (schoolName) {
    pdf.setFontSize(9).setFont(undefined, 'normal').setTextColor(80)
    pdf.text(schoolName, PAGE_W / 2, y + 4, { align: 'center' })
    y += 6
  }
  pdf.setFontSize(13).setFont(undefined, 'bold').setTextColor(0)
  pdf.text(title, PAGE_W / 2, y + 4, { align: 'center' })
  y += 8

  pdf.setFontSize(8).setFont(undefined, 'normal').setTextColor(100)
  pdf.text(`Tarih: ${date}`, margin.left + sq + 3, margin.top + 4)

  // ── Öğrenci Bilgi Alanı ──────────────────────────────────────
  const infoBoxH = 10
  pdf.setDrawColor(180).setLineWidth(0.3)
  pdf.rect(margin.left + sq + 3, y, innerW - sq * 2 - 6, infoBoxH)
  pdf.setFontSize(8).setTextColor(100)
  pdf.text('Ad Soyad: ……………………………………………………………', margin.left + sq + 5, y + 4)
  pdf.text('No: ……………………', PAGE_W - margin.right - sq - 45, y + 4)
  y += infoBoxH + 4

  // ── Öğrenci Numarası Optik Bloğu ─────────────────────────────
  const numBlockX = margin.left + sq + 3
  const digitW    = (innerW * 0.35) / studentNumDigits
  const digitH    = 5.5
  const circleR   = Math.min(digitW, digitH) * 0.35

  pdf.setFontSize(7).setFont(undefined, 'bold').setTextColor(0)
  pdf.text('ÖĞRENCİ NUMARASI', numBlockX, y + 3)
  y += 5

  for (let d = 0; d < studentNumDigits; d++) {
    const dx = numBlockX + d * (digitW + 0.8)
    // Sütun başlık
    pdf.setFontSize(6).setFont(undefined, 'normal').setTextColor(80)
    pdf.text(String(d + 1), dx + digitW / 2, y, { align: 'center' })

    for (let digit = 0; digit <= 9; digit++) {
      const dy = y + 2.5 + digit * (digitH + 0.8)
      pdf.setDrawColor(100).setLineWidth(0.3)
      pdf.circle(dx + digitW / 2, dy + digitH / 2, circleR)
      pdf.setFontSize(5.5).setTextColor(60)
      pdf.text(String(digit), dx + digitW / 2, dy + digitH / 2 + 1.5, { align: 'center' })
    }
  }

  y += 2.5 + 10 * (digitH + 0.8) + 5

  // ── Cevap Izgarası ────────────────────────────────────────────
  const questPerCol = Math.ceil(questionCount / columns)
  const usableH     = PAGE_H - margin.bottom - y - sq - 4
  const rawCellH    = (usableH / questPerCol) - 0.5
  const cellH       = Math.max(5, Math.min(9, rawCellH))
  const numW        = 8
  const choiceW     = (choiceCount === 5 ? 8.5 : 10)
  const colTotalW   = numW + choiceCount * choiceW + 4
  const colStep     = innerW / columns

  pdf.setFontSize(7).setFont(undefined, 'bold').setTextColor(0)

  for (let col = 0; col < columns; col++) {
    const colX     = margin.left + col * colStep
    const startQ   = col * questPerCol + 1
    const endQ     = Math.min((col + 1) * questPerCol, questionCount)

    // Sütun başlıkları (A B C D E)
    let headerY = y
    pdf.setFontSize(6.5).setFont(undefined, 'bold').setTextColor(60)
    pdf.text('No', colX + 2, headerY + 3)
    OPTS_USED.forEach((opt, oi) => {
      pdf.text(opt, colX + numW + oi * choiceW + choiceW / 2, headerY + 3, { align: 'center' })
    })

    // Satırlar
    for (let q = startQ; q <= endQ; q++) {
      const rowIdx = q - startQ
      const rowY   = y + 5 + rowIdx * (cellH + 0.4)

      // Satır arka planı (almaşık)
      if (rowIdx % 2 === 0) {
        pdf.setFillColor(248, 248, 248)
        pdf.rect(colX, rowY, colTotalW, cellH, 'F')
      }

      // Soru numarası
      pdf.setFontSize(6).setFont(undefined, 'bold').setTextColor(40)
      pdf.text(String(q), colX + numW - 1, rowY + cellH * 0.65, { align: 'right' })

      // Şık daireleri
      OPTS_USED.forEach((opt, oi) => {
        const cx = colX + numW + oi * choiceW + choiceW / 2
        const cy = rowY + cellH / 2
        const r  = Math.min(choiceW, cellH) * 0.32

        pdf.setDrawColor(120).setLineWidth(0.35)
        pdf.circle(cx, cy, r)

        pdf.setFontSize(5).setFont(undefined, 'normal').setTextColor(80)
        pdf.text(opt, cx, cy + 1.5, { align: 'center' })
      })
    }

    // Sütun dış çerçeve
    pdf.setDrawColor(160).setLineWidth(0.4)
    pdf.rect(colX, y, colTotalW, 5 + (endQ - startQ + 1) * (cellH + 0.4))
  }

  // ── Alt bilgi ────────────────────────────────────────────────
  pdf.setFontSize(7).setFont(undefined, 'normal').setTextColor(150)
  pdf.text(
    'Bu form optik okuyucu ile işlenecektir. Daireleri kurşun kalemle tamamen doldurunuz.',
    PAGE_W / 2, PAGE_H - 6, { align: 'center' }
  )

  return pdf
}

// ─── SVG ÖNİZLEME ÜRET ───────────────────────────────────────
/**
 * Tarayıcıda önizleme için basit SVG üretir.
 * @param {Object} config
 * @returns {string} SVG string
 */
export function generateOpticalFormSVG(config = {}) {
  const {
    questionCount    = 20,
    choiceCount      = 5,
    columns          = questionCount > 40 ? 2 : 1,
    studentNumDigits = 9,
    title            = 'Cevap Kağıdı',
  } = config

  const W          = 400
  const H          = 560
  const margin     = 20
  const OPTS_USED  = OPTS.slice(0, choiceCount)
  const questPerCol= Math.ceil(questionCount / columns)
  const cellH      = Math.min(18, Math.floor((H - 160) / questPerCol))
  const choiceW    = Math.min(28, Math.floor((W - margin * 2 - 30) / columns / (choiceCount + 1)))
  const numW       = 22

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif">`

  // Arka plan
  svg += `<rect width="${W}" height="${H}" fill="white" stroke="#ddd" stroke-width="0.5" rx="4"/>`

  // 4 köşe referans kare
  ;[[6,6],[W-18,6],[6,H-18],[W-18,H-18]].forEach(([x,y]) =>
    svg += `<rect x="${x}" y="${y}" width="12" height="12" fill="black"/>`
  )

  // Başlık
  svg += `<text x="${W/2}" y="30" text-anchor="middle" font-size="11" font-weight="bold" fill="#1e293b">${title}</text>`

  // Bilgi alanı
  svg += `<rect x="${margin}" y="38" width="${W-margin*2}" height="16" fill="none" stroke="#cbd5e1" stroke-width="0.5" rx="2"/>`
  svg += `<text x="${margin+4}" y="50" font-size="7" fill="#64748b">Ad Soyad: ………………………………………………………… No: ……………</text>`

  // Öğrenci numarası sütunlar (küçük)
  const numStartX = margin
  const numStartY = 62
  svg += `<text x="${numStartX}" y="${numStartY}" font-size="7" font-weight="bold" fill="#334155">ÖĞRENCİ NO</text>`

  const dW = Math.min(20, (W * 0.55) / studentNumDigits)
  const dH = 8
  for (let d = 0; d < studentNumDigits; d++) {
    const dx = numStartX + d * (dW + 1)
    for (let digit = 0; digit <= 9; digit++) {
      const dy = numStartY + 4 + digit * (dH + 0.5)
      svg += `<circle cx="${dx + dW/2}" cy="${dy + dH/2}" r="${dH*0.35}" fill="none" stroke="#94a3b8" stroke-width="0.5"/>`
      svg += `<text x="${dx + dW/2}" y="${dy + dH/2 + 2.5}" text-anchor="middle" font-size="4.5" fill="#64748b">${digit}</text>`
    }
  }

  // Cevap ızgarası
  const gridY = numStartY + 5 + 10 * (dH + 0.5) + 8
  const colW2 = (W - margin * 2) / columns

  for (let col = 0; col < columns; col++) {
    const colX  = margin + col * colW2
    const startQ= col * questPerCol + 1
    const endQ  = Math.min((col + 1) * questPerCol, questionCount)

    // Başlık
    OPTS_USED.forEach((opt, oi) => {
      svg += `<text x="${colX + numW + oi * choiceW + choiceW/2}" y="${gridY - 2}" text-anchor="middle" font-size="7" font-weight="bold" fill="#475569">${opt}</text>`
    })

    for (let q = startQ; q <= endQ; q++) {
      const ri   = q - startQ
      const rowY = gridY + ri * cellH

      if (ri % 2 === 0)
        svg += `<rect x="${colX}" y="${rowY}" width="${numW + OPTS_USED.length * choiceW}" height="${cellH}" fill="#f8fafc"/>`

      svg += `<text x="${colX + numW - 2}" y="${rowY + cellH * 0.68}" text-anchor="end" font-size="7" font-weight="bold" fill="#334155">${q}</text>`

      OPTS_USED.forEach((opt, oi) => {
        const cx = colX + numW + oi * choiceW + choiceW / 2
        const cy = rowY + cellH / 2
        const r  = Math.min(choiceW, cellH) * 0.33
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#94a3b8" stroke-width="0.5"/>`
        svg += `<text x="${cx}" y="${cy + 2.5}" text-anchor="middle" font-size="5" fill="#64748b">${opt}</text>`
      })
    }

    // Çerçeve
    const gridH = (endQ - startQ + 1) * cellH
    svg += `<rect x="${colX}" y="${gridY}" width="${numW + OPTS_USED.length * choiceW}" height="${gridH}" fill="none" stroke="#cbd5e1" stroke-width="0.5" rx="2"/>`
  }

  // Alt not
  svg += `<text x="${W/2}" y="${H-8}" text-anchor="middle" font-size="6" fill="#94a3b8">Daireleri kurşun kalemle tamamen doldurunuz.</text>`
  svg += `</svg>`

  return svg
}
