const { MessageMedia } = require('whatsapp-web.js');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { parseTime, isTimeDue } = require('./utils');
const creds = require('./creds.json');

// Get timezone from environment variable, default to Asia/Kolkata
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';
const DUE_WINDOW_MINUTES = process.env.DUE_WINDOW_MINUTES ? parseInt(process.env.DUE_WINDOW_MINUTES) : 60;
const PASS_LABEL = '[SEND PASS]';
const COUNT_PASS_LABEL = '[COUNT PASS]';

async function sendMessage(client, numberOrLink, message, imageUrl) {
  try {
    if (isGroupInviteLink(numberOrLink)) {
      // Handle group invite link
      const inviteCode = extractInviteCode(numberOrLink);
      if (!inviteCode) throw new Error('Invalid group invite link format');
      let groupId;
      try {
        groupId = await client.acceptInvite(inviteCode); // Joins the group, returns group chat ID
        console.log(`✅ Joined group via invite: ${numberOrLink} (ID: ${groupId})`);
      } catch (err) {
        if (err && err.message && err.message.includes('already in group')) {
          // Already a member, try to get groupId from invite
          const info = await client.getInviteInfo(inviteCode);
          groupId = info.id + '@g.us';
          console.log(`ℹ️ Already a member of group: ${numberOrLink} (ID: ${groupId})`);
        } else {
          throw err;
        }
      }
      // Send message to group
      if (imageUrl?.trim()) {
        try {
          const media = await MessageMedia.fromUrl(imageUrl.trim(), { unsafeMime: true });
          await client.sendMessage(groupId, media, { caption: message });
          console.log(`✅ Image message sent to group ${groupId}`);
          return 'Sent with image to group';
        } catch (error) {
          console.warn(`⚠️ Image send failed to group ${groupId}: ${error.message}`);
          console.log('⏳ Falling back to text-only message...');
        }
      }
      await client.sendMessage(groupId, message);
      console.log(`✅ Text message sent to group ${groupId}`);
      return 'Sent text-only to group';
    } else {
      const formattedNumber = numberOrLink.replace(/\D/g, '');
      const chatId = formattedNumber.includes('@c.us')
        ? formattedNumber
        : `${formattedNumber}@c.us`;

      if (imageUrl?.trim()) {
        try {
          const media = await MessageMedia.fromUrl(imageUrl.trim(), { unsafeMime: true });
          await client.sendMessage(chatId, media, { caption: message });
          console.log(`✅ Image message sent to ${chatId}`);
          return 'Sent with image';
        } catch (error) {
          console.warn(`⚠️ Image send failed to ${chatId}: ${error.message}`);
          console.log('⏳ Falling back to text-only message...');
        }
      }

      await client.sendMessage(chatId, message);
      console.log(`✅ Text message sent to ${chatId}`);
      return 'Sent text-only';
    }
  } catch (error) {
    console.error(`❌ Failed to send to ${numberOrLink}: ${error.message}`);
    throw error;
  }
}

/**
 * Process messages from a combined sheet with smart recipient detection
 * @param {Object} client - WhatsApp client
 * @param {string} sheetName - Name of the sheet to process
 * @param {Object} options - Processing options
 * @param {boolean} options.instantMode - If true, ignore time column and send immediately
 * @param {boolean} options.scheduledMode - If true, respect time column and send if due
 * @param {boolean} options.combinedMode - If true, handle both instant (empty time) and scheduled (with time) messages
 * @param {boolean} options.autoStopSchedule - If true, automatically stop schedule when all messages are sent
 * @returns {Object} Results summary
 */
