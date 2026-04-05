// lib/analyticsEngine.js
// İstatistiksel Analiz ve Raporlama Motoru
// Tüm hesaplamalar saf JS — UI'dan bağımsız, test edilebilir.

import * as XLSX from 'xlsx'

// ─── TEMEL İSTATİSTİK ─────────────────────────────────────────

/** Ortalama */
export function mean(values) {
  if (!values.length) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** Standart sapma (popülasyon) */
export function stdDev(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length)
}

/** Medyan */
export function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid    = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Minimum / Maksimum */
export function minMax(values) {
  if (!values.length) return { min: 0, max: 0 }
  return { min: Math.min(...values), max: Math.max(...values) }
}

/** Varyans */
export function variance(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  return values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length
}

/** Çarpıklık (Skewness — Pearson 3. moment) */
export function skewness(values) {
  if (values.length < 3) return 0
  const m  = mean(values)
  const sd = stdDev(values)
  if (sd === 0) return 0
  const n  = values.length
  return values.reduce((s, v) => s + Math.pow((v - m) / sd, 3), 0) / n
}

/** Yüzdelik dilim */
export function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx    = (p / 100) * (sorted.length - 1)
  const lo     = Math.floor(idx)
  const hi     = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** Frekans dağılımı (histogram) */
export function frequencyDistribution(values, binCount = 10) {
  if (!values.length) return []
  const { min, max } = minMax(values)
  const range = max - min || 1
  const binW  = range / binCount

  const bins = Array.from({ length: binCount }, (_, i) => ({
    from:  min + i * binW,
    to:    min + (i + 1) * binW,
    count: 0,
    pct:   0,
  }))

  values.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / binW), binCount - 1)
    bins[idx].count++
  })

  bins.forEach(b => { b.pct = Math.round((b.count / values.length) * 100) })
  return bins
}

// ─── MADDE ANALİZİ ────────────────────────────────────────────

/**
 * Her soru için madde analizi hesaplar.
 *
 * @param {Object[]} questions  - [{ id, correct_answer, order_index }]
 * @param {Object[]} submissions - [{ answers: {"1":"A",...}, score, student }]
 * @param {number}   penalty    - Yanlış başına götürü katsayısı
 * @returns {Object[]}          - Madde istatistikleri dizisi
 */
export function itemAnalysis(questions, submissions, penalty = 0.25) {
  const finished = submissions.filter(s => s.finished_at)
  if (!finished.length || !questions.length) return []

  const OPTS   = ['A','B','C','D','E']
  const scores = finished.map(s => s.score ?? 0)
  const topN   = Math.ceil(finished.length * 0.27)

  // Üst %27 ve alt %27 grupları (Madde Ayırt Edicilik İndeksi için)
  const sorted   = [...finished].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const topGroup = new Set(sorted.slice(0, topN).map(s => s.id))
  const botGroup = new Set(sorted.slice(-topN).map(s => s.id))

  return questions.map((q, qi) => {
    const questionNum = q.order_index + 1
    const correct     = q.correct_answer

    // Şık dağılımı
    const dist = Object.fromEntries(OPTS.map(o => [o, 0]))
    dist.empty = 0

    let topCorrect = 0, botCorrect = 0

    finished.forEach(s => {
      const ans = s.answers?.[questionNum]
      if (!ans) { dist.empty++ }
      else if (OPTS.includes(ans)) { dist[ans]++ }

      if (topGroup.has(s.id)) { if (ans === correct) topCorrect++ }
      if (botGroup.has(s.id)) { if (ans === correct) botCorrect++ }
    })

    const n         = finished.length
    const nCorrect  = dist[correct] ?? 0

    // Güçlük İndeksi (P) — doğru cevap oranı
    const difficulty = nCorrect / n

    // Ayırt Edicilik İndeksi (D) — üst-alt grup farkı
    const discrimination = topN > 0
      ? (topCorrect - botCorrect) / topN
      : 0

    // Nokta-Biserial Korelasyon (rpbis)
    // Doğru cevap verenlerin skor ortalaması vs genel ortalama
    const correctScores   = finished.filter(s => s.answers?.[questionNum] === correct).map(s => s.score ?? 0)
    const incorrectScores = finished.filter(s => s.answers?.[questionNum] !== correct).map(s => s.score ?? 0)
    const meanCorrect     = mean(correctScores)
    const meanAll         = mean(scores)
    const sdAll           = stdDev(scores)
    const p               = nCorrect / n
    const rpbis           = sdAll > 0
      ? ((meanCorrect - meanAll) / sdAll) * Math.sqrt(p * (1 - p))
      : 0

    // Değerlendirme
    const diffLabel =
      difficulty >= 0.80 ? 'Çok Kolay' :
      difficulty >= 0.60 ? 'Kolay'     :
      difficulty >= 0.40 ? 'Orta'      :
      difficulty >= 0.20 ? 'Zor'       : 'Çok Zor'

    const discLabel =
      discrimination >= 0.40 ? 'Çok İyi'   :
      discrimination >= 0.30 ? 'İyi'       :
      discrimination >= 0.20 ? 'Kabul'     :
      discrimination >= 0.10 ? 'Düşük'     : 'Yetersiz'

    return {
      questionNum,
      correct,
      dist,
      n,
      nCorrect,
      difficulty:      Math.round(difficulty     * 100) / 100,
      discrimination:  Math.round(discrimination * 100) / 100,
      rpbis:           Math.round(rpbis          * 100) / 100,
      diffLabel,
      discLabel,
      distPct: Object.fromEntries(
        OPTS.map(o => [o, Math.round(((dist[o] ?? 0) / n) * 100)])
      ),
      emptyPct: Math.round((dist.empty / n) * 100),
    }
  })
}

