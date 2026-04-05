'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode]       = useState('login')
  const [email, setEmail]     = useState('')
  const [pass,  setPass]      = useState('')
  const [name,  setName]      = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const handle = async () => {
    if (!email || !pass) { setError('E-posta ve şifre zorunlu'); return }
    setError('')
    setLoading(true)

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: pass,
        })
        if (error) throw error
        router.push('/dashboard')
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password: pass,
          options: { data: { full_name: name } },
        })
        if (error) throw error
        setError('Kayıt başarılı! E-postanızı doğrulayın, sonra giriş yapın.')
        setMode('login')
      }
    } catch (e) {
      setError(e.message || 'Bir hata oluştu')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">📝</div>
          <h1 className="text-2xl font-bold text-gray-800">Online Test Maker</h1>
          <p className="text-gray-400 text-sm mt-1">
            {mode === 'login' ? 'Hesabınıza giriş yapın' : 'Yeni hesap oluşturun'}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {mode === 'register' && (
            <input
              type="text"
              placeholder="Ad Soyad"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <input
            type="email"
            placeholder="E-posta"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder="Şifre (en az 6 karakter)"
            value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handle()}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {error && (
            <p className={`text-sm text-center px-3 py-2 rounded-xl ${
              error.includes('başarılı')
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-600'
            }`}>
              {error}
            </p>
          )}

          <button
            onClick={handle}
            disabled={loading}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
              loading
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
            }`}
          >
            {loading ? 'Lütfen bekleyin…' : mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
          </button>

          <button
            onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError('') }}
            className="text-sm text-blue-600 hover:underline text-center mt-1"
          >
            {mode === 'login' ? 'Hesabınız yok mu? Kayıt olun' : 'Zaten hesabınız var mı? Giriş yapın'}
          </button>
        </div>
      </div>
    </div>
  )
}
