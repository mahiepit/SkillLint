<div align="center">

# 🧪 SkillLint

**Trình kiểm tra (linter) cho Agent Skills (`SKILL.md`): biết chắc skill của bạn hợp lệ, được kích hoạt đúng lúc và chạy được trên Claude Code, Codex, Cursor, Gemini CLI và GitHub Copilot — trước khi người dùng phát hiện ra là nó không chạy.**

**67 quy tắc, mỗi quy tắc dẫn nguồn tài liệu chính thức · Ma trận tương thích với `--target` · Kiểm tra manifest plugin Claude Code · GitHub Action · Không phụ thuộc thư viện nào**

[English](README.md) · Tiếng Việt

</div>

---

## ✨ Vì sao cần SkillLint

Agent Skills là một chuẩn mở, nhưng mỗi agent đọc nó hơi khác nhau. Một skill chạy tốt trong Claude Code có thể bị Codex âm thầm bỏ qua (mô tả dài hơn 500 ký tự), bị Cursor đặt sai tên (name ≠ tên thư mục), không bao giờ được Gemini CLI tìm thấy (lồng sâu thêm một cấp thư mục), hoặc hỏng trên Linux vì được viết trên Windows. Agent hầu như không báo lỗi — skill chỉ đơn giản là không bao giờ được dùng.

