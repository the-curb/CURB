# The Curb — tindak lanjut persiapan mainnet, 15 September 2026

**Paket implementasi lokal selesai: 610 tes aplikasi lulus tanpa skip, 31 pemeriksaan HTTP/ledger/webhook lulus, dan build produksi berhasil. Token launch, paid beta dan position pilot tetap menunggu bukti eksternal.** Pekerjaan berada di `D:/BARONG/the-curb`, branch `codex/curb-first-release-hardening`. Tidak ada push, deployment publik, transaksi public-chain, pembelian layanan atau pengiriman pesan ke pihak luar.

Laporan ini melanjutkan [persiapan 13 September](MAINNET-PREPARATION-2026-09-13.md). Keputusan teknis rutin menggunakan mandat pemilik untuk memilih yang masuk akal; tidak ada identitas reviewer, pendanaan, hak issuer atau persetujuan release yang diisi secara fiktif. [Keputusan pelaksanaan](../mainnet/EXECUTION-DECISIONS-2026-09-15.md) menetapkan urutan pekerjaan dan input yang masih diperlukan.

## Perubahan implementasi

- **CreditDesk:** deployment mengompilasi ulang source, memeriksa creation/runtime bytecode dan provenance source, serta memverifikasi treasury Safe lengkap pada public chain. Journal menyimpan intent, nonce dan alamat sebelum broadcast; deployment ganda ditolak. Backend menolak provenance public build yang kotor atau tidak menunjuk commit. Source Solidity tidak berubah; record build kini menyertakan creation bytecode yang dibutuhkan pemeriksaan.
- **Safe:** ekspektasi wajib mencakup versi, owners/quorum, proxy/singleton, daftar lengkap modules, guard dan fallback handler beserta runtime hash. Pembacaan dipin pada satu block; pagination yang tidak lengkap, cycle dan duplikat ditolak. Ini memeriksa konfigurasi terhadap ekspektasi, bukan membuktikan custody signer atau keamanan internal extension.
- **Receipt transaksi deployment:** shared journal menolak receipt dengan hash berbeda/hilang. Viem dapat mengikuti transaksi pengganti; alamat CREATE saja belum membuktikan bytecode deployment yang dimaksud. Status `SENT` dipertahankan untuk rekonsiliasi jika hasilnya tidak pasti. Perbaikan berlaku pada CompanySeries dan CreditDesk.
- **Anggaran:** kalkulator integer tanpa pembulatan floating point mengalokasikan dana treasury bebas yang benar-benar tersedia: US$40.000 pertama untuk review, US$15.000 berikutnya untuk legal, lalu sisa 40/20/20/20. Default dana tersedia nol; biaya belum diukur tetap `null`. Biaya mencakup semua percobaan, pendapatan hanya layanan yang benar-benar tercatat ditagih. Webhook sukses tetapi gagal ditagih tidak dihitung sebagai pendapatan.
- **Rehearsal satu perintah:** membuat salinan source tanpa env produksi, chain lokal, database PostgreSQL acak dan server Next dalam mode produksi. Menjalankan seluruh suite dengan empat fixture, CLI deployment nyata lokal, dan penerimaan HTTP/webhook. Journal deployment historis tidak disalin ke node baru. Fixture harga dibuat setelah drill yang menambang banyak block agar jendela observasi 40 block tetap sah.
- **CI dan paket review:** job penerimaan lokal ditambahkan ke aggregate lima job. Legacy rehearsal juga menyegarkan fixture harga sebelum read-back. Tool archive mengekspor commit bersih dengan SHA-256; source, tes, evidence dan contoh env termasuk, sedangkan Git history, ignored secrets, database serta dependencies tidak termasuk. GitHub Actions baru ini belum dijalankan di remote.

## Temuan PONS dan keputusan produk

