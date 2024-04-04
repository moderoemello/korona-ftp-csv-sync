const ftp = require('basic-ftp');
const csvParser = require('csv-parser');
const axios = require('axios'); // for API calls
const fs = require('fs');
const util = require('util');
const appendFile = util.promisify(fs.appendFile);
const readFile = util.promisify(fs.readFile);
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

require('dotenv').config();

// Open a database connection
const db = new sqlite3.Database('./suppliers.db', (err) => {
    if (err) {
        console.error('Could not open database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create a table for suppliers if it doesn't exist
        db.run('CREATE TABLE IF NOT EXISTS suppliers (name TEXT PRIMARY KEY)', (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            }
        });
    }
});


async function downloadCSVs() {
    const client = new ftp.Client();
    client.ftp.verbose = true;

    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: false
        });

        console.log("Connected to the FTP server.");

        await client.cd("/OUT");
        const fileList = await client.list();
        console.log(`Total files listed: ${fileList.length}`);
        for (let file of fileList) {
            let newFileName = file.name;
            // Check if file name ends with .csv, if not, append it
            if (!newFileName.endsWith('.csv')) {
                newFileName += '.csv';
            }
            console.log(`Attempting to download: ${file.name}`);
            try {
                await client.downloadTo(`./${newFileName}`, file.name);
                console.log(`Downloaded ${file.name} and saved as ${newFileName}`);
            } catch (downloadError) {
                console.error(`Failed to download file ${file.name}:`, downloadError);
            }
        }
    } catch (error) {
        console.error("Failed to connect or list CSVs:", error);
    } finally {
        console.log("Closing FTP client.");
        client.close();
    }
}




function removeLeadingZeros(str) {
    return str.replace(/^0+/, '');
}

function removeUnderscores(str) {
    return str.replace(/_/g, '').slice(8);
}

async function convertCsvToJson(filename) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filename);
        const vendorsData = {}; // Object to hold data grouped by vendor

        stream
            .pipe(csvParser())
            .on('data', (row) => {
                const vendorName = row['Vendor Name'] || 'Unknown'; // Default to 'Unknown' if no vendor name

                // Initialize an array for the vendor if it doesn't exist
                if (!vendorsData[vendorName]) {
                    vendorsData[vendorName] = [];
                }

                // Add the row to the appropriate vendor's array
                vendorsData[vendorName].push(row);
            })
            .on('end', () => {
                // Convert each vendor's data into a separate JSON object
                const result = Object.keys(vendorsData).map(vendor => {
                    return {
                        vendor: vendor,
                        data: transformVendorDataToJSON(vendorsData[vendor], filename)
                    };
                });

                resolve(result);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

function transformVendorDataToJSON(vendorData, filename) {
    // Assume vendorData is an array of objects where each object represents a row from your CSV
    // We will now only use the first object from this array to create the stock receipt
    function sanitizeString(inputString) {
        // Replace all invalid characters with a dot "."
        // Allowed characters are a-z, A-Z, 0-9, äöü, ÄÖÜ, ß, and the special characters . and ;
        // The regex matches any character that is NOT in the allowed set and replaces it
        return inputString.replace(/[^a-zA-Z0-9äöüÄÖÜß.;]/g, '.');
    }
    function sanitizeString2(inputString) {
        // Check if the input string contains "(" or ")" characters
        if (inputString.includes("(") || inputString.includes(")")) {
            // Replace parentheses and other invalid characters with a dot "."
            // Allowed characters are a-z, A-Z, 0-9, äöü, ÄÖÜ, ß, and the special characters . and ;
            // The regex matches any character that is NOT in the allowed set and replaces it
            return inputString.replace(/[^a-zA-Z0-9äöüÄÖÜß.;()]/g, '.');
        }
        // Return the input string as is if no parentheses are found
        return inputString;
    }
    
    // Extract the first row from the vendorData array
    const firstRow = vendorData[0];

    // Proceed with your existing logic but only for the firstRow
    const now = new Date();
    const dateFormatted = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

    // Create a stockReceiptId using the filename and vendor name from the first row
    const stockReceiptId = filename + (firstRow['Vendor Name'] || 'UnknownVendor');

    // Since we're now only dealing with the firstRow, we don't need to map through the vendorData
    // We directly return an array with a single object for the stock receipt
    return [{
        "number": sanitizeString(stockReceiptId),
        "cashier": { "number": "1" },
        "description": `DATE:${firstRow['Invoice Date'] || ''} INVOICE#${firstRow['Invoice Number'] || ''}`,
        "itemsCount": firstRow['Invoice Item Count'], // Assuming you're counting items per row
        "organizationalUnit": {
            "number": removeLeadingZeros(firstRow['Retailer Store Number'])
        },
        "supplier": { "name": sanitizeString2(firstRow['Vendor Name']) || '' },
        "comment": `processed by api on ${dateFormatted}`
    }];
}

async function createSupplier(vendorName, username, password) {
    console.log("*******************SUPPLIER CREATION STARTED**********************");

    // Check if the supplier already exists in the database
    const supplierExists = await new Promise((resolve, reject) => {
        db.get('SELECT name FROM suppliers WHERE name = ?', [vendorName], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(!!row);
            }
        });
    });

    if (supplierExists) {
        console.log(`Supplier already created: ${vendorName}`);
        return true; // Supplier already exists, no need to create
    }

    const config = {
        method: 'post',
        url: `https://167.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/suppliers`,
        auth: { username, password },
        data: { "name": vendorName },
        params: {
            writeMode: 'ADD_OR_REPLACE'
        }
    };

    try {
        const response = await axios(config);
        if (response.status === 200) {
            console.log(`Supplier created successfully: ${vendorName}`);
            console.log("*******************SUPPLIER CREATION ENDED**********************");
            // Insert the new supplier into the database
            db.run('INSERT INTO suppliers (name) VALUES (?)', [vendorName], (err) => {
                if (err) {
                    console.error('Error inserting supplier into database:', err.message);
                }
            });
            return true;
        } else {
            console.error(`Failed to create supplier: ${vendorName}`);
            return false;
        }
    } catch (error) {
        console.error(`Error creating supplier: ${vendorName}`, error.message);
        return false;
    }
}



