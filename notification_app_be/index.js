const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const { Log, setToken } = require("../logging_middleware/index");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

let currentToken = null;

// ─── Auto-refresh Token ───────────────────────────────────────────────────────
async function refreshToken() {
  try {
    const res = await axios.post(
      "http://20.207.122.201/evaluation-service/auth",
      {
        email: "nk8291@srmist.edu.in",
        name: "Nandha Kumar K",
        rollNo: "RA2311027010131",
        accessCode: "QkbpxH",
        clientID: "885ce191-ab7a-4205-85e0-a46888dc58dd",
        clientSecret: "VjccZWwgGcaMZbfz",
      }
    );
    currentToken = res.data.access_token;
    setToken(currentToken);
    console.log("[Auth] Token refreshed successfully");
    setTimeout(refreshToken, 10 * 60 * 1000);
  } catch (err) {
    console.error("[Auth] Token refresh failed:", err.message);
    setTimeout(refreshToken, 60 * 1000);
  }
}

// ─── In-Memory Store ──────────────────────────────────────────────────────────
let notifications = [];
let notificationId = 1;

// ─── WebSocket ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const studentId = socket.handshake.query.studentId;
  if (studentId) {
    socket.join(`room:${studentId}`);
    console.log(`[WS] Student ${studentId} connected`);
  }
  socket.on("disconnect", () => {
    console.log(`[WS] Student ${studentId} disconnected`);
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/notifications - get all notifications for a student
app.get("/api/notifications", async (req, res) => {
  const { studentId } = req.query;
  try {
    await Log("backend", "info", "route", `Fetching notifications for student ${studentId}`);
    const result = studentId
      ? notifications.filter((n) => n.targetStudentIds.includes(studentId))
      : notifications;
    await Log("backend", "info", "service", `Returned ${result.length} notifications`);
    res.json({ notifications: result });
  } catch (err) {
    await Log("backend", "error", "handler", `Failed to fetch notifications: ${err.message}`);
    res.status(500).json({ message: "Error fetching notifications" });
  }
});

// GET /api/notifications/unread-count
app.get("/api/notifications/unread-count", async (req, res) => {
  const { studentId } = req.query;
  try {
    await Log("backend", "info", "route", `Fetching unread count for student ${studentId}`);
    const count = notifications.filter(
      (n) => !n.isRead && (!studentId || n.targetStudentIds.includes(studentId))
    ).length;
    await Log("backend", "info", "service", `Unread count: ${count}`);
    res.json({ unreadCount: count });
  } catch (err) {
    await Log("backend", "error", "handler", `Unread count failed: ${err.message}`);
    res.status(500).json({ message: "Error fetching unread count" });
  }
});

// GET /api/notifications/:id
app.get("/api/notifications/:id", async (req, res) => {
  try {
    await Log("backend", "info", "route", `Fetching notification ${req.params.id}`);
    const notification = notifications.find((n) => n.id === parseInt(req.params.id));
    if (!notification) {
      await Log("backend", "error", "service", `Notification ${req.params.id} not found`);
      return res.status(404).json({ message: "Notification not found" });
    }
    res.json(notification);
  } catch (err) {
    await Log("backend", "error", "handler", `Error fetching notification: ${err.message}`);
    res.status(500).json({ message: "Error" });
  }
});

// POST /api/notifications - create notification
app.post("/api/notifications", async (req, res) => {
  const { type, title, message, targetStudentIds } = req.body;
  try {
    if (!type || !title || !message) {
      await Log("backend", "error", "controller", "Create notification failed: missing fields");
      return res.status(400).json({ message: "type, title and message are required" });
    }
    const notification = {
      id: notificationId++,
      type,
      title,
      message,
      targetStudentIds: targetStudentIds || [],
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    notifications.push(notification);
    await Log("backend", "info", "service", `Notification created: ${title} (${type})`);

    // Emit via WebSocket to target students
    if (targetStudentIds && targetStudentIds.length > 0) {
      targetStudentIds.forEach((sid) => {
        io.to(`room:${sid}`).emit("new-notification", notification);
      });
      await Log("backend", "info", "service", `Notification emitted to ${targetStudentIds.length} students via WebSocket`);
    }

    res.status(201).json({ message: "Notification created successfully", notificationId: notification.id });
  } catch (err) {
    await Log("backend", "error", "handler", `Create notification error: ${err.message}`);
    res.status(500).json({ message: "Error creating notification" });
  }
});

// PATCH /api/notifications/read-all - mark all as read
app.patch("/api/notifications/read-all", async (req, res) => {
  try {
    await Log("backend", "info", "route", "Marking all notifications as read");
    notifications.forEach((n) => {
      n.isRead = true;
      n.readAt = new Date().toISOString();
    });
    await Log("backend", "info", "service", "All notifications marked as read");
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    await Log("backend", "error", "handler", `Read-all error: ${err.message}`);
    res.status(500).json({ message: "Error" });
  }
});

// PATCH /api/notifications/:id/read - mark one as read
app.patch("/api/notifications/:id/read", async (req, res) => {
  try {
    await Log("backend", "info", "route", `Marking notification ${req.params.id} as read`);
    const notification = notifications.find((n) => n.id === parseInt(req.params.id));
    if (!notification) {
      await Log("backend", "error", "service", `Notification ${req.params.id} not found`);
      return res.status(404).json({ message: "Notification not found" });
    }
    notification.isRead = true;
    notification.readAt = new Date().toISOString();
    await Log("backend", "info", "service", `Notification ${req.params.id} marked as read`);
    res.json({ message: "Notification marked as read", id: notification.id });
  } catch (err) {
    await Log("backend", "error", "handler", `Mark-read error: ${err.message}`);
    res.status(500).json({ message: "Error" });
  }
});

// DELETE /api/notifications/:id
app.delete("/api/notifications/:id", async (req, res) => {
  try {
    await Log("backend", "info", "route", `Deleting notification ${req.params.id}`);
    const index = notifications.findIndex((n) => n.id === parseInt(req.params.id));
    if (index === -1) {
      await Log("backend", "error", "service", `Notification ${req.params.id} not found`);
      return res.status(404).json({ message: "Notification not found" });
    }
    notifications.splice(index, 1);
    await Log("backend", "warn", "service", `Notification ${req.params.id} deleted`);
    res.json({ message: "Notification deleted" });
  } catch (err) {
    await Log("backend", "error", "handler", `Delete error: ${err.message}`);
    res.status(500).json({ message: "Error" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

refreshToken().then(() => {
  server.listen(PORT, async () => {
    await Log("backend", "info", "config", `Campus Notification Service running on port ${PORT}`);
    console.log(`Notification server running on port ${PORT}`);
  });
});