<p align="center">
  <a href="https://hena.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Hena Agent logo">
    </picture>
  </a>
</p>
<p align="center">Trợ lý lập trình AI mã nguồn mở.</p>
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

### Cài đặt

```bash
# YOLO
curl -fsSL https://hena.ai/install | bash

# Các trình quản lý gói (Package managers)
npm i -g hena-agent@latest        # hoặc bun/pnpm/yarn
scoop install hena-agent             # Windows
choco install hena-agent             # Windows
brew install hena-agent/tap/hena-agent # macOS và Linux (khuyên dùng, luôn cập nhật)
brew install hena-agent              # macOS và Linux (công thức brew chính thức, ít cập nhật hơn)
sudo pacman -S hena-agent            # Arch Linux (Bản ổn định)
paru -S hena-agent-bin               # Arch Linux (Bản mới nhất từ AUR)
mise use -g hena-agent               # Mọi hệ điều hành
nix run github:hena-agent/hena           # hoặc github:hena-agent/hena cho nhánh dev mới nhất
```

> [!TIP]
> Hãy xóa các phiên bản cũ hơn 0.1.x trước khi cài đặt.

### Ứng dụng Desktop (BETA)

Hena Agent cũng có sẵn dưới dạng ứng dụng desktop. Tải trực tiếp từ [trang releases](https://github.com/hena-agent/hena/releases) hoặc [hena.ai/download](https://hena.ai/download).

| Nền tảng              | Tải xuống                          |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `hena-agent-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `hena-agent-desktop-mac-x64.dmg`     |
| Windows               | `hena-agent-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, hoặc AppImage      |

```bash
# macOS (Homebrew)
brew install --cask hena-agent
# Windows (Scoop)
scoop bucket add extras; scoop install hena-agent
```

#### Thư mục cài đặt

Tập lệnh cài đặt tuân theo thứ tự ưu tiên sau cho đường dẫn cài đặt:

1. `$HENA_AGENT_INSTALL_DIR` - Thư mục cài đặt tùy chỉnh
2. `$XDG_BIN_DIR` - Đường dẫn tuân thủ XDG Base Directory Specification
3. `$HOME/bin` - Thư mục nhị phân tiêu chuẩn của người dùng (nếu tồn tại hoặc có thể tạo)
4. `$HOME/.hena-agent/bin` - Mặc định dự phòng

```bash
# Ví dụ
HENA_AGENT_INSTALL_DIR=/usr/local/bin curl -fsSL https://hena.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://hena.ai/install | bash
```

### Agents (Đại diện)

Hena Agent bao gồm hai agent được tích hợp sẵn mà bạn có thể chuyển đổi bằng phím `Tab`.

- **build** - Agent mặc định, có toàn quyền truy cập cho công việc lập trình
- **plan** - Agent chỉ đọc dùng để phân tích và khám phá mã nguồn
  - Mặc định từ chối việc chỉnh sửa tệp
  - Hỏi quyền trước khi chạy các lệnh bash
  - Lý tưởng để khám phá các codebase lạ hoặc lên kế hoạch thay đổi

Ngoài ra còn có một subagent **general** dùng cho các tìm kiếm phức tạp và tác vụ nhiều bước.
Agent này được sử dụng nội bộ và có thể gọi bằng cách dùng `@general` trong tin nhắn.

Tìm hiểu thêm về [agents](https://hena.ai/docs/agents).

### Tài liệu

Để biết thêm thông tin về cách cấu hình Hena Agent, [**hãy truy cập tài liệu của chúng tôi**](https://hena.ai/docs).

### Đóng góp

Nếu bạn muốn đóng góp cho Hena Agent, vui lòng đọc [tài liệu hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi pull request.

### Xây dựng trên nền tảng Hena Agent

Nếu bạn đang làm việc trên một dự án liên quan đến Hena Agent và sử dụng "hena-agent" như một phần của tên dự án, ví dụ "hena-agent-dashboard" hoặc "hena-agent-mobile", vui lòng thêm một ghi chú vào README của bạn để làm rõ rằng dự án đó không được xây dựng bởi đội ngũ Hena Agent và không liên kết với chúng tôi dưới bất kỳ hình thức nào.

---

**Tham gia cộng đồng của chúng tôi** [Discord](https://hena.ai/discord) | [X.com](https://hena.ai)