| | |
|---|---|
| 🧭 **Kiểm tra tính tương thích, không chỉ cú pháp** | Biết các agent khác nhau ở đâu: giới hạn mô tả 500 ký tự của Codex, Cursor dùng tên thư mục làm định danh, Gemini CLI chỉ tìm một cấp thư mục, các trường và cú pháp `$ARGUMENTS` chỉ Claude Code hiểu, mỗi agent quét thư mục nào. `--target claude,codex` chỉ kiểm tra những gì quan trọng với các agent bạn hỗ trợ. |
| 📚 **Mỗi quy tắc đều có nguồn** | [docs/RULES.md](docs/RULES.md) giải thích từng quy tắc kèm lý do và đường dẫn tới đặc tả hoặc tài liệu của nhà phát triển. Không có quy tắc "tự nghĩ ra". |
| 🎯 **Bắt các skill không bao giờ được kích hoạt** | Mô tả quá ngắn, chỉ nói *làm gì* mà không nói *khi nào dùng*, viết kiểu "Tôi có thể giúp bạn…", hoặc chứa thẻ XML. Dấu `: ` và ` #` không được đặt trong ngoặc kép làm YAML lỗi hoặc âm thầm cắt mất mô tả. |
| 🪟 **Bắt các lỗi "đặc sản" Windows** | UTF-8 BOM, script có dòng CRLF (`bash\r: bad interpreter`), thiếu quyền thực thi (đọc từ git index nên chạy đúng cả trên Windows), liên kết chỉ chạy được trên ổ đĩa không phân biệt hoa/thường, đường dẫn dùng dấu `\`. |
| 🧩 **Kiểm tra cả manifest plugin** | Kiểm tra `.claude-plugin/plugin.json` và `marketplace.json` giống `claude plugin validate`, cộng thêm các lỗi chỉ lộ ra lúc cài đặt mà lệnh đó không báo (thư mục nguồn không tồn tại, tên bị cấm). |
| 🤖 **Sẵn sàng cho CI** | GitHub Action hiển thị lỗi ngay trên diff của pull request và bảng tóm tắt, `--json`, SARIF cho code scanning, mã thoát rõ ràng, `--fix` để tự sửa các lỗi an toàn. |
| 🪶 **Không phụ thuộc thư viện** | Một gói Node.js nhỏ với bộ phân tích YAML riêng, chặt chẽ. Chạy ở bất cứ đâu với `npx`. |

## 🚀 Tính năng

- **Tự tìm mọi thứ**: chỉ vào một skill, một thư mục `skills/` hoặc cả repo. Tìm `SKILL.md` trong `.claude/skills`, `.agents/skills`, `.codex/skills`, `.cursor/skills`, `.gemini/skills`, `.github/skills`, `skills/` và mọi nơi khác, cùng các manifest plugin Claude Code. Bỏ qua `node_modules`, `.git` và các mẫu ignore của bạn.
- **Tuân thủ đặc tả**: trường bắt buộc, định dạng và độ dài `name`, `name` = tên thư mục, `description` ≤ 1024, `compatibility` ≤ 500, giá trị `metadata` phải là chuỗi, định dạng `allowed-tools`, trường lạ kèm gợi ý "có phải ý bạn là…".
- **Đánh giá khả năng kích hoạt**: mô tả quá ngắn, thiếu "Use when…", viết ở ngôi thứ nhất/thứ hai, tên mơ hồ (`utils`, `helper`), giới hạn hiển thị của Claude.
- **Nội dung và tệp đi kèm**: giới hạn 500 dòng và ~5000 token, liên kết tương đối bị hỏng (kể cả sai chữ hoa/thường), đường dẫn `scripts/…` không tồn tại, liên kết trỏ ra ngoài skill, đường dẫn tuyệt đối hoặc riêng của máy bạn, tham chiếu lồng nhau, tệp tham chiếu dài không có mục lục, tệp đi kèm không được nhắc tới, câu chữ phụ thuộc thời gian.
- **Script**: thiếu shebang, không có quyền thực thi, dòng CRLF, script chỉ chạy trên Windows (`.ps1/.bat`).
- **Bố cục**: độ sâu thư mục, agent nào (không) tìm thấy thư mục chứa skill, tên trùng nhau.
- **Đầu ra**: dạng dễ đọc có màu với `tệp:dòng:cột`, mã quy tắc và gợi ý sửa; `--json`; `--format github`; `--format sarif` / `--sarif tệp`.
- **Tùy biến**: `--target`, `--rule id=off|info|warning|error`, `--ignore`, `.skilllintrc.json`, và `<!-- skilllint-disable rule-id -->` ngay trong skill.

## 📥 Cài đặt

Yêu cầu: [Node.js 18+](https://nodejs.org). Không cần gì khác.

### Cách 1 — chạy không cần cài
```bash
npx github:mahiepit/SkillLint .
```

### Cách 2 — cài lệnh dùng chung
```bash
npm install -g github:mahiepit/SkillLint
skilllint .
```

### Cách 3 — dùng như plugin Claude Code (CLI + một skill dạy agent cách viết và kiểm tra skill)
```
/plugin marketplace add mahiepit/SkillLint
/plugin install skilllint@skilllint
```
Với Codex, Cursor, Gemini CLI hoặc Copilot, hãy sao chép [`skills/writing-agent-skills`](skills/writing-agent-skills) vào `.agents/skills/` (hoặc thư mục skills của agent bạn dùng).

## 🖱️ Tra cứu nhanh

| Việc cần làm | Lệnh |
|---|---|
| Kiểm tra repo hiện tại | `skilllint` |
| Kiểm tra một skill | `skilllint .claude/skills/my-skill` |
| Chỉ kiểm tra cho một số agent | `skilllint --target claude,codex` |
| Tự sửa các lỗi an toàn | `skilllint --fix` |
| Coi cảnh báo là lỗi | `skilllint --strict` (hoặc `--max-warnings 10`) |
| Chỉ hiện lỗi | `skilllint --quiet` |
| JSON / chú thích GitHub / SARIF | `--json` · `--format github` · `--format sarif` hoặc `--sarif out.sarif` |
| Tắt hoặc nâng mức một quy tắc | `--rule unreferenced-file=off` · `--rule name-vague=error` |
| Bỏ qua đường dẫn | `--ignore "vendor/**"` |
| Xem mọi quy tắc và agent liên quan | `skilllint --list-rules` |

Target: `claude` (Claude Code), `codex` (OpenAI Codex), `cursor`, `gemini` (Gemini CLI), `copilot` (GitHub Copilot), `spec` (agentskills.io / `skills-ref`), hoặc `all` (mặc định).

Mã thoát: `0` không có lỗi · `1` có lỗi (hoặc có cảnh báo khi dùng `--strict` / `--max-warnings`) · `2` dùng sai lệnh.

**Tệp cấu hình** — `.skilllintrc.json` (hoặc `skilllint.config.json`) trong thư mục đang chạy:
```json
{
  "targets": ["claude", "codex", "cursor"],
  "rules": { "unreferenced-file": "off", "description-person": "error" },
  "ignore": ["vendor/**", "tests/fixtures/**"]
}
```

## 🔍 Ví dụ kết quả

Kết quả thật khi chạy trên các fixture kiểm thử của repo này (`cd tests/fixtures && skilllint fields invalid-yaml codex-description`; thông báo của công cụ bằng tiếng Anh):

```text
codex-description/codex-desc/SKILL.md
  3:1  warning  `description` is 577 characters; the Codex skill loader rejects descriptions over 500.  description-too-long-codex
                fix: Keep it under 500 characters to load in Codex as well.

