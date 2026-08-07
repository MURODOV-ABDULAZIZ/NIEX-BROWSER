# SafeNet — skriptlarni masofadan yangilash (ixtiyoriy)

Brauzer AI endi **Supabase** orqali emas, `.env` dagi **Groq / OpenRouter / Gemini** kalitlari bilan ishlaydi.

Agar `contentfilter.js` va `monitor.js` ni o‘z server/CDN dan avtomatik yangilamoqchi bo‘lsangiz:

## `.env`

```
SAFENET_SCRIPT_UPDATE=1
SAFENET_SCRIPT_UPDATE_URL=https://SIZNING_DOMENINGIZ.com/path/to/
```

`SAFENET_SCRIPT_UPDATE_URL` oxirida **`/`** bo‘lishi kerak. U yerda quyidagi fayllar HTTP orqali mavjud bo‘lishi kerak:

- `contentfilter.js`
- `monitor.js`

## Odatiy holat

`SAFENET_SCRIPT_UPDATE` **yo‘q** yoki `1` emas bo‘lsa, skriptlar faqat lokal papkadagi fayllardan o‘qiladi — tashqi storage chaqirilmaydi.
