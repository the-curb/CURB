**The Curb — inventaris pekerjaan tersisa, 13 September 2026**

Audit source, keputusan, roadmap dan bukti lokal setelah paket pertama. Repo: `D:/BARONG/the-curb`; branch `codex/curb-first-release-hardening`; commit dasar `8f093ff9de64c8da7003ad2d2762c6b5967db573`. Perubahan paket pertama masih di working tree. Laporan ini mencatat pekerjaan dan usulan urutan; tidak mengubah keputusan produk, harga, kontrak, atau konfigurasi.

Status di sini berasal dari file lokal. Website live, akun hosting, database produksi, konfigurasi launchpad dan state chain terkini tidak diperiksa ulang dalam audit ini. “Belum dibuktikan” tidak selalu berarti “belum pernah dikerjakan”. Bukti bertanggal dari operator dapat mengubah status setelah diperiksa. Tidak ada test baru, commit, push, deployment, transaksi, atau komunikasi eksternal dalam audit ini.

**Dasar yang sudah selesai**

Accounting dua komponen, mint in-kind atomik, exit allocation, claim A/B mandiri termasuk ketika receipt sudah nol, permits/pause, reconciliation/index recovery, pemeriksaan account/chain wallet, parsing BigInt, pembetulan bukti fork, serta sejumlah alur credits sudah tersedia. CreditDesk, key, price reader, indexer, debit, webhook, receipt, deployment tools dan backup/restore tools juga sudah dibangun. Jangan menjadwalkan semuanya lagi dari nol.

Paket pertama memiliki 493 tes aplikasi lulus / 0 gagal / 6 skip dari 499; 49 tes Solidity non-fork lulus; 13 tes fork lulus; dua acceptance credits lokal lulus secara terpisah; 16 pemeriksaan browser lokal lulus; production build dan TypeScript lulus. Browser memakai wallet mock; acceptance memakai chain dan komponen lokal. Keenam skip bukan keenam kegagalan: dua acceptance credits dijalankan terpisah, sedangkan bukti final untuk fixture lain masih perlu dilengkapi. Self-review dan static analysis sudah ada, tetapi review independen belum tersedia.

Sumber: [laporan paket pertama](D:/BARONG/the-curb/docs/reviews/FIRST-RELEASE-2026-09-13.md), [self-review](D:/BARONG/the-curb/docs/decisions/REVIEW.md), [catatan backup/restore](D:/BARONG/the-curb/DEPLOY.md:61).

**Gate posisi saat audit**

| Gate | Status dalam source | Pekerjaan utama yang masih terbuka |
| --- | --- | --- |
| G1 — instrument | IN_RESEARCH | Lengkapi identitas, dependency dan evidence instrumen; putuskan kelayakannya. |
| G2 — rights/access | NOT_STARTED | Review hak dan eligibility untuk issuer, kontrak, receipt dan pengguna. |
| G3 — components | IN_RESEARCH | Acquisition/current-wrapper issuance, corporate actions, authority dan batas integrasi. |
| G4 — contract | IN_RESEARCH | Review independen dan penutupan temuan material. |
| G5 — operations | IN_RESEARCH | Operator Ethereum, policy final dan pembuktian operasi pada lingkungan yang dipilih. |
| G6 — economics | IN_RESEARCH | Biaya lengkap dan validasi kebutuhan pengguna terhadap baseline dua token di wallet. |

Tidak ada gate berstatus PASSED. Ini status keputusan yang dicatat di [source gate](D:/BARONG/the-curb/lib/positions/series.ts:182), bukan persentase penyelesaian proyek. Kelayakan token launch, paid beta dan pilot posisi harus diputuskan sesuai syarat masing-masing; satu milestone tidak meluluskan semuanya.

**Pekerjaan yang bisa langsung dipersiapkan secara lokal**

**R01 — Selesaikan ketidakkonsistenan dokumen dan klaim fitur.** Status: sebagian selesai dalam paket pertama; sisa di bawah ditemukan pada audit. Prioritas: sebelum release berikutnya.