fields/field-mix/SKILL.md
  4:1   warning  Unknown frontmatter field `licence`; no supported agent reads it (did you mean `license`?).  unknown-field
                 fix: Put custom data under `metadata:` instead.
  5:1   warning  `model` is only understood by Claude Code; OpenAI Codex, Cursor, Gemini CLI, GitHub Copilot ignore it; it is not in the Agent Skills spec, so `skills-ref validate` and Claude skill uploads reject it.  non-portable-field
                 fix: Keep it only if you target Claude Code, or limit checks with --target claude.
  ...
  7:1   error    `effort` must be one of low, medium, high, xhigh, max, but it is "extreme".  field-type
                 fix: effort: low
  ...
  13:3  warning  `metadata.version` is a number (1), but metadata values must be strings; unquoted versions like 1.0 or 1.10 are silently turned into numbers.  metadata-invalid
                 fix: Quote it: version: "1.0"
  14:1  error    `compatibility` is empty; omit it unless the skill has environment requirements.  compatibility-invalid
                 fix: Example: compatibility: Requires git, docker and network access

invalid-yaml/colon-skill/SKILL.md
  3:43  error    Invalid YAML: mapping values are not allowed here: a plain value contains ": " (colon + space) or ends with ":"; wrap the whole value in quotes.  frontmatter-invalid-yaml
                 fix: Agents skip skills whose frontmatter does not parse. Quoting the value usually fixes it: description: "..."

✖ 11 problems (3 errors, 8 warnings, 0 info) in 3 skills.
```

Với `--target claude`, các trường chỉ dành cho Claude và giới hạn của Codex không còn bị báo, còn lỗi thật vẫn được giữ lại:

```text
✖ 3 problems (2 errors, 1 warning, 0 info) in 3 skills.
  Targets: Claude Code.
```

Xem toàn bộ kết quả mẫu trong [README tiếng Anh](README.md#-example-output).

## 🤖 GitHub Action

```yaml
# .github/workflows/skills.yml
name: skills
on: [push, pull_request]
jobs:
  skilllint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mahiepit/SkillLint@v1
        with:
          path: .                 # tệp hoặc thư mục, cách nhau bằng dấu cách
          target: claude,codex    # tùy chọn, mặc định: all
```

Lỗi hiển thị dưới dạng chú thích ngay trên diff của pull request, kèm bảng tóm tắt trên trang job. Đầu vào: `path`, `target`, `strict`, `max-warnings`, `sarif`, `args` (cờ CLI bổ sung), `node-version`. Đầu ra: `errors`, `warnings`.

Hiển thị kết quả trong GitHub code scanning:
```yaml
      - uses: mahiepit/SkillLint@v1
        with:
          sarif: skilllint.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: skilllint.sarif
