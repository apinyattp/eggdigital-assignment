# eggdigital-assignment

| รายการ | ลิงก์ |
|---|---|
| Production Front End | [เปิดหน้า Login](https://frontend-production-1564.up.railway.app/login) |
| Production Back End | [API](https://backend-production-9356.up.railway.app/api/v1) · [Health](https://backend-production-9356.up.railway.app/api/v1/health/ready) |
| Wireframe | [เปิด Wireframe](https://apinyattp.github.io/eggdigital-assignment/doc/) |
| UI design | [เปิด UI design](https://apinyattp.github.io/eggdigital-assignment/doc/ui-design.html) |

## 1. Flow

```mermaid
flowchart TD
  Login["เข้าสู่ระบบด้วยรหัสผ่านหรือ Google"] --> Member{"เป็น Member ที่ได้รับสิทธิ์?"}
  Member -->|ไม่ใช่| Denied["ปฏิเสธการเข้าสู่ระบบ"]
  Member -->|ใช่| Dashboard["เลือกวันและดูรายการประชุม"]
  Dashboard --> Create["สร้างนัด: Onsite หรือ Online พร้อมลิงก์ HTTPS"]
  Create --> Detail["รายละเอียดนัด"]
  Dashboard --> Detail
  Detail --> Manage["ผู้สร้าง: แก้ไข / จัดทีม / เปลี่ยนสถานะ / ยกเลิก / ลบ"]
  Manage --> Dashboard
  Detail --> Notes["Notes ส่วนตัวของผู้เขียน"]
  Detail --> Feedback["อ่าน Feedback / เขียนและแก้ไขของตนเอง"]
  Dashboard --> Logout["ออกจากระบบ"]
  Logout --> Login
```

## 2. DB diagram

โครงสร้างหลัง migration ถอด provider; แสดงคีย์และฟิลด์หลัก เส้นเชื่อมคือ foreign key จริงเท่านั้น

```mermaid
erDiagram
  users ||--o{ meetings : creator_id
  users |o--o{ meeting_attendees : member_id
  meetings ||--o{ meeting_attendees : meeting_id
  meetings ||--o{ interview_notes : meeting_id
  meetings ||--o{ meeting_feedback : meeting_id
  users ||--o{ deleted_meeting_requests : creator_id

  users {
    uuid id PK
    text email UK
    text display_name
    text password_hash
  }
  meetings {
    uuid id PK
    uuid creator_id FK
    uuid create_request_id
    text title
    text candidate_name
    text candidate_email
    timestamptz starts_at
    timestamptz ends_at
    text status
    text format
    text location
    text manual_join_url
  }
  meeting_attendees {
    uuid meeting_id PK,FK
    text email PK
    uuid member_id FK "nullable"
    text display_name
  }
  interview_notes {
    uuid meeting_id PK,FK
    text author_key PK
    text content
  }
  meeting_feedback {
    uuid id PK
    uuid meeting_id FK
    text author_key
    uuid create_request_id
    text content
  }
  deleted_meeting_requests {
    uuid creator_id PK,FK
    uuid create_request_id PK
    uuid meeting_id UK "ข้อมูลอ้างอิง ไม่ใช่ FK"
  }
  local_demo_seed_runs {
    text dataset_key PK
    text fixture_version
    text manifest_sha256
    timestamptz applied_at
  }
  pgmigrations {
    int id PK
    varchar name
    timestamp run_on
  }
```

`author_key` เป็นข้อมูลผู้เขียน ไม่ใช่ FK ไป `users`; `deleted_meeting_requests` ยังใช้ป้องกันการสร้างนัดที่ลบแล้วซ้ำจาก request เดิม

## 3. วิธีติดตั้งแบบ step by step

เตรียม Git, Node.js `>=24.19.0 <25` พร้อม npm และ Docker Compose แล้วเปิด Docker

1. ดาวน์โหลดโครงการและเข้าโฟลเดอร์

   ```sh
   git clone https://github.com/apinyattp/eggdigital-assignment.git
   cd eggdigital-assignment
   ```

2. สร้างไฟล์ตั้งค่าและคีย์สำหรับเครื่องนี้ คำสั่งจะรักษาไฟล์เดิม

   ```sh
   [ -f .env ] || cp .env.example .env
   npm ci --prefix backend
   npm run setup:local --prefix backend
   npm run setup:bridge --prefix backend
   ```

   หากใช้ Google login ให้กรอก `GOOGLE_CLIENT_ID` และ `GOOGLE_CLIENT_SECRET` ใน `.env` และตั้ง OAuth redirect เป็น `http://localhost:3000/api/auth/callback/google`; เว้นว่างได้เมื่อใช้รหัสผ่าน

3. สร้างและเริ่มระบบ (Docker ติดตั้ง dependencies ของ Front End ให้ และ Back End รัน migrations ก่อนเริ่ม)

   ```sh
   docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env up --build -d --wait
   ```

4. สร้างบัญชีตัวอย่างสำหรับเข้าใช้งาน

   ```sh
   docker compose --env-file .env --env-file backend/.local.env --env-file backend/.bridge.local.env exec backend npm run seed:login
   ```

5. เปิด [หน้า Login](http://localhost:3000/login) ใช้ `sample01@example.test` และรหัส `LOGIN_FIXTURE_PASSWORD` จากไฟล์ส่วนตัว `backend/.local.env` บัญชีตัวอย่างนี้ใช้รหัสผ่าน ไม่ใช่บัญชี Google

   Backend: `http://localhost:3001` · PostgreSQL: `127.0.0.1:5432` (database/user: `meeting_manager`, รหัส `POSTGRES_PASSWORD` ในไฟล์เดียวกัน)