- [RUNBOOK](D:/BARONG/the-curb/docs/decisions/RUNBOOK.md:8) masih menyebut stop mint dengan satu signer. [OPERATIONS](D:/BARONG/the-curb/docs/decisions/OPERATIONS.md:16) sudah sesuai source: bila operator Safe 2-of-3, stop maupun resume memerlukan quorum; kontrak tidak memiliki guardian terpisah. RUNBOOK juga terlalu mutlak menjanjikan tidak ada charge ketika store gagal, padahal acknowledgement debit dapat UNKNOWN.
- [COSTS](D:/BARONG/the-curb/docs/decisions/COSTS.md:15) masih memakai angka gas fork lama. [Record terbaru](D:/BARONG/the-curb/contracts/evidence/apple-s1.fork.json:37) mencatat transfer A 43.882 dan B 66.578 gas, berbeda dari tabel lama 13.587 dan 68.533. Sinkronkan seluruh tabel dan baseline dengan block/record yang sama; angka ini tetap execution gas, bukan total biaya transaksi.
- [ADR-006](D:/BARONG/the-curb/docs/decisions/ADR-006-lots-and-cap.md:11) masih menyebut alamat/decimals B belum dibaca. [ASSUMPTIONS](D:/BARONG/the-curb/docs/decisions/ASSUMPTIONS.md:7) dan ADR-006 perlu membedakan inventory wrapper historis dari kapasitas issuance tambahan yang belum diuji.
- [DEPLOYMENT](D:/BARONG/the-curb/docs/decisions/DEPLOYMENT.md:30) masih mengaitkan treasury Robinhood dengan operator series tanpa scope chain yang cukup jelas. Operator Ethereum perlu bukti tersendiri.
- [TOKEN](D:/BARONG/the-curb/docs/decisions/TOKEN.md:77) menempatkan deployment desk sesudah first top-up ke desk. Selaraskan urutan yang dapat dijalankan dengan LAUNCH; pemeriksaan transfer token dan top-up CreditDesk adalah langkah berbeda.
- [Registry Tally](D:/BARONG/the-curb/lib/agents/registry.ts:179) mengklaim concentration/holder distribution, sementara [producer](D:/BARONG/the-curb/lib/agents/producers/tally.ts:17) eksplisit hanya membaca sampel transfer dan tidak mengukur konsentrasi pemegang. Perbaiki klaim menjadi kemampuan aktual. Full-history indexer hanya pekerjaan tambahan bila fitur itu sengaja dipilih.
- [INTERVIEWS](D:/BARONG/the-curb/docs/decisions/INTERVIEWS.md:20) perlu stimulus yang membedakan Mock A/B dan contoh lot dari konfigurasi saham produksi.
- [DEPLOY](D:/BARONG/the-curb/DEPLOY.md:250) perlu konsisten dengan bagian akhirnya: watch di GitHub sudah ada; monitor di platform lain masih terbuka. Beberapa keterangan biaya masih menggantung pada penamaan operator yang sudah dicatat.

Selesai jika pembaca tidak mendapat dua instruksi yang bertentangan, semua angka menunjuk bukti bertanggal, dan klaim fitur sesuai output producer. Catatan historis dipertahankan dengan penjelasan ketika sudah digantikan. Perubahan wording tidak otomatis menyetujui policy produksi.

**R02 — Bawa status UNREAD sampai receipt dan pending top-up.** Status: gap source terkonfirmasi. Prioritas: sebelum paid beta.

[receipts.ts](D:/BARONG/the-curb/lib/credits/receipts.ts:60) mengubah index UNREAD menjadi `waitingForRate: 0` dan `storeFault: null` ketika rows top-up masih terbaca. [keys.ts](D:/BARONG/the-curb/lib/credits/keys.ts:149) dapat mengembalikan pending kosong ketika pembacaan index yang diminta gagal. [Services](D:/BARONG/the-curb/app/services/page.tsx:259) lalu menampilkan angka nol.

Selesai jika API/UI membedakan tidak ada pending, pending tidak dibaca, dan pembacaan gagal. Saldo yang benar-benar terbaca tetap dapat dijelaskan terpisah; pemanggilan `pending: false` untuk debit tidak keliru diperlakukan sebagai outage. Tambahkan regresi untuk partial store failure.

**R03 — Samakan syarat petunjuk top-up di semua endpoint.** Status: API quote dan Services sudah diperkuat; hint lain tertinggal. Prioritas: sebelum mengundang pembayaran.

[guard.ts](D:/BARONG/the-curb/lib/credits/guard.ts:39) masih memakai MATCHES dari pembacaan kode terakhir untuk menawarkan top-up, tanpa seluruh syarat freshness/immutables baru. [POST keys](D:/BARONG/the-curb/app/api/keys/route.ts:23) memberi tujuan top-up dari konfigurasi saja.