[Penelitian sumber publik bertanggal](../mainnet/EXTERNAL-FACTS-2026-09-15.md) mengidentifikasi PONS di `ponsfamily.com` sebagai kecocokan terkuat. Dokumentasi v2 menjelaskan bonding curve yang bermigrasi ke Uniswap v4; pembaca harga The Curb saat ini mendukung v2/v3, sehingga integrasi v2 PONS belum kompatibel. Tidak ada adapter v4 atau pool nyata yang direpresentasikan sudah diverifikasi. Lihat [dokumentasi resmi PONS v2](https://docs.ponsfamily.com/v2).

Reserve bonding curve/LP terkunci, volume dan market cap dikeluarkan dari anggaran operasional. Creator fee yang benar-benar tersedia harus dibuktikan tersendiri. Tidak ada janji fee share, buyback, pendanaan baru atau perubahan harga layanan yang ditambahkan. Research desk dipertahankan; aktivasi pembayaran membutuhkan market harga yang benar-benar didukung dan direview. PONS v1/v3 hanya kandidat sampai token, pool dan hak terkait diperiksa.

## Hasil validasi terbaru

Semua pembayaran dan deployment di bawah berlangsung pada chain lokal dengan aset mock. Angka antarkategori saling mencakup; jangan dijumlahkan sebagai jumlah tes unik.

| Pemeriksaan | Hasil | Bukti / batas |
| --- | --- | --- |
| Seluruh suite aplikasi, empat fixture dan Postgres | **610 lulus, 0 gagal, 0 skip** | [TAP final](mainnet-followup-2026-09-15/app-tests-final.txt) |
| Build aplikasi produksi dari salinan tanpa env | **Lulus** | [Log build](mainnet-followup-2026-09-15/production-build-final.txt) |
| HTTP, index, ledger dan webhook | **31/31 lulus** | [Laporan executable](mainnet-evidence/reproducible-local-2026-09-15.json); top-up 2.500 sen, HTTP 15 sen, webhook sukses 20 sen, saldo akhir 2.465 sen |
| CLI CreditDesk | **Record, dry-run, deploy dan duplicate refusal lulus** | Laporan executable yang sama; signer acak lokal, nonce tidak berubah pada penolakan duplikat |
| Safe dan CompanySeries integration | **16/16 lulus** | [Record](mainnet-evidence/operator-safe-2026-09-15.json); real Safe code di node lokal, quorum acceptance, modules/guard/fallback dan tool deployment |
| Unit Safe / kalkulator anggaran | **10 / 7 lulus**, termasuk dalam 610 | [Tes Safe](mainnet-evidence/operator-safe-tests-2026-09-15.txt), [TAP final](mainnet-followup-2026-09-15/app-tests-final.txt) |
| Cleanup normal | **Proses runner berhenti; database sementara terhapus** | Laporan executable |
| Cleanup saat kegagalan | **Penolakan yang disengaja, database terhapus** | [Failure drill](mainnet-evidence/rehearsal-cleanup-failure-2026-09-15.json), exit 1 dan state `FAILED` memang diharapkan; kegagalan disuntikkan sebelum child services berjalan |

Webhooks memakai fungsi produksi `fanOut`/`deliver` dengan transport khusus CLI ke receiver HTTP loopback. API produksi tetap menolak URL loopback. DNS/TLS publik dan extension wallet tidak diuji. Salinan yang diuji mencatat hash snapshot dan `workingTreeClean: false` secara jujur karena perubahan belum di-commit saat tes berjalan; itu bukan public release approval. Final source pin dan pemeriksaan build/preflight dicatat setelah commit.

[Log suite awal](mainnet-followup-2026-09-15/app-tests.txt) mencatat 595 lulus dari 600 dengan lima fixture belum tersedia; hasil final 610/610 di atas menggantikannya untuk paket ini. Kegagalan sementara dari journal historis dan usia fixture harga diperbaiki pada isolasi/urutan runner, tanpa melonggarkan penolakan deployment atau assertion harga.

Hasil **54 Solidity, 14 fork Ethereum dan 13 browser** pada 13 September tetap bukti historis untuk cakupan/source pada tanggal itu, bukan tes yang diklaim dijalankan ulang hari ini. Tidak ada perubahan Solidity dalam paket 15 September. Upstream automation `d1f353b` menggunakan contract source lama dengan 44 unit tests; salinannya dipertahankan di [history](../../contracts/evidence/history/upstream-d1f353b-2026-09-15.md), tanpa mengganti canonical evidence yang cocok dengan source sekarang.

## Kondisi publik dan input yang masih diperlukan

[Probe GET publik](mainnet-followup-2026-09-15/public-operations.json) membaca research desk `HEALTHY` pada waktu pemeriksaan, credits `NOT_CONFIGURED`, dan posisi `DESIGN`/`NOT_DEPLOYED`. Satu probe kesehatan tidak membuktikan service-level uptime atau kesiapan paid beta.

Akun Vercel yang terhubung hanya dapat melihat team berbeda dari `.vercel/project.json`; target project mengembalikan **403**. Paket/plan team yang bisa diakses tidak membuktikan plan The Curb. Pengaturan produksi, secrets, proteksi dan identitas deployment belum dapat diverifikasi. Permintaan koneksi ke team pemilik sudah disampaikan; tidak dibuat project pengganti.

Input berikut tetap diperlukan: akses team hosting yang benar; pendanaan review yang benar-benar tersedia; review independen sesuai scope; token/pool/parameter launchpad yang pasti; treasury/operator dan custody nyata; eligibility/hak issuer dan peserta untuk position pilot; serta bukti operasi dan keputusan release yang relevan. Dossier berisi brief, formulir dan pertanyaan konkret. Review antarpelaksana pada paket ini adalah **review internal**, bukan audit independen G4.

## Source pin dan distribusi

Implementasi dipin pada **`9c80ba7105de97d6dfae3ccaf7bbc2d5f063ce9f`**. Merge lokal **`490a8c76549b9353cad342a8eef5366137d7e656`** menyertakan sejarah upstream terbaru sambil mempertahankan canonical evidence yang cocok dengan source sekarang; isi tree identik dengan commit implementasi, dan kedua file upstream tersedia di history. Identitas Git `Codex (local preparation) <codex@localhost>` hanya diterapkan per command, tanpa mengubah profil global.

[Pemeriksaan source dan build](mainnet-followup-2026-09-15/source-and-build-check.json) membandingkan **266 file** aplikasi, contract, operator tooling, tes dan build/config terhadap snapshot yang lulus: semuanya identik setelah normalisasi LF. Kedua pemeriksaan fresh build record **lulus**. CompanySeries tetap source commit `64870f116a02fa44fda1dfc4a67dcb9ac4aa15bf`; CreditDesk tetap source commit asalnya, bukan dilabeli ulang mengikuti commit tooling. Workflow legacy mendapat penyegaran fixture harga setelah snapshot dan direview tersendiri; workflow remote belum dieksekusi.

[Preflight](mainnet-followup-2026-09-15/preflight.json) berjalan pada commit merge dengan **working tree bersih**, exit **2** yang diharapkan, dan seluruh fase **HELD**. [Release validation](mainnet-followup-2026-09-15/release-validation.json) mengikat delapan file evidence beserta SHA-256 LF pada digest source/config/runtime-evidence **`9352940fe055ee76cf0753b6a19a8a70b4c233f8ec5e46abfb989840aad0a6fc`**. Commit laporan/evidence setelahnya tidak mengubah digest tersebut. Requirement contoh tetap pending; evidence lokal tidak otomatis menjadi signoff.

Archive review dibuat dari final commit bersih dengan `npm run review:package`; manifest di samping archive mencatat commit dan SHA-256 byte file sebenarnya. Archive tanpa Git history membutuhkan checkout repository lengkap untuk mengulang pemeriksaan provenance berbasis `git log`. Proses Next/Hardhat milik runner dan server PostgreSQL lokal yang dinyalakan untuk pekerjaan ini telah dihentikan. Tidak ada proses produksi yang dihentikan.
