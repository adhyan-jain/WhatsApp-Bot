# WhatsApp GitHub Integration Bot

A powerful WhatsApp bot that integrates with GitHub webhooks to provide real-time notifications and manage issues directly from WhatsApp.

## 🌟 Features

### GitHub Webhook Integration
- **Real-time notifications** for GitHub events:
  - Issues (opened, closed, assigned, unassigned, reopened, edited)
  - Pull Requests (opened, merged, closed, reopened, edited, review requested)
  - Issue Comments (created, edited, deleted)
- **Auto-sync**: GitHub issues automatically sync with local issue tracker

### Issue Tracker
- Create and manage issues directly from WhatsApp
- Assign issues to team members using @mentions
- Set deadlines for tasks
- Track open and closed issues
- View your assigned issues
- All data stored in-memory (resets on restart)

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- A GitHub repository
- A WhatsApp account
- Docker (optional, for containerized deployment)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd whatsapp-github-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
# WhatsApp Configuration
WHATSAPP_GROUP_ID=123456789-1234567890@g.us

# GitHub Webhook Configuration
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
GITHUB_REPO=username/repository  # Optional: filter events from specific repo

# Server Configuration
PORT=3000
RENDER=false  # Set to true if deploying on Render

# Docker (Optional)
DOCKER=false  # Set to true if running in Docker
```

### 4. Get WhatsApp Group ID

Run the bot once to get your group ID:

```bash
npm start
```

Scan the QR code with WhatsApp, then send a message in your target group. Check the console logs for the group ID (format: `123456789-1234567890@g.us`).

### 5. Configure GitHub Webhook

1. Go to your GitHub repository
2. Navigate to **Settings** → **Webhooks** → **Add webhook**
3. Set the Payload URL to: `https://your-domain.com/github/webhook`
4. Set Content type to: `application/json`
5. Set the Secret to match your `GITHUB_WEBHOOK_SECRET`
6. Select individual events:
   - Issues
   - Pull requests
   - Issue comments
7. Click **Add webhook**

### 6. Start the Bot

```bash
npm start
```

## 🐳 Docker Deployment

### Build the Image

```bash
docker build -t whatsapp-github-bot .
```

### Run the Container

```bash
docker run -d \
  --name whatsapp-bot \
  -p 3000:3000 \
  -e WHATSAPP_GROUP_ID="your-group-id" \
  -e GITHUB_WEBHOOK_SECRET="your-secret" \
  -e GITHUB_REPO="username/repo" \
  -e DOCKER=true \
  -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth \
  whatsapp-github-bot
```

### Docker Compose

```yaml
version: '3.8'

services:
  whatsapp-bot:
    build: .
    ports:
      - "3000:3000"
    environment:
      - WHATSAPP_GROUP_ID=${WHATSAPP_GROUP_ID}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - GITHUB_REPO=${GITHUB_REPO}
      - DOCKER=true
    volumes:
      - ./.wwebjs_auth:/app/.wwebjs_auth
    restart: unless-stopped
```

## 📱 WhatsApp Commands

### Issue Management

| Command | Description |
|---------|-------------|
| `$help` | Show all available commands |
| `$issue add <title>` | Create a new issue |
| `$issue list` | List all open issues |
| `$issue closed` | List all closed issues |
| `$issue my` | List your assigned issues |
| `$issue assign <id> self` | Assign issue to yourself |
| `$issue assign <id> @mention` | Assign to mentioned person |
| `$issue unassign <id>` | Remove all assignments |
| `$issue update <id> <new title>` | Update issue title |
| `$issue deadline <id> <YYYY-MM-DD>` | Set deadline |
| `$issue deadline <id> remove` | Remove deadline |
| `$issue complete <id>` | Mark issue as complete |
| `$issue reopen <id>` | Reopen a closed issue |

### Example Usage

```
$issue add Fix login bug
$issue assign 1 self
$issue deadline 1 2025-11-01
$issue complete 1
```

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/health` | GET | Detailed status information |
| `/github/webhook` | POST | GitHub webhook endpoint |

## 🏗️ Project Structure

```
whatsapp-github-bot/
├── index.js              # Main application file
├── package.json          # Node.js dependencies
├── .env                  # Environment variables (create this)
├── .gitignore           # Git ignore rules
├── .dockerignore        # Docker ignore rules
├── Dockerfile           # Docker configuration
├── README.md            # This file
└── .wwebjs_auth/        # WhatsApp session data (auto-generated)
```

## 🔒 Security Notes

1. **Never commit** your `.env` file or `.wwebjs_auth` directory
2. **Use strong secrets** for `GITHUB_WEBHOOK_SECRET`
3. **Verify webhook signatures** are enabled (handled automatically)
4. **Keep dependencies updated** with `npm audit fix`
5. **Limit webhook access** by setting `GITHUB_REPO` filter

## ⚠️ Important Notes

- **Data Persistence**: All issue data is stored in-memory and will be lost on restart
- **WhatsApp Session**: The `.wwebjs_auth` directory maintains your WhatsApp session
- **Rate Limits**: Be mindful of WhatsApp's rate limits when sending messages
- **GitHub Sync**: GitHub issues automatically create local issues when opened

## 🐛 Troubleshooting

### QR Code Not Appearing
- Ensure your terminal supports QR code rendering
- Check if port 3000 is available
- Verify Chromium is installed (for Docker deployments)

### Webhook Not Working
- Verify the webhook URL is publicly accessible
- Check `GITHUB_WEBHOOK_SECRET` matches in both GitHub and `.env`
- Review GitHub webhook delivery logs
- Check server logs for signature verification errors

### WhatsApp Disconnects
- The bot will automatically attempt to reconnect
- If issues persist, delete `.wwebjs_auth` and re-scan QR code
- Check Chromium/Puppeteer compatibility

### Docker Issues
- Ensure Chromium is installed in the container
- Verify volume mounts for `.wwebjs_auth`
- Check container logs: `docker logs whatsapp-bot`

## 📦 Dependencies

- **whatsapp-web.js**: WhatsApp Web API
- **express**: Web server framework
- **qrcode-terminal**: QR code rendering
- **dotenv**: Environment variable management
- **crypto**: Webhook signature verification

## 🚀 Deployment Options

### Render.com
1. Create a new Web Service
2. Connect your GitHub repository
3. Set environment variables in Render dashboard
4. Deploy!

### Railway.app
1. Create new project from GitHub
2. Add environment variables
3. Deploy automatically on push

### VPS/Cloud Server
1. Clone repository
2. Install Node.js and dependencies
3. Use PM2 for process management: `pm2 start index.js --name whatsapp-bot`
4. Set up reverse proxy (nginx) for HTTPS

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 💬 Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

Made with ❤️ for seamless GitHub + WhatsApp integration