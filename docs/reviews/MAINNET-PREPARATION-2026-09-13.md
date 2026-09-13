# The Curb — laporan persiapan mainnet, 13 September 2026

**Status: persiapan lokal teruji dan source dipin pada commit `64870f116a02fa44fda1dfc4a67dcb9ac4aa15bf`; clean CompanySeries build record telah dibuat dan kedua contract build check lulus. Semua fase eksternal tetap HELD.** Pekerjaan dilakukan di `D:/BARONG/the-curb`, branch `codex/curb-first-release-hardening`, dari commit dasar `8f093ff9de64c8da7003ad2d2762c6b5967db573` beserta perubahan paket pertama yang sudah ada. Source commit sudah tercatat lokal; pencatatan akhir evidence/preflight dilanjutkan sesudahnya. Tidak ada push, deployment aplikasi publik, transaksi mainnet, pengiriman pesan ke pihak luar atau pemeriksaan database/env produksi dalam paket ini.

Laporan ini melanjutkan [paket pertama](FIRST-RELEASE-2026-09-13.md) dan [audit 28 pekerjaan tersisa](REMAINING-WORK-2026-09-13.md). Hasil historis keduanya tetap berlaku untuk cakupan dan waktunya; laporan ini tidak mengganti angka atau menulis ulang apa yang dahulu sudah/belum diuji. [Dossier mainnet](../mainnet/PREPARATION.md) berisi bahan keputusan, pertanyaan issuer, brief reviewer, scorecard wawancara, perhitungan ekonomi dan formulir operasi yang sekarang siap digunakan.

## Perubahan yang sudah disiapkan

### Pembayaran, data yang belum terbaca dan wallet

- Receipt dan pending top-up membedakan **nol yang benar-benar terbaca** dari index/store yang belum terbaca. Kegagalan parsial tidak lagi disederhanakan menjadi tidak ada pembayaran pending; pembacaan saldo yang tersedia dapat dijelaskan terpisah.
- Petunjuk top-up pada gate layanan dan pembuatan key memakai kesiapan pembayaran yang terikat pada code/config/rate terkini. Quote, undangan pembayaran dan status tidak diluluskan hanya karena suatu alamat sudah dikonfigurasi. Pemakaian credits lama memiliki syarat sendiri.
- Pengujian HTTP dengan kontrak dan Postgres lokal menemukan perbedaan representasi immutable address dengan prefiks `0x`; pembandingan dinormalisasi dan regresinya ditambahkan. Ini mencegah deployment lokal yang benar ditahan karena format representasi expected value, tanpa melonggarkan pemeriksaan alamat sebenarnya.
- Review transaksi wallet menampilkan jumlah komponen dalam unit yang tepat, allowance dan informasi estimasi gas atau alasan ketidaktersediaannya. Claim A/B tetap mandiri dan tidak membutuhkan receipt tersisa maupun alokasi ulang.
- Rekonsiliasi transaksi pengganti memakai hash yang diberikan pengguna dan pemeriksaan sender/nonce; transaksi berbeda tidak diterima sebagai pengganti. Account/chain diperiksa kembali, receipt harus terkait hash yang dimaksud dan chain yang benar, serta reconnect mereset state pemeriksaan yang perlu dibaca ulang. Status belum pasti tidak menjadi alasan mengirim ulang secara buta.
- Pemeriksaan browser menemukan alamat panjang yang menyebabkan overflow pada mobile Services; wrapping diperbaiki dan favicon menggunakan brandmark yang sudah ada sehingga request-nya tidak lagi 404. Rerun browser selesai dengan 13 pemeriksaan lulus dan tanpa page/console error.

### Contract, operator dan deployment

- `transferOperator(next)` kini **menominasikan**; operator saat ini tetap berwenang. Hanya nominee yang dapat menjalankan `acceptOperator()`. Operator saat ini dapat mengganti atau membatalkan nominasi melalui `cancelOperatorTransfer()`.
- Public deployment CompanySeries membutuhkan ekspektasi Safe yang direview: target chain, owner set, threshold, runtime proxy serta alamat/hash runtime singleton. Pembaca membandingkan fakta tersebut pada satu block. Safe Robinhood tidak diperlakukan sebagai bukti operator Ethereum. Modules, guard, fallback configuration dan kontrol nyata signer masih memerlukan review tersendiri.
- Tool deployment mengompilasi source yang sedang dipakai sebelum mempercayai artifact, membandingkan creation/runtime bytecode, mengecek commit source/compiler aktual, dan menolak source/build/tooling yang belum menjadi release bersih untuk public deployment.
- Journal deployment ditulis **sebelum broadcast** dengan state `SENDING`, deployer/nonce/alamat yang diharapkan; hash disimpan sebagai `SENT` sebelum menunggu receipt. Jika broadcast/receipt tidak pasti, file tetap ada dan pengiriman berikutnya ditolak sampai operator merekonsiliasi hasilnya. Tidak ada automatic retry yang membuat kontrak kedua.
- Pemeriksaan public CompanySeries tidak menganggap build rehearsal dengan dirty source atau tanpa source commit sebagai build produksi; statusnya `NO_BUILD`. Chain lokal dapat menggunakan build rehearsal dengan keterangan dan provenance lokal yang eksplisit.