Selesai jika petunjuk pembayaran memakai kesiapan yang sama dengan `/api/credits`, atau jelas mengarahkan pengguna untuk memeriksa kesiapan sebelum transfer. Uji code stale, rate stale, perubahan konfigurasi dan store unread. Menghentikan undangan top-up tidak otomatis menghentikan pemakaian saldo credits yang telah dimiliki.

**R04 — Tutup keputusan perpindahan operator satu langkah.** Status: temuan self-review masih terbuka. Prioritas: sebelum deployment CompanySeries publik.

[CompanySeries](D:/BARONG/the-curb/contracts/src/CompanySeries.sol:306) memiliki transferOperator langsung. [REVIEW](D:/BARONG/the-curb/docs/decisions/REVIEW.md:28) dan [ADR-001](D:/BARONG/the-curb/docs/decisions/ADR-001-immutable-series.md:27) mencatat risiko salah alamat/kehilangan otoritas. Tentukan model role final, termasuk kemungkinan transfer/accept dua langkah. Selesai jika keputusan memiliki owner, perubahan yang dipilih diuji, build diperbarui dan direview kembali. Ini belum diimplementasikan diam-diam oleh audit.

**R05 — Perkuat pemeriksaan operator pada deployment series.** Status: gap validasi tool. Prioritas: sebelum deployment publik.

[deploy-series.ts](D:/BARONG/the-curb/contracts/scripts/deploy-series.ts:72) memeriksa format alamat operator; pemeriksaan chain berikutnya berfokus pada komponen. Selesai jika tool dan reviewed record membuktikan operator pada target chain sesuai policy: code, implementation/config, owners dan quorum. Uji penolakan alamat tanpa code serta konfigurasi yang tidak sesuai. Bukti Safe Robinhood tidak menggantikan bukti Ethereum.

**R06 — Lengkapi pengalaman review transaksi dan transaksi pengganti.** Status: peningkatan UX; jalur claim dasar sudah bekerja. Prioritas: sebelum pilot pengguna sesuai kebutuhan uji.

Janji [MECHANISM](D:/BARONG/the-curb/MECHANISM.md:98) perlu disejajarkan dengan [layar wallet](D:/BARONG/the-curb/app/components/wallet-sign.tsx:243): jumlah dalam unit yang dapat dibaca, allowance, indicative value beserta waktunya, biaya atau alasan belum tersedia, dan hasil receipt yang diharapkan. API menyatakan gas NOT_ESTIMATED dan menyerahkannya ke wallet. Estimasi tidak menjamin transaksi akan berhasil.

Pending saat ini tersimpan untuk reload tab yang sama; pemeriksaan memakai hash tersimpan. Penanganan speed-up/cancel/replacement belum otomatis. Selesai jika hasil penggantian dapat direkonsiliasi tanpa blind retry, dan batas persistensi dijelaskan. Cross-tab persistence adalah pilihan UX lanjutan, bukan syarat accounting yang baru diada-adakan.

**R07 — Lengkapi bukti pengujian lingkungan final.** Status: banyak tes lulus; beberapa fixture tidak dimuat di suite final. Prioritas: sebelum release paid beta/pilot yang bersangkutan.

Jalankan conformance Postgres pada database terisolasi serta tool-credit deployment rehearsal, positions rehearsal dan incident drill untuk versi final. Dua tes credits yang diskip di suite penuh sudah lulus terpisah. Backup/restore dan rehearsal lain memiliki bukti historis; jangan mengklaim belum pernah diuji. Selesai jika bukti mencatat source/build, lingkungan, hasil dan skip yang tersisa; perubahan setelah pengujian diikuti pemeriksaan relevan. Database produksi bukan fixture pengujian. Sumber: [hasil final](D:/BARONG/the-curb/docs/reviews/FIRST-RELEASE-2026-09-13.md:41), [DEPLOY](D:/BARONG/the-curb/DEPLOY.md:61).

**R08 — Jadikan perubahan lokal sebuah release yang dapat dilacak.** Status: belum commit/push/deploy dalam paket pertama. Prioritas: setelah perbaikan lokal dan review yang relevan.

Review diff dan evidence, tetapkan commit release, jalankan checks pada commit tersebut, verifikasi jalur CI/deployment serta rencana pemulihan. DEPLOY mencatat push main dapat memicu Vercel tanpa menunggu checks; pastikan kontrol release yang dipilih benar-benar berlaku. Saat deploy kelak, periksa migrasi/config, code verification dan tick baru: snapshot rate lama tanpa chain ditahan sampai pembacaan baru berhasil. Selesai jika versi yang tayang dan hasil smoke test dapat dihubungkan ke commit yang disetujui. Build lokal belum merupakan deployment. Sumber: [release](D:/BARONG/the-curb/docs/reviews/FIRST-RELEASE-2026-09-13.md:3), [DEPLOY](D:/BARONG/the-curb/DEPLOY.md).

