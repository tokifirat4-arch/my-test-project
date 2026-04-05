# Online Test Maker

## Kurulum

```bash
# 1. Bağımlılıkları kur
npm install

# 2. .env.local oluştur
cp .env.local.example .env.local
# Supabase bilgilerini gir

# 3. Veritabanını kur
# supabase.com → SQL Editor → supabase_schema.sql çalıştır
# Storage → questions (private) + watermarks (public) bucket oluştur

# 4. OpenCV.js indir
curl -o public/opencv.js https://cdnjs.cloudflare.com/ajax/libs/opencv.js/4.8.0/opencv.js

# 5. Çalıştır
npm run dev
```

## URL'ler
- `/login` → Öğretmen girişi
- `/dashboard` → Ana çalışma alanı
- `/dashboard/tests` → Test listesi
- `/dashboard/exams` → Sınav listesi
- `/dashboard/analytics` → Analiz raporları
- `/dashboard/optical` → Optik okuyucu
- `/exam` → Öğrenci sınav odası
