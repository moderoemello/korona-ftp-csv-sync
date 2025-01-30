┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃           KORONA FTP CSV SYNC PROJECT               ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

A simple Node.js project to:
1. Download CSV files from an FTP server
2. Convert and send their contents to KORONA Cloud
3. Handle supplier creation if missing in KORONA
4. Log processed files to avoid duplicates

<br/>

## ★ Table of Contents
1. [Project Setup](#project-setup)
2. [Environment Variables](#environment-variables)
3. [Usage](#usage)
4. [Full Source Code](#full-source-code)

<br/>

---
### Project Setup
---
1. **Install Dependencies**  
   ```bash
   npm install
Upon first run, this script automatically creates an SQLite database file named suppliers.db if it doesn't already exist.

Run the service:
node index.js

or use any name your file has.
<br/>
