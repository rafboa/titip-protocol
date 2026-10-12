# Oracle M-dari-N (multi-node)

Kontrak escrow bisa memakai beberapa oracle. Dana dilepas hanya setelah `threshold` oracle
berbeda menyetujui pengiriman (`approve_delivery`). Tanpa himpunan oracle, kontrak berjalan seperti
sebelumnya: satu oracle (`confirm_delivery`).

## Aturan penting

- Setiap oracle dihitung sekali dan menandatangani transaksinya sendiri dengan kuncinya sendiri.
- Begitu himpunan oracle diatur, `confirm_delivery` ditolak kontrak. Hanya `approve_delivery` yang berlaku.
- Persetujuan dari oracle yang sudah dikeluarkan dari himpunan tidak dihitung.
- `update_oracle` mengembalikan kontrak ke satu oracle dan menghapus himpunan.
- Admin tetap bisa mengganti himpunan dan menyelesaikan dispute (belum terdesentralisasi, panel arbiter menyusul).

## Mencoba di testnet

0. **Deploy kontrak versi baru.** Kontrak yang sudah ter-deploy sebelum fitur ini tidak punya
   `set_oracles` (galatnya: *trying to invoke non-existent contract function*). Bangun dan deploy ulang:

   ```bash
   cd packages/contracts && cargo build --release --target wasm32v1-none && cd ../..
   npx dotenv-cli -e .env.local -- npx tsx scripts/deploy-contract.ts
   ```

   Lalu ganti `NEXT_PUBLIC_CONTRACT_ADDRESS` di `.env.local` (dan di Vercel/Railway bila dipakai)
   dengan alamat baru. Escrow lama tetap berada di kontrak lama dan tidak ikut pindah. Skrip deploy
   menolak wasm yang lebih tua daripada kode sumber kontrak.

1. Buat 3 kunci oracle (rahasia ditulis ke `.oracle-keys/`, tidak dicetak, tidak di-commit):

   ```bash
   npx tsx scripts/generate-oracle-keys.ts 3 --fund
   ```

2. Atur himpunan 2-dari-3 dengan kunci publik yang dicetak skrip tadi (admin menandatangani):

   ```bash
   npx dotenv-cli -e .env.local -- npx tsx scripts/set-oracle-set.ts set 2 G...A G...B G...C
   npx dotenv-cli -e .env.local -- npx tsx scripts/set-oracle-set.ts show
   ```

3. Jalankan satu service oracle per kunci, masing-masing di terminal sendiri. Setiap node memakai
   `ORACLE_SECRET_KEY` dan `ORACLE_NODE_ID` dari berkasnya sendiri, di atas pengaturan bersama
   (`DATABASE_URL`, `REDIS_URL`, `ORACLE_INTERNAL_API_KEY`, `APP_INTERNAL_API_URL`).

   **Urutan `-e` penting:** `dotenv-cli` memakai nilai dari berkas *pertama* yang mendefinisikan sebuah
   variabel. Berkas kunci node harus di depan, kalau tidak, `ORACLE_SECRET_KEY` dari `.env.local`
   (kunci deployer/admin) menang dan semua node berjalan dengan kunci yang sama.

   ```bash
   npx dotenv-cli -e .oracle-keys/oracle-1.env -e .env.local -- npm run start -w @titip/oracle
   ```

   Ulangi untuk `oracle-2.env` dan `oracle-3.env`. Log awal setiap node menampilkan `Node ID`,
   periksa bahwa ketiganya berbeda.

## Perilaku service oracle

- Node memeriksa kontrak: ada himpunan atau tidak, siapa yang sudah menyetujui, dan status escrow.
- Node yang sudah menyetujui tidak mengirim transaksi kedua selama kuorum belum tercapai.
- Node yang kalah balapan menyetujui terakhir tidak gagal: bila escrow sudah `Delivered`, ia dianggap berhasil.
- Hanya satu callback ke web yang berhasil menyinkronkan DB. Node lain menerima 409 "sudah DELIVERED" dan menganggapnya sukses.
- Bila kunci node tidak ada di himpunan, node berhenti dengan galat yang jelas (periksa `ORACLE_SECRET_KEY`).
- **Satu antrean per node.** Antrean BullMQ bernama `tracking-<ORACLE_NODE_ID>`, jadi setiap node mengevaluasi
  setiap escrow sendiri dan menyetujuinya. `ORACLE_NODE_ID` harus **unik per node** dan hanya berisi
  `A-Z a-z 0-9 _ -` (maksimal 64 karakter); dua node dengan ID sama akan berbagi antrean dan kembali
  ke perilaku lama. Antrean lama `tracking` tidak dipakai lagi.
- **Webhook kurir** untuk pengiriman akhir tetap berstatus belum diproses selama kuorum belum tercapai, supaya
  setiap node ikut menyetujui; baru ditandai selesai setelah dana dirilis. Event yang kuorumnya tidak pernah
  tercapai (misalnya hanya satu node hidup) tetap terbuka dan diperiksa ulang tiap siklus.
- Dua node yang menyetujui pada ledger yang sama bisa membuat salah satu transaksi gagal; node itu membaca ulang
  keadaan kontrak dan mencoba lagi (maksimal 3 percobaan) tanpa menunggu antrean.
- Event di `oracle_events`: `DELIVERY_SUBMITTED` hanya saat node mengirim transaksi, `DELIVERY_CONFIRMED` sekali saat DB disinkronkan,
  `SUBMIT_ERROR` saat pengiriman gagal.
- Di mainnet adapter kurir mock dimatikan: kurir tanpa kunci API atau tanpa adapter membuat job gagal, bukan "terkirim".

## Batasan yang perlu dipahami

- **Independensi data.** Node-node ini berbagi database dan antrean yang sama (satu operator dengan
  beberapa kunci). Oracle yang benar-benar independen harus mengambil data kurir sendiri
  (kunci API dan webhook sendiri). Arsitektur itu belum ada: jangan menyebut sistem ini terdesentralisasi
  sebelum operator yang berbeda menjalankan node dengan sumber data masing-masing.
- Staking dan slashing ditunda. Belum ada jaminan ekonomi bagi oracle.
- Perubahan kontrak ini perlu deploy ulang dan tinjauan keamanan sebelum mainnet.