Dua gap terakhir—journal sebelum receipt dan hubungan source commit dengan artifact—ditemukan saat pemeriksaan kedua terhadap tool, lalu diperbaiki dan diuji lokal. Ini merupakan review internal antarpelaksana, **bukan independent audit** yang dibutuhkan gate G4.

### Konsekuensi release untuk CompanySeries dan index

CompanySeries berubah bytecode dan ABI/event karena operator transfer dua langkah. Ia immutable: deployment dari source lama tidak dapat di-upgrade menjadi perilaku ini. Public deployment berikutnya harus memakai build baru yang telah dipin, direview dan direkam, dengan record konfigurasi serta source verification yang cocok. Jangan mengganti label build suatu alamat lama seolah kontraknya berubah. CreditDesk production source/compiler tidak diubah hanya untuk mengikuti perubahan CompanySeries.

Index posisi sekarang **version 3**, mencakup `OperatorTransferProposed` dan `OperatorTransferCancelled` beserta acceptance melalui `OperatorChanged`. Snapshot versi lama di-replay dari block awal deployment sehingga event yang sebelumnya dilewati dapat masuk; pergantian chain/alamat menggunakan index baru. Pada rollout, siapkan waktu/RPC untuk catch-up dan verifikasi hasil replay/reconciliation. Replay off-chain ini tidak mengubah receipts, permits atau claim di chain. Jangan menyatakan data sudah mutakhir sebelum sync selesai.

Record sebelumnya dipertahankan di `contracts/evidence/history/`, termasuk build, unit tests, drill dan fork sebelum operator dua langkah. [Ringkasan contract sebelum source pin](../../contracts/evidence/mainnet-prep-contracts-verification.json) mencatat fingerprint, lingkungan dan batas hasil lokal pada waktu itu; field dirty/null di dalamnya merupakan sejarah rehearsal. [Clean build record check](mainnet-evidence/clean-build-record.json) kemudian membuktikan CompanySeries direkam dari commit `64870f116a02fa44fda1dfc4a67dcb9ac4aa15bf`, `workingTreeClean: true`, runtime **6.693 bytes**, dan check CompanySeries/CreditDesk lulus. Record CreditDesk tetap menunjuk source asalnya yang tidak berubah.

### Klaim produk, dokumen dan kesiapan operasi

- RUNBOOK diselaraskan dengan quorum operator dan status debit `UNKNOWN`; cakupan drill historis dibedakan dari prosedur yang belum direhearsal di production.
- Tally kini menjelaskan sampel transfer dan distinct addresses, tanpa mengklaim pengukuran konsentrasi holder atau depth.
- COSTS memakai fork terbaru: mint **170.806**, allocate **90.740**, claim A **62.081**, claim B **65.102**, subtotal **388.729 execution gas**. Transfer langsung A/B berjumlah **110.460 execution gas**. Approvals, base transaction, calldata, cold access dan acquisition/exit costs belum termasuk; angka itu bukan harga full round trip.
- ADR/assumption register membedakan inventory wrapper historis dari kapasitas issuance yang masih perlu dibuktikan. Alamat B dan decimals yang sudah dibaca tidak lagi disebut belum diketahui; Mock A/B tetap ilustratif.
- Urutan token/desk/pool/top-up dijadikan executable dan konsisten. Quote buffer 5% tetap bukan slippage cap atau minimum credit guarantee. Review sebelum launch tetap membutuhkan sumber pendanaan yang benar-benar tersedia.
- `mainnet:preflight` memeriksa **15 requirement records** dengan source digest, attribution/date, evidence path/hash dan status fase. Record contoh tetap PENDING; missing evidence, source berbeda, gate posisi belum passed atau release belum bersih membuat hasil HELD. `RECORDS_COMPLETE_REQUIRES_VERIFICATION` pun bukan otorisasi transaksi atau bukti reviewer independen.
- Health probe yang dapat dijalankan operator tersedia dan diuji. Tool ini belum berarti monitor di luar GitHub sudah dipasang atau on-call sudah menerima alert production. Dossier menyediakan owner, target response/recovery, backup dan drill fields yang belum diisi dengan orang/hasil fiktif.
- Dependency helper deployment diperbaiki agar typecheck aplikasi dari instalasi dependencies root saja tidak bergantung diam-diam pada `contracts/node_modules` atau root `viem`. Workflow checks/fork-evidence mengambil full git history sehingga pencarian commit source/compiler tidak rusak pada shallow checkout. Typecheck terisolasi, strict deployment-script typecheck dan 11 focused checks lulus lokal; workflow GitHub sendiri belum dijalankan di remote.

