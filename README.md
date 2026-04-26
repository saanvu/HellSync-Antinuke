# 🔥 HellSync Anti-Nuke

<p align="center">
  <b>Real-time Discord server protection against raids, nukes, and abuse.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Protection-Anti--Nuke-red?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Anti-Spam-Enabled-orange?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Status-Stable-22c55e?style=for-the-badge"/>
</p>

---

## 🧠 What is HellSync Anti-Nuke?

HellSync Anti-Nuke is a **real-time security bot** designed to protect Discord servers from:

* Mass channel deletions
* Role wipes
* Ban waves
* Message spam

It actively monitors **audit logs + user behavior** and takes **automatic action** before damage spreads.

---

## ⚡ Core Features

### 🛡️ Anti-Nuke System

* Detects:

  * Channel deletion spam
  * Role deletion attacks
  * Mass banning

* Uses **time-window tracking** to identify malicious bursts

```js
NUKE_WINDOW_MS = 60000
CHANNEL_DELETE_THRESHOLD = 3
```

👉 If threshold is exceeded → instant punishment


---

### ⚡ Automatic Punishment System

* Primary action: **Timeout (24h)**
* Fallback: **Ban (if required)**

```js
member.timeout(NUKE_PUNISH_TIMEOUT_MS)
```

👉 Safe-first design (timeout > ban)


---

### 🧾 Audit Log Intelligence

* Identifies **who performed destructive actions**
* Filters out:

  * Server owner
  * Trusted users
  * Bot itself

```js
fetchAuditLogs({ type: AuditLogEvent.ChannelDelete })
```



---

### 🚫 Anti-Spam System

* Tracks message bursts per user
* Warns → then auto-timeouts

```js
SPAM_WINDOW_MS = 7000
SPAM_MAX_MESSAGES = 7
```



---

### 🔐 Trusted User System

* Whitelist specific users
* Bypass all protection logic

Commands:

* `hs!addtrusted @user`
* `hs!removetrusted @user`
* `hs!trustedlist`

```js
getGuildTrusted(guild.id)
```



---

### 📜 Auto Logging System

* Automatically creates:

  ```
  # hellsync-logs
  ```
* Logs:

  * Punishments
  * Toggles
  * Nuke detections

👉 Fully automatic — no setup needed


---

## ⚙️ Commands

| Command                  | Description              |
| ------------------------ | ------------------------ |
| `hs!antinuke on/off`     | Enable/disable anti-nuke |
| `hs!antispam on/off`     | Enable/disable anti-spam |
| `hs!addtrusted @user`    | Add trusted user         |
| `hs!removetrusted @user` | Remove trusted user      |
| `hs!trustedlist`         | View trusted users       |
| `hs!untimeout @user`     | Remove timeout           |

---

## 🏗️ Architecture

```id="as72dj"
Discord Events
     ↓
Audit Logs + Message Tracking
     ↓
Detection Engine
     ↓
Action System (Timeout / Ban)
     ↓
Logging System (#hellsync-logs)
```

---

## 🚀 Setup

### 1. Install dependencies

```bash
npm install
```

---

### 2. Create `.env`

```env
DISCORD_TOKEN=your_bot_token
PREFIX=hs!
```

---

### 3. Run the bot

```bash
npm start
```

---

## 🧠 How It Works (Simplified)

1. Tracks destructive actions per user
2. Groups actions within a time window
3. Compares against thresholds
4. Punishes instantly if exceeded

👉 This prevents:

* Raid bots
* Rogue admins
* Compromised accounts

---

## 🔥 Why HellSync?

Most bots react **after damage is done**.

HellSync:

* Detects patterns in real-time
* Acts before escalation
* Minimizes server damage

---

## ⚠️ Disclaimer

This bot has **moderation powers**:

* Timeout members
* Ban users

Ensure:

* Proper permissions are configured
* Trusted users are correctly set

---

## 💜 Part of HellSync System

This is the **Anti-Nuke module** of HellSync.

👉 Designed to work alongside:

* Main bot (interaction / immersion layer)

---

## ✦ Author

Built by **Saanvi**

> Protection isn’t optional. It’s built-in.
