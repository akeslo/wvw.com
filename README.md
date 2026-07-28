# Akeslo Apps

[![Validate apps.json](https://github.com/akeslo/wvw.com/actions/workflows/validate.yml/badge.svg)](https://github.com/akeslo/wvw.com/actions/workflows/validate.yml)

This repo contains the [`apps.json`](apps.json) data file that powers my [Appetit](https://wvw.dev) app store.

## Apps

| App | Platform | Description |
|-----|----------|-------------|
| [Bridge Your Budget](https://bridgeyourbudget.com) | Web | Auto-sync Amazon purchases to YNAB |
| [Breathe Wisely](https://apps.apple.com/us/app/breathe-wisely/id6744491087) | iOS | Guided breathing and meditation exercises |
| [PinkCloud Timer](https://apps.apple.com/us/app/pinkcloud-timer/id6744997715) | iOS | Sobriety tracking with second-level precision |
| [Rerun Timer](https://apps.apple.com/us/app/rerun-timer/id6755941416) | iOS | Looping interval timer with Live Activities |
| [Unified Audio Control](https://github.com/akeslo/Unified-Audio-Control) | macOS | Menu bar audio and display manager |
| [WhisperWrap](https://github.com/akeslo/WhisperWrap) | macOS | System-wide dictation and transcription |
| [Podcast Ad Remover](https://github.com/akeslo/podcast-ad-remover) | Python | AI-powered podcast ad detection and removal |
| [AI User Scripts](https://github.com/akeslo/AI_User_Scripts) | Browser | Bulk delete AI chat conversations |

## How it works

The `apps.json` file follows the [Appetit schema](https://wvw.dev/apps.schema.json). It defines the store metadata, categories, featured apps, and app listings. Appetit reads this file to render the storefront.

## Development

### Local Validation

To validate `apps.json` against the schema before pushing:

```bash
npm install
npm test
```

Or use the dedicated validate command:

```bash
npm run validate path/to/apps.json
```

This runs the same validation that runs in CI, catching schema violations early.

## License

MIT
