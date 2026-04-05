'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getTests, createTest, supabase } from '@/lib/supabase'

export default function TestsPage() {
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { getTests().then(t => { setTests(t); setLoading(false) }) }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Testlerim</h1>
        <button onClick={async () => { const t = prompt('Başlık:'); if(t) { const r = await createTest(t); setTests(p => [r,...p]) } }}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700">+ Yeni Test</button>
      </div>
      {loading ? <div className="text-center py-16 text-gray-400">Yükleniyor…</div> :
        <div className="grid gap-3">
          {tests.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4 hover:border-blue-300 transition-all">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-700">{t.title}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{new Date(t.created_at).toLocaleDateString('tr-TR')} ·
                  <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${t.status==='published'?'bg-green-100 text-green-700':t.status==='archived'?'bg-gray-100 text-gray-500':'bg-amber-100 text-amber-700'}`}>
                    {t.status==='published'?'Yayında':t.status==='archived'?'Arşiv':'Taslak'}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/dashboard?test=${t.id}`} className="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-sm hover:bg-blue-100">Düzenle</Link>
                <button onClick={async () => { if(confirm('Silinsin mi?')) { await supabase.from('tests').delete().eq('id',t.id); setTests(p=>p.filter(x=>x.id!==t.id)) }}}
                  className="px-3 py-1.5 bg-red-50 text-red-500 border border-red-200 rounded-lg text-sm hover:bg-red-100">Sil</button>
              </div>
            </div>
          ))}
        </div>
      }
    </div>
  )
}
