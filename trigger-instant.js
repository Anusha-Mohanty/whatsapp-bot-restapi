const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3000/send-now';
const API_TOKEN = process.env.API_TOKEN || 'your_secret_token';

function triggerInstant() {
  axios.post(API_URL, { mode: 'instant' }, {
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  .then(res => {
    console.log('Triggered instant:', new Date().toLocaleString(), res.data);
  })
  .catch(err => {
    console.error('Error triggering instant:', err.response ? err.response.data : err.message);
  });
}

triggerInstant(); 