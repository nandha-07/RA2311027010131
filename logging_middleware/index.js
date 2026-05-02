const axios = require("axios");

let authToken = null;

function setToken(token) {
  authToken = token;
}

async function Log(stack, level, pkg, message) {
  if (!authToken) {
    console.error("[Logger] No auth token set. Call setToken() first.");
    return;
  }

  try {
    const response = await axios.post(
      "http://20.207.122.201/evaluation-service/logs",
      {
        stack: stack,
        level: level,
        package: pkg,
        message: message,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`[Logger] Log created: ${response.data.logID}`);
    return response.data;
  } catch (err) {
    console.error("[Logger] Failed to send log:", err.message);
  }
}

module.exports = { Log, setToken };