**Pekerjaan pembuktian produk dan instrumen**

**R09 — Jalankan wawancara pengguna posisi dan tes pemahaman.** Status: guide ada, respons eksternal belum dicatat. Prioritas: sebelum menyatakan thesis tervalidasi dan sebelum menentukan pilot.

Wawancarai 10–15 calon pengguna relevan; bandingkan satu receipt dengan memegang dua token langsung. Catat masalah nyata, pemahaman backing/claim, biaya, kesalahan, willingness to use/pay dan alasan menolak. Target awal dalam blueprint adalah usulan eksperimen: setidaknya lima orang dapat menjelaskan masalah nyata, tiga ingin mencoba lagi setelah memahami biaya/risk, dan satu integrator spesifik bila integrator target utama. Itu bukan bukti PMF. Selesai jika ada hasil asli dan keputusan lanjut/ubah/stop, termasuk bila baseline lebih disukai. Sumber: [INTERVIEWS](D:/BARONG/the-curb/docs/decisions/INTERVIEWS.md:3), [MECHANISM](D:/BARONG/the-curb/MECHANISM.md:331).

**R10 — Validasi pembeli API/archive/webhook secara terpisah.** Status: belum ada bukti demand yang memadai dalam record audit. Prioritas: sebelum memperbesar paid beta.

Guide posisi tidak menjawab apakah integrator mau membayar data. Usulan awal: temui 3–5 calon integrator yang benar-benar membutuhkan history/journal/alert, minta tugas integrasi konkret, ukur penggunaan ulang dan kesediaan membayar harga yang sudah diputuskan. Angka ini target rekrutmen usulan, bukan calon pelanggan yang sudah tersedia. Selesai jika segmen, kebutuhan endpoint, alasan membayar dan hasil uji tercatat. Pembeli token tidak otomatis pembeli layanan. Sumber dasar: [INTERVIEWS](D:/BARONG/the-curb/docs/decisions/INTERVIEWS.md), [Services](D:/BARONG/the-curb/app/services/page.tsx:323).

**R11 — Selesaikan review hak dan eligibility kedua issuer.** Status: G2 NOT_STARTED. Prioritas: syarat pilot aset nyata.

Jawab secara tertulis siapa yang boleh memperoleh/memegang token, apakah kontrak series dapat menjadi holder, apa implikasi receipt, siapa penerima claim yang diizinkan, yurisdiksi/kategori peserta serta proses exit/access loss. Selesai jika sumber issuer dan/atau review legal yang relevan mencakup struktur yang dipilih dan pemilik gate mencatat keputusan. Fork transfer membuktikan perilaku teknis pada state tertentu; tidak menjawab izin. Audit ini tidak memberikan pendapat legal. Sumber: [G2](D:/BARONG/the-curb/lib/positions/series.ts:184), [ASSUMPTIONS](D:/BARONG/the-curb/docs/decisions/ASSUMPTIONS.md:9).

**R12 — Buktikan jalur acquisition dan issuance komponen.** Status: round trip fork lulus, jalur memperoleh komponen belum dibuktikan. Prioritas: sebelum memilih lot/cap.

Uji/documentasikan acquisition raw A, deposit/mint wrapper versi yang dipilih, asset/decimals, maxDeposit/maxMint atau limit yang berlaku, rounding, acquisition B serta akses, liquidity dan ukuran yang dapat diperoleh. Inventory wrapper historis yang kecil tidak membuktikan batas issuance absolut. Saldo yang disiapkan melalui storage fork tidak membuktikan jalur pembelian/mint sebenarnya. Selesai jika ada bukti bertanggal untuk akses dan kapasitas pada ukuran pilot; transaksi nyata hanya ketika diotorisasi. Sumber: [batas fork](D:/BARONG/the-curb/contracts/evidence/apple-s1.fork.json:51), [release](D:/BARONG/the-curb/docs/reviews/FIRST-RELEASE-2026-09-13.md:53).

**R13 — Lengkapi instrument file, dependency map dan corporate-action evidence.** Status: sebagian sudah ada, G1/G3 belum lulus.

