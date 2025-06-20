const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3000/send-now';
const API_TOKEN = process.env.API_TOKEN || 'your_secret_token';
const INTERVAL_MINUTES = parseInt(process.env.SCHEDULE_INTERVAL_MINUTES, 10) || 5;

let intervalId = null;

function triggerScheduled() {
  axios.post(API_URL, { mode: 'scheduled' }, {
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  .then(res => {
    console.log('Triggered scheduled:', new Date().toLocaleString(), res.data);

    // Check if all scheduled messages are sent
    if (
      res.data &&
      res.data.result &&
      typeof res.data.result.scheduledMessagesRemaining === 'number' &&
      res.data.result.scheduledMessagesRemaining === 0
    ) {
      console.log('✅ All scheduled messages have been sent. Stopping scheduler.');
      if (intervalId) clearInterval(intervalId);
      process.exit(0);
    }
  })
  .catch(err => {
    console.error('Error triggering scheduled:', err.response ? err.response.data : err.message);
  });
}

triggerScheduled(); // Run immediately on start
intervalId = setInterval(triggerScheduled, INTERVAL_MINUTES * 60 * 1000);