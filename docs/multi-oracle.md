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

1. Buat 3 kunci oracle (rahasia ditulis ke `.oracle-keys/`, tidak dicetak, tidak di-commit):

   ```bash
   npx tsx scripts/generate-oracle-keys.ts 3 --fund
   ```

2. Atur himpunan 2-dari-3 dengan kunci publik yang dicetak skrip tadi (admin menandatangani):

   ```bash
   npx dotenv-cli -e .env.local -- npx tsx scripts/set-oracle-set.ts set 2 G...A G...B G...C
   npx dotenv-cli -e .env.local -- npx tsx scripts/set-oracle-set.ts show
   ```

3. Jalankan satu service oracle per kunci. Setiap node memakai `ORACLE_SECRET_KEY` dan `ORACLE_NODE_ID`
   dari berkasnya sendiri, di atas pengaturan bersama (`DATABASE_URL`, `REDIS_URL`,
   `ORACLE_INTERNAL_API_KEY`, `APP_INTERNAL_API_URL`):

   ```bash
   npx dotenv-cli -e .env.local -e .oracle-keys/oracle-1.env -- npm run start -w @titip/oracle
   ```

   Ulangi untuk `oracle-2.env` dan `oracle-3.env`.

## Perilaku service oracle

- Node memeriksa kontrak: ada himpunan atau tidak, siapa yang sudah menyetujui, dan status escrow.
- Node yang sudah menyetujui tidak mengirim transaksi kedua selama kuorum belum tercapai.
- Node yang kalah balapan menyetujui terakhir tidak gagal: bila escrow sudah `Delivered`, ia dianggap berhasil.
- Hanya satu callback ke web yang berhasil menyinkronkan DB. Node lain menerima 409 "sudah DELIVERED" dan menganggapnya sukses.
- Bila kunci node tidak ada di himpunan, node berhenti dengan galat yang jelas (periksa `ORACLE_SECRET_KEY`).

## Batasan yang perlu dipahami

- **Independensi data.** Node-node ini berbagi database dan antrean yang sama (satu operator dengan
  beberapa kunci). Oracle yang benar-benar independen harus mengambil data kurir sendiri
  (kunci API dan webhook sendiri). Arsitektur itu belum ada: jangan menyebut sistem ini terdesentralisasi
  sebelum operator yang berbeda menjalankan node dengan sumber data masing-masing.
- Staking dan slashing ditunda. Belum ada jaminan ekonomi bagi oracle.
- Perubahan kontrak ini perlu deploy ulang dan tinjauan keamanan sebelum mainnet.
