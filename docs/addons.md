# Add-on Claude Code: ringkasan dan checklist tes

Dipasang lewat `install-claude-addons.sh` (level user, aktif di semua project).
Setelah restart aplikasi Claude, jalankan checklist di bawah di sesi baru.

## 0. Prasyarat (sekali saja)

- [ ] Restart penuh Claude desktop app (Quit dari system tray, buka lagi), lalu mulai sesi baru.
- [ ] Nyalakan Docker Desktop, lalu tarik image strix:

```bash
docker pull ghcr.io/usestrix/strix-sandbox:1.3.0
```

- [ ] Siapkan API key LLM untuk strix (hanya kalau mau scan).
- [ ] Nonaktifkan plugin "Security Guidance" dari pengaturan Plugins di aplikasi Claude (hook-nya error: `security_reminder_hook.py` tidak ada).

## 1. Cek status global

```bash
claude plugin list
claude mcp list
```

Harapan: 12 plugin `enabled`; MCP `autoharness`, `claude-mem`, `watermelon` berstatus Connected.

## 2. Workflow dan memori

| Add-on | Fungsi | Tes |
|---|---|---|
| superpowers | Brainstorming, rencana, TDD, debugging, review | `/superpowers:brainstorming` atau minta "bantu rencanakan fitur X" |
| autoharness | Belajar dari episode kerja, membuat skill | `/autoharness:learn` |
| claude-mem | Memori lintas sesi (telemetry sudah dimatikan) | `/claude-mem:mem-search <kata kunci>` |

## 3. Desain dan UI

| Add-on | Fungsi | Tes |
|---|---|---|
| impeccable | Aturan dan audit desain | `/impeccable` pada satu halaman, mis. dashboard |
| ui-ux-pro-max | Referensi gaya, palet, tipografi | `/ui-ux-pro-max:design-system` |
| watermelon (MCP) | Katalog komponen UI | "cari komponen tabel dari watermelon" |

## 4. Alat kerja

| Add-on | Fungsi | Tes |
|---|---|---|
| graphify | Knowledge graph kode dan dokumen | `/graphify` di root project (membuat `graphify-out/`) |
| worktrunk | Mengelola git worktree | `git-wt list` di terminal baru |
| typesafe | Bantuan TypeScript aman tipe | `/typesafe:typesafe-ai` pada satu file `.ts` |
| brag | Rangkuman pencapaian | `/brag:brag` atau `/brag:brag-slim` |
| prompt-master | Menyusun prompt untuk AI lain | "buatkan prompt untuk Cursor agar membuat form escrow" |
| ian-xiaohei-illustrations | Ilustrasi artikel gaya Ian | Hanya kalau diminta eksplisit |

## 5. Gaya balasan dan LSP

- i-have-adhd: balasan seharusnya lebih ringkas dan terstruktur.
- vibe-wise: mode belajar, menjelaskan keputusan saat kode ditulis.
- vtsls dan pyright: buka file `.ts` / `.py` yang salah tipe, error harus muncul.

## 6. Keamanan (strix, 8 skill)

Strix 1.7.0 terpasang di **WSL**, bukan di Windows.

```bash
wsl.exe -e bash -lc '$HOME/.strix/bin/strix --version'
```

Skill: penetration-testing, web-app-penetration-testing, api-security-testing,
owasp-top-10-testing, application-security-testing, find-security-vulnerabilities-in-code,
fix-security-vulnerabilities-with-strix, ci-security-scanning-with-strix.

Aturan: scan hanya terhadap aplikasi sendiri (mis. `localhost`), jangan target pihak lain.

## 7. Catatan masalah yang diketahui

- `wt` di Git Bash bisa memanggil Windows Terminal. Pakai alias `git-wt`
  (terpasang di `~/.bashrc` dan profil PowerShell) atau `~/.cargo/bin/wt`.
- Hook pyright saat sesi dimulai bisa mencetak "Failed to install" karena memeriksa lewat pip.
  Pyright sebenarnya terpasang via `npm i -g pyright`; abaikan pesan itu selama
  `pyright-langserver` ada di PATH.
- Strix tidak ada di Windows, hanya di WSL.
- Plugin yang dihapus script (kalau ada): pro-workflow, ponytail, agent-skills, arscontexta,
  taste-skill, antislop, caveman. Skill yang dipindahkan ada di `~/.claude/removed-addons-*`.
