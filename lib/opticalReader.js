// lib/opticalReader.js
// Optik Form Okuyucu — OpenCV.js tabanlı
//
// Akış:
//   1. Kamera/dosyadan görüntü al
//   2. Gri + eşikleme (threshold) ile siyah-beyaza çevir
//   3. 4 köşe referans kare bul → perspektif düzeltme (warpPerspective)
//   4. Izgara hücrelerini tara → dolu/boş tespit
//   5. Her satır için en koyu hücreyi "işaretlenen şık" kabul et
//   6. Öğrenci numarası bloğunu ayrıca oku
//
// Kurulum:
//   public/opencv.js dosyasını şuradan al:
//   https://docs.opencv.org/4.x/opencv.js
//   veya CDN: https://cdnjs.cloudflare.com/ajax/libs/opencv.js/4.8.0/opencv.js
//
// Kullanım:
//   import { readOpticalForm } from '@/lib/opticalReader'
//   const result = await readOpticalForm(imageElement, formConfig)

// ─── OpenCV yükleme (lazy, sadece tarayıcıda) ────────────────
let cvReady = false
let cvPromise = null

export function loadOpenCV() {
  if (cvReady) return Promise.resolve(window.cv)
  if (cvPromise) return cvPromise

  cvPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('Sadece tarayıcıda çalışır'))

    if (window.cv?.Mat) { cvReady = true; return resolve(window.cv) }

    const script = document.createElement('script')
    script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/opencv.js/4.8.0/opencv.js'
    script.async = true

    script.onload = () => {
      // OpenCV.js asenkron başlatma
      if (window.cv?.Mat) { cvReady = true; resolve(window.cv); return }
      window.Module = {
        onRuntimeInitialized: () => { cvReady = true; resolve(window.cv) }
      }
    }
    script.onerror = () => reject(new Error('OpenCV.js yüklenemedi'))
    document.head.appendChild(script)
  })

  return cvPromise
}

// ─── Yardımcı: Canvas'tan Mat oluştur ────────────────────────
function canvasToMat(cv, canvas) {
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return cv.matFromImageData(img)
}

// ─── Yardımcı: Mat'ı Canvas'a yaz ────────────────────────────
function matToCanvas(cv, mat, canvas) {
  const imgData = new ImageData(
    new Uint8ClampedArray(mat.data),
    mat.cols,
    mat.rows
  )
  canvas.width  = mat.cols
  canvas.height = mat.rows
  canvas.getContext('2d').putImageData(imgData, 0, 0)
}

// ─── Yardımcı: Dört köşeyi sırala (sol-üst, sağ-üst, sağ-alt, sol-alt) ──
function sortCorners(points) {
  // Merkeze göre açı hesapla
  const cx = points.reduce((s, p) => s + p.x, 0) / 4
  const cy = points.reduce((s, p) => s + p.y, 0) / 4

  return points.sort((a, b) => {
    const angA = Math.atan2(a.y - cy, a.x - cx)
    const angB = Math.atan2(b.y - cy, b.x - cx)
    return angA - angB
  })
  // Sıralama: sol-üst (-π,-π/2), sağ-üst (-π/2,0), sağ-alt (0,π/2), sol-alt (π/2,π)
}

// ─── 4 Köşe Referans Kare Bul ────────────────────────────────
/**
 * Formun 4 köşesindeki siyah referans kareleri tespit eder.
 * @param {cv} cv
 * @param {cv.Mat} gray - Gri görüntü
 * @returns {{ corners: [{x,y}], debugMat: cv.Mat }}
 */
