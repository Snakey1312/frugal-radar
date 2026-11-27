# FrugalRadar

Comparator inteligent de prețuri în România: cost total real (preț + transport + ramburs),
verificare stoc pe mărime, comparare între 35 magazine RO și recunoaștere foto fără cheie API.

## Rulează local

```bash
npm install
npm start
# http://localhost:3456
```

Teste: `npm test` (36/36).

## Publicare gratuită pe Vercel

Aplicația e deja configurată pentru Vercel:

- `vercel.json` — `public/` ca static, funcția `api/[...path].js` pentru toate `/api/*`
  și timeout 60s. Nu e nevoie de variabile de mediu: `lib/cache.js` folosește
  automat `/tmp` când rulează pe Vercel (singura zonă scriabilă din serverless).
- `api/[...path].js` — folosește exact același handler ca `node server.js`, deci
  search-ul și verificarea stocului funcționează identic.
- `public/vendor/tesseract/` — OCR-ul rulează direct în browser, deci recunoașterea
  foto merge pe hosting fără cheie Gemini și fără PC pornit.
- `lib/adapters.js` — adaptează interogarea pentru magazinele RO (`air max tn` →
  `air max plus tn`, `triple black` → `negru`), fără a slăbi filtrul de relevanță.
- `package.json` — Node.js 24.x, conform versiunilor suportate de Vercel.

### Pași

1. Creează un cont gratuit pe <https://vercel.com> și autorizează GitHub-ul.
2. Încarcă acest folder ca repo GitHub (sau folosește repository-ul existent
   `Snakey1312/frugal-radar`).
3. În Vercel: **Add New → Project** → selectează repo-ul → **Deploy**.
   Nu trebuie setat nimic manual; `vercel.json` conține deja totul.
4. (Opțional, gratuit) Adaugă `SERPER_API_KEY` în **Settings → Environment Variables**
   din Vercel. Serper oferă 2.500 de căutări gratuite și aduce rezultate Google
   Shopping România, inclusiv prețurile reale de pe eMAG, direct în lista
   principală. Cheia se poate adăuga și din **Setări** în aplicație (doar pentru
   browserul respectiv). Fără cheie, eMAG rămâne doar în secțiunea de linkuri
   manuale, pentru că blochează IP-urile Vercel.
5. (Opțional) `GEMINI_API_KEY` nu mai e necesar: OCR-ul din poză rulează local în
   browser.

După deploy, Vercel îți dă un URL public de forma `https://frugal-radar-xxx.vercel.app`.
PC-ul tău nu trebuie să fie pornit.

### Deploy în 1 clic

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSnakey1312%2Ffrugal-radar)

### Observații

- Free tier-ul Vercel are limite generoase; funcția e setată la 60s, suficient
  pentru căutarea în 35 de magazine.
- Cache-ul SQLite e în `/tmp`, deci fiecare instanță serverless pornește cu el gol;
  rezultatele se recalculază, dar aplicația nu se oprește.
- Recunoașterea foto folosește Tesseract.js (limba `eng`); textele românești sunt
  normalizate (diacriticele se elimină), deci `negru`, `mărime`, `triple black` etc.
  sunt recunoscute corect.
- Interfața e responsive: sub 650px tabelul devine cărți cu etichete, iar hero-ul
  și formularul se adaptează pe telefon.