## Bukti validasi

Angka antarkategori dapat mencakup pengujian yang saling terkait; jangan menjumlahkannya sebagai satu jumlah test unik. Semua pembayaran dan deployment yang diuji menggunakan chain lokal atau fork. Database conformance dan HTTP memakai Postgres terisolasi, bukan database pelanggan.

| Pemeriksaan | Hasil yang tercatat | Evidence dan batas |
| --- | --- | --- |
| Full application suite | **584 lulus / 0 gagal / 0 skip** | [app-tests.txt](mainnet-evidence/app-tests.txt); mencakup 45 pemeriksaan Postgres pada database terisolasi |
| Postgres conformance | **45 lulus** | [postgres-conformance.txt](mainnet-evidence/postgres-conformance.txt); PostgreSQL 16.15 lokal |
| Solidity lokal | **54 lulus / 0 gagal** | [mainnet-prep-solidity-local.txt](../../contracts/evidence/mainnet-prep-solidity-local.txt) |
| Fork Ethereum | **14 lulus** | [raw output](../../contracts/evidence/mainnet-prep-apple-components-fork.txt): 13 component tests pada block **25.967.875** dan satu dividend test pada block **25.706.679/25.706.680** |
| Safe/deployment integration lokal | **8 pemeriksaan lulus; diulang sesudah source pin** | [operator-release-local.json](mainnet-evidence/operator-release-local.json); Safe runtime lokal, quorum acceptance, konfigurasi salah ditolak, deployment CLI lokal dan duplicate-run refusal terhadap clean build record. [Rehearsal awal](../../contracts/evidence/mainnet-prep-series-preflight-local.json) tetap disimpan |
| Incident drill posisi | **26 langkah, 0 unexpected; 1 site test lulus** | [chain record](../../contracts/evidence/mainnet-prep-drill-chain-local.json), [site output](../../contracts/evidence/mainnet-prep-drill-site-local.txt) |
| Positions rehearsal | **1 site test lulus** | [rehearsal record](../../contracts/evidence/mainnet-prep-positions-rehearsal-local.json), [site output](../../contracts/evidence/mainnet-prep-positions-rehearsal-site-local.txt) |
| Contract/tool/backend checks terfokus | **44 lulus** | [tool tests](../../contracts/evidence/mainnet-prep-contract-tools-tests.txt); mencakup interrupted journal, stale source pin dan penolakan public dirty build |
| Backend/operator/provenance sesudah source pin | **42 lulus / 0 gagal / 0 skip** | [pinned-source-tests.txt](mainnet-evidence/pinned-source-tests.txt); tambahan pemeriksaan terhadap source/build yang sudah dipin |
| CI dependency/history preparation | **Root-only typecheck dan strict script typecheck lulus; 11 focused checks lulus** | [ci-verification.json](../../contracts/evidence/mainnet-prep-ci-verification.json); copy terisolasi tanpa contract dependencies atau env files, checkout history dicek lokal. GitHub Actions tidak didispatch |
| HTTP acceptance pada production Next server lokal | **14 pemeriksaan lulus** | [http-acceptance.json](mainnet-evidence/http-acceptance.json); top-up mock lokal, auth/validation refusal tanpa debit, pembayaran endpoint 5 cent, concurrent debit tepat, privacy receipt, readiness/quote |
| Backup/restore lokal | **Lulus; dua restore idempotent** | [backup-restore.json](mainnet-evidence/backup-restore.json), [output](mainnet-evidence/backup-restore.txt): 2 observations dan 8 snapshots; payload/version/write token cocok, snapshot differences 0 |
| Production build dan TypeScript | **Lulus** | [build.txt](mainnet-evidence/build.txt); keberhasilan build lokal tidak membuktikan konfigurasi production |
| Clean contract build records | **CompanySeries dan CreditDesk lulus** | [clean-build-record.json](mainnet-evidence/clean-build-record.json); fresh compile, creation/runtime/provenance checks; CompanySeries source pin `64870f116a…` |
| Browser | **13 pemeriksaan lulus / 0 page atau console error** | [browser.json](mainnet-evidence/browser.json); tiga route desktop dan mobile 390 px, wallet units/allowance/receipt outcome, reconnect, quote expiry dan saldo terbaca saat pending UNREAD |

