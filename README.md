┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 
KORONA FTP CSV SYNC PROJECT      

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

Environment Variables
Create a .env file in the project root (same folder as index.js) with the following variables:
# FTP SETTINGS

FTP_HOST=ftp.yourserver.com

FTP_USER=yourFtpUsername

FTP_PASSWORD=yourFtpPassword

# KORONA API SETTINGS

CLUSTER=yourKoronaCluster

API_KEY=yourAccountID

USERNAME=yourKoronaUsername

PASSWORD=yourKoronaPassword

# ORGANIZATIONAL UNIT MATCH (Store Number)

ORG_UNIT_TO_MATCH=3

# (Optional) CSV Column Overrides

VENDOR_NAME_KEY=Vendor Name

PRODUCT_DESCRIPTION_KEY=Product Description

UNIT_COST_KEY=Unit Cost

PACKS_PER_CASE_KEY=Packs Per Case

QUANTITY_KEY=Quantity

PRODUCT_NUMBER_KEY=Pack UPC

PRODUCT_NUMBER_KEY2=

CASE_UPC_KEY=Case UPC

GL_CODE_KEY=GL Code

SUPPLIER_ITEM_NUMBER=Product Number

RETAILER_NAME=unknown

UNITS_PER_PACK=

STORE_NUMBER_KEY=Retailer Store Number

UNIT_OF_MEASURE=

DISCOUNT_ADJUSTMENT_TOTAL=

Adjust them to match your CSV columns, store number, etc.

<br/>

★Usage★

Edit .env with your FTP and KORONA API credentials.

Run the script: node index.js

The script downloads all new .csv files from your FTP folder (/OUT), processes them, and sends data to KORONA’s API.

Once processed, filenames are appended to uploaded.txt to prevent duplicate processing.
<br/>

Check logs and uploaded.txt to confirm processed files.

Check your KORONA account to ensure new dispatchNotifications (stock receipts) and supplier entries appear.
<br/>

Feel free to rename index.js or adjust the script to your liking—just keep the .env and code consistent. Enjoy your KORONA FTP CSV SYNC project!
