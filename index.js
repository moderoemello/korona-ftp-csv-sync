 
const ftp = require('basic-ftp');
const csvParser = require('csv-parser');
const axios = require('axios'); // for API calls
const fs = require('fs');
const util = require('util');
const appendFile = util.promisify(fs.appendFile);
const readFile = util.promisify(fs.readFile);
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const stream = require('stream');
const finished = promisify(stream.finished);
require('dotenv').config();

let supplierCache = [];
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


//modify this to change where the files are downloaded from
async function downloadCSVs() {
    const client = new ftp.Client();
    client.ftp.verbose = true;

    try {
        // Read uploaded files log
        const uploadedFilePath = path.join(__dirname, 'uploaded.txt');
        let uploadedFiles;
        try {
            const data = await readFile(uploadedFilePath, 'utf8');
            uploadedFiles = new Set(
                data.split('\n').map((line) => line.trim()).filter(Boolean)
            );
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                console.log('No uploaded files log found, creating a new one.');
                uploadedFiles = new Set();
            } else {
                console.error('Error reading the uploaded files log:', readError);
                return;
            }
        }

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
            if (!newFileName.endsWith('.csv')) {
                newFileName += '.csv';
            }

            // Check if the file has already been processed
            if (uploadedFiles.has(newFileName)) {
                console.log(`File ${newFileName} has already been processed. Skipping download.`);
                continue;
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

async function convertCsvToJson(filename) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filename);
        const vendorsData = {}; // Object to hold data grouped by vendor

        stream
            .pipe(csvParser())
            .on('data', (row) => {//remove 3 after
                const vendorName = row['Vendor Name']|| 'Unknown'; // Default to 'Unknown' if no vendor name


                // Skip rows where 'Retailer Store Number' is not '3'
                if (row['Retailer Store Number'] !== `${process.env.ORG_UNIT_TO_MATCH}`) {//***************************************************************8 */
                    return; // Skip this iteration, do not add the row
                }

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
    // We will now use all unique 'Invoice Number' values to create the stock receipt

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

    // Collect all unique invoice numbers from the vendorData array
    const uniqueInvoiceNumbers = new Set();
    vendorData.forEach(row => {
        const invoiceNumber = row['Invoice Number'] || '';
        if (invoiceNumber) {
            uniqueInvoiceNumbers.add(invoiceNumber);
        }
    });

    // Join all unique invoice numbers into a single string for the description
    const invoiceNumbersDescription = Array.from(uniqueInvoiceNumbers).join(', ');

    const now = new Date();
    const dateFormatted = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

    // Create a stockReceiptId using the filename and vendor name from the first row
    const stockReceiptId = filename + (vendorData[0]['Vendor Name'] || '$UnknownVendor');

    // Include 'Invoice Number' explicitly in the returned JSON for use in other functions
    return vendorData.map(row => {
        return {
            "number": sanitizeString(stockReceiptId),
            "cashier": { "number": "1" },
            "description": `DATE:${row['Invoice Date'] || '$UnknownInvoiceDate'} INVOICES#${row['Invoice Number'] || 'UnknownInvoiceNumber'}`,
            "itemsCount": 0, // Assuming you're counting items per row
            "organizationalUnit": {
                "number": removeLeadingZeros(row['Retailer Store Number'])
            },
            "supplier": { "name": sanitizeString2(row['Vendor Name']) || '$UnknownVendor' },
            "invoiceNumber": row['Invoice Number'],  // Explicitly adding the invoice number
            "comment": `processed by api on ${dateFormatted}`
        };
    });
}

async function loadSupplierCache() {
    const config = {
        method: 'get',
        url: `https://${process.env.CLUSTER}.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/suppliers`,
        auth: {
            username: process.env.USERNAME, 
            password: process.env.PASSWORD
        }
    };

    try {
        const response = await axios(config);
        if (response.status === 200 && response.data.results) {
            supplierCache = response.data.results.map(supplier => supplier.name);
            console.log('Supplier cache loaded successfully');
        } else {
            console.error('Failed to load supplier cache');
            supplierCache = []; // Ensure it's an empty array to prevent errors
        }
    } catch (error) {
        console.error('Error loading supplier cache:', error.message);
        supplierCache = []; // Ensure it's an empty array to prevent errors
        throw error; // Optionally rethrow to handle it higher up
    }
}

async function createSupplier(vendorName, username, password) {
    console.log("*******************SUPPLIER CREATION STARTED**********************");

    // Load or check the supplier cache before checking the database
    if (supplierCache.length === 0) {
        await loadSupplierCache();
    }

    const supplierExistsInCache = supplierCache.includes(vendorName);
    if (supplierExistsInCache) {
        console.log(`Supplier already in cache: ${vendorName}`);
        return true; // Supplier already exists in cache, no need to create
    }

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
        return true; // Supplier already exists in DB, no need to create
    }

    // Attempt to create the supplier if not found in cache or DB
    const config = {
        method: 'post',
        url: `https://${process.env.CLUSTER}.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/suppliers`,
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
            console.log("***$$$$$$$$$$SUPPLIER CREATION ENDED$$$$$$$$$**********************");
            // Update the cache and database
            supplierCache.push(vendorName);
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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendDataToApi(vendorData, username, password) {
    let receiptNumbers = []; // Store custom numbers along with vendor names
    let processedInvoices = new Set(); // Track processed invoice numbers

    // First, create a structure to group by vendor and invoice number
    const vendorInvoiceGroups = vendorData.reduce((grouped, vendorObject) => {
        const vendorName = vendorObject.vendor;

        // Iterate over each row in the vendorObject.data array
        for (const row of vendorObject.data) {
            const invoiceNumber = row['invoiceNumber'] || 'UnknownInvoiceNumber'; // Access the invoice number from the row

            // Ensure each vendor has a group
            if (!grouped[vendorName]) {
                grouped[vendorName] = {};
            }

            // Ensure each vendor group has a sub-group for each invoice number
            if (!grouped[vendorName][invoiceNumber]) {
                grouped[vendorName][invoiceNumber] = [];
            }

            // Push the row data to the correct vendor-invoice group
            grouped[vendorName][invoiceNumber].push(row);
        }

        return grouped;
    }, {});

    // Log the number of vendor groups and their sizes
    console.log(`Number of vendors: ${Object.keys(vendorInvoiceGroups).length}`);
    for (const [vendorName, invoiceGroups] of Object.entries(vendorInvoiceGroups)) {
        console.log(`Vendor: ${vendorName}, Number of invoices: ${Object.keys(invoiceGroups).length}`);
        for (const [invoiceNumber, invoiceGroup] of Object.entries(invoiceGroups)) {
            console.log(`Invoice: ${invoiceNumber}, Number of items: ${invoiceGroup.length}`);
        }
    }

    // Iterate over each vendor and invoice group
    for (const [vendorName, invoiceGroups] of Object.entries(vendorInvoiceGroups)) {
        for (const [invoiceNumber, invoiceGroup] of Object.entries(invoiceGroups)) {

            // Skip processing if the invoice has already been processed
            if (processedInvoices.has(invoiceNumber)) {
                console.log(`Skipping already processed invoice: ${invoiceNumber}`);
                continue;
            }

            console.log(`Processing vendor group for vendor: ${vendorName} with invoice number: ${invoiceNumber}`);
            console.log(`Vendor group:`, invoiceGroup);

            // Create dispatch notification for each invoice group
            const newStockReceiptId = `Invoice-${invoiceNumber}`; // Create new stockReceiptId with only invoice number
            console.log(`Created new stock receipt ID: ${newStockReceiptId}`);

            // Modify the first row to include the modified stock receipt ID
            const row = invoiceGroup[0]; // Use the first row to create the dispatch notification
            row.number = newStockReceiptId; // Update the 'number' field with the new ID

            await createSupplier(vendorName, username, password);

            const config = {
                method: 'post',
                url: `https://${process.env.CLUSTER}.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/dispatchNotifications/`,
                auth: { username, password },
                data: row // Send the modified row
            };

            console.log(`Sending data for vendor: ${vendorName} with Invoice Number: ${invoiceNumber}`);
            console.log(`Request configuration:`, config); // Log the full request config

            // Pause for 0.5 seconds before sending the request
            await delay(500);

            try {
                const response = await axios(config);
                console.log(`Data sent successfully for vendor: ${vendorName}. Response:`, response.data);

                // Use the custom stockReceiptId (with invoice number) to store in the receiptNumbers array
                receiptNumbers.push({ vendor: vendorName, stockReceiptId: newStockReceiptId });

                // Mark the invoice number as processed after processing
                processedInvoices.add(invoiceNumber);

            } catch (error) {
                console.error(`Failed to send data for vendor: ${vendorName}:`, error.message);
            }
        }
    }

    return receiptNumbers; // Return the array of custom numbers and associated vendor names
}


async function convertCsvToJson2(filename, vendorName) {
    // Load column keys from environment variables or use default values
    const keys = {
        vendorName: process.env.VENDOR_NAME_KEY || 'Vendor Name',
        productDescription: process.env.PRODUCT_DESCRIPTION_KEY || 'Product Description',
        unitCost: process.env.UNIT_COST_KEY || 'Unit Cost',
        packsPerCase: process.env.PACKS_PER_CASE_KEY || 'Packs Per Case',
        quantity: process.env.QUANTITY_KEY || 'Quantity',
        productNumber: process.env.PRODUCT_NUMBER_KEY || 'Pack UPC',
        productNumber2: process.env.PRODUCT_NUMBER_KEY2,
        caseUpc: process.env.CASE_UPC_KEY || 'Case UPC',
        glCode: process.env.GL_CODE_KEY || 'GL Code',
        supplierItemNumber: process.env.SUPPLIER_ITEM_NUMBER || 'Product Number',
        retailerName: process.env.RETAILER_NAME || 'unknown',
        unitsPerPack: process.env.UNITS_PER_PACK,
        storeId: process.env.STORE_NUMBER_KEY,
        unitOfMeasure: process.env.UNIT_OF_MEASURE,
        discountAdjustmentTotal: process.env.DISCOUNT_ADJUSTMENT_TOTAL
    };

    const ORG_UNIT_TO_MATCH = process.env.ORG_UNIT_TO_MATCH || '000001'; // Store ID to match

    console.log(`Processing file: ${filename}`);

    function sanitizeString2(inputString) {
        return inputString.replace(/[^a-zA-Z0-9äöüÄÖÜß.;]/g, '');
    }

    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${(now.getMonth() + 1)
        .toString()
        .padStart(2, '0')}-${now
        .getDate()
        .toString()
        .padStart(2, '0')}T${now
        .getHours()
        .toString()
        .padStart(2, '0')}:${now
        .getMinutes()
        .toString()
        .padStart(2, '0')}:${now
        .getSeconds()
        .toString()
        .padStart(2, '0')}Z`;

    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filename);
        const vendorInvoiceItems = {}; // Object to hold items grouped by vendor and invoice number

        stream
            .pipe(csvParser())
            .on('data', (row) => {
                // console.log("Processing row:", row);
                if (
                    row[keys.vendorName] === vendorName &&
                    row[keys.storeId] === ORG_UNIT_TO_MATCH
                ) {
                    const invoiceNumber = row['Invoice Number'] || 'UnknownInvoiceNumber';

                    // Initialize the vendor group if it doesn't exist
                    if (!vendorInvoiceItems[vendorName]) {
                        vendorInvoiceItems[vendorName] = {};
                    }

                    // Initialize the invoice group if it doesn't exist
                    if (!vendorInvoiceItems[vendorName][invoiceNumber]) {
                        vendorInvoiceItems[vendorName][invoiceNumber] = [];
                    }
                    const glCode = row[keys.glCode];
                    const unitCost = parseFloat(row[keys.unitCost]);
                    const packsPerCase = parseInt(row[keys.packsPerCase]);
                    let value = 1;
                    if (!isNaN(unitCost)) {
                        value = calculate2(unitCost, row[keys.packsPerCase], row[keys.unitsPerPack], row[keys.unitOfMeasure], row[keys.discountAdjustmentTotal],row[keys.quantity], row[keys.productDescription]), row[keys.glCode];
                    } else {
                        console.error(
                            `Invalid or missing data for product ${row[keys.productDescription]} - Unit Cost: ${row[keys.unitCost]}, Packs Per Case: ${row[keys.packsPerCase]}, Units Per Pack: ${row[keys.unitsPerPack]}`
                        );
                    }

                    let item = {
                        unitType: row[keys.unitOfMeasure],
                        name: row[keys.productDescription],
                        shelfLife: dateFormatted,
                        amount: {
                            ordered: calculateAmount(
                                row[keys.quantity],
                                row[keys.packsPerCase],
                                row[keys.unitsPerPack],
                                glCode,
                                row[keys.unitOfMeasure],
                                row[keys.productDescription]
                            ),
                            delivered: calculateAmount(
                                row[keys.quantity],
                                row[keys.packsPerCase],
                                row[keys.unitsPerPack],
                                glCode,
                                row[keys.unitOfMeasure],
                                row[keys.productDescription]
                            )
                        },
                        identification: {
                            buyer: row[keys.retailerName] || 'Unknown',
                            productCode:
                            row[keys.productNumber] !== ''
                                ? formatProductCode(row[keys.productNumber])
                                : (row[keys.caseUpc] !== ''
                                    ? row[keys.caseUpc]
                                    : row[keys.productNumber2]),                        
                            supplier: row[keys.caseUpc] || 1001
                        },
                        container: { quantity: 1 },
                        importData: {
                            assortment: { number: '1' },
                            commodityGroup: { name: row[keys.glCode] } || 'API',
                            name:
                                row[keys.productDescription] ||
                                'Product_Not_Included_In_SHEET',
                            codes: [
                                {
                                    productCode:
                                    row[keys.productNumber] !== ''
                                        ? formatProductCode(row[keys.productNumber])
                                        : (row[keys.caseUpc] !== ''
                                            ? row[keys.caseUpc]
                                            : row[keys.productNumber2]),
                                    containerSize: 1
                                }
                            ],
                            sector: { number: '1' },
                            supplierPrices: [
                                {
                                    supplier: { name: vendorName || 'UNASSIGNED' },
                                    orderCode:
                                        row[keys.caseUpc] !== ''
                                            ? row[keys.caseUpc]
                                            : row[keys.productNumber] || row[keys.productNumber2],
                                    value: value || 1,
                                    containerSize:
                                    parseInt(row[keys.unitsPerPack]) > 0
                                        ? parseInt(row[keys.unitsPerPack])
                                        : parseInt(row[keys.packsPerCase]) > 0
                                            ? parseInt(row[keys.packsPerCase])
                                            : 1
                                }
                            ]
                        }
                    };
                    // console.log("Constructed item:", item);

                    // Add the item to the correct vendor and invoice group
                    vendorInvoiceItems[vendorName][invoiceNumber].push(item);
                }
            })
            .on('end', () => {
                // console.log("Final items grouped by vendor and invoice:", vendorInvoiceItems);
                resolve(vendorInvoiceItems);
            })
            .on('error', (error) => {
                console.error('Error processing file:', error);
                reject(error);
            });
    });

function formatProductCode(code) {
    // Remove leading zeros only, do NOT remove the last character
    return code.replace(/^0+/, '');
}

    function calculateAmount(quantity, packsPerCase, unitsPerPack, glCode, unitOfMeasure, productDescription) {
        quantity = parseInt(quantity); // Parse quantity but do not default to 1
        packsPerCase = parseInt(packsPerCase);
        unitsPerPack = parseInt(unitsPerPack);
        unitOfMeasure = String(unitOfMeasure || "").toUpperCase(); // Normalize unitOfMeasure
        productDescription = String(productDescription || "").toUpperCase(); // Normalize product description
    
        // Return 0 if quantity is negative or 0
 
        if (quantity <= 0) {
            return 0;
        }
        // If unit of measure is "EA"
        if ( unitOfMeasure === "EA" || unitOfMeasure === "BO"){
            return quantity;
          }
        
        if (
            packsPerCase === 1 && unitOfMeasure === "CA" ||
            (unitOfMeasure === "CA" &&
              (unitsPerPack === 12 ||
               unitsPerPack === 15 ||
               unitsPerPack === 16 ||
               unitsPerPack === 6  ||
               unitsPerPack === 9  ||
               unitsPerPack === 18 ||
               unitsPerPack === 24 ||
               unitsPerPack === 48 ||
               unitsPerPack === 4))
          ) {
            return quantity * unitsPerPack; // Use Units per Pack for beer
          } 
          else if (packsPerCase === 4 && glCode === "BEER") {
            return quantity * unitsPerPack; // Specific logic for glCode BEER
          }
          // ADDED NEW ELSE IF
          else if (unitsPerPack === 0 && packsPerCase >= 1) {
            return quantity * packsPerCase;
          }
        // Default to packsPerCase for other scenarios
        return quantity * packsPerCase;
    }

    function calculate2(unitCost, packsPerCase, unitsPerPack, unitOfMeasure, discountAdjustmentTotal, quantity, productDescription, glCode) {
        cost = parseFloat(unitCost) || 1; 
        quantity = parseInt(quantity); 
        packsPerCase = parseInt(packsPerCase);
        unitsPerPack = parseInt(unitsPerPack);
        unitOfMeasure = String(unitOfMeasure || "").trim().toUpperCase(); // Normalize unitOfMeasure
        productDescription = String(productDescription || "").toUpperCase(); // Normalize product description
        discountAdjustmentTotal = parseFloat(discountAdjustmentTotal); // Keep the original value, including negative
    
        // Return 0 if quantity is negative or 0
        if (quantity <= 0) {
            return 0;
        }


        // If unit of measure is "EA"
    
        // Check for missing or 0 values and fallback logic
        if (isNaN(unitsPerPack) || unitsPerPack <= 0) {
            if (isNaN(packsPerCase) || packsPerCase <= 0) {
                unitsPerPack = 1; // Default to 1 if both are missing or 0
            } else {
                unitsPerPack = packsPerCase; // Use packsPerCase if unitsPerPack is invalid or 0
            }
        }
    
        if (isNaN(packsPerCase) || packsPerCase <= 0) {
            if (isNaN(unitsPerPack) || unitsPerPack <= 0) {
                packsPerCase = 1; // Default to 1 if both are missing or 0
            } else {
                packsPerCase = unitsPerPack; // Use unitsPerPack if packsPerCase is invalid or 0
            }
        }
    
        // Adjust calculation logic for specific conditions
        function calculateAmount(quantity, packsPerCase, unitsPerPack, unitOfMeasure, productDescription, glCode) {
            quantity = parseInt(quantity); // Parse quantity but do not default to 1
            packsPerCase = parseInt(packsPerCase);
            unitsPerPack = parseInt(unitsPerPack);
            unitOfMeasure = String(unitOfMeasure || "").trim().toUpperCase(); // Normalize unitOfMeasure
            productDescription = String(productDescription || "").toUpperCase(); // Normalize product description
    
            // Return 0 if quantity is negative or 0
            if (quantity <= 0) {
                return 0;
            }

            if ( unitOfMeasure === "EA" || unitOfMeasure === "BO"){
                return quantity;
              }
            // Main cases for calculation
            if (packsPerCase === 1 || packsPerCase === 2 || packsPerCase === 6 && 
                (unitsPerPack === 12 || unitsPerPack === 15 || unitsPerPack === 16 || 
                 unitsPerPack === 6 || unitsPerPack === 9 || unitsPerPack === 18 || 
                 unitsPerPack === 24 || unitsPerPack === 48 || unitsPerPack === 4 || unitsPerPack === 20 && unitOfMeasure=== "CA" )){
                return quantity * unitsPerPack; // Use Units per Pack for beer
            } else if (packsPerCase === 4 && glCode === "BEER") {
                return quantity * unitsPerPack; // Specific logic for glCode BEER
            
            } else if ( unitOfMeasure === "EA" || unitOfMeasure === "BO"){
                return quantity;
              }
    
            // Default to packsPerCase for other scenarios
            return quantity * packsPerCase;
        }
    
        const totalUnits = calculateAmount(quantity, packsPerCase, unitsPerPack, unitOfMeasure, productDescription, glCode); // Total units in the container
        const discountPerUnit = discountAdjustmentTotal / totalUnits; // Calculate discount per unit
        
        // if (unitOfMeasure === "EA" || unitOfMeasure === "BO") {
        //     return (cost / packsPerCase) + discountAdjustmentTotal;
        // }

        // Calculate cost with discount adjustment
        if ( unitOfMeasure === "EA" || unitOfMeasure === "BO"){
            return (( quantity * cost) + discountAdjustmentTotal) / quantity
          }
        if (packsPerCase === 12 || packsPerCase === 15 || packsPerCase === 16) {
            return (cost / packsPerCase) + discountPerUnit;
            
        } else {
            return (cost / unitsPerPack) + discountPerUnit;
        }
    }
    
    
    

}


async function updateAndSendProductData(item, stockReceiptId, vendorName, assignExistingProduct = true) {
    console.log("Product processed")
}

async function sendDataInfoToSecondApi(jsonData, stockReceiptId, assignExistingProduct = true) {
    // Check if jsonData is empty before proceeding
    if (jsonData.length === 0) {
        console.log(`No items to send for Stock Receipt ID: ${stockReceiptId}. Skipping.`);
        return;
    }

    // Log the entire jsonData for debugging
    console.log(`JSON DATA for Stock Receipt ID ${stockReceiptId}:`, JSON.stringify(jsonData, null, 2));

    // Detect duplicates using unique identifiers
    const itemIdentifiers = new Set();
    const uniqueItems = [];

    jsonData.forEach(item => {
        const identifier = item.identification.productCode; // Use a property that uniquely identifies the item
        if (!itemIdentifiers.has(identifier)) {
            itemIdentifiers.add(identifier);
            uniqueItems.push(item);
        }
    });

    if (uniqueItems.length !== jsonData.length) {
        console.error(`Duplicate items detected in jsonData for Stock Receipt ID ${stockReceiptId}. Sending only unique items.`);
        jsonData = uniqueItems;
    }

    // Prepare the configuration for the request with deduplicated jsonData
    const config = {
        method: 'post',
        url: `https://${process.env.CLUSTER}.koronacloud.com/web/api/v3/accounts/${process.env.API_KEY}/dispatchNotifications/${stockReceiptId}/items`,
        auth: {
            username: process.env.USERNAME,
            password: process.env.PASSWORD
        },
        headers: {
            'Content-Type': 'application/json'
        },
        params: {
            assignExistingProduct: assignExistingProduct,
            writeMode: "ADD_OR_UPDATE"
        },
        data: jsonData
    };

    // Log the number of items being sent
    console.log(`Preparing to send ${jsonData.length} unique items to dispatch notification with Stock Receipt ID: ${stockReceiptId}`);

    // Introduce a delay before sending (for debugging or throttling purposes)
    console.log("Pausing for 10 seconds before sending data for dispatch with Stock Receipt ID:", stockReceiptId);
    await delay(500); // 10-second delay

    console.log("Sending data for dispatch with Stock Receipt ID:", stockReceiptId);
    console.log("Request configuration:", JSON.stringify(config, null, 2));

    // Send the request to the API
    try {
        const response = await axios(config);
        if (Array.isArray(response.data) && response.data[0] && response.data[0].status === 'ERROR') {
            throw { response: { data: response.data } };
        }
        console.log("Data sent successfully for Stock Receipt ID:", stockReceiptId, "Response:", response.data);
    } catch (error) {
        console.error("Failed to send data for Stock Receipt ID:", stockReceiptId, "Error:", error.response ? error.response.data : error);
    }
}

async function main() {
    async function periodicCheck() {
        try {
            // await fetchAndCacheProducts(); // Fetch and cache all product data before processing
            await downloadCSVs(); // Download all necessary CSV files for processing

            const uploadedFilePath = path.join(__dirname, 'uploaded.txt');
            let uploadedFiles;

            try {
                const data = await readFile(uploadedFilePath, 'utf8');
                uploadedFiles = new Set(
                    data.split('\n').map((line) => line.trim()).filter(Boolean)
                );
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    console.log('No uploaded files log found, creating a new one.');
                    uploadedFiles = new Set();
                } else {
                    console.error('Error reading the uploaded files log:', readError);
                    return;
                }
            }

            const csvFiles = fs
                .readdirSync('.')
                .filter((file) => file.endsWith('.csv'));
            console.log(`Downloaded CSV files: ${csvFiles}`);

            if (csvFiles.length === 0) {
                console.log('No CSV files were downloaded.');
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
                const username = process.env.USERNAME;
                const password = process.env.PASSWORD;
                const receiptNumbers = await sendDataToApi(
                    jsonDataFirstApi,
                    username,
                    password
                );
                console.log('Receipt IDs:', receiptNumbers);

                // Create a map to hold items grouped by vendor and invoice number
                const itemsGroupedByVendorAndInvoice = {};

                // For each vendor, get items grouped by invoice number
                for (const vendorData of jsonDataFirstApi) {
                    const vendor = vendorData.vendor;
                    const itemsForVendor = await convertCsvToJson2(file, vendor);
                    itemsGroupedByVendorAndInvoice[vendor] =
                        itemsForVendor[vendor];
                }

                for (const { vendor, stockReceiptId } of receiptNumbers) {
                    // Extract invoice number from stockReceiptId
                    const invoiceNumberMatch = stockReceiptId.match(/^Invoice-(.+)$/);
                    if (!invoiceNumberMatch) {
                        console.error(
                            `Could not extract invoice number from stockReceiptId: ${stockReceiptId}`
                        );
                        continue;
                    }
                    const invoiceNumber = invoiceNumberMatch[1];

                    if (
                        !itemsGroupedByVendorAndInvoice[vendor] ||
                        !itemsGroupedByVendorAndInvoice[vendor][invoiceNumber]
                    ) {
                        console.error(
                            `No items found for vendor ${vendor} and invoice ${invoiceNumber}`
                        );
                        continue;
                    }

                    const itemsForInvoice =
                        itemsGroupedByVendorAndInvoice[vendor][invoiceNumber];

                    // Update and send product data for each item
                    for (const item of itemsForInvoice) {
                        await updateAndSendProductData(item, stockReceiptId, vendor);
                    }

                    // Send items to the second API
                    await sendDataInfoToSecondApi(itemsForInvoice, stockReceiptId);
                    console.log(
                        `Sent item data for ${vendor} and invoice ${invoiceNumber} to second API with stockReceiptId ${stockReceiptId}.`
                    );
                }

                await appendFile(uploadedFilePath, file + '\n');
                console.log(`Logged ${file} as uploaded.`);
            }
        } catch (error) {
            console.error('Error during periodic check:', error);
        }
    }

    periodicCheck(); // Immediately start the periodic check
    // setInterval(periodicCheck, checkInterval); // Optionally schedule to run every 15 minutes
}

main();