// ─── SINIF ANALİZİ ────────────────────────────────────────────

/**
 * @param {Object[]} submissions - tamamlanmış cevap nesneleri
 * @param {Object[]} questions
 * @param {number}   penalty
 * @returns {Object} Tüm sınıf istatistikleri
 */
export function examAnalysis(submissions, questions, penalty = 0.25) {
  const finished = submissions.filter(s => s.finished_at)
  const scores   = finished.map(s => s.score ?? 0)

  const { min, max } = minMax(scores)
  const avg           = mean(scores)
  const sd            = stdDev(scores)
  const med           = median(scores)
  const skew          = skewness(scores)

  // Başarı yüzdesi (0-100 ölçeğinde)
  const maxPossible = questions.length
  const successPct  = maxPossible > 0 ? (avg / maxPossible) * 100 : 0

  // Harf notu dağılımı
  const gradeDist = { AA: 0, BA: 0, BB: 0, CB: 0, CC: 0, DC: 0, DD: 0, FF: 0 }
  scores.forEach(s => {
    const pct = maxPossible > 0 ? (s / maxPossible) * 100 : 0
    if      (pct >= 90) gradeDist.AA++
    else if (pct >= 80) gradeDist.BA++
    else if (pct >= 70) gradeDist.BB++
    else if (pct >= 65) gradeDist.CB++
    else if (pct >= 57) gradeDist.CC++
    else if (pct >= 50) gradeDist.DC++
    else if (pct >= 45) gradeDist.DD++
    else                gradeDist.FF++
  })

  // Güvenilirlik (Cronbach Alfa — basit iç tutarlılık tahmini)
  const k = questions.length
  const itemVariances = questions.map((q, i) => {
    const itemScores = finished.map(s =>
      s.answers?.[q.order_index + 1] === q.correct_answer ? 1 : 0
    )
    return variance(itemScores)
  })
  const sumItemVar = itemVariances.reduce((a, b) => a + b, 0)
  const totalVar   = variance(scores)
  const cronbachA  = k > 1 && totalVar > 0
    ? (k / (k - 1)) * (1 - sumItemVar / totalVar)
    : 0

  return {
    total:      finished.length,
    scores,
    avg:        Math.round(avg  * 100) / 100,
    sd:         Math.round(sd   * 100) / 100,
    median:     Math.round(med  * 100) / 100,
    min:        Math.round(min  * 100) / 100,
    max:        Math.round(max  * 100) / 100,
    skewness:   Math.round(skew * 100) / 100,
    successPct: Math.round(successPct),
    p25:        Math.round(percentile(scores, 25) * 100) / 100,
    p75:        Math.round(percentile(scores, 75) * 100) / 100,
    cronbachA:  Math.round(Math.max(0, cronbachA) * 100) / 100,
    gradeDist,
    histogram:  frequencyDistribution(scores, 10),
    items:      itemAnalysis(questions, submissions, penalty),
  }
}

// ─── EXCEL EXPORT (Çok sayfalı kapsamlı rapor) ────────────────

/**
 * @param {Object}   analysis   - examAnalysis() çıktısı
 * @param {Object[]} submissions
 * @param {Object[]} questions
 * @param {Object}   meta       - { title, schoolName, date, examTime }
 */
