# 🤖 WhatsApp Issue Tracker Bot

A powerful WhatsApp bot for managing issues, tasks, and team coordination directly in WhatsApp. Built with Node.js and deployed on Render using Docker.

![Status](https://img.shields.io/badge/status-active-success)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Docker](https://img.shields.io/badge/docker-ready-blue)

## ✨ Features

### 📋 Issue Management

- Create, assign, and track issues in WhatsApp
- Support for multiple assignees
- Track issue history and completion status
- View personal assignments with `$issue my`

### 👥 Team Coordination

- Mention all group members with `$everyone`
- Filter mentions by admin/non-admin
- Assign tasks to specific team members
- Track who created and completed issues

### 🔒 Admin Controls

- Owner-only commands for group management
- Secure admin verification
- Protected mention everyone feature

## 🚀 Quick Start

**Deploy in 10 minutes!** See [QUICKSTART.md](./QUICKSTART.md)

```bash
# 1. Clone and push to GitHub
git clone <your-repo>
git push origin main

# 2. Deploy on Render (using render.yaml)
# 3. Scan QR code from logs
# 4. Set OWNER_NUMBER in environment variables
# 5. Done! 🎉
```

## 📖 Commands

### Help

```
$help - Show all commands
```

### Issue Management

```
$issue add <title>           - Create new issue
$issue list                  - List all open issues
$issue closed                - List completed issues
$issue my                    - Show your assigned issues
$issue assign <id> self      - Assign issue to yourself
$issue assign <id> @user1 @user2  - Assign to multiple people
$issue unassign <id>         - Remove all assignments
$issue unassign <id> @user   - Remove specific person
$issue complete <id>         - Mark issue as complete
$issue delete <id>           - Delete an issue
```

### Admin Commands (Owner Only)

```
$everyone     - Mention all group members
$everyone jc  - Mention non-admin members only
$everyone sc  - Mention admin members only
```

## 📁 Project Structure

```
whatsapp-bot/
├── main.js              # Main application code
├── package.json         # Dependencies
├── Dockerfile          # Docker container config
├── .dockerignore       # Docker ignore rules
├── render.yaml         # Render deployment config
├── .env.example        # Environment variables template
├── README.md           # This file
├── QUICKSTART.md       # Quick deployment guide
├── DEPLOYMENT.md       # Detailed deployment guide
└── data/
    └── issues.json     # Issue storage (auto-created)
```

## 🛠️ Technology Stack

- **Runtime**: Node.js 20 LTS
- **WhatsApp**: whatsapp-web.js
- **Browser**: Puppeteer with Chromium
- **Web Server**: Express
- **Deployment**: Docker on Render
- **Storage**: File-based JSON + Persistent disk

## 🔧 Configuration

### Environment Variables

| Variable       | Required | Description              | Example            |
| -------------- | -------- | ------------------------ | ------------------ |
| `RENDER`       | Yes      | Tells app it's on Render | `true`             |
| `NODE_ENV`     | Yes      | Environment mode         | `production`       |
| `PORT`         | Yes      | HTTP server port         | `3001`             |
| `OWNER_NUMBER` | Yes\*    | Bot owner WhatsApp ID    | `13105551234@c.us` |

\*Required for admin commands to work

### Getting Your OWNER_NUMBER

1. Deploy the bot first
2. Scan QR code to authenticate
3. Check logs for: `📱 Your number: xxxxx@c.us`
4. Set that value as `OWNER_NUMBER` in Render
5. Redeploy

## 🐳 Docker Deployment

### Build Locally

```bash
docker build -t whatsapp-bot .
```

### Run Locally

```bash
docker run -p 3001:3001 \
  -v $(pwd)/data:/app/data \
  -e OWNER_NUMBER=your_number@c.us \
  whatsapp-bot
```

### Deploy on Render

Render automatically builds and deploys using `Dockerfile` and `render.yaml`.

## 📊 Monitoring

### Health Check Endpoint

```
GET https://your-app-name.onrender.com/health
```

Response:

```json
{
  "status": "running",
  "whatsappReady": true,
  "uptime": 12345,
  "timestamp": "2025-10-20T10:00:00.000Z",
  "nodeVersion": "v20.x.x",
  "memoryUsage": {...},
  "environment": "render"
}
```

### Logs

Monitor in real-time via Render Dashboard:

- Application logs
- Error messages
- Message activity
- Issue operations

## 🔒 Security

- **No credentials in code** - All sensitive data in environment variables
- **Owner verification** - Admin commands restricted to bot owner
- **No database exposure** - File-based storage with proper permissions
- **Secure session** - WhatsApp session stored in persistent disk
- **HTTPS only** - All traffic encrypted on Render

## 🆘 Troubleshooting

### Bot Not Responding

1. Check health endpoint: `/health`
2. Verify `whatsappReady: true`
3. Check Render logs for errors
4. Ensure service is not sleeping (free tier)

### Admin Commands Not Working

1. Verify `OWNER_NUMBER` is set
2. Check format: `[country_code][number]@c.us`
3. No spaces, dashes, or parentheses
4. Match exactly from logs

### Session Lost After Restart

1. Add persistent disk in Render
2. Mount path: `/app/.wwebjs_auth`
3. Size: 1 GB minimum
4. Redeploy service

### Memory Issues

1. Upgrade Render plan for more RAM
2. Monitor memory usage in health endpoint
3. Check for memory leaks in logs

## 📈 Scaling

### Free Tier

- Perfect for small teams (< 10 people)
- Sleeps after 15 minutes inactivity
- Use uptime monitoring to keep alive

### Starter Plan ($7/month)

- No sleeping
- Better performance
- Recommended for active teams

### Pro Features

- Multiple instances
- Auto-scaling
- High availability
- Custom domains

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details

## 👨‍💻 Author

**Adhyan Jain**

## 🙏 Acknowledgments

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) - WhatsApp Web API
- [Puppeteer](https://pptr.dev/) - Headless Chrome automation
- [Render](https://render.com/) - Deployment platform

## 📚 Documentation

- [Quick Start Guide](./QUICKSTART.md) - Get started in 10 minutes
- [Deployment Guide](./DEPLOYMENT.md) - Detailed deployment instructions
- [API Documentation](https://wwebjs.dev/) - WhatsApp Web.js docs

## 🔗 Links

- **Live Demo**: `https://your-app-name.onrender.com`
- **Health Check**: `https://your-app-name.onrender.com/health`
- **Source Code**: Your GitHub repo
- **Issues**: GitHub Issues tab

## 📞 Support

Having issues? Check:

1. [DEPLOYMENT.md](./DEPLOYMENT.md) - Troubleshooting section
2. Application logs in Render Dashboard
3. Health endpoint status
4. GitHub Issues for bug reports

---

**Made with ❤️ for better team coordination**

_Deploy once, manage everywhere_ 🚀