async function processCombinedMessages(client, sheetName, options = {}) {
  const { instantMode = false, scheduledMode = false, combinedMode = false, autoStopSchedule = false } = options;
  
  try {
    console.log(`📋 Processing messages from sheet: ${sheetName}`);
    
    // Determine processing mode
    const instantMode = !combinedMode && !scheduledMode;
    const modeDescription = combinedMode ? 'Combined (instant + scheduled)' : 
                           scheduledMode ? 'Scheduled (respecting time column)' : 
                           'Instant (ignoring time column)';
    
    // Get sheet data
    const exactSheetName = sheetName;
    
    // Check for required environment variables
    if (!process.env.GOOGLE_SHEET_ID) {
      throw new Error('GOOGLE_SHEET_ID environment variable is not set');
    }
    
    // Initialize Google Sheets using the existing auth setup
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const client_auth = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client_auth });
    
    // Get sheet metadata to verify it exists
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      fields: 'sheets.properties'
    });
    
    const targetSheet = metadata.data.sheets.find(sheet => 
      sheet.properties.title.toLowerCase() === sheetName.toLowerCase()
    );
    
    if (!targetSheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }
    
    // Get all values from the sheet
    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: exactSheetName
    });
    
    if (!valuesRes.data.values || valuesRes.data.values.length === 0) {
      return {
        sent: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        totalProcessable: 0,
        remainingMessages: 0,
        scheduledMessagesRemaining: 0,
        shouldStopSchedule: autoStopSchedule
      };
    }
    
    // Convert to array of objects with headers
    const headers = valuesRes.data.values[0];
    const rows = valuesRes.data.values.slice(1).map((row, rowIndex) => {
      const obj = {};
      headers.forEach((header, index) => {
        if (header.toLowerCase().includes('image')) {
          // Handle Google Drive links in the Image column
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
    
    // Find column indices
    const phoneCol = headers.findIndex(h => h.toLowerCase().includes('phone'));
    const messageCol = headers.findIndex(h => h.toLowerCase().includes('message'));
    const campaignCol = headers.findIndex(h => h.toLowerCase().includes('campaign'));
    const imageCol = headers.findIndex(h => h.toLowerCase().includes('image'));
    const timeCol = headers.findIndex(h => h.toLowerCase().includes('time'));
    const statusCol = headers.findIndex(h => h.toLowerCase().includes('status'));
    const runCol = headers.findIndex(h => h.toLowerCase().includes('run'));
    
    if (phoneCol === -1 || messageCol === -1) {
      throw new Error('Required columns "Phone Numbers" and "Message Text" not found');
    }
    
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let instantCount = 0;
    let scheduledCount = 0;
    let totalProcessableRows = 0;
    let remainingMessages = 0;
    
    // First pass: count total processable rows and remaining messages
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const phoneValue = row[headers[phoneCol]];
      const messageValue = row[headers[messageCol]];
      const runValue = runCol !== -1 ? row[headers[runCol]] : 'yes';
      const statusValue = statusCol !== -1 ? row[headers[statusCol]] : '';
      
      // Skip if no phone number or message
      if (!phoneValue || !messageValue) {
        continue;
      }
      
      // Check if should run
      if (runCol !== -1 && runValue) {
        const runStr = runValue.toString().toLowerCase();
        if (runStr !== 'yes' && runStr !== 'true' && runStr !== '1') {
          continue;
        }
      }
      
      totalProcessableRows++;
      
      // Check if already sent
      if (statusCol !== -1 && statusValue) {
        const statusStr = statusValue.toString().toLowerCase();
        if (statusStr.includes('sent')) {
          continue; // Already sent, don't count as remaining
        }
      }
      
      remainingMessages++;
    }
    
    // Process each row
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      try {
        const row = rows[rowIndex];
        const phoneValue = row[headers[phoneCol]];
        let messageValue = row[headers[messageCol]];
        const campaignValue = campaignCol !== -1 ? row[headers[campaignCol]] : 'Unknown Campaign';
        const runValue = runCol !== -1 ? row[headers[runCol]] : 'yes';
        const timeValue = timeCol !== -1 ? row[headers[timeCol]] : '';
        const statusValue = statusCol !== -1 ? row[headers[statusCol]] : '';
        const imageValue = imageCol !== -1 ? row[headers[imageCol]] : '';
        
        // Skip if no phone number or message
        if (!phoneValue || !messageValue) {
          continue;
        }
        
        // Check if should run
        if (runCol !== -1 && runValue) {
          const runStr = runValue.toString().toLowerCase();
          if (runStr !== 'yes' && runStr !== 'true' && runStr !== '1') {
            continue;
          }
        }
        
        // Check if already sent
        if (statusCol !== -1 && statusValue) {
          const statusStr = statusValue.toString().toLowerCase();
          if (statusStr.includes('sent')) {
            console.log(`⏭️ Row ${rowIndex + 2}: Status is '${statusValue}', skipping as already sent.`);
            skippedCount++;
            continue;
          }
        }
        
        // Determine message type and whether to process
        let shouldProcess = false;
        let messageType = '';
        
        if (combinedMode) {
          // Combined mode: handle both instant and scheduled messages
          const hasTime = timeValue && timeValue.toString().trim() !== '';
          
          if (hasTime) {
            // Scheduled message - check if time is due
            const scheduledTime = parseTime(timeValue.toString());
            if (scheduledTime && isTimeDue(scheduledTime)) {
              shouldProcess = true;
              messageType = 'scheduled';
              scheduledCount++;
            } else {
              skippedCount++;
              continue;
            }
          } else {
            // Instant message - no time specified
            shouldProcess = true;
            messageType = 'instant';
            instantCount++;
          }
        } else if (instantMode) {
          // Instant mode only - ignore time column (but only send messages with empty time)
          const hasTime = timeValue && timeValue.toString().trim() !== '';
          
          if (hasTime) {
            console.log(`⚠️ Row ${rowIndex + 2}: Has time "${timeValue}" but in instant mode, skipping (use scheduled mode for timed messages)`);
            skippedCount++;
            continue;
          } else {
            shouldProcess = true;
            messageType = 'instant';
            instantCount++;

          }
        } else if (scheduledMode) {
          // Scheduled mode only - must have time and be due
          if (timeCol !== -1 && timeValue) {
            const scheduledTime = parseTime(timeValue.toString());
            
            if (scheduledTime && isTimeDue(scheduledTime)) {
              shouldProcess = true;
              messageType = 'scheduled';
              scheduledCount++;
              console.log(`✅ Row ${rowIndex + 2}: Scheduled message is due, will process`);
            } else {
              if (!scheduledTime) {
                console.log(`⚠️ Row ${rowIndex + 2}: Invalid time format "${timeValue}", skipping`);
              } else {
                const now = new Date();
                const scheduledDate = scheduledTime.toJSDate();
                const timeDiff = now - scheduledDate;
                const minutesDiff = timeDiff / (1000 * 60);
                console.log(`${PASS_LABEL} ⏳ Row ${rowIndex + 2}: Scheduled message not due yet (${minutesDiff.toFixed(1)} minutes ${timeDiff > 0 ? 'late' : 'early'}), skipping`);
              }
              skippedCount++;
              continue;
            }
          } else {
            console.log(`⚠️ Row ${rowIndex + 2}: No time specified for scheduled mode, skipping`);
            skippedCount++;
            continue;
          }
        }
        
        if (!shouldProcess) {
          continue;
        }
        
        console.log(`🚀 Row ${rowIndex + 2}: Processing ${messageType} message...`);
        
        // Get phone numbers (support both single and multiple)
        const phoneNumbers = parsePhoneNumbers(phoneValue.toString());
        
        if (phoneNumbers.length === 0) {
          console.log(`⚠️ Row ${rowIndex + 2} (${campaignValue}): No valid phone numbers found`);
          failedCount++;
          continue;
        }
        
        // Get message
        let message = messageValue.toString();
        // Replace {column} and <column> tags with values from the row (case-insensitive)
        message = message.replace(/[{<]([a-zA-Z0-9 _-]+)[}>]/g, (match, tag) => {
          // Find the column in the row (case-insensitive)
          const colKey = Object.keys(row).find(
            k => k.trim().toLowerCase() === tag.trim().toLowerCase()
          );
          if (colKey && row[colKey] != null) {
            return row[colKey];
          }
          return match; // leave as is if not found
        });
        
        // Get image if available
        let imageUrl = null;
        if (imageCol !== -1 && imageValue) {
          imageUrl = imageValue.toString();
        }
        
        // Send to all recipients
        let allSent = true;
        let sentToCount = 0;
        let failedToCount = 0;
        
        for (const phoneNumber of phoneNumbers) {
          try {
            await sendMessage(client, phoneNumber, message, imageUrl);
            console.log(`✅ [${campaignValue}] [${messageType.toUpperCase()}] Sent to ${phoneNumber}: ${message.substring(0, 50)}...`);
            sentToCount++;
          } catch (error) {
            console.error(`❌ [${campaignValue}] [${messageType.toUpperCase()}] Failed to send to ${phoneNumber}:`, error.message);
            failedToCount++;
            allSent = false;
          }
        }
        
        // Update status in sheet
        if (statusCol !== -1) {
          const newStatus = allSent ? '✅ Sent' : 'Failed';
          const range = `${exactSheetName}!${String.fromCharCode(65 + statusCol)}${rowIndex + 2}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[newStatus]]
            }
          });
        }
        
        if (allSent) {
          sentCount++;
        } else {
          failedCount++;
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Error processing row ${rowIndex + 2}:`, error.message);
        failedCount++;
      }
    }
    
    // Calculate remaining messages after processing
    let finalRemainingMessages = 0;
    let scheduledMessagesRemaining = 0;
    if (autoStopSchedule) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const phoneValue = row[headers[phoneCol]];
        const messageValue = row[headers[messageCol]];
        const runValue = runCol !== -1 ? row[headers[runCol]] : 'yes';
        const statusValue = statusCol !== -1 ? row[headers[statusCol]] : '';
        const timeValue = timeCol !== -1 ? row[headers[timeCol]] : '';
        
        // Skip if no phone number or message
        if (!phoneValue || !messageValue) {
          continue;
        }
        
        // Check if should run
        if (runCol !== -1 && runValue) {
          const runStr = runValue.toString().toLowerCase();
          if (runStr !== 'yes' && runStr !== 'true' && runStr !== '1') {
            continue;
          }
        }
        
        // Check if already sent
        if (statusCol !== -1 && statusValue) {
          const statusStr = statusValue.toString().toLowerCase();
          if (statusStr.includes('sent')) {
            continue; // Already sent
          }
        }
        
        // For scheduled mode, only count messages that have times (scheduled messages)
        if (scheduledMode) {
          if (timeCol !== -1 && timeValue && timeValue.toString().trim() !== '') {
            const scheduledTime = parseTime(timeValue.toString());
            if (scheduledTime) {
              // Count unsent messages with valid scheduled times as remaining
              scheduledMessagesRemaining++;
            }
          }
        } else if (combinedMode) {
          // For combined mode, count both instant and scheduled messages
          const hasTime = timeValue && timeValue.toString().trim() !== '';
          if (hasTime) {
            // Scheduled message
            const scheduledTime = parseTime(timeValue.toString());
            if (scheduledTime) {
              scheduledMessagesRemaining++;
            }
          }
          // Instant message - don't count for auto-stop in combined mode
        } else {
          // For instant mode, count all unsent messages
          finalRemainingMessages++;
        }
      }
      
      // Use scheduled messages count for auto-stop logic
      finalRemainingMessages = scheduledMessagesRemaining;
    }
    
    const result = {
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
      total: sentCount + failedCount + skippedCount,
      totalProcessable: totalProcessableRows,
      remainingMessages: finalRemainingMessages,
      scheduledMessagesRemaining: scheduledMessagesRemaining,
      shouldStopSchedule: autoStopSchedule && scheduledMessagesRemaining === 0
    };
    
    if (combinedMode) {
      result.instant = instantCount;
      result.scheduled = scheduledCount;
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error processing combined messages:', error);
    throw error;
  }
}

