# grok-search-skills

A lightweight local script bundle for xAI Grok, using the Responses API with server-side search tools:

- `web_search`: web lookup
- `x_search`: X/Twitter lookup

## Included Scripts

- `scripts/grok_search.mjs`: unified search entry point (`web` / `x`)
- `scripts/chat.mjs`: general chat interface (supports image input)
- `scripts/models.mjs`: list available models
- `scripts/utils/readKeyFromEnv.mjs`: shared `XAI_API_KEY` loader

## API Key Resolution

OpenClaw-compatible, resolved in this order:

1. `process.env.XAI_API_KEY`
2. `~/.clawdbot/clawdbot.json`
3. `~/.openclaw/openclaw.json`

## Usage

For detailed commands, flags, and examples, see [SKILL.md](./SKILL.md).
