// Google Sheets integration logic
const { google } = require('googleapis');
const creds = require('./creds.json');
const { GOOGLE_SHEET_ID } = process.env;

const { GoogleAuth } = require('google-auth-library');
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

async function getClient() {
  try {
    console.log('🔑 Getting Google Sheets client...');
    const client = await auth.getClient();
    console.log('✅ Google Sheets client obtained successfully');
    return client;
  } catch (error) {
    console.error('❌ Error getting client:', error.message);
    throw new Error('Failed to authenticate with Google Sheets');
  }
}

async function getRows(sheetName) {
  console.log(`\n📥 Starting getRows for sheet: ${sheetName}`);
  console.log(`📊 Sheet ID: ${GOOGLE_SHEET_ID}`);
  
  try {
    const client = await getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // First, get the sheet metadata to verify it exists and get its exact name
    console.log('🔍 Fetching sheet metadata...');
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      fields: 'sheets.properties'
    });

    console.log('📋 Available sheets:', metadata.data.sheets.map(s => s.properties.title));
    
    const targetSheet = metadata.data.sheets.find(sheet => 
      sheet.properties.title.toLowerCase() === sheetName.toLowerCase()
    );

    if (!targetSheet) {
      throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${metadata.data.sheets.map(s => s.properties.title).join(', ')}`);
    }

    const exactSheetName = targetSheet.properties.title;
    console.log('✅ Sheet found:', exactSheetName);
    
    // Get values from the sheet
    console.log(`\n📥 Fetching values from sheet: ${exactSheetName}`);
    console.log('🔍 API Request:', {
      spreadsheetId: GOOGLE_SHEET_ID,
      range: exactSheetName
    });
    
    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: exactSheetName
    });

    console.log('✅ Values response received');
    
    if (!valuesRes.data.values || valuesRes.data.values.length === 0) {
      console.log('ℹ️ No data found in sheet');
      return [];
    }

    // Convert array of arrays to array of objects with column names
    const headers = valuesRes.data.values[0];
    console.log('📋 Headers found:', headers);
    
    const rows = valuesRes.data.values.slice(1).map((row, rowIndex) => {
      const obj = {};
      headers.forEach((header, index) => {
        if (header === 'Image') {
          // Only handle Google Drive links in the Image column
          const cellValue = row[index] || '';
          if (cellValue.includes('drive.google.com/file/d/')) {
            // Convert any Google Drive link format to direct download URL
            const fileId = cellValue.match(/\/d\/(.*?)\//)?.[1];
            if (fileId) {
              obj[header] = `https://drive.google.com/uc?export=view&id=${fileId}`;
            } else {
              console.log(`⚠️ Invalid Google Drive link format in row ${rowIndex + 2}:`, cellValue);
              obj[header] = '';
            }
          } else if (cellValue.trim() !== '') {
            // Keep other image URLs as they are
            obj[header] = cellValue;
          } else {
            obj[header] = '';
          }
        } else {
          obj[header] = row[index] || '';
        }
      });
      return obj;
    });

    console.log(`✅ Successfully processed ${rows.length} rows`);
    return rows;
  } catch (error) {
    console.error('❌ Error in getRows:', error.message);
    console.error('🔍 Error details:', {
      name: error.name,
      code: error.code,
      status: error.status,
      errors: error.errors
    });
    throw error;
  }
}

async function updateCell(sheetName, row, col, value) {
  try {
    console.log(`\n📝 Updating cell ${col}${row} in sheet: ${sheetName}`);
    const client = await getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    // Get the exact sheet name first
    console.log('🔍 Fetching sheet metadata...');
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      fields: 'sheets.properties'
    });
    
    const targetSheet = metadata.data.sheets.find(sheet => 
      sheet.properties.title.toLowerCase() === sheetName.toLowerCase()
    );
    
    if (!targetSheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }
    
    const exactSheetName = targetSheet.properties.title;
    console.log('✅ Sheet found:', exactSheetName);
    
    console.log('🔍 API Request:', {
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${exactSheetName}!H${row}`,
      value: value
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${exactSheetName}!H${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[value]]
      }
    });
    console.log(`✅ Updated ${exactSheetName}!H${row} with "${value}"`);
  } catch (error) {
    console.error('❌ Error updating cell:', error.message);
    console.error('🔍 Error details:', {
      name: error.name,
      code: error.code,
      status: error.status,
      errors: error.errors
    });
    throw error;
  }
}

module.exports = { getRows, updateCell };