Lengkapi identity, rights, authority/proxy/admin, custody dan pihak perantara yang dapat dibuktikan; catat pihak yang belum dinamai tanpa mengarang. Bedakan transfer token, unwrap, jual di pasar dan redemption issuer. Review kode implementasi komponen belum tercakup oleh self-review. Bukti dividend historis ada secara terpisah; split belum dibuktikan dan corporate-action evidence tidak diulang dalam 13 fork tes paket pertama. Selesai jika evidence versi/block yang relevan menjawab perilaku unit atau tetap menyatakan batas yang belum diketahui. Jika event historis tidak tersedia, jangan membuat simulasi seolah bukti kejadian nyata. Sumber: [instrument/gates](D:/BARONG/the-curb/lib/positions/series.ts:183), [cakupan review](D:/BARONG/the-curb/docs/decisions/REVIEW.md:64).

**R14 — Putuskan komponen, lot, cap dan biaya posisi produksi.** Status: metode proposed; angka simulator ilustratif. Prioritas: sesudah R09/R11/R12/R13 memberi input.

Tetapkan versi komponen dan chain, qA/qB, capLots, peserta/ukuran pilot dari unit, jalur acquisition, limit, biaya serta manfaat pengguna. Hitung approvals, base transaction/calldata, cold access, wrapping/acquisition/exit dan harga gas/ETH bertanggal terhadap baseline dua token. Execution gas warm tidak cukup untuk klaim murah. Selesai jika reviewed configuration memiliki asal setiap input; q10/20 dan cap1.000 tidak diangkat menjadi produksi karena tersedia di simulator. Otomatisasi feed harga bukan syarat sebelum tersedia analisis biaya bertanggal. Sumber: [ADR-006](D:/BARONG/the-curb/docs/decisions/ADR-006-lots-and-cap.md), [COSTS](D:/BARONG/the-curb/docs/decisions/COSTS.md).

**R15 — Finalisasi akses peserta, ADR dan operator series.** Status: mekanisme prototype tersedia; kebijakan produksi masih proposed.

Tuntaskan ADR 001–006 serta OPERATIONS/RUNBOOK dengan owner, reviewer dan tanggal. Putuskan lifecycle permit, eligibility/onboarding, attestations dan proses privat data peserta; expiry/revocation, participant contract address, access loss, sunset/permanent close, resume delay, surplus retirement dan cap policy yang masih terbuka. Verifikasi Safe Ethereum dan quorum sebenarnya; record treasury Robinhood sudah ada tetapi berbeda scope. Selesai jika proses dapat dijalankan operator dan diuji tanpa menjanjikan recovery/reassignment yang kontraknya tidak bisa lakukan. Sumber: [ADR-003](D:/BARONG/the-curb/docs/decisions/ADR-003-on-chain-access.md:20), [OPERATIONS](D:/BARONG/the-curb/docs/decisions/OPERATIONS.md:3), [RUNBOOK](D:/BARONG/the-curb/docs/decisions/RUNBOOK.md:3).

**R16 — Review independen kontrak dan layanan yang memegang catatan nilai.** Status: self-review dan static analysis tersedia, review independen belum.

Cakupan mencakup CompanySeries, CreditDesk, asumsi integrasi komponen, deployment/config, rate/indexing serta backend ledger/debit sesuai release yang dipilih. Selesai jika reviewer independen bernama mengulas commit/build tertentu, menerbitkan hasil, temuan material ditutup dan regresi yang relevan diulang. Slither yang sudah dijalankan tidak perlu dipresentasikan sebagai pekerjaan yang belum dimulai; disposition temuannya tetap perlu review. Sumber: [REVIEW](D:/BARONG/the-curb/docs/decisions/REVIEW.md:3), [TOKEN](D:/BARONG/the-curb/docs/decisions/TOKEN.md:76).

**Pekerjaan token dan layanan berbayar**

**R17 — Putuskan dan verifikasi mekanisme launchpad sebenarnya.** Status: terms/curve/allocation/vesting belum diketahui dalam record lokal.

PONS pernah disebut pengguna; audit ini belum memverifikasi platform tersebut. Periksa sumber resmi untuk kecocokan chain yang sudah dipilih, plain ERC-20, supply, creator allocation, vesting, fee/tax/rebase/admin, curve-to-pool dan liquidity. Informasi yang diperlukan sebelum penjualan harus tersedia sebelum penjualan. Selesai jika pilihan dan terms bertanggal dapat diperiksa serta blocker teknis/produk ditangani. Jangan mengarang tokenomics untuk mengisi kolom kosong. Sumber: [ASSUMPTIONS](D:/BARONG/the-curb/docs/decisions/ASSUMPTIONS.md:18), [TOKEN](D:/BARONG/the-curb/docs/decisions/TOKEN.md:31), [LAUNCH](D:/BARONG/the-curb/docs/decisions/LAUNCH.md:28).