HTTP acceptance memakai production-mode Next di loopback, PostgreSQL 16.15 loopback dan Hardhat chain 31337. Ia membuktikan interaksi HTTP nyata dengan ledger lokal, bukan pembayaran CURB publik. Hasil tersebut belum membuktikan alur lengkap extension wallet nyata, pool publik dan delivery webhook ke integrator eksternal. Browser memakai EIP-1193 test adapter, RPC read-only lokal dan fixture untuk quote-expiry/pending tertentu; tidak memakai extension wallet asli atau mengirim transaksi publik.

Fork dividend yang diulang membuktikan observasi pada event historis tersebut. **Stock split/reverse split, semua corporate actions berikutnya, eligibility, acquisition/current-wrapper issuance dan issuer reserves tetap belum terbukti.** Storage-staged balances tidak menjadi bukti token tersebut dapat dibeli atau diterbitkan oleh peserta pilot.

Backup kecil ini menguji data dan idempotency restore release lokal. Ia tidak menggantikan backup production, volume/capacity test, penyimpanan off-provider rutin atau RTO/RPO yang belum disepakati.

## Status terhadap 28 pekerjaan pada audit sebelumnya

“Disiapkan” berarti source, template atau prosedur siap direview/dijalankan dalam scope tersebut. Ia tidak berarti hasil eksternal atau keputusan produksi sudah diperoleh.

| Audit | Status setelah paket ini | Yang masih dibutuhkan |
| --- | --- | --- |
| R01 — konsistensi dokumen/klaim | Koreksi lokal disiapkan; gas tersinkron dengan fork baru | Review final release dan pembuktian policy yang masih proposed |
| R02 — UNREAD receipt/pending | Perbaikan source dan regresi lokal selesai | Verifikasi setelah rollout pada konfigurasi yang dipilih |
| R03 — kesiapan semua petunjuk top-up | Helper/endpoint diselaraskan dan diuji | Token/desk/pool publik serta evidence readiness aktual |
| R04 — operator dua langkah | Implementasi dan tests lokal selesai | Independent review dan penerimaan sebagai release/policy pilot |
| R05 — operator deployment checker | Safe/preflight/journal/provenance diperkuat; source dipin, clean build direkam dan 8 integration checks diulang | Reviewed Ethereum operator record dan public deployment signoff |
| R06 — review wallet/replacement | Implementasi, regresi dan 13 pemeriksaan browser lokal lulus | Rehearsal peserta dengan extension wallet nyata |
| R07 — fixture/testing final | Suite 584 tanpa skip, PG, rehearsal/drill, HTTP, restore dan browser lokal lulus; 42 post-pin checks dan 8 Safe integration checks lulus | Bukti production/staging aktual sesuai scope rilis dan retest bila source kembali berubah |
| R08 — release yang dapat dilacak | Source commit dipin, clean CompanySeries build direkam, production build dan offline gate tersedia | Pencatatan akhir evidence/preflight; remote CI, push dan deployment belum dijalankan |
| R09 — wawancara pengguna posisi | Guide dan scorecard siap | Respons asli 10–15 peserta dan keputusan berdasarkan hasil |
| R10 — validasi integrator layanan | Task-based scorecard dan target rekrutmen usulan siap | Integrasi/usage/pay-interest nyata; tidak disimpulkan dari token holder |
| R11 — rights/eligibility issuer | Brief struktur dan questionnaire per issuer siap | Jawaban tertulis/review yang relevan; G2 belum lulus |
| R12 — acquisition/issuance | Worksheet dan batas fork jelas | Akses/jalur/kapasitas aktual pada ukuran pilot |
| R13 — instrument/corporate actions | Fork component/dividend diulang; dependency questions disiapkan | Split dan scope component/source/rights yang belum dijawab |
| R14 — lot/cap/full costs | Data gas baru dan worksheet complete-cost siap | qA/qB/cap yang direview dari acquisition, rights, biaya dan demand |
| R15 — policy/access/operator | Dua langkah dan prosedur diselaraskan; decision fields tersedia | Finalisasi ADR/policy, Ethereum Safe, private access process dan owner |
| R16 — independent review | Brief dan finding register siap; temuan internal ditangani lokal | Reviewer independen bernama, laporan scope/commit tertentu, retest temuan material |
| R17 — launchpad | Worksheet terms/token/pool siap | Identitas dan mekanisme PONS/platform yang benar-benar diverifikasi |
| R18 — funding/proceeds | Formula residual dan skenario seimbang disiapkan sebagai **PROPOSED** | Product-owner decision dan dana prereview yang nyata |
| R19 — terms token/credits | Harga/fungsi dipertahankan; isu review dinyatakan | Review terms untuk distribusi, closure, notice, lost key dan deficits |
| R20 — unit economics | Worksheet volume/cost/stress dan credit obligations siap | Biaya vendor aktual, reserve/runway dan kapasitas beta yang diputuskan |
| R21 — akuntabilitas treasury | Schema ledger/approval/budget-versus-actual disiapkan | Pencatatan proceeds/pengeluaran aktual dengan owner/cadence |
| R22 — token/CreditDesk publik | Tool dan urutan operasi siap direview | Prasyarat, record, transaksi yang diotorisasi dan source verification publik |
| R23 — pool/rate publik | Kriteria dan readiness checks tersedia | Pool, quote/liquidity assumptions dan rate aktual yang direview |
| R24 — wallet/HTTP/webhook | HTTP/Postgres/top-up mock lokal terbukti | Extension wallet/pool publik dan webhook eksternal end-to-end sesuai otorisasi |
| R25 — monitoring/platform | Probe dan tests tersedia; konfigurasi checklist siap | Monitor independen benar-benar dipasang, log/TLS/platform/budget aktual |
| R26 — on-call/backup/drill | Local restore/drill terbukti; owner/signoff templates siap | Orang yang ditugaskan, routine production backup, alert receipt dan recovery targets |
| R27 — paid beta | Scoreboard dan phase gate disiapkan | Cohort, budget, operasi, terms dan outcomes pengguna nyata |
| R28 — pilot posisi | G1–G6 decision fields dan release gate tersedia | Bukti serta keputusan masing-masing gate; pilot tetap HELD |

