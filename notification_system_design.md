# Notification System Design

## Stage 1

### Overview
A campus notification platform where students receive real-time updates regarding Placements, Events, and Results.

### REST API Endpoints

#### Authentication Header (all routes)
```
Authorization: Bearer <token>
```

---

#### 1. Get All Notifications for a Student
**GET** `/api/notifications`

Request Headers:
```json
{
  "Authorization": "Bearer <token>"
}
```

Response (200):
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "placement",
      "title": "TCS Walk-in Drive",
      "message": "TCS is conducting a walk-in drive on 10th June.",
      "isRead": false,
      "createdAt": "2026-05-01T10:00:00Z"
    }
  ]
}
```

---

#### 2. Get a Single Notification
**GET** `/api/notifications/:id`

Response (200):
```json
{
  "id": "uuid",
  "type": "event",
  "title": "Annual Tech Fest",
  "message": "Join us for the annual tech fest on 15th June.",
  "isRead": true,
  "createdAt": "2026-05-01T10:00:00Z"
}
```

---

#### 3. Create a Notification (Admin only)
**POST** `/api/notifications`

Request Body:
```json
{
  "type": "result",
  "title": "Semester Results Published",
  "message": "Your semester results are now available.",
  "targetStudentIds": ["studentId1", "studentId2"]
}
```

Response (201):
```json
{
  "message": "Notification created successfully",
  "notificationId": "uuid"
}
```

---

#### 4. Mark Notification as Read
**PATCH** `/api/notifications/:id/read`

Response (200):
```json
{
  "message": "Notification marked as read",
  "id": "uuid"
}
```

---

#### 5. Mark All Notifications as Read
**PATCH** `/api/notifications/read-all`

Response (200):
```json
{
  "message": "All notifications marked as read"
}
```

---

#### 6. Delete a Notification
**DELETE** `/api/notifications/:id`

Response (200):
```json
{
  "message": "Notification deleted"
}
```

---

#### 7. Get Unread Count
**GET** `/api/notifications/unread-count`

Response (200):
```json
{
  "unreadCount": 5
}
```

---

### Real-Time Notification Mechanism

Use **WebSockets** (via `socket.io`) for real-time delivery:

- Student connects to the WebSocket server with their auth token
- Server validates token and joins the student to a room: `room:<studentId>`
- When admin creates a notification, server emits to the target rooms
- Client receives notification instantly without polling

```
Client --> connects with token --> Server validates --> joins room:<studentId>
Admin creates notification --> Server emits to room:<studentId> --> Client receives
```

---

## Stage 2

### Recommended Database: PostgreSQL

**Why PostgreSQL?**
- Relational structure suits notifications (students → notifications relationship)
- Supports indexing for fast unread queries
- ACID compliant — no data loss for critical academic notifications
- Supports JSON columns for flexible metadata

---

### DB Schema

#### Table: students
```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  rollNo VARCHAR(100) UNIQUE NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

#### Table: notifications
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL CHECK (type IN ('placement', 'event', 'result')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

#### Table: student_notifications (junction table)
```sql
CREATE TABLE student_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studentId UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notificationId UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  isRead BOOLEAN DEFAULT FALSE,
  readAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

---

### Scalability Problems at 50,000 Students / 5,000,000 Notifications

1. **Full table scans** on `student_notifications` for unread queries become very slow
2. **Fan-out problem**: creating 50,000 rows per notification (one per student) is expensive
3. **Write amplification** when broadcasting to all students
4. **Memory pressure** from loading millions of rows

### Solutions

- Add indexes on frequently queried columns
- Use **read replicas** for SELECT queries
- Use **Redis** to cache unread counts per student
- Use a **message queue** (e.g. RabbitMQ or Kafka) for async fan-out delivery
- **Paginate** all list endpoints (limit/offset or cursor-based)

### Relevant SQL Queries

#### Get unread notifications for a student:
```sql
SELECT n.id, n.type, n.title, n.message, sn.isRead, n.createdAt
FROM student_notifications sn
JOIN notifications n ON sn.notificationId = n.id
WHERE sn.studentId = '1042'
  AND sn.isRead = false
ORDER BY n.createdAt DESC
LIMIT 20 OFFSET 0;
```

#### Get unread count for a student:
```sql
SELECT COUNT(*) AS unread_count
FROM student_notifications
WHERE studentId = '1042' AND isRead = false;
```

---

## Stage 3

### Slow Query Analysis

Original slow query:
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Problems:**
1. `SELECT *` fetches all columns including large `message` TEXT — wasteful
2. No index on `(studentID, isRead)` — causes full table scan on 5M rows
3. No `LIMIT` — fetches all unread records into memory
4. No index on `createdAt` — ORDER BY requires full sort

**Optimized Query:**
```sql
SELECT id, type, title, createdAt
FROM student_notifications sn
JOIN notifications n ON sn.notificationId = n.id
WHERE sn.studentId = 1042
  AND sn.isRead = false
ORDER BY n.createdAt DESC
LIMIT 20 OFFSET 0;
```

**Indexes to add:**
```sql
-- Composite index for the most common query pattern
CREATE INDEX idx_student_notifications_student_read
ON student_notifications(studentId, isRead);

-- Index for sorting
CREATE INDEX idx_notifications_created_at
ON notifications(createdAt DESC);
```

**Why this is faster:**
- Composite index on `(studentId, isRead)` avoids full table scan
- Only fetches needed columns instead of `SELECT *`
- `LIMIT 20` prevents loading millions of rows into memory
- Index on `createdAt DESC` speeds up the ORDER BY clause