```

CI khác: `npx --yes github:mahiepit/SkillLint . --strict` (mã thoát 1 nếu có vấn đề).

## 📏 Quy tắc & ma trận tương thích

67 quy tắc chia thành mười nhóm: tệp & frontmatter, `name`, `description`, các trường khác, nội dung, tham chiếu & tệp, script, bố cục, `plugin.json`, `marketplace.json`. Mỗi quy tắc được gắn với các agent mà nó ảnh hưởng — trích một phần:

| Quy tắc | Mức | Claude Code | Codex | Cursor | Gemini CLI | Copilot | Spec |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `frontmatter-invalid-yaml` | error | ● | ● | ● | ● | ● | ● |
| `name-dir-mismatch` | error |  |  | ● | ● | ● | ● |
| `description-too-long-codex` | warning |  | ● |  |  |  |  |
| `non-portable-field` | warning | ± | ± | ± | ± | ± | ± |
| `agent-specific-syntax` | warning |  | ● | ● | ● | ● | ● |
| `skill-nesting-depth` | warning | ● |  |  | ● |  |  |
| `script-crlf` | error | ● | ● | ● | ● | ● | ● |
| `plugin-path` | error | ● |  |  |  |  |  |

**Ma trận đầy đủ, lý do và nguồn của từng quy tắc: [docs/RULES.md](docs/RULES.md)** (tiếng Anh). Chạy `skilllint --list-rules` để in ra terminal.

## ⚖️ Các công cụ khác

SkillLint không phải công cụ duy nhất; hãy chọn cái phù hợp:

- **[skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref)** (Python) — trình kiểm tra tham chiếu của dự án Agent Skills, là chuẩn mực cho việc tuân thủ đặc tả (các trường frontmatter và quy tắc đặt tên). SkillLint làm các kiểm tra tương tự và bổ sung khác biệt giữa các agent, đánh giá chất lượng, kiểm tra tệp/script, manifest plugin và định dạng cho CI.
- **[skill-check](https://www.npmjs.com/package/skill-check)** (npm) — công cụ chất lượng rộng hơn, có chấm điểm, nhiều định dạng đầu ra, chế độ watch và quét bảo mật. Phù hợp nếu bạn muốn điểm số và báo cáo HTML.
- **[agent-skills-lint](https://github.com/swarmclawai/agent-skills-lint)** (npm) — kiểm tra theo từng agent, kết hợp cài skill vào thư mục của từng agent và tạo chỉ mục.
- **[skills_lint](https://pub.dev/packages/skills_lint)** (Dart) — trình phân tích tĩnh cho skill trong hệ sinh thái Dart/Flutter.
- **`claude plugin validate`** — kiểm tra chính thức cho manifest plugin Claude Code. SkillLint làm theo để bạn chạy được trong CI mà không cần Claude Code, nhưng vẫn nên chạy lệnh chính thức trước khi phát hành.

Trọng tâm của SkillLint: ma trận tương thích mà mỗi quy tắc đều dẫn nguồn chính thức, `--target` để kiểm tra đúng agent cần hỗ trợ, manifest plugin/marketplace của Claude Code, các bẫy trên Windows, và không phụ thuộc thư viện.

## ❤️ Ủng hộ dự án

SkillLint miễn phí và sẽ luôn miễn phí. Nếu công cụ giúp bạn tiết kiệm thời gian, một khoản ủng hộ sẽ giúp dự án được duy trì và phát triển. Xin cảm ơn!

<table>
<tr>
<td align="center"><b>PayPal</b><br><img src="docs/img/donate-paypal.svg" width="180" alt="PayPal QR"><br><a href="https://paypal.me/thaogia">paypal.me/thaogia</a></td>
<td align="center"><b>BNB (BEP-20) / ETH (ERC-20)</b><br><img src="docs/img/donate-crypto.svg" width="180" alt="BNB / ETH QR"><br><code>0xd09c2E60cbC8526976C436e316630FA64296E824</code></td>
</tr>
</table>

Vui lòng kiểm tra kỹ mạng lưới (BNB Smart Chain hoặc Ethereum) trước khi gửi tiền mã hóa.

## 🧩 Cách hoạt động

```
đường dẫn ──► tìm tệp ──► SKILL.md ──► frontmatter + bộ phân tích YAML chặt chẽ ──► quy tắc ──► --fix ──► stylish / json / github / sarif
                │                                                                  ▲
                └──► .claude-plugin/plugin.json, marketplace.json ─────────────────┘   lọc theo --target, cấu hình, chú thích tắt quy tắc
```

- Bộ phân tích YAML được cố ý làm chặt chẽ như PyYAML/js-yaml, nên frontmatter làm hỏng trình nạp của agent cũng sẽ lỗi ở đây, đồng thời ghi lại các trường hợp phân tích được nhưng không đúng ý (chú thích ` #`, boolean kiểu YAML 1.1).
- Quyền tệp và kiểu xuống dòng được đọc từ git index khi có thể, nên kết quả đúng cả trên bản checkout Windows.
- `--fix` chỉ áp dụng các sửa đổi không làm thay đổi ý nghĩa: xóa BOM, xóa khoảng trắng cuối dòng, CRLF → LF, `chmod +x`, và chuẩn hóa `name` khi kết quả trùng với tên thư mục.

```
bin/skilllint.js          điểm vào CLI
src/yaml.js               bộ phân tích YAML không phụ thuộc thư viện
src/rules/skill.js        quy tắc cho SKILL.md, nội dung, tham chiếu, script, bố cục
src/rules/plugin.js       quy tắc cho plugin.json và marketplace.json
src/rules/registry.js     thông tin quy tắc: mức độ, target, nguồn
src/targets.js            mỗi agent hỗ trợ gì và tìm skill ở đâu
src/formatters/           đầu ra stylish, json, github, sarif
skills/writing-agent-skills/   skill đi kèm plugin Claude Code
action.yml                GitHub Action dạng composite
docs/RULES.md             mọi quy tắc, lý do và nguồn
```

Phát triển: `npm test` (trình chạy test có sẵn của Node, fixture trong `tests/fixtures`), `npm run lint:self` (SkillLint tự kiểm tra repo này).

## 📄 Giấy phép

[MIT](LICENSE) © Thảo Gia.
SkillLint là dự án độc lập, không liên kết với Anthropic, OpenAI, Anysphere (Cursor), Google hay GitHub. Tên sản phẩm chỉ được dùng để mô tả khả năng tương thích.
