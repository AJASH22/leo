# 🌌 Miruro — SkyStream Plugin Repository

> Anime-only streaming for [SkyStream](https://github.com/akashdh11/skystream).
> AllAnime + Jikan + Kitsu + optional self-hosted HiAnime, with AniList/AniZip metadata and validated multi-provider streams.

## 🚀 Install in SkyStream

1. Open the **SkyStream** app.
2. Go to **Settings → Manage Extensions → Add Repository**.
3. Paste the URL:
   ```
   https://raw.githubusercontent.com/AJASH22/leo/main/repo.json
   ```
4. Tap **Add**, wait for the catalog to populate, then download the **Miruro** plugin.
5. Back on the home screen, use the **Provider** selector (bottom-right FAB) to switch to **Miruro**.

> The URL points at `AJASH22/leo` (the published fork of this repo). The `skystream deploy`
> workflow rewrites `repo.json#pluginLists` on every push, so the link stays current.

## 📦 Bundled plugins

| Plugin     | Package name    | Categories | Description                                       |
| ---------- | --------------- | ---------- | ------------------------------------------------- |
| Miruro     | `com.miruro`    | Anime      | Multi-source anime catalog + stream resolution.   |

## 🛠 Development

### Prerequisites

- Node.js 20+
- `npm install -g skystream-cli`

### Clone

```bash
git clone https://github.com/AJASH22/leo.git
cd leo
npm install
```

### Validate a plugin

```bash
skystream validate
```

### Test a single function

```bash
# Home screen
skystream test -p miruro -f getHome

# Search
skystream test -p miruro -f search -q "naruto"

# Detail page (replace with a real source-aware or legacy show id)
skystream test -p miruro -f load -q "<allanime-show-id>"

# Streams (v2 source-aware payload; legacy {hash,...} is still accepted)
skystream test -p miruro -f loadStreams -q '{"v":2,"source":"allanime","id":"<id>","episode":"1","dubStatus":"sub"}'
```

### Deploy locally

```bash
skystream deploy -u https://raw.githubusercontent.com/AJASH22/leo/main/
```

This regenerates `dist/plugins.json` and `dist/com.miruro.sky`. Push to `main` and the GitHub
Actions workflow does the same.

## 🧱 Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the provider and stream pipeline, and
[`docs/API.md`](docs/API.md) for AllAnime, Jikan, Kitsu, HiAnime, AniList, AniZip, and extractor hosts.

The plugin deliberately rejects manga, manhwa, manhua, novels, and other non-video records.
Configure an optional self-hosted HiAnime API from the SkyStream extension settings; it is never
required for catalog browsing. Common gotchas live in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## 🤝 Contributing

PRs are welcome. Before submitting:

1. `skystream validate` should pass.
2. `skystream test -p miruro -f getHome` should print `Status: SUCCESS`.
3. If you changed a public endpoint, update `docs/API.md`.

## 📄 License

[MIT](LICENSE) © 2024 ajash
