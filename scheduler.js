const { sendMessage } = require('./sendMessage');
const { getRows, updateCell } = require('./sheets');
const { parseTime, isTimeDue } = require('./utils');
const { DateTime } = require('luxon');
const cron = require('node-cron');

const MAX_RETRIES = 3;
const scheduledJobs = new Map(); // Store active cron jobs

// Get timezone from environment variable, default to Asia/Kolkata
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';

// Cron job management
class CronScheduler {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }

  // Schedule a recurring task
  scheduleRecurringTask(jobId, cronExpression, taskFunction, options = {}) {
    if (this.jobs.has(jobId)) {
      this.stopJob(jobId);
    }

    const job = cron.schedule(cronExpression, taskFunction, {
      scheduled: false,
      timezone: options.timezone || DEFAULT_TIMEZONE,
      ...options
    });

    this.jobs.set(jobId, {
      job,
      cronExpression,
      taskFunction: taskFunction.toString(),
      options,
      isActive: false
    });

    console.log(`📅 Scheduled recurring task: ${jobId} with cron: ${cronExpression}`);
    return job;
  }

  // Start a specific job
  startJob(jobId) {
    const jobData = this.jobs.get(jobId);
    if (!jobData) {
      throw new Error(`Job ${jobId} not found`);
    }

    jobData.job.start();
    jobData.isActive = true;
    console.log(`▶️ Started job: ${jobId}`);
  }

  // Stop a specific job
  stopJob(jobId) {
    const jobData = this.jobs.get(jobId);
    if (!jobData) {
      throw new Error(`Job ${jobId} not found`);
    }

    jobData.job.stop();
    jobData.isActive = false;
    console.log(`⏹️ Stopped job: ${jobId}`);
  }

  // Start all jobs
  startAllJobs() {
    this.jobs.forEach((jobData, jobId) => {
      if (!jobData.isActive) {
        this.startJob(jobId);
      }
    });
    this.isRunning = true;
  }

  // Stop all jobs
  stopAllJobs() {
    this.jobs.forEach((jobData, jobId) => {
      if (jobData.isActive) {
        this.stopJob(jobId);
      }
    });
    this.isRunning = false;
  }

  // Get job status
  getJobStatus(jobId) {
    const jobData = this.jobs.get(jobId);
    if (!jobData) {
      return null;
    }

    return {
      jobId,
      cronExpression: jobData.cronExpression,
      isActive: jobData.isActive,
      options: jobData.options
    };
  }

  // Get all jobs status
  getAllJobsStatus() {
    const status = [];
    this.jobs.forEach((jobData, jobId) => {
      status.push(this.getJobStatus(jobId));
    });
    return status;
  }

  // Remove a job
  removeJob(jobId) {
    const jobData = this.jobs.get(jobId);
    if (jobData) {
      jobData.job.stop();
      this.jobs.delete(jobId);
      console.log(`🗑️ Removed job: ${jobId}`);
    }
  }

  // Validate cron expression
  validateCronExpression(expression) {
    return cron.validate(expression);
  }
}

// Global scheduler instance
const cronScheduler = new CronScheduler();

// Schedule message processing (for recurring scheduled tasks)
async function scheduleMessageProcessing(sheetName, cronExpression, client, options = {}, onAutoStop) {
  const jobId = `message_processing_${sheetName}`;
  
  const taskFunction = async () => {
    console.log(`🕐 Running scheduled message processing for ${sheetName}`);
    try {
      // Use the new processCombinedMessages function with auto-stop functionality
      const { processCombinedMessages } = require('./sendMessage');
      const result = await processCombinedMessages(client, sheetName, {
        instantMode: false,
        scheduledMode: true,
        combinedMode: false,
        autoStopSchedule: true
      });
      
      // Check if we should stop the schedule
      if (result.shouldStopSchedule) {
        console.log(`🎉 All messages in ${sheetName} have been sent! Stopping schedule temporarily.`);
        cronScheduler.stopJob(jobId);
        console.log(`⏹️ Schedule ${jobId} stopped (kept for future runs).`);
        console.log(`💡 Schedule will remain available for when new messages are added to the sheet.`);
        if (typeof onAutoStop === 'function') {
          console.log('🔄 Triggering auto-stop callback to return to main menu.');
          onAutoStop();
        } else if (typeof globalThis.returnToMainMenu === 'function') {
          // Fallback: call a global main menu function if defined
          console.log('🔄 Fallback: Triggering global returnToMainMenu.');
          globalThis.returnToMainMenu();
        } else {
          console.log('⚠️ No auto-stop callback or global main menu handler defined.');
        }
      } else if (result.remainingMessages !== undefined) {
        console.log(`📊 Remaining messages in ${sheetName}: ${result.remainingMessages}`);
      }
      
    } catch (error) {
      console.error(`❌ Error in scheduled message processing for ${sheetName}:`, error);
    }
  };

  return cronScheduler.scheduleRecurringTask(jobId, cronExpression, taskFunction, options);
}

