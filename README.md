# WhatsApp Scheduler Bot (REST API Version)

## 🚀 Setup & Installation

1. **Clone the repository**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Configure environment variables:**
   - Copy `.env.example` to `.env`
   - Fill in:
     - `API_TOKEN=your_secret_token`
     - `GOOGLE_SHEET_ID=your_google_sheet_id`
     - (Other values as needed, e.g., timezone, due window, etc.)

4. **Add your Google API credentials:**
   - Place your `creds.json` in the project root (do not commit real credentials to public repos).

## 🟢 Start the REST API Server

```bash
node server.js
```
- The first time, scan the WhatsApp QR code in the terminal to authenticate.

## 🔁 Trigger Message Sending

### 1. **Scheduled Messages (every X minutes)**
- Set `SCHEDULE_INTERVAL_MINUTES` in `.env` (default: 5)
- Run:
  ```bash
  node trigger-scheduler.js
  ```

### 2. **Instant Messages (all at once)**
- Run:
  ```bash
  node trigger-instant.js
  ```

### 3. **Manual Trigger (for testing)**
- Use curl or PowerShell:
  ```powershell
  $headers = @{
    "Authorization" = "Bearer your_secret_token"
    "Content-Type" = "application/json"
  }
  $body = '{"mode":"combined"}'
  Invoke-RestMethod -Uri "http://localhost:3000/send-now" -Method Post -Headers $headers -Body $body
  ```

## 🛑 Stopping the Server/Scripts

- Press `Ctrl+C` in the terminal to stop any running server or script.

## 📁 Files to Include in the Repo

- `server.js` (REST API server)
- `sendMessage.js` (message logic)
- `utils.js` (utility functions)
- `config.js`, `config.json` (configuration)
- `sheets.js` (Google Sheets logic)
- `scheduler.js` (scheduling logic)
- `schedule-persistence.js` (schedule saving/loading)
- `menu.js` (menu system, if keeping CLI)
- `index.js` (main entry for CLI/menu, optional)
- `trigger-scheduler.js` (scheduled trigger script)
- `trigger-instant.js` (instant trigger script)
- `.env.example` (template for environment variables)
- `README.md` (this file)
- `.gitignore` (see below)

## 🔒 Security & .gitignore

- **Never commit your real `.env` or `creds.json` to a public repo.**
- Add these to `.gitignore`:
  ```
  .env
  creds.json
  .wwebjs_auth/
  .wwebjs_cache/
  node_modules/
  saved-schedules.json
  ```

## 📝 What to Share for Testing

- The repo (with all code/scripts above)
- `.env.example` file
- Updated `README.md`
- Google Sheet link (with sample/test data)
- API token (or instructions to set their own)

## 🛠️ Additional Notes
- The CLI/menu system (`start.js`, `index.js`, `menu.js`) is optional for REST API use, but can be included for advanced/manual control.
- All message scheduling and sending is now triggered via the REST API or the provided trigger scripts.
- For any issues, check the logs in your terminal for errors or status updates.

# WhatsApp Scheduler Bot

A WhatsApp automation tool with advanced cron-based scheduling capabilities for bulk messaging and message queue processing. Supports multi-timezone scheduling, auto-stop/restart functionality, and Google Sheets integration.

## 🚀 Features

- **WhatsApp Integration**: Connect to WhatsApp Web for automated messaging
- **Bulk Messaging**: Send messages to multiple recipients from Google Sheets
- **Scheduled Messaging**: Process messages at specific times with timezone support
- **Multi-timezone Support**: Configure any timezone via environment variables
- **Auto-stop & Restart**: Schedules pause when complete, restart when new messages added
- **Google Sheets Integration**: Read data from Google Sheets for messaging
- **Image Support**: Send messages with images (including Google Drive links)
- **Error Handling**: Robust error handling and retry mechanisms
- **Status Tracking**: Track message delivery status in Google Sheets

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js** (v16 or higher) installed on your system
- **Google Sheets API** credentials set up
- **WhatsApp Web** access on your phone
- **Git** for cloning the repository

## 🛠️ Installation

### 1. Clone the Repository
```bash
git clone <your-repository-url>
cd whatsapp-bot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
```bash
# Copy the environment template
cp env_template.txt .env

# Edit the .env file with your configuration
```

**Required Environment Variables:**
```bash
# Timezone Configuration
DEFAULT_TIMEZONE=Asia/Kolkata

# Scheduling Configuration  
DUE_WINDOW_MINUTES=60