async function sendDataToApi(vendorData, username, password) {
    let receiptNumbers = []; // Store custom numbers along with vendor names

    createSupplier()
    for (const vendorObject of vendorData) {
        const dataToSend = vendorObject.data[0]; // Assuming each 'data' array has one object to send
        await createSupplier(vendorObject.vendor, username, password)
        const config = {
            method: 'post',
            url: `https://167.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/dispatchNotifications/`,
            auth: { username, password },
            data: dataToSend
        };

        console.log(`Sending data for vendor: ${vendorObject.vendor}`, config); // Log the config

        try {
            const response = await axios(config);
            console.log(`Data sent successfully for vendor: ${vendorObject.vendor}. Response:`, response); // Log the response

            // Use the custom number you've created for the stock receipt
            receiptNumbers.push({ vendor: vendorObject.vendor, stockReceiptId: dataToSend.number });

        } catch (error) {
            console.error(`Failed to send data for vendor: ${vendorObject.vendor}:`, error.message);
        }
    }

    return receiptNumbers; // Return the array of custom numbers and associated vendor names
}



async function convertCsvToJson2(filename, vendorName) {
    function sanitizeString2(inputString) {
        // Replace parentheses with an empty string
        // Allowed characters are a-z, A-Z, 0-9, äöü, ÄÖÜ, ß, and the special characters . and ;
        // The regex matches any character that is NOT in the allowed set and replaces it
        return inputString.replace(/[^a-zA-Z0-9äöüÄÖÜß.;]/g, '');
    }    
    const now = new Date();
    const dateFormatted = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filename);
        let items = []; // Array to hold all items from the CSV

        stream
            .pipe(csvParser())
            .on('data', (row) => {
                // Check if the row's vendor name matches the provided vendorName
                if (row['Vendor Name'] === vendorName) {
                    // Construct the JSON object for each row
                    let item = {
                        "name": row['Product Description'],
                        "shelfLife": `2018-11-22T09:40:21+01:00`, // Example date, adjust as needed
                        "amount": {
                            "ordered": parseInt(row['Quantity']),
                            "delivered": parseInt(row['Quantity'])
                        },
                        "identification": {
                            "buyer": "Elite",
                            "productCode": row['Case UPC'] || "0",
                            "supplier": vendorName || "UNASSIGNED"
                        },
                        "container": {
                            "quantity": 1 // Example value, adjust as needed
                        },
                        "importData": {
                            "assortment": {
                                "number": "1"
                            },
                            "commodityGroup": {
                                "name":  "Drinks", //row['Product Class'] ||
                            },
                            "name": row['Product Description'],
                            "prices": [
                                {
                                    "value": 1,
                                    "validFrom": "2024-03-24T14:15:22Z",
                                    "priceGroup": {
                                        "number": "1"
                                    },
                                }
                            ],
                            "codes": [
                                {
                                    "productCode": row['Product Number'],
                                    "containerSize": 1, // Example value, adjust as needed
                                }
                            ],
                            "sector": {
                                "number": "1"
                            },
                            "supplierPrices": [
                                {
                                    "supplier": {
                                        "name": vendorName || "UNASSIGNED",
                                    },
                                    "orderCode": row['Case UPC'] || "1001",
                                    "value": parseInt(row['Quantity']) === 0 ? 0 : parseInt(row['Quantity']) * parseInt(row['Units Per Pack']),
                                    "containerSize": row['Units Per Pack'], // Example value, adjust as needed
                                }
                            ]
                        }
                    };

                    // Add this item to the items array
                    items.push(item);
                }
            })
            .on('end', () => {
                // When the CSV file is fully read, resolve with the filtered items array
                resolve(items);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

async function sendDataInfoToSecondApi(jsonData, stockReceiptId, assignExistingProduct = true) {
    console.log("JSON DATA ********************** :  ", JSON.stringify(jsonData, null, 2));

    const config = {
        method: 'post',
        url: `https://167.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/dispatchNotifications/${stockReceiptId}/items`,
        auth: {
            username: process.env.USERNAME,
            password: process.env.PASSWORD
        },
        headers: {
            'Content-Type': 'application/json'
        },
        params: {
            assignExistingProduct: assignExistingProduct
        }
    };

    for (let item of jsonData) {
        config.data = item; // Set the data for each individual item
        console.log("&&&&&& * JSON OBECJT * &&&&&&&&&&& : ",item)
        try {
            const response = await axios(config);
            // Check if the response contains an array with a status of 'ERROR'
            if (Array.isArray(response.data) && response.data[0] && response.data[0].status === 'ERROR') {
                throw { response: { data: response.data } }; // Throw an error to trigger the catch block
            }
            console.log("Data sent successfully:", response.data);
        } catch (error) {
            console.error("Failed to send data:", error.response ? error.response.data : error);
        }
    }
}



// async function createProductInSystem(item) {
//     console.log(item.vendorName)
//     function sanitizeString(inputString) {
//         // Replace all invalid characters with a dot "."
//         // Allowed characters are a-z, A-Z, 0-9, äöü, ÄÖÜ, ß, and the special characters . and ;
//         // The regex matches any character that is NOT in the allowed set and replaces it
//         return inputString.replace(/[^a-zA-Z0-9äöüÄÖÜß.;]/g, '.');
//     }
//     const productData = [
//         {
//             "number": item.product.number,
//             "assortment": {
//                 "number": 1
//             },
//             "codes": [
//                 {
//                     "productCode": item.product.number,
//                     "containerSize": item.containerSize.number
//                 }
//             ],
//             "commodityGroup": {
//                 "name": item.commodityName.name
//             },
//             "lastPurchasePrice": item.purchasePrice.actual,
//             "name": item.productName.number,
//             "sector": {
//                 "number": item.sector.number
//             },
//             "supplierPrices": [
//                 {
//                     "supplier": {
//                         "name": item.vendorName
//                     },
//                     "orderCode": item.identification.productCode,
//                     "value": item.purchasePrice.actual,
//                     "containerSize": item.containerSize.number
//                 }
//             ],
//             "trackInventory": true
//         }
//     ];
//     console.log(productData)

//     const config = {
//         method: 'post',
//         url: `https://167.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/products`, // Replace with the correct URL for your product creation endpoint
//         auth: {
//             username: process.env.USERNAME,
//             password: process.env.PASSWORD
//         },
//         data: productData
//     };

//     try {
//         const response = await axios(config);
//         console.log("Product created successfully:", response.data);
//     } catch (error) {
//         console.error("Failed to create product:", error);
//     }
// }

async function main() {
    const checkInterval = 15 * 60 * 1000; // 15 minutes in milliseconds

    async function periodicCheck() {
        try {
            await downloadCSVs();

            const uploadedFilePath = path.join(__dirname, 'uploaded.txt');
            let uploadedFiles;

            try {
                const data = await readFile(uploadedFilePath, 'utf8');
                uploadedFiles = new Set(data.split('\n').map(line => line.trim()).filter(Boolean));
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    console.log('No uploaded files log found, creating a new one.');
                    uploadedFiles = new Set();
                } else {
                    console.error('Error reading the uploaded files log:', readError);
                    return;
                }
            }

            const csvFiles = fs.readdirSync('.').filter(file => file.endsWith('.csv'));
            console.log(`Downloaded CSV files: ${csvFiles}`);

            if (csvFiles.length === 0) {
                console.log("No CSV files were downloaded.");
                return;
            }

            for (const file of csvFiles) {
                if (uploadedFiles.has(file)) {
                    console.log(`File ${file} has already been processed and uploaded.`);
                    continue;
                }

                console.log(`Processing file: ${file}`);
                const jsonDataFirstApi = await convertCsvToJson(file);
                console.log(`Converted ${file} to JSON for first API.`);
                const username = process.env.USERNAME; // Assuming these are correctly set in your .env file
                const password = process.env.PASSWORD;
                // Send data to the first API and capture the stock receipt IDs
                const receiptNumbers = await sendDataToApi(jsonDataFirstApi, username, password);
                console.log("Receipt IDs:", receiptNumbers);
                // Now iterate over receiptIds to send item data to the second API
                for (const { vendor, stockReceiptId } of receiptNumbers) {
                    // Assuming convertCsvToJson2 is adjusted to only get items for the current vendor
                    // This might require passing vendor as a parameter and filtering items based on vendor name
                    const itemsForVendor = await convertCsvToJson2(file, vendor); // Now passing vendor name
                    await sendDataInfoToSecondApi(itemsForVendor, stockReceiptId);
                    console.log(`Sent item data for ${vendor} to second API with stockReceiptId ${stockReceiptId}.`);
                }

                // Log the uploaded file
                await appendFile(uploadedFilePath, file + '\n');
                console.log(`Logged ${file} as uploaded.`);
            }
        } catch (error) {
            console.error('Error during periodic check:', error);
        }
    }

    periodicCheck(); // Run immediately on start
    // setInterval(periodicCheck, checkInterval); // Schedule to run every 15 minutes
}

main();