## Hal yang masih menahan mainnet

[Readiness template](../mainnet/readiness.example.json) tetap berisi 15 record PENDING. Tidak ada nama reviewer, issuer response, dana, approval, harga/vendor plan atau tokenomics yang dibuat untuk mengisi kekosongan. G1/G3/G4/G5/G6 pada source tetap IN_RESEARCH; G2 NOT_STARTED. Token launch, paid beta dan position pilot belum diluluskan oleh pemeriksaan lokal ini.

Keputusan eksternal berikut masih diperlukan: platform/terms launchpad yang benar, dana review sebelum launch, interpretasi proceeds yang disetujui, review independen dan terms, eligibility/acquisition issuer, konfigurasi lot/cap, Safe Ethereum, on-call/monitor/backup production, ekonomi layanan dan hasil pengguna. Dossier membuat kebutuhan tersebut konkret untuk dikerjakan; ia tidak memberi jawaban atas nama pihak yang belum dihubungi.

## Source pin dan pencatatan akhir

Source sudah dipin pada `64870f116a02fa44fda1dfc4a67dcb9ac4aa15bf`. CompanySeries build telah direkam ulang dari source bersih tersebut dan kedua contract build check lulus; production build serta 42 backend/operator/provenance checks dan 8 actual local Safe/deployment checks sesudah pin juga lulus. Ini menggantikan keterbatasan source pin pada rehearsal sebelumnya tanpa menghapus evidence historisnya.

`npm run mainnet:preflight` menghasilkan digest dan status fase berdasarkan file yang benar-benar ada. Output final akan dicatat dalam `docs/reviews/mainnet-evidence/preflight.json`; laporan ini tidak menuliskan digest atau hasil command yang belum tersedia. Seluruh requirement eksternal masih PENDING sehingga phase decisions tetap HELD. Commit evidence/build sesudah source pin tidak otomatis mengubah approval/gate. Remote GitHub Actions dan Vercel belum dijalankan; tidak ada push/deploy/public send dalam paket ini.

```text
Release/source commit: 64870f116a02fa44fda1dfc4a67dcb9ac4aa15bf
Recorded CompanySeries sourceCommit: 64870f116a02fa44fda1dfc4a67dcb9ac4aa15bf
Recorded CompanySeries build: workingTreeClean true; 6693 runtime bytes; both contract checks PASS
Post-pin checks: 42 backend/operator/provenance PASS; 8 local Safe/deployment checks PASS
Final browser result: 13 checks PASS, 0 errors; EIP-1193 adapter, local environment
Final sourceDigest and preflight evidence: use generated mainnet-evidence/preflight.json when recorded
External phase decisions: token-launch HELD / paid-beta HELD / position-pilot HELD
Public deployment/payment evidence from this preparation: NONE
```
