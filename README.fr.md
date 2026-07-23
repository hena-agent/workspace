<p align="center">
  <a href="https://hena.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo Hena Agent">
    </picture>
  </a>
</p>
<p align="center">L'agent de codage IA open source.</p>
<p align="center">
  <a href="https://hena.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/hena-agent"><img alt="npm" src="https://img.shields.io/npm/v/hena-agent?style=flat-square" /></a>
  <a href="https://github.com/hena-agent/hena/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/hena-agent/hena/publish.yml?style=flat-square&branch=dev" /></a>
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

[![Hena Agent Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://hena.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://hena.ai/install | bash

# Gestionnaires de paquets
npm i -g hena-agent@latest        # ou bun/pnpm/yarn
scoop install hena-agent             # Windows
choco install hena-agent             # Windows
brew install hena-agent/tap/hena-agent # macOS et Linux (recommandé, toujours à jour)
brew install hena-agent              # macOS et Linux (formule officielle brew, mise à jour moins fréquente)
sudo pacman -S hena-agent            # Arch Linux (Stable)
paru -S hena-agent-bin               # Arch Linux (Latest from AUR)
mise use -g hena-agent               # n'importe quel OS
nix run github:hena-agent/hena           # ou github:hena-agent/hena pour la branche dev la plus récente
```

> [!TIP]
> Supprimez les versions antérieures à 0.1.x avant d'installer.

### Application de bureau (BETA)

Hena Agent est aussi disponible en application de bureau. Téléchargez-la directement depuis la [page des releases](https://github.com/hena-agent/hena/releases) ou [hena.ai/download](https://hena.ai/download).

| Plateforme            | Téléchargement                     |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `hena-agent-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `hena-agent-desktop-mac-x64.dmg`     |
| Windows               | `hena-agent-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, ou AppImage        |

```bash
# macOS (Homebrew)
brew install --cask hena-agent
# Windows (Scoop)
scoop bucket add extras; scoop install hena-agent
```

#### Répertoire d'installation

Le script d'installation respecte l'ordre de priorité suivant pour le chemin d'installation :

1. `$HENA_AGENT_INSTALL_DIR` - Répertoire d'installation personnalisé
2. `$XDG_BIN_DIR` - Chemin conforme à la spécification XDG Base Directory
3. `$HOME/bin` - Répertoire binaire utilisateur standard (s'il existe ou peut être créé)
4. `$HOME/.hena-agent/bin` - Repli par défaut

```bash
# Exemples
HENA_AGENT_INSTALL_DIR=/usr/local/bin curl -fsSL https://hena.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://hena.ai/install | bash
```

### Agents

Hena Agent inclut deux agents intégrés que vous pouvez basculer avec la touche `Tab`.

- **build** - Par défaut, agent avec accès complet pour le travail de développement
- **plan** - Agent en lecture seule pour l'analyse et l'exploration du code
  - Refuse les modifications de fichiers par défaut
  - Demande l'autorisation avant d'exécuter des commandes bash
  - Idéal pour explorer une base de code inconnue ou planifier des changements

Un sous-agent **general** est aussi inclus pour les recherches complexes et les tâches en plusieurs étapes.
Il est utilisé en interne et peut être invoqué via `@general` dans les messages.

En savoir plus sur les [agents](https://hena.ai/docs/agents).

### Documentation

Pour plus d'informations sur la configuration d'Hena Agent, [**consultez notre documentation**](https://hena.ai/docs).

### Contribuer

Si vous souhaitez contribuer à Hena Agent, lisez nos [docs de contribution](./CONTRIBUTING.md) avant de soumettre une pull request.

### Construire avec Hena Agent

Si vous travaillez sur un projet lié à Hena Agent et que vous utilisez "hena-agent" dans le nom du projet (par exemple, "hena-agent-dashboard" ou "hena-agent-mobile"), ajoutez une note dans votre README pour préciser qu'il n'est pas construit par l'équipe Hena Agent et qu'il n'est pas affilié à nous.

---

**Rejoignez notre communauté** [Discord](https://hena.ai/discord) | [X.com](https://hena.ai)