/**
 * Parse phone numbers from a string (supports single and multiple numbers)
 * @param {string} phoneInput - Phone number input (can be single or comma-separated)
 * @returns {string[]} Array of cleaned phone numbers
 */
function parsePhoneNumbers(phoneInput) {
  if (!phoneInput) return [];
  const separators = /[,;\n|]/;
  const items = phoneInput.split(separators).map(item => item.trim()).filter(Boolean);
  const numbers = [];
  for (const item of items) {
    if (isGroupInviteLink(item)) {
      numbers.push(item); // Push group invite link as-is
      continue;
    }
    // Remove extra whitespace and clean the number
    let cleaned = item.replace(/[\s\-\(\)\.]/g, '');
    
    // Skip empty numbers
    if (!cleaned) {
      continue;
    }
    
    // Remove any duplicate digits that might have occurred
    // This prevents issues like 919078840822919078840822
    if (cleaned.length > 15) {
      // If number is too long, take the last 15 digits (max international length)
      const original = cleaned;
      cleaned = cleaned.slice(-15);
    }
    
    // Handle different country code scenarios
    if (cleaned.startsWith('+')) {
      // Already has + prefix, keep as is
    } else if (cleaned.startsWith('91') && cleaned.length === 12) {
      // Indian number without + prefix
      cleaned = '+' + cleaned;
    } else if (cleaned.startsWith('1') && cleaned.length === 11) {
      // US/Canada number without + prefix
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      // 10-digit number, assume US/Canada
      cleaned = '+1' + cleaned;
    } else if (cleaned.length >= 10 && cleaned.length <= 15) {
      // Other international numbers, add + if missing
      cleaned = '+' + cleaned;
    }
    
    // Validate phone number
    const cleanNum = cleaned.replace(/[^\d]/g, '');
    const isValid = cleanNum.length >= 10 && cleanNum.length <= 15;
    if (isValid) numbers.push(cleaned);
  }
  
  // Remove duplicates
  const uniqueNumbers = [...new Set(numbers)];
  
  return uniqueNumbers;
}

function isGroupInviteLink(input) {
  // WhatsApp group invite links are like: https://chat.whatsapp.com/XXXXXXXXXXX
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(input.trim());
}

function extractInviteCode(link) {
  // Extracts the invite code from the link
  const match = link.trim().match(/^https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]+)$/);
  return match ? match[1] : null;
}

module.exports = {
  sendMessage,
  processCombinedMessages,
  parsePhoneNumbers
};
