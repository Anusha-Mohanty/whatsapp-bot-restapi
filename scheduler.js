const cron = require('node-cron');
const { processCombinedMessages } = require('./sendMessage');
const { DateTime } = require('luxon');

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';

class CronScheduler {
    constructor() {
        this.jobs = new Map();
    }

    scheduleTask(jobId, cronExpression, taskFunction, client, sheetName, onAutoStop) {
        if (this.jobs.has(jobId)) {
            this.stopJob(jobId);
        }

        const task = async () => {
            console.log(`\n-- 🚀 Running job: ${jobId} at ${DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('dd/MM/yyyy HH:mm:ss')} --`);
            try {
                const result = await taskFunction(client, sheetName, {
                    scheduledMode: true,
                    autoStopSchedule: true,
                });

                if (result.shouldStopSchedule) {
                    console.log(`🎉 All scheduled messages sent. Stopping job: ${jobId}.`);
                    this.stopJob(jobId);
                    if (typeof onAutoStop === 'function') {
                        onAutoStop();
                    }
                }
            } catch (error) {
                console.error(`❌ Error during scheduled task ${jobId}:`, error);
            }
        };

        const job = cron.schedule(cronExpression, task, {
            scheduled: false,
            timezone: DEFAULT_TIMEZONE,
        });

        this.jobs.set(jobId, { job, cronExpression });
        console.log(`📅 Job "${jobId}" scheduled with cron: "${cronExpression}". It is currently stopped.`);
        return job;
    }

    startJob(jobId) {
        const jobData = this.jobs.get(jobId);
        if (jobData && jobData.job) {
            jobData.job.start();
            console.log(`▶️ Job "${jobId}" has started.`);
        } else {
            console.error(`⚠️ Could not start job: ${jobId}. Not found.`);
        }
    }

    stopJob(jobId) {
        const jobData = this.jobs.get(jobId);
        if (jobData && jobData.job) {
            jobData.job.stop();
            console.log(`⏹️ Job "${jobId}" has been stopped.`);
        } else {
            console.error(`⚠️ Could not stop job: ${jobId}. Not found.`);
        }
    }

    getJobStatus(jobId) {
        const jobData = this.jobs.get(jobId);
        if (!jobData) return 'Not Found';
        // The `running` property is not standard on the public API of node-cron, so we manage state ourselves if needed
        return {
             cronExpression: jobData.cronExpression,
             // To know if it is active, you need to manage state, e.g. this.jobs.get(jobId).active = true/false
        };
    }

    startAll() {
        console.log('Starting all scheduled jobs...');
        for (const jobId of this.jobs.keys()) {
            this.startJob(jobId);
        }
    }

    stopAll() {
        console.log('Stopping all scheduled jobs...');
        for (const jobId of this.jobs.keys()) {
            this.stopJob(jobId);
        }
    }
}

const scheduler = new CronScheduler();

// This is the primary function to set up and start the scheduler for a given sheet.
function initializeScheduledJobs(client, sheetName, cronExpression = '*/1 * * * *', onAutoStop) {
    const jobId = `process_sheet_${sheetName}`;
    
    scheduler.scheduleTask(
        jobId,
        cronExpression,
        processCombinedMessages, // The main logic is now here
        client,
        sheetName,
        onAutoStop
    );

    scheduler.startJob(jobId);
}

module.exports = {
    scheduler,
    initializeScheduledJobs,
};
