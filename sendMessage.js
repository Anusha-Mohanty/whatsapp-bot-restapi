const { MessageMedia } = require('whatsapp-web.js');
const { google } = require('googleapis');
const { isTimeDue, parseTime } = require('./utils');
const { getRows, updateCellByName } = require('./sheets');
const creds = require('./creds.json');

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';
const DUE_WINDOW_MINUTES = process.env.DUE_WINDOW_MINUTES ? parseInt(process.env.DUE_WINDOW_MINUTES, 10) : 60;

function parsePhoneNumbers(phoneInput) {
  if (!phoneInput || typeof phoneInput !== 'string') return [];
  // Split by comma, semicolon, or newline, then trim whitespace and remove empty strings
  return phoneInput
    .split(/[,;\n]+/)
    .map(num => num.trim())
    .filter(num => num.length > 0);
}

async function sendMessage(client, numberOrLink, message, imageUrl) {
  try {
    const isGroup = isGroupInviteLink(numberOrLink);
    let chatId;

    if (isGroup) {
      const inviteCode = extractInviteCode(numberOrLink);
      if (!inviteCode) throw new Error('Invalid group invite link');
      const group = await client.acceptInvite(inviteCode);
      chatId = group.id._serialized;
      console.log(`✅ Joined group: ${numberOrLink}`);
    } else {
      chatId = numberOrLink.includes('@c.us') ? numberOrLink : `${numberOrLink.replace(/\D/g, '')}@c.us`;
    }

    if (imageUrl) {
      try {
        const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
        await client.sendMessage(chatId, media, { caption: message });
        return `Sent with image to ${chatId}`;
      } catch (e) {
        console.warn(`⚠️ Image send failed to ${chatId}, falling back to text: ${e.message}`);
      }
    }
    await client.sendMessage(chatId, message);
    return `Sent text-only to ${chatId}`;
  } catch (error) {
    console.error(`❌ Failed to send to ${numberOrLink}:`, error);
    throw error;
  }
}

async function processCombinedMessages(client, sheetName, options = {}) {
  const { scheduledMode = false, instantMode = false, autoStopSchedule = false } = options;

  console.log(`📋 Processing messages from sheet: ${sheetName} (Instant: ${instantMode}, Scheduled: ${scheduledMode})`);
  
  const rows = await getRows(sheetName);

  if (!rows || rows.length === 0) {
    console.log('✅ No data to process.');
    return { sent: 0, failed: 0, skipped: 0, scheduledMessagesRemaining: 0, shouldStopSchedule: true };
  }
  
  const phoneCol = 'Phone Numbers';
  const msgCol = 'Message Text';
  const statusCol = 'Status';
  const timeCol = 'Time';
  const imgCol = 'Image';
  const runCol = 'Run';
  
  let sentCount = 0, failedCount = 0, skippedCount = 0;
  let scheduledMessagesRemaining = 0;

  // First pass: Count all unsent messages that have a scheduled time.
  for (const row of rows) {
    const status = row[statusCol] || '';
    const time = row[timeCol] || '';
    if (!status.toLowerCase().includes('sent') && time) {
        scheduledMessagesRemaining++;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 2; // Sheet rows are 1-indexed, and we have a header
    const phoneString = row[phoneCol];
    const message = row[msgCol];
    const status = row[statusCol] || '';
    const time = row[timeCol] || '';
    const image = row[imgCol] || '';
    const run = row[runCol] || '';

    if (!phoneString || !message || status.toLowerCase().includes('sent')) {
      continue;
    }

    if (run.toLowerCase() !== 'yes') {
      if (time && !status.toLowerCase().includes('sent')) {
        scheduledMessagesRemaining--;
      }
      skippedCount++;
      continue;
    }
    
    // If in instant mode, only send messages that do NOT have a time specified.
    if (instantMode && time) {
        skippedCount++;
        continue; // Skip rows with a time in instant mode
    }
    
    if (scheduledMode && time) {
        const scheduledTime = parseTime(time, DEFAULT_TIMEZONE);
        if (!scheduledTime || !isTimeDue(scheduledTime, DUE_WINDOW_MINUTES)) {
            skippedCount++;
            continue;
        }
    } else if (scheduledMode && !time) {
        // In scheduled mode, if there's no time, we should skip it.
        skippedCount++;
        continue;
    }
    
    const phoneNumbers = parsePhoneNumbers(phoneString);
    if(phoneNumbers.length === 0) {
        continue;
    }

    console.log(`▶️ Processing Row ${rowIndex}: Sending to ${phoneNumbers.join(', ')}`);
    let allSentSuccessfully = true;

    for(const number of phoneNumbers) {
        try {
          await sendMessage(client, number, message, image);
        } catch (e) {
          allSentSuccessfully = false;
          failedCount++;
          console.error(`❌ Error on row ${rowIndex} for number ${number}: ${e.message}`);
        }
    }

    if (allSentSuccessfully) {
        sentCount++;
        if (time) {
            scheduledMessagesRemaining--;
        }
        try {
          await updateCellByName(sheetName, rowIndex, statusCol, '✅ Sent');
        } catch (e) {
          console.error(`❌ Failed to update status for row ${rowIndex}: ${e.message}`);
        }
    }
  }

  const shouldStop = autoStopSchedule && scheduledMessagesRemaining <= 0;
  console.log(`\n✅ Run complete. Sent: ${sentCount}, Failed: ${failedCount}, Skipped: ${skippedCount}. Remaining scheduled: ${scheduledMessagesRemaining}.`);
  if (shouldStop) console.log('⏹️ Scheduler will stop.');

  return {
    sent: sentCount,
    failed: failedCount,
    skipped: skippedCount,
    scheduledMessagesRemaining,
    shouldStopSchedule: shouldStop,
  };
}

const isGroupInviteLink = (i) => i && /chat\.whatsapp\.com/.test(i);
const extractInviteCode = (l) => l.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/)?.[1];

module.exports = { sendMessage, processCombinedMessages };