function findCornerMarkers(cv, gray) {
  const binary = new cv.Mat()
  cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU)

  // Morfolojik kapama → gürültüyü azalt
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
  const closed = new cv.Mat()
  cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel)

  // Kontur bul
  const contours  = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  const W = gray.cols
  const H = gray.rows
  const minArea = (W * H) * 0.0005   // min: toplam alanın %0.05'i
  const maxArea = (W * H) * 0.015    // max: toplam alanın %1.5'i

  // Kare-benzeri konturları filtrele
  const squares = []
  for (let i = 0; i < contours.size(); i++) {
    const cnt  = contours.get(i)
    const area = cv.contourArea(cnt)
    if (area < minArea || area > maxArea) continue

    const rect   = cv.boundingRect(cnt)
    const aspect = rect.width / rect.height
    if (aspect < 0.5 || aspect > 2.0) continue   // Kare oranı

    // Yalnızca köşe bölgelerini al (her köşede 1 adet)
    const cx = rect.x + rect.width  / 2
    const cy = rect.y + rect.height / 2
    squares.push({ x: cx, y: cy, area, rect })
  }

  // Köşe bölgelerine en yakın 4 kare
  const corners4 = [
    squares.filter(s => s.x < W * 0.35 && s.y < H * 0.35),   // sol-üst
    squares.filter(s => s.x > W * 0.65 && s.y < H * 0.35),   // sağ-üst
    squares.filter(s => s.x > W * 0.65 && s.y > H * 0.65),   // sağ-alt
    squares.filter(s => s.x < W * 0.35 && s.y > H * 0.65),   // sol-alt
  ].map(group => {
    if (!group.length) return null
    return group.sort((a, b) => b.area - a.area)[0]  // en büyüğü al
  })

  binary.delete(); closed.delete(); kernel.delete()
  contours.delete(); hierarchy.delete()

  return corners4
}

// ─── Perspektif Düzeltme ──────────────────────────────────────
function correctPerspective(cv, src, corners, outW = 800, outH = 1100) {
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x, corners[0].y,  // sol-üst
    corners[1].x, corners[1].y,  // sağ-üst
    corners[2].x, corners[2].y,  // sağ-alt
    corners[3].x, corners[3].y,  // sol-alt
  ])

  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,    0,
    outW, 0,
    outW, outH,
    0,    outH,
  ])

  const M = cv.getPerspectiveTransform(srcPts, dstPts)
  const dst = new cv.Mat()
  cv.warpPerspective(src, dst, M, new cv.Size(outW, outH))

  srcPts.delete(); dstPts.delete(); M.delete()
  return dst
}

// ─── Izgara Hücresi Doluluk Oranı ────────────────────────────
/**
 * Belirli bir dikdörtgen bölgedeki siyah piksel yoğunluğunu döndürür (0-1).
 */
function cellDarkness(cv, binary, x, y, w, h) {
  // Bölgeyi kırp
  const roi     = binary.roi(new cv.Rect(
    Math.max(0, x), Math.max(0, y),
    Math.min(w, binary.cols - x),
    Math.min(h, binary.rows - y)
  ))
  const total   = roi.rows * roi.cols
  if (total === 0) return 0
  const nonzero = cv.countNonZero(roi)
  roi.delete()
  return nonzero / total
}

// ─── Izgara Tarama ────────────────────────────────────────────
/**
 * Formun soru/şık ızgarasını tarar.
 *
 * @param {cv}     cv
 * @param {cv.Mat} binary  - Perspektif düzeltilmiş, eşiklenmiş görüntü
 * @param {Object} config  - Form yapılandırması
 * @returns {Object[]}     - [{ questionNum, markedAnswer, darkness }]
 */
function scanAnswerGrid(cv, binary, config) {
  const {
    questionCount = 20,
    choiceCount   = 5,       // A-B-C-D-E
    gridLeft      = 80,      // İlk şık sütununun sol kenarı (px, 800px genişlikte)
    gridTop       = 150,     // İlk satırın üst kenarı (px)
    cellWidth     = 60,      // Şık hücre genişliği
    cellHeight    = 38,      // Şık hücre yüksekliği
    cellPadding   = 6,       // Hücre içi dolgu
    rowGap        = 2,       // Satırlar arası boşluk
    colGap        = 2,       // Sütunlar arası boşluk
    darkThreshold = 0.18,    // Bu oran üstü → "işaretlenmiş"
    minDarkRatio  = 1.8,     // En koyu hücre / ikinci koyu hücre oranı (belirsizlik kontrolü)
  } = config

  const results = []
  const OPTS    = ['A','B','C','D','E'].slice(0, choiceCount)

  for (let q = 0; q < questionCount; q++) {
    const rowY = gridTop + q * (cellHeight + rowGap)

    const darknesses = OPTS.map((opt, ci) => {
      const cellX = gridLeft + ci * (cellWidth + colGap)
      return {
        opt,
        darkness: cellDarkness(
          cv, binary,
          cellX + cellPadding,
          rowY  + cellPadding,
          cellWidth  - cellPadding * 2,
          cellHeight - cellPadding * 2
        )
      }
    })

    // En koyu hücreyi bul
    darknesses.sort((a, b) => b.darkness - a.darkness)
    const best   = darknesses[0]
    const second = darknesses[1]

    let markedAnswer = null
    let confidence   = 'low'

    if (best.darkness >= darkThreshold) {
      // Belirsizlik kontrolü: en koyu / ikinci koyu > minDarkRatio → güvenli
      if (second.darkness < 0.01 || best.darkness / second.darkness >= minDarkRatio) {
        markedAnswer = best.opt
        confidence   = 'high'
      } else {
        markedAnswer = best.opt   // düşük güvenle işaretle
        confidence   = 'low'
      }
    }

    results.push({
      questionNum:  q + 1,
      markedAnswer,
      confidence,
      darknesses:   darknesses.sort((a, b) => OPTS.indexOf(a.opt) - OPTS.indexOf(b.opt)),
    })
  }

  return results
}