export function exportFullReportExcel(analysis, submissions, questions, meta = {}) {
  const wb   = XLSX.utils.book_new()
  const OPTS = ['A','B','C','D','E']

  // ── Sayfa 1: Kapak / Özet ───────────────────────────────────
  const coverData = [
    ['ONLİNE TEST MAKER — SINAV RAPORU'],
    [],
    ['Sınav Adı',       meta.title      ?? '—'],
    ['Okul / Kurum',    meta.schoolName ?? '—'],
    ['Tarih',           meta.date       ?? new Date().toLocaleDateString('tr-TR')],
    ['Süre (dk)',        meta.examTime   ?? '—'],
    [],
    ['── GENEL İSTATİSTİKLER ──'],
    ['Katılımcı Sayısı',    analysis.total],
    ['Ortalama Net',        analysis.avg],
    ['Standart Sapma',      analysis.sd],
    ['Medyan',              analysis.median],
    ['Minimum',             analysis.min],
    ['Maksimum',            analysis.max],
    ['25. Yüzdelik',        analysis.p25],
    ['75. Yüzdelik',        analysis.p75],
    ['Çarpıklık',           analysis.skewness],
    ['Başarı Yüzdesi (%)',  analysis.successPct],
    ['Cronbach Alfa',       analysis.cronbachA],
    [],
    ['── HARF NOTU DAĞILIMI ──'],
    ...Object.entries(analysis.gradeDist).map(([grade, count]) => [
      grade, count,
      Math.round((count / (analysis.total || 1)) * 100) + '%'
    ]),
  ]

  const wsCover = XLSX.utils.aoa_to_sheet(coverData)
  wsCover['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsCover, 'Özet')

  // ── Sayfa 2: Öğrenci Sonuçları ──────────────────────────────
  const finished = submissions.filter(s => s.finished_at)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const resultRows = finished.map((s, i) => {
    const dur = s.start_at && s.finished_at
      ? Math.round((new Date(s.finished_at) - new Date(s.start_at)) / 60000)
      : '—'
    const pct = analysis.scores.length
      ? Math.round(((s.score ?? 0) / Math.max(...analysis.scores, 1)) * 100)
      : 0
    const grade =
      pct >= 90 ? 'AA' : pct >= 80 ? 'BA' : pct >= 70 ? 'BB' :
      pct >= 65 ? 'CB' : pct >= 57 ? 'CC' : pct >= 50 ? 'DC' :
      pct >= 45 ? 'DD' : 'FF'

    return {
      'Sıra':           i + 1,
      'Ad Soyad':       s.student?.student_name   ?? '—',
      'Numara':         s.student?.student_number ?? '—',
      'Doğru':          s.correct  ?? 0,
      'Yanlış':         s.wrong    ?? 0,
      'Boş':            s.empty    ?? 0,
      'Net':            s.score?.toFixed(2) ?? '—',
      'Harf Notu':      grade,
      'Süre (dk)':      dur,
      'Başlangıç':      s.start_at    ? new Date(s.start_at).toLocaleString('tr-TR')    : '—',
      'Bitiş':          s.finished_at ? new Date(s.finished_at).toLocaleString('tr-TR') : '—',
    }
  })

  const wsResults = XLSX.utils.json_to_sheet(resultRows)
  wsResults['!cols'] = [
    { wch: 5 }, { wch: 24 }, { wch: 14 }, { wch: 7 }, { wch: 7 },
    { wch: 7 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 20 },
  ]
  XLSX.utils.book_append_sheet(wb, wsResults, 'Öğrenci Sonuçları')

  // ── Sayfa 3: Cevap Detayı ────────────────────────────────────
  const detailHeaders = [
    'Ad Soyad', 'Numara',
    ...questions.map(q => `S${q.order_index + 1}`),
    'Net',
  ]

  const detailRows = finished.map(s => {
    const row = {
      'Ad Soyad': s.student?.student_name   ?? '—',
      'Numara':   s.student?.student_number ?? '—',
    }
    questions.forEach(q => {
      const qNum = q.order_index + 1
      const ans  = s.answers?.[qNum] ?? ''
      const mark = ans === q.correct_answer ? '✓' : ans ? '✗' : '—'
      row[`S${qNum}`] = ans ? `${ans}${mark}` : '—'
    })
    row['Net'] = s.score?.toFixed(2) ?? '—'
    return row
  })

  const wsDetail = XLSX.utils.json_to_sheet(detailRows)
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Cevap Detayı')

  // ── Sayfa 4: Madde Analizi ───────────────────────────────────
  const itemRows = analysis.items.map(item => ({
    'Soru No':              item.questionNum,
    'Doğru Şık':           item.correct,
    ...Object.fromEntries(OPTS.map(o => [`${o} (%)`, item.distPct[o] ?? 0])),
    'Boş (%)':             item.emptyPct,
    'Güçlük (P)':          item.difficulty,
    'Güçlük Etiket':       item.diffLabel,
    'Ayırt Edicilik (D)':  item.discrimination,
    'Ayırt Etiket':        item.discLabel,
    'Nokta-Biserial (r)':  item.rpbis,
    'Doğru Sayısı':        item.nCorrect,
    'Toplam':              item.n,
  }))

  const wsItems = XLSX.utils.json_to_sheet(itemRows)
  wsItems['!cols'] = [
    { wch: 9 }, { wch: 10 },
    { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 },
    { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 8 },
  ]
  XLSX.utils.book_append_sheet(wb, wsItems, 'Madde Analizi')

  // ── Sayfa 5: Histogram ───────────────────────────────────────
  const histRows = analysis.histogram.map((bin, i) => ({
    'Aralık':  `${bin.from.toFixed(1)} – ${bin.to.toFixed(1)}`,
    'Frekans': bin.count,
    'Yüzde (%)': bin.pct,
    'Bar': '█'.repeat(Math.max(0, Math.min(40, Math.round(bin.pct * 0.4)))),
  }))

  const wsHist = XLSX.utils.json_to_sheet(histRows)
  wsHist['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 45 }]
  XLSX.utils.book_append_sheet(wb, wsHist, 'Dağılım')

  // ── Kaydet ──────────────────────────────────────────────────
  const filename = `rapor_${(meta.title ?? 'sinav').replace(/\s+/g, '_')}_${Date.now()}.xlsx`
  XLSX.writeFile(wb, filename)
  return filename
}