**R18 — Selesaikan urutan pendanaan review dan formula penggunaan proceeds.** Status: keputusan tertulis ada, pelaksanaannya belum cukup presisi.

TOKEN meminta review sebelum launch, sementara proceeds launch direncanakan membiayai review. Tentukan sumber biaya pra-launch dan syarat tiap tahap. Waterfall “first US$40k, then 40%”, “next US$15k, then 20%”, ditambah 20% infrastruktur dan 20% reserve harus menjadi formula tanpa penghitungan ganda. Selesai jika definisi net/biaya/kurs, prioritas, persentase atas basis yang mana, owner pengeluaran dan contoh net US$10k/55k/100k dijelaskan; contoh bukan perkiraan fundraise. Penjelasan/perubahan keputusan perlu dicatat product owner. Sumber: [TOKEN proceeds](D:/BARONG/the-curb/docs/decisions/TOKEN.md:60), [urutan](D:/BARONG/the-curb/docs/decisions/TOKEN.md:75).

**R19 — Tuntaskan review terms token/credits.** Status: fungsi, harga dan terms dasar sudah diputuskan; review terkait masih terbuka.

Fungsi CURB saat ini membayar layanan data; minimum pendanaan kumulatif US$20 tetap saldo, bukan biaya aktivasi; history/journal US$0,05 per call; webhook US$0,10 per delivery berhasil. Review penerapan no-refund, lost key, non-expiry selama layanan hidup, pemberitahuan 30 hari, closure, reorg/defisit dan kewajiban layanan. Selesai jika kebijakan operasional sesuai terms dan hasil review yang relevan; perubahan mengikuti mekanisme keputusan/notice yang sudah dicatat. Menambahkan staking, buyback atau fee sharing bukan penyelesaian otomatis. Sumber: [TOKEN](D:/BARONG/the-curb/docs/decisions/TOKEN.md:37).

**R20 — Ukur unit economics, kapasitas dan kewajiban credits.** Status: harga sudah ada; biaya aktual dan batas beta belum lengkap.

Ukur RPC, archive/indexing, store, webhook, hosting, biaya per request/delivery/key, latency/backlog dan overhead pada volume rendah/normal/tinggi. Bedakan saldo credits USD yang belum dipakai dari CURB yang masuk treasury; tentukan budget pelayanan ketika harga token turun. Selesai jika biaya/margin dan runway memakai angka bertanggal, batas kapasitas/quota beta diputuskan dan dapat dijelaskan. Fungsi token yang berjalan tidak otomatis membuktikan permintaan publik. Sumber: [DEPLOY biaya](D:/BARONG/the-curb/DEPLOY.md:608), [TOKEN budget](D:/BARONG/the-curb/docs/decisions/TOKEN.md:68).

**R21 — Lengkapi akuntabilitas proceeds dan treasury spending.** Status: receipts top-up ada; tidak mencakup seluruh janji proceeds.

[Receipts](D:/BARONG/the-curb/lib/credits/receipts.ts:1) berasal dari top-up yang sudah dikreditkan. Tambahkan catatan yang dapat ditelusuri untuk hasil launch net, budget vs actual, persetujuan/pembayaran treasury, serta credits diterbitkan, dipakai dan tersisa. Selesai jika receipt top-up tidak dianggap bukti audit/legal sudah dibayar; invoice/tx ditautkan sesuai policy dengan data privat yang sesuai. Pendanaan credits dan hasil launch juga tidak otomatis revenue jasa yang sudah diperoleh. Sumber keputusan: [TOKEN](D:/BARONG/the-curb/docs/decisions/TOKEN.md:62).

**R22 — Eksekusi token/CreditDesk production setelah prasyarat dipenuhi.** Status: tools ada; deployment publik/configuration tidak dibuktikan oleh paket release.

Urutan operasional: keputusan launch → token dan record aktual → reviewed config → dry run/deploy desk → source/build verification dan immutables → konfigurasi aplikasi/schema → code verification oleh tick. Read supply/decimals/code/proxy/admin/transfer behaviour sesuai token yang benar-benar terbit. Code treasury perlu review sebagai Safe yang sesuai, bukan hanya code nonkosong; catatan OPERATIONS juga meminta perbandingan deployment Safe dengan release resminya. Selesai jika record dan transaksi publik yang diotorisasi tersedia serta situs menampilkan setiap milestone sesuai buktinya. Sumber: [LAUNCH](D:/BARONG/the-curb/docs/decisions/LAUNCH.md:18), [DEPLOYMENT](D:/BARONG/the-curb/docs/decisions/DEPLOYMENT.md:31), [OPERATIONS](D:/BARONG/the-curb/docs/decisions/OPERATIONS.md:38).