// Schedule bulk message processing (for recurring scheduled tasks)
async function scheduleBulkMessageProcessing(sheetName, cronExpression, client, options = {}) {
  const jobId = `bulk_processing_${sheetName}`;
  
  const taskFunction = async () => {
    console.log(`🕐 Running scheduled bulk message processing for ${sheetName}`);
    try {
      const { sendBulkMessages } = require('./bulkMessages');
      await sendBulkMessages(client, sheetName, {
        statusColumn: 'Status',
        phoneColumn: 'Phone Numbers',
        messageColumn: 'Message Text',
        imageColumn: 'Image',
        runColumn: 'Run'
      });
    } catch (error) {
      console.error(`❌ Error in scheduled bulk message processing for ${sheetName}:`, error);
    }
  };

  return cronScheduler.scheduleRecurringTask(jobId, cronExpression, taskFunction, options);
}

// Schedule custom function
async function scheduleCustomTask(taskName, cronExpression, taskFunction, options = {}) {
  const jobId = `custom_${taskName}`;
  return cronScheduler.scheduleRecurringTask(jobId, cronExpression, taskFunction, options);
}

// Process scheduled messages (for recurring cron jobs)
async function processScheduledMessages(sheetName, client) {
  console.log(`✅ Fetching rows from ${sheetName} for scheduled processing...`);

  let rows;
  try {
    rows = await getRows(sheetName);
  } catch (e) {
    throw new Error(`Unable to parse range: ${sheetName}!A1:I`);
  }

  if (!rows || rows.length === 0) {
    console.log('No rows found in the sheet');
    return;
  }

  console.log(`📋 Processing ${rows.length} rows from ${sheetName} for scheduled messages...`);

  // First, let's analyze what's in the sheet
  console.log('\n📊 SCHEDULED MESSAGES ANALYSIS:');
  console.log('══════════════════════════════════════════════════════════════');
  
  let totalMessages = 0;
  let sentMessages = 0;
  let pendingMessages = 0;
  let dueMessages = 0;
  let futureMessages = 0;
  let invalidMessages = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const index = i + 2;

    if (!row || !row['Phone']) continue;
    if ((row['Run'] || '').toLowerCase() !== 'yes') continue;
    
    totalMessages++;
    const name = row['Name'] || '';
    const rawNumber = row['Phone'];
    const number = rawNumber.replace(/[^\d]/g, '');
    const status = row['Status'] || '';
    const scheduledTimeStr = (row['Time'] || '').trim();
    
    // Check if already sent
    if (status.includes('✅ Sent') || status.includes('Sent successfully')) {
      sentMessages++;
      console.log(`   ✅ Row ${index}: ${name} | ${number} | ${scheduledTimeStr} | SENT`);
      continue;
    }

    // Validate phone number
    if (!/^\d{10,15}$/.test(number)) {
      invalidMessages++;
      console.log(`   ❌ Row ${index}: ${name} | ${number} | ${scheduledTimeStr} | INVALID PHONE`);
      continue;
    }

    // Parse time
    const parsedTime = parseTime(scheduledTimeStr);
    const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
    
    if (!parsedTime) {
      invalidMessages++;
      console.log(`   ❌ Row ${index}: ${name} | ${number} | ${scheduledTimeStr} | INVALID TIME`);
      continue;
    }

    pendingMessages++;
    
    if (now >= parsedTime) {
      dueMessages++;
      console.log(`   ⏰ Row ${index}: ${name} | ${number} | ${parsedTime.toFormat('dd/MM/yyyy HH:mm')} | DUE NOW`);
    } else {
      futureMessages++;
      console.log(`   ⏳ Row ${index}: ${name} | ${number} | ${parsedTime.toFormat('dd/MM/yyyy HH:mm')} | FUTURE`);
    }
  }

  console.log('\n📈 SUMMARY:');
  console.log(`   📊 Total messages: ${totalMessages}`);
  console.log(`   ✅ Already sent: ${sentMessages}`);
  console.log(`   ⏰ Due now: ${dueMessages}`);
  console.log(`   ⏳ Future: ${futureMessages}`);
  console.log(`   ❌ Invalid: ${invalidMessages}`);
  console.log('══════════════════════════════════════════════════════════════');

  if (dueMessages === 0) {
    console.log('\n💡 No messages are due at this time.');
    return;
  }

  console.log(`\n🚀 Processing ${dueMessages} due messages...`);

  // Now process the due messages
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const index = i + 2;

    if (!row || !row['Phone']) continue;
    if ((row['Run'] || '').toLowerCase() !== 'yes') continue;
    
    // Check if already sent (look for any sent status)
    const status = row['Status'] || '';
    if (status.includes('✅ Sent') || status.includes('Sent successfully')) {
      continue;
    }

    const name = row['Name'] || '';
    const rawNumber = row['Phone'];
    const number = rawNumber.replace(/[^\d]/g, ''); // Remove +, spaces, dashes etc.

    const originalMessage = row['Message'] || '';
    const message = originalMessage.replace(/{name}/g, name).replace(/<name>/g, name);
    const imageUrl = row['Image'] || '';
    const handledBy = (row['Handled By'] || '').trim().toLowerCase();
    const handler = process.env.HANDLED_BY?.toLowerCase() || '';
    const retryCount = parseInt((status.match(/Retry (\d+)/) || [])[1] || 0);
    const scheduledTimeStr = (row['Time'] || '').trim().toLowerCase();

    // ✅ International number validation: 10 to 15 digits
    if (!/^\d{10,15}$/.test(number)) {
      console.warn(`⚠️ Invalid number: "${rawNumber}" → cleaned: "${number}"`);
      await updateCell(sheetName, index, 'Status', `❌ Invalid phone number`);
      continue;
    }

    if (handledBy && handler && handledBy !== handler) continue;
    if (retryCount >= MAX_RETRIES) continue;

    // Parse time (handles 'now' or future time)
    const parsedTime = parseTime(scheduledTimeStr);
    const now = DateTime.now().setZone(DEFAULT_TIMEZONE);

    if (!parsedTime) {
      console.log(`   ⚠️ Invalid scheduled time: '${scheduledTimeStr}'`);
      continue;
    }

    console.log(`\n➡️ Row ${index}: ${name} | ${number}`);
    console.log(`   ⏳ Scheduled For: ${parsedTime.toFormat('dd/MM/yyyy HH:mm')} | Now: ${now.toFormat('dd/MM/yyyy HH:mm')}`);

    // Only send if the time is due
    if (now < parsedTime) {
      console.log(`   ⏱️ Not yet due`);
      continue;
    }

    await sendAndUpdateStatus(sheetName, index, client, number, message, imageUrl, retryCount);
  }
}