// ─── Öğrenci Numarası Bloğu ───────────────────────────────────
/**
 * Öğrenci numarası sütununu tarar (her sütun 0-9 rakamları).
 */
function scanStudentNumber(cv, binary, config) {
  const {
    numDigits   = 9,
    numLeft     = 600,   // Numara bloğunun sol kenarı (800px genişlikte)
    numTop      = 150,
    digitW      = 22,
    digitH      = 30,
    digitGapX   = 4,
    digitGapY   = 2,
  } = config

  let studentNumber = ''

  for (let col = 0; col < numDigits; col++) {
    const colX = numLeft + col * (digitW + digitGapX)
    let maxDark = 0
    let digit   = ''

    for (let row = 0; row < 10; row++) {  // 0-9
      const rowY   = numTop + row * (digitH + digitGapY)
      const dark   = cellDarkness(cv, binary, colX + 2, rowY + 2, digitW - 4, digitH - 4)
      if (dark > maxDark) { maxDark = dark; digit = String(row) }
    }

    studentNumber += maxDark > 0.15 ? digit : '_'
  }

  return studentNumber
}

// ─── ANA OKU FONKSİYONU ──────────────────────────────────────
/**
 * @param {HTMLImageElement | HTMLCanvasElement} imageSource
 * @param {Object} formConfig  - Form yapılandırması (questionCount, choiceCount vb.)
 * @param {Object} [opts]
 *   @param {HTMLCanvasElement} [opts.debugCanvas]  - Debug görüntüsü için canvas
 *   @param {Function}          [opts.onProgress]   - (0-100) ilerleme callback
 * @returns {Promise<{
 *   answers:       Object,     // { "1": "A", "2": "C", ... }
 *   studentNumber: string,
 *   confidence:    Object,     // { "1": "high", ... }
 *   corners:       Array,
 *   warnings:      string[],
 * }>}
 */