**R23 — Buktikan pool nyata dan kelayakan rate untuk pembayaran.** Status: reader/guard tersedia; pool aktual belum dibuktikan dalam audit lokal.

Verifikasi interface pair/pool, token order/decimals, creation/fromBlock, source quote dan feed, archive state/log access dan liquidity. Mode usd-stable memperlakukan quote sebagai USD berdasarkan konfigurasi; asumsi itu perlu dibuktikan/diterima eksplisit. Uji stale/missing rate, thin liquidity dan manipulasi yang bertahan sepanjang jendela sampel. Buffer5% bukan slippage cap atau jaminan nilai kredit minimum; lookback pendek bukan bukti oracle kebal manipulasi. Selesai jika pool aktual lolos pemeriksaan dan batas/risk rate diputuskan. Sumber: [TOKEN rate](D:/BARONG/the-curb/docs/decisions/TOKEN.md:27), [LAUNCH](D:/BARONG/the-curb/docs/decisions/LAUNCH.md:37).

**R24 — Jalankan pembayaran lengkap lewat wallet, HTTP dan webhook.** Status: acceptance mock lokal lulus; alur nyata belum dibuktikan.

Mulai dari staging terisolasi: key baru, quote, top-up, confirmation, credit, request berbayar melalui server HTTP, debit/receipt, webhook endpoint milik penguji dan saldo habis. Uji response hilang, retry, reorg, outage, rate hilang dan double-charge. Setelah syarat layanan dan otorisasi transaksi terpenuhi, buktikan first small public top-up menggunakan wallet sesungguhnya. Selesai jika chain receipt, ledger dan respons pelanggan cocok; UNKNOWN tetap direkonsiliasi, tidak dianggap pasti gratis. Source saat ini sudah memiliki admission/settlement dan perlindungan concurrency; tugas ini menambah bukti integrasi, bukan menulis billing dari nol. Sumber: [acceptance dan batas](D:/BARONG/the-curb/docs/reviews/FIRST-RELEASE-2026-09-13.md:29), [LAUNCH](D:/BARONG/the-curb/docs/decisions/LAUNCH.md:36).

**Pekerjaan operasi dan pembukaan pengguna**

**R25 — Lengkapi monitoring, log dan konfigurasi platform.** Status: GitHub tick/watch serta alert dasar ada; kebutuhan operasional tambahan dicatat terbuka.

DEPLOY menyebut durable log untuk error page/API, monitor di platform selain GitHub, database CA/certificate verification, konfirmasi plan hosting komersial sesuai keputusan proyek, serta pencatatan quota/tier/biaya. Selesai jika scheduler dapat terdeteksi mati oleh sistem yang tidak mati bersamanya, error tersimpan, koneksi DB tervalidasi, budget/runtime sesuai beban dan kondisi ini dibuktikan. Status akun dan terms vendor terkini perlu dicek pada pelaksanaan; audit lokal tidak mengetahui plan aktif. Sumber: [DEPLOY plan](D:/BARONG/the-curb/DEPLOY.md:85), [sisa operasi](D:/BARONG/the-curb/DEPLOY.md:592).

**R26 — Tetapkan operator/on-call, backup rutin dan incident response.** Status: tools dan catatan rehearsal historis ada; policy final/pelaksanaan rutin belum lengkap.

Tetapkan penerima alert, jam/tenggat respons, eskalasi, ketersediaan quorum, rotasi, pemilik backup dan bukti backup off-provider berkala. Jalankan restore serta drill oleh operator sebenarnya untuk scope rilis yang dipilih, termasuk stop/resume, backend mati, rate unread dan backlog. Untuk CreditDesk immutable tanpa pause, menghentikan UI/undangan pembayaran tidak menghentikan transfer langsung; runbook harus menjelaskan respons yang memang bisa dilakukan. Selesai jika ada pemilik, catatan pelaksanaan dan hasil recovery yang dapat direview. Sumber: [OPERATIONS](D:/BARONG/the-curb/docs/decisions/OPERATIONS.md), [RUNBOOK](D:/BARONG/the-curb/docs/decisions/RUNBOOK.md), [backup](D:/BARONG/the-curb/DEPLOY.md:69).

