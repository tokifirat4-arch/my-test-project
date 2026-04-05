'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import useQuestionStore from '@/store/questionStore'

// PDF.js lazy import (client only)
let pdfjsLib = null
async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib
  pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
  return pdfjsLib
}

// ─── Otomatik kenar boşluğu kırp ─────────────────────────────
function autoCropWhitespace(canvas, threshold = 240, padding = 6) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data

  const isLight = (r, g, b) => r > threshold && g > threshold && b > threshold

  let top    = 0
  let bottom = height - 1
  let left   = 0
  let right  = width - 1

  // Üst boşluk
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (!isLight(data[i], data[i+1], data[i+2])) { top = y; break outer }
    }
  }
  // Alt boşluk
  outer: for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (!isLight(data[i], data[i+1], data[i+2])) { bottom = y; break outer }
    }
  }
  // Sol boşluk
  outer: for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4
      if (!isLight(data[i], data[i+1], data[i+2])) { left = x; break outer }
    }
  }
  // Sağ boşluk
  outer: for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4
      if (!isLight(data[i], data[i+1], data[i+2])) { right = x; break outer }
    }
  }

  const cx = Math.max(0, left   - padding)
  const cy = Math.max(0, top    - padding)
  const cw = Math.min(width,  right  - left + 1 + padding * 2)
  const ch = Math.min(height, bottom - top  + 1 + padding * 2)

  const out = document.createElement('canvas')
  out.width  = cw
  out.height = ch
  out.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch)
  return out
}

// ─── Araç Çubuğu ─────────────────────────────────────────────
const TOOLS = [
  { key: 'select',  label: 'Seç',    icon: '⬚', tip: 'Bölge seçerek kes' },
  { key: 'pen',     label: 'Kalem',  icon: '✏️', tip: 'Üstüne çiz / vurgula' },
  { key: 'eraser',  label: 'Silgi',  icon: '◻', tip: 'Boyamayı sil' },
  { key: 'text',    label: 'Metin',  icon: 'T',  tip: 'Metin ekle' },
]

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#ca8a04', '#000000']