# Google Sheets Configuration
GOOGLE_SHEET_ID=your_sheet_id_here
```

### 4. Set Up Google Sheets API

#### Step 1: Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Sheets API

#### Step 2: Create Service Account
1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in service account details
4. Download the JSON credentials file

#### Step 3: Set Up Google Sheet
1. Create a new Google Sheet
2. Share it with your service account email (from the JSON file)
3. Copy the Sheet ID from the URL
4. Update `GOOGLE_SHEET_ID` in your `.env` file

#### Step 4: Add Credentials
1. Rename your downloaded JSON file to `creds.json`
2. Place it in the project root directory

### 5. Configure Your Sheet

Create a sheet with these columns:
- **Phone Numbers** (required): Recipient phone numbers
- **Message Text** (required): Message content  
- **Time** (optional): Scheduled time (HH:mm, dd/MM/yyyy HH:mm, etc.)
- **Image** (optional): Image URL or Google Drive link
- **Run** (optional): Set to "yes" to process
- **Status** (auto-updated): Delivery status
- **Campaign** (optional): Campaign name for tracking

## 🚀 Usage

### Starting the Bot
```bash
npm start
```

### First Time Setup
1. Run the bot: `npm start`
2. Scan the QR code with WhatsApp Web
3. Wait for connection confirmation
4. Use the menu to configure your team member

### Main Menu Options
1. **Send Messages Now** - Process instant messages (ignores time column)
2. **Send Scheduled Messages** - Process due scheduled messages
3. **Schedule Future Messages** - Set up recurring processing
4. **View Status & Schedules** - Monitor progress and active jobs
5. **Settings** - Manage schedules, team member, etc.
6. **Exit** - Close the application

## 📅 Scheduling Features

### Supported Time Formats
- **Time only**: `20:30`, `8:30 PM`
- **Date + Time**: `25/12/2024 20:30`, `2024-12-25 8:30 PM`
- **US Format**: `12/25/2024 8:30 PM`
- **ISO Format**: `2024-12-25 20:30`
- **Immediate**: `now`

### Cron Scheduling Examples
```bash
# Every 10 minutes
*/10 * * * *

# Every hour  
0 * * * *

# Daily at 9 AM
0 9 * * *

# Weekdays at 6 PM
0 18 * * 1-5

# Every Monday at 6 PM
0 18 * * 1
```

### Auto-Stop & Restart
- **Auto-stop**: Schedules pause when all scheduled messages are sent
- **Restart**: Add new messages to sheet, then use "Restart Stopped Schedule"
- **Preserved**: Schedule settings are kept for future use

## 🌍 Timezone Configuration

Set your timezone in the `.env` file:
```bash
DEFAULT_TIMEZONE=Asia/Kolkata
```

**Popular Timezones:**
- `Asia/Kolkata` - India (IST)
- `America/New_York` - Eastern Time (ET)
- `Europe/London` - British Time (GMT/BST)
- `Asia/Tokyo` - Japan (JST)
- `Australia/Sydney` - Australia (AEST/AEDT)

## 📊 Google Sheets Structure

### Example Sheet Layout
| Phone Numbers | Message Text | Time | Image | Run | Status | Campaign |
|---------------|--------------|------|-------|-----|--------|----------|
| 919078840822 | Hello! | 20:30 | https://... | yes | Sent | Campaign 1 |
| 919078840823 | Hi there! | | | yes | Pending | Campaign 1 |

### Phone Number Formats
- **Single**: `919078840822`
- **Multiple**: `919078840822, 919078840823`
- **With country code**: `+919078840822`
- **International**: `+1234567890`

## 🔧 Configuration Files

### .env
```bash
# Timezone Configuration
DEFAULT_TIMEZONE=Asia/Kolkata
DUE_WINDOW_MINUTES=60

# Google Sheets Configuration
GOOGLE_SHEET_ID=your_sheet_id_here
```

### config.json
```json
{
  "teamMember": "your_name",
  "bulkSheet": "BulkMessages_your_name",
  "queueSheet": "MessageQueue_your_name"
}
```

## 🚨 Troubleshooting

### Common Issues

**1. QR Code Not Scanning**
- Ensure WhatsApp Web is not active on other devices
- Try refreshing the QR code
- Check internet connection

**2. Google Sheets Access Error**
- Verify service account has edit permissions
- Check if `creds.json` is in the correct location
- Ensure Google Sheets API is enabled

**3. Messages Not Sending**
- Check phone number format
- Verify WhatsApp connection status
- Check for rate limiting (wait 1-2 minutes between messages)

**4. Timezone Issues**
- Verify `DEFAULT_TIMEZONE` in `.env`
- Check time format in your sheet
- Use 24-hour format for consistency

### Debug Mode
For detailed logging, check the console output for:
- Connection status
- Message processing details
- Error messages with row numbers

