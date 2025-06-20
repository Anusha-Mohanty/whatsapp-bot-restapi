const { DateTime } = require('luxon');

// Get timezone from environment variable, default to Asia/Kolkata
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';
const DUE_WINDOW_MINUTES = process.env.DUE_WINDOW_MINUTES ? parseInt(process.env.DUE_WINDOW_MINUTES) : 60;

// Format date into readable string (used for logging)
function formatTime(date, timezone = DEFAULT_TIMEZONE) {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat('dd/MM/yyyy, hh:mm:ss a');
}

// Check if message is due based on scheduled time and timezone
function isDue(scheduledTimeStr, timezone = DEFAULT_TIMEZONE) {
  const now = DateTime.now().setZone(timezone);
  const scheduled = parseTime(scheduledTimeStr, timezone);
  if (!scheduled) return false;
  return scheduled <= now;
}

// Extract retry count from status
function getRetryCount(status) {
  const match = status?.match(/Retry (\d+)/);
  return match ? parseInt(match[1]) : 0;
}

// Decide if the message should be retried
function shouldRetry(status, maxRetries = 3) {
  return getRetryCount(status) < maxRetries;
}

// Create next retry status string
function nextRetryStatus(status) {
  const count = getRetryCount(status);
  return `Retry ${count + 1}`;
}

