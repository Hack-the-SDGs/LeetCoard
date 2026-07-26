<div align="center">

![Banner](.github/assets/banner.png)

**LeetCode x Scoreboard** — 課堂練習即時計分板

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org)  

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)

</div>

## 總覽

LeetCoard 是投影用的即時計分板，給社課現場帶練習題用。老師在控制台逐題開放，
學員在 LeetCode 上寫，後端輪詢他們的提交，畫面即時更新。

這不是比賽系統。沒有開始時間、沒有結束時間、沒有提交次數上限——**每一題自己
帶一個開放視窗，老師按下開關就是計時的開始與結束**。排行榜存在的理由是好勝
心：畫面最上方是六組的組別排行，左側是個人排行，中間是每一題的 runtime 百分
位賽道。

### 介面預覽

**公開計分板（投影畫面）**

![Scoreboard](.github/assets/web-scoreboard.png)

**控制台**

![Dashboard](.github/assets/web-dashboard.png)

### 特色

- **逐題開放** — 每題自己的 `opened_at` / `closed_at` 視窗，開關即時生效。關題
  時記下時間點而不是直接關門，所以關題前一秒送出、下一輪才被抓到的 AC 仍然計分
- **百分位賽道** — 每題把最快的 20 位解題者畫在 0–100 的 runtime 百分位軸上。解出
  來就上場，優化就往右滑。這也是「無限重送」這條規則的視覺意義所在。第 21 名以後
  只計人數不列名，公開板上永遠不會出現「還沒解出」的名單
- **助教視角** — 後台的「解題狀況」列出每題的未解出名單（分數低的排前面），讓助教
  知道該走去幫誰。這份資料只在控制台，不會出現在投影畫面上
- **頭像** — 用學員自己的 LeetCode 頭像，外框是組別色；沒有頭像、或圖載入失敗時
  才退回姓名首字配組別色
- **兩個排行榜** — 六組固定組別的組別排行放在畫面最上方中央，個人排行在左側，
  前五名固定不動、其餘自動輪播，70 人也都輪得到自己
- **顏色即身分** — 介面本身沒有彩度，畫面上每一抹顏色都代表某一組；難度改用字重
  編碼（純文字／描邊／實心），色盲也讀得出來。組別色在控制台可即時改 hex
- **觀看密碼** — 公開板與它的 API 可以上鎖，避免學員互相看作法。密碼預設來自
  `.env`，控制台可以臨時覆寫（只存在記憶體，重啟即失效）；改密碼會立刻中斷所有
  已連線的畫面
- **注意力導向輪詢** — 剛送出提交的人每 5 秒查一次，安靜的人指數退到 60 秒，全體
  合計不超過 `POLL_MAX_RPS`。全部題目關閉時完全不呼叫 API
- **改題即重算** — 刪題、改分數、改 bonus 級距都會立刻重算全體分數，不會出現同一
  題兩種身價
- **原子化持久化** — `data/contest.json` 以 `tmp + os.replace` 寫入並保留 `.bak`，
  重啟後狀態完整恢復
- **多 cookie 輪替** — `LEETCODE_SESSIONS` 支援逗號分隔，自動 round-robin + cooldown

## 前置需求

| 項目 | 需求 |
|------|------|
| Python | 3.11+ |
| Node.js | 20+ |
| LEETCODE_SESSION cookie | 選填（取得 beat-% 需要） |

## 安裝

```bash
git clone https://github.com/xinshoutw/leetcoard.git
cd leetcoard

# 後端
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env   # 至少填 ADMIN_TOKEN

# 前端
cd frontend
npm install
```

## 快速開始

```bash
# 後端（root 目錄）
uvicorn app.main:app --reload --port 8080

# 前端（frontend/）
npm run dev    # http://localhost:5173
```