// ─── Ana Bileşen ─────────────────────────────────────────────
export default function CropEditor({ onClose }) {
  const { addFiles } = useQuestionStore()

  // ── Durum ────────────────────────────────────────────────
  const [sourceFile, setSourceFile]   = useState(null)   // File nesnesi
  const [sourceType, setSourceType]   = useState(null)   // 'image' | 'pdf'
  const [pdfDoc, setPdfDoc]           = useState(null)
  const [pageNum, setPageNum]         = useState(1)
  const [totalPages, setTotalPages]   = useState(1)
  const [scale, setScale]             = useState(1.5)
  const [tool, setTool]               = useState('select')
  const [color, setColor]             = useState('#e11d48')
  const [penSize, setPenSize]         = useState(3)
  const [mobileMode, setMobileMode]   = useState('scroll') // 'scroll' | 'cut'
  const [isDrawing, setIsDrawing]     = useState(false)
  const [selection, setSelection]     = useState(null)   // { x, y, w, h } canvas koordinatları
  const [selStart, setSelStart]       = useState(null)
  const [textInput, setTextInput]     = useState('')
  const [textPos, setTextPos]         = useState(null)
  const [autoCrop, setAutoCrop]       = useState(true)
  const [crops, setCrops]             = useState([])     // kesilen bölgeler önizlemeleri
  const [loading, setLoading]         = useState(false)

  const canvasRef     = useRef(null)   // Ana görüntü canvas
  const overlayRef    = useRef(null)   // Çizim overlay canvas
  const containerRef  = useRef(null)

  // ── PDF / Görsel yükle ────────────────────────────────────
  const loadSource = useCallback(async (file) => {
    setSourceFile(file)
    setLoading(true)

    if (file.type === 'application/pdf') {
      const pdfjs = await getPdfjs()
      const url   = URL.createObjectURL(file)
      const doc   = await pdfjs.getDocument(url).promise
      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      setPageNum(1)
      setSourceType('pdf')
    } else {
      setSourceType('image')
      setPdfDoc(null)
      setTotalPages(1)
    }
    setLoading(false)
  }, [])

  // ── Canvas'a içerik çiz ───────────────────────────────────
  useEffect(() => {
    if (!sourceFile || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    if (sourceType === 'image') {
      const img = new Image()
      img.onload = () => {
        canvas.width  = img.naturalWidth  * scale
        canvas.height = img.naturalHeight * scale
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        syncOverlay()
      }
      img.src = URL.createObjectURL(sourceFile)
    } else if (sourceType === 'pdf' && pdfDoc) {
      pdfDoc.getPage(pageNum).then(page => {
        const vp = page.getViewport({ scale })
        canvas.width  = vp.width
        canvas.height = vp.height
        page.render({ canvasContext: ctx, viewport: vp }).promise.then(syncOverlay)
      })
    }
  }, [sourceFile, sourceType, pdfDoc, pageNum, scale])

  const syncOverlay = () => {
    const c  = canvasRef.current
    const o  = overlayRef.current
    if (!c || !o) return
    o.width  = c.width
    o.height = c.height
  }

  // ── Fare/Dokunma Koordinatları ────────────────────────────
  const getPos = (e) => {
    const rect = overlayRef.current.getBoundingClientRect()
    const sc   = overlayRef.current.width / rect.width   // CSS px → canvas px
    const cx   = e.touches ? e.touches[0].clientX : e.clientX
    const cy   = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (cx - rect.left) * sc,
      y: (cy - rect.top)  * sc,
    }
  }

  // ── Pointer down ──────────────────────────────────────────
  const handlePointerDown = (e) => {
    if (mobileMode === 'scroll' && e.touches) return   // Mobil: kaydırma modunda dokunma izleme
    e.preventDefault()
    const pos = getPos(e)
    setIsDrawing(true)

    if (tool === 'select') {
      setSelStart(pos)
      setSelection(null)
    } else if (tool === 'pen' || tool === 'eraser') {
      const ctx = overlayRef.current.getContext('2d')
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
    } else if (tool === 'text') {
      setTextPos(pos)
    }
  }

  // ── Pointer move ──────────────────────────────────────────
  const handlePointerMove = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    const pos = getPos(e)

    if (tool === 'select' && selStart) {
      setSelection({
        x: Math.min(selStart.x, pos.x),
        y: Math.min(selStart.y, pos.y),
        w: Math.abs(pos.x - selStart.x),
        h: Math.abs(pos.y - selStart.y),
      })
    } else if (tool === 'pen' || tool === 'eraser') {
      const ctx = overlayRef.current.getContext('2d')
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
      ctx.strokeStyle = color
      ctx.lineWidth   = penSize
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    }
  }

  // ── Pointer up ────────────────────────────────────────────
  const handlePointerUp = (e) => {
    setIsDrawing(false)
    if (tool === 'pen' || tool === 'eraser') {
      const ctx = overlayRef.current.getContext('2d')
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  // ── Seçili bölgeyi kes + soru olarak ekle ────────────────
  const handleCrop = useCallback(async () => {
    if (!selection || selection.w < 10 || selection.h < 10) return

    // 1. Ana canvas + overlay'i birleştir
    const merged = document.createElement('canvas')
    merged.width  = canvasRef.current.width
    merged.height = canvasRef.current.height
    const mctx   = merged.getContext('2d')
    mctx.drawImage(canvasRef.current, 0, 0)
    mctx.drawImage(overlayRef.current, 0, 0)

    // 2. Seçili bölgeyi kes
    const cropped = document.createElement('canvas')
    cropped.width  = selection.w
    cropped.height = selection.h
    cropped.getContext('2d').drawImage(
      merged,
      selection.x, selection.y, selection.w, selection.h,
      0, 0, selection.w, selection.h
    )

    // 3. Otomatik kenar boşluğu temizle
    const final = autoCrop ? autoCropWhitespace(cropped) : cropped

    // 4. Blob → File → store'a ekle
    final.toBlob(blob => {
      if (!blob) return
      const filename = `soru_kirpma_${Date.now()}.jpg`
      const file     = new File([blob], filename, { type: 'image/jpeg' })
      addFiles([file])

      // Önizleme listesine ekle
      setCrops(prev => [...prev, { url: final.toDataURL('image/jpeg', 0.9), filename }])

      // Seçimi temizle
      setSelection(null)
      setSelStart(null)
    }, 'image/jpeg', 0.92)
  }, [selection, autoCrop, addFiles])

  // ── Metin ekle ────────────────────────────────────────────
  const handleAddText = () => {
    if (!textInput || !textPos) return
    const ctx = overlayRef.current.getContext('2d')
    ctx.font      = `${penSize * 5}px sans-serif`
    ctx.fillStyle = color
    ctx.fillText(textInput, textPos.x, textPos.y)
    setTextInput('')
    setTextPos(null)
  }

  // ── Overlay temizle ───────────────────────────────────────
  const handleClearOverlay = () => {
    const ctx = overlayRef.current.getContext('2d')
    ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
  }

  // ─── RENDER ──────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-gray-900/90 flex flex-col">
      {/* Üst araç çubuğu */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center gap-3 flex-wrap shrink-0">
        {/* Kapat */}
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-700"
        >
          ✕
        </button>

        <span className="text-white font-semibold text-sm">Kırpma Editörü</span>

        {/* Dosya yükle */}
        <label className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium cursor-pointer hover:bg-blue-700">
          📂 Dosya Aç
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={e => e.target.files?.[0] && loadSource(e.target.files[0])}
          />
        </label>

        <div className="w-px h-6 bg-gray-600"/>

        {/* Araçlar */}
        <div className="flex gap-1">
          {TOOLS.map(t => (
            <button
              key={t.key}
              onClick={() => setTool(t.key)}
              title={t.tip}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${tool === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}
              `}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Renk paleti */}
        {(tool === 'pen' || tool === 'text') && (
          <div className="flex gap-1.5 items-center">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-800 scale-110' : 'opacity-70 hover:opacity-100'}`}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="w-7 h-7 rounded-lg border border-gray-600 cursor-pointer bg-transparent"
              title="Özel renk"
            />
          </div>
        )}

        {/* Fırça boyutu */}
        {(tool === 'pen' || tool === 'eraser' || tool === 'text') && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs">Boyut</span>
            <input
              type="range" min={1} max={20} value={penSize}
              onChange={e => setPenSize(+e.target.value)}
              className="w-20 accent-blue-500"
            />
            <span className="text-gray-400 text-xs w-4">{penSize}</span>
          </div>
        )}

        <div className="w-px h-6 bg-gray-600"/>

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            className="w-7 h-7 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm">−</button>
          <span className="text-gray-400 text-xs w-10 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(4, s + 0.25))}
            className="w-7 h-7 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm">+</button>
        </div>

        {/* PDF sayfa gezgini */}
        {sourceType === 'pdf' && (
          <div className="flex items-center gap-1 ml-auto">
            <button disabled={pageNum <= 1}
              onClick={() => setPageNum(p => p - 1)}
              className="w-7 h-7 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-30 text-sm">‹</button>
            <span className="text-gray-300 text-xs px-2">{pageNum} / {totalPages}</span>
            <button disabled={pageNum >= totalPages}
              onClick={() => setPageNum(p => p + 1)}
              className="w-7 h-7 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-30 text-sm">›</button>
          </div>
        )}

        {/* Mobil mod geçişi */}
        <div className="ml-auto flex items-center gap-2 sm:hidden">
          <span className="text-gray-400 text-xs">Mod:</span>
          <button
            onClick={() => setMobileMode(m => m === 'scroll' ? 'cut' : 'scroll')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${mobileMode === 'cut' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          >
            {mobileMode === 'scroll' ? '📜 Kaydır' : '✂ Kes'}
          </button>
        </div>
      </div>

      {/* İkincil araç çubuğu */}
      <div className="bg-gray-800/80 border-b border-gray-700/50 px-4 py-1.5 flex items-center gap-4 text-xs shrink-0">
        <label className="flex items-center gap-1.5 text-gray-300 cursor-pointer select-none">
          <input type="checkbox" checked={autoCrop} onChange={e => setAutoCrop(e.target.checked)}
            className="accent-blue-500"/>
          Otomatik kenar boşluğu temizle
        </label>

        {tool === 'select' && selection && (
          <>
            <span className="text-gray-500">
              {Math.round(selection.w)} × {Math.round(selection.h)} px
            </span>
            <button
              onClick={handleCrop}
              className="px-4 py-1 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
            >
              ✂ Bu Bölgeyi Soru Olarak Kes
            </button>
            <button onClick={() => { setSelection(null); setSelStart(null) }}
              className="text-gray-400 hover:text-gray-200">
              İptal
            </button>
          </>
        )}

        {(tool === 'pen' || tool === 'eraser') && (
          <button onClick={handleClearOverlay}
            className="text-gray-400 hover:text-red-400 transition-colors">
            Çizimi Temizle
          </button>
        )}

        {tool === 'text' && textPos && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddText()}
              placeholder="Metin gir, Enter'a bas…"
              className="bg-gray-700 text-white px-3 py-1 rounded-lg border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
              autoFocus
            />
            <button onClick={handleAddText}
              className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Ekle
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas Alanı */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-gray-900 p-4"
          style={{ touchAction: mobileMode === 'scroll' ? 'auto' : 'none' }}
        >
          {loading && (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <div className="text-4xl mb-3 animate-spin">⏳</div>
                <p>Yükleniyor…</p>
              </div>
            </div>
          )}

          {!sourceFile && !loading && (
            <label className="flex flex-col items-center justify-center h-full text-gray-500 cursor-pointer border-2 border-dashed border-gray-700 rounded-2xl m-4 hover:border-gray-500 transition-colors">
              <div className="text-5xl mb-4">📂</div>
              <p className="font-medium">PDF veya görsel dosyası aç</p>
              <p className="text-sm mt-1 text-gray-600">Tıkla veya sürükle-bırak</p>
              <input type="file" accept="image/*,application/pdf" className="hidden"
                onChange={e => e.target.files?.[0] && loadSource(e.target.files[0])} />
            </label>
          )}

          {/* Canvas yığını */}
          {sourceFile && !loading && (
            <div className="relative inline-block select-none">
              {/* Arka plan: asıl görüntü */}
              <canvas ref={canvasRef} className="block rounded-lg shadow-xl"/>

              {/* Overlay: çizim katmanı */}
              <canvas
                ref={overlayRef}
                className="absolute top-0 left-0"
                style={{
                  cursor: tool === 'select' ? 'crosshair' :
                          tool === 'pen'    ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 16 16\'%3E%3Ccircle cx=\'8\' cy=\'8\' r=\'4\' fill=\'%23e11d48\'/%3E%3C/svg%3E") 8 8, crosshair' :
                          tool === 'eraser' ? 'cell' : 'text',
                  touchAction: mobileMode === 'cut' ? 'none' : 'auto',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onTouchStart={mobileMode === 'cut' ? handlePointerDown : undefined}
                onTouchMove={mobileMode  === 'cut' ? handlePointerMove : undefined}
                onTouchEnd={mobileMode   === 'cut' ? handlePointerUp   : undefined}
              />

              {/* Seçim dikdörtgeni */}
              {selection && (
                <div
                  className="absolute border-2 border-blue-400 bg-blue-400/10 pointer-events-none"
                  style={{
                    left:   selection.x / (overlayRef.current?.width  / overlayRef.current?.getBoundingClientRect().width  || 1),
                    top:    selection.y / (overlayRef.current?.height / overlayRef.current?.getBoundingClientRect().height || 1),
                    width:  selection.w / (overlayRef.current?.width  / overlayRef.current?.getBoundingClientRect().width  || 1),
                    height: selection.h / (overlayRef.current?.height / overlayRef.current?.getBoundingClientRect().height || 1),
                  }}
                >
                  {/* Köşe tutaçları */}
                  {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map(pos => (
                    <div key={pos} className={`absolute ${pos} w-3 h-3 bg-blue-500 border-2 border-white rounded-sm -m-1.5`}/>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sağ Panel: Kesilen Sorular */}
        {crops.length > 0 && (
          <aside className="w-56 bg-gray-800 border-l border-gray-700 flex flex-col overflow-hidden shrink-0">
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
              <span className="text-gray-300 text-xs font-medium">Kesilen Sorular ({crops.length})</span>
              <button onClick={() => setCrops([])} className="text-gray-500 hover:text-red-400 text-xs">Temizle</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
              {crops.map((c, i) => (
                <div key={i} className="bg-gray-700 rounded-xl overflow-hidden group relative">
                  <img src={c.url} alt={`Soru ${i + 1}`} className="w-full object-contain max-h-32"/>
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <span className="text-gray-400 text-xs">#{i + 1}</span>
                    <button
                      onClick={() => setCrops(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-500 hover:text-red-400 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-gray-700">
              <p className="text-gray-400 text-xs text-center">
                Kesilen sorular otomatik olarak soru listesine eklendi
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
