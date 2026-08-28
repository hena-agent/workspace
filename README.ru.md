<p align="center">Открытый AI-агент для программирования.</p>
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

---

### Установка

```bash
# YOLO
curl -fsSL https://hena.dev/install | bash

# Менеджеры пакетов
npm i -g hena@latest        # или bun/pnpm/yarn
scoop install hena             # Windows
choco install hena             # Windows
brew install hena-agent/tap/hena # macOS и Linux (рекомендуем, всегда актуально)
brew install hena              # macOS и Linux (официальная формула brew, обновляется реже)
sudo pacman -S hena            # Arch Linux (Stable)
paru -S hena-bin               # Arch Linux (Latest from AUR)
mise use -g hena               # любая ОС
nix run github:hena-agent/hena           # или github:hena-agent/hena для самой свежей ветки develop
```

> [!TIP]
> Перед установкой удалите версии старше 0.1.x.

### Десктопное приложение (BETA)

Hena также доступен как десктопное приложение. Скачайте его со [страницы релизов](https://github.com/hena-agent/hena/releases) или с [hena.dev/download](https://hena.dev/download).

| Платформа             | Загрузка                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `hena-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `hena-desktop-mac-x64.dmg`     |
| Windows               | `hena-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` или AppImage        |

```bash
# macOS (Homebrew)
brew install --cask hena
# Windows (Scoop)
scoop bucket add extras; scoop install hena
```

#### Каталог установки

Скрипт установки выбирает путь установки в следующем порядке приоритета:

1. `$HENA_INSTALL_DIR` - Пользовательский каталог установки
2. `$XDG_BIN_DIR` - Путь, совместимый со спецификацией XDG Base Directory
3. `$HOME/bin` - Стандартный каталог пользовательских бинарников (если существует или можно создать)
4. `$HOME/.hena/bin` - Fallback по умолчанию

```bash
# Примеры
HENA_INSTALL_DIR=/usr/local/bin curl -fsSL https://hena.dev/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://hena.dev/install | bash
```

### Agents

В Hena есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](https://hena.dev/docs/agents).

### Документация

Больше информации о том, как настроить Hena: [**наши docs**](https://hena.dev/docs).

### Вклад

Если вы хотите внести вклад в Hena, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе Hena

Если вы делаете проект, связанный с Hena, и используете "hena" как часть имени (например, "hena-dashboard" или "hena-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой Hena и не аффилирован с нами.

---

**Присоединяйтесь к нашему сообществу** [Discord](https://hena.dev/discord) | [X.com](https://hena.dev)