export async function readOpticalForm(imageSource, formConfig = {}, opts = {}) {
  const { debugCanvas, onProgress } = opts

  const cv = await loadOpenCV()
  onProgress?.(10)

  // 1. Kaynak → Canvas → Mat
  const srcCanvas  = document.createElement('canvas')
  if (imageSource instanceof HTMLCanvasElement) {
    srcCanvas.width  = imageSource.width
    srcCanvas.height = imageSource.height
    srcCanvas.getContext('2d').drawImage(imageSource, 0, 0)
  } else {
    srcCanvas.width  = imageSource.naturalWidth  || imageSource.width
    srcCanvas.height = imageSource.naturalHeight || imageSource.height
    srcCanvas.getContext('2d').drawImage(imageSource, 0, 0)
  }

  const srcMat  = canvasToMat(cv, srcCanvas)
  const grayMat = new cv.Mat()
  cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY)
  onProgress?.(20)

  // 2. Köşe referans karelerini bul
  const corners4 = findCornerMarkers(cv, grayMat)
  const warnings = []

  const missingCorners = corners4.map((c, i) => c === null ? i : null).filter(i => i !== null)
  if (missingCorners.length > 0) {
    warnings.push(`${missingCorners.length} köşe referans karesi bulunamadı (${missingCorners.join(', ')}). Perspektif düzeltme atlandı.`)
  }
  onProgress?.(40)

  // 3. Perspektif düzeltme (tüm 4 köşe bulunduysa)
  let workMat = grayMat.clone()
  let correctedCorners = corners4

  if (missingCorners.length === 0) {
    const cornerPoints = [
      corners4[0], corners4[1], corners4[2], corners4[3]
    ]
    const sorted = sortCorners(cornerPoints)
    workMat = correctPerspective(cv, grayMat, sorted)
    correctedCorners = sorted
  }
  onProgress?.(55)

  // 4. Eşikleme (binarize)
  const binaryMat = new cv.Mat()
  cv.adaptiveThreshold(
    workMat, binaryMat, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    11, 4
  )
  onProgress?.(65)

  // 5. Cevap ızgarasını tara
  const gridResults    = scanAnswerGrid(cv, binaryMat, formConfig)
  onProgress?.(80)

  // 6. Öğrenci numarası
  const studentNumber  = scanStudentNumber(cv, binaryMat, formConfig)
  onProgress?.(90)

  // 7. Debug canvas
  if (debugCanvas) {
    const colorDebug = new cv.Mat()
    cv.cvtColor(binaryMat, colorDebug, cv.COLOR_GRAY2RGBA)

    // İşaretlenen hücreleri yeşil kare ile göster
    const { gridLeft = 80, gridTop = 150, cellWidth = 60, cellHeight = 38,
            choiceCount = 5, rowGap = 2, colGap = 2 } = formConfig
    const OPTS = ['A','B','C','D','E'].slice(0, choiceCount)

    gridResults.forEach(r => {
      if (!r.markedAnswer) return
      const ci  = OPTS.indexOf(r.markedAnswer)
      const x   = gridLeft  + ci * (cellWidth  + colGap)
      const y   = gridTop   + (r.questionNum - 1) * (cellHeight + rowGap)
      const col = r.confidence === 'high'
        ? new cv.Scalar(0, 200, 0, 255)
        : new cv.Scalar(255, 165, 0, 255)
      cv.rectangle(colorDebug,
        new cv.Point(x, y),
        new cv.Point(x + cellWidth, y + cellHeight),
        col, 2
      )
    })

    // Köşe noktalarını kırmızı daire ile göster
    if (missingCorners.length === 0) {
      correctedCorners.forEach(c => {
        if (c) cv.circle(colorDebug, new cv.Point(c.x, c.y), 12, new cv.Scalar(255,0,0,255), 3)
      })
    }

    matToCanvas(cv, colorDebug, debugCanvas)
    colorDebug.delete()
  }

  // 8. Temizlik
  srcMat.delete(); grayMat.delete(); workMat.delete()
  binaryMat.delete()
  onProgress?.(100)

  // 9. Sonuçları düzenle
  const answers    = {}
  const confidence = {}
  gridResults.forEach(r => {
    answers[r.questionNum]    = r.markedAnswer ?? ''
    confidence[r.questionNum] = r.confidence
  })

  return {
    answers,
    studentNumber,
    confidence,
    corners: correctedCorners,
    warnings,
    raw: gridResults,
  }
}

// ─── FORM YAPISI ÜRET ─────────────────────────────────────────
/**
 * Soru sayısı ve şık sayısına göre formConfig üretir.
 * Formun 800×1100 px perspektif alanına sığdırılmış ızgara koordinatları.
 */
export function buildFormConfig(questionCount = 20, choiceCount = 5, includeStudentNum = true) {
  // Dinamik ızgara: soru sayısına göre hücre yüksekliğini ayarla
  const availableH = includeStudentNum ? 850 : 950
  const rawCellH   = Math.floor(availableH / questionCount) - 2
  const cellHeight = Math.max(22, Math.min(50, rawCellH))
  const cellWidth  = Math.min(70, Math.floor(650 / choiceCount) - 4)

  return {
    questionCount,
    choiceCount,
    gridLeft:      80,
    gridTop:       160,
    cellWidth,
    cellHeight,
    cellPadding:   5,
    rowGap:        2,
    colGap:        3,
    darkThreshold: 0.18,
    minDarkRatio:  1.7,
    // Öğrenci numarası bloğu
    numDigits:     9,
    numLeft:       550,
    numTop:        160,
    digitW:        18,
    digitH:        cellHeight * 0.75,
    digitGapX:     3,
    digitGapY:     2,
  }
}