// Process instant messages (for manual trigger)
async function processInstantMessages(sheetName, client) {
  console.log(`✅ Fetching rows from ${sheetName} for instant processing...`);

  let rows;
  try {
    rows = await getRows(sheetName);
  } catch (e) {
    throw new Error(`Unable to parse range: ${sheetName}!A1:I`);
  }

  if (!rows || rows.length === 0) {
    console.log('No rows found in the sheet');
    return;
  }

  console.log(`📋 Processing ${rows.length} rows from ${sheetName} for instant messages...`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const index = i + 2;

    if (!row || !row['Phone']) continue;
    if ((row['Run'] || '').toLowerCase() !== 'yes') continue;
    
    // Check if already sent
    const status = row['Status'] || '';
    if (status.includes('✅ Sent') || status.includes('Sent successfully')) {
      console.log(`   ⏭️ Row ${index}: Already sent, skipping`);
      continue;
    }

    const name = row['Name'] || '';
    const rawNumber = row['Phone'];
    const number = rawNumber.replace(/[^\d]/g, ''); // Remove +, spaces, dashes etc.

    const originalMessage = row['Message'] || '';
    const message = originalMessage.replace(/{name}/g, name).replace(/<name>/g, name);
    const imageUrl = row['Image'] || '';
    const handledBy = (row['Handled By'] || '').trim().toLowerCase();
    const handler = process.env.HANDLED_BY?.toLowerCase() || '';
    const retryCount = parseInt((status.match(/Retry (\d+)/) || [])[1] || 0);

    // ✅ International number validation: 10 to 15 digits
    if (!/^\d{10,15}$/.test(number)) {
      console.warn(`⚠️ Invalid number: "${rawNumber}" → cleaned: "${number}"`);
      await updateCell(sheetName, index, 'Status', `❌ Invalid phone number`);
      continue;
    }

    if (handledBy && handler && handledBy !== handler) continue;
    if (retryCount >= MAX_RETRIES) continue;

    console.log(`\n➡️ Row ${index}: ${name} | ${number}`);
    console.log(`   ⚡ Processing instantly`);

    await sendAndUpdateStatus(sheetName, index, client, number, message, imageUrl, retryCount);
  }
}