// Parse scheduled time string into Luxon DateTime (fallback to null if invalid)
function parseTime(timeString, timezone = DEFAULT_TIMEZONE) {
  if (!timeString || timeString.trim() === '') {
    console.log(`⚠️ Empty time string provided`);
    return null;
  }
  
  if (timeString.trim().toLowerCase() === 'now') {
    console.log(`✅ Parsed 'now' as immediate processing`);
    return DateTime.now().setZone(timezone);
  }

  let dt;
  const trimmedTime = timeString.trim();

  // Handle time-only formats (assume today's date)
  if (/^\d{1,2}:\d{2}$/.test(trimmedTime)) {
    // Format: HH:mm (e.g., 20:50)
    const [hours, minutes] = trimmedTime.split(':');
    dt = DateTime.now().setZone(timezone).set({ hour: parseInt(hours), minute: parseInt(minutes), second: 0, millisecond: 0 });
    return dt;
  }

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(trimmedTime)) {
    // Format: HH:mm:ss (e.g., 20:50:30)
    const [hours, minutes, seconds] = trimmedTime.split(':');
    dt = DateTime.now().setZone(timezone).set({ hour: parseInt(hours), minute: parseInt(minutes), second: parseInt(seconds), millisecond: 0 });
    return dt;
  }

  // Handle 12-hour time formats with AM/PM
  if (/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)$/.test(trimmedTime)) {
    // Format: HH:mm AM/PM (e.g., 8:30 PM, 08:30 AM)
    const match = trimmedTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
    const [, hours, minutes, period] = match;
    let hour24 = parseInt(hours);
    
    if (period.toUpperCase() === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period.toUpperCase() === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    dt = DateTime.now().setZone(timezone).set({ hour: hour24, minute: parseInt(minutes), second: 0, millisecond: 0 });
    return dt;
  }

  if (/^\d{1,2}:\d{2}:\d{2}\s*(AM|PM|am|pm)$/.test(trimmedTime)) {
    // Format: HH:mm:ss AM/PM (e.g., 8:30:00 PM, 08:30:00 AM)
    const match = trimmedTime.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM|am|pm)$/);
    const [, hours, minutes, seconds, period] = match;
    let hour24 = parseInt(hours);
    
    if (period.toUpperCase() === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period.toUpperCase() === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    dt = DateTime.now().setZone(timezone).set({ hour: hour24, minute: parseInt(minutes), second: parseInt(seconds), millisecond: 0 });
    return dt;
  }

  // Primary format: dd/MM/yyyy HH:mm (e.g., 25/06/2024 12:50)
  dt = DateTime.fromFormat(trimmedTime, 'dd/MM/yyyy HH:mm', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Secondary format: dd/MM/yyyy HH:mm:ss (e.g., 25/06/2024 12:50:30)
  dt = DateTime.fromFormat(trimmedTime, 'dd/MM/yyyy HH:mm:ss', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Legacy format: dd/MM/yy HH:mm (e.g., 25/06/24 12:50) - for backward compatibility
  dt = DateTime.fromFormat(trimmedTime, 'dd/MM/yy HH:mm', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Legacy format: dd/MM/yy HH:mm:ss (e.g., 25/06/24 12:50:30) - for backward compatibility
  dt = DateTime.fromFormat(trimmedTime, 'dd/MM/yy HH:mm:ss', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // ISO format: yyyy-MM-dd HH:mm (e.g., 2024-06-25 12:50)
  dt = DateTime.fromFormat(trimmedTime, 'yyyy-MM-dd HH:mm', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // ISO format: yyyy-MM-dd HH:mm:ss (e.g., 2024-06-25 12:50:30)
  dt = DateTime.fromFormat(trimmedTime, 'yyyy-MM-dd HH:mm:ss', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Handle MM/dd/yyyy format (US format)
  dt = DateTime.fromFormat(trimmedTime, 'MM/dd/yyyy HH:mm', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  dt = DateTime.fromFormat(trimmedTime, 'MM/dd/yyyy HH:mm:ss', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Handle date formats with 12-hour time
  // Format: dd/MM/yyyy HH:mm AM/PM (e.g., 25/12/2024 8:30 PM)
  dt = DateTime.fromFormat(trimmedTime, 'dd/MM/yyyy h:mm a', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Format: MM/dd/yyyy HH:mm AM/PM (e.g., 12/25/2024 8:30 PM)
  dt = DateTime.fromFormat(trimmedTime, 'MM/dd/yyyy h:mm a', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Format: yyyy-MM-dd HH:mm AM/PM (e.g., 2024-12-25 8:30 PM)
  dt = DateTime.fromFormat(trimmedTime, 'yyyy-MM-dd h:mm a', { zone: timezone });
  if (dt.isValid) {
    return dt;
  }

  // Try manual parsing for dd/MM/yyyy HH:mm format
  const manualMatch = trimmedTime.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (manualMatch) {
    const [, day, month, year, hour, minute] = manualMatch;
    
    dt = DateTime.fromObject({
      year: parseInt(year),
      month: parseInt(month),
      day: parseInt(day),
      hour: parseInt(hour),
      minute: parseInt(minute),
      second: 0,
      millisecond: 0
    }, { zone: timezone });
    
    if (dt.isValid) {
      return dt;
    }
  }

  // Fallback to Date parser if still invalid
  const fallback = new Date(trimmedTime);
  if (!isNaN(fallback)) {
    const fallbackDt = DateTime.fromJSDate(fallback).setZone(timezone);
    return fallbackDt;
  }

  console.warn(`❌ Invalid time format: ${trimmedTime}`);
  console.warn(`💡 Supported formats:`);
  console.warn(`   • HH:mm (e.g., 20:50) - assumes today's date`);
  console.warn(`   • HH:mm AM/PM (e.g., 8:30 PM) - assumes today's date`);
  console.warn(`   • dd/MM/yyyy HH:mm (e.g., 25/06/2024 12:50)`);
  console.warn(`   • dd/MM/yyyy HH:mm AM/PM (e.g., 25/06/2024 8:30 PM)`);
  console.warn(`   • dd/MM/yyyy HH:mm:ss (e.g., 25/06/2024 12:50:30)`);
  console.warn(`   • dd/MM/yy HH:mm (e.g., 25/06/24 12:50) - legacy`);
  console.warn(`   • yyyy-MM-dd HH:mm (e.g., 2024-06-25 12:50)`);
  console.warn(`   • yyyy-MM-dd HH:mm AM/PM (e.g., 2024-06-25 8:30 PM)`);
  console.warn(`   • MM/dd/yyyy HH:mm (e.g., 06/25/2024 12:50) - US format`);
  console.warn(`   • MM/dd/yyyy HH:mm AM/PM (e.g., 06/25/2024 8:30 PM) - US format`);
  console.warn(`   • now (for immediate processing)`);
  
  return null;
}

// Show current time in different timezones for reference
function showCurrentTimes() {
  const now = DateTime.now();
  console.log('\n🕐 Current Time Reference:');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`UTC:        ${now.toUTC().toFormat('dd/MM/yyyy HH:mm')}`);
  console.log(`Local:      ${now.toLocal().toFormat('dd/MM/yyyy HH:mm')}`);
  console.log(`Asia/Kolkata: ${now.setZone('Asia/Kolkata').toFormat('dd/MM/yyyy HH:mm')}`);
  console.log(`US/Eastern: ${now.setZone('US/Eastern').toFormat('dd/MM/yyyy HH:mm')}`);
  console.log(`Europe/London: ${now.setZone('Europe/London').toFormat('dd/MM/yyyy HH:mm')}`);
  console.log('══════════════════════════════════════════════════════════════');
}

// Check if a scheduled time is due (for Luxon DateTime objects)
function isTimeDue(scheduledTime, windowMinutes = DUE_WINDOW_MINUTES) {
  // Always use the configured timezone to ensure consistent comparison
  const zone = DEFAULT_TIMEZONE;
  
  // Get current time in the configured timezone
  const now = DateTime.now().setZone(zone);
  
  // Ensure scheduled time is also in the configured timezone
  const scheduledInZone = scheduledTime.setZone(zone);
  
  const timeDiff = now.diff(scheduledInZone, 'minutes').minutes;
  
  // Consider messages as due if they are past their scheduled time but within the window
  const isDue = timeDiff >= 0 && timeDiff <= windowMinutes;
  
  console.log(`⏰ Time check: Scheduled: ${scheduledInZone.toFormat('dd/MM/yyyy HH:mm')} (${zone}), Now: ${now.toFormat('dd/MM/yyyy HH:mm')} (${zone}), Diff: ${timeDiff.toFixed(1)} minutes, Due: ${isDue} (window: ${windowMinutes} min)`);
  
  return isDue;
}

module.exports = {
  formatTime,
  isDue,
  getRetryCount,
  shouldRetry,
  nextRetryStatus,
  parseTime,
  showCurrentTimes,
  isTimeDue,
};
