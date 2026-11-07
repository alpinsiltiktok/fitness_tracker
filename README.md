# Stride & Spoon Fitness Tracker

Aplikasi web statis mobile-first untuk mencatat nutrisi harian, target olahraga, kalori, dan progres aktivitas. Screenshot aktivitas serta label makanan dibaca di browser dengan Tesseract.js; data ditinjau dan dikoreksi sebelum disimpan.

## Isi folder

- `index.html`, `styles.css`, `app.js` — antarmuka, dashboard, grafik Canvas, dan backup/sinkronisasi.
- `strava-ocr.js` — OCR screenshot dan parser field aktivitas.
- `strava-import.js` — pembaca `activities.csv` langsung dari arsip ZIP Strava di browser.
- `food-scan.js` — OCR label gizi dan kompresi foto sebelum estimasi.
- `manifest.webmanifest`, `sw.js`, `icons/stride-icon.svg` — instalasi PWA dan cache shell aplikasi agar dashboard dapat dibuka offline.
- `google-apps-script/Code.gs` — jembatan Google Apps Script ke spreadsheet.
- `netlify/functions/sheets.mjs` — proxy server-side untuk Google Sheets dan estimasi foto Gemini agar kunci API tidak diekspos ke browser.
- `netlify.toml` — konfigurasi publish statis dan Netlify Functions.

Spreadsheet yang dikonfigurasi: [Fitness Tracker](https://docs.google.com/spreadsheets/d/1E04kuvWVYLeGLRUZ3Mil4ljV4eT9_TeUe4tr9cg7Res/edit).

## Deploy Google Apps Script

1. Buka spreadsheet di atas, pilih **Extensions → Apps Script**, lalu salin isi `google-apps-script/Code.gs`.
2. Pada **Project Settings → Script properties**, tambahkan `FITNESS_TRACKER_API_KEY` dengan nilai acak yang panjang. Jangan menaruh kunci ini di `index.html`, `app.js`, atau repository.
3. Jalankan deployment sebagai **Web app**, pilih **Execute as: Me** dan izinkan akses web app. Simpan URL deployment yang berakhiran `/exec`.
4. Script membuat tab `Fitness Logs` dan header-nya saat menerima permintaan pertama. Jika sheet memakai format lama, script memeriksa header lama lalu menambahkan kolom target aktivitas dan nutrisi di bagian akhir tanpa memindahkan data. Tab `Body Measurements` dibuat otomatis saat pengukuran tubuh pertama kali disinkronkan. Setelah mengganti kode Apps Script, buka **Deploy → Manage deployments**, edit deployment web app, pilih **New version**, lalu deploy. Jangan mengubah urutan header setelah data mulai dicatat.

Apps Script menerima `GET` untuk membaca log atau pengukuran dan `POST` berisi aksi `logs`, `append`, `importLogs`, `update`, `delete`, `measurements`, `saveMeasurement`, `deleteMeasurement`, atau `health`. `importLogs` menerima hingga 250 aktivitas per permintaan dan melewati ID yang sudah tersimpan. Permintaan wajib menyertakan `apiKey`. Netlify Function meneruskan permintaan tersebut secara server-side.

## Deploy ke Netlify

1. Buat site dari repository ini dan atur **Base directory** ke `bot/fitness_tracker`. Publish directory `.` dan functions directory `netlify/functions` sudah ada di `netlify.toml`.
2. Tambahkan environment variables pada konfigurasi site:
   - `FITNESS_TRACKER_GAS_URL` — URL Web App Apps Script yang berakhiran `/exec`.
   - `FITNESS_TRACKER_API_KEY` — nilai yang sama dengan Script Property Apps Script.
   - `FITNESS_TRACKER_GEMINI_API_KEY` — API key dari [Google AI Studio](https://aistudio.google.com/app/apikey) untuk estimasi gizi foto. Simpan hanya sebagai environment variable server.
   - `FITNESS_TRACKER_GEMINI_MODEL` — opsional; model Gemini, default `gemini-3.5-flash-lite` (mendukung input gambar).
   - `FITNESS_TRACKER_GEMINI_FALLBACK_MODELS` — opsional; daftar model gambar alternatif, pisahkan dengan koma. Default `gemini-3.1-flash-lite,gemini-3.8-flash`; gunakan `none` untuk menonaktifkan fallback.
3. Deploy/redeploy site. Buka domain Netlify melalui HTTPS untuk menggunakan OCR dan sinkronisasi.

Tidak ada secret pada client. Endpoint Apps Script tetap harus dapat dipanggil oleh Netlify, sementara API key diverifikasi oleh Apps Script. Aplikasi belum memiliki login pengguna; sebelum mempublikasikan data kebugaran pribadi, aktifkan proteksi akses pada site Netlify atau tambahkan autentikasi pengguna. Proxy publik dapat menerima permintaan dari siapa pun yang mengetahui URL site, termasuk permintaan estimasi foto yang dapat memakai kuota/API berbayar. Batasi akses/rate limit dan kuota API, batasi pembagian URL deployment, dan rotasi key jika bocor. `localStorage` adalah backup lokal pada browser/perangkat yang sama, bukan pengganti backup spreadsheet.

## PWA dan akses offline

Aplikasi dapat dipasang dari tombol **Pasang aplikasi** atau menu browser setelah dibuka melalui HTTPS (atau `localhost`). Service worker menyimpan shell aplikasi sehingga dashboard dapat dibuka kembali offline; data lokal tetap tersedia pada perangkat tersebut. Sinkronisasi Google Sheets, pemindaian OCR yang memerlukan Tesseract.js dari CDN, font eksternal, dan analisis foto memerlukan koneksi internet. Perubahan aplikasi baru diterapkan saat service worker diperbarui.

## Menjalankan lokal

Server statis biasa (contohnya `python -m http.server`) tidak menjalankan Netlify Function, sehingga catatan hanya tersimpan di browser. Untuk menguji endpoint proxy di lokal:

1. Salin `.env.local.example` menjadi `.env.local`, lalu isi `FITNESS_TRACKER_GAS_URL` dan `FITNESS_TRACKER_API_KEY` dengan nilai deployment Apps Script dan Script Property. Isi `FITNESS_TRACKER_GEMINI_API_KEY` untuk mengaktifkan estimasi foto. Secara default server memakai model utama `gemini-3.5-flash-lite` dengan fallback `gemini-3.1-flash-lite` dan `gemini-3.8-flash`. Atur `FITNESS_TRACKER_GEMINI_MODEL` atau `FITNESS_TRACKER_GEMINI_FALLBACK_MODELS` hanya jika ingin memilih model lain yang tersedia pada project. File `.env.local` jangan dimasukkan ke repository.
2. Dari folder ini jalankan `npm run start:configured`. Server lokal hanya bind ke `127.0.0.1:4173` dan menyediakan halaman beserta endpoint proxy.
3. Buka `http://127.0.0.1:4173`. Catatan berlabel **belum sinkron** pada browser/origin ini akan otomatis dicoba ulang setelah Apps Script bisa dijangkau.

Jika `.env.local` belum ada, `npm start` tetap menjalankan aplikasi dan menyimpan catatan secara lokal, tetapi endpoint mengembalikan status konfigurasi yang jelas. Untuk Netlify, deploy dengan environment variables pada bagian sebelumnya; jangan menggunakan server lokal untuk host produksi.

## Fitur pencatatan

- Tab **Makanan** mencatat kalori serta protein, karbohidrat, dan lemak.
- Form makanan menyediakan input gula, serat, natrium, vitamin A, B kompleks, C, D, E, K, serta mineral utama. Scan OCR label dapat mengisi nilai yang terbaca; selalu cek satuan dan takaran saji. Foto hidangan hanya memperkirakan energi/makro serta gula, serat, dan natrium; AI tidak mengarang angka vitamin/mineral bila tidak dapat diketahui dari foto.
- Dashboard menampilkan progres nutrisi harian dibanding acuan AKG laki-laki usia 19–29 tahun yang dipilih, dengan rujukan Permenkes 28/2019. Nilai ini merupakan acuan populasi umum, bukan kebutuhan medis personal. Batas gula 50 g ditandai sebagai anjuran, bukan AKG.
- Scan label gizi memakai OCR di browser untuk mengisi kalori, protein, karbohidrat, dan lemak dari teks kemasan berbahasa Indonesia atau Inggris. Pilih **Upload file** untuk mengambil gambar dari galeri/perangkat atau **Buka kamera** untuk memotret langsung; kedua opsi juga tersedia untuk estimasi foto hidangan. Periksa takaran saji dan hasil OCR sebelum menyimpan.
- Estimasi foto hidangan mengirim gambar yang telah diperkecil ke Gemini melalui server untuk memperkirakan nama makanan, porsi, kalori, dan makro. Model utama dan alternatif dipakai bergiliran pada browser ini untuk membagi pemakaian; jika kuota tercapai (429), model tidak tersedia (404), layanan sibuk (5xx), terjadi timeout/gangguan jaringan, atau format respons tidak valid, server mencoba model berikutnya. Rotasi lokal ini tidak membagi pemakaian dari perangkat atau aplikasi lain. Foto tidak disimpan oleh aplikasi, tetapi dikirim ke Google untuk analisis; hasilnya perkiraan visual, bukan pengukuran dan tidak menggantikan saran ahli gizi. Jika API key tidak diatur, scan label OCR tetap bisa digunakan.
- Model utama/fallback hanya dipakai untuk estimasi foto makanan. OCR screenshot olahraga dan scan label gizi tetap berjalan lokal di browser dengan Tesseract.js dan tidak menggunakan kuota Gemini.
- Panel **Tanya AI** menjawab pertanyaan performa, kesiapan HM, nutrisi, dan rencana latihan berdasarkan ringkasan aktivitas 8 minggu serta nutrisi 14 hari yang dihitung di browser. Ringkasan agregat dan pertanyaan dikirim ke Gemini melalui Netlify Function; ringkasan tidak menyertakan nama makanan atau aktivitas, dan percakapan hanya berada di memori halaman. Hindari memasukkan data pribadi ke pertanyaan. Fitur memerlukan `FITNESS_TRACKER_GEMINI_API_KEY` yang sama dengan estimasi foto. Jawaban adalah panduan umum, bukan diagnosis medis atau pengganti pelatih/ahli gizi.
- Gemini menerapkan batas per project dan per model; batas aktual dapat berbeda, berubah, dan tidak dijamin. API tidak menyediakan sisa kuota real-time untuk aplikasi ini, sehingga rotasi model membagi beban secara bergiliran dan fallback menangani limit yang dilaporkan oleh API, tetapi tidak dapat menjamin pindah tepat sebelum ambang kuota.
- Tab **Olahraga** menyediakan lari, sepeda, renang, jalan kaki, hiking, dayung, free training, yoga, olahraga lainnya, dan **Custom**. Custom menampilkan kolom wajib untuk nama olahraga; judul aktivitas tetap menjadi kolom terpisah. Jarak, pace/kecepatan, waktu, elevasi, dan kalori dapat diisi sesuai olahraga. Tombol **Isi estimasi kalori** memakai pendekatan MET (`MET × 3,5 × berat kg ÷ 200 × durasi menit`) berdasarkan jenis olahraga, durasi, dan berat badan terakhir yang dicatat pada/sebelum tanggal latihan. Nilai ini perkiraan kasar, bisa berbeda dari kalori aktual, dan tetap dapat diedit; tinggi badan tidak dipakai dalam rumus kalori.
- Arsip ekspor Strava ZIP dapat diunggah dari bagian **Jurnal Aktivitas**. Aplikasi membaca hanya `activities.csv` di browser; bila CSV berisi dua kolom `Distance`, kolom kedua (meter) dipakai agar jarak tercatat benar dalam kilometer. Waktu `Activity Date` ekspor dikonversi dari UTC ke WIB (UTC+7), sehingga aktivitas yang diekspor sebagai 9:57 PM tanggal 4 akan tercatat pukul 4:57 AM tanggal 5. Tanggal/durasi/jenis olahraga dipetakan ke format jurnal dan kalori Strava dipakai bila tersedia. Jika kalori kosong atau 0, aplikasi memperkirakannya dengan MET berdasarkan jenis olahraga, durasi, dan berat badan pada/sebelum tanggal aktivitas; bila data tidak tersedia, kalori tetap 0. Saat arsip diunggah ulang, jarak lama yang tersimpan dengan nilai sangat kecil akibat impor sebelumnya diperbaiki tanpa membuat duplikat; waktu lama yang tertinggal tepat 7 jam dikoreksi ke WIB, dan estimasi akan mengisi kalori hanya jika kalorinya masih 0. ID stabil `strava-{Activity ID}` serta pemeriksaan di Google Sheets mencegah duplikasi saat arsip yang sama diunggah lagi. Aktivitas baru tetap dicadangkan lokal dan menunggu sinkronisasi bila offline.
- Target aktivitas mencakup jarak lari, jarak sepeda, push-up, dan target custom. Periode target dapat diatur harian, mingguan, bulanan, atau tahunan; progres menjumlahkan catatan di periode berjalan. Catatan custom harus menggunakan nama dan satuan yang sama agar masuk ke progres targetnya.
- OCR tersedia untuk semua jenis olahraga. Setelah screenshot dipilih, OCR mencoba mengenali jenis olahraga, judul, tanggal/waktu, jarak, pace/kecepatan, waktu, dan elevasi; hasilnya mengisi formulir untuk diperiksa sebelum disimpan. Jika OCR kehilangan pemisah desimal pada jarak km/mi tiga digit (misalnya `514`), parser membacanya sebagai `5,14`; selalu periksa kembali hasil pada formulir. Pace renang dan kecepatan sepeda dikenali jika terlihat pada screenshot. Tombol **Baca screenshot** tersedia untuk mencoba ulang; OCR tidak menghitung kalori terbakar.
- Grafik jarak dapat ditelusuri per minggu. Grafik semua olahraga dan perkembangan pace menyediakan pilihan tanggal awal dan akhir hingga 5 tahun serta filter kategori aktivitas dengan opsi semua kategori. Rentang sampai 90 hari menampilkan data harian/per aktivitas; rentang lebih panjang diringkas per minggu, dengan detail aktivitas pada tooltip. Rentang panjang dapat digulir horizontal tanpa mengubah lebar halaman. Grafik riwayat kalori membandingkan asupan makanan, kalori terbakar, dan selisih bersih per hari atau per minggu, dengan pilihan rentang tanggal dan detail catatan saat diarahkan.
- Pengukuran tinggi dan berat dapat dicatat pada tanggal pilihan dengan frekuensi bebas (misalnya harian, tiap beberapa hari, atau mingguan). Riwayat disimpan di tab `Body Measurements` Google Sheets dan dicadangkan di browser; grafik berat badan menampilkan seluruh riwayat serta perubahan dari pengukuran pertama. BMI dihitung sebagai indikator skrining umum, bukan diagnosis medis. Catatan pengukuran dapat diedit atau dihapus.
- Dashboard menghitung kalori dari semua jenis olahraga, target jarak mingguan hanya dari lari, dan tren pace khusus aktivitas lari.
- Target kalori dan makro hanya mengedit jumlah; nama serta satuan nutrisi tetap karena data asupan dicatat dalam kcal atau gram. Target olahraga dapat mengedit nilai dan periode, sedangkan target custom dapat mengedit nama, jumlah, satuan, dan periode. Tekan **Selesai**, lalu **Simpan target**. Target olahraga dan custom mendukung periode harian, mingguan, bulanan, atau tahunan. Target yang dihapus dapat ditambahkan kembali; preferensi disimpan lokal per browser.
- Ketika koneksi gagal, log dan pengukuran tetap disimpan lokal dan dicoba disinkronkan saat koneksi kembali. Penghapusan juga disimpan sebagai antrean agar data di Google Sheets ikut terhapus setelah online.
- Catatan makanan dan olahraga pada jurnal dapat diedit. Perubahan mempertahankan ID dan waktu pembuatan catatan, memperbarui baris Google Sheets yang sama, serta masuk antrean sinkronisasi bila offline. Setelah mengubah Apps Script, deploy sebagai **New version** agar aksi pembaruan tersedia.
- Catatan jurnal dan pengukuran tubuh dapat dihapus setelah konfirmasi; penghapusan ikut diterapkan ke Google Sheets dan tetap mengantre bila sedang offline. Deploy Apps Script sebagai **New version** dan deploy ulang Netlify agar aksi baru tersedia.
- Setelah menambahkan atau memperbarui impor Strava, deploy ulang Netlify dan deploy Google Apps Script sebagai **New version** agar aksi impor batch, deduplikasi, serta pembaruan kalori, jarak, dan koreksi waktu WIB di spreadsheet aktif. Setelah deploy, unggah ulang ZIP Strava untuk memperbaiki waktu aktivitas lama.

Format tab `Fitness Logs` mempertahankan kolom lama dan menambahkan `activityValue`, `activityUnit`, gula, serat, natrium, vitamin, dan mineral. `type` berisi `meal` atau `workout`; `activityType` menyimpan kategori aktivitas; `activityName` menyimpan nama custom. Apps Script menambahkan header baru di bagian akhir secara otomatis setelah kode baru dideploy.