**R27 — Jalankan paid beta dengan ukuran dan ukuran keberhasilan yang diputuskan.** Status: belum dibuktikan sebagai layanan publik berbayar dalam record ini.

Sesudah R02/R03/R16–R26 yang relevan selesai, buka kepada sejumlah kecil pengguna yang bersedia dengan budget/capacity yang jelas. Catat activation, sukses top-up, repeat usage, retensi, delivery success, latency, billing disputes serta biaya pelayanan. Tetapkan ambang lanjut/hold sebelum melihat hasil. Selesai jika ada outcome pengguna nyata dan keputusan berbasis data; traffic, holder token atau pujian narasi tidak menggantikan pemakaian jasa.

**R28 — Ambil keputusan gate dan jalankan pilot posisi bila lolos.** Status: enam gate belum lulus; deployment publik belum disetujui dalam bukti lokal.

Setelah hak/access, acquisition, komponen, contract review, operator, lot/cap, ekonomi dan demand cukup dibuktikan, pemilik gate merekam keputusan. Jika lanjut: reviewed deployment record, deploy/source verification, peserta berizin, round trip kecil yang diizinkan, claim mandiri saat backend tidak tersedia dan incident drill dengan operator sebenarnya. Jika syarat belum terpenuhi, hold atau ubah kandidat/desain dengan alasan tercatat. Selesai bukan sekadar kontrak berhasil dideploy. Sumber: [gate](D:/BARONG/the-curb/lib/positions/series.ts:182), [DEPLOYMENT](D:/BARONG/the-curb/docs/decisions/DEPLOYMENT.md:7).

**Urutan pengerjaan yang disarankan**

1. Paket lokal berikutnya: R01–R03; persiapkan keputusan R04 dan checker R05; lengkapi bukti R07 lalu siapkan release R08. UX R06 mengikuti temuan penggunaan dan kebutuhan pilot.
2. Secara paralel, mulai validasi kebutuhan R09/R10, review akses R11, acquisition/instrument R12/R13, serta keputusan launchpad/funding R17/R18. Ini mencegah konfigurasi produksi dibuat dari asumsi.
3. Finalisasi lot/akses R14/R15, scope dan hasil review R16, terms/ekonomi/pencatatan R19–R21, serta operasi R25/R26.
4. Setelah prasyarat dan otorisasi masing-masing terpenuhi, jalankan konfigurasi dan pembayaran nyata R22–R24; evaluasi paid beta R27.
5. Pilot posisi R28 mengikuti gate posisi. Launch token atau paid beta tidak otomatis meluluskan gate tersebut; posisi sendiri tidak membutuhkan CURB untuk mint, hold atau claim.

Urutan ini usulan pekerjaan, bukan jadwal pasti atau perubahan sepihak atas keputusan TOKEN. Beberapa keputusan membutuhkan orang yang berwenang dan bukti eksternal; agent dapat menyiapkan materi, tetapi tidak boleh membuat jawaban issuer, hasil wawancara, laporan independen atau persetujuan gate fiktif.

**Di luar scope MVP saat ini**

Deposit USDC satu klik/router, cash redemption, rebalancing otomatis, leverage/lending, insurance, bridges, banyak saham sekaligus, permissionless factory, transfer/trading receipt atau stuck claim, reward token, staking/buyback/fee sharing, recovery lost-key, partial claims dan alternate recipient tidak otomatis menjadi backlog wajib. Sebagian sengaja ditunda dan sebagian tidak dijanjikan oleh desain. Membangunnya memerlukan pilihan produk baru. Sumber: [batas mekanisme](D:/BARONG/the-curb/MECHANISM.md:273), [claims](D:/BARONG/the-curb/MECHANISM.md:160), [fungsi token](D:/BARONG/the-curb/docs/decisions/TOKEN.md:48).

**Pemetaan roadmap sebelumnya**

N01/N04: sebagian selesai, residual R01–R03/R06. N02/N03: fondasi paket pertama selesai; enhancement wallet R06 terpisah. N05: R09/R10. N06: R18/R19. N07: R20/R21. N08: lokal sebagian besar selesai, bukti integrasi R07/R24. N09: R17/R18/R22/R23. N10: R08/R16/R25–R27. N11: R12/R13. N12: R11/R15. N13: R04/R05/R14/R15. N14: R07/R16/R28. Sumber: [roadmap sebelum implementasi](C:/Users/Hi/Documents/ChatGPT/PPK/output/curb-local-reading-2026-09-13/NEXT-STEPS-2026-09-13.md).
