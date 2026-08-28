<p align="center">ওপেন সোর্স এআই কোডিং এজেন্ট।</p>
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

### ইনস্টলেশন (Installation)

```bash
# YOLO
curl -fsSL https://hena.dev/install | bash

# Package managers
npm i -g hena@latest        # or bun/pnpm/yarn
scoop install hena             # Windows
choco install hena             # Windows
brew install hena-agent/tap/hena # macOS and Linux (recommended, always up to date)
brew install hena              # macOS and Linux (official brew formula, updated less)
sudo pacman -S hena            # Arch Linux (Stable)
paru -S hena-bin               # Arch Linux (Latest from AUR)
mise use -g hena               # Any OS
nix run github:hena-agent/hena           # or github:hena-agent/hena for latest develop branch
```

> [!TIP]
> ইনস্টল করার আগে ০.১.x এর চেয়ে পুরোনো ভার্সনগুলো মুছে ফেলুন।

### ডেস্কটপ অ্যাপ (BETA)

Hena ডেস্কটপ অ্যাপ্লিকেশন হিসেবেও উপলব্ধ। সরাসরি [রিলিজ পেজ](https://github.com/hena-agent/hena/releases) অথবা [hena.dev/download](https://hena.dev/download) থেকে ডাউনলোড করুন।

| প্ল্যাটফর্ম           | ডাউনলোড                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `hena-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `hena-desktop-mac-x64.dmg`     |
| Windows               | `hena-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask hena
# Windows (Scoop)
scoop bucket add extras; scoop install hena
```

#### ইনস্টলেশন ডিরেক্টরি (Installation Directory)

ইনস্টল স্ক্রিপ্টটি ইনস্টলেশন পাতের জন্য নিম্নলিখিত অগ্রাধিকার ক্রম মেনে চলে:

1. `$HENA_INSTALL_DIR` - কাস্টম ইনস্টলেশন ডিরেক্টরি
2. `$XDG_BIN_DIR` - XDG বেস ডিরেক্টরি স্পেসিফিকেশন সমর্থিত পাথ
3. `$HOME/bin` - সাধারণ ব্যবহারকারী বাইনারি ডিরেক্টরি (যদি বিদ্যমান থাকে বা তৈরি করা যায়)
4. `$HOME/.hena/bin` - ডিফল্ট ফলব্যাক

```bash
# উদাহরণ
HENA_INSTALL_DIR=/usr/local/bin curl -fsSL https://hena.dev/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://hena.dev/install | bash
```

### এজেন্টস (Agents)

Hena এ দুটি বিল্ট-ইন এজেন্ট রয়েছে যা আপনি `Tab` কি(key) দিয়ে পরিবর্তন করতে পারবেন।

- **build** - ডিফল্ট, ডেভেলপমেন্টের কাজের জন্য সম্পূর্ণ অ্যাক্সেসযুক্ত এজেন্ট
- **plan** - বিশ্লেষণ এবং কোড এক্সপ্লোরেশনের জন্য রিড-ওনলি এজেন্ট
  - ডিফল্টভাবে ফাইল এডিট করতে দেয় না
  - ব্যাশ কমান্ড চালানোর আগে অনুমতি চায়
  - অপরিচিত কোডবেস এক্সপ্লোর করা বা পরিবর্তনের পরিকল্পনা করার জন্য আদর্শ

এছাড়াও জটিল অনুসন্ধান এবং মাল্টিস্টেপ টাস্কের জন্য একটি **general** সাবএজেন্ট অন্তর্ভুক্ত রয়েছে।
এটি অভ্যন্তরীণভাবে ব্যবহৃত হয় এবং মেসেজে `@general` লিখে ব্যবহার করা যেতে পারে।

এজেন্টদের সম্পর্কে আরও জানুন: [docs](https://hena.dev/docs/agents)।

### ডকুমেন্টেশন (Documentation)

কিভাবে Hena কনফিগার করবেন সে সম্পর্কে আরও তথ্যের জন্য, [**আমাদের ডকস দেখুন**](https://hena.dev/docs)।

### অবদান (Contributing)

আপনি যদি Hena এ অবদান রাখতে চান, অনুগ্রহ করে একটি পুল রিকোয়েস্ট সাবমিট করার আগে আমাদের [কন্ট্রিবিউটিং ডকস](./CONTRIBUTING.md) পড়ে নিন।

### Hena এর উপর বিল্ডিং (Building on Hena)

আপনি যদি এমন প্রজেক্টে কাজ করেন যা Hena এর সাথে সম্পর্কিত এবং প্রজেক্টের নামের অংশ হিসেবে "hena" ব্যবহার করেন, উদাহরণস্বরূপ "hena-dashboard" বা "hena-mobile", তবে দয়া করে আপনার README তে একটি নোট যোগ করে স্পষ্ট করুন যে এই প্রজেক্টটি Hena দল দ্বারা তৈরি হয়নি এবং আমাদের সাথে এর কোনো সরাসরি সম্পর্ক নেই।

---

**আমাদের কমিউনিটিতে যুক্ত হোন** [Discord](https://hena.dev/discord) | [X.com](https://hena.dev)