打開 [`http://localhost:5173/`](http://localhost:5173/) 看計分板，
[`/dashboard`](http://localhost:5173/dashboard) 進控制台。
健康檢查：[`http://localhost:8080/api/health`](http://localhost:8080/api/health) 應回 `{"ok":true}`。

## 專案結構

```
leetcoard/
├── app/                          # FastAPI 後端
│   ├── main.py                   # ASGI entrypoint、lifespan
│   ├── core/
│   │   ├── auth.py               # 管理員 token 驗證（含 SSE query token）
│   │   ├── config.py             # 環境變數
│   │   ├── scoring.py            # beat-% 級距換算（純函式）
│   │   ├── sse.py                # SSE fanout（public / admin 分流）
│   │   └── storage.py            # 原子化 JSON 持久化（.tmp + .bak）
│   ├── domain/
│   │   ├── models.py             # Pydantic schema、Problem.accepts() 開放視窗
│   │   └── state.py              # ContestEngine：唯一計分權威
│   ├── routes/
│   │   ├── public.py             # 唯讀 snapshot / stream / health
│   │   └── admin.py              # 題目、開關、名單、組別、輪詢狀態
│   ├── integrations/
│   │   └── leetcode.py           # httpx client + cookie 輪替
│   └── workers/
│       └── polling.py            # 注意力導向輪詢排程
│
├── frontend/                     # React + Vite SPA
│   └── src/
│       ├── routes/
│       │   ├── Scoreboard.tsx    # 公開計分板（投影用）
│       │   └── Dashboard.tsx     # 控制台
│       ├── components/
│       │   ├── scoreboard/       # TeamBar / Standings / ProblemStack
│       │   │                     # PercentileTrack / Ticker
│       │   ├── dashboard/        # PracticePanel / ProblemsPanel
│       │   │                     # ParticipantsPanel / SolveStatusPanel
│       │   │                     # EventsPanel / Login
│       │   └── ui/               # Avatar / DifficultyMark / Switch / icons
│       ├── hooks/
│       │   ├── useContestStream.ts  # snapshot + SSE 對齊、自動重連
│       │   └── useAutoScroll.ts     # 個人榜輪播
│       └── lib/                  # api / color / score / types / leetcode
│
├── data/                         # contest.json（執行時產生，已 gitignore）
├── tools/                        # 離線示範用，不參與正式流程
│   ├── fake_leetcode_api.py      # 假的上游，會隨輪詢生出提交
│   └── seed_demo_board.py        # 產生一份有內容的 contest.json
│
├── tests/                        # pytest
└── pyproject.toml
```

## 計分規則

每位學員對每題：

1. **開放視窗** — 一題可以開開關關很多次，每一段開放區間都算數。AC 只要落在
   **任何一段**區間內就計分；落在關閉的空檔、或題目從沒開過，一律不計分
2. **基礎分** — 視窗內第一次 AC，加上題目設定的 `points`
3. **Beat-% 加分** — 可選，每題可設多階區間（例：`≥90% → +4`、`≥60% → +2`）。
   第一次 AC 套用對應階級，之後進步到更高階只補加差額
4. **無提交次數上限** — 想重送幾次都可以，每次都可能刷新 runtime。即使沒跨到更高
   階，賽道上的標記仍然會往右移動
5. **去重** — 同一個 `submission_id` 只計一次。讀不懂的提交（缺欄位、時間戳壞掉）
   不會被記成已讀，下一輪抓到完整資料仍然算數
6. **不在清單裡、或還沒開過的題** — 完全忽略，不記事件也不計分（事件是公開的，
   記下來等於把還沒公布的題名送上投影幕）

一批提交一律**由舊到新**處理，所以「第一次 AC」與同分順位不會因為兩題剛好被同一
次輪詢抓到而改變。

個人排名：分數高優先；同分以「最後一次得分的時間」較早者勝出。
組別排名：組員分數直接加總；同分以該組最後得分時間較早者勝出。未分組的學員不
列入任何組。

刪題、改 `points`、改 bonus 級距都會觸發全體重算，重算的依據是每位學員存下來的
「該題最佳 beat-%」與「最後得分時間」，不是事件紀錄（事件有 500 筆上限）。

**刪題是可還原的**：那題的解題紀錄會留著休眠而不是被抹掉，把題目加回清單，所有
人的分數就會原樣回來。這是刻意的——那些提交早就被標記為已讀、無法重新抓取，若
紀錄跟著題目一起消失，一次誤刪對全班就是不可逆的。

## 分組

固定六組，只能改組名與顏色，不能增減。指派方式三種都支援：

- 名單檔 `roster.txt`（見下節），開機時套用
- 控制台批量匯入同樣的 `組別,姓名,username`，即時生效
- 名單每列的下拉選單隨時改

組別分數是即時加總，換組不需要搬移任何資料，分數跟著人走。組別顏色只要有人
挑得偏暗（深紫、深青），壓在上面的字會自動翻成亮色，投影時才讀得到。

## 名單檔

`roster.txt` 放在專案根目錄，每行 `組別,姓名,username`，後端每次開機讀一次：

```
1,陳小明,alice
4,王小華,bob
```

- **`username` 是 LeetCode 帳號**，就是 `leetcode.com/u/<username>/` 中間那段。
  打錯不會有任何錯誤訊息，那個人只是永遠不會被輪詢、永遠 0 分
- 組別欄可留空，留空不會動到那個人原本的組別
- `#` 開頭與空行會略過
- **這個檔案說了算**：板上有、檔案裡沒有的人，開機時會連分數一起移除。所以臨時
  從控制台加進來的人，記得補回檔案，不然重開就不見了
- 檔案不存在時完全不動名單；檔案存在但一行都讀不出來時會拒絕套用（避免手滑清空全班）
- 改完要重開後端才生效；上課中要即時改，就把同樣幾行貼進控制台的「學員」面板

`roster.txt` 已在 `.gitignore` 內（裡面是真實姓名）。格式範本見 `roster.example.txt`，
換路徑用 `ROSTER_FILE`。

## 上課流程

1. 填好 `.env`（`ADMIN_TOKEN` 必換；`LEETCODE_SESSIONS` 沒填就沒有 beat-% 加分；
   要鎖住畫面就填 `VIEW_PASSWORD`）
2. 把名單寫進 `roster.txt`（`組別,姓名,username`）後啟動後端，開機日誌會印出
   實際套用了幾人
3. 控制台：
   - 確認六組的組名與顏色（預設已是這學期的六組）
   - 加題目、設分數與加分區間，按「儲存」
   - 需要的話在「觀看密碼」臨時換一組密碼，唸給全班
4. 開場時所有題目都是關閉的，公開板上看不到任何題目，後端也不會呼叫 LeetCode API
5. 要放哪一題就按哪一題的開關，題卡會出現在公開板上，輪詢同時啟動
6. 講解前把題目關掉，卡片與成績會留在板上並置灰
7. 需要重來時按「重置分數」，題目、名單、組別設定都會保留

## 環境變數

| Var | 預設 | 說明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | `change-me` | 控制台登入用，部署前必換 |
| `VIEW_PASSWORD` | `""` | 觀看公開板需要的密碼；留空 = 公開 |
| `LEETCODE_SESSIONS` | `""` | LEETCODE_SESSION cookie，逗號分隔多個 |
| `LEETCODE_API_BASE` | `https://leetcode-api-pied.vercel.app` | upstream API |
| `DATA_DIR` | `./data` | JSON 持久化資料夾 |
| `ROSTER_FILE` | `./roster.txt` | 名單檔；不存在就不動名單 |
| `POLL_MIN_INTERVAL_SEC` | `5` | 活躍學員的輪詢間隔下限 |
| `POLL_MAX_INTERVAL_SEC` | `60` | 安靜學員退避到的上限 |
| `POLL_MAX_RPS` | `6` | 全體合計請求上限（次/秒） |
| `POLL_RECENT_LIMIT` | `10` | 每次輪詢取的 submission 筆數 |
| `POLL_JITTER` | `0.2` | 抖動，避免同步突發 |
| `POLL_CONCURRENCY` | `8` | 同時在途請求數上限 |
| `POST_END_GRACE_SEC` | `90` | 最後一題關閉後仍輪詢的寬限期 |
| `LEETCODE_HTTP_TIMEOUT_SEC` | `10` | httpx 超時 |
| `CORS_ORIGINS` | `*` | 逗號分隔，正式環境填具體網域 |

## 沒有真人也能看畫面

`tools/` 下面兩支腳本可以把整條路徑跑起來，而且跑的是正式程式碼：假的上游會隨著
輪詢生出提交，輪詢器照常抓、引擎照常計分、SSE 照常推播。畫面上沒有任何東西是被
直接塞進去的。

```bash
# 1. 產生一份有 66 人、六題、各種可見度狀態的假資料
python tools/seed_demo_board.py ./demo-data 66

# 2. 假的 LeetCode API（FAKE_RATE 是每次輪詢生出提交的機率）
FAKE_RATE=0.25 uvicorn tools.fake_leetcode_api:app --port 9999

# 3. 後端指向它
ADMIN_TOKEN=demo-token VIEW_PASSWORD=demo DATA_DIR=./demo-data \
ROSTER_FILE=./demo-data/roster.txt \
LEETCODE_API_BASE=http://127.0.0.1:9999 uvicorn app.main:app --port 8080
```

`FAKE_RATE` 調高（0.25）會讓排名一直洗牌，適合看動畫；調低（0.05）比較接近真實
節奏。`FAKE_AVATARS=1` 會發假的頭像網址。seed 腳本會一併寫出對應的
`demo-data/roster.txt`，`ROSTER_FILE` 一定要跟著指過去，不然開機時會拿真實名單
去對，把 66 個假學員全部清掉。**別把 `DATA_DIR` 指到正式資料夾**，seed 腳本會
直接覆蓋狀態檔。

## 開發

```bash
# 後端測試
pytest -q

# 後端 lint
ruff check app tests

# 前端型別檢查
cd frontend && npm run lint

# 前端建置
npm run build
```

## 部署

### 後端（自架）

任何能跑 Python 3.11+ 且有 stable filesystem 的機器。對外用 nginx 或 cloudflared
反代，注意：

- SSE 需要 `proxy_buffering off;` 並把 `proxy_read_timeout` 拉長
- `.env` 的 `CORS_ORIGINS` 寫入前端網域

> **狀態檔格式會變**：`student_id` 已改名 `nickname`，題目的 `opened_at`/`closed_at`
> 已換成 `windows` 區間清單。載入不相容的舊檔會驗證失敗並退回預設狀態——**而預設
> 狀態現在帶著十五題**，所以畫面看起來像是設定好的，不會明顯空白，很容易誤以為載入
> 成功。每次寫入又會把主檔輪替成 `.bak`，連備份都會在兩次存檔內被覆蓋。**升級前先
> 刪掉 `data/contest.json` 與 `data/contest.json.bak`**，並在開機日誌確認
> `Loaded contest state from ...` 這行有出現。

範例 systemd unit：

```ini
[Service]
WorkingDirectory=/srv/leetcoard
EnvironmentFile=/srv/leetcoard/.env
ExecStart=/srv/leetcoard/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
Restart=always
```

### 前端（Cloudflare Workers）

```bash
cd frontend
npm install
npm run build
npx wrangler deploy
```

`wrangler.jsonc` 處理 SPA fallback；前端透過 `VITE_API_BASE` 直連 API origin
（不走 Worker proxy，避免無限轉發）。

## 已知假設

- 一台投影機播公開板，控制台由一位老師操作；一個 token，沒有多管理員角色
- 70+ 名學員的帳號被輪詢；同時開著公開板的瀏覽器數量假設不多
- 觀看密碼是全班共用的一組字串，擋的是隨手偷看，不是有心人；它跟 `ADMIN_TOKEN`
  完全分開，知道觀看密碼的人動不了任何設定
- `ADMIN_TOKEN` 只吃 `Authorization` header。SSE 因為 `EventSource` 不能帶 header
  才走 query string，而那條路徑只接受串流端點——但它仍然會進 access log，正式環境
  請把後端的 log 當敏感資料處理
- 兩組密碼都可以用中文或 emoji
- 組別固定六組，只能改名與改色
- 沒有「開題前是否已 AC 過該題」的檢查（需要學員本人 cookie，不可行）。實務上
  影響有限：輪詢只看最近幾筆提交，開題前的舊 AC 不會被抓到，學員得重新送出才會
  計分
- beat-% 需要 `LEETCODE_SESSIONS`；沒設定時百分位賽道會退回成單純的解題者列表

## 貢獻

歡迎 PR 與 Issue。送出前請確認：

1. 後端 `pytest -q` 與 `ruff check app tests` 通過
2. 前端 `npm run lint` 與 `npm run build` 通過
3. 分支以 `feature/...` 或 `fix/...` 命名
4. PR 目標分支為 `main`

## 授權

本專案採用 [MIT License](LICENSE) 授權。
