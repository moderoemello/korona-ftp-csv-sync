# Node.js CSV & FTP Integration with API Communication
Overview

This project automates the process of downloading CSV files from an FTP server, parsing them into JSON, and sending the data to specified APIs for processing. Built with Node.js, it leverages basic-ftp for FTP operations, csv-parser for parsing CSV files, axios for API communications, and dotenv for managing environment variables. This tool is designed to streamline data workflows, making it ideal for tasks such as inventory updates, data analysis, and more.


Features

FTP Server Integration: Automatically connect to and download CSV files from an FTP server.

CSV File Parsing: Efficiently parse CSV files into JSON format for easy data manipulation.

API Communication: Send processed data to REST APIs with comprehensive error handling.

Secure Configuration: Use environment variables for secure and flexible configuration.

Prerequisites

Before you begin, ensure you have the following installed on your system:


Node.js (v12.x or later recommended)

npm (typically comes with Node.js)

Getting Started

1. Clone the Repository
   
<code>git clone https://github.com/yourusername/nodejs-csv-ftp-api-integration.git

cd nodejs-csv-ftp-api-integration</code>

Install the necessary Node.js modules specified in package.json:
   
<code>npm install</code>

3. Configure Environment Variables

Copy the .env.example file to a new file named .env, and fill in the environment variables with your own settings:
<code>cp .env.example .env</code>

Edit the .env file to include your FTP server details and API credentials:

FTP_HOST=your_ftp_server.com

FTP_USER=your_username

FTP_PASSWORD=your_password

USERNAME=api_user

PASSWORD=api_password

4. Running the Application
To start the application, run:

<code>node index.js</code>

This will initiate the process of connecting to the FTP server, downloading CSV files, parsing them, and sending the data to the configured API endpoints.

Usage Guide

Download CSVs: The application automatically downloads all CSV files from the specified FTP server directory.

Convert CSV to JSON: After downloading, each CSV file is converted into JSON format based on the mapping defined in the code.

API Data Transfer: The JSON data is then sent to the API endpoints using the credentials provided in the .env file.