// Legacy function - now calls instant processing
async function processSheet(sheetName, isScheduled, client) {
  if (isScheduled) {
    return processScheduledMessages(sheetName, client);
  } else {
    return processInstantMessages(sheetName, client);
  }
}

async function sendAndUpdateStatus(sheetName, index, client, number, message, imageUrl, retryCount) {
  try {
    await sendMessage(client, number, message, imageUrl);
    await updateCell(sheetName, index, 'Status', '✅ Sent');
    console.log(`   ✅ Message sent successfully!`);
  } catch (error) {
    const newRetry = retryCount + 1;
    if (newRetry < MAX_RETRIES) {
      await updateCell(sheetName, index, 'Status', `Retry ${newRetry}`);
      console.log(`   ❌ Error sending message. Will retry (${newRetry})`);
    } else {
      await updateCell(sheetName, index, 'Status', `Error: ${error.message}`);
      console.log(`   ❌ Max retries reached.`);
    }
  }
}

// Legacy functions for backward compatibility
async function scheduleMessages(sheetName, client) {
  return scheduleMessageProcessing(sheetName, '*/5 * * * *', client); // Every 5 minutes
}

async function checkAndSendScheduledMessages(sheetName, client) {
  return processScheduledMessages(sheetName, client);
}

// Restart a stopped schedule (useful when new messages are added)
async function restartStoppedSchedule(sheetName, client) {
  const jobId = `message_processing_${sheetName}`;
  const jobData = cronScheduler.jobs.get(jobId);
  
  if (!jobData) {
    console.log(`❌ No schedule found for ${sheetName}`);
    return false;
  }
  
  if (jobData.isActive) {
    console.log(`✅ Schedule ${jobId} is already running`);
    return true;
  }
  
  console.log(`🔄 Restarting stopped schedule: ${jobId}`);
  cronScheduler.startJob(jobId);
  console.log(`✅ Schedule ${jobId} restarted successfully`);
  return true;
}

// Check if a schedule exists and can be restarted
function canRestartSchedule(sheetName) {
  const jobId = `message_processing_${sheetName}`;
  const jobData = cronScheduler.jobs.get(jobId);
  
  if (!jobData) {
    return { exists: false, canRestart: false, reason: 'Schedule not found' };
  }
  
  if (jobData.isActive) {
    return { exists: true, canRestart: false, reason: 'Schedule is already running' };
  }
  
  return { exists: true, canRestart: true, reason: 'Schedule can be restarted' };
}

module.exports = { 
  processSheet,
  processInstantMessages,
  processScheduledMessages,
  scheduleMessages,
  checkAndSendScheduledMessages,
  cronScheduler,
  scheduleMessageProcessing,
  scheduleBulkMessageProcessing,
  scheduleCustomTask,
  restartStoppedSchedule,
  canRestartSchedule
};
