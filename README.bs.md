<p align="center">Hena je open source AI agent za programiranje.</p>
<p align="center">
  <a href="https://hena.dev/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/hena"><img alt="npm" src="https://img.shields.io/npm/v/hena?style=flat-square" /></a>
  <a href="https://github.com/hena-agent/hena/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/hena-agent/hena/publish.yml?style=flat-square&branch=develop" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Hena Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://hena.dev)

---

### Instalacija

```bash
# YOLO
curl -fsSL https://hena.dev/install | bash

# Package manageri
npm i -g hena@latest        # ili bun/pnpm/yarn
scoop install hena             # Windows
choco install hena             # Windows
brew install hena-agent/tap/hena # macOS i Linux (preporučeno, uvijek ažurno)
brew install hena              # macOS i Linux (zvanična brew formula, rjeđe se ažurira)
sudo pacman -S hena            # Arch Linux (Stable)
paru -S hena-bin               # Arch Linux (Latest from AUR)
mise use -g hena               # Bilo koji OS
nix run github:hena-agent/hena           # ili github:hena-agent/hena za najnoviji develop branch
```

> [!TIP]
> Ukloni verzije starije od 0.1.x prije instalacije.

### Desktop aplikacija (BETA)

Hena je dostupan i kao desktop aplikacija. Preuzmi je direktno sa [stranice izdanja](https://github.com/hena-agent/hena/releases) ili sa [hena.dev/download](https://hena.dev/download).

| Platforma             | Preuzimanje                        |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `hena-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `hena-desktop-mac-x64.dmg`     |
| Windows               | `hena-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, ili AppImage       |

```bash
# macOS (Homebrew)
brew install --cask hena
# Windows (Scoop)
scoop bucket add extras; scoop install hena
```

#### Instalacijski direktorij

Instalacijska skripta koristi sljedeći redoslijed prioriteta za putanju instalacije:

1. `$HENA_INSTALL_DIR` - Prilagođeni instalacijski direktorij
2. `$XDG_BIN_DIR` - Putanja usklađena sa XDG Base Directory specifikacijom
3. `$HOME/bin` - Standardni korisnički bin direktorij (ako postoji ili se može kreirati)
4. `$HOME/.hena/bin` - Podrazumijevana rezervna lokacija

```bash
# Primjeri
HENA_INSTALL_DIR=/usr/local/bin curl -fsSL https://hena.dev/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://hena.dev/install | bash
```

### Agenti

Hena uključuje dva ugrađena agenta između kojih možeš prebacivati tasterom `Tab`.

- **build** - Podrazumijevani agent sa punim pristupom za razvoj
- **plan** - Agent samo za čitanje za analizu i istraživanje koda
  - Podrazumijevano zabranjuje izmjene datoteka
  - Traži dozvolu prije pokretanja bash komandi
  - Idealan za istraživanje nepoznatih codebase-ova ili planiranje izmjena

Uključen je i **general** pod-agent za složene pretrage i višekoračne zadatke.
Koristi se interno i može se pozvati pomoću `@general` u porukama.

Saznaj više o [agentima](https://hena.dev/docs/agents).

### Dokumentacija

Za više informacija o konfiguraciji Hena-a, [**pogledaj dokumentaciju**](https://hena.dev/docs).

### Doprinosi

Ako želiš doprinositi Hena-u, pročitaj [upute za doprinošenje](./CONTRIBUTING.md) prije slanja pull requesta.

### Gradnja na Hena-u

Ako radiš na projektu koji je povezan s Hena-om i koristi "hena" kao dio naziva, npr. "hena-dashboard" ili "hena-mobile", dodaj napomenu u svoj README da projekat nije napravio Hena tim i da nije povezan s nama.

---

**Pridruži se našoj zajednici** [Discord](https://hena.dev/discord) | [X.com](https://hena.dev)
