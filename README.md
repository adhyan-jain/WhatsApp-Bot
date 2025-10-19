# WhatsApp Bot

A small WhatsApp bot using whatsapp-web.js.

## Requirements

- Node.js (v16+ recommended)
- npm or yarn

## Install

Run in the project root:

```bash
npm install
```

## Run

Start the bot and scan the QR code with your phone (first run):

```bash
node main.js
```

Notes

- The bot uses `LocalAuth` to persist session data. If you send messages from the same account the bot is logged into, some libraries mark those messages as `fromMe` (self-sent) and behavior can differ. If you want the bot to respond to messages you send from the same account, inspect `msg.fromMe` / `msg.author` fields in the message handler and adjust logic accordingly.

Environment variable

- Set your owner number in the environment so the bot can recognize owner-only commands. The variable name is `OWNER_NUMBER` and should be your phone number with or without the `@c.us` suffix. Examples:

```bash
# Unix / macOS
export OWNER_NUMBER=9112345678

# Windows (PowerShell)
$env:OWNER_NUMBER = '9112345678@c.us'
```

When `main.js` runs it will normalize the value to the internal WhatsApp ID form (append `@c.us` if missing).

GitHub API access

- If the repository is private or you need higher rate limits, set a `GITHUB_TOKEN` environment variable (a personal access token) before running the bot.

```bash
# Unix / macOS
export GITHUB_TOKEN=ghp_xxxYOURTOKENxxx

# Windows (PowerShell)
$env:GITHUB_TOKEN = 'ghp_xxxYOURTOKENxxx'
```

The bot currently fetches issues for a repository hard-coded in `main.js` (owner/repo). You can change those values directly in the file or extend it to accept environment variables.

Usage

- Fetch default repository issues (from `main.js` or env overrides):

```text
!issues
```

- Fetch issues for any repo you have access to by specifying owner/repo:

```text
!issues owner/repo
```

Environment overrides

- You can set these environment variables to change defaults without editing code:

```bash
export GITHUB_OWNER=some-owner
export GITHUB_REPO=some-repo
```

The bot will use `GITHUB_TOKEN` for authenticated requests (must be a PAT or installation token) and can fetch issues for any repo the token has access to.
