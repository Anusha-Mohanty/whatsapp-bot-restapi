const readline = require('readline');

class MenuSystem {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async showWelcome(teamMember) {
    console.clear();
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    WhatsApp Scheduler Bot                    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`👤 Team Member: ${teamMember}`);
    console.log('🕐 Simplified Message Processing & Scheduling');
    console.log('');
  }

  async showMainMenu() {
    console.log('\n📋 MAIN MENU');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('1. 🚀 Send Messages Now (ignores time column - instant only)');
    console.log('2. ⏰ Send Scheduled Messages (manual check OR set up recurring schedule)');
    console.log('3. 📅 Schedule Future Messages (set up recurring processing)');
    console.log('4. 📊 View Status & Schedules (monitor progress and active jobs)');
    console.log('5. ⚙️ Settings (manage schedules, team member, etc.)');
    console.log('6. 🚪 Exit');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('💡 Tip: Option 2 lets you check once OR set up automatic recurring checking');
    console.log('🎉 Auto-stop: Schedules pause when all scheduled messages (with times) are sent');
    console.log('🔄 Restart: Stopped schedules can be restarted when new messages are added');
    console.log('══════════════════════════════════════════════════════════════');
    
    return await this.getUserChoice('Select an option (1-6): ', ['1', '2', '3', '4', '5', '6']);
  }

  async showScheduleMenu() {
    // Removed recurring schedule options to avoid duplicate printing. This menu is now a placeholder or can be repurposed.
    // If needed, you can implement a different menu here.
    return await this.getUserChoice('Select schedule pattern (1-8): ', ['1', '2', '3', '4', '5', '6', '7', '8']);
  }

  async showSettingsMenu() {
    console.log('\n⚙️ SETTINGS');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('1. 👤 Change Team Member');
    console.log('2. 📊 View Active Schedules');
    console.log('3. ⏹️ Stop All Schedules');
    console.log('4. ▶️ Start All Schedules');
    console.log('5. 🗑️ Remove Schedule');
    console.log('6. 🔄 Restart Stopped Schedule');
    console.log('7. ↩️ Back to Main Menu');
    console.log('══════════════════════════════════════════════════════════════');
    
    return await this.getUserChoice('Select option (1-7): ', ['1', '2', '3', '4', '5', '6', '7']);
  }

  getCronExpression(choice) {
    const patterns = {
      '1': '*/10 * * * *',      // Every 10 minutes
      '2': '0 * * * *',         // Every hour
      '3': '0 */2 * * *',       // Every 2 hours
      '4': '0 9 * * *',         // Daily at 9 AM
      '5': '0 18 * * *',        // Daily at 6 PM
      '6': '0 9 * * 1-5',       // Weekdays at 9 AM
      '7': null                 // Custom - will be handled separately
    };
    
    return patterns[choice];
  }

  async getCustomCronExpression() {
    console.log('\n📅 CUSTOM SCHEDULE');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('Format: * * * * * (minute hour day month weekday)');
    console.log('');
    console.log('Examples:');
    console.log('• */5 * * * *     - Every 5 minutes');
    console.log('• 0 */2 * * *     - Every 2 hours');
    console.log('• 0 9 * * 1-5     - Weekdays at 9 AM');
    console.log('• 0 18 * * 1      - Every Monday at 6 PM');
    console.log('• 30 14 * * *     - Daily at 2:30 PM');
    console.log('');
    
    const cronExpression = await this.getUserInput('Enter cron expression: ');
    return cronExpression.trim();
  }

  async getScheduleOptions() {
    console.log('\n⚙️ SCHEDULE OPTIONS');
    console.log('══════════════════════════════════════════════════════════════');
    
    const timezone = await this.getUserInput('Timezone (default: UTC): ') || 'UTC';
    const runImmediately = await this.confirmAction('Run immediately after scheduling?');
    
    return {
      timezone,
      runImmediately
    };
  }

  async showActiveSchedules(schedules) {
    console.log('\n📊 ACTIVE SCHEDULES');
    console.log('══════════════════════════════════════════════════════════════');
    
    if (!schedules || schedules.length === 0) {
      console.log('❌ No active schedules found.');
      return;
    }

    schedules.forEach((schedule, index) => {
      const status = schedule.isActive ? '🟢 Active' : '🔴 Inactive';
      console.log(`${index + 1}. ${schedule.jobId}`);
      console.log(`   Cron: ${schedule.cronExpression}`);
      console.log(`   Status: ${status}`);
      console.log(`   Timezone: ${schedule.options?.timezone || 'UTC'}`);
      console.log('');
    });
  }

  async getScheduleToRemove(schedules) {
    if (!schedules || schedules.length === 0) {
      console.log('❌ No schedules to remove.');
      return null;
    }

    console.log('\n🗑️ REMOVE SCHEDULE');
    console.log('══════════════════════════════════════════════════════════════');
    
    schedules.forEach((schedule, index) => {
      const status = schedule.isActive ? '🟢 Active' : '🔴 Inactive';
      console.log(`${index + 1}. ${schedule.jobId} (${status})`);
    });
    
    const choice = await this.getUserChoice('Select schedule to remove (or 0 to cancel): ', 
      ['0', ...Array.from({length: schedules.length}, (_, i) => (i + 1).toString())]);
    
    if (choice === '0') return null;
    
    const selectedIndex = parseInt(choice) - 1;
    return schedules[selectedIndex].jobId;
  }

  async showStatusDashboard(client, isReady, schedules = []) {
    console.log('\n📊 STATUS DASHBOARD');
    console.log('══════════════════════════════════════════════════════════════');
    
    // Connection Status
    const connectionStatus = isReady ? '🟢 Connected' : '🔴 Disconnected';
    let connectedNumber = '';
    if (isReady && client && client.info && client.info.wid && client.info.wid.user) {
      connectedNumber = client.info.wid.user;
    }
    if (isReady && client && client.info && client.info.pushname) {
      connectedNumber += ` (${client.info.pushname})`;
    }
    if (isReady && connectedNumber) {
      console.log(`🔌 WhatsApp Status: ${connectionStatus} as ${connectedNumber}`);
    } else {
      console.log(`🔌 WhatsApp Status: ${connectionStatus}`);
    }
    
    // Active/Stopped Schedules
    const activeSchedules = schedules.filter(s => s.isActive).length;
    const stoppedSchedules = schedules.filter(s => !s.isActive).length;
    const totalSchedules = schedules.length;
    console.log(`📅 Schedules: ${activeSchedules}/${totalSchedules} active, ${stoppedSchedules} stopped`);
    
    // Quick Stats
    if (schedules.length > 0) {
      console.log('\n📈 Schedule Overview:');
      schedules.forEach((schedule, index) => {
        const status = schedule.isActive ? '🟢 Active' : '🟡 Stopped (can restart)';
        console.log(`   ${schedule.isActive ? '🟢' : '🟡'} ${schedule.jobId} - ${schedule.cronExpression} - ${status}`);
      });
    }
    
    console.log('\n💡 Quick Tips:');
    console.log('   • Option 1: Send all messages immediately (ignores time column)');
    console.log('   • Option 2: Check once OR set up recurring schedule for due messages');
    console.log('   • Option 3: Set up automatic recurring processing');
    console.log('   • 🎉 Auto-stop: Schedules pause when complete (kept for future use)');
    console.log('   • 🔄 Restart: Use Settings → Restart Stopped Schedule when adding new messages');
    console.log('   • 📊 Progress tracking shows remaining messages');
    console.log('══════════════════════════════════════════════════════════════');
  }

  async showProcessingMessage(type) {
    const messages = {
      instant: '🚀 Sending messages now...',
      scheduled: '⏰ Processing scheduled messages...',
      combined: '🔄 Processing combined messages (instant + scheduled)...',
      schedule: '📅 Setting up schedule...'
    };
    
    console.log(`\n${messages[type] || '⏳ Processing...'}`);
    console.log('Please wait...\n');
  }

  async showResults(results) {
    console.log('\n📊 RESULTS SUMMARY');
    console.log('══════════════════════════════════════════════════════════════');
    
    if (results.sent !== undefined) {
      console.log(`📤 Messages Sent: ${results.sent}`);
      console.log(`❌ Failed: ${results.failed}`);
      console.log(`⏭️ Skipped: ${results.skipped}`);
      console.log(`📊 Total Processed: ${results.total}`);
      
      // Show breakdown for combined mode
      if (results.instant !== undefined && results.scheduled !== undefined) {
        console.log(`\n📋 Message Breakdown:`);
        console.log(`   🚀 Instant Messages: ${results.instant}`);
        console.log(`   ⏰ Scheduled Messages: ${results.scheduled}`);
      }
      
      // Show remaining messages info
      if (results.remainingMessages !== undefined) {
        console.log(`\n📈 Progress:`);
        console.log(`   📋 Total Processable: ${results.totalProcessable || 'N/A'}`);
        console.log(`   ⏳ Remaining Messages: ${results.remainingMessages}`);
        
        if (results.shouldStopSchedule) {
          console.log(`\n🎉 All messages completed! Schedule will be stopped automatically.`);
        } else if (results.remainingMessages > 0) {
          console.log(`\n⏰ Schedule will continue running until all messages are sent.`);
        }
      }
    }
    
    if (results.schedule) {
      console.log(`📅 Schedule: ${results.schedule.status}`);
    }
    
    console.log('══════════════════════════════════════════════════════════════');
  }

  async showSuccess(message) {
    console.log(`\n✅ ${message}`);
  }

  async showError(message) {
    console.log(`\n❌ Error: ${message}`);
  }

  async showInfo(message) {
    console.log(`\nℹ️ ${message}`);
  }

  async confirmAction(action) {
    const response = await this.getUserInput(`Are you sure you want to ${action}? (y/N): `);
    return response.toLowerCase() === 'y' || response.toLowerCase() === 'yes';
  }

  async getTeamMemberName() {
    return await this.getUserInput('Enter team member name: ');
  }

  async getUserChoice(prompt, options, validChoices = null) {
    // If only 2 parameters are passed, treat the second as validChoices
    if (validChoices === null) {
      validChoices = options;
      options = null;
    }
    
    // Display options if provided
    if (options && Array.isArray(options)) {
      options.forEach(option => console.log(option));
    }
    
    while (true) {
      const choice = await this.getUserInput(prompt);
      
      if (validChoices.includes(choice.trim())) {
        return choice.trim();
      }
      console.log(`❌ Invalid choice. Please select from: ${validChoices.join(', ')}`);
    }
  }

  async getUserInput(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  async waitForUser() {
    await this.getUserInput('\nPress Enter to continue...');
  }

  close() {
    this.rl.close();
  }
}

module.exports = MenuSystem;
