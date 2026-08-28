<p align="center">Trợ lý lập trình AI mã nguồn mở.</p>
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

### Cài đặt

```bash
# YOLO
curl -fsSL https://hena.dev/install | bash

# Các trình quản lý gói (Package managers)
npm i -g hena@latest        # hoặc bun/pnpm/yarn
scoop install hena             # Windows
choco install hena             # Windows
brew install hena-agent/tap/hena # macOS và Linux (khuyên dùng, luôn cập nhật)
brew install hena              # macOS và Linux (công thức brew chính thức, ít cập nhật hơn)
sudo pacman -S hena            # Arch Linux (Bản ổn định)
paru -S hena-bin               # Arch Linux (Bản mới nhất từ AUR)
mise use -g hena               # Mọi hệ điều hành
nix run github:hena-agent/hena           # hoặc github:hena-agent/hena cho nhánh develop mới nhất
```

> [!TIP]
> Hãy xóa các phiên bản cũ hơn 0.1.x trước khi cài đặt.

### Ứng dụng Desktop (BETA)

Hena cũng có sẵn dưới dạng ứng dụng desktop. Tải trực tiếp từ [trang releases](https://github.com/hena-agent/hena/releases) hoặc [hena.dev/download](https://hena.dev/download).

| Nền tảng              | Tải xuống                          |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `hena-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `hena-desktop-mac-x64.dmg`     |
| Windows               | `hena-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, hoặc AppImage      |

```bash
# macOS (Homebrew)
brew install --cask hena
# Windows (Scoop)
scoop bucket add extras; scoop install hena
```

#### Thư mục cài đặt

Tập lệnh cài đặt tuân theo thứ tự ưu tiên sau cho đường dẫn cài đặt:

1. `$HENA_INSTALL_DIR` - Thư mục cài đặt tùy chỉnh
2. `$XDG_BIN_DIR` - Đường dẫn tuân thủ XDG Base Directory Specification
3. `$HOME/bin` - Thư mục nhị phân tiêu chuẩn của người dùng (nếu tồn tại hoặc có thể tạo)
4. `$HOME/.hena/bin` - Mặc định dự phòng

```bash
# Ví dụ
HENA_INSTALL_DIR=/usr/local/bin curl -fsSL https://hena.dev/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://hena.dev/install | bash
```

### Agents (Đại diện)

Hena bao gồm hai agent được tích hợp sẵn mà bạn có thể chuyển đổi bằng phím `Tab`.

- **build** - Agent mặc định, có toàn quyền truy cập cho công việc lập trình
- **plan** - Agent chỉ đọc dùng để phân tích và khám phá mã nguồn
  - Mặc định từ chối việc chỉnh sửa tệp
  - Hỏi quyền trước khi chạy các lệnh bash
  - Lý tưởng để khám phá các codebase lạ hoặc lên kế hoạch thay đổi

Ngoài ra còn có một subagent **general** dùng cho các tìm kiếm phức tạp và tác vụ nhiều bước.
Agent này được sử dụng nội bộ và có thể gọi bằng cách dùng `@general` trong tin nhắn.

Tìm hiểu thêm về [agents](https://hena.dev/docs/agents).

### Tài liệu

Để biết thêm thông tin về cách cấu hình Hena, [**hãy truy cập tài liệu của chúng tôi**](https://hena.dev/docs).

### Đóng góp

Nếu bạn muốn đóng góp cho Hena, vui lòng đọc [tài liệu hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi pull request.

### Xây dựng trên nền tảng Hena

Nếu bạn đang làm việc trên một dự án liên quan đến Hena và sử dụng "hena" như một phần của tên dự án, ví dụ "hena-dashboard" hoặc "hena-mobile", vui lòng thêm một ghi chú vào README của bạn để làm rõ rằng dự án đó không được xây dựng bởi đội ngũ Hena và không liên kết với chúng tôi dưới bất kỳ hình thức nào.

---

**Tham gia cộng đồng của chúng tôi** [Discord](https://hena.dev/discord) | [X.com](https://hena.dev)
