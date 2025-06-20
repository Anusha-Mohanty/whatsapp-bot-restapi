/**
 * Schedule Persistence System
 * 
 * This module saves schedules to a file and restores them when the bot starts
 */

const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = 'saved-schedules.json';

class SchedulePersistence {
  constructor() {
    this.scheduleFile = path.join(process.cwd(), SCHEDULE_FILE);
  }

  // Save all active schedules to file
  saveSchedules(schedules) {
    try {
      const scheduleData = {
        timestamp: new Date().toISOString(),
        schedules: schedules.map(schedule => ({
          jobId: schedule.jobId,
          cronExpression: schedule.cronExpression,
          options: schedule.options,
          isActive: schedule.isActive
        }))
      };

      fs.writeFileSync(this.scheduleFile, JSON.stringify(scheduleData, null, 2));
      console.log(`💾 Saved ${schedules.length} schedules to ${SCHEDULE_FILE}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to save schedules:', error.message);
      return false;
    }
  }

  // Load saved schedules from file
  loadSchedules() {
    try {
      if (!fs.existsSync(this.scheduleFile)) {
        console.log('📁 No saved schedules found');
        return [];
      }

      const data = fs.readFileSync(this.scheduleFile, 'utf8');
      const scheduleData = JSON.parse(data);
      
      console.log(`📂 Loaded ${scheduleData.schedules.length} saved schedules from ${SCHEDULE_FILE}`);
      console.log(`📅 Saved on: ${scheduleData.timestamp}`);
      
      return scheduleData.schedules;
    } catch (error) {
      console.error('❌ Failed to load schedules:', error.message);
      return [];
    }
  }

  // Clear saved schedules
  clearSchedules() {
    try {
      if (fs.existsSync(this.scheduleFile)) {
        fs.unlinkSync(this.scheduleFile);
        console.log('🗑️ Cleared saved schedules');
      }
      return true;
    } catch (error) {
      console.error('❌ Failed to clear schedules:', error.message);
      return false;
    }
  }

  // Check if schedules file exists
  hasSavedSchedules() {
    return fs.existsSync(this.scheduleFile);
  }

  // Get schedule file info
  getScheduleFileInfo() {
    try {
      if (!fs.existsSync(this.scheduleFile)) {
        return null;
      }

      const stats = fs.statSync(this.scheduleFile);
      const data = fs.readFileSync(this.scheduleFile, 'utf8');
      const scheduleData = JSON.parse(data);

      return {
        filename: SCHEDULE_FILE,
        size: stats.size,
        modified: stats.mtime,
        savedOn: scheduleData.timestamp,
        scheduleCount: scheduleData.schedules.length
      };
    } catch (error) {
      console.error('❌ Failed to get schedule file info:', error.message);
      return null;
    }
  }
}

// Auto-save function to be called periodically
function autoSaveSchedules(cronScheduler, persistence) {
  const schedules = cronScheduler.getAllJobsStatus();
  persistence.saveSchedules(schedules);
}

// Auto-restore function to be called on startup
async function autoRestoreSchedules(cronScheduler, persistence, client) {
  const savedSchedules = persistence.loadSchedules();
  
  if (savedSchedules.length === 0) {
    console.log('📭 No saved schedules to restore');
    return;
  }

  console.log('🔄 Restoring saved schedules...');
  
  for (const savedSchedule of savedSchedules) {
    try {
      // Determine schedule type based on jobId
      if (savedSchedule.jobId.startsWith('message_processing_')) {
        const sheetName = savedSchedule.jobId.replace('message_processing_', '');
        await require('./scheduler').scheduleMessageProcessing(
          sheetName,
          savedSchedule.cronExpression,
          client,
          savedSchedule.options
        );
      } else if (savedSchedule.jobId.startsWith('bulk_processing_')) {
        const sheetName = savedSchedule.jobId.replace('bulk_processing_', '');
        await require('./scheduler').scheduleBulkMessageProcessing(
          sheetName,
          savedSchedule.cronExpression,
          client,
          savedSchedule.options
        );
      }

      // Start the job if it was active
      if (savedSchedule.isActive) {
        cronScheduler.startJob(savedSchedule.jobId);
      }

      console.log(`✅ Restored: ${savedSchedule.jobId}`);
    } catch (error) {
      console.error(`❌ Failed to restore ${savedSchedule.jobId}:`, error.message);
    }
  }

  console.log('🎉 Schedule restoration completed');
}

module.exports = {
  SchedulePersistence,
  autoSaveSchedules,
  autoRestoreSchedules
}; 