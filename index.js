require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { cronScheduler, scheduleMessageProcessing, canRestartSchedule, restartStoppedSchedule } = require('./scheduler');
const { processCombinedMessages } = require('./sendMessage');
const ConfigManager = require('./config');
const MenuSystem = require('./menu');
const { SchedulePersistence, autoSaveSchedules, autoRestoreSchedules } = require('./schedule-persistence');
const path = require('path');

class WhatsAppAutomation {
  constructor() {
    this.config = new ConfigManager();
    this.menu = new MenuSystem();
    this.client = null;
    this.isReady = false;
    this.persistence = new SchedulePersistence();
    this.autoSaveInterval = null;
    this.schedules = [];
  }

  async initialize() {
    try {
      await this.menu.showWelcome(this.config.teamMember);
      
      // Check if team member is set up
      if (this.config.teamMember === 'default') {
        const teamMember = await this.menu.getTeamMemberName();
        if (teamMember) {
          this.config.updateTeamMember(teamMember);
          this.menu.showSuccess(`Configuration updated for ${teamMember}`);
        }
      }

      // Initialize WhatsApp client
      await this.initializeWhatsAppClient();
      
      // Restore saved schedules after client is ready
      await this.restoreSavedSchedules();
      
      // Start auto-save for schedules
      this.startAutoSave();
      
      // Start main menu loop
      await this.runMainLoop();
      
    } catch (error) {
      this.menu.showError(error.message);
      await this.menu.waitForUser();
    }
  }

  async initializeWhatsAppClient() {
    console.log('🔄 Initializing WhatsApp client...');
    
    try {
      // Create .wwebjs_auth directory if it doesn't exist
      const authDir = path.join(process.cwd(), '.wwebjs_auth');
      if (!require('fs').existsSync(authDir)) {
        require('fs').mkdirSync(authDir, { recursive: true });
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.config.teamMember,
          dataPath: authDir
        }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      });

      // Handle QR Code
      this.client.on('qr', (qr) => {
        console.log('');
        console.log('📲 Scan this QR code with your WhatsApp mobile app:');
        console.log('');
        try {
          qrcode.generate(qr, { small: true });
        } catch (error) {
          console.error('Error generating QR code:', error);
        }
        console.log('');
        console.log('⏳ Waiting for QR code scan...');
      });

      // Handle ready event
      this.client.on('ready', () => {
        this.isReady = true;
        console.log('✅ WhatsApp client is ready!');
        console.log('Session saved successfully. You won\'t need to scan QR code again.');
      });

      // Handle disconnection
      this.client.on('disconnected', (reason) => {
        console.log('❌ Client disconnected:', reason);
        this.isReady = false;
      });

      // Handle authentication failure
      this.client.on('auth_failure', (error) => {
        console.error('❌ Authentication failed:', error);
        this.isReady = false;
      });

      // Handle loading screen
      this.client.on('loading_screen', (percent, message) => {
        console.log(`Loading: ${percent}% - ${message}`);
      });

      // Initialize the client
      console.log('Starting client initialization...');
      await this.client.initialize();
      console.log('Client initialization started');

      // Wait for client to be ready
      await this.waitForClientReady();
    } catch (error) {
      console.error('Error initializing WhatsApp client:', error);
      throw error;
    }
  }

  async waitForClientReady() {
    return new Promise((resolve) => {
      if (this.isReady) {
        resolve();
        return;
      }

      const checkReady = () => {
        if (this.isReady) {
          resolve();
        } else {
          setTimeout(checkReady, 1000);
        }
      };
      
      checkReady();
    });
  }

  async restoreSavedSchedules() {
    if (this.isReady && this.client) {
      await autoRestoreSchedules(cronScheduler, this.persistence, this.client);
      this.updateSchedulesList();
    }
  }

  updateSchedulesList() {
    this.schedules = cronScheduler.getAllJobsStatus();
  }

  startAutoSave() {
    // Save schedules every 5 minutes
    this.autoSaveInterval = setInterval(() => {
      if (this.isReady) {
        autoSaveSchedules(cronScheduler, this.persistence);
        this.updateSchedulesList();
      }
    }, 5 * 60 * 1000); // 5 minutes

    console.log('💾 Auto-save enabled: Schedules will be saved every 5 minutes');
  }

  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      console.log('⏹️ Auto-save disabled');
    }
  }

  async runMainLoop() {
    let running = true;
    
    while (running) {
      try {
        const choice = await this.menu.showMainMenu();
        
        switch (choice) {
          case '1':
            await this.handleSendMessagesNow();
            break;
          case '2':
            await this.handleSendScheduledMessages();
            break;
          case '3':
            await this.handleScheduleFutureMessages();
            break;
          case '4':
            await this.handleViewStatus();
            break;
          case '5':
            await this.handleSettings();
            break;
          case '6':
            running = false;
            console.log('👋 Goodbye!');
            break;
          default:
            this.menu.showError('Invalid choice. Please select 1-6.');
            await this.menu.waitForUser();
        }
      } catch (error) {
        this.menu.showError(error.message);
        await this.menu.waitForUser();
      }
    }
  }

  async handleSendMessagesNow() {
    if (!this.isReady) {
      this.menu.showError('WhatsApp client is not ready. Please wait for connection.');
      await this.menu.waitForUser();
      return;
    }

    const confirmed = await this.menu.confirmAction('send all messages immediately (ignoring time column)');
    if (!confirmed) return;

    await this.menu.showProcessingMessage('instant');
    
    try {
      const result = await processCombinedMessages(this.client, this.config.messagesSheet, {
        instantMode: true,
        scheduledMode: false
      });
      
      await this.menu.showResults(result);
    } catch (error) {
      this.menu.showError(`Failed to send messages: ${error.message}`);
    }
    
    await this.menu.waitForUser();
  }

  async handleSendScheduledMessages() {
    if (!this.isReady) {
      this.menu.showError('WhatsApp client is not ready. Please wait for connection.');
      await this.menu.waitForUser();
      return;
    }

    console.log('\n⏰ SCHEDULED MESSAGE PROCESSING');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('This will set up automatic checking for scheduled messages.');
    console.log('Messages will be sent when their scheduled time is due.');
    console.log('══════════════════════════════════════════════════════════════');
    
    const choice = await this.menu.getUserChoice('Select processing mode:', [
      '1. Check once now (manual)',
      '2. Set up recurring schedule (automatic)',
      '3. Cancel'
    ], ['1', '2', '3']);
    
    if (choice === '3') {
      return;
    }
    
    if (choice === '1') {
      // Manual one-time check
      const confirmed = await this.menu.confirmAction('check for due messages once');
      if (!confirmed) return;

      await this.menu.showProcessingMessage('scheduled');
      
      try {
        const result = await processCombinedMessages(this.client, this.config.messagesSheet, {
          instantMode: false,
          scheduledMode: true,
          combinedMode: false,
          autoStopSchedule: false
        });
        
        await this.menu.showResults(result);
      } catch (error) {
        this.menu.showError(`Failed to process scheduled messages: ${error.message}`);
      }
      
      await this.menu.waitForUser();
      return;
    }
    
    if (choice === '2') {
      // Set up recurring schedule
      console.log('\n📅 SET UP RECURRING SCHEDULE');
      console.log('══════════════════════════════════════════════════════════════');
      console.log('Choose how often to check for scheduled messages:');
      console.log('1. Every 1 minute (very frequent checking)');
      console.log('2. Every 5 minutes (frequent checking)');
      console.log('3. Every 10 minutes (moderate checking)');
      console.log('4. Every 30 minutes (hourly checking)');
      console.log('5. Every hour (daily checking)');
      console.log('6. Custom interval');
      console.log('7. Cancel');
      console.log('══════════════════════════════════════════════════════════════');
      
      const scheduleChoice = await this.menu.getUserChoice('Select interval (1-7):', ['1', '2', '3', '4', '5', '6', '7']);
      
      if (scheduleChoice === '7') {
        return;
      }
      
      let cronExpression = '';
      let intervalName = '';
      
      switch (scheduleChoice) {
        case '1':
          cronExpression = '* * * * *';
          intervalName = 'Every 1 minute';
          break;
        case '2':
          cronExpression = '*/5 * * * *';
          intervalName = 'Every 5 minutes';
          break;
        case '3':
          cronExpression = '*/10 * * * *';
          intervalName = 'Every 10 minutes';
          break;
        case '4':
          cronExpression = '*/30 * * * *';
          intervalName = 'Every 30 minutes';
          break;
        case '5':
          cronExpression = '0 * * * *';
          intervalName = 'Every hour';
          break;
        case '6':
          console.log('\n📅 CUSTOM INTERVAL');
          console.log('══════════════════════════════════════════════════════════════');
          console.log('Enter custom cron expression (e.g., */15 for every 15 minutes)');
          console.log('Format: minute hour day month weekday');
          console.log('Examples:');
          console.log('• */15 * * * *     - Every 15 minutes');
          console.log('• 0 */2 * * *      - Every 2 hours');
          console.log('• 0 9 * * *        - Daily at 9 AM');
          console.log('• 0 9 * * 1-5      - Weekdays at 9 AM');
          console.log('══════════════════════════════════════════════════════════════');
          
          cronExpression = await this.menu.getUserInput('Enter cron expression: ');
          intervalName = 'Custom interval';
          break;
      }
      
      if (!cronExpression) {
        this.menu.showError('Invalid cron expression. Please try again.');
        await this.menu.waitForUser();
        return;
      }
      
      if (!cronScheduler.validateCronExpression(cronExpression)) {
        this.menu.showError('Invalid cron expression. Please check the format.');
        await this.menu.waitForUser();
        return;
      }
      
      const confirmed = await this.menu.confirmAction(`set up ${intervalName} checking for scheduled messages`);
      if (!confirmed) return;

      await this.menu.showProcessingMessage('schedule');
      
      try {
        // Schedule the recurring message processing
        await scheduleMessageProcessing(
          this.config.messagesSheet,
          cronExpression,
          this.client,
          {
            timezone: 'UTC',
            runImmediately: true
          },
          () => {
            // Callback when schedule auto-stops
            console.log('\n🎉 All scheduled messages sent. Returning to main menu...');
            setTimeout(() => this.runMainLoop(), 1000); // Show menu after a short delay
          }
        );
        
        // Start the job immediately
        const jobId = `message_processing_${this.config.messagesSheet}`;
        cronScheduler.startJob(jobId);
        
        this.updateSchedulesList();
        
        console.log(`\n✅ Scheduled message processing set up successfully!`);
        console.log(`⏰ Interval: ${intervalName}`);
        console.log(`📅 Cron: ${cronExpression}`);
        console.log(`🎯 Sheet: ${this.config.messagesSheet}`);
        console.log(`🎉 Auto-stop: Will stop when all messages are sent`);
        
        await this.menu.showResults({ 
          schedule: { 
            status: 'Scheduled successfully',
            interval: intervalName,
            cron: cronExpression
          } 
        });
        
      } catch (error) {
        this.menu.showError(`Failed to set up schedule: ${error.message}`);
      }
      
      await this.menu.waitForUser();
    }
  }

  async handleScheduleFutureMessages() {
    if (!this.isReady) {
      this.menu.showError('WhatsApp client is not ready. Please wait for connection.');
      await this.menu.waitForUser();
      return;
    }

    let running = true;
    
    while (running) {
      try {
        // Only call showScheduleMenu to display options and get choice
        const choice = await this.menu.showScheduleMenu();
        
        if (choice === '8') {
          running = false;
          break;
        }

        let cronExpression = this.menu.getCronExpression(choice);
        
        if (choice === '7') {
          cronExpression = await this.menu.getCustomCronExpression();
        }
        
        if (!cronExpression) {
          this.menu.showError('Invalid schedule pattern. Please try again.');
          await this.menu.waitForUser();
          continue;
        }

        if (!cronScheduler.validateCronExpression(cronExpression)) {
          this.menu.showError('Invalid cron expression. Please check the format.');
          await this.menu.waitForUser();
          continue;
        }

        const options = await this.menu.getScheduleOptions();
        
        await this.menu.showProcessingMessage('schedule');
        
        // Schedule the combined message processing
        await scheduleMessageProcessing(this.config.messagesSheet, cronExpression, this.client, options);
        
        if (options.runImmediately) {
          cronScheduler.startJob(`message_processing_${this.config.messagesSheet}`);
        }
        
        this.updateSchedulesList();
        this.menu.showSuccess(`Messages scheduled with pattern: ${cronExpression}`);
        await this.menu.showResults({ schedule: { status: 'Scheduled successfully' } });
        
        running = false;
      } catch (error) {
        this.menu.showError(error.message);
        await this.menu.waitForUser();
      }
    }
  }

  async handleViewStatus() {
    await this.menu.showStatusDashboard(this.client, this.isReady, this.schedules);
    await this.menu.waitForUser();
  }

  async handleSettings() {
    let running = true;
    
    while (running) {
      try {
        const choice = await this.menu.showSettingsMenu();
        
        switch (choice) {
          case '1':
            await this.handleChangeTeamMember();
            break;
          case '2':
            await this.handleViewSchedules();
            break;
          case '3':
            await this.handleStopAllSchedules();
            break;
          case '4':
            await this.handleStartAllSchedules();
            break;
          case '5':
            await this.handleRemoveSchedule();
            break;
          case '6':
            await this.handleRestartStoppedSchedule();
            break;
          case '7':
            running = false;
            break;
          default:
            this.menu.showError('Invalid choice. Please select 1-7.');
            await this.menu.waitForUser();
        }
      } catch (error) {
        this.menu.showError(error.message);
        await this.menu.waitForUser();
      }
    }
  }

  async handleViewSchedules() {
    this.updateSchedulesList();
    await this.menu.showActiveSchedules(this.schedules);
    await this.menu.waitForUser();
  }

  async handleStopAllSchedules() {
    const confirmed = await this.menu.confirmAction('stop all active schedules');
    if (!confirmed) return;

    try {
      cronScheduler.stopAllJobs();
      this.updateSchedulesList();
      this.menu.showSuccess('All schedules stopped successfully');
    } catch (error) {
      this.menu.showError(`Failed to stop schedules: ${error.message}`);
    }
    
    await this.menu.waitForUser();
  }

  async handleStartAllSchedules() {
    const confirmed = await this.menu.confirmAction('start all schedules');
    if (!confirmed) return;

    try {
      cronScheduler.startAllJobs();
      this.updateSchedulesList();
      this.menu.showSuccess('All schedules started successfully');
    } catch (error) {
      this.menu.showError(`Failed to start schedules: ${error.message}`);
    }
    
    await this.menu.waitForUser();
  }

  async handleRemoveSchedule() {
    this.updateSchedulesList();
    const scheduleToRemove = await this.menu.getScheduleToRemove(this.schedules);
    
    if (!scheduleToRemove) return;

    const confirmed = await this.menu.confirmAction(`remove schedule: ${scheduleToRemove}`);
    if (!confirmed) return;

    try {
      cronScheduler.removeJob(scheduleToRemove);
      this.updateSchedulesList();
      this.menu.showSuccess(`Schedule ${scheduleToRemove} removed successfully`);
    } catch (error) {
      this.menu.showError(`Failed to remove schedule: ${error.message}`);
    }
    
    await this.menu.waitForUser();
  }

  async handleChangeTeamMember() {
    const newTeamMember = await this.menu.getTeamMemberName();
    if (newTeamMember && newTeamMember.trim()) {
      this.config.updateTeamMember(newTeamMember.trim());
      this.menu.showSuccess(`Team member changed to: ${newTeamMember}`);
    }
    await this.menu.waitForUser();
  }

  async handleRestartStoppedSchedule() {
    // Check if there's a schedule that can be restarted
    const restartInfo = canRestartSchedule(this.config.messagesSheet);
    
    if (!restartInfo.exists) {
      this.menu.showError('No schedule found for this sheet. Please set up a schedule first.');
      await this.menu.waitForUser();
      return;
    }
    
    if (!restartInfo.canRestart) {
      this.menu.showError(`Cannot restart schedule: ${restartInfo.reason}`);
      await this.menu.waitForUser();
      return;
    }
    
    const confirmed = await this.menu.confirmAction('restart the stopped schedule');
    if (!confirmed) return;

    try {
      await restartStoppedSchedule(this.config.messagesSheet, this.client);
      this.updateSchedulesList();
      this.menu.showSuccess('Schedule restarted successfully');
    } catch (error) {
      this.menu.showError(`Failed to restart schedule: ${error.message}`);
    }
    
    await this.menu.waitForUser();
  }

  cleanup() {
    try {
      // Stop auto-save
      this.stopAutoSave();
      
      // Save schedules before exiting
      if (this.isReady) {
        autoSaveSchedules(cronScheduler, this.persistence);
      }
      
      // Close menu
      this.menu.close();
      
      // Close WhatsApp client
      if (this.client) {
        this.client.destroy();
      }
      
      console.log('✅ Cleanup completed successfully');
    } catch (error) {
      console.error('❌ Error during cleanup:', error.message);
    }
  }
}

async function main() {
  const automation = new WhatsAppAutomation();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    automation.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    automation.cleanup();
    process.exit(0);
  });

  try {
    await automation.initialize();
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    automation.cleanup();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = WhatsAppAutomation